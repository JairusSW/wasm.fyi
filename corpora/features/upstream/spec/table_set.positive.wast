;; Selected positive semantic cases from WebAssembly/spec.
;; Upstream revision: 970c4116e644e2bf7acb39aab8b733db14ccdf28
;; Upstream path: test/core/table_set.wast
;; Apache-2.0. See licenses/spec-test-LICENSE.
;; Selection only: no negative, exhaustion, malformed, or crash tests.
;; Not a complete official conformance suite; not performance evidence.

(module
  (table $t2 1 externref)
  (table $t3 2 funcref)
  (elem (table $t3) (i32.const 1) func $dummy)
  (func $dummy)

  (func (export "get-externref") (param $i i32) (result externref)
    (table.get $t2 (local.get $i))
  )
  (func $f3 (export "get-funcref") (param $i i32) (result funcref)
    (table.get $t3 (local.get $i))
  )

  (func (export "set-externref") (param $i i32) (param $r externref)
    (table.set (local.get $i) (local.get $r))
  )
  (func (export "set-funcref") (param $i i32) (param $r funcref)
    (table.set $t3 (local.get $i) (local.get $r))
  )
  (func (export "set-funcref-from") (param $i i32) (param $j i32)
    (table.set $t3 (local.get $i) (table.get $t3 (local.get $j)))
  )

  (func (export "is_null-funcref") (param $i i32) (result i32)
    (ref.is_null (call $f3 (local.get $i)))
  )
)

(assert_return (invoke "get-externref" (i32.const 0)) (ref.null extern))

(assert_return (invoke "set-externref" (i32.const 0) (ref.extern 1)))

(assert_return (invoke "get-externref" (i32.const 0)) (ref.extern 1))

(assert_return (invoke "set-externref" (i32.const 0) (ref.null extern)))

(assert_return (invoke "get-externref" (i32.const 0)) (ref.null extern))

(assert_return (invoke "get-funcref" (i32.const 0)) (ref.null func))

(assert_return (invoke "set-funcref-from" (i32.const 0) (i32.const 1)))

(assert_return (invoke "is_null-funcref" (i32.const 0)) (i32.const 0))

(assert_return (invoke "set-funcref" (i32.const 0) (ref.null func)))

(assert_return (invoke "get-funcref" (i32.const 0)) (ref.null func))

