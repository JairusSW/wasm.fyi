(module (type $a (array (mut i32)))
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (array.get $a (array.new $a (local.get $i) (i32.const 16)) (i32.and (local.get $i) (i32.const 15)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
