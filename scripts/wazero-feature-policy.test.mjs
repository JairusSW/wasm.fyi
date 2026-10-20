import test from 'node:test';
import assert from 'node:assert/strict';
import {wazeroFeaturePolicySources} from './lib/wazero-feature-policy.mjs';

test('composes feature enablement with close-on-context and cache settings',()=>{
 const input={
  features:'package main\nimport "github.com/wasmbench/wasmbench/protocol"\nEvidence:  "old"\n// These experimental bits are excluded from CoreFeaturesV2. This is\n// deliberately not a blanket declaration about every validator flag.\n"THREADS": false, "TAIL_CALL": false, "EXTENDED_CONST": false,\n"EXCEPTIONS": false, "FUNCTION_REFERENCES": false,',
  main:'c.WithCoreFeatures(api.CoreFeaturesV2).WithCloseOnContextDone(true)',
  nativeCode:'c.WithCoreFeatures(api.CoreFeaturesV2).WithCloseOnContextDone(true).WithCompilationCache(cache)',
  hosts:'switch profile { case "identity-v1": return nil }'
 };
 const out=wazeroFeaturePolicySources(input);
 assert.match(out.features,/CoreFeaturesTypedFunctionReferences/);
 assert.match(out.features,/"THREADS": true/);
 assert.match(out.main,/WithCoreFeatures\(enabledCoreFeatures\)/);
 assert.doesNotMatch(out.main,/WithCloseOnContextDone/);
 assert.match(out.nativeCode,/WithCoreFeatures\(enabledCoreFeatures\).*WithCompilationCache/);
 assert.doesNotMatch(out.nativeCode,/WithCloseOnContextDone/);
 assert.match(out.hosts,/threads-identity-v1/);
 assert.match(out.hosts,/threads-opaque-identity-v1/);
});

test('drops the api import when feature configuration was its only use',()=>{
 const input={
  features:'package main\nimport "github.com/wasmbench/wasmbench/protocol"\nEvidence:  "old"\n"THREADS": false, "TAIL_CALL": false, "EXTENDED_CONST": false,\n"EXCEPTIONS": false, "FUNCTION_REFERENCES": false,',
  main:'c.WithCoreFeatures(api.CoreFeaturesV2)',
  nativeCode:'import (\n\t"github.com/tetratelabs/wazero/api"\n)\nc.WithCoreFeatures(api.CoreFeaturesV2)',
  hosts:'case "identity-v1":'
 };
 const out=wazeroFeaturePolicySources(input);
 assert.doesNotMatch(out.nativeCode,/wazero\/api/);
});
