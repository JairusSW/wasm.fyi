(module (type $f (func (param i32) (result i32))) (type $c (cont $f)) (func $task (type $f) local.get 0 i32.const 7 i32.add) (elem declare func $task)
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (resume $c (local.get $i) (cont.new $c (ref.func $task)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
