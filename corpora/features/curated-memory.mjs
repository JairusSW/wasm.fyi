// Deterministic memory algorithms, with separately evaluated JS reference models.
// Immutable active data is installed at instantiation, outside the measured call.
// Mutable scratch never overlaps it. Per-call initialization (window/seed copies
// and diffusion input restoration) is part of the measured algorithm, not hidden
// host setup. Every export can be called repeatedly, including between other
// exports on the same instance, without depending on an earlier invocation.
const bounded = n => Math.min(n >>> 0, 256);
const weighted = values => values.reduce((total, value, index) => total + value * (index + 1), 0);
const bytes = values => Array.from(values, value => `\\${value.toString(16).padStart(2, '0')}`).join('');
const words = values => bytes(values.flatMap(value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24]));
const sourceByte = index => ((index * 37) ^ (index >>> 3) ^ 0x5a) & 255;
const wideValue = index => (index * 73 + 19) % 997;
const recordKey = index => (index * 17 + 5) % 1021;
const fieldValue = index => (index * index * 13 + index * 7 + 19) % 251;
const boundWat = `(func $bound (param $n i32) (result i32)
  (select (local.get $n) (i32.const 256) (i32.lt_u (local.get $n) (i32.const 256))))`;

// The result deliberately covers every produced byte/word. All sums stay below
// 2^31 for the bounded inputs, so the i32 and exact_u64 contracts agree directly.
const checksumWat = (name, memory = '', wide = false, byte = false) => {
  const offset = byte ? '(local.get $j)' : '(i32.shl (local.get $j) (i32.const 2))';
  const address = wide ? `(i64.extend_i32_u ${offset})` : offset;
  return `(func $${name} (param $count i32) (result i32)
    (local $j i32) (local $sum i32)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $j) (local.get $count)))
        (local.set $sum (i32.add (local.get $sum)
          (i32.mul (i32.${byte ? 'load8_u' : 'load'} ${memory} ${address})
            (i32.add (local.get $j) (i32.const 1)))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $next)))
    (local.get $sum))`;
};

const bulkWat = `(module
  (memory 1 1)
  (data (i32.const 8192) "${bytes(Array.from({ length: 4096 }, (_, i) => sourceByte(i)))}")
  (data $seed "${bytes(Array.from({ length: 16 }, (_, i) => sourceByte(i)))}")
  ${boundWat}
  ${checksumWat('checksum-bytes', '', false, true)}

  ;; Pack a deterministic permutation of fixed-width records into a dense buffer.
  (func (export "record-pack") (param $n i32) (result i32)
    (local $i i32)
    (local.set $n (call $bound (local.get $n)))
    (block $done
      (loop $record
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (memory.copy
          (i32.shl (local.get $i) (i32.const 4))
          (i32.add (i32.const 8192) (i32.shl
            (i32.and (i32.add (i32.mul (local.get $i) (i32.const 13)) (i32.const 7)) (i32.const 255))
            (i32.const 4)))
          (i32.const 16))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $record)))
    (call $checksum-bytes (i32.shl (local.get $n) (i32.const 4))))

  ;; A 32-byte sliding window compacts left, then appends the next stream byte.
  (func (export "sliding-window-compaction") (param $n i32) (result i32)
    (local $i i32)
    (local.set $n (call $bound (local.get $n)))
    (memory.copy (i32.const 0) (i32.const 8192) (i32.const 32))
    (block $done
      (loop $step
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (memory.copy (i32.const 0) (i32.const 1) (i32.const 31))
        (i32.store8 (i32.const 31) (i32.add (i32.mul (local.get $i) (i32.const 11)) (i32.const 3)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $step)))
    (call $checksum-bytes (i32.const 32)))

  ;; Expand a passive 16-byte pattern by doubling the initialized prefix.
  (func (export "doubling-pattern-expansion") (param $n i32) (result i32)
    (local $length i32) (local $written i32) (local $chunk i32)
    (local.set $length (i32.shl (call $bound (local.get $n)) (i32.const 4)))
    (if (i32.eqz (local.get $length)) (then (return (i32.const 0))))
    (memory.init $seed (i32.const 0) (i32.const 0) (i32.const 16))
    (local.set $written (i32.const 16))
    (block $done
      (loop $double
        (br_if $done (i32.ge_u (local.get $written) (local.get $length)))
        (local.set $chunk (i32.sub (local.get $length) (local.get $written)))
        (if (i32.gt_u (local.get $chunk) (local.get $written))
          (then (local.set $chunk (local.get $written))))
        (memory.copy (local.get $written) (i32.const 0) (local.get $chunk))
        (local.set $written (i32.add (local.get $written) (local.get $chunk)))
        (br $double)))
    (call $checksum-bytes (local.get $length))))`;

