import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {userPath} from './user-path.mjs';
test('CLI dependencies stay in its root; campaigns keep existing paths',()=>{
 const old=process.env.WASMFYI_HOME;
 try{delete process.env.WASMFYI_HOME;assert.equal(userPath('.cache/wasm-fyi/tools'),join(homedir(),'.cache/wasm-fyi/tools'));process.env.WASMFYI_HOME='/private/cli';assert.equal(userPath('.cache/wasm-fyi/tools'),'/private/cli/cache/tools');assert.equal(userPath('.local/share/wasm-fyi/toolchains/llvm'),'/private/cli/cache/toolchains/llvm')}
 finally{if(old===undefined)delete process.env.WASMFYI_HOME;else process.env.WASMFYI_HOME=old}
});
