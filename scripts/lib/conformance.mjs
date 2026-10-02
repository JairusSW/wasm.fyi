import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {homedir,hostname,platform,arch} from 'node:os';
import {command,digest,exists} from './wasmbench.mjs';
import {releasedBuild,releaseSource,assertReleasedSource,githubReleases} from './release-policy.mjs';

export const suites={
  core:{repository:'WebAssembly/spec',revision:'9d36019973201a19f9c9ebb0f10828b2fe2374aa',directory:'test/core',label:'WebAssembly 3.0 official WAST'},
  component:{repository:'WebAssembly/component-model',revision:'8b5c200fe8ef39d715849d4b9b5e03017c8ab62a',directory:'test',label:'Official Component Model WAST (including async)'},
  wasi:{repository:'WebAssembly/wasi-testsuite',revision:'e0aa527fab67f2f311882bcee4f62cc755433b73',directory:'tests',label:'Official WASI precompiled testsuite'}
};
export const conformanceCache=()=>process.env.WASMBENCH_CONFORMANCE_CACHE || join(homedir(),'.cache/wasm-fyi/conformance');
export async function checkoutSuite(suite){
  const root=join(conformanceCache(),'sources',suite.repository.replace('/','-')+'-'+suite.revision);
  await mkdir(root,{recursive:true});
  const url=`https://github.com/${suite.repository}.git`;
  if(!await exists(join(root,'.git'))){command('git',['init',root]);command('git',['-C',root,'remote','add','origin',url]);}
  if(command('git',['-C',root,'remote','get-url','origin']).toString().trim()!==url)throw Error('Suite remote changed');
  if(!await exists(join(root,'.git/wasm-fyi-suite'))){command('git',['-C',root,'fetch','--depth','1','origin',suite.revision],{stdio:'inherit'});command('git',['-C',root,'checkout','--detach',suite.revision],{stdio:'inherit'});await writeFile(join(root,'.git/wasm-fyi-suite'),suite.revision);}
  if(command('git',['-C',root,'rev-parse','HEAD']).toString().trim()!==suite.revision || command('git',['-C',root,'status','--porcelain','--untracked-files=no']).length)throw Error('Pinned suite source changed');
  return root;
}
export async function inventory(root,extension='.wast',relative=''){
  const rows=[];
  for(const entry of (await readdir(join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const path=join(relative,entry.name);
    if(entry.isDirectory())rows.push(...await inventory(root,extension,path));
    else if(entry.name.endsWith(extension))rows.push({path:path.replaceAll('\\','/'),sha256:digest(await readFile(join(root,path)))});
  }
  if(!relative && !rows.length)throw Error('Empty upstream suite inventory');
  return rows;
}
export function execute(binary,args,{cwd,env=process.env,timeout=120000}={}){
  const run=spawnSync(binary,args,{cwd,env,timeout,encoding:'utf8',maxBuffer:64*1024*1024});
  return {command:[binary,...args],exitCode:run.status,signal:run.signal,processError:run.error?.message || null,stdout:run.stdout || '',stderr:run.stderr || '',status:run.error?'runner-error':run.signal?'crashed':run.status===0?'passed':'failed'};
}
export async function latestWasmtime(asOf){
  const r=asOf? (await import('./release-policy.mjs')).latestRelease(githubReleases('bytecodealliance/wasmtime'),asOf):JSON.parse(command('gh',['api','repos/bytecodealliance/wasmtime/releases/latest']).toString());
  if(!r)throw Error('No Wasmtime release available at snapshot date');
  if(!releasedBuild(r))throw Error('Wasmtime selected release is a development build');
  const target={ 'darwin-arm64':'aarch64-macos','linux-x64':'x86_64-linux','darwin-x64':'x86_64-macos'}[`${platform()}-${arch()}`];
  if(!target)throw Error('No qualified Wasmtime release asset for this host');
  const name=`wasmtime-${r.tag_name}-${target}.tar.xz`,asset=r.assets.find(a=>a.name===name);
  if(!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || ''))throw Error('Released CLI asset lacks its published checksum');
  const root=join(conformanceCache(),'tools',r.tag_name+'-'+target),binary=join(root,'wasmtime');
  await mkdir(root,{recursive:true});
  const archive=join(root,name),receipt=join(root,'release.json');
  if(!await exists(receipt)){
    command('curl',['--fail','--location','--retry','3',asset.browser_download_url,'-o',archive],{stdio:'inherit'});
    if(digest(await readFile(archive))!==asset.digest.slice(7))throw Error('Release asset checksum differs');
    command('tar',['-xJf',archive,'--strip-components=1','-C',root]);
    await writeFile(receipt,JSON.stringify({tag:r.tag_name,sha256:digest(await readFile(binary)),assetSha256:asset.digest.slice(7),url:r.html_url})+'\n');
  }
  const pin=JSON.parse(await readFile(receipt));
  if(pin.tag!==r.tag_name || digest(await readFile(binary))!==pin.sha256)throw Error('Released Wasmtime CLI changed');
  return {...pin,binary,version:command(binary,['--version']).toString().trim()};
}
export async function wastReport(engine,suiteName,options={}){
  const suite=suites[suiteName],source=await checkoutSuite(suite),root=join(source,suite.directory),files=await inventory(root);
  const flags=options.flags || [],probe=join(conformanceCache(),'probe.wast');
  await writeFile(probe,'(module (func (export "value") (result i32) i32.const 7))\n(assert_return (invoke "value") (i32.const 7))\n');
  const check=execute(engine.binary,['wast',...flags,probe]);
  if(check.status!=='passed')throw Error('Conformance runner preflight failed: '+check.stderr);
  const results=[];
  for(const file of files){
    const result=execute(engine.binary,['wast',...flags,join(root,file.path)],options);
    results.push({...file,...result});
  }
  return {kind:'wast',unit:'files',suite:{...suite,inventory:files},engine,flags,results,totals:countOutcomes(results),policy:'Native WAST runner preserves module registration, malformed/invalid modules, traps, typed values and script assertions. Counts are whole files, not benchmark cases or assertion counts. Every inventoried file has an outcome; parser/runner failures are never passes.'};
}
export const countOutcomes=rows=>Object.fromEntries(['passed','failed','unsupported','skipped','runner-error','crashed'].map(s=>[s,rows.filter(r=>r.status===s).length]));
export function goResults(log){
  const completed=new Map();let run=0;const outputs=[];
  for(const line of log.split('\n')){
    let event;try{event=JSON.parse(line);}catch{continue;}
    if(event.Action==='run')run++;
    if(event.Output)outputs.push(event.Output);
    if(event.Test && ['pass','fail','skip'].includes(event.Action))completed.set(event.Test,{name:event.Test,status:{pass:'passed',fail:'failed',skip:'skipped'}[event.Action]});
  }
  const rows=[...completed.values()].filter(t=>![...completed.keys()].some(name=>name.startsWith(t.name+'/')));
  return {results:rows,totals:countOutcomes(rows),testsStarted:run,output:outputs.join('')};
}
// The released Preview 1 runner reports individual cases in a single Go test.
// Keep its case counts separate from Go leaf-test counts.
export function wasiCaseTotals(output){
  const matches=[...output.matchAll(/TOTAL\[wasip1\]: passed=(\d+) failed=(\d+) skipped=(\d+) \(of (\d+)\)/g)];
  if(matches.length!==1)return null;
  const [passed,failed,skipped,total]=matches[0].slice(1).map(Number);
  if(passed+failed+skipped!==total || total===0)return null;
  return {...countOutcomes([]),passed,failed,skipped};
}
export async function goConformance(pin,args,env={}){
  assertReleasedSource(pin.source,pin);
  const run=execute('go',['test','-json','-count=1',...args],{cwd:pin.source,env:{...process.env,GOWORK:'off',GOFLAGS:'-mod=readonly',...env},timeout:1800000});
  const parsed=goResults(run.stdout);
  assertReleasedSource(pin.source,pin);
  return {kind:'go-native-suite',unit:'leaf subtests',engine:pin,...run,...parsed,status:parsed.testsStarted===0?'runner-error':run.status,policy:'Expected-failure skips remain skipped; package exit status and raw Go JSON are retained. A successful Go process with zero tests is a runner error.'};
}
export const hostIdentity=()=>({hostname:hostname(),os:platform(),arch:arch()});

export async function wasiReport(engine){
  const suite=suites.wasi,source=await checkoutSuite(suite),files=await inventory(join(source,suite.directory),'.wasm');
  const envRoot=join(conformanceCache(),'python-'+suite.revision),python=join(envRoot,'bin/python');
  if(!await exists(python))command('python3',['-m','venv',envRoot]);
  const receipt=join(envRoot,'dependencies.json');
  if(!await exists(receipt)){
    command(python,['-m','pip','install','-r',join(source,'test-runner/requirements.txt')],{stdio:'inherit'});
    await writeFile(receipt,JSON.stringify({requirementsSha256:digest(await readFile(join(source,'test-runner/requirements.txt'))),freeze:command(python,['-m','pip','freeze']).toString()})+'\n');
  }
  const expected=JSON.parse(await readFile(receipt));
  if(command(python,['-m','pip','freeze']).toString()!==expected.freeze)throw Error('WASI runner dependencies changed');
  const output=join(conformanceCache(),'wasi-'+Date.now()+'.json');
  const result=execute(python,[join(source,'run-tests'),'--runtime-adapter',join(source,'adapters/wasmtime.py'),'--json-output-location',output,'--disable-colors'],{cwd:source,env:{...process.env,WASMTIME:engine.binary},timeout:1800000});
  const upstream=await exists(output)?JSON.parse(await readFile(output)):null;
  const tests=(upstream?.results || []).flatMap(group=>group.tests.map(test=>({...test,group:group.name,status:{pass:'passed',fail:'failed',skip:'skipped',xfail:'skipped',xpass:'failed'}[test.outcome] || 'runner-error'})));
  return {kind:'official-wasi-runner',unit:'cases',results:tests,totals:countOutcomes(tests),suite:{...suite,inventory:files},engine,...result,upstream,runnerDependencies:expected,status:upstream?result.status:'runner-error',policy:'The unmodified official WASI runner applies fixture JSON oracles, environment, preopens, expected output and exit codes. Upstream skips and expected failures are retained in the raw JSON; a missing report is never a pass.'};
}
