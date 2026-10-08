const dgram = require('node:dgram');

const client = dgram.createSocket('udp4');
const PORT = 9999;
const HOST = '127.0.0.1';
const PAD_STREAM_MAGIC = 0x50533450;

let seq = 0;
let angle = 0;

console.log(`Starting PS4 Pad UDP Telemetry Simulator -> ${HOST}:${PORT}...`);

const BUTTONS = {
    cross: 0x00004000,
    circle: 0x00002000,
    triangle: 0x00001000,
    square: 0x00008000,
    dpad_up: 0x00000010,
    dpad_right: 0x00000020,
    dpad_down: 0x00000040,
    dpad_left: 0x00000080,
    l1: 0x00000400,
    r1: 0x00000800,
    l2_btn: 0x00000100,
    r2_btn: 0x00000200,
    l3: 0x00000002,
    r3: 0x00000004,
    options: 0x00000008,
    share: 0x00000001,
    touchpad: 0x00100000
};

const btnList = Object.values(BUTTONS);

setInterval(() => {
    seq++;
    angle += 0.05;

    // Simulate stick circular rotation
    const lx = Math.round(128 + Math.cos(angle) * 110);
    const ly = Math.round(128 + Math.sin(angle) * 110);
    const rx = Math.round(128 + Math.sin(angle * 1.5) * 100);
    const ry = Math.round(128 + Math.cos(angle * 1.5) * 100);

    // Simulate analog triggers oscillating
    const l2 = Math.round(Math.abs(Math.sin(angle * 0.8)) * 255);
    const r2 = Math.round(Math.abs(Math.cos(angle * 0.8)) * 255);

    // Cycle through buttons
    let buttonMask = 0;
    const btnIndex = Math.floor((seq / 30) % (btnList.length + 5));
    if (btnIndex < btnList.length) {
        buttonMask |= btnList[btnIndex];
    }

    const buf = Buffer.alloc(19);
    buf.writeUInt32LE(PAD_STREAM_MAGIC, 0);
    buf.writeUInt32LE(seq, 4);
    buf.writeUInt32LE(buttonMask, 8);
    buf.writeUInt8(Math.max(0, Math.min(255, lx)), 12);
    buf.writeUInt8(Math.max(0, Math.min(255, ly)), 13);
    buf.writeUInt8(Math.max(0, Math.min(255, rx)), 14);
    buf.writeUInt8(Math.max(0, Math.min(255, ry)), 15);
    buf.writeUInt8(l2, 16);
    buf.writeUInt8(r2, 17);
    buf.writeUInt8((seq % 60 < 20) ? 1 : 0, 18); // touch_active

    client.send(buf, PORT, HOST, (err) => {
        if (err) console.error('Send error:', err);
    });
}, 16); // 60Hz
