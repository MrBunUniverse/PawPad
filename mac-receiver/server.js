'use strict';
/**
 * PS4 controller overlay bridge: PS4 (UDP) -> this process -> OBS Browser Source (HTTP + WebSocket).
 * Runs from source (`node server.js`) or as a single executable (see scripts/build-release.sh).
 */
const dgram = require('node:dgram');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { WebSocketServer, WebSocket } = require('ws');
const { createSources } = require('./sources');
const { loadSdl, createLocalPad } = require('./local-pad');

// ---------------------------------------------------------------
// Options: --udp-port=9999 --http-port=8080 --host=127.0.0.1 --ps4-ip=192.168.1.50 --no-local (skip local controllers)
// (env UDP_PORT / HTTP_PORT / HTTP_HOST / PS4_IP work too)
// ---------------------------------------------------------------
const args = Object.fromEntries(
    process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v === undefined ? 'true' : v])
);
const port = (v, fallback) => { const n = parseInt(v, 10); return n > 0 && n < 65536 ? n : fallback; };
const UDP_PORT = port(args['udp-port'] || process.env.UDP_PORT, 9999);
const HTTP_PORT = port(args['http-port'] || process.env.HTTP_PORT, 8080);
// OBS runs on this machine, so the web side listens on localhost only unless you ask otherwise.
const HTTP_HOST = args.host || process.env.HTTP_HOST || '127.0.0.1';
const PS4_IP = args['ps4-ip'] || process.env.PS4_IP || ''; // optional: only accept packets from this address

// ---------------------------------------------------------------
// Overlay files: embedded in the executable (Node SEA) or read from ../obs-overlay when run from source.
// Only these names are ever served.
// ---------------------------------------------------------------
const OVERLAY_FILES = {
    'index.html': 'text/html; charset=utf-8',
    'style.css': 'text/css; charset=utf-8',
    'app.js': 'application/javascript; charset=utf-8',
    'retro.js': 'application/javascript; charset=utf-8'
};
const sea = (() => { try { const s = require('node:sea'); return s.isSea() ? s : null; } catch (e) { return null; } })();
const OVERLAY_DIR = path.resolve(__dirname, '../obs-overlay');
const readOverlayFile = (name) => sea
    ? Buffer.from(sea.getAsset(name))
    : fs.readFileSync(path.join(OVERLAY_DIR, name));

// ---------------------------------------------------------------
// Pad packet (see ps4-plugin/include/pad_stream.h)
// ---------------------------------------------------------------
const PAD_STREAM_MAGIC = 0x50533450; // 'PS4P'
const PACKET_MIN_SIZE = 18;
const BUTTON_MASKS = {
    share: 0x00000001, l3: 0x00000002, r3: 0x00000004, options: 0x00000008,
    dpad_up: 0x00000010, dpad_right: 0x00000020, dpad_down: 0x00000040, dpad_left: 0x00000080,
    l2: 0x00000100, r2: 0x00000200, l1: 0x00000400, r1: 0x00000800,
    triangle: 0x00001000, circle: 0x00002000, cross: 0x00004000, square: 0x00008000,
    touchpad: 0x00100000
};

function localIpAddresses() {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
        for (const i of list) {
            if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) {
                out.push({ interface: name, address: i.address });
            }
        }
    }
    return out;
}

function fatal(message) {
    console.error(`\n[ERROR] ${message}\n`);
    process.exit(1);
}

