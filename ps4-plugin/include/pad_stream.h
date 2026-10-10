#ifndef PAD_STREAM_H
#define PAD_STREAM_H

#include <stdint.h>
#include <stdbool.h>

#define PAD_STREAM_MAGIC 0x50533450 // 'PS4P' in ASCII (Little Endian)
#define DEFAULT_TARGET_IP "" // no default: set `ip` in pad_stream.ini
#define DEFAULT_TARGET_PORT 9999
#define DEFAULT_POLL_RATE_MS 16
#define CONFIG_PATH "/data/GoldHEN/pad_stream.ini"
#define CONFIG_PATH_ALT "/data/GoldHEN/plugins/pad_stream.ini"

// Standard PS4 Digital Button Bitmasks (ScePadButtonDataOffset)
#define ORBIS_PAD_L3        0x00000002
#define ORBIS_PAD_R3        0x00000004
#define ORBIS_PAD_OPTIONS   0x00000008
#define ORBIS_PAD_UP        0x00000010
#define ORBIS_PAD_RIGHT     0x00000020
#define ORBIS_PAD_DOWN      0x00000040
#define ORBIS_PAD_LEFT      0x00000080
#define ORBIS_PAD_L2        0x00000100
#define ORBIS_PAD_R2        0x00000200
#define ORBIS_PAD_L1        0x00000400
#define ORBIS_PAD_R1        0x00000800
#define ORBIS_PAD_TRIANGLE  0x00001000
#define ORBIS_PAD_CIRCLE    0x00002000
#define ORBIS_PAD_CROSS     0x00004000
#define ORBIS_PAD_SQUARE    0x00008000
#define ORBIS_PAD_TOUCHPAD  0x00100000
#define ORBIS_PAD_SHARE     0x00000001 // Intercepted or mapped where available

#pragma pack(push, 1)
typedef struct {
    uint32_t magic;         // 0x50533450 ('PS4P')
    uint32_t sequence;      // Monotonic sequence ID
    uint32_t buttons;       // Digital button bitmask
    uint8_t  lx;            // Left Stick X (0 - 255, center ~128)
    uint8_t  ly;            // Left Stick Y (0 - 255, center ~128)
    uint8_t  rx;            // Right Stick X (0 - 255, center ~128)
    uint8_t  ry;            // Right Stick Y (0 - 255, center ~128)
    uint8_t  l2;            // Left Trigger Analog Pressure (0 - 255)
    uint8_t  r2;            // Right Trigger Analog Pressure (0 - 255)
    uint8_t  touch_active;  // 1 if touchpad finger is active, 0 otherwise
    uint8_t  reserved;      // Reserved for alignment / future expansion
    float    accel[3];      // Accelerometer x, y, z, as the PS4 SDK reports it (1.0 = 1 g is assumed; check on a real pad)
    float    gyro[3];       // Gyro x, y, z: angular velocity, as the PS4 SDK reports it. Zero when the pad sends no motion
} PadPacket;
// Packets from plugins older than the motion fields are 20 bytes; the bridge reads motion only when the packet is long enough.
#pragma pack(pop)

typedef struct {
    char target_ip[64];
    uint16_t target_port;
    uint32_t poll_rate_ms;
} PadStreamConfig;

// Configuration functions
void config_load(const char *path, PadStreamConfig *config);

// UDP sender functions
int udp_sender_init(const char *ip, uint16_t port);
int udp_sender_send(const PadPacket *packet);
void udp_sender_close(void);

// Pad polling functions
int pad_hook_init(void);
void pad_hook_start(const PadStreamConfig *config);
void pad_hook_stop(void);

#endif // PAD_STREAM_H
