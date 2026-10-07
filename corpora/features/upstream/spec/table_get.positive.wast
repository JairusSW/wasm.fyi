;; Selected positive semantic cases from WebAssembly/spec.
;; Upstream revision: 970c4116e644e2bf7acb39aab8b733db14ccdf28
;; Upstream path: test/core/table_get.wast
;; Apache-2.0. See licenses/spec-test-LICENSE.
;; Selection only: no negative, exhaustion, malformed, or crash tests.
;; Not a complete official conformance suite; not performance evidence.

(module
  (table $t2 2 externref)
  (table $t3 3 funcref)
  (elem (table $t3) (i32.const 1) func $dummy)
  (func $dummy)

  (func (export "init") (param $r externref)
    (table.set $t2 (i32.const 1) (local.get $r))
    (table.set $t3 (i32.const 2) (table.get $t3 (i32.const 1)))
  )

  (func (export "get-externref") (param $i i32) (result externref)
    (table.get (local.get $i))
  )
  (func $f3 (export "get-funcref") (param $i i32) (result funcref)
    (table.get $t3 (local.get $i))
  )
  (func (export "is_null-funcref") (param $i i32) (result i32)
    (ref.is_null (call $f3 (local.get $i)))
  )
)

(invoke "init" (ref.extern 1))

(assert_return (invoke "get-externref" (i32.const 0)) (ref.null extern))

(assert_return (invoke "get-externref" (i32.const 1)) (ref.extern 1))

(assert_return (invoke "get-funcref" (i32.const 0)) (ref.null func))

(assert_return (invoke "is_null-funcref" (i32.const 1)) (i32.const 0))

(assert_return (invoke "is_null-funcref" (i32.const 2)) (i32.const 0))

