#define main upstream_main
#include ICEPACK_SOURCE
#undef main
#include <sstream>
int main(int argc,char **argv){ FpgaConfig f; f.device="1k";f.freqrange="medium";f.nosleep="enabled";f.warmboot="enabled";
 f.cram_width=332;f.cram_height=144;f.bram_width=64;f.bram_height=256;f.skip_bram_initialization=false;
 f.cram.resize(4);f.bram.resize(4);
 for(int b=0;b<4;b++){f.cram[b].resize(f.cram_width);f.bram[b].resize(f.bram_width);
 for(int x=0;x<f.cram_width;x++){f.cram[b][x].resize(f.cram_height);for(int y=0;y<f.cram_height;y++)f.cram[b][x][y]=((x*17+y*31+b*7)%13)<6;}
 for(int x=0;x<f.bram_width;x++){f.bram[b][x].resize(f.bram_height);for(int y=0;y<f.bram_height;y++)f.bram[b][x][y]=((x*7+y*19+b*11)%17)<8;}}
std::ostringstream o;f.write_bits(o);std::string bytes=o.str();uint32_t h=2166136261u;for(unsigned char c:bytes)h=(h^c)*16777619u;printf("%u %zu\n",h,bytes.size());if(argc==2){std::ofstream file(argv[1],std::ios::binary);file.write(bytes.data(),bytes.size());}}
