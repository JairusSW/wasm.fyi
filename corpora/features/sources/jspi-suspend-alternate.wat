(module (import "jspi" "step" (func $step (param i32) (result i32))) (import "jspi" "double" (func $double (param i32) (result i32))) (import "jspi" "immediate" (func $immediate (param i32) (result i32)))
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (if (result i32) (i32.and (local.get $i) (i32.const 1)) (then (call $step (local.get $i))) (else (local.get $i)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
