(module (global $w  (mut i64) (i64.const 0))
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (block (result i32) (global.set $w (i64.mul (i64.extend_i32_u (local.get $i)) (i64.const 4294967297))) (i32.add (i32.wrap_i64 (global.get $w)) (i32.wrap_i64 (i64.shr_u (global.get $w) (i64.const 32)))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
