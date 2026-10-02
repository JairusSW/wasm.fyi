/* Original portable CPU kernels. MIT; see ../LICENSE. All inputs regenerated
 * on every invocation. Unsigned arithmetic wraps; integer output is exact. */
typedef unsigned int u32;
typedef unsigned long long u64;
typedef unsigned char u8;
/* Freestanding lowering for aggregate initialization; volatile prevents
 * LLVM from recursively lowering these definitions back to libc calls. */
void *memset(void *destination,int byte,unsigned long length){volatile u8 *p=(volatile u8*)destination;for(unsigned long i=0;i<length;i++)p[i]=(u8)byte;return destination;}
void *memcpy(void *destination,const void *source,unsigned long length){volatile u8 *p=(volatile u8*)destination;const volatile u8 *q=(const volatile u8*)source;for(unsigned long i=0;i<length;i++)p[i]=q[i];return destination;}
static u32 a[65536], b[65536];
static u32 sample(u32 i) { u32 x=i+0x9e3779b9u; x^=x>>16; x*=0x85ebca6bu; x^=x>>13; return x; }
static u32 hash(u32 h,u32 x) { return (h^x)*16777619u; }
#define EMIT(x) h=hash(h,(u32)(x))
static u32 search_char(u32 i){const u32 pattern[9]={0,1,0,1,0,2,0,1,0};return i%97<9?pattern[i%97]:sample(i)&3u;}
static u32 aes_mul(u32 x,u32 y){u32 product=0;for(u32 bit=0;bit<8;bit++){if(y&1u)product^=x;y>>=1;x=(x<<1)^((x&128u)?0x11bu:0);}return product;}
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

#elif KIND == 15 /* frustum-culling */
  for(u32 i=0;i<n;i++){int r=16+(int)(sample(i+31)&63u),visible=1;for(u32 d=0;d<3;d++){int v=(int)(sample(i*3+d)&2047u)-1024;if(v< -512-r||v>512+r)visible=0;}EMIT(visible);}

#elif KIND == 16 /* ray-box */
  for(u32 i=0;i<n;i++){u32 near=0,far=~0u;for(u32 d=0;d<3;d++){u32 lo=sample(i*6+d)&1023u,hi=lo+32+(sample(i*6+d+3)&127u),dir=1+(sample(i*3+d+71)&255u);u32 t0=lo*65536u/dir,t1=hi*65536u/dir;if(t0>near)near=t0;if(t1<far)far=t1;}EMIT(far>=near);EMIT(near);}

#elif KIND == 17 /* bezier-tessellation */
  for(u32 i=0;i<n;i++)for(u32 j=0;j<=16;j++)for(u32 d=0;d<3;d++){u32 t=16-j,v=t*t*t*(sample(i*12+d)&1023u)+3*t*t*j*(sample(i*12+3+d)&1023u)+3*t*j*j*(sample(i*12+6+d)&1023u)+j*j*j*(sample(i*12+9+d)&1023u);EMIT(v/4096);}

#elif KIND == 18 /* audio-biquad */
  int x1=0,x2=0,y1=0,y2=0;for(u32 i=0;i<n;i++){int x=(int)(sample(i)&32767u)-16384,y=(32*x+64*x1+32*x2+192*y1-64*y2)/256;x2=x1;x1=x;y2=y1;y1=y;EMIT(y);}

#elif KIND == 19 /* audio-autocorrelation */
  for(u32 i=0;i<n;i++)a[i]=sample(i)&255u;for(u32 lag=1;lag<=32;lag++){int v=0;for(u32 i=lag;i<n;i++)v+=((int)a[i]-128)*((int)a[i-lag]-128);EMIT(v);}

#elif KIND == 20 /* audio-adpcm */
  int predictor=0,step=16;for(u32 i=0;i<n;i++){int x=(int)(sample(i)&65535u)-32768,q=(x-predictor)/step;if(q< -8)q=-8;if(q>7)q=7;predictor+=q*step;if(predictor< -32768)predictor=-32768;if(predictor>32767)predictor=32767;int magnitude=q<0?-q:q;step+=magnitude>3?2:-1;if(step<1)step=1;EMIT((u32)q&15u);}

#elif KIND == 21 /* compiler-constant-fold */
  for(u32 i=0;i<n;i++){a[i]=0;b[i]=0;if(i%5==0)continue;if(i<2||i%3==0){a[i]=1;b[i]=sample(i)&255u;}else if(a[i-1]&&a[i/2]){a[i]=1;b[i]=i%3==1?b[i-1]+b[i/2]:b[i-1]*b[i/2];}}for(u32 i=0;i<n;i++){EMIT(a[i]);EMIT(b[i]);}

#elif KIND == 22 /* compiler-dead-code */
  for(u32 i=0;i<n;i++)a[i]=0;a[n-1]=1;a[n/2]=1;for(u32 i=n-1;i>0;i--)if(a[i]){a[i/2]=1;a[sample(i)%i]=1;}for(u32 i=0;i<n;i++)if(a[i])EMIT(i);

#elif KIND == 23 /* compiler-register-allocation */
  int owners[8];for(int r=0;r<8;r++)owners[r]=-1;for(u32 i=0;i<n;i++){u32 end=i+1+sample(i)%16,reg=8;for(u32 r=0;r<8;r++){if(owners[r]>=0&&a[owners[r]]<=i)owners[r]=-1;if(reg==8&&owners[r]<0)reg=r;}a[i]=end;if(reg==8){u32 longest=0;for(u32 r=1;r<8;r++)if(a[owners[r]]>a[owners[longest]])longest=r;if(end<a[owners[longest]]){b[owners[longest]]=8;reg=longest;}}b[i]=reg;if(reg<8)owners[reg]=(int)i;}for(u32 i=0;i<n;i++)EMIT(b[i]);

#elif KIND == 24 /* compression-rle */
  u32 previous=0,count=0;for(u32 i=0;i<n;i++){u32 value=i%64<48?(i/64)&255u:sample(i)&255u;if(count&&value!=previous){EMIT(count);EMIT(previous);count=0;}previous=value;count++;if(count==255){EMIT(count);EMIT(previous);count=0;}}if(count){EMIT(count);EMIT(previous);}

#elif KIND == 25 /* compression-lzw */
  u32 next=256,current=sample(0)&15u;for(u32 i=1;i<n;i++){u32 c=sample(i)&15u,found=~0u;for(u32 j=256;j<next;j++)if(a[j]==current&&b[j]==c){found=j;break;}if(found!=~0u)current=found;else{EMIT(current);if(next<4096){a[next]=current;b[next]=c;next++;}current=c;}}EMIT(current);

