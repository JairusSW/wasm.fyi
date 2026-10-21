(module (tag $a (param i32)) (tag $b (param i32))
 (func (export "benchmark") (param $n i32) (result i32)
  (local $i i32) (local $sum i32)  
  (block $done (br_if $done (i32.eqz (local.get $n)))
   (loop $again
    (local.set $sum (i32.add (local.get $sum) (block (result i32) try (result i32) (local.get $i) throw $b catch $a drop (i32.const 0) catch $b (i32.const 3) i32.add end)))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $again (i32.lt_u (local.get $i) (local.get $n))))) (local.get $sum)))
