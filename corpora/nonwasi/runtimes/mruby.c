#include <stdint.h>
#include "mruby.h"
#include "mruby/compile.h"
#include "mruby/string.h"
#include "program.h"
static uint32_t hash;
static mrb_value capture(mrb_state *mrb, mrb_value self) {
  (void)self;
  const char *s; mrb_int n;
  mrb_get_args(mrb,"s",&s,&n);
  for(mrb_int i=0;i<n;i++){hash^=(unsigned char)s[i];hash*=16777619u;}
  hash^='\n';hash*=16777619u;
  return mrb_nil_value();
}
__attribute__((export_name("run"))) int run(void) {
  hash=2166136261u;
  mrb_state *mrb=mrb_open();if(!mrb)__builtin_trap();
  mrb_define_method(mrb,mrb->kernel_module,"puts",capture,MRB_ARGS_REQ(1));
  mrb_load_nstring(mrb,program,sizeof(program)-1);
  if(mrb->exc)__builtin_trap();
  mrb_close(mrb);
  return (int)hash;
}
