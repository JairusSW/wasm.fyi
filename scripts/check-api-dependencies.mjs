import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const packages=execFileSync('go',['list','-deps','./cmd/wasmfyi'],{cwd:fileURLToPath(new URL('../service',import.meta.url)),encoding:'utf8',env:{...process.env,GOWORK:'off',GOFLAGS:'-mod=readonly'}}).trim().split('\n');
const forbidden=packages.filter(p=>/sqlite/i.test(p)||p.startsWith('github.com/wasmbench/wasmbench/'));
assert.deepEqual(forbidden,[],'Serving dependency closure includes SQLite or harness execution packages');
console.log(`API dependency closure checked (${packages.length} packages; no SQLite or harness execution)`);
