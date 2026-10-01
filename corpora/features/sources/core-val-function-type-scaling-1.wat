(module (func $f0 (param i32) (result i32) local.get 0 i32.const 0 i32.add) (func (export "benchmark") (param i32) (result i32) local.get 0 call $f0))
