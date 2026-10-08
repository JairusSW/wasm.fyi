#include <stdint.h>
#include <stddef.h>
struct MemoryOutput { uint8_t data[262144]; unsigned size=0; MemoryOutput& operator<<(uint8_t b) { if(size==sizeof(data)) __builtin_trap(); data[size++]=b; return *this; } void write(const char *p,size_t n) { while(n--) *this << (uint8_t)*p++; } };
static uint32_t hash(const uint8_t *p, unsigned n) { uint32_t h=2166136261u; while(n--) h=(h^*p++)*16777619u; return h; }
extern "C" void reset() {}

static MemoryOutput output;
extern "C" const uint8_t* output_ptr(){return output.data;}
extern "C" unsigned output_len(){return output.size;}
