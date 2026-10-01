import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { config, digest, exists, site } from './lib/wasmbench.mjs';

const settings = await config();
const root = resolve(site, process.env.WASMBENCH_ROOT || settings.root);
for (const backend of ['llvm','singlepass'].filter(backend=>!process.env.WASMBENCH_RUNTIMES || process.env.WASMBENCH_RUNTIMES.split(',').includes('wasmer-'+backend))) test(`Wasmer ${backend}: real protocol, fresh stores, phase barriers and failure handling`, async context => {
  const binary = join(root, 'adapters/native/target/wasmer-'+backend+'/release/adapter-native');
  if (!await exists(binary)) {
    assert.notEqual(process.env.WASMBENCH_REQUIRE_WASMER_TESTS, '1', 'Build the selected native Wasmer adapters before testing');
    context.skip('Native Wasmer SDK and adapter are required'); return;
  }
  const directory = await mkdtemp(join(tmpdir(),'wasmer-protocol-'));
  const invoke = requests => {
    const result = spawnSync(binary, [], { input: requests.map(r=>JSON.stringify({version:1,...r})).join('\n')+'\n', encoding:'utf8', timeout:60_000 });
    assert.equal(result.status,0,result.stderr || result.error?.message);
    return result.stdout.trim().split('\n').map(line=>JSON.parse(line));
  };
  try {
    const artifact=join(directory,'fixture.wasm');
    // Original fixture, compiled with wasm-tools 1.260.0: (module (memory (export "memory") 1) (func (export "benchmark") (result i32) (i32.store (i32.const 0) (i32.add (i32.load (i32.const 0)) (i32.const 1))) (i32.load (i32.const 0))))
    await writeFile(artifact,Buffer.from('0061736d010000000105016000017f030201000503010001071602066d656d6f727902000962656e63686d61726b00000a160114004100410028020041016a36020041002802000b','hex'));
    const sha=digest(await readFile(artifact));
    const workload={schema:1,id:'test/fresh-store',abi:'core',export:'benchmark',args:[],reset:'fresh_instance_per_sample',oracle:{kind:'exact_u64',expected:['1'],memory:[{offset:0,hex:'01000000'}]}};
    const preparation={artifact,artifact_sha256:sha,profile:'memory',workload};
    const requests=[{id:1,method:'describe'},{id:2,method:'prepare',prepare:preparation}];
    for(const [index,scenario] of ['compile','instantiate','first-call','steady'].entries()) {
      const id=10+index;
      requests.push({id,method:'run',run:{scenario,samples:3,operations:1,warmup:0,phase_barriers:true}});
      for(let k=0;k<9;k++)requests.push({id,method:'continue'});
    }
    requests.push({id:30,method:'prepare',prepare:{...preparation,artifact_sha256:'0'.repeat(64)}},{id:31,method:'run',run:{scenario:'first-call',samples:1,operations:1,warmup:0}},{id:32,method:'prepare',prepare:{...preparation,workload:{...workload,abi:'component'}}},{id:33,method:'close'});
    const responses=invoke(requests);
    const description=responses.find(r=>r.id===1).description;
    assert.equal(description.runtime,'wasmer-'+backend);
    assert.equal(description.runtime_version,'7.3.0');
    assert.equal(description.backend,backend==='llvm'?'llvm-jit':'singlepass-jit');
    assert.equal(responses.find(r=>r.id===2).status,'ok');
    for(const id of [10,11,12,13]) {
      const phases=responses.filter(r=>r.id===id&&r.status==='phase');assert.equal(phases.length,9);
      const result=responses.find(r=>r.id===id&&r.status!=='phase');assert.equal(result.status,'ok',result.reason);
      assert.equal(result.samples.length,3);
      for(const sample of result.samples) {
        assert.equal(sample.verified,true);assert.deepEqual(sample.result,['1']);assert(sample.elapsed_ns>0);
        assert.equal(sample.observations[0].value,65536);
      }
    }
    assert.match(responses.find(r=>r.id===30).reason,/digest mismatch/);
    assert.match(responses.find(r=>r.id===31).reason,/prepare required/);
    assert.equal(responses.find(r=>r.id===32).status,'unsupported');
    // Preserve all i64 bits and multiple results through the C/Rust bridge.
    // Original fixture, compiled with wasm-tools 1.260.0: (module (func (export "benchmark") (param i64) (result i64 i32) local.get 0 i32.const -1))
    await writeFile(artifact,Buffer.from('0061736d0100000001070160017e027e7f03020100070d010962656e63686d61726b00000a080106002000417f0b','hex'));
    const wide=invoke([{id:1,method:'prepare',prepare:{artifact,artifact_sha256:digest(await readFile(artifact)),profile:'timing',workload:{...workload,reset:'stateless',args:['18446744073709551615'],oracle:{kind:'exact_u64',expected:['18446744073709551615','4294967295']}}}},{id:2,method:'run',run:{scenario:'steady',samples:2,operations:5,warmup:1}},{id:3,method:'close'}]);
    assert.equal(wide[1].status,'ok',wide[1].reason);assert.equal(wide[1].samples.length,3);
    for(const sample of wide[1].samples){assert.deepEqual(sample.result,['18446744073709551615','4294967295']);assert.equal(sample.operations,5);assert.equal(sample.verified,true);}
    // A real guest trap must remain a failed execution, never a timing sample.
    // Original fixture, compiled with wasm-tools 1.260.0: (module (func (export "benchmark") (result i32) unreachable))
    await writeFile(artifact,Buffer.from('0061736d010000000105016000017f03020100070d010962656e63686d61726b00000a05010300000b','hex'));
    const trapped=invoke([{id:1,method:'prepare',prepare:{artifact,artifact_sha256:digest(await readFile(artifact)),profile:'timing',workload:{...workload,oracle:{kind:'exact_u64',expected:['0']}}}},{id:2,method:'run',run:{scenario:'first-call',samples:1,operations:1,warmup:0}},{id:3,method:'close'}]);
    assert.equal(trapped[0].status,'ok');assert.equal(trapped[1].status,'error');assert.match(trapped[1].reason,/guest trap/);assert.equal(trapped[1].samples,undefined);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
