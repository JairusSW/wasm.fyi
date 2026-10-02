/* Original portable CPU kernels. MIT; see ../LICENSE. All inputs regenerated
 * on every invocation. Unsigned arithmetic wraps; integer output is exact. */
typedef unsigned int u32;
typedef unsigned long long u64;
typedef unsigned char u8;
static u32 a[512*512], b[512*512];
static u32 sample(u32 i) { u32 x=i+0x9e3779b9u; x^=x>>16; x*=0x85ebca6bu; x^=x>>13; return x; }
static u32 hash(u32 h,u32 x) { return (h^x)*16777619u; }
u32 benchmark(u32 n) {
  u32 h=2166136261u;
#if KIND <= 5
  for(u32 i=0;i<n*n;i++) a[i]=sample(i)&255u;
#endif
#if KIND == 1 /* 3x3 Gaussian blur; clamped edges. */
  for(u32 y=0;y<n;y++) for(u32 x=0;x<n;x++) {
    u32 v=0;
    for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++) {
      int yy=(int)y+dy,xx=(int)x+dx;
      if(yy<0)yy=0;if(xx<0)xx=0;if(yy>=(int)n)yy=n-1;if(xx>=(int)n)xx=n-1;
      v+=a[(u32)yy*n+(u32)xx]*(dy==0?2u:1u)*(dx==0?2u:1u);
    }
    b[y*n+x]=v/16;
  }
  for(u32 i=0;i<n*n;i++) h=hash(h,b[i]);
#elif KIND == 2 /* Half-size bilinear resampling at pixel centers. */
  for(u32 y=0;y<n;y+=2) for(u32 x=0;x<n;x+=2)
    h=hash(h,(a[y*n+x]+a[y*n+x+1]+a[(y+1)*n+x]+a[(y+1)*n+x+1]+2)/4);
#elif KIND == 3 /* Alpha blend, then integer luminance/color adjustment. */
  for(u32 i=0;i<n*n;i++) { u32 alpha=sample(i+17)&255u, back=sample(i+31)&255u;
    u32 v=(a[i]*alpha+back*(255-alpha)+127)/255; v=(v*9)/8; h=hash(h,v>255?255:v); }
#elif KIND == 4 /* Sobel edges / computer vision gradient magnitude. */
  for(u32 y=1;y+1<n;y++) for(u32 x=1;x+1<n;x++) {
    int gx=-(int)a[(y-1)*n+x-1]+(int)a[(y-1)*n+x+1]-2*(int)a[y*n+x-1]+2*(int)a[y*n+x+1]-(int)a[(y+1)*n+x-1]+(int)a[(y+1)*n+x+1];
    int gy=-(int)a[(y-1)*n+x-1]-2*(int)a[(y-1)*n+x]-(int)a[(y-1)*n+x+1]+(int)a[(y+1)*n+x-1]+2*(int)a[(y+1)*n+x]+(int)a[(y+1)*n+x+1];
    h=hash(h,(u32)(gx<0?-gx:gx)+(u32)(gy<0?-gy:gy));
  }
#elif KIND == 5 /* Block motion estimation; 5x5 search, 8x8 SAD. */
  for(u32 i=0;i<n*n;i++) b[i]=sample((i+n+1)%(n*n))&255u;
  for(u32 y=2;y+10<n;y+=8) for(u32 x=2;x+10<n;x+=8) {
    u32 best=~0u,index=0;
    for(int dy=-2;dy<=2;dy++) for(int dx=-2;dx<=2;dx++) {
      u32 sad=0;for(u32 yy=0;yy<8;yy++)for(u32 xx=0;xx<8;xx++) {
        int d=(int)a[(y+yy)*n+x+xx]-(int)b[(y+yy+dy)*n+x+xx+dx]; sad+=(u32)(d<0?-d:d); }
      if(sad<best){best=sad;index=(u32)((dy+2)*5+dx+2);}
    } h=hash(hash(h,best),index);
  }
#elif KIND == 6 /* Fixed-point 3D skeletal skinning, four bone influences. */
  for(u32 i=0;i<n;i++) for(u32 row=0;row<3;row++) {
    int out=0;for(u32 bone=0;bone<4;bone++) {
      int v=0;for(u32 col=0;col<3;col++) v+=((int)(sample(i*3+col)&1023u)-512)*((int)(sample(bone*12+row*4+col)&127u)-64);
      v+=(int)(sample(bone*12+row*4+3)&511u)-256;
      out+=v*(int)(bone+1);
    } h=hash(h,(u32)(out/10));
  }
