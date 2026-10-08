#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

// Set the loader policy after protected macOS launchers have cleared DYLD env.
int main(int argc, char **argv) {
    if (argc < 3 || argv[1][0] != '/' || argv[2][0] != '/') {
        fprintf(stderr, "usage: darwin-qos-launch /absolute/policy.dylib /absolute/engine [args]\n");
        return 2;
    }
    if (setenv("DYLD_INSERT_LIBRARIES", argv[1], 1)) {
        perror("setenv");
        return 1;
    }
    execv(argv[2], argv + 2);
    perror("execv");
    return 1;
}
