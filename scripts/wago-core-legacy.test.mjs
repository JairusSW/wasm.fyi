import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {adaptCoreLegacyWago} from './lib/wago-core-legacy.mjs';
const base=new URL('../../../Tools/wasm-bench/',import.meta.url).pathname;
for(const slots of [false,true])test(`generates a core-only historical embedding for ${slots?'slot':'Value'} APIs`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'wago-core-'));
 try {
  await mkdir(join(root,'adapters/wago'),{recursive:true});await mkdir(join(root,'experiment'));
  const original=await readFile(join(base,'adapters/wago/main.go'),'utf8');
  const api=slots?'func (in *Instance) Invoke(export string, args ...uint64)\nfunc CompileWithConfig(\ntype SyncHostFunc \ntype TrapError \nfunc (c *Compiled) Close()':'';
  const receipt=await adaptCoreLegacyWago({root,base,api,run:promisify(execFile)});
  const main=await readFile(join(root,'adapters/wago/main.go'),'utf8'),bridge=await readFile(join(root,'adapters/wago/historical_core.go'),'utf8');
  assert.doesNotMatch(main,/wago\.NewRuntime\(|componentRuntime|wago "github.com\/wago-org\/wago"/);
  assert.match(main,/historicalIdentityImports\(\)/);
  assert.match(bridge,/wago\.Instantiate\(c.Compiled, imports\)/);
  assert.equal(receipt.sdkModified,false);
  assert.equal(await readFile(join(base,'adapters/wago/main.go'),'utf8'),original);
  if(slots){assert.match(bridge,/wago\.SyncHostFunc/);assert.match(bridge,/protocol\.AssemblyScriptAbort/);assert.doesNotMatch(bridge,/"math"/)}
  else {assert.match(bridge,/wago\.I32\(0\).Type/);assert.match(bridge,/wago\.Value/);assert.match(bridge,/identity return signature unavailable/);assert.match(bridge,/func \(c \*historicalCompiled\) Close/)}
 }finally{await rm(root,{recursive:true,force:true})}
});
