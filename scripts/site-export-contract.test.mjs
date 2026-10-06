import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {verifySiteExportContract} from './lib/site-export-contract.mjs';
import {digest,site} from './lib/wasmbench.mjs';
const exec=promisify(execFile);
const contract={schema:1,format:'site-v2',exportSchema:2,verification:'source-recomputed',chunkBytes:262144,binaryBytes:16777216,inventoryObjects:512,inventoryPages:512};

test('producer contract admission is versioned and bounded before collection',async()=>{
  let invocation;
  assert.deepEqual(await verifySiteExportContract('/prepared/controller',{cwd:'/prepared',execute:async(...args)=>{invocation=args;return {stdout:JSON.stringify(contract)}}}),contract);
  assert.deepEqual(invocation[1],['export-site','--describe']);
  assert.equal(invocation[2].timeout,30_000);assert.equal(invocation[2].maxBuffer,16*1024);
  for(const change of [{schema:2},{format:'legacy'},{exportSchema:3},{verification:'unchecked'},{chunkBytes:262145},{binaryBytes:16777217},{inventoryObjects:513},{inventoryPages:513},{chunkBytes:0},{binaryBytes:null},{inventoryObjects:1.5}])
    await assert.rejects(verifySiteExportContract('controller',{execute:async()=>({stdout:JSON.stringify({...contract,...change})})}),/requires a controller supporting/);
  await assert.rejects(verifySiteExportContract('controller',{execute:async()=>({stdout:'help or malformed JSON'})}),/requires a controller supporting/);
  await assert.rejects(verifySiteExportContract('controller',{execute:async()=>{throw Error('unknown command')}}),/requires a controller supporting/);
  const canceled=new AbortController();canceled.abort();let called=false;
  await assert.rejects(verifySiteExportContract('controller',{signal:canceled.signal,execute:async()=>{called=true}}));assert.equal(called,false);
});

test('cached API preparation probes its hashed controller; legacy reuse does not',async()=>{
  const root=await mkdtemp(join(tmpdir(),'wasmfyi-export-contract-'));
  try {
    const controller=join(root,'controller'),marker=join(root,'probe.json'),identity='a'.repeat(64);
    const prepare=async(publication,response,includeController=true)=>{
      const script='#!'+process.execPath+'\n'+`import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},JSON.stringify(process.argv.slice(2))); console.log(${JSON.stringify(JSON.stringify(response))});\n`;
      // The extension is intentionally .mjs: execute a synthetic controller only.
      const path=controller+'.mjs';await writeFile(path,script,{mode:0o700});
      await writeFile(join(root,'plan.json'),JSON.stringify({identity,engines:[],collection:{},publication}));
      await writeFile(join(root,'host.json'),JSON.stringify({harness:root,controller:path}));
      await writeFile(join(root,'ready.json'),JSON.stringify({plan:identity,files:includeController?[{path,sha256:digest(Buffer.from(script))}]:[]}));
      return exec(process.execPath,[join(site,'scripts/benchmark-prepare.mjs'),root],{timeout:10_000,maxBuffer:16*1024});
    };
    await prepare({type:'api-v1'},contract);
    assert.deepEqual(JSON.parse(await readFile(marker)),['export-site','--describe']);
    await rm(marker);
    await assert.rejects(prepare({type:'api-v1'},{...contract,exportSchema:1}),/requires a controller supporting/);
    await rm(marker);
    await assert.rejects(prepare({type:'api-v1'},contract,false),/missing from the tool hash receipt/);
    await assert.rejects(access(marker));
    await prepare(undefined,{exportSchema:1});
    await assert.rejects(access(marker));
  } finally {await rm(root,{recursive:true,force:true})}
});

test('built producer describes export support without source evidence',{skip:!process.env.WASMFYI_PRODUCER_BIN},async()=>{
  const binary=process.env.WASMFYI_PRODUCER_BIN;
  assert.deepEqual(await verifySiteExportContract(binary),contract);
  await assert.rejects(exec(binary,['export-site','--describe','--report','/nonexistent/report']),/does not accept evidence/);
  await assert.rejects(exec(binary,['export-site','--describe','--out','/nonexistent/output']),/does not accept evidence/);
  await assert.rejects(exec(binary,['export-site','--describe','--native-disassembly','/nonexistent/diagnostics']),/does not accept evidence/);
});