#elif KIND == 26 /* vision-otsu */
  u32 histogram[256]={0},total=n*n,sum=0;for(u32 i=0;i<total;i++){u32 v=sample(i)&255u;histogram[v]++;sum+=v;}u32 count=0,partial=0,best=0;double score=-1;for(u32 t=0;t<255;t++){count+=histogram[t];partial+=t*histogram[t];if(count&&count<total){double delta=(double)total*partial-(double)sum*count,v=delta*delta/((double)count*(total-count));if(v>score){score=v;best=t;}}}EMIT(best);

#elif KIND == 27 /* vision-dilation */
  for(u32 i=0;i<n*n;i++)a[i]=sample(i)&1u;for(u32 y=0;y<n;y++)for(u32 x=0;x<n;x++){u32 v=0;for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){int yy=(int)y+dy,xx=(int)x+dx;if(yy>=0&&xx>=0&&yy<(int)n&&xx<(int)n)v|=a[yy*n+xx];}EMIT(v);}

#elif KIND == 28 /* vision-components */
  for(u32 i=0;i<n*n;i++){a[i]=(sample(i)&7u)<2;b[i]=i;}for(u32 y=0;y<n;y++)for(u32 x=0;x<n;x++){u32 p=y*n+x;if(!a[p])continue;u32 neighbors[2]={x?p-1:p,y?p-n:p};for(u32 j=0;j<2;j++){u32 q=neighbors[j];if(a[q]){u32 r=p,s=q;while(b[r]!=r)r=b[r];while(b[s]!=s)s=b[s];if(r<s)b[s]=r;else b[r]=s;}}}for(u32 i=0;i<n*n;i++)if(a[i]){u32 r=i;while(b[r]!=r)r=b[r];EMIT(i);EMIT(r);}

#elif KIND == 29 /* vision-fast-corners */
  const int dx[16]={0,1,2,3,3,3,2,1,0,-1,-2,-3,-3,-3,-2,-1},dy[16]={-3,-3,-2,-1,0,1,2,3,3,3,2,1,0,-1,-2,-3};for(u32 i=0;i<n*n;i++)a[i]=sample(i)&255u;for(u32 y=3;y+3<n;y++)for(u32 x=3;x+3<n;x++){int p=(int)a[y*n+x],corner=0;for(u32 start=0;start<16;start++){int bright=1,dark=1;for(u32 k=0;k<9;k++){u32 j=(start+k)&15u;int v=(int)a[(y+dy[j])*n+x+dx[j]];bright&=v>p+20;dark&=v<p-20;}corner|=bright|dark;}if(corner)EMIT(y*n+x);}

#elif KIND == 30 /* vision-distance-transform */
  for(u32 i=0;i<n*n;i++)a[i]=(sample(i)&7u)<2?0:16383;for(u32 y=0;y<n;y++)for(u32 x=0;x<n;x++){u32 p=y*n+x;if(x&&a[p-1]+1<a[p])a[p]=a[p-1]+1;if(y&&a[p-n]+1<a[p])a[p]=a[p-n]+1;}for(u32 yy=n;yy-->0;)for(u32 xx=n;xx-->0;){u32 p=yy*n+xx;if(xx+1<n&&a[p+1]+1<a[p])a[p]=a[p+1]+1;if(yy+1<n&&a[p+n]+1<a[p])a[p]=a[p+n]+1;}for(u32 i=0;i<n*n;i++)EMIT(a[i]);

#elif KIND == 31 /* db-btree */
  u32 nodes=(n+7)/8,start=0,count=nodes;for(u32 i=0;i<n;i++)a[i]=3*i;for(u32 i=0;i<nodes;i++){b[4*i]=8*i;b[4*i+1]=n-8*i<8?n-8*i:8;b[4*i+2]=~0u;b[4*i+3]=a[8*i];}while(count>1){u32 next=(count+7)/8,newstart=nodes;for(u32 j=0;j<next;j++){u32 p=nodes++;b[4*p]=0;b[4*p+1]=count-8*j<8?count-8*j:8;b[4*p+2]=start+8*j;b[4*p+3]=b[4*(start+8*j)+3];}start=newstart;count=next;}for(u32 i=0;i<n;i++){u32 q=sample(i)%(3*n),p=start;while(b[4*p+2]!=~0u){u32 first=b[4*p+2],k=0;for(u32 j=1;j<b[4*p+1];j++)if(b[4*(first+j)+3]<=q)k=j;else break;p=first+k;}u32 result=~0u;for(u32 j=0;j<b[4*p+1];j++)if(a[b[4*p]+j]==q)result=b[4*p]+j;EMIT(result);}

#elif KIND == 32 /* db-hash-join */
  for(u32 i=0;i<256;i++)a[i]=~0u;for(u32 i=0;i<n;i++){u32 key=sample(i)%512,bucket=key%256;b[2*i]=key;b[2*i+1]=a[bucket];a[bucket]=i;}for(u32 j=0;j<n;j++){u32 key=sample(j+5)%512;for(u32 i=a[key%256];i!=~0u;i=b[2*i+1])if(b[2*i]==key){EMIT(i);EMIT(j);}}

#elif KIND == 33 /* db-sort-merge-join */
  for(u32 i=0;i<n;i++){a[i]=sample(i)%256;b[i]=sample(i+53)%256;}for(u32 i=1;i<n;i++){u32 v=a[i],j=i;while(j&&a[j-1]>v){a[j]=a[j-1];j--;}a[j]=v;v=b[i];j=i;while(j&&b[j-1]>v){b[j]=b[j-1];j--;}b[j]=v;}u32 i=0,j=0;while(i<n&&j<n){if(a[i]<b[j])i++;else if(a[i]>b[j])j++;else{u32 key=a[i],l=i,r=j;while(i<n&&a[i]==key)i++;while(j<n&&b[j]==key)j++;EMIT(key);EMIT((i-l)*(j-r));}}

#elif KIND == 34 /* db-bitmap-index */
  u32 words=(n+31)/32,total=0;for(u32 i=0;i<words;i++){a[i]=0;b[i]=0;}for(u32 i=0;i<n;i++){u32 bit=1u<<(i%32);if((sample(i)&255u)>127)a[i/32]|=bit;if((sample(i+17)&3u)==0)b[i/32]|=bit;}for(u32 i=0;i<words;i++){u32 v=a[i]&b[i];EMIT(v);while(v){total++;v&=v-1;}}EMIT(total);

#elif KIND == 35 /* document-optimal-wrap */
  for(u32 i=0;i<n;i++)a[i]=4+sample(i)%24;b[n]=0;for(u32 i=n;i-->0;){u32 width=0,best=~0u;for(u32 j=i;j<n;j++){width+=a[j]+(j>i?1:0);if(width>80)break;u32 slack=80-width,cost=(j+1==n?0:slack*slack)+b[j+1];if(cost<best)best=cost;}b[i]=best;}EMIT(b[0]);

