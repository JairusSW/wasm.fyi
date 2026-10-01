(module (memory 1 64) (func (export "benchmark") (param i32) (result i32) (drop (memory.grow (local.get 0))) (memory.size)))
