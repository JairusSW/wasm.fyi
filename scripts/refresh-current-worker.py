#!/usr/bin/env python3
"""Reload supervisor code at the next completed engine stage, preserving its child."""
import json,os,signal,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]);mode=sys.argv[2]
s=json.loads((root/'fleet-worker.json').read_text());pid=s['pid']
p=subprocess.run(['ps','-p',str(pid),'-o','command='],capture_output=True,text=True)
if p.returncode or 'run-current-campaign.py' not in p.stdout:raise SystemExit('Supervisor identity changed')
os.kill(pid,signal.SIGSTOP)
try:
 s=json.loads((root/'fleet-worker.json').read_text());child=s.get('childPid')
 while child:
  p=subprocess.run(['ps','-p',str(child),'-o','stat='],capture_output=True,text=True)
  if p.returncode or p.stdout.strip().startswith('Z'):break
  time.sleep(1)
 hook=root/'refresh-before-restart.json'
 if hook.exists():
  for command in json.loads(hook.read_text()):subprocess.run(command,check=True)
  hook.rename(root/'refresh-before-restart.completed.json')
 if mode=='local':
  os.kill(pid,signal.SIGKILL)
  log=(root/'supervisor.log').open('ab',buffering=0)
  child=subprocess.Popen([sys.executable,str(Path(__file__).with_name('run-current-campaign.py')),str(root)],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
  subprocess.Popen(['/usr/bin/caffeinate','-i','-w',str(child.pid)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
 else:
  command=['systemctl']+(['--user'] if mode=='user' else [])
  # The old stage is terminal; killing the supervisor cannot interrupt a capture.
  os.kill(pid,signal.SIGKILL)
  subprocess.run(command+['restart','wasmfyi-current-week-20261024.service'],check=True)
 print('Supervisor refreshed after stage completion',flush=True)
except BaseException:
 try:os.kill(pid,signal.SIGCONT)
 except ProcessLookupError:pass
 raise
