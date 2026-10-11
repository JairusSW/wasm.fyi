(module (global $a (export "a") (mut i32) (i32.const 0)) (global $b (export "b") (mut i32) (i32.const 0)) (global $t (mut i32) (i32.const 0))
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (block (result i32) (global.set $a (local.get $i)) (global.set $b (i32.add (local.get $i) (i32.const 3))) (global.set $t (global.get $a)) (global.set $a (global.get $b)) (global.set $b (global.get $t)) (i32.sub (global.get $a) (global.get $b)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
