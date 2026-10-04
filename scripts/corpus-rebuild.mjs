// Build in an empty staging tree. Never populate outputs from release modules.
import { readFile, writeFile, mkdir, copyFile, symlink, access, readdir, rename } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { platform, arch } from 'node:os';
import { randomUUID } from 'node:crypto';
import { site, digest, config, exists } from './lib/wasmbench.mjs';
import { parseCorpusJSON } from './lib/corpus.mjs';

const settings=await config();
if(process.version!==`v${settings.node.version}`||process.versions.v8!==settings.node.v8)throw Error('Source verification requires the pinned Node/V8 from wasmbench.config.json');
const lock=JSON.parse(await readFile(join(site,'corpora/upstream/sources.json')));
const contracts=parseCorpusJSON(await readFile(join(site,'corpora/upstream/contracts.json'),'utf8'));
const requested=process.argv.find(arg=>arg.startsWith('--ids='))?.slice(6).split(',') || lock.benchmarks.map(b=>b.id);
if(new Set(requested).size!==requested.length || requested.some(id=>!lock.benchmarks.some(b=>b.id===id)))throw Error('Select unique retained benchmark IDs');
const directory=join(site,'.wasmbench/source-builds',`all-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
const tree=join(directory,'tree');
const sdkHost={ 'darwin-arm64':'arm64-macos','darwin-x64':'x86_64-macos','linux-x64':'x86_64-linux','linux-arm64':'arm64-linux'}[platform()+'-'+arch()];
const sdk=resolve(process.env.WASI_SDK || join(site,'.wasmbench/toolchains','wasi-sdk-34.0-'+sdkHost));
const env={...process.env,WASI_SDK:sdk,WASI_SDK_PATH:sdk};
// Prefer an installed rustup toolchain when Homebrew's standalone rustc is on
// PATH. The benchmark has both wasm32-unknown-unknown and WASI Rust workloads;
// the compiler must have both target libraries available.
if(!env.RUSTC) {
  try {
    const candidate=command('rustup',['which','rustc']).toString().trim();
    const sysroot=command(candidate,['--print','sysroot']).toString().trim();
    const targets=['wasm32-unknown-unknown','wasm32-wasip1'];
    if((await Promise.all(targets.map(target=>exists(join(sysroot,'lib/rustlib',target))))).every(Boolean))env.RUSTC=candidate;
  } catch {}
}
let currentSources=[];const artifactSources=new Map();
const recipeSha256=digest(await readFile(join(site,'scripts/corpus-rebuild.mjs')));
const sourcePorts=join(directory,'ports'),sourcePatches=join(directory,'patches');
const buildInputs=[];
async function snapshot(from,to,relativePath) {
  await mkdir(to,{recursive:true});
  for(const entry of await readdir(from,{withFileTypes:true})) {
    if(entry.name==='node_modules'||entry.name.startsWith('.'))continue;
    const path=join(from,entry.name),dest=join(to,entry.name),name=join(relativePath,entry.name);
    if(entry.isDirectory())await snapshot(path,dest,name);
    else if(entry.isFile()){const bytes=await readFile(path);await writeFile(dest,bytes);buildInputs.push({path:name,sha256:digest(bytes)});}
  }
}
await snapshot(join(site,'corpora/upstream/ports'),sourcePorts,'ports');
await snapshot(join(site,'corpora/upstream/patches'),sourcePatches,'patches');
await writeFile(join(directory,'inputs.json'),JSON.stringify({recipeSha256,retained:lock.files,contractsSha256:digest(await readFile(join(site,'corpora/upstream/contracts.json'))),buildInputs},null,2)+'\n');
await mkdir(directory,{recursive:true});
for(const file of lock.files){
  const from=join(site,'corpora/upstream/wago',file.path),to=join(tree,file.path);
  if(digest(await readFile(from))!==file.sha256)throw Error('Retained source digest mismatch: '+file.path);
  await mkdir(dirname(to),{recursive:true});await copyFile(from,to);
}
async function run(program,args,options={}) {
  console.log(program,...args);
  await new Promise((ok,fail)=>{const p=spawn(program,args,{cwd:tree,env,stdio:'inherit',...options});p.on('error',fail);p.on('exit',code=>code===0?ok():fail(Error(`${program} exited ${code}`)));});
}
async function checkout(name,repository,revision) {
  currentSources.push({name,repository,revision});
  const dir=join(tree,'.tmp',name);await mkdir(dirname(dir),{recursive:true});
  if(await exists(dir)) {
    const actualRepository=command('git',['-C',dir,'remote','get-url','origin']).toString().trim();
    const actualRevision=command('git',['-C',dir,'rev-parse','HEAD']).toString().trim();
    if(actualRepository!==repository || actualRevision!==revision)throw Error('Source checkout identity changed during rebuild: '+name);
    return dir;
  }
  await run('git',['init','--quiet',dir]);
  await run('git',['remote','add','origin',repository],{cwd:dir});
  await run('git',['fetch','--depth=1','origin',revision],{cwd:dir});
  await run('git',['checkout','--detach',revision],{cwd:dir});
  const patch=join(sourcePatches,name+'.patch');
  let hasPatch=false;try{await access(patch);hasPatch=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(hasPatch){await run('git',['apply',patch],{cwd:dir});env.SOURCE_EDITS='1';}
  return dir;
}
async function archive(name,url,sha256,folder) {
  currentSources.push({name,url,sha256});
  const file=join(tree,'.tmp',name);await mkdir(dirname(file),{recursive:true});
  await run('curl',['-fsSL',url,'-o',file]);
  if(digest(await readFile(file))!==sha256)throw Error('Source archive digest mismatch: '+name);
  await run(name.endsWith('.zip')?'unzip':'tar',name.endsWith('.zip')?['-q',file,'-d',dirname(file)]:['-xf',file,'-C',dirname(file)]);
  const dir=join(dirname(file),folder);
  const patch=join(sourcePatches,folder+'.patch');
  if(await access(patch).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))await run('git',['apply',patch],{cwd:dir,env:{...env,GIT_CEILING_DIRECTORIES:dirname(dir)}});
  return dir;
}
const applicationSources={
  'tree-list':['tree','https://github.com/Old-Man-Programmer/tree.git','d501b58ff9cbfd64272c8cbcad0bda36a3fada06',false],
  'brotli-compress':['brotli','https://github.com/google/brotli.git','028fb5a23661f123017c060daa546b55cf4bde29',true],
  'quickjs-script':['wasi-lab','https://github.com/saghul/wasi-lab.git','05d2c175afeed626187f792c9dd1a8142e11f95a',true],
  'age-keygen-public':['age','https://github.com/FiloSottile/age.git','b74dce4cdbe35b5e5f66c06d9612b72f89028758',false],
  'esbuild-minify':['esbuild','https://github.com/evanw/esbuild.git','f6058f8364fe7ab91ca57a83e02577ed74c9cae4',false]
};
const applicationArchives={
  'jq-json-transform':['jq-1.8.2.tar.gz','https://github.com/jqlang/jq/releases/download/jq-1.8.2/jq-1.8.2.tar.gz','71b8d6e8f5fe81f6c6d0d110e3892251f6ce76ed095abd315e26e6e1193af3af','jq-1.8.2',true],
  'xzdec-decompress':['xz-5.8.4.tar.xz','https://github.com/tukaani-project/xz/releases/download/v5.8.4/xz-5.8.4.tar.xz','4ce24038fd4221e0d13bc1a2de7a4db56e90b92b3bf75321f6c14be73f65de4b','xz-5.8.4',true],
  'sqlite3-query':['sqlite.zip','https://www.sqlite.org/2026/sqlite-amalgamation-3530400.zip','1e71ddf93849c6a6ecf58b827c0692073d2dd7ee40196158068f7b29f422e87d','sqlite-amalgamation-3530400',false]
};
const built=new Set(),outcomes=[],suite=[];
for(const b of lock.benchmarks.filter(b=>requested.includes(b.id))) {
  const artifact=join(tree,'corpus',b.artifact);
  try {
    if(!built.has(b.artifact)) {
      env.SOURCE_EDITS='0';currentSources=[];
      await mkdir(dirname(artifact),{recursive:true});
      if(b.artifact.includes('/synthetic/')||b.id==='linked_list') {
        await run('wat2wasm',[join(tree,'corpus/sources/wat',b.id+'.wat'),'-o',artifact]);
      } else if(b.artifact.includes('/polybench/')) {
        currentSources.push({repository:'https://github.com/JamesMenetrey/webassembly-polybench-c.git',revision:'5474c59fe88f4e36ba968e8f8c4ac913ee83f0d0'});
        if(!built.has('polybench')) {
          const path=join(tree,b.recipe),patch=join(sourcePatches,'polybench.patch');
          if(await access(patch).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;})) {
            const original=await readFile(path,'utf8');
            await writeFile(path,original.replace('out="$corpus/workloads/polybench"',`git -C "$UPSTREAM_DIR" apply "$SOURCE_PATCH"\nout="$corpus/workloads/polybench"`));
          }
          await run('sh',[path],{env:{...env,SOURCE_PATCH:patch}});built.add('polybench');
        }
      } else if(b.artifact.includes('/semantic/')) {
        // The retained recipes compile into a temporary directory then compare
        // binary identity. Capture that newly compiled output instead; correctness
        // is checked below against the independent retained contract.
        const original=await readFile(join(tree,b.recipe),'utf8');
        currentSources.push({recipe:b.recipe,repository:original.match(/(?:UPSTREAM_REPO|repo)=(https:[^\s;]+)/)?.[1],revision:original.match(/(?:UPSTREAM_REV|rev)=([a-f0-9]{40})/)?.[1]});
        const marker=original.indexOf('\ngot=');
        if(marker<0 || !original.slice(0,marker).includes(`$stage/${basename(artifact)}`))throw Error('Unrecognized semantic compilation recipe');
        let compile=original.slice(0,marker);
        const patch=join(sourcePatches,'semantic-'+b.id+'.patch');
        let hasPatch=false;try{await access(patch);hasPatch=true;}catch(error){if(error.code!=='ENOENT')throw error;}
        if(hasPatch)compile=compile.replace('stage=$(mktemp',`git -C "${original.includes('UPSTREAM_DIR=')?'$UPSTREAM_DIR':'$upstream'}" apply "$SOURCE_PATCH"\nstage=$(mktemp`);
        const recipe=compile+`\ncp "$stage/${basename(artifact)}" "$here/${basename(artifact)}"\n`;
        const path=join(dirname(join(tree,b.recipe)),'source-build.sh');
        await writeFile(path,recipe);await run('sh',[path],{env:{...env,SOURCE_PATCH:patch}});
      } else if(b.artifact.includes('/compute/')&&b.id!=='linked_list') {
        await run(process.env.RUSTC || 'rustc',[...(process.env.RUST_SYSROOT?['--sysroot',resolve(process.env.RUST_SYSROOT)]:[]),...['-C','linker='+resolve(process.env.RUST_LINKER || join(sdk,'bin/wasm-ld'))],'--target','wasm32-unknown-unknown','-C','opt-level=3','-C','lto=fat','-C','panic=abort','-C','codegen-units=1','--crate-type','cdylib','-o',artifact,join(tree,'corpus/sources/rust',b.id+'.rs')]);
      } else if(b.artifact.includes('/assemblyscript/')) {
        const json=b.id==='json-as-simd',name=json?'json-as':'utf-as';
        const dir=await checkout(name,`https://github.com/JairusSW/${name}.git`,json?'bbb1097c43645cc483f54407a77316f5db2063cd':'ed2a0b277ac90850c644b6d5f99c4f6c139a0345');
        const tools=join(tree,'.tmp/assemblyscript-tools');
        if(!built.has('assemblyscript-tools')) {
          await mkdir(tools,{recursive:true});for(const file of ['package.json','package-lock.json'])await copyFile(join(sourcePorts,'assemblyscript',file),join(tools,file));
          await run('npm',['ci','--ignore-scripts','--no-audit'],{cwd:tools});built.add('assemblyscript-tools');
        }
        await symlink(join(tools,'node_modules'),join(dir,'node_modules'),'dir');
        await copyFile(join(tree,'corpus/sources/assemblyscript',b.id+'.ts'),join(dir,'assembly/wago-bench.ts'));
        await run(process.execPath,[join(tools,'node_modules/assemblyscript/bin/asc.js'),'assembly/wago-bench.ts','-o',artifact,'-O3','--noAssert','--uncheckedBehavior','always','--exportStart','_initialize','--enable','simd','--enable','bulk-memory',...(json?['--transform','./transform','--runtime','incremental','--exportRuntime']:['--runtime','stub'])],{cwd:dir,env:{...env,JSON_MODE:'SIMD'}});
      } else if(b.id==='clang-cpp-kernels') {
        const dir=await checkout('llvm','https://github.com/binji/llvm-project.git','5dc09c94393510bc8d042a9f07382b53e845c0f2');
        await run('bash',[join(sourcePorts,'clang/build.sh'),dir,artifact]);
      } else if(['ruby-buckets','yosys-counter'].includes(b.id)) {
        const ruby=b.id==='ruby-buckets',name=ruby?'ruby':'yosys';
        const dir=await checkout(name,ruby?'https://github.com/ruby/ruby.git':'https://github.com/YoWASP/yosys.git',ruby?'e51014f9c05aa65cbf203442d37fef7c12390015':'d0ee6801cc45748a8630a04723eb290fcff1a7bf');
        if(!ruby)await run('git',['submodule','update','--init','--depth','1','yosys-src'],{cwd:dir});
        const ports=join(sourcePorts,'legacy');
        if(!built.has('legacy-image')) {await run('docker',['build','--platform','linux/amd64','-t','wasm-fyi-corpus-legacy-sdk19',ports]);built.add('legacy-image');}
        await run('docker',['run','--rm','--platform','linux/amd64',ruby?'--memory=4g':'--memory=12g','--cpus=2','-v',dir+':/src','-v',ports+':/recipes:ro','-w','/src','wasm-fyi-corpus-legacy-sdk19','bash','/recipes/'+name+'.sh']);
        await copyFile(join(dir,ruby?'build-wasi/ruby':'yosys-build/yosys.wasm'),artifact);
      } else if(b.id==='ecppll-clock') {
        const dir=await checkout('prjtrellis','https://github.com/YosysHQ/prjtrellis.git','35f5affe10a2995bdace49e23fcbafb5723c5347');
        const boost=await archive('boost_1_76_0.tar.bz2','https://archives.boost.io/release/1.76.0/source/boost_1_76_0.tar.bz2','f0397ba6e982c4450f27bf32a2a83292aba035b827a5623a14636ea583318c41','boost_1_76_0');
        await copyFile(join(sourcePorts,'ecppll/wasmexcept.hpp'),join(dir,'libtrellis/tools/wasmexcept.hpp'));
        const version=join(tree,'.tmp/ecppll-version.cpp');await writeFile(version,'#include <string>\nextern const std::string git_describe_str = "35f5affe10a2995bdace49e23fcbafb5723c5347";\n');
                const sources=(await readdir(join(boost,'libs/program_options/src'))).filter(f=>f.endsWith('.cpp')).map(f=>join(boost,'libs/program_options/src',f));
        await run(join(sdk,'bin/clang++'),['-std=c++14','-O2','-fexceptions','-DBOOST_NO_EXCEPTIONS','-DBOOST_NO_CXX11_HDR_MUTEX','-DBOOST_SP_NO_ATOMIC_ACCESS','-DBOOST_AC_DISABLE_THREADS','-I'+boost,...sources,join(dir,'libtrellis/tools/ecppll.cpp'),version,'-o',artifact]);
      } else if(b.id==='swift-format-source') {
        const dir=await checkout('swift-format','https://github.com/kkebo/swift-format.git','92097d54ac3be47738fe77e38c918e9aabce0302');
        await run('bash',[join(sourcePorts,'swift-format/build.sh'),dir,artifact]);
      } else if(applicationSources[b.id]||applicationArchives[b.id]) {
        const item=applicationSources[b.id]||applicationArchives[b.id];
        const dir=applicationSources[b.id]?await checkout(...item.slice(0,3)):await archive(...item.slice(0,4));
        const args=[join(tree,b.recipe),dir];if(item.at(-1))args.push(join(tree,'.tmp/build-'+b.id));
        if(env.SOURCE_EDITS==='1') {
          const path=join(tree,b.recipe);const original=await readFile(path,'utf8');
          const guard='if [[ -n "$(git -C "$source_dir" status --porcelain)" ]]; then';
          await writeFile(path,original.replace(guard,'if [[ "${SOURCE_EDITS:-0}" != 1 ]] && [[ -n "$(git -C "$source_dir" status --porcelain)" ]]; then'));
        }
        await run('bash',args);
      } else if(b.id==='lua-cli-buckets') {
        const dir=await archive('lua-5.4.6.tar.gz','https://www.lua.org/ftp/lua-5.4.6.tar.gz','7d5ea1b9cb6aa0b59ca3dde1c6adcb57ef83a1ba8e5432c0ecd06bf439b3ad88','lua-5.4.6');
        const port=join(sourcePorts,'lua');const shim=join(tree,'.tmp/lua-compat.o');
        await run(join(sdk,'bin/clang'),['-O2','-c',join(port,'compat.c'),'-o',shim]);
        await run('make',['-C',join(dir,'src'),'lua',`CC=${join(sdk,'bin/clang')}`,`AR=${join(sdk,'bin/llvm-ar')} rcu`,`RANLIB=${join(sdk,'bin/llvm-ranlib')}`,
          `MYCFLAGS=-include ${join(port,'compat.h')} -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -mllvm -wasm-enable-sjlj`,
          `MYLDFLAGS=${shim} -lwasi-emulated-signal -lwasi-emulated-process-clocks -lsetjmp`]);
        // SDK 34's SjLj support library emits the retired EH encoding. Convert
        // that output to standardized try_table/exnref without optimizing it.
        const wasmOpt=env.WASM_OPT || 'wasm-opt';
        const version=execFileSync(wasmOpt,['--version'],{encoding:'utf8'}).trim();
        if(version!=='wasm-opt version 130')throw Error('Lua requires Binaryen wasm-opt version 130');
        const legacy=join(dir,'src/lua');
        const args=['--translate-to-exnref','--emit-exnref','--all-features',legacy,'-o',artifact];
        await run(wasmOpt,args);
        currentSources.push({name:'binaryen',repository:'https://github.com/WebAssembly/binaryen',revision:'version_130',version,inputSha256:digest(await readFile(legacy)),flags:args.slice(0,3)});
      } else if(b.id==='json2csv-people') {
        const dir=await checkout('json2csv','https://github.com/jehiah/json2csv.git','0bd0bb4e06a282ff4c9ec979a52159c379bf9652');
        await run('go',['build','-mod=readonly','-trimpath','-o',artifact,'.'],{cwd:dir,env:{...env,CGO_ENABLED:'0',GOOS:'wasip1',GOARCH:'wasm'}});
      } else if(b.id.startsWith('coreutils-')||b.id==='ripgrep-source') {
        const core=b.id.startsWith('coreutils-');
        const dir=await checkout(core?'coreutils':'ripgrep',core?'https://github.com/uutils/coreutils.git':'https://github.com/BurntSushi/ripgrep.git',core?'28b6856d7b215bf844b4223589cb54ade84f5223':'4649aa9700619f94cf9c66876e9549d83420e16c');
        await run(process.env.CARGO || 'cargo',['build','--locked','--release','--target','wasm32-wasip1','-j','2',...(core?['--no-default-features','--features','feat_wasm']:[])],{cwd:dir,env:{...env,RUSTFLAGS:'-C linker='+join(sdk,'bin/wasm-ld')}});
        await copyFile(join(dir,'target/wasm32-wasip1/release',core?'coreutils.wasm':'rg.wasm'),artifact);
      } else if(['icemulti-image','icepack-pack'].includes(b.id)) {
        const dir=await checkout('icestorm-'+b.id,'https://github.com/YosysHQ/icestorm.git','45f5e5f3889afb07907bab439cf071478ee5a2a5');
        const name=b.id==='icemulti-image'?'icemulti':'icepack';
        await run(join(sdk,'bin/clang++'),['-O2','-fno-exceptions',join(dir,name,name+'.cc'),'-o',artifact]);
      } else throw Error('Source build not implemented yet: '+b.id);
      // Reject absent, empty, or non-Wasm output even if a recipe exited zero.
      const data=await readFile(artifact);if(data.subarray(0,8).toString('hex')!=='0061736d01000000')throw Error('Recipe did not produce a core Wasm module');
      artifactSources.set(b.artifact,currentSources.length?currentSources:[{repository:lock.repository,revision:lock.revision,recipe:b.recipe}]);
      built.add(b.artifact);
    }
    const w=structuredClone(contracts.find(w=>w.id.split('/')[1]===b.id));
    if(!w)throw Error('Retained correctness contract missing');
    w.artifact=artifact;w.sha256=digest(await readFile(artifact));
    for(const f of Object.values(w.command?.files||{}))f.path=resolve(site,f.path);
    const inputs=artifactSources.get(b.artifact);
    w.source=inputs[0].repository || inputs[0].url || inputs[0].name || inputs[0].recipe || b.recipe;w.generator='wasm-fyi-source-build-v1';
    w.provenance.rebuild={sources:artifactSources.get(b.artifact),recipe:'scripts/corpus-rebuild.mjs',recipeSha256,inputsSha256:digest(await readFile(join(directory,'inputs.json'))),originalRecipe:b.recipe};
    const resultFile=join(directory,b.id+'.check.json');
    const inputFile=join(directory,b.id+'.contract.json');await writeFile(inputFile,JSON.stringify(w));
    const result=await new Promise((ok,fail)=>{let output='';const p=spawn(process.execPath,[join(site,'scripts/corpus-v8-worker.mjs')],{cwd:site,env:{...env,NODE_NO_WARNINGS:'1'},stdio:['pipe','pipe','inherit'],timeout:30_000});p.stdout.on('data',chunk=>output+=chunk);p.on('error',fail);p.on('exit',()=>{try{ok(JSON.parse(output));}catch(error){fail(error);}});p.stdin.end(JSON.stringify(w));});
    await writeFile(resultFile,JSON.stringify(result,null,2)+'\n');
    if(result.status!=='verified')throw Error('V8 check: '+JSON.stringify(result));
    suite.push(w);outcomes.push({id:b.id,sha256:w.sha256,status:'verified'});
  } catch(error){outcomes.push({id:b.id,status:'failed',reason:error.message});console.error(b.id,error.message);}
  await writeFile(join(directory,'report.json'),JSON.stringify({schema:1,requested,outcomes},null,2)+'\n');
}
await writeFile(join(directory,'suite.json'),JSON.stringify(suite,null,2)+'\n');
await writeFile(join(site,'.wasmbench/latest-source-build.json'),JSON.stringify({directory})+'\n');
console.log(`Source build: ${suite.length}/${requested.length} verified; ${directory}`);
if(outcomes.some(o=>o.status!=='verified'))process.exitCode=1;
else if(!process.argv.some(arg=>arg.startsWith('--ids='))) {
  const published=join(site,'.wasmbench/upstream');await mkdir(published,{recursive:true});
  for(const w of suite) {
    const b=lock.benchmarks.find(b=>b.id===w.id.split('/')[1]);
    const output=join(published,basename(directory),'artifacts',b.artifact);await mkdir(dirname(output),{recursive:true});await copyFile(w.artifact,output);
    w.artifact=output;
  }
  const staged=join(published,'manifest.json.partial');await writeFile(staged,JSON.stringify(suite,null,2)+'\n');await rename(staged,join(published,'manifest.json'));
  await copyFile(join(directory,'inputs.json'),join(published,'inputs.json'));
  await copyFile(join(directory,'report.json'),join(published,'report.json'));
  console.log('Published complete source-built upstream corpus: '+join(published,'manifest.json'));
}
