// Audit the latest projected cells; never substitute older successes for failures.
// Run scripts/view-data.mjs first to refresh the digest-verified projection.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { site } from './lib/wasmbench.mjs';

const view=JSON.parse(await readFile(join(site,'src/lib/data/measurements.json')));
const settings=JSON.parse(await readFile(join(site,'wasmbench.config.json')));
if(view.encoding!=='indexed-cells-v1')throw Error('Unsupported cell encoding');
const slots=Object.keys(view.configurations);
const workloads=view.catalogue.map((workload,index)=>({workload,index})).filter(({workload})=>!workload.id.startsWith('features/'));
const result={schema:1,scope:'current non-feature workloads',workloads:workloads.length,hosts:{}};
for(const [machine,host]of Object.entries(view.hosts)){
  const cells=new Map();
  for(const row of host.snapshots.s1){
    const key=row.slice(0,3).join('|');
    if(cells.has(key))throw Error('Duplicate latest cell: '+key);
    cells.set(key,row);
  }
  const configurations={};
  for(const runtime of settings.collection.runtimes){
    const slot=slots.findIndex(slot=>view.configurations[slot]===runtime);
    if(slot<0)throw Error('Missing runtime slot: '+runtime);
    const metrics={};
    for(const [metricIndex,metric]of view.metrics.entries()){
      const counts={ok:0,unsupported:0,failed:0,nm:0,na:0,missing:0},gaps=[];
      for(const {workload,index}of workloads){
        const row=cells.get([index,slot,metricIndex].join('|'));
        const status=row?view.statuses[row[3]]:'missing';
        if(!(status in counts))throw Error('Unknown status: '+status);
        counts[status]++;
        if(['failed','nm','missing'].includes(status))gaps.push({workload:workload.id,status,...(row?{report:view.reportIds[row[4]],reason:view.reasons[row[8]]}: {})});
      }
      metrics[metric]={counts,gaps};
    }
    configurations[runtime]={identity:host.configurations[slots[slot]]||null,metrics};
  }
  result.hosts[machine]={label:host.label,configurations};
}
console.log(JSON.stringify(result,null,2));
