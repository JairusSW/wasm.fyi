import {readFile,mkdir,lstat,cp,writeFile,stat,rm,readlink,symlink} from 'node:fs/promises';
import {join,resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const gitRaw=(root,args)=>execFileSync('git',['-C',root,...args],{maxBuffer:32<<20,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const git=(root,args)=>gitRaw(root,args).trim();
export async function snapshotSource(path,cache){
 const root=resolve(path),base=git(root,['rev-parse','HEAD']);
 const files=[];
 const gather=async(directory,prefix='')=>{
  for(const name of [...new Set(gitRaw(directory,['ls-files','-z','--cached','--others','--exclude-standard']).split('\0').filter(Boolean))].sort()){
   const info=await lstat(join(directory,name)).catch(()=>null);
   if(info?.isDirectory()){
    // Flatten initialized submodules, including their uncommitted source changes.
    if(await stat(join(directory,name,'.git')).catch(()=>null))await gather(join(directory,name),prefix+name+'/');
    else files.push(prefix+name+'/');
   }else files.push(prefix+name);
  }
 };
 await gather(root);
 const entries=[],hash=createHash('sha256');hash.update(base+'\0');
 for(const name of files){
  if(name.endsWith('/')||name.split('/').some(p=>p==='.git'||p==='node_modules'||p==='target')||/(^|\/)(?:\.env(?:\..*)?|prod\.env|local\.env|\.npmrc|\.netrc|\.pypirc|credentials|[^/]*\.key|[^/]*\.pem|id_rsa|id_ed25519)$/.test(name))continue;
  const file=join(root,name),info=await lstat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e});
  if(!info){hash.update(name+'\0deleted\0');continue}
  if(info.isDirectory())throw Error(`Local submodule ${name} must be flattened into declared source inputs before snapshotting`);
  if(info.isSymbolicLink()){
   const target=await readlink(file),destination=relative(root,resolve(dirname(file),target));
   if(target.startsWith('/')||destination==='..'||destination.startsWith('../'))throw Error('Source symlink escapes the checkout: '+name);
   hash.update(name+'\0symlink\0'+target+'\0');entries.push({name,target});continue;
  }
  if(!info.isFile())throw Error('Unsupported local source input: '+name);
  const bytes=await readFile(file);hash.update(name+'\0'+String(info.mode&0o777)+'\0').update(bytes);entries.push({name,bytes,mode:info.mode});
 }
 const digest=hash.digest('hex'),snapshot=join(cache,'sources','local-'+digest);
 if(await stat(join(snapshot,'.git')).catch(()=>null)){if(git(snapshot,['status','--porcelain']))throw Error('Cached source snapshot was modified: '+snapshot);return {path:snapshot,digest,base,revision:git(snapshot,['rev-parse','HEAD']),local:true}};
 const stage=snapshot+'.prepare-'+process.pid;await mkdir(stage,{recursive:true});
 try{
  for(const f of entries){const p=join(stage,f.name);await mkdir(dirname(p),{recursive:true});if(f.target!==undefined)await symlink(f.target,p);else await writeFile(p,f.bytes,{mode:f.mode&0o777})}
  git(stage,['init']);git(stage,['add','-A']);
  const env={...process.env,GIT_AUTHOR_DATE:'2000-01-01T00:00:00Z',GIT_COMMITTER_DATE:'2000-01-01T00:00:00Z'};
  execFileSync('git',['-C',stage,'-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','-c','user.name=wasmfyi local snapshot','-c','user.email=local@localhost','commit','--allow-empty','-qm','Snapshot '+base+' '+digest],{env,stdio:'pipe'});
  const {rename}=await import('node:fs/promises');await rename(stage,snapshot);
 }catch(error){await rm(stage,{recursive:true,force:true});throw error}
 return {path:snapshot,digest,base,revision:git(snapshot,['rev-parse','HEAD']),local:true};
}
export async function checkoutSource(engine,cache,{offline=false}={}){
 const metadata=join(cache,'resolutions',engine.id+'-'+createHash('sha256').update(engine.ref).digest('hex')+'.json');
 let resolved;
 if(offline){resolved=JSON.parse(await readFile(metadata,'utf8').catch(()=>{throw Error('No cached source resolution for '+engine.id+'@'+engine.ref)}))}
 else {
  const headers={'User-Agent':'wasmfyi-local-cli',Accept:'application/vnd.github+json',...(process.env.GH_TOKEN||process.env.GITHUB_TOKEN?{Authorization:'Bearer '+(process.env.GH_TOKEN||process.env.GITHUB_TOKEN)}:{})};
  const get=async suffix=>{const response=await fetch('https://api.github.com/repos/'+engine.repository+suffix,{headers,signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`GitHub source resolution for ${engine.id} returned ${response.status}`);return response.json()};
  let ref=engine.ref,tag;
  if(ref==='latest'){
   const releases=await get('/releases?per_page=100');const release=releases.filter(r=>!r.draft&&(engine.family==='wago'?/beta/i.test(r.tag_name):!r.prerelease&&!/nightly|snapshot|canary/i.test(r.tag_name))).sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at))[0];
   if(release){tag=release.tag_name;ref=tag}else ref=(await get('')).default_branch;
  }else if(ref==='main')ref=(await get('')).default_branch;
  else if(!/^[a-f0-9]{40}$/i.test(ref))tag=ref;
  let commit;try{commit=await get('/commits/'+encodeURIComponent(ref))}catch(error){if(!tag||tag.startsWith('v'))throw error;tag='v'+tag;commit=await get('/commits/'+encodeURIComponent(tag))}
  resolved={revision:commit.sha,tag,repository:engine.repository};await mkdir(dirname(metadata),{recursive:true});await writeFile(metadata,JSON.stringify(resolved));
 }
 const path=join(cache,'sources',engine.family+'-'+resolved.revision);
 if(!await stat(join(path,'.git')).catch(()=>null)){
  if(offline)throw Error('Source is not cached: '+engine.id+'@'+resolved.revision);
  await mkdir(path,{recursive:true});git(path,['init']);git(path,['remote','add','origin','https://github.com/'+engine.repository+'.git']);
  execFileSync('git',['-C',path,'fetch','--depth=1','origin',resolved.revision],{stdio:['ignore',2,2]});git(path,['checkout','--detach',resolved.revision]);
 }
 if(git(path,['rev-parse','HEAD'])!==resolved.revision)throw Error('Cached source pin differs');
 return {path,digest:resolved.revision,base:resolved.revision,...resolved};
}
