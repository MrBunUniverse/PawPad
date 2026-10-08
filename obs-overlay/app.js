/**
 * DualShock 4 OBS overlay: WebSocket client, capture-delay buffer, simulator.
 * Drawing lives in retro.js.
 */
(function () {
  'use strict';

  const config = { delayMs: 0, deadzone: 0.06 };
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
  const styleInput = $('styleInput');
  const coatInput = $('coatInput');
  const coatRow = $('coatRow');
  const toneInput = $('toneInput');
  const toneRow = $('toneRow');
  const layoutInput = $('layoutInput');
  const padToggle = $('padToggle');

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
  const link = { bridge: false, ps4: false };
  function showStatus() {
    statusBadge.classList.toggle('connected', link.bridge && (link.ps4 || simulatorToggle.checked));
    statusText.textContent = !link.bridge ? 'Bridge offline'
      : simulatorToggle.checked ? 'Test mode'
      : link.ps4 ? 'PS4 live' : 'Waiting for PS4';
  }

  function setDelay(ms) {
    config.delayMs = ms;
    delayInput.value = ms;
    delayVal.textContent = `${ms} ms`;
  }

  function setStyle(name, coat, tone, layout, pad) {
    config.style = ['fine', 'bun', 'cat'].includes(name) ? name : 'classic';
    config.coat = [...coatInput.options].some(o => o.value === coat) ? coat : config.coat || 'pumpkin';
    config.tone = tone === 'midnight' ? 'midnight' : 'default';
    config.layout = layout === 'wide' ? 'wide' : 'normal';
    layoutInput.value = config.layout;
    config.pad = pad !== false && pad !== 'false' && pad !== '0';
    padToggle.checked = config.pad;
    styleInput.value = config.style;
    coatInput.value = config.coat;
    toneInput.value = config.tone;
    coatRow.hidden = config.style !== 'cat';
    toneRow.hidden = config.style !== 'fine';
    syncSegs();
    window.RetroPad.setStyle(config.style, config.coat, config.tone, config.layout, config.pad);
    try { localStorage.setItem('padStyle', config.style); localStorage.setItem('padCoat', config.coat); localStorage.setItem('padTone', config.tone); localStorage.setItem('padLayout', config.layout); localStorage.setItem('padPad', config.pad); } catch (e) { /* storage blocked */ }
  }

  function setDeadzone(fraction) {
    config.deadzone = fraction;
    deadzoneInput.value = Math.round(fraction * 100);
    deadzoneVal.textContent = `${Math.round(fraction * 100)}%`;
  }

  // URL params: hideUI=1 (or obs), delay=0..500, deadzone=0..0.5, layout=normal|wide, touchpad=0, preset=classic|fine|bun|fine-midnight|pumpkin|shadow|snowball|smokey|mittens, style=classic|fine|bun|cat, cat=pumpkin|shadow|snowball|smokey|mittens, demo=1 (or sim=1).
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
    let saved = null, savedCoat = null, savedTone = null, savedLayout = null, savedPad = null;
    try { saved = localStorage.getItem('padStyle'); savedCoat = localStorage.getItem('padCoat'); savedTone = localStorage.getItem('padTone'); savedLayout = localStorage.getItem('padLayout'); savedPad = localStorage.getItem('padPad'); } catch (e) { /* storage blocked */ }
    // ?preset=pumpkin (or classic / fine / bun) is a one-word shortcut; ?style= / ?cat= still work. Any of them pins this page.
    const preset = params.get('preset');
    const isCoat = (p) => [...coatInput.options].some(o => o.value === p);
    const fineMidnight = preset === 'fine-midnight';
    const urlStyle = preset ? (isCoat(preset) ? 'cat' : fineMidnight ? 'fine' : preset) : params.get('style');
    const urlLayout = params.get('layout'), urlPad = params.get('touchpad');
    config.pinned = !!(urlStyle || urlLayout || urlPad); // a URL-pinned page ignores the live look from the bridge
    setStyle(urlStyle || saved, (isCoat(preset) ? preset : params.get('cat')) || savedCoat,
      fineMidnight ? 'midnight' : (urlStyle ? params.get('tone') : savedTone), urlLayout || savedLayout, urlPad !== null ? urlPad : savedPad); // ?style= wins over the remembered choice
  }

  $('settingsToggleBtn').addEventListener('click', () => settingsPanel.classList.toggle('open'));
  $('closePanelBtn').addEventListener('click', () => settingsPanel.classList.remove('open'));
  delayInput.addEventListener('input', (e) => setDelay(parseInt(e.target.value, 10)));
  styleInput.addEventListener('change', (e) => { setStyle(e.target.value, config.coat, config.tone, config.layout, config.pad); sendLook(); });
  coatInput.addEventListener('change', (e) => { setStyle(config.style, e.target.value, config.tone, config.layout, config.pad); sendLook(); });
  toneInput.addEventListener('change', (e) => { setStyle(config.style, config.coat, e.target.value, config.layout, config.pad); sendLook(); });
  layoutInput.addEventListener('change', (e) => { setStyle(config.style, config.coat, config.tone, e.target.value, config.pad); sendLook(); });
  padToggle.addEventListener('change', () => { setStyle(config.style, config.coat, config.tone, config.layout, padToggle.checked); sendLook(); });
  deadzoneInput.addEventListener('input', (e) => setDeadzone(parseInt(e.target.value, 10) / 100));
  // Test mode runs on the bridge so every client (including OBS) receives it.
  // The chosen look lives on the bridge, so every page (OBS included) follows it with no URL changes.
  const sendLook = () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'look', style: config.style, coat: config.coat, tone: config.tone, layout: config.layout, pad: config.pad }));
  };
  const sendSim = () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sim', on: simulatorToggle.checked }));
  };
  simulatorToggle.addEventListener('change', () => { sendSim(); showStatus(); });

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

  function animationLoop() {
    const now = performance.now();
    let due = null; // several states can arrive per frame: only the newest one is worth drawing
    while (stateQueue.length && now - stateQueue[0].localTime >= config.delayMs) due = stateQueue.shift().state;
    if (due) renderState(due);
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
        if (!config.pinned) setStyle(data.style, data.coat, data.tone, data.layout, data.pad);
      } else if (data.type === 'status') {
        link.ps4 = !!data.ps4;
        showStatus();
      } else if (data.type === 'pad_state') {
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
