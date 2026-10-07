#include <stdlib.h>
_Noreturn void abort(void) { __builtin_trap(); }
/* Freestanding benchmark canary, initialized without entropy or constructors. */
#include <stdint.h>
uintptr_t __stack_chk_guard = 0x93d765a1u;
_Noreturn void __stack_chk_fail(void) { __builtin_trap(); }
