import {readFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {historyEngineOrder} from './lib/history-scope.mjs';import {atomicJSON} from './lib/benchmark-plan.mjs';
const root=resolve(process.argv[2]),plan=JSON.parse(await readFile(join(root,'source-plan.json'))),template=JSON.parse(await readFile(join(root,'collection-template.json')));
if(template.collection.samples!==plan.samples||plan.samples!==5)throw Error('This campaign requires exactly five samples');
const state={started:new Date().toISOString(),status:'running',current:null,completed:[],errors:[],pass:0};
const pending=new Map(historyEngineOrder.map(engine=>[engine,plan.pins.filter(p=>p.engine===engine&&p.status==='planned').sort((a,b)=>Date.parse(b.targetWeek)-Date.parse(a.targetWeek))]));
async function run(program,args){return new Promise((yes,no)=>{const fd=openSync(join(root,'coordinator.log'),'a');const child=spawn(program,args,{cwd:process.cwd(),env:{...process.env,...template.env,GOMAXPROCS:'1',CARGO_BUILD_JOBS:'1'},stdio:['ignore',fd,fd]});closeSync(fd);state.childPid=child.pid;child.on('error',no);child.on('exit',code=>code===0?yes():no(Error('Collector exited '+code)));});}
while([...pending.values()].some(p=>p.length)){
 state.pass++;
 for(const engine of historyEngineOrder){
  const pin=pending.get(engine).shift();if(!pin)continue;
  state.current={engine,ref:pin.tag||pin.revision,asOf:pin.targetWeek};await atomicJSON(join(root,'coordinator-status.json'),state);
  const script=['wago','wazero','wasm2go'].includes(engine)?'benchmark-go-history.mjs':engine==='libwasm'?'benchmark-libwasm-history.mjs':'benchmark-engine-history.mjs';
  const base=engine==='libwasm'?template.toolRoot:join(root,'frozen-harness');
  try{await run(process.execPath,[join(process.cwd(),'scripts',script),root,base,...(engine==='libwasm'?[]:[engine]),pin.tag||pin.revision]);state.completed.push(state.current);}
  catch(error){state.errors.push({...state.current,error:String(error)});}
  await atomicJSON(join(root,'coordinator-status.json'),state);
 }
}
state.current=null;state.status='awaiting-completion-audit';await atomicJSON(join(root,'coordinator-status.json'),state);
