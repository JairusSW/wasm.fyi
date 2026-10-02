import {command} from './wasmbench.mjs';
import {latestRelease} from './release-policy.mjs';
export const engineSources={
  wago:{repository:'wago-org/wago',configurations:['wago']},
  wazero:{repository:'tetratelabs/wazero',configurations:['wazero']},
  wasmtime:{repository:'bytecodealliance/wasmtime',configurations:['wasmtime','wasmtime-winch','wasmtime-component-async']},
  wasmer:{repository:'wasmerio/wasmer',configurations:['wasmer-llvm','wasmer-singlepass']},
  v8:{repository:'nodejs/node',provider:'node',configurations:['v8-optimizing-only','v8-liftoff-only','v8-wasmfx']},
  wasmi:{repository:'wasmi-labs/wasmi',configurations:['wasmi']},
  wasmedge:{repository:'WasmEdge/WasmEdge',configurations:['wasmedge']},
  wamr:{repository:'bytecodealliance/wasm-micro-runtime',configurations:['wamr']},
  wasm3:{repository:'wasm3/wasm3',configurations:['wasm3']},
  chicory:{repository:'dylibso/chicory',configurations:['chicory']},
  spidermonkey:{repository:'mozilla-firefox/firefox',provider:'firefox',configurations:['spidermonkey']},
  jsc:{repository:'WebKit/WebKit',provider:'unavailable',configurations:['jsc'],platforms:['darwin']},
  wavm:{repository:'WAVM/WAVM',configurations:['wavm'],platforms:['darwin']},
  deno:{repository:'denoland/deno',configurations:['deno']}
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
    const rows=JSON.parse(command('curl',['--fail','--silent','--show-error','https://product-details.mozilla.org/1.0/firefox_history_major_releases.json']).toString());
    return Object.entries(rows).map(([version,date])=>({tag_name:version,published_at:date+'T00:00:00Z',draft:false,prerelease:false,html_url:'https://archive.mozilla.org/pub/firefox/releases/'+version+'/',datePrecision:'day'}));
  }
  return JSON.parse(command('gh',['api','--paginate',`repos/${spec.repository}/releases?per_page=100`,'--slurp']).toString()).flat();
}
export async function pinEngine(engine,dates){
  const spec=engineSources[engine];let releases;
  try{releases=await releaseInventory(engine);}catch(error){return dates.map(targetWeek=>({engine,targetWeek,status:'unavailable',reason:error.message,configurations:spec.configurations}));}
  return dates.map(targetWeek=>{
    const candidates=spec.provider==='node'?releases.filter(r=>+new Date(r.published_at)<=+new Date(targetWeek)):releases;
    const major=spec.provider==='node'?Math.max(...candidates.map(r=>Number(r.tag_name.split('.')[0].slice(1)))):null;
    const release=latestRelease(spec.provider==='node'?candidates.filter(r=>Number(r.tag_name.split('.')[0].slice(1))===major):candidates,targetWeek);
    return {engine,targetWeek,repository:spec.repository,configurations:spec.configurations,...(release?{status:'planned',tag:release.tag_name,publishedAt:release.published_at,prerelease:!!release.prerelease,url:release.html_url,embeddedV8:release.embeddedV8,datePrecision:release.datePrecision || 'second'}:{status:'unavailable',reason:'No published non-development release was available by this Wednesday.'})};
  });
}
