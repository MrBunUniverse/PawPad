#include "../include/pad_stream.h"
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#ifdef __ORBIS__
#include <orbis/libkernel.h>
#include <orbis/Net.h>

typedef struct OrbisNetSockaddrIn {
    uint8_t sin_len;
    uint8_t sin_family;
    uint16_t sin_port;
    struct {
        uint32_t s_addr;
    } sin_addr;
    char sin_zero[8];
} OrbisNetSockaddrIn;

static int g_sock = -1;
static OrbisNetSockaddrIn g_dests[4];
static int g_num_dests = 0;

static void add_dest(const char *ip, uint16_t port) {
    if (g_num_dests >= 4 || !ip || ip[0] == '\0') return;

    OrbisNetSockaddrIn *d = &g_dests[g_num_dests];
    memset(d, 0, sizeof(*d));
    d->sin_len = sizeof(*d);
    d->sin_family = ORBIS_NET_AF_INET;
    d->sin_port = sceNetHtons(port);
    
    if (sceNetInetPton(ORBIS_NET_AF_INET, ip, &d->sin_addr) > 0) {
        g_num_dests++;
    }
}

int udp_sender_init(const char *ip, uint16_t port) {
    if (g_sock >= 0) {
        sceNetSocketClose(g_sock);
        g_sock = -1;
    }

    g_num_dests = 0;

    // Initialize network stack and memory pool
    sceNetInit();
    sceNetPoolCreate("pad_stream_pool", 128 * 1024, 0);

    g_sock = sceNetSocket("pad_sock", ORBIS_NET_AF_INET, ORBIS_NET_SOCK_DGRAM, 0);
    if (g_sock < 0) {
        return -1;
    }

    // Send only to the address configured in pad_stream.ini (no built-in or broadcast targets)
    add_dest(ip, port);

    return (g_num_dests > 0) ? 0 : -2;
}

int udp_sender_send(const PadPacket *packet) {
    if (g_sock < 0 || !packet || g_num_dests <= 0) {
        return -1;
    }

    for (int i = 0; i < g_num_dests; i++) {
        sceNetSendto(
            g_sock,
            (const void *)packet,
            sizeof(PadPacket),
            0,
            (const OrbisNetSockaddr *)&g_dests[i],
            sizeof(g_dests[i])
        );
    }

    return 0;
}

void udp_sender_close(void) {
    if (g_sock >= 0) {
        sceNetSocketClose(g_sock);
        g_sock = -1;
    }
    g_num_dests = 0;
}

#else
// POSIX fallback
#include <fcntl.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

static int g_socket_fd = -1;
static struct sockaddr_in g_dest_addr;

int udp_sender_init(const char *ip, uint16_t port) {
    if (g_socket_fd >= 0) {
        close(g_socket_fd);
        g_socket_fd = -1;
    }

    g_socket_fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (g_socket_fd < 0) return -1;

    memset(&g_dest_addr, 0, sizeof(g_dest_addr));
    g_dest_addr.sin_family = AF_INET;
    g_dest_addr.sin_port = htons(port);
    if (inet_pton(AF_INET, ip, &g_dest_addr.sin_addr) <= 0) {
        close(g_socket_fd);
        g_socket_fd = -1;
        return -2;
    }

    return 0;
}

int udp_sender_send(const PadPacket *packet) {
    if (g_socket_fd < 0 || !packet) return -1;
    ssize_t sent = sendto(g_socket_fd, (const void *)packet, sizeof(PadPacket), 0, (struct sockaddr *)&g_dest_addr, sizeof(g_dest_addr));
    return (sent == sizeof(PadPacket)) ? 0 : -1;
}

void udp_sender_close(void) {
    if (g_socket_fd >= 0) {
        close(g_socket_fd);
        g_socket_fd = -1;
    }
}
#endif
