import test from 'node:test';
import assert from 'node:assert/strict';
import {wideArithmeticWords,wideArithmeticExpected,wideArithmeticFixtures} from '../corpora/features/wide-arithmetic.mjs';
import {fixtures} from '../corpora/features/generator.mjs';

// Independent base-65536 arithmetic: all intermediate Number products are exact.
const words=x=>Array.from({length:4},(_,j)=>Number(BigInt.asUintN(64,x)>>BigInt(j*16)&65535n));
const subtract=(a,b)=>{let borrow=0;return a.map((v,j)=>{const n=v-(b[j]||0)-borrow;borrow=n<0?1:0;return (n+65536)%65536;});};
function reference(op,i){
 const a=words(BigInt(i)*0x9e3779b97f4a7c15n+0x8000000000000001n);
 const ah=words(BigInt(i)*0x100000001n+7n);
 const b=words((BigInt(i)+1n)*0xd1342543de82ef95n);
 const bh=words(BigInt(i)^0xfeedbeefn);
 let out=Array(8).fill(0);
 if(op==='add128'){let carry=0;out=[...a,...ah].map((v,j)=>{const n=v+[...b,...bh][j]+carry;carry=Math.floor(n/65536);return n%65536;});}
 else if(op==='sub128')out=subtract([...a,...ah],[...b,...bh]);
 else {
  for(let j=0;j<4;j++)for(let k=0;k<4;k++)out[j+k]+=a[j]*b[k];
  for(let j=0;j<7;j++){out[j+1]+=Math.floor(out[j]/65536);out[j]%=65536;}out[7]%=65536;
  if(op==='mul_wide_s'){
   if(a[3]>=32768)out=subtract(out,[0,0,0,0,...b]);
   if(b[3]>=32768)out=subtract(out,[0,0,0,0,...a]);
  }
 }
 const combine=a=>a.reduce((v,n,j)=>v|(BigInt(n)<<BigInt(j*16)),0n);
 return [combine(out.slice(0,4)),combine(out.slice(4))];
}
test('wide arithmetic oracle matches independent limb arithmetic across every corpus input',()=>{
 for(const op of ['add128','sub128','mul_wide_s','mul_wide_u']){
  let sum=0;
  for(let i=0;i<4096;i++){
   const expected=reference(op,i);assert.deepEqual(wideArithmeticWords(op,i),expected,`${op} input ${i}`);
   const [lo,hi]=expected;sum=(sum+Number((lo^(lo>>32n)^hi^(hi>>32n))&0xffffffffn))>>>0;
   if([1,64,4096].includes(i+1))assert.equal(wideArithmeticExpected(op,i+1),sum);
  }
 }
});
test('all four original wide instructions have execution contracts and consume both results',()=>{
 assert.equal(wideArithmeticFixtures().length,4);
 const family=fixtures().filter(f=>f.feature==='wide-arithmetic');assert.equal(family.length,4);
 for(const f of family){assert.equal(f.scope,'execution');assert.deepEqual(f.sizes,[1,64,4096]);assert.match(f.wat,/local.set \$hi local.set \$lo/);}
 assert.throws(()=>wideArithmeticWords('unknown',0),/Unknown/);
});
