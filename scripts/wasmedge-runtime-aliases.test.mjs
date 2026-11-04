import test from 'node:test';
import assert from 'node:assert/strict';
import {withWasmEdgeRuntimeAliases} from './lib/wasmedge-runtime-aliases.mjs';
const modern=`switch id {
 case "wasmedge-jit":
  return []string{NativeExecutable(filepath.Join(root,"bin","adapter-"+id)),"--wasmedge-mode=jit"},true,nil
 case "wasmi", "libwasm", "wasmedge":
 }
 if !slices.Contains([]string{"wasmedge-jit", "libwasm", "wasmedge"}, id) { return false,nil }
 switch id {
 case "wamr", "wasmedge-jit", "libwasm", "wasmedge":
  feature := id
  if id == "wasmedge-jit" {
   feature = "wasmedge"
  }
 }`;
test('accepts source-qualified modern registry with unrelated runtimes unchanged',()=>assert.equal(withWasmEdgeRuntimeAliases(modern),modern));
test('rejects incomplete transport, registration, or Cargo feature bindings',()=>{
 for(const broken of [modern.replace('--wasmedge-mode=jit','--other'),modern.replace('"wasmedge-jit", "libwasm", "wasmedge"}, id','"libwasm", "wasmedge"}, id'),modern.replace('feature = "wasmedge"','feature = "wrong"')])assert.throws(()=>withWasmEdgeRuntimeAliases(broken));
});
