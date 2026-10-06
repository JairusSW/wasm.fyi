import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,cp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {historicalAPIBinding,publishPerformanceHistoryConfiguration} from './lib/performance-history-api.mjs';
import {performanceCorpusIdentity} from './lib/performance-history.mjs';
import {collectionVerdict} from './lib/collection-verdict.mjs';
import {digest,site} from './lib/wasmbench.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
const pin={engine:'wasmer',tag:'v7.5.0',targetType:'weekly',publishedAt:'2026-10-01T11:32:50Z',datePrecision:'second',url:'https://github.com/wasmerio/wasmer/releases/tag/v7.5.0'};
const binding={engine:'wasmer',version:'7.5.0',configuration:'wasmer-singlepass',release:pin};

test('historical queue bindings retain exact release/source roles, aliases and precision',()=>{
  const job={release:pin,targetWeeks:['2026-10-03','2026-10-03'],targetReleases:[{publishedAt:pin.publishedAt}]},entry={id:'wasmer-singlepass',status:'collected',binding};
  const input={job,entry,reportId:'a'.repeat(64),configurationId:'b'.repeat(64)};
  const actual=historicalAPIBinding(input);
  assert.deepEqual(actual.targetDates,['2026-10-01','2026-10-03']);assert.equal(actual.buildRole,'release');assert.equal(actual.release.datePrecision,'second');assert.equal(actual.sourceRevision,undefined);
  const day={...pin,publishedAt:'2026-10-01T00:00:00Z',datePrecision:'day'};
  assert.equal(historicalAPIBinding({...input,job:{...job,release:day},entry:{...entry,binding:{...binding,release:day}}}).release.datePrecision,'day');
  const revision='c'.repeat(40),source={engine:'wago',targetType:'main',revision,committedAt:'2026-09-30T12:00:00Z'};
  const sourceBinding=historicalAPIBinding({...input,job:{release:source,targetWeeks:['2026-10-03']},entry:{id:'wago',status:'collected',binding:{engine:'wago',configuration:'wago',release:source,source:{revision}}}});
  assert.equal(sourceBinding.buildRole,'source');assert.equal(sourceBinding.sourceRevision,revision);assert.equal(sourceBinding.sourceDate,'2026-09-30T12:00:00.000Z');assert.equal(sourceBinding.release,undefined);
  for(const date of ['2026-02-30','0000-01-01','not-a-date'])assert.throws(()=>historicalAPIBinding({...input,job:{...job,targetWeeks:[date]}}));
  assert.throws(()=>historicalAPIBinding({...input,entry:{...entry,status:'running'}}));
  assert.throws(()=>historicalAPIBinding({...input,job:{...job,release:{...pin,tag:'other'}}}));
  assert.throws(()=>historicalAPIBinding({...input,job:{...job,release:{...pin,datePrecision:'day'}}}),/UTC day boundary/);
  assert.throws(()=>historicalAPIBinding({...input,job:{...job,release:{...pin,url:'https://user:password@example.test/'}}}));
});

test('shared verdict retains failed, unsupported and zero-valued complete measurements',()=>{
  assert.equal(collectionVerdict([]),'NOT MEASURED');
  assert.equal(collectionVerdict([{scenario:'steady',median_ns_per_operation:0}]),'PASS');
  assert.equal(collectionVerdict([{scenario:'steady',median_ns_per_operation:null,outcomes:{unsupported:1}}]),'UNSUPPORTED');
  assert.equal(collectionVerdict([{scenario:'compile',outcomes:{timeout:1}}]),'FAIL');
});

