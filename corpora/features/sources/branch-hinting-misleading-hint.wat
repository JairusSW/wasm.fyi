(module 
 (func (export "benchmark") (param $n i32) (result i32)
  (local $i i32) (local $sum i32)  
  (block $done (br_if $done (i32.eqz (local.get $n)))
   (loop $again
    (local.set $sum (i32.add (local.get $sum) (block (result i32) (i32.eqz (i32.and (local.get $i) (i32.const 31)))
  (@metadata.code.branch_hint "\01") if (result i32) (i32.const 31) else (i32.const 2) end)))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $again (i32.lt_u (local.get $i) (local.get $n))))) (local.get $sum)))
