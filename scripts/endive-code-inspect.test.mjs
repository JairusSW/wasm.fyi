import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {withEndiveCodeInspection} from './lib/endive-code-inspect.mjs';
const source=await readFile(new URL('../adapters/qualification/EndiveAdapter.java',import.meta.url),'utf8');
test('inspection reuses the existing verified code compile and preserves every run implementation byte',()=>{
 const after=withEndiveCodeInspection(source),run='      case "run":{';
 assert.equal(after.slice(after.indexOf(run)),source.slice(source.indexOf(run)));
 assert.match(after,/redline&&preparation!=null&&preparation\.getString\("profile"\)\.equals\("code"\)/);
 assert.match(after,/getString\("abi"\)\.equals\("core"\)/);
 assert.match(after,/\.put\("scenario","compile"\)\.put\("samples",1\)\.put\("operations",1\)\.put\("warmup",0\)/);
 assert.match(after,/samples\.length\(\)==1&&samples\.getJSONObject\(0\)\.getBoolean\("verified"\)/);
 assert.match(after,/if\(redline\)\{description\.getJSONObject\("capabilities"\)/);
 assert.equal(withEndiveCodeInspection(after),after);
});
test('changed or partial inspection bindings fail closed',()=>{
 assert.throws(()=>withEndiveCodeInspection(source.replace('      case "run":{','      case "run": {')));
 assert.throws(()=>withEndiveCodeInspection(source.replace('      case "run":{','      case "inspect":{')));
 assert.throws(()=>withEndiveCodeInspection(withEndiveCodeInspection(source).replace('.put("can_code_profile",true)','')));
});
