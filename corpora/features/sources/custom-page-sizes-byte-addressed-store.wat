(module (memory (export "memory") 32768 65536 (pagesize 1))
 (func (export "benchmark") (param $n i32) (result i32)
  (local $i i32) (local $sum i32)  
  (block $done (br_if $done (i32.eqz (local.get $n)))
   (loop $again
    (local.set $sum (i32.add (local.get $sum) (block (result i32) (i32.store8 (i32.and (local.get $i) (i32.const 32767)) (local.get $i)) (i32.load8_u (i32.and (local.get $i) (i32.const 32767))))))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $again (i32.lt_u (local.get $i) (local.get $n))))) (local.get $sum)))
