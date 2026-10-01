(module 
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (if (result i32) (i32.and (local.get $i) (i32.const 1)) (then (i32.mul (local.get $i) (i32.const 3))) (else (i32.add (local.get $i) (i32.const 7))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
