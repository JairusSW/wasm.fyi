// Original execution workloads organized around normal spec-test concepts:
// br_table, loop, return, call_indirect, multi-value and return_call.
// JavaScript arithmetic oracles are independent of the generated Wasm output.
const sum = (n, value) => {
  let total = 0;
  for (let i = 0; i < n; i++) total = (total + value(i)) >>> 0;
  return total;
};
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const outer = (name, expression, locals = '') => `
  (func (export "${name}") (param $n i32) (result i32)
    (local $i i32) (local $total i32) ${locals}
    (block $done (loop $next
      (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (local.set $total (i32.add (local.get $total) ${expression}))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $next)))
    (local.get $total))`;

// br_table.wast's nested-label dispatch, loop.wast's nested loops, and
// return.wast's ordinary early exits, lifted into runtime-input algorithms.
const control = `(module
  (func (export "br-table-state-machine") (param $n i32) (result i32)
    (local $i i32) (local $state i32) (local $total i32)
    (block $done (loop $next
      (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (block $dispatch
        (block $case3 (block $case2 (block $case1 (block $case0
          (br_table $case0 $case1 $case2 $case3
            (i32.and (i32.add (i32.add (local.get $i) (local.get $state))
              (i32.div_u (local.get $i) (i32.const 7))) (i32.const 3))))
          (local.set $state (i32.add (local.get $state) (i32.const 3)))
          (br $dispatch))
        (local.set $state (i32.xor (local.get $state) (local.get $i)))
        (br $dispatch))
      (local.set $state (i32.add (i32.mul (local.get $state) (i32.const 3)) (i32.const 1)))
      (br $dispatch))
      (local.set $state (i32.sub (local.get $state) (local.get $i))))
      (local.set $state (i32.and (local.get $state) (i32.const 1023)))
      (local.set $total (i32.add (local.get $total) (local.get $state)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $next)))
    (local.get $total))
  (func (export "nested-divisor-count") (param $n i32) (result i32)
    (local $v i32) (local $d i32) (local $total i32)
    (local.set $v (i32.const 1))
    (block $done (loop $next
      (br_if $done (i32.gt_u (local.get $v) (local.get $n)))
      (local.set $d (i32.const 1))
      (block $divisors-done (loop $divisors
        (br_if $divisors-done (i32.gt_u (i32.mul (local.get $d) (local.get $d)) (local.get $v)))
        (if (i32.eqz (i32.rem_u (local.get $v) (local.get $d)))
          (then (local.set $total (i32.add (local.get $total)
            (i32.add (i32.const 1) (i32.ne (i32.mul (local.get $d) (local.get $d)) (local.get $v)))))))
        (local.set $d (i32.add (local.get $d) (i32.const 1)))
        (br $divisors)))
      (local.set $v (i32.add (local.get $v) (i32.const 1)))
      (br $next)))
    (local.get $total))
  (func (export "early-return-search") (param $n i32) (result i32)
    (local $i i32) (local $target i32)
    (local.set $target (i32.and (local.get $n) (i32.const 15)))
    (block $done (loop $next
      (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (if (i32.eq (i32.rem_u (i32.add (i32.mul (local.get $i) (i32.const 17)) (i32.const 11)) (i32.const 97)) (local.get $target))
        (then (return (i32.add (local.get $i) (i32.const 1)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $next)))
    (i32.const 0)))`;

// The comparator's slot chooses ascending or descending order. Pair members
// use scalar locals; the module needs core call_indirect, not multi-value.
const exchange = (a, b) => `
  (local.set $tmp (call_indirect (type $binary)
    (local.get $${a}) (local.get $${b}) (local.get $slot)))
  (local.set $${b} (call_indirect (type $binary)
    (local.get $${a}) (local.get $${b}) (i32.xor (local.get $slot) (i32.const 1))))
  (local.set $${a} (local.get $tmp))`;

