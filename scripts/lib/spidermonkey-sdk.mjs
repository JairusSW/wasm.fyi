import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';
export async function buildSpiderMonkeySDK({source,target,env,run}) {
 await mkdir(target,{recursive:true});
 const object=join(target,'obj'),mozconfig=join(target,'mozconfig');
 const flags=['--enable-project=js','--enable-optimize','--disable-debug','--enable-release','--disable-tests'];
 if(/[\n\r"$`]/.test(object))throw Error('Unsafe SpiderMonkey build path');
 await writeFile(mozconfig,['mk_add_options MOZ_OBJDIR="'+object+'"',...flags.map(flag=>'ac_add_options '+flag),''].join('\n'));
 const buildEnv={...env,MOZCONFIG:mozconfig};
 await run('python3',[join(source,'mach'),'build','--jobs','2'],{cwd:source,env:buildEnv});
 const binary=join(object,'dist/bin/js');if(!await stat(binary).catch(()=>null))throw Error('SpiderMonkey source build did not produce its shell');
 await run(binary,['--wasm-compiler=ion','-e','if(!wasmIsSupported())throw Error("WebAssembly disabled")']);
 env.WASMBENCH_SPIDERMONKEY=binary;env.NODE_OPTIONS='';
 return {source,target,binary,binarySha256:digest(await readFile(binary)),flags,mozconfigSha256:digest(await readFile(mozconfig)),wasmCompiler:'Ion only'};
}
