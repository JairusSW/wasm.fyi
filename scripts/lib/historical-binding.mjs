import {readFile,writeFile,mkdir,cp,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {command,digest,exists} from './wasmbench.mjs';
import {releaseSource,assertReleasedSource} from './release-policy.mjs';
import {patchHarness} from './harness-patch.mjs';

export function engineVersion(pin) {
  const version=pin.tag.replace(/^v/,'');
  if(!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))throw Error('Release needs an explicit SDK version mapping: '+pin.tag);
  return version;
}

export async function copyHistoricalHarness(base,root) {
  if(await exists(root))throw Error('Historical build directory already exists: '+root);
  await mkdir(dirname(root),{recursive:true});
  command('git',['clone','--no-hardlinks','--no-checkout','--local',base,root],{stdio:'inherit'});
  const files=command('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:base}).toString().split('\0').filter(Boolean);
  for(const path of files) {
    if(path.startsWith('/') || path.split('/').includes('..'))throw Error('Unsafe harness input: '+path);
    await mkdir(dirname(join(root,path)),{recursive:true});
    await cp(join(base,path),join(root,path),{dereference:true});
  }
  // Keep independent artifact admission fixed while changing the measured SDK.
  const analyzer='adapters/wasmtime/target/release/wasm-analyze';
  await mkdir(dirname(join(root,analyzer)),{recursive:true});
  await cp(join(base,analyzer),join(root,analyzer));
  patchHarness(root);
}

export async function buildHistoricalBinding({root,pin,configuration,invoke,env}) {
  if(!pin.configurations.includes(configuration))throw Error('Configuration is not part of this release job');
  const version=engineVersion(pin);
  const replace=async(path,old,value)=>{
    const file=join(root,path),source=await readFile(file,'utf8');
    if(!source.includes(old))throw Error('Historical adapter version anchor missing: '+path);
    await writeFile(file,source.replaceAll(old,value));
  };
  const replaceSourceTree=async(directory,extension,old)=>{
    for(const entry of await readdir(join(root,directory),{withFileTypes:true})) {
      const path=join(directory,entry.name);
      if(entry.isDirectory())await replaceSourceTree(path,extension,old);
      else if(path.endsWith(extension)) {
        const source=await readFile(join(root,path),'utf8');
        if(source.includes(old))await writeFile(join(root,path),source.replaceAll(old,version));
      }
    }
  };
  const cargoReceipt=async(path,name)=>{
    const lock=await readFile(join(root,path),'utf8');
    const packages=lock.split('[[package]]').filter(block=>new RegExp('(?:^|\\n)name = "'+name+'"(?:\\n|$)').test(block));
    if(packages.length!==1 || !packages[0].includes('version = "'+version+'"'))throw Error('Historical Cargo SDK differs from its selected release');
    return {sdk:name,version,lockSha256:digest(lock)};
  };
  let source;
  if(pin.engine==='wago') {
    source=await releaseSource(pin.repository,{tag:pin.tag});
    if(source.publishedAt!==pin.publishedAt)throw Error('Wago publication metadata changed since planning');
    assertReleasedSource(source.source,source);
    invoke('build','--runtimes',configuration,'--wago-source',source.source);
    assertReleasedSource(source.source,source);
  } else if(pin.engine==='wazero') {
    await replaceSourceTree('adapters/wazero','.go','1.12.0');
    // The controller and its oracle keep their original module graph. Only the
    // adapter gets the historical dependency, using a separate Go modfile.
    const mod=join(root,'historical-wazero.mod');
    await cp(join(root,'go.mod'),mod);await cp(join(root,'go.sum'),mod.replace(/\.mod$/,'.sum'));
    command('go',['mod','edit','-modfile='+mod,'-require=github.com/tetratelabs/wazero@'+pin.tag],{cwd:root,env});
    const receipt=JSON.parse(command('go',['mod','download','-json','github.com/tetratelabs/wazero@'+pin.tag],{cwd:root,env}).toString());
    if(receipt.Version!==pin.tag || !receipt.Sum)throw Error('Historical wazero module identity differs');
    command('go',['build','-mod=mod','-modfile='+mod,'-trimpath','-o',join(root,'bin/adapter-wazero'),'./adapters/wazero'],{cwd:root,env,stdio:'inherit'});
    const info=command('go',['version','-m',join(root,'bin/adapter-wazero')],{env}).toString();
    if(!info.includes('github.com/tetratelabs/wazero\t'+pin.tag+'\t'+receipt.Sum))throw Error('Built wazero adapter has a different module graph');
    source={module:'github.com/tetratelabs/wazero',version:receipt.Version,sum:receipt.Sum,goModSum:receipt.GoModSum};
  } else if(pin.engine==='wasmtime') {
    await replace('adapters/wasmtime/Cargo.toml','=46.0.1','='+version);
    await replaceSourceTree('adapters/wasmtime/src','.rs','46.0.1');
    command('cargo',['update','--manifest-path',join(root,'adapters/wasmtime/Cargo.toml'),'-p','wasmtime','--precise',version],{cwd:root,env,stdio:'inherit'});
    invoke('build','--runtimes',configuration);
    source=await cargoReceipt('adapters/wasmtime/Cargo.lock','wasmtime');
  } else if(pin.engine==='wasmi') {
    await replace('adapters/native/Cargo.toml','=2.0.0','='+version);
    await replace('adapters/native/src/wasmi.rs','2.0.0',version);
    command('cargo',['update','--manifest-path',join(root,'adapters/native/Cargo.toml'),'-p','wasmi','--precise',version],{cwd:root,env,stdio:'inherit'});
    invoke('build','--runtimes',configuration);
    source=await cargoReceipt('adapters/native/Cargo.lock','wasmi');
  } else {
    const error=Error('A release-specific performance build binding is still required for '+pin.engine+' '+pin.tag);
    error.code='BINDING_PENDING';throw error;
  }
  return {engine:pin.engine,version,release:pin,source,configuration,created:new Date().toISOString()};
}

export function assertHistoricalRuntime(runtime,binding) {
  if(runtime.id!==binding.configuration)throw Error('Historical configuration does not match its release binding');
  const actual=runtime.description?.runtime_version;
  if(binding.engine==='wago') {
    if(!actual?.startsWith(binding.source.revision+'/source-'))throw Error('Historical Wago source differs from its release');
  } else if(actual!==binding.version)throw Error('Historical engine version differs from its release: '+actual+' != '+binding.version);
  if(binding.engine==='wazero' && !runtime.description?.effective_configuration?.compile_policy?.startsWith('fresh uncached module per operation;'))throw Error('Historical wazero has no fresh compile policy');
}
