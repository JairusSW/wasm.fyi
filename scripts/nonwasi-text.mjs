import { readFile, writeFile, mkdir, cp, copyFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const execute=promisify(execFile);
const source=resolve(dirname(fileURLToPath(import.meta.url)),'../corpora/nonwasi/text');
const variants={
 'coreutils-sort':['rusttext-sort','sort','Rust standard-library stable UTF-8 line sorting; replaces coreutils CLI sort without locale or filesystem'],
 'coreutils-base64':['base64-rfc4648','base64-work','base64 crate standard and URL-safe RFC4648 encoding plus both decodings; replaces coreutils base64 CLI'],
 'coreutils-wc':['unicode-wordcount','wc','Rust text counting and Unicode grapheme segmentation; replaces coreutils wc CLI, adding codepoint/grapheme counts'],
 'ripgrep-source':['regex-source-scan','scan','Rust regex engine, four full-source searches with complete byte offsets and matched strings; replaces ripgrep traversal/CLI'],
 'json2csv-people':['serde-json2csv','csv-work','serde_json parsing and csv serialization with embedded comma, quote and newline fields; replaces json2csv CLI'],
 'jq-json-transform':['jaq-json-query','query','jaq jq-language parser/compiler/interpreter executes selection, mapping, sorting, grouping and reduction; replaces libjq CLI'],
 'tree-list':['zip-directory-extract','zip-work','zip crate central-directory traversal and CRC-validated extraction of every stored file; replaces host filesystem tree traversal'],
 'age-keygen-public':['x25519-public','x25519','curve25519-dalek via x25519-dalek derives 64 deterministic public keys; replaces age keygen public-key stage, without entropy or Bech32']
};
export const ids=Object.keys(variants);
const sha=b=>createHash('sha256').update(b).digest('hex');
function crc32(data){let c=0xffffffff;for(const b of data){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function zip(entries){let offset=0;const local=[],central=[];for(const [name,body] of entries){const n=Buffer.from(name),b=Buffer.from(body),crc=crc32(b);const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);h.writeUInt32LE(b.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(n.length,26);local.push(h,n,b);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=h.length+n.length+b.length;}const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,cd,end]);}
function fixtures(){
 const lines=Array.from({length:4096},(_,i)=>`${String((i*7919)%4096).padStart(4,'0')} ${['pear','apple','zebra','éclair'][i%4]} ${i%31}`).join('\n')+'\n';
 const binary=Buffer.from(Array.from({length:32771},(_,i)=>(i*29+(i>>>3)*17)&255));
 const words=Array.from({length:512},(_,i)=>`line ${i}: café cafe\u0301 👩‍💻\t世界\r\n`).join('');
 const code=Array.from({length:512},(_,i)=>`use module::part;\nfn process_${i}(value: u32) -> u32 {\n    // ${i%3?'TODO':'FIXME'}: review item ${1000+i}\n    value + ${100+i}\n}\n`).join('');
 const people=Array.from({length:256},(_,i)=>({id:i,name:['Ada, Lovelace','Grace "Amazing" Hopper','Linus\nTorvalds','René Descartes'][i%4]+` ${i}`,city:['London','New York','Paris','Tokyo'][i%4],score:(i*37)%101,active:i%3!==0}));
 const entries=Array.from({length:64},(_,i)=>[`project/group${i%8}/file${i}.txt`,Array.from({length:8},(_,j)=>`entry ${i} line ${j} payload ${(i*31+j*17)%997}\n`).join('')]);
 return {files:{'lines.txt':lines,'binary.bin':binary,'words.txt':words,'source.txt':code,'people.json':JSON.stringify(people),'tree.zip':zip(entries)},lines,binary,words,code,people,entries};
}
function reference(kind,f){switch(kind){
 case 'sort':return Buffer.from(f.lines.trimEnd().split('\n').sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).join('\n')+'\n');
 case 'base64-work':return Buffer.concat([Buffer.from(f.binary.toString('base64')+'\n'+f.binary.toString('base64url')+'\n'),f.binary,f.binary]);
 case 'wc':return Buffer.from(`${(f.words.match(/\n/g)||[]).length} ${f.words.trim().split(/\s+/u).length} ${Buffer.byteLength(f.words)} ${[...f.words].length} ${[...new Intl.Segmenter('en',{granularity:'grapheme'}).segment(f.words)].length}\n`);
 case 'scan':{let out='';const ps=[/^fn\s+([A-Za-z_][A-Za-z_0-9]*)\(([^\n]*)\)/gm,/\b(?:TODO|FIXME):[^\n]*/g,/\b[0-9]{2,4}\b/g,/^use\s+([a-z_:]+);$/gm];ps.forEach((p,i)=>{for(const m of f.code.matchAll(p))out+=`${i}:${m.index}:${m.index+m[0].length}:${m[0]}\n`;});return Buffer.from(out);}
 case 'csv-work':{const quote=v=>/[",\r\n]/.test(String(v))?'"'+String(v).replaceAll('"','""')+'"':String(v);return Buffer.from('id,name,city,score,active\r\n'+f.people.map(p=>[p.id,p.name,p.city,p.score,p.active].map(quote).join(',')+'\r\n').join(''));}
 case 'query':{const groups=new Map();for(const p of f.people){const g=groups.get(p.city)||[];g.push(p);groups.set(p.city,g);}const outputs=[f.people.filter(p=>p.active&&p.score>=50).map(p=>[p.id,p.name,p.score*2]),f.people.toSorted((a,b)=>a.score-b.score).reverse().slice(0,12).map(p=>[p.id,p.score]),[...groups].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,g])=>[k,g.length,g.reduce((a,p)=>a+p.score,0)]),f.people.reduce((a,p)=>a+p.score,0)];return Buffer.from(outputs.map(v=>JSON.stringify(v)+'\n').join(''));}
 case 'zip-work':return Buffer.concat(f.entries.flatMap(([n,b])=>[Buffer.from(`${n}\t${Buffer.byteLength(b)}\t${crc32(Buffer.from(b))}\n`),Buffer.from(b),Buffer.from('\n')]));
 case 'x25519':return Buffer.concat(Array.from({length:64},(_,i)=>{const secret=Buffer.from(Array.from({length:32},(_,j)=>(i*37+j*19+11)&255));const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b656e04220420','hex'),secret]),format:'der',type:'pkcs8'});return createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(-32);}));
}}
export async function build({id,artifact,run,tree}){
 const variant=variants[id];if(!variant)return null;
 const [newId,feature,description]=variant;
 const dir=join(tree,'.tmp','nonwasi-text');await mkdir(dir,{recursive:true});await cp(source,dir,{recursive:true});await mkdir(join(dir,'fixtures'),{recursive:true});
 const f=fixtures();for(const [name,data] of Object.entries(f.files))await writeFile(join(dir,'fixtures',name),data);
 const cargo=process.env.NONWASI_CARGO||'cargo';
 const env={...process.env,CARGO_INCREMENTAL:'0',RUSTUP_TOOLCHAIN:'1.90.0'};
 if(process.env.NONWASI_RUSTUP_HOME)env.RUSTUP_HOME=process.env.NONWASI_RUSTUP_HOME;
 if(process.env.NONWASI_CARGO_HOME)env.CARGO_HOME=process.env.NONWASI_CARGO_HOME;
 const rustc=cargo.includes('/')?join(dirname(cargo),'rustc'):'rustc';
  env.RUSTC=rustc;
  delete env.CARGO_ENCODED_RUSTFLAGS;
  delete env.CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS;
 env.RUSTFLAGS=`--remap-path-prefix=${dir}=/nonwasi-text --remap-path-prefix=${env.CARGO_HOME||process.env.HOME+'/.cargo'}=/cargo`;
 const version=(await execute(rustc,['--version'],{env})).stdout.trim();if(!version.startsWith('rustc 1.90.0 '))throw Error(`Rust 1.90.0 required: ${version}`);
 await run(cargo,['build','--locked','--release','--target','wasm32-unknown-unknown','--no-default-features','--features',feature],{cwd:dir,env});
 await mkdir(dirname(artifact),{recursive:true});await copyFile(join(dir,'target/wasm32-unknown-unknown/release/nonwasi_text.wasm'),artifact);
 const bytes=await readFile(artifact),module=await WebAssembly.compile(bytes);
 if(WebAssembly.Module.imports(module).length)throw Error(`${newId}: unexpected imports`);
 const expected=reference(feature,f);let hash=14695981039346656037n;for(const b of expected)hash=BigInt.asUintN(64,(hash^BigInt(b))*1099511628211n);
 const {exports:e}=await WebAssembly.instantiate(module);
 for(let repeat=0;repeat<4;repeat++){
  const got=BigInt.asUintN(64,e.benchmark());const output=Buffer.from(e.memory.buffer,e.output_ptr(),e.output_len());
  if(got!==hash||!output.equals(expected))throw Error(`${newId}: full-output oracle mismatch at repeat ${repeat}: ${got} != ${hash}, output ${output.length} vs ${expected.length}`);
 }
 const metadata=JSON.parse((await execute(cargo,['metadata','--locked','--format-version','1','--filter-platform','wasm32-unknown-unknown','--no-default-features','--features',feature],{cwd:dir,env,maxBuffer:20*1024*1024})).stdout);
 const licenses=metadata.packages.filter(p=>p.source).map(p=>({name:p.name,version:p.version,license:p.license,source:p.source})).sort((a,b)=>a.name.localeCompare(b.name));
 const categories={sort:'Integer & graph algorithms','base64-work':'Text & parsing',wc:'Text & parsing',scan:'Search & indexing','csv-work':'JSON & serialization',query:'JSON & serialization','zip-work':'Files & directories',x25519:'Hashing & cryptography'};
 const units={sort:['lines',4096],'base64-work':['bytes',f.binary.length],wc:['bytes',Buffer.byteLength(f.words)],scan:['bytes',Buffer.byteLength(f.code)],'csv-work':['records',256],query:['records',256],'zip-work':['entries',64],x25519:['public_keys',64]};
 return {schema:1,id:`wago/${newId}`,family:'applications',abi:'core',artifact,source:'corpora/nonwasi/text/src/lib.rs',generator:'wasm-fyi-nonwasi-text-v1',features:[],work_unit:units[feature][0],units_per_invocation:units[feature][1],export:'benchmark',args:[],reset:'stateless',oracle:{kind:'exact_u64',expected:[String(hash)]},license:[...new Set(['MIT OR Apache-2.0',...licenses.map(p=>p.license)])].join('; '),provenance:{algorithm:newId,category:categories[feature],scope:'execution',resetPolicy:'Invocation-local state; previous output allocation replaced',kind:'upstream-library',description,semanticMapping:{replaces:`wago/${id}`,retained:description,excluded:'CLI, environment, filesystem, clocks and host entropy'},upstreamPackages:licenses,recipe:{compiler:version,target:'wasm32-unknown-unknown',targetCapabilities:['bulk-memory','sign-extension','saturating-float-to-int','reference-types'],cargoLockSha256:sha(await readFile(join(source,'Cargo.lock'))),source:'corpora/nonwasi/text',sourceSha256:sha(await readFile(join(source,'src/lib.rs'))),oracleSource:'scripts/nonwasi-text.mjs',oracleSourceSha256:sha(await readFile(fileURLToPath(import.meta.url))),features:[feature],flags:['--locked','--release','--no-default-features']},input:{files:Object.fromEntries(Object.entries(f.files).map(([k,v])=>[k,{bytes:Buffer.byteLength(v),sha256:sha(v)}]))},oraclePolicy:'Independent Node.js reference; all output bytes compared on four repeated calls, including output lengths. FNV-1a-64 over the complete output is the runner contract.',output:{bytes:expected.length,sha256:sha(expected)}}};
}
