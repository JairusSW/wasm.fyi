import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {brotliCompressSync} from 'node:zlib';
import {siteUrl} from './lib/ai-metadata.mjs';

const root=join(process.cwd(),'build');
const names=await readdir(root);
for(const name of names)assert(!['wasmbench','data'].includes(name)&&!name.includes('.previous-')&&!name.startsWith('.static-data-'),'Frontend build contains a measurement dataset or private backup');
async function files(directory){const output=[];for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())output.push(...await files(path));else output.push(path)}return output}
const paths=await files(root),html=paths.filter(p=>p.endsWith('.html'));
assert(names.includes('404.html'),'Missing application shell for newly imported workloads');
assert(names.includes('index.html'),'Missing homepage shell');
for(const path of html){const body=await readFile(path,'utf8');assert(!/<h1[^>]*>500<\/h1>|500 Internal Error/.test(body),`Prerender error: ${path}`);if(path.endsWith('/404.html'))continue;assert(body.includes('/api/v1/manifest'),`Missing API discovery link: ${path}`);const canonical=/<link rel="canonical" href="([^"]+)"/.exec(body)?.[1];assert.equal(canonical,siteUrl(relative(root,path).replace(/index\.html$/,''),process.env.BASE_PATH||''),`Wrong canonical URL: ${path}`)}
const sitemap=await readFile(join(root,'sitemap.xml'),'utf8'),publicRoot=siteUrl('',process.env.BASE_PATH||'');
for(const [,link] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)){assert(link.startsWith(publicRoot),'Sitemap leaves configured public root');assert((await stat(join(root,link.slice(publicRoot.length),'index.html'))).isFile(),`Missing sitemap page: ${link}`)}
for(const name of ['llms.txt','llms-full.txt'])assert((await readFile(join(root,name),'utf8')).includes('/api/v1/manifest'),'Machine-readable reference must resolve the API revision');
let largest=0;
for(const path of paths.filter(p=>p.endsWith('.js'))){const body=await readFile(path);assert(!body.includes(Buffer.from('indexed-cells-v1')),'Legacy measurement corpus found in client JavaScript');largest=Math.max(largest,brotliCompressSync(body).length)}
assert(largest<=200*1024,`Client chunk exceeds compressed build budget: ${largest}`);
console.log(`Verified ${html.length} application pages, no bundled measurements, largest compressed JavaScript chunk ${largest} bytes.`);
