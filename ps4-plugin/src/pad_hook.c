#include "../include/pad_stream.h"
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <stdatomic.h>

#ifdef __ORBIS__
#include <orbis/libkernel.h>
#include <orbis/Pad.h>
#include <orbis/UserService.h>
#else
typedef struct stick { uint8_t x, y; } stick;
typedef struct analog { uint8_t l2, r2; } analog;
typedef struct OrbisPadTouchData { uint8_t fingers; } OrbisPadTouchData;
typedef struct OrbisPadData {
    uint32_t buttons;
    stick leftStick;
    stick rightStick;
    analog analogButtons;
    OrbisPadTouchData touch;
} OrbisPadData;
#endif

static atomic_bool g_running = false;
static int g_pad_handle = -1;
static uint32_t g_sequence = 0;

int pad_hook_init(void) {
    return 0;
}

// Get the game's existing active pad handle without calling scePadOpen (read-only query)
static int get_active_game_handle(void) {
#ifdef __ORBIS__
    int32_t userId = 0;

    // 1. Try foreground user handle
    if (sceUserServiceGetForegroundUser(&userId) >= 0 && userId > 0) {
        int h = scePadGetHandle(userId, 0, 0);
        if (h >= 0) return h;
    }

    // 2. Try initial user handle
    if (sceUserServiceGetInitialUser(&userId) >= 0 && userId > 0) {
        int h = scePadGetHandle(userId, 0, 0);
        if (h >= 0) return h;
    }

    // 3. Try standard user IDs (0x10000000 - 0x10000004)
    for (int32_t uid = 0x10000000; uid <= 0x10000004; uid++) {
        int h = scePadGetHandle(uid, 0, 0);
        if (h >= 0) return h;
    }

    // 4. Test pre-opened system handles (0, 1, 2)
    for (int h = 0; h <= 2; h++) {
        OrbisPadData test;
        if (scePadReadState(h, &test) >= 0) {
            return h;
        }
    }
#endif
    return -1;
}

void pad_hook_start(const PadStreamConfig *config) {
    if (!config) return;

    atomic_store(&g_running, true);
    g_sequence = 0;
    g_pad_handle = get_active_game_handle();

    uint32_t sleep_us = (config->poll_rate_ms > 0) ? (config->poll_rate_ms * 1000) : 16000;

    while (atomic_load(&g_running)) {
        OrbisPadData data;
        memset(&data, 0, sizeof(data));

        int ret = -1;

#ifdef __ORBIS__
        // If we have a valid game handle, read from it
        if (g_pad_handle >= 0) {
            ret = scePadReadState(g_pad_handle, &data);
        }

        // If current handle is invalid or disconnected, search for active handle
        if (ret < 0) {
            g_pad_handle = get_active_game_handle();
            if (g_pad_handle >= 0) {
                ret = scePadReadState(g_pad_handle, &data);
            }
        }
#endif

        if (ret >= 0) {
            PadPacket packet;
            packet.magic = PAD_STREAM_MAGIC;
            packet.sequence = ++g_sequence;
            packet.buttons = data.buttons;
            packet.lx = data.leftStick.x;
            packet.ly = data.leftStick.y;
            packet.rx = data.rightStick.x;
            packet.ry = data.rightStick.y;
            packet.l2 = data.analogButtons.l2;
            packet.r2 = data.analogButtons.r2;
            packet.touch_active = (data.touch.fingers > 0) ? 1 : 0;
            packet.reserved = 0;

            udp_sender_send(&packet);
        }

        usleep(sleep_us);
    }

    g_pad_handle = -1;
}

void pad_hook_stop(void) {
    atomic_store(&g_running, false);
}
