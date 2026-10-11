(module (global $g  (mut i32) (i32.const 0))
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    (global.set $g (i32.const 0))
    (loop $loop
      (local.set $a (i32.add (local.get $a) (block (result i32) (global.set $g (i32.add (global.get $g) (local.get $i))) (global.get $g))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
