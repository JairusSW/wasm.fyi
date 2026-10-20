import {readFile,writeFile,mkdir,mkdtemp,rm,readdir} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {tmpdir,hostname,arch,platform} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {site,digest,command} from './lib/wasmbench.mjs';
import {featureCompiler} from './lib/feature-toolchain.mjs';
import {proposalD8,proposalRuntimeIdentity} from './lib/proposal-validation.mjs';
import {upstreamRoot,proposalSuites,prepareProposalSuite} from './lib/proposal-upstream.mjs';

const root=join(site,'corpora/features/host-proposals'),out=join(site,'.wasmbench/proposal-coverage');
await mkdir(root,{recursive:true});await mkdir(out,{recursive:true});
const compiler=await featureCompiler();
if(command(compiler,['--version']).toString().trim()!=='wasm-tools 1.260.0')throw Error('Pinned wasm-tools required');
const definitions=[
 ['named-function','(module (func (export "value") (result i32) i32.const 7))'],
 ['immutable-global','(module (global (export "value") i32 (i32.const 42)))'],
 ['memory-segment','(module (memory (export "memory") 1) (data (i32.const 0) "\\00\\7f\\80\\ff"))'],
 ['host-import','(module (import "./esm-host.mjs" "step" (func $step (param i32) (result i32))) (func (export "benchmark") (param i32) (result i32) local.get 0 call $step))'],
 ['source-phase','(module (func (export "value") (result i32) i32.const 7))'],
];
const contracts=[];
for(const [name,wat]of definitions) {
 const source=join(root,'esm-'+name+'.wat'),artifact=join(root,'esm-'+name+'.wasm');
 await writeFile(source,wat+'\n');command(compiler,['parse',source,'-o',artifact]);command(compiler,['validate',artifact]);
 contracts.push({feature:'esm-integration',name,source,artifact,sourceSha256:digest(await readFile(source)),sha256:digest(await readFile(artifact)),phase:name==='source-phase'?'source-import':'module-linking',scope:'host-interface'});
}
const reflection=['function-type','typed-host-function','global-type','memory-type','table-type'];
const memoryMaps=['zero-initialization','mapped-write','unmap-zero','adjacent-preserved','remap-data'];
const cCases=['direct-call','host-callback','mutable-global','memory-access','table-call','trap-lifecycle'];
for(const name of reflection)contracts.push({feature:'type-reflection',name,source:join(root,'reflection.mjs'),scope:'host-interface',phase:'host-api'});
for(const name of memoryMaps)contracts.push({feature:'memory-control',name,source:join(root,'memory-map.js'),scope:'host-interface',phase:'native-memory-map'});
for(const name of cCases)contracts.push({feature:'wasm-c-api',name,source:join(root,'c-api.c'),scope:'host-interface',phase:'host-api'});

const report={schema:1,created:new Date().toISOString(),timing:false,host:{hostname:hostname(),os:platform(),arch:arch()},
 engines:[await proposalRuntimeIdentity(process.execPath),await proposalRuntimeIdentity(proposalD8())],outcomes:[]};
function execute(feature,name,binary,args,{cwd=site,env=process.env}={}) {
 const p=spawnSync(binary,args,{cwd,env,encoding:'utf8',timeout:30000,maxBuffer:4<<20});
 const output=(p.stdout||'')+(p.stderr||'');
 const unavailable=/Native (?:type-reflection|memory-map) API unavailable|Failed to create a MemoryMapDescriptor|`wasm_\w+` is not implemented/.test(output);
 const status=p.error?'runner-error':p.status===0?'verified':unavailable?'unavailable':p.signal?'crashed':'failed';
 const row={feature,name,status,binary,args,exitCode:p.status,signal:p.signal,error:p.error?.message,stdout:p.stdout,stderr:p.stderr};
 report.outcomes.push(row);console.log(status,feature+'/'+name);
 return row;
}
const artifact=name=>join(root,'esm-'+name+'.wasm');
for(const [name]of definitions)for(const size of [1,7,64,4096])execute('esm-integration',name+'/'+size,process.execPath,['--experimental-wasm-modules',join(root,'esm.mjs'),name,pathToFileURL(artifact(name)).href,String(size)]);
for(const name of reflection)for(const size of [1,7,64,4096])execute('type-reflection',name+'/'+size,process.execPath,['--experimental-wasm-type-reflection',join(root,'reflection.mjs'),name,artifact('named-function'),String(size)]);
for(const name of memoryMaps)execute('memory-control',name,proposalD8(),['--wasm-memory-control',join(root,'memory-map.js'),'--',name]);

