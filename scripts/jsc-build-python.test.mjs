import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {javaScriptCoreBuildPython,javaScriptCorePythonFlags} from './lib/jsc-build-python.mjs';

const execute=promisify(execFile);
const run=async(program,args)=>({output:(await execute(program,args,{timeout:30000})).stdout});

test('actual CMake reproduces the source-relative FILEPATH failure and accepts the resolved interpreter',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'jsc-python-regression-')));
 try {
  const source=join(root,'source');await mkdir(source);
  await writeFile(join(source,'CMakeLists.txt'),`cmake_minimum_required(VERSION 3.20)
project(PythonProbe NONE)
set(PYTHON_EXECUTABLE \${Python_EXECUTABLE} CACHE FILEPATH "Python executable")
execute_process(COMMAND \${PYTHON_EXECUTABLE} -c "print('python-probe-ok')" RESULT_VARIABLE result OUTPUT_VARIABLE output)
if(NOT result EQUAL 0 OR NOT output MATCHES "python-probe-ok")
 message(FATAL_ERROR "Python execution failed")
endif()
`);
  const build=join(root,'build');
  const configure=async flags=>({output:(await execute('cmake',['-S',source,'-B',build,...flags],{cwd:source,timeout:30000})).stdout});
  await assert.rejects(configure(['-DPython_EXECUTABLE=python3','-DPython3_EXECUTABLE=python3','-DPYTHON_EXECUTABLE=python3']));
  assert.ok((await readFile(join(build,'CMakeCache.txt'),'utf8')).includes('PYTHON_EXECUTABLE:FILEPATH='+join(source,'python3')));
  const python=await javaScriptCoreBuildPython({},run);
  await configure(javaScriptCorePythonFlags(python.program));
  assert.ok((await readFile(join(build,'CMakeCache.txt'),'utf8')).includes('PYTHON_EXECUTABLE:FILEPATH='+python.program));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('resolves the explicitly selected private Python without changing global environment',async()=>{
 const env={WASMFYI_BUILD_PYTHON:'/private/python/bin/python3'};
 const calls=[];
 const result=await javaScriptCoreBuildPython(env,async(program,args)=>{
  calls.push({program,args});return {output:calls.length===1?'3.11.9\n':'/private/python/bin/python3.11\n'};
 });
 assert.equal(result.program,'/private/python/bin/python3.11');
 assert.equal(result.version,'3.11.9');
 assert.ok(calls.every(call=>call.program===env.WASMFYI_BUILD_PYTHON));
 assert.deepEqual(env,{WASMFYI_BUILD_PYTHON:'/private/python/bin/python3'});
});

test('rejects ambiguous paths and retains the minimum Python version guard',async()=>{
 for(const invalid of ['python3','','/python\n/other','/python;other']){
  let count=0;
  await assert.rejects(javaScriptCoreBuildPython({},async()=>({output:++count===1?'3.11.9':invalid})),/absolute executable/);
  assert.throws(()=>javaScriptCorePythonFlags(invalid),/absolute executable/);
 }
 await assert.rejects(javaScriptCoreBuildPython({},async()=>({output:'3.9.9'})),/requires Python >=3.10/);
});
