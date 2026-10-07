// Untimed correctness checks for original curated execution kernels. Upstream
// conformance selections have their own runner and never enter timing suites.
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {curatedFixtures} from '../corpora/features/curated.mjs';
import {checkV8} from './lib/v8-corpus.mjs';
import {site, digest} from './lib/wasmbench.mjs';
const root=join(site,'corpora/features');
const manifest=JSON.parse(await readFile(join(root,'manifest.json')));
const outcomes=[];
const wasmtime=process.env.WASMBENCH_WASMTIME || 'wasmtime';
const wtVersion=spawnSync(wasmtime,['--version'],{encoding:'utf8'});
for(const f of curatedFixtures()) {
  const w=manifest.find(w=>w.id===`features/${f.feature}/${f.name}/${f.sizes[0]}`);
  if(!w)throw Error('Missing built curated contract: '+f.name);
  const artifact=join(root,w.artifact);
  if(digest(await readFile(artifact))!==w.sha256)throw Error('Artifact digest mismatch: '+w.id);
  for(const n of f.validationSizes || [1,7,64,127]) {
    const args=f.args?f.args(n):[f.abi==='component'?String(n):n];
    const oracle=f.oracle?f.oracle(n):{kind:'exact_u64',expected:[f.abi==='component'?String(f.expected(n)):f.expected(n)]};
    try {
      if(f.abi==='component') {
        if(wtVersion.error?.code==='ENOENT'){outcomes.push({id:w.id,n,status:'unavailable',reason:'Wasmtime executable not installed'});continue;}
        if(wtVersion.status!==0||!/^wasmtime 46\.0\.1\b/.test(wtVersion.stdout))throw Error('Component verification requires Wasmtime 46.0.1');
        for(let r=0;r<3;r++) {
          const result=spawnSync(wasmtime,['run','-C','cache=n','--invoke',`${w.export}(${args.join(',')})`,artifact],{encoding:'utf8',timeout:30000,maxBuffer:2<<20});
          if(result.error||result.status!==0)throw Error(result.error?.message || result.stderr);
          if(result.stdout.trim()!==oracle.expected.map(String).join('\n'))throw Error('Component result differs from independent oracle');
        }
        outcomes.push({id:w.id,n,status:'verified',repetitions:3,engine:wtVersion.stdout.trim()});
      } else outcomes.push({id:w.id,n,...await checkV8({...w,artifact,args,oracle}),engine:process.version});
    } catch(error) {outcomes.push({id:w.id,n,status:'failed',reason:error.message});}
  }
}
await mkdir(join(site,'.wasmbench'),{recursive:true});
await writeFile(join(site,'.wasmbench/feature-curation-check.json'),JSON.stringify({schema:1,timing:false,outcomes},null,2)+'\n');
for(const o of outcomes.filter(o=>o.status!=='verified'))console.log(o.status,o.id,o.n,o.reason);
console.log(`Curated kernels: ${outcomes.filter(o=>o.status==='verified').length} verified, ${outcomes.filter(o=>o.status==='unavailable').length} unavailable, ${outcomes.filter(o=>o.status==='failed').length} failed; all checks untimed.`);
if(outcomes.some(o=>o.status==='failed') || (process.argv.includes('--require-all')&&outcomes.some(o=>o.status!=='verified')))process.exitCode=1;
