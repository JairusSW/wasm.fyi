import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {atomicJSON} from './benchmark-plan.mjs';
import {startupLaunchCommand} from './sdk-startup.mjs';
import {readFile} from 'node:fs/promises';
import {qualifyHistoryGuest} from './qualify-history-guest.mjs';

export async function qualifyHistoryStartup({directory,configuration,suite,harness,controller,source,env,run}) {
 const suitePath=join(directory,'sdk-startup-suite.json');
 // Controller plans are immutable: a failed SDK repair must get a new plan.
 const planPath=join(directory,'sdk-startup-plan-'+randomUUID()+'.json');
 await atomicJSON(suitePath,suite);
 const runtimeEnv={...env,WASMBENCH_SINGLE_CORE:'1'};delete runtimeEnv.LD_LIBRARY_PATH;
 const planCommand=startupLaunchCommand([controller,'plan','--suite',suitePath,'--runtimes',configuration,'--profile','timing','--out',planPath],runtimeEnv.WASMFYI_STARTUP_CPU);
 await run(planCommand[0],planCommand.slice(1),{cwd:harness,env:runtimeEnv});
 await run(process.execPath,[fileURLToPath(new URL('../qualify-sdk-startup.mjs',import.meta.url)),planPath,join(directory,'sdk-startup-'+configuration+'-qualified.json')],{cwd:harness,env:runtimeEnv});
 if(JSON.parse(runtimeEnv.WASMFYI_GUEST_QUALIFY_CONFIGS||'[]').includes(configuration)&&(!runtimeEnv.WASMFYI_GUEST_QUALIFY_WEEK||source?.asOf===runtimeEnv.WASMFYI_GUEST_QUALIFY_WEEK)){
  const plan=JSON.parse(await readFile(planPath));
  const qualified=JSON.parse(await readFile(join(directory,'sdk-startup-'+configuration+'-qualified.json')));
  const runtime=plan.runtime_configurations.find(r=>r.id===configuration);
  if(qualified.configuration!==configuration||JSON.stringify(qualified.command)!==JSON.stringify(runtime?.command))throw Error('SDK metadata qualification command differs from immutable plan');
  await qualifyHistoryGuest({directory,configuration,suite,harness,controller,source,runtime:{...runtime,description:qualified.description},env:runtimeEnv,run});
 }
}
