// Bundled after the normal SvelteKit build. No compiler or npm tree is needed
// on the server: run this frozen renderer only when publications change. It
// re-bakes the homepage, Benchmarks, Features and History with their startup
// snapshots so visitors load the current publication without API requests.
import {Server} from '../.svelte-kit/output/server/index.js';
import {manifest} from '../.svelte-kit/output/server/manifest-homepage.js';
import {readFile,writeFile,rename,rm,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
const directory=resolve(process.argv[2]||'build');
const api=process.env.WASMFYI_PRERENDER_API_ORIGIN||'http://127.0.0.1:8090';
const nativeFetch=globalThis.fetch;
// Direct loopback API traffic must satisfy the same trusted-proxy contract as Caddy.
globalThis.fetch=(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 if(url.origin===new URL(api).origin&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)){
  const headers=new Headers(input instanceof Request?input.headers:undefined);
  new Headers(init?.headers).forEach((value,key)=>headers.set(key,value));headers.set('X-Real-IP','127.0.0.1');
  return nativeFetch(input,{...init,headers});
 }
 return nativeFetch(input,init);
};
const initial=await fetch(new URL('/api/summary',api));if(!initial.ok)throw Error('Homepage summary unavailable');
const revision=(await initial.json()).revision;
manifest._.prerendered_routes.clear();
const server=new Server(manifest);
await server.init({env:{...process.env,WASMFYI_PRERENDER_API_ORIGIN:api,WASMFYI_STATIC_BAKER:'1'},read:file=>readFile(join(directory,file))});
const render=async path=>{
 const response=await server.respond(new Request('https://wasm.fyi'+path),{getClientAddress:()=> '127.0.0.1'});
 if(response.status!==200)throw Error(`Render ${path}: ${response.status}`);
 return response.text();
};
// Each render bakes from shared module state, so pages render one at a time.
const files=[];
const home=await render('/'),homeData=await render('/__data.json');
if(!home.includes('Leaderboard')||!home.includes('Proposals')||!home.includes('timing samples captured')||home.includes('<li class="empty">Loading'))throw Error('Incomplete homepage render');
JSON.parse(homeData);
files.push(['index.html',home],['__data.json',homeData]);
// Benchmarks, Features and History open from a snapshot of the current
// publication, and switch machines from baked startup snapshots.
for(const view of ['benchmarks','features','history']){
 const html=await render(`/${view}/`),data=await render(`/${view}/__data.json`);
 const seed=JSON.parse(data).nodes.filter(Boolean).flatMap(node=>node.data||[]).find(value=>typeof value==='string'&&value.startsWith('{"root":'));
 if(!seed||Buffer.byteLength(html)>32*1024*1024)throw Error(`Incomplete ${view} render`);
 files.push([`${view}/index.html`,html],[`${view}/__data.json`,data]);
  // Pages baked for the other machines; the host serves them by ?m= or by the
  // visitor's platform, so first paint already shows that machine's results.
  for(const machine of ['m2','m3']){
   const response=await server.respond(new Request(`https://wasm.fyi/${view}/?m=${machine}`),{getClientAddress:()=> '127.0.0.1'});
   if(response.status!==200)continue;
   const variant=await response.text(),variantData=await render(`/${view}/__data.json?m=${machine}`);
   const variantSeed=JSON.parse(variantData).nodes.filter(Boolean).flatMap(node=>node.data||[]).find(value=>typeof value==='string'&&value.startsWith('{"root":'));
   if(!variantSeed||Buffer.byteLength(variant)>32*1024*1024)throw Error(`Incomplete ${view} render for ${machine}`);
   files.push([`${view}/index.${machine}.html`,variant],[`${view}/__data.${machine}.json`,variantData]);
  }
 for(const machine of ['m1','m2','m3']){
  const response=await server.respond(new Request(`https://wasm.fyi/data/startup/${view}/${machine}.json`),{getClientAddress:()=> '127.0.0.1'});
  // A machine without published results keeps no startup snapshot.
  if(response.status===404)continue;
  if(response.status!==200)throw Error(`Startup snapshot ${view}/${machine}: ${response.status}`);
  files.push([`data/startup/${view}/${machine}.json`,await response.text()]);
 }
}
files.push(['homepage-revision.json',JSON.stringify({schema:1,revision,generatedAt:new Date().toISOString()})]);
try{
 for(const [name,body] of files){await mkdir(dirname(join(directory,name)),{recursive:true});await writeFile(join(directory,name+'.next'),body,{mode:0o644})}
 for(const [name] of files)await rename(join(directory,name+'.next'),join(directory,name));
}finally{for(const [name] of files)await rm(join(directory,name+'.next'),{force:true})}
console.log(JSON.stringify({revision,files:files.length,bytes:files.reduce((n,[,body])=>n+Buffer.byteLength(body),0)}));
