(module
  (import "env" "memory" (memory 4 4 shared))
  (func (export "increment") (param $n i32) (param $address i32) (local $i i32)
    (loop $loop
      (drop (i32.atomic.rmw.add (local.get $address) (i32.const 1)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))))
