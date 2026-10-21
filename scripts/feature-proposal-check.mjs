import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir,hostname,arch,platform} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fixtures} from '../corpora/features/generator.mjs';
import {proposalGapIds} from '../corpora/features/proposal-gaps.mjs';
import {proposalBinaryIds} from '../corpora/features/proposal-binary.mjs';
import {nativeProposalCheck,proposalD8,proposalRuntimeIdentity,PROPOSAL_VALIDATION_SIZES,unavailableProposal} from './lib/proposal-validation.mjs';
import {checkProposalMetadata} from './lib/proposal-metadata.mjs';
import {site,digest} from './lib/wasmbench.mjs';

const root=join(site,'corpora/features'),families=new Set([...proposalGapIds,...proposalBinaryIds]);
const performance=process.argv.find(a=>a.startsWith('--performance='))?.slice(14);
const rows=JSON.parse(await readFile(performance?resolve(performance,'manifest.json'):join(root,'manifest.json')));
const out=resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||join(site,'.wasmbench/proposal-coverage',performance?'performance-correctness.json':'correctness.json'));
const wasmTime=process.env.WASMBENCH_WASMTIME||'wasmtime';
const result={schema:1,created:new Date().toISOString(),timing:false,host:{hostname:hostname(),os:platform(),arch:arch()},
 sourcePolicy:'Independent deterministic expectations; runtime outputs never establish oracles. Fresh instances and reused calls are checked separately.',
 performance:Boolean(performance),engines:[],outcomes:[]};
for(const [name,binary]of [['v8',proposalD8()],['wasmtime',wasmTime]]) {
 result.engines.push({name,...await proposalRuntimeIdentity(binary)});
}
for(const f of fixtures().filter(f=>families.has(f.feature))) {
 const w=rows.find(w=>w.id.startsWith(`features/${f.feature}/${f.name}/`));
 if(!w){if(performance&&f.scope==='compile-and-instantiate')continue;throw Error('Missing proposal contract '+f.name);}
 const artifact=performance?w.artifact:join(root,w.artifact);
 const vectors=(performance?[w.size]:PROPOSAL_VALIDATION_SIZES).map(n=>({
  args:f.args?f.args(n):[n],expected:[performance&&!f.hostBoundary?Number(BigInt.asUintN(32,BigInt(f.expected(n))*64n)):f.expected(n)]}));
 let check;
 try {
  const metadata=performance?null:checkProposalMetadata(f,await readFile(artifact));
  if(f.feature==='custom-page-sizes') {
   const bytes=await readFile(artifact);
   if(digest(bytes)!==w.sha256)throw Error('Artifact digest mismatch');
   const literal=`(module binary "${Array.from(bytes,b=>'\\'+b.toString(16).padStart(2,'0')).join('')}")`;
   const directory=await mkdtemp(join(tmpdir(),'wasmfyi-pages-'));
   try {
    const file=join(directory,'check.wast');
    const assertions=vectors.flatMap(v=>Array.from({length:3},()=>`(assert_return (invoke "${w.export}" (i32.const ${v.args[0]})) (i32.const ${v.expected[0]}))`));
    await writeFile(file,Array.from({length:2},()=>[literal,...assertions].join('\n')).join('\n'));
    const args=['wast','-C','cache=n','-W','custom-page-sizes=y',file];
    const p=spawnSync(wasmTime,args,{encoding:'utf8',timeout:30000});
    if(p.error||p.status!==0)throw Error(p.error?.message||p.stderr);
    check={status:'verified',engine:'wasmtime',flags:args.slice(1,-1),freshInstances:2,reusedCallsPerInput:3};
   }finally{await rm(directory,{recursive:true,force:true});}
  } else check={...await nativeProposalCheck({...w,artifact,validationVectors:vectors}),engine:'v8'};
  if(metadata)check.metadata=metadata;
 }catch(error){
  // memory.discard is a different subproposal from V8's memory-map API.
  // Preserve the unavailable opcode as a gap; never replace it with a no-op.
  const unavailable=unavailableProposal(f.feature,error.message);
  check={status:unavailable?'unavailable':'failed',reason:error.message};
 }
 result.outcomes.push({id:w.id,sha256:w.sha256,sourceSha256:digest(await readFile(performance?w.source:join(root,w.source))),vectors,...check});
 console.log(check.status,f.feature+'/'+f.name,check.status==='verified'?'':check.reason?.split('\n')[0]);
}
result.totals=Object.fromEntries(['verified','unavailable','failed'].map(s=>[s,result.outcomes.filter(o=>o.status===s).length]));
await mkdir(resolve(out,'..'),{recursive:true});await writeFile(out,JSON.stringify(result,null,2)+'\n');
console.log(result.totals,out);
if(result.totals.failed||(process.argv.includes('--require-all')&&result.totals.unavailable))process.exitCode=1;
