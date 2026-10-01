import { describe, expect, it } from 'vitest';
import { FEATS } from './data/features';
import { RTB } from './data/runtimes';
import { compatCell, type Scope } from './model';
import { runtimeSupportCell, supportOf } from './support';

describe('optional plugin availability',()=>{
  for(const machine of ['m1','m2'] as const)it(`shows Wago interface plugins without inventing measured passes on ${machine}`,()=>{
    const scope:Scope={machine,baseline:'A',hide:{},weighting:'workload'};
    for(const id of ['wasi-p1','wasi-p2','component-model','cm-abi','cm-res','cm-async']) {
      const feature=FEATS.find(f=>f.id===id)!;
      expect(supportOf('wago',feature,scope)).toBe('?');
      expect(compatCell(id,'G',scope).pass).toBe(0);
      const cell=runtimeSupportCell('wago',feature,scope);
      expect(cell.text).toBe('via plugin');
      expect(cell.detail).toContain('has not been benchmarked');
      expect(cell.detail).toContain('https://github.com/wago-org/');
      expect(runtimeSupportCell('wasmer',feature,scope).text).not.toBe('via plugin');
    }
  });
  it('lists both WASI versions and the component runtime in the descriptive registry',()=>{
    expect(RTB.wago.wasi).toBe('0.1 · 0.2 (plugin)');
    expect(RTB.wago.cm).toBe('y');
    expect(RTB.wago.notes.join(' ')).toContain('wago-org/component-model');
  });
});

describe('experimental feature configurations',()=>{
  for(const machine of ['m1','m2'] as const)it(`labels flag-only stack switching passes on ${machine}`,()=>{
    const scope:Scope={machine,baseline:'A',hide:{},weighting:'workload'};
    const feature=FEATS.find(f=>f.id==='stack-switching')!;
    expect(supportOf('v8',feature,scope)).toBe('f');
    const cell=runtimeSupportCell('v8',feature,scope);
    expect(cell.text).toBe('corpus passed · flag');
    expect(cell.detail).toContain('WasmFX flag');
  });
});
