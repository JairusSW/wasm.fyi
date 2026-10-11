import {createHash} from 'node:crypto';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {qualifiedEngineFatal} from './lib/qualified-engine-failure.mjs';import {historyIntegrationFailure} from './lib/history-completion-audit.mjs';
const root=process.env.WASMFYI_TEST_CAMPAIGN;
test('source-bound actual engine fatal proof exempts only its sealed adapter termination',{skip:!root},()=>{
 const proof=JSON.parse(readFileSync(root+'/engine-failure-classifications/zwasm-jit-b84f9f97-pcre2.json'));const status=JSON.parse(readFileSync(root+'/zwasm-history-status.json'));const done=status.completed.find(d=>d.pinKey===`${proof.identity.engine}|main|${proof.identity.source.revision}|${proof.identity.source.asOf}`);const error=done.workloadErrors.find(e=>e.workload===proof.identity.workload);assert(historyIntegrationFailure(error));assert(qualifiedEngineFatal(error,done,proof));
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
