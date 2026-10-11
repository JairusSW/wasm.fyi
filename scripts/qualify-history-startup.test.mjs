import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {qualifyHistoryStartup} from './lib/qualify-history-startup.mjs';
const execute=promisify(execFile);
test('a repaired SDK gets a new immutable plan and runs metadata qualification in the measurement environment',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'history-startup-'));
 try {
  const paths=[],env={...process.env,WASMBENCH_SINGLE_CORE:'0',LD_LIBRARY_PATH:'build-only-libraries'};
  const fixture=`console.log(JSON.stringify({version:1,id:1,description:{runtime:'fixture',runtime_version:'hash',backend:'interpreter',build:'hash'}}));`;
  const run=async(program,args,options)=>{
   assert.equal(options.env.WASMBENCH_SINGLE_CORE,'1');assert.equal(options.env.LD_LIBRARY_PATH,undefined);
   let selected=program,planArgs=args;
   if(program==='taskset'){assert.equal(args[0],'-c');assert.equal(args[1],String(env.WASMFYI_STARTUP_CPU));selected=args[2];planArgs=args.slice(3);}
   if(selected==='fixture-controller'){
    assert.equal(planArgs[0],'plan');assert.equal(planArgs[planArgs.indexOf('--runtimes')+1],'fixture');
    const path=planArgs[planArgs.indexOf('--out')+1];paths.push(path);
    // This mirrors the real controller's immutable-plan creation contract.
    await writeFile(path,JSON.stringify({runtime_configurations:[{id:'fixture',command:[process.execPath,'-e',fixture]}]}),{flag:'wx'});
   }else await execute(program,args,options);
  };
  const options={directory,configuration:'fixture',suite:[],harness:directory,controller:'fixture-controller',env,run};
  await qualifyHistoryStartup(options);await qualifyHistoryStartup(options);
  assert.equal(new Set(paths).size,2);
  const result=JSON.parse(await readFile(join(directory,'sdk-startup-fixture-qualified.json')));
  assert.equal(result.configuration,'fixture');assert.equal(result.description.runtime_version,'hash');
  assert.equal(env.LD_LIBRARY_PATH,'build-only-libraries');
 }finally{await rm(directory,{recursive:true,force:true});}
});
