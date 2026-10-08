#include <stdlib.h>
#include <stdint.h>
#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"
#include "program.h"
static uint32_t hash;
static void *allocate(void *ud, void *p, size_t old, size_t n) {
  (void)ud; (void)old;
  if (!n) { free(p); return NULL; }
  return realloc(p,n);
}
static int capture(lua_State *L) {
  for (int i=1;i<=lua_gettop(L);i++) {
    if (i>1) { hash ^= '\t'; hash *= 16777619u; }
    size_t n; const char *s=lua_tolstring(L,i,&n);
    if (!s) __builtin_trap();
    for(size_t j=0;j<n;j++) { hash ^= (unsigned char)s[j]; hash *= 16777619u; }
  }
  hash ^= '\n'; hash *= 16777619u;
  return 0;
}
__attribute__((export_name("run"))) int run(void) {
  hash=2166136261u;
  lua_State *L=lua_newstate(allocate,NULL);
  if (!L) __builtin_trap();
  luaL_requiref(L,"table",luaopen_table,1); lua_pop(L,1);
  luaL_requiref(L,"string",luaopen_string,1); lua_pop(L,1);
  lua_pushcfunction(L,capture); lua_setglobal(L,"print");
  if(luaL_loadbuffer(L,program,sizeof(program)-1,"buckets")) __builtin_trap();
  lua_call(L,0,0); lua_close(L);
  return (int)hash;
}
