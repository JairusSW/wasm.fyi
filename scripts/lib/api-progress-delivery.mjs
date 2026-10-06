import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,lstatSync,fstatSync,readSync,constants,opendirSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const NAME=/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.([0-9]{5})\.json$/;
const STATES={running:'running',completed:'completed',paused:'interrupted',error:'failed'};
function install(directory,name,bytes){
 const path=join(directory,name),temporary=join(directory,'temp-'+randomUUID());let fd;
 try{fd=openSync(temporary,'wx',0o600);writeFileSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temporary,path);const dir=openSync(directory,'r');try{fsyncSync(dir)}finally{closeSync(dir)}}
 finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary)}catch(e){if(e.code!=='ENOENT')throw e}}
}
function read(path,ceiling){const info=lstatSync(path);assert(info.isFile()&&!info.isSymbolicLink()&&info.size<=ceiling,'Invalid progress journal file');const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const opened=fstatSync(fd);assert(opened.isFile()&&opened.dev===info.dev&&opened.ino===info.ino&&opened.size<=ceiling,'Progress file changed');const bytes=Buffer.alloc(ceiling+1);let size=0,n;while(size<bytes.length&&(n=readSync(fd,bytes,size,bytes.length-size,null)))size+=n;assert(size<=ceiling,'Progress file exceeds ceiling');return bytes.subarray(0,size)}finally{closeSync(fd)}
}
export class ProgressDelivery {
 constructor({directory,plan,send,readState,onError=()=>{},maxPending=128,maxEvents=100000,maxAttempts=10000}){
  assert(typeof send==='function'&&typeof readState==='function');this.readState=readState;this.onError=onError;for(const [n,max] of [[maxPending,128],[maxEvents,100000],[maxAttempts,10000]])assert(Number.isSafeInteger(n)&&n>0&&n<=max);this.directory=directory;this.plan=plan;this.send=send;this.maxPending=maxPending;this.maxEvents=maxEvents;this.maxAttempts=maxAttempts;
  mkdirSync(directory,{recursive:true,mode:0o700});assert(lstatSync(directory).isDirectory()&&!lstatSync(directory).isSymbolicLink(),'Invalid journal directory');
  this.names=[];const dir=opendirSync(directory);let total=0;try{for(let entry;(entry=dir.readSync());){assert(++total<=maxEvents+maxPending,'Progress directory exceeds ceiling');if(NAME.test(entry.name)){assert(this.names.length<maxEvents,'Progress event journal exceeds ceiling');this.names.push(entry.name)}}}finally{dir.closeSync()}this.keys=new Set(this.names);
  this.latest=new Map();this.active=new Map();this.pending=[];this.running=null;this.error=null;
  const counts=new Map();for(const name of this.names){const update=this.load(name),old=this.latest.get(update.attempt);if(old)assert(old.machine===update.machine&&old.corpus===update.corpus,'Attempt scope changed');counts.set(update.attempt,(counts.get(update.attempt)||0)+1);if(!old||old.sequence<update.sequence)this.latest.set(update.attempt,update)}for(const [attempt,u] of this.latest)assert(counts.get(attempt)===u.sequence,'Incomplete progress journal');
  assert(this.latest.size<=maxAttempts,'Progress attempt journal exceeds ceiling');
 }
 validate(u){assert(u.schema===1&&u.session===this.plan.id&&u.plan===this.plan.identity&&this.plan.machines.some(m=>m.name===u.machine)&&this.plan.jobs.some(j=>j.id===u.corpus)&&typeof u.attempt==='string'&&NAME.test(u.attempt+'.00001.json')&&Number.isSafeInteger(u.sequence)&&u.sequence>0&&u.sequence<=10000&&Object.values(STATES).includes(u.status)&&Number.isFinite(Date.parse(u.observedAt))&&(!u.phase||ID.test(u.phase)),'Progress outside locked scope')}
 load(name){const u=JSON.parse(read(join(this.directory,name),2048));this.validate(u);const match=NAME.exec(name);assert(u.attempt===match[1]&&u.sequence===Number(match[2]),'Progress journal identity differs');return u}
 async deliver(name,u){const receipt=await this.send(u);assert(/^[a-f0-9]{64}$/.test(receipt.id),'Invalid progress receipt')}
 async replay(){assert(!this.running&&!this.pending.length,'Cannot replay while delivering');
  const ordered=[...this.names].sort((a,b)=>{const x=NAME.exec(a),y=NAME.exec(b);return x[1].localeCompare(y[1])||Number(x[2])-Number(y[2])});let attempt,confirmed=0;
  for(const name of ordered){const u=this.load(name);if(attempt!==u.attempt){attempt=u.attempt;const remote=await this.readState(u);confirmed=remote?.update?.sequence||0;
   if(remote){assert(Number.isSafeInteger(confirmed)&&confirmed>0&&confirmed<=this.latest.get(attempt).sequence,'Remote progress exceeds local journal');const original=this.load(attempt+'.'+String(confirmed).padStart(5,'0')+'.json');assert(['schema','session','plan','machine','corpus','attempt','sequence','status'].every(k=>original[k]===remote.update[k])&&(original.phase||'')===(remote.update.phase||'')&&Date.parse(original.observedAt)===Date.parse(remote.update.observedAt),'Remote progress differs from journal')}
  }if(u.sequence>confirmed)await this.deliver(name,u)}
 }
 append(u){this.validate(u);const bytes=Buffer.from(JSON.stringify(u));assert(bytes.length<=2048,'Progress event exceeds ceiling');assert(this.names.length<this.maxEvents,'Progress event journal exceeds ceiling');
  const old=this.latest.get(u.attempt);assert(old?old.status==='running'&&u.sequence===old.sequence+1:u.sequence===1&&this.latest.size<this.maxAttempts,'Progress journal sequence or attempt ceiling');
  const name=u.attempt+'.'+String(u.sequence).padStart(5,'0')+'.json';assert(!this.keys.has(name),'Duplicate progress filename');install(this.directory,name,bytes);this.names.push(name);this.keys.add(name);this.latest.set(u.attempt,u);
  // Even overflow is retained durably, so stopping collection can resume it.
  assert(this.pending.length<this.maxPending,'Progress delivery queue exceeds ceiling');this.pending.push({name,u});this.start();return u;
 }
 start(){if(this.running||this.error)return;this.running=(async()=>{try{while(this.pending.length){const {name,u}=this.pending[0];await this.deliver(name,u);this.pending.shift()}}catch(e){this.error=e;this.onError(e)}finally{this.running=null}})()}
 record(event){if(!event.corpus||!STATES[event.status]||event.resumed)return null;const key=JSON.stringify([event.machine,event.corpus]);let old=this.active.get(key);
  if(old&&old.status!=='running'&&event.status!=='running')return null;
  if(!old||old.status!=='running')old={attempt:randomUUID(),sequence:0};
  const u={schema:1,session:this.plan.id,plan:this.plan.identity,machine:event.machine,corpus:event.corpus,attempt:old.attempt,sequence:old.sequence+1,status:STATES[event.status],...(event.phase?{phase:event.phase}:{}),observedAt:event.time||new Date().toISOString()};
  try{const saved=this.append(u);this.active.set(key,saved);return saved}catch(e){if(this.latest.get(u.attempt)?.sequence===u.sequence)this.active.set(key,u);throw e}
 }
 async interruptPrevious(machine){for(const u of [...this.latest.values()])if(u.machine===machine&&u.status==='running')this.append({...u,sequence:u.sequence+1,status:'interrupted',phase:'coordinator-restart',observedAt:new Date().toISOString()});await this.flush()}
 async flush(){while(this.running)await this.running;if(this.error)throw this.error;assert(this.pending.length===0,'Pending progress was not delivered')}
}
