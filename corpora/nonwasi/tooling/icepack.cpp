//
//  Copyright (C) 2015  Clifford Wolf <clifford@clifford.at>
//
//  Based on a reference implementation provided by Mathias Lasser
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
// Fixed-capacity in-memory containers replace host allocator/string/stream dependencies.
struct string { const char *p; string& operator=(const char *s){p=s;return *this;} bool operator==(const char *s)const{const char*q=p;while(*q&&*q==*s){q++;s++;}return *q==*s;}bool operator!=(const char*s)const{return !(*this==s);}const char*c_str()const{return p;} };
template<class T> struct vector { T data[48000]; unsigned n=0; void push_back(T x){if(n==48000)__builtin_trap();data[n++]=x;} unsigned size()const{return n;} T operator[](unsigned i)const{return data[i];}const T*begin()const{return data;}const T*end()const{return data+n;} };
#define debug(...) ((void)0)
#define info(...) ((void)0)
#define error(...) __builtin_trap()
struct FpgaConfig {
 string device,freqrange,nosleep,warmboot;
 int cram_width,cram_height,bram_width,bram_height;
 bool cram[4][332][144],bram[4][64][256];
 bool skip_bram_initialization;
 vector<uint8_t> initblop;
 void write_bits(MemoryOutput &ofs) const;
};
static void update_crc16(uint16_t &crc, uint8_t byte)
{
	// CRC-16-CCITT, Initialize to 0xFFFF, No zero padding
	for (int i = 7; i >= 0; i--) {
		uint16_t xor_value = ((crc >> 15) ^ ((byte >> i) & 1)) ? 0x1021 : 0;
		crc = (crc << 1) ^ xor_value;
	}
}

static void write_byte(MemoryOutput &ofs, uint16_t &crc_value, int &file_offset, uint8_t byte)
{
	ofs << byte;
	file_offset++;
	update_crc16(crc_value, byte);
}

