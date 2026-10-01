import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { command, digest, exists, installDirectory, site } from './wasmbench.mjs';

const relevant=['wasmedge','wasm3','wamr','chicory','spidermonkey','deno','wavm'];
async function tree(directory,relative='') {
  const files={};
  for(const entry of await readdir(join(directory,relative),{withFileTypes:true})) {
    const name=join(relative,entry.name);
    if(entry.isDirectory())Object.assign(files,await tree(directory,name));
    else if(name!=='build.json')files[name]=digest(await readFile(join(directory,name)));
  }
  return files;
}
export async function prepareFeatureTools(root,settings,ids) {
  if(!ids.some(id=>relevant.includes(id)))return;
  const platform=`${process.platform}-${process.arch}`,pins=settings.featureTools;
  if(!pins?.assets?.[platform])throw new Error('Feature toolchain is not pinned for '+platform);
  const target=join(homedir(),'.local/share/wasm-fyi/toolchains/features-v1-'+platform);
  const identity=digest(JSON.stringify(pins)+await readFile(fileURLToPath(import.meta.url),'utf8'));
  const ready=await exists(join(target,'build.json')) && JSON.parse(await readFile(join(target,'build.json')));
  if(ready && ready.identity===identity) {
    if(JSON.stringify(await tree(target))!==JSON.stringify(ready.files))throw new Error('Managed feature toolchain changed; restore its recorded build before collecting');
  } else {
    await mkdir(dirname(target),{recursive:true});
    const temp=await mkdtemp(join(dirname(target),'.features-build-')),sdk=join(temp,'sdk');
    try {
      await mkdir(sdk,{recursive:true});
      for(const [name,asset] of Object.entries({...pins.sources,...pins.assets[platform]})) {
        if(!/^https:\/\//.test(asset.url)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw new Error('Invalid pinned feature asset');
        const archive=join(temp,name+'.archive');command('curl',['--fail','--location','--retry','3','--max-time','180',asset.url,'-o',archive],{stdio:'inherit'});
        if(digest(await readFile(archive))!==asset.sha256)throw new Error('Changed feature asset: '+name);
        const destination=join(temp,name);await mkdir(destination,{recursive:true});
        if(asset.format==='jar')await cp(archive,join(sdk,name+'.jar'));
        else if(asset.format==='zip')command('unzip',['-q',archive,'-d',destination]);
        else command('tar',['-xzf',archive,...(name==='wasmedge'?[]:['--strip-components=1']),'-C',destination]);
      }
      for(const name of ['wasmedge','spidermonkey','deno'])await cp(join(temp,name),join(sdk,name),{recursive:true,verbatimSymlinks:true});
      if(await exists(join(sdk,'wasmedge/lib64')) && !await exists(join(sdk,'wasmedge/lib')))await cp(join(sdk,'wasmedge/lib64'),join(sdk,'wasmedge/lib'),{recursive:true,verbatimSymlinks:true});
      command('chmod',['+x',join(sdk,'spidermonkey/js'),join(sdk,'deno/deno')]);
      const wasm3Build=join(temp,'wasm3-build');
      command('cmake',['-S',join(temp,'wasm3'),'-B',wasm3Build,'-DCMAKE_BUILD_TYPE=Release','-DBUILD_WASI=none'],{stdio:'inherit'});
      command('cmake',['--build',wasm3Build,'--target','m3','-j','4'],{stdio:'inherit'});
      await mkdir(join(sdk,'wasm3/include'),{recursive:true});await mkdir(join(sdk,'wasm3/lib'),{recursive:true});
      for(const name of await readdir(join(temp,'wasm3/source')))if(name.endsWith('.h'))await cp(join(temp,'wasm3/source',name),join(sdk,'wasm3/include',name));
      await cp(join(wasm3Build,'source/libm3.a'),join(sdk,'wasm3/lib/libm3.a'));
      const wamrBuild=join(temp,'wamr-build');
      const flags=['-DCMAKE_BUILD_TYPE=Release','-DWAMR_BUILD_AOT=0','-DWAMR_DISABLE_STACK_HW_BOUND_CHECK=1','-DWAMR_BUILD_FAST_INTERP=0','-DWAMR_BUILD_GC=1','-DWAMR_BUILD_EXCE_HANDLING=1','-DWAMR_BUILD_LIBC_WASI=0','-DWAMR_BUILD_LIBC_BUILTIN=0','-DBUILD_SHARED_LIBS=ON'];
      command('cmake',['-S',join(temp,'wamr/product-mini/platforms',process.platform),'-B',wamrBuild,...flags],{stdio:'inherit'});
      command('cmake',['--build',wamrBuild,'--target','vmlib','-j','4'],{stdio:'inherit'});
      await mkdir(join(sdk,'wamr/include'),{recursive:true});await mkdir(join(sdk,'wamr/lib'),{recursive:true});
      for(const name of await readdir(join(temp,'wamr/core/iwasm/include')))if(name.endsWith('.h'))await cp(join(temp,'wamr/core/iwasm/include',name),join(sdk,'wamr/include',name));
      for(const name of await readdir(wamrBuild))if(/^libiwasm.*\.(dylib|so)(\.[\d.]+)?$/.test(name))await cp(join(wamrBuild,name),join(sdk,'wamr/lib',name),{dereference:true});
      await writeFile(join(sdk,'build.json'),JSON.stringify({schema:1,identity,pins,wamrFlags:flags,files:await tree(sdk)})+'\n');
      const finish=await installDirectory(sdk,target);await finish(false);
    } finally {await rm(temp,{recursive:true,force:true});}
  }
  process.env.WASMBENCH_WASMEDGE_SDK=join(target,'wasmedge');
  process.env.WASMBENCH_WASM3_SDK=join(target,'wasm3');process.env.WASMBENCH_WASM3_VERSION='0.5.0';
  process.env.WASMBENCH_WAMR_SDK=join(target,'wamr');process.env.WASMBENCH_WAMR_VERSION='2.4.5';
  process.env.WASMBENCH_SPIDERMONKEY=join(target,'spidermonkey/js');process.env.WASMBENCH_DENO=join(target,'deno/deno');
  if(ids.includes('wavm')) {
    process.env.WASMBENCH_WAVM_SDK ||= join(root,'.wasmbench/extra-sdk/wavm');
    process.env.WASMBENCH_WAVM_VERSION ||= '0.0.0-prerelease';
    if(!await exists(join(process.env.WASMBENCH_WAVM_SDK,'include/WAVM/wavm-c/wavm-c.h')))throw new Error('Install a WAVM SDK or set WASMBENCH_WAVM_SDK; no alternate engine will be substituted');
  }
  if(ids.includes('chicory')) {
    const java=process.env.WASMBENCH_JAVA || (process.platform==='darwin'?'/opt/homebrew/opt/openjdk@25/bin/java':'java');
    process.env.WASMBENCH_JAVA=await realpath(command('which',[java]).toString().trim());
    command(process.env.WASMBENCH_JAVA,['--version']);
    const javaDirectory=dirname(process.env.WASMBENCH_JAVA),classes=await mkdtemp(join(target,'.java-build-'));
    try {
      const jars=['chicory-runtime','chicory-wasm','json'].map(name=>join(target,name+'.jar'));
      for(const jar of jars)command('unzip',['-oq',jar,'-d',classes]);
      await rm(join(classes,'META-INF'),{recursive:true,force:true});await rm(join(classes,'module-info.class'),{force:true});
      command(join(javaDirectory,'javac'),['--release','21','-cp',jars.join(':'),'-d',classes,join(site,'adapters/features/ChicoryAdapter.java')]);
      await mkdir(join(root,'bin'),{recursive:true});
      command(join(javaDirectory,'jar'),['--create','--file',join(root,'bin/adapter-chicory.jar'),'--main-class','ChicoryAdapter','-C',classes,'.']);
    } finally {await rm(classes,{recursive:true,force:true});}
  }
  console.log('Verified isolated feature SDKs and shells: '+target);
}
