'use strict';
/**
 * Decides which input the overlay shows: the PS4 plugin (UDP) or a controller plugged into this computer.
 * Pure logic (no sockets, no timers of its own) so it can be unit-tested.
 *
 *   source() = 'auto'  -> the PS4 while it is sending, otherwise the local pad
 *              'ps4'   -> only the PS4
 *              'local' -> only the local pad
 *
 * `send(msg)` broadcasts to every page: pad_state messages and {type:'status', ps4, local, active}.
 */
const LIVE_MS = 2000; // the PS4 counts as live while packets keep arriving

function createSources({ source = () => 'auto', now = Date.now, send }) {
    let lastPs4At = -Infinity; // never seen a PS4 packet yet
    let ps4Pad = null;
    let localPad = null;
    let device = null;      // { name, kind } of the local controller, or null
    let active = null;      // 'ps4' | 'local' | null
    let ps4Live = false;

    const fresh = () => now() - lastPs4At < LIVE_MS;
    const pick = () => {
        const s = source();
        if (s === 'ps4') return fresh() ? 'ps4' : null;
        if (s === 'local') return device ? 'local' : null;
        return fresh() ? 'ps4' : device ? 'local' : null;
    };
    const status = () => ({ type: 'status', ps4: fresh(), local: device, active });
    const current = () => (active === 'local' ? localPad : active === 'ps4' ? ps4Pad : null);

    // Re-evaluate; on a change tell everyone and (replay = true) re-send the newly active source's last state,
    // since its input may be unchanged and no fresh packet would otherwise arrive.
    function refresh(replay = true) {
        const a = pick();
        const live = fresh();
        if (a === active && live === ps4Live) return false;
        active = a;
        ps4Live = live;
        send(status());
        const pad = replay && current();
        if (pad) send(pad);
        return true;
    }

    return {
        status,
        current,
        active: () => active,
        refresh,
        // A PS4 packet arrived. `pad` is the decoded state, or null when it repeats the previous one.
        ps4Packet(pad) {
            lastPs4At = now();
            if (pad) ps4Pad = pad;
            refresh(!pad); // a new state is sent right below, so nothing to replay
            if (pad && active === 'ps4') send(pad);
        },
        // The local controller's state changed.
        localState(pad) {
            localPad = pad;
            refresh(false);
            if (active === 'local') send(pad);
        },
        setDevice(dev) {
            device = dev;
            if (!dev) localPad = null;
            if (!refresh()) send(status()); // always tell pages about the device itself
        }
    };
}

module.exports = { createSources, LIVE_MS };
