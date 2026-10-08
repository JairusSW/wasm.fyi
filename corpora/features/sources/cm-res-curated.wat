(component
 (core module $state
  (global $count (mut i64) (i64.const 0)) (global $sequence (mut i64) (i64.const 0))
  (func (export "reset") (global.set $count (i64.const 0)) (global.set $sequence (i64.const 0)))
  (func (export "drop") (param i32)
   (global.set $sequence (i64.add (global.get $sequence) (i64.const 1)))
   (global.set $count (i64.add (global.get $count) (i64.mul (global.get $sequence) (i64.extend_i32_u (local.get 0))))))
  (func (export "count") (result i64) (global.get $count)))
 (core instance $s (instantiate $state))
 (type $r (resource (rep i32) (dtor (core func $s "drop"))))
 (type $rb (resource (rep i32) (dtor (core func $s "drop"))))
 (core func $new (canon resource.new $r)) (core func $rep (canon resource.rep $r)) (core func $drop (canon resource.drop $r))
 (core func $new-b (canon resource.new $rb)) (core func $rep-b (canon resource.rep $rb)) (core func $drop-b (canon resource.drop $rb))
 (core instance $r (export "new" (func $new)) (export "rep" (func $rep)) (export "drop" (func $drop)) (export "new-b" (func $new-b)) (export "rep-b" (func $rep-b)) (export "drop-b" (func $drop-b)))
 (core module $bench
  (import "res" "new" (func $new (param i32) (result i32)))
(import "res" "rep" (func $rep (param i32) (result i32)))
(import "res" "new-b" (func $new-b (param i32) (result i32)))
(import "res" "rep-b" (func $rep-b (param i32) (result i32)))
  (import "res" "drop" (func $drop (param i32)))
(import "res" "drop-b" (func $drop-b (param i32)))
  (import "state" "reset" (func $reset)) (import "state" "count" (func $count (result i64)))

 (func (export "representation-checksum") (param $n i64) (result i64)
  (local $i i64) (local $sum i64) (local $h i32) (local $value i64) (call $reset)
  (block $done (loop $loop
   (br_if $done (i64.ge_u (local.get $i) (local.get $n)))
   (local.set $sum (i64.add (local.get $sum) (block (result i64) (local.set $h (call $new (i32.add (i32.mul (i32.wrap_i64 (local.get $i)) (i32.const 3)) (i32.const 1)))) (local.set $value (i64.extend_i32_u (call $rep (local.get $h)))) (call $drop (local.get $h)) (local.get $value))))
   (local.set $i (i64.add (local.get $i) (i64.const 1))) (br $loop))) (local.get $sum))

 (func (export "paired-live-resources") (param $n i64) (result i64)
  (local $i i64) (local $sum i64) (local $a i32) (local $b i32) (local $value i64) (call $reset)
  (block $done (loop $loop
   (br_if $done (i64.ge_u (local.get $i) (local.get $n)))
   (local.set $sum (i64.add (local.get $sum) (block (result i64) (local.set $a (call $new (i32.wrap_i64 (local.get $i)))) (local.set $b (call $new (i32.add (i32.wrap_i64 (local.get $i)) (i32.const 7)))) (local.set $value (i64.extend_i32_u (i32.mul (call $rep (local.get $a)) (call $rep (local.get $b))))) (call $drop (local.get $a)) (call $drop (local.get $b)) (local.get $value))))
   (local.set $i (i64.add (local.get $i) (i64.const 1))) (br $loop))) (local.get $sum))

 (func (export "reverse-release-batch") (param $n i64) (result i64)
  (local $i i64) (local $sum i64) (local $a i32) (local $b i32) (local $c i32) (local $value i64) (call $reset)
  (block $done (loop $loop
   (br_if $done (i64.ge_u (local.get $i) (local.get $n)))
   (local.set $sum (i64.add (local.get $sum) (block (result i64) (local.set $a (call $new (i32.wrap_i64 (local.get $i)))) (local.set $b (call $new (i32.add (i32.wrap_i64 (local.get $i)) (i32.const 1)))) (local.set $c (call $new (i32.add (i32.wrap_i64 (local.get $i)) (i32.const 2)))) (call $drop (local.get $c)) (call $drop (local.get $b)) (call $drop (local.get $a)) (i64.const 0))))
   (local.set $i (i64.add (local.get $i) (i64.const 1))) (br $loop))) (call $count))

 (func (export "alternating-resource-types") (param $n i64) (result i64)
  (local $i i64) (local $sum i64) (local $h i32) (local $value i64) (call $reset)
  (block $done (loop $loop
   (br_if $done (i64.ge_u (local.get $i) (local.get $n)))
   (local.set $sum (i64.add (local.get $sum) (if (result i64) (i32.and (i32.wrap_i64 (local.get $i)) (i32.const 1)) (then (local.set $h (call $new-b (i32.add (i32.wrap_i64 (local.get $i)) (i32.const 19)))) (local.set $value (i64.extend_i32_u (call $rep-b (local.get $h)))) (call $drop-b (local.get $h)) (local.get $value)) (else (local.set $h (call $new (i32.wrap_i64 (local.get $i)))) (local.set $value (i64.extend_i32_u (call $rep (local.get $h)))) (call $drop (local.get $h)) (local.get $value)))))
   (local.set $i (i64.add (local.get $i) (i64.const 1))) (br $loop))) (local.get $sum)))
 (core instance $b (instantiate $bench (with "res" (instance $r)) (with "state" (instance $s))))
 (func (export "representation-checksum") (param "count" u64) (result u64) (canon lift (core func $b "representation-checksum")))
(func (export "paired-live-resources") (param "count" u64) (result u64) (canon lift (core func $b "paired-live-resources")))
(func (export "reverse-release-batch") (param "count" u64) (result u64) (canon lift (core func $b "reverse-release-batch")))
(func (export "alternating-resource-types") (param "count" u64) (result u64) (canon lift (core func $b "alternating-resource-types"))))
