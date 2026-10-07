// Original, bounded data-access algorithms. Setup is an exported initializer,
// which the runner calls before warmup and measurement. All calls are repeatable.
const data = Array.from({length:256}, (_,i)=>`\\${((i*17+3)&255).toString(16).padStart(2,'0')}`).join('');
const memoryWat=`(module (memory (export "memory") 1 1) (data (i32.const 0) "${data}")
  (func (export "prefix-scan-checksum") (param $n i32) (result i32)
    (local $i i32) (local $prefix i32) (local $sum i32)
    (local.set $n (select (local.get $n) (i32.const 4096) (i32.lt_u (local.get $n) (i32.const 4096))))
    (block $done (loop $scan (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (local.set $prefix (i32.add (local.get $prefix) (i32.load8_u (i32.and (local.get $i) (i32.const 255)))))
      (i32.store (i32.add (i32.const 1024) (i32.shl (local.get $i) (i32.const 2))) (local.get $prefix))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $scan)))
    (local.set $i (i32.const 0))
    (block $done (loop $sumloop (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (local.set $sum (i32.add (local.get $sum) (i32.load (i32.add (i32.const 1024) (i32.shl (local.get $i) (i32.const 2))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $sumloop))) (local.get $sum))
  (func (export "strided-gather") (param $n i32) (result i32)
    (local $i i32) (local $sum i32)
    (block $done (loop $loop (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (local.set $sum (i32.add (local.get $sum) (i32.load8_u (i32.and (i32.mul (local.get $i) (i32.const 37)) (i32.const 255)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $loop))) (local.get $sum))
  (func (export "packed-record-fields") (param $n i32) (result i32)
    (local $i i32) (local $sum i32) (local $p i32)
    (block $done (loop $loop (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (local.set $p (i32.mul (i32.rem_u (local.get $i) (i32.const 31)) (i32.const 7)))
      (local.set $sum (i32.add (local.get $sum) (i32.xor (i32.load16_u align=1 (local.get $p)) (i32.load8_u offset=4 (local.get $p)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $loop))) (local.get $sum)))`;
const tableWat=`(module
 (type $t (func (param i32) (result i32)))
 (table $t0 16 16 funcref) (table $t1 16 16 funcref) (table $sparse 16 16 funcref)
 (elem declare func $inc $double)
 (func $inc (type $t) (param i32) (result i32) (i32.add (local.get 0) (i32.const 1)))
 (func $double (type $t) (param i32) (result i32) (i32.mul (local.get 0) (i32.const 2)))
 (func (export "initialize")
  (table.fill $t0 (i32.const 0) (ref.func $inc) (i32.const 16))
  (table.fill $t1 (i32.const 0) (ref.func $double) (i32.const 16)))
 (func (export "sparse-reference-compaction") (param $n i32) (result i32)
  (local $i i32) (local $j i32) (local $write i32) (local $k i32) (local $sum i32) (local $r funcref)
  (block $done (loop $round (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
   (local.set $j (i32.const 0))
   (loop $seed
    (local.set $k (i32.add (local.get $i) (local.get $j)))
    (table.set $sparse (local.get $j)
     (if (result funcref) (i32.eqz (i32.and (local.get $k) (i32.const 3))) (then (ref.null func))
      (else (if (result funcref) (i32.and (local.get $k) (i32.const 1)) (then (ref.func $inc)) (else (ref.func $double))))))
    (local.set $j (i32.add (local.get $j) (i32.const 1))) (br_if $seed (i32.lt_u (local.get $j) (i32.const 16))))
   (local.set $j (i32.const 0)) (local.set $write (i32.const 0))
   (loop $compact
    (local.set $r (table.get $sparse (local.get $j)))
    (if (i32.eqz (ref.is_null (local.get $r))) (then
     (table.set $sparse (local.get $write) (local.get $r))
     (local.set $write (i32.add (local.get $write) (i32.const 1)))))
    (local.set $j (i32.add (local.get $j) (i32.const 1))) (br_if $compact (i32.lt_u (local.get $j) (i32.const 16))))
   (table.fill $sparse (local.get $write) (ref.null func) (i32.sub (i32.const 16) (local.get $write)))
   (local.set $j (i32.const 0))
   (loop $checksum
    (local.set $sum (i32.add (local.get $sum) (call_indirect $sparse (type $t) (i32.add (local.get $i) (local.get $j)) (local.get $j))))
    (local.set $j (i32.add (local.get $j) (i32.const 1))) (br_if $checksum (i32.lt_u (local.get $j) (local.get $write))))
   (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $round))) (local.get $sum))
 (func (export "cross-table-dispatch") (param $n i32) (result i32)
  (local $i i32) (local $sum i32)
  (table.copy $t0 $t1 (i32.const 8) (i32.const 0) (i32.const 8))
  (block $done (loop $loop (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
   (local.set $sum (i32.add (local.get $sum) (call_indirect $t0 (type $t) (local.get $i) (i32.and (local.get $i) (i32.const 15)))))
   (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $loop))) (local.get $sum)))`;
const sum=(n,f)=>Array.from({length:n},(_,i)=>f(i)).reduce((a,b)=>(a+b)>>>0,0);
const byte=i=>(i*17+3)&255;
export function fixtures(){
 const base={sizes:[64],scope:'execution',reset:'stateless'};
 return [
  {...base,feature:'core-mem',name:'prefix-scan-checksum',module:'core-mem-curated',export:'prefix-scan-checksum',wat:memoryWat,expected:n=>{let prefix=0,total=0;for(let i=0;i<Math.min(n>>>0,4096);i++){prefix+=byte(i&255);total=(total+prefix)>>>0;}return total;}},
  {...base,feature:'core-mem',name:'strided-gather',module:'core-mem-curated',export:'strided-gather',wat:memoryWat,expected:n=>sum(n,i=>byte(i*37&255))},
  {...base,feature:'core-mem',name:'packed-record-fields',module:'core-mem-curated',export:'packed-record-fields',wat:memoryWat,expected:n=>sum(n,i=>{const p=i%31*7;return (byte(p)+byte(p+1)*256)^byte(p+4);})},
  {...base,feature:'reference-types',name:'sparse-reference-compaction',module:'reference-types-curated',export:'sparse-reference-compaction',wat:tableWat,expected:n=>sum(n,i=>Array.from({length:16},(_,j)=>i+j).filter(k=>(k&3)!==0).reduce((a,k,j)=>a+((k&1)?i+j+1:2*(i+j)),0))},
  {...base,feature:'reference-types',name:'cross-table-dispatch',module:'reference-types-curated',export:'cross-table-dispatch',initialize:'initialize',wat:tableWat,expected:n=>sum(n,i=>(i&15)<8?i+1:2*i)}
 ];
}
