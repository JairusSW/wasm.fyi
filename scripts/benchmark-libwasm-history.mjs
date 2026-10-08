import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
import {readFile,writeFile,mkdir,stat,cp,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {command} from './lib/wasmbench.mjs';
const [rootArg,toolRootArg]=process.argv.slice(2),root=resolve(rootArg),tools=resolve(toolRootArg);
const plan=JSON.parse(await readFile(join(root,'source-plan.json'))),template=JSON.parse(await readFile(join(root,'collection-template.json')));
const nativeBase=join(root,'frozen-harness');
if(!await stat(join(nativeBase,'adapters/native/Cargo.toml')).catch(()=>null))throw Error('Missing frozen LibWasm adapter source');
const prepareOnly=process.argv.includes('--prepare-only'),selectedRefs=new Set(process.argv.slice(4).filter(value=>value!=='--prepare-only'));
const source=join(tools,'libwasm-source'),project=join(tools,'libwasm-build-project'),deps=join(tools,'libwasm-deps');
const env={...process.env,...template.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',CARGO_BUILD_JOBS:template.env?.WASMFYI_BUILD_JOBS||'1',WASMBENCH_LIBWASM_DEPS:deps,WASMBENCH_LIBWASM_FASTFLOAT:join(tools,'libwasm-fastfloat/include')};
if(process.platform==='linux'){const llvm=join(tools,'toolchains/llvm22');env.CC=env.WASMFYI_LIBWASM_CC||join(llvm,'usr/lib/llvm-22/bin/clang');env.CXX=env.WASMFYI_LIBWASM_CXX||join(llvm,'usr/lib/llvm-22/bin/clang++');env.LD_LIBRARY_PATH=join(llvm,'usr/lib/x86_64-linux-gnu')}else{env.CXX='/opt/homebrew/opt/llvm/bin/clang++';env.CC='/opt/homebrew/opt/llvm/bin/clang'}
const statusPath=join(root,prepareOnly?'libwasm-qualification-status.json':'libwasm-status.json');
const status=await readFile(statusPath,'utf8').then(JSON.parse,()=>({started:new Date().toISOString(),completed:[],errors:[]}));
for(const pin of plan.pins.filter(p=>p.engine==='libwasm'&&p.status==='planned'&&p.revision&&(!selectedRefs.size||selectedRefs.has(p.tag||p.revision))&&(!process.env.WASMFYI_LIBWASM_REVISION||p.revision===process.env.WASMFYI_LIBWASM_REVISION)).sort((a,b)=>Date.parse(b.targetWeek)-Date.parse(a.targetWeek))){
 if(Date.parse(pin.targetWeek)<Date.parse(plan.cutoff)||Date.parse(pin.targetWeek)>Date.parse(plan.anchor))throw Error('Pin outside authorized window');
 const pinKey=['libwasm',pin.targetType,pin.tag||pin.revision,pin.targetWeek].join('|');
 if(!prepareOnly&&status.completed.some(done=>done.pinKey===pinKey))continue;
 const dir=join(plan.buildCacheRoot||root,'libwasm-builds',pin.revision.slice(0,12)),checkout=join(dir,'source'),build=join(dir,'sdk'),harness=join(dir,'harness'),controller=join(dir,'controller');await mkdir(dir,{recursive:true});
 const releaseBuild=await acquireMeasurementLock(join(root,'measurement-lock'));
 try{
  command('git',['-C',source,'fetch','--depth','1','origin',pin.revision],{env,stdio:'inherit'});
  if(!await stat(checkout).catch(()=>null))command('git',['-C',source,'worktree','add','--detach',checkout,pin.revision],{env,stdio:'inherit'});
  const actualRevision=command('git',['-C',checkout,'rev-parse','HEAD'],{env}).toString().trim();
  if(actualRevision!==pin.revision)throw Error('Libwasm checkout differs from source pin');
  command('git',['-C',checkout,'sparse-checkout','set','AK','Libraries/LibWasm','Libraries/LibMain','Libraries/LibCore','Libraries/LibGC','Libraries/LibThreading','Libraries/LibFileSystem','Libraries/LibUnicode','Libraries/LibTextCodec','Meta','Docs'],{env,stdio:'inherit'});
  command('cmake',['-S',project,'-B',build,'-DSRC='+checkout,'-DCMAKE_PREFIX_PATH='+deps,'-DCMAKE_CXX_FLAGS=-Wno-invalid-constexpr'],{env,stdio:'inherit'});
  command('cmake',['--build',build,'--parallel',String(template.env?.WASMFYI_BUILD_JOBS||1)],{env,stdio:'inherit',timeout:90*60*1000});
  command('cargo',['build','--manifest-path',join(nativeBase,'adapters/native/Cargo.toml'),'--release','--no-default-features','--features','libwasm','--target-dir',join(dir,'native')],{env:{...env,WASMBENCH_LIBWASM_SOURCE:checkout,WASMBENCH_LIBWASM_BUILD:build,WASMBENCH_LIBWASM_VERSION:pin.revision},stdio:'inherit',timeout:90*60*1000});
  await mkdir(join(harness,'bin'),{recursive:true});await cp(join(dir,'native/release/adapter-native'),join(harness,'bin/adapter-libwasm'));
  await mkdir(join(harness,'adapters/wasmtime/target/release'),{recursive:true});const analyzer=join(harness,'adapters/wasmtime/target/release/wasm-analyze');if(!await stat(analyzer).catch(()=>null))await symlink(join(nativeBase,'adapters/wasmtime/target/release/wasm-analyze'),analyzer);
  command('go',['build','-trimpath','-o',controller,'./cmd/wasmbench'],{cwd:nativeBase,env,stdio:'inherit'});
  if(prepareOnly){await writeFile(join(dir,'qualification-build.json'),JSON.stringify({revision:pin.revision,harness,controller,builtAt:new Date().toISOString()},null,2));break;}
  const job={id:'libwasm-'+pin.revision.slice(0,12)+'-'+pin.targetWeek.replace(/[^0-9]/g,''),engine:'libwasm',harness,controller,historical:true,source:{repository:pin.repository,revision:pin.revision,ref:'main@'+pin.revision.slice(0,12),asOf:pin.targetWeek,kind:'snapshot'}};
  const runDirectory=join(dir,'runs',job.id);await mkdir(runDirectory,{recursive:true});
  await writeFile(join(runDirectory,'plan.json'),JSON.stringify({...template,anchor:plan.anchor,cutoff:plan.cutoff,captureDirectory:join(root,'captures'),jobs:[job]}));
  await releaseBuild();
  command(process.execPath,[join(process.cwd(),'scripts/benchmark-history-worker.mjs'),runDirectory],{env:{...process.env,...template.env},cwd:process.cwd(),stdio:'inherit',timeout:48*60*60*1000});const result=JSON.parse(await readFile(join(runDirectory,'status.json'),'utf8'));
  if(result.status!=='completed'||result.completed!==template.workloads.length)throw Error('Incomplete Libwasm collection: '+result.status+'; '+result.errors.length+' errors');
  status.completed.push({pinKey,revision:pin.revision,asOf:pin.targetWeek,captures:result.completed});
 }catch(error){status.errors.push({pinKey,revision:pin.revision,asOf:pin.targetWeek,error:String(error)});console.error(error);if(prepareOnly){await writeFile(statusPath,JSON.stringify(status,null,2));throw error;}}
 finally {await releaseBuild();}
 await writeFile(statusPath,JSON.stringify({...status,updated:new Date().toISOString()},null,2));
}
