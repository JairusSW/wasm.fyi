(module 
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (i32.eq (i32.reinterpret_f32 (f32.copysign (f32.const 0) (f32.neg (f32.convert_i32_u (i32.add (local.get $i) (i32.const 1)))))) (i32.const -2147483648))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
