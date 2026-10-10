'use strict';
// Draws every look of the overlay (retro.js) onto a fake canvas, with a fake clock, and checks nothing throws or draws
// nonsense. The drawing code is a browser script, so it is loaded with stand-ins for window, document and performance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let now = 0;
let rects = 0, bad = [];
const ctx = new Proxy({}, {
    get: (t, k) => {
        if (k === 'fillRect') return (x, y, w, h) => { rects++; if (![x, y, w, h].every(Number.isFinite) || w < 0 || h < 0) bad.push([x, y, w, h]); };
        return k in t ? t[k] : () => {};
    },
    set: (t, k, v) => { t[k] = v; return true; }
});
const canvas = { width: 0, height: 0, getContext: () => ctx };
globalThis.window = {};
globalThis.document = { getElementById: () => canvas };
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
const src = path.join(__dirname, '..', '..', 'obs-overlay');
eval(fs.readFileSync(path.join(src, 'retro.js'), 'utf8')); // sets window.RetroPad
const R = window.RetroPad;

const BUTTONS = ['cross', 'circle', 'triangle', 'square', 'l1', 'r1', 'l3', 'r3', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'share', 'options', 'touchpad'];
const state = (down = [], extra = {}) => ({
    type: 'pad_state', buttons: Object.fromEntries(BUTTONS.map((n) => [n, down.includes(n)])),
    axes: { lx_norm: 0.6, ly_norm: -0.4, rx_norm: -0.3, ry_norm: 0.8 }, triggers: { l2_norm: 0.7, r2_norm: 0.1 }, touch: { active: false }, ...extra
});
const frame = (st) => { now += 16; R.draw(st, { x: 0.6, y: -0.4 }, { x: -0.3, y: 0.8 }); };

// Every style with each of its coats (plain styles have none).
const looks = [['classic'], ['fine'], ['fine', null, 'midnight'], ['bun']];
for (const [style, coats] of Object.entries(R.coats)) for (const coat of coats) looks.push([style, coat]);

test('every furry style has coats and every coat name fits the bridge', () => {
    assert.deepEqual(Object.keys(R.coats).sort(), ['cat', 'dog', 'fox', 'wolf']);
    for (const coats of Object.values(R.coats)) {
        assert.ok(coats.length >= 4);
        coats.forEach((c) => assert.match(c, /^[a-z]{2,12}$/)); // server.js rejects other coat names
    }
    const all = Object.values(R.coats).flat();
    assert.equal(new Set(all).size, all.length, 'a coat name belongs to one style only');
});

test('app.js knows a swatch and a name for every coat', () => {
    const app = fs.readFileSync(path.join(src, 'app.js'), 'utf8');
    for (const c of Object.values(R.coats).flat()) assert.match(app, new RegExp(`\\b${c}: '`), `${c} missing in app.js`);
});

test('every look draws, in every layout and controller, idle and fully pressed', () => {
    let count = 0;
    for (const [style, coat, tone] of looks) for (const layout of ['normal', 'wide']) for (const ctrl of ['ps', 'xbox']) for (const pad of [true, false]) {
        R.setStyle(style, coat, tone || 'default', layout, pad, ctrl, 'level', true, true, true, {});
        for (const st of [state(), state(BUTTONS), state(['touchpad'], { touch: { active: true } })]) {
            rects = 0; bad = [];
            frame(st);
            assert.ok(rects > 50, `${style}/${coat}/${layout}/${ctrl} drew almost nothing`);
            assert.deepEqual(bad, [], `${style}/${coat}/${layout}/${ctrl} drew a bad rect`);
            count++;
        }
    }
    assert.ok(count > 300);
});

test('themes, squeeze triggers, calm, trail and shake do not break any style', () => {
    for (const [style, coat] of looks) for (const theme of ['default', 'contrast', 'night', 'pastel']) {
        rects = 0; bad = [];
        R.setStyle(style, coat, 'default', 'normal', true, 'ps', 'squeeze', false, false, false, { theme, trail: true });
        frame(state(['l1', 'r1']));
        assert.ok(rects > 50 && !bad.length, `${style}/${coat}/${theme} rects=${rects} bad=${JSON.stringify(bad.slice(0,3))}`);
    }
    R.setStyle('fox', 'redfox', 'default', 'normal', true, 'ps', 'level', true, true, true, {});
    R.shake(); for (let i = 0; i < 30; i++) frame(state());
    R.setStyle('wolf', 'greywolf', 'default', 'normal', true, 'ps', 'level', true, true, true, { calm: true });
    R.shake(); frame(state());
    assert.ok(!bad.length);
});

test('an unknown coat falls back to the style\'s first coat', () => {
    rects = 0;
    R.setStyle('dog', 'redfox', 'default', 'normal', true, 'ps', 'level', true, false, true, {});
    frame(state());
    assert.ok(rects > 0);
});

test('a held button squishes first, then returns to full size', () => {
    R.setStyle('bun', 'x', 'default', 'normal', true, 'ps', 'level', true, true, true, {});
    const held = state(['circle']);
    let peak = 0;
    for (let t = 0; t < 300; t += 16) { frame(held); peak = Math.max(peak, R.squish('circle')); }
    assert.ok(peak > 0.8, `circle squished (${peak})`);
    for (let t = 0; t < 1500; t += 16) frame(held);
    assert.ok(Math.abs(R.squish('circle')) < 0.05, `circle back to full size (${R.squish('circle')})`);
    for (let t = 0; t < 600; t += 16) frame(state());
    assert.ok(Math.abs(R.squish('circle')) < 0.05, 'and stays at rest after release');
});

test('frame cost: a settled held button asks for no more redraws', () => {
    R.setStyle('cat', 'pumpkin', 'default', 'normal', true, 'ps', 'level', true, true, true, {});
    const held = state(['cross']);
    for (let t = 0; t < 2000; t += 16) frame(held);
    rects = 0;
    for (let i = 0; i < 20; i++) { now += 16; R.tick(); }
    assert.equal(rects, 0, 'tick redrew a pad that is sitting still');
});
