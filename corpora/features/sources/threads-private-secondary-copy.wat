(module (memory $shared 2 2 shared) (memory $private 2 2)
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (block (result i32) (i32.atomic.store (i32.const 0) (local.get $i))
    (memory.copy $private $shared (i32.shl (i32.and (local.get $i) (i32.const 8191)) (i32.const 2)) (i32.const 0) (i32.const 4)) (i32.load $private (i32.shl (i32.and (local.get $i) (i32.const 8191)) (i32.const 2))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
