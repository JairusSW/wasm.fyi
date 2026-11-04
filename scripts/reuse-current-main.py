#!/usr/bin/env python3
"""Export exact source/artifact/contract matches from SQL into a current campaign."""
import hashlib,json,os,re,sqlite3,struct,sys,uuid
from pathlib import Path
db,root_arg,contracts_arg,cpu=sys.argv[1:]
root=Path(root_arg);plan=json.loads((root/'source-plan.json').read_text())
expected={w['workload']:w for w in json.loads(Path(contracts_arg).read_text())}
c=sqlite3.connect('file:'+db+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
platform=c.execute('select * from platforms where cpu=? order by id desc limit 1',(cpu,)).fetchone()
if platform is None:raise SystemExit('Unknown host CPU')
platforms={p['id']:p for p in c.execute('select * from platforms where cpu=?',(cpu,))}
platform_json={k:platform[k] for k in ['os','arch','cpu','cores','kernel']};platform_json['memoryBytes']=platform['memory_bytes']
statuses=['','ok','failed','unsupported','disabled','not-measured','unavailable'];phases=['compile','instantiate','first-call','steady']
clean=lambda s:re.sub('[^a-zA-Z0-9.-]','_',s)
summary=[]
for pin in plan['pins']:
 if pin.get('status')!='planned':continue
 for config in pin['configurations']:
  dates=[r[0] for r in c.execute('select distinct snap.as_of from snapshots snap join sources s on s.id=snap.source_id where s.repository=? and s.revision=? order by snap.as_of desc',(pin['repository'],pin['revision']))]
  grouped={}
  for date in dates:
   rows=c.execute('''select o.*,h.platform_id,w.name workload,ct.wasm,ct.artifact,ct.digest contract,cfg.version,cfg.backend,e.name engine,d.data display,sp.data sampling,v.data samples
    from history h join observations o on o.id=h.observation_id
    join configurations cfg on cfg.id=o.configuration_id join engines e on e.id=cfg.engine_id
    join contracts ct on ct.id=o.contract_id join workloads w on w.id=ct.workload_id
    left join displays d on d.id=o.display_id left join sampling_policies sp on sp.id=o.sampling_id left join sample_vectors v on v.id=o.samples_id
    join sources s on s.id=o.source_id
    where h.platform_id in ('''+','.join('?' for _ in platforms)+''') and h.as_of=? and e.name=? and s.repository=? and s.revision=?''',(*platforms,date,config,pin['repository'],pin['revision']))
   for row in rows:
    want=expected.get(row['workload'])
    if not want or row['artifact'].hex()!=want['artifactSha256'] or row['contract'].hex()!=want['contractSha256']:continue
    grouped.setdefault((row['workload'],row['captured_at']),{})[row['phase']]=row
  count=0
  for workload in expected:
   matches=[(at,rows) for (w,at),rows in grouped.items() if w==workload and len(rows)==4]
   if not matches:continue
   at,rows=max(matches,key=lambda item:item[0]);results=[]
   measured_platform=platforms[rows[0]['platform_id']]
   platform_json={k:measured_platform[k] for k in ['os','arch','cpu','cores','kernel']};platform_json['memoryBytes']=measured_platform['memory_bytes']
   if any(r['latency_status'] not in (1,3) for r in rows.values()):continue
   for phase in range(4):
    r=rows[phase];bits=r['metric_bits'];samples=list(struct.unpack('<'+'d'*(len(r['samples'] or b'')//8),r['samples'] or b''))
    result={'workload':workload,'wasm':r['wasm'],'artifactSha256':r['artifact'].hex(),'contractSha256':r['contract'].hex(),'engine':config,'version':r['version'],'backend':r['backend'],'phase':phases[phase],'latencyStatus':statuses[r['latency_status']],'memoryStatus':statuses[r['memory_status']],'codeStatus':statuses[r['code_status']],'codeKind':r['code_kind'],'timingSamples':r['timing_samples'],'samplesNs':samples}
    for i,k in enumerate(['latencyNs','peakRssBytes','codeBytes']):result[k]=struct.unpack_from('<d',bits,1+8*i)[0] if bits[0]&(1<<i) else None
    if r['display'] is not None:result['display']=json.loads(r['display'])
    if r['sampling'] is not None:result['sampling']=json.loads(r['sampling'])
    results.append(result)
   source={'repository':pin['repository'],'revision':pin['revision'],'ref':pin.get('tag') or 'main@'+pin['revision'][:(12 if pin['engine'] in ['wago','wazero','wasm2go','libwasm'] else 8)],'kind':'release' if pin.get('tag') else 'snapshot','asOf':pin['targetWeek']}
   if pin.get('dateBasis'):source['dateBasis']=pin['dateBasis']
   if pin['engine'] in ['wago','wazero','wasm2go']:
    job='history-5-'+config+'-'+pin['revision'][:12]+'-'+pin['targetType']+'-'+re.sub('[^0-9]','',pin['targetWeek'])
    if pin.get('dateBasis') and pin.get('tag'):job+='-'+clean(pin['tag'])
   elif pin['engine']=='libwasm':job=config+'-'+pin['revision'][:12]+'-'+re.sub('[^0-9]','',pin['targetWeek'])
   else:job='history-5-'+clean('-'.join([config,pin.get('tag') or pin['revision'],pin['targetType'],pin['targetWeek']]))
   path=root/'captures'/(job+'-'+hashlib.sha256(workload.encode()).hexdigest()[:16]+'.json');path.parent.mkdir(parents=True,exist_ok=True)
   if path.exists():continue
   body=json.dumps({'capturedAt':at,'source':source,'platform':platform_json,'results':results},separators=(',',':'))+'\n'
   temporary=path.with_name(path.name+'.reuse-'+uuid.uuid4().hex)
   temporary.write_text(body)
   try:
    try:os.link(temporary,path);count+=1
    except FileExistsError:pass
   finally:temporary.unlink()
  summary.append({'engine':config,'reused':count});print(json.dumps(summary[-1]),flush=True)
(root/'main-reuse-receipt.json').write_text(json.dumps(summary,indent=2)+'\n')
