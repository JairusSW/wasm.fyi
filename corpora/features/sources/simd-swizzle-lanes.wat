(module 
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (i8x16.extract_lane_u 3 (i8x16.swizzle (i8x16.splat (local.get $i)) (v128.const i8x16 15 14 13 12 11 10 9 8 7 6 5 4 3 2 1 0)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
