(module (memory 2 2 shared)
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (block (result i32) (i32.atomic.store (i32.shl (i32.and (local.get $i) (i32.const 8191)) (i32.const 2)) (local.get $i)) (i32.atomic.load (i32.shl (i32.and (local.get $i) (i32.const 8191)) (i32.const 2))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
