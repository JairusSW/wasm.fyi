(component
  (component $provider

   (core module $m (func (export "scale") (param i64) (result i64) (i64.mul (local.get 0) (i64.const 3)))
(func (export "bias") (param i64) (result i64) (i64.add (local.get 0) (i64.const 7))))
   (core instance $m (instantiate $m))
   (func (export "scale") (param "value" u64) (result u64) (canon lift (core func $m "scale")))
(func (export "bias") (param "value" u64) (result u64) (canon lift (core func $m "bias"))))
  (instance $p (instantiate $provider))

  (alias export $p "scale" (func $scale))
(alias export $p "bias" (func $bias))
  (component $consumer

   (import "scale" (func $scale (param "value" u64) (result u64)))
   (core func $scale (canon lower (func $scale)))
(import "bias" (func $bias (param "value" u64) (result u64)))
   (core func $bias (canon lower (func $bias)))
   (core instance $imports (export "scale" (func $scale)) (export "bias" (func $bias)))
   (core module $bench
    (import "ops" "scale" (func $scale (param i64) (result i64)))
(import "ops" "bias" (func $bias (param i64) (result i64)))

 (func (export "sibling-pipeline") (param $n i64) (result i64)
  (local $i i64) (local $sum i64)
  (block $done (loop $loop
   (br_if $done (i64.ge_u (local.get $i) (local.get $n)))
   (local.set $sum (i64.add (local.get $sum) (call $bias (call $scale (local.get $i)))))
   (local.set $i (i64.add (local.get $i) (i64.const 1))) (br $loop))) (local.get $sum))

 (func (export "fanout-reduction") (param $n i64) (result i64)
  (local $i i64) (local $sum i64)
  (block $done (loop $loop
   (br_if $done (i64.ge_u (local.get $i) (local.get $n)))
   (local.set $sum (i64.add (local.get $sum) (i64.add (call $scale (local.get $i)) (call $bias (local.get $i)))))
   (local.set $i (i64.add (local.get $i) (i64.const 1))) (br $loop))) (local.get $sum))

 (func (export "conditional-service") (param $n i64) (result i64)
  (local $i i64) (local $sum i64)
  (block $done (loop $loop
   (br_if $done (i64.ge_u (local.get $i) (local.get $n)))
   (local.set $sum (i64.add (local.get $sum) (if (result i64) (i64.eqz (i64.rem_u (local.get $i) (i64.const 3))) (then (call $scale (local.get $i))) (else (call $bias (local.get $i))))))
   (local.set $i (i64.add (local.get $i) (i64.const 1))) (br $loop))) (local.get $sum))

 (func (export "bounded-feedback") (param $n i64) (result i64)
  (local $i i64) (local $sum i64) (local $state i64)
  (block $done (loop $loop
   (br_if $done (i64.ge_u (local.get $i) (local.get $n)))
   (local.set $sum (i64.add (local.get $sum) (block (result i64) (local.set $state (i64.rem_u (call $bias (call $scale (local.get $state))) (i64.const 257))) (local.get $state))))
   (local.set $i (i64.add (local.get $i) (i64.const 1))) (br $loop))) (local.get $sum)))
   (core instance $b (instantiate $bench (with "ops" (instance $imports))))
   (func (export "sibling-pipeline") (param "count" u64) (result u64) (canon lift (core func $b "sibling-pipeline")))
(func (export "fanout-reduction") (param "count" u64) (result u64) (canon lift (core func $b "fanout-reduction")))
(func (export "conditional-service") (param "count" u64) (result u64) (canon lift (core func $b "conditional-service")))
(func (export "bounded-feedback") (param "count" u64) (result u64) (canon lift (core func $b "bounded-feedback"))))
  (instance $c (instantiate $consumer  (with "scale" (func $scale)) (with "bias" (func $bias))))
  (alias export $c "sibling-pipeline" (func $sibling-pipeline)) (export "sibling-pipeline" (func $sibling-pipeline))
(alias export $c "fanout-reduction" (func $fanout-reduction)) (export "fanout-reduction" (func $fanout-reduction))
(alias export $c "conditional-service" (func $conditional-service)) (export "conditional-service" (func $conditional-service))
(alias export $c "bounded-feedback" (func $bounded-feedback)) (export "bounded-feedback" (func $bounded-feedback)))