#elif KIND == 36 /* document-edit-distance */
  for(u32 j=0;j<=n;j++)a[j]=j;for(u32 i=1;i<=n;i++){b[0]=i;for(u32 j=1;j<=n;j++){u32 substitution=a[j-1]+((sample(i-1)&15u)!=(sample(j+51)&15u)),v=a[j]+1;if(b[j-1]+1<v)v=b[j-1]+1;b[j]=substitution<v?substitution:v;}for(u32 j=0;j<=n;j++)a[j]=b[j];}EMIT(a[n]);

#elif KIND == 37 /* document-kerning */
  int x=0;u32 previous=0;for(u32 i=0;i<n;i++){u32 glyph=sample(i)&255u;int kern=i?(int)(sample(previous*256+glyph)&7u)-3:0;x+=kern;EMIT(x);x+=4+(glyph%13);previous=glyph;}EMIT(x);

#elif KIND == 38 /* document-bidi-reorder */
  for(u32 i=0;i<n;i++){a[i]=i;b[i]=sample(i)%4;}for(int level=3;level>=1;level--){u32 i=0;while(i<n){if(b[i]<(u32)level){i++;continue;}u32 end=i;while(end<n&&b[end]>=(u32)level)end++;for(u32 l=i,r=end-1;l<r;l++,r--){u32 t=a[l];a[l]=a[r];a[r]=t;}i=end;}}for(u32 i=0;i<n;i++)EMIT(a[i]);

#elif KIND == 39 /* document-page-packing */
  for(u32 i=0;i<n;i++)a[i]=20+sample(i)%181;for(u32 i=1;i<n;i++){u32 v=a[i],j=i;while(j&&a[j-1]<v){a[j]=a[j-1];j--;}a[j]=v;}u32 pages=0;for(u32 i=0;i<n;i++){u32 p=0;while(p<pages&&b[p]+a[i]>800)p++;if(p==pages)b[pages++]=0;b[p]+=a[i];}EMIT(pages);for(u32 p=0;p<pages;p++)EMIT(b[p]);

#elif KIND == 40 /* files-path-normalize */
  for(u32 row=0;row<n;row++){u32 stack[8],depth=0;for(u32 j=0;j<8;j++){u32 k=sample(row*8+j)%4;if(k==1){if(depth)depth--;}else if(k>=2)stack[depth++]=65+sample(row*8+j+999)%26;}EMIT(47);for(u32 j=0;j<depth;j++){if(j)EMIT(47);EMIT(stack[j]);}}

#elif KIND == 41 /* files-content-chunking */
  u32 gear=0,start=0;for(u32 i=0;i<n;i++){u32 byte=sample(i)&255u;gear=(gear<<1)+sample(byte+1000);u32 length=i+1-start;if(length>=32&&((gear&255u)==0||length>=1024)){EMIT(i+1);start=i+1;gear=0;}}if(start<n)EMIT(n);

#elif KIND == 42 /* files-merkle-tree */
  for(u32 i=0;i<n;i++){u32 v=2166136261u;for(u32 j=0;j<16;j++)v=hash(v,sample(i*16+j));a[i]=v;}u32 count=n;while(count>1){u32 next=(count+1)/2;for(u32 i=0;i<next;i++)b[i]=hash(hash(2166136261u,a[2*i]),a[2*i+1<count?2*i+1:2*i]);for(u32 i=0;i<next;i++)a[i]=b[i];count=next;}EMIT(a[0]);

#elif KIND == 43 /* files-glob-match */
  const char pattern[]="*A?B*";for(u32 row=0;row<n;row++){int p=0,star=-1;u32 i=0,retry=0;while(i<24){char c=(char)(65+(sample(row*24+i)&3u));if(pattern[p]=='?'||pattern[p]==c){p++;i++;}else if(pattern[p]=='*'){star=p++;retry=i;}else if(star>=0){p=star+1;i=++retry;}else break;}while(pattern[p]=='*')p++;if(i==24&&pattern[p]==0)EMIT(row);}

#elif KIND == 44 /* files-path-trie */
  for(u32 i=0;i<(n*8+1)*5;i++)a[i]=0;u32 nodes=1;for(u32 row=0;row<n;row++){u32 p=0;for(u32 j=0;j<8;j++){u32 c=sample(row*8+j)&3u;if(!a[5*p+c])a[5*p+c]=nodes++;p=a[5*p+c];}a[5*p+4]=1;}EMIT(nodes);for(u32 p=0;p<nodes;p++)for(u32 j=0;j<5;j++)EMIT(a[5*p+j]);

#elif KIND == 45 /* game-collision-impulse */
  for(u32 i=0;i<n;i++){int m1=1+(int)(sample(i*4)%16),m2=1+(int)(sample(i*4+1)%16),v1=(int)(sample(i*4+2)&255u)-128,v2=(int)(sample(i*4+3)&255u)-128;int u1=((m1-m2)*v1+2*m2*v2)/(m1+m2),u2=((m2-m1)*v2+2*m1*v1)/(m1+m2);EMIT(u1);EMIT(u2);}

#elif KIND == 46 /* game-flocking */
  for(u32 i=0;i<n;i++){a[2*i]=sample(2*i)&1023u;a[2*i+1]=sample(2*i+1)&1023u;}for(u32 i=0;i<n;i++){int count=0,cx=0,cy=0,sx=0,sy=0;for(u32 j=0;j<n;j++)if(i!=j){int dx=(int)a[2*j]-(int)a[2*i],dy=(int)a[2*j+1]-(int)a[2*i+1],d=dx*dx+dy*dy;if(d<16384){count++;cx+=dx;cy+=dy;if(d<1024){sx-=dx;sy-=dy;}}}EMIT(count?cx/count+sx:0);EMIT(count?cy/count+sy:0);}

#elif KIND == 47 /* game-spatial-hash */
  for(u32 i=0;i<256;i++)a[i]=~0u;for(u32 i=0;i<n;i++){u32 x=(sample(2*i)&1023u)/64,y=(sample(2*i+1)&1023u)/64,cell=y*16+x;b[i]=a[cell];a[cell]=i;}for(u32 cell=0;cell<256;cell++)for(u32 i=a[cell];i!=~0u;i=b[i])for(u32 j=b[i];j!=~0u;j=b[j]){EMIT(i);EMIT(j);}

#elif KIND == 48 /* game-cellular-automata */
  for(u32 i=0;i<n*n;i++)a[i]=sample(i)&1u;for(u32 step=0;step<8;step++){for(u32 y=0;y<n;y++)for(u32 x=0;x<n;x++){u32 count=0;for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++)if(dx||dy)count+=a[((y+n+dy)%n)*n+(x+n+dx)%n];u32 p=y*n+x;b[p]=count==3||(a[p]&&count==2);}for(u32 i=0;i<n*n;i++)a[i]=b[i];}for(u32 i=0;i<n*n;i++)EMIT(a[i]);

