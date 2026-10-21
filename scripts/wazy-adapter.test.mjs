import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptWazyComponents,adaptWazyCoreFeatures} from './lib/wazy-adapter.mjs';

const adapter='WithCoreFeatures(api.CoreFeaturesV3|experimental.CoreFeaturesThreads)';
test('historical Wazy releases use their declared WebAssembly 2 feature set plus threads',()=>{
 const old=adaptWazyCoreFeatures(adapter,'const CoreFeaturesV2 = CoreFeaturesV1');
 assert.equal(old.policy,'core-features-v2-plus-threads');
 assert.equal(old.source,'WithCoreFeatures(api.CoreFeaturesV2|experimental.CoreFeaturesThreads)');
 const current=adaptWazyCoreFeatures(adapter,'const CoreFeaturesV3 = CoreFeaturesV2');
 assert.deepEqual(current,{source:adapter,policy:'core-features-v3'});
 assert.throws(()=>adaptWazyCoreFeatures(adapter,'const CoreFeaturesV1 = 1'),/neither CoreFeaturesV2 nor CoreFeaturesV3/);
});

test('Wazy sources predating the component package retain the core adapter',()=>{
 const source='\t"github.com/samyfodil/wazy/component"\nABIs: []string{"core", "component"}\nif !ok || (w.ABI != "core" && w.ABI != "component") || !slices.Contains([]string{"exact_u64", "exact_vectors", "component_compile_only"}, kind) {}\n\t\tif w.ABI == "component" {\ncomponent.Call()\n\t\t}\n\t\tif w.Oracle.Kind == "exact_vectors" {\ncore()\n';
 const old=adaptWazyComponents(source,false);
 assert.equal(old.policy,'core-only-component-package-unavailable');assert.doesNotMatch(old.source,/component\.Call|wazy\/component|"component"/);assert.match(old.source,/exact_vectors/);
 assert.deepEqual(adaptWazyComponents(source,true),{source,policy:'component-enabled'});
});
