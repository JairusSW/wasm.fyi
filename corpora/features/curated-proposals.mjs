// Original execution kernels informed by ordinary proposal semantics.
// These are bounded execution kernels, not copied conformance harnesses.
// The GC copy pair is informed by the bulk-copy/element-loop comparison in V8's
// test/mjsunit/wasm/array-copy-benchmark.js, with our own inputs and oracle.

const sum = (n, value) => {
  let total = 0;
  for (let i = 0; i < n; i++) total = (total + value(i)) >>> 0;
  return total;
};

const loop = (name, expression, locals = '') => `
  (func (export "${name}") (param $n i32) (result i32)
    (local $i i32) (local $total i32) ${locals}
    (block $done
      (br_if $done (i32.eqz (local.get $n)))
      (loop $again
        (local.set $total (i32.add (local.get $total) ${expression}))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $again (i32.lt_u (local.get $i) (local.get $n)))))
    (local.get $total))`;

const exceptions = `(module
  (tag $pair (param i32 i32))
  (tag $inner (param i32))
  (tag $outer (param i32))
  ${loop('multi-payload-catch', `(block (result i32)
    (block $caught (result i32 i32)
      (try_table (catch $pair $caught)
        (throw $pair (local.get $i) (i32.add (i32.mul (local.get $i) (i32.const 3)) (i32.const 7))))
      unreachable)
    i32.add)`)}
  ${loop('nested-tag-dispatch', `(block $outer-caught (result i32)
    (try_table (catch $outer $outer-caught)
      (block $inner-caught (result i32)
        (try_table (catch $inner $inner-caught)
          (if (i32.and (local.get $i) (i32.const 1))
            (then (throw $inner (i32.add (local.get $i) (i32.const 5)))))
          (throw $outer (i32.add (local.get $i) (i32.const 11))))
        unreachable)
      (i32.const 17)
      i32.add
      (br $outer-caught))
    unreachable)`)}
)`;

const relaxedSimd = `(module
  ;; Both finite input lanes are positive, far inside the signed i32 range.
  ;; Fractional quarters and halves are exact; lanes 2 and 3 must be zero.
  ${loop('finite-truncation-zero-lanes', `(block (result i32)
    (local.set $v (i32x4.relaxed_trunc_f64x2_s_zero
      (f64x2.replace_lane 1
        (f64x2.splat (f64.add (f64.convert_i32_u (i32.and (local.get $i) (i32.const 255))) (f64.const 0.75)))
        (f64.add (f64.convert_i32_u (i32.shl (i32.and (local.get $i) (i32.const 255)) (i32.const 1))) (f64.const 0.5)))))
    (i32.add
      (i32.add (i32x4.extract_lane 0 (local.get $v)) (i32x4.extract_lane 1 (local.get $v)))
      (i32.add (i32x4.extract_lane 2 (local.get $v)) (i32x4.extract_lane 3 (local.get $v)))))`, '(local $v v128)')}
  ;; One operand is 16384, so the ambiguous (-32768, -32768) pair is impossible.
  ;; The other operand is 0..255, making rounded multiplication ceil(i / 2).
  ${loop('bounded-q15-rounded-multiply', `(i16x8.extract_lane_s 5
    (i16x8.relaxed_q15mulr_s
      (i16x8.splat (i32.and (local.get $i) (i32.const 255)))
      (i16x8.splat (i32.const 16384))))`)}
)`;

const jsStrings = `(module
  (import "wasm:js-string" "fromCharCode" (func $from-char (param i32) (result (ref extern))))
  (import "wasm:js-string" "charCodeAt" (func $char-at (param externref i32) (result i32)))
  (import "wasm:js-string" "fromCodePoint" (func $from-point (param i32) (result (ref extern))))
  (import "wasm:js-string" "codePointAt" (func $point-at (param externref i32) (result i32)))
  (import "wasm:js-string" "length" (func $length (param externref) (result i32)))
  ${loop('utf16-character-roundtrip', `(call $char-at
    (call $from-char (i32.add (i32.const 945) (i32.rem_u (local.get $i) (i32.const 24))))
    (i32.const 0))`)}
  ${loop('supplementary-codepoint-roundtrip', `(block (result i32)
    (local.set $s (call $from-point (i32.add (i32.const 128512) (i32.and (local.get $i) (i32.const 63)))))
    (i32.add (call $point-at (local.get $s) (i32.const 0))
      (i32.mul (call $length (local.get $s)) (i32.const 17))))`, '(local $s externref)')}
)`;

