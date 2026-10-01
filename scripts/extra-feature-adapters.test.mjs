import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { config,exists,site } from './lib/wasmbench.mjs';
const settings=await config(),root=resolve(site,process.env.WASMBENCH_ROOT || settings.root);
const manifest=JSON.parse(await readFile(join(site,'corpora/features/manifest.json')));
function protocol(command,workload,scenario='steady',mutate=()=>{}) {
  const w=structuredClone(workload);w.args=w.args.map(String);w.oracle.expected=w.oracle.expected.map(String);
  const prepare={artifact:join(site,'corpora/features',w.artifact),artifact_sha256:w.sha256,profile:'timing',workload:w};mutate(prepare);
  const requests=[{method:'describe'},{method:'prepare',prepare},{method:'run',run:{scenario,operations:1,samples:3,warmup:0}},{method:'close'}].map((r,i)=>({...r,version:1,id:i+1}));
  const result=spawnSync(command[0],command.slice(1),{input:requests.map(r=>JSON.stringify(r)).join('\n')+'\n',encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  assert.equal(result.status,0,result.stderr);return result.stdout.trim().split('\n').map(line=>JSON.parse(line));
}
for(const runtime of ['wasmi','wasmedge','wavm','wamr','chicory'])test(`${runtime} verifies real lifecycle calls and withholds samples for changed inputs or failed oracles`,async context=>{
  const binary=join(root,'bin',runtime==='chicory'?'adapter-chicory.jar':'adapter-'+runtime);
  if(!await exists(binary)) {
    if(runtime!=='wavm'||process.platform==='darwin')assert.notEqual(process.env.WASMBENCH_REQUIRE_EXTRA_FEATURE_TESTS,'1','Build the feature adapters first');context.skip('Native feature adapters unavailable');return;
  }
  const java=process.env.WASMBENCH_JAVA || (process.platform==='darwin'?'/opt/homebrew/opt/openjdk@25/bin/java':'java');
  const command=runtime==='chicory'?[java,'-jar',binary]:[binary];
  const scalar=manifest.find(w=>w.id==='features/core-num/integer-multiply-add/64');
  for(const scenario of ['compile','instantiate','first-call','steady']) {
    const responses=protocol(command,scalar,scenario);
    assert.equal(responses[0].description.runtime,runtime);
    assert.equal(responses[1].status,'ok');assert.equal(responses[2].status,'ok',responses[2].reason);
    assert.equal(responses[2].samples.length,3);assert(responses[2].samples.every(s=>s.verified&&s.elapsed_ns>=0));
  }
  const digest=protocol(command,scalar,'steady',p=>p.artifact_sha256='0'.repeat(64));
  assert.equal(digest[1].status,'error');assert.equal(digest[2].samples,undefined);
  const wrong=protocol(command,scalar,'steady',p=>p.workload.oracle.expected=['18446744073709551615']);
  assert.equal(wrong[2].status,'error');assert.match(wrong[2].reason,/oracle mismatch/);assert.equal(wrong[2].samples,undefined);
  const memory=manifest.find(w=>w.id==='features/core-mem/load-store-sequential/64');
  const badMemory=protocol(command,memory,'steady',p=>p.workload.oracle.memory=[{offset:0,hex:'ffffffff'}]);
  assert.equal(badMemory[2].status,'error');assert.match(badMemory[2].reason,/memory oracle mismatch/);assert.equal(badMemory[2].samples,undefined);
  const fresh=manifest.find(w=>w.id==='features/core-mem/memory-grow/1');
  assert.equal(protocol(command,fresh)[2].status,'ok','fresh instances must not accumulate memory.grow across samples');
});
