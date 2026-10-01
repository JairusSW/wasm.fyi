(module (import "strings" "abcdefghijklmnopqrstuvwxyz" (global $s externref)) (import "wasm:js-string" "substring" (func $sub (param externref i32 i32) (result (ref extern)))) (import "wasm:js-string" "length" (func $length (param externref) (result i32)))
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (call $length (call $sub (global.get $s) (i32.rem_u (local.get $i) (i32.const 26)) (i32.const 26)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
