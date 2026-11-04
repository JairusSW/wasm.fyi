import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,isAbsolute,basename} from 'node:path';
import {createHash} from 'node:crypto';
const [corpusArg,performanceArg,outputArg]=process.argv.slice(2),corpus=resolve(corpusArg),performance=resolve(performanceArg),output=resolve(outputArg);
const digest=data=>createHash('sha256').update(data).digest('hex');
const read=async p=>JSON.parse(await readFile(p));
const compatibility=await read(join(corpus,'manifest.json')),originals=new Map(compatibility.map(w=>[w.id,w]));
const suites={compatibility:[corpus,compatibility],performance:[performance,await read(join(performance,'manifest.json'))],compile:[performance,await read(join(performance,'compile-probes.json'))],lifecycle:[performance,await read(join(performance,'lifecycle-probes.json'))]};
await mkdir(join(output,'artifacts'),{recursive:true});await mkdir(join(output,'sources'),{recursive:true});
const retain=async(path,sha,kind)=>{const bytes=await readFile(path);if(digest(bytes)!==sha)throw Error('Artifact differs: '+path);const relative=kind+'/'+sha+(kind==='artifacts'?'.wasm':'.wat');await writeFile(join(output,relative),bytes);return relative;};
const counts={};
for(const [kind,[root,rows]] of Object.entries(suites)){
 const packed=[];
 for(const item of rows){
  const w=structuredClone(item),recipe=w.provenance?.recipe;
  w.artifact=await retain(isAbsolute(w.artifact)?w.artifact:join(root,w.artifact),w.sha256,'artifacts');
  if(kind==='performance'){
   const id=w.id.split('/').slice(0,3).join('/')+'/'+w.provenance.performancePolicy.originalSize;
   if(originals.get(id)?.sha256!==recipe.originalArtifactSha256)throw Error('Stale performance workload: '+id);
  }
  if(w.source){let path=isAbsolute(w.source)?w.source:join(root,w.source);try{await readFile(path)}catch{path=join(corpus,w.source)}w.source=await retain(path,recipe.sourceSha256,'sources');}
  packed.push(w);
 }
 await writeFile(join(output,kind+'.json'),JSON.stringify(packed)+'\n');counts[kind]=packed.length;
}
await writeFile(join(output,'identity.json'),JSON.stringify({counts},null,2)+'\n');console.log(JSON.stringify(counts));
