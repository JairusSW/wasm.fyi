// Original adapter for the attributed Wasmtime strings.rs vectors. The two
// memories force canonical lowering/lifting to transcode across encodings.
export function stringRoundtripComponent(from, to) {
  if(!['utf8','utf16','latin1+utf16'].includes(from)||!['utf8','utf16','latin1+utf16'].includes(to))throw Error('Unknown canonical string encoding');
  const storage=`(memory (export "memory") 2 2)
    (global $heap (mut i32) (i32.const 1024))
    (func (export "realloc") (param $old i32) (param $oldlen i32) (param $align i32) (param $len i32) (result i32)
      (local $p i32)
      (local.set $p (i32.and (i32.add (global.get $heap) (i32.sub (local.get $align) (i32.const 1))) (i32.sub (i32.const 0) (local.get $align))))
      (global.set $heap (i32.add (local.get $p) (local.get $len)))
      (if (local.get $oldlen) (then (memory.copy (local.get $p) (local.get $old) (local.get $oldlen))))
      (local.get $p))`;
  return `(component
    (component $child
    (core module $source ${storage}
      (func (export "echo") (param $ptr i32) (param $len i32) (result i32)
        (i32.store (i32.const 0) (local.get $ptr))
        (i32.store (i32.const 4) (local.get $len)) (i32.const 0)))
    (core instance $s (instantiate $source))
    (func (export "echo") (param "value" string) (result string)
      (canon lift (core func $s "echo") (memory (core memory $s "memory")) (realloc (core func $s "realloc")) string-encoding=${from})))
    (instance $child-i (instantiate $child))
    (alias export $child-i "echo" (func $echo))
    (component $consumer
    (import "echo" (func $echo (param "value" string) (result string)))
    (core module $storage ${storage})
    (core instance $m (instantiate $storage))
    (core func $lower (canon lower (func $echo) (memory (core memory $m "memory")) (realloc (core func $m "realloc")) string-encoding=${to}))
    (core instance $imports (export "echo" (func $lower)) (export "memory" (memory $m "memory")))
    (core module $caller (import "host" "memory" (memory 2 2))
      (import "host" "echo" (func $echo (param i32 i32 i32)))
      (func (export "roundtrip") (param $ptr i32) (param $len i32) (result i32)
        (call $echo (local.get $ptr) (local.get $len) (i32.const 0)) (i32.const 0)))
    (core instance $c (instantiate $caller (with "host" (instance $imports))))
    (func (export "roundtrip") (param "value" string) (result string)
      (canon lift (core func $c "roundtrip") (memory (core memory $m "memory")) (realloc (core func $m "realloc")) string-encoding=${to})))
    (instance $consumer-i (instantiate $consumer (with "echo" (func $echo))))
    (alias export $consumer-i "roundtrip" (func $roundtrip))
    (export "roundtrip" (func $roundtrip)))`;
}
