import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const file='deps/LIEF/third-party/spdlog/include/spdlog/fmt/bundled/format.h';
const declaration='#  include <cstdlib>  // wasm.fyi: fmt malloc/free declarations\n';
const sha=text=>createHash('sha256').update(text).digest('hex');

// Recent libc++ removes transitive declarations. This repairs only the bundled
// fmt allocator's missing standard header; V8 sources and compiler flags stay
// intact. Derive the same provenance when resuming an interrupted build.
export function nodeFmtHeaderPatch(text,platform=process.platform) {
 if(platform!=='darwin')return {text,proof:null};
 const original=text.includes(declaration)?text.replace(declaration,''):text;
 if(!original.includes('template <typename T> struct allocator {')||!original.includes('static_cast<T*>(malloc(n * sizeof(T)))')||!original.includes('void deallocate(T* p, size_t) { free(p); }'))return {text,proof:null};
 if(/^\s*#\s*include\s*<cstdlib>/m.test(original))return {text,proof:null};
 const marker='#ifndef FMT_MODULE\n';
 if(!original.includes(marker))throw Error('Unrecognized Node fmt allocator header layout');
 const patched=original.replace(marker,marker+declaration);
 return {text:patched,proof:{kind:'node-bundled-fmt-stdlib-header-v1',file,beforeSha256:sha(original),afterSha256:sha(patched)}};
}

export async function ensureNodeFmtStandardLibrary(source,platform=process.platform) {
 if(platform!=='darwin')return null;
 const path=join(source,file);
 let before;
 try{before=await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
 const result=nodeFmtHeaderPatch(before,platform);
 if(result.text!==before)await writeFile(path,result.text);
 return result.proof;
}
