// Private inputs are copied by content into the local cache, never uploaded.
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {parseCorpusJSON} from '../lib/corpus.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function values(text,label){
 const list=parseCorpusJSON(text);
 if(!Array.isArray(list)||list.some(v=>!(typeof v==='number'&&Number.isSafeInteger(v)||typeof v==='string'&&/^\d+$/.test(v))||BigInt(v)<0n||BigInt(v)>0xffffffffffffffffn))throw Error(label+' must be a JSON array of unsigned 64-bit integers (quote large values)');
 return list.map(String);
}
export async function customWorkloads(options,cache){
 const rows=[];
 for(const file of options.wasm||[]){
  if(!options.expected)throw Error('--wasm requires --expected (use [] for a void result), or use --manifest for a full workload contract');
  if(!options.export||options.export.length>256)throw Error('A non-empty --export is required');
  rows.push({schema:1,id:'custom/'+basename(file,'.wasm').replace(/[^a-zA-Z0-9_.-]/g,'-'),family:'custom',artifact:resolve(file),abi:'core',features:['mvp'],export:options.export,args:values(options.wasmArgs||'[]','--args'),oracle:{kind:'exact_u64',expected:values(options.expected,'--expected')},reset:'stateless',work_unit:'invocation',units_per_invocation:1,license:'private',generator:'wasmfyi-local-input-v1'});
 }
 for(const file of options.manifests||[]){
  const manifest=parseCorpusJSON(await readFile(file,'utf8'));
  if(!Array.isArray(manifest))throw Error('Custom manifest must be an array of workload contracts');
  for(const w of manifest){
   if(!w.id||!w.artifact||!w.oracle)throw Error('Custom manifest requires id, artifact and oracle');
   // Rebase paths, including command/initialization inputs, against the manifest.
   const pathKeys=new Set(['artifact','source']);
   const rebase=(v,key)=>typeof v==='string'&&pathKeys.has(key)?resolve(dirname(resolve(file)),v):Array.isArray(v)?v.map(x=>rebase(x,'')):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rebase(x,k)])):v;
   rows.push(rebase(w,''));
  }
 }
 if(new Set(rows.map(w=>w.id)).size!==rows.length)throw Error('Duplicate custom workload IDs; use unique filenames or manifest IDs');
 for(const w of rows){
  const bytes=await readFile(w.artifact);
  const header=bytes.subarray(0,8),core=header.equals(Buffer.from([0,97,115,109,1,0,0,0])),component=header.equals(Buffer.from([0,97,115,109,13,0,1,0]));
  if(!core&&!(component&&w.abi==='component'))throw Error('Not a WebAssembly module for the declared ABI: '+w.artifact);
  const sha256=hash(bytes);
  if(w.sha256&&w.sha256!==sha256)throw Error('Custom artifact differs from manifest: '+w.id);
  w.sha256=sha256;w.artifactName=basename(w.artifact);w.bytes=bytes.length;
  const destination=join(cache,'artifacts',sha256+'.wasm');await mkdir(dirname(destination),{recursive:true});
  const temporary=destination+'.'+randomUUID();
  try{await writeFile(temporary,bytes,{flag:'wx',mode:0o600});await rename(temporary,destination)}finally{await rm(temporary,{force:true})}
  w.artifact=destination;
 }
 return rows;
}
