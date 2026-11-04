#!/usr/bin/env python3
"""Durable engine-by-engine main and latest-feature capture supervisor."""
import hashlib, json, os, signal, subprocess, sys, time
from pathlib import Path

root=Path(sys.argv[1]).resolve()
config=json.loads((root/'runner-config.json').read_text())
site=Path(config['site']); node=config['node']; child=None; stopping=False
state_path=root/'fleet-worker.json'
def read(path,default):
    try:return json.loads(path.read_text())
    except FileNotFoundError:return default
state=read(state_path,{'completed':[],'errors':[]})
input_fingerprint=hashlib.sha256(b''.join((Path(config['inputs'])/(kind+'.json')).read_bytes() for kind in ['compatibility','performance','compile','lifecycle'])).hexdigest()
if state.get('inputFingerprint')!=input_fingerprint:
    state.update(completed=[],inputFingerprint=input_fingerprint)
def save(**fields):
    state.update(fields,pid=os.getpid(),updated=time.time())
    temp=state_path.with_suffix('.next');temp.write_text(json.dumps(state,indent=2)+'\n');temp.replace(state_path)
def stop(sig,frame):
    global stopping
    stopping=True
    if child and child.poll() is None:os.killpg(child.pid,sig)
for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,stop)
# An independently launched child can survive a supervisor kill. Adopt it.
prior=state.get('childPid')
while prior:
    p=subprocess.run(['ps','-p',str(prior),'-o','command='],capture_output=True,text=True)
    if p.returncode or str(root) not in p.stdout:break
    time.sleep(5)
plan=read(root/'source-plan.json',{});template=read(root/'collection-template.json',{})
env={**os.environ,**template.get('env',{}),'WASMFYI_HISTORY_FAST':'1'}
def run(args,stage,engine,extra=None):
    global child
    current_template=read(root/'collection-template.json',template)
    with (root/'worker.log').open('ab',buffering=0) as log:
        child=subprocess.Popen([node,*args],cwd=site,env={**env,**current_template.get('env',{}),**(extra or {})},stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        save(status='running',stage=stage,engine=engine,childPid=child.pid)
        code=child.wait();child=None;save(childPid=None)
    return code
for pin in plan['pins']:
    if stopping:break
    if pin.get('status')!='planned':continue
    engine=pin['engine'];key=engine+'|'+pin['revision']
    if key in state['completed']:
        feature_identity=read(root/'latest-features/status.json',{}).get('inputIdentity')
        markers=read(root/'latest-features/ledger.json',{}).get('completedEngines',[])
        if feature_identity and all(c+'|'+pin['revision']+'|'+feature_identity in markers for c in pin['configurations']):continue
        state['completed'].remove(key)
    state['errors']=[error for error in state['errors'] if error.get('engine')!=engine]
    go=engine in ('wago','wazero','wasm2go')
    script='benchmark-go-history.mjs' if go else 'benchmark-libwasm-history.mjs' if engine=='libwasm' else 'benchmark-engine-history.mjs'
    args=[str(site/'scripts'/script),str(root),template['toolRoot']] if engine=='libwasm' else [str(site/'scripts'/script),str(root),str(root/'frozen-harness'),engine]
    main_ok=False
    for attempt in range(3):
        code=run(args,'main',engine)
        status=read(root/('build-status.json' if go else 'libwasm-status.json' if engine=='libwasm' else engine+'-history-status.json'),{})
        done={x.get('pinKey') for x in status.get('completed',[]) if not any(e.get('kind')=='capture-error' for e in x.get('workloadErrors',[]))}
        expected={(engine if go or engine=='libwasm' else c)+'|'+pin['targetType']+'|'+(pin.get('tag') or pin['revision'])+'|'+pin['targetWeek'] for c in pin['configurations']}
        main_ok=code==0 and expected<=done
        if main_ok or stopping:break
        time.sleep(15)
    if stopping:break
    if engine=='wamr':
        preparation=run([str(site/'scripts/prepare-history-sdk.mjs'),str(root),'wamr','wamr','classic'],'prepare-classic',engine)
        if stopping:break
        if preparation:state['errors'].append({'engine':engine,'kind':'classic-profile-build','at':time.time()})
    current_config=read(root/'runner-config.json',config)
    code=run([str(site/'scripts/latest-feature-campaign.mjs'),str(root),str(root/'latest-features'),current_config['inputs']], 'features',engine,{'WASMFYI_FEATURE_ENGINES':','.join(pin['configurations'])})
    feature=read(root/'latest-features/status.json',{})
    markers=read(root/'latest-features/ledger.json',{}).get('completedEngines',[])
    feature_ok=(code==0 and feature.get('status') in ('completed','completed-with-errors')
                and bool(feature.get('inputIdentity'))
                and all(c+'|'+pin['revision']+'|'+feature['inputIdentity'] in markers for c in pin['configurations']))
    if main_ok and feature_ok:state['completed'].append(key)
    else:state['errors'].append({'engine':engine,'mainComplete':main_ok,'featuresComplete':feature_ok,'at':time.time()})
    save()
save(status='paused' if stopping else 'needs-repair' if state['errors'] else 'completed',stage=None,engine=None,childPid=None)
if not stopping and state['errors'] and state.get('repairRound',0)<2:
    save(status='waiting-repair-round',repairRound=state.get('repairRound',0)+1)
    time.sleep(30)
    os.execv(sys.executable,[sys.executable,str(Path(__file__).resolve()),str(root)])