// call_indirect.wast's heterogeneous table signatures and indirect recursion
// become composition, a sorting network, token recognition and tree folding.
const tables = `(module
  (type $unary (func (param i32) (result i32)))
  (type $binary (func (param i32 i32) (result i32)))
  (table 11 funcref)
  (elem (i32.const 0) $add $triple $xor $square $min $max $letter $digit $space $tree-add $tree-xor)
  (func $add (type $unary) (param $x i32) (result i32) (i32.add (local.get $x) (i32.const 7)))
  (func $triple (type $unary) (param $x i32) (result i32) (i32.mul (local.get $x) (i32.const 3)))
  (func $xor (type $unary) (param $x i32) (result i32) (i32.xor (local.get $x) (i32.const 85)))
  (func $square (type $unary) (param $x i32) (result i32) (i32.add (i32.mul (local.get $x) (local.get $x)) (i32.const 1)))
  (func $min (type $binary) (param $a i32) (param $b i32) (result i32)
    (select (local.get $a) (local.get $b) (i32.lt_u (local.get $a) (local.get $b))))
  (func $max (type $binary) (param $a i32) (param $b i32) (result i32)
    (select (local.get $a) (local.get $b) (i32.gt_u (local.get $a) (local.get $b))))
  (func $letter (type $unary) (param $s i32) (result i32)
    (i32.add (i32.const 1) (i32.shl (i32.eqz (local.get $s)) (i32.const 2))))
  (func $digit (type $unary) (param $s i32) (result i32)
    (i32.add (i32.const 2) (i32.shl (i32.eqz (local.get $s)) (i32.const 2))))
  (func $space (type $unary) (param i32) (result i32) (i32.const 0))
  (func $tree-add (type $binary) (param $depth i32) (param $seed i32) (result i32)
    (if (result i32) (i32.eqz (local.get $depth))
      (then (i32.and (local.get $seed) (i32.const 255)))
      (else (i32.add
        (call_indirect (type $binary) (i32.sub (local.get $depth) (i32.const 1))
          (i32.add (local.get $seed) (i32.const 1)) (i32.add (i32.const 9) (i32.and (local.get $seed) (i32.const 1))))
        (call_indirect (type $binary) (i32.sub (local.get $depth) (i32.const 1))
          (i32.add (local.get $seed) (i32.const 3)) (i32.add (i32.const 9) (i32.and (i32.shr_u (local.get $seed) (i32.const 1)) (i32.const 1))))))))
  (func $tree-xor (type $binary) (param $depth i32) (param $seed i32) (result i32)
    (if (result i32) (i32.eqz (local.get $depth))
      (then (i32.xor (i32.and (local.get $seed) (i32.const 255)) (i32.const 90)))
      (else (i32.xor
        (call_indirect (type $binary) (i32.sub (local.get $depth) (i32.const 1))
          (i32.add (local.get $seed) (i32.const 2)) (i32.add (i32.const 9) (i32.and (local.get $seed) (i32.const 1))))
        (call_indirect (type $binary) (i32.sub (local.get $depth) (i32.const 1))
          (i32.add (local.get $seed) (i32.const 5)) (i32.add (i32.const 9) (i32.and (i32.shr_u (local.get $seed) (i32.const 1)) (i32.const 1))))))))
  ${outer('indirect-composition', `(block (result i32)
    (local.set $state (i32.and (call_indirect (type $unary)
      (local.get $state) (i32.and (local.get $i) (i32.const 3))) (i32.const 4095)))
    (local.get $state))`, '(local $state i32)')}
  ${outer('indirect-sorting-network', `(block (result i32)
    (local.set $a (i32.and (i32.add (i32.mul (local.get $i) (i32.const 37)) (i32.const 11)) (i32.const 255)))
    (local.set $b (i32.and (i32.add (i32.mul (local.get $i) (i32.const 19)) (i32.const 7)) (i32.const 255)))
    (local.set $c (i32.and (i32.add (i32.mul (local.get $i) (i32.const 13)) (i32.const 101)) (i32.const 255)))
    (local.set $d (i32.and (i32.add (i32.mul (local.get $i) (i32.const 29)) (i32.const 53)) (i32.const 255)))
    (local.set $slot (i32.add (i32.const 4) (i32.and (local.get $i) (i32.const 1))))
    ${exchange('a', 'b')} ${exchange('c', 'd')} ${exchange('a', 'c')} ${exchange('b', 'd')} ${exchange('b', 'c')}
    (i32.add (i32.add (local.get $a) (i32.mul (local.get $b) (i32.const 3)))
      (i32.add (i32.mul (local.get $c) (i32.const 5)) (i32.mul (local.get $d) (i32.const 7)))))`,
    '(local $a i32) (local $b i32) (local $c i32) (local $d i32) (local $slot i32) (local $tmp i32)')}
  ${outer('indirect-token-recognition', `(block (result i32)
    (local.set $packed (call_indirect (type $unary) (local.get $state)
      (i32.add (i32.const 6) (i32.rem_u (i32.add (i32.mul (local.get $i) (i32.const 5))
        (i32.div_u (local.get $i) (i32.const 7))) (i32.const 3)))))
    (local.set $state (i32.and (local.get $packed) (i32.const 3)))
    (i32.shr_u (local.get $packed) (i32.const 2)))`, '(local $state i32) (local $packed i32)')}
  ${outer('indirect-tree-fold', `(call_indirect (type $binary)
    (i32.add (i32.rem_u (local.get $i) (i32.const 5)) (i32.const 1))
    (local.get $i) (i32.add (i32.const 9) (i32.and (local.get $i) (i32.const 1))))`)}
)`;

