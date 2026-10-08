import {command} from './wasmbench.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {latestRelease,parseReleasePages} from './release-policy.mjs';
import {firefoxReleases} from './firefox-releases.mjs';
import {mergeGoModuleVersions} from './go-module-versions.mjs';
const execFileAsync=promisify(execFile);
export const engineSources={
  wasmedge:{repository:"WasmEdge/WasmEdge",configurations:["wasmedge","wasmedge-jit"]},
  chicory:{repository:"dylibso/chicory",configurations:["chicory"]},
  wasm2c:{repository:"WebAssembly/wabt",configurations:["wasm2c-gcc"]},
  w2c2:{repository:"turbolent/w2c2",configurations:["w2c2-gcc"]},
  wasm2go:{repository:'ncruces/wasm2go',configurations:['wasm2go']},
  libwasm:{repository:'LadybirdBrowser/ladybird',configurations:['libwasm']},
  wago:{repository:'wago-org/wago',configurations:['wago']},
  wazero:{repository:'tetratelabs/wazero',configurations:['wazero','wazero-interpreter']},
  wasmtime:{repository:'bytecodealliance/wasmtime',configurations:['wasmtime','wasmtime-winch']},
  wasmer:{repository:'wasmerio/wasmer',configurations:['wasmer-singlepass','wasmer-llvm']},
  v8:{repository:'nodejs/node',provider:'node',configurations:['v8']},
  wasmi:{repository:'wasmi-labs/wasmi',configurations:['wasmi']},
  wamr:{repository:'bytecodealliance/wasm-micro-runtime',configurations:['wamr','wamr-fast-jit','wamr-llvm-jit']},
  wasm3:{repository:'wasm3/wasm3',configurations:['wasm3']},
  spidermonkey:{repository:'mozilla-firefox/firefox',provider:'firefox',configurations:['spidermonkey']},
  jsc:{repository:'WebKit/WebKit',provider:'webkitgtk',configurations:['jsc'],platforms:['darwin','linux']},
  wavm:{repository:'WAVM/WAVM',configurations:['wavm'],platforms:['darwin','linux']},
};
export async function releaseInventory(engine){
  const spec=engineSources[engine];
  if(!spec)throw Error('Unknown engine '+engine);
  if(spec.provider==='unavailable')throw Error('No qualified published JavaScriptCore standalone release archive; Safari version is not standalone JSC provenance.');
  if(spec.provider==='node'){
    const rows=JSON.parse(command('curl',['--fail','--silent','--show-error','https://nodejs.org/dist/index.json']).toString());
    return rows.map(r=>({tag_name:r.version,published_at:r.date+'T00:00:00Z',draft:false,prerelease:false,html_url:'https://nodejs.org/dist/'+r.version+'/',embeddedV8:r.v8,datePrecision:'day'}));
  }
  if(spec.provider==='firefox'){
    return firefoxReleases(JSON.parse(command('curl',['--fail','--silent','--show-error','https://product-details.mozilla.org/1.0/firefox.json']).toString()));
  }
  if(spec.provider==='webkitgtk'){
    const html=command('curl',['--fail','--silent','--show-error','https://webkitgtk.org/releases/']).toString();
    const releases=[];
    for(const [,row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const file=row.match(/href=["'](webkitgtk-(\d+)\.(\d+)\.(\d+)\.tar\.xz)["']/i);
      const date=row.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
      if(!file||!date)continue;
      const minor=Number(file[3]);
      releases.push({tag_name:`webkitgtk-${file[2]}.${file[3]}.${file[4]}`,published_at:`${date[1]}T${date[2]}:00Z`,draft:false,prerelease:minor%2===1,html_url:`https://webkitgtk.org/releases/${file[1]}`});
    }
    if(!releases.length)throw Error('Official WebKitGTK release index contained no versioned source archives');
    return releases;
  }
  // `gh api --slurp` is not available in every installed GitHub CLI release
  // (notably the version on Hub). Ask gh to emit one JSON object per release
  // instead; --paginate and --jq are supported by both hosts.
  const releases=parseReleasePages(command('gh',['api','--paginate',`repos/${spec.repository}/releases?per_page=100`,'--jq','. | tojson']).toString());
  if(!['wasm2go','wago','wazero'].includes(engine))return releases;
  const base='https://proxy.golang.org/github.com/'+spec.repository+'/@v/';
  const versions=command('curl',['--fail','--silent','--show-error',base+'list']).toString().trim().split(/\s+/),metadata=[];
  for(let i=0;i<versions.length;i+=4)metadata.push(...await Promise.all(versions.slice(i,i+4).map(async version=>{
   const {stdout}=await execFileAsync('curl',['--fail','--silent','--show-error','--retry','3','--max-time','60',base+encodeURIComponent(version)+'.info'],{encoding:'utf8',timeout:65_000,maxBuffer:1024*1024});return JSON.parse(stdout);
  })));
  return mergeGoModuleVersions(spec.repository,releases,metadata);
}
export async function pinMain(engine,dates){
  const spec=engineSources[engine];
  if(!spec)throw Error('Unknown engine '+engine);
  if(spec.provider==='webkitgtk')return dates.map(targetWeek=>({engine,targetType:'main',targetWeek,status:'unavailable',reason:'No Git repository with a qualified standalone JavaScriptCore main build source.',configurations:spec.configurations}));
  try {
    const repo=JSON.parse(command('gh',['api',`repos/${spec.repository}`]).toString());
    const branch=repo.default_branch;
    if(!branch)throw Error('Upstream repository did not report its default branch.');
    const pins=[];
    for(let offset=0;offset<dates.length;offset+=6){
      const batch=await Promise.all(dates.slice(offset,offset+6).map(async targetWeek=>{
        try {
          const until=encodeURIComponent(targetWeek);
          const {stdout}=await execFileAsync('gh',['api',`repos/${spec.repository}/commits?sha=${encodeURIComponent(branch)}&until=${until}&per_page=1`],{maxBuffer:1024*1024});
          const commit=JSON.parse(stdout)[0];
          if(!commit?.sha)throw Error('No branch commit was available by this Saturday.');
          return {engine,targetType:'main',targetWeek,repository:spec.repository,branch,revision:commit.sha,committedAt:commit.commit?.committer?.date||commit.commit?.author?.date||null,url:commit.html_url,status:'planned',configurations:spec.configurations};
        } catch(error) { return {engine,targetType:'main',targetWeek,repository:spec.repository,branch,status:'unavailable',reason:error.message,configurations:spec.configurations}; }
      }));
      pins.push(...batch);
    }
    return pins;
  } catch(error) { return dates.map(targetWeek=>({engine,targetType:'main',targetWeek,repository:spec.repository,status:'unavailable',reason:error.message,configurations:spec.configurations})); }
}
export async function pinEngine(engine,dates){
  const spec=engineSources[engine];let releases;
  try{releases=await releaseInventory(engine);}catch(error){return dates.map(targetWeek=>({engine,targetWeek,status:'unavailable',reason:error.message,configurations:spec.configurations}));}
  return dates.map(targetWeek=>{
    const candidates=spec.provider==='node'?releases.filter(r=>+new Date(r.published_at)<=+new Date(targetWeek)):releases;
    const major=spec.provider==='node'?Math.max(...candidates.map(r=>Number(r.tag_name.split('.')[0].slice(1)))):null;
    let release;
    const eligible=spec.provider==='node'?candidates.filter(r=>Number(r.tag_name.split('.')[0].slice(1))===major):candidates;
    if(engine==='wago')release=eligible.filter(r=>r.prerelease&&/beta/i.test(r.tag_name)).filter(r=>+new Date(r.published_at)<=+new Date(targetWeek)).sort((a,b)=>+new Date(b.published_at)-+new Date(a.published_at))[0]||null;
    else if(engine==='wavm')release=eligible.filter(r=>+new Date(r.published_at)<=+new Date(targetWeek)).sort((a,b)=>+new Date(b.published_at)-+new Date(a.published_at))[0]||null;
    else release=latestRelease(eligible,targetWeek);
    return {engine,targetType:'weekly',targetWeek,repository:spec.repository,configurations:spec.configurations,...(release?{status:'planned',tag:release.tag_name,publishedAt:release.published_at,prerelease:!!release.prerelease,url:release.html_url,embeddedV8:release.embeddedV8,datePrecision:release.datePrecision || 'second'}:{status:'unavailable',reason:'No eligible release was available by this Saturday.'})};
  });
}

export async function pinEveryRelease(engine,start,end) {
  const spec=engineSources[engine];
  try {
    const releases=await releaseInventory(engine);
    const eligible=releases.filter(r=>!r.draft&&r.published_at&&+new Date(r.published_at)>=+new Date(start)&&+new Date(r.published_at)<=+new Date(end));
    const selected=engine==='wago'?eligible.filter(r=>r.prerelease&&/beta/i.test(r.tag_name)):
      engine==='wavm'?eligible:
      eligible.filter(r=>!r.prerelease&&!/nightly|snapshot|canary|(?:^|[-/])dev(?:[-/]|$)/i.test(r.tag_name));
    return selected.map(r=>({engine,targetType:'release',targetWeek:new Date(r.published_at).toISOString(),targetRelease:r.tag_name,repository:spec.repository,configurations:spec.configurations,status:'planned',tag:r.tag_name,publishedAt:r.published_at,prerelease:!!r.prerelease,url:r.html_url,embeddedV8:r.embeddedV8,datePrecision:r.datePrecision||'second'}));
  } catch(error) {
    return [{engine,targetType:'release',targetWeek:new Date(start).toISOString(),targetRelease:'',repository:spec.repository,configurations:spec.configurations,status:'unavailable',reason:error.message}];
  }
}
