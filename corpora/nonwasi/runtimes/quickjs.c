#include <stdint.h>
#include <string.h>
#include "quickjs.h"
#include "program.h"
static uint32_t hash;
static JSValue capture(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  (void)self;
  for(int i=0;i<argc;i++) {
    if(i) { hash^=' '; hash*=16777619u; }
    size_t n; const char *s=JS_ToCStringLen(ctx,&n,argv[i]);
    if(!s) __builtin_trap();
    for(size_t j=0;j<n;j++) {hash^=(unsigned char)s[j];hash*=16777619u;}
    JS_FreeCString(ctx,s);
  }
  hash^='\n';hash*=16777619u;
  return JS_UNDEFINED;
}
__attribute__((export_name("run"))) int run(void) {
  hash=2166136261u;
  JSRuntime *rt=JS_NewRuntime(); if(!rt)__builtin_trap();
  JSContext *ctx=JS_NewContextRaw(rt);if(!ctx)__builtin_trap();
  if(JS_AddIntrinsicBaseObjects(ctx)||JS_AddIntrinsicEval(ctx)||JS_AddIntrinsicRegExp(ctx)||JS_AddIntrinsicJSON(ctx))__builtin_trap();
  JSValue global=JS_GetGlobalObject(ctx), console=JS_NewObject(ctx);
  JS_SetPropertyStr(ctx,console,"log",JS_NewCFunction(ctx,capture,"log",1));
  JS_SetPropertyStr(ctx,global,"console",console);JS_FreeValue(ctx,global);
  JSValue result=JS_Eval(ctx,program,sizeof(program)-1,"events.js",JS_EVAL_TYPE_GLOBAL);
  if(JS_IsException(result))__builtin_trap();
  JS_FreeValue(ctx,result);JS_FreeContext(ctx);JS_FreeRuntime(rt);
  return (int)hash;
}
