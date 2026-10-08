'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mapPad, kindOf, createLocalPad } = require('../local-pad');

const NAMES = ['share', 'l3', 'r3', 'options', 'dpad_up', 'dpad_right', 'dpad_down', 'dpad_left', 'l2', 'r2', 'l1', 'r1', 'triangle', 'circle', 'cross', 'square', 'touchpad'];

test('device types map to a controller kind', () => {
    assert.equal(kindOf('ps4'), 'playstation');
    assert.equal(kindOf('ps5'), 'playstation');
    assert.equal(kindOf('ps3'), 'playstation');
    assert.equal(kindOf('xboxOne'), 'xbox');
    assert.equal(kindOf('xbox360'), 'xbox');
    assert.equal(kindOf('nintendoSwitchPro'), 'switch');
    assert.equal(kindOf('googleStadia'), 'other');
    assert.equal(kindOf(null), 'other');
});

test('face buttons use the PlayStation slots (A = cross, B = circle, X = square, Y = triangle)', () => {
    const p = mapPad({ a: true, y: true }, {}, NAMES);
    assert.equal(p.buttons.cross, true);
    assert.equal(p.buttons.triangle, true);
    assert.equal(p.buttons.circle, false);
    assert.equal(p.buttons.square, false);
});

test('every button the overlay knows is present, and only pressed ones are true', () => {
    const p = mapPad({ leftShoulder: true, rightStick: true, back: true, start: true, guide: true, dpadLeft: true }, {}, NAMES);
    assert.deepEqual(Object.keys(p.buttons).sort(), [...NAMES].sort());
    const pressed = Object.entries(p.buttons).filter(([, v]) => v).map(([k]) => k).sort();
    assert.deepEqual(pressed, ['dpad_left', 'l1', 'options', 'r3', 'share', 'touchpad'].sort());
});

test('sticks are clamped, triggers 0..1 and the digital L2/R2 follow them', () => {
    const p = mapPad({}, { leftStickX: 2, leftStickY: -0.5, rightStickX: 0.25, rightStickY: NaN, leftTrigger: 0.7, rightTrigger: 0.2 }, NAMES);
    assert.deepEqual(p.axes, { lx_norm: 1, ly_norm: -0.5, rx_norm: 0.25, ry_norm: 0 });
    assert.deepEqual(p.triggers, { l2_norm: 0.7, r2_norm: 0.2 });
    assert.equal(p.buttons.l2, true);
    assert.equal(p.buttons.r2, false);
    assert.equal(p.type, 'pad_state');
    assert.deepEqual(p.touch, { active: false });
});

test('same message shape as the PS4 path (so the overlay needs no changes)', () => {
    const p = mapPad({}, {}, NAMES);
    assert.deepEqual(Object.keys(p).sort(), ['axes', 'buttons', 'touch', 'triggers', 'type']);
    assert.deepEqual(Object.keys(p.axes).sort(), ['lx_norm', 'ly_norm', 'rx_norm', 'ry_norm']);
    assert.deepEqual(Object.keys(p.triggers).sort(), ['l2_norm', 'r2_norm']);
});

// A fake SDL: a device list and one controller whose state the test edits. No events, like the real poller.
function fakeSdl(devices = []) {
    const state = { buttons: {}, axes: {}, closed: false };
    return {
        state,
        controller: {
            get devices() { return devices; },
            openDevice: (d) => ({ device: d, get buttons() { return state.buttons; }, get axes() { return state.axes; }, close: () => { state.closed = true; } })
        },
        plug: (d) => devices.push(d),
        unplug: (d) => devices.splice(devices.indexOf(d), 1)
    };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('reports a pad that is already connected, then only changes', async () => {
    const d = { id: 1, name: 'DualShock 4 Wireless Controller', type: 'ps4' };
    const sdl = fakeSdl([d]);
    const devs = [], pads = [];
    const lp = createLocalPad({ sdl, buttonNames: NAMES, onState: (p) => pads.push(p), onDevice: (x) => devs.push(x), pollMs: 2, idleMs: 2 });
    await wait(20);
    assert.deepEqual(devs, [{ name: 'DualShock 4 Wireless Controller', kind: 'playstation' }]);
    assert.equal(pads.length, 1, 'one initial state, no repeats while nothing changes');
    sdl.state.buttons = { a: true };
    await wait(20);
    assert.equal(pads.length, 2);
    assert.equal(pads[1].buttons.cross, true);
    lp.stop();
});

test('hot-plug: a pad added later is picked up and removal clears it', async () => {
    const sdl = fakeSdl([]);
    const devs = [], pads = [];
    const lp = createLocalPad({ sdl, buttonNames: NAMES, onState: (p) => pads.push(p), onDevice: (x) => devs.push(x), pollMs: 2, idleMs: 2 });
    await wait(10);
    assert.deepEqual(devs, []);
    const d = { id: 7, name: 'Xbox Wireless Controller', type: 'xboxOne' };
    sdl.plug(d);
    await wait(20);
    assert.deepEqual(devs, [{ name: 'Xbox Wireless Controller', kind: 'xbox' }]);
    sdl.unplug(d);
    await wait(20);
    assert.equal(devs.at(-1), null);
    assert.equal(sdl.state.closed, true);
    lp.stop();
});

test('a read error disconnects the pad instead of crashing the bridge', async () => {
    const d = { id: 1, name: 'Flaky pad', type: 'ps4' };
    const sdl = fakeSdl([d]);
    const devs = [], logs = [];
    Object.defineProperty(sdl.state, 'buttons', { get() { throw new Error('device lost'); } });
    const lp = createLocalPad({ sdl, buttonNames: NAMES, onState: () => {}, onDevice: (x) => devs.push(x), log: (m) => logs.push(m), pollMs: 2, idleMs: 1000 });
    await wait(20);
    assert.equal(devs.at(-1), null);
    assert.ok(logs.some((m) => /device lost/.test(m)));
    lp.stop();
});

test('idle polling is slow, active polling is fast', async () => {
    const sdl = fakeSdl([]);
    let reads = 0;
    const orig = Object.getOwnPropertyDescriptor(sdl.controller, 'devices').get;
    Object.defineProperty(sdl.controller, 'devices', { get() { reads++; return orig(); } });
    const lp = createLocalPad({ sdl, buttonNames: NAMES, onState: () => {}, onDevice: () => {}, pollMs: 2, idleMs: 100 });
    await wait(250);
    assert.ok(reads <= 4, `expected a slow poll while no pad is connected, got ${reads} reads in 250 ms`);
    lp.stop();
});
