#include <brotli/encode.h>
#include <brotli/decode.h>
#include <stdint.h>
#include <string.h>
static size_t encoded_size;
__attribute__((export_name("compressed_size"))) uint32_t compressed_size(void) { return (uint32_t)encoded_size; }
static uint8_t input[65536], compressed[131072], decoded[65536];
__attribute__((export_name("compressed_pointer"))) const uint8_t *compressed_pointer(void) { return compressed; }
__attribute__((export_name("benchmark"))) uint32_t benchmark(void) {
 for(uint32_t i=0;i<sizeof(input);i++) input[i]=(uint8_t)((i*17u+(i>>8))&255);
 size_t n=sizeof(compressed), m=sizeof(decoded);
 if(!BrotliEncoderCompress(10,BROTLI_DEFAULT_WINDOW,BROTLI_MODE_GENERIC,sizeof(input),input,&n,compressed)||n>=sizeof(input))__builtin_trap();
 if(BrotliDecoderDecompress(n,compressed,&m,decoded)!=BROTLI_DECODER_RESULT_SUCCESS||m!=sizeof(input)||memcmp(input,decoded,m))__builtin_trap();
 encoded_size=n;
 uint32_t hash=2166136261u;for(size_t i=0;i<m;i++)hash=(hash^decoded[i])*16777619u;return hash;
}
