import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeBakedSeed} from '../src/lib/api/baked-codec.ts';

const routes=['/','/benchmarks','/features','/history','/health','/compare','/simd','/gc','/memory64','/threads'];
export async function verifyBakedPages(directory){
 const root=directory instanceof URL?fileURLToPath(directory):resolve(directory);
 const manifest=JSON.parse(await readFile(resolve(root,'baked-pages.json'),'utf8'));
 assert.equal(manifest.schema,1,'Missing baked-page manifest schema');
 assert.deepEqual([...manifest.routes].sort(),[...routes].sort(),'Incomplete baked-page manifest');
 for(const route of routes){
  const page=resolve(root,route.slice(1));
  const html=await readFile(resolve(page,'index.html'),'utf8');
  assert(Buffer.byteLength(html)<=32*1024*1024,`Baked page exceeds host byte limit: ${route}`);
  const data=JSON.parse(await readFile(resolve(page,'__data.json'),'utf8'));
  const encoded=data.nodes.filter(Boolean).flatMap(node=>node.data||[]).find(value=>typeof value==='string'&&value.startsWith('{"root":'));
  assert(encoded,`Missing baked snapshot: ${route}`);
  const seed=decodeBakedSeed(encoded);
  assert.equal(seed.schema,2,`Invalid snapshot schema: ${route}`);
  assert(seed.revision&&seed.revision===seed.summary.revision,`Invalid snapshot revision: ${route}`);
  assert.equal(seed.path.replace(/\/$/,'')||'/',route,`Snapshot belongs to a different route: ${route}`);
  assert(seed.view.hosts[seed.machine],`Missing snapshot machine: ${route}`);
  if(route==='/benchmarks')for(const workload of seed.view.catalogue.filter(row=>!row.id.startsWith('features/'))){
   const path='/bench/'+encodeURI(workload.id).replace(/[?#]/g,encodeURIComponent);
   assert(html.includes(path),`Workload missing from baked HTML: ${workload.id}`);
  }
 }
 for(const view of ['features','history'])for(const machine of ['m1','m2','m3']){
  const encoded=JSON.parse(await readFile(resolve(root,`data/startup/${view}/${machine}.json`),'utf8'));
  const seed=decodeBakedSeed(encoded);
  assert.equal(seed.machine,machine,`Invalid startup machine: ${view}/${machine}`);
  assert.equal(seed.path,`/${view}/`,`Invalid startup view: ${view}/${machine}`);
  assert(seed.revision&&seed.revision===seed.summary.revision,`Invalid startup revision: ${view}/${machine}`);
  if(view==='history'){
   assert(seed.history,`Missing initial history: ${machine}`);
   const query=new URLSearchParams(seed.history.query);
   const hosts=query.get('platforms').split(',').map(id=>seed.summary.platforms.find(p=>p.id===id));
   assert(hosts.every(host=>host&&['os','arch','cpu','cores'].every(key=>host[key]===hosts[0][key])),`Incompatible history hosts: ${machine}`);
  }
 }
 console.log(`Verified baked HTML and snapshots for ${routes.length} public routes.`);
 console.log('Verified Features and History startup snapshots for all three machines.');
}