// Each iteration changes one source element, copies 32 elements and folds every
// destination element into a position-weighted checksum. Repeated calls create
// fresh arrays. This keeps both implementations observable and stateless.
const copyFunction = (name, copy) => `
  (func (export "${name}") (param $n i32) (result i32)
    (local $source (ref null $array)) (local $target (ref null $array))
    (local $i i32) (local $j i32) (local $total i32)
    (local.set $source (array.new $array (i32.const 0) (i32.const 32)))
    (local.set $target (array.new $array (i32.const -1) (i32.const 32)))
    (loop $initialize
      (array.set $array (local.get $source) (local.get $j)
        (i32.add (i32.mul (local.get $j) (i32.const 5)) (i32.const 11)))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $initialize (i32.lt_u (local.get $j) (i32.const 32))))
    (block $done
      (br_if $done (i32.eqz (local.get $n)))
      (loop $again
        (array.set $array (local.get $source) (i32.and (local.get $i) (i32.const 31))
          (i32.add (i32.mul (local.get $i) (i32.const 3)) (i32.const 7)))
        ${copy}
        (local.set $total (i32.add (local.get $total) (call $checksum (local.get $target))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $again (i32.lt_u (local.get $i) (local.get $n)))))
    (local.get $total))`;

const gcCopy = `(module
  (type $array (array (mut i32)))
  (func $checksum (param $a (ref null $array)) (result i32)
    (local $j i32) (local $total i32)
    (loop $elements
      (local.set $total (i32.add (local.get $total)
        (i32.mul (i32.add (local.get $j) (i32.const 1)) (array.get $array (local.get $a) (local.get $j)))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $elements (i32.lt_u (local.get $j) (i32.const 32))))
    (local.get $total))
  ${copyFunction('array-copy-checksum', `(array.copy $array $array
    (local.get $target) (i32.const 0) (local.get $source) (i32.const 0) (i32.const 32))`)}
  ${copyFunction('array-loop-copy-checksum', `(local.set $j (i32.const 0))
    (loop $copy
      (array.set $array (local.get $target) (local.get $j)
        (array.get $array (local.get $source) (local.get $j)))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $copy (i32.lt_u (local.get $j) (i32.const 32))))`)}
)`;

// Arithmetic recurrence for the weighted array contents, independent of either
// Wasm copying algorithm: update only the changed element's contribution.
const copyExpected = n => {
  let checksum = sum(32, j => (j + 1) * (5 * j + 11));
  let total = 0;
  for (let i = 0; i < n; i++) {
    const index = i % 32;
    const previous = i < 32 ? 5 * index + 11 : 3 * (i - 32) + 7;
    checksum = (checksum + (index + 1) * (3 * i + 7 - previous)) >>> 0;
    total = (total + checksum) >>> 0;
  }
  return total;
};

export function fixtures() {
  const out = [];
  const add = (feature, name, wat, expected, options = {}) => out.push({
    feature, name, module: `${feature}-curated`, export: name, wat, expected,
    sizes: [64], scope: 'execution', reset: 'stateless', ...options,
  });
  add('exceptions', 'multi-payload-catch', exceptions, n => sum(n, i => 4 * i + 7));
  add('exceptions', 'nested-tag-dispatch', exceptions, n => sum(n, i => i + (i % 2 ? 22 : 11)));
  add('relaxed-simd', 'finite-truncation-zero-lanes', relaxedSimd, n => sum(n, i => 3 * (i % 256)));
  add('relaxed-simd', 'bounded-q15-rounded-multiply', relaxedSimd, n => sum(n, i => Math.floor(((i % 256) + 1) / 2)));
  add('js-string-builtins', 'utf16-character-roundtrip', jsStrings, n => sum(n, i => 945 + i % 24),
    { hostProfile: 'js-string-builtins-v1' });
  add('js-string-builtins', 'supplementary-codepoint-roundtrip', jsStrings, n => sum(n, i => 128512 + i % 64 + 34),
    { hostProfile: 'js-string-builtins-v1' });
  const copySources = [{
    repository: 'https://github.com/v8/v8',
    revision: '99085bf90a931dcece5cf327e5d0a47317e8de5c',
    path: 'test/mjsunit/wasm/array-copy-benchmark.js',
    relationship: 'original benchmark design informed by upstream comparison',
  }];
  add('gc', 'array-copy-checksum', gcCopy, copyExpected, { sources: copySources });
  add('gc', 'array-loop-copy-checksum', gcCopy, copyExpected, { baseline: true, sources: copySources });
  return out;
}
