import test from 'node:test';
import assert from 'node:assert/strict';
import {javaScriptCoreModuleCast} from './lib/jsc-native-size.mjs';

test('uses modern WebKit class-info casts when the source exposes them',()=>{
 assert.equal(javaScriptCoreModuleCast('dynamicDowncast<JSWebAssemblyMemory>(object)'), 'dynamicDowncast<JSWebAssemblyModule>');
});

test('retains the historical JSC cast spelling for older releases',()=>{
 assert.equal(javaScriptCoreModuleCast('unrelated historical source'), 'jsDynamicCast<JSWebAssemblyModule*>');
});
