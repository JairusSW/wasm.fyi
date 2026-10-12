(module (memory 1 64 shared) (func (export "benchmark") (param i32) (result i32) (drop (memory.grow (local.get 0))) (memory.size)))
