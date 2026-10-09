import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('capture audit rejects startup failures without a qualified runtime version',async()=>{
 const root=await mkdtemp(join(tmpdir(),'capture-audit-'));
 try{
 const hash='a'.repeat(64),revision='b'.repeat(40),date='2026-10-04T03:59:00.000Z';
 await mkdir(join(root,'captures'));
 await writeFile(join(root,'source-plan.json'),JSON.stringify({samples:5,pins:[{status:'planned',engine:'wasmedge',configurations:['wasmedge-jit'],targetType:'main',revision,targetWeek:date,repository:'WasmEdge/WasmEdge'}]}));
 await writeFile(join(root,'collection-template.json'),JSON.stringify({machine:'test',collection:{samples:5},workloads:[{id:'applications/test',sha256:hash}]}));
 await writeFile(join(root,'captures/test.json'),JSON.stringify({platform:{memoryBytes:1024},source:{kind:'main',revision,asOf:date,repository:'WasmEdge/WasmEdge'},results:['compile','instantiate','first-call','steady'].map(phase=>({phase,engine:'wasmedge-jit',version:'unknown',workload:'applications/test',artifactSha256:hash,latencyStatus:'failed'}))}));
 execFileSync(process.execPath,['scripts/audit-history-corpus-captures.mjs',root]);
 const audit=JSON.parse(await readFile(join(root,'corpus-capture-audit.json')));
 assert.equal(audit.machines[0].errors.length,1);
 assert.equal(audit.machines[0].completeTargets,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
