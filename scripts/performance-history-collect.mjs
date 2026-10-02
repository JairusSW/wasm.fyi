import {readFile,writeFile,mkdir,rename,rm,statfs} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {site,harness,command,digest,exists,locked} from './lib/wasmbench.mjs';
import {parseCorpusJSON} from './lib/corpus.mjs';
import {performanceCorpusIdentity} from './lib/performance-history.mjs';
import {copyHistoricalHarness,buildHistoricalBinding,assertHistoricalRuntime} from './lib/historical-binding.mjs';

// Acquire the same Linux measurement lock as the current Hub supervisor.
// flock retains it while the nested collector is alive, including all builds.
if(process.platform==='linux'&&!process.argv.includes('--under-host-lock')) {
  const lock=join(homedir(),'.cache/wasm-fyi/measurement.lock');await mkdir(join(homedir(),'.cache/wasm-fyi'),{recursive:true});
  const child=spawnSync('flock',['-w','86400',lock,process.execPath,...process.argv.slice(1),'--under-host-lock'],{stdio:'inherit'});
  if(child.error)throw child.error;process.exit(child.status??1);
}

// Run under the host measurement lock. Never share a live adapter build tree.
const directory=join(site,'.wasmbench/performance-history');
const {root:base}=await harness();
await mkdir(directory,{recursive:true});
const env={...process.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'};
const active=await readFile(join(site,'.wasmbench/full-2026-10-02/active-runs.json'),'utf8').then(JSON.parse,()=>null);
const localOwners=process.platform==='darwin'?[active?.mac?.pid,active?.macRecovery?.pid]:[];
for(const localPid of localOwners.filter(Boolean)) {
  try{
    process.kill(localPid,0);
    if(/scripts\/(full-run|resume-collection)\.mjs/.test(command('ps',['-p',String(localPid),'-o','args=']).toString()))throw Error('Current Mac collection still owns the host; run history after its collector exits.');
  }
  catch(error){if(error.code!=='ESRCH')throw error;}
}
await locked(async()=>{
  // Reuse the complete corpus that planning already imported. Re-importing to
  // the same manifest path fails with O_EXCL in the Wasm bench controller.
  const suite=join(directory,'corpus','wago-suite.json');
  command(process.execPath,['scripts/performance-history.mjs','plan'],{env:{...env,WASMBENCH_HISTORY_SUITE:suite},stdio:'inherit'});
  const queue=JSON.parse(await readFile(join(directory,'queue.json')));
  if(queue.host!==process.platform+'/'+process.arch)throw Error('Historical queue belongs to another architecture');
  const workloads=parseCorpusJSON(await readFile(queue.suite,'utf8'));
  if(performanceCorpusIdentity(workloads)!==queue.corpusSha256)throw Error('Historical corpus contracts changed');
  for(const w of workloads)if(digest(await readFile(resolve(w.artifact)))!==w.sha256)throw Error('Historical corpus artifact changed: '+w.id);
  const controller=join(directory,'controller-'+queue.recipeSha256);
  if(!await exists(controller))command('go',['build','-trimpath','-o',controller,'./cmd/wasmbench'],{cwd:base,env,stdio:'inherit'});
  const previous=await readFile(join(directory,'results.json'),'utf8').then(JSON.parse,()=>({jobs:[]}));
  const state={schema:1,pid:process.pid,startedAt:new Date().toISOString(),queue,phase:'collect',jobs:[]};
  async function save(){const path=join(directory,'results.json');await writeFile(path+'.tmp',JSON.stringify(state,null,2)+'\n');await rename(path+'.tmp',path);}
  await save();
  for(const job of queue.jobs) {
    const result={id:job.id,release:job.release,targetWeeks:job.targetWeeks,status:'running',configurations:[]};
    state.jobs.push(result);await save();
    for(const configuration of job.identity.configurations) {
      if(!/^[a-z0-9-]+$/.test(configuration))throw Error('Unsafe historical configuration ID');
      const cached=previous.jobs.find(j=>j.id===job.id)?.configurations.find(c=>c.id===configuration&&c.status==='collected');
      if(cached) {
        try {
          if(cached.binding?.release.tag!==job.release.tag || cached.binding?.configuration!==configuration)throw Error('Cached release binding differs');
          command(controller,['verify-report','--dir',cached.report],{cwd:base,env});
          if(digest(await readFile(join(cached.report,'data.json')))!==cached.sha256)throw Error('Cached historical report changed');
          if(['wago','wazero'].includes(job.release.engine)) {
            const bytes=await readFile(join(cached.audit.path,'audit-report.json'));
            if(digest(bytes)!==cached.audit.sha256)throw Error('Cached compile audit changed');
            const audit=JSON.parse(bytes);
            if(audit.comparisons.length!==3 || audit.comparisons.some(c=>c.engine!==configuration||!c.passed))throw Error('Cached compile audit is incomplete');
            if(job.release.engine==='wazero'&&audit.wazeroVersion!==job.release.tag)throw Error('Cached scratch SDK differs');
            if(job.release.engine==='wago'&&audit.release.revision!==cached.binding.source.revision)throw Error('Cached scratch source differs');
          }
          result.configurations.push(cached);await save();continue;
        } catch(error){console.log('Historical cache rejected:',job.release.engine,job.release.tag,configuration,error.message);}
      }
      const space=await statfs(directory);
      if(Number(space.bavail)*Number(space.bsize)<20*1024**3) {
        state.phase='paused-low-disk';state.reason='Less than 20 GiB available; collection stopped before another build.';await save();
        throw Error(state.reason);
      }
      const entry={id:configuration,status:'building',startedAt:new Date().toISOString()};result.configurations.push(entry);await save();
      const attempt=join(directory,'jobs',job.id,configuration,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
      await mkdir(attempt,{recursive:true});entry.attempt=attempt;
      const root=join(attempt,'harness');
      const invoke=(...args)=>command(controller,args,{cwd:root,env,stdio:'inherit'});
      try {
        // Unsupported binding code is a pending task, not an engine failure.
        if(!['wago','wazero','wasmtime','wasmi'].includes(job.release.engine)) {
          entry.status='pending-binding';entry.reason='A release-specific performance build binding is required.';await save();continue;
        }
        await copyHistoricalHarness(base,root);
        const binding=await buildHistoricalBinding({root,pin:job.release,configuration,invoke,env});
        await writeFile(join(attempt,'binding.json'),JSON.stringify(binding,null,2)+'\n');
        entry.binding=binding;entry.status='collecting';await save();
        const opts=queue.options;
        const shared=['--archive-tools=true','--suite',queue.suite,'--runtimes',configuration,'--timeout',opts.timeout,'--validation-profile',opts.validationProfile];
        const preflight=join(attempt,'preflight.lock.json');
        invoke('plan',...shared,'--profile','timing','--out',preflight);
        const planned=JSON.parse(await readFile(preflight)).runtime_configurations;
        if(planned.length!==1)throw Error('Historical preflight has an unexpected configuration cohort');
        const runtime=planned[0];
        const described=command(runtime.command[0],runtime.command.slice(1),{cwd:root,env,timeout:30_000,input:'{"version":1,"id":1,"method":"describe"}\n'}).toString().trim();
        runtime.description=JSON.parse(described).description;
        assertHistoricalRuntime(runtime,binding);
        await writeFile(join(attempt,'preflight-description.json'),JSON.stringify(runtime,null,2)+'\n');
        if(['wago','wazero'].includes(binding.engine)) {
          const audit=join(attempt,'compile-audit');
          command(process.execPath,['scripts/compile-latency-audit.mjs',audit],{env:{...env,WASMBENCH_ROOT:root,WASMBENCH_BIN:controller,
            WASMBENCH_AUDIT_RUNTIMES:configuration,WASMBENCH_AUDIT_WAGO_TAG:binding.engine==='wago'?job.release.tag:undefined,
            WASMBENCH_AUDIT_WAZERO_VERSION:binding.engine==='wazero'?job.release.tag:'v1.12.0'},stdio:'inherit'});
          entry.audit={path:audit,sha256:digest(await readFile(join(audit,'audit-report.json')))};await save();
        }
        const reportArgs=['report'];
        const profiles=['timing',...(opts.memory?['memory']:[]),...(opts.code?['code']:[])];
        for(const profile of profiles) {
          const output=join(attempt,profile+'-'+randomUUID().slice(0,8));
          const args=['run',...shared,'--profile',profile,'--launches',String(profile==='timing'?opts.launches:1),
            '--samples',String(profile==='timing'?opts.samples:1),'--operations',String(profile==='timing'?opts.operations:1),
            '--warmup',String(profile==='timing'?opts.warmup:0),'--out',output];
          if(profile==='code')args.push('--scenarios','compile');
          if(profile==='memory'&&opts.phaseBarriers)args.push('--phase-barriers');
          let failure;
          try{invoke(...args);}catch(error){failure=error;}
          // Trial failures are retained only when the complete bundle verifies.
          invoke('verify','--run',output);
          const manifest=JSON.parse(await readFile(join(output,'manifest.json')));
          const runtimes=manifest.lock.runtime_configurations;
          if(runtimes.length!==1)throw Error('Historical pass has an unexpected runtime cohort');
          assertHistoricalRuntime(runtimes[0],binding);
          const locked=manifest.lock.workloads;
          if(locked.length!==workloads.length || locked.some(w=>!workloads.some(input=>input.id===w.id&&input.sha256===w.sha256)))throw Error('Historical pass does not cover the complete corpus');
          if(failure)console.log('Retained verified historical failed trial outcomes:',failure.message);
          reportArgs.push(profile==='timing'?'--run':profile==='memory'?'--memory-run':'--code-run',output);
        }
        const report=join(attempt,'report');invoke(...reportArgs,'--out',report);invoke('verify-report','--dir',report);
        entry.status='collected';entry.report=report;entry.sha256=digest(await readFile(join(report,'data.json')));entry.collectedAt=new Date().toISOString();
      } catch(error) {
        entry.status=error.code==='BINDING_PENDING'?'pending-binding':'runner-error';entry.reason=error.message;
        console.error('Historical performance job:',job.release.engine,job.release.tag,configuration,entry.status,error.message);
      }
      finally {
        // Failed SDK builds also leave large intermediates. Preserve their
        // sources and diagnostics while removing only this owned attempt's targets.
        for(const adapter of ['wasmtime','native'])await rm(join(root,'adapters',adapter,'target'),{recursive:true,force:true,maxRetries:5,retryDelay:200});
        entry.buildIntermediatesRemoved=true;
      }
      entry.completedAt=new Date().toISOString();await save();
    }
    result.status=result.configurations.every(c=>c.status==='collected')?'collected':'incomplete';await save();
  }
  state.phase=state.jobs.every(j=>j.status==='collected')?'collected':'incomplete';state.completedAt=new Date().toISOString();await save();
  if(state.phase!=='collected')process.exitCode=1;
},'performance-history');
