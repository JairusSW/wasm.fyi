import test from 'node:test';
import assert from 'node:assert/strict';
import {wazyNativeSizeLayout} from './lib/wazy-native-size.mjs';

test('Wazy code sizing distinguishes supported native and older Wazevo layouts',()=>{
 assert.equal(wazyNativeSizeLayout(new Set(['internal/engine/native/engine.go'])),'native');
 assert.equal(wazyNativeSizeLayout(new Set(['internal/engine/wazevo/engine.go'])),'unavailable-wazevo');
 assert.throws(()=>wazyNativeSizeLayout(new Set()),/layout is unknown/);
});
