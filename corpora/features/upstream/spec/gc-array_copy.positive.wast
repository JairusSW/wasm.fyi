;; Selected positive semantic cases from WebAssembly/spec.
;; Upstream revision: 970c4116e644e2bf7acb39aab8b733db14ccdf28
;; Upstream path: test/core/gc/array_copy.wast
;; Apache-2.0. See licenses/spec-test-LICENSE.
;; Selection only: no negative, exhaustion, malformed, or crash tests.
;; Not a complete official conformance suite; not performance evidence.

(module
  (type $arr8 (array i8))
  (type $arr8_mut (array (mut i8)))

  (global $g_arr8 (ref $arr8) (array.new $arr8 (i32.const 10) (i32.const 12)))
  (global $g_arr8_mut (mut (ref $arr8_mut)) (array.new_default $arr8_mut (i32.const 12)))

  (data $d1 "abcdefghijkl")

  (func (export "array_get_nth") (param $1 i32) (result i32)
    (array.get_u $arr8_mut (global.get $g_arr8_mut) (local.get $1))
  )

  (func (export "array_copy-null-left")
    (array.copy $arr8_mut $arr8 (ref.null $arr8_mut) (i32.const 0) (global.get $g_arr8) (i32.const 0) (i32.const 0))
  )

  (func (export "array_copy-null-right")
    (array.copy $arr8_mut $arr8 (global.get $g_arr8_mut) (i32.const 0) (ref.null $arr8) (i32.const 0) (i32.const 0))
  )

  (func (export "array_copy") (param $1 i32) (param $2 i32) (param $3 i32)
    (array.copy $arr8_mut $arr8 (global.get $g_arr8_mut) (local.get $1) (global.get $g_arr8) (local.get $2) (local.get $3))
  )

  (func (export "array_copy_overlap_test-1")
    (local $1 (ref $arr8_mut))
    (array.new_data $arr8_mut $d1 (i32.const 0) (i32.const 12))
    (local.set $1)
    (array.copy $arr8_mut $arr8_mut (local.get $1) (i32.const 1) (local.get $1) (i32.const 0) (i32.const 11))
    (global.set $g_arr8_mut (local.get $1))
  )

  (func (export "array_copy_overlap_test-2")
    (local $1 (ref $arr8_mut))
    (array.new_data $arr8_mut $d1 (i32.const 0) (i32.const 12))
    (local.set $1)
    (array.copy $arr8_mut $arr8_mut (local.get $1) (i32.const 0) (local.get $1) (i32.const 1) (i32.const 11))
    (global.set $g_arr8_mut (local.get $1))
  )
)

(assert_return (invoke "array_copy" (i32.const 12) (i32.const 0) (i32.const 0)))

(assert_return (invoke "array_copy" (i32.const 0) (i32.const 12) (i32.const 0)))

(assert_return (invoke "array_get_nth" (i32.const 0)) (i32.const 0))

(assert_return (invoke "array_get_nth" (i32.const 5)) (i32.const 0))

(assert_return (invoke "array_get_nth" (i32.const 11)) (i32.const 0))

(assert_return (invoke "array_copy" (i32.const 0) (i32.const 0) (i32.const 2)))

(assert_return (invoke "array_get_nth" (i32.const 0)) (i32.const 10))

(assert_return (invoke "array_get_nth" (i32.const 1)) (i32.const 10))

(assert_return (invoke "array_get_nth" (i32.const 2)) (i32.const 0))

(assert_return (invoke "array_copy_overlap_test-1"))

(assert_return (invoke "array_get_nth" (i32.const 0)) (i32.const 97))

(assert_return (invoke "array_get_nth" (i32.const 1)) (i32.const 97))

(assert_return (invoke "array_get_nth" (i32.const 2)) (i32.const 98))

(assert_return (invoke "array_get_nth" (i32.const 5)) (i32.const 101))

(assert_return (invoke "array_get_nth" (i32.const 10)) (i32.const 106))

(assert_return (invoke "array_get_nth" (i32.const 11)) (i32.const 107))

(assert_return (invoke "array_copy_overlap_test-2"))

(assert_return (invoke "array_get_nth" (i32.const 0)) (i32.const 98))

(assert_return (invoke "array_get_nth" (i32.const 1)) (i32.const 99))

(assert_return (invoke "array_get_nth" (i32.const 5)) (i32.const 103))

(assert_return (invoke "array_get_nth" (i32.const 9)) (i32.const 107))

(assert_return (invoke "array_get_nth" (i32.const 10)) (i32.const 108))

(assert_return (invoke "array_get_nth" (i32.const 11)) (i32.const 108))

