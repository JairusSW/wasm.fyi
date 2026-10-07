// Untimed adaptation of Wasmtime's pinned strings.rs positive vectors.
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {stringRoundtripComponent} from '../corpora/features/upstream-adapters/component-strings.mjs';
import {site,digest} from './lib/wasmbench.mjs';
import {featureCompiler} from './lib/feature-toolchain.mjs';
const root=join(site,'corpora/features/upstream');
const index=JSON.parse(await readFile(join(root,'index.json')));
const source=index.sources.find(s=>s.localPath==='vectors/wasmtime-component-string-positive.json');
const bytes=await readFile(join(root,source.localPath));
if(digest(bytes)!==source.localSha256)throw Error('Pinned Wasmtime vector integrity mismatch');
const vectors=JSON.parse(bytes).cases;
const wasmtime=process.env.WASMBENCH_WASMTIME || 'wasmtime';
const version=spawnSync(wasmtime,['--version'],{encoding:'utf8'});
const compiler=await featureCompiler();
const compilerVersion=spawnSync(compiler,['--version'],{encoding:'utf8'});
const unavailable=version.error?.code==='ENOENT'?'Wasmtime executable not installed':compilerVersion.error?.code==='ENOENT'?'wasm-tools executable not installed':null;
const outcomes=[];
if(unavailable)for(let i=0;i<vectors.length;i++)outcomes.push({case:i,status:'unavailable',reason:unavailable});
else {
 if(version.status!==0||!/^wasmtime 46\.0\.1\b/.test(version.stdout))throw Error('Use Wasmtime 46.0.1 for this pinned conformance adapter');
 if(compilerVersion.status!==0||!/^wasm-tools 1\.260\.0\b/.test(compilerVersion.stdout))throw Error('Use wasm-tools 1.260.0');
 const temp=await mkdtemp(join(tmpdir(),'wasmfyi-string-conformance-'));
 const modules=new Map();
 try {
  for(let i=0;i<vectors.length;i++) {
   const c=vectors[i],pair=c.fromEncoding+'-'+c.toEncoding;
   try {
    if(c.operation!=='component-string-roundtrip')throw Error('Unknown vector operation');
    if(!modules.has(pair)) {
     const wat=join(temp,pair+'.wat'),artifact=join(temp,pair+'.wasm');
     await writeFile(wat,stringRoundtripComponent(c.fromEncoding,c.toEncoding));
     const compiled=spawnSync(compiler,['parse',wat,'-o',artifact],{encoding:'utf8',timeout:30000});
     if(compiled.error||compiled.status!==0)throw Error(compiled.error?.message||compiled.stderr);
     const validated=spawnSync(compiler,['validate','--features','all',artifact],{encoding:'utf8',timeout:30000});
     if(validated.error||validated.status!==0)throw Error(validated.error?.message||validated.stderr);
     modules.set(pair,artifact);
    }
    const result=spawnSync(wasmtime,['run','-C','cache=n','--invoke',`roundtrip(${JSON.stringify(c.input)})`,modules.get(pair)],{encoding:'utf8',timeout:30000,maxBuffer:2<<20});
    if(result.error||result.status!==0)throw Error(result.error?.message||result.stderr);
    if(JSON.parse(result.stdout.trim())!==c.expected)throw Error('Component string differs from pinned upstream expectation');
    outcomes.push({case:i,pair,status:'verified'});
   }catch(error){outcomes.push({case:i,pair,status:'failed',reason:error.message});}
  }
 }finally{await rm(temp,{recursive:true,force:true});}
}
await mkdir(join(site,'.wasmbench'),{recursive:true});
await writeFile(join(site,'.wasmbench/feature-upstream-components.json'),JSON.stringify({schema:1,timing:false,source:source.upstreamUrl,engine:version.stdout?.trim(),compiler:compilerVersion.stdout?.trim(),adapterSha256:digest(await readFile(join(site,'corpora/features/upstream-adapters/component-strings.mjs'))),outcomes},null,2)+'\n');
for(const o of outcomes.filter(o=>o.status!=='verified'))console.log(o.status,o.case,o.reason);
console.log(`Wasmtime string conformance: ${outcomes.filter(o=>o.status==='verified').length} verified, ${outcomes.filter(o=>o.status==='unavailable').length} unavailable, ${outcomes.filter(o=>o.status==='failed').length} failed; untimed.`);
if(outcomes.some(o=>o.status==='failed')||(process.argv.includes('--require-all')&&outcomes.some(o=>o.status!=='verified')))process.exitCode=1;
