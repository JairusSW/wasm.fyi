import test from 'node:test';import assert from 'node:assert/strict';
import {withWamrRuntimeAliases} from './lib/wamr-runtime-aliases.mjs';
const modern=`switch id {
 case "wamr-fast-jit", "wamr-llvm-jit":
  return []string{NativeExecutable(filepath.Join(root,"bin","adapter-"+id)),"--wamr-mode="+strings.TrimPrefix(id,"wamr-")},true,nil
 case "wasmedge-jit":
 }
 if !slices.Contains([]string{"wamr-fast-jit", "wamr-llvm-jit", "wasmi", "libwasm", "wamr"}, id) { return false,nil }
 switch id {
 case "wamr-fast-jit", "wamr-llvm-jit", "libwasm", "wamr":
  feature := id
  if strings.HasPrefix(id, "wamr-") {
   feature = "wamr"
  }
 }`;
test('accepts already upgraded registry with extra runtimes unchanged',()=>assert.equal(withWamrRuntimeAliases(modern),modern));
test('legacy three-list registry upgrades exactly once',()=>{
 const old=Array(3).fill('case "wasmi", "wavm", "wamr", "wasm3":').join('\n')+'\nstrings.ReplaceAll(id, "-", "_")';
 const patched=withWamrRuntimeAliases(old);assert.equal(patched.split('"wamr-fast-jit"').length-1,3);assert(patched.includes('strings.HasPrefix(id, "wamr-")'));assert.equal(withWamrRuntimeAliases(patched),patched);
});
test('rejects partial alias migrations',()=>{
 for(const broken of [modern.replace('"--wamr-mode="','"--other-mode="').replace('"adapter-"+id','"other-"+id'),modern.replace('"wamr-fast-jit", "wamr-llvm-jit", "wasmi"','"wamr-fast-jit", "wasmi"'),modern.replace('feature = "wamr"','feature = "wrong"')])assert.throws(()=>withWamrRuntimeAliases(broken),/anchors changed/);
});
