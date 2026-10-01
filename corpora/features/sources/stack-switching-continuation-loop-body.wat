(module (type $f (func (param i32) (result i32))) (type $c (cont $f))
    (func $task (type $f) (local $i i32) (local $a i32) (loop $loop (local.set $a (i32.add (local.get $a) (local.get $i))) (local.set $i (i32.add (local.get $i) (i32.const 1))) (br_if $loop (i32.lt_u (local.get $i) (local.get 0)))) (local.get $a))
    (elem declare func $task) (func (export "benchmark") (param i32) (result i32) (resume $c (local.get 0) (cont.new $c (ref.func $task)))))
