import {expect,it} from 'vitest';
import {compilationCandidate} from './ranking-policy';
it('excludes transpilers only from compilation rankings',()=>{
 for(const rt of ['wasm2go','wasm2c','wasm2c-gcc','w2c2','w2c2-gcc','wasm2rs']){
  expect(compilationCandidate(rt,'compile')).toBe(false);
  expect(compilationCandidate(rt,'steady')).toBe(true);
  expect(compilationCandidate(rt,'inst')).toBe(true);
 }
 for(const rt of ['wago','wasmtime','wasmer','wazero','v8'])expect(compilationCandidate(rt,'compile')).toBe(true);
});
