import { describe, expect, it } from 'vitest';
import { FEATS } from './data/features';
import { viewData } from './view-data';
import { RTB } from './data/runtimes';
import { compatCell, type Scope } from './model';
import { runtimeSupportCell, supportOf, engineFeatureVersions, runtimeFeatureTrack, pluginSupportEvidence } from './support';

describe('optional plugin availability',()=>{
  for(const machine of ['m1','m2'] as const)it(`keeps Wago plugin suite evidence separate from measured contracts on ${machine}`,()=>{
    const scope:Scope={machine,baseline:'A',hide:{},weighting:'workload'};
    for(const id of ['wasi-p1','wasi-p2','component-model','cm-abi','cm-res','cm-async']) {
      const feature=FEATS.find(f=>f.id===id)!;
      const support=supportOf('wago',feature,scope);
      const cell=runtimeSupportCell('wago',feature,scope);
      const evidence=pluginSupportEvidence(id,machine);
      if(evidence){
        expect(support).toBe('y');
        expect(cell.detail).toContain('wago-org/');
        expect(cell.detail).toContain(evidence.label);
      } else {
        expect(evidence).toBeUndefined();
        expect(cell.detail).not.toContain('Plugin tests');
        const expected={ 'via plugin':'?', 'corpus passed':'y', 'partial corpus':'p', 'adapter unsupported':'?', 'rejected / failed':'?' }[cell.text];
        expect(expected).toBeDefined();
        expect(support).toBe(expected);
        if(cell.text==='via plugin')expect(cell.detail).toContain('wago-org/');
        if(cell.text==='corpus passed')expect(cell.detail).toMatch(/\d+\/\d+ passed/);
      }
      if(['wasi-p1','wasi-p2','component-model','cm-abi','cm-res','cm-async'].includes(id))
        expect(engineFeatureVersions('wago',scope,'development')).toHaveLength(0);
      expect(runtimeSupportCell('wasmer',feature,scope).text).not.toBe('via plugin');
    }
  });
  it('lists both WASI versions and the component runtime in the descriptive registry',()=>{
    expect(RTB.wago.wasi).toBe('0.1 · 0.2 (plugin)');
    expect(RTB.wago.cm).toBe('y');
    expect(RTB.wago.notes.join(' ')).toContain('wago-org/component-model');
  });
});

describe('excluded experimental feature configurations',()=>{
  for(const machine of ['m1','m2'] as const)it(`does not expose archived WasmFX evidence on ${machine}`,()=>{
    const scope:Scope={machine,baseline:'A',hide:{},weighting:'workload'};
    const feature=FEATS.find(f=>f.id==='threads')!;
    const track=runtimeFeatureTrack('v8',feature,scope,'stable');
    expect(track.configurations.some(c=>c.id==='v8-wasmfx')).toBe(false);
    expect(runtimeSupportCell('v8',feature,scope).detail).not.toContain('WasmFX');
  });
});

describe('host-provided WASI is separated from V8 engine conformance',()=>{
  for(const machine of ['m1','m2'] as const)it(`reports the Node Preview 1 host without claiming benchmark coverage on ${machine}`,()=>{
    const scope:Scope={machine,baseline:'A',hide:{},weighting:'workload'};
    const wasi=FEATS.find(f=>f.id==='wasi-p1')!;
    const cell=runtimeSupportCell('v8',wasi,scope);
    expect(cell.text).toBe('Node host API · unmeasured');
    expect(cell.detail).toContain('has not been collected yet');
    expect(runtimeFeatureTrack('v8',wasi,scope,'stable').text).toBe('Node host API · unmeasured');
  });
});

describe('stable and development compatibility tracks',()=>{
  for(const machine of ['m1','m2'] as const)it(`never presents unreleased Wago as stable on ${machine}`,()=>{
    const scope:Scope={machine,baseline:'A',hide:{},weighting:'workload'};
    const f=FEATS.find(f=>f.id==='simd')!;
    const released=engineFeatureVersions('wago',scope,'stable');
    expect(released.every(v=>!v.includes('9f01d145'))).toBe(true);
    const track=runtimeFeatureTrack('wago',f,scope,'stable');
    if(!released.length)expect(track.text).toBe('not collected');
    else for(const c of track.configurations){
      expect(viewData.featureVersions[machine].some(v=>v.channel==='stable' && v.version===c.version && v.id===c.id)).toBe(true);
    }
    expect(engineFeatureVersions('wago',scope,'development')).toHaveLength(0);
    expect(runtimeFeatureTrack('wago',f,scope,'development').text).toBe('not collected');
    const wasi=FEATS.find(feature=>feature.id==='wasi-p1')!;
    expect(runtimeFeatureTrack('wago',wasi,scope,'development').text).toBe('not collected');
    const wasmtimeStable=engineFeatureVersions('wasmtime',scope,'stable');
    expect(runtimeFeatureTrack('wasmtime',f,scope,'stable').text).toBe(wasmtimeStable.length?'corpus passed':'not collected');
    const development=engineFeatureVersions('wasmtime',scope,'development');
    expect(runtimeFeatureTrack('wasmtime',f,scope,'development').text).toBe(development.length?'corpus passed':'not collected');
  });
});

describe('combined compatibility and corpus counts',()=>{
  for(const machine of ['m1','m2'] as const)it(`keeps backend evidence separate and counts only one complete configuration on ${machine}`,()=>{
    const scope:Scope={machine,baseline:'A',hide:{},weighting:'workload'};
    const feature=FEATS.find(f=>f.id==='simd')!;
    const track=runtimeFeatureTrack('v8',feature,scope,'stable');
    if(track.configurations.length)expect(track.pass).toBe(track.expected);
    else expect(track.text).toBe('not collected');
		expect(track.configurations.every(c=>c.id==='v8-optimizing-only')).toBe(true);
		if(track.configurations.length)expect(track.configurations.some(c=>c.backend.includes('optimizing'))).toBe(true);
    for(const c of track.configurations){
      expect(c.pass+c.failed+c.skipped+c.missing).toBe(c.total);
      expect(c.contracts).toHaveLength(c.total-c.missing);
      expect(c.contracts.filter(x=>x.status==='passed')).toHaveLength(c.pass);
    }
    const missing=runtimeFeatureTrack('uncollected-engine',feature,scope,'stable');
    expect(missing.configurations).toEqual([]);
    expect(missing.pass).toBe(0);
  });
});