void FpgaConfig::write_bits(MemoryOutput &ofs) const
{
	int file_offset = 0;
	uint16_t crc_value = 0;

	debug("## %s\n", __PRETTY_FUNCTION__);
	info("Writing bitstream file..\n");

	for (auto byte : this->initblop)
		ofs << byte;

	debug("Writing preamble.\n");
	write_byte(ofs, crc_value, file_offset, 0x7E);
	write_byte(ofs, crc_value, file_offset, 0xAA);
	write_byte(ofs, crc_value, file_offset, 0x99);
	write_byte(ofs, crc_value, file_offset, 0x7E);

	debug("Setting freqrange to '%s'.\n", this->freqrange.c_str());
	write_byte(ofs, crc_value, file_offset, 0x51);
	if (this->freqrange == "low")
		write_byte(ofs, crc_value, file_offset, 0x00);
	else if (this->freqrange == "medium")
		write_byte(ofs, crc_value, file_offset, 0x01);
	else if (this->freqrange == "high")
		write_byte(ofs, crc_value, file_offset, 0x02);
	else
		error("Unknown freqrange '%s'.\n", this->freqrange.c_str());

	debug("Resetting CRC.\n");
	write_byte(ofs, crc_value, file_offset, 0x01);
	write_byte(ofs, crc_value, file_offset, 0x05);
	crc_value = 0xffff;

	{
		uint8_t nosleep_flag;
		debug("Setting warmboot to '%s', nosleep to '%s'.\n", this->warmboot.c_str(), this->nosleep.c_str());
		write_byte(ofs, crc_value, file_offset, 0x92);
		write_byte(ofs, crc_value, file_offset, 0x00);

		if (this->nosleep == "disabled")
			nosleep_flag = 0;
		else if (this->nosleep == "enabled")
			nosleep_flag = 1;
		else
			error("Unknown nosleep setting '%s'.\n", this->nosleep.c_str());

		if (this->warmboot == "disabled")
			write_byte(ofs, crc_value, file_offset, 0x00 | nosleep_flag);
		else if (this->warmboot == "enabled")
			write_byte(ofs, crc_value, file_offset, 0x20 | nosleep_flag);
		else
			error("Unknown warmboot setting '%s'.\n", this->warmboot.c_str());
	}

	debug("CRAM: Setting bank width to %d.\n", this->cram_width);
	write_byte(ofs, crc_value, file_offset, 0x62);
	write_byte(ofs, crc_value, file_offset, (this->cram_width-1) >> 8);
	write_byte(ofs, crc_value, file_offset, (this->cram_width-1));
	if(this->device != "5k") {
		debug("CRAM: Setting bank height to %d.\n", this->cram_height);
		write_byte(ofs, crc_value, file_offset, 0x72);
		write_byte(ofs, crc_value, file_offset, this->cram_height >> 8);
		write_byte(ofs, crc_value, file_offset, this->cram_height);
	}

	debug("CRAM: Setting bank offset to 0.\n");
	write_byte(ofs, crc_value, file_offset, 0x82);
	write_byte(ofs, crc_value, file_offset, 0x00);
	write_byte(ofs, crc_value, file_offset, 0x00);

	for (int cram_bank = 0; cram_bank < 4; cram_bank++)
	{
		vector<bool> cram_bits;
		int height = this->cram_height;
		if(this->device == "5k" && ((cram_bank % 2) == 1))
			height = height / 2 + 8;
		for (int cram_y = 0; cram_y < height; cram_y++)
		for (int cram_x = 0; cram_x < this->cram_width; cram_x++)
			cram_bits.push_back(this->cram[cram_bank][cram_x][cram_y]);

		if(this->device == "5k") {
			debug("CRAM: Setting bank height to %d.\n", height);
			write_byte(ofs, crc_value, file_offset, 0x72);
			write_byte(ofs, crc_value, file_offset, height >> 8);
			write_byte(ofs, crc_value, file_offset, height);
		}

		debug("CRAM: Setting bank %d.\n", cram_bank);
		write_byte(ofs, crc_value, file_offset, 0x11);
		write_byte(ofs, crc_value, file_offset, cram_bank);

		debug("CRAM: Writing bank %d data.\n", cram_bank);
		write_byte(ofs, crc_value, file_offset, 0x01);
		write_byte(ofs, crc_value, file_offset, 0x01);
		for (int i = 0; i < int(cram_bits.size()); i += 8) {
			uint8_t byte = 0;
			for (int j = 0; j < 8; j++)
				byte = (byte << 1) | (cram_bits[i+j] ? 1 : 0);
			write_byte(ofs, crc_value, file_offset, byte);
		}

		write_byte(ofs, crc_value, file_offset, 0x00);
		write_byte(ofs, crc_value, file_offset, 0x00);
	}

	int bram_chunk_size = 128;

	if (this->bram_width && this->bram_height)
	{
		if(this->device != "5k") {
			debug("BRAM: Setting bank width to %d.\n", this->bram_width);
			write_byte(ofs, crc_value, file_offset, 0x62);
			write_byte(ofs, crc_value, file_offset, (this->bram_width-1) >> 8);
			write_byte(ofs, crc_value, file_offset, (this->bram_width-1));
		}


		debug("BRAM: Setting bank height to %d.\n", this->bram_height);
		write_byte(ofs, crc_value, file_offset, 0x72);
		write_byte(ofs, crc_value, file_offset, bram_chunk_size >> 8);
		write_byte(ofs, crc_value, file_offset, bram_chunk_size);

		for (int bram_bank = 0; bram_bank < 4; bram_bank++)
		{
			debug("BRAM: Setting bank %d.\n", bram_bank);
			write_byte(ofs, crc_value, file_offset, 0x11);
			write_byte(ofs, crc_value, file_offset, bram_bank);

			for (int offset = 0; offset < this->bram_height; offset += bram_chunk_size)
			{
				vector<bool> bram_bits;
				int width = this->bram_width;
				if(this->device == "5k" && ((bram_bank % 2) == 1))
					width = width / 2;
				for (int bram_y = 0; bram_y < bram_chunk_size; bram_y++)
				for (int bram_x = 0; bram_x < width; bram_x++)
					bram_bits.push_back(this->bram[bram_bank][bram_x][bram_y+offset]);

				debug("BRAM: Setting bank offset to %d.\n", offset);
				write_byte(ofs, crc_value, file_offset, 0x82);
				write_byte(ofs, crc_value, file_offset, offset >> 8);
				write_byte(ofs, crc_value, file_offset, offset);

				if(this->device == "5k") {
					debug("BRAM: Setting bank width to %d.\n", width);
					write_byte(ofs, crc_value, file_offset, 0x62);
					write_byte(ofs, crc_value, file_offset, (width-1) >> 8);
					write_byte(ofs, crc_value, file_offset, (width-1));
				}


                                if (!this->skip_bram_initialization) {
                                    debug("BRAM: Writing bank %d data.\n", bram_bank);
                                    write_byte(ofs, crc_value, file_offset, 0x01);
                                    write_byte(ofs, crc_value, file_offset, 0x03);
                                    for (int i = 0; i < int(bram_bits.size()); i += 8) {
                                            uint8_t byte = 0;
                                            for (int j = 0; j < 8; j++)
                                                    byte = (byte << 1) | (bram_bits[i+j] ? 1 : 0);
                                            write_byte(ofs, crc_value, file_offset, byte);
                                    }

                                    write_byte(ofs, crc_value, file_offset, 0x00);
                                    write_byte(ofs, crc_value, file_offset, 0x00);
                                }
			}
		}
	}

	debug("Writing CRC value.\n");
	write_byte(ofs, crc_value, file_offset, 0x22);
	uint8_t crc_hi = crc_value >> 8, crc_lo = crc_value;
	write_byte(ofs, crc_value, file_offset, crc_hi);
	write_byte(ofs, crc_value, file_offset, crc_lo);

	debug("Wakeup.\n");
	write_byte(ofs, crc_value, file_offset, 0x01);
	write_byte(ofs, crc_value, file_offset, 0x06);

	debug("Padding byte.\n");
	write_byte(ofs, crc_value, file_offset, 0x00);
}

extern "C" uint32_t run() {
 FpgaConfig f; f.device="1k";f.freqrange="medium";f.nosleep="enabled";f.warmboot="enabled";
 f.cram_width=332;f.cram_height=144;f.bram_width=64;f.bram_height=256;f.skip_bram_initialization=false;
 for(int b=0;b<4;b++){
 for(int x=0;x<f.cram_width;x++){for(int y=0;y<f.cram_height;y++)f.cram[b][x][y]=((x*17+y*31+b*7)%13)<6;}
 for(int x=0;x<f.bram_width;x++){for(int y=0;y<f.bram_height;y++)f.bram[b][x][y]=((x*7+y*19+b*11)%17)<8;}}
 output.size=0;f.write_bits(output);return hash(output.data,output.size);
}
