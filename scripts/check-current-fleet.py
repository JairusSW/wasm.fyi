#!/usr/bin/env python3
"""Read-only ten-minute fleet inspection, independent of the Codex process."""
import concurrent.futures,datetime,json,subprocess,sys
from pathlib import Path

repo=Path(__file__).resolve().parents[1]
root=repo/'.wasmfyi/local/current-week-20261024'
probe=r'''
import json,os,pathlib,shlex,subprocess,sys,time
r=pathlib.Path(sys.argv[1]).resolve();s=json.loads((r/'fleet-worker.json').read_text())
def process(pid):
 if not pid:return None
 p=subprocess.run(['ps','-p',str(pid),'-o','stat=,command='],capture_output=True,text=True)
 parts=p.stdout.strip().split(None,1);state=parts[0] if parts else ''
 return {'pid':pid,'alive':p.returncode==0 and not state.startswith('Z'),'state':state,'command':(parts[1] if len(parts)>1 else '')[:1000]}
all_captures=list((r/'captures').glob('*.json'));captures=[p for p in all_captures if not p.name.startswith('feature-')];features=list((r/'latest-features/captures').glob('*.json'))
logs=list(r.glob('*.log'))+list(r.glob('sdk-builds/*/*-build.log'))+list(r.glob('builds/*/*-build.log'))
progress=max([p.stat().st_mtime for p in captures+features+logs]+[s.get('updated',0)])
f=os.statvfs(r)
out={'host':os.uname().nodename,'checkedAt':time.time(),'worker':process(s.get('pid')),'child':process(s.get('childPid')),'status':s.get('status'),'engine':s.get('engine'),'stage':s.get('stage'),'mainCaptureFiles':len(captures),'featureCaptureFiles':len(features),'completedEngines':len(s.get('completed',[])),'errors':s.get('errors',[])[-5:],'secondsSinceProgress':round(time.time()-progress),'freeBytes':f.f_bavail*f.f_frsize}
# A boundary-refresh helper can own a repair after the old stage exits while
# the supervisor remains stopped. Report that live collector, not its dead PID.
out['supervisorPaused']='T' in (out['worker'] or {}).get('state','')
if out['supervisorPaused'] and not (out['child'] or {}).get('alive'):
 for line in subprocess.check_output(['ps','-axo','pid=,command='],text=True).splitlines():
  parts=line.strip().split(None,1)
  if len(parts)!=2:continue
  try:argv=shlex.split(parts[1])
  except ValueError:continue
  stages={'latest-feature-campaign.mjs':'features','benchmark-engine-history.mjs':'main','benchmark-go-history.mjs':'main','benchmark-libwasm-history.mjs':'main','repair-wasm2go-memory.mjs':'main-repair','prepare-history-sdk.mjs':'prepare'}
  index=next((i for i,arg in enumerate(argv) if pathlib.Path(arg).name in stages and i+1<len(argv) and argv[i+1]==str(r)),None)
  if index is not None:
   candidate=process(int(parts[0]))
   if candidate['alive']:
    out['child']=candidate
    script=pathlib.Path(argv[index]).name;stage=stages[script];engine=out['engine']
    if stage=='features':
     feature=json.loads((r/'latest-features/status.json').read_text())
     engine=(feature.get('current') or {}).get('engine') or engine
    elif script in ('benchmark-engine-history.mjs','benchmark-go-history.mjs') and index+3<len(argv):engine=argv[index+3]
    elif script=='benchmark-libwasm-history.mjs':engine='libwasm'
    elif script=='repair-wasm2go-memory.mjs':engine='wasm2go'
    elif script=='prepare-history-sdk.mjs' and index+2<len(argv):engine=argv[index+2]
    out.update(engine=engine,stage=stage,boundaryRepair=True)
    break
out['operatorPaused']=(r/'OPERATOR-PAUSED').is_file()
out['needsAttention']=out['freeBytes']<3*1024**3 or (not out['operatorPaused'] and (bool(out['errors']) or (out['status']!='completed' and (not (out['worker'] or {}).get('alive') or out['secondsSinceProgress']>900 or (out['status']=='running' and bool(s.get('childPid')) and not (out['child'] or {}).get('alive') and out['secondsSinceProgress']>60)))))
print(json.dumps(out))
'''
if len(sys.argv)==3 and sys.argv[1]=='--host-root':
 import contextlib,io
 host_root=Path(sys.argv[2]);sys.argv=[sys.argv[0],str(host_root)]
 output=io.StringIO()
 with contextlib.redirect_stdout(output):exec(probe)
 report=json.loads(output.getvalue())
 temporary=host_root/('host-check.'+str(__import__('os').getpid())+'.next')
 temporary.write_text(json.dumps(report,indent=2)+'\n');temporary.replace(host_root/'host-check.json')
 with (host_root/'host-check-history.jsonl').open('a') as stream:stream.write(json.dumps(report)+'\n')
 print(json.dumps(report));raise SystemExit(0)
hosts={'apple':(None,str(root/'apple')),'hub':('hub@hub','/home/hub/.cache/wasm-fyi/current-week-20261024'),'remote':('root@remote','/var/lib/wasmfyi-bench/current-week-20261024')}
def check(item):
 name,(host,path)=item
 try:
  command=[sys.executable,'-c',probe,path] if host is None else ['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','-o','ControlMaster=auto','-o','ControlPersist=yes','-o','ControlPath=/tmp/wasmfyi-'+name+'-%C',host,'python3 -c '+__import__('shlex').quote(probe)+' '+__import__('shlex').quote(path)]
  p=subprocess.run(command,capture_output=True,text=True,timeout=90)
  if p.returncode:raise RuntimeError(p.stderr[-2000:])
  return name,json.loads(p.stdout)
 except Exception as error:return name,{'needsAttention':True,'error':str(error)}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=dict(pool.map(check,hosts.items()))
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'machines':results}
root.mkdir(parents=True,exist_ok=True)
temp=root/('fleet-check.'+str(__import__('os').getpid())+'.next');temp.write_text(json.dumps(report,indent=2)+'\n');temp.replace(root/'fleet-check.json')
with (root/'fleet-check-history.jsonl').open('a') as stream:stream.write(json.dumps(report)+'\n')
print(json.dumps(report,indent=2))
