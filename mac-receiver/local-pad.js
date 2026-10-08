'use strict';
/**
 * Controllers plugged into this computer (PlayStation, Xbox, Switch, ...), read through SDL.
 * Output is the same `pad_state` message the PS4 path produces, so everything downstream is unchanged.
 * SDL is optional: if it can't be loaded the bridge simply stays PS4-only.
 */
const path = require('node:path');
const { createRequire } = require('node:module');

const kindOf = (type) => (/^ps[345]$/.test(type || '') ? 'playstation'
    : /^xbox/.test(type || '') ? 'xbox'
    : /^nintendo/.test(type || '') ? 'switch' : 'other');

// SDL's standard controller names -> the PS4 names the overlay already uses.
// SDL does not expose the DualShock touchpad, so the centre button (PS / Xbox / Guide) takes the touchpad slot.
const BUTTONS = {
    a: 'cross', b: 'circle', x: 'square', y: 'triangle',
    leftShoulder: 'l1', rightShoulder: 'r1', leftStick: 'l3', rightStick: 'r3',
    back: 'share', start: 'options', guide: 'touchpad',
    dpadUp: 'dpad_up', dpadRight: 'dpad_right', dpadDown: 'dpad_down', dpadLeft: 'dpad_left'
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

/** buttons/axes as SDL reports them -> pad_state. `buttonNames` = every button name the overlay knows. */
function mapPad(buttons = {}, axes = {}, buttonNames = Object.values(BUTTONS)) {
    const out = {};
    for (const name of buttonNames) out[name] = false;
    for (const [sdlName, name] of Object.entries(BUTTONS)) if (buttons[sdlName]) out[name] = true;
    const l2 = clamp(axes.leftTrigger, 0, 1);
    const r2 = clamp(axes.rightTrigger, 0, 1);
    if ('l2' in out) out.l2 = l2 > 0.5;
    if ('r2' in out) out.r2 = r2 > 0.5;
    return {
        type: 'pad_state',
        buttons: out,
        axes: {
            lx_norm: clamp(axes.leftStickX, -1, 1), ly_norm: clamp(axes.leftStickY, -1, 1),
            rx_norm: clamp(axes.rightStickX, -1, 1), ry_norm: clamp(axes.rightStickY, -1, 1)
        },
        triggers: { l2_norm: l2, r2_norm: r2 },
        touch: { active: false }
    };
}

/**
 * Finds SDL: a copy shipped next to the executable (`native/sdl`), a copy beside this file, or the
 * normal node_modules install when running from source. Returns null if none loads.
 */
function loadSdl(baseDirs, log = () => {}) {
    // SDL's video init makes this node process a Dock app; the bridge has no window, so keep it background-only.
    process.env.SDL_MAC_BACKGROUND_APP = '1';
    const tries = [];
    for (const dir of baseDirs) tries.push(() => createRequire(path.join(dir, 'x.js'))(path.join(dir, 'native', 'sdl')));
    tries.push(() => createRequire(__filename)('@kmamal/sdl'));
    let lastError = null;
    for (const attempt of tries) {
        try { return attempt(); } catch (e) { lastError = e; }
    }
    log(`local controllers unavailable (${lastError && lastError.code === 'MODULE_NOT_FOUND' ? 'SDL not installed' : lastError && lastError.message})`);
    return null;
}

/**
 * Polls the first connected controller and reports changes.
 *   onState(pad_state)   when the mapped state changes
 *   onDevice({name, kind} | null)   when a controller is added or removed
 *
 * Deliberately uses no SDL event listeners: registering one makes the binding spin a busy zero-delay loop
 * (a few % CPU for nothing). Instead we diff the device list on a slow timer while no pad is connected
 * and read the pad's state on a fast one while it is.
 */
function createLocalPad({ sdl, onState, onDevice, buttonNames, log = () => {}, pollMs = 8, idleMs = 250 }) {
    let device = null;
    let inst = null;
    let lastKey = '';

    const open = (dev) => {
        try {
            inst = sdl.controller.openDevice(dev);
            device = dev;
            lastKey = '';
            onDevice({ name: dev.name, kind: kindOf(dev.type) });
        } catch (e) {
            inst = null;
            log(`could not open controller "${dev.name}": ${e.message}`);
        }
    };
    const close = () => {
        if (inst) { try { inst.close(); } catch (e) { /* already gone */ } }
        const had = !!inst;
        inst = null; device = null;
        if (had) onDevice(null);
    };

    let timer = null;
    let stopped = false;
    const tick = () => {
        try {
            const devices = sdl.controller.devices; // also pumps SDL's event queue
            if (inst && !devices.some((d) => d.id === device.id)) close(); // unplugged
            if (!inst && devices.length) open(devices[0]);
            if (inst) {
                const pad = mapPad(inst.buttons, inst.axes, buttonNames);
                const key = JSON.stringify([pad.buttons, pad.axes, pad.triggers]);
                if (key !== lastKey) { lastKey = key; onState(pad); }
            }
        } catch (e) { log(`controller read failed: ${e.message}`); close(); }
        if (!stopped) { timer = setTimeout(tick, inst ? pollMs : idleMs); if (timer.unref) timer.unref(); }
    };
    tick();

    return { stop() { stopped = true; clearTimeout(timer); close(); } };
}

module.exports = { mapPad, kindOf, loadSdl, createLocalPad, BUTTONS };
