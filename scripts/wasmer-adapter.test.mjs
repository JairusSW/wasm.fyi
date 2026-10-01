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
      requests.push({id,method:'run',run:{scenario,samples:3,operations:1,warmup:scenario==='steady'?0:3,phase_barriers:true}});
      for(let k=0;k<9;k++)requests.push({id,method:'continue'});
    }
    requests.push({id:30,method:'prepare',prepare:{...preparation,artifact_sha256:'0'.repeat(64)}},{id:31,method:'run',run:{scenario:'first-call',samples:1,operations:1,warmup:0}},{id:32,method:'prepare',prepare:{...preparation,workload:{...workload,abi:'component'}}},{id:33,method:'close'});
    const responses=invoke(requests);
    const description=responses.find(r=>r.id===1).description;
    assert.equal(description.runtime,'wasmer-'+backend);
    assert.equal(description.runtime_version,'7.3.0');
    assert.equal(description.capabilities.can_code_profile,false);
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
    assert.match(description.effective_configuration.assemblyscript_abort_policy,/guest trap/);
    for(const [kind,bytes] of [['unused','0061736d01000000010c0260047f7f7f7f006000017f020d0103656e760561626f7274000003020101070d010962656e63686d61726b00010a0601040041070b000f046e616d65010801000561626f7274'],['called','0061736d01000000010c0260047f7f7f7f006000017f020d0103656e760561626f7274000003020101070d010962656e63686d61726b00010a10010e004100410041004100100041070b000f046e616d65010801000561626f7274'],['signature','0061736d0100000001090260017e006000017f020d0103656e760561626f7274000003020101070d010962656e63686d61726b00010a0601040041070b000f046e616d65010801000561626f7274']]) {
      await writeFile(artifact,Buffer.from(bytes,'hex'));
      const abort=invoke([{id:1,method:'prepare',prepare:{artifact,artifact_sha256:digest(await readFile(artifact)),profile:'timing',workload:{...workload,host_profile:'assemblyscript-abort-v1',oracle:{kind:'exact_u64',expected:['7']}}}},{id:2,method:'run',run:{scenario:'first-call',samples:2,operations:1,warmup:0}},{id:3,method:'close'}]);
      assert.equal(abort[0].status,'ok');assert.equal(abort[1].status,kind==='unused'?'ok':kind==='called'?'error':'unsupported',abort[1].reason);
      if(kind==='called'){assert.match(abort[1].reason,/AssemblyScript abort/);assert.equal(abort[1].samples,undefined);}
    }
    // Ordered outputs 1,2,3 prove sequence order and fresh-instance resets.
    await writeFile(artifact,Buffer.from('0061736d01000000010b026000017f60037f7f7f0003040300000105030100010606017f0141000b072f04066d656d6f7279020009696e7075745f70747200000a6f75747075745f70747200010962656e63686d61726b00020a1e0305004180010b05004180020b1000230041016a2400200223003a00000b0011046e616d65070a010007636f756e746572','hex'));
    const vector={...workload,oracle:{kind:'exact_vectors',expected:[]},vector_byte_budget:8,vectors:{input_offset:0,output_offset:64,input_ptr_export:'input_ptr',output_ptr_export:'output_ptr',output_len:1,mod:251,cases:[{len:0,out:'01'},{len:1,out:'02'},{len:2,out:'03'}]}};
    const vectorPrep={artifact,artifact_sha256:digest(await readFile(artifact)),profile:'memory',workload:vector};
    const vectorRequests=[{id:1,method:'prepare',prepare:vectorPrep},{id:2,method:'run',run:{scenario:'first-call',samples:2,operations:1,warmup:0,phase_barriers:true}},...Array.from({length:6},()=>({id:2,method:'continue'})),{id:3,method:'prepare',prepare:{...vectorPrep,workload:{...vector,vectors:{...vector.vectors,cases:[{len:0,out:'00'}]}}}},{id:4,method:'run',run:{scenario:'first-call',samples:1,operations:1,warmup:0}},{id:5,method:'prepare',prepare:{...vectorPrep,workload:{...vector,vector_byte_budget:1}}},{id:6,method:'close'}];
    const vectorResults=invoke(vectorRequests);
    assert.equal(vectorResults.filter(r=>r.id===2&&r.status==='phase').length,6);
    const sequence=vectorResults.find(r=>r.id===2&&r.status!=='phase');assert.equal(sequence.status,'ok',sequence.reason);
    for(const sample of sequence.samples){assert.equal(sample.sample_type,'sequence_call_sum');assert.equal(sample.operations,1);assert.equal(sample.verified,true);assert.equal(sample.observations[0].value,65536);assert(sample.elapsed_ns>0);}
    assert.equal(vectorResults.find(r=>r.id===4).status,'error');assert.match(vectorResults.find(r=>r.id===4).reason,/vector 0 memory mismatch/);
    assert.match(vectorResults.find(r=>r.id===5).reason,/byte budget exceeded/);
    // A real guest trap must remain a failed execution, never a timing sample.
    // Original fixture, compiled with wasm-tools 1.260.0: (module (func (export "benchmark") (result i32) unreachable))
    await writeFile(artifact,Buffer.from('0061736d010000000105016000017f03020100070d010962656e63686d61726b00000a05010300000b','hex'));
    const trapped=invoke([{id:1,method:'prepare',prepare:{artifact,artifact_sha256:digest(await readFile(artifact)),profile:'timing',workload:{...workload,oracle:{kind:'exact_u64',expected:['0']}}}},{id:2,method:'run',run:{scenario:'first-call',samples:1,operations:1,warmup:0}},{id:3,method:'close'}]);
    assert.equal(trapped[0].status,'ok');assert.equal(trapped[1].status,'error');assert.match(trapped[1].reason,/guest trap/);assert.equal(trapped[1].samples,undefined);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
