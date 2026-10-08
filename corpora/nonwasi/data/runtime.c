/* Fatal internal failures trap instead of terminating a host process. */
#include <stdlib.h>
_Noreturn void abort(void) { __builtin_trap(); }
/* Brotli's allocation/invariant failure paths call exit(EXIT_FAILURE). */
_Noreturn void __wrap_exit(int status) { (void)status; __builtin_trap(); }
