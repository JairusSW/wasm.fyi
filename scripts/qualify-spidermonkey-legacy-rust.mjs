import {withBuildLock} from './lib/measurement-lock.mjs';
import {mkdir,readFile,writeFile,cp,copyFile,symlink,stat,readdir} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
const [root,sdk]=process.argv.slice(2),proof=root+'/spidermonkey-legacy-rust-proof';
await mkdir(proof,{recursive:true});const save=d=>writeFile(proof+'/status.json',JSON.stringify({...d,at:new Date().toISOString(),pid:process.pid},null,2));
await save({status:'waiting-lock'});
try{await withBuildLock(root,async()=>{
 const site=proof+'/site';await mkdir(site,{recursive:true});await cp(root+'/site/scripts',site+'/scripts',{recursive:true});await cp(root+'/site/adapters',site+'/adapters',{recursive:true});
 for(const f of ['spidermonkey-sdk.mjs','spidermonkey-rust.mjs'])await copyFile(root+'/diagnostics/'+f,site+'/scripts/lib/'+f);
 await copyFile(root+'/diagnostics/spidermonkey-rust.test.mjs',site+'/scripts/spidermonkey-rust.test.mjs');
 const template=JSON.parse(await readFile(root+'/collection-template.json')),env={...process.env,...template.env,GOWORK:'off',WASMFYI_SPIDERMONKEY_LEGACY_RUST:'1.70.0'};
 for(const k of ['WASMBENCH_SINGLE_CORE','GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','LD_LIBRARY_PATH'])delete env[k];
 const run=(p,a,extra={})=>{const r=spawnSync(p,a,{cwd:site,env,stdio:'inherit',timeout:6*3600000,...extra});if(r.status!==0)throw Error(p+' failed '+r.status);};
 run(process.execPath,['--test',site+'/scripts/spidermonkey-rust.test.mjs']);await save({status:'provisioning-compatible-rust'});
 run('/home/hub/.cargo/bin/rustup',['toolchain','install','1.70.0','--profile','minimal']);
 const tools=root+'/../toolchains/spidermonkey-legacy-build',packages=tools+'/packages';await mkdir(packages,{recursive:true});
 if(!await stat(tools+'/usr/bin/m4').catch(()=>null)||!await stat(tools+'/usr/bin/autoconf2.13').catch(()=>null)){
  run('/usr/bin/apt-get',['download','m4','autoconf2.13'],{cwd:packages});
  for(const file of (await readdir(packages)).filter(f=>f.endsWith('.deb')))run('/usr/bin/dpkg-deb',['--extract',packages+'/'+file,tools]);
 }
 env.WASMFYI_SPIDERMONKEY_LEGACY_BUILD=tools;
 const packageReceipts=[];for(const file of (await readdir(packages)).filter(f=>f.endsWith('.deb')))packageReceipts.push({file:packages+'/'+file,sha256:createHash('sha256').update(await readFile(packages+'/'+file)).digest('hex')});
 await writeFile(proof+'/toolchain-packages.json',JSON.stringify({source:'Distribution packages verified by apt-get download against signed repository indexes',packages:packageReceipts},null,2));
 const privateSDK=proof+'/sdk';await mkdir(privateSDK+'/sources',{recursive:true});
 for(const f of ['pins.json','suite.json'])await copyFile(sdk+'/'+f,privateSDK+'/'+f);
 if(!await stat(privateSDK+'/sources/spidermonkey').catch(()=>null))await symlink(sdk+'/sources/spidermonkey',privateSDK+'/sources/spidermonkey');
 await save({status:'building-private-sdk',toolchain:'1.70.0'});
 run(process.execPath,[site+'/scripts/weekly-build.mjs',privateSDK,'spidermonkey',root+'/frozen-harness']);
 const record=JSON.parse(await readFile(privateSDK+'/spidermonkey-build.json'));const {readCache}=await import(root+'/site/scripts/lib/benchmark-plan.mjs');const workload=(await readCache(template.corpusRoot)).find(w=>w.id==='wago/tiny/add');if(!workload)throw Error('Tiny workload absent');
 await save({status:'qualifying-private-sdk',toolchain:'1.70.0'});
 const child=spawn('taskset',['-c','2',...record.runtime.command],{cwd:record.root,env:{...env,...record.env,WASMBENCH_SINGLE_CORE:'1'},stdio:['pipe','pipe','pipe'],detached:true}),lines=createInterface({input:child.stdout}),iterator=lines[Symbol.asyncIterator]();let id=0,stderr='';const rows=[];child.stderr.on('data',b=>stderr+=b);const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},300000);
 const request=async(method,payload={})=>{child.stdin.write(JSON.stringify({version:1,id:++id,method,...payload})+'\n');const next=await iterator.next();if(next.done)throw Error('SDK exited '+stderr);const response=JSON.parse(next.value);if(response.version!==1||response.id!==id||response.status!=='ok')throw Error(next.value);rows.push({method,response});return response;};
 try{await request('describe');await request('prepare',{prepare:{artifact:workload.artifact,artifact_sha256:workload.sha256,workload,profile:'timing'}});for(const scenario of ['compile','instantiate','first-call','steady']){const r=await request('run',{run:{scenario,samples:1,operations:1,warmup:0}});if(r.samples?.length!==1||!r.samples[0].verified||JSON.stringify(r.samples[0].result)!==JSON.stringify(['12']))throw Error('Tiny oracle '+scenario);}await request('close');}finally{clearTimeout(timer);lines.close();child.stdin.destroy();try{process.kill(-child.pid,'SIGTERM')}catch{}await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}resolve()},1000)});}
 await save({status:'qualified',rows,sdkReceipt:privateSDK+'/spidermonkey-build.json',toolchain:'1.70.0',source:record.source,capturesMutated:false,guestSamplesPerPhase:1});
 });}catch(error){await save({status:'failed-held',error:String(error),capturesMutated:false});throw error;}
