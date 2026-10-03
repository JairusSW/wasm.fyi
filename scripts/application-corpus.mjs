import { readFile, writeFile, mkdir, mkdtemp, copyFile, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { command, digest, site, installDirectory } from './lib/wasmbench.mjs';
import { kernels, reference, sample } from './lib/application-kernels.mjs';

const destination=join(site,'corpora/applications');
let root=destination;
const build=process.argv.includes('build');
const check=process.argv.includes('check');
if(!build&&!check)throw Error('Usage: node scripts/application-corpus.mjs build|check');
const source=await readFile(join(root,'sources/kernels.c'));
const oracle=await readFile(join(site,'scripts/lib/application-kernels.mjs'));
const sourceSha=digest(source),oracleSha=digest(oracle);
if(build) {
  const clang=process.env.WASMBENCH_CLANG || (process.platform==='darwin'?'/opt/homebrew/opt/llvm/bin/clang':'clang');
  const compiler=command(clang,['--version']).toString().trim();
  if(!/^.*clang version 22\.1\.8\b/m.test(compiler))throw Error('Application corpus requires LLVM Clang 22.1.8 (set WASMBENCH_CLANG)');
  const compilerPath=clang.includes('/')?resolve(clang):command('which',[clang]).toString().trim();
  const compilerSha256=digest(await readFile(compilerPath));
  await mkdir(join(site,'.wasmbench'),{recursive:true});
  root=await mkdtemp(join(site,'.wasmbench/applications-build-'));
  await mkdir(join(root,'sources'));await mkdir(join(root,'artifacts'));
  await copyFile(join(destination,'sources/kernels.c'),join(root,'sources/kernels.c'));
  await copyFile(join(destination,'LICENSE'),join(root,'LICENSE'));
  const manifest=[];
  for(const kernel of kernels) {
    const artifact=`artifacts/${kernel.id}.wasm`;
    const flags=['--target=wasm32-unknown-unknown','-mcpu=mvp','--no-wasm-opt','-mno-sign-ext','-mno-nontrapping-fptoint','-mno-bulk-memory','-fno-builtin','-ffp-contract=off','-O3','-fno-vectorize','-fno-slp-vectorize','-nostdlib',`-DKIND=${kernel.kind}`,
      '-Wl,--no-entry','-Wl,--export=benchmark','-Wl,--export-memory','-Wl,--max-memory=2359296','-Wl,--strip-all'];
    command(clang,[...flags,'sources/kernels.c','-o',artifact],{cwd:root});
    await chmod(join(root,artifact),0o644);
    command('wasm-tools',['validate','--features=-all,floats',artifact],{cwd:root});
    const bytes=await readFile(join(root,artifact));
    {
      const size=kernel.size;
      const input=Buffer.alloc(size*4);for(let i=0;i<size;i++)input.writeUInt32LE(sample(i),i*4);
      manifest.push({schema:1,id:`applications/${kernel.id}`,family:'applications',artifact,sha256:digest(bytes),abi:'core',features:['mvp'],
        export:'benchmark',args:[size],work_unit:kernel.unit,units_per_invocation:kernel.units(size),reset:'stateless',
        oracle:{kind:'exact_u64',expected:[String(reference(kernel.kind,size))]},license:'MIT',source:'sources/kernels.c',
        generator:'wasm-fyi-application-kernels-v2',dimension:['pixels','output_pixels','interior_pixels','blocks'].includes(kernel.unit)?'image_width':kernel.unit==='cells'?'grid_width':'items',size,
        provenance:{algorithm:kernel.id,category:kernel.category,kind:'kernel',description:kernel.description,scope:'execution',
          input:{generator:'index-mix32-v1',seed:'0x9e3779b9',size,sequenceSha256:digest(input),policy:'deterministic inputs regenerated inside every invocation; initialization and output checksum are included'},
          recipe:{source:'sources/kernels.c',sourceSha256:sourceSha,oracleSource:'scripts/lib/application-kernels.mjs',oracleSha256:oracleSha,compiler,compilerSha256,flags},
          oraclePolicy:'independent JavaScript algorithm; complete output FNV-1a checksum; compared with Wasm on repeated invocations'}});
    }
  }
  await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
}
const manifest=JSON.parse(await readFile(join(root,'manifest.json')));
if(manifest.length!==kernels.length)throw Error('Application corpus contract count changed');
const ids=new Set();
for(const w of manifest) {
  if(ids.has(w.id))throw Error(`Duplicate ${w.id}`);ids.add(w.id);
  const kernel=kernels.find(k=>w.id===`applications/${k.id}`);
  if(!kernel || kernel.size!==w.size || w.args[0]!==w.size || w.units_per_invocation!==kernel.units(w.size))throw Error(`Invalid representative-input contract ${w.id}`);
  if(w.provenance.recipe.sourceSha256!==sourceSha || w.provenance.recipe.oracleSha256!==oracleSha)throw Error(`Stale source/oracle: ${w.id}; rebuild`);
  const bytes=await readFile(resolve(root,w.artifact));
  if(digest(bytes)!==w.sha256)throw Error(`Artifact changed: ${w.id}`);
  const module=await WebAssembly.compile(bytes);
  if(WebAssembly.Module.imports(module).length)throw Error(`Unexpected host dependency ${w.id}`);
  const instance=await WebAssembly.instantiate(module);
  const expected=reference(kernel.kind,w.size);
  if(w.oracle.expected[0]!==String(expected))throw Error(`Stale oracle ${w.id}`);
  for(let repeat=0;repeat<3;repeat++)if((instance.exports.benchmark(w.size)>>>0)!==expected)throw Error(`Incorrect/reused-state result ${w.id}`);
  if(check && !process.argv.includes('--v8-only')) {
    const result=command('wasmtime',['run','--invoke','benchmark',resolve(root,w.artifact),String(w.size)]).toString().trim();
    if((Number(result)>>>0)!==expected)throw Error(`Wasmtime result ${w.id}: ${result}`);
  }
}
if(build){const finish=await installDirectory(root,destination);await finish(false);}
console.log(`Verified ${manifest.length} contracts / ${kernels.length} application kernels, one representative input per algorithm; independent reference + repeated V8 calls${check&&!process.argv.includes('--v8-only')?' + Wasmtime':''}. No timings collected.`);
