// Bundled after the normal SvelteKit build. No compiler or npm tree is needed
// on the server: run this frozen renderer only when publications change.
import {Server} from '../.svelte-kit/output/server/index.js';
import {manifest} from '../.svelte-kit/output/server/manifest-homepage.js';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const directory=resolve(process.argv[2]||'build');
const api=process.env.WASMFYI_PRERENDER_API_ORIGIN||'http://127.0.0.1:8090';
const initial=await fetch(new URL('/api/summary',api));if(!initial.ok)throw Error('Homepage summary unavailable');
const revision=(await initial.json()).revision;
manifest._.prerendered_routes.clear();
const server=new Server(manifest);
await server.init({env:{...process.env,WASMFYI_PRERENDER_API_ORIGIN:api},read:file=>readFile(join(directory,file))});
const render=async path=>{
 const response=await server.respond(new Request('https://wasm.fyi'+path),{getClientAddress:()=> '127.0.0.1'});
 if(response.status!==200)throw Error(`Homepage render ${path}: ${response.status}`);
 return response.text();
};
const html=await render('/'),data=await render('/__data.json');
if(!html.includes('Leaderboard')||!html.includes('Proposals')||!html.includes('timing samples captured')||html.includes('<li class="empty">Loading'))throw Error('Incomplete homepage render');
JSON.parse(data);
const files=[['__data.json',data],['index.html',html],['homepage-revision.json',JSON.stringify({schema:1,revision,generatedAt:new Date().toISOString()})]];
try{
 for(const [name,body] of files)await writeFile(join(directory,name+'.next'),body,{mode:0o644});
 for(const [name] of files)await rename(join(directory,name+'.next'),join(directory,name));
}finally{for(const [name] of files)await rm(join(directory,name+'.next'),{force:true})}
console.log(JSON.stringify({revision,htmlBytes:Buffer.byteLength(html),dataBytes:Buffer.byteLength(data)}));
