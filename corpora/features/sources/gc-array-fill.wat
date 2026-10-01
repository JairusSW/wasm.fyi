(module (type $a (array (mut i32)))
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) (local $r (ref null $a))
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (block (result i32) (local.set $r (array.new $a (i32.const 0) (i32.const 16))) (array.fill $a (local.get $r) (i32.const 0) (local.get $i) (i32.const 16)) (array.get $a (local.get $r) (i32.and (local.get $i) (i32.const 15))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
