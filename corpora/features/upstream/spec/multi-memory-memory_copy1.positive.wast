;; Selected positive semantic cases from WebAssembly/spec.
;; Upstream revision: 970c4116e644e2bf7acb39aab8b733db14ccdf28
;; Upstream path: test/core/multi-memory/memory_copy1.wast
;; Apache-2.0. See licenses/spec-test-LICENSE.
;; Selection only: no negative, exhaustion, malformed, or crash tests.
;; Not a complete official conformance suite; not performance evidence.

(module
  (memory $mem0 (data "\ff\11\44\ee"))
  (memory $mem1 (data "\ee\22\55\ff"))
  (memory $mem2 (data "\dd\33\66\00"))
  (memory $mem3 (data "\aa\bb\cc\dd"))

  (func (export "copy") (param i32 i32 i32)
    (memory.copy $mem0 $mem3
      (local.get 0)
      (local.get 1)
      (local.get 2)))

  (func (export "load8_u") (param i32) (result i32)
    (i32.load8_u $mem0 (local.get 0)))
)

(invoke "copy" (i32.const 10) (i32.const 0) (i32.const 4))

(assert_return (invoke "load8_u" (i32.const 9)) (i32.const 0))

(assert_return (invoke "load8_u" (i32.const 10)) (i32.const 0xaa))

(assert_return (invoke "load8_u" (i32.const 11)) (i32.const 0xbb))

(assert_return (invoke "load8_u" (i32.const 12)) (i32.const 0xcc))

(assert_return (invoke "load8_u" (i32.const 13)) (i32.const 0xdd))

(assert_return (invoke "load8_u" (i32.const 14)) (i32.const 0))

(invoke "copy" (i32.const 0xff00) (i32.const 0) (i32.const 0x100))

(invoke "copy" (i32.const 0xfe00) (i32.const 0xff00) (i32.const 0x100))

(invoke "copy" (i32.const 0x10000) (i32.const 0) (i32.const 0))

(invoke "copy" (i32.const 0) (i32.const 0x10000) (i32.const 0))

