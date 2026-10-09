/**
 * DualShock 4 OBS overlay: WebSocket client, capture-delay buffer, simulator.
 * Drawing lives in retro.js.
 */
(function () {
  'use strict';

  const config = { delayMs: 0, deadzone: 0.06, deviceKind: null, shadow: 0, fps: 60, trigger: 'level', bulge: true, squish: false, names: true, opacity: 100 };
  const stateQueue = []; // FIFO buffer that delays input to match capture-card lag

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
    const l = { style: config.style, coat: config.coat, tone: config.tone, layout: config.layout, pad: config.pad, controller: config.controller, source: config.source, shadow: config.shadow, fps: config.fps, trigger: config.trigger, bulge: config.bulge, squish: config.squish, names: config.names, opacity: config.opacity, ...patch };
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
    setShadow(Math.min(100, Math.max(0, Math.round(Number(l.shadow) || 0))));
    setFps(Math.min(60, Math.max(5, Math.round(Number(l.fps) || 60))));
    setOpacity(Math.min(100, Math.max(10, Math.round(Number(l.opacity) || 100))));
    const ctrl = effectiveController();
    styleInput.value = config.style; coatInput.value = config.coat; toneInput.value = config.tone;
    layoutInput.value = config.layout; controllerInput.value = config.controller; sourceInput.value = config.source; padToggle.checked = config.pad; squeezeToggle.checked = config.trigger === 'squeeze'; bulgeToggle.checked = config.bulge; squishToggle.checked = config.squish; namesToggle.checked = config.names;
    coatRow.hidden = config.style !== 'cat';
    toneRow.hidden = config.style !== 'fine';
    padLabel.textContent = ctrl === 'xbox' ? 'Guide button' : 'Touchpad';
    syncSegs();
    window.RetroPad.setStyle(config.style, config.coat, config.tone, config.layout, config.pad, ctrl, config.trigger, config.bulge, config.squish, config.names);
    try { for (const k of ['style', 'coat', 'tone', 'layout', 'pad', 'controller', 'source', 'shadow', 'fps', 'trigger', 'bulge', 'squish', 'names', 'opacity']) localStorage.setItem('pad' + k[0].toUpperCase() + k.slice(1), config[k]); } catch (e) { /* storage blocked */ }
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
    stageCanvas.style.opacity = pct < 100 ? pct / 100 : '';
  }

  // URL params: hideUI=1 (or obs), delay=0..500, deadzone=0..0.5, layout=normal|wide, touchpad=0, controller=auto|ps|xbox, preset=classic|fine|bun|fine-midnight|pumpkin|shadow|snowball|smokey|mittens, style=classic|fine|bun|cat, cat=pumpkin|shadow|snowball|smokey|mittens, demo=1 (or sim=1).
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
    try { for (const k of ['style', 'coat', 'tone', 'layout', 'pad', 'controller', 'source', 'shadow', 'fps', 'trigger', 'bulge', 'squish', 'names', 'opacity']) saved[k] = localStorage.getItem('pad' + k[0].toUpperCase() + k.slice(1)); } catch (e) { /* storage blocked */ }
    // ?preset=pumpkin (or classic / fine / bun) is a one-word shortcut; ?style= / ?cat= still work. Any of them pins this page.
    const preset = params.get('preset');
    const isCoat = (p) => [...coatInput.options].some(o => o.value === p);
    const fineMidnight = preset === 'fine-midnight';
    const urlStyle = preset ? (isCoat(preset) ? 'cat' : fineMidnight ? 'fine' : preset) : params.get('style');
    const urlLayout = params.get('layout'), urlPad = params.get('touchpad'), urlController = params.get('controller');
    config.pinned = !!(urlStyle || urlLayout || urlPad || urlController); // a URL-pinned page ignores the live look from the bridge
    applyLook({
      style: urlStyle || saved.style,
      coat: (isCoat(preset) ? preset : params.get('cat')) || saved.coat,
      tone: fineMidnight ? 'midnight' : (urlStyle ? params.get('tone') : saved.tone),
      layout: urlLayout || saved.layout,
      pad: urlPad !== null ? urlPad : saved.pad,
      controller: urlController || saved.controller,
      source: saved.source,
      shadow: saved.shadow,
      fps: saved.fps,
      trigger: saved.trigger,
      bulge: saved.bulge,
      squish: saved.squish,
      names: saved.names,
      opacity: saved.opacity
    });
  }

  $('settingsToggleBtn').addEventListener('click', () => settingsPanel.classList.toggle('open'));
  $('closePanelBtn').addEventListener('click', () => settingsPanel.classList.remove('open'));
  delayInput.addEventListener('input', (e) => setDelay(parseInt(e.target.value, 10)));
  // Every look control: apply the change here, then tell the bridge so OBS follows.
  const bind = (el, key) => el.addEventListener('change', () => { applyLook({ [key]: el === padToggle ? el.checked : el.value }); sendLook(); });
  [[styleInput, 'style'], [coatInput, 'coat'], [toneInput, 'tone'], [layoutInput, 'layout'], [padToggle, 'pad'], [controllerInput, 'controller'], [sourceInput, 'source']].forEach(([el, key]) => bind(el, key));
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
  // Test mode runs on the bridge so every client (including OBS) receives it.
  // The chosen look lives on the bridge, so every page (OBS included) follows it with no URL changes.
  const sendLook = () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'look', style: config.style, coat: config.coat, tone: config.tone, layout: config.layout, pad: config.pad, controller: config.controller, source: config.source, shadow: config.shadow, fps: config.fps, trigger: config.trigger, bulge: config.bulge, squish: config.squish, names: config.names, opacity: config.opacity }));
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
      }
      if (due) renderState(due);
      window.RetroPad.tick(); // keeps the squish springs moving between pad states, on the same frame-rate cap
    }
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

  parseUrlParams();
  if (!document.body.classList.contains('hide-ui')) settingsPanel.classList.add('open');
  connectWebSocket();
  requestAnimationFrame(animationLoop);
})();
