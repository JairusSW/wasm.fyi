import test from 'node:test';
import assert from 'node:assert/strict';
import {command} from './lib/wasmbench.mjs';
test('adapter protocol requests reach subprocess stdin',()=>{
  const request='{"version":1,"id":1,"method":"describe"}\n';
  const actual=command(process.execPath,['-e',"process.stdin.pipe(process.stdout)"],{input:request}).toString();
  assert.equal(actual,request);
});
