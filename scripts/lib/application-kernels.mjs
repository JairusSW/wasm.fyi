import { createCipheriv } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { posix } from 'node:path';
// Independent JavaScript result oracle; not generated from Wasm output.
export const kernels = [
  ['image-blur', 'Image editing', '3×3 Gaussian blur with clamped image borders', 192, 'pixels', n=>n*n],
  ['image-resize', 'Image editing', 'Bilinear image downsampling at pixel centers', 192, 'output_pixels', n=>n*n/4],
  ['image-composite', 'Image editing', 'Alpha compositing and clamped color adjustment', 192, 'pixels', n=>n*n],
  ['vision-sobel', 'Computer vision', 'Sobel horizontal/vertical edges and gradient magnitude', 192, 'interior_pixels', n=>(n-2)**2],
  ['video-motion', 'Video processing', '8×8 block motion estimation over a 5×5 displacement search', 192, 'blocks', n=>Math.ceil((n-12)/8)**2],
  ['mesh-skinning', '3D & rendering', 'Fixed-point skeletal skinning with four bone influences and 3×4 matrices', 4096, 'vertices', n=>n],
  ['triangle-raster', '3D & rendering', 'CPU triangle coverage rasterization into a 128×128 depth buffer', 512, 'triangles', n=>n],
  ['particle-physics', 'Games & physics', '64 simulation steps of particle integration, gravity and reflecting wall collisions', 4096, 'particle_steps', n=>n*64],
  ['ml-inference', 'Machine learning', 'Int8 dense inference: 64 input channels, 32 outputs, ReLU activation', 16, 'multiply_accumulates', n=>n*64*32],
  ['audio-fir', 'Audio', '32-tap fixed-point FIR audio filtering', 4096, 'samples', n=>n],
  ['columnar-query', 'Databases & analytics', 'Columnar range filter with grouped SUM and COUNT over 256 keys', 16384, 'rows', n=>n],
  ['map-point-segment', 'Geospatial', 'Map geometry classification by exact squared distance to a finite line segment', 16384, 'points', n=>n],
  ['document-layout', 'Documents & layout', 'Proportional glyph advances and greedy word line breaking into 640-unit lines', 16384, 'words', n=>n],
  ['grid-pathfinding', 'Games & physics', 'Four-neighbor breadth-first shortest paths over a seeded obstacle grid', 96, 'cells', n=>n*n],
  ["frustum-culling","3D & rendering","Orthographic sphere/frustum culling against six clipping planes",4096,"spheres",n=>n],
  ["ray-box","3D & rendering","Fixed-point slab ray/AABB intersection with positive ray directions",4096,"rays",n=>n],
  ["bezier-tessellation","3D & rendering","Cubic 3D Bezier tessellation using Bernstein evaluation at 17 samples",256,"curve_samples",n=>n*17],
  ["audio-biquad","Audio","Q8 second-order low-pass IIR biquad with reset filter history",8192,"samples",n=>n],
  ["audio-autocorrelation","Audio","Pitch-analysis autocorrelation over 32 positive sample lags",4096,"sample_pairs",n=>32*n-528],
  ["audio-adpcm","Audio","Custom adaptive 4-bit differential PCM: saturating predictor and variable quantizer step",8192,"samples",n=>n],
  ["compiler-constant-fold","Compilers & development tools","Constant propagation and folding over a mixed literal/variable expression DAG",512,"ir_nodes",n=>n],
  ["compiler-dead-code","Compilers & development tools","Backward reachability elimination of dead nodes in an acyclic IR dependency graph",2048,"ir_nodes",n=>n],
  ["compiler-register-allocation","Compilers & development tools","Linear-scan register allocation with eight registers and furthest-end spilling",2048,"live_intervals",n=>n],
  ["compression-rle","Compression","Byte run-length encoding of mixed repeated and noisy input spans",16384,"input_bytes",n=>n],
  ["compression-lzw","Compression","Lempel\u2013Ziv\u2013Welch dictionary compression with 12-bit code-space limit",2048,"input_bytes",n=>n],
  ["vision-otsu","Computer vision","Otsu histogram-based global threshold selection for grayscale segmentation",128,"pixels",n=>n*n],
  ["vision-dilation","Computer vision","Binary 3\u00d73 morphological dilation with cropped image borders",128,"pixels",n=>n*n],
  ["vision-components","Computer vision","Four-connected binary component labeling by union-find with canonical minimum labels",128,"pixels",n=>n*n],
  ["vision-fast-corners","Computer vision","FAST-9 corner detection on the 16-sample radius-three ring",96,"interior_pixels",n=>(n-6)*(n-6)],
  ["vision-distance-transform","Computer vision","Two-pass city-block distance transform of a binary image",128,"pixels",n=>n*n],
  ["db-btree","Databases & analytics","Bulk-built eight-way B-tree index and point lookups",1024,"lookups",n=>n],
  ["db-hash-join","Databases & analytics","Chained hash equijoin emitting matching left/right row pairs",512,"input_rows",n=>2*n],
  ["db-sort-merge-join","Databases & analytics","Sort-merge equijoin with grouped result multiplicities",512,"input_rows",n=>2*n],
  ["db-bitmap-index","Databases & analytics","Bitmap filter intersection and set-bit counting",8192,"rows",n=>n],
  ["document-optimal-wrap","Documents & layout","Dynamic-programming minimum-raggedness line breaking with quadratic slack cost",512,"words",n=>n],
  ["document-edit-distance","Documents & layout","Two-row Levenshtein document-token edit distance",256,"token_pairs",n=>n*n],
  ["document-kerning","Documents & layout","Glyph positioning with pair-kerning adjustments and proportional advances",16384,"glyphs",n=>n],
  ["document-bidi-reorder","Documents & layout","Bidirectional run reordering from supplied embedding levels (L2 stage only)",4096,"glyphs",n=>n],
  ["document-page-packing","Documents & layout","First-fit decreasing page packing of document block heights",512,"blocks",n=>n],
  ["files-path-normalize","Files & directories","Lexical path normalization by dot-segment stack reduction",2048,"paths",n=>n],
  ["files-content-chunking","Files & directories","Gear-hash content-defined chunk boundaries with 32-byte minimum and 1024-byte maximum",32768,"bytes",n=>n],
  ["files-merkle-tree","Files & directories","Binary Merkle content tree with a non-cryptographic FNV fixture hash",1024,"leaf_blocks",n=>n],
  ["files-glob-match","Files & directories","Wildcard filename matching with star backtracking and single-character wildcards",4096,"filenames",n=>n],
  ["files-path-trie","Files & directories","Directory-component trie construction with deduplicated prefixes",512,"paths",n=>n],
  ["game-collision-impulse","Games & physics","One-dimensional elastic collision impulse resolution for contacting bodies",8192,"body_pairs",n=>n],
  ["game-flocking","Games & physics","Local-neighbor boid cohesion and separation steering",256,"agents",n=>n],
  ["game-spatial-hash","Games & physics","Uniform-grid broadphase pair enumeration for collision candidates",2048,"bodies",n=>n],
  ["game-cellular-automata","Games & physics","Eight generations of Conway Life on a toroidal game grid",64,"cell_steps",n=>8*n*n],
  ["geo-point-in-polygon","Geospatial","Even-odd point-in-polygon classification against an eight-vertex map polygon",8192,"points",n=>n],
  ["geo-convex-hull","Geospatial","Andrew monotone-chain convex hull of two-dimensional map points",256,"points",n=>n],
  ["geo-polygon-clipping","Geospatial","Integer Sutherland\u2013Hodgman clipping of map polygons to a tile rectangle",1024,"polygons",n=>n],
  ["geo-polyline-simplify","Geospatial","Ramer\u2013Douglas\u2013Peucker polyline simplification with squared perpendicular-distance tolerance",512,"points",n=>n],
  ["geo-geohash","Geospatial","Binary geohash encoding by interleaving quantized longitude/latitude bits",8192,"coordinates",n=>n],
  ["graphics-bresenham","Graphics & images","Bresenham integer line rasterization into a 128\u00d7128 coverage image",1024,"lines",n=>n],
  ["graphics-png-paeth","Graphics & images","PNG Paeth scanline residual filtering with four-byte pixels",16384,"bytes",n=>n],
  ["graphics-reed-solomon","Graphics & images","GF(256) polynomial multiplication used in Reed\u2013Solomon image-code parity construction",1024,"polynomial_products",n=>n],
  ["hardware-prime-implicants","Hardware design","Four-variable Boolean truth-table prime implicant enumeration",128,"truth_tables",n=>n],
  ["hardware-boolean-anf","Hardware design","Boolean M\u00f6bius transform into algebraic normal form for eight-input logic functions",64,"truth_tables",n=>n],
  ["image-median","Image editing","3\u00d73 median filtering of interior grayscale pixels",128,"interior_pixels",n=>(n-2)*(n-2)],
  ["image-error-diffusion","Image editing","Floyd\u2013Steinberg monochrome error-diffusion dithering",128,"pixels",n=>n*n],
  ["image-ycocg","Image editing","Reversible integer RGB-to-YCoCg lifting color transform",16384,"pixels",n=>n],
  ["graph-dijkstra","Integer & graph algorithms","Dense-graph Dijkstra single-source shortest paths",64,"edges",n=>n*n],
  ["serialization-msgpack","JSON & serialization","MessagePack shortest-form unsigned integer encoding",4096,"integers",n=>n],
  ["serialization-protobuf","JSON & serialization","Packed Protobuf unsigned-varint stream decoding, with fixture encoding included",4096,"integers",n=>n],
  ["language-forth","Language runtimes","Tiny Forth-style text interpreter: decimal literals, arithmetic and output words",1024,"programs",n=>n],
  ["language-brainfuck","Language runtimes","Brainfuck tape interpreter with bracket scanning and loop control",256,"programs",n=>n],
  ["language-register-vm","Language runtimes","Eight-register bytecode interpreter with arithmetic, table loads and conditional skips",4096,"instructions",n=>n],
  ["ml-convolution","Machine learning","Valid 3\u00d73 int8 convolution followed by ReLU activation",128,"output_pixels",n=>(n-2)*(n-2)],
  ["ml-max-pooling","Machine learning","2\u00d72 maximum-pooling reduction of activation planes",192,"output_pixels",n=>n*n/4],
  ["ml-decision-tree","Machine learning","Depth-eight decision-tree classifier over eight input features",8192,"rows",n=>n],
  ["ml-knn","Machine learning","Five-nearest-neighbor classification against 32 eight-dimensional training vectors",256,"queries",n=>n],
  ["ml-kmeans","Machine learning","Five Lloyd iterations of eight-cluster two-dimensional k-means",1024,"points",n=>n],
  ["numeric-integer-sqrt","Numerical arithmetic","Integer Newton square-root iteration with floor-result correction",8192,"roots",n=>n],
  ["numeric-euclidean-gcd","Numerical arithmetic","Euclidean greatest-common-divisor reduction of integer pairs",8192,"pairs",n=>n],
  ["numeric-cordic","Numerical arithmetic","Q16 CORDIC sine/cosine rotation over angles in the convergence interval",4096,"angles",n=>n],
  ["numeric-simpson","Numerical arithmetic","Composite Simpson quadrature of a quadratic polynomial over integer sample points",1024,"function_evaluations",n=>n+1],
  ["search-kmp","Search & indexing","Knuth\u2013Morris\u2013Pratt substring matching with prefix failure links",32768,"characters",n=>n],
  ["search-horspool","Search & indexing","Boyer\u2013Moore\u2013Horspool substring search with bad-character shifts",32768,"characters",n=>n],
  ["search-rabin-karp","Search & indexing","Rabin\u2013Karp rolling polynomial hash with exact match verification",32768,"characters",n=>n],
  ["search-aho-corasick","Search & indexing","Aho\u2013Corasick multi-pattern automaton with suffix-failure links",16384,"characters",n=>n],
  ["search-bk-tree","Search & indexing","BK-tree fuzzy lookup using Hamming distance over 16-bit symbol vectors",512,"queries",n=>n],
  ["stats-quickselect","Statistics","Lomuto quickselect median without fully sorting observations",4095,"observations",n=>n],
  ["stats-welford","Statistics","Q8 online Welford mean and variance accumulator",8192,"observations",n=>n],
  ["stats-linear-regression","Statistics","Q8 ordinary least-squares slope and intercept from sufficient statistics",4096,"observations",n=>n],
  ["stats-gini","Statistics","Q16 empirical categorical Gini impurity from class-frequency counts",8192,"observations",n=>n],
  ["stats-bootstrap","Statistics","Deterministic bootstrap resampling of the mean, 64 resample replicates",512,"resampled_observations",n=>64*n],
  ["video-dct","Video processing","Separable Q10 8\u00d78 cosine transform (unscaled DCT-II coefficients)",256,"blocks",n=>n],
  ["video-yuv420","Video processing","Integer BT.601 RGB-to-YUV420 conversion with 2\u00d72 chroma averaging",128,"pixels",n=>n*n],
  ["video-deblocking","Video processing","Thresholded vertical block-boundary deblocking with clamped pair updates",128,"pixels",n=>n*n],
  ["video-temporal-denoise","Video processing","Ten-frame exponential temporal denoising with integer 3:1 history weighting",128,"pixel_frames",n=>10*n*n],
  ["video-optical-flow","Video processing","Q6 Lucas\u2013Kanade optical flow from 3\u00d73 patch normal equations",96,"patches",n=>Math.ceil((n-4)/3)**2],

  ["graph-kruskal","Integer & graph algorithms","Kruskal minimum-spanning-tree weight using sorted edges and disjoint sets",32,"edges",n=>n*(n-1)/2],
  ["crypto-aes128","Hashing & cryptography","AES-128 ECB encryption with key expansion and algebraic S-box setup included",256,"blocks",n=>n],
  ["checksum-crc32","Hashing & cryptography","IEEE CRC-32 byte-stream checksum using reflected bitwise polynomial reduction",32768,"bytes",n=>n],

  ["stencil-lattice-boltzmann","Stencils","D2Q9 lattice-Boltzmann fluid collision/streaming with BGK relaxation",32,"population_steps",n=>10*n*n*9],
  ["stencil-wave-equation","Stencils","Second-order two-dimensional wave-equation time stepping on a periodic grid",64,"cell_steps",n=>8*n*n],
].map(([id,category,description,size,unit,units],i)=>({id,category,description,size,unit,units,kind:i+1}));
export function sample(i) {
  let x=(i+0x9e3779b9)>>>0; x^=x>>>16; x=Math.imul(x,0x85ebca6b); x^=x>>>13; return x>>>0;
}
export function reference(kind,n) {
  let h=2166136261;
  const add=x=>{h=Math.imul(h^x,16777619)>>>0;};
  const image=()=>Uint32Array.from({length:n*n},(_,i)=>sample(i)&255);
  if(kind<=5) {
    const a=image();
    if(kind===1) {
      for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
        let v=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)
          v+=a[Math.max(0,Math.min(n-1,y+dy))*n+Math.max(0,Math.min(n-1,x+dx))]*(dy===0?2:1)*(dx===0?2:1);
        add(Math.floor(v/16));
      }
    } else if(kind===2) {
      for(let y=0;y<n;y+=2)for(let x=0;x<n;x+=2)add(Math.floor((a[y*n+x]+a[y*n+x+1]+a[(y+1)*n+x]+a[(y+1)*n+x+1]+2)/4));
    } else if(kind===3) {
      for(let i=0;i<a.length;i++) {
        const alpha=sample(i+17)&255,background=sample(i+31)&255;
        add(Math.min(255,Math.floor(Math.floor((a[i]*alpha+background*(255-alpha)+127)/255)*9/8)));
      }
    } else if(kind===4) {
      const at=(x,y)=>a[y*n+x];
      for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++) {
        const gx=-at(x-1,y-1)+at(x+1,y-1)-2*at(x-1,y)+2*at(x+1,y)-at(x-1,y+1)+at(x+1,y+1);
        const gy=-at(x-1,y-1)-2*at(x,y-1)-at(x+1,y-1)+at(x-1,y+1)+2*at(x,y+1)+at(x+1,y+1);
        add(Math.abs(gx)+Math.abs(gy));
      }
    } else {
      const b=Uint32Array.from({length:n*n},(_,i)=>sample((i+n+1)%(n*n))&255);
      for(let y=2;y+10<n;y+=8)for(let x=2;x+10<n;x+=8) {
        let best=Infinity,index=0;
        for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++) {
          let sad=0;for(let yy=0;yy<8;yy++)for(let xx=0;xx<8;xx++)sad+=Math.abs(a[(y+yy)*n+x+xx]-b[(y+yy+dy)*n+x+xx+dx]);
          if(sad<best){best=sad;index=(dy+2)*5+dx+2;}
        } add(best);add(index);
      }
    }
  } else if(kind===6) {
    for(let i=0;i<n;i++)for(let row=0;row<3;row++) {
      let sum=0;
      for(let bone=0;bone<4;bone++) {
        const position=Array.from({length:3},(_,col)=>(sample(i*3+col)&1023)-512);
        const matrix=Array.from({length:3},(_,col)=>(sample(bone*12+row*4+col)&127)-64);
        sum+=(position.reduce((v,p,col)=>v+p*matrix[col],0)+(sample(bone*12+row*4+3)&511)-256)*(bone+1);
      } add(Math.trunc(sum/10));
    }
  } else if(kind===7) {
    const depth=new Uint32Array(128*128).fill(0xffffffff);
    for(let t=0;t<n;t++) {
      const x=sample(t*3)&95,y=sample(t*3+1)&95,s=sample(t*3+2)%24+4,z=sample(t+19)&65535;
      for(let dy=0;dy<s;dy++)for(let dx=0;dx<s-dy;dx++) {
        const p=(y+dy)*128+x+dx;depth[p]=Math.min(z,depth[p]);
      }
    } depth.forEach(add);
  } else if(kind===8) {
    for(let i=0;i<n;i++) {
      let x=sample(i*4)&65535,y=sample(i*4+1)&65535,vx=(sample(i*4+2)&255)-128,vy=(sample(i*4+3)&255)-128;
      for(let step=0;step<64;step++) {
        vy+=3;x+=vx;y+=vy;
        if(x<0){x=-x;vx=-vx;}if(x>65535){x=131070-x;vx=-vx;}
        if(y<0){y=-y;vy=-vy;}if(y>65535){y=131070-y;vy=-vy;}
      } add(x);add(y);
    }
  } else if(kind===9) {
    for(let batch=0;batch<n;batch++)for(let neuron=0;neuron<32;neuron++) {
      let sum=0;for(let k=0;k<64;k++)sum+=((sample(batch*64+k)&255)-128)*((sample(neuron*64+k+101)&255)-128);
      add(Math.max(0,sum));
    }
  } else if(kind===10) {
    for(let i=0;i<n;i++) {
      let sum=0;for(let tap=0;tap<32;tap++)sum+=((sample(i+tap)&65535)-32768)*((sample(tap+73)&127)-64);
      add(Math.trunc(sum/128));
    }
  } else if(kind===11) {
    const sum=new Uint32Array(256),count=new Uint32Array(256);
    for(let i=0;i<n;i++){const key=sample(i)&255,value=sample(i+5)&65535;if(value>=16384&&value<49152){sum[key]+=value;count[key]++;}}
    sum.forEach(add);count.forEach(add);
  } else if(kind===12) {
    for(let i=0;i<n;i++) {const x=sample(i*2)&1023,y=sample(i*2+1)&1023;
      const dot=768*x+512*y,cross=768*y-512*x;
      const far=dot>851968?(x-768)**2+(y-512)**2>1024:cross**2>1024*851968;
      if(far){add(x);add(y);}
    }
  } else if(kind===13) {
    let line=0,x=0;
    for(let word=0;word<n;word++) {
      let width=0;const len=sample(word)%12+1;
      for(let glyph=0;glyph<len;glyph++)width+=4+sample(word*12+glyph)%9;
      if(x && x+width>640){line++;x=0;}
      add(line);add(x);x+=width+4;
    } add(line);add(x);
  } else if(kind===14) {
    const distance=new Uint32Array(n*n).fill(0xffffffff),queue=[0];distance[0]=0;
    for(let head=0;head<queue.length;head++) {
      const p=queue[head],x=p%n,y=Math.floor(p/n);
      const neighbors=[];if(x>0)neighbors.push(p-1);if(x<n-1)neighbors.push(p+1);if(y>0)neighbors.push(p-n);if(y<n-1)neighbors.push(p+n);
      for(const q of neighbors)if(distance[q]===0xffffffff && (sample(q)%5!==0 || q===n*n-1)){distance[q]=distance[p]+1;queue.push(q);}
    } distance.forEach(add);
  } else if(kind>=15 && kind<15+extraReferences.length) return extraReferences[kind-15](n);
  else throw Error('Unknown kernel');
  return h;
}

