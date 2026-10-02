import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {harness,site,command,digest} from './lib/wasmbench.mjs';
import {releaseSource,assertReleasedSource} from './lib/release-policy.mjs';
const {root,run}=await harness();
const runtimes=process.env.WASMBENCH_AUDIT_RUNTIMES?.split(',') || ['wago','wazero','v8-optimizing-only','v8-liftoff-only'];
if(!runtimes.length || new Set(runtimes).size!==runtimes.length || runtimes.some(id=>!['wago','wazero','v8-optimizing-only','v8-liftoff-only'].includes(id)))throw Error('Unknown or duplicate compile-audit runtime');
const singleGo=runtimes.length===1&&['wago','wazero'].includes(runtimes[0]);
if(!singleGo&&(!runtimes.includes('wago')||!runtimes.includes('wazero')))throw Error('Select the complete audit, both Go engines, or one Go engine');
const wazeroVersion=process.env.WASMBENCH_AUDIT_WAZERO_VERSION || 'v1.12.0';
if(!/^v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(wazeroVersion))throw Error('Invalid scratch wazero version');
const output=resolve(process.argv[2] || join(site,'.wasmbench/compile-latency-audit',new Date().toISOString().replace(/[:.]/g,'-')));
await mkdir(output,{recursive:true});
const release=runtimes.includes('wago')?await releaseSource('wago-org/wago',{tag:process.env.WASMBENCH_AUDIT_WAGO_TAG}):null;
if(release)assertReleasedSource(release.source,release);
const scratch=join(output,'scratch');await mkdir(scratch,{recursive:true});
const source=await readFile(join(site,singleGo?`adapters/audit/${runtimes[0]}-single.go.txt`:'adapters/audit/compile.go'));
await writeFile(join(scratch,'main.go'),source);
if(!singleGo&&!release)throw Error('V8-only audit requires a standalone scratch path; select the complete audit or one Go engine');
await writeFile(join(scratch,'go.mod'),`module wasm.fyi/compile-audit\n\ngo 1.26.0\n\nrequire (\n${runtimes.includes('wazero')?` github.com/tetratelabs/wazero ${wazeroVersion}\n`:''}${release?' github.com/wago-org/wago v0.0.0\n':''})\n${release?`replace github.com/wago-org/wago => ${JSON.stringify(release.source)}\n`:''}`);
command('go',['mod','tidy'],{cwd:scratch});command('go',['build','-trimpath','-o',join(scratch,'compile-audit'),'.'],{cwd:scratch});
const scratchBuild=command('go',['version','-m',join(scratch,'compile-audit')]).toString();
if(runtimes.includes('wazero')&&!scratchBuild.includes('github.com/tetratelabs/wazero\t'+wazeroVersion+'\t'))throw Error('Scratch wazero dependency differs from requested release');
const wanted=['image-blur','stencil-lattice-boltzmann','language-register-vm'];
const suite=JSON.parse(await readFile(join(site,'corpora/applications/manifest.json'))).filter(w=>wanted.includes(w.id.split('/')[1])).map(w=>({...w,artifact:join(site,'corpora/applications',w.artifact)}));
if(suite.length!==3)throw Error('Missing audit fixtures');
const raw=command(join(scratch,'compile-audit'),suite.map(w=>w.artifact)).toString();await writeFile(join(output,'scratch.jsonl'),raw);
const references=raw.trim().split('\n').map(JSON.parse);
const v8References={};
for(const mode of ['optimizing-only','liftoff-only']) {
 if(!runtimes.includes('v8-'+mode))continue;
 const flags=['--allow-natives-syntax',mode==='liftoff-only'?'--liftoff-only':'--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation','--no-wasm-native-module-cache'];
 const measured=command(process.execPath,[...flags,join(site,'adapters/audit/v8.mjs'),...suite.map(w=>w.artifact)]).toString();
 await writeFile(join(output,'scratch-v8-'+mode+'.jsonl'),measured);
 v8References['v8-'+mode]=measured.trim().split('\n').map(JSON.parse);
}

const manifest=join(output,'suite.json');await writeFile(manifest,JSON.stringify(suite)+'\n');
const bundle=join(output,'compile-audit-'+digest(output).slice(0,12));process.stdout.write(run('run','--archive-tools=true','--suite',manifest,'--runtimes',runtimes.join(','),'--scenarios','compile','--profile','timing','--launches','3','--samples','5','--operations','1','--warmup','0','--out',bundle));
process.stdout.write(run('verify','--run',bundle));
const trials=await Promise.all((await readdir(join(bundle,'trials'))).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(join(bundle,'trials',f)))));
const comparisons=[];
for(const w of suite)for(const engine of runtimes){
 const reference=references.find(r=>r.artifact===w.artifact);
 const ns=trials.filter(t=>t.workload===w.id&&t.runtime_configuration===engine&&t.block>=0).flatMap(t=>{if(t.status!=='ok')throw Error('Failed audit trial');return t.samples.filter(s=>!s.warmup).map(s=>{if(!s.verified)throw Error('Unverified audit sample');return s.elapsed_ns/s.operations;});}).sort((a,b)=>a-b);
 if(ns.length!==15)throw Error('Incomplete audit samples');
 const scratchNs=engine.startsWith('v8-')?v8References[engine].find(r=>r.artifact===w.artifact).medianNs:reference[engine==='wago'?'wago_fresh_compile_ns':'wazero_fresh_runtime_ns'];const harnessNs=ns[Math.floor(ns.length/2)],ratio=harnessNs/scratchNs;
 comparisons.push({engine,workload:w.id,artifactSha256:w.sha256,harnessNs,scratchNs,ratio,passed:ratio>=0.25&&ratio<=4});
}
const report={schema:1,created:new Date().toISOString(),host:process.platform+'/'+process.arch,release,wazeroVersion:runtimes.includes('wazero')?wazeroVersion:null,scratchBuild,scratchSourceSha256:digest(source),goVersion:command('go',['version']).toString().trim(),harnessRoot:root,policy:'Resident Wasm bytes; compile API only. Runtime construction, invocation verification and release excluded. Fresh uncached modules. Three launches x five verified harness samples compared with 15 scratch calls; ratio must be 0.25..4.',comparisons};
await writeFile(join(output,'audit-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(comparisons,null,2));if(comparisons.some(c=>!c.passed))throw Error('Compile timings failed independent scratch ballpark check');
