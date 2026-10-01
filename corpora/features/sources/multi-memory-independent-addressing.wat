(module (memory $a 2 2) (memory $b 2 2)
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (block (result i32) (i32.store $a (i32.shl (i32.and (local.get $i) (i32.const 8191)) (i32.const 2)) (local.get $i)) (i32.store $b (i32.shl (i32.and (local.get $i) (i32.const 8191)) (i32.const 2)) (i32.add (local.get $i) (i32.const 7))) (i32.sub (i32.load $b (i32.shl (i32.and (local.get $i) (i32.const 8191)) (i32.const 2))) (i32.load $a (i32.shl (i32.and (local.get $i) (i32.const 8191)) (i32.const 2)))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