// Multi-value tuple, conditional-result and loop-parameter test concepts support
// algorithms whose intermediate results really carry more than one value.
const tuples = `(module
  (func $euclid (param $a i32) (param $b i32) (result i32 i32)
    (local $steps i32) (local $r i32)
    (block $done (loop $next
      (br_if $done (i32.eqz (local.get $b)))
      (local.set $r (i32.rem_u (local.get $a) (local.get $b)))
      (local.set $a (local.get $b)) (local.set $b (local.get $r))
      (local.set $steps (i32.add (local.get $steps) (i32.const 1)))
      (br $next)))
    (local.get $a) (local.get $steps))
  (func $fib (param $k i32) (result i32 i32)
    (local $a i32) (local $b i32)
    (local.get $k) (i32.const 0) (i32.const 1)
    (loop $next (param i32 i32 i32) (result i32 i32)
      (local.set $b) (local.set $a) (local.set $k)
      (if (result i32 i32) (i32.eqz (local.get $k))
        (then (local.get $a) (local.get $b))
        (else (br $next (i32.sub (local.get $k) (i32.const 1))
          (local.get $b) (i32.add (local.get $a) (local.get $b)))))))
  (func $ordered (param $a i32) (param $b i32) (result i32 i32)
    (if (result i32 i32) (i32.le_u (local.get $a) (local.get $b))
      (then (local.get $a) (local.get $b))
      (else (local.get $b) (local.get $a))))
  (func $sqrt-rem (param $x i32) (result i32 i32)
    (local $root i32) (local $odd i32)
    (local.set $odd (i32.const 1))
    (block $done (loop $next
      (br_if $done (i32.lt_u (local.get $x) (local.get $odd)))
      (local.set $x (i32.sub (local.get $x) (local.get $odd)))
      (local.set $odd (i32.add (local.get $odd) (i32.const 2)))
      (local.set $root (i32.add (local.get $root) (i32.const 1)))
      (br $next)))
    (local.get $root) (local.get $x))
  ${outer('euclid-result-and-steps', `(block (result i32)
    (call $euclid (i32.add (i32.mul (local.get $i) (i32.const 29)) (i32.const 7))
      (i32.add (i32.rem_u (local.get $i) (i32.const 17)) (i32.const 2)))
    (local.set $steps) (local.set $gcd)
    (i32.add (i32.mul (local.get $gcd) (i32.const 17)) (local.get $steps)))`, '(local $gcd i32) (local $steps i32)')}
  ${outer('fibonacci-loop-tuple', `(block (result i32)
    (call $fib (i32.add (i32.rem_u (local.get $i) (i32.const 20)) (i32.const 1)))
    (i32.xor))`)}
  ${outer('conditional-order-pair', `(block (result i32)
    (call $ordered (i32.and (i32.add (i32.mul (local.get $i) (i32.const 37)) (i32.const 11)) (i32.const 255))
      (i32.and (i32.add (i32.mul (local.get $i) (i32.const 19)) (i32.const 7)) (i32.const 255)))
    (local.set $hi) (local.set $lo)
    (i32.add (i32.mul (local.get $lo) (i32.const 3)) (i32.sub (local.get $hi) (local.get $lo))))`, '(local $lo i32) (local $hi i32)')}
  ${outer('integer-sqrt-remainder', `(block (result i32)
    (call $sqrt-rem (i32.and (i32.add (i32.mul (local.get $i) (i32.const 43)) (i32.const 19)) (i32.const 4095)))
    (local.set $remainder) (local.set $root)
    (i32.add (i32.mul (local.get $root) (i32.const 17)) (local.get $remainder)))`, '(local $root i32) (local $remainder i32)')}
)`;

