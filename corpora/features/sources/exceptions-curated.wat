(module
  (tag $pair (param i32 i32))
  (tag $inner (param i32))
  (tag $outer (param i32))

  (func (export "multi-payload-catch") (param $n i32) (result i32)
    (local $i i32) (local $total i32)
    (block $done
      (br_if $done (i32.eqz (local.get $n)))
      (loop $again
        (local.set $total (i32.add (local.get $total) (block (result i32)
    (block $caught (result i32 i32)
      (try_table (catch $pair $caught)
        (throw $pair (local.get $i) (i32.add (i32.mul (local.get $i) (i32.const 3)) (i32.const 7))))
      unreachable)
    i32.add)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $again (i32.lt_u (local.get $i) (local.get $n)))))
    (local.get $total))

  (func (export "nested-tag-dispatch") (param $n i32) (result i32)
    (local $i i32) (local $total i32)
    (block $done
      (br_if $done (i32.eqz (local.get $n)))
      (loop $again
        (local.set $total (i32.add (local.get $total) (block $outer-caught (result i32)
    (try_table (catch $outer $outer-caught)
      (block $inner-caught (result i32)
        (try_table (catch $inner $inner-caught)
          (if (i32.and (local.get $i) (i32.const 1))
            (then (throw $inner (i32.add (local.get $i) (i32.const 5)))))
          (throw $outer (i32.add (local.get $i) (i32.const 11))))
        unreachable)
      (i32.const 17)
      i32.add
      (br $outer-caught))
    unreachable)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $again (i32.lt_u (local.get $i) (local.get $n)))))
    (local.get $total))
)
