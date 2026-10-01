(module 
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (i32x4.extract_lane 2 (i32x4.mul (i32x4.add (i32x4.splat (local.get $i)) (i32x4.splat (i32.const 3))) (i32x4.splat (i32.const 7))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
