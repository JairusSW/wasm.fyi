import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {availableParallelism} from 'node:os';
import {digest} from './wasmbench.mjs';

const repository='bytecodealliance/endive-cranelift-bridge';
const sha256=/^sha256:([a-f0-9]{64})$/;
const field=(text,name)=>text.match(new RegExp('^'+name+'\\s*=\\s*"([^"\\r\\n]+)"\\s*$','m'))?.[1];

export function endiveBridgePin(pom,lock){
 const version=pom.match(/<cranelift-bridge\.version>\s*([^<]+?)\s*<\/cranelift-bridge\.version>/)?.[1];
 if(!version||!/[a-zA-Z0-9]/.test(version)||!/^[a-zA-Z0-9_.-]+$/.test(version))throw Error('Endive bridge version must be explicit in the pinned source');
 const packages=lock.split(/^\[\[packages\]\]\s*$/m).slice(1).filter(block=>field(block.split(/^\[\[packages\.versions\]\]/m)[0],'name')==='bytecodealliance:endive-cranelift-bridge');
 if(packages.length!==1||field(packages[0].split(/^\[\[packages\.versions\]\]/m)[0],'registry')!=='ghcr.io')throw Error('Pinned Endive bridge registry is missing or ambiguous');
 const versions=packages[0].split(/^\[\[packages\.versions\]\]\s*$/m).slice(1).filter(block=>field(block,'version')===version&&field(block,'requirement')==='='+version);
 if(versions.length!==1||!sha256.test(field(versions[0],'digest')||''))throw Error('Pinned Endive bridge digest is missing or ambiguous');
 return {version,manifestDigest:field(versions[0],'digest')};
}

async function boundedBody(response,limit){
 if(!response.ok)throw Error('Pinned Endive bridge registry returned HTTP '+response.status);
 const declared=Number(response.headers.get('content-length'));
 if(declared>limit)throw Error('Pinned Endive bridge response exceeds its size budget');
 const reader=response.body?.getReader();if(!reader)throw Error('Pinned Endive bridge response body is missing');
 const buffers=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Pinned Endive bridge response exceeds its size budget');buffers.push(Buffer.from(value));}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
 return Buffer.concat(buffers,size);
}

async function buildSourceBridge({source,env,run}){
 const build=join(source,'redline/wasm-build');
 const lock=await readFile(join(build,'Cargo.lock')),manifest=await readFile(join(build,'Cargo.toml'));
 if(typeof run!=='function')throw Error('Pinned Endive source bridge requires the SDK build runner');
 if(env.WASMFYI_SDK_BUILD_DEADLINE_AT_MS&&Number(env.WASMFYI_SDK_BUILD_DEADLINE_AT_MS)<=Date.now())throw Error('Pinned Endive bridge SDK build deadline exceeded');
 const jobs=Number(env.WASMFYI_BUILD_JOBS||availableParallelism());
 if(!Number.isSafeInteger(jobs)||jobs<1)throw Error('Invalid Endive bridge build parallelism');
 // This is upstream wasm-build/Makefile's release target, with dependency
 // resolution locked. Host CPU flags must not leak into a Wasm build.
 const buildEnv={...env,RUSTFLAGS:'',CARGO_ENCODED_RUSTFLAGS:'',CARGO_TARGET_DIR:join(build,'target')};
 const targets=(await run('rustup',['target','list','--installed'],{env:buildEnv})).output;
 if(!targets.trim().split(/\s+/).includes('wasm32-wasip1'))await run('rustup',['target','add','wasm32-wasip1'],{env:buildEnv});
 await run('cargo',['build','--locked','--target','wasm32-wasip1','--release','--jobs',String(jobs)],{cwd:build,env:buildEnv});
 const wasm=await readFile(join(build,'target/wasm32-wasip1/release/cranelift_bridge.wasm'));
 if(wasm.length<8||wasm.length>32*1024*1024||!wasm.subarray(0,8).equals(Buffer.from([0,97,115,109,1,0,0,0])))throw Error('Pinned Endive source bridge is not a bounded core Wasm module');
 if(!(await readFile(join(build,'Cargo.lock'))).equals(lock))throw Error('Pinned Endive bridge Cargo lock changed during its build');
 const artifact=join(source,'redline/cranelift_bridge.wasm'),temporary=artifact+'.build-'+process.pid;
 try{await writeFile(temporary,wasm);await rename(temporary,artifact);}finally{await rm(temporary,{force:true});}
 return {origin:'pinned-cargo-source',target:'wasm32-wasip1',cargoLockSha256:digest(lock),cargoManifestSha256:digest(manifest),artifactSha256:digest(wasm),artifactBytes:wasm.length,artifact};
}

