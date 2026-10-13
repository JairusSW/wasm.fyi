// Eight repeated imports exercise expansion count and first/last function indices.
// Identity host calls use the existing identity-v1 contract for every encoding.
export function compactImportFixtures(){
 const type='(func (param i32) (result i32))',count=8;
 const ordinary=Array.from({length:count},()=>`(import "wasmbench" "identity" ${type})`).join('\n');
 const group1=`(import "wasmbench" ${Array.from({length:count},()=>`(item "identity" ${type})`).join(' ')})`;
 const group2=`(import "wasmbench" ${Array.from({length:count},()=>'(item "identity")').join(' ')} ${type})`;
 return [['module-group',group1],['type-group',group2],['ordinary-baseline',ordinary]].map(([name,imports])=>({name,baseline:name==='ordinary-baseline',hostProfile:'identity-v1',
  expected:n=>Number(BigInt.asUintN(32,BigInt(n)*(BigInt(n)+2n))),
  wat:`(module ${imports}
   (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $sum i32)
    (loop $loop
     (local.set $sum (i32.add (local.get $sum)
      (i32.add (call 0 (local.get $i)) (call 7 (i32.add (local.get $i) (i32.const 3))))))
     (local.set $i (i32.add (local.get $i) (i32.const 1)))
     (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $sum)))`
 }));
}
