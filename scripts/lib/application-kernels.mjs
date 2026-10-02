// Independent JavaScript result oracle; not generated from Wasm output.
export const kernels = [
  ['image-blur', 'Image editing', '3×3 Gaussian blur with clamped image borders', [64,192,512], 'pixels', n=>n*n],
  ['image-resize', 'Image editing', 'Bilinear image downsampling at pixel centers', [64,192,512], 'output_pixels', n=>n*n/4],
  ['image-composite', 'Image editing', 'Alpha compositing and clamped color adjustment', [64,192,512], 'pixels', n=>n*n],
  ['vision-sobel', 'Computer vision', 'Sobel horizontal/vertical edges and gradient magnitude', [64,192,512], 'interior_pixels', n=>(n-2)**2],
  ['video-motion', 'Video processing', '8×8 block motion estimation over a 5×5 displacement search', [64,192,512], 'blocks', n=>Math.ceil((n-12)/8)**2],
  ['mesh-skinning', '3D & rendering', 'Fixed-point skeletal skinning with four bone influences and 3×4 matrices', [256,4096,32768], 'vertices', n=>n],
  ['triangle-raster', '3D & rendering', 'CPU triangle coverage rasterization into a 128×128 depth buffer', [64,512,4096], 'triangles', n=>n],
  ['particle-physics', 'Games & physics', '64 simulation steps of particle integration, gravity and reflecting wall collisions', [256,4096,32768], 'particle_steps', n=>n*64],
  ['ml-inference', 'Machine learning', 'Int8 dense inference: 64 input channels, 32 outputs, ReLU activation', [1,16,128], 'multiply_accumulates', n=>n*64*32],
  ['audio-fir', 'Audio', '32-tap fixed-point FIR audio filtering', [256,4096,32768], 'samples', n=>n],
  ['columnar-query', 'Databases & analytics', 'Columnar range filter with grouped SUM and COUNT over 256 keys', [1024,16384,131072], 'rows', n=>n],
  ['map-point-segment', 'Geospatial', 'Map geometry classification by exact squared distance to a finite line segment', [1024,16384,131072], 'points', n=>n],
  ['document-layout', 'Documents & layout', 'Proportional glyph advances and greedy word line breaking into 640-unit lines', [1024,16384,131072], 'words', n=>n],
  ['grid-pathfinding', 'Games & physics', 'Four-neighbor breadth-first shortest paths over a seeded obstacle grid', [32,96,256], 'cells', n=>n*n],
].map(([id,category,description,sizes,unit,units],i)=>({id,category,description,sizes,unit,units,kind:i+1}));
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
  } else throw Error('Unknown kernel');
  return h;
}
