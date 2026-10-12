(module (memory $primary 2 2 shared) (memory $secondary 2 2 shared)
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (block (result i32) (i32.atomic.store $secondary (i32.const 0) (local.get $i))
    (i32.add (memory.atomic.wait32 $secondary (i32.const 0) (i32.add (local.get $i) (i32.const 1)) (i64.const 0)) (memory.grow $secondary (i32.const 0))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
