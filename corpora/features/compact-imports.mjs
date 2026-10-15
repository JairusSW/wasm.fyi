// Each module uses only MVP function imports plus the compact-import encoding.
// Ordinary controls have identical execution and binding work to their compact peers.
export function compactImportFixtures(){
 const type='(func (param i32) (result i32))';
 const ordinary=count=>Array.from({length:count},()=>`(import "wasmbench" "identity" ${type})`).join('\n');
 const moduleGroup=count=>`(import "wasmbench" ${Array.from({length:count},()=>`(item "identity" ${type})`).join(' ')})`;
 const typeGroup=count=>`(import "wasmbench" ${Array.from({length:count},()=>'(item "identity")').join(' ')} ${type})`;
 const fixture=(name,imports,count,indices=[0,count-1],offsets=[0,3])=>({name,importCount:count,baseline:name.startsWith('ordinary-baseline'),hostProfile:'identity-v1',
  expected:n=>Number(BigInt.asUintN(32,BigInt(indices.length)*BigInt(n)*(BigInt(n)-1n)/2n+BigInt(offsets.reduce((a,b)=>a+b,0))*BigInt(n))),
  wat:`(module ${imports}
   (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $sum i32)
    (loop $loop
     (local.set $sum (i32.add (local.get $sum)
      ${indices.map((index,k)=>`(call ${index} ${offsets[k]?`(i32.add (local.get $i) (i32.const ${offsets[k]}))`:'(local.get $i)'})`).reduce((a,b)=>`(i32.add ${a} ${b})`)}))
     (local.set $i (i32.add (local.get $i) (i32.const 1)))
     (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $sum)))`
 });
 return [
  fixture('module-group',moduleGroup(8),8),
  fixture('type-group',typeGroup(8),8),
  fixture('ordinary-baseline',ordinary(8),8),
  // Check indices on both sides of every compact group, with ordinary imports at both ends.
  fixture('mixed-groups',[ordinary(1),moduleGroup(8),typeGroup(8),ordinary(1)].join('\n'),18,[0,1,8,9,16,17],[0,1,2,3,4,5]),
  // Large tables exercise LEB lengths/counts and amplify import-section decoding costs.
  fixture('module-group-1024',moduleGroup(1024),1024),
  fixture('type-group-1024',typeGroup(1024),1024),
  fixture('ordinary-baseline-1024',ordinary(1024),1024),
 ];
}
