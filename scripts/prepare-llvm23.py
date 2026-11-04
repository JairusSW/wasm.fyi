#!/usr/bin/env python3
"""Fetch hash-verified LLVM 23 SDK packages into a private, unprivileged prefix."""
import argparse,gzip,hashlib,json,subprocess
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('prefix',type=Path);parser.add_argument('--distribution',default='focal');parser.add_argument('--download-only',action='store_true');parser.add_argument('--install-cached',action='store_true');args=parser.parse_args()
prefix=args.prefix.resolve();cache=prefix/'packages';cache.mkdir(parents=True,exist_ok=True)
if args.install_cached:
 for item in json.loads((prefix/'sdk-packages.json').read_text()):
  path=Path(item['path'])
  if path.parent!=cache or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:raise SystemExit('Cached package identity differs')
  subprocess.run(['dpkg-deb','-x',str(path),str(prefix)],check=True)
 subprocess.run([str(prefix/'usr/lib/llvm-23/bin/llvm-config'),'--version'],check=True)
 raise SystemExit(0)
base='https://apt.llvm.org/'+args.distribution+'/'
index=cache/'Packages.gz'
def fetch(url,path):subprocess.run(['curl','--fail','--silent','--show-error','--location','--retry','3','--max-time','600',url,'-o',str(path)],check=True)
fetch(base+'dists/llvm-toolchain-'+args.distribution+'-23/main/binary-amd64/Packages.gz',index)
packages={}
for stanza in gzip.decompress(index.read_bytes()).decode().split('\n\n'):
 fields={}
 for line in stanza.splitlines():
  if line and not line[0].isspace() and ': ' in line:
   key,value=line.split(': ',1);fields[key]=value
 if 'Package' in fields:packages[fields['Package']]=fields
names=['libllvm23','llvm-23','llvm-23-dev','llvm-23-runtime','llvm-23-linker-tools','libpolly-23-dev']
receipt=[]
for name in names:
 item=packages[name];path=cache/Path(item['Filename']).name
 if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()!=item['SHA256']:fetch(base+item['Filename'],path)
 if hashlib.sha256(path.read_bytes()).hexdigest()!=item['SHA256']:raise SystemExit('Package digest mismatch: '+name)
 receipt.append({'package':name,'version':item['Version'],'sha256':item['SHA256'],'path':str(path)})
 print(json.dumps(receipt[-1]),flush=True)
 if not args.download_only:subprocess.run(['dpkg-deb','-x',str(path),str(prefix)],check=True)
(prefix/'sdk-packages.json').write_text(json.dumps(receipt,indent=2)+'\n')
if not args.download_only:subprocess.run([str(prefix/'usr/lib/llvm-23/bin/llvm-config'),'--version'],check=True)
