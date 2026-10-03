import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fixtures,featureIds} from '../corpora/features/generator.mjs';
import {digest,site,config,exists} from './lib/wasmbench.mjs';

test('checked-in feature artifacts and provenance cover every declared family',async()=>{
  const manifest=JSON.parse(await readFile(join(site,'corpora/features/manifest.json'),'utf8'));
  const build=JSON.parse(await readFile(join(site,'corpora/features/build.json'),'utf8'));
  const ui=await readFile(join(site,'src/lib/data/features.ts'),'utf8');
  const displayed=[...new Set([...ui.matchAll(/\bid: '([^']+)'/g)].map(match=>match[1]))];
  assert.deepEqual([...featureIds].sort(),displayed.sort(),'Feature corpus no longer matches displayed families');
  assert.deepEqual(build.missingFeatures,[]);assert.equal(build.recipes.length,fixtures().length);
  assert.equal(manifest.length,fixtures().reduce((n,f)=>n+f.sizes.length,0));
  for(const feature of featureIds)assert(manifest.some(w=>w.features.includes(feature)&&!w.provenance.baseline),`Missing actual ${feature} workload`);
  const generated = new Map(fixtures().map(f=>[`${f.feature}-${f.name}`,f]));
  for(const recipe of build.recipes) {
    const fixture=generated.get(`${recipe.feature}-${recipe.variant}`);
    assert.equal(await readFile(join(site,'corpora/features',recipe.source),'utf8'),fixture.wat.trim()+'\n','Stale generated feature source');
    for(const size of fixture.sizes) {
      const workload=manifest.find(w=>w.id===`features/${fixture.feature}/${fixture.name}/${size}`);
      assert(workload,'Missing generated workload contract');
      assert.equal(workload.sha256,recipe.sha256);
      const oracle=fixture.oracle?fixture.oracle(size):{kind:'exact_u64',expected:[fixture.abi==='component'?String(fixture.expected(size)):fixture.expected(size)]};
      assert.deepEqual(workload.oracle,oracle,'Stale generated feature oracle');
    }
    assert.equal(digest(await readFile(join(site,'corpora/features',recipe.source))),recipe.sourceSha256);
    assert.equal(digest(await readFile(join(site,'corpora/features',recipe.artifact))),recipe.sha256);
  }
});

test('independent admission rejects malformed input',async(context)=>{
  const settings=await config();const root=resolve(site,process.env.WASMBENCH_ROOT || settings.root);
  const analyzer=join(root,'adapters/wasmtime/target/release/wasm-analyze');
  if(!await exists(analyzer)) {
    assert.notEqual(process.env.WASMBENCH_REQUIRE_ADAPTER_TESTS,'1','Build the independent analyzer before running feature admission tests');
    context.skip('Independent analyzer is exercised on the measurement runner');return;
  }
  const directory=await mkdtemp(join(tmpdir(),'wasm-fyi-invalid-feature-'));
  try {const path=join(directory,'invalid.wasm');await writeFile(path,Buffer.from('0061736d010000000104016000','hex'));assert.notEqual(spawnSync(analyzer,[path,'all']).status,0);}finally{await rm(directory,{recursive:true,force:true});}
});
