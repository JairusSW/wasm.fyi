// Retain the selected upstream build inputs, without copying prebuilt modules.
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { config, site, command, digest } from './lib/wasmbench.mjs';
const settings=await config();
const source=resolve(site,process.env.WAGO_SOURCE || settings.collection.wagoSource);
const root=join(site,'corpora/upstream/wago');
const catalog=JSON.parse(await readFile(join(source,'corpus/catalog.json')));
const selected=catalog.benchmarks.filter(b=>settings.corpus.ids.includes(b.id));
const directories=new Set(['corpus/sources','corpus/build','corpus/workloads/semantic/shared']);
for(const b of selected)if(b.artifact.startsWith('workloads/semantic/')||b.artifact.startsWith('workloads/applications/'))directories.add('corpus/'+dirname(b.artifact));
const files=[];
async function copyTree(part) {
  for(const entry of await readdir(join(source,part),{withFileTypes:true})) {
    const path=join(part,entry.name);
    if(entry.isDirectory())await copyTree(path);
    else if(entry.isFile()&&!entry.name.endsWith('.wasm')&&entry.name!=='applications.sh') {
      const dest=join(root,path);await mkdir(dirname(dest),{recursive:true});await copyFile(join(source,path),dest);
      files.push({path,sha256:digest(await readFile(dest))});
    }
  }
}
for(const part of directories)await copyTree(part);
await copyFile(join(source,'LICENSE'),join(root,'LICENSE'));
files.push({path:'LICENSE',sha256:digest(await readFile(join(root,'LICENSE')))});
const lock={schema:1,repository:'https://github.com/wago-org/wago',revision:command('git',['rev-parse','HEAD'],{cwd:source}).toString().trim(),
  upstreamCatalogSha256:digest(await readFile(join(source,'corpus/catalog.json'))),
  policy:'Selected wrappers, original WAT/Rust/AssemblyScript sources, fixtures, licenses and pinned upstream build/fetch recipes. Dependencies are fetched at the revisions in the recipes. Fetch-only release binaries are explicitly listed; these recipes do not constitute a rebuild from source.',
  benchmarks:selected.map(b=>({id:b.id,artifact:b.artifact,source:b.source || null,license:b.source?.license || 'see retained provenance',recipe:b.artifact.startsWith('workloads/semantic/')||b.artifact.startsWith('workloads/applications/')?'corpus/'+dirname(b.artifact)+'/build.sh':b.artifact.includes('/polybench/')?'corpus/build/polybench.sh':b.artifact.includes('/assemblyscript/')?'corpus/build/assemblyscript.sh':b.artifact.includes('/synthetic/')||b.id==='linked_list'?'corpus/build/wat.sh':'corpus/build/rust.sh'})),
  files:files.sort((a,b)=>a.path.localeCompare(b.path))};
const commandBuilds=new Set(['tree-list','brotli-compress','jq-json-transform','age-keygen-public','xzdec-decompress','sqlite3-query','quickjs-script','esbuild-minify']);
for(const b of lock.benchmarks) {
  if(!files.some(f=>f.path===b.recipe)) {
    const fetch=b.recipe.replace(/build.sh$/,'fetch.sh');
    b.recipe=files.some(f=>f.path===fetch)?fetch:null;
  }
  b.workflow=!b.recipe?'release-artifact-only':b.artifact.startsWith('workloads/applications/')&&!commandBuilds.has(b.id)?'fetch-or-transform':'source-build';
}
await writeFile(join(site,'corpora/upstream/sources.json'),JSON.stringify(lock,null,2)+'\n');
console.log(`Retained ${files.length} source/build/fixture/license files for ${selected.length} selected upstream benchmarks at ${relative(site,root)}`);
