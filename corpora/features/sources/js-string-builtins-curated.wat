(module
  (import "wasm:js-string" "fromCharCode" (func $from-char (param i32) (result (ref extern))))
  (import "wasm:js-string" "charCodeAt" (func $char-at (param externref i32) (result i32)))
  (import "wasm:js-string" "fromCodePoint" (func $from-point (param i32) (result (ref extern))))
  (import "wasm:js-string" "codePointAt" (func $point-at (param externref i32) (result i32)))
  (import "wasm:js-string" "length" (func $length (param externref) (result i32)))

  (func (export "utf16-character-roundtrip") (param $n i32) (result i32)
    (local $i i32) (local $total i32)
    (block $done
      (br_if $done (i32.eqz (local.get $n)))
      (loop $again
        (local.set $total (i32.add (local.get $total) (call $char-at
    (call $from-char (i32.add (i32.const 945) (i32.rem_u (local.get $i) (i32.const 24))))
    (i32.const 0))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $again (i32.lt_u (local.get $i) (local.get $n)))))
    (local.get $total))

  (func (export "supplementary-codepoint-roundtrip") (param $n i32) (result i32)
    (local $i i32) (local $total i32) (local $s externref)
    (block $done
      (br_if $done (i32.eqz (local.get $n)))
      (loop $again
        (local.set $total (i32.add (local.get $total) (block (result i32)
    (local.set $s (call $from-point (i32.add (i32.const 128512) (i32.and (local.get $i) (i32.const 63)))))
    (i32.add (call $point-at (local.get $s) (i32.const 0))
      (i32.mul (call $length (local.get $s)) (i32.const 17))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $again (i32.lt_u (local.get $i) (local.get $n)))))
    (local.get $total))
)
