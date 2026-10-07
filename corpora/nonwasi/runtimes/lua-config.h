/* This benchmark executes trusted, fixed programs. Errors are fatal traps,
 * not recoverable pcall/longjmp operations. No clock is needed for hash seeds. */
#define LUAI_THROW(L,c) __builtin_trap()
#define LUAI_TRY(L,c,a) a
#define luai_jmpbuf int
#define luai_makeseed(L) 0x243f6a88u
#define l_signalT int
#define l_randomizePivot() (~0u)
