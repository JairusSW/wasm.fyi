// Prebuild one exact source snapshot; collection remains owned by the coordinator.
import {readFile,mkdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {runCommand} from './lib/benchmark-process.mjs';
import {readCache,atomicJSON} from './lib/benchmark-plan.mjs';
import {historyBuildDirectory} from './lib/history-build-cache.mjs';
const [rootArg,engine,configuration]=process.argv.slice(2),root=resolve(rootArg);
const plan=JSON.parse(await readFile(join(root,'source-plan.json')));
const template=JSON.parse(await readFile(join(root,'collection-template.json')));
const pin=plan.pins.filter(p=>p.engine===engine&&p.targetType==='main'&&p.status==='planned'&&p.configurations.includes(configuration)).sort((a,b)=>Date.parse(b.targetWeek)-Date.parse(a.targetWeek))[0];
if(!pin)throw Error('No planned snapshot for '+configuration);
const directory=await historyBuildDirectory(root,pin,configuration);
await mkdir(directory,{recursive:true});
const env={...process.env,...template.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',CARGO_BUILD_JOBS:'2'};
const run=(program,args)=>runCommand(program,args,{cwd:process.cwd(),env,log:join(directory,'prepare.log')});
const source=join(directory,'sources',engine);await mkdir(source,{recursive:true});
if(!await stat(join(source,'.git')).catch(()=>null)){await run('git',['init',source]);await run('git',['-C',source,'remote','add','origin','https://github.com/'+pin.repository+'.git']);}
if(engine==='jsc'){
 await run('git',['-C',source,'sparse-checkout','init','--cone']);
 await run('git',['-C',source,'sparse-checkout','set','Configurations','Source','Tools/Scripts','Tools/TestWebKitAPI','Tools/clangd','WebKitLibraries']);
}
await run('git',['-C',source,'fetch','--depth','1','origin',pin.revision]);await run('git',['-C',source,'checkout','--detach',pin.revision]);
const inventory=new Map(template.workloads.map(w=>[w.id,w.sha256]));
const suite=(await readCache(template.corpusRoot)).filter(w=>inventory.get(w.id)===w.sha256);
if(suite.length!==inventory.size)throw Error('Frozen suite is incomplete');
await atomicJSON(join(directory,'suite.json'),suite);await atomicJSON(join(directory,'pins.json'),{pins:[{...pin,configurations:[configuration]}]});
await run(process.execPath,['scripts/weekly-build.mjs',directory,engine,join(root,'frozen-harness')]);
console.log(JSON.stringify({engine,configuration,revision:pin.revision,directory,status:'prepared'}));
