import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {corpusGroups,collectCorpusByCorpus} from './corpus-collection.mjs';

test('corpus collection groups artifact variants and preserves corpus order',()=>{
 assert.deepEqual(corpusGroups([{id:'a',sha256:'x'},{id:'b',sha256:'y'},{id:'c',sha256:'x'}]).map(g=>g.map(w=>w.id)),[['a','c'],['b']]);
});
for(const mechanisms of [false,true])test(`each corpus completes all profiles${mechanisms?' and precise calls':''}, keeps evidence and cleans scratch before the next`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'corpus-order-'));
 const {createHash}=await import('node:crypto');
 const calls=[];const runtimes=mechanisms?'wago,v8':'wago';
 try {
  await mkdir(join(root,'.wasmbench'));const directory=join(root,'pair-unique');await mkdir(directory);
  const suite=join(root,'suite.json');await writeFile(suite,JSON.stringify([{id:mechanisms?'mechanisms/host-to-wasm-call':'a',sha256:'x'},{id:mechanisms?'mechanisms/wasm-to-host-call':'b',sha256:'y'}]));
  const run=(command,...args)=>{
   const option=name=>args[args.indexOf(name)+1];
   calls.push([command,option('--profile'),args]);
   if(command==='run') {
    const out=option('--out');
    // Synchronous mock mirrors the harness CLI seam used by production.
    const fs=requireFs;fs.mkdirSync(join(out,'trials'),{recursive:true});
    fs.writeFileSync(join(out,'manifest.json'),'{}');fs.writeFileSync(join(out,'checksums.json'),'{}');fs.writeFileSync(join(out,'trials','trial.json'),'{}');
    if(out.includes('corpus-0002'))assert(!fs.existsSync(join(directory,'corpus-0001')));
   } else if(command==='report') {
    const fs=requireFs,out=option('--out');fs.mkdirSync(out);
    const data=JSON.stringify({schema:1,bundle:{manifest:{id:option('--run').split('/').at(-1),kind:'measurement',lock:{options:{profile:'timing'},runtime_configurations:runtimes.split(',').map(id=>({id,description:{runtime_version:'fixture'}}))}},trials:[]}});
    fs.writeFileSync(join(out,'data.json'),data);fs.writeFileSync(join(out,'checksums.json'),JSON.stringify({'data.json':createHash('sha256').update(data).digest('hex')}));
   }
   return '';
  };
  const requireFs=await import('node:fs');
  const reports=await collectCorpusByCorpus({directory,suite,runtimes,collection:{memory:true,code:true,timeout:'5m',launches:1,samples:1,operations:1,warmup:0},run,number:(_name,fallback)=>fallback,site:root});
  assert.deepEqual(calls.filter(([name])=>name==='run').map(([,profile])=>profile),mechanisms?['timing','memory','code','timing','timing','memory','code','timing']:['timing','memory','code','timing','memory','code']);
  if(mechanisms) {
   const callRuns=calls.filter(([command,,args])=>command==='run' && args[args.indexOf('--operations')+1]==='1000000');
   assert.equal(callRuns.length,2);
   for(const [,,args] of callRuns) {
    assert.equal(args[args.indexOf('--samples')+1],'3');
    assert.equal(args[args.indexOf('--runtimes')+1],'wago,v8');
    assert.equal(args[args.indexOf('--workers')+1],'1');
   }
  }
  assert.equal(new Set(JSON.parse(await readFile(join(root,'.wasmbench/latest-reports.json')))).size,mechanisms?4:2);
  assert.equal(reports.length,mechanisms?4:2);
  assert(!(await readdir(directory)).some(name=>name.startsWith('corpus-')));
  assert.equal(JSON.parse(await readFile(join(directory,'collection.json'))).completed.length,2);
  const callsBeforeResume=calls.length;
  const resumed=await collectCorpusByCorpus({directory,suite,runtimes,collection:{},run,number:(_name,fallback)=>fallback,site:root});
  assert.deepEqual(resumed,reports);assert.equal(calls.length,callsBeforeResume);
 } finally {await rm(root,{recursive:true,force:true});}
});