function finish(values) { return values.reduce((h,x)=>Math.imul(h^x,16777619)>>>0,2166136261); }
function searchMatches(n) {const pattern=[0,1,0,1,0,2,0,1,0],text=Array.from({length:n},(_,i)=>i%97<9?pattern[i%97]:sample(i)&3),matches=[];for(let i=0;i+9<=n;i++)if(pattern.every((c,j)=>c===text[i+j]))matches.push(i);return matches;}
const extraReferences=[
  n=>{const out=[];for(let i=0;i<n;i++){const r=16+(sample(i+31)&63);out.push(Array.from({length:3},(_,d)=>(sample(i*3+d)&2047)-1024).every(v=>Math.abs(v)<=512+r)?1:0);}return finish(out);},
  n=>{const out=[];for(let i=0;i<n;i++){const intervals=Array.from({length:3},(_,d)=>{const lo=sample(i*6+d)&1023,hi=lo+32+(sample(i*6+d+3)&127),dir=1+(sample(i*3+d+71)&255);return [Math.floor(lo*65536/dir),Math.floor(hi*65536/dir)];});const near=Math.max(0,...intervals.map(t=>t[0]));out.push(Math.min(...intervals.map(t=>t[1]))>=near?1:0,near);}return finish(out);},
  n=>{const out=[];for(let i=0;i<n;i++)for(let j=0;j<=16;j++)for(let d=0;d<3;d++){let p=Array.from({length:4},(_,k)=>sample(i*12+3*k+d)&1023);const t=j/16;for(let level=3;level>0;level--)p=p.slice(0,level).map((x,k)=>(1-t)*x+t*p[k+1]);out.push(Math.floor(p[0]));}return finish(out);},
  n=>{let x1=0,x2=0,y1=0,y2=0;const out=[];for(let i=0;i<n;i++){const x=(sample(i)&32767)-16384,y=Math.trunc((32*x+64*x1+32*x2+192*y1-64*y2)/256);[x2,x1,y2,y1]=[x1,x,y1,y];out.push(y);}return finish(out);},
  n=>{const signal=Array.from({length:n},(_,i)=>(sample(i)&255)-128);return finish(Array.from({length:32},(_,k)=>signal.slice(k+1).reduce((v,x,i)=>v+x*signal[i],0)));},
  n=>{let predictor=0,step=16;const out=[];for(let i=0;i<n;i++){const x=(sample(i)&65535)-32768,q=Math.max(-8,Math.min(7,Math.trunc((x-predictor)/step)));predictor=Math.max(-32768,Math.min(32767,predictor+q*step));step=Math.max(1,step+(Math.abs(q)>3?2:-1));out.push(q&15);}return finish(out);},
  n=>{const memo=new Map();function evaluate(i){if(memo.has(i))return memo.get(i);let v=null;if(i%5!==0){if(i<2||i%3===0)v=sample(i)&255;else{const l=evaluate(i-1),r=evaluate(Math.floor(i/2));if(l!==null&&r!==null)v=i%3===1?(l+r)>>>0:Math.imul(l,r)>>>0;}}memo.set(i,v);return v;}const out=[];for(let i=0;i<n;i++){const v=evaluate(i);out.push(v===null?0:1,v??0);}return finish(out);},
  n=>{const live=new Set(),stack=[n-1,Math.floor(n/2)];while(stack.length){const i=stack.pop();if(live.has(i))continue;live.add(i);if(i)stack.push(Math.floor(i/2),sample(i)%i);}return finish([...live].sort((a,b)=>a-b));},
  n=>{const owners=Array(8).fill(null),assigned=Array(n),ends=Array.from({length:n},(_,i)=>i+1+sample(i)%16);for(let i=0;i<n;i++){for(let r=0;r<8;r++)if(owners[r]!==null&&ends[owners[r]]<=i)owners[r]=null;let reg=owners.indexOf(null);if(reg<0){const longest=owners.reduce((r,owner,j)=>ends[owner]>ends[owners[r]]?j:r,0);if(ends[i]<ends[owners[longest]]){assigned[owners[longest]]=8;reg=longest;}}assigned[i]=reg<0?8:reg;if(reg>=0)owners[reg]=i;}return finish(assigned);},
  n=>{const input=Array.from({length:n},(_,i)=>i%64<48?(Math.floor(i/64)&255):(sample(i)&255)),out=[];let start=0;while(start<n){let end=start+1;while(end<n&&input[end]===input[start]&&end-start<255)end++;out.push(end-start,input[start]);start=end;}return finish(out);},
  n=>{const dictionary=new Map(Array.from({length:256},(_,i)=>[String.fromCharCode(i),i]));let word=String.fromCharCode(sample(0)&15);const out=[];for(let i=1;i<n;i++){const c=String.fromCharCode(sample(i)&15),combined=word+c;if(dictionary.has(combined))word=combined;else{out.push(dictionary.get(word));if(dictionary.size<4096)dictionary.set(combined,dictionary.size);word=c;}}out.push(dictionary.get(word));return finish(out);},
  n=>{const hist=Array(256).fill(0);for(let i=0;i<n*n;i++)hist[sample(i)&255]++;const total=n*n,sum=hist.reduce((s,c,i)=>s+c*i,0);let best=0,bestScore=-1;for(let t=0;t<255;t++){const count=hist.slice(0,t+1).reduce((a,b)=>a+b,0),partial=hist.slice(0,t+1).reduce((a,c,i)=>a+c*i,0);if(count&&count<total){const delta=total*partial-sum*count,score=delta*delta/(count*(total-count));if(score>bestScore){bestScore=score;best=t;}}}return finish([best]);},
  n=>{const out=[];for(let y=0;y<n;y++)for(let x=0;x<n;x++){let hit=false;for(let yy=Math.max(0,y-1);yy<=Math.min(n-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(n-1,x+1);xx++)hit ||= (sample(yy*n+xx)&1)!==0;out.push(hit?1:0);}return finish(out);},
  n=>{const mask=Array.from({length:n*n},(_,i)=>(sample(i)&7)<2),labels=new Int32Array(n*n).fill(-1);for(let start=0;start<mask.length;start++)if(mask[start]&&labels[start]<0){const queue=[start];labels[start]=start;for(let head=0;head<queue.length;head++){const p=queue[head],x=p%n,y=Math.floor(p/n),neighbors=[];if(x)neighbors.push(p-1);if(x<n-1)neighbors.push(p+1);if(y)neighbors.push(p-n);if(y<n-1)neighbors.push(p+n);for(const q of neighbors)if(mask[q]&&labels[q]<0){labels[q]=start;queue.push(q);}}}const out=[];labels.forEach((v,i)=>{if(v>=0)out.push(i,v);});return finish(out);},
  n=>{const ring=[[0,-3],[1,-3],[2,-2],[3,-1],[3,0],[3,1],[2,2],[1,3],[0,3],[-1,3],[-2,2],[-3,1],[-3,0],[-3,-1],[-2,-2],[-1,-3]],out=[];for(let y=3;y<n-3;y++)for(let x=3;x<n-3;x++){const center=sample(y*n+x)&255,values=ring.map(([dx,dy])=>(sample((y+dy)*n+x+dx)&255)-center);const contiguous=sign=>{let run=0;for(let i=0;i<32;i++){run=sign*values[i%16]>20?run+1:0;if(run>=9)return true;}return false;};if(contiguous(1)||contiguous(-1))out.push(y*n+x);}return finish(out);},
  n=>{const distance=new Int32Array(n*n).fill(-1),queue=[];for(let i=0;i<n*n;i++)if((sample(i)&7)<2){distance[i]=0;queue.push(i);}for(let head=0;head<queue.length;head++){const p=queue[head],x=p%n,y=Math.floor(p/n),neighbors=[];if(x)neighbors.push(p-1);if(x<n-1)neighbors.push(p+1);if(y)neighbors.push(p-n);if(y<n-1)neighbors.push(p+n);for(const q of neighbors)if(distance[q]<0){distance[q]=distance[p]+1;queue.push(q);}}return finish([...distance]);},
  n=>{return finish(Array.from({length:n},(_,i)=>{const q=sample(i)%(3*n);return q%3===0?q/3:0xffffffff;}));},
  n=>{const out=[];for(let j=0;j<n;j++)for(let i=n-1;i>=0;i--)if(sample(i)%512===sample(j+5)%512)out.push(i,j);return finish(out);},
  n=>{const left=Array(256).fill(0),right=Array(256).fill(0),out=[];for(let i=0;i<n;i++){left[sample(i)%256]++;right[sample(i+53)%256]++;}for(let key=0;key<256;key++)if(left[key]&&right[key])out.push(key,left[key]*right[key]);return finish(out);},
  n=>{const words=new Uint32Array(Math.ceil(n/32));let total=0;for(let i=0;i<n;i++)if((sample(i)&255)>127&&(sample(i+17)&3)===0){words[Math.floor(i/32)]|=1<<(i%32);total++;}return finish([...words,total]);},
  n=>{const widths=Array.from({length:n},(_,i)=>4+sample(i)%24),memo=new Map();function cost(i){if(i===n)return 0;if(memo.has(i))return memo.get(i);let width=0,best=Infinity;for(let j=i;j<n;j++){width+=widths[j]+(j>i?1:0);if(width>80)break;best=Math.min(best,(j===n-1?0:(80-width)**2)+cost(j+1));}memo.set(i,best);return best;}return finish([cost(0)]);},
  n=>{const table=Array.from({length:n+1},(_,i)=>Array(n+1).fill(i));for(let j=0;j<=n;j++)table[0][j]=j;for(let i=1;i<=n;i++)for(let j=1;j<=n;j++)table[i][j]=Math.min(table[i-1][j]+1,table[i][j-1]+1,table[i-1][j-1]+((sample(i-1)&15)===(sample(j+51)&15)?0:1));return finish([table[n][n]]);},
  n=>{const glyphs=Array.from({length:n},(_,i)=>sample(i)&255),out=[];let x=0;glyphs.forEach((g,i)=>{x+=i?(sample(glyphs[i-1]*256+g)&7)-3:0;out.push(x);x+=4+g%13;});out.push(x);return finish(out);},
  n=>{let order=Array.from({length:n},(_,i)=>i);const levels=order.map(i=>sample(i)%4);for(let level=3;level>=1;level--){const next=[];let i=0;while(i<n){let end=i+1;if(levels[i]>=level){while(end<n&&levels[end]>=level)end++;next.push(...order.slice(i,end).reverse());}else next.push(order[i]);i=end;}order=next;}return finish(order);},
  n=>{const blocks=Array.from({length:n},(_,i)=>20+sample(i)%181).sort((a,b)=>b-a),pages=[];for(const block of blocks){let i=pages.findIndex(height=>height+block<=800);if(i<0){i=pages.length;pages.push(0);}pages[i]+=block;}return finish([pages.length,...pages]);},
  n=>{const out=[];for(let row=0;row<n;row++){const parts=Array.from({length:8},(_,j)=>{const k=sample(row*8+j)%4;return k===0?'.':k===1?'..':String.fromCharCode(65+sample(row*8+j+999)%26);});for(const ch of posix.normalize('/'+parts.join('/')))out.push(ch.charCodeAt(0));}return finish(out);},
  n=>{const out=[];let gear=0,start=0;for(let i=0;i<n;i++){gear=(gear*2+sample((sample(i)&255)+1000))>>>0;const length=i+1-start;if(length>=32&&(!(gear&255)||length>=1024)){out.push(i+1);start=i+1;gear=0;}}if(start<n)out.push(n);return finish(out);},
  n=>{function node(start,size){if(size===1)return finish(Array.from({length:16},(_,j)=>sample(start*16+j)));const half=size/2;return finish([node(start,half),node(start+half,half)]);}return finish([node(0,n)]);},
  n=>{const out=[];for(let row=0;row<n;row++){const name=Array.from({length:24},(_,i)=>String.fromCharCode(65+(sample(row*24+i)&3))).join('');if(/^.*A.B.*$/.test(name))out.push(row);}return finish(out);},
  n=>{const prefixes=new Map([['',0]]),nodes=[[0,0,0,0,0]];for(let row=0;row<n;row++){let prefix='',parent=0;for(let j=0;j<8;j++){const c=sample(row*8+j)&3;prefix+=String(c);if(!prefixes.has(prefix)){prefixes.set(prefix,nodes.length);nodes.push([0,0,0,0,0]);}const child=prefixes.get(prefix);nodes[parent][c]=child;parent=child;}nodes[parent][4]=1;}return finish([nodes.length,...nodes.flat()]);},
  n=>{const out=[];for(let i=0;i<n;i++){const m1=1+sample(i*4)%16,m2=1+sample(i*4+1)%16,v1=(sample(i*4+2)&255)-128,v2=(sample(i*4+3)&255)-128;out.push(Math.trunc(((m1-m2)*v1+2*m2*v2)/(m1+m2)),Math.trunc(((m2-m1)*v2+2*m1*v1)/(m1+m2)));}return finish(out);},
  n=>{const p=Array.from({length:n},(_,i)=>[sample(2*i)&1023,sample(2*i+1)&1023]),out=[];for(let i=0;i<n;i++){const neighbors=p.map(([x,y],j)=>[x-p[i][0],y-p[i][1],j]).filter(([x,y,j])=>j!==i&&x*x+y*y<16384);for(let d=0;d<2;d++)out.push(neighbors.length?Math.trunc(neighbors.reduce((s,v)=>s+v[d],0)/neighbors.length)-neighbors.filter(([x,y])=>x*x+y*y<1024).reduce((s,v)=>s+v[d],0):0);}return finish(out);},
  n=>{const cells=Array.from({length:256},()=>[]),out=[];for(let i=0;i<n;i++){const x=Math.floor((sample(2*i)&1023)/64),y=Math.floor((sample(2*i+1)&1023)/64);cells[y*16+x].unshift(i);}for(const cell of cells)for(let i=0;i<cell.length;i++)for(let j=i+1;j<cell.length;j++)out.push(cell[i],cell[j]);return finish(out);},
  n=>{let cells=Array.from({length:n*n},(_,i)=>sample(i)&1);for(let step=0;step<8;step++)cells=cells.map((alive,p)=>{const x=p%n,y=Math.floor(p/n);let count=0;for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)if(xx||yy)count+=cells[((y+n+yy)%n)*n+(x+n+xx)%n];return count===3||!!alive&&count===2?1:0;});return finish(cells);},
  n=>{const polygon=[[100,100],[500,50],[900,150],[850,600],[700,900],[400,850],[150,700],[50,400]],out=[];for(let q=0;q<n;q++){const x=sample(2*q)&1023,y=sample(2*q+1)&1023;let crossings=0;polygon.forEach(([x1,y1],i)=>{const [x2,y2]=polygon[(i+1)%8];if((y1>y)!==(y2>y)&&x<x1+(x2-x1)*(y-y1)/(y2-y1))crossings++;});out.push(crossings%2);}return finish(out);},
  n=>{const points=Array.from({length:n},(_,i)=>[sample(2*i)&1023,sample(2*i+1)&1023]);const start=points.reduce((p,q)=>q[0]<p[0]||q[0]===p[0]&&q[1]<p[1]?q:p),hull=[];let p=start;do{hull.push(...p);let q=points.find(v=>v!==p);for(const r of points){const cross=(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]),dq=(q[0]-p[0])**2+(q[1]-p[1])**2,dr=(r[0]-p[0])**2+(r[1]-p[1])**2;if(cross<0||cross===0&&dr>dq)q=r;}p=q;}while(p!==start);return finish(hull);},
  n=>{const out=[];for(let row=0;row<n;row++){const cx=sample(row*3)&1023,cy=sample(row*3+1)&1023,r=20+sample(row*3+2)%100;let poly=[[cx-r,cy],[cx,cy-r],[cx+r,cy],[cx,cy+r]];for(let plane=0;plane<4&&poly.length;plane++){const axis=Math.floor(plane/2),boundary=plane%2?768:256,inside=p=>plane%2?p[axis]<=boundary:p[axis]>=boundary;const next=[];poly.forEach((p,i)=>{const previous=poly[(i+poly.length-1)%poly.length];if(inside(p)!==inside(previous)){const other=1-axis,q=[];q[axis]=boundary;q[other]=previous[other]+Math.trunc((p[other]-previous[other])*(boundary-previous[axis])/(p[axis]-previous[axis]));next.push(q);}if(inside(p))next.push(p);});poly=next;}out.push(poly.length,...poly.flat());}return finish(out);},
  n=>{const p=Array.from({length:n},(_,i)=>[4*i,8*(i%64<32?i%64:64-i%64)+(sample(i)&7)]),keep=new Set([0,n-1]);function split(first,last){const dx=p[last][0]-p[first][0],dy=p[last][1]-p[first][1];let maximum=0,best=first;for(let i=first+1;i<last;i++){const d=Math.abs(dx*(p[i][1]-p[first][1])-dy*(p[i][0]-p[first][0]));if(d>maximum){maximum=d;best=i;}}if(best!==first&&maximum**2>64*(dx*dx+dy*dy)){keep.add(best);split(first,best);split(best,last);}}split(0,n-1);return finish([...keep].sort((a,b)=>a-b));},
  n=>{return finish(Array.from({length:n},(_,i)=>{const x=(sample(2*i)&65535).toString(2).padStart(16,'0'),y=(sample(2*i+1)&65535).toString(2).padStart(16,'0');return parseInt([...x].map((bit,j)=>bit+y[j]).join(''),2);}));},
  n=>{const image=new Uint32Array(128*128);for(let i=0;i<n;i++){let x=sample(i*4)&127,y=sample(i*4+1)&127;const x1=sample(i*4+2)&127,y1=sample(i*4+3)&127,dx=Math.abs(x1-x),dy=-Math.abs(y1-y),sx=x<x1?1:-1,sy=y<y1?1:-1;let error=dx+dy;while(true){image[y*128+x]++;if(x===x1&&y===y1)break;const twice=2*error;if(twice>=dy){error+=dy;x+=sx;}if(twice<=dx){error+=dx;y+=sy;}}}return finish([...image]);},
  n=>{return finish(Array.from({length:n},(_,i)=>{const x=sample(i)&255,l=i>=4?sample(i-4)&255:0,u=sample(i+71)&255,ul=i>=4?sample(i+67)&255:0,p=l+u-ul;const choices=[[Math.abs(p-l),l],[Math.abs(p-u),u],[Math.abs(p-ul),ul]].sort((a,b)=>a[0]-b[0]);return (x-choices[0][1])&255;}));},
  n=>{function multiply(x,y){let polynomial=0;for(let i=0;i<8;i++)if(y&(1<<i))polynomial^=x<<i;for(let bit=14;bit>=8;bit--)if(polynomial&(1<<bit))polynomial^=0x11d<<(bit-8);return polynomial;}const out=[];for(let row=0;row<n;row++){const coefficients=Array(15).fill(0);for(let i=0;i<8;i++)for(let j=0;j<8;j++)coefficients[i+j]^=multiply(sample(row*16+i)&255,sample(row*16+8+j)&255);out.push(...coefficients);}return finish(out);},
  n=>{const covers=Array.from({length:81},(_,code)=>{const digits=Array.from({length:4},(_,j)=>Math.floor(code/3**j)%3);let mask=0;for(let value=0;value<16;value++)if(digits.every((d,j)=>d===2||d===((value>>j)&1)))mask|=1<<value;return mask;});const out=[];for(let row=0;row<n;row++){const truth=sample(row)&65535,valid=covers.filter(c=>(c&~truth)===0);out.push(...valid.filter(c=>!valid.some(other=>other!==c&&(c&~other)===0)));}return finish(out);},
  n=>{const out=[];for(let row=0;row<n;row++)for(let mask=0;mask<256;mask++){let parity=0,sub=mask;while(true){parity^=sample(row*256+sub)&1;if(sub===0)break;sub=(sub-1)&mask;}if(parity)out.push(mask);}return finish(out);},
  n=>{const out=[];for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){const values=[];for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)values.push(sample((y+yy)*n+x+xx)&255);out.push(values.sort((a,b)=>a-b)[4]);}return finish(out);},
  n=>{const image=Array.from({length:n*n},(_,i)=>16*(sample(i)&255)),out=[];for(let y=0;y<n;y++)for(let x=0;x<n;x++){const p=y*n+x,value=image[p]>=2048?4080:0,error=image[p]-value;out.push(value/16);for(const [dx,dy,weight]of [[1,0,7],[-1,1,3],[0,1,5],[1,1,1]])if(x+dx>=0&&x+dx<n&&y+dy<n)image[(y+dy)*n+x+dx]+=Math.trunc(error*weight/16);}return finish(out);},
  n=>{const out=[];for(let i=0;i<n;i++){const [r,g,b]=[0,1,2].map(j=>sample(3*i+j)&255),co=r-b,t=b+Math.floor(co/2),cg=g-t;out.push(t+Math.floor(cg/2),co,cg);}return finish(out);},
  n=>{const distance=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?0:1+sample(i*n+j)%16));for(let k=0;k<n;k++)for(let i=0;i<n;i++)for(let j=0;j<n;j++)distance[i][j]=Math.min(distance[i][j],distance[i][k]+distance[k][j]);return finish(distance[0]);},
  n=>{const bytes=[];for(let i=0;i<n;i++){const v=sample(i)&65535;if(v<=127)bytes.push(v);else if(v<=255)bytes.push(204,v);else bytes.push(205,...new Uint8Array([Math.floor(v/256),v%256]));}return finish(bytes);},
  n=>{return finish(Array.from({length:n},(_,i)=>sample(i)&0xfffffff));},
  n=>{return finish(Array.from({length:n},(_,i)=>{const x=10+sample(2*i)%90,y=10+sample(2*i+1)%90;return i%3===0?x+y:i%3===1?x*y:x^y;}));},
  n=>{return finish(Array(n).fill(65));},
  n=>{const r=Array.from({length:8},(_,i)=>i);let executed=0;for(let pc=0;pc<n;pc++){const code=sample(pc)&65535,d=(code>>3)&7,s=(code>>6)&7,imm=code>>9;executed++;switch(code&7){case 0:r[d]=(r[d]+imm)>>>0;break;case 1:r[d]=Math.imul(r[d],imm|1)>>>0;break;case 2:r[d]=(r[d]^r[s])>>>0;break;case 3:r[d]=((r[d]<<1)|(r[d]>>>31))>>>0;break;case 4:r[d]=sample(r[s]%n+17);break;case 5:if(r[d]&1)pc++;break;case 6:r[d]=(r[d]-r[s])>>>0;break;case 7:r[d]=imm;}}return finish([...r,executed]);},
  n=>{const weights=[[-1,2,-1],[2,4,2],[-1,2,-1]],out=[];for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){let v=0;weights.forEach((row,yy)=>row.forEach((w,xx)=>{v+=((sample((y+yy-1)*n+x+xx-1)&255)-128)*w;}));out.push(Math.max(0,v));}return finish(out);},
  n=>{const out=[];for(let y=0;y<n;y+=2)for(let x=0;x<n;x+=2)out.push(Math.max(...[[x,y],[x+1,y],[x,y+1],[x+1,y+1]].map(([xx,yy])=>sample(yy*n+xx)&255)));return finish(out);},
  n=>{const out=[];for(let row=0;row<n;row++){const input=Array.from({length:8},(_,f)=>sample(row*8+f)&255);function classify(node,depth){if(depth===8)return node-255;return classify(node*2+1+(input[node%8]>(sample(node+71)&255)?1:0),depth+1);}out.push(classify(0,0));}return finish(out);},
  n=>{const out=[];for(let row=0;row<n;row++){const nearest=Array.from({length:32},(_,i)=>({i,d:Array.from({length:8},(_,k)=>(sample(row*8+k)&255)-(sample(i*8+k+1001)&255)).reduce((s,d)=>s+d*d,0)})).sort((a,b)=>a.d-b.d||a.i-b.i).slice(0,5),votes=Array(4).fill(0);nearest.forEach(p=>votes[p.i%4]++);out.push(votes.indexOf(Math.max(...votes)));}return finish(out);},
  n=>{const points=Array.from({length:n},(_,i)=>[sample(2*i)&1023,sample(2*i+1)&1023]);let centers=points.slice(0,8).map(p=>[...p]),labels;for(let step=0;step<5;step++){const groups=Array.from({length:8},()=>[]);labels=points.map(p=>{const distances=centers.map(c=>(p[0]-c[0])**2+(p[1]-c[1])**2),k=distances.indexOf(Math.min(...distances));groups[k].push(p);return k;});centers=groups.map((g,k)=>g.length?[0,1].map(d=>Math.floor(g.reduce((s,p)=>s+p[d],0)/g.length)):centers[k]);}return finish([...centers.flat(),...labels]);},
  n=>{return finish(Array.from({length:n},(_,i)=>Math.floor(Math.sqrt(1+(sample(i)&0xffffff)))));},
  n=>{function gcd(x,y){return y?gcd(y,x%y):x;}return finish(Array.from({length:n},(_,i)=>gcd(1+(sample(2*i)&65535),1+(sample(2*i+1)&65535))));},
  n=>{const table=Array.from({length:16},(_,i)=>Math.round(Math.atan(2**-i)*65536)),out=[];for(let i=0;i<n;i++){let x=39797,y=0,z=(sample(i)&131071)-65536;table.forEach((angle,j)=>{const direction=z>=0?1:-1,xx=x-direction*Math.floor(y/2**j),yy=y+direction*Math.floor(x/2**j);x=xx;y=yy;z-=direction*angle;});out.push(x,y);}return finish(out);},
  n=>{return finish([Math.floor(n**3/3+3*n*n/2+n)]);},
  n=>{return finish(searchMatches(n));},
  n=>{return finish(searchMatches(n));},
  n=>{return finish(searchMatches(n));},
  n=>{const patterns=Array.from({length:8},(_,p)=>Array.from({length:6},(_,j)=>sample(p*6+j)&3)),out=[];for(let end=5;end<n;end++)patterns.forEach((pattern,p)=>{if(pattern.every((c,j)=>c===(sample(end-5+j)&3)))out.push(end-5,p);});return finish(out);},
  n=>{const values=[...new Set(Array.from({length:128},(_,i)=>sample(i)&65535))];return finish(Array.from({length:n},(_,i)=>values.filter(v=>((v^(sample(i+31)&65535))>>>0).toString(2).replaceAll('0','').length<=2).length));},
  n=>{const values=Array.from({length:n},(_,i)=>sample(i)&65535).sort((a,b)=>a-b);return finish([values[Math.floor(n/2)]]);},
  n=>{let mean=0,m2=0;for(let i=0;i<n;i++){const x=(sample(i)&31)*256,d=x-mean;mean+=Math.trunc(d/(i+1));m2+=d*(x-mean);}return finish([mean,m2>>>0]);},
  n=>{const x=Array.from({length:n},(_,i)=>sample(2*i)&1023),y=Array.from({length:n},(_,i)=>sample(2*i+1)&1023);const sx=x.reduce((a,b)=>a+b),sy=y.reduce((a,b)=>a+b),mx=sx/n,my=sy/n;let sxx=0,sxy=0;for(let i=0;i<n;i++){sxx+=x[i]*x[i];sxy+=x[i]*y[i];}const slope=Math.trunc((n*sxy-sx*sy)*256/(n*sxx-sx*sx)),intercept=Math.trunc((sy*256-slope*sx)/n);return finish([slope,intercept]);},
  n=>{const counts=Array(32).fill(0);for(let i=0;i<n;i++)counts[sample(i)&31]++;return finish([65536-Math.floor(counts.reduce((s,c)=>s+c*c,0)*65536/(n*n))]);},
  n=>{const input=Array.from({length:n},(_,i)=>sample(i)&255);return finish(Array.from({length:64},(_,r)=>Math.floor(Array.from({length:n},(_,i)=>input[sample(r*n+i+71)%n]).reduce((s,x)=>s+x,0)*256/n)));},
  n=>{const c=Array.from({length:8},(_,u)=>Array.from({length:8},(_,x)=>Math.round(1024*Math.cos((2*x+1)*u*Math.PI/16)))),out=[];for(let block=0;block<n;block++)for(let v=0;v<8;v++)for(let u=0;u<8;u++){let sum=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++)sum+=((sample(block*64+y*8+x)&255)-128)*c[u][x]*c[v][y];out.push(Math.trunc(sum/1048576));}return finish(out);},
  n=>{const y=[],u=[],v=[],out=[];for(let i=0;i<n*n;i++){const [r,g,b]=[0,1,2].map(j=>sample(3*i+j)&255);y.push(Math.floor((66*r+129*g+25*b+128)/256)+16);u.push(Math.floor((-38*r-74*g+112*b+128)/256)+128);v.push(Math.floor((112*r-94*g-18*b+128)/256)+128);}out.push(...y);for(let yy=0;yy<n;yy+=2)for(let x=0;x<n;x+=2){const indices=[yy*n+x,yy*n+x+1,(yy+1)*n+x,(yy+1)*n+x+1];out.push(Math.floor((indices.reduce((s,i)=>s+u[i],0)+2)/4),Math.floor((indices.reduce((s,i)=>s+v[i],0)+2)/4));}return finish(out);},
  n=>{const input=Array.from({length:n*n},(_,i)=>sample(i)&255),output=[...input];for(let y=0;y<n;y++)for(let x=8;x<n;x+=8){const p=y*n+x,l=input[p-1],r=input[p];if(Math.abs(l-r)<48){output[p-1]=Math.floor((3*l+r+2)/4);output[p]=Math.floor((l+3*r+2)/4);}}return finish(output);},
  n=>{return finish(Array.from({length:n*n},(_,i)=>{let value=sample(i)&255;for(let frame=1;frame<10;frame++)value=Math.floor((3*value+(sample(frame*n*n+i)&255))/4);return value;}));},
  n=>{const out=[];for(let y=2;y<n-2;y+=3)for(let x=2;x<n-2;x+=3){const gradients=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const p=(y+dy)*n+x+dx;gradients.push([(sample(p+1)&255)-(sample(p-1)&255),(sample(p+n)&255)-(sample(p-n)&255),(sample(p+17)&255)-(sample(p)&255)]);}const dot=(i,j)=>gradients.reduce((sum,g)=>sum+g[i]*g[j],0),aa=dot(0,0),ab=dot(0,1),bb=dot(1,1),at=dot(0,2),bt=dot(1,2),det=aa*bb-ab*ab;out.push(det?Math.trunc((ab*bt-bb*at)*64/det):0,det?Math.trunc((ab*at-aa*bt)*64/det):0);}return finish(out);}
];

