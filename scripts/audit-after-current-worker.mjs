// A detached, read-only completion audit. Never takes a lease while waiting.
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [directory,pidText]=process.argv.slice(2),pid=Number(pidText);
if(!directory||!Number.isSafeInteger(pid)||pid<1)throw Error('Usage: audit-after-current-worker.mjs ROOT WORKER_PID');
const root=resolve(directory),config=JSON.parse(await readFile(join(root,'runner-config.json'),'utf8'));
for(;;){
 const check=spawnSync('ps',['-p',String(pid),'-o','stat=,command='],{encoding:'utf8'});
 if(check.error)throw check.error;
 const line=check.stdout.trim();
 if(check.status===1&&!line&&!check.stderr.trim())break; // ps confirms missing PID
 if(check.status!==0)throw Error('Worker observation failed: '+check.stderr);
 if(line.startsWith('Z')||!line.includes('run-current-campaign.py')||!line.includes(root))break;
 await delay(5000);
}
const {withBuildLock}=await import(pathToFileURL(join(config.site,'scripts/lib/measurement-lock.mjs')).href);
const {runCommand}=await import(pathToFileURL(join(config.site,'scripts/lib/benchmark-process.mjs')).href);
await withBuildLock(root,async()=>{
 await runCommand(config.node,[join(config.site,'scripts/audit-current-campaign.mjs'),root],{cwd:config.site,log:join(root,'full-coverage-verification.log')});
 const report=JSON.parse(await readFile(join(root,'coverage-audit.json'),'utf8'));
 console.log(JSON.stringify({checkedAt:report.checkedAt,complete:report.complete,configurations:report.engines.length,incomplete:report.engines.filter(engine=>!engine.complete).map(engine=>engine.engine)}));
});
