;; Selected positive semantic cases from WebAssembly/spec.
;; Upstream revision: 970c4116e644e2bf7acb39aab8b733db14ccdf28
;; Upstream path: test/core/gc/i31.wast
;; Apache-2.0. See licenses/spec-test-LICENSE.
;; Selection only: no negative, exhaustion, malformed, or crash tests.
;; Not a complete official conformance suite; not performance evidence.

(module
  (func (export "new") (param $i i32) (result (ref i31))
    (ref.i31 (local.get $i))
  )

  (func (export "get_u") (param $i i32) (result i32)
    (i31.get_u (ref.i31 (local.get $i)))
  )
  (func (export "get_s") (param $i i32) (result i32)
    (i31.get_s (ref.i31 (local.get $i)))
  )

  (func (export "get_u-null") (result i32)
    (i31.get_u (ref.null i31))
  )
  (func (export "get_s-null") (result i32)
    (i31.get_s (ref.null i31))
  )

  (global $i (ref i31) (ref.i31 (i32.const 2)))
  (global $m (mut (ref i31)) (ref.i31 (i32.const 3)))

  (func (export "get_globals") (result i32 i32)
    (i31.get_u (global.get $i))
    (i31.get_u (global.get $m))
  )

  (func (export "set_global") (param i32)
    (global.set $m (ref.i31 (local.get 0)))
  )
)

(assert_return (invoke "new" (i32.const 1)) (ref.i31))

(assert_return (invoke "get_u" (i32.const 0)) (i32.const 0))

(assert_return (invoke "get_u" (i32.const 100)) (i32.const 100))

(assert_return (invoke "get_u" (i32.const -1)) (i32.const 0x7fff_ffff))

(assert_return (invoke "get_u" (i32.const 0x3fff_ffff)) (i32.const 0x3fff_ffff))

(assert_return (invoke "get_u" (i32.const 0x4000_0000)) (i32.const 0x4000_0000))

(assert_return (invoke "get_u" (i32.const 0x7fff_ffff)) (i32.const 0x7fff_ffff))

(assert_return (invoke "get_u" (i32.const 0xaaaa_aaaa)) (i32.const 0x2aaa_aaaa))

(assert_return (invoke "get_u" (i32.const 0xcaaa_aaaa)) (i32.const 0x4aaa_aaaa))

(assert_return (invoke "get_s" (i32.const 0)) (i32.const 0))

(assert_return (invoke "get_s" (i32.const 100)) (i32.const 100))

(assert_return (invoke "get_s" (i32.const -1)) (i32.const -1))

(assert_return (invoke "get_s" (i32.const 0x3fff_ffff)) (i32.const 0x3fff_ffff))

(assert_return (invoke "get_s" (i32.const 0x4000_0000)) (i32.const -0x4000_0000))

(assert_return (invoke "get_s" (i32.const 0x7fff_ffff)) (i32.const -1))

(assert_return (invoke "get_s" (i32.const 0xaaaa_aaaa)) (i32.const 0x2aaa_aaaa))

(assert_return (invoke "get_s" (i32.const 0xcaaa_aaaa)) (i32.const 0xcaaa_aaaa))