#elif KIND == 7 /* Software triangle rasterizer with depth test. */
  for(u32 i=0;i<128*128;i++) a[i]=~0u;
  for(u32 t=0;t<n;t++) {
    int x=(int)(sample(t*3)&95u),y=(int)(sample(t*3+1)&95u),s=(int)(sample(t*3+2)%24)+4;
    u32 z=sample(t+19)&65535u;
    for(int yy=y;yy<y+s;yy++)for(int xx=x;xx<x+s;xx++) if((xx-x)+(yy-y)<s) {
      u32 p=(u32)(yy*128+xx);if(z<a[p])a[p]=z;
    }
  } for(u32 i=0;i<128*128;i++)h=hash(h,a[i]);
#elif KIND == 8 /* Particle simulation: gravity, integration, wall collision. */
  for(u32 i=0;i<n;i++) {
    int x=(int)(sample(i*4)&65535u),y=(int)(sample(i*4+1)&65535u);
    int vx=(int)(sample(i*4+2)&255u)-128,vy=(int)(sample(i*4+3)&255u)-128;
    for(int step=0;step<64;step++) {vy+=3;x+=vx;y+=vy;
      if(x<0){x=-x;vx=-vx;}if(x>65535){x=131070-x;vx=-vx;}
      if(y<0){y=-y;vy=-vy;}if(y>65535){y=131070-y;vy=-vy;}}
    h=hash(hash(h,(u32)x),(u32)y);
  }
#elif KIND == 9 /* Int8 fully connected inference: 64 inputs, 32 ReLU outputs. */
  for(u32 i=0;i<n*64;i++)a[i]=sample(i)&255u;
  for(u32 i=0;i<32*64;i++)b[i]=sample(i+101)&255u;
  for(u32 batch=0;batch<n;batch++) for(u32 neuron=0;neuron<32;neuron++) {
    int v=0;for(u32 k=0;k<64;k++)v+=((int)a[batch*64+k]-128)*((int)b[neuron*64+k]-128);
    h=hash(h,(u32)(v<0?0:v));
  }
#elif KIND == 10 /* Audio 32-tap integer FIR filtering. */
  for(u32 i=0;i<n+31;i++)a[i]=sample(i)&65535u;
  for(u32 tap=0;tap<32;tap++)b[tap]=sample(tap+73)&127u;
  for(u32 i=0;i<n;i++) {int v=0;for(u32 tap=0;tap<32;tap++)
    v+=((int)a[i+tap]-32768)*((int)b[tap]-64);
    h=hash(h,(u32)(v/128));}
#elif KIND == 11 /* Columnar WHERE + GROUP BY SUM/COUNT, 256 groups. */
  for(u32 i=0;i<512;i++)a[i]=0;
  for(u32 i=0;i<n;i++){u32 key=sample(i)&255u,value=sample(i+5)&65535u;
    if(value>=16384 && value<49152){a[key]+=value;a[256+key]++;}}
  for(u32 i=0;i<512;i++)h=hash(h,a[i]);
#elif KIND == 12 /* Map geometry point-to-segment distance threshold. */
  for(u32 i=0;i<n;i++) {int x=(int)(sample(i*2)&1023u),y=(int)(sample(i*2+1)&1023u);
    int cross=768*y-512*x;u32 d=(u32)(cross<0?-cross:cross);
    u32 dot=(u32)(768*x+512*y),far;
    if(dot>851968u){int dx=x-768,dy=y-512;far=(u32)(dx*dx+dy*dy)>1024u;}
    else far=(u64)d*d>(u64)1024*851968;
    if(far)h=hash(hash(h,(u32)x),(u32)y);}
#elif KIND == 13 /* Proportional glyph layout with greedy word line breaking. */
  u32 line=0,x=0;
  for(u32 word=0;word<n;word++) {
    u32 width=0,len=sample(word)%12+1;
    for(u32 glyph=0;glyph<len;glyph++)width+=4+(sample(word*12+glyph)%9);
    if(x && x+width>640){line++;x=0;}
    h=hash(hash(h,line),x);x+=width+4;
  }
  h=hash(hash(h,line),x);
#elif KIND == 14 /* Game grid shortest paths, seeded obstacles and FIFO BFS. */
  for(u32 i=0;i<n*n;i++)a[i]=~0u;
  u32 head=0,tail=1;b[0]=0;a[0]=0;
  while(head<tail) {
    u32 p=b[head++],x=p%n,y=p/n;
    u32 next[4]={x?p-1:p,x+1<n?p+1:p,y?p-n:p,y+1<n?p+n:p};
    for(u32 j=0;j<4;j++) {u32 q=next[j];
      if(a[q]==~0u && (sample(q)%5!=0 || q==n*n-1)) {a[q]=a[p]+1;b[tail++]=q;}}
  }
  for(u32 i=0;i<n*n;i++)h=hash(h,a[i]);
#else
#error Unknown corpus kernel kind
#endif
  return h;
}
