import { cp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { randomUUID } from 'node:crypto';
import { command, config, digest, exists, locked, site } from './lib/wasmbench.mjs';
import {wasmerRelease} from './lib/wasmer-release.mjs';

const action = process.argv[2] || 'local';
const pin=wasmerRelease(process.env.WASMBENCH_WASMER_VERSION);
if (action === 'hub') {
  const { hosts } = await config();
  const host = hosts.hub;
  if (!/^[a-zA-Z0-9_.@-]+$/.test(host.ssh) || !/^[a-zA-Z0-9_./-]+$/.test(host.workspace) || host.workspace.startsWith('/') || host.workspace.includes('..')) throw new Error('Invalid Hub toolchain host settings');
  const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
  const sockets = join(homedir(), '.cache/wasm-fyi/ssh'); await mkdir(sockets, { recursive: true });
  const options = ['-o','BatchMode=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','ControlMaster=auto','-o','ControlPersist=86400','-o','ControlPath=' + join(sockets,digest(Buffer.from(site)).slice(0,12))];
  const remote = host.workspace + '/wasmer-sdk-' + randomUUID();
  const ssh = (script, timeout=120_000) => command('ssh',[...options,host.ssh,'bash -lc ' + quote(script)],{timeout,stdio:'inherit'});
  ssh('set -eu; mkdir -p ' + [remote+'/scripts/lib',remote+'/.wasmbench'].map(quote).join(' '));
  const copy = (files,target) => command('rsync',['-a','-e',['ssh',...options.map(quote)].join(' '),...files,host.ssh+':'+remote+'/'+target],{stdio:'inherit',timeout:120_000});
  copy([join(site,'scripts/wasmer-sdk.mjs'),join(site,'scripts/llvm-toolchain.mjs')],'scripts/');
  copy([join(site,'scripts/lib/wasmbench.mjs'),join(site,'scripts/lib/wasmer-release.mjs')],'scripts/lib/');
  ssh(`export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"; export WASMBENCH_WASMER_VERSION=${quote(pin.version)}; set -eu; exec 9>"$HOME/${host.workspace}/measurement.lock"; flock -w 3600 9; cd ${quote(remote)}; node scripts/llvm-toolchain.mjs; node scripts/wasmer-sdk.mjs local`,150*60_000);
} else if (action === 'local') await locked(async () => {
  const root=join(homedir(),`.local/share/wasm-fyi/toolchains/wasmer-c-api-${pin.version}`);
  const source=join(root,'source');
  const {revision}=pin;
  const llvm=resolve(process.env.WASMBENCH_LLVM_PREFIX || (platform()==='darwin'?'/opt/homebrew/opt/llvm@22':join(homedir(),'.local/share/wasm-fyi/toolchains/llvm-22')));
  const llvmVersion=command(join(llvm,'bin/llvm-config'),['--version']).toString().trim();
  if(!llvmVersion.startsWith(pin.llvm+'.'))throw new Error(`Wasmer ${pin.version} LLVM requires an LLVM ${pin.llvm} prefix; set WASMBENCH_LLVM_PREFIX`);
  await mkdir(root,{recursive:true});
  let llvmBuildPrefix=llvm;
  let compatibility=null;
  const buildEnv={...process.env};
  if(platform()==='linux') {
    const flags=command(join(llvm,'bin/llvm-config'),['--system-libs','--link-static']).toString().trim();
    const missing='/usr/lib/x86_64-linux-gnu/libzstd.a';
    if(flags.split(/\s+/).includes(missing) && !await exists(missing)) {
      // The official archive records its build host's static zstd path. Link
      // the installed shared zstd instead, through an owned linker symlink.
      const library=await realpath('/usr/lib/x86_64-linux-gnu/libzstd.so.1');
      const compat=join(root,'llvm-compat');
      await mkdir(join(compat,'bin'),{recursive:true});await mkdir(join(compat,'lib'),{recursive:true});
      const link=join(compat,'lib/libzstd.so');
      if(await exists(link)){if(await realpath(link)!==library)throw new Error('LLVM compatibility zstd link differs');}
      else await symlink(library,link);
      const wrapper='#!/bin/sh\nset -eu\nout=$("$WASMBENCH_LLVM_CONFIG" "$@")\ncase " $* " in *" --system-libs "*) printf "%s\\n" "$out" | sed "s@/usr/lib/x86_64-linux-gnu/libzstd.a@-lzstd@g" ;; *) printf "%s\\n" "$out" ;; esac\n';
      const wrapperPath=join(compat,'bin/llvm-config');
      const existingWrapper=await readFile(wrapperPath,'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
      if(existingWrapper!==wrapper)await writeFile(wrapperPath,wrapper,{mode:0o755});
      llvmBuildPrefix=compat;
      buildEnv.WASMBENCH_LLVM_CONFIG=join(llvm,'bin/llvm-config');
      buildEnv.RUSTFLAGS=(buildEnv.RUSTFLAGS || '')+' -Lnative='+join(compat,'lib');
      compatibility={reason:'Official LLVM archive references a missing build-host static zstd library; use host shared zstd',originalSystemLibraries:flags,wrapper,wrapperSha256:digest(Buffer.from(wrapper)),library,librarySha256:digest(await readFile(library)),rustflags:buildEnv.RUSTFLAGS};
    }
  }
  if(!await exists(source))command('git',['clone','--depth','1','--branch',pin.tag,'https://github.com/wasmerio/wasmer.git',source],{stdio:'inherit'});
  if(command('git',['rev-parse','HEAD'],{cwd:source}).toString().trim()!==revision)throw new Error('Wasmer source revision differs from the pinned release');
  command('git',['submodule','update','--init','--depth','1','lib/napi'],{cwd:source,stdio:'inherit'});
  const napi=command('git',['rev-parse','HEAD:lib/napi'],{cwd:source}).toString().trim();
  const assertSource = () => {
    if(command('git',['rev-parse','HEAD'],{cwd:source}).toString().trim()!==revision)throw new Error('Managed Wasmer source changed release revision');
    if(command('git',['status','--porcelain','--untracked-files=no'],{cwd:source}).toString().trim())throw new Error('Managed Wasmer source has tracked modifications');
    if(command('git',['-C','lib/napi','rev-parse','HEAD'],{cwd:source}).toString().trim()!==napi)throw new Error('Wasmer NAPI submodule differs from its pinned gitlink');
  };
  assertSource();
  // wasm_config_new constructs a Cranelift configuration before the caller can
  // explicitly select LLVM or Singlepass. Its constructor must be compiled in.
  const features='sys-default,cranelift,llvm,singlepass,wasi,wasmer-artifact-create,wasmer-artifact-load';
  const argv=['build','--manifest-path',join(source,'lib/c-api/Cargo.toml'),'--release','--locked','--no-default-features','--features',features];
  command('cargo',argv,{stdio:'inherit',timeout:30*60*1000,env:{...buildEnv,LLVM_SYS_221_PREFIX:llvmBuildPrefix,CARGO_TARGET_DIR:join(root,'target')}});
  assertSource();
  const sdk=join(root,'sdk');await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
  for(const [from,to] of [['lib/c-api/wasmer.h','wasmer.h'],['lib/c-api/tests/wasm-c-api/include/wasm.h','wasm.h']])await cp(join(source,from),join(sdk,'include',to));
  const libraryName=platform()==='darwin'?'libwasmer.dylib':'libwasmer.so';
  const library=join(sdk,'lib',libraryName);await cp(join(root,'target/release',libraryName),library);
  await cp(join(source,'LICENSE'),join(sdk,'LICENSE'));
  await writeFile(join(sdk,'build.json'),JSON.stringify({schema:1,version:pin.version,source:'https://github.com/wasmerio/wasmer',revision,
    submodules:command('git',['submodule','status','lib/napi'],{cwd:source}).toString().trim(),
    lockSha256:digest(await readFile(join(source,'Cargo.lock'))),features,argv:['cargo',...argv],
    rust:command('rustc',['--version']).toString().trim(),cargo:command('cargo',['--version']).toString().trim(),llvm:{prefix:llvm,buildPrefix:llvmBuildPrefix,version:llvmVersion,compatibility,
      distribution:await exists(join(llvm,'wasm-fyi-build.json'))?JSON.parse(await readFile(join(llvm,'wasm-fyi-build.json'))):null},library:libraryName,librarySha256:digest(await readFile(library))},null,2)+'\n');
  console.log('Isolated native LLVM/Singlepass/WASI SDK built: '+sdk+'; validate with just wasmer-preflight');
},'wasmer-sdk');
else throw new Error('Usage: wasmer-sdk.mjs local|hub');
