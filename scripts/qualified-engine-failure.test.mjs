import {createHash} from 'node:crypto';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {qualifiedEngineFatal} from './lib/qualified-engine-failure.mjs';import {historyIntegrationFailure} from './lib/history-completion-audit.mjs';
import {workloadContract} from './lib/workload-contract.mjs';

// Small protocol fixtures keep qualification coverage independent of retained
// campaign dumps. The same verifier also runs against actual host evidence below.
function fatalFixture(reason){
 const files=new Map(),hash=b=>createHash('sha256').update(b).digest('hex');
 const put=(path,value)=>{const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));files.set(path,bytes);return{path,sha256:hash(bytes)}};
 const source={repository:'zwasm/zwasm',revision:'a'.repeat(40),ref:'main@aaaaaaaa',asOf:'2026-10-15T07:33:48.082Z',kind:'snapshot'};
 const platform={os:'linux',arch:'amd64',cpu:'Fixture CPU',cores:1,kernel:'fixture'};
 const phases=['compile','instantiate','first-call','steady'],engine='zwasm-jit';
 const workload={id:'wago/pcre2/compile-match',sha256:'b'.repeat(64),abi:'core',export:'benchmark',args:[],oracle:{kind:'exact_u64',expected:['0']},reset:'stateless'};
 const controller=put('/controller','controller'),adapter=put('/adapter','adapter');
 const runtime={id:engine,command:['/adapter','--jit'],file_sha256:{'/adapter':adapter.sha256}};
 const error={engine,workload:workload.id,source:source.ref,asOf:source.asOf,error:reason,phases};
 const proof={schema:1,classification:'qualified-engine-fatal',identity:{engine,workload:workload.id,source,platform,artifactSHA256:workload.sha256,contractSHA256:workloadContract(workload),controllerSHA256:controller.sha256,runtime}};
 proof.originalCapture=put('/original.json',{source,platform,results:phases.map(phase=>({phase,engine,workload:workload.id,version:source.revision,artifactSha256:workload.sha256,contractSha256:proof.identity.contractSHA256,latencyStatus:'failed',timingSamples:0}))});
 proof.originalFailureNote=put('/note.json',{engine,workload:workload.id,source,phases,reason});
 proof.sdkReceipt=put('/sdk.json',{pin:{revision:source.revision,repository:source.repository,targetWeek:source.asOf},controller:'/controller',controllerSha256:controller.sha256,runtime});
 const diagnostic={source,workload:workload.id,sdkReceiptSHA256:proof.sdkReceipt.sha256,controllerSHA256:controller.sha256,runtime,result:{code:1,signal:null},elapsedMs:100};
 const manifest={host:{...platform,cpu_description:platform.cpu,logical_cpus:platform.cores},lock:{runner_sha256:controller.sha256,workloads:[workload],runtime_configurations:[{...runtime,description:{runtime_version:source.revision,backend:'jit'}}]}};
 proof.diagnostic={receipt:put('/diagnostic.json',diagnostic),manifest:put('/capture/manifest.json',manifest),fatalLog:put('/capture/logs/check-0-0.log','zwasm: internal error — caught a fatal signal. This is a bug in zwasm (not a wasm trap); please report it.')};
 put('/capture/trials/check.json',{id:'check-0-0',runtime_configuration:engine,workload:workload.id,status:'error',reason:'adapter terminated before response (see trial log)',log:'logs/check-0-0.log'});
 for(const scenario of phases)put('/capture/trials/'+scenario+'.json',{id:scenario,scenario,runtime_configuration:engine,workload:workload.id,status:'preflight_failed',reason:'sacrificial check check-0-0: adapter terminated before response (see trial log)'});
 proof.sealedFiles=[...files].map(([path,bytes])=>({path,sha256:hash(bytes)}));
 return qualifiedEngineFatal(error,{configuration:engine,pinKey:`${engine}|main|${source.revision}|${source.asOf}`},proof,path=>{assert(files.has(path));return files.get(path)});
}
test('qualifies exact adaptive termination messages without admitting unrelated integration errors',()=>{
 const fatal='adapter terminated before response (see trial log)';
 for(const prefix of ['', 'sacrificial check check-0-0: ',...['compile','instantiate','first-call','steady'].map(phase=>`adaptive phase ${phase}: `)])assert.equal(fatalFixture(prefix+fatal),true,prefix);
 assert.equal(fatalFixture(fatal+'; adaptive phase compile: '+fatal),true);
 for(const reason of ['adaptive phase compile: SDK API unavailable','adaptive phase arbitrary: '+fatal,fatal+'; Cannot find module x','unqualified '+fatal])assert.equal(fatalFixture(reason),false,reason);
});
const root=process.env.WASMFYI_TEST_CAMPAIGN;
test('source-bound actual engine fatal proof exempts only its sealed adapter termination',{skip:!root},()=>{
 const proof=JSON.parse(readFileSync(process.env.WASMFYI_TEST_FAILURE_PROOF||root+'/engine-failure-classifications/zwasm-jit-b84f9f97-pcre2.json'));const status=JSON.parse(readFileSync(root+'/zwasm-history-status.json'));const done=status.completed.find(d=>d.pinKey===`${proof.identity.engine}|main|${proof.identity.source.revision}|${proof.identity.source.asOf}`);const error=done.workloadErrors.find(e=>e.workload===proof.identity.workload);assert(historyIntegrationFailure(error));assert(qualifiedEngineFatal(error,done,proof));
 const copy=x=>JSON.parse(JSON.stringify(x));
 for(const [field,value] of [['engine','unrelated'],['workload','other'],['asOf','2026-06-28T00:00:00.000Z'],['source','main@other']])assert.equal(qualifiedEngineFatal({...error,[field]:value},done,proof),false,field);
 for(const field of ['artifactSHA256','contractSHA256','controllerSHA256']){const p=copy(proof);p.identity[field]='0'.repeat(64);assert.equal(qualifiedEngineFatal(error,done,p),false,field);}
 {const p=copy(proof);p.identity.source.revision='0'.repeat(40);assert.equal(qualifiedEngineFatal(error,done,p),false);}
 {const p=copy(proof);p.identity.platform.cpu='Other';assert.equal(qualifiedEngineFatal(error,done,p),false);}
 {const p=copy(proof);p.identity.runtime.command[0]='/other';assert.equal(qualifiedEngineFatal(error,done,p),false);}
 for(const field of ['originalCapture','originalFailureNote']){const p=copy(proof);p[field].sha256='0'.repeat(64);assert.equal(qualifiedEngineFatal(error,done,p),false,field);}
 for(const descriptor of [proof.diagnostic.fatalLog,proof.diagnostic.manifest,proof.sdkReceipt,proof.originalFailureNote])assert.equal(qualifiedEngineFatal(error,done,proof,path=>path===descriptor.path?Buffer.from('changed'):readFileSync(path)),false,descriptor.path);
 assert.equal(qualifiedEngineFatal(error,done,proof,()=>{throw Error('missing proof')}),false);
 for(const extra of ['Cannot find module x','protocol version or request identity mismatch','Invalid ordered latency samples'])assert.equal(qualifiedEngineFatal({...error,error:error.error+'; '+extra},done,proof),false,extra);

 const mutateEvidence=(descriptor,mutate)=>{const p=copy(proof),object=JSON.parse(readFileSync(descriptor.path));mutate(object);const bytes=Buffer.from(JSON.stringify(object));const sha=createHash('sha256').update(bytes).digest('hex');for(const f of p.sealedFiles)if(f.path===descriptor.path)f.sha256=sha;const update=v=>{if(v&&typeof v==='object'){if(v.path===descriptor.path)v.sha256=sha;for(const child of Object.values(v))if(child&&typeof child==='object')update(child);}};update(p);return qualifiedEngineFatal(error,done,p,path=>path===descriptor.path?bytes:readFileSync(path));};
 for(const ms of [null,-1,300001,'293'])assert.equal(mutateEvidence(proof.diagnostic.receipt,d=>d.elapsedMs=ms),false,String(ms));
 assert.equal(mutateEvidence(proof.diagnostic.receipt,d=>d.result.signal='SIGSEGV'),false);
 assert.equal(mutateEvidence(proof.originalCapture,c=>c.results[1].phase=c.results[0].phase),false);
 assert.equal(mutateEvidence(proof.diagnostic.manifest,m=>m.host.cpu_description='Other CPU'),false);
 assert.equal(qualifiedEngineFatal(error,{...done,pinKey:'other'},proof),false);assert.equal(qualifiedEngineFatal(error,done,{}),false);
});
