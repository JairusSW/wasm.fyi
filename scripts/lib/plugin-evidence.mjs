export function pluginEvidence(reports,host,aliases={}) {
  const normalize=name=>aliases[name] || name;
  const architecture=name=>name==='x64'?'amd64':name;
  const candidates=reports.filter(r=>r.host.os===host.os && architecture(r.host.arch)===architecture(host.arch) && normalize(r.host.hostname)===normalize(host.hostname)).sort((a,b)=>b.created.localeCompare(a.created));
  const lanes=new Map();
  for(const report of candidates)for(const lane of report.lanes)if(lane.totals && lane.status!=='runner-error' && !lanes.has(lane.id))lanes.set(lane.id,{report,lane});
  const output={};
  const entry=(item,totals,label,official=false)=>({label,official,passed:totals.passed,failed:totals.failed,skipped:totals.skipped,total:totals.passed+totals.failed+totals.skipped,created:item.report.created,version:item.lane.plugin.tag,engine:item.lane.engine.tag,evidence:'/wasmbench/conformance/'+item.report.sha256+'.json'});
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
  if(wasi?.lane.unit==='official Preview 1 cases')output['wasi-p1']=entry(wasi,wasi.lane.totals,'Official suite',true);
  const component=lanes.get('wago-component');
  if(component){
    const cases=component.lane.results.filter(r=>/^TestOfficialComponentModel(?:Synchronous|Async)Conformance\//.test(r.name));
    const pinned=component.lane.suite?.manifests?.find(m=>m.path==='testdata/conformance/manifest.json');
    if(cases.length && pinned?.revision===component.lane.suite.revision){
      const groups={
        'component-model':{scope:'Entire official Component Model suite',cases},
        'cm-abi':{scope:'Official values/* and validation/abi.wast cases',cases:cases.filter(r=>/Conformance\/(values\/|validation\/abi\.wast\/)/.test(r.name))},
        'cm-res':{scope:'Official resources/* and validation/resources.wast cases',cases:cases.filter(r=>/Conformance\/(resources\/|validation\/resources\.wast\/)/.test(r.name))},
        'cm-async':{scope:'Official async/* cases',cases:cases.filter(r=>r.name.startsWith('TestOfficialComponentModelAsyncConformance/async/'))}
      };
      for(const [feature,group] of Object.entries(groups))if(group.cases.length)output[feature]={...entry(component,{passed:group.cases.filter(r=>r.status==='passed').length,failed:group.cases.filter(r=>r.status==='failed').length,skipped:group.cases.filter(r=>r.status==='skipped').length},'Official suite',true),scope:group.scope};
    }
  }
  return output;
}
