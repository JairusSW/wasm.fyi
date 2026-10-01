(module (tag $t (param i32))
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (block $out (result i32) (try_table (catch $t $out) (if (i32.and (local.get $i) (i32.const 1)) (then (throw $t (local.get $i)))) (br $out (local.get $i))) unreachable)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
