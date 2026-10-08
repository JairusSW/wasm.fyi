"""Import completed compact captures while detached host jobs keep running."""
import argparse, pathlib, subprocess, time
p=argparse.ArgumentParser();p.add_argument('--site',default=str(pathlib.Path(__file__).resolve().parent.parent));p.add_argument('--hub',default='hub@hub');p.add_argument('--hub-root',default='/home/hub/.cache/wasm-fyi');a=p.parse_args();site=pathlib.Path(a.site);root=site/'.wasmfyi/local'
while True:
 for name in ['release-five-20261008']:
  destination=root/name/'hub';destination.mkdir(parents=True,exist_ok=True)
  cmd=['rsync','-a','--include=captures/','--include=captures/*.json','--include=status.json','--exclude=*','-e','ssh -o BatchMode=yes -o ConnectTimeout=10 -o ControlMaster=auto -o ControlPersist=24h -o ControlPath=/tmp/wasmfyi-hub-%C',a.hub+':'+a.hub_root+'/'+name+'/',str(destination)+'/']
  try:
   result=subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=30)
   if result.returncode:print('Hub import will retry:',result.stderr.decode()[-300:],flush=True)
  except (subprocess.TimeoutExpired,OSError) as error:print('Hub import will retry:',type(error).__name__,flush=True)
 for name in ['release-five-20261008']:
  destination=root/name/'remote';destination.mkdir(parents=True,exist_ok=True)
  cmd=['rsync','-a','--include=captures/','--include=captures/*.json','--include=status.json','--exclude=*','-e','ssh -o BatchMode=yes -o ConnectTimeout=10 -o ControlMaster=auto -o ControlPersist=24h -o ControlPath=/tmp/wasmfyi-remote-%C','root@remote:/root/.cache/wasm-fyi/'+name+'/',str(destination)+'/']
  try:
   result=subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=30)
   if result.returncode:print('Remote import will retry:',result.stderr.decode()[-300:],flush=True)
  except (subprocess.TimeoutExpired,OSError) as error:print('Remote import will retry:',type(error).__name__,flush=True)
 try:
  result=subprocess.run(['node',str(root/'publish-collected.mjs')],cwd=site,capture_output=True,text=True,timeout=180)
  print(result.stdout.strip() if result.returncode==0 else result.stderr[-500:],flush=True)
 except (subprocess.TimeoutExpired,OSError) as error:print('Local publication will retry:',type(error).__name__,flush=True)
 time.sleep(20)
