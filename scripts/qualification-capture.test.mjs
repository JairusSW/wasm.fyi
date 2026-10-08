import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertQualifiedCaptureRow} from './lib/qualification-capture.mjs';
const row={backend:'interpreter',latencyStatus:'ok',timingSamples:12,memoryStatus:'ok',peakRssBytes:4096,codeStatus:'unsupported',codeBytes:null};
test('interpreter probes require explicit native-code unavailability',()=>{
 assert.doesNotThrow(()=>assertQualifiedCaptureRow(row));
 assert.throws(()=>assertQualifiedCaptureRow({...row,codeStatus:'not-measured'}));
 assert.throws(()=>assertQualifiedCaptureRow({...row,codeStatus:'ok',codeBytes:128}));
});
test('native backends must produce positive native-code sizes',()=>{
 assert.throws(()=>assertQualifiedCaptureRow({...row,backend:'OMG'}));
 assert.doesNotThrow(()=>assertQualifiedCaptureRow({...row,backend:'OMG',codeStatus:'ok',codeBytes:128}));
 assert.throws(()=>assertQualifiedCaptureRow({...row,backend:'OMG',codeStatus:'ok',codeBytes:0}));
});
test('native-code unavailability does not waive RSS or twelve timing samples',()=>{
 assert.throws(()=>assertQualifiedCaptureRow({...row,memoryStatus:'unsupported'}));
 assert.throws(()=>assertQualifiedCaptureRow({...row,timingSamples:11}));
});