const packedRecords = Array.from({ length: 256 }, (_, i) => {
  const key = recordKey(i), value = wideValue(i);
  return [key & 255, key >>> 8, value & 255, value >>> 8, 0, 0];
}).flat();

const memory64Wat = `(module
  (memory i64 1 1)
  (data (i64.const 16384) "${words(Array.from({ length: 256 }, (_, i) => wideValue(i)))}")
  (data (i64.const 32768) "${bytes(packedRecords)}")
  ${boundWat}

  ;; Sparse traversal of an immutable table using 64-bit address arithmetic.
  (func (export "strided-gather-reduction") (param $n i32) (result i32)
    (local $i i32) (local $sum i32) (local $address i64)
    (local.set $n (call $bound (local.get $n)))
    (block $done
      (loop $gather
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $address (i64.add (i64.const 16384)
          (i64.shl (i64.extend_i32_u
            (i32.and (i32.add (i32.mul (local.get $i) (i32.const 37)) (i32.const 11)) (i32.const 255)))
            (i64.const 2))))
        (local.set $sum (i32.add (local.get $sum)
          (i32.mul (i32.load (local.get $address)) (i32.add (local.get $i) (i32.const 1)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $gather)))
    (local.get $sum))

  ;; Produce an inclusive prefix scan, then reduce all materialized prefixes.
  (func (export "prefix-scan") (param $n i32) (result i32)
    (local $i i32) (local $prefix i32) (local $offset i64) (local $sum i32)
    (local.set $n (call $bound (local.get $n)))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $offset (i64.shl (i64.extend_i32_u (local.get $i)) (i64.const 2)))
        (local.set $prefix (i32.add (local.get $prefix)
          (i32.load (i64.add (i64.const 16384) (local.get $offset)))))
        (i32.store (local.get $offset) (local.get $prefix))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $scan)))
    (local.set $i (i32.const 0))
    (block $done
      (loop $reduce
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $sum (i32.add (local.get $sum)
          (i32.load (i64.shl (i64.extend_i32_u (local.get $i)) (i64.const 2)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $reduce)))
    (local.get $sum))

  ;; Decode six-byte packed records and write transformed words at odd addresses.
  (func (export "unaligned-record-transform") (param $n i32) (result i32)
    (local $i i32) (local $address i64) (local $value i32) (local $sum i32)
    (local.set $n (call $bound (local.get $n)))
    (block $done
      (loop $transform
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $address (i64.add (i64.const 32768)
          (i64.mul (i64.extend_i32_u (local.get $i)) (i64.const 6))))
        (local.set $value (i32.xor (i32.load16_u align=1 (local.get $address))
          (i32.add (i32.mul (i32.load offset=2 align=1 (local.get $address)) (i32.const 3)) (i32.const 7))))
        (i32.store align=1 (i64.add (i64.const 1)
          (i64.shl (i64.extend_i32_u (local.get $i)) (i64.const 2))) (local.get $value))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $transform)))
    (local.set $i (i32.const 0))
    (block $done
      (loop $reduce
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $sum (i32.add (local.get $sum)
          (i32.mul (i32.load align=1 (i64.add (i64.const 1)
            (i64.shl (i64.extend_i32_u (local.get $i)) (i64.const 2))))
            (i32.add (local.get $i) (i32.const 1)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $reduce)))
    (local.get $sum)))`;