// ---------------------------------------------------------------
// HTTP: serves the overlay
// ---------------------------------------------------------------
const server = http.createServer((req, res) => {
    let name;
    try { name = decodeURIComponent((req.url || '/').split('?')[0].replace(/^\/+/, '')) || 'index.html'; } catch (e) { name = ''; }
    if (!Object.hasOwn(OVERLAY_FILES, name)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
    }
    try {
        const body = readOverlayFile(name);
        res.writeHead(200, {
            'Content-Type': OVERLAY_FILES[name],
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        res.end(body);
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Overlay file missing');
    }
});

// ---------------------------------------------------------------
// WebSocket: pad state out, test-mode toggle in
// ---------------------------------------------------------------
const wss = new WebSocketServer({
    server,
    maxPayload: 256,
    // Only pages served by this bridge may connect (blocks other websites from reading your input).
    verifyClient: ({ origin, req }) => {
        if (!origin) return true; // non-browser clients
        try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
    }
});

let simOwner = null;
let simTimer = null;
let look = null; // last style chosen on the settings page; replayed to every OBS/browser client

function send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(obj) {
    if (wss.clients.size === 0) return;
    const msg = JSON.stringify(obj);
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
}

// PS4 plugin vs a controller on this computer: PS4 first in 'auto' (the PS4 is the main use).
const sources = createSources({ source: () => (look && look.source) || 'auto', send: broadcast });

wss.on('connection', (ws) => {
    send(ws, { type: 'welcome', ips: localIpAddresses(), udpPort: UDP_PORT });
    send(ws, sources.status());
    if (look) send(ws, look);
    const pad = sources.current(); // a freshly opened page starts with the current state
    if (pad) send(ws, pad);

    ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw); } catch (e) { return; }
        if (m && m.type === 'look') {
            if (!['classic', 'fine', 'bun', 'cat'].includes(m.style) || !/^[a-z]{2,12}$/.test(m.coat)) return;
            look = {
                type: 'look', style: m.style, coat: m.coat, tone: m.tone === 'midnight' ? 'midnight' : 'default',
                layout: m.layout === 'wide' ? 'wide' : 'normal', pad: m.pad !== false,
                controller: ['ps', 'xbox'].includes(m.controller) ? m.controller : 'auto', // look of the pad: PlayStation / Xbox / follow the connected pad
                source: ['ps4', 'local'].includes(m.source) ? m.source : 'auto',           // which input to show
                shadow: Math.min(100, Math.max(0, Math.round(Number(m.shadow) || 0))),     // drop shadow strength, 0 = off
                fps: Math.min(60, Math.max(5, Math.round(Number(m.fps) || 60))),           // overlay frame-rate cap, 5-60
                opacity: m.opacity == null ? 100 : Math.min(100, Math.max(10, Math.round(Number(m.opacity) || 100))), // controller opacity, 10-100%
                trigger: m.trigger === 'squeeze' ? 'squeeze' : 'level',                    // L2/R2 look: level meter or squeeze
                bulge: m.bulge !== false,                                                  // Bun / Cat: squeezed triggers bulge (on by default)
                squish: m.squish === true,                                                 // Bun / Cat: pressed buttons squish and bulge (off by default)
                names: m.names !== false                                                   // button names on the controller (on by default)
            };
            broadcast(look);
            sources.refresh();
            return;
        }
        if (!m || m.type !== 'sim') return;
        if (m.on) { simOwner = ws; startSim(); } else if (simOwner === ws) stopSim();
    });
    ws.on('close', () => { if (simOwner === ws) stopSim(); }); // test mode ends with the page that enabled it
    ws.on('error', () => {});
});

// Test mode: a fake controller broadcast to every client (settings page and OBS alike).
function simPayload(a) {
    const buttons = {};
    for (const name of Object.keys(BUTTON_MASKS)) buttons[name] = false;
    Object.assign(buttons, {
        cross: Math.sin(a * 2) > 0.6, circle: Math.cos(a * 2) > 0.6,
        triangle: Math.sin(a * 1.5) < -0.7, square: Math.cos(a * 1.5) < -0.7,
        l1: Math.sin(a) > 0.8, r1: Math.cos(a) > 0.8,
        l3: Math.sin(a * 3) > 0.85, r3: Math.cos(a * 3) > 0.85,
        dpad_up: Math.sin(a * 0.7) > 0.8, dpad_down: Math.sin(a * 0.7) < -0.8,
        share: Math.sin(a * 0.4) > 0.9, options: Math.cos(a * 0.4) > 0.9
    });
    return {
        type: 'pad_state',
        buttons,
        axes: {
            lx_norm: Math.cos(a) * 0.9, ly_norm: Math.sin(a) * 0.9,
            rx_norm: Math.sin(a * 1.3) * 0.85, ry_norm: Math.cos(a * 1.3) * 0.85
        },
        triggers: { l2_norm: Math.max(0, Math.sin(a * 1.2)), r2_norm: Math.max(0, Math.cos(a * 1.2)) },
        touch: { active: Math.sin(a * 0.5) > 0 }
    };
}
function startSim() {
    if (simTimer) return;
    let angle = 0;
    simTimer = setInterval(() => broadcast(simPayload(angle += 0.04)), 16);
}
function stopSim() {
    clearInterval(simTimer);
    simTimer = simOwner = null;
}

// ---------------------------------------------------------------
// UDP: PS4 telemetry
// ---------------------------------------------------------------
const udp = dgram.createSocket({ type: 'udp4' }); // no reuseAddr: a second bridge must fail loudly, not steal packets

const SOURCE_TIMEOUT_MS = 5000;
let lockedSource = PS4_IP; // first valid sender wins until it goes quiet, so other LAN hosts can't inject input
let lastPacketTime = 0;
let packetCount = 0;
let lastState = null; // previous packet minus the sequence number, to drop repeats