export async function ensureEndiveBridge({source,env={},fetchImpl=fetch,run}){
 const lock=await readFile(join(source,'redline/wkg.lock'),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(lock===null)return buildSourceBridge({source,env,run});
 const pin=endiveBridgePin(await readFile(join(source,'pom.xml'),'utf8'),lock);
 const timeout=()=>{
  const remaining=env.WASMFYI_SDK_BUILD_DEADLINE_AT_MS?Number(env.WASMFYI_SDK_BUILD_DEADLINE_AT_MS)-Date.now():60000;
  if(!Number.isFinite(remaining)||remaining<=0)throw Error('Pinned Endive bridge SDK build deadline exceeded');
  return AbortSignal.timeout(Math.max(1,Math.min(60000,Math.floor(remaining))));
 };
 const manifestUrl='https://ghcr.io/v2/'+repository+'/manifests/'+pin.manifestDigest;
 const headers={Accept:'application/vnd.oci.image.manifest.v1+json'};
 let response=await fetchImpl(manifestUrl,{headers,signal:timeout()});
 if(response.status===401){
  await response.body?.cancel();
  const url='https://ghcr.io/token?'+new URLSearchParams({service:'ghcr.io',scope:'repository:'+repository+':pull'});
  const auth=JSON.parse((await boundedBody(await fetchImpl(url,{signal:timeout()}),65536)).toString());
  const token=auth.token||auth.access_token;if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw Error('Pinned Endive bridge anonymous pull token is invalid');
  headers.Authorization='Bearer '+token;
  response=await fetchImpl(manifestUrl,{headers,signal:timeout()});
 }
 const body=await boundedBody(response,1024*1024);
 if('sha256:'+digest(body)!==pin.manifestDigest)throw Error('Pinned Endive bridge manifest digest differs');
 const manifest=JSON.parse(body.toString());
 if(manifest.schemaVersion!==2||manifest.mediaType!=='application/vnd.oci.image.manifest.v1+json'||manifest.layers?.length!==1)throw Error('Pinned Endive bridge must contain one OCI Wasm layer');
 const layer=manifest.layers[0];
 if(layer.mediaType!=='application/wasm'||!sha256.test(layer.digest||'')||!Number.isSafeInteger(layer.size)||layer.size<8||layer.size>32*1024*1024)throw Error('Pinned Endive bridge Wasm layer is invalid');
 const artifact=join(source,'redline/cranelift_bridge.wasm'),artifactSha256=layer.digest.slice(7);
 let wasm=await readFile(artifact).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(!wasm||wasm.length!==layer.size||digest(wasm)!==artifactSha256){
  wasm=await boundedBody(await fetchImpl('https://ghcr.io/v2/'+repository+'/blobs/'+layer.digest,{headers:headers.Authorization?{Authorization:headers.Authorization}:{},signal:timeout()}),layer.size);
  if(wasm.length!==layer.size||digest(wasm)!==artifactSha256)throw Error('Pinned Endive bridge Wasm digest or length differs');
  if(!wasm.subarray(0,8).equals(Buffer.from([0,97,115,109,1,0,0,0])))throw Error('Pinned Endive bridge is not a core Wasm module');
  const temporary=artifact+'.download-'+process.pid;
  try{await writeFile(temporary,wasm);await rename(temporary,artifact);}finally{await rm(temporary,{force:true});}
 }else if(!wasm.subarray(0,8).equals(Buffer.from([0,97,115,109,1,0,0,0])))throw Error('Pinned Endive bridge is not a core Wasm module');
 return {registry:'ghcr.io',repository,version:pin.version,manifestSha256:pin.manifestDigest.slice(7),artifactSha256,artifactBytes:wasm.length,artifact};
}