#elif KIND == 49 /* geo-point-in-polygon */
  const int px[8]={100,500,900,850,700,400,150,50},py[8]={100,50,150,600,900,850,700,400};for(u32 q=0;q<n;q++){int x=(int)(sample(2*q)&1023u),y=(int)(sample(2*q+1)&1023u),inside=0;for(int i=0,j=7;i<8;j=i++){if((py[i]>y)!=(py[j]>y)){int dy=py[j]-py[i],lhs=(x-px[i])*dy,rhs=(px[j]-px[i])*(y-py[i]);if(dy>0?lhs<rhs:lhs>rhs)inside=!inside;}}EMIT(inside);}

#elif KIND == 50 /* geo-convex-hull */
  for(u32 i=0;i<n;i++){a[2*i]=sample(2*i)&1023u;a[2*i+1]=sample(2*i+1)&1023u;}for(u32 i=1;i<n;i++){u32 x=a[2*i],y=a[2*i+1],j=i;while(j&&(a[2*j-2]>x||(a[2*j-2]==x&&a[2*j-1]>y))){a[2*j]=a[2*j-2];a[2*j+1]=a[2*j-1];j--;}a[2*j]=x;a[2*j+1]=y;}u32 k=0;for(u32 i=0;i<n;i++){while(k>=2){u32 p=b[k-2],q=b[k-1];int cross=((int)a[2*q]-(int)a[2*p])*((int)a[2*i+1]-(int)a[2*p+1])-((int)a[2*q+1]-(int)a[2*p+1])*((int)a[2*i]-(int)a[2*p]);if(cross>0)break;k--;}b[k++]=i;}u32 limit=k+1;for(u32 i=n-1;i-->0;){while(k>=limit){u32 p=b[k-2],q=b[k-1];int cross=((int)a[2*q]-(int)a[2*p])*((int)a[2*i+1]-(int)a[2*p+1])-((int)a[2*q+1]-(int)a[2*p+1])*((int)a[2*i]-(int)a[2*p]);if(cross>0)break;k--;}b[k++]=i;}for(u32 i=0;i+1<k;i++){EMIT(a[2*b[i]]);EMIT(a[2*b[i]+1]);}

#elif KIND == 51 /* geo-polygon-clipping */
  for(u32 row=0;row<n;row++){int cx=(int)(sample(row*3)&1023u),cy=(int)(sample(row*3+1)&1023u),r=20+(int)(sample(row*3+2)%100);a[0]=(u32)(cx-r);a[1]=cy;a[2]=cx;a[3]=(u32)(cy-r);a[4]=(u32)(cx+r);a[5]=cy;a[6]=cx;a[7]=(u32)(cy+r);u32 len=4;for(u32 plane=0;plane<4&&len;plane++){u32 axis=plane/2,out=0;int boundary=plane%2?768:256;for(u32 i=0;i<len;i++){u32 j=i?i-1:len-1;int x=(int)a[2*i],y=(int)a[2*i+1],px=(int)a[2*j],py=(int)a[2*j+1],v=axis?y:x,pv=axis?py:px,in=plane%2?v<=boundary:v>=boundary,pin=plane%2?pv<=boundary:pv>=boundary;if(in!=pin){int ix=axis?px+(x-px)*(boundary-py)/(y-py):boundary,iy=axis?boundary:py+(y-py)*(boundary-px)/(x-px);b[2*out]=(u32)ix;b[2*out+1]=(u32)iy;out++;}if(in){b[2*out]=(u32)x;b[2*out+1]=(u32)y;out++;}}len=out;for(u32 i=0;i<2*len;i++)a[i]=b[i];}EMIT(len);for(u32 i=0;i<2*len;i++)EMIT(a[i]);}

#elif KIND == 52 /* geo-polyline-simplify */
  for(u32 i=0;i<n;i++){u32 t=i%64;a[2*i]=4*i;a[2*i+1]=8*(t<32?t:64-t)+(sample(i)&7u);b[i]=0;}b[0]=b[n-1]=1;u32 top=1;b[n]=0;b[n+1]=n-1;while(top){top--;u32 first=b[n+2*top],last=b[n+2*top+1],best=first;int dx=(int)a[2*last]-(int)a[2*first],dy=(int)a[2*last+1]-(int)a[2*first+1];u32 maximum=0;for(u32 i=first+1;i<last;i++){int cross=dx*((int)a[2*i+1]-(int)a[2*first+1])-dy*((int)a[2*i]-(int)a[2*first]);u32 d=(u32)(cross<0?-cross:cross);if(d>maximum){maximum=d;best=i;}}if(best!=first&&(u64)maximum*maximum>(u64)64*(dx*dx+dy*dy)){b[best]=1;b[n+2*top]=first;b[n+2*top+1]=best;top++;b[n+2*top]=best;b[n+2*top+1]=last;top++;}}for(u32 i=0;i<n;i++)if(b[i])EMIT(i);

#elif KIND == 53 /* geo-geohash */
  for(u32 i=0;i<n;i++){u32 x=sample(2*i)&65535u,y=sample(2*i+1)&65535u,code=0;for(int bit=15;bit>=0;bit--){code=(code<<1)|((x>>bit)&1u);code=(code<<1)|((y>>bit)&1u);}EMIT(code);}

#elif KIND == 54 /* graphics-bresenham */
  for(u32 i=0;i<128*128;i++)a[i]=0;for(u32 i=0;i<n;i++){int x=(int)(sample(i*4)&127u),y=(int)(sample(i*4+1)&127u),x1=(int)(sample(i*4+2)&127u),y1=(int)(sample(i*4+3)&127u),dx=x1>x?x1-x:x-x1,dy=-(y1>y?y1-y:y-y1),sx=x<x1?1:-1,sy=y<y1?1:-1,err=dx+dy;for(;;){a[y*128+x]++;if(x==x1&&y==y1)break;int e=2*err;if(e>=dy){err+=dy;x+=sx;}if(e<=dx){err+=dx;y+=sy;}}}for(u32 i=0;i<128*128;i++)EMIT(a[i]);

#elif KIND == 55 /* graphics-png-paeth */
  for(u32 i=0;i<n;i++){int x=(int)(sample(i)&255u),left=i>=4?(int)(sample(i-4)&255u):0,above=(int)(sample(i+71)&255u),upper=i>=4?(int)(sample(i-4+71)&255u):0,p=left+above-upper,pa=p-left,pb=p-above,pc=p-upper;if(pa<0)pa=-pa;if(pb<0)pb=-pb;if(pc<0)pc=-pc;int predictor=pa<=pb&&pa<=pc?left:pb<=pc?above:upper;EMIT((u32)(x-predictor)&255u);}

#elif KIND == 56 /* graphics-reed-solomon */
  for(u32 row=0;row<n;row++){u32 coefficients[16]={0};for(u32 i=0;i<8;i++)for(u32 j=0;j<8;j++){u32 x=sample(row*16+i)&255u,y=sample(row*16+8+j)&255u,product=0;for(u32 bit=0;bit<8;bit++){if(y&1u)product^=x;y>>=1;x<<=1;if(x&256u)x^=0x11du;}coefficients[i+j]^=product;}for(u32 i=0;i<15;i++)EMIT(coefficients[i]);}

