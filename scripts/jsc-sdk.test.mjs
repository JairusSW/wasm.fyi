import {test} from 'node:test';
import assert from 'node:assert/strict';
import {javaScriptCorePort} from './lib/jsc-sdk.mjs';

test('selects an accepted CMake port across the Mac to Cocoa transition',()=>{
 const release='set(ALL_PORTS\n GTK IOS JSCOnly Mac PlayStation WPE Win\n)';
 const main='set(ALL_PORTS\n Cocoa GTK IOS JSCOnly Mac PlayStation WPE Win\n)';
 assert.equal(javaScriptCorePort(release,true),'Mac');
 assert.equal(javaScriptCorePort(main,true),'Cocoa');
 assert.equal(javaScriptCorePort(release,false),'JSCOnly');
 assert.equal(javaScriptCorePort(main,false),'JSCOnly');
 assert.throws(()=>javaScriptCorePort('set(ALL_PORTS GTK WPE)',true),/does not support Mac/);
});
