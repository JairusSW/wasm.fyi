// Download compilers, not corpus executables. Release archive digests are pinned.
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { platform, arch } from 'node:os';
import { command, digest, exists, site } from './lib/wasmbench.mjs';
const assets={
  'darwin-arm64':['arm64-macos','9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9'],
  'darwin-x64':['x86_64-macos','87d27fa8adc68dee59bfbf2e22a6d34ef717c34d6bf1d8af2a56fc929d9ce0eb'],
  'linux-x64':['x86_64-linux','b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4'],
  'linux-arm64':['arm64-linux','f7e243dff54d60bcc576e94d6166b69f410f2500ae4a9ceef34315be10e77971']
};
const item=assets[platform()+'-'+arch()];if(!item)throw Error('Unsupported WASI SDK host');
const [host,sha256]=item,name='wasi-sdk-34.0-'+host;
const root=join(site,'.wasmbench/toolchains'),destination=join(root,name),archive=join(root,name+'.tar.gz');
await mkdir(root,{recursive:true});
if(!await exists(destination)) {
  command('curl',['--fail','--location','--retry','3','https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/'+name+'.tar.gz','-o',archive],{stdio:'inherit',timeout:30*60_000});
  if(digest(await readFile(archive))!==sha256)throw Error('WASI SDK archive digest mismatch');
  const stage=join(root,name+'-staged-'+process.pid);await mkdir(stage);
  try{command('tar',['-xzf',archive,'--strip-components=1','-C',stage],{stdio:'inherit'});await rename(stage,destination);}finally{await rm(stage,{recursive:true,force:true});}
  await writeFile(join(destination,'wasm-fyi-build.json'),JSON.stringify({version:'34.0',sha256})+'\n');
}
const version=command(join(destination,'bin/clang'),['--version']).toString();
if(!version.includes('23.1.0-wasi-sdk'))throw Error('Unexpected WASI SDK compiler');
console.log(destination);