#elif KIND == 57 /* hardware-prime-implicants */
  u32 coverage[81];for(u32 code=0;code<81;code++){u32 value=code,mask=0,bits=0;for(u32 j=0;j<4;j++){u32 digit=value%3;value/=3;if(digit<2){mask|=1u<<j;if(digit)bits|=1u<<j;}}coverage[code]=0;for(u32 v=0;v<16;v++)if((v&mask)==bits)coverage[code]|=1u<<v;}for(u32 row=0;row<n;row++){u32 truth=sample(row)&65535u;for(u32 i=0;i<81;i++){u32 cover=coverage[i];if(cover&~truth)continue;int prime=1;for(u32 j=0;j<81;j++)if(coverage[j]!=cover&&!(coverage[j]&~truth)&&!(cover&~coverage[j])){prime=0;break;}if(prime)EMIT(cover);}}

#elif KIND == 58 /* hardware-boolean-anf */
  for(u32 row=0;row<n;row++){for(u32 i=0;i<256;i++)a[i]=sample(row*256+i)&1u;for(u32 bit=0;bit<8;bit++)for(u32 i=0;i<256;i++)if(i&(1u<<bit))a[i]^=a[i^(1u<<bit)];for(u32 i=0;i<256;i++)if(a[i])EMIT(i);}

#elif KIND == 59 /* image-median */
  for(u32 i=0;i<n*n;i++)a[i]=sample(i)&255u;for(u32 y=1;y+1<n;y++)for(u32 x=1;x+1<n;x++){u32 v[9],k=0;for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++)v[k++]=a[(y+dy)*n+x+dx];for(u32 i=1;i<9;i++){u32 value=v[i],j=i;while(j&&v[j-1]>value){v[j]=v[j-1];j--;}v[j]=value;}EMIT(v[4]);}

#elif KIND == 60 /* image-error-diffusion */
  for(u32 i=0;i<n*n;i++)a[i]=16*(sample(i)&255u);for(u32 y=0;y<n;y++)for(u32 x=0;x<n;x++){u32 p=y*n+x;int old=(int)a[p],value=old>=2048?4080:0,error=old-value;EMIT(value/16);if(x+1<n)a[p+1]=(u32)((int)a[p+1]+error*7/16);if(y+1<n){if(x)a[p+n-1]=(u32)((int)a[p+n-1]+error*3/16);a[p+n]=(u32)((int)a[p+n]+error*5/16);if(x+1<n)a[p+n+1]=(u32)((int)a[p+n+1]+error/16);}}

#elif KIND == 61 /* image-ycocg */
  for(u32 i=0;i<n;i++){int r=(int)(sample(3*i)&255u),g=(int)(sample(3*i+1)&255u),blue=(int)(sample(3*i+2)&255u),co=r-blue,t=blue+(co>>1),cg=g-t,y=t+(cg>>1);EMIT(y);EMIT(co);EMIT(cg);}

#elif KIND == 62 /* graph-dijkstra */
  for(u32 i=0;i<n;i++){a[i]=~0u;b[i]=0;}a[0]=0;for(u32 step=0;step<n;step++){u32 u=~0u;for(u32 i=0;i<n;i++)if(!b[i]&&(u==~0u||a[i]<a[u]))u=i;b[u]=1;for(u32 v=0;v<n;v++)if(v!=u){u32 d=a[u]+1+sample(u*n+v)%16;if(d<a[v])a[v]=d;}}for(u32 i=0;i<n;i++)EMIT(a[i]);

#elif KIND == 63 /* serialization-msgpack */
  for(u32 i=0;i<n;i++){u32 v=sample(i)&65535u;if(v<128)EMIT(v);else if(v<256){EMIT(0xcc);EMIT(v);}else{EMIT(0xcd);EMIT(v>>8);EMIT(v&255u);}}

#elif KIND == 64 /* serialization-protobuf */
  u32 length=0;for(u32 i=0;i<n;i++){u32 v=sample(i)&0xfffffffu;while(v>=128){a[length++]=(v&127u)|128u;v>>=7;}a[length++]=v;}u32 value=0,shift=0;for(u32 i=0;i<length;i++){u32 byte=a[i];value|=(byte&127u)<<shift;if(byte&128u)shift+=7;else{EMIT(value);value=0;shift=0;}}

#elif KIND == 65 /* language-forth */
  u32 length=0;for(u32 i=0;i<n;i++){u32 x=10+sample(2*i)%90,y=10+sample(2*i+1)%90;b[length++]=48+x/10;b[length++]=48+x%10;b[length++]=32;b[length++]=48+y/10;b[length++]=48+y%10;b[length++]=32;b[length++]=i%3==0?43:i%3==1?42:94;b[length++]=32;b[length++]=46;b[length++]=32;}u32 stack[8],sp=0;for(u32 pc=0;pc<length;){u32 token=b[pc++];if(token>=48&&token<=57){u32 value=token-48;while(pc<length&&b[pc]>=48&&b[pc]<=57)value=value*10+b[pc++]-48;stack[sp++]=value;}else if(token==46){EMIT(stack[--sp]);}else if(token==43||token==42||token==94){u32 y=stack[--sp],x=stack[--sp];stack[sp++]=token==43?x+y:token==42?x*y:x^y;}}

#elif KIND == 66 /* language-brainfuck */
  const char program[]="++++++++[>++++++++<-]>+.";for(u32 run=0;run<n;run++){u32 tape[4]={0},pointer=0;int pc=0;while(program[pc]){char op=program[pc];if(op=='+')tape[pointer]=(tape[pointer]+1)&255u;else if(op=='-')tape[pointer]=(tape[pointer]-1)&255u;else if(op=='>')pointer++;else if(op=='<')pointer--;else if(op=='.')EMIT(tape[pointer]);else if(op=='['&&!tape[pointer]){int depth=1;while(depth){pc++;if(program[pc]=='[')depth++;if(program[pc]==']')depth--;}}else if(op==']'&&tape[pointer]){int depth=1;while(depth){pc--;if(program[pc]==']')depth++;if(program[pc]=='[')depth--;}}pc++;}}

#elif KIND == 67 /* language-register-vm */
  for(u32 i=0;i<n;i++){a[i]=sample(i+17);b[i]=sample(i)&65535u;}u32 registers[8]={0,1,2,3,4,5,6,7},executed=0;for(u32 pc=0;pc<n;pc++){u32 code=b[pc],dst=(code>>3)&7u,src=(code>>6)&7u,imm=code>>9;executed++;switch(code&7u){case 0:registers[dst]+=imm;break;case 1:registers[dst]*=imm|1u;break;case 2:registers[dst]^=registers[src];break;case 3:registers[dst]=(registers[dst]<<1)|(registers[dst]>>31);break;case 4:registers[dst]=a[registers[src]%n];break;case 5:if(registers[dst]&1u)pc++;break;case 6:registers[dst]-=registers[src];break;case 7:registers[dst]=imm;break;}}for(u32 i=0;i<8;i++)EMIT(registers[i]);EMIT(executed);

