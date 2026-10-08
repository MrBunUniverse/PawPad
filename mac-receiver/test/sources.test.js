'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSources, LIVE_MS } = require('../sources');

function setup(source = 'auto') {
    const sent = [];
    let t = 1000;
    let mode = source;
    const s = createSources({ source: () => mode, now: () => t, send: (m) => sent.push(m) });
    return {
        s, sent,
        tick: (ms) => { t += ms; s.refresh(); },
        setMode: (m) => { mode = m; s.refresh(); },
        pads: () => sent.filter((m) => m.type === 'pad_state'),
        statuses: () => sent.filter((m) => m.type === 'status')
    };
}
const pad = (n) => ({ type: 'pad_state', n });
const dev = { name: 'DualShock 4', kind: 'playstation' };

test('PS4 only: packets are forwarded and the PS4 is live', () => {
    const { s, pads } = setup();
    s.ps4Packet(pad(1));
    assert.equal(s.active(), 'ps4');
    assert.deepEqual(pads().map((m) => m.n), [1]);
    assert.equal(s.status().ps4, true);
});

test('repeated PS4 packets keep it live without re-sending the state', () => {
    const { s, pads, tick } = setup();
    s.ps4Packet(pad(1));
    tick(1500); s.ps4Packet(null);
    tick(1500); s.ps4Packet(null);
    assert.equal(s.active(), 'ps4');
    assert.equal(pads().length, 1);
});

test('auto: the PS4 wins while it is sending, even with a local pad connected', () => {
    const { s, pads } = setup();
    s.setDevice(dev);
    s.ps4Packet(pad(1));
    s.localState(pad(2));
    assert.equal(s.active(), 'ps4');
    assert.ok(!pads().some((m) => m.n === 2), 'local state must not reach the overlay while the PS4 is live');
});

test('auto: the local pad takes over when the PS4 goes quiet, and the PS4 takes back when it returns', () => {
    const { s, pads, tick } = setup();
    s.setDevice(dev);
    s.localState(pad(2));            // nothing from the PS4 yet: local is shown
    assert.equal(s.active(), 'local');
    s.ps4Packet(pad(1));
    assert.equal(s.active(), 'ps4');
    tick(LIVE_MS + 100);             // PS4 stops
    assert.equal(s.active(), 'local');
    assert.equal(pads().at(-1).n, 2, 'the local pad state is replayed on switching');
    s.ps4Packet(pad(3));
    assert.equal(s.active(), 'ps4');
    assert.equal(pads().at(-1).n, 3);
});

test("source 'ps4' ignores a local pad; source 'local' ignores the PS4", () => {
    const a = setup('ps4');
    a.s.setDevice(dev); a.s.localState(pad(2));
    assert.equal(a.s.active(), null);
    a.s.ps4Packet(pad(1));
    assert.equal(a.s.active(), 'ps4');

    const b = setup('local');
    b.s.ps4Packet(pad(1));
    assert.equal(b.s.active(), null);
    b.s.setDevice(dev); b.s.localState(pad(2));
    assert.equal(b.s.active(), 'local');
    assert.deepEqual(b.pads().map((m) => m.n), [2]);
});

test('changing the source setting switches immediately', () => {
    const { s, pads, setMode } = setup('auto');
    s.setDevice(dev); s.localState(pad(2)); s.ps4Packet(pad(1));
    assert.equal(s.active(), 'ps4');
    setMode('local');
    assert.equal(s.active(), 'local');
    assert.equal(pads().at(-1).n, 2);
});

test('unplugging the pad clears it and falls back', () => {
    const { s, statuses } = setup();
    s.setDevice(dev); s.localState(pad(2));
    assert.equal(s.active(), 'local');
    s.setDevice(null);
    assert.equal(s.active(), null);
    assert.equal(s.current(), null);
    assert.equal(statuses().at(-1).local, null);
});

test('status reports the device so the overlay can pick the controller look', () => {
    const { s } = setup();
    s.setDevice({ name: 'Xbox Wireless Controller', kind: 'xbox' });
    assert.deepEqual(s.status().local, { name: 'Xbox Wireless Controller', kind: 'xbox' });
});
