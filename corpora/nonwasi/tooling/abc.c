// Actual ABC Morreale ISOP minimization; exhaustive independent truth-table validation.
#include "bool/kit/kit.h"
#include <stdint.h>
void reset(void) {}
uint32_t run(void) {
 uint32_t h=2166136261u; Vec_Int_t *cover=Vec_IntAlloc(1024);
 for(unsigned fixture=0;fixture<12;fixture++) {
  unsigned truth[32]={0};
  for(unsigned x=0;x<1024;x++) { unsigned a=x&31,b=x>>5;
   unsigned v=fixture%3==0 ? ((a+b+fixture)&16)!=0 : fixture%3==1 ? (((a*3+b*5+fixture)&31)<12) : (((a^(b<<1)^fixture)&15)==3 || (a&b&7)==7);
   if(v) truth[x>>5]|=1u<<(x&31);
  }
  int invert=Kit_TruthIsop(truth,10,cover,1); if(invert<0)__builtin_trap();
  for(unsigned x=0;x<1024;x++) { int output=0;
   for(int c=0;c<Vec_IntSize(cover);c++) { unsigned cube=Vec_IntEntry(cover,c);int matches=1;
    for(unsigned v=0;v<10;v++) {unsigned literal=(cube>>(2*v))&3; if((literal==1&&((x>>v)&1))||(literal==2&&!((x>>v)&1))) {matches=0;break;} }
    output|=matches;
   }
   output^=invert;if(output!=(int)((truth[x>>5]>>(x&31))&1))__builtin_trap();
  }
  h=(h^Vec_IntSize(cover))*16777619u;for(int c=0;c<Vec_IntSize(cover);c++)h=(h^(unsigned)Vec_IntEntry(cover,c))*16777619u;
 }
 Vec_IntFree(cover);return h;
}
