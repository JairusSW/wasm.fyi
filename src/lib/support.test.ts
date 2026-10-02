import { describe, expect, it } from 'vitest';
import { FEATS } from './data/features';
import { RTB } from './data/runtimes';
import { compatCell, type Scope } from './model';
import { runtimeSupportCell, supportOf, engineFeatureVersions, runtimeFeatureTrack } from './support';

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

describe('stable and development compatibility tracks',()=>{
  for(const machine of ['m1','m2'] as const)it(`never presents unreleased Wago as stable on ${machine}`,()=>{
    const scope:Scope={machine,baseline:'A',hide:{},weighting:'workload'};
    const f=FEATS.find(f=>f.id==='simd')!;
    expect(engineFeatureVersions('wago',scope,'stable')).toEqual([]);
    expect(runtimeFeatureTrack('wago',f,scope,'stable').text).toBe('not collected');
    expect(engineFeatureVersions('wago',scope,'development')[0]).toContain('9f01d145');
    expect(runtimeFeatureTrack('wago',f,scope,'development').text).toBe('corpus passed');
    expect(engineFeatureVersions('wasmtime',scope,'stable')).toContain('46.0.1');
    expect(runtimeFeatureTrack('wasmtime',f,scope,'stable').text).toBe('corpus passed');
    expect(runtimeFeatureTrack('wasmtime',f,scope,'development').text).toBe('not collected');
  });
});

describe('combined compatibility and corpus counts',()=>{
  for(const machine of ['m1','m2'] as const)it(`keeps backend evidence separate and counts only one complete configuration on ${machine}`,()=>{
    const scope:Scope={machine,baseline:'A',hide:{},weighting:'workload'};
    const feature=FEATS.find(f=>f.id==='simd')!;
    const track=runtimeFeatureTrack('v8',feature,scope,'stable');
    expect(track.pass).toBe(track.expected);
    expect(track.configurations.length).toBeGreaterThan(1);
    for(const c of track.configurations){
      expect(c.pass+c.failed+c.skipped+c.missing).toBe(c.total);
      expect(c.contracts).toHaveLength(c.total-c.missing);
      expect(c.contracts.filter(x=>x.status==='passed')).toHaveLength(c.pass);
    }
    const missing=runtimeFeatureTrack('wago',feature,scope,'stable');
    expect(missing.configurations).toEqual([]);
    expect(missing.pass).toBe(0);
  });
});
