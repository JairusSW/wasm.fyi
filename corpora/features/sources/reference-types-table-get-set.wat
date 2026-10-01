(module (table 16 funcref) (func $f) (elem declare func $f)
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (block (result i32) (table.set (i32.and (local.get $i) (i32.const 15)) (ref.func $f)) (i32.eqz (ref.is_null (table.get (i32.and (local.get $i) (i32.const 15))))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
