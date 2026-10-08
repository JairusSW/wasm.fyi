import {it,expect,vi} from 'vitest';
vi.unmock('./view-data');
import {datasetView} from './api/view.svelte';
import {emptyView} from './api/view.svelte';
import {historySeries,historyPointInfo} from './history-values';
import {CALL_PATHS} from './call-paths';
import {OTM_KEYS} from './data/snapshot';
it('adds both call directions and leaves an incomplete total unmeasured',()=>{
 const previous=datasetView.current;const view=emptyView();datasetView.current=view;
 try{
  view.history.m1.points=[{date:'2026-10-01',revision:'',status:'measured'},{date:'2026-10-02',revision:'',status:'measured'}];
  view.history.m1.workloads=CALL_PATHS.map(p=>p.id);
  view.history.m1.cells[`${CALL_PATHS[0].id}|A|steady`]=[{st:'ok',v:0.000003,report:'a',role:'retrospective-revision'},{st:'ok',v:0.000004,report:'b',role:'retrospective-revision'}];
  view.history.m1.cells[`${CALL_PATHS[1].id}|A|steady`]=[{st:'ok',v:0.000007,report:'a',role:'retrospective-revision'},{st:'unsupported',report:'b',role:'retrospective-revision'}];
  const scope={machine:'m1' as const,baseline:'A' as const,hide:{},weighting:'workload' as const};
  const values=historySeries(scope,'A','callTotal')!;
  expect(values[0]).toBeCloseTo(0.000010,12);expect(values[1]).toBeNaN();
  expect(historyPointInfo(scope,'A','callTotal',0).calls?.label).toBe('Total call latency');
  expect(OTM_KEYS).toContain('callTotal');expect(OTM_KEYS).not.toContain('hostWasm');expect(OTM_KEYS).not.toContain('wasmHostLoop');
 }finally{datasetView.current=previous;}
});