udp.on('message', (msg, rinfo) => {
    if (msg.length < PACKET_MIN_SIZE || msg.readUInt32LE(0) !== PAD_STREAM_MAGIC) return;

    const now = Date.now();
    if (PS4_IP) {
        if (rinfo.address !== PS4_IP) return;
    } else {
        if (lockedSource && rinfo.address !== lockedSource && now - lastPacketTime < SOURCE_TIMEOUT_MS) return;
        lockedSource = rinfo.address;
    }
    lastPacketTime = now;
    packetCount++;

    // The PS4 streams at a fixed rate even when nothing moves: forward changes only (still counts as "live").
    const state = msg.subarray(8);
    if (lastState && state.equals(lastState)) { sources.ps4Packet(null); return; }
    lastState = Buffer.from(state);

    const mask = msg.readUInt32LE(8);
    const buttons = {};
    for (const [name, bit] of Object.entries(BUTTON_MASKS)) buttons[name] = (mask & bit) !== 0;
    const axis = (i) => (msg[i] - 128) / 128;

    sources.ps4Packet({
        type: 'pad_state',
        seq: msg.readUInt32LE(4),
        buttons,
        axes: { lx_norm: axis(12), ly_norm: axis(13), rx_norm: axis(14), ry_norm: axis(15) },
        triggers: { l2_norm: msg[16] / 255, r2_norm: msg[17] / 255 },
        touch: { active: msg.length > 18 && msg[18] === 1 }
    });
});

udp.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        fatal(`UDP port ${UDP_PORT} is already in use. Is another bridge running? Close it, or use --udp-port=<other>.`);
    }
    fatal(`UDP error: ${err.message}`);
});

// Report whether the PS4 is actually sending, so "connected but nothing happens" is diagnosable.
let rate = 0;
setInterval(() => {
    rate = packetCount;
    packetCount = 0;
    sources.refresh(); // re-check which input is live (also notices the PS4 going quiet)
    const live = sources.status().ps4;
    const local = sources.status().local;
    process.stdout.write(`\r[PS4] ${live ? `receiving ${rate} packets/s` : 'waiting for packets...'} | OBS/browser clients: ${wss.clients.size}${local ? ` | controller: ${local.name}` : ''}      `);
}, 1000);

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        fatal(`HTTP port ${HTTP_PORT} is already in use. Is another bridge running? Close it, or use --http-port=<other>.`);
    }
    fatal(`HTTP error: ${err.message}`);
});

// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------
udp.bind(UDP_PORT, '0.0.0.0', () => {
    server.listen(HTTP_PORT, HTTP_HOST, () => {
        const ips = localIpAddresses();
        console.log('PawPad bridge');
        console.log('-----------------------------');
        console.log(`Put this in /data/GoldHEN/pad_stream.ini on the PS4 (ip = ..., port = ${UDP_PORT}):`);
        console.log(ips.length ? ips.map(i => `   ip = ${i.address}   (${i.interface})`).join('\n') : '   (no network address found, check your connection)');
        if (PS4_IP) console.log(`Only accepting packets from ${PS4_IP}`);
        console.log('');
        console.log('OBS Browser Source URL (488 x 280):');
        console.log(`   http://localhost:${HTTP_PORT}/?hideUI=1`);
        console.log('Settings / test page:');
        console.log(`   http://localhost:${HTTP_PORT}/`);
        if (HTTP_HOST !== '127.0.0.1' && HTTP_HOST !== 'localhost') {
            console.log(`\nWARNING: the overlay is reachable from the network (--host=${HTTP_HOST}).`);
        }
        console.log('');
        startLocalControllers();
    });
});

// Controllers plugged into this computer (optional: needs the SDL files next to the bridge or installed from npm).
let localPad = null;
function startLocalControllers() {
    if (args['no-local']) { console.log('Local controllers: off (--no-local)\n'); return; }
    const sdl = loadSdl([sea ? path.dirname(process.execPath) : __dirname]);
    if (!sdl) { console.log('Local controllers: not available (PS4 only)\n'); return; }
    try {
        localPad = createLocalPad({
            sdl,
            buttonNames: Object.keys(BUTTON_MASKS),
            onState: (pad) => sources.localState(pad),
            onDevice: (dev) => { console.log(dev ? `\nController connected: ${dev.name}` : '\nController disconnected'); sources.setDevice(dev); },
            log: (msg) => console.log(`\n[controller] ${msg}`)
        });
        console.log('Local controllers: ready\n');
    } catch (e) {
        console.log(`Local controllers: not available (${e.message})\n`);
    }
}

process.on('SIGINT', () => { console.log('\nBye.'); process.exit(0); });
process.on('SIGTERM', () => process.exit(0));
