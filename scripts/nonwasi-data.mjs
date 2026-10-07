// Pinned upstream engines embedded as import-free, in-memory core modules.
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
const ports=fileURLToPath(new URL('../corpora/nonwasi/data/',import.meta.url));
const hash = bytes => { let h=2166136261; for(const b of bytes) h=Math.imul(h^b,16777619)>>>0; return h; };
function sqliteOracle() {
  let value=12345n; const sums=[10000n,0n,0n,0n];
  for(let n=1;n<=10000;n++){sums[1]+=value;if(value%257n===0n)sums[2]+=value;sums[3]+=value&4095n;value=(value+48271n)%1000003n;}
  const bytes=Buffer.alloc(32);sums.forEach((n,i)=>bytes.writeBigUInt64LE(n,i*8));return hash(bytes);
}
export async function build({id,artifact,checkout,archive,run,sdk,tree}) {
  const common=['-O2','-DNDEBUG','-nostartfiles','-Wl,--no-entry','-Wl,--export=benchmark','-Wl,--export-memory','-Wl,--wrap=exit','-Wl,-z,stack-size=1048576','-Wl,--strip-all'];
  let source,flags=[],inputs=[],name,expected,license,description,units,algorithm,category;
  if(id==='sqlite3-query') {
    const url='https://www.sqlite.org/2026/sqlite-amalgamation-3530400.zip';
    const dir=await archive('sqlite-core.zip',url,'1e71ddf93849c6a6ecf58b827c0692073d2dd7ee40196158068f7b29f422e87d','sqlite-amalgamation-3530400');
    flags=['-DSQLITE_OS_OTHER=1','-DSQLITE_THREADSAFE=0','-DSQLITE_OMIT_LOAD_EXTENSION','-DSQLITE_OMIT_LOCALTIME','-DSQLITE_OMIT_WAL','-DSQLITE_TEMP_STORE=3','-I'+dir];
    inputs=[join(ports,'sqlite.c'),join(dir,'sqlite3.c')];
    name='sqlite-memory-query'; expected=sqliteOracle();license='Public-Domain'; units=10000;
    source={repository:url,revision:'3.53.4'}; algorithm='sqlite-sql-query';category='Databases & analytics';
    description='SQLite 3.53.4 inserts 10,000 recursive rows into an in-memory table, commits, rolls back an update and checks four complete SQL aggregates.';
  } else if(id==='brotli-compress') {
    const repository='https://github.com/google/brotli.git',revision='028fb5a23661f123017c060daa546b55cf4bde29';
    const dir=await checkout('brotli-core',repository,revision);
    flags=['-DBROTLI_BUILD_PORTABLE','-I'+join(dir,'c/include')];inputs=[join(ports,'brotli.c')];
    for(const sub of ['common','enc','dec'])for(const f of (await readdir(join(dir,'c',sub))).sort())if(f.endsWith('.c'))inputs.push(join(dir,'c',sub,f));
    name='brotli-memory-roundtrip';expected=hash(Uint8Array.from({length:65536},(_,i)=>(i*17+(i>>>8))&255));license='MIT';units=65536;
    source={repository,revision};algorithm='brotli';category='Compression';
    description='Brotli quality-10 compresses 64 KiB of deterministic bytes, requires size reduction, decodes the stream and compares every output byte before hashing.';
  } else if(id==='xzdec-decompress') {
    const repository='https://github.com/tukaani-project/xz.git',revision='d3e650e63c110e830fd5391e7f8b45df0b91d3da';
    const dir=await checkout('xz-core',repository,revision),buildDir=join(tree,'.tmp/xz-core-build');
    await mkdir(buildDir,{recursive:true});
    await run('cmake',['-S',dir,'-B',buildDir,'-DCMAKE_TOOLCHAIN_FILE='+join(sdk,'share/cmake/wasi-sdk-p1.cmake'),'-DCMAKE_BUILD_TYPE=Release','-DBUILD_SHARED_LIBS=OFF','-DXZ_THREADS=no','-DXZ_SANDBOX=no','-DXZ_NLS=OFF','-DXZ_TOOL_XZ=OFF','-DXZ_TOOL_XZDEC=OFF','-DXZ_TOOL_LZMADEC=OFF','-DXZ_TOOL_LZMAINFO=OFF']);
    await run('cmake',['--build',buildDir,'--parallel','8','--target','liblzma']);
    flags=['-I'+join(dir,'src/liblzma/api')];inputs=[join(ports,'xz.c'),join(buildDir,'liblzma.a')];
    name='xz-memory-decode';expected=1888774247;license='0BSD';units=1010;
    source={repository,revision};algorithm='lzma';category='Compression';
    description='XZ Utils liblzma decodes the original pinned XZ fixture entirely in memory, validates checksums, consumes the complete stream and hashes all 1,010 decoded bytes.';
  } else throw Error('Unsupported non-WASI data workload: '+id);
  await mkdir(dirname(artifact),{recursive:true});
  await run(join(sdk,'bin/clang'),[...common,...flags,...inputs,join(ports,'runtime.c'),'-lm','-o',artifact]);
  const module=await WebAssembly.compile(await readFile(artifact));
  if(WebAssembly.Module.imports(module).length)throw Error('Unexpected host imports in '+name+': '+JSON.stringify(WebAssembly.Module.imports(module)));
  const instance=await WebAssembly.instantiate(module);
  for(let i=0;i<3;i++)if((instance.exports.benchmark()>>>0)!==expected)throw Error('Independent/repeated-call oracle failed: '+name);
  if(id==='brotli-compress') {
    const encoded=Buffer.from(instance.exports.memory.buffer,instance.exports.compressed_pointer(),instance.exports.compressed_size());
    const decoded=brotliDecompressSync(encoded);
    const reference=Buffer.from(Uint8Array.from({length:65536},(_,i)=>(i*17+(i>>>8))&255));
    if(!decoded.equals(reference))throw Error('Independent Node decoder rejected Wasm Brotli output');
  }
  return {schema:1,id:'wago/'+name,family:'applications',artifact:relative(join(tree,'corpus'),artifact),abi:'core',features:[],export:'benchmark',args:[],reset:'stateless',oracle:{kind:'exact_u64',expected:[String(expected)]},license,source:{...source,license},work_unit:id==='sqlite3-query'?'rows':'bytes',units_per_invocation:units,provenance:{algorithm,category,kind:'upstream-library',description,scope:'execution',replaces:'wago/'+id,oraclePolicy:id==='xzdec-decompress'?'Full-output FNV-1a independently checked using Python lzma against the retained stream; repeated Wasm calls.':'Independent JavaScript input/aggregate reference and full-output FNV-1a; repeated Wasm calls. Brotli output also cross-decoded by Node zlib and compared byte-for-byte.',recipe:{source:'corpora/nonwasi/data',flags:[...common,...flags],compiler:'WASI SDK 34 clang; SDK libc is statically dead-stripped to an import-free core module.'}}};
}
