#include "../include/pad_stream.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifdef __ORBIS__
#include <orbis/libkernel.h>
#include <orbis/SysUtil.h>

// Sony Module Parameters required by Orbis OS kernel dynamic loader
__asm__(
".intel_syntax noprefix \n"
".align 0x8 \n"
".section \".data.sce_module_param\" \n"
"_sceProcessParam: \n"
"	.quad 	0x18 \n"
"	.quad   0x13C13F4BF \n"
"	.quad 	0x1000051 \n"
".att_syntax prefix \n"
);

__asm__(
".intel_syntax noprefix \n"
".align 0x8 \n"
".data \n"
"__dso_handle: \n"
"	.quad 	0 \n"
"_sceLibc: \n"
"	.quad 	0 \n"
".att_syntax prefix \n"
);

static OrbisPthread g_poll_thread;
#else
static pthread_t g_poll_thread;
#endif

static volatile int g_thread_active = 0;
static PadStreamConfig g_config;

static void notify(const char *msg) {
#ifdef __ORBIS__
    OrbisNotificationRequest req;
    memset(&req, 0, sizeof(req));
    req.type = NotificationRequest;
    req.targetId = -1;
    req.useIconImageUri = 0;
    strncpy(req.message, msg, sizeof(req.message) - 1);
    sceKernelSendNotificationRequest(0, &req, sizeof(req), 0);
    sceSysUtilSendSystemNotificationWithText(222, msg);
#endif
}

static void *stream_worker_thread(void *arg) {
    (void)arg;

    // Immediately send notification that plugin is active
    notify("PawPad: Controller Overlay Active!");

    // Give game process a brief moment to initialize
#ifdef __ORBIS__
    sceKernelUsleep(1000000);
#else
    usleep(1000000);
#endif

    // Load configuration from /data/GoldHEN/pad_stream.ini
    config_load(CONFIG_PATH, &g_config);

    // Initialize UDP socket sender
    if (udp_sender_init(g_config.target_ip, g_config.target_port) != 0) {
        notify("PawPad: set ip in /data/GoldHEN/pad_stream.ini");
        return NULL;
    }

    notify("PawPad: Streaming to OBS!");

    // Initialize Pad API
    pad_hook_init();

    // Start polling and streaming loop (blocks until stopped)
    pad_hook_start(&g_config);

    // Cleanup when stopped
    udp_sender_close();

    return NULL;
}

static int start_worker(void) {
    if (!g_thread_active) {
        g_thread_active = 1;
#ifdef __ORBIS__
        int ret = scePthreadCreate(&g_poll_thread, NULL, stream_worker_thread, NULL, "pad_stream_thread");
        if (ret != 0) {
            g_thread_active = 0;
            return -1;
        }
#else
        if (pthread_create(&g_poll_thread, NULL, stream_worker_thread, NULL) != 0) {
            g_thread_active = 0;
            return -1;
        }
#endif
    }
    return 0;
}

static int stop_worker(void) {
    if (g_thread_active) {
        pad_hook_stop();
#ifdef __ORBIS__
        scePthreadJoin(g_poll_thread, NULL);
#else
        pthread_join(g_poll_thread, NULL);
#endif
        g_thread_active = 0;
    }
    return 0;
}

// -------------------------------------------------------------
// Official GoldHEN Plugin Entry Points (plugin_load / plugin_unload)
// -------------------------------------------------------------
int32_t __attribute__((visibility("default"))) plugin_load(const char *title_id) {
    (void)title_id;
    return start_worker();
}

int32_t __attribute__((visibility("default"))) plugin_unload(void) {
    return stop_worker();
}

// -------------------------------------------------------------
// Standard Orbis OS Module Entry Points (module_start / module_stop)
// -------------------------------------------------------------
int32_t __attribute__((visibility("default"))) module_start(int64_t args, const void *argp) {
    (void)args;
    (void)argp;
    return start_worker();
}

int32_t __attribute__((visibility("default"))) module_stop(int64_t args, const void *argp) {
    (void)args;
    (void)argp;
    return stop_worker();
}

int32_t __attribute__((visibility("default"))) _init(void) {
    return 0;
}

int32_t __attribute__((visibility("default"))) _fini(void) {
    return 0;
}
