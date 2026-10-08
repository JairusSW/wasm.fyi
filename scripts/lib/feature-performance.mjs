export const FEATURE_PERFORMANCE_REPEATS=64;
export const FEATURE_PERFORMANCE_BATCH_NS=50_000_000;

/** Keep GC allocations observable rather than allowing allocation/access fusion. */
export function performanceSource(fixture) {
 if(fixture.feature!=='gc'||!['struct-allocation-access','array-allocation-access','array-fill'].includes(fixture.name))return {wat:fixture.wat,retained:false};
 const structure=fixture.name==='struct-allocation-access';
 const declarations=structure?'(type $item (struct (field i32)))':'(type $item (array (mut i32)))';
 const create=structure?'(struct.new $item (local.get $i))':fixture.name==='array-fill'?'(array.new $item (i32.const 0) (i32.const 16))':'(array.new $item (local.get $i) (i32.const 16))';
 const fill=fixture.name==='array-fill'?'(array.fill $item (local.get $r) (i32.const 0) (local.get $i) (i32.const 16))':'';
 const access=structure?'(struct.get $item 0 (local.get $r))':'(array.get $item (local.get $r) (i32.and (local.get $i) (i32.const 15)))';
 return {retained:true,wat:`(module ${declarations}
 (type $roots (array (mut (ref null $item))))
 (global $roots (export "performance-roots") (mut (ref null $roots)) (ref.null $roots))
 (func (export "retained-count") (result i32) (array.len (global.get $roots)))
 (func (export "retained-object") (param $index i32) (result (ref null $item)) (array.get $roots (global.get $roots) (local.get $index)))
 (func (export "retained-value") (param $index i32) (result i32)
  ${structure?'(struct.get $item 0 (array.get $roots (global.get $roots) (local.get $index)))':'(array.get $item (array.get $roots (global.get $roots) (local.get $index)) (i32.const 0))'})
 (func (export "benchmark") (param $n i32) (result i32)
  (local $i i32) (local $sum i32) (local $r (ref null $item))
  (global.set $roots (array.new_default $roots (local.get $n)))
  (block $done (br_if $done (i32.eqz (local.get $n)))
   (loop $loop
    (local.set $r ${create}) ${fill}
    (array.set $roots (global.get $roots) (local.get $i) (local.get $r))
    (local.set $sum (i32.add (local.get $sum) ${access}))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $loop (i32.lt_u (local.get $i) (local.get $n)))))
  (local.get $sum)))`};
}
/** Repetition stays within Wasm; no extra feature or host import is introduced. */
export function repeatedFeatureSource(wat,repeats=FEATURE_PERFORMANCE_REPEATS) {
 if(!Number.isSafeInteger(repeats)||repeats<1)throw Error('Invalid repetition count');
 const needle='(func (export "benchmark")';
 if(!wat.includes(needle))throw Error('Feature kernel must expose an i32 benchmark export');
 const named=wat.replace(needle,'(func $performance_kernel (export "benchmark")').trim();
 return named.slice(0,-1)+`\n (func (export "performance") (param $n i32) (result i32)
  (local $iteration i32) (local $checksum i32)
  (loop $repeat
   (local.set $checksum (i32.add (local.get $checksum) (call $performance_kernel (local.get $n))))
   (local.set $iteration (i32.add (local.get $iteration) (i32.const 1)))
   (br_if $repeat (i32.lt_u (local.get $iteration) (i32.const ${repeats}))))
  (local.get $checksum)))`;
}
export function repeatedFeatureExpected(expected,repeats=FEATURE_PERFORMANCE_REPEATS) {
 return Number(BigInt.asUintN(32,BigInt(expected)*BigInt(repeats)));
}
