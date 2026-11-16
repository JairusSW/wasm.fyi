// Bundles the publication baker: a frozen SvelteKit server limited to the pages
// and startup snapshots that are re-rendered whenever new results are published.
import {build} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const full=resolve('.svelte-kit/output/server/manifest-full.js');
const {manifest}=await import(pathToFileURL(full));
const text=await readFile(full,'utf8');
const BAKED=['/','/benchmarks','/features','/history','/data/startup/[view]/[machine].json'];
const nodeBlock=text.slice(text.indexOf('nodes: ['),text.indexOf('remotes:'));
const nodeFiles=[...nodeBlock.matchAll(/__memo\(\(\) => import\('(.+?)'\)\)/g)].map(m=>m[1]);
const endpointFile=id=>{
 const at=text.indexOf(`id: ${JSON.stringify(id)}`);
 const block=text.slice(at,text.indexOf('}',text.indexOf('endpoint:',at))+1);
 return block.match(/endpoint: __memo\(\(\) => import\('(.+?)'\)\)/)?.[1]??null;
};
const routes=BAKED.map(id=>{const route=manifest._.routes.find(r=>r.id===id);if(!route)throw Error('Missing baked route '+id);return route});
const indexes=[...new Set(routes.flatMap(r=>r.page?[...r.page.layouts,...r.page.errors,r.page.leaf]:[]).filter(n=>n!=null))];
const remap=n=>n==null?null:indexes.indexOf(n);
const routeSource=routes.map(r=>{
 const endpoint=endpointFile(r.id);
 if(!r.page&&!endpoint)throw Error('Missing endpoint for '+r.id);
 return `{id:${JSON.stringify(r.id)},pattern:${r.pattern},params:${JSON.stringify(r.params)},page:${r.page?JSON.stringify({layouts:r.page.layouts.map(remap),errors:r.page.errors.map(remap),leaf:remap(r.page.leaf)}):'null'},endpoint:${endpoint?`()=>import(${JSON.stringify(endpoint)})`:'null'}}`;
}).join(',');
const source=`export const manifest={appDir:${JSON.stringify(manifest.appDir)},appPath:${JSON.stringify(manifest.appPath)},assets:new Set(${JSON.stringify([...manifest.assets])}),mimeTypes:${JSON.stringify(manifest.mimeTypes)},_:{client:${JSON.stringify(manifest._.client)},nodes:[${indexes.map(i=>`()=>import(${JSON.stringify(nodeFiles[i])})`).join(',')}],remotes:{},routes:[${routeSource}],prerendered_routes:new Set(),matchers:async()=>({}),server_assets:{}}};`;
await writeFile(resolve('.svelte-kit/output/server/manifest-homepage.js'),source);
await build({configFile:false,publicDir:false,logLevel:'warn',ssr:{noExternal:true},build:{ssr:resolve('scripts/render-homepage-entry.mjs'),outDir:resolve('.wasmfyi/homepage-renderer'),emptyOutDir:true,minify:true,rolldownOptions:{output:{entryFileNames:'homepage-baker.mjs',codeSplitting:false}}}});