const prefix=process.env.WASMBENCH_WASMTIME_C_PREFIX||'/opt/homebrew';
const header=await readFile(join(prefix,'include/wasmtime.h'),'utf8').catch(()=>null);
if(!header?.includes('#define WASMTIME_VERSION "46.0.1"')) {
 for(const name of cCases)report.outcomes.push({feature:'wasm-c-api',name,status:'unavailable',reason:'Wasmtime 46.0.1 C library required'});
} else {
 const binary=join(out,'wasm-c-api-corpus');
 const compile=execute('wasm-c-api','build','clang',['-std=c11','-O2','-Wall','-Wextra','-Werror',join(root,'c-api.c'),'-I'+join(prefix,'include'),'-L'+join(prefix,'lib'),'-lwasmtime','-Wl,-rpath,'+join(prefix,'lib'),'-o',binary]);
 if(compile.status==='verified') {
  report.cLibrary={version:'46.0.1',headerSha256:digest(header),librarySha256:digest(await readFile(join(prefix,'lib/libwasmtime.dylib'))),binarySha256:digest(await readFile(binary))};
  for(const name of cCases)for(const size of [0,1,7,64,4096])execute('wasm-c-api',name+'/'+size,binary,[name,String(size)]);
 }
 // Run every C example shipped by this exact Wasmtime release, preserving build
 // and execution failures. This is the examples suite, not all Rust API tests.
 const upstream=join(upstreamRoot,'wasmtime');
 const pin=proposalSuites.find(s=>s.id==='wasmtime');
 await prepareProposalSuite(pin);
 report.upstreamCExamples={repository:pin.repository,revision:pin.revision,archiveSha256:pin.archiveSha256,files:[]};
 for(const name of (await readdir(join(upstream,'examples'))).filter(n=>n.endsWith('.c')).sort()) {
  report.upstreamCExamples.files.push({path:'examples/'+name,sha256:digest(await readFile(join(upstream,'examples',name)))});
  const binary=join(out,'upstream-c-'+name.slice(0,-2));
  const built=execute('wasmtime-c-examples',name+'/build','clang',['-O2',join(upstream,'examples',name),'-I'+join(prefix,'include'),'-L'+join(prefix,'lib'),'-lwasmtime','-Wl,-rpath,'+join(prefix,'lib'),'-pthread','-lm','-o',binary]);
  if(built.status==='verified')execute('wasmtime-c-examples',name,binary,[],{cwd:upstream});
 }
}

