import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';

// The pinned upstream encoder supplies wire constants, not our workloads or
// expected results. Keep support for proposals absent from wasm-tools' grammar.
const encoder = readFileSync(new URL('./third-party/v8/wasm-module-builder.js', import.meta.url), 'utf8');
const sha256 = createHash('sha256').update(encoder).digest('hex');
if(sha256!=='2d04976cccbf1b11de25438fd411a355f3444529dc32cc04f2873df2ce9aaf4b')throw Error('Pinned V8 encoder digest mismatch');
const sources = [{repository:'https://github.com/v8/v8', revision:'34f4bf16f621ceba505ef2b7b818d48d09a5d3d3',
 path:'test/mjsunit/wasm/wasm-module-builder.js', sha256, relationship:'unmodified BSD-3-Clause binary encoder'}];
const binaryWat = bytes => `(module binary "${Array.from(bytes,b=>'\\'+b.toString(16).padStart(2,'0')).join('')}")`;

function kernels() {
 const out=[];
 const get = [kExprLocalGet,1];
 const c = n=>[kExprI32Const,...wasmSignedLeb(n)];
 const gc = op=>[kGCPrefix,...wasmUnsignedLeb(op)];
 const simd = op=>[kSimdPrefix,...(Array.isArray(op)?op:[op])];
 const add = (feature,name,flags,make,expected,options={}) => out.push({feature,name,flags,make,expected,...options});
 const build = (expression, setup, repeats=1) => {
  const b=new WasmModuleBuilder();
  const code=expression(b);
  const kernel=b.addFunction('benchmark',kSig_i_i).addLocals(kWasmI32,2).addBody([
   ...(setup?.(b)||[]),
   kExprBlock,kWasmVoid,kExprLocalGet,0,kExprI32Eqz,kExprBrIf,0,
   kExprLoop,kWasmVoid,
   kExprLocalGet,2,code,kExprI32Add,kExprLocalSet,2,
   get,c(1),kExprI32Add,kExprLocalSet,1,
   get,kExprLocalGet,0,kExprI32LtU,kExprBrIf,0,
   kExprEnd,kExprEnd,kExprLocalGet,2,
  ].flat(Infinity)).exportFunc();
  if(repeats>1)b.addFunction('performance',kSig_i_i).addLocals(kWasmI32,2).addBody([
   kExprLoop,kWasmVoid,kExprLocalGet,2,kExprLocalGet,0,kExprCallFunction,kernel.index,kExprI32Add,kExprLocalSet,2,
   kExprLocalGet,1,c(1),kExprI32Add,kExprLocalTee,1,c(repeats),kExprI32LtU,kExprBrIf,0,
   kExprEnd,kExprLocalGet,2,
  ].flat(Infinity)).exportFunc();
  return b.toBuffer();
 };
 const bounded=[get,c(255),kExprI32And];
 const half=[bounded,kExprF32UConvertI32,simd(kExprF16x8Splat)];
 for(const [name,op,rhs,value] of [
  ['lane-add',kExprF16x8Add,2,x=>x%256+2],
  ['lane-subtract',kExprF16x8Sub,3,x=>x%256-3],
  ['lane-multiply',kExprF16x8Mul,2,x=>x%256*2],
  ['lane-minimum',kExprF16x8Min,127,x=>Math.min(x%256,127)],
  ['lane-maximum',kExprF16x8Max,127,x=>Math.max(x%256,127)],
 ]) add('half-precision',name,['--wasm-fp16'],r=>build(()=>[
   half,wasmF32Const(rhs),simd(kExprF16x8Splat),simd(op),simd(kExprF16x8ExtractLane),5,kExprI32SConvertF32],null,r),value);

 // Cross the BMP boundary halfway through each input cycle, so Unicode lengths
 // are data-dependent rather than a constant loop contribution.
 const point=[bounded,c(0xff80),kExprI32Add,gc(kExprStringFromCodePoint)];
 const permuted=[get,c(17),kExprI32Mul,c(255),kExprI32And,c(0xff80),kExprI32Add,gc(kExprStringFromCodePoint)];
 const small=[get,c(63),kExprI32And,c(945),kExprI32Add,gc(kExprStringFromCodePoint)];
 for(const [name,expression,value] of [
  ['utf16-length',[point,gc(kExprStringMeasureWtf16)],x=>x%256<128?1:2],
  ['utf8-length',[point,gc(kExprStringMeasureUtf8)],x=>x%256<128?3:4],
  ['concat-length',[point,small,gc(kExprStringConcat),gc(kExprStringMeasureWtf16)],x=>x%256<128?2:3],
  ['value-equality',[point,permuted,gc(kExprStringEq)],x=>x%16===0?1:0],
  ['codeunit-access',[small,gc(kExprStringAsWtf16),c(0),gc(kExprStringViewWtf16GetCodeunit)],x=>945+x%64],
 ]) add('stringref',name,['--wasm-stringref'],r=>build(()=>expression,null,r),value);

 for(const [name,opcode,value] of [
  ['rmw-add',kExprI32AtomicAdd,x=>4*x+7], ['rmw-subtract',kExprI32AtomicSub,x=>4*x-7],
  ['rmw-exchange',kExprI32AtomicExchange,x=>3*x+7], ['rmw-xor',kExprI32AtomicXor,x=>3*x+(x^7)],
  ['compare-exchange',kExprI32AtomicCompareExchange,x=>3*x+7],
 ]) add('acquire-release-atomics',name,['--wasm-acquire-release'],r=>build(b=>{
  b.addMemory(1,1,true);
  b.exportMemoryAs('memory');
  return [c(0),get,kAtomicPrefix,kExprI32AtomicStore,2,0,
   c(0),...(name==='compare-exchange'?[get]:[]),c(7),kAtomicPrefix,opcode,0x22,0x11,0,
   c(3),kExprI32Mul,c(0),kAtomicPrefix,kExprI32AtomicLoad,0x22,0x01,0,kExprI32Add];
 },null,r),value);

 // The descriptors carry a changing payload; both object and descriptor
 // operations are observed. Full native upstream tests cover casts and interop.
 for(const [name,operation,value] of [
  ['payload-read','payload',x=>x], ['descriptor-read','descriptor',x=>x+7],
  ['identity','identity',()=>1], ['mutable-payload','mutate',x=>3*x],
  ['default-payload','default',()=>0],
 ]) add('custom-descriptors',name,['--wasm-custom-descriptors'],r=>{
  let initialize;
  return build(b=>{
  b.startRecGroup();
  const t=b.addStruct({fields:[makeField(kWasmI32,true)],descriptor:1,final:true});
  const d=b.addStruct({fields:[makeField(kWasmI32,false)],describes:t,final:true});
  b.endRecGroup();
  const roots=b.addArray(wasmRefNullType(t));
  const root=b.addGlobal(wasmRefNullType(roots),true,false,[kExprRefNull,...wasmSignedLeb(roots)]);
  initialize=[kExprLocalGet,0,kGCPrefix,kExprArrayNewDefault,roots,kExprGlobalSet,root.index];
  b.addFunction('retained-count',kSig_i_v).addBody([kExprGlobalGet,root.index,kGCPrefix,kExprArrayLen]).exportFunc();
  b.addFunction('retained-object',makeSig([kWasmI32],[wasmRefNullType(t)])).addBody([
   kExprGlobalGet,root.index,kExprLocalGet,0,kGCPrefix,kExprArrayGet,roots]).exportFunc();
  b.addFunction('retained-value',kSig_i_i).addBody([
   kExprGlobalGet,root.index,kExprLocalGet,0,kGCPrefix,kExprArrayGet,roots,kGCPrefix,kExprStructGet,t,0]).exportFunc();
  const fn=b.addFunction('operate',kSig_i_i).addLocals(wasmRefNullType(t),1).addBody([
   ...(operation==='default'?[]:[kExprLocalGet,0]),
   kExprLocalGet,0,c(7),kExprI32Add,kGCPrefix,kExprStructNew,d,
   kGCPrefix,operation==='default'?kExprStructNewDefaultDesc:kExprStructNewDesc,t,
   kExprLocalSet,1,
   ...(operation==='mutate'?[kExprLocalGet,1,kExprLocalGet,0,c(3),kExprI32Mul,kGCPrefix,kExprStructSet,t,0]:[]),
   kExprGlobalGet,root.index,kExprLocalGet,0,kExprLocalGet,1,kGCPrefix,kExprArraySet,roots,
   kExprLocalGet,1,
   ...(operation==='descriptor'?[kGCPrefix,kExprRefGetDesc,t,kGCPrefix,kExprStructGet,d,0]:
    operation==='identity'?[kExprLocalGet,1,kExprRefEq]:[kGCPrefix,kExprStructGet,t,0]),
  ].flat(Infinity));
  return [get,kExprCallFunction,fn.index];
  },()=>initialize,r);
 },value,{retainedRoots:{multiplier:operation==='default'?0:operation==='mutate'?3:1}});
 return out;
}

export const proposalBinaryIds=['half-precision','stringref','acquire-release-atomics','custom-descriptors'];
export function proposalBinaryBytes(wat) {
 const match=/^\(module binary "((?:\\[0-9a-f]{2})*)"\)$/.exec(wat.trim());
 if(!match)throw Error('Expected generated binary module literal');
 return Buffer.from(match[1].replaceAll('\\',''),'hex');
}
export function proposalBinaryFixtures() {
 const definitions=runInNewContext(encoder+'\n('+kernels.toString()+')()',{}, {timeout:5000});
 return definitions.map(f=>({feature:f.feature,name:f.name,wat:binaryWat(f.make(1)),
  performanceWat:()=>binaryWat(f.make(64)),
  expected:n=>{let total=0;for(let i=0;i<n;i++)total=(total+f.expected(i))>>>0;return total;},
  sizes:[1,64,4096],scope:'execution',reset:'stateless',nativeValidation:true,v8Flags:[...f.flags],
  ...(f.retainedRoots?{retainedRoots:{...f.retainedRoots}}:{}),sources}));
}
