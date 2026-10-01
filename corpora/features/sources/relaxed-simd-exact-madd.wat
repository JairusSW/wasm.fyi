(module 
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (i32.trunc_f32_u (f32x4.extract_lane 2 (f32x4.relaxed_madd (f32x4.splat (f32.convert_i32_u (local.get $i))) (f32x4.splat (f32.const 2)) (f32x4.splat (f32.const 1)))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
