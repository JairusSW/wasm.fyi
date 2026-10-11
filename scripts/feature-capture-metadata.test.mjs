import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeFeatureCaptureMetadata} from './lib/feature-capture-metadata.mjs';
test('memory repair preserves literal sample numbers and timestamps',()=>{
 for(const memory of ['',',"memoryBytes":0']){
  const raw=Buffer.from('{"capturedAt":"original","platform":{"os":"linux"'+memory+'},"results":[{"workload":"features/test","samplesNs":[-0,1.0000000000000002,1e-9]}],"featureCompatibility":true}');
  const next=normalizeFeatureCaptureMetadata(raw,1024);assert.equal(JSON.parse(next).platform.memoryBytes,1024);assert.equal(JSON.parse(next).featureCompatibility,undefined);assert.ok(next.toString().includes('"samplesNs":[-0,1.0000000000000002,1e-9]'));assert.ok(next.toString().includes('"capturedAt":"original"'));
  assert.deepEqual(normalizeFeatureCaptureMetadata(next,1024),next);
 }
});
test('conflicting memory and malformed UTF8 reject',()=>{
 const raw=Buffer.from('{"platform":{"memoryBytes":2048},"results":[{"workload":"features/test"}]}');assert.throws(()=>normalizeFeatureCaptureMetadata(raw,1024));assert.throws(()=>normalizeFeatureCaptureMetadata(Buffer.concat([raw,Buffer.from([255])]),1024));
});
