import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('completed cache retirement preserves runners and rejects incomplete weeks',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'weekly-retire-')),base=join(temp,'weekly-20260919'),root=join(base,'harness/wasmtime'),target=join(root,'adapters/wasmtime/target'),analyzer=join(target,'release/wasm-analyze'),runner=join(target,'release/adapter-wasmtime');
 try{
  await mkdir(join(target,'release/deps'),{recursive:true});await writeFile(analyzer,'analyzer');await writeFile(runner,'runner');await writeFile(join(target,'release/deps/cache'),'regenerable');
  await writeFile(join(base,'wasmtime-build.json'),JSON.stringify({root,controller:join(base,'controller'),runtime:{command:[runner]}}));
  await writeFile(join(base,'weekly-run.json'),JSON.stringify({status:'paused'}));
  await assert.rejects(exec(process.execPath,[resolve('scripts/weekly-retire.mjs'),base]),/Cannot retire an incomplete week/);
  await writeFile(join(base,'weekly-run.json'),JSON.stringify({status:'collected'}));await exec(process.execPath,[resolve('scripts/weekly-retire.mjs'),base]);
  assert.equal(await readFile(runner,'utf8'),'runner');assert.equal(await readFile(analyzer,'utf8'),'analyzer');assert.equal(await stat(join(target,'release/deps')).catch(()=>null),null);
 }finally{await rm(temp,{recursive:true,force:true});}
});