#elif KIND == 68 /* ml-convolution */
  const int weights[9]={-1,2,-1,2,4,2,-1,2,-1};for(u32 i=0;i<n*n;i++)a[i]=sample(i)&255u;for(u32 y=1;y+1<n;y++)for(u32 x=1;x+1<n;x++){int value=0;u32 k=0;for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++)value+=((int)a[(y+dy)*n+x+dx]-128)*weights[k++];EMIT(value<0?0:value);}

#elif KIND == 69 /* ml-max-pooling */
  for(u32 i=0;i<n*n;i++)a[i]=sample(i)&255u;for(u32 y=0;y<n;y+=2)for(u32 x=0;x<n;x+=2){u32 v=a[y*n+x];if(a[y*n+x+1]>v)v=a[y*n+x+1];if(a[(y+1)*n+x]>v)v=a[(y+1)*n+x];if(a[(y+1)*n+x+1]>v)v=a[(y+1)*n+x+1];EMIT(v);}

#elif KIND == 70 /* ml-decision-tree */
  for(u32 row=0;row<n;row++){u32 node=0;for(u32 depth=0;depth<8;depth++){u32 feature=node%8,threshold=sample(node+71)&255u,value=sample(row*8+feature)&255u;node=node*2+1+(value>threshold);}EMIT(node-255);}

#elif KIND == 71 /* ml-knn */
  for(u32 row=0;row<n;row++){u32 distances[5]={~0u,~0u,~0u,~0u,~0u},labels[5]={0};for(u32 training=0;training<32;training++){u32 distance=0;for(u32 d=0;d<8;d++){int delta=(int)(sample(row*8+d)&255u)-(int)(sample(training*8+d+1001)&255u);distance+=(u32)(delta*delta);}u32 slot=5;for(u32 k=0;k<5;k++)if(distance<distances[k]){slot=k;break;}if(slot<5){for(u32 k=4;k>slot;k--){distances[k]=distances[k-1];labels[k]=labels[k-1];}distances[slot]=distance;labels[slot]=training%4;}}u32 votes[4]={0},best=0;for(u32 k=0;k<5;k++)votes[labels[k]]++;for(u32 k=1;k<4;k++)if(votes[k]>votes[best])best=k;EMIT(best);}

#elif KIND == 72 /* ml-kmeans */
  for(u32 i=0;i<n;i++){a[2*i]=sample(2*i)&1023u;a[2*i+1]=sample(2*i+1)&1023u;}u32 centers[16];for(u32 k=0;k<16;k++)centers[k]=a[k];for(u32 step=0;step<5;step++){u32 sums[16]={0},counts[8]={0};for(u32 i=0;i<n;i++){u32 best=0,minimum=~0u;for(u32 k=0;k<8;k++){int dx=(int)a[2*i]-(int)centers[2*k],dy=(int)a[2*i+1]-(int)centers[2*k+1];u32 d=(u32)(dx*dx+dy*dy);if(d<minimum){minimum=d;best=k;}}b[i]=best;counts[best]++;sums[2*best]+=a[2*i];sums[2*best+1]+=a[2*i+1];}for(u32 k=0;k<8;k++)if(counts[k]){centers[2*k]=sums[2*k]/counts[k];centers[2*k+1]=sums[2*k+1]/counts[k];}}for(u32 k=0;k<16;k++)EMIT(centers[k]);for(u32 i=0;i<n;i++)EMIT(b[i]);

#elif KIND == 73 /* numeric-integer-sqrt */
  for(u32 i=0;i<n;i++){u32 value=1+(sample(i)&0xffffffu),x=value,y=(x+1)/2;while(y<x){x=y;y=(x+value/x)/2;}EMIT(x);}

#elif KIND == 74 /* numeric-euclidean-gcd */
  for(u32 i=0;i<n;i++){u32 x=1+(sample(2*i)&65535u),y=1+(sample(2*i+1)&65535u);while(y){u32 remainder=x%y;x=y;y=remainder;}EMIT(x);}

#elif KIND == 75 /* numeric-cordic */
  const int angles[16]={51472,30386,16055,8150,4091,2047,1024,512,256,128,64,32,16,8,4,2};for(u32 i=0;i<n;i++){int x=39797,y=0,z=(int)(sample(i)&131071u)-65536;for(int j=0;j<16;j++){int old=x;if(z>=0){x-=y>>j;y+=old>>j;z-=angles[j];}else{x+=y>>j;y-=old>>j;z+=angles[j];}}EMIT(x);EMIT(y);}

#elif KIND == 76 /* numeric-simpson */
  u32 sum=0;for(u32 i=0;i<=n;i++){u32 value=i*i+3*i+1,weight=(i==0||i==n)?1:i%2?4:2;sum+=weight*value;}EMIT(sum/3);

#elif KIND == 77 /* search-kmp */
  const u32 p[9]={0,1,0,1,0,2,0,1,0};u32 failure[9]={0},j=0;for(u32 i=1;i<9;i++){while(j&&p[i]!=p[j])j=failure[j-1];if(p[i]==p[j])j++;failure[i]=j;}j=0;for(u32 i=0;i<n;i++){u32 c=search_char(i);while(j&&c!=p[j])j=failure[j-1];if(c==p[j])j++;if(j==9){EMIT(i-8);j=failure[8];}}

#elif KIND == 78 /* search-horspool */
  const u32 p[9]={0,1,0,1,0,2,0,1,0};u32 shift[4]={9,9,9,9};for(u32 i=0;i<8;i++)shift[p[i]]=8-i;u32 end=8;while(end<n){int j=8;while(j>=0&&search_char(end-8+(u32)j)==p[j])j--;if(j<0)EMIT(end-8);end+=shift[search_char(end)];}

#elif KIND == 79 /* search-rabin-karp */
  const u32 p[9]={0,1,0,1,0,2,0,1,0};u32 wanted=0,window=0,power=1;for(u32 i=0;i<9;i++){wanted=wanted*5+p[i];window=window*5+search_char(i);if(i<8)power*=5;}for(u32 start=0;start+9<=n;start++){if(window==wanted){int equal=1;for(u32 j=0;j<9;j++)if(search_char(start+j)!=p[j])equal=0;if(equal)EMIT(start);}if(start+9<n)window=(window-search_char(start)*power)*5+search_char(start+9);}

