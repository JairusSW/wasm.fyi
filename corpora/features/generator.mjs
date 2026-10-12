// Original, deterministic feature workloads. Each operation has an independent
// arithmetic oracle; runtime output is never used to invent an expected value.
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
export const featureIds = ['core-num', 'core-mem', 'core-ctl', 'core-tab', 'core-val', 'core-glb',
  'sign-extension', 'saturating-float-to-int', 'mutable-globals',
  'bulk-memory', 'reference-types', 'multi-value', 'simd', 'gc', 'memory64',
  'exceptions', 'tail-call', 'relaxed-simd', 'multi-memory', 'extended-const',
  'js-string-builtins', 'jspi', 'threads',
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
  loop('core-num', 'signed-zero-bits', `(i32.eq (i32.reinterpret_f32 (f32.copysign (f32.const 0) (f32.neg (f32.convert_i32_u (i32.add ${i} (i32.const 1)))))) (i32.const -2147483648))`, () => 1);
  loop('core-mem', 'load-store-sequential', `(block (result i32) (i32.store ${address} ${i}) (i32.load ${address}))`, x => x, mem);
  loop('core-mem', 'load-store-unaligned', `(block (result i32) (i32.store align=1 (i32.add ${address} (i32.const 1)) ${i}) (i32.load align=1 (i32.add ${address} (i32.const 1))))`, x => x, mem);
  loop('core-mem', 'narrow-load-sign-extension', `(block (result i32) (i32.store8 ${address} (i32.sub (i32.and ${i} (i32.const 127)) (i32.const 128))) (i32.add (i32.load8_s ${address}) (i32.const 128)))`, x => x & 127, mem);
  add('core-mem', 'memory-grow', `(module (memory 1 64) (func (export "benchmark") (param i32) (result i32) (drop (memory.grow (local.get 0))) (memory.size)))`, n => n + 1,
    { sizes: [1, 4, 16], reset: 'fresh_instance_per_sample', workUnit: 'memory_page', scope: 'allocation' });
  loop('core-ctl', 'branch-mixed', `(if (result i32) (i32.and ${i} (i32.const 1)) (then (i32.mul ${i} (i32.const 3))) (else (i32.add ${i} (i32.const 7))))`, x => x & 1 ? x * 3 : x + 7);
  loop('core-ctl', 'direct-call', `(call $f ${i})`, x => x * 3 + 1, '(func $f (param i32) (result i32) local.get 0 i32.const 3 i32.mul i32.const 1 i32.add)');
  const indirect = '(type $t (func (param i32) (result i32))) (table 2 funcref) (elem (i32.const 0) $f $g) (func $f (type $t) local.get 0 i32.const 1 i32.add) (func $g (type $t) local.get 0 i32.const 3 i32.add)';
  loop('core-tab', 'indirect-call', `(call_indirect (type $t) ${i} (i32.and ${i} (i32.const 1)))`, x => x + (x & 1 ? 3 : 1), indirect);
  // MVP globals. Mutable state is reset on entry so repeated invocations of one
  // instance agree with the stateless oracle.
  const globalFamily = (feature, exported) => {
    const ex = name => exported ? `(export "${name}")` : '';
    loop(feature, exported ? 'exported-read' : 'immutable-constant', '(global.get $k)', () => 41, `(global $k ${ex('k')} ${exported ? '(mut i32)' : 'i32'} (i32.const 41))`);
    loop(feature, 'mutable-accumulate', `(block (result i32) (global.set $g (i32.add (global.get $g) ${i})) (global.get $g))`, x => (x * (x + 1) / 2) >>> 0,
      `(global $g ${ex('g')} (mut i32) (i32.const 0))`, '', '(global.set $g (i32.const 0))');
    loop(feature, 'i64-global-split', `(block (result i32) (global.set $w (i64.mul (i64.extend_i32_u ${i}) (i64.const 4294967297))) (i32.add (i32.wrap_i64 (global.get $w)) (i32.wrap_i64 (i64.shr_u (global.get $w) (i64.const 32)))))`, x => 2 * x,
      `(global $w ${ex('w')} (mut i64) (i64.const 0))`);
    loop(feature, 'f64-global-scale', `(block (result i32) (global.set $f (f64.mul (f64.convert_i32_u ${i}) (f64.const 0.5))) (i32.trunc_f64_u (f64.mul (global.get $f) (f64.const 4))))`, x => 2 * x,
      `(global $f ${ex('f')} (mut f64) (f64.const 0))`);
    loop(feature, 'global-swap', `(block (result i32) (global.set $a ${i}) (global.set $b (i32.add ${i} (i32.const 3))) (global.set $t (global.get $a)) (global.set $a (global.get $b)) (global.set $b (global.get $t)) (i32.sub (global.get $a) (global.get $b)))`, () => 3,
      `(global $a ${ex('a')} (mut i32) (i32.const 0)) (global $b ${ex('b')} (mut i32) (i32.const 0)) (global $t (mut i32) (i32.const 0))`);
    add(feature, 'dependent-read-write', scalarLoop(`(block (result i32)
      (global.set $state (i32.xor (i32.rotl (global.get $state) (i32.const 5))
        (i32.add ${i} (i32.const 17)))) (global.get $state))`,
      `(global $state ${ex('state')} (mut i32) (i32.const 0))`, '', '(global.set $state (i32.const -1640531527))'), n => {
      let state = 0x9e3779b9, checksum = 0;
      for (let j = 0; j < n; j++) { state = (((state << 5) | (state >>> 27)) ^ (j + 17)) >>> 0; checksum = (checksum + state) >>> 0; }
      return checksum;
    });
    add(feature, 'i64-carry-overflow', scalarLoop(`(block (result i32)
      (global.set $wide (i64.add (global.get $wide) (i64.const 4294967313)))
      (i32.xor (i32.wrap_i64 (global.get $wide))
        (i32.wrap_i64 (i64.shr_u (global.get $wide) (i64.const 32)))))`,
      `(global $wide ${ex('wide')} (mut i64) (i64.const 0))`, '', '(global.set $wide (i64.const -16))'), n => {
      let wide = 0xfffffffffffffff0n, checksum = 0;
      for (let j = 0; j < n; j++) { wide = BigInt.asUintN(64, wide + 4294967313n); checksum = (checksum + Number(BigInt.asUintN(32, wide ^ (wide >> 32n)))) >>> 0; }
      return checksum;
    });
    add(feature, 'f32-rounding-state', scalarLoop(`(block (result i32)
      (global.set $single (f32.add (global.get $single)
        (f32.convert_i32_u (i32.add (i32.const 1) (i32.shl (i32.and ${i} (i32.const 1)) (i32.const 1))))))
      (i32.reinterpret_f32 (global.get $single)))`,
      `(global $single ${ex('single')} (mut f32) (f32.const 0))`, '', '(global.set $single (f32.const 16777216))'), n => {
      const view = new DataView(new ArrayBuffer(4)); let single = 16777216, checksum = 0;
      for (let j = 0; j < n; j++) { single = Math.fround(single + (j % 2 ? 3 : 1)); view.setFloat32(0, single, true); checksum = (checksum + view.getUint32(0, true)) >>> 0; }
      return checksum;
    });
  };
  globalFamily('core-glb', false);
  // Import/export of mutable globals: the same algorithms over exported mutable globals.
  globalFamily('mutable-globals', true);

  // JS Promise Integration. The host (profile jspi-v1) supplies WebAssembly.Suspending
  // imports: step(i) and double(i) resolve asynchronously, so each call suspends the Wasm
  // stack; immediate(i) returns synchronously and must not suspend. The export is called
  // through WebAssembly.promising and awaited.
  const jspi = '(import "jspi" "step" (func $step (param i32) (result i32))) (import "jspi" "double" (func $double (param i32) (result i32))) (import "jspi" "immediate" (func $immediate (param i32) (result i32)))';
  const jspiOptions = { hostProfile: 'jspi-v1' };
  loop('jspi', 'suspend-every-call', `(call $step ${i})`, x => x * 3 + 1, jspi, '', '', jspiOptions);
  loop('jspi', 'suspend-alternate', `(if (result i32) (i32.and ${i} (i32.const 1)) (then (call $step ${i})) (else ${i}))`, x => x & 1 ? x * 3 + 1 : x, jspi, '', '', jspiOptions);
  loop('jspi', 'two-imports', `(i32.add (call $step ${i}) (call $double ${i}))`, x => x * 5 + 1, jspi, '', '', jspiOptions);
  loop('jspi', 'state-across-suspension', `(block (result i32) (i32.store ${address} ${i}) (drop (call $step ${i})) (i32.add (i32.load ${address}) (call $double ${i})))`, x => x * 3,
    jspi + ' ' + mem, '', '', jspiOptions);
  loop('jspi', 'immediate-resolve', `(call $immediate ${i})`, x => x + 7, jspi, '', '', jspiOptions);

  // Sign-extension operators (Wasm 2.0).
  const sext = (v, bits) => (v << (32 - bits)) >> (32 - bits);
  loop('sign-extension', 'i32-extend8', `(i32.extend8_s ${i})`, x => sext(x, 8));
  loop('sign-extension', 'i32-extend16', `(i32.extend16_s (i32.mul ${i} (i32.const 97)))`, x => sext(Math.imul(x, 97), 16));
  loop('sign-extension', 'i64-extend8', `(i32.wrap_i64 (i64.extend8_s (i64.extend_i32_u (i32.mul ${i} (i32.const 13)))))`, x => sext(Math.imul(x, 13), 8));
  loop('sign-extension', 'i64-extend16', `(i32.wrap_i64 (i64.extend16_s (i64.extend_i32_u (i32.mul ${i} (i32.const 31)))))`, x => sext(Math.imul(x, 31), 16));
  loop('sign-extension', 'i64-extend32-high-word', `(i32.wrap_i64 (i64.shr_s (i64.extend32_s (i64.extend_i32_u (i32.mul ${i} (i32.const 1048583)))) (i64.const 32)))`, x => (Math.imul(x, 1048583) < 0 ? -1 : 0));

  // Non-trapping (saturating) float-to-int conversions (Wasm 2.0).
  loop('saturating-float-to-int', 'f32-in-range', `(i32.trunc_sat_f32_s (f32.mul (f32.convert_i32_u ${i}) (f32.const 1.5)))`, x => Math.trunc(x * 1.5));
  loop('saturating-float-to-int', 'f32-overflow-clamp', `(i32.trunc_sat_f32_s (f32.mul (f32.convert_i32_u (i32.add ${i} (i32.const 1))) (f32.const 1e10)))`, () => 2147483647);
  loop('saturating-float-to-int', 'f64-unsigned-negative-clamp', `(i32.add ${i} (i32.trunc_sat_f64_u (f64.neg (f64.convert_i32_u ${i}))))`, x => x);
  loop('saturating-float-to-int', 'nan-and-infinity', `(i32.trunc_sat_f32_s (f32.div (f32.convert_i32_u ${i}) (f32.const 0)))`, x => (x === 0 ? 0 : 2147483647));
  loop('saturating-float-to-int', 'i64-in-range', `(i32.wrap_i64 (i64.trunc_sat_f64_s (f64.mul (f64.convert_i32_u ${i}) (f64.const 3.25))))`, x => Math.trunc(x * 3.25));

  loop('reference-types', 'table-null-check', `(i32.eqz (ref.is_null (table.get (i32.and ${i} (i32.const 1)))))`, () => 1, indirect);
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
  const privateSecondary = '(memory $shared 2 2 shared) (memory $private 2 2)';
  loop('threads', 'private-secondary-load-store', `(block (result i32) (i32.atomic.store (i32.const 0) ${i})
    (i32.store $private ${address} (i32.add ${i} (i32.const 3)))
    (i32.sub (i32.load $private ${address}) (i32.atomic.load (i32.const 0))))`, () => 3,
    privateSecondary, '', '', { hostProfile: 'threads-defined-v1', features: ['threads', 'multi-memory'] });
  loop('threads', 'private-secondary-atomic-load-store', `(block (result i32) (i32.atomic.store $private ${address} ${i}) (i32.atomic.load $private ${address}))`, x => x,
    privateSecondary, '', '', { hostProfile: 'threads-defined-v1', features: ['threads', 'multi-memory'] });
  loop('threads', 'private-secondary-atomic-rmw-add', `(block (result i32) (i32.atomic.store $private (i32.const 0) ${i}) (i32.atomic.rmw.add $private (i32.const 0) (i32.const 1)))`, x => x,
    privateSecondary, '', '', { hostProfile: 'threads-defined-v1', features: ['threads', 'multi-memory'] });
  const sharedSecondary = '(memory $primary 2 2 shared) (memory $secondary 2 2 shared)';
  loop('threads', 'shared-secondary-atomic-load-store', `(block (result i32) (i32.atomic.store $secondary ${address} ${i}) (i32.atomic.load $secondary ${address}))`, x => x,
    sharedSecondary, '', '', { hostProfile: 'threads-defined-v1', features: ['threads', 'multi-memory'] });
  loop('threads', 'shared-secondary-wait-size', `(block (result i32) (i32.atomic.store $secondary (i32.const 0) ${i})
    (i32.add (memory.atomic.wait32 $secondary (i32.const 0) (i32.add ${i} (i32.const 1)) (i64.const 0)) (memory.grow $secondary (i32.const 0))))`, () => 3,
    sharedSecondary, '', '', { hostProfile: 'threads-defined-v1', features: ['threads', 'multi-memory'] });
  loop('threads', 'shared-secondary-copy', `(block (result i32) (i32.atomic.store $secondary (i32.const 0) ${i})
    (memory.copy $primary $secondary ${address} (i32.const 0) (i32.const 4)) (i32.load $primary ${address}))`, x => x,
    sharedSecondary, '', '', { hostProfile: 'threads-defined-v1', features: ['threads', 'multi-memory'] });
  loop('threads', 'private-secondary-copy', `(block (result i32) (i32.atomic.store (i32.const 0) ${i})
    (memory.copy $private $shared ${address} (i32.const 0) (i32.const 4)) (i32.load $private ${address}))`, x => x,
    privateSecondary, '', '', { hostProfile: 'threads-defined-v1', features: ['threads', 'multi-memory'] });
  loop('threads', 'unshared-atomic-load-store', `(block (result i32) (i32.atomic.store ${address} ${i}) (i32.atomic.load ${address}))`, x => x,
    '(memory 2 2)', '', '', { hostProfile: 'threads-defined-v1' });
  loop('threads', 'unshared-atomic-rmw-add', `(block (result i32) (i32.atomic.store (i32.const 0) ${i}) (i32.atomic.rmw.add (i32.const 0) (i32.const 1)))`, x => x,
    '(memory 2 2)', '', '', { hostProfile: 'threads-defined-v1' });
  const shared64 = '(memory i64 2 2 shared)', address64 = `(i64.extend_i32_u ${address})`;
  loop('threads', 'memory64-atomic-load-store', `(block (result i32) (i32.atomic.store ${address64} ${i}) (i32.atomic.load ${address64}))`, x => x,
    shared64, '', '', { hostProfile: 'threads-defined-v1', features: ['threads', 'memory64'] });
  loop('threads', 'memory64-wait-mismatch-notify', `(block (result i32) (i32.atomic.store (i64.const 0) ${i}) (drop (memory.atomic.notify (i64.const 0) (i32.const 1))) (memory.atomic.wait32 (i64.const 0) (i32.add ${i} (i32.const 1)) (i64.const 0)))`, () => 1,
    shared64, '', '', { hostProfile: 'threads-defined-v1', features: ['threads', 'memory64'] });
  loop('threads', 'table-indirect-call', `(block (result i32) (i32.store ${address} ${i})
    (i32.add (call_indirect (type $t) (i32.load ${address}) (i32.and ${i} (i32.const 1))) (memory.size)))`,
    x => x + (x & 1 ? 3 : 1) + 2, indirect + ' ' + shared, '', '', { hostProfile: 'threads-defined-v1' });
  for (const [name, hostProfile] of [['host-identity', 'threads-identity-v1'], ['host-opaque-identity', 'threads-opaque-identity-v1']]) {
    loop('threads', name, `(block (result i32) (i32.store ${address} ${i}) (call $identity (i32.load ${address})))`, x => x,
      '(import "wasmbench" "identity" (func $identity (param i32) (result i32))) ' + shared, '', '', { hostProfile });
  }
  loop('threads', 'ordinary-load-store', `(block (result i32) (i32.store align=1 (i32.add ${address} (i32.const 1)) ${i}) (i32.load align=1 (i32.add ${address} (i32.const 1))))`, x => x, shared, '', '', { hostProfile: 'threads-defined-v1' });
  loop('threads', 'simd-load-store', `(block (result i32) (v128.store align=1 (i32.add ${address} (i32.const 1)) (i32x4.splat ${i})) (i32x4.extract_lane 3 (v128.load align=1 (i32.add ${address} (i32.const 1)))))`, x => x, shared, '', '', { hostProfile: 'threads-defined-v1' });
  loop('threads', 'bulk-fill', `(block (result i32) (memory.fill (i32.add ${address} (i32.const 1)) ${i} (i32.const 33)) (i32.load8_u (i32.add ${address} (i32.const 33))))`, x => x & 255, shared, '', '', { hostProfile: 'threads-defined-v1' });
  loop('threads', 'bulk-copy-overlap', `(block (result i32) (i32.store align=1 ${address} ${i}) (memory.copy (i32.add ${address} (i32.const 1)) ${address} (i32.const 33)) (i32.load align=1 (i32.add ${address} (i32.const 1))))`, x => x, shared, '', '', { hostProfile: 'threads-defined-v1' });
  const sharedSeed = `${shared} (data $seed "${Array.from({ length: 64 }, (_, k) => '\\' + ((k * 37 + 17) & 255).toString(16).padStart(2, '0')).join('')}")`;
  loop('threads', 'passive-data-init', `(block (result i32) (memory.init $seed (i32.add ${address} (i32.const 1)) (i32.and ${i} (i32.const 15)) (i32.const 33)) (i32.load8_u (i32.add ${address} (i32.const 33))))`, x => (((x & 15) + 32) * 37 + 17) & 255, sharedSeed, '', '', { hostProfile: 'threads-defined-v1' });
  loop('threads', 'memory64-passive-data-init', `(block (result i32) (memory.init $seed (i64.add ${address64} (i64.const 1)) (i32.and ${i} (i32.const 15)) (i32.const 33)) (i32.load8_u (i64.add ${address64} (i64.const 33))))`, x => (((x & 15) + 32) * 37 + 17) & 255, sharedSeed.replace(shared, shared64), '', '', { hostProfile: 'threads-defined-v1', features: ['threads', 'memory64'] });
  loop('threads', 'memory-size-zero-growth', `(i32.sub (memory.grow (i32.const 0)) (memory.size))`, () => 0, shared, '', '', { hostProfile: 'threads-defined-v1' });
  add('threads', 'memory-grow', `(module (memory 1 64 shared) (func (export "benchmark") (param i32) (result i32) (drop (memory.grow (local.get 0))) (memory.size)))`, n => n + 1,
    { sizes: [1, 4, 16], reset: 'fresh_instance_per_sample', workUnit: 'memory_page', scope: 'allocation', hostProfile: 'threads-defined-v1' });
  loop('threads', 'atomic-load-store', `(block (result i32) (i32.atomic.store ${address} ${i}) (i32.atomic.load ${address}))`, x => x, shared, '', '', { hostProfile: 'threads-defined-v1' });
  loop('threads', 'atomic-rmw-add', `(block (result i32) (i32.atomic.store (i32.const 0) ${i}) (i32.atomic.rmw.add (i32.const 0) (i32.const 1)))`, x => x, shared, '', '', { hostProfile: 'threads-defined-v1' });
  loop('threads', 'atomic-compare-exchange', `(block (result i32) (i32.atomic.store (i32.const 0) ${i}) (i32.atomic.rmw.cmpxchg (i32.const 0) ${i} (i32.add ${i} (i32.const 1))))`, x => x, shared, '', '', { hostProfile: 'threads-defined-v1' });
  loop('threads', 'wait-mismatch-notify', `(block (result i32) (i32.atomic.store (i32.const 0) ${i}) (drop (memory.atomic.notify (i32.const 0) (i32.const 1))) (memory.atomic.wait32 (i32.const 0) (i32.add ${i} (i32.const 1)) (i64.const 0)))`, () => 1, shared, '', '', { hostProfile: 'threads-defined-v1' });
  loop('threads', 'atomic-fence', `(block (result i32) (atomic.fence) ${i})`, x => x, shared, '', '', { hostProfile: 'threads-defined-v1' });
  baseline('threads', 'non-atomic', x => x);
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
