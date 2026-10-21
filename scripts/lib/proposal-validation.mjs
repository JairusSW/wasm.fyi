import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdtemp,writeFile,rm,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {command,digest} from './wasmbench.mjs';
import {proposalToolchainRoot} from './proposal-toolchain.mjs';

export const proposalD8 = () => process.env.WASMBENCH_D8 || (existsSync(join(proposalToolchainRoot,'bin/d8'))?join(proposalToolchainRoot,'bin/d8'):join(homedir(),'.jsvu/bin/d8'));
export const PROPOSAL_VALIDATION_SIZES=[0,1,2,3,7,15,31,32,63,64,65,127,128,255,256,257,1023,4096];
export function unavailableProposal(feature,message) {
 return (feature==='memory-control'&&/^CompileError:[\s\S]*\binvalid numeric opcode: 0xfc12\b/.test(message))||
  (feature==='shared-everything-threads'&&/^CompileError:[\s\S]*shared globals are not supported yet/.test(message));
}
export async function proposalRuntimeIdentity(binary) {
 const p=spawnSync(binary,['--version'],{encoding:'utf8'});
 if(p.error||p.status!==0)throw Error('Runtime preflight failed: '+binary);
 const located=spawnSync('which',[binary],{encoding:'utf8'}).stdout?.trim();
 if(!located)throw Error('Cannot locate runtime '+binary);
 const executable=await realpath(located),files=[executable];
 if(binary===proposalD8()&&!process.env.WASMBENCH_D8) {
  const cached=binary===join(proposalToolchainRoot,'bin/d8');
  files.push(...(cached?['d8','snapshot_blob.bin','icudtl.dat','v8_build_config.json']:['d8','snapshot_blob.bin','icudtl.dat'])
   .map(name=>join(cached?proposalToolchainRoot:join(homedir(),'.jsvu/engines/v8'),name)));
 }
 const fileSha256=Object.fromEntries(await Promise.all(files.map(async file=>[file,digest(await readFile(file))])));
 return {binary:executable,version:p.stdout.trim(),fileSha256};
}
export const proposalFlags = {
 'legacy-exceptions':['--wasm-legacy-eh'],
 'shared-everything-threads':['--wasm-shared'],
 'stack-switching':['--wasm-wasmfx'],
 'memory-control':['--wasm-memory-control'],
 'branch-hinting':[],
 'custom-page-sizes':[],
};

export async function nativeProposalCheck(workload, {compileOnly=false}={}) {
 const bytes=await readFile(workload.artifact);
 if(digest(bytes)!==workload.sha256)throw Error('Artifact digest mismatch: '+workload.id);
 const dir=await mkdtemp(join(tmpdir(),'wasmfyi-proposal-'));
 try {
  const script=join(dir,'check.js'),input=join(dir,'input.json');
  await writeFile(input,JSON.stringify({...workload,compileOnly}));
  await writeFile(script,`const w=JSON.parse(read(arguments[0]));
try {
 const module=new WebAssembly.Module(readbuffer(w.artifact));
 if(!w.compileOnly) {
  for(let fresh=0;fresh<2;fresh++) {
   const instance=new WebAssembly.Instance(module,{});let previousRoot;
   for(const vector of w.validationVectors || [{args:w.args,expected:w.oracle.expected}]) {
    for(let repeat=0;repeat<3;repeat++) {
     const args=vector.args.map(v=>typeof v==='string'?BigInt(v):v);
     const actual=instance.exports[w.export](...args);
     const values=(Array.isArray(actual)?actual:[actual]).map(v=>typeof v==='bigint'?BigInt.asUintN(64,v).toString():String(v>>>0));
     if(JSON.stringify(values)!==JSON.stringify(vector.expected.map(String))) throw Error('Incorrect result '+w.id+' '+JSON.stringify(vector.args)+': '+values+' expected '+vector.expected);
     for(const expected of w.oracle?.memory || []) {
      const bytes=new Uint8Array(instance.exports.memory.buffer,expected.offset,expected.hex.length/2);
      const actualHex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
      if(actualHex!==expected.hex)throw Error('Incorrect memory bytes '+w.id+': '+actualHex);
     }
     if(w.retainedRoots) {
      const n=Number(vector.args[0]);
      if(instance.exports['retained-count']()!==n)throw Error('Incorrect retained root count');
      if(n>0) {
       for(const index of [0,n>>1,n-1])if(instance.exports['retained-value'](index)!==(Math.imul(index,w.retainedRoots.multiplier)|0))throw Error('Incorrect retained root value');
       const first=instance.exports['retained-object'](0);
       if(n>1&&first===instance.exports['retained-object'](n-1))throw Error('Allocation roots alias');
       if(previousRoot===first)throw Error('Reused object across fresh kernel calls');
       previousRoot=first;
      }
     }
    }
   }
  }
 }
 print('WASMFYI:'+JSON.stringify({status:'verified',freshInstances:w.compileOnly?0:2,reusedCallsPerInput:w.compileOnly?0:3}));
} catch(error) { print('WASMFYI:'+JSON.stringify({status:'failed',reason:String(error.stack || error)})); quit(1); }
`);
  const flags=workload.v8Flags || proposalFlags[workload.id?.split('/')[1]] || [];
  const args=[...flags,script,'--',input];
  const run=spawnSync(proposalD8(),args,{encoding:'utf8',timeout:30000,maxBuffer:4<<20});
  if(run.error)throw run.error;
  const line=run.stdout.split('\n').find(s=>s.startsWith('WASMFYI:'));
  if(!line)throw Error('Native V8 runner failed: '+run.stderr+' '+run.stdout);
  const result=JSON.parse(line.slice(8));
  if(result.status!=='verified'||run.status!==0)throw Error(result.reason || run.stderr);
  return {...result,flags};
 } finally {await rm(dir,{recursive:true,force:true});}
}

export async function validateProposalArtifact(compiler,artifact,fixture) {
 if(!fixture.nativeValidation) {command(compiler,['validate','--features','all',artifact]);return;}
 if(!/V8 version 15\.2\.20\b/.test(command(proposalD8(),['--version']).toString()))throw Error('Binary proposal dialect requires V8 15.2.20');
 await nativeProposalCheck({id:`features/${fixture.feature}/${fixture.name}`,artifact,sha256:digest(await readFile(artifact)),v8Flags:fixture.v8Flags},{compileOnly:true});
}
