export function pluginEvidence(reports,host,aliases={}) {
  const normalize=name=>aliases[name] || name;
  const architecture=name=>name==='x64'?'amd64':name;
  const candidates=reports.filter(r=>r.host.os===host.os && architecture(r.host.arch)===architecture(host.arch) && normalize(r.host.hostname)===normalize(host.hostname)).sort((a,b)=>b.created.localeCompare(a.created));
  const lanes=new Map();
  for(const report of candidates)for(const lane of report.lanes)if(lane.totals && lane.status!=='runner-error' && !lanes.has(lane.id))lanes.set(lane.id,{report,lane});
  const output={};
  const entry=(item,totals,label)=>({label,passed:totals.passed,failed:totals.failed,skipped:totals.skipped,total:totals.passed+totals.failed+totals.skipped,created:item.report.created,version:item.lane.plugin.tag,engine:item.lane.engine.tag,evidence:'/wasmbench/conformance/'+item.report.sha256+'.json'});
  const library=lanes.get('wago-wasi-library');
  if(library)for(const [feature,packageName] of [['wasi-p1','p1'],['wasi-p2','p2']]){
    const tests=new Map();
    for(const line of library.lane.stdout.split('\n')){
      let e;try{e=JSON.parse(line);}catch{continue;}
      if(e.Package==='github.com/wago-org/wasi/'+packageName && e.Test && ['pass','fail','skip'].includes(e.Action))tests.set(e.Test,e.Action);
    }
    const leaves=[...tests].filter(([name])=>![...tests.keys()].some(n=>n.startsWith(name+'/')));
    if(leaves.length)output[feature]=entry(library,{passed:leaves.filter(([,s])=>s==='pass').length,failed:leaves.filter(([,s])=>s==='fail').length,skipped:leaves.filter(([,s])=>s==='skip').length},'Plugin tests');
  }
  const wasi=lanes.get('wago-wasi');
  if(wasi?.lane.unit==='official Preview 1 cases')output['wasi-p1']=entry(wasi,wasi.lane.totals,'Official suite');
  const component=lanes.get('wago-component');
  if(component)output['component-model']=entry(component,component.lane.totals,'Plugin suite');
  return output;
}
