import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { command, digest, exists, locked } from './lib/wasmbench.mjs';

await locked(async () => {
  const root=join(homedir(),'.local/share/wasm-fyi/toolchains/wasmer-c-api-7.3.0');
  const source=join(root,'source');
  const revision='35c10644f7b0aad6fd9458624ceb8429fe7413c4';
  const llvm=resolve(process.env.WASMBENCH_LLVM_PREFIX || (platform()==='darwin'?'/opt/homebrew/opt/llvm@22':join(homedir(),'.local/share/wasm-fyi/toolchains/llvm-22')));
  const llvmVersion=command(join(llvm,'bin/llvm-config'),['--version']).toString().trim();
  if(!llvmVersion.startsWith('22.1.'))throw new Error('Wasmer 7.3.0 LLVM requires an LLVM 22.1 prefix; set WASMBENCH_LLVM_PREFIX');
  await mkdir(root,{recursive:true});
  if(!await exists(source))command('git',['clone','--depth','1','--branch','v7.3.0','https://github.com/wasmerio/wasmer.git',source],{stdio:'inherit'});
  if(command('git',['rev-parse','HEAD'],{cwd:source}).toString().trim()!==revision)throw new Error('Wasmer source revision differs from the pinned release');
  command('git',['submodule','update','--init','--depth','1','lib/napi'],{cwd:source,stdio:'inherit'});
  // wasm_config_new constructs a Cranelift configuration before the caller can
  // explicitly select LLVM or Singlepass. Its constructor must be compiled in.
  const features='sys-default,cranelift,llvm,singlepass,wasi,wasmer-artifact-create,wasmer-artifact-load';
  const argv=['build','--manifest-path',join(source,'lib/c-api/Cargo.toml'),'--release','--locked','--no-default-features','--features',features];
  command('cargo',argv,{stdio:'inherit',timeout:30*60*1000,env:{...process.env,LLVM_SYS_221_PREFIX:llvm,CARGO_TARGET_DIR:join(root,'target')}});
  const sdk=join(root,'sdk');await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
  for(const [from,to] of [['lib/c-api/wasmer.h','wasmer.h'],['lib/c-api/tests/wasm-c-api/include/wasm.h','wasm.h']])await cp(join(source,from),join(sdk,'include',to));
  const libraryName=platform()==='darwin'?'libwasmer.dylib':'libwasmer.so';
  const library=join(sdk,'lib',libraryName);await cp(join(root,'target/release',libraryName),library);
  await cp(join(source,'LICENSE'),join(sdk,'LICENSE'));
  await writeFile(join(sdk,'build.json'),JSON.stringify({schema:1,version:'7.3.0',source:'https://github.com/wasmerio/wasmer',revision,
    submodules:command('git',['submodule','status','lib/napi'],{cwd:source}).toString().trim(),
    lockSha256:digest(await readFile(join(source,'Cargo.lock'))),features,argv:['cargo',...argv],
    rust:command('rustc',['--version']).toString().trim(),cargo:command('cargo',['--version']).toString().trim(),llvm:{prefix:llvm,version:llvmVersion},library:libraryName,librarySha256:digest(await readFile(library))},null,2)+'\n');
  console.log('Isolated native LLVM/Singlepass/WASI SDK built: '+sdk+'; validate with just wasmer-preflight');
},'wasmer-sdk');
