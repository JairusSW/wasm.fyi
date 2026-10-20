(module (type $f (func (param i32) (result i32))) (type $c (cont $f))
  (func $identity (type $f) (local.get 0)) (elem declare func $identity)
 (func (export "benchmark") (param $n i32) (result i32)
  (local $i i32) (local $sum i32)  
  (block $done (br_if $done (i32.eqz (local.get $n)))
   (loop $again
    (local.set $sum (i32.add (local.get $sum) (resume $c (i32.add (i32.mul (local.get $i) (i32.const 7)) (i32.const 3)) (cont.new $c (ref.func $identity)))))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $again (i32.lt_u (local.get $i) (local.get $n))))) (local.get $sum)))