const diffusionPassWat = (source, destination) => `(local.set $j (i32.const 0))
  (loop $cell
    (i32.store ${destination} (i32.shl (local.get $j) (i32.const 2))
      (i32.shr_u (i32.add
        (i32.add
          (i32.load ${source} (i32.shl (i32.and (i32.sub (local.get $j) (i32.const 1)) (i32.const 63)) (i32.const 2)))
          (i32.shl (i32.load ${source} (i32.shl (local.get $j) (i32.const 2))) (i32.const 1)))
        (i32.load ${source} (i32.shl (i32.and (i32.add (local.get $j) (i32.const 1)) (i32.const 63)) (i32.const 2))))
        (i32.const 2)))
    (local.set $j (i32.add (local.get $j) (i32.const 1)))
    (br_if $cell (i32.lt_u (local.get $j) (i32.const 64))))`;

const multiMemoryWat = `(module
  (memory $a 1 1) (memory $b 1 1) (memory $c 1 1)
  (data (memory $a) (i32.const 4096) "${words(Array.from({ length: 256 }, (_, i) => 3 * i + 1))}")
  (data (memory $b) (i32.const 4096) "${words(Array.from({ length: 256 }, (_, i) => 5 * i + 2))}")
  (data (memory $a) (i32.const 8192) "${words(Array.from({ length: 258 }, (_, i) => fieldValue(i)))}")
  ${boundWat}
  ${checksumWat('checksum-a', '$a')}
  ${checksumWat('checksum-b', '$b')}
  ${checksumWat('checksum-c', '$c')}
  (func $read-a (param $i i32) (result i32)
    (i32.load $a (i32.add (i32.const 4096) (i32.shl (local.get $i) (i32.const 2)))))
  (func $read-b (param $i i32) (result i32)
    (i32.load $b (i32.add (i32.const 4096) (i32.shl (local.get $i) (i32.const 2)))))

  ;; Merge two independently stored sorted lists into a third memory.
  (func (export "sorted-list-merge") (param $n i32) (result i32)
    (local $left i32) (local $right i32) (local $take-left i32) (local $value i32) (local $out i32)
    (local.set $n (call $bound (local.get $n)))
    (block $done
      (loop $merge
        (br_if $done (i32.ge_u (local.get $out) (i32.shl (local.get $n) (i32.const 1))))
        (local.set $take-left
          (if (result i32) (i32.ge_u (local.get $left) (local.get $n))
            (then (i32.const 0))
            (else (if (result i32) (i32.ge_u (local.get $right) (local.get $n))
              (then (i32.const 1))
              (else (i32.le_u (call $read-a (local.get $left)) (call $read-b (local.get $right))))))))
        (if (local.get $take-left)
          (then
            (local.set $value (call $read-a (local.get $left)))
            (local.set $left (i32.add (local.get $left) (i32.const 1))))
          (else
            (local.set $value (call $read-b (local.get $right)))
            (local.set $right (i32.add (local.get $right) (i32.const 1)))))
        (i32.store $c (i32.shl (local.get $out) (i32.const 2)) (local.get $value))
        (local.set $out (i32.add (local.get $out) (i32.const 1)))
        (br $merge)))
    (call $checksum-c (local.get $out)))

  ;; A weighted three-point stencil reads immutable memory A and materializes B.
  (func (export "cross-memory-stencil") (param $n i32) (result i32)
    (local $i i32) (local $address i32)
    (local.set $n (call $bound (local.get $n)))
    (block $done
      (loop $stencil
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $address (i32.add (i32.const 8192) (i32.shl (local.get $i) (i32.const 2))))
        (i32.store $b (i32.shl (local.get $i) (i32.const 2))
          (i32.add (i32.add
            (i32.mul (i32.load $a (local.get $address)) (i32.const 3))
            (i32.mul (i32.load $a offset=4 (local.get $address)) (i32.const 5)))
            (i32.load $a offset=8 (local.get $address))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $stencil)))
    (call $checksum-b (local.get $n)))

  ;; Diffuse a cyclic 64-cell field through A -> B -> A for each requested step.
  ;; Restoring A is measured; every cell of B is overwritten before being read.
  (func (export "ping-pong-diffusion") (param $n i32) (result i32)
    (local $i i32) (local $j i32)
    (local.set $n (call $bound (local.get $n)))
    (loop $restore
      (i32.store $a (i32.shl (local.get $j) (i32.const 2))
        (i32.load $a (i32.add (i32.const 8192) (i32.shl (local.get $j) (i32.const 2)))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $restore (i32.lt_u (local.get $j) (i32.const 64))))
    (block $done
      (loop $step
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        ${diffusionPassWat('$a', '$b')}
        ${diffusionPassWat('$b', '$a')}
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $step)))
    (call $checksum-a (i32.const 64))))`;

