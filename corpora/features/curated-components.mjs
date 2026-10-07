// Original bounded component workloads. Oracles use arithmetic/value semantics,
// never observed runtime results. Every exported benchmark takes/returns u64.
const sum = (n, f) => Array.from({length:n}, (_,i)=>f(i)).reduce((a,b)=>a+b,0);
const ix = '(local.get $i)';
const lo = `(i32.wrap_i64 ${ix})`;
const loop = (name, expression, locals='', before='', after='(local.get $sum)') => `
 (func (export "${name}") (param $n i64) (result i64)
  (local $i i64) (local $sum i64) ${locals} ${before}
  (block $done (loop $loop
   (br_if $done (i64.ge_u ${ix} (local.get $n)))
   (local.set $sum (i64.add (local.get $sum) ${expression}))
   (local.set $i (i64.add ${ix} (i64.const 1))) (br $loop))) ${after})`;
// Two sibling components, with typed exports from the provider lowered into
// the consumer. Keeping them distinct ensures canonical crossings are real.
function connected(types, operations, workloads) {
 const typeNames=[...types.matchAll(/\(type \$(\w+)/g)].map(([,t])=>t);
 return `(component
  (component $provider ${types}
   ${typeNames.map(t=>`(export $${t}-public "${t}-type" (type $${t}))`).join(" ")}
   (core module $m ${operations.map(o=>`(func (export "${o.name}") ${o.core} (result i64) ${o.body})`).join('\n')})
   (core instance $m (instantiate $m))
   ${operations.map(o=>`(func (export "${o.name}") ${o.type.replace(/\$(\w+)/g,"$$$1-public")} (result u64) (canon lift (core func $m "${o.name}")))`).join('\n')})
  (instance $p (instantiate $provider))
  ${typeNames.map(t=>`(alias export $p "${t}-type" (type $${t}))`).join(" ")}
  ${operations.map(o=>`(alias export $p "${o.name}" (func $${o.name}))`).join('\n')}
  (component $consumer ${types}
   ${typeNames.map(t=>`(import "${t}-type" (type $${t}-public (eq $${t})))`).join(" ")}
   ${operations.map(o=>`(import "${o.name}" (func $${o.name} ${o.type.replace(/\$(\w+)/g,"$$$1-public")} (result u64)))
   (core func $${o.name} (canon lower (func $${o.name})))`).join('\n')}
   (core instance $imports ${operations.map(o=>`(export "${o.name}" (func $${o.name}))`).join(' ')})
   (core module $bench
    ${operations.map(o=>`(import "ops" "${o.name}" (func $${o.name} ${o.core} (result i64)))`).join('\n')}
    ${workloads.map(w=>loop(w.name,w.expression,w.locals,w.before,w.after)).join('\n')})
   (core instance $b (instantiate $bench (with "ops" (instance $imports))))
   ${workloads.map(w=>`(func (export "${w.name}") (param "count" u64) (result u64) (canon lift (core func $b "${w.name}")))`).join('\n')})
  (instance $c (instantiate $consumer ${typeNames.map(t=>`(with "${t}-type" (type $${t}))`).join(" ")} ${operations.map(o=>`(with "${o.name}" (func $${o.name}))`).join(' ')}))
  ${workloads.map(w=>`(alias export $c "${w.name}" (func $${w.name})) (export "${w.name}" (func $${w.name}))`).join('\n')})`;
}
const composition = [
 {name:'sibling-pipeline',expression:`(call $bias (call $scale ${ix}))`,expected:n=>sum(n,i=>i*3+7)},
 {name:'fanout-reduction',expression:`(i64.add (call $scale ${ix}) (call $bias ${ix}))`,expected:n=>sum(n,i=>i*4+7)},
 {name:'conditional-service',expression:`(if (result i64) (i64.eqz (i64.rem_u ${ix} (i64.const 3))) (then (call $scale ${ix})) (else (call $bias ${ix})))`,expected:n=>sum(n,i=>i%3===0?3*i:i+7)},
 {name:'bounded-feedback',locals:'(local $state i64)',expression:`(block (result i64) (local.set $state (i64.rem_u (call $bias (call $scale (local.get $state))) (i64.const 257))) (local.get $state))`,expected:n=>{let state=0,total=0;for(let i=0;i<n;i++){state=(state*3+7)%257;total+=state;}return total;}}
];
const compositionWat=connected('',[
 {name:'scale',type:'(param "value" u64)',core:'(param i64)',body:'(i64.mul (local.get 0) (i64.const 3))'},
 {name:'bias',type:'(param "value" u64)',core:'(param i64)',body:'(i64.add (local.get 0) (i64.const 7))'}
],composition);
const canonical = [
 {name:'record-fields',expression:`(call $record ${lo} (i64.add ${ix} (i64.const 11)))`,expected:n=>sum(n,i=>i*5+i+11)},
 {name:'tuple-mixed-width',expression:`(call $tuple (i32.and ${lo} (i32.const 255)) ${ix} (i32.and ${lo} (i32.const 1)))`,expected:n=>sum(n,i=>(i&255)+i*2+(i&1)*13)},
 {name:'option-presence',expression:`(call $optional (i32.and ${lo} (i32.const 1)) (i64.mul ${ix} (i64.const 9)))`,expected:n=>sum(n,i=>i&1?i*9:17)},
 {name:'flags-weighted',expression:`(call $flags (i32.and ${lo} (i32.const 7)))`,expected:n=>sum(n,i=>(i&1?2:0)+(i&2?5:0)+(i&4?11:0))}
];
const canonicalWat=connected(`(type $record (record (field "small" u32) (field "wide" u64)))
 (type $tuple (tuple u8 u64 bool)) (type $optional (option u64))
 (type $flags (flags "read" "write" "execute"))`,[
 {name:'record',type:'(param "value" $record)',core:'(param i32 i64)',body:'(i64.add (i64.mul (i64.extend_i32_u (local.get 0)) (i64.const 5)) (local.get 1))'},
 {name:'tuple',type:'(param "value" $tuple)',core:'(param i32 i64 i32)',body:'(i64.add (i64.add (i64.extend_i32_u (local.get 0)) (i64.mul (local.get 1) (i64.const 2))) (i64.mul (i64.extend_i32_u (local.get 2)) (i64.const 13)))'},
 {name:'optional',type:'(param "value" $optional)',core:'(param i32 i64)',body:'(if (result i64) (local.get 0) (then (local.get 1)) (else (i64.const 17)))'},
 {name:'flags',type:'(param "value" $flags)',core:'(param i32)',body:'(i64.extend_i32_u (i32.add (i32.add (select (i32.const 2) (i32.const 0) (i32.and (local.get 0) (i32.const 1))) (select (i32.const 5) (i32.const 0) (i32.and (local.get 0) (i32.const 2)))) (select (i32.const 11) (i32.const 0) (i32.and (local.get 0) (i32.const 4)))))'}
],canonical);
// Resource handles stay opaque: only resource.rep yields the application value.
// Each call releases every created handle and resets the destructor checksum.
const resources = [
 {name:'representation-checksum',locals:'(local $h i32)',expression:`(block (result i64) (local.set $h (call $new (i32.add (i32.mul ${lo} (i32.const 3)) (i32.const 1)))) (local.set $value (i64.extend_i32_u (call $rep (local.get $h)))) (call $drop (local.get $h)) (local.get $value))`,expected:n=>sum(n,i=>3*i+1)},
 {name:'paired-live-resources',locals:'(local $a i32) (local $b i32)',expression:`(block (result i64) (local.set $a (call $new ${lo})) (local.set $b (call $new (i32.add ${lo} (i32.const 7)))) (local.set $value (i64.extend_i32_u (i32.mul (call $rep (local.get $a)) (call $rep (local.get $b))))) (call $drop (local.get $a)) (call $drop (local.get $b)) (local.get $value))`,expected:n=>sum(n,i=>i*(i+7))},
 {name:'reverse-release-batch',locals:'(local $a i32) (local $b i32) (local $c i32)',expression:`(block (result i64) (local.set $a (call $new ${lo})) (local.set $b (call $new (i32.add ${lo} (i32.const 1)))) (local.set $c (call $new (i32.add ${lo} (i32.const 2)))) (call $drop (local.get $c)) (call $drop (local.get $b)) (call $drop (local.get $a)) (i64.const 0))`,after:'(call $count)',expected:n=>sum(n,i=>{let k=3*i;return (k+1)*(i+2)+(k+2)*(i+1)+(k+3)*i;})},
 {name:'alternating-resource-types',locals:'(local $h i32)',expression:`(if (result i64) (i32.and ${lo} (i32.const 1)) (then (local.set $h (call $new-b (i32.add ${lo} (i32.const 19)))) (local.set $value (i64.extend_i32_u (call $rep-b (local.get $h)))) (call $drop-b (local.get $h)) (local.get $value)) (else (local.set $h (call $new ${lo})) (local.set $value (i64.extend_i32_u (call $rep (local.get $h)))) (call $drop (local.get $h)) (local.get $value)))`,expected:n=>sum(n,i=>i+(i&1?19:0))}
];
const resourcesWat=`(component
 (core module $state
  (global $count (mut i64) (i64.const 0)) (global $sequence (mut i64) (i64.const 0))
  (func (export "reset") (global.set $count (i64.const 0)) (global.set $sequence (i64.const 0)))
  (func (export "drop") (param i32)
   (global.set $sequence (i64.add (global.get $sequence) (i64.const 1)))
   (global.set $count (i64.add (global.get $count) (i64.mul (global.get $sequence) (i64.extend_i32_u (local.get 0))))))
  (func (export "count") (result i64) (global.get $count)))
 (core instance $s (instantiate $state))
 (type $r (resource (rep i32) (dtor (core func $s "drop"))))
 (type $rb (resource (rep i32) (dtor (core func $s "drop"))))
 (core func $new (canon resource.new $r)) (core func $rep (canon resource.rep $r)) (core func $drop (canon resource.drop $r))
 (core func $new-b (canon resource.new $rb)) (core func $rep-b (canon resource.rep $rb)) (core func $drop-b (canon resource.drop $rb))
 (core instance $r ${['new','rep','drop','new-b','rep-b','drop-b'].map(n=>`(export "${n}" (func $${n}))`).join(' ')})
 (core module $bench
  ${['new','rep','new-b','rep-b'].map(n=>`(import "res" "${n}" (func $${n} (param i32) (result i32)))`).join('\n')}
  ${['drop','drop-b'].map(n=>`(import "res" "${n}" (func $${n} (param i32)))`).join('\n')}
  (import "state" "reset" (func $reset)) (import "state" "count" (func $count (result i64)))
  ${resources.map(w=>loop(w.name,w.expression,w.locals+' (local $value i64)','(call $reset)',w.after)).join('\n')})
 (core instance $b (instantiate $bench (with "res" (instance $r)) (with "state" (instance $s))))
 ${resources.map(w=>`(func (export "${w.name}") (param "count" u64) (result u64) (canon lift (core func $b "${w.name}")))`).join('\n')})`;
export function fixtures() {
 const base={sizes:[64],abi:'component',hostProfile:'component-u64-v1',scope:'execution',reset:'stateless'};
 return [['component-model',composition,compositionWat],['cm-abi',canonical,canonicalWat],['cm-res',resources,resourcesWat]].flatMap(([feature,workloads,wat])=>workloads.map(w=>({...base,feature,name:w.name,module:feature+'-curated',export:w.name,wat,expected:w.expected})));
}
