import {wizardSPCGlobalCommand} from './wizard-spc-globals.mjs';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {digest,site} from './wasmbench.mjs';

// This compiler revision supplied the SDK used by both architecture proofs.
// SDK history remains pinned independently; no moving compiler branch is used.
export const wizardVirgilRevision='7cf038fc13a5474836bec8b14c7a3e796fd07fa5';
// These extensions are implemented by the pinned Wizard engine but remain
// opt-in at its CLI. Keep the list beside command construction so SDK and
// qualification executions cannot silently test different feature sets.
export const wizardFeatureFlags=['--ext:custom-page-sizes','--ext:legacy-eh','--ext:stack-switching','--ext:threads','--ext:wide-arithmetic'];
export async function ensureWizardCompiler({virgil,external=false,run}) {
 const initialized=await stat(join(virgil,'.git')).catch(()=>null);
 if(!initialized){
  await mkdir(virgil,{recursive:true});
  await run('git',['init',virgil]);
  await run('git',['-C',virgil,'remote','add','origin','https://github.com/titzer/virgil.git']);
 }
 let revision;
 try { revision=(await run('git',['-C',virgil,'rev-parse','--verify','HEAD'])).output.trim(); }
 catch(error){ if(external&&initialized)throw error; }
 // A disconnected initial fetch leaves an initialized repository without HEAD.
 // Recover only our own incomplete cache; never overwrite another checkout.
 if(!revision){
  await run('git',['-C',virgil,'fetch','--depth','1','origin',wizardVirgilRevision]);
  await run('git',['-C',virgil,'checkout','--detach',wizardVirgilRevision]);
  revision=(await run('git',['-C',virgil,'rev-parse','--verify','HEAD'])).output.trim();
 }
 if(revision!==wizardVirgilRevision)throw Error('Virgil compiler source differs from qualified pinned revision');
 return revision;
}
export function wizardArchitectureUnavailable(configuration,{platform=process.platform,architecture=process.arch}={}) {
 if(!['wizard-v3-int','wizard-fast-int','wizard-spc'].includes(configuration))throw Error('Unknown Wizard configuration');
 if(configuration!=='wizard-v3-int'&&(platform!=='linux'||architecture!=='x64'))return {
  reason:'Pinned Wizard fast interpreter and Singlepass SDK require Linux AMD64; portable V3 interpreter is available separately',
  configuration,platform,architecture,backend:configuration==='wizard-spc'?'singlepass-jit':'interpreter',
 };
 return null;
}
export async function buildWizardSDK({source,root,version,configuration,env,run}) {
 const unavailable=wizardArchitectureUnavailable(configuration);
 if(unavailable)throw Object.assign(Error(unavailable.reason),{code:'UNSUPPORTED_PLATFORM',proof:unavailable});
 if(!/^[a-f0-9]{40}$/i.test(version))throw Error('Full pinned Wizard source commit required');
 const virgil=env.WASMFYI_VIRGIL||join(homedir(),'.cache/wasm-fyi/toolchains/virgil-'+wizardVirgilRevision);
 const compilerRevision=await ensureWizardCompiler({virgil,external:Boolean(env.WASMFYI_VIRGIL),run});
 if(env.WASMBENCH_JAVA)env.PATH=dirname(env.WASMBENCH_JAVA)+':'+env.PATH;
 // Upstream selects its source-pinned bootstrap binary for the build host.
 await run('bash',[join(virgil,'bin/.setup-v3c')],{cwd:virgil});
 env.PATH=join(virgil,'bin')+':'+env.PATH;
 env.VIRGIL_LOC=virgil;env.VIRGIL_LIB=join(virgil,'lib');
 await mkdir(join(source,'bin'),{recursive:true});
 for(const script of ['prepare-wizard-native-size.mjs','prepare-wizard-benchmark.mjs'])await run(process.execPath,[join(site,'scripts',script),source,...(script==='prepare-wizard-benchmark.mjs'?[virgil,version,configuration==='wizard-v3-int'?'portable':'linux-x64']:[])]);
 const target=configuration==='wizard-v3-int'?'jvm':'x86-64-linux';
 const flags=target==='jvm'?['--nojit']:[];
 await run('bash',['build.sh',...flags,'wizeng',target],{cwd:source});
 const artifact=join(source,'bin',target==='jvm'?'wizeng.jvm.jar':'wizeng.x86-64-linux');
 if(!await stat(artifact).catch(()=>null))throw Error('Pinned Wizard source did not produce its selected SDK target');
 const mode=configuration==='wizard-spc'?'spc':configuration==='wizard-fast-int'?'int':'v3-int';
 const command=target==='jvm'?[env.WASMBENCH_JAVA||'java','-XX:ActiveProcessorCount=1','-XX:+UseSerialGC','-Xbatch','-jar',artifact,'--mode='+mode,...wizardFeatureFlags,'--invoke=wasmfyi-bench']:[artifact,'--mode='+mode,...wizardFeatureFlags,'--invoke=wasmfyi-bench'];
 // SDK CLI routing token: the RPC entrypoint intercepts it before file loading.
 command.push('wasmfyi-bench.wasm');
 await mkdir(join(root,'bin'),{recursive:true});
 const files={[artifact]:digest(await readFile(artifact))};
 const configurations=target==='jvm'?['wizard-v3-int']:['wizard-fast-int','wizard-spc'];
 for(const selected of configurations){
  const selectedMode=selected==='wizard-spc'?'spc':selected==='wizard-fast-int'?'int':'v3-int';
  const selectedCommand=wizardSPCGlobalCommand(command.map(argument=>argument.startsWith('--mode=')?'--mode='+selectedMode:argument),selected);
  await writeFile(join(root,'bin',selected+'-command.json'),JSON.stringify({configuration:selected,revision:version,command:selectedCommand,files})+'\n');
 }
 const commandFile=join(root,'bin',configuration+'-command.json');
 const manifest={files};
 const patches=Object.fromEntries(await Promise.all(['WasmBenchCore.v3','WasmBenchOracle.v3','WasmBenchPrepared.v3','WasmBenchRPC.v3','WasmBenchHost.v3','WasmBenchClock.v3','WasmBenchJson.v3'].map(async name=>[name,digest(await readFile(join(source,'src/util',name)))])));
 return {source,version,configuration,target,mode,flags,compilerRevision,compiler:join(virgil,'bin/v3c'),compilerSha256:digest(await readFile(join(virgil,'bin/v3c'))),commandFile,artifact,artifactSha256:manifest.files[artifact],patches,
  clockPolicy:target==='jvm'?'JVM nanoTime; 32-bit wrap extended with monotonic microsecond reference':'Linux CLOCK_MONOTONIC full 64-bit timespec; SDK fractional gettimeofday ticksNs excluded',
  timingPolicy:'SDK parse/validation/eager selected compiler; fresh SDK linker/instance; SDK Execute.call; immutable decoded corpus inputs and independent oracle checks outside clocks',
  cachePolicy:'One prepare and process; verified final compile sample retained for subsequent phases; stateless steady instance retained across groups',
  nativeCodePolicy:configuration==='wizard-spc'?'Actual emitted module image codeEnd; excludes unused mapping ballast and shared runtime stubs':'Selected interpreter has no artifact-native image; n/a',
 };
}