// return_call.wast's direct and mutually recursive transfers are ordinary,
// bounded parity, Euclidean, search and digit-reduction workloads.
const tails = `(module
  (func $even (param $k i32) (result i32)
    (if (result i32) (i32.eqz (local.get $k))
      (then (i32.const 1))
      (else (return_call $odd (i32.sub (local.get $k) (i32.const 1))))))
  (func $odd (param $k i32) (result i32)
    (if (result i32) (i32.eqz (local.get $k))
      (then (i32.const 0))
      (else (return_call $even (i32.sub (local.get $k) (i32.const 1))))))
  (func $gcd (param $a i32) (param $b i32) (result i32)
    (if (result i32) (i32.eqz (local.get $b))
      (then (local.get $a))
      (else (return_call $gcd (local.get $b) (i32.rem_u (local.get $a) (local.get $b))))))
  (func $search (param $lo i32) (param $hi i32) (param $target i32) (result i32)
    (local $mid i32) (local $value i32)
    (if (i32.ge_u (local.get $lo) (local.get $hi)) (then (return (i32.const 0))))
    (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
    (local.set $value (i32.add (i32.mul (local.get $mid) (i32.const 3)) (i32.const 2)))
    (if (i32.eq (local.get $value) (local.get $target))
      (then (return (i32.add (local.get $mid) (i32.const 1)))))
    (if (result i32) (i32.lt_u (local.get $value) (local.get $target))
      (then (return_call $search (i32.add (local.get $mid) (i32.const 1)) (local.get $hi) (local.get $target)))
      (else (return_call $search (local.get $lo) (local.get $mid) (local.get $target)))))
  (func $digits (param $value i32) (param $total i32) (result i32)
    (if (result i32) (i32.eqz (local.get $value))
      (then (local.get $total))
      (else (return_call $digits (i32.div_u (local.get $value) (i32.const 10))
        (i32.add (local.get $total) (i32.rem_u (local.get $value) (i32.const 10)))))))
  ${outer('mutual-parity-count', `(call $even (i32.add (i32.rem_u (local.get $i) (i32.const 31)) (i32.const 1)))`)}
  ${outer('euclidean-gcd', `(call $gcd (i32.add (i32.mul (local.get $i) (i32.const 13)) (i32.const 17))
    (i32.add (i32.rem_u (local.get $i) (i32.const 17)) (i32.const 1)))`)}
  ${outer('binary-search', `(call $search (i32.const 0) (i32.const 128)
    (i32.rem_u (i32.add (i32.mul (local.get $i) (i32.const 11)) (i32.const 5)) (i32.const 400)))`)}
  ${outer('decimal-digit-sum', `(call $digits (i32.add (i32.mul (local.get $i) (i32.const 997)) (i32.const 12345)) (i32.const 0))`)}
)`;

function treeFold(depth, seed, kind) {
  if (depth === 0) return kind ? (seed & 255) ^ 90 : seed & 255;
  const left = treeFold(depth - 1, seed + (kind ? 2 : 1), seed & 1);
  const right = treeFold(depth - 1, seed + (kind ? 5 : 3), (seed >>> 1) & 1);
  return kind ? left ^ right : left + right;
}

