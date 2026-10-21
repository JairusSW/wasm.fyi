// Original kernels for previously unrepresented proposals. Expectations follow
// value semantics, never candidate engine output. Each kernel resets its state.
const sum = (n, f) => { let s = 0; for (let i = 0; i < n; i++) s = (s + f(i)) >>> 0; return s; };
const i = '(local.get $i)';
const loop = (expression, declarations = '', locals = '', before = '') => `(module ${declarations}
 (func (export "benchmark") (param $n i32) (result i32)
  (local $i i32) (local $sum i32) ${locals} ${before}
  (block $done (br_if $done (i32.eqz (local.get $n)))
   (loop $again
    (local.set $sum (i32.add (local.get $sum) ${expression}))
    (local.set $i (i32.add ${i} (i32.const 1)))
    (br_if $again (i32.lt_u ${i} (local.get $n))))) (local.get $sum)))`;

export const proposalGapIds = ['typed-function-references', 'branch-hinting', 'custom-page-sizes',
 'legacy-exceptions', 'shared-everything-threads', 'stack-switching', 'memory-control',
 'custom-annotation-syntax-in-the-text-format', 'extended-name-section', 'compilation-hints', 'numeric-values-in-wat', 'big-int',
 'instrument-and-tracing-technology'];

export function proposalGapFixtures() {
 const out = [];
 const add = (feature, name, expression, value, declarations = '', locals = '', before = '', options = {}) =>
  out.push({feature, name, wat: loop(expression, declarations, locals, before), expected: n => sum(n, value),
   sizes: [1, 64, 4096], scope: 'execution', reset: 'stateless', ...options});

 const functions = `(type $unary (func (param i32) (result i32)))
  (func $inc (type $unary) (i32.add (local.get 0) (i32.const 3)))
  (func $scale (type $unary) (i32.mul (local.get 0) (i32.const 5)))
  (elem declare func $inc $scale)`;
 add('typed-function-references', 'call-ref', `(call_ref $unary ${i} (ref.func $inc))`, x=>x+3, functions);
 add('typed-function-references', 'selected-target', `(call_ref $unary ${i}
  (select (result (ref $unary)) (ref.func $inc) (ref.func $scale) (i32.and ${i} (i32.const 1))))`, x=>x%2?x+3:5*x, functions);
 add('typed-function-references', 'reference-composition', `(call_ref $unary (call_ref $unary ${i} (ref.func $inc)) (ref.func $scale))`, x=>5*(x+3), functions);
 add('typed-function-references', 'typed-table', `(call_ref $unary ${i} (table.get $t (i32.and ${i} (i32.const 1))))`, x=>x%2?5*x:x+3,
  functions+' (table $t 2 (ref $unary) (ref.func $inc)) (elem (table $t) (i32.const 1) (ref $unary) (ref.func $scale))');
 add('typed-function-references', 'nullable-local-refinement', `(block (result i32)
  (local.set $r (ref.func $inc)) (call_ref $unary ${i} (ref.as_non_null (local.get $r))))`, x=>x+3, functions, '(local $r (ref null $unary))');

 for (const [name, condition, yes, no, oracle, hint] of [
  ['rare-error', `(i32.eqz (i32.and ${i} (i32.const 63)))`, 19, 3, x=>x%64===0?19:3, '00'],
  ['mostly-taken', `(i32.ne (i32.and ${i} (i32.const 63)) (i32.const 0))`, 7, 23, x=>x%64!==0?7:23, '01'],
  ['alternating', `(i32.and ${i} (i32.const 1))`, 11, 5, x=>x%2?11:5, '00'],
  ['clustered', `(i32.lt_u (i32.and ${i} (i32.const 255)) (i32.const 240))`, 13, 29, x=>x%256<240?13:29, '01'],
  ['misleading-hint', `(i32.eqz (i32.and ${i} (i32.const 31)))`, 31, 2, x=>x%32===0?31:2, '01'],
 ]) add('branch-hinting',name,`(block (result i32) ${condition}
  (@metadata.code.branch_hint "\\${hint}") if (result i32) (i32.const ${yes}) else (i32.const ${no}) end)`,oracle);

 const tiny = '(memory (export "memory") 32768 65536 (pagesize 1))';
 add('custom-page-sizes','byte-addressed-store',`(block (result i32) (i32.store8 (i32.and ${i} (i32.const 32767)) ${i}) (i32.load8_u (i32.and ${i} (i32.const 32767))))`,x=>x%256,tiny);
 add('custom-page-sizes','last-byte',`(block (result i32) (i32.store8 (i32.sub (memory.size) (i32.const 1)) ${i}) (i32.load8_u (i32.sub (memory.size) (i32.const 1))))`,x=>x%256,tiny);
 add('custom-page-sizes','unaligned-word',`(block (result i32) (i32.store align=1 (i32.const 1) ${i}) (i32.load align=1 (i32.const 1)))`,x=>x,tiny);
 add('custom-page-sizes','page-count',`(i32.xor (memory.size) ${i})`,x=>32768^x,tiny);
 add('custom-page-sizes','zero-grow',`(i32.add (memory.grow (i32.const 0)) ${i})`,x=>32768+x,tiny);

 const tags = '(tag $a (param i32)) (tag $b (param i32))';
 add('legacy-exceptions','payload-catch',`(block (result i32) try (result i32) ${i} throw $a catch $a end)`,x=>x,tags);
 add('legacy-exceptions','selective-throw',`(block (result i32) try (result i32) (if (i32.and ${i} (i32.const 1)) (then (throw $a ${i}))) (i32.const 7) catch $a end)`,x=>x%2?x:7,tags);
 add('legacy-exceptions','nested-rethrow',`(block (result i32) try (result i32) try ${i} throw $a catch $a drop rethrow 0 end (i32.const 0) catch $a end)`,x=>x,tags);
 add('legacy-exceptions','tag-dispatch',`(block (result i32) try (result i32) ${i} throw $b catch $a drop (i32.const 0) catch $b (i32.const 3) i32.add end)`,x=>x+3,tags);
 add('legacy-exceptions','catch-all',`(block (result i32) try (result i32) ${i} throw $a catch_all (i32.const 17) end)`,()=>17,tags);

 // These are single-agent atomic semantics, not a proof of inter-thread ordering.
 const shared = '(global $g (shared mut i32) (i32.const 0))';
 for (const [name, op, value] of [['exchange','xchg',x=>3*x+7],['add','add',x=>4*x+7],['xor','xor',x=>3*x+(x^7)],['or','or',x=>3*x+(x|7)],['and','and',x=>3*x+(x&7)]]) {
  add('shared-everything-threads','global-'+name,`(block (result i32)
   (global.atomic.set seqcst $g ${i})
   (i32.add (i32.mul (global.atomic.rmw.${op} seqcst $g (i32.const 7)) (i32.const 3))
    (global.atomic.get seqcst $g)))`,value,shared,'','',{scope:'compile-and-instantiate'});
  add('shared-everything-threads','struct-'+name,`(block (result i32)
   (struct.atomic.set seqcst $cell 0 (local.get $cell) ${i})
   (i32.add (i32.mul (struct.atomic.rmw.${op} seqcst $cell 0 (local.get $cell) (i32.const 7)) (i32.const 3))
    (struct.atomic.get seqcst $cell 0 (local.get $cell))))`,value,
   '(type $cell (shared (struct (field (mut i32)))))','(local $cell (ref null $cell))',
   '(local.set $cell (struct.new $cell (i32.const 0)))');
 }

 const continuation = `(type $f (func (param i32) (result i32))) (type $c (cont $f))
  (func $identity (type $f) (local.get 0)) (elem declare func $identity)`;
 for (const [name, expr, value] of [
  ['resume-value',i,x=>x], ['resume-negative',`(i32.sub (i32.const 0) ${i})`,x=>-x],
  ['resume-affine',`(i32.add (i32.mul ${i} (i32.const 7)) (i32.const 3))`,x=>7*x+3],
  ['resume-masked',`(i32.and ${i} (i32.const 255))`,x=>x%256],
  ['resume-composed',`(resume $c ${i} (cont.new $c (ref.func $identity)))`,x=>x],
 ]) add('stack-switching',name,`(resume $c ${expr} (cont.new $c (ref.func $identity)))`,value,continuation,'','',
  ['resume-negative','resume-affine','resume-masked'].includes(name)?{scope:'compile-and-instantiate'}:{});
 add('stack-switching','bound-parameter',`(resume $c ${i}
  (cont.bind $pair-c $c (i32.const 7) (cont.new $pair-c (ref.func $add))))`,x=>x+7,
  continuation+`(type $pair (func (param i32 i32) (result i32))) (type $pair-c (cont $pair))
   (func $add (type $pair) (i32.add (local.get 0) (local.get 1))) (elem declare func $add)`);
 add('stack-switching','nested-stack-resume',`(resume $c ${i} (cont.new $c (ref.func $nested)))`,x=>x,
  continuation+`(func $nested (type $f) (resume $c (local.get 0) (cont.new $c (ref.func $identity))))
   (elem declare func $nested)`);
 const yielding=continuation+`(tag $yield (type $f))
  (func $yielding (type $f) (i32.add (suspend $yield (local.get 0)) (i32.const 11)))
  (elem declare func $yielding)`;
 add('stack-switching','suspend-payload-resume',`(block (result i32)
  (block $suspended (result i32 (ref $c))
   (drop (resume $c (on $yield $suspended) ${i} (cont.new $c (ref.func $yielding)))) unreachable)
  (local.set $saved) (local.set $payload)
  (resume $c (i32.add (local.get $payload) (i32.const 5)) (local.get $saved)))`,x=>x+16,
  yielding,'(local $saved (ref null $c)) (local $payload i32)');

 // Discard is page-aligned; verify zeroing rather than merely accepting opcode.
 for (const [name, offset, probe] of [['first-page',0,0],['second-page',65536,65536],['last-byte',0,65535],['interior-word',0,124],['other-page-preserved',0,65536]]) {
  add('memory-control',name,`(block (result i32)
   (i32.store8 (i32.const ${probe}) (i32.add ${i} (i32.const 1)))
   (memory.discard (i32.const ${offset}) (i32.const 65536)) (i32.load8_u (i32.const ${probe})))`,
   x=>name==='other-page-preserved'?(x+1)%256:0,'(memory 2 2)', '', '', {sizes:[1,7,64]});
 }

 // Metadata is validated by dedicated binary/text checks. Execution is only a
 // semantic control; these fixtures belong to compile/instantiate comparisons.
 for (const [name, annotation] of [
  ['module-note','(@wasmfyi "module")'], ['nested-note','(@wasmfyi (nested (note "x")))'],
  ['unicode-note','(@wasmfyi "λ🌍")'], ['empty-note','(@wasmfyi)'], ['multiple-notes','(@a "a") (@b "b")'],
 ]) add('custom-annotation-syntax-in-the-text-format',name,i,x=>x,annotation,'','',{scope:'compile-and-instantiate'});

 for (const [name, declarations] of [
  ['type-name','(type $named-type (func))'], ['memory-name','(memory $named-memory 1)'],
  ['table-name','(table $named-table 1 funcref)'], ['global-name','(global $named-global i32 (i32.const 7))'],
  ['element-name','(table 1 funcref) (elem $named-element (i32.const 0) func)'],
  ['data-name','(memory 1) (data $named-data (i32.const 0) "named")'],
  ['field-name','(type $named-struct (struct (field $named-field i32)))'],
  ['tag-name','(tag $named-tag (param i32))'],
 ]) add('extended-name-section',name,i,x=>x,declarations,'','',{scope:'compile-and-instantiate',
  ...(name==='field-name'?{features:['extended-name-section','gc']}:name==='tag-name'?{features:['extended-name-section','exceptions']}:{})});

 for (const [name, section, bytes] of [
  ['priority','compilation_priority','\\01\\00\\01\\00\\02\\00\\0a'],
  ['run-once','compilation_priority','\\01\\00\\01\\00\\02\\00\\7f'],
  ['optimization','compilation_priority','\\01\\00\\01\\00\\02\\00\\01'],
  ['priority-only','compilation_priority','\\01\\00\\01\\00\\01\\03'],
  ['priority-extension','compilation_priority','\\01\\00\\01\\00\\03\\00\\0a\\00'],
 ]) add('compilation-hints',name,i,x=>x,`(@custom "metadata.code.${section}" (before code) "${bytes}")`,'','',{scope:'compile-and-instantiate',v8Flags:['--wasm-compilation-hints']});

 for(const [name,values,bytes] of [
  ['signed-bytes','(i8 -1 0 127 -128)',[255,0,127,128]],
  ['little-endian-i16','(i16 -1 0x1234)',[255,255,52,18]],
  ['little-endian-i32','(i32 0x12345678)',[120,86,52,18]],
  ['little-endian-i64','(i64 0x0123456789abcdef)',[239,205,171,137,103,69,35,1]],
  ['f32-signed-zero','(f32 -0 1.5)',[0,0,0,128,0,0,192,63]],
  ['f64-exact-fraction','(f64 -2.5)',[0,0,0,0,0,0,4,192]],
 ]) add('numeric-values-in-wat',name,`(i32.load8_u (i32.rem_u ${i} (i32.const ${bytes.length})))`,
  x=>bytes[x%bytes.length],`(memory (export "memory") 1) (data (i32.const 0) ${values})`,'','',{
   scope:'compile-and-instantiate',oracle:n=>({kind:'exact_u64',expected:[sum(n,x=>bytes[x%bytes.length])],
    memory:[{offset:0,hex:Buffer.from(bytes).toString('hex')}]})});

 const u64=x=>BigInt.asUintN(64,x).toString();
 for(const [name,input,expression,expected] of [
  ['high-bit-identity',n=>(1n<<60n)+BigInt(n),'(local.get 0)',x=>x],
  ['wrapping-add',n=>(1n<<64n)-BigInt(n)-1n,'(i64.add (local.get 0) (i64.const 17))',x=>x+17n],
  ['signed-divide',n=>-((1n<<60n)+BigInt(n)),'(i64.div_s (local.get 0) (i64.const 3))',x=>x/3n],
  ['wide-multiply',n=>(1n<<40n)+BigInt(n),'(i64.mul (local.get 0) (i64.const 4294967297))',x=>x*4294967297n],
  ['bitwise-complement',n=>(1n<<63n)+BigInt(n),'(i64.xor (local.get 0) (i64.const -1))',x=>~x],
 ]) out.push({feature:'big-int',name,wat:`(module (func (export "benchmark") (param i64) (result i64) ${expression}))`,
  args:n=>[input(n).toString()],expected:n=>u64(expected(input(n))),sizes:[1,64,4096],scope:'host-interface',
  reset:'stateless',units:1,workUnit:'host_call',hostBoundary:true});

 const trace='(@custom "metadata.code.trace_inst" (before code) "\\01\\00\\01\\03\\04\\78\\56\\34\\12")';
 for(const [name,expression,value] of [
  ['affine-region',`(i32.add (i32.mul ${i} (i32.const 7)) (i32.const 3))`,x=>7*x+3],
  ['masked-region',`(i32.and ${i} (i32.const 255))`,x=>x%256],
  ['branch-region',`(if (result i32) (i32.and ${i} (i32.const 1)) (then (i32.const 17)) (else (i32.const 5)))`,x=>x%2?17:5],
  ['division-region',`(i32.div_u ${i} (i32.const 7))`,x=>Math.floor(x/7)],
  ['remainder-region',`(i32.rem_u ${i} (i32.const 7))`,x=>x%7],
 ]) add('instrument-and-tracing-technology',name,expression,value,trace,'','',{scope:'compile-and-instantiate',v8Flags:['--wasm-instruction-tracing']});
 return out;
}
