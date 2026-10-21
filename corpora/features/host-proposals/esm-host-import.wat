(module (import "./esm-host.mjs" "step" (func $step (param i32) (result i32))) (func (export "benchmark") (param i32) (result i32) local.get 0 call $step))