extraReferences.push(
n=>{const chosen=new Set([0]);let sum=0;while(chosen.size<n){let best=null;for(const u of chosen)for(let v=0;v<n;v++)if(!chosen.has(v)){const w=1+sample(Math.min(u,v)*n+Math.max(u,v))%1024;if(!best||w<best.w)best={v,w};}chosen.add(best.v);sum+=best.w;}return finish([sum]);},
n=>{const key=Buffer.from(Array.from({length:16},(_,i)=>sample(i+1000)&255)),input=Buffer.from(Array.from({length:16*n},(_,i)=>sample(i)&255)),cipher=createCipheriv('aes-128-ecb',key,null);cipher.setAutoPadding(false);return finish([...Buffer.concat([cipher.update(input),cipher.final()])]);},
n=>{return finish([crc32(Buffer.from(Array.from({length:n},(_,i)=>sample(i)&255)))]);}
);

extraReferences.push(
n=>{const velocities=[[0,0],[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[-1,-1],[1,-1]],weights=[4/9,1/9,1/9,1/9,1/9,1/36,1/36,1/36,1/36];let grid=Array.from({length:n*n},(_,p)=>Array.from({length:9},(_,d)=>1+(sample(9*p+d)&31)));for(let step=0;step<10;step++){const next=Array.from({length:n*n},()=>Array(9));for(let y=0;y<n;y++)for(let x=0;x<n;x++){const f=grid[y*n+x];let density=0,ux=0,uy=0;for(let d=0;d<9;d++){density+=f[d];ux+=f[d]*velocities[d][0];uy+=f[d]*velocities[d][1];}ux/=density;uy/=density;velocities.forEach(([cx,cy],d)=>{const cu=cx*ux+cy*uy,eq=weights[d]*density*(1+3*cu+4.5*cu*cu-1.5*(ux*ux+uy*uy));next[((y+n+cy)%n)*n+(x+n+cx)%n][d]=(f[d]+eq)*0.5;});}grid=next;}return finish(grid.flat().map(v=>Math.floor(v*1024)));},
n=>{let previous=Array.from({length:n*n},(_,i)=>(sample(i)&31)-16),current=[...previous];for(let step=0;step<8;step++){const next=current.map((v,p)=>{const x=p%n,y=Math.floor(p/n),lap=current[y*n+(x+n-1)%n]+current[y*n+(x+1)%n]+current[((y+n-1)%n)*n+x]+current[((y+1)%n)*n+x]-4*v;return 2*v-previous[p]+Math.trunc(lap/4);});previous=current;current=next;}return finish(current);}
);
