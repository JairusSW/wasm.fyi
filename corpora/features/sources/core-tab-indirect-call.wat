(module (type $t (func (param i32) (result i32))) (table 2 funcref) (elem (i32.const 0) $f $g) (func $f (type $t) local.get 0 i32.const 1 i32.add) (func $g (type $t) local.get 0 i32.const 3 i32.add)
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (call_indirect (type $t) (local.get $i) (i32.and (local.get $i) (i32.const 1)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
