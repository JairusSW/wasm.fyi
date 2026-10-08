import {test} from 'node:test';
import assert from 'node:assert/strict';
import {memoryObserver} from './lib/memory-observers.mjs';
test('C AOT compile RSS requires an actual tree mean, with no peak or parent-only fallback',()=>{
 for(const rt of ['wasm2c-gcc','w2c2-gcc','wasm2c-clang']) assert.equal(memoryObserver(rt,'rssCurrentCompile'),'process_tree.rss.mean');
 assert.equal(memoryObserver('wasm2c-gcc','rssCompile'),'process.peak_rss');
 assert.equal(memoryObserver('w2c2-gcc','rssCurrent'),'process.rss');
 assert.equal(memoryObserver('wago','rssCurrentCompile'),'process.rss');
});
