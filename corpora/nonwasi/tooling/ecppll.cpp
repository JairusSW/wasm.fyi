/*
Copyright (C) 2018  The Project Trellis Authors. All rights reserved.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

libtrellis/include contains list_indexing_suite.h and
set_indexing_suite.h from bond, see below license:

The MIT License (MIT)

Copyright (c) 2014 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
// Extracted from Project Trellis ecppll.cpp; see PROVENANCE.md.
#include <stdint.h>
#define PFD_MIN 3.125f
#define PFD_MAX 400.0f
#define VCO_MIN 400.0f
#define VCO_MAX 800.0f
#define OUTPUT_MIN 10.0f
#define OUTPUT_MAX 400.0f
enum class pll_mode { SIMPLE,HIGHRES };
struct secondary_params { int div; bool enabled; float freq; };
struct pll_params { pll_mode mode; int refclk_div,feedback_div,output_div,primary_cphase; float fout,fvco; secondary_params secondary[3]; };
void calc_pll_params(pll_params &params, float input, float output){
  float error = 3.402823466e+38F;
  for(int input_div=1;input_div <= 128; input_div++){

    float fpfd = input / (float)input_div;
    if(fpfd < PFD_MIN || fpfd > PFD_MAX)
      continue;
    for(int feedback_div=1;feedback_div <= 80; feedback_div++){
      for(int output_div=1;output_div <= 128; output_div++){
	float fvco = fpfd * (float)feedback_div * (float) output_div;

	if(fvco < VCO_MIN || fvco > VCO_MAX)
	  continue;

	float fout = fvco / (float) output_div;
	if(__builtin_fabsf(fout - output) < error ||
	   (__builtin_fabsf(fout-output) == error && __builtin_fabsf(fvco - 600) < __builtin_fabsf(params.fvco - 600))){
	  error = __builtin_fabsf(fout-output);
	  params.refclk_div = input_div;
	  params.feedback_div = feedback_div;
	  params.output_div = output_div;
	  params.fout = fout;
	  params.fvco = fvco;
	  // shift the primary by 180 degrees. Lattice seems to do this
	  float ns_phase = 1/(fout * 1e6) * 0.5;
	  params.primary_cphase = ns_phase * (fvco * 1e6);
	}
      }
    }
  }
}

void calc_pll_params_highres(pll_params &params, float input, float output){
  float error = 3.402823466e+38F;
  for(int input_div=1;input_div <= 128; input_div++){

    float fpfd = input / (float)input_div;
    if(fpfd < PFD_MIN || fpfd > PFD_MAX)
      continue;
    for(int feedback_div=1;feedback_div <= 80; feedback_div++){
      for(int output_div=1;output_div <= 128; output_div++){
	float fvco = fpfd * (float)feedback_div * (float) output_div;

	if(fvco < VCO_MIN || fvco > VCO_MAX)
	  continue;
	float ffeedback = fvco / (float) output_div;
	if(ffeedback < OUTPUT_MIN || ffeedback > OUTPUT_MAX)
	  continue;
	for(int secondary_div = 1; secondary_div <= 128; secondary_div++){
	  float fout = fvco / (float) secondary_div;
	  if(__builtin_fabsf(fout - output) < error ||
	     (__builtin_fabsf(fout-output) == error && __builtin_fabsf(fvco - 600) < __builtin_fabsf(params.fvco - 600))){
	    error = __builtin_fabsf(fout-output);
	    params.mode = pll_mode::HIGHRES;
	    params.refclk_div = input_div;
	    params.feedback_div = feedback_div;
	    params.output_div = output_div;
	    params.secondary[0].div = secondary_div;
	    params.secondary[0].enabled = true;
	    params.secondary[0].freq = fout;
	    params.fout = fout;
	    params.fvco = fvco;
	  }
	}
      }
    }
  }
}



extern "C" void reset() {}
extern "C" uint32_t run() {
  static const float pairs[][2]={{12,48},{20,30},{45,30},{100,400},{70,40},{12,96},{90,50},{43,86},{25,74.25},{48,148.5},{27,65}};
  static const int golden[][4]={{1,4,12,5},{2,3,20,9},{3,2,20,9},{1,4,1,0},{7,4,15,7},{1,8,6,2},{9,5,12,5},{1,2,7,3},{1,3,8,4},{11,34,4,1},{5,12,9,4}};
  unsigned pair_index=0;
  uint32_t h=2166136261u;
  for(auto &pair:pairs) { pll_params p={}; calc_pll_params(p,pair[0],pair[1]);
    h=(h^p.refclk_div)*16777619u; h=(h^p.feedback_div)*16777619u; h=(h^p.output_div)*16777619u; h=(h^p.primary_cphase)*16777619u;
    if(p.fvco<400 || p.fvco>800) __builtin_trap();
    const int *g=golden[pair_index++];
    if(p.refclk_div!=g[0]||p.feedback_div!=g[1]||p.output_div!=g[2]||p.primary_cphase!=g[3]) __builtin_trap();
  } return h;
}
