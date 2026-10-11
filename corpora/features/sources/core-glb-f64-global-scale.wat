(module (global $f  (mut f64) (f64.const 0))
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (block (result i32) (global.set $f (f64.mul (f64.convert_i32_u (local.get $i)) (f64.const 0.5))) (i32.trunc_f64_u (f64.mul (global.get $f) (f64.const 4))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
