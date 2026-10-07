import { readFile, writeFile, mkdir, cp, copyFile } from 'node:fs/promises';
import { dirname, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
const execute=promisify(execFile);
const ports=fileURLToPath(new URL('../corpora/nonwasi/tooling/',import.meta.url));
const iceRevision='45f5e5f3889afb07907bab439cf071478ee5a2a5';
const abcRevision='a3001b72edc5de22442e942165487fddf150e3d0';
const tsRevision='8261cea5e5098ad4b88f234dbaa224a916a34af3';
const swiftSha='abd89284f1b0f1375ba5efaa9ddf99ad4b16ac91fc7751ef10c5f013cca06f8c';
export const replacements=Object.freeze({
 'clang-cpp-kernels':'wasm-tools-assemble-validate',
 'swift-format-source':'tree-sitter-swift-parse',
 'esbuild-minify':'oxc-js-minify',
 'yosys-counter':'abc-isop-minimize',
 'icemulti-image':'icestorm-multiboot-memory',
 'icepack-pack':'icestorm-bitstream-memory',
 'ecppll-clock':'trellis-pll-search'
});
export const ids=Object.keys(replacements);
const golden={
 'clang-cpp-kernels':1659816563,'swift-format-source':664666373,'esbuild-minify':3819475620,
 'yosys-counter':1213771677,'icemulti-image':3294422427,'icepack-pack':2918599611,'ecppll-clock':1792084035
};
const descriptions={
 'clang-cpp-kernels':'wasm-tools WAT parser/encoder and wasmparser validation of 96 structured functions, table, globals, data and memory; replaces C++ compilation with WebAssembly assembly/validation.',
 'swift-format-source':'Actual tree-sitter Swift parser/scanner and full syntax-tree traversal, repeated 24 times over structs, enums, generics, closures, protocols and extensions; formatting is excluded.',
 'esbuild-minify':'Oxc JavaScript parsing, semantic analysis, compression, local-variable mangling and code generation for 48 functions; replaces esbuild minification, without bundling or file resolution.',
 'yosys-counter':'ABC Morreale ISOP minimization in both output polarities for 12 ten-input Boolean functions, with exhaustive independent cover evaluation; replaces full Yosys Verilog synthesis.',
 'icemulti-image':'IceStorm multiboot image placement, alignment, five headers, padding and four image copies in memory; replaces file I/O with bounded byte buffers.',
 'icepack-pack':'IceStorm complete CRAM/BRAM bitstream serialization, command framing and CRC-16-CCITT in memory; ASCII parsing and file I/O are excluded.',
 'ecppll-clock':'Project Trellis actual PLL divider search and VCO tie-breaking for 11 clock pairs; command parsing and Verilog formatting are excluded.'
};
const sha=b=>createHash('sha256').update(b).digest('hex');
async function patchTreeSitter(source,dir) {
 await cp(join(source,'lib'),dir,{recursive:true});
 let p=join(dir,'src/parser.c'),s=await readFile(p,'utf8');
 s=s.replaceAll('if (self->dot_graph_file)','if (false)').replaceAll('if (self->lexer.logger.log || self->dot_graph_file)','if (false)');
 const start=s.indexOf('void ts_parser_print_dot_graphs('),end=s.indexOf('\n}',start)+2;
 if(start<0||end<start)throw Error('Pinned tree-sitter diagnostics boundary changed');
 s=s.slice(0,start)+'void ts_parser_print_dot_graphs(TSParser *self, int fd) { if (fd >= 0) __builtin_trap(); }'+s.slice(end);await writeFile(p,s);
 p=join(dir,'src/lexer.c');s=await readFile(p,'utf8');await writeFile(p,s.replaceAll('if (self->logger.log)','if (false)'));
 p=join(dir,'src/alloc.c');s=await readFile(p,'utf8');await writeFile(p,s.replace(/    fprintf\(stderr,[^\n]+\n/g,'').replaceAll('abort();','__builtin_trap();'));
}
export async function build({id,artifact,checkout,archive,run,sdk,tree}) {
 if(!replacements[id])throw Error('Unknown tooling workload: '+id);
 await mkdir(dirname(artifact),{recursive:true});
 const work=join(tree,'.tmp','nonwasi-tooling');await mkdir(work,{recursive:true});
 let source,license='ISC',flags=[],units,unit,algorithm;
 const cflags=['-O2','-DNDEBUG','-mexec-model=reactor','-Wl,-z,stack-size=2097152','-Wl,--export=run','-Wl,--export=reset'];
 if(id==='clang-cpp-kernels'||id==='esbuild-minify') {
  const dir=join(work,'rust');await cp(join(ports,'rust'),dir,{recursive:true,filter:p=>basename(p)!=='target'});
  const cargo=process.env.NONWASI_CARGO||'cargo',env={...process.env,CARGO_INCREMENTAL:'0',RUSTUP_TOOLCHAIN:'1.90.0'};
  if(process.env.NONWASI_RUSTUP_HOME)env.RUSTUP_HOME=process.env.NONWASI_RUSTUP_HOME;
  if(process.env.NONWASI_CARGO_HOME)env.CARGO_HOME=process.env.NONWASI_CARGO_HOME;
  const rustc=cargo.includes('/')?join(dirname(cargo),'rustc'):'rustc';
  env.RUSTC=rustc;
  delete env.CARGO_ENCODED_RUSTFLAGS;
  delete env.CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS;
  env.RUSTFLAGS=`--remap-path-prefix=${dir}=/nonwasi-tooling --remap-path-prefix=${env.CARGO_HOME||process.env.HOME+'/.cargo'}=/cargo`;
  const version=(await execute(rustc,['--version'],{env})).stdout.trim();if(!version.startsWith('rustc 1.90.0 '))throw Error('Rust 1.90.0 required: '+version);
  const feature=id==='esbuild-minify'?'minifier':'assembler';
  flags=['build','--lib','--locked','--release','--target','wasm32-unknown-unknown','--no-default-features','--features',feature];
  await run(cargo,flags,{cwd:dir,env});await copyFile(join(dir,'target/wasm32-unknown-unknown/release/tooling_core.wasm'),artifact);
  source={repository:feature==='minifier'?'https://github.com/oxc-project/oxc':'https://github.com/bytecodealliance/wasm-tools',revision:feature==='minifier'?'d25dc35b19971ee19dcc1645a19b3044283d18ea':'35f8671bce74190ef0b00ce36c399b053b490374',version:feature==='minifier'?'oxc 0.75.0':'wat 1.239.0 / wasmparser 0.239.0',cargoLockSha256:sha(await readFile(join(ports,'rust/Cargo.lock'))),toolchain:version};
  license=feature==='minifier'?'MIT':'Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT';units=feature==='minifier'?48:96;unit='functions';algorithm=feature==='minifier'?'javascript-minification':'wasm-assembly-validation';
 } else if(id==='swift-format-source') {
  const ts=await checkout('tree-sitter-core','https://github.com/tree-sitter/tree-sitter.git',tsRevision);
  const grammar=await archive('swift-core-0.7.1.tgz','https://registry.npmjs.org/tree-sitter-swift/-/tree-sitter-swift-0.7.1.tgz',swiftSha,'package');
  const lib=join(work,'tree-sitter-lib');await patchTreeSitter(ts,lib);
  const scanner=join(work,'swift-scanner.c');const raw=await readFile(join(grammar,'src/scanner.c'),'utf8');if(!raw.includes('1UL << FAKE_TRY_BANG'))throw Error('Swift scanner patch boundary changed');await writeFile(scanner,raw.replace('1UL << FAKE_TRY_BANG','UINT64_C(1) << FAKE_TRY_BANG'));
  flags=[...cflags,'-D_POSIX_C_SOURCE=200809L','-I'+join(lib,'include'),'-I'+join(lib,'src'),'-I'+join(grammar,'src')];
  await run(join(sdk,'bin/clang'),[...flags,join(ports,'swift.c'),join(lib,'src/lib.c'),join(grammar,'src/parser.c'),scanner,'-o',artifact]);
  source={repository:'https://github.com/tree-sitter/tree-sitter',revision:tsRevision,grammar:{repository:'https://github.com/alex-pinkus/tree-sitter-swift',revision:'npm 0.7.1',sha256:swiftSha}};license='MIT';units=24;unit='parses';algorithm='swift-parsing';
 } else if(id==='yosys-counter') {
  const abc=await checkout('abc-core','https://github.com/berkeley-abc/abc.git',abcRevision);
  flags=[...cflags,'-DABC_USE_STDINT_H','-I'+join(abc,'src')];
  await run(join(sdk,'bin/clang'),[...flags,join(ports,'abc.c'),join(abc,'src/bool/kit/kitIsop.c'),join(abc,'src/bool/kit/kitTruth.c'),'-o',artifact]);
  source={repository:'https://github.com/berkeley-abc/abc',revision:abcRevision};license='LicenseRef-ABC-Berkeley';units=12;unit='truth tables';algorithm='logic-minimization';
 } else {
  const stem=id==='icepack-pack'?'icepack':id==='icemulti-image'?'icemulti':'ecppll';
  flags=[...cflags,'-fno-exceptions','-fno-rtti','-nostdlib++'];
  if(stem!=='ecppll')flags.push('-Wl,--export=output_ptr','-Wl,--export=output_len');
  await run(join(sdk,'bin/clang++'),[...flags,join(ports,stem+'.cpp'),'-o',artifact]);
  source={repository:stem==='ecppll'?'https://github.com/YosysHQ/prjtrellis':'https://github.com/YosysHQ/icestorm',revision:stem==='ecppll'?'35f5affe10a2995bdace49e23fcbafb5723c5347':iceRevision,portSha256:sha(await readFile(join(ports,stem+'.cpp')))};
  units=stem==='ecppll'?11:stem==='icepack'?32216:45683;unit=stem==='ecppll'?'clock pairs':'output bytes';algorithm=stem==='ecppll'?'pll-search':stem==='icepack'?'fpga-bitstream-packing':'fpga-multiboot-image';
 }
 const module=await WebAssembly.compile(await readFile(artifact));const imports=WebAssembly.Module.imports(module);if(imports.length)throw Error('Tooling core must have zero imports: '+JSON.stringify(imports));
 const {exports:e}=await WebAssembly.instantiate(module);
 for(let repeat=0;repeat<5;repeat++) {
  if(repeat===2)e.reset();
  if((e.run()>>>0)!==golden[id])throw Error('Tooling independent oracle mismatch: '+id);
  if(id==='icepack-pack'||id==='icemulti-image') {
   const bytes=Buffer.from(e.memory.buffer,e.output_ptr(),e.output_len());
   const expected=id==='icepack-pack'?'c4d07ab8273fb71b133e0c6fdd0d7c7bcf8854505ba38e2d4ed3942b619832e4':'cc1f7493f6812904fef129845c4f838ff410cda07f067c72eb2f0f7587321214';
   if(bytes.length!==units||sha(bytes)!==expected)throw Error('Native upstream full bitstream oracle mismatch');
  } else if(id==='esbuild-minify') {
   const output=Buffer.from(e.memory.buffer,e.output_ptr(),e.output_len()).toString();const context={};runInNewContext(output,context,{timeout:1000});if(context.result!==1414016970||output.length!==6871)throw Error('Minified JavaScript semantic oracle mismatch');
  } else if(id==='clang-cpp-kernels') {
   const output=Buffer.from(e.memory.buffer,e.output_ptr(),e.output_len());const kernel=(await WebAssembly.instantiate(output)).instance.exports.kernel;
   if(output.length!==7951||kernel(123,37)!==-1840500015)throw Error('Generated Wasm execution oracle mismatch');
  }
 }
 return {schema:1,id:'wago/'+replacements[id],family:'applications',artifact:relative(join(tree,'corpus'),artifact),abi:'core',features:[],export:'run',args:[],reset:'stateless',oracle:{kind:'exact_u64',expected:[String(golden[id])]},license,source:{...source,license},work_unit:unit,units_per_invocation:units,provenance:{kind:'upstream-library',algorithm,category:id.startsWith('ice')||id==='ecppll-clock'||id==='yosys-counter'?'Hardware design':'Compilers & development tools',scope:'execution',replaces:'wago/'+id,description:descriptions[id],oraclePolicy:'Committed native upstream/reference golden; zero imports; five calls including reset. Hardware full-output SHA-256; ABC exhaustive truth tables; generated JS/Wasm independently executed.',recipe:{source:'corpora/nonwasi/tooling',flags,compiler:id==='clang-cpp-kernels'||id==='esbuild-minify'?'Rust 1.90.0 wasm32-unknown-unknown':'WASI SDK 34 clang, import-free dead-stripped core'}}};
}
