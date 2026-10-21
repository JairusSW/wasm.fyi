(module (@custom "metadata.code.trace_inst" (before code) "\01\00\01\03\04\78\56\34\12")
 (func (export "benchmark") (param $n i32) (result i32)
  (local $i i32) (local $sum i32)  
  (block $done (br_if $done (i32.eqz (local.get $n)))
   (loop $again
    (local.set $sum (i32.add (local.get $sum) (i32.add (i32.mul (local.get $i) (i32.const 7)) (i32.const 3))))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $again (i32.lt_u (local.get $i) (local.get $n))))) (local.get $sum)))