// Serve real HTTP CSP headers to a native browser. Each case has an allowed
// and denied counterpart; no script simulation stands in for browser policy.
const wasm=await readFile(artifact('named-function'));
const apis=['compile','instantiate','compileStreaming','instantiateStreaming','module-constructor'];
const chrome=process.env.WASMBENCH_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browserVersion=spawnSync(chrome,['--version'],{encoding:'utf8'});
report.browser={binary:chrome,version:browserVersion.stdout?.trim(),fixtureSha256:digest(wasm)};
const server=createServer((req,res)=>{
 if(req.url==='/fixture.wasm'){res.setHeader('Content-Type','application/wasm');res.end(wasm);return;}
 const [,policy,api]=req.url.split('/');
 const allow=policy==='allow';
 res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'unsafe-inline'${allow?" 'wasm-unsafe-eval'":''}`);
 res.setHeader('Content-Type','text/html');
 res.end(`<!doctype html><body>pending<script type="module">
const api=${JSON.stringify(api)},allow=${allow};
try {
 const response=await fetch('/fixture.wasm'),bytes=await response.clone().arrayBuffer();
 let module,instance;
 if(api==='compile')module=await WebAssembly.compile(bytes);
 else if(api==='instantiate')({module,instance}=await WebAssembly.instantiate(bytes));
 else if(api==='compileStreaming')module=await WebAssembly.compileStreaming(response);
 else if(api==='instantiateStreaming')({module,instance}=await WebAssembly.instantiateStreaming(response));
 else module=new WebAssembly.Module(bytes);
 if(!allow)throw Error('CSP did not block Wasm');
 instance??=new WebAssembly.Instance(module);
 if(instance.exports.value()!==7)throw Error('Incorrect Wasm result');
 document.body.textContent='WASMFYI:verified';
}catch(error){document.body.textContent=!allow&&error instanceof WebAssembly.CompileError?'WASMFYI:verified':'WASMFYI:failed '+String(error);}
</script>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
 for(const api of apis)for(const policy of ['allow','deny']) {
  const profile=await mkdtemp(join(tmpdir(),'wasmfyi-csp-'));
  const args=['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}/${policy}/${api}`];
  const p=await new Promise(resolve=>{
   const child=spawn(chrome,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
   const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
   child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
   child.on('error',error=>{clearTimeout(timer);resolve({error:error.message,stdout,stderr});});
   child.on('close',(exitCode,signal)=>{clearTimeout(timer);resolve({exitCode,signal,stdout,stderr});});
  });
  // Match rendered body, not the marker embedded in the script source.
  const passed=p.exitCode===0&&/<body>WASMFYI:verified<\/body>/.test(p.stdout);
  const row={feature:'web-content-security-policy',name:policy+'-'+api,status:passed?'verified':p.error?'unavailable':p.signal?'crashed':'failed',...p};
  report.outcomes.push(row);console.log(row.status,row.feature+'/'+row.name);
  if(policy==='allow')contracts.push({feature:row.feature,name:api,source:new URL(import.meta.url).pathname,scope:'host-interface',phase:api,policy:"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",artifact:artifact('named-function'),sha256:digest(wasm)});
  await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
}finally{await new Promise(resolve=>server.close(resolve));}
for(const contract of contracts) {
 contract.sourceSha256=digest(await readFile(contract.source));
 contract.id=`features/${contract.feature}/${contract.name}`;
 contract.source=relative(site,contract.source);
 if(contract.artifact)contract.artifact=relative(site,contract.artifact);
 contract.license='MIT';
 const outcomes=report.outcomes.filter(row=>row.feature===contract.feature&&(row.name===contract.name||row.name.startsWith(contract.name+'/')));
 contract.validation=outcomes.length&&outcomes.every(row=>row.status==='verified')?'verified':outcomes.some(row=>row.status==='failed')?'failed':'unavailable';
 if(contract.validation==='verified') {
  let argv;
  if(contract.feature==='esm-integration')argv=['node','--experimental-wasm-modules','corpora/features/host-proposals/esm.mjs',contract.name,relative(site,artifact(contract.name)),'4096'];
  if(contract.feature==='type-reflection')argv=['node','--experimental-wasm-type-reflection','corpora/features/host-proposals/reflection.mjs',contract.name,relative(site,artifact('named-function')),'4096'];
  if(contract.feature==='wasm-c-api')argv=['.wasmbench/proposal-coverage/wasm-c-api-corpus',contract.name,'4096'];
  contract.performance={iterations:4096,phase:contract.phase,argv,policy:'Native host source workload, validated at this size. Separate from portable Wasm steady contracts and not a collected timing result.'};
 }
}
await writeFile(join(root,'manifest.json'),JSON.stringify({schema:1,pathBase:'repository-root',policy:'Native embedding contracts; kept separate from portable Wasm execution. These are source/performance recipes, not collected timings. Compatibility counts have no quota or cap.',contracts},null,2)+'\n');
report.totals=Object.fromEntries(['verified','unavailable','failed','crashed','runner-error'].map(s=>[s,report.outcomes.filter(o=>o.status===s).length]));
await writeFile(join(out,'host-correctness.json'),JSON.stringify(report,null,2)+'\n');
console.log(report.totals);
if(report.totals.failed||report.totals.crashed||report.totals['runner-error'])process.exitCode=1;
