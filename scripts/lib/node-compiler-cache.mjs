import {readFile,mkdir,writeFile,realpath} from 'node:fs/promises';import {join,dirname,delimiter,isAbsolute} from 'node:path';import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function compilerCacheEnvironment(env,{program,directory,config,source,statsLog,extraFiles=[]}){
 for(const path of [program,directory,config,source,...extraFiles])if(!isAbsolute(path)||/[\s"'`$]/.test(path))throw Error('Compiler cache requires plain absolute paths');
 const next={...env};for(const key of Object.keys(next))if(key.startsWith('CCACHE_'))delete next[key];
 for(const key of ['CC','CXX']){const compiler=next[key];if(!compiler||!isAbsolute(compiler)||/[\s"'`$]/.test(compiler))throw Error('Compiler cache requires exact unwrapped compiler');next[key]=program+' '+compiler;}
 return {...next,CCACHE_DIR:directory,CCACHE_CONFIGPATH:config,CCACHE_BASEDIR:source,CCACHE_COMPILERCHECK:'content',CCACHE_SLOPPINESS:'',CCACHE_HASHDIR:'1',CCACHE_NOHARDLINK:'1',CCACHE_NOINODECACHE:'1',CCACHE_DIRECT:'1',CCACHE_NODEPEND:'1',CCACHE_MAXSIZE:'8GiB',CCACHE_EXTRAFILES:extraFiles.join(delimiter),CCACHE_STATSLOG:statsLog};
}
export async function configureNodeCompilerCache(env,{source,directory,run}){
 if(!env.WASMFYI_NODE_CCACHE){const marker=await readFile(join(dirname(dirname(directory)),'node-compiler-cache.json'),'utf8').then(JSON.parse,()=>null);if(marker?.status==='installed-verified')env={...env,WASMFYI_NODE_CCACHE:marker.program,WASMFYI_NODE_CCACHE_DIR:marker.directory};else return {env,provenance:null};}
 const program=env.WASMFYI_NODE_CCACHE,cache=env.WASMFYI_NODE_CCACHE_DIR;if(!cache)throw Error('Explicit Node compiler cache directory required');
 const version=(await run(program,['--version'],{env})).output.trim().split('\n')[0],config=join(cache,'strict-config');await mkdir(cache,{recursive:true});
 await writeFile(config,'max_size = 8GiB\ncompiler_check = content\nsloppiness =\nhash_dir = true\nhard_link = false\ninode_cache = false\ndirect_mode = true\ndepend_mode = false\n');
 const compilers={},extraFiles=[];const build={...env};
 for(const [key,fallback] of [['CC','gcc'],['CXX','g++']]){
  const requested=env[key]||fallback;if(/[\s"'`$]/.test(requested))throw Error('Compiler cache refuses prewrapped compiler');
  const path=isAbsolute(requested)?requested:(await run('which',[requested],{env})).output.trim();const actual=await realpath(path);
  // clang++ commonly resolves to clang. Keep the selected driver name, which
  // controls C++ linking, while fingerprinting its real executable contents.
  build[key]=path;compilers[key]={path:actual,driverPath:path,sha256:hash(await readFile(actual))};extraFiles.push(actual);
  if(/(?:gcc|g\+\+)/.test(actual))for(const name of ['cc1','cc1plus','as']){let delegate=(await run(actual,['-print-prog-name='+name],{env})).output.trim();if(!isAbsolute(delegate))delegate=(await run('which',[delegate],{env})).output.trim();const resolved=await realpath(delegate);if(!extraFiles.includes(resolved))extraFiles.push(resolved);}
 }
 const delegateHashes=Object.fromEntries(await Promise.all(extraFiles.map(async f=>[f,hash(await readFile(f))]))),statsLog=join(directory,'node-ccache-statistics.log');
 const configured=compilerCacheEnvironment(build,{program,directory:cache,config,source,statsLog,extraFiles});
 return {env:configured,provenance:{program,programSha256:hash(await readFile(program)),version,directory:cache,maxSize:'8GiB',compilerCheck:'content',sloppiness:[],hashDirectory:true,inodeCache:false,sourceBase:source,statsLog,compilers,delegateHashes,configurationSha256:hash(await readFile(config)),environment:Object.fromEntries(Object.entries(configured).filter(([k])=>k.startsWith('CCACHE_')||['CC','CXX'].includes(k)))}};
}
export function summarizeCompilerCacheStats(log){const groups={icu:{hits:0,misses:0},v8:{hits:0,misses:0},other:{hits:0,misses:0}};let group='other';for(const line of String(log).split('\n')){if(line.startsWith('#'))group=/\/icu[-/]|icu-small/.test(line)?'icu':/deps\/v8/.test(line)?'v8':'other';else if(/^(?:direct|preprocessed)_cache_hit$/.test(line.trim()))groups[group].hits++;else if(line.trim()==='cache_miss')groups[group].misses++;}return groups;}
