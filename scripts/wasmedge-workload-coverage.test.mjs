import test from 'node:test';
import assert from 'node:assert/strict';
import {wasmedgeWorkloadCoverageSources} from './lib/wasmedge-workload-coverage.mjs';

const cfgGroup='feature = "wavm"\n                ))]';
const main=`#[cfg(any(
    feature = "wavm"
))]
mod vectors;
#[cfg(any(${cfgGroup}))]
fn first_vector_path() {}
#[cfg(any(${cfgGroup}))]
fn second_vector_path() {}
fn contract(w: &Value) {
    if cfg!(feature = "other") || cfg!(feature = "wavm"))
                    && w["oracle"]["kind"] == "vector" {}
    if cfg!(feature = "other") || cfg!(feature = "wavm"))
                    && w["host_profile"] == "assemblyscript-abort-v1" {}
    if cfg!(feature = "wasmer_llvm")
                    || cfg!(feature = "wasmer_singlepass")
                    || cfg!(feature = "wavm")
                {}
}
fn prepare(assemblyscript: bool) {
                self.bytes = bytes;
                self.prep = Some(p.clone());
}`;
const ffi='pub fn existing_binding() {}';
const cpp=`#include <memory>
struct Instance {
    WasmEdge_ModuleInstanceContext* module=nullptr;
    ~Instance(){if(module)WasmEdge_ModuleInstanceDelete(module);}
};
static const WasmEdge_FunctionInstanceContext* function();
void instantiate(std::unique_ptr<Instance>& i){if(!i->executor||!i->store)throw std::runtime_error("executor/store creation failed");}`;

test('adds WasmEdge vector and AssemblyScript workload transport at the frozen harness seams',()=>{
 const result=wasmedgeWorkloadCoverageSources({main,ffi,cpp});
 assert.match(result.main,/feature = "wasmedge"/);
 assert.match(result.main,/embedding::set_assemblyscript_profile\(assemblyscript\)/);
 assert.match(result.ffi,/fn wb_assemblyscript_profile\(enabled: bool\)/);
 assert.match(result.cpp,/WasmEdge_ExecutorRegisterImport/);
 assert.match(result.cpp,/register_assemblyscript\(i\.get\(\)\)/);
 assert.deepEqual(wasmedgeWorkloadCoverageSources(result),result);
});

test('rejects a partially patched WasmEdge adapter set',()=>{
 assert.throws(
  ()=>wasmedgeWorkloadCoverageSources({main:'// WASMFYI_WASMEDGE_WORKLOAD_COVERAGE_V1\n'+main,ffi,cpp}),
  /Partial WasmEdge coverage patch/
 );
});
