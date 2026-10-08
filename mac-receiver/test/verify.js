const { spawn } = require('node:child_process');
const http = require('node:http');
const dgram = require('node:dgram');
const { WebSocket } = require('ws');

async function runTest() {
    console.log('--- Starting Integration Test ---');
    
    // 1. Launch server
    const serverProcess = spawn('node', ['server.js'], {
        cwd: require('node:path').join(__dirname, '..'),
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let serverOutput = '';
    serverProcess.stdout.on('data', (d) => { serverOutput += d.toString(); });
    serverProcess.stderr.on('data', (d) => { console.error('Server STDERR:', d.toString()); });

    // Wait for server to bind
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
        // 2. Test HTTP GET /index.html
        console.log('[Test 1] Testing HTTP Static file server on :8080...');
        const httpRes = await new Promise((resolve, reject) => {
            http.get('http://127.0.0.1:8080/index.html', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
            }).on('error', reject);
        });

        if (httpRes.statusCode === 200 && httpRes.body.includes('retroCanvas')) {
            console.log('✓ HTTP static overlay served correctly (Status 200, contains retro canvas)');
        } else {
            throw new Error(`HTTP test failed. Status: ${httpRes.statusCode}`);
        }

        // 3. Test WebSocket connection
        console.log('[Test 2] Connecting WebSocket client to ws://127.0.0.1:8080...');
        const wsClient = new WebSocket('ws://127.0.0.1:8080');

        await new Promise((resolve, reject) => {
            wsClient.on('open', resolve);
            wsClient.on('error', reject);
        });
        console.log('✓ WebSocket client connected successfully');

        // 4. Send UDP Binary packet and listen on WS
        console.log('[Test 3] Sending UDP binary telemetry packet to port 9999...');
        const packetPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout waiting for WS packet')), 3000);
            wsClient.on('message', (raw) => {
                const msg = JSON.parse(raw);
                if (msg.type === 'pad_state') {
                    clearTimeout(timeout);
                    resolve(msg);
                }
            });
        });

        const udpClient = dgram.createSocket('udp4');
        const buf = Buffer.alloc(19);
        const PAD_STREAM_MAGIC = 0x50533450;
        buf.writeUInt32LE(PAD_STREAM_MAGIC, 0);
        buf.writeUInt32LE(42, 4); // seq
        buf.writeUInt32LE(0x00004000 | 0x00000400, 8); // Cross + L1
        buf.writeUInt8(200, 12); // lx
        buf.writeUInt8(50, 13);  // ly
        buf.writeUInt8(128, 14); // rx
        buf.writeUInt8(128, 15); // ry
        buf.writeUInt8(180, 16); // l2
        buf.writeUInt8(250, 17); // r2
        buf.writeUInt8(1, 18);   // touch_active

        udpClient.send(buf, 9999, '127.0.0.1', (err) => {
            if (err) console.error('UDP send error:', err);
            udpClient.close();
        });

        const receivedState = await packetPromise;
        console.log('✓ Received parsed telemetry via WebSocket:');
        console.log('  - Sequence:', receivedState.seq);
        console.log('  - Cross button:', receivedState.buttons.cross);
        console.log('  - L1 button:', receivedState.buttons.l1);
        console.log('  - Left Stick X/Y:', receivedState.axes.lx_norm, receivedState.axes.ly_norm);
        console.log('  - L2/R2 triggers:', receivedState.triggers.l2_norm, receivedState.triggers.r2_norm);
        console.log('  - Touch active:', receivedState.touch.active);

        if (
            receivedState.seq === 42 &&
            receivedState.buttons.cross === true &&
            receivedState.buttons.l1 === true &&
            Math.abs(receivedState.axes.lx_norm - 72 / 128) < 1e-6 &&
            Math.abs(receivedState.triggers.l2_norm - 180 / 255) < 1e-6 &&
            receivedState.touch.active === true
        ) {
            console.log('✓ ALL VALIDATION CHECKS PASSED!');
        } else {
            throw new Error('Received telemetry data did not match expected values.');
        }

        wsClient.close();
    } finally {
        serverProcess.kill('SIGINT');
        console.log('--- Test Completed Cleanly ---');
    }
}

runTest().catch((err) => {
    console.error('Test FAILED:', err);
    process.exit(1);
});
