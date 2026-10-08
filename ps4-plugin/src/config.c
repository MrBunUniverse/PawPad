#include "../include/pad_stream.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

static void trim(char *str) {
    char *start = str;
    while (isspace((unsigned char)*start)) start++;

    char *end = start + strlen(start) - 1;
    while (end > start && (isspace((unsigned char)*end) || *end == '\r' || *end == '\n')) {
        *end = '\0';
        end--;
    }

    if (start != str) {
        memmove(str, start, strlen(start) + 1);
    }
}

void config_load(const char *path, PadStreamConfig *config) {
    // Set safe defaults
    strncpy(config->target_ip, DEFAULT_TARGET_IP, sizeof(config->target_ip) - 1);
    config->target_ip[sizeof(config->target_ip) - 1] = '\0';
    config->target_port = DEFAULT_TARGET_PORT;
    config->poll_rate_ms = DEFAULT_POLL_RATE_MS;

    FILE *f = fopen(path, "r");
    if (!f) {
        f = fopen(CONFIG_PATH_ALT, "r");
    }
    if (!f) {
        return;
    }

    char line[256];
    while (fgets(line, sizeof(line), f)) {
        trim(line);
        // Skip comments and empty lines
        if (line[0] == ';' || line[0] == '#' || line[0] == '[' || line[0] == '\0') {
            continue;
        }

        char *eq = strchr(line, '=');
        if (!eq) continue;

        *eq = '\0';
        char *key = line;
        char *val = eq + 1;
        trim(key);
        trim(val);

        if (strcasecmp(key, "ip") == 0 || strcasecmp(key, "target_ip") == 0) {
            strncpy(config->target_ip, val, sizeof(config->target_ip) - 1);
            config->target_ip[sizeof(config->target_ip) - 1] = '\0';
        } else if (strcasecmp(key, "port") == 0 || strcasecmp(key, "target_port") == 0) {
            int p = atoi(val);
            if (p > 0 && p <= 65535) {
                config->target_port = (uint16_t)p;
            }
        } else if (strcasecmp(key, "poll_rate_ms") == 0 || strcasecmp(key, "poll_rate") == 0) {
            int rate = atoi(val);
            if (rate >= 1 && rate <= 1000) {
                config->poll_rate_ms = (uint32_t)rate;
            }
        }
    }

    fclose(f);
}
