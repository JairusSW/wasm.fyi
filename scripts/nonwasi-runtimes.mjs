import {readFile, writeFile, mkdir, readdir, cp} from 'node:fs/promises';
import {join, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const port = fileURLToPath(new URL('../corpora/nonwasi/runtimes/', import.meta.url));
const quickjsRevision = '535a7c250ff4a577ec36c3e103daab6dadeea650';
const digest = b => createHash('sha256').update(b).digest('hex');
function fnv(bytes) { let h=2166136261; for(const b of bytes) h=Math.imul(h^b,16777619)>>>0; return String(h); }
function replaceOnce(text, before, after) {
  if(!text.includes(before)) throw Error('Pinned runtime source did not match expected port edit: '+before);
  return text.replace(before,after);
}
export async function build({id,artifact,checkout,archive,run,sdk,tree}) {
  const temp=join(tree,'.tmp','nonwasi-'+id); await mkdir(temp,{recursive:true});
  const flags=['-O2','-flto','-fno-stack-protector','-DNDEBUG','-ffunction-sections','-fdata-sections'];
  let source, sources, extra=[], programName, outputName, newId, description;
  if(id==='lua-cli-buckets') {
    const upstream=await archive('lua-5.4.6.tar.gz','https://www.lua.org/ftp/lua-5.4.6.tar.gz','7d5ea1b9cb6aa0b59ca3dde1c6adcb57ef83a1ba8e5432c0ecd06bf439b3ad88','lua-5.4.6');
    const dir=join(temp,'lua'); await cp(join(upstream,'src'),dir,{recursive:true});
    const path=join(dir,'ldo.c'); await writeFile(path,replaceOnce(await readFile(path,'utf8'),'#include <setjmp.h>','/* Errors trap; no non-local-jump ABI is required. */'));
    sources=(await readdir(dir)).filter(f=>f.endsWith('.c')&&!/^(lua|luac|linit|liolib|loslib|loadlib|lbaselib|lcorolib|ldblib|lmathlib|lutf8lib)\.c$/.test(f)).map(f=>join(dir,f));
    sources.push(join(port,'lua.c')); extra=['-I'+dir,'-include',join(port,'lua-config.h')];
    programName='program.lua'; outputName='lua'; newId='wago/lua-memory-buckets';
    description='Lua 5.4.6 parses and executes the original million-event ranked-bucket program entirely in memory';
    source={repository:'https://www.lua.org/ftp/lua-5.4.6.tar.gz',revision:'5.4.6',sha256:'7d5ea1b9cb6aa0b59ca3dde1c6adcb57ef83a1ba8e5432c0ecd06bf439b3ad88'};
  } else if(id==='quickjs-script') {
    const upstream=await checkout('quickjs-core','https://github.com/bellard/quickjs.git',quickjsRevision);
    const dir=join(temp,'quickjs'); await mkdir(dir,{recursive:true});
    for(const f of await readdir(upstream)) if(/\.[ch]$/.test(f)) await cp(join(upstream,f),join(dir,f));
    const path=join(dir,'quickjs.c'); let text=await readFile(path,'utf8');
    text=replaceOnce(text,'#define CONFIG_ATOMICS','/* Thread-dependent Atomics intrinsics are not registered. */');
    text=replaceOnce(text,'    struct timeval tv;\n    gettimeofday(&tv, NULL);\n    ctx->random_state = ((int64_t)tv.tv_sec * 1000000) + tv.tv_usec;','    ctx->random_state = 0x243f6a8885a308d3ULL;');
    // QuickJS explicitly supports returning zero for optional allocator-size introspection.
    text=text.replaceAll('return malloc_usable_size((void *)ptr);','return 0; /* Optional allocator-size introspection unavailable. */');
    await writeFile(path,text);
    const dtoa=join(dir,'dtoa.c'); await writeFile(dtoa,replaceOnce(await readFile(dtoa,'utf8'),'#include <setjmp.h>','/* Unused setjmp header removed for the core Wasm target. */'));
    sources=['quickjs.c','dtoa.c','libregexp.c','libunicode.c','cutils.c'].map(f=>join(dir,f));
    sources.push(join(port,'quickjs.c')); extra=['-I'+dir,'-DCONFIG_VERSION="2026-06-04"'];
    programName='program.js'; outputName='quickjs'; newId='wago/quickjs-memory-events';
    description='QuickJS parses and executes the original 50,000-event regexp, aggregation and ranking JavaScript program in memory';
    source={repository:'https://github.com/bellard/quickjs.git',revision:quickjsRevision};
  } else if(id==='ruby-buckets') {
    const revision='a309524d0bc90eef077a24634db2495a6f68e318';
    const upstream=await checkout('mruby-core','https://github.com/mruby/mruby.git',revision);
    const dir=join(temp,'mruby'); await cp(upstream,dir,{recursive:true,preserveTimestamps:true,filter:p=>!['.git','build'].includes(relative(upstream,p).split('/')[0])});
    // The pinned tree includes generated lex.def; keep it newer than keywords.
    await writeFile(join(dir,'mrbgems/mruby-compiler/core/lex.def'),await readFile(join(upstream,'mrbgems/mruby-compiler/core/lex.def')));
    const path=join(dir,'include/mruby/throw.h');
    await writeFile(path,replaceOnce(await readFile(path,'utf8'),'#if defined(MRB_USE_CXX_EXCEPTION)',`#if defined(__wasm__)
/* This embedding's fixed trusted program has fatal, trapping errors. */
#define MRB_TRY(buf) {
#define MRB_CATCH(buf) } if (0) {
#define MRB_END_EXC(buf) }
#define MRB_THROW(buf) __builtin_trap()
typedef int mrb_jmpbuf_impl;
#elif defined(MRB_USE_CXX_EXCEPTION)`));
    await run(process.env.RUBY || 'ruby',['-rrake','-e','Rake.application.run','--','-j4'],{cwd:dir,env:{...process.env,WASI_SDK_PATH:sdk,MRUBY_CONFIG:join(port,'mruby-build.rb')}});
    sources=[join(port,'mruby.c'),join(dir,'build/core-wasm/lib/libmruby.a')];
    extra=['-DMRB_NO_STDIO','-DMRB_INT64','-I'+join(dir,'include'),'-I'+join(dir,'build/core-wasm/include')];
    programName='program.rb'; outputName='mruby'; newId='wago/mruby-memory-buckets';
    description='mruby 3.4.0 parses and executes the original Ruby Hash, Range, Enumerable and string-interpolation bucket program entirely in memory';
    source={repository:'https://github.com/mruby/mruby.git',revision};
  } else throw Error('Unknown non-WASI language-runtime build: '+id);
  const program=await readFile(join(port,programName),'utf8');
  await writeFile(join(temp,'program.h'),'static const char program[] = '+JSON.stringify(program)+';\n');
  await mkdir(dirname(artifact),{recursive:true});
  await run(join(sdk,'bin/clang'),[...flags,...extra,'-I'+temp,...sources,join(port,'fatal.c'),'-lc-printscan-long-double','-nostartfiles','-Wl,--no-entry','-Wl,--gc-sections','-Wl,-z,stack-size=4194304','-Wl,--export=run','-Wl,--export=__wasm_call_ctors','-o',artifact]);
  const output=await readFile(join(port,outputName+'.stdout'));
  const module=new WebAssembly.Module(await readFile(artifact));
  if(WebAssembly.Module.imports(module).length) throw Error('Language-runtime core module retained host imports');
  const instance=new WebAssembly.Instance(module,{}); instance.exports.__wasm_call_ctors();
  for(let i=0;i<3;i++) if(String(instance.exports.run()>>>0)!==fnv(output)) throw Error('Independent runtime output oracle mismatch: '+newId);
  return {schema:1,id:newId,family:'applications',artifact:relative(join(tree,'corpus'),artifact),abi:'core',export:'run',args:[],initialize:'__wasm_call_ctors',features:[],reset:'stateless',work_unit:'program',units_per_invocation:1,oracle:{kind:'exact_u64',expected:[fnv(output)]},license:'MIT',source:{...source,license:'MIT',toolchain:'WASI SDK 34 clang; core memory-only link'},provenance:{scope:'execution',algorithm:outputName+'-interpreter',category:'Language runtimes',description,replaces:'wago/'+id,input_sha256:digest(program),reference_stdout_sha256:digest(output),oracle_derivation:'FNV-1a of complete independently generated native reference stdout; hashes also match the retained WASI corpus reference'},original_contract:{desc:description}};
}
