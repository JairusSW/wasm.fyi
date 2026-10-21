// Rebuild proposal artifacts in a new, empty directory. Never seed it with Wasm
// or native executables from the checkout or an earlier build.
import {readFile,writeFile,mkdir,mkdtemp,copyFile,readdir} from 'node:fs/promises';
import {join,relative,extname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {proposalGapIds} from '../corpora/features/proposal-gaps.mjs';
import {proposalBinaryIds} from '../corpora/features/proposal-binary.mjs';
import {fixtures} from '../corpora/features/generator.mjs';
import {featureCompiler} from './lib/feature-toolchain.mjs';
import {proposalSuites,prepareProposalSuite,upstreamRoot} from './lib/proposal-upstream.mjs';
import {site,digest} from './lib/wasmbench.mjs';

const wasmOnly=process.argv.includes('--wasm-only');
const parent=join(site,'.wasmbench/proposal-source-builds');
await mkdir(parent,{recursive:true});
const output=await mkdtemp(join(parent,'clean-'));
const root=join(site,'corpora/features'),core=join(output,'correctness'),performance=join(output,'performance'),host=join(output,'host');
const families=[...proposalGapIds,...proposalBinaryIds],family='--family='+families.join(',');
const report={schema:1,created:new Date().toISOString(),output,scope:wasmOnly?'Wasm artifacts and JavaScript sources':'Wasm artifacts, JavaScript sources and native C workloads',status:'building',artifacts:[],sources:[],commands:[]};
function run(binary,args) {
 const p=spawnSync(binary,args,{cwd:site,encoding:'utf8',timeout:300000,maxBuffer:8<<20});
 report.commands.push({binary,args,exitCode:p.status,signal:p.signal,stdout:p.stdout,stderr:p.stderr,error:p.error?.message});
 if(p.error||p.status!==0)throw Error(`Source build failed: ${binary} ${args.join(' ')}\n${p.stderr||p.error}`);
 return p.stdout.trim();
}
async function record(source,artifact,expectedSha256,kind) {
 const sourceSha256=digest(await readFile(source)),sha256=digest(await readFile(artifact));
 if(expectedSha256&&sha256!==expectedSha256)throw Error('Source rebuild differs: '+artifact);
 report.artifacts.push({kind,source:relative(site,source),sourceSha256,artifact:relative(site,artifact),sha256,...(expectedSha256?{expectedSha256,byteIdentical:true}:{})});
}
try {
 report.recipes=[];
 for(const path of ['scripts/proposal-source-build.mjs','scripts/feature-corpus.mjs','scripts/feature-performance-suite.mjs','scripts/lib/feature-performance.mjs','scripts/lib/proposal-validation.mjs','corpora/features/generator.mjs','corpora/features/proposal-gaps.mjs','corpora/features/proposal-binary.mjs','corpora/features/third-party/v8/wasm-module-builder.js'])
  report.recipes.push({path,sha256:digest(await readFile(join(site,path)))});
 run(process.execPath,['scripts/feature-corpus.mjs','build',family,'--fresh','--out='+core]);
 const rebuilt=JSON.parse(await readFile(join(core,'build.json')));
 const committed=JSON.parse(await readFile(join(root,'build.json')));
 const expected=fixtures().filter(f=>families.includes(f.feature));
 if(!expected.length||rebuilt.recipes.length!==expected.length)throw Error('Incomplete correctness source build');
 for(const recipe of rebuilt.recipes) {
  const original=committed.recipes.find(r=>r.feature===recipe.feature&&r.variant===recipe.variant);
  if(!original||recipe.sourceSha256!==original.sourceSha256)throw Error('Source identity differs: '+recipe.source);
  if(!Buffer.from(await readFile(join(root,original.source))).equals(await readFile(join(core,recipe.source))))throw Error('Generated source differs: '+recipe.source);
  await record(join(core,recipe.source),join(core,recipe.artifact),original.sha256,'correctness');
 }
 run(process.execPath,['scripts/feature-performance-suite.mjs',performance,family,'--input='+core]);
 const perf=JSON.parse(await readFile(join(performance,'build.json')));
 const retained=JSON.parse(await readFile(join(root,'reports/proposal-performance-build.json')));
 if(!perf.recipes.length||perf.recipes.length!==retained.recipes.length||perf.compileProbes.length!==retained.compileProbes.length||perf.lifecycleOnly.length!==retained.lifecycleOnly.length)throw Error('Incomplete performance source build');
 for(const recipe of perf.recipes) {
  const original=retained.recipes.find(r=>r.source.split('/').at(-1)===recipe.source.split('/').at(-1));
  if(!original||recipe.sourceSha256!==original.sourceSha256)throw Error('Performance source identity differs: '+recipe.source);
  await record(recipe.source,recipe.artifact,original.sha256,'performance');
 }
 await mkdir(host);
 const compiler=await featureCompiler();
 const compilerPath=compiler.includes('/')?compiler:run('which',[compiler]);
 report.compiler={binary:compiler,path:compilerPath,sha256:digest(await readFile(compilerPath)),version:run(compiler,['--version'])};
 const manifest=JSON.parse(await readFile(join(root,'host-proposals/manifest.json')));
 for(const contract of manifest.contracts) {
  const source=join(site,contract.source),sourceSha256=digest(await readFile(source));
  if(sourceSha256!==contract.sourceSha256)throw Error('Host source identity differs: '+source);
  if(contract.feature==='esm-integration') {
   const wat=join(host,'esm-'+contract.name+'.wat'),artifact=wat.replace(/\.wat$/,'.wasm');
   await copyFile(source,wat);
   run(compiler,['parse',wat,'-o',artifact]);run(compiler,['validate',artifact]);
   await record(wat,artifact,contract.sha256,'host-esm');
  }
 }
 // These hosts run directly from source. Check syntax in fresh copies, including
 // the ESM fixture's relative import. Execution evidence lives in host-correctness.
 const scripts=new Set(manifest.contracts.map(c=>c.source).filter(s=>['.mjs','.js'].includes(extname(s))));
 scripts.add('corpora/features/host-proposals/esm.mjs');scripts.add('corpora/features/host-proposals/esm-host.mjs');
 for(const source of scripts) {
  const target=join(host,source.split('/').at(-1));await copyFile(join(site,source),target);
  run(process.execPath,['--check',target]);
  report.sources.push({source,sha256:digest(await readFile(target)),kind:'JavaScript source (no binary artifact)'});
 }
 if(!wasmOnly) {
  const prefix=process.env.WASMBENCH_WASMTIME_C_PREFIX||'/opt/homebrew';
  const header=await readFile(join(prefix,'include/wasmtime.h'),'utf8');
  if(!header.includes('#define WASMTIME_VERSION "46.0.1"'))throw Error('Wasmtime 46.0.1 C headers/library required; set WASMBENCH_WASMTIME_C_PREFIX');
  let library;
  for(const name of ['libwasmtime.dylib','libwasmtime.so']) {
   const path=join(prefix,'lib',name);
   try {const bytes=await readFile(path);library={path,sha256:digest(bytes)};break;}
   catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(!library)throw Error('Wasmtime shared C library missing from '+prefix+'; source builds require -DBUILD_SHARED_LIBS=ON');
  report.cLibrary={version:'46.0.1',headerSha256:digest(header),wasmHeaderSha256:digest(await readFile(join(prefix,'include/wasm.h'))),...library};
  report.nativeCompiler=run('clang',['--version']);
  const nativeSource=join(host,'c-api.c'),binary=join(host,'wasm-c-api-corpus');
  await copyFile(join(root,'host-proposals/c-api.c'),nativeSource);
  const flags=['-I'+join(prefix,'include'),library.path,'-Wl,-rpath,'+join(prefix,'lib')];
  run('clang',['-std=c11','-O2','-Wall','-Wextra','-Werror',nativeSource,...flags,'-o',binary]);
  await record(nativeSource,binary,null,'native-c-api');
  // Smoke the newly built executable; full table/host API outcomes stay separate.
  report.nativeSmoke=JSON.parse(run(binary,['direct-call','4096']));
  const pin=proposalSuites.find(s=>s.id==='wasmtime');await prepareProposalSuite(pin);
  const upstream=join(upstreamRoot,pin.id),examples=(await readdir(join(upstream,'examples'))).filter(n=>n.endsWith('.c')).sort();
  if(!examples.length)throw Error('No upstream C examples found');
  report.upstream={repository:pin.repository,revision:pin.revision,archiveSha256:pin.archiveSha256};
  for(const name of examples) {
   const source=join(upstream,'examples',name),artifact=join(host,'upstream-'+name.slice(0,-2));
   run('clang',['-O2',source,...flags,'-pthread','-lm','-o',artifact]);
   await record(source,artifact,null,'upstream-c-example');
  }
 }
 report.totals=Object.fromEntries([...new Set(report.artifacts.map(r=>r.kind))].map(kind=>[kind,report.artifacts.filter(r=>r.kind===kind).length]));
 report.status='verified';
} catch(error) {report.status='failed';report.error=error.stack;process.exitCode=1;}
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${report.status}: clean source build ${JSON.stringify(report.totals||{})}; ${join(output,'report.json')}`);
if(report.error)console.error(report.error);
