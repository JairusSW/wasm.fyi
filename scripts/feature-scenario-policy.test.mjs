import{test}from'node:test';import assert from'node:assert/strict';import{featureScenarios}from'./lib/feature-scenario-policy.mjs';
test('compatibility executes once while performance and lifecycle retain all phases',()=>{assert.equal(featureScenarios('compatibility',{}),'first-call');for(const stage of['performance','lifecycle'])assert.equal(featureScenarios(stage,{}),'compile,instantiate,first-call,steady');assert.equal(featureScenarios('compile',{}),'compile');assert.equal(featureScenarios('compile',{provenance:{scope:'compile-and-instantiate'}}),'compile,instantiate');});
test('explicit failed-phase repair preserves original phase scope',()=>assert.equal(featureScenarios('compatibility',{},['compile','instantiate']),'compile,instantiate'));
test('non-executable correctness probes test their declared admission stage',()=>{
 assert.equal(featureScenarios('compatibility',{provenance:{scope:'compile-only'}}),'compile');
 assert.equal(featureScenarios('compatibility',{provenance:{scope:'compile-and-instantiate'}}),'instantiate');
});