#elif KIND == 80 /* search-aho-corasick */
  for(u32 i=0;i<64*6;i++)a[i]=~0u;u32 nodes=1;for(u32 p=0;p<8;p++){u32 state=0;for(u32 j=0;j<6;j++){u32 c=sample(p*6+j)&3u;if(a[state*6+c]==~0u)a[state*6+c]=nodes++;state=a[state*6+c];}if(a[state*6+5]==~0u)a[state*6+5]=0;a[state*6+5]|=1u<<p;}for(u32 s=0;s<nodes;s++){a[s*6+4]=0;if(a[s*6+5]==~0u)a[s*6+5]=0;}u32 head=0,tail=0;for(u32 c=0;c<4;c++){u32 next=a[c];if(next==~0u)a[c]=0;else b[tail++]=next;}while(head<tail){u32 state=b[head++],fail=a[state*6+4];a[state*6+5]|=a[fail*6+5];for(u32 c=0;c<4;c++){u32 next=a[state*6+c];if(next==~0u)a[state*6+c]=a[fail*6+c];else{a[next*6+4]=a[fail*6+c];b[tail++]=next;}}}u32 state=0;for(u32 i=0;i<n;i++){state=a[state*6+(sample(i)&3u)];u32 matches=a[state*6+5];for(u32 p=0;p<8;p++)if(matches&(1u<<p)){EMIT(i-5);EMIT(p);}}

#elif KIND == 81 /* search-bk-tree */
  for(u32 i=0;i<128*18;i++)a[i]=~0u;u32 nodes=1;a[0]=sample(0)&65535u;for(u32 i=1;i<128;i++){u32 value=sample(i)&65535u,p=0;for(;;){u32 x=value^a[p*18],d=0;while(x){d++;x&=x-1;}if(d==0)break;if(a[p*18+1+d]==~0u){u32 q=nodes++;a[q*18]=value;a[p*18+1+d]=q;break;}p=a[p*18+1+d];}}for(u32 i=0;i<n;i++){u32 query=sample(i+31)&65535u,top=1,count=0;b[0]=0;while(top){u32 p=b[--top],x=query^a[p*18],d=0;while(x){d++;x&=x-1;}if(d<=2)count++;u32 first=d>2?d-2:1,last=d+2<16?d+2:16;for(u32 k=first;k<=last;k++)if(a[p*18+1+k]!=~0u)b[top++]=a[p*18+1+k];}EMIT(count);}

#elif KIND == 82 /* stats-quickselect */
  for(u32 i=0;i<n;i++)a[i]=sample(i)&65535u;u32 low=0,high=n-1,target=n/2;while(low<high){u32 pivot=a[high],p=low;for(u32 i=low;i<high;i++)if(a[i]<pivot){u32 t=a[i];a[i]=a[p];a[p++]=t;}u32 t=a[p];a[p]=a[high];a[high]=t;if(p==target)break;if(p<target)low=p+1;else high=p-1;}EMIT(a[target]);

#elif KIND == 83 /* stats-welford */
  long long mean=0,m2=0;for(u32 i=0;i<n;i++){long long x=(long long)(sample(i)&31u)*256,delta=x-mean;mean+=delta/(i+1);m2+=delta*(x-mean);}EMIT(mean);EMIT(m2);

#elif KIND == 84 /* stats-linear-regression */
  long long sx=0,sy=0,sxx=0,sxy=0;for(u32 i=0;i<n;i++){long long x=sample(2*i)&1023u,y=sample(2*i+1)&1023u;sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}long long slope=((long long)n*sxy-sx*sy)*256/((long long)n*sxx-sx*sx),intercept=(sy*256-slope*sx)/n;EMIT(slope);EMIT(intercept);

#elif KIND == 85 /* stats-gini */
  u32 counts[32]={0};for(u32 i=0;i<n;i++)counts[sample(i)&31u]++;u64 squares=0;for(u32 i=0;i<32;i++)squares+=(u64)counts[i]*counts[i];EMIT(65536-(u32)(squares*65536/((u64)n*n)));

#elif KIND == 86 /* stats-bootstrap */
  for(u32 i=0;i<n;i++)a[i]=sample(i)&255u;for(u32 replicate=0;replicate<64;replicate++){u32 sum=0;for(u32 i=0;i<n;i++)sum+=a[sample(replicate*n+i+71)%n];EMIT(sum*256/n);}

#elif KIND == 87 /* video-dct */
  const int cosine[64]={1024,1024,1024,1024,1024,1024,1024,1024,1004,851,569,200,-200,-569,-851,-1004,946,392,-392,-946,-946,-392,392,946,851,-200,-1004,-569,569,1004,200,-851,724,-724,-724,724,724,-724,-724,724,569,-1004,200,851,-851,-200,1004,-569,392,-946,946,-392,-392,946,-946,392,200,-569,851,-1004,1004,-851,569,-200};for(u32 block=0;block<n;block++){for(u32 y=0;y<8;y++)for(u32 u=0;u<8;u++){int v=0;for(u32 x=0;x<8;x++)v+=((int)(sample(block*64+y*8+x)&255u)-128)*cosine[u*8+x];a[y*8+u]=(u32)v;}for(u32 v=0;v<8;v++)for(u32 u=0;u<8;u++){long long value=0;for(u32 y=0;y<8;y++)value+=(long long)(int)a[y*8+u]*cosine[v*8+y];EMIT(value/1048576);}}

#elif KIND == 88 /* video-yuv420 */
  for(u32 i=0;i<n*n;i++){int r=(int)(sample(3*i)&255u),g=(int)(sample(3*i+1)&255u),blue=(int)(sample(3*i+2)&255u);EMIT(((66*r+129*g+25*blue+128)>>8)+16);a[i]=(u32)(((-38*r-74*g+112*blue+128)>>8)+128);b[i]=(u32)(((112*r-94*g-18*blue+128)>>8)+128);}for(u32 y=0;y<n;y+=2)for(u32 x=0;x<n;x+=2){u32 p=y*n+x;EMIT((a[p]+a[p+1]+a[p+n]+a[p+n+1]+2)/4);EMIT((b[p]+b[p+1]+b[p+n]+b[p+n+1]+2)/4);}

#elif KIND == 89 /* video-deblocking */
  for(u32 i=0;i<n*n;i++)a[i]=b[i]=sample(i)&255u;for(u32 y=0;y<n;y++)for(u32 x=8;x<n;x+=8){u32 p=y*n+x;int left=(int)a[p-1],right=(int)a[p],delta=right-left;if(delta<0)delta=-delta;if(delta<48){b[p-1]=(u32)((3*left+right+2)/4);b[p]=(u32)((left+3*right+2)/4);}}for(u32 i=0;i<n*n;i++)EMIT(b[i]);

#elif KIND == 90 /* video-temporal-denoise */
  for(u32 i=0;i<n*n;i++)a[i]=sample(i)&255u;for(u32 frame=1;frame<10;frame++)for(u32 i=0;i<n*n;i++)a[i]=(3*a[i]+(sample(frame*n*n+i)&255u))/4;for(u32 i=0;i<n*n;i++)EMIT(a[i]);