test('real completed history publication reuses its source, tools and API records',{skip:!process.env.WASMFYI_REAL_HISTORY_SOURCE||!process.env.WASMFYI_PRODUCER_BIN||!process.env.WASMFYI_PRODUCER_ROOT,timeout:600000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'wasmfyi-history-api-'));let child,exit;
  try {
    const report=process.env.WASMFYI_REAL_HISTORY_SOURCE,source=await readFile(join(report,'data.json')),data=JSON.parse(source);
    const configuration=data.bundle.manifest.lock.runtime_configurations[0].id,workloads=data.bundle.manifest.lock.workloads;
    assert.equal(configuration,'wasmer-singlepass','opt-in fixture requires the verified Wasmer call report');
    const entry={id:configuration,status:'collected',report,sha256:digest(source),collectedAt:data.bundle.manifest.created,binding};
    // This association is synthetic; original measurements and tools are real.
    const job={id:digest(Buffer.from('retrospective Wasmer HTTP fixture')),release:pin,identity:{configurations:[configuration]},targetWeeks:['2026-10-03'],targetReleases:[{publishedAt:pin.publishedAt}]};
    const queue={host:data.bundle.manifest.host.os+'/'+data.bundle.manifest.host.arch,corpusSha256:performanceCorpusIdentity(workloads),options:data.bundle.manifest.lock.options,jobs:[job]};
    const binary=join(root,'wasmfyi');await runCommand('go',['build','-o',binary,'./cmd/wasmfyi'],{cwd:join(site,'service'),env:{...process.env,GOWORK:'off',GOFLAGS:'-mod=readonly'}});
    const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
    const url='http://127.0.0.1:'+port,token='history-fixture-'+'x'.repeat(32);
    child=spawn(binary,['--listen','127.0.0.1:'+port,'--data',join(root,'store')],{env:{...process.env,WASMFYI_ADMIN_TOKEN:token},stdio:'ignore'});exit=new Promise(resolve=>child.once('exit',resolve));
    let ready=false;for(let i=0;i<200;i++){assert.equal(child.exitCode,null,'service exited');try{if((await fetch(url+'/api/v1/manifest')).ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,25))}assert(ready,'service readiness timeout');
    const invocations=[];let uploads=0;
    const input={directory:join(root,'publication'),queue,job,entry,workloads,url,token,configuredHarnessPin:'0509a0a323f41c58a2f2db15a372fb2e63c692bf',
      request:async(...args)=>{if(args[1]?.method==='PUT')uploads++;return fetch(...args)},
      invoke:async(...args)=>{assert(['verify-report','export-site'].includes(args[0]),'publication must not execute measurements');invocations.push(args[0]);return runCommand(process.env.WASMFYI_PRODUCER_BIN,args,{env:{...process.env,GOMAXPROCS:'1'}})}};
    const first=await publishPerformanceHistoryConfiguration(input);assert(uploads>0);assert.equal(first.status,'published');
    const history=await(await fetch(url+'/api/v1/history?revision='+first.revision)).json();assert.equal(history.total,4);
    const jobs=await(await fetch(url+'/api/v1/sessions/'+first.session+'/jobs?revision='+first.revision)).json();
    const context=await(await fetch(url+'/api/v1/history/jobs/'+jobs.items[0].id+'?revision='+first.revision)).json();
    assert.deepEqual(context.items[0].binding.targetDates,['2026-10-01','2026-10-03']);assert.equal(context.items[0].binding.release.datePrecision,'second');assert.equal(context.items[0].interpretationSource,'trusted-publisher-assertion');
    const parent=await readFile(join(root,'publication/api',first.session,'bundle/index.json'));
    uploads=0;const second=await publishPerformanceHistoryConfiguration(input);assert.deepEqual(second,first);assert.equal(uploads,0);assert.equal(invocations.filter(command=>command==='export-site').length,1);
    assert((await readFile(join(root,'publication/api',first.session,'bundle/index.json'))).equals(parent));
    assert((await readFile(join(report,'data.json'))).equals(source),'publication changed original science');
    const invalid={...input,entry:{...entry,status:'running'}};await assert.rejects(publishPerformanceHistoryConfiguration(invalid),/incomplete/);
    // Run the real existing collector against an isolated site/ledger. Its
    // synthetic controller delegates only verification and export to the real
    // producer, rejecting every measurement or tool-build command.
    const isolated=join(root,'site'),historyRoot=join(isolated,'.wasmbench/performance-history');
    await mkdir(historyRoot,{recursive:true});await cp(join(site,'scripts'),join(isolated,'scripts'),{recursive:true});
    const controller=join(historyRoot,'controller-fixture'),commandLog=join(root,'history-commands.jsonl');
    const script='#!'+process.execPath+'\n'+`import {appendFileSync} from 'node:fs'; import {execFileSync} from 'node:child_process'; const args=process.argv.slice(2); appendFileSync(${JSON.stringify(commandLog)},JSON.stringify(args)+'\\n'); if(!['verify-report','export-site'].includes(args[0]))process.exit(55); execFileSync(${JSON.stringify(process.env.WASMFYI_PRODUCER_BIN)},args,{stdio:'inherit',env:{...process.env,GOMAXPROCS:'1'}});\n`;
    await writeFile(controller,script,{mode:0o700});
    const suite=join(historyRoot,'suite.json'),retainedWorkloads=workloads.map(workload=>({...workload,artifact:join(report,'raw',workload.artifact)}));await writeFile(suite,JSON.stringify(retainedWorkloads));
    await writeFile(join(historyRoot,'queue.json'),JSON.stringify({...queue,suite,recipeSha256:'fixture',jobs:[job]}));
    await writeFile(join(historyRoot,'results.json'),JSON.stringify({jobs:[{id:job.id,configurations:[entry]}]}));
    await writeFile(join(isolated,'wasmbench.config.json'),JSON.stringify({root:process.env.WASMFYI_PRODUCER_ROOT,collection:{runtimes:[configuration]},harnessSource:{revision:input.configuredHarnessPin}}));
    const env={...process.env,WASMFYI_HISTORY_API_URL:url,WASMFYI_HISTORY_PUBLISH_ONLY:'1',WASMFYI_ADMIN_TOKEN:token,WASMBENCH_ROOT:process.env.WASMFYI_PRODUCER_ROOT};
    assert(process.env.WASMFYI_PRODUCER_ROOT,'real collector gate requires WASMFYI_PRODUCER_ROOT');
    const run=()=>runCommand(process.execPath,[join(isolated,'scripts/performance-history-collect.mjs')],{cwd:isolated,env});
    await run();let ledger=JSON.parse(await readFile(join(historyRoot,'results.json')));assert.equal(ledger.phase,'collected');assert.equal(ledger.jobs[0].configurations[0].apiPublication.status,'published');
    env.WASMFYI_ADMIN_TOKEN='incorrect-token-'+'x'.repeat(32);await assert.rejects(run(),/API publication failed|Historical API publication/);
    ledger=JSON.parse(await readFile(join(historyRoot,'results.json')));assert.equal(ledger.phase,'publication-failed');assert.equal(ledger.jobs[0].configurations[0].status,'collected');assert.equal(ledger.jobs[0].configurations[0].sha256,entry.sha256);
    env.WASMFYI_ADMIN_TOKEN=token;await run();ledger=JSON.parse(await readFile(join(historyRoot,'results.json')));assert.equal(ledger.phase,'collected');
    const commands=(await readFile(commandLog,'utf8')).trim().split('\n').map(JSON.parse);assert(commands.every(args=>['verify-report','export-site'].includes(args[0])));assert.equal(commands.filter(args=>args[0]==='export-site'&&args[1]!=='--describe').length,1);
    const current=await(await fetch(url+'/api/v1/manifest')).json(),replayed=await(await fetch(url+'/api/v1/history?revision='+current.revision)).json();assert.equal(replayed.total,4,'collector replay created independent measurements');
    // Kill the real collector after its initial ledger save, before it has
    // verified/revisited cached jobs. Both completed references must survive.
    const secondJob={...job,id:digest(Buffer.from('second retrospective crash fixture'))};
    await writeFile(join(historyRoot,'queue.json'),JSON.stringify({...queue,suite,recipeSha256:'fixture',jobs:[job,secondJob]}));
    await writeFile(join(historyRoot,'results.json'),JSON.stringify({jobs:[{id:job.id,status:'collected',configurations:[entry]},{id:secondJob.id,status:'collected',configurations:[entry]}]}));
    const marker=join(root,'interrupted-controller.json');
    await writeFile(controller,'#!'+process.execPath+'\n'+`import {writeFileSync} from 'node:fs'; import {execFileSync} from 'node:child_process'; const args=process.argv.slice(2); if(args[0]==='verify-report'){writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid})); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);} if(!['verify-report','export-site'].includes(args[0]))process.exit(55); execFileSync(${JSON.stringify(process.env.WASMFYI_PRODUCER_BIN)},args,{stdio:'inherit'});\n`,{mode:0o700});
    const interrupted=spawn(process.execPath,[join(isolated,'scripts/performance-history-collect.mjs')],{cwd:isolated,env,detached:true,stdio:'ignore'});
    const interruptedExit=new Promise(resolve=>interrupted.once('exit',(code,signal)=>resolve({code,signal})));
    try{
      let blocked=false;for(let i=0;i<400;i++){assert.equal(interrupted.exitCode,null);try{await readFile(marker);blocked=true;break}catch(error){if(error.code!=='ENOENT')throw error}await new Promise(resolve=>setTimeout(resolve,25))}assert(blocked,'collector did not reach crash checkpoint');
      process.kill(-interrupted.pid,'SIGKILL');assert.equal((await interruptedExit).signal,'SIGKILL');
    }finally{try{process.kill(-interrupted.pid,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error}}
    ledger=JSON.parse(await readFile(join(historyRoot,'results.json')));assert.equal(ledger.jobs.length,2);assert(ledger.jobs.every(job=>job.configurations[0].status==='collected'&&job.configurations[0].sha256===entry.sha256),'crash lost an unvisited completed report');
    await writeFile(controller,script,{mode:0o700});await run();
    ledger=JSON.parse(await readFile(join(historyRoot,'results.json')));assert.equal(ledger.phase,'collected');assert.equal(ledger.jobs.length,2);assert(ledger.jobs.every(job=>job.configurations[0].apiPublication.status==='published'));
    const recoveredManifest=await(await fetch(url+'/api/v1/manifest')).json();assert.equal((await(await fetch(url+'/api/v1/history?revision='+recoveredManifest.revision)).json()).total,4,'crash recovery invented measurements');
    // Invalid retained evidence is an operator repair condition, never an
    // empty ledger that can overwrite completed report references on startup.
    const ledgerPath=join(historyRoot,'results.json'),retainedLedger=await readFile(ledgerPath);
    for(const invalidLedger of ['{invalid JSON',JSON.stringify({jobs:[{id:job.id,configurations:null}]})]){
      await writeFile(ledgerPath,invalidLedger);await assert.rejects(run());
      assert.equal(await readFile(ledgerPath,'utf8'),invalidLedger,'invalid ledger was overwritten');
    }
    await writeFile(ledgerPath,retainedLedger);await run();
  } finally {if(child){child.kill('SIGTERM');await exit}await rm(root,{recursive:true,force:true})}
});