export function fixtures() {
  const result = [];
  const add = (feature, name, wat, expected, workUnit) => result.push({
    feature, name, module: `${feature}-curated`, export: name, wat, expected,
    sizes: [64], scope: 'execution', reset: 'stateless', workUnit,
  });

  add('bulk-memory', 'record-pack', bulkWat, n => weighted(Array.from(
    { length: bounded(n) * 16 }, (_, i) => sourceByte(((Math.floor(i / 16) * 13 + 7) & 255) * 16 + i % 16))), 'record');
  add('bulk-memory', 'sliding-window-compaction', bulkWat, n => {
    const initial = Array.from({ length: 32 }, (_, i) => sourceByte(i));
    const incoming = Array.from({ length: bounded(n) }, (_, i) => (i * 11 + 3) & 255);
    return weighted(initial.concat(incoming).slice(-32));
  }, 'compaction_step');
  add('bulk-memory', 'doubling-pattern-expansion', bulkWat, n => weighted(
    Array.from({ length: bounded(n) * 16 }, (_, i) => sourceByte(i % 16))), 'pattern_record');

  add('memory64', 'strided-gather-reduction', memory64Wat, n => weighted(
    Array.from({ length: bounded(n) }, (_, i) => wideValue((i * 37 + 11) & 255))), 'gathered_word');
  // Each input contributes to every prefix from its position to the end. This
  // closed-form reference does not reproduce the Wasm scan/store/reduce loops.
  add('memory64', 'prefix-scan', memory64Wat, n => {
    const count = bounded(n);
    return Array.from({ length: count }, (_, i) => wideValue(i) * (count - i)).reduce((a, b) => a + b, 0);
  }, 'scanned_word');
  add('memory64', 'unaligned-record-transform', memory64Wat, n => weighted(
    Array.from({ length: bounded(n) }, (_, i) => recordKey(i) ^ (wideValue(i) * 3 + 7))), 'record');

  // Reference sorting differs from the three-memory two-cursor Wasm merge.
  add('multi-memory', 'sorted-list-merge', multiMemoryWat, n => weighted(
    Array.from({ length: bounded(n) }, (_, i) => [3 * i + 1, 5 * i + 2]).flat().sort((a, b) => a - b)), 'input_pair');
  add('multi-memory', 'cross-memory-stencil', multiMemoryWat, n => weighted(
    Array.from({ length: bounded(n) }, (_, i) => 3 * fieldValue(i) + 5 * fieldValue(i + 1) + fieldValue(i + 2))), 'stencil_cell');
  add('multi-memory', 'ping-pong-diffusion', multiMemoryWat, n => {
    let field = Array.from({ length: 64 }, (_, i) => fieldValue(i));
    for (let pass = 0; pass < 2 * bounded(n); pass++) {
      field = field.map((center, i, previous) => Math.floor(
        (previous[(i + 63) % 64] + 2 * center + previous[(i + 1) % 64]) / 4));
    }
    return weighted(field);
  }, 'diffusion_step');
  return result;
}
