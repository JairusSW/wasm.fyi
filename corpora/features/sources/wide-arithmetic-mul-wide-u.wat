(module
  (func (export "benchmark") (param $n i32) (result i32)
   (local $i i32) (local $sum i32) (local $lo i64) (local $hi i64)
   (loop $loop
    (i64.add (i64.mul (i64.extend_i32_u (local.get $i)) (i64.const 0x9e3779b97f4a7c15)) (i64.const 0x8000000000000001)) (i64.mul (i64.add (i64.extend_i32_u (local.get $i)) (i64.const 1)) (i64.const 0xd1342543de82ef95))
    i64.mul_wide_u local.set $hi local.set $lo
    (local.set $sum (i32.add (local.get $sum)
     (i32.wrap_i64 (i64.xor (i64.xor (local.get $lo) (i64.shr_u (local.get $lo) (i64.const 32)))
      (i64.xor (local.get $hi) (i64.shr_u (local.get $hi) (i64.const 32)))))))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
   (local.get $sum)))
