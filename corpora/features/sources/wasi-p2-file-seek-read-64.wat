(module (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32))) (import "wasi_snapshot_preview1" "fd_read" (func $read (param i32 i32 i32 i32) (result i32))) (import "wasi_snapshot_preview1" "path_open" (func $open (param i32 i32 i32 i32 i32 i64 i64 i32 i32) (result i32))) (import "wasi_snapshot_preview1" "fd_seek" (func $seek (param i32 i64 i32 i32) (result i32))) (import "wasi_snapshot_preview1" "fd_close" (func $close (param i32) (result i32))) (memory (export "memory") 2 256) (global $heap (mut i32) (i32.const 16384)) (func (export "cabi_realloc") (param $old i32) (param $oldsize i32) (param $align i32) (param $size i32) (result i32) (local $p i32) (if (local.get $old) (then unreachable)) (local.set $p (i32.and (i32.add (global.get $heap) (i32.sub (local.get $align) (i32.const 1))) (i32.sub (i32.const 0) (local.get $align)))) (global.set $heap (i32.add (local.get $p) (local.get $size))) (if (i32.gt_u (global.get $heap) (i32.mul (memory.size) (i32.const 65536))) (then (if (i32.eq (memory.grow (i32.const 2)) (i32.const -1)) (then unreachable)))) (local.get $p)) (data (i32.const 512) "probe.txt") (data (i32.const 4096) "ARIZQHYPGXOFWNEVMDULCTKBSJARIZQHYPGXOFWNEVMDULCTKBSJARIZQHYPGXOF")  (func (export "_start") (local $i i32) (local $previous i64) (local $sent i32) (local $received i32) (i32.store (i32.const 0) (i32.const 4096)) (i32.store (i32.const 4) (i32.const 64)) (if (call $open (i32.const 3) (i32.const 0) (i32.const 512) (i32.const 9) (i32.const 0) (i64.const 6) (i64.const 0) (i32.const 0) (i32.const 24)) (then unreachable))(if (call $seek (i32.load (i32.const 24)) (i64.const 3) (i32.const 0) (i32.const 16)) (then unreachable))(if (i64.ne (i64.load (i32.const 16)) (i64.const 3)) (then unreachable))(loop $clear
            (i32.store8 (i32.add (i32.const 4096) (local.get $received)) (i32.const 0))
            (local.set $received (i32.add (local.get $received) (i32.const 1)))
            (br_if $clear (i32.lt_u (local.get $received) (i32.const 64))))
          (local.set $received (i32.const 0))
          (loop $reads
            (i32.store (i32.const 0) (i32.add (i32.const 4096) (local.get $received)))
            (i32.store (i32.const 4) (i32.sub (i32.const 64) (local.get $received)))
            (if (call $read (i32.load (i32.const 24)) (i32.const 0) (i32.const 1) (i32.const 8)) (then unreachable))
            (if (i32.eqz (i32.load (i32.const 8))) (then unreachable))
            (if (i32.gt_u (i32.load (i32.const 8)) (i32.sub (i32.const 64) (local.get $received))) (then unreachable))
            (local.set $received (i32.add (local.get $received) (i32.load (i32.const 8))))
            (br_if $reads (i32.lt_u (local.get $received) (i32.const 64))))(if (call $close (i32.load (i32.const 24))) (then unreachable)) (loop $writes
        (i32.store (i32.const 0) (i32.add (i32.const 4096) (local.get $sent))) (i32.store (i32.const 4) (i32.sub (i32.const 64) (local.get $sent)))
        (if (call $write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)) (then unreachable))
        (if (i32.eqz (i32.load (i32.const 8))) (then unreachable))
        (if (i32.gt_u (i32.load (i32.const 8)) (i32.sub (i32.const 64) (local.get $sent))) (then unreachable))
        (local.set $sent (i32.add (local.get $sent) (i32.load (i32.const 8))))
        (br_if $writes (i32.lt_u (local.get $sent) (i32.const 64))))))
