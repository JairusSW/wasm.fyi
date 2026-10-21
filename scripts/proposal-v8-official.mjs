import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {arch,hostname,platform} from 'node:os';
import {spawnSync} from 'node:child_process';
import {proposalSuites,prepareProposalSuite,upstreamRoot} from './lib/proposal-upstream.mjs';
import {proposalToolchainRoot,proposalToolchains} from './lib/proposal-toolchain.mjs';
import {site,digest} from './lib/wasmbench.mjs';

const suite=proposalSuites.find(s=>s.id==='v8-15.2.20');
const inventory=await prepareProposalSuite(suite);
const target=`${platform()}-${arch()}`,pin=proposalToolchains[target];
if(!pin)throw Error('No qualified official V8 build configuration for '+target);
const receipt=JSON.parse(await readFile(join(proposalToolchainRoot,'receipt.json')));
if(receipt.archiveSha256!==pin.sha256||digest(await readFile(join(proposalToolchainRoot,pin.file)))!==pin.sha256)throw Error('V8 build archive pin changed');
for(const [path,sha256]of Object.entries(receipt.fileSha256))
 if(digest(await readFile(join(proposalToolchainRoot,path)))!==sha256)throw Error('V8 build file changed: '+path);
const root=join(upstreamRoot,suite.id);
const out=resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||join(site,'.wasmbench/proposal-coverage/v8-official'));
await mkdir(out,{recursive:true});
const results=join(out,'results.json'),schedule=join(out,'schedule.log');
await rm(results,{force:true});await rm(schedule,{force:true});
const args=[join(root,'tools/run-tests.py'),'--outdir='+proposalToolchainRoot,'--arch='+arch(),'-j1','--progress=dots',
 '--json-test-results='+results,'--log-test-schedule='+schedule,'mjsunit/wasm/*'];
const run=spawnSync('python3',args,{cwd:root,encoding:'utf8',timeout:25*60*1000,maxBuffer:16<<20});
const upstream=JSON.parse(await readFile(results).catch(()=>Buffer.from('{}')));
const scheduled=(await readFile(schedule,'utf8').catch(()=>'')).split('\n').filter(Boolean);
const statuses=scheduled.map(line=>/: ([A-Z_]+) \(/.exec(line)?.[1]||'UNPARSED');
const complete=Number.isSafeInteger(upstream.test_total)&&upstream.test_total>0&&scheduled.length===upstream.test_total;
const report={schema:1,created:new Date().toISOString(),timing:false,host:{hostname:hostname(),os:platform(),arch:arch()},
 suite:{...suite,files:inventory.files.length,inventorySha256:digest(JSON.stringify(inventory.files))},engine:receipt,
 command:['python3',...args],exitCode:run.status,signal:run.signal,error:run.error?.message,
 policy:'Unmodified upstream V8 runner, real published build configuration, upstream default variants/status filters. No corpus quota. Zero tests or an incomplete schedule is a runner error. Status-selected skips are never counted as passes. This is the full enabled mjsunit/wasm suite for this build, not all V8 test suites.',
 status:!complete?'runner-error':run.status===0&&upstream.results?.length===0?'passed':'failed',
 totals:Object.fromEntries([...new Set(statuses)].map(status=>[status,statuses.filter(s=>s===status).length])),
 stdout:run.stdout,stderr:run.stderr,upstream,schedule:scheduled,
 resultsSha256:digest(await readFile(results).catch(()=>Buffer.alloc(0))),scheduleSha256:digest(scheduled.join('\n')+'\n')};
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(report.status,upstream.test_total,report.totals,join(out,'report.json'));
if(report.status!=='passed')process.exitCode=1;
