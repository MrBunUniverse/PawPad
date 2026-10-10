/**
 * DualShock 4 OBS overlay: WebSocket client, capture-delay buffer, simulator, presets, input history.
 * Drawing lives in retro.js.
 */
(function () {
  'use strict';

  const config = { delayMs: 0, deadzone: 0.06, deviceKind: null, shadow: 0, fps: 60, trigger: 'level', bulge: true, squish: false, names: true, opacity: 100, calm: false, theme: 'default', trail: false, autohide: false, history: false };
  // Every look field: what the bridge stores, what Export and presets save, and what this browser remembers.
  const LOOK_KEYS = ['style', 'coat', 'tone', 'layout', 'pad', 'controller', 'source', 'shadow', 'fps', 'trigger', 'bulge', 'squish', 'names', 'opacity', 'calm', 'theme', 'trail', 'autohide', 'history'];
  const DEFAULT_LOOK = { style: 'classic', coat: 'pumpkin', tone: 'default', layout: 'normal', pad: true, controller: 'auto', source: 'auto', shadow: 0, fps: 60, trigger: 'level', bulge: true, squish: false, names: true, opacity: 100, calm: false, theme: 'default', trail: false, autohide: false, history: false };
  const snapshot = () => Object.fromEntries(LOOK_KEYS.map((k) => [k, config[k]]));
  const storeKey = (k) => 'pad' + k[0].toUpperCase() + k.slice(1);
  const stateQueue = []; // FIFO buffer that delays input to match capture-card lag
  let lastActive = performance.now(); // last time a button or stick or trigger moved (auto-hide counts from here)
  const AUTO_HIDE_MS = 8000;

  const $ = (id) => document.getElementById(id);
  const statusBadge = $('connectionStatus');
  const statusText = $('statusText');
  const settingsPanel = $('settingsPanel');
  const delayInput = $('delayInput');
  const delayVal = $('delayVal');
  const deadzoneInput = $('deadzoneInput');
  const deadzoneVal = $('deadzoneVal');
  const simulatorToggle = $('simulatorToggle');
  const mashToggle = $('mashToggle');
  const styleInput = $('styleInput');
  const coatInput = $('coatInput');
  const coatRow = $('coatRow');
  const toneInput = $('toneInput');
  const toneRow = $('toneRow');
  const themeInput = $('themeInput');
  const layoutInput = $('layoutInput');
  const padToggle = $('padToggle');
  const padLabel = $('padLabel');
  const controllerInput = $('controllerInput');
  const sourceInput = $('sourceInput');
  const shadowInput = $('shadowInput');
  const shadowVal = $('shadowVal');
  const stageCanvas = $('retroCanvas');
  const fpsInput = $('fpsInput');
  const fpsVal = $('fpsVal');
  const opacityInput = $('opacityInput');
  const opacityVal = $('opacityVal');
  const squeezeToggle = $('squeezeToggle');
  const bulgeToggle = $('bulgeToggle');
  const squishToggle = $('squishToggle');
  const namesToggle = $('namesToggle');
  const advancedToggle = $('advancedToggle');
  const historyBox = $('history');
  const statLine = $('statLine');

  // Segmented buttons mirror each <select data-seg>: the select stays the source of truth.
  const COAT_DOT = { pumpkin: '#d9822b', shadow: '#2b2b33', snowball: '#e6e6ee', smokey: '#7d8794', mittens: '#e3d2b2' };
  const segSelects = [...document.querySelectorAll('select[data-seg]')];
  segSelects.forEach((sel) => {
    const box = document.createElement('div');
    box.className = `seg${sel.dataset.seg === 'swatch' ? ' swatch' : ''}`;
    box.setAttribute('role', 'radiogroup');
    [...sel.options].forEach((o) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.v = o.value;
      btn.setAttribute('role', 'radio');
      if (sel.dataset.seg === 'swatch') btn.innerHTML = `<i style="--dot:${COAT_DOT[o.value]}"></i>`;
      btn.append(o.textContent);
      btn.addEventListener('click', () => {
        if (sel.value !== o.value) { sel.value = o.value; sel.dispatchEvent(new Event('change')); }
      });
      box.append(btn);
    });
    sel.after(box);
    sel.hidden = true;
    sel.seg = box;
  });
  const syncSegs = () => segSelects.forEach((sel) => [...sel.seg.children].forEach((b) => b.setAttribute('aria-checked', b.dataset.v === sel.value)));

  // Status badge: bridge link, then whether the PS4 is actually sending.
  const link = { bridge: false, ps4: false, local: null, active: null };
  function showStatus() {
    statusBadge.classList.toggle('connected', link.bridge && (link.ps4 || link.active === 'local' || simulatorToggle.checked));
    statusText.textContent = !link.bridge ? 'Bridge offline'
      : simulatorToggle.checked ? (mashToggle.checked ? 'Button mash' : 'Test mode')
      : link.active === 'local' ? `Controller: ${link.local.name}`
      : link.ps4 ? 'PS4 live' : 'Waiting for PS4';
  }

  function setDelay(ms) {
    config.delayMs = ms;
    delayInput.value = ms;
    delayVal.textContent = `${ms} ms`;
  }

  // One look = style + coat/tone + layout + touchpad + controller type. applyLook merges a partial change and redraws.
  // Controller type 'auto' follows the connected pad (PlayStation pads and "no pad" -> PlayStation look, anything else -> Xbox look).
  const effectiveController = () => (config.controller !== 'auto' ? config.controller : ['playstation', null].includes(config.deviceKind) ? 'ps' : 'xbox');
  function applyLook(patch) {
    const l = { ...snapshot(), ...patch };
    config.style = ['fine', 'bun', 'cat'].includes(l.style) ? l.style : 'classic';
    config.coat = [...coatInput.options].some(o => o.value === l.coat) ? l.coat : config.coat || 'pumpkin';
    config.tone = l.tone === 'midnight' ? 'midnight' : 'default';
    config.layout = l.layout === 'wide' ? 'wide' : 'normal';
    config.pad = l.pad !== false && l.pad !== 'false' && l.pad !== '0';
    config.controller = ['ps', 'xbox'].includes(l.controller) ? l.controller : 'auto';
    config.source = ['ps4', 'local'].includes(l.source) ? l.source : 'auto'; // bridge-side: which input to show
    config.trigger = l.trigger === 'squeeze' ? 'squeeze' : 'level'; // L2/R2 look: level meter with readout, or squeeze
    config.bulge = l.bulge !== false && l.bulge !== 'false'; // Bun / Cat only: squeezed triggers bulge out (on by default)
    config.squish = l.squish === true || l.squish === 'true'; // Bun / Cat only: pressed buttons squish and bulge (off by default)
    config.names = l.names !== false && l.names !== 'false'; // button names on the controller: LT / RT or L2 / R2 (on by default)
    config.calm = l.calm === true || l.calm === 'true'; // no motion at all
    config.theme = ['contrast', 'night', 'pastel'].includes(l.theme) ? l.theme : 'default';
    config.trail = l.trail === true || l.trail === 'true'; // faint dots behind the stick caps
    config.autohide = l.autohide === true || l.autohide === 'true'; // fade out after a quiet spell
    config.history = l.history === true || l.history === 'true'; // last few presses in the corner
    setShadow(Math.min(100, Math.max(0, Math.round(Number(l.shadow) || 0))));
    setFps(Math.min(60, Math.max(5, Math.round(Number(l.fps) || 60))));
    setOpacity(Math.min(100, Math.max(10, Math.round(Number(l.opacity) || 100))));
    const ctrl = effectiveController();
    styleInput.value = config.style; coatInput.value = config.coat; toneInput.value = config.tone; themeInput.value = config.theme;
    layoutInput.value = config.layout; controllerInput.value = config.controller; sourceInput.value = config.source; padToggle.checked = config.pad; squeezeToggle.checked = config.trigger === 'squeeze'; bulgeToggle.checked = config.bulge; squishToggle.checked = config.squish; namesToggle.checked = config.names;
    document.querySelectorAll('input[data-look]').forEach((el) => { el.checked = !!config[el.dataset.look]; });
    coatRow.hidden = config.style !== 'cat';
    toneRow.hidden = config.style !== 'fine';
    padLabel.textContent = ctrl === 'xbox' ? 'Guide button' : 'Touchpad';
    syncSegs();
    window.RetroPad.setStyle(config.style, config.coat, config.tone, config.layout, config.pad, ctrl, config.trigger, config.bulge, config.squish, config.names, { calm: config.calm, theme: config.theme, trail: config.trail });
    try { for (const k of LOOK_KEYS) localStorage.setItem(storeKey(k), config[k]); } catch (e) { /* storage blocked */ }
    if (!config.history) historyBox.hidden = true;
  }

  function setDeadzone(fraction) {
    config.deadzone = fraction;
    deadzoneInput.value = Math.round(fraction * 100);
    deadzoneVal.textContent = `${Math.round(fraction * 100)}%`;
  }

  // Shadow behind the controller, for busy game backgrounds: a CSS drop shadow on the canvas. 0 = off.
  function setShadow(pct) {
    config.shadow = pct;
    shadowInput.value = pct;
    shadowVal.textContent = pct ? `${pct}%` : 'Off';
    stageCanvas.style.filter = pct ? `drop-shadow(0 4px ${6 + pct / 25}px rgba(0,0,0,${pct / 100}))` : ''; // blur widens 6px -> 10px at max
  }

  // Frame-rate cap for the overlay, 5 to 60 fps: fewer redraws (less CPU) or a choppy, stylised look.
  function setFps(fps) {
    config.fps = fps;
    fpsInput.value = fps;
    fpsVal.textContent = `${fps} fps`;
  }

  // Opacity of the controller, 10 to 100%: see through it, or fade it into a busy scene. 100 = no opacity style at all.
  function setOpacity(pct) {
    config.opacity = pct;
    opacityInput.value = pct;
    opacityVal.textContent = `${pct}%`;
    refreshStage();
  }

  // The controller's opacity, or 0 while auto-hide has it faded out after a quiet spell. Only the value that changed is written.
  let stageTarget = null;
  function refreshStage() {
    const hidden = config.autohide && performance.now() - lastActive > AUTO_HIDE_MS;
    const target = hidden ? '0' : config.opacity < 100 ? String(config.opacity / 100) : '';
    if (target === stageTarget) return;
    stageTarget = target;
    stageCanvas.style.transition = 'opacity 0.6s ease';
    stageCanvas.style.opacity = target;
  }

  // Advanced settings show the rarer rows. The choice is per browser, not sent to OBS.
  function setAdvanced(on) {
    document.body.classList.toggle('simple', !on);
    advancedToggle.checked = on;
    try { localStorage.setItem('padAdvanced', on ? 'true' : 'false'); } catch (e) { /* storage blocked */ }
  }

  // URL params: hideUI=1 (or obs), delay=0..500, deadzone=0..0.5, layout=normal|wide, touchpad=0, controller=auto|ps|xbox, preset=classic|fine|bun|fine-midnight|pumpkin|shadow|snowball|smokey|mittens, style=classic|fine|bun|cat, cat=pumpkin|shadow|snowball|smokey|mittens, demo=1 (or sim=1), look=<base64 look from Copy look URL>.
  // Any other param (e.g. an old theme=) is ignored.
  function parseUrlParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('hideUI') === '1' || params.get('hideui') === '1' || params.has('obs')) {
      document.body.classList.add('hide-ui');
    }
    const d = parseInt(params.get('delay'), 10);
    if (d >= 0 && d <= 500) config.delayMs = d;
    const dz = parseFloat(params.get('deadzone'));
    if (dz >= 0 && dz <= 0.5) config.deadzone = dz;
    if (params.get('demo') === '1' || params.get('sim') === '1') {
      simulatorToggle.checked = true;
    }
    setDelay(config.delayMs);
    setDeadzone(config.deadzone);
    const saved = {};
    try { for (const k of LOOK_KEYS) saved[k] = localStorage.getItem(storeKey(k)); } catch (e) { /* storage blocked */ }
    // ?preset=pumpkin (or classic / fine / bun) is a one-word shortcut; ?style= / ?cat= still work. Any of them pins this page.
    const preset = params.get('preset');
    const isCoat = (p) => [...coatInput.options].some(o => o.value === p);
    const fineMidnight = preset === 'fine-midnight';
    const urlStyle = preset ? (isCoat(preset) ? 'cat' : fineMidnight ? 'fine' : preset) : params.get('style');
    const urlLayout = params.get('layout'), urlPad = params.get('touchpad'), urlController = params.get('controller');
    config.pinned = !!(urlStyle || urlLayout || urlPad || urlController); // a URL-pinned page ignores the live look from the bridge
    applyLook({
      ...saved,
      style: urlStyle || saved.style,
      coat: (isCoat(preset) ? preset : params.get('cat')) || saved.coat,
      tone: fineMidnight ? 'midnight' : (urlStyle ? params.get('tone') : saved.tone),
      layout: urlLayout || saved.layout,
      pad: urlPad !== null ? urlPad : saved.pad,
      controller: urlController || saved.controller
    });
    // ?look= is a whole look from a copied link, for one OBS scene. It pins the page to that look.
    const look = params.get('look');
    if (look) {
      try { applyLook(JSON.parse(atob(look))); config.pinned = true; } catch (e) { /* a broken link keeps the saved look */ }
    }
  }

  $('settingsToggleBtn').addEventListener('click', () => settingsPanel.classList.toggle('open'));
  $('closePanelBtn').addEventListener('click', () => settingsPanel.classList.remove('open'));
  delayInput.addEventListener('input', (e) => setDelay(parseInt(e.target.value, 10)));
  // Every look control: apply the change here, then tell the bridge so OBS follows.
  const bind = (el, key) => el.addEventListener('change', () => { applyLook({ [key]: el === padToggle ? el.checked : el.value }); sendLook(); });
  [[styleInput, 'style'], [coatInput, 'coat'], [toneInput, 'tone'], [layoutInput, 'layout'], [padToggle, 'pad'], [controllerInput, 'controller'], [sourceInput, 'source'], [themeInput, 'theme']].forEach(([el, key]) => bind(el, key));
  deadzoneInput.addEventListener('input', (e) => setDeadzone(parseInt(e.target.value, 10) / 100));
  shadowInput.addEventListener('input', (e) => applyLook({ shadow: e.target.value })); // live preview while dragging
  shadowInput.addEventListener('change', () => sendLook()); // send once on release, so OBS follows
  fpsInput.addEventListener('input', (e) => applyLook({ fps: e.target.value }));
  fpsInput.addEventListener('change', () => sendLook());
  opacityInput.addEventListener('input', (e) => applyLook({ opacity: e.target.value })); // live preview while dragging
  opacityInput.addEventListener('change', () => sendLook()); // send once on release, so OBS follows
  squeezeToggle.addEventListener('change', () => { applyLook({ trigger: squeezeToggle.checked ? 'squeeze' : 'level' }); sendLook(); });
  bulgeToggle.addEventListener('change', () => { applyLook({ bulge: bulgeToggle.checked }); sendLook(); });
  squishToggle.addEventListener('change', () => { applyLook({ squish: squishToggle.checked }); sendLook(); });
  namesToggle.addEventListener('change', () => { applyLook({ names: namesToggle.checked }); sendLook(); });
  // Switches marked data-look (calm, trail, auto-hide, history) follow the same path: apply, then send.
  document.querySelectorAll('input[data-look]').forEach((el) => el.addEventListener('change', () => { applyLook({ [el.dataset.look]: el.checked }); sendLook(); }));
  advancedToggle.addEventListener('change', () => setAdvanced(advancedToggle.checked));

  // Test mode runs on the bridge so every client (including OBS) receives it.
  // The chosen look lives on the bridge, so every page (OBS included) follows it with no URL changes.
  const sendLook = () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'look', ...snapshot() }));
  };
  const sendSim = () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sim', on: simulatorToggle.checked }));
  };
  simulatorToggle.addEventListener('change', () => {
    if (!simulatorToggle.checked) { mashToggle.checked = false; setMash(false); }
    sendSim(); showStatus();
  });

  // Button mash (preview only): this page makes its own random presses at random moments, some only one frame long, so the
  // squish gets busy input. Turning it on also turns Test mode on, and while it runs this page ignores the bridge's test pattern.
  const MASH_BUTTONS = ['cross', 'circle', 'triangle', 'square', 'l1', 'r1', 'l3', 'r3', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'share', 'options', 'touchpad'];
  const mashLeft = {}; // button -> ticks it is still pressed
  let mashTimer = null;
  function mashTick() {
    if (Math.random() < 0.25) { // about 15 presses a second on the 60 Hz tick
      const free = MASH_BUTTONS.filter((n) => !mashLeft[n]);
      if (free.length) mashLeft[free[Math.floor(Math.random() * free.length)]] = 1 + Math.floor(Math.random() * 8); // held 1 to 8 ticks
    }
    const buttons = {};
    for (const n of MASH_BUTTONS) { buttons[n] = mashLeft[n] > 0; if (mashLeft[n] > 0) mashLeft[n]--; }
    stateQueue.push({ localTime: performance.now(), state: { type: 'pad_state', buttons, axes: {}, triggers: {}, touch: { active: false } } });
    if (stateQueue.length > 600) stateQueue.shift();
  }
  function setMash(on) {
    if (on && !mashTimer) mashTimer = setInterval(mashTick, 16);
    if (!on && mashTimer) { clearInterval(mashTimer); mashTimer = null; MASH_BUTTONS.forEach((n) => { mashLeft[n] = 0; }); }
  }
  mashToggle.addEventListener('change', () => {
    if (mashToggle.checked && !simulatorToggle.checked) { simulatorToggle.checked = true; sendSim(); }
    setMash(mashToggle.checked); showStatus();
  });

  // Radial deadzone with rescaling so the stick still reaches +/-1.
  function applyDeadzone(x, y, deadzone) {
    const mag = Math.hypot(x, y);
    if (mag < deadzone) return { x: 0, y: 0 };
    const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
    return { x: (x / mag) * scaled, y: (y / mag) * scaled };
  }

  function renderState(state) {
    const axes = state.axes || {};
    window.RetroPad.draw(
      state,
      applyDeadzone(axes.lx_norm || 0, axes.ly_norm || 0, config.deadzone),
      applyDeadzone(axes.rx_norm || 0, axes.ry_norm || 0, config.deadzone)
    );
  }

  // Input history and signal stats. A press is a button that went from up to down between two states.
  const LABELS_PS = { cross: 'CROSS', circle: 'CIRCLE', triangle: 'TRIANGLE', square: 'SQUARE', l1: 'L1', r1: 'R1', l3: 'L3', r3: 'R3', share: 'SHARE', options: 'OPTIONS', touchpad: 'TOUCHPAD', dpad_up: 'UP', dpad_down: 'DOWN', dpad_left: 'LEFT', dpad_right: 'RIGHT' };
  const LABELS_XBOX = { ...LABELS_PS, cross: 'A', circle: 'B', square: 'X', triangle: 'Y', l1: 'LB', r1: 'RB', l3: 'LS', r3: 'RS', share: 'VIEW', options: 'MENU', touchpad: 'GUIDE' };
  const pressLog = [];
  let prevPressed = {};
  let packets = 0, presses = 0, lastPacket = 0;
  function noteInput(state) {
    const b = state.buttons || {};
    const names = effectiveController() === 'xbox' ? LABELS_XBOX : LABELS_PS;
    for (const k of Object.keys(b)) {
      if (b[k] && !prevPressed[k]) { presses++; pressLog.push(names[k] || k.toUpperCase()); if (pressLog.length > 4) pressLog.shift(); }
    }
    prevPressed = b;
    const a = state.axes || {}, t = state.triggers || {};
    const moved = Math.abs(a.lx_norm || 0) + Math.abs(a.ly_norm || 0) + Math.abs(a.rx_norm || 0) + Math.abs(a.ry_norm || 0) + (t.l2_norm || 0) + (t.r2_norm || 0);
    if (moved > 0.05 || Object.values(b).some(Boolean)) lastActive = performance.now();
    historyBox.hidden = !config.history;
    if (config.history) historyBox.textContent = pressLog.join('  ·  ');
  }
  setInterval(() => {
    statLine.textContent = lastPacket ? `${packets}/s · last ${Math.round(performance.now() - lastPacket)} ms ago · ${presses} presses/s` : 'no packets yet';
    packets = 0; presses = 0;
  }, 1000);

  let lastFrame = 0;
  function animationLoop() {
    const now = performance.now();
    // Frame-rate cap (the 2 ms slack absorbs vsync jitter). Skipped frames leave their states queued, so the newest one is still drawn.
    if (now - lastFrame >= 1000 / config.fps - 2) {
      lastFrame = now;
      let due = null; // several states can arrive per frame: only the newest one is worth drawing
      while (stateQueue.length && now - stateQueue[0].localTime >= config.delayMs) {
        if (due) window.RetroPad.latch(due.buttons); // a skipped state still counts: a tap shorter than a frame still squashes
        due = stateQueue.shift().state;
        noteInput(due);
      }
      if (due) renderState(due);
      window.RetroPad.tick(); // keeps the squish springs moving between pad states, on the same frame-rate cap
    }
    refreshStage(); // auto-hide checks the clock every frame, so a fade starts on time
    requestAnimationFrame(animationLoop);
  }

  let ws = null;
  let reconnectDelay = 1000;
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host || 'localhost:8080'}`);

    ws.onopen = () => {
      link.bridge = true; reconnectDelay = 1000; sendSim(); showStatus();
      if (!document.body.classList.contains('hide-ui') && !config.pinned) sendLook();
    };
    ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      if (data.type === 'welcome' && data.ips && data.ips.length) {
        $('detectedIp').textContent = `${data.ips.map(i => i.address).join(' or ')}:${data.udpPort || 9999}`;
      } else if (data.type === 'look') {
        if (!config.pinned) applyLook(data);
      } else if (data.type === 'status') {
        link.ps4 = !!data.ps4;
        link.local = data.local || null;
        link.active = data.active || null;
        const kind = link.local ? link.local.kind : null;
        if (kind !== config.deviceKind) { config.deviceKind = kind; applyLook({}); } // 'auto' controller type follows the pad
        showStatus();
      } else if (data.type === 'pad_state') {
        packets++; lastPacket = performance.now(); // counts what the bridge sends, for the Signal line
        if (mashTimer) return; // the bridge's test pattern would fight the button mash on this page
        stateQueue.push({ localTime: performance.now(), state: data });
        if (stateQueue.length > 600) stateQueue.shift(); // frames stop while the source is hidden: don't grow forever
      }
    };
    ws.onclose = () => {
      link.bridge = link.ps4 = false;
      showStatus();
      setTimeout(connectWebSocket, reconnectDelay = Math.min(reconnectDelay * 1.5, 8000));
    };
    ws.onerror = () => ws.close();
  }

  // Button text flashes for a moment after a copy or save, then goes back to what it said.
  const flash = (btn, text) => {
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = old; }, 1500);
  };
  const copyBtn = $('copyObsUrlBtn');
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(`http://${window.location.host}/?hideUI=1`).then(() => {
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy OBS URL';
        copyBtn.classList.remove('copied');
      }, 2000);
    });
  });
  $('lookUrlBtn').addEventListener('click', (e) => {
    const url = `${window.location.origin}/?hideUI=1&look=${btoa(JSON.stringify(snapshot()))}`;
    navigator.clipboard.writeText(url).then(() => flash(e.currentTarget, 'Copied!'));
  });

  // Presets: named whole looks, kept in this browser.
  const presetName = $('presetName'), presetSelect = $('presetSelect');
  const readPresets = () => { try { return JSON.parse(localStorage.getItem('padPresets')) || {}; } catch (e) { return {}; } };
  const writePresets = (p) => { try { localStorage.setItem('padPresets', JSON.stringify(p)); } catch (e) { /* storage blocked */ } };
  function refreshPresets(selected) {
    const names = Object.keys(readPresets());
    presetSelect.replaceChildren(...(names.length ? names.map((n) => new Option(n, n)) : [new Option('(none saved)', '')]));
    if (selected && names.includes(selected)) presetSelect.value = selected;
  }
  $('savePresetBtn').addEventListener('click', (e) => {
    const name = presetName.value.trim();
    if (!name) return;
    const p = readPresets(); p[name] = snapshot(); writePresets(p);
    refreshPresets(name); presetName.value = '';
    flash(e.currentTarget, 'Saved');
  });
  $('loadPresetBtn').addEventListener('click', () => {
    const look = readPresets()[presetSelect.value];
    if (look) { applyLook(look); sendLook(); }
  });
  $('deletePresetBtn').addEventListener('click', () => {
    const p = readPresets(); delete p[presetSelect.value]; writePresets(p); refreshPresets();
  });

  // Export and import: the same look as a JSON file, for backups or sharing.
  $('exportBtn').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }));
    a.download = 'pawpad-look.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const importFile = $('importFile');
  $('importBtn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    if (!file) return;
    try { applyLook(JSON.parse(await file.text())); sendLook(); } catch (e) { /* not a PawPad look file: keep the current look */ }
    importFile.value = '';
  });

  // Reset: back to the default look, delay and deadzone. The advanced view and Test mode are left alone.
  $('resetBtn').addEventListener('click', () => {
    applyLook(DEFAULT_LOOK); setDelay(0); setDeadzone(0.06); sendLook();
  });

  refreshPresets();
  setAdvanced(localStorage.getItem('padAdvanced') === 'true');
  parseUrlParams();
  if (!document.body.classList.contains('hide-ui')) settingsPanel.classList.add('open');
  connectWebSocket();
  requestAnimationFrame(animationLoop);
})();
