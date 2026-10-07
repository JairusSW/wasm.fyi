//
//  Copyright (C) 2015  Marcus Comstedt <marcus@mc.pp.se>
//
//  Permission to use, copy, modify, and/or distribute this software for any
//  purpose with or without fee is hereby granted, provided that the above
//  copyright notice and this permission notice appear in all copies.
//
//  THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
//  WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
//  MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
//  ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
//  WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
//  ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
//  OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
//

#include "memory.hpp"
static const int NUM_IMAGES=4,HEADER_SIZE=32;
struct Image { uint32_t offs; uint32_t offset() const { return offs; } };
static void align_offset(uint32_t &offset, int bits)
{
    uint32_t mask = (1 << bits) - 1;
    if (offset & mask)
        offset = (offset | mask) + 1;
}

static void write_byte(MemoryOutput &ofs, uint32_t &file_offset, uint8_t byte)
{
    ofs << byte;
    file_offset++;
}

static void write_bytes(MemoryOutput &ofs, uint32_t &file_offset,
                        const uint8_t *buf, size_t n)
{
    if (n > 0) {
        ofs.write(reinterpret_cast<const char*>(buf), n);
        file_offset += n;
    }
}

static void write_header(MemoryOutput &ofs, uint32_t &file_offset,
                         Image const *image, bool coldboot)
{
    // Preamble
    write_byte(ofs, file_offset, 0x7e);
    write_byte(ofs, file_offset, 0xaa);
    write_byte(ofs, file_offset, 0x99);
    write_byte(ofs, file_offset, 0x7e);

    // Boot mode
    write_byte(ofs, file_offset, 0x92);
    write_byte(ofs, file_offset, 0x00);
    write_byte(ofs, file_offset, coldboot ? 0x10 : 0x00);

    // Boot address
    write_byte(ofs, file_offset, 0x44);
    write_byte(ofs, file_offset, 0x03);
    write_byte(ofs, file_offset, (image->offset() >> 16) & 0xff);
    write_byte(ofs, file_offset, (image->offset() >> 8) & 0xff);
    write_byte(ofs, file_offset, image->offset() & 0xff);

    // Bank offset
    write_byte(ofs, file_offset, 0x82);
    write_byte(ofs, file_offset, 0x00);
    write_byte(ofs, file_offset, 0x00);

    // Reboot
    write_byte(ofs, file_offset, 0x01);
    write_byte(ofs, file_offset, 0x08);

    // Zero out any unused bytes
    while (file_offset & (HEADER_SIZE - 1))
        write_byte(ofs, file_offset, 0x00);
}

extern "C" uint32_t run() {
 output.size=0; Image images[4]; uint32_t lengths[4]={1021,8193,4099,17011}; uint32_t pos=160;
 for(int i=0;i<4;i++){align_offset(pos,12);images[i].offs=pos;pos+=lengths[i];}
 uint32_t file_offset=0;
 for(int i=0;i<5;i++) write_header(output,file_offset,&images[i?i-1:2],false);
 for(int i=0;i<4;i++){while(file_offset<images[i].offs)write_byte(output,file_offset,255); for(uint32_t j=0;j<lengths[i];j++)write_byte(output,file_offset,(uint8_t)((j*37u+(j>>5)+i*71u)&255));}
 return hash(output.data,output.size);
}
