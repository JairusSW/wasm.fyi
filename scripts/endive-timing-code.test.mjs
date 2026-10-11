import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withEndiveTimingCodeSize} from './lib/endive-timing-code.mjs';
import {endiveAdapterSource} from './lib/endive-sdk.mjs';

test('SDK builder pins the version and enables timing code capture only for Redline',()=>{
 const source=readFileSync(new URL('../adapters/qualification/EndiveAdapter.java',import.meta.url),'utf8');
 const version='qualified-source-revision';
 const pinned=source.replaceAll('3c6d9cbdc9e96671f2526604d95ecd4ecfaf374c',version);
 assert.equal(endiveAdapterSource(source,version,'endive-redline'),withEndiveTimingCodeSize(pinned));
 for(const configuration of ['endive-interpreter','endive-jit'])assert.equal(endiveAdapterSource(source,version,configuration),pinned);
});

test('native size reuses the timed Redline module after the timer, without adding compile calls',()=>{
 const source=readFileSync(new URL('../adapters/qualification/EndiveAdapter.java',import.meta.url),'utf8');
 const updated=withEndiveTimingCodeSize(source);
 const timer='long start=System.nanoTime();module=compile(bytes);elapsed=System.nanoTime()-start;';
 assert(updated.includes(timer));
 assert.equal(updated.split('compile(bytes)').length,source.split('compile(bytes)').length);
 assert(updated.indexOf(timer)<updated.indexOf('Object code=nativeCode.get(module);'));
 assert(updated.indexOf('Object code=nativeCode.get(module);')<updated.indexOf('nativeCode.remove(module);'));
 assert(updated.includes('redline&&scenario.equals("compile")&&index==0&&warmup==0&&preparation.getString("profile").equals("timing")'));
 assert(updated.includes('.put("profile",preparation.getString("profile")).put("quality","engine_reported")'));
 assert.equal(withEndiveTimingCodeSize(updated),updated);
});
test('native observation transform rejects drift without silently moving the latency timer',()=>{
 assert.throws(()=>withEndiveTimingCodeSize('changed source'),/observation block changed/);
 const source=readFileSync(new URL('../adapters/qualification/EndiveAdapter.java',import.meta.url),'utf8');
 const partial=withEndiveTimingCodeSize(source).replace('.put("profile",preparation.getString("profile")).put("quality","engine_reported")','.put("profile","code").put("quality","engine_reported")');
 assert.throws(()=>withEndiveTimingCodeSize(partial),/observation profile changed/);
});
