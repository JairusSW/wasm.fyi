(module (memory i64 1 64) (func (export "benchmark") (param i32) (result i32) (drop (memory.grow (i64.extend_i32_u (local.get 0)))) (i32.wrap_i64 (memory.size))))