export function fixtures() {
  const out = [];
  const add = (feature, name, wat, expected) => out.push({
    feature, name, wat, expected, module: `${feature}-curated`, export: name,
    sizes: [64], scope: 'execution', reset: 'stateless'
  });
  add('core-ctl', 'br-table-state-machine', control, n => {
    let state = 0;
    return sum(n, i => {
      switch ((i + state + Math.floor(i / 7)) & 3) {
        case 0: state += 3; break;
        case 1: state ^= i; break;
        case 2: state = state * 3 + 1; break;
        case 3: state -= i; break;
      }
      return state &= 1023;
    });
  });
  // Sum of divisor counts equals the number of pairs (d, multiple) up to n.
  add('core-ctl', 'nested-divisor-count', control, n => sum(n, i => Math.floor(n / (i + 1))));
  // 40 is the inverse of 17 modulo 97, giving the first matching index.
  add('core-ctl', 'early-return-search', control, n => {
    const first = ((((n & 15) - 11) * 40) % 97 + 97) % 97;
    return first < n ? first + 1 : 0;
  });
  add('core-tab', 'indirect-composition', tables, n => {
    let state = 0;
    const functions = [x => x + 7, x => x * 3, x => x ^ 85, x => x * x + 1];
    return sum(n, i => state = functions[i % 4](state) & 4095);
  });
  add('core-tab', 'indirect-sorting-network', tables, n => sum(n, i =>
    [i * 37 + 11, i * 19 + 7, i * 13 + 101, i * 29 + 53]
      .map(x => x & 255).sort((a, b) => i & 1 ? b - a : a - b)
      .reduce((total, value, index) => total + value * (index * 2 + 1), 0)));
  add('core-tab', 'indirect-token-recognition', tables, n => {
    const tokens = Array.from({ length: n }, (_, i) =>
      ['a', '7', ' '][(i * 5 + Math.floor(i / 7)) % 3]).join('');
    return (tokens.match(/\S+/g) || []).length;
  });
  add('core-tab', 'indirect-tree-fold', tables, n => sum(n, i => treeFold(i % 5 + 1, i, i & 1)));
  add('multi-value', 'euclid-result-and-steps', tuples, n => sum(n, i => {
    let a = i * 29 + 7, b = i % 17 + 2, steps = 0;
    while (b) { [a, b] = [b, a % b]; steps++; }
    return a * 17 + steps;
  }));
  add('multi-value', 'fibonacci-loop-tuple', tuples, n => sum(n, i => {
    const sequence = [0, 1];
    for (let k = 2; k <= i % 20 + 2; k++) sequence.push(sequence[k - 1] + sequence[k - 2]);
    return sequence[i % 20 + 1] ^ sequence[i % 20 + 2];
  }));
  add('multi-value', 'conditional-order-pair', tuples, n => sum(n, i => {
    const a = (i * 37 + 11) & 255, b = (i * 19 + 7) & 255;
    return 3 * Math.min(a, b) + Math.abs(a - b);
  }));
  add('multi-value', 'integer-sqrt-remainder', tuples, n => sum(n, i => {
    const value = (i * 43 + 19) & 4095, root = Math.floor(Math.sqrt(value));
    return root * 17 + value - root * root;
  }));
  add('tail-call', 'mutual-parity-count', tails, n => sum(n, i => (i % 31 + 1) % 2 === 0 ? 1 : 0));
  add('tail-call', 'euclidean-gcd', tails, n => sum(n, i => gcd(i * 13 + 17, i % 17 + 1)));
  add('tail-call', 'binary-search', tails, n => sum(n, i => {
    const target = (i * 11 + 5) % 400;
    return target >= 2 && target <= 383 && target % 3 === 2 ? (target - 2) / 3 + 1 : 0;
  }));
  add('tail-call', 'decimal-digit-sum', tails, n => sum(n, i =>
    String(i * 997 + 12345).split('').reduce((total, digit) => total + Number(digit), 0)));
  return out;
}
