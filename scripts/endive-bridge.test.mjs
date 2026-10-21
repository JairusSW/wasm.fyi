import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest} from './lib/wasmbench.mjs';
import {endiveBridgePin,ensureEndiveBridge} from './lib/endive-bridge.mjs';

const wasm=Buffer.from([0,97,115,109,1,0,0,0]);
const version='999.0.0-SNAPSHOT';
const pom='<project><properties><cranelift-bridge.version>'+version+'</cranelift-bridge.version></properties></project>';
const manifest=Buffer.from(JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',layers:[{mediaType:'application/wasm',size:wasm.length,digest:'sha256:'+digest(wasm)}]}));
const locked=digest(manifest);
function lock(hash=locked){return 'version = 1\n[[packages]]\nname = "bytecodealliance:endive-cranelift-bridge"\nregistry = "ghcr.io"\n[[packages.versions]]\nrequirement = "='+version+'"\nversion = "'+version+'"\ndigest = "sha256:'+hash+'"\n';}
async function fixture(t){const source=await mkdtemp(join(tmpdir(),'endive-bridge-'));t.after(()=>rm(source,{recursive:true,force:true}));await mkdir(join(source,'redline'));await writeFile(join(source,'pom.xml'),pom);await writeFile(join(source,'redline/wkg.lock'),lock());return source;}
const respond=(body,status=200)=>new Response(body,{status});

test('pin selects the exact package/version rather than another release',()=>{
 const text=lock()+'\n[[packages.versions]]\nrequirement = "=1.1.0"\nversion = "1.1.0"\ndigest = "sha256:'+'b'.repeat(64)+'"\n';
 assert.deepEqual(endiveBridgePin(pom,text),{version,manifestDigest:'sha256:'+locked});
 assert.throws(()=>endiveBridgePin(pom,text.replace('registry = "ghcr.io"','registry = "127.0.0.1"')),/registry/);
 assert.throws(()=>endiveBridgePin(pom,text.replace('=999.0.0-SNAPSHOT','=other')),/digest/);
 assert.throws(()=>endiveBridgePin(pom,lock()+lock()),/ambiguous/);
});
test('immutable manifest and layer are verified; original source lock remains intact',async t=>{
 const source=await fixture(t),calls=[];
 const result=await ensureEndiveBridge({source,fetchImpl:async(url)=>{calls.push(url);return respond(url.includes('/manifests/')?manifest:wasm);}});
 assert.equal(result.manifestSha256,locked);assert.equal(result.artifactSha256,digest(wasm));assert.deepEqual(await readFile(result.artifact),wasm);assert.equal(await readFile(join(source,'redline/wkg.lock'),'utf8'),lock());
 assert.equal(calls.length,2);assert.ok(calls.every(url=>!url.includes(version)));assert.ok(calls[0].endsWith('sha256:'+locked));
});
test('anonymous registry challenge only authorizes the fixed public pull scope',async t=>{
 const source=await fixture(t);let count=0;
 const result=await ensureEndiveBridge({source,fetchImpl:async(url,options)=>{
  count++;
  if(count===1)return respond('',401);
  if(count===2){assert.ok(url.startsWith('https://ghcr.io/token?'));assert.equal(new URL(url).searchParams.get('scope'),'repository:bytecodealliance/endive-cranelift-bridge:pull');return respond(JSON.stringify({token:'test-public-pull-token'}));}
  assert.equal(options.headers.Authorization,'Bearer test-public-pull-token');return respond(url.includes('/manifests/')?manifest:wasm);
 }});assert.equal(result.artifactBytes,8);assert.equal(count,4);assert.ok(!JSON.stringify(result).includes('test-public-pull-token'));
});
test('cached Wasm is verified and reused without fetching the blob',async t=>{
 const source=await fixture(t);await writeFile(join(source,'redline/cranelift_bridge.wasm'),wasm);let count=0;
 await ensureEndiveBridge({source,fetchImpl:async url=>{count++;assert.ok(url.includes('/manifests/'));return respond(manifest);}});assert.equal(count,1);
});
test('locked manifest and Wasm caches support an offline rebuild',async t=>{
 const source=await fixture(t);await writeFile(join(source,'redline/cranelift_bridge.manifest.json'),manifest);await writeFile(join(source,'redline/cranelift_bridge.wasm'),wasm);
 const result=await ensureEndiveBridge({source,fetchImpl:async()=>{throw Error('must not fetch verified caches');}});
 assert.equal(result.manifestSha256,locked);assert.equal(result.artifactSha256,digest(wasm));
});
test('manifest substitution fails before writing an artifact',async t=>{
 const source=await fixture(t);await assert.rejects(ensureEndiveBridge({source,fetchImpl:async()=>respond('{}')}),/manifest digest/);assert.deepEqual(await readdir(join(source,'redline')),['wkg.lock']);
});
test('corrupt blob preserves the previous generated artifact',async t=>{
 const source=await fixture(t),artifact=join(source,'redline/cranelift_bridge.wasm');await writeFile(artifact,'previous');
 await assert.rejects(ensureEndiveBridge({source,fetchImpl:async url=>respond(url.includes('/manifests/')?manifest:Buffer.alloc(8))}),/Wasm digest/);assert.equal(await readFile(artifact,'utf8'),'previous');
});
test('oversized response is rejected without leaving partial files',async t=>{
 const source=await fixture(t);
 await assert.rejects(ensureEndiveBridge({source,fetchImpl:async url=>respond(url.includes('/manifests/')?manifest:Buffer.alloc(9))}),/size budget/);assert.deepEqual(await readdir(join(source,'redline')),['wkg.lock']);
});
test('expired build budget fails before making a network request',async t=>{
 const source=await fixture(t);await assert.rejects(ensureEndiveBridge({source,env:{WASMFYI_SDK_BUILD_DEADLINE_AT_MS:'1'},fetchImpl:async()=>{throw Error('must not fetch');}}),/deadline exceeded/);
});

async function cargoFixture(t){
 const source=await fixture(t),build=join(source,'redline/wasm-build');
 await rm(join(source,'redline/wkg.lock'));await mkdir(build);
 await writeFile(join(build,'Cargo.toml'),'[package]\nname = "cranelift-bridge"\nversion = "0.1.0"\n');
 await writeFile(join(build,'Cargo.lock'),'version = 4\n');return {source,build};
}
test('historical in-tree bridge builds its locked Wasm target without registry substitution',async t=>{
 const {source,build}=await cargoFixture(t),calls=[];
 const result=await ensureEndiveBridge({source,env:{WASMFYI_BUILD_JOBS:'8',RUSTFLAGS:'-C target-cpu=native'},fetchImpl:async()=>{throw Error('must not fetch an unpinned registry tag');},run:async(program,args,options)=>{
  calls.push({program,args,options});
  if(program==='rustup')return {output:'wasm32-wasip1\n'};
  assert.equal(program,'cargo');assert.ok(args.includes('--locked'));assert.ok(args.includes('wasm32-wasip1'));assert.equal(args[args.indexOf('--jobs')+1],'8');
  assert.equal(options.cwd,build);assert.equal(options.env.RUSTFLAGS,'');
  const out=join(build,'target/wasm32-wasip1/release');await mkdir(out,{recursive:true});await writeFile(join(out,'cranelift_bridge.wasm'),wasm);return {output:''};
 }});
 assert.equal(result.origin,'pinned-cargo-source');assert.equal(result.cargoLockSha256,digest(Buffer.from('version = 4\n')));assert.equal(result.artifactSha256,digest(wasm));
 assert.deepEqual(await readFile(result.artifact),wasm);assert.equal(calls.filter(x=>x.program==='cargo').length,1);assert.equal(await readFile(join(build,'Cargo.lock'),'utf8'),'version = 4\n');
});
test('historical bridge requires a lock and rejects corrupt compiler output without replacing an artifact',async t=>{
 const {source,build}=await cargoFixture(t),artifact=join(source,'redline/cranelift_bridge.wasm');await writeFile(artifact,'previous');
 await assert.rejects(ensureEndiveBridge({source,run:async(program)=>{
  if(program==='rustup')return {output:'wasm32-wasip1\n'};
  const out=join(build,'target/wasm32-wasip1/release');await mkdir(out,{recursive:true});await writeFile(join(out,'cranelift_bridge.wasm'),Buffer.alloc(8));return {output:''};
 }}),/core Wasm/);
 assert.equal(await readFile(artifact,'utf8'),'previous');await rm(join(build,'Cargo.lock'));
 await assert.rejects(ensureEndiveBridge({source,run:async()=>{throw Error('must not build without a lock');}}),/ENOENT/);
});
