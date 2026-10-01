// Original, deterministic feature workloads. Each operation has an independent
// arithmetic oracle; runtime output is never used to invent an expected value.
import { createHash } from 'node:crypto';
const streamDigest = text => createHash('sha256').update(text).digest('hex');
const sum = (n, value) => {
  let total = 0;
  for (let i = 0; i < n; i++) total = (total + value(i)) >>> 0;
  return total;
};
const scalarLoop = (expression, declarations = '', locals = '', before = '') => `
(module ${declarations}
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) ${locals}
    ${before}
    (loop $loop
      (local.set $a (i32.add (local.get $a) ${expression}))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))`;
const i = '(local.get $i)';
const mem = '(memory (export "memory") 2 256)';
const address = `(i32.shl (i32.and ${i} (i32.const 8191)) (i32.const 2))`;
const index = `(i32.and ${i} (i32.const 15))`;
const triangular = n => (n * (n - 1) / 2) >>> 0;
export const featureIds = ['core-num', 'core-mem', 'core-ctl', 'core-tab', 'core-val',
  'bulk-memory', 'reference-types', 'multi-value', 'simd', 'gc', 'memory64',
  'exceptions', 'tail-call', 'relaxed-simd', 'multi-memory', 'extended-const',
  'js-string-builtins', 'threads', 'stack-switching', 'wasi-p1', 'wasi-p2',
  'component-model', 'cm-abi', 'cm-res', 'cm-async'];

