import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {command,exists} from './wasmbench.mjs';

export const releasedBuild = release => !release.draft && !!release.published_at && !/^(main|master|HEAD|latest)$/i.test(release.tag_name) && !/nightly|snapshot|canary|(?:^|[-/])dev(?:[-/]|$)/i.test(release.tag_name);
export function latestRelease(releases,asOf=new Date().toISOString()) {
  const cutoff=+new Date(asOf);
  if(!Number.isFinite(cutoff))throw Error('Invalid release cutoff');
  return releases.filter(releasedBuild).filter(r=>Number.isFinite(+new Date(r.published_at)) && +new Date(r.published_at)<=cutoff).sort((a,b)=>+new Date(b.published_at)-+new Date(a.published_at))[0] || null;
}
export const parseReleasePages=output=>output.trim().split('\n').filter(Boolean).flatMap(line=>JSON.parse(line));
export const githubReleases=repository=>parseReleasePages(command('gh',['api','--paginate',`repos/${repository}/releases?per_page=100`,'--jq','. | tojson']).toString());
export const releaseCache=()=>process.env.WASMBENCH_RELEASE_CACHE || join(homedir(),'.cache/wasm-fyi/releases');
export async function releaseSource(repository,{tag,asOf,taggedLibrary=false}={}) {
  let candidates;
  if(taggedLibrary){
    if(asOf)throw Error('Historical plugin snapshots require verified publication dates; Go module tag commit times are insufficient.');
    const info=JSON.parse(command('go',['list','-m','-json',`github.com/${repository}@latest`],{env:{...process.env,GOWORK:'off',GOFLAGS:''}}).toString());
    if(!/^v[0-9]+\.[0-9]+\.[0-9]+(?:[-+].*)?$/.test(info.Version) || /-[0-9]{14}-[a-f0-9]+$/.test(info.Version))throw Error('Plugin has no released module version');
    candidates=[{tag_name:info.Version,published_at:info.Time,draft:false,prerelease:info.Version.includes('-'),html_url:`https://github.com/${repository}/tree/${info.Version}`}];
  }else candidates=githubReleases(repository);
  const release=tag?candidates.find(r=>r.tag_name===tag && releasedBuild(r)):latestRelease(candidates,asOf);
  if(!release)throw Error(`No published non-development release for ${repository}${tag?' at '+tag:''}`);
  const source=join(releaseCache(),repository.replace('/','-'),release.tag_name.replaceAll('/','-'));
  await mkdir(source,{recursive:true});
  const url=`https://github.com/${repository}.git`;
  if(!await exists(join(source,'.git'))){command('git',['init',source]);command('git',['-C',source,'remote','add','origin',url]);}
  if(command('git',['-C',source,'remote','get-url','origin']).toString().trim()!==url)throw Error('Release checkout remote differs');
  const changes=command('git',['-C',source,'status','--porcelain','--untracked-files=no']).toString();
  if(changes)throw Error('Release checkout contains tracked changes: '+source);
  command('git',['-C',source,'fetch','--depth','1','--filter=blob:none','origin',`refs/tags/${release.tag_name}`],{stdio:'inherit'});
  const revision=command('git',['-C',source,'rev-parse','FETCH_HEAD^{commit}']).toString().trim();
  const receipt=join(source,'.git/wasm-fyi-release.json');
  if(await exists(receipt) && JSON.parse(await readFile(receipt)).revision!==revision)throw Error('Published release tag moved: '+release.tag_name);
  command('git',['-C',source,'checkout','--detach',revision],{stdio:'inherit'});
  const pin={repository,tag:release.tag_name,revision,publishedAt:release.published_at,prerelease:release.prerelease,source,url:release.html_url};
  await writeFile(receipt,JSON.stringify(pin)+'\n');
  return pin;
}
export function assertReleasedSource(source,receipt) {
  const extra=command('git',['-C',source,'ls-files','--others','--exclude-standard']).toString().split('\n').filter(p=>/\.(go|rs|c|h|cc|cpp|s|S)$/.test(p));
  if(extra.length)throw Error('Release checkout contains untracked source inputs: '+extra.join(', '));
  if(command('git',['-C',source,'rev-parse','HEAD']).toString().trim()!==receipt.revision || command('git',['-C',source,'status','--porcelain','--untracked-files=no']).length)throw Error('Engine source is not the recorded clean release');
}