#elif KIND == 91 /* video-optical-flow */
  for(u32 i=0;i<n*n;i++){a[i]=sample(i)&255u;b[i]=sample(i+17)&255u;}for(u32 y=2;y+2<n;y+=3)for(u32 x=2;x+2<n;x+=3){long long aa=0,ab=0,bb=0,at=0,bt=0;for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){u32 p=(y+dy)*n+x+dx;long long gx=(int)a[p+1]-(int)a[p-1],gy=(int)a[p+n]-(int)a[p-n],gt=(int)b[p]-(int)a[p];aa+=gx*gx;ab+=gx*gy;bb+=gy*gy;at+=gx*gt;bt+=gy*gt;}long long det=aa*bb-ab*ab;EMIT(det?(ab*bt-bb*at)*64/det:0);EMIT(det?(ab*at-aa*bt)*64/det:0);}

#elif KIND == 92 /* graph-kruskal */
  u32 edges=0;for(u32 u=0;u<n;u++)for(u32 v=u+1;v<n;v++){a[3*edges]=u;a[3*edges+1]=v;a[3*edges+2]=1+sample(u*n+v)%1024;edges++;}for(u32 i=1;i<edges;i++){u32 u=a[3*i],v=a[3*i+1],weight=a[3*i+2],j=i;while(j&&a[3*j-1]>weight){a[3*j]=a[3*j-3];a[3*j+1]=a[3*j-2];a[3*j+2]=a[3*j-1];j--;}a[3*j]=u;a[3*j+1]=v;a[3*j+2]=weight;}for(u32 i=0;i<n;i++)b[i]=i;u32 sum=0;for(u32 i=0;i<edges;i++){u32 u=a[3*i],v=a[3*i+1];while(b[u]!=u)u=b[u];while(b[v]!=v)v=b[v];if(u!=v){b[v]=u;sum+=a[3*i+2];}}EMIT(sum);

#elif KIND == 93 /* crypto-aes128 */
  u32 sbox[256],key[176];for(u32 i=0;i<256;i++){u32 inverse=1,base=i,power=254;if(i==0)inverse=0;else while(power){if(power&1u)inverse=aes_mul(inverse,base);base=aes_mul(base,base);power>>=1;}u32 x=inverse;sbox[i]=(x^((x<<1)|(x>>7))^((x<<2)|(x>>6))^((x<<3)|(x>>5))^((x<<4)|(x>>4))^99)&255u;}for(u32 i=0;i<16;i++)key[i]=sample(i+1000)&255u;u32 rcon=1;for(u32 i=16;i<176;i+=4){u32 t[4]={key[i-4],key[i-3],key[i-2],key[i-1]};if(i%16==0){u32 first=t[0];t[0]=sbox[t[1]]^rcon;t[1]=sbox[t[2]];t[2]=sbox[t[3]];t[3]=sbox[first];rcon=aes_mul(rcon,2);}for(u32 j=0;j<4;j++)key[i+j]=key[i+j-16]^t[j];}for(u32 block=0;block<n;block++){u32 state[16],temp[16];for(u32 i=0;i<16;i++)state[i]=(sample(block*16+i)&255u)^key[i];for(u32 round=1;round<=10;round++){for(u32 column=0;column<4;column++)for(u32 row=0;row<4;row++)temp[4*column+row]=sbox[state[4*((column+row)%4)+row]];if(round<10)for(u32 column=0;column<4;column++){u32 p=4*column,x0=temp[p],x1=temp[p+1],x2=temp[p+2],x3=temp[p+3];state[p]=aes_mul(x0,2)^aes_mul(x1,3)^x2^x3;state[p+1]=x0^aes_mul(x1,2)^aes_mul(x2,3)^x3;state[p+2]=x0^x1^aes_mul(x2,2)^aes_mul(x3,3);state[p+3]=aes_mul(x0,3)^x1^x2^aes_mul(x3,2);}else for(u32 i=0;i<16;i++)state[i]=temp[i];for(u32 i=0;i<16;i++)state[i]^=key[round*16+i];}for(u32 i=0;i<16;i++)EMIT(state[i]);}

#elif KIND == 94 /* checksum-crc32 */
  u32 crc=~0u;for(u32 i=0;i<n;i++){crc^=sample(i)&255u;for(u32 bit=0;bit<8;bit++)crc=(crc>>1)^((crc&1u)?0xedb88320u:0);}EMIT(~crc);

#elif KIND == 95 /* stencil-lattice-boltzmann */
  static double first[9216],second[9216];const int cx[9]={0,1,0,-1,0,1,-1,-1,1},cy[9]={0,0,1,0,-1,1,1,-1,-1};const double weight[9]={4.0/9,1.0/9,1.0/9,1.0/9,1.0/9,1.0/36,1.0/36,1.0/36,1.0/36};for(u32 i=0;i<n*n*9;i++)first[i]=1+(sample(i)&31u);for(u32 step=0;step<10;step++){for(u32 y=0;y<n;y++)for(u32 x=0;x<n;x++){u32 p=(y*n+x)*9;double density=0,ux=0,uy=0;for(u32 d=0;d<9;d++){density+=first[p+d];ux+=first[p+d]*cx[d];uy+=first[p+d]*cy[d];}ux/=density;uy/=density;for(u32 d=0;d<9;d++){double cu=cx[d]*ux+cy[d]*uy,equilibrium=weight[d]*density*(1+3*cu+4.5*cu*cu-1.5*(ux*ux+uy*uy));u32 target=(((y+n+cy[d])%n)*n+(x+n+cx[d])%n)*9+d;second[target]=(first[p+d]+equilibrium)*0.5;}}for(u32 i=0;i<n*n*9;i++)first[i]=second[i];}for(u32 i=0;i<n*n*9;i++)EMIT((u32)(first[i]*1024));

#elif KIND == 96 /* stencil-wave-equation */
  static int next[4096];for(u32 i=0;i<n*n;i++)a[i]=b[i]=(u32)((int)(sample(i)&31u)-16);for(u32 step=0;step<8;step++){for(u32 y=0;y<n;y++)for(u32 x=0;x<n;x++){u32 p=y*n+x;int current=(int)b[p],laplacian=(int)b[y*n+(x+n-1)%n]+(int)b[y*n+(x+1)%n]+(int)b[((y+n-1)%n)*n+x]+(int)b[((y+1)%n)*n+x]-4*current;next[p]=2*current-(int)a[p]+laplacian/4;}for(u32 i=0;i<n*n;i++){a[i]=b[i];b[i]=(u32)next[i];}}for(u32 i=0;i<n*n;i++)EMIT(b[i]);
#else
#error Unknown corpus kernel kind
#endif
  return h;
}
