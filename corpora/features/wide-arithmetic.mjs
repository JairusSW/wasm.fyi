// Original workloads for the four phase 4 instructions. Inputs vary across
// both words; the BigInt oracle performs arithmetic before splitting results.
const u64=x=>BigInt.asUintN(64,x);
const operands=i=>[u64(i*0x9e3779b97f4a7c15n+0x8000000000000001n),u64(i*0x100000001n+7n),u64((i+1n)*0xd1342543de82ef95n),u64(i^0xfeedbeefn)];
export function wideArithmeticWords(op,i){
 const [a,ah,b,bh]=operands(BigInt(i));
 const value=op==='add128'?((ah<<64n)|a)+((bh<<64n)|b):op==='sub128'?((ah<<64n)|a)-((bh<<64n)|b):op==='mul_wide_s'?BigInt.asIntN(64,a)*BigInt.asIntN(64,b):op==='mul_wide_u'?a*b:null;
 if(value===null)throw Error('Unknown wide arithmetic operation');
 const bits=BigInt.asUintN(128,value);return [u64(bits),bits>>64n];
}
export function wideArithmeticExpected(op,n){
 let sum=0n;
 for(let i=0;i<n;i++){
  const [lo,hi]=wideArithmeticWords(op,i);
  sum=BigInt.asUintN(32,sum+(lo^(lo>>32n)^hi^(hi>>32n)));
 }
 return Number(sum);
}
export function wideArithmeticFixtures(){
 const i='(i64.extend_i32_u (local.get $i))';
 const a=`(i64.add (i64.mul ${i} (i64.const 0x9e3779b97f4a7c15)) (i64.const 0x8000000000000001))`;
 const ah=`(i64.add (i64.mul ${i} (i64.const 0x100000001)) (i64.const 7))`;
 const b=`(i64.mul (i64.add ${i} (i64.const 1)) (i64.const 0xd1342543de82ef95))`;
 const bh=`(i64.xor ${i} (i64.const 0xfeedbeef))`;
 return ['add128','sub128','mul_wide_s','mul_wide_u'].map(op=>({name:op.replaceAll('_','-'),expected:n=>wideArithmeticExpected(op,n),wat:`(module
  (func (export "benchmark") (param $n i32) (result i32)
   (local $i i32) (local $sum i32) (local $lo i64) (local $hi i64)
   (loop $loop
    ${op==='add128'||op==='sub128'?`${a} ${ah} ${b} ${bh}`:`${a} ${b}`}
    i64.${op} local.set $hi local.set $lo
    (local.set $sum (i32.add (local.get $sum)
     (i32.wrap_i64 (i64.xor (i64.xor (local.get $lo) (i64.shr_u (local.get $lo) (i64.const 32)))
      (i64.xor (local.get $hi) (i64.shr_u (local.get $hi) (i64.const 32)))))))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
   (local.get $sum)))`}));
}
