#include <errno.h>
#include <stdio.h>
/* Preview 1 has no process spawning or anonymous temporary-file service. */
FILE *tmpfile(void) { errno = ENOSYS; return NULL; }
int system(const char *command) { if (!command) return 0; errno = ENOSYS; return -1; }
