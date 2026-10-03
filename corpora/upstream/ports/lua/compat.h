/* WASI has no tmpnam. Report the API as unavailable rather than invent a path. */
#define LUA_TMPNAMBUFSIZE 32
#define lua_tmpnam(buffer, error) ((error) = 1)
