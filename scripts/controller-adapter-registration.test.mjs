import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
test('an already adaptive harness receives new runtime registrations idempotently',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-registration-'));
 try{
  for(const directory of ['experiment','cmd/wasmbench','adapters/js-shell'])await mkdir(join(root,directory),{recursive:true});
  await writeFile(join(root,'experiment/types.go'),'type Options struct { AdaptiveSamples bool; SteadyOperations int; adaptiveSessions bool }');
  await writeFile(join(root,'experiment/runner.go'),'package experiment\nfunc sample(){\n\t\tswitch id {\n default: break\n }\n\t\tfor _, path := range r.Command {\n }\n}\n');
  await writeFile(join(root,'cmd/wasmbench/main.go'),'package main');
  await writeFile(join(root,'adapters/js-shell/adapter.js'),'let cachedModule, cachedSteady, cachedVectors;');
  const install=()=>run(process.execPath,['scripts/apply-controller-sampling.mjs',root]);
  await install();const first=await readFile(join(root,'experiment/runner.go'),'utf8');
  for(const id of ['wazy','chasm','chicory-jit','endive-interpreter','endive-jit','endive-redline','zwasm-interpreter','zwasm-jit','graalwasm','wasmer-cranelift','wizard-v3-int','wizard-fast-int','wizard-spc'])assert.ok(first.includes('"'+id+'"'),id);
  assert.ok(first.includes('-XX:ActiveProcessorCount=1'));
  assert.ok(first.includes('exec.LookPath("python3")'));
  assert.ok(first.includes('filepath.EvalSymlinks(python)'));
  assert.ok(first.includes('filepath.Abs(python)'));
  assert.ok(!first.includes('r.Command=[]string{"python3",script,library,mode}'));
  assert.ok(first.includes('chasm-command.json'));
  assert.ok(first.includes('managedJVM := id=="chasm"'));
  assert.ok(!first.includes('r.Command = []string{filepath.Join(root, "bin", "adapter-chasm")}'));
  await install();assert.equal(await readFile(join(root,'experiment/runner.go'),'utf8'),first);
  const canonicalPython = /python, err := exec.LookPath\("python3"\)[\s\S]*?r.Command=\[\]string\{python,script,library,mode\}/;
  await writeFile(join(root,'experiment/runner.go'),first.replace(canonicalPython,'r.Command=[]string{"python3",script,library,mode}'));
  await install();assert.equal(await readFile(join(root,'experiment/runner.go'),'utf8'),first);
  // A previously installed controller must gain dependency tracking too.
  await writeFile(join(root,'experiment/runner.go'),first.replace('managedJVM := id=="chasm" || ','managedJVM := '));
  await install();assert.equal(await readFile(join(root,'experiment/runner.go'),'utf8'),first);
 }finally{await rm(root,{recursive:true,force:true});}
});
