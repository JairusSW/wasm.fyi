import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareCorpus } from './lib/corpus.mjs';
import { digest } from './lib/wasmbench.mjs';

async function fixture(check) {
  const directory=await mkdtemp(join(tmpdir(),'wasm-fyi-source-manifest-'));
  const settings={collection:{suite:'wago',wagoSource:'unused'},corpus:{source:'wago',ids:['tiny'],buildManifest:join(directory,'source.json'),applications:'corpora/applications/manifest.json'}};
  let imports=0;
  const run=()=>{imports++;throw Error('Binary import must not run');};
  try{await check({directory,settings,run});assert.equal(imports,0);}
  finally{await rm(directory,{recursive:true,force:true});}
}

test('source collection requires a build and never falls back to binary imports',async()=>{
  await fixture(async({directory,settings,run})=>{
    await assert.rejects(prepareCorpus(settings,run,join(directory,'prepared')),/corpus-build-all/);
  });
});

test('source collection rejects incomplete or malformed inventories',async()=>{
  await fixture(async({directory,settings,run})=>{
    for(const manifest of [[],{}]) {
      await writeFile(settings.corpus.buildManifest,JSON.stringify(manifest));
      await assert.rejects(prepareCorpus(settings,run,join(directory,'prepared')),/Incomplete source-built/);
    }
  });
});

test('source collection uses the compiled artifact and rejects digest drift',async()=>{
  await fixture(async({directory,settings,run})=>{
    const artifact=join(directory,'tiny.wasm'),bytes=Buffer.from('0061736d01000000','hex');
    await writeFile(artifact,bytes);
    await writeFile(settings.corpus.buildManifest,JSON.stringify([{id:'wago/tiny/source',artifact,sha256:digest(bytes)}]));
    const output=await prepareCorpus(settings,run,join(directory,'prepared'));
    const workloads=JSON.parse(await readFile(output));
    assert.equal(workloads[0].artifact,artifact);
    assert.equal(workloads.length,103);
    await writeFile(artifact,Buffer.concat([bytes,Buffer.from([0])]));
    await assert.rejects(prepareCorpus(settings,run,join(directory,'drift')),/digest mismatch/);
  });
});
