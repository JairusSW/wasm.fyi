#include <errno.h>
#include <inttypes.h>
#include <libproc.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <unistd.h>

static int usage(int pid, struct rusage_info_v6 *info) {
    memset(info, 0, sizeof(*info));
    if (proc_pid_rusage(pid, RUSAGE_INFO_V6, (rusage_info_t *)info)) {
        fprintf(stderr, "proc_pid_rusage: %s\n", strerror(errno));
        return 1;
    }
    return 0;
}
int main(int argc, char **argv) {
    struct rusage_info_v6 before = {0}, after = {0};
    int self_test = argc == 2 && !strcmp(argv[1], "--self-test");
    int pid = self_test || argc == 1 ? getpid() : atoi(argv[1]);
    if (pid <= 0) return 2;
    if (self_test) {
        if (usage(pid, &before)) return 1;
        volatile uint64_t state = 1;
        for (uint64_t i = 0; i < 50000000; ++i)
            state = state * 1664525 + 1013904223;
        (void)state;
    }
    if (usage(pid, &after)) return 1;
    printf("{\"pid\":%d,\"userTime\":%" PRIu64 ",\"systemTime\":%" PRIu64
           ",\"performanceUserTime\":%" PRIu64 ",\"performanceSystemTime\":%" PRIu64
           ",\"instructions\":%" PRIu64 ",\"performanceInstructions\":%" PRIu64
           ",\"cycles\":%" PRIu64 ",\"performanceCycles\":%" PRIu64 "}\n",
           pid, after.ri_user_time - before.ri_user_time,
           after.ri_system_time - before.ri_system_time,
           after.ri_user_ptime - before.ri_user_ptime,
           after.ri_system_ptime - before.ri_system_ptime,
           after.ri_instructions - before.ri_instructions,
           after.ri_pinstructions - before.ri_pinstructions,
           after.ri_cycles - before.ri_cycles,
           after.ri_pcycles - before.ri_pcycles);
    return 0;
}
