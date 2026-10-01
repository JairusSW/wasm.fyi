(module (import "strings" "abcdefghijklmnopqrstuvwxyz" (global $s externref)) (import "wasm:js-string" "concat" (func $concat (param externref externref) (result (ref extern)))) (import "wasm:js-string" "charCodeAt" (func $char (param externref i32) (result i32)))
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (call $char (call $concat (global.get $s) (global.get $s)) (i32.rem_u (local.get $i) (i32.const 52)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))
