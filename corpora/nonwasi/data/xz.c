#include <lzma.h>
#include <stdint.h>
#include "xz-input.h"
static uint8_t output[OUTPUT_SIZE];
__attribute__((export_name("benchmark"))) uint32_t benchmark(void) {
 uint64_t limit=128u*1024u*1024u; size_t in_pos=0,out_pos=0;
 if(lzma_stream_buffer_decode(&limit,0,0,compressed,&in_pos,sizeof(compressed),output,&out_pos,sizeof(output))!=LZMA_OK||in_pos!=sizeof(compressed)||out_pos!=sizeof(output))__builtin_trap();
 uint32_t hash=2166136261u;for(size_t i=0;i<out_pos;i++)hash=(hash^output[i])*16777619u;return hash;
}