export function fixtures() {
  const out = [];
  const add = (feature, name, wat, expected, options = {}) => out.push({ feature, name, wat, expected,
    sizes: [1, 64, 4096], scope: 'execution', reset: 'stateless', ...options });
  const loop = (feature, name, expression, value, declarations = '', locals = '', before = '', options = {}) =>
    add(feature, name, scalarLoop(expression, declarations, locals, before), n => sum(n, value), options);
  const baseline = (feature, name, value, expression = i) =>
    loop(feature, name + '-scalar-baseline', expression, value, '', '', '', { baseline: true });

  loop('core-num', 'integer-multiply-add', `(i32.add (i32.mul ${i} (i32.const 17)) (i32.const 3))`, x => x * 17 + 3);
  loop('core-num', 'integer-div-rem', `(i32.add (i32.div_u ${i} (i32.const 7)) (i32.rem_u ${i} (i32.const 7)))`, x => Math.floor(x / 7) + x % 7);
  loop('core-num', 'integer-rotate-popcount', `(i32.popcnt (i32.rotl ${i} (i32.const 7)))`, x => {
    let bits = x >>> 0, count = 0; while (bits) { bits &= bits - 1; count++; } return count;
  });
  loop('core-num', 'f32-round-convert', `(i32.trunc_f32_u (f32.nearest (f32.div (f32.convert_i32_u ${i}) (f32.const 3))))`, x => Math.round(x / 3));
  loop('core-num', 'f64-sqrt-convert', `(i32.trunc_f64_u (f64.sqrt (f64.mul (f64.convert_i32_u ${i}) (f64.convert_i32_u ${i}))))`, x => x);
  loop('core-num', 'signed-zero-nan-bits', `(i32.eq (i32.reinterpret_f32 (f32.copysign (f32.const 0) (f32.neg (f32.convert_i32_u (i32.add ${i} (i32.const 1)))))) (i32.const -2147483648))`, () => 1);
  loop('core-mem', 'load-store-sequential', `(block (result i32) (i32.store ${address} ${i}) (i32.load ${address}))`, x => x, mem);
  loop('core-mem', 'load-store-unaligned', `(block (result i32) (i32.store align=1 (i32.add ${address} (i32.const 1)) ${i}) (i32.load align=1 (i32.add ${address} (i32.const 1))))`, x => x, mem);
  loop('core-mem', 'narrow-load-sign-extension', `(block (result i32) (i32.store8 ${address} (i32.sub (i32.and ${i} (i32.const 127)) (i32.const 128))) (i32.add (i32.load8_s ${address}) (i32.const 128)))`, x => x & 127, mem);
  add('core-mem', 'memory-grow', `(module (memory 1 64) (func (export "benchmark") (param i32) (result i32) (drop (memory.grow (local.get 0))) (memory.size)))`, n => n + 1,
    { sizes: [1, 4, 16], reset: 'fresh_instance_per_sample', workUnit: 'memory_page', scope: 'allocation' });
  loop('core-ctl', 'branch-mixed', `(if (result i32) (i32.and ${i} (i32.const 1)) (then (i32.mul ${i} (i32.const 3))) (else (i32.add ${i} (i32.const 7))))`, x => x & 1 ? x * 3 : x + 7);
  loop('core-ctl', 'direct-call', `(call $f ${i})`, x => x * 3 + 1, '(func $f (param i32) (result i32) local.get 0 i32.const 3 i32.mul i32.const 1 i32.add)');
  const indirect = '(type $t (func (param i32) (result i32))) (table 2 funcref) (elem (i32.const 0) $f $g) (func $f (type $t) local.get 0 i32.const 1 i32.add) (func $g (type $t) local.get 0 i32.const 3 i32.add)';
  loop('core-tab', 'indirect-call', `(call_indirect (type $t) ${i} (i32.and ${i} (i32.const 1)))`, x => x + (x & 1 ? 3 : 1), indirect);
  loop('core-tab', 'table-null-check', `(i32.eqz (ref.is_null (table.get (i32.and ${i} (i32.const 1)))))`, () => 1, indirect);
  for (const count of [1, 32, 256]) {
    const functions = Array.from({ length: count }, (_, k) => `(func $f${k} (param i32) (result i32) local.get 0 i32.const ${k} i32.add)`).join('\n');
    add('core-val', `function-type-scaling-${count}`, `(module ${functions} (func (export "benchmark") (param i32) (result i32) local.get 0 call $f${count - 1}))`, n => n + count - 1,
      { sizes: [7], units: count, dimension: 'function_count', size: count, scope: 'compile-and-instantiate' });
  }

  add('bulk-memory', 'fill', `(module ${mem} (func (export "benchmark") (param $n i32) (result i32) (memory.fill (i32.const 0) (i32.const 7) (local.get $n)) (i32.add (i32.load8_u (i32.const 0)) (i32.load8_u (i32.sub (local.get $n) (i32.const 1))))))`, () => 14,
    { sizes: [64, 4096, 65536], workUnit: 'byte', scope: 'memory-bandwidth' });
  add('bulk-memory', 'copy-overlap', `(module ${mem} (func (export "benchmark") (param $n i32) (result i32) (memory.fill (i32.const 0) (i32.const 11) (local.get $n)) (memory.copy (i32.const 1) (i32.const 0) (local.get $n)) (i32.add (i32.load8_u (i32.const 1)) (i32.load8_u (local.get $n)))))`, () => 22,
    { sizes: [64, 4096, 65536], workUnit: 'byte', scope: 'memory-bandwidth' });
  add('bulk-memory', 'init-drop', `(module ${mem} (data $d "abcdefg") (func (export "benchmark") (param i32) (result i32) (memory.init $d (i32.const 0) (i32.const 0) (i32.const 7)) (data.drop $d) (i32.add (i32.load8_u (i32.const 0)) (i32.load8_u (i32.const 6)))))`, () => 200,
    { sizes: [1], units: 7, reset: 'fresh_instance_per_sample', workUnit: 'byte' });
  loop('reference-types', 'table-get-set', `(block (result i32) (table.set ${index} (ref.func $f)) (i32.eqz (ref.is_null (table.get ${index}))))`, () => 1,
    '(table 16 funcref) (func $f) (elem declare func $f)');
  loop('reference-types', 'externref-null', `(ref.is_null (table.get ${index}))`, () => 1, '(table 16 externref)');
  loop('reference-types', 'table-fill-copy', `(block (result i32) (table.fill (i32.const 0) (ref.func $f) (i32.const 8)) (table.copy (i32.const 8) (i32.const 0) (i32.const 8)) (i32.eqz (ref.is_null (table.get ${index}))))`, () => 1,
    '(table 16 funcref) (func $f) (elem declare func $f)');
  loop('multi-value', 'pair-results', `(block (result i32) (call $pair ${i}) (i32.add))`, x => x * 3,
    '(func $pair (param i32) (result i32 i32) local.get 0 local.get 0 i32.const 2 i32.mul)');
  loop('multi-value', 'block-parameters', `(block (result i32) ${i} (i32.const 3) (block (param i32 i32) (result i32) i32.mul))`, x => x * 3);

  loop('simd', 'i32x4-add-multiply', `(i32x4.extract_lane 2 (i32x4.mul (i32x4.add (i32x4.splat ${i}) (i32x4.splat (i32.const 3))) (i32x4.splat (i32.const 7))))`, x => (x + 3) * 7);
  loop('simd', 'i8x16-saturating-add', `(i8x16.extract_lane_u 9 (i8x16.add_sat_u (i8x16.splat ${i}) (i8x16.splat (i32.const 7))))`, x => Math.min((x & 255) + 7, 255));
  loop('simd', 'swizzle-lanes', `(i8x16.extract_lane_u 3 (i8x16.swizzle (i8x16.splat ${i}) (v128.const i8x16 15 14 13 12 11 10 9 8 7 6 5 4 3 2 1 0)))`, x => x & 255);
  loop('simd', 'load-store-unaligned', `(block (result i32) (v128.store align=1 (i32.add ${address} (i32.const 1)) (i32x4.splat ${i})) (i32x4.extract_lane 3 (v128.load align=1 (i32.add ${address} (i32.const 1)))))`, x => x, mem);
  loop('simd', 'f32x4-sqrt', `(i32.trunc_f32_u (f32x4.extract_lane 1 (f32x4.sqrt (f32x4.mul (f32x4.splat (f32.convert_i32_u ${i})) (f32x4.splat (f32.convert_i32_u ${i}))))))`, x => x);
  baseline('simd', 'arithmetic', x => (x + 3) * 7, `(i32.mul (i32.add ${i} (i32.const 3)) (i32.const 7))`);
  loop('relaxed-simd', 'in-range-swizzle', `(i8x16.extract_lane_u 3 (i8x16.relaxed_swizzle (i8x16.splat ${i}) (v128.const i8x16 15 14 13 12 11 10 9 8 7 6 5 4 3 2 1 0)))`, x => x & 255);
  loop('relaxed-simd', 'exact-madd', `(i32.trunc_f32_u (f32x4.extract_lane 2 (f32x4.relaxed_madd (f32x4.splat (f32.convert_i32_u ${i})) (f32x4.splat (f32.const 2)) (f32x4.splat (f32.const 1)))))`, x => x * 2 + 1);
  loop('relaxed-simd', 'all-bits-laneselect', `(i32x4.extract_lane 1 (i32x4.relaxed_laneselect (i32x4.splat ${i}) (i32x4.splat (i32.const 99)) (i32x4.splat (i32.const -1))))`, x => x);

  loop('gc', 'struct-allocation-access', `(struct.get $s 0 (struct.new $s ${i}))`, x => x, '(type $s (struct (field (mut i32))))');
  loop('gc', 'array-allocation-access', `(array.get $a (array.new $a ${i} (i32.const 16)) ${index})`, x => x, '(type $a (array (mut i32)))');
  loop('gc', 'array-fill', `(block (result i32) (local.set $r (array.new $a (i32.const 0) (i32.const 16))) (array.fill $a (local.get $r) (i32.const 0) ${i} (i32.const 16)) (array.get $a (local.get $r) ${index}))`, x => x,
    '(type $a (array (mut i32)))', '(local $r (ref null $a))');
  loop('gc', 'i31-roundtrip', `(i31.get_u (ref.i31 ${i}))`, x => x);
  loop('gc', 'cast-subtype', `(struct.get $base 0 (ref.cast (ref $base) (struct.new $child ${i} (i32.const 7))))`, x => x,
    '(type $base (sub (struct (field i32)))) (type $child (sub $base (struct (field i32) (field i32))))');
  baseline('gc', 'access', x => x);
  const mem64 = '(memory (export "memory") i64 2 256)';
  loop('memory64', 'load-store', `(block (result i32) (i32.store (i64.extend_i32_u ${address}) ${i}) (i32.load (i64.extend_i32_u ${address})))`, x => x, mem64);
  add('memory64', 'fill-copy', `(module ${mem64} (func (export "benchmark") (param $n i32) (result i32) (memory.fill (i64.const 0) (i32.const 7) (i64.extend_i32_u (local.get $n))) (memory.copy (i64.const 65536) (i64.const 0) (i64.extend_i32_u (local.get $n))) (i32.load8_u (i64.add (i64.const 65536) (i64.extend_i32_u (i32.sub (local.get $n) (i32.const 1)))))))`, () => 7,
    { sizes: [64, 4096, 65536], workUnit: 'byte', scope: 'memory-bandwidth' });
  add('memory64', 'memory-grow', `(module (memory i64 1 64) (func (export "benchmark") (param i32) (result i32) (drop (memory.grow (i64.extend_i32_u (local.get 0)))) (i32.wrap_i64 (memory.size))))`, n => n + 1,
    { sizes: [1, 4, 16], reset: 'fresh_instance_per_sample', workUnit: 'memory_page', scope: 'allocation' });
  baseline('memory64', 'addressing', x => x);

  const caught = `(block $out (result i32) (try_table (catch $t $out) (throw $t ${i})) unreachable)`;
  loop('exceptions', 'throw-catch-tag', caught, x => x, '(tag $t (param i32))');
  loop('exceptions', 'throw-ref-recatch', `(block $out (result i32) (try_table (catch $t $out) (block $caught (result exnref) (try_table (catch_all_ref $caught) (throw $t ${i})) unreachable) throw_ref) unreachable)`, x => x, '(tag $t (param i32))');
  loop('exceptions', 'mixed-exception-path', `(block $out (result i32) (try_table (catch $t $out) (if (i32.and ${i} (i32.const 1)) (then (throw $t ${i}))) (br $out ${i})) unreachable)`, x => x, '(tag $t (param i32))');
  baseline('exceptions', 'normal-control', x => x);
  for (const indirectCall of [false, true]) {
    const recurse = indirectCall ? '(return_call_indirect (type $t) (i32.sub (local.get $n) (i32.const 1)) (i32.add (local.get $a) (i32.sub (local.get $n) (i32.const 1))) (i32.const 0))' : '(return_call $f (i32.sub (local.get $n) (i32.const 1)) (i32.add (local.get $a) (i32.sub (local.get $n) (i32.const 1))))';
    add('tail-call', indirectCall ? 'indirect-recursion' : 'direct-recursion', `(module (type $t (func (param i32 i32) (result i32))) ${indirectCall ? '(table 1 funcref) (elem (i32.const 0) $f)' : ''} (func $f (type $t) (param $n i32) (param $a i32) (result i32) (if (result i32) (i32.eqz (local.get $n)) (then (local.get $a)) (else ${recurse}))) (func (export "benchmark") (param i32) (result i32) (call $f (local.get 0) (i32.const 0))))`, triangular);
  }
  baseline('tail-call', 'iterative-recursion', x => x);
  const memories = '(memory $a 2 2) (memory $b 2 2)';
  loop('multi-memory', 'independent-addressing', `(block (result i32) (i32.store $a ${address} ${i}) (i32.store $b ${address} (i32.add ${i} (i32.const 7))) (i32.sub (i32.load $b ${address}) (i32.load $a ${address})))`, () => 7, memories);
  add('multi-memory', 'cross-memory-copy', `(module ${memories} (func (export "benchmark") (param $n i32) (result i32) (memory.fill $a (i32.const 0) (i32.const 13) (local.get $n)) (memory.copy $b $a (i32.const 0) (i32.const 0) (local.get $n)) (i32.load8_u $b (i32.sub (local.get $n) (i32.const 1)))))`, () => 13,
    { sizes: [64, 4096, 65536], workUnit: 'byte', scope: 'memory-bandwidth' });
  for (const count of [1, 32, 256]) {
    const globals = Array.from({ length: count }, (_, k) => `(global $g${k} i32 (i32.add (i32.const ${k}) (i32.mul (i32.const 7) (i32.const 6))))`).join('\n');
    add('extended-const', `initializer-scaling-${count}`, `(module ${globals} (func (export "benchmark") (param i32) (result i32) (global.get $g${count - 1})))`, () => count + 41,
      { sizes: [1], units: count, dimension: 'global_initializer_count', size: count, scope: 'compile-and-instantiate' });
  }
  const strings = '(import "strings" "abcdefghijklmnopqrstuvwxyz" (global $s externref))';
  loop('js-string-builtins', 'character-index', `(call $char (global.get $s) (i32.rem_u ${i} (i32.const 26)))`, x => 97 + x % 26,
    strings + ' (import "wasm:js-string" "charCodeAt" (func $char (param externref i32) (result i32)))', '', '', { hostProfile: 'js-string-builtins-v1' });
  loop('js-string-builtins', 'substring-length', `(call $length (call $sub (global.get $s) (i32.rem_u ${i} (i32.const 26)) (i32.const 26)))`, x => 26 - x % 26,
    strings + ' (import "wasm:js-string" "substring" (func $sub (param externref i32 i32) (result (ref extern)))) (import "wasm:js-string" "length" (func $length (param externref) (result i32)))', '', '', { hostProfile: 'js-string-builtins-v1' });
  loop('js-string-builtins', 'concat-character', `(call $char (call $concat (global.get $s) (global.get $s)) (i32.rem_u ${i} (i32.const 52)))`, x => 97 + x % 26,
    strings + ' (import "wasm:js-string" "concat" (func $concat (param externref externref) (result (ref extern)))) (import "wasm:js-string" "charCodeAt" (func $char (param externref i32) (result i32)))', '', '', { hostProfile: 'js-string-builtins-v1' });
  const shared = '(memory 2 2 shared)';
  loop('threads', 'atomic-load-store', `(block (result i32) (i32.atomic.store ${address} ${i}) (i32.atomic.load ${address}))`, x => x, shared, '', '', { hostProfile: 'threads-defined-v1' });
  loop('threads', 'atomic-rmw-add', `(block (result i32) (i32.atomic.store (i32.const 0) ${i}) (i32.atomic.rmw.add (i32.const 0) (i32.const 1)))`, x => x, shared, '', '', { hostProfile: 'threads-defined-v1' });
  loop('threads', 'atomic-compare-exchange', `(block (result i32) (i32.atomic.store (i32.const 0) ${i}) (i32.atomic.rmw.cmpxchg (i32.const 0) ${i} (i32.add ${i} (i32.const 1))))`, x => x, shared, '', '', { hostProfile: 'threads-defined-v1' });
  loop('threads', 'wait-mismatch-notify', `(block (result i32) (i32.atomic.store (i32.const 0) ${i}) (drop (memory.atomic.notify (i32.const 0) (i32.const 1))) (memory.atomic.wait32 (i32.const 0) (i32.add ${i} (i32.const 1)) (i64.const 0)))`, () => 1, shared, '', '', { hostProfile: 'threads-defined-v1' });
  loop('threads', 'atomic-fence', `(block (result i32) (atomic.fence) ${i})`, x => x, shared, '', '', { hostProfile: 'threads-defined-v1' });
  baseline('threads', 'non-atomic', x => x);
  // Actual proposal continuations, distinct from runtime-private snapshot APIs.
  add('stack-switching', 'continuation-create-resume', `(module (type $f (func (param i32) (result i32))) (type $c (cont $f)) (func $task (type $f) local.get 0 i32.const 7 i32.add) (elem declare func $task) (func (export "benchmark") (param i32) (result i32) (resume $c (local.get 0) (cont.new $c (ref.func $task)))))`, n => n + 7, { units: 1, workUnit: 'continuation', dimension: 'input_value' });

  loop('stack-switching', 'continuation-allocation-loop', `(resume $c ${i} (cont.new $c (ref.func $task)))`, x=>x+7,
    '(type $f (func (param i32) (result i32))) (type $c (cont $f)) (func $task (type $f) local.get 0 i32.const 7 i32.add) (elem declare func $task)');
  add('stack-switching', 'continuation-loop-body', `(module (type $f (func (param i32) (result i32))) (type $c (cont $f))
    (func $task (type $f) (local $i i32) (local $a i32) (loop $loop (local.set $a (i32.add (local.get $a) (local.get $i))) (local.set $i (i32.add (local.get $i) (i32.const 1))) (br_if $loop (i32.lt_u (local.get $i) (local.get 0)))) (local.get $a))
    (elem declare func $task) (func (export "benchmark") (param i32) (result i32) (resume $c (local.get 0) (cont.new $c (ref.func $task)))))`, triangular);
  for (const size of [1, 64, 4096]) {
    for (const operation of ['fd-write', 'stdin-read', 'clock-monotonic', 'random-get', 'arguments']) {
      const stdout = operation === 'random-get' ? 'ok' : operation === 'fd-write' || operation === 'stdin-read' ? 'x'.repeat(size) : 'x';
      const imports = ['(import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))'];
      let action = '';
      const check = expression => `(if ${expression} (then unreachable))`;
      if (operation === 'stdin-read') {
        imports.push('(import "wasi_snapshot_preview1" "fd_read" (func $read (param i32 i32 i32 i32) (result i32)))');
        action = check('(call $read (i32.const 0) (i32.const 0) (i32.const 1) (i32.const 8))') + check(`(i32.ne (i32.load (i32.const 8)) (i32.const ${size}))`);
      }
      if (operation === 'clock-monotonic') {
        imports.push('(import "wasi_snapshot_preview1" "clock_time_get" (func $clock (param i32 i64 i32) (result i32)))');
        action = `(loop $calls ${check('(call $clock (i32.const 1) (i64.const 0) (i32.const 16))')} ${check('(i64.lt_u (i64.load (i32.const 16)) (local.get $previous))')} (local.set $previous (i64.load (i32.const 16))) (local.set $i (i32.add (local.get $i) (i32.const 1))) (br_if $calls (i32.lt_u (local.get $i) (i32.const ${size}))))`;
      }
      if (operation === 'random-get') {
        imports.push('(import "wasi_snapshot_preview1" "random_get" (func $random (param i32 i32) (result i32)))');
        action = check(`(call $random (i32.const 8192) (i32.const ${size}))`);
      }
      if (operation === 'arguments') {
        imports.push('(import "wasi_snapshot_preview1" "args_sizes_get" (func $args_size (param i32 i32) (result i32))) (import "wasi_snapshot_preview1" "args_get" (func $args (param i32 i32) (result i32)))');
        action = check('(call $args_size (i32.const 16) (i32.const 20))') + check('(i32.ne (i32.load (i32.const 16)) (i32.const 2))') + check(`(i32.ne (i32.load (i32.const 20)) (i32.const ${size + 15}))`) + check('(call $args (i32.const 128) (i32.const 8192))');
      }
      const wat = `(module ${imports.join(' ')} (memory (export "memory") 2 256) (global $heap (mut i32) (i32.const 16384)) (func (export "cabi_realloc") (param $old i32) (param $oldsize i32) (param $align i32) (param $size i32) (result i32) (local $p i32) (if (local.get $old) (then unreachable)) (local.set $p (i32.and (i32.add (global.get $heap) (i32.sub (local.get $align) (i32.const 1))) (i32.sub (i32.const 0) (local.get $align)))) (global.set $heap (i32.add (local.get $p) (local.get $size))) (if (i32.gt_u (global.get $heap) (i32.mul (memory.size) (i32.const 65536))) (then (if (i32.eq (memory.grow (i32.const 2)) (i32.const -1)) (then unreachable)))) (local.get $p)) (data (i32.const 4096) "${stdout}") (func (export "_start") (local $i i32) (local $previous i64) (i32.store (i32.const 0) (i32.const 4096)) (i32.store (i32.const 4) (i32.const ${stdout.length})) ${action} ${check('(call $write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8))')}))`;
      for (const feature of ['wasi-p1', 'wasi-p2']) {
        add(feature, `${operation}-${size}`, wat, () => 0, { sizes: [size], abi: feature === 'wasi-p1' ? 'wasi-command' : 'component',
          export: '_start', args: () => [], reset: 'fresh_instance_per_sample',
          hostProfile: feature === 'wasi-p1' ? 'wasi-preview1-readonly-v1' : 'wasi-preview2-readonly-v1',
          wasiAdapter: feature === 'wasi-p2', scope: operation === 'random-get' ? 'host-interface-result-code' : 'host-interface',
          workUnit: operation === 'clock-monotonic' ? 'host_call' : 'byte',
          oracle: () => ({ kind: 'exact_command', expected: [] }),
          command: () => ({ argv: operation === 'arguments' ? ['feature-probe', 'x'.repeat(size)] : ['feature-probe'],
            ...(operation === 'stdin-read' ? { stdin: Buffer.from(stdout).toString('base64') } : {}),
            exit_code: 0, stdout_sha256: streamDigest(stdout), stderr_sha256: streamDigest(''), output_limit_bytes: 1 << 20 }) });
      }
    }
  }
  const component = `(component
    (component $child
      (core module $m (func (export "step") (param i64) (result i64) local.get 0 i64.const 1 i64.add))
      (core instance $i (instantiate $m))
      (func (export "step") (param "value" u64) (result u64) (canon lift (core func $i "step"))))
    (instance $ci (instantiate $child))
    (alias export $ci "step" (func $step))
    (component $caller
      (import "step" (func $step (param "value" u64) (result u64)))
    (core func $lower (canon lower (func $step)))
    (core instance $host (export "step" (func $lower)))
    (core module $bench (import "host" "step" (func $step (param i64) (result i64)))
      (func (export "benchmark") (param $n i64) (result i64) (local $i i64) (local $sum i64)
        (loop $loop (local.set $sum (i64.add (local.get $sum) (call $step (local.get $i))))
          (local.set $i (i64.add (local.get $i) (i64.const 1))) (br_if $loop (i64.lt_u (local.get $i) (local.get $n)))) (local.get $sum)))
    (core instance $b (instantiate $bench (with "host" (instance $host))))
    (func (export "benchmark") (param "count" u64) (result u64) (canon lift (core func $b "benchmark"))))
    (instance $caller-i (instantiate $caller (with "step" (func $step))))
    (alias export $caller-i "benchmark" (func $benchmark))
    (export "benchmark" (func $benchmark)))`;
  add('component-model', 'nested-component-calls', component, n => n * (n + 1) / 2,
    { abi: 'component', hostProfile: 'component-u64-v1', reset: 'fresh_instance_per_sample', workUnit: 'canonical_crossing' });
  add('cm-abi', 'u64-lower-lift-roundtrip', component, n => n * (n + 1) / 2,
    { abi: 'component', hostProfile: 'component-u64-v1', reset: 'fresh_instance_per_sample', workUnit: 'canonical_crossing' });
  add('cm-res', 'resource-new-drop-destructor', `(component
    (core module $d (global $count (mut i64) (i64.const 0)) (func (export "drop") (param i32) (global.set $count (i64.add (global.get $count) (i64.const 1)))) (func (export "count") (result i64) global.get $count))
    (core instance $di (instantiate $d))
    (type $r (resource (rep i32) (dtor (core func $di "drop"))))
    (core func $new (canon resource.new $r)) (core func $drop (canon resource.drop $r))
    (core instance $res (export "new" (func $new)) (export "drop" (func $drop)))
    (core module $m (import "res" "new" (func $new (param i32) (result i32))) (import "res" "drop" (func $drop (param i32))) (import "count" "count" (func $count (result i64)))
      (func (export "benchmark") (param $n i64) (result i64) (local $i i64)
        (loop $loop (call $drop (call $new (i32.wrap_i64 (local.get $i)))) (local.set $i (i64.add (local.get $i) (i64.const 1))) (br_if $loop (i64.lt_u (local.get $i) (local.get $n)))) (call $count)))
    (core instance $mi (instantiate $m (with "res" (instance $res)) (with "count" (instance $di))))
    (func (export "benchmark") (param "count" u64) (result u64) (canon lift (core func $mi "benchmark"))))`, n => n,
    { abi: 'component', hostProfile: 'component-u64-v1', reset: 'fresh_instance_per_sample', workUnit: 'resource_lifetime' });
  add('cm-async', 'future-stream-compile', `(component (type $f (future u32)) (type $s (stream u32)) (core func (canon future.new $f)) (core func (canon stream.new $s)))`, () => 0,
    { sizes: [1], abi: 'component', export: '', args: () => [], scope: 'compile-only', workUnit: 'component',
      oracle: () => ({ kind: 'component_compile_only', expected: [] }) });

  for (const count of [32,256]) {
    const builtins=Array.from({length:count},()=>'(core func (canon future.new $f)) (core func (canon stream.new $s))').join('\n');
    add('cm-async', `future-stream-scaling-${count}`, `(component (type $f (future u32)) (type $s (stream u32)) ${builtins})`, ()=>0,
      { sizes:[1], units:1, size:count*2, dimension:'canonical_async_builtin_count', abi:'component', export:'', args:()=>[], scope:'compile-only', workUnit:'component', oracle:()=>({kind:'component_compile_only',expected:[]}) });
  }

  return out;
}
