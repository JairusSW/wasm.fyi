import test from 'node:test';
import assert from 'node:assert/strict';
import {measurementLaunch} from './lib/measurement-launch.mjs';

test('feature measurements retain the selected controller and its exact arguments under host scheduling',()=>{
 const args=Object.freeze(['capture','--suite','/path with spaces/suite.json']);
 for(const [platform,program,prefix] of [
  ['linux','taskset',['-c','7','/selected/controller']],
  ['darwin','taskpolicy',['-a','-t','0','-l','0','/selected/controller']],
  ['win32','/selected/controller',[]],
 ]){
  const launch=measurementLaunch('/selected/controller',args,{platform,cpu:7});
  assert.equal(launch.program,program);
  assert.deepEqual(launch.args,[...prefix,...args]);
 }
});
