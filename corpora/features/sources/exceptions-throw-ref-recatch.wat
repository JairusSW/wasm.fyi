(module (tag $t (param i32))
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (block $out (result i32) (try_table (catch $t $out) (block $caught (result exnref) (try_table (catch_all_ref $caught) (throw $t (local.get $i))) unreachable) throw_ref) unreachable)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
