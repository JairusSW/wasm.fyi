// Build in an empty staging tree. Never populate outputs from release modules.
import { readFile, writeFile, mkdir, copyFile, symlink, access, readdir, rename } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { platform, arch } from 'node:os';
import { randomUUID } from 'node:crypto';
import { site, digest, config, exists, command } from './lib/wasmbench.mjs';
import { parseCorpusJSON } from './lib/corpus.mjs';
import { assertMainCorpusContract } from './lib/main-corpus-contract.mjs';

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
// PATH. Feature/component tools manage their separate WASI target libraries;
// the main corpus compiler only needs the core target library.
if(!env.RUSTC) {
  try {
    const candidate=command('rustup',['which','rustc']).toString().trim();
    const sysroot=command(candidate,['--print','sysroot']).toString().trim();
    const targets=['wasm32-unknown-unknown'];
    if((await Promise.all(targets.map(target=>exists(join(sysroot,'lib/rustlib',target))))).every(Boolean))env.RUSTC=candidate;
  } catch {}
}
let currentSources=[];const artifactSources=new Map();
const recipeBytes=await readFile(join(site,'scripts/corpus-rebuild.mjs'));
const recipeSha256=digest(recipeBytes);
const sourcePorts=join(directory,'ports'),sourcePatches=join(directory,'patches');
const buildInputs=[],observedInputs=new Map();
async function snapshot(from,to,relativePath) {
  await mkdir(to,{recursive:true});
  for(const entry of await readdir(from,{withFileTypes:true})) {
    if(['node_modules','target'].includes(entry.name)||entry.name.startsWith('.'))continue;
    const path=join(from,entry.name),dest=join(to,entry.name),name=join(relativePath,entry.name);
    if(entry.isDirectory())await snapshot(path,dest,name);
    else if(entry.isFile()){const bytes=await readFile(path);await writeFile(dest,bytes);buildInputs.push({path:name,sha256:digest(bytes)});observedInputs.set(path,digest(bytes));}
  }
}
await snapshot(join(site,'corpora/upstream/ports'),sourcePorts,'ports');
await snapshot(join(site,'corpora/upstream/patches'),sourcePatches,'patches');
await snapshot(join(site,'corpora/nonwasi'),join(directory,'nonwasi'),'nonwasi');
await writeFile(join(directory,'recipe.mjs'),await readFile(join(site,'scripts/corpus-rebuild.mjs')));
for(const group of ['data','runtimes','tooling','text']) {
  const name='nonwasi-'+group+'.mjs',bytes=await readFile(join(site,'scripts',name));
  await writeFile(join(directory,name),bytes);buildInputs.push({path:name,sha256:digest(bytes)});
  observedInputs.set(join(site,'scripts',name),digest(bytes));
}
observedInputs.set(join(site,'scripts/corpus-rebuild.mjs'),recipeSha256);
const admission=await readFile(join(site,'scripts/lib/main-corpus-contract.mjs'));
buildInputs.push({path:'lib/main-corpus-contract.mjs',sha256:digest(admission)});
await mkdir(join(directory,'lib'),{recursive:true});
await writeFile(join(directory,'lib/main-corpus-contract.mjs'),admission);
observedInputs.set(join(site,'scripts/lib/main-corpus-contract.mjs'),digest(admission));
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
const built=new Set(),outcomes=[],suite=[],replacementContracts=new Map();
for(const b of lock.benchmarks.filter(b=>requested.includes(b.id))) {
  const artifact=join(tree,'corpus',b.artifact);
  try {
    if(!built.has(b.artifact)) {
      env.SOURCE_EDITS='0';currentSources=[];
      await mkdir(dirname(artifact),{recursive:true});
      if(b.replaces) {
        const builder=await import('./nonwasi-'+b.group+'.mjs');
        const contract=await builder.build({id:b.replaces.split('/')[1],artifact,checkout,archive,run,sdk,tree,sourcePorts});
        if(contract.id.split('/')[1]!==b.id)throw Error('Replacement builder returned the wrong workload: '+contract.id);
        replacementContracts.set(b.artifact,contract);
      } else if(b.artifact.includes('/synthetic/')||b.id==='linked_list') {
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
      } else throw Error('Source build not implemented yet: '+b.id);
      // Reject absent, empty, or non-Wasm output even if a recipe exited zero.
      const data=await readFile(artifact);if(data.subarray(0,8).toString('hex')!=='0061736d01000000')throw Error('Recipe did not produce a core Wasm module');
      const replacement=replacementContracts.get(b.artifact);
      const replacementSource=typeof replacement?.source==='string'?{path:replacement.source}:replacement?.source || {};
      artifactSources.set(b.artifact,currentSources.length?currentSources:replacement?[{...replacementSource,recipe:'scripts/nonwasi-'+b.group+'.mjs',packages:replacement.provenance?.upstreamPackages,cargoLockSha256:replacement.provenance?.recipe?.cargoLockSha256}]:[{repository:lock.repository,revision:lock.revision,recipe:b.recipe}]);
      built.add(b.artifact);
    }
    const w=structuredClone(replacementContracts.get(b.artifact) || contracts.find(w=>w.id.split('/')[1]===b.id));
    if(!w)throw Error('Retained correctness contract missing');
    const expected=contracts.find(item=>item.id===w.id);
    if(b.replaces && expected)for(const key of ['abi','export','args','reset','initialize','oracle']) {
      if(JSON.stringify(w[key])!==JSON.stringify(expected[key]))throw Error('Replacement contract drift: '+w.id+' '+key);
    }
    w.artifact=artifact;w.sha256=digest(await readFile(artifact));
    assertMainCorpusContract(w,await readFile(artifact));
    for(const f of Object.values(w.command?.files||{}))f.path=resolve(site,f.path);
    const inputs=artifactSources.get(b.artifact);
    if(b.replaces)w.provenance.upstreamSource=structuredClone(w.source || {packages:w.provenance.upstreamPackages});
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
// Helpers read local wrappers by their source-relative paths. Refuse to accept
// a build if an editor changed any snapshotted input while it was compiling.
for(const [path,sha256] of observedInputs)if(digest(await readFile(path))!==sha256)throw Error('Build input changed during compilation: '+path);
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
