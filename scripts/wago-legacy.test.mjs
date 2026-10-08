import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {legacyIdentityImports} from './lib/wago-legacy.mjs';
test('adapts the actual typed identity helper to historical slot imports',async()=>{
 const source=await readFile(new URL('../../../Tools/wasm-bench/adapters/wago/main.go',import.meta.url),'utf8');
 const adapted=legacyIdentityImports(source);
 assert.match(adapted,/"wasmbench.identity":\s*wago\.HostFunc/);
 assert.match(adapted,/r\[0\] = p\[0\]/);
 assert.doesNotMatch(adapted.slice(adapted.indexOf('func identityImports')),/NewImports/);
});
