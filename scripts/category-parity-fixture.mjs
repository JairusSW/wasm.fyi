import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {workloadCategory} from './lib/workload-category.mjs';
const names=['lcs-substrings','needleman-wunsch-dna','smith-waterman-dna','fasttree-phylogeny','seqtk-fastq-to-fasta','polybench-nussinov','wren','wren-modulo','lua','cjson','sightglass-shootout-base64','tinyxml2','coreutils-sha256sum','embench-crc32','embench-nettle-aes','embench-nettle-sha256','sightglass-libsodium-hash','embench-huffbench','embench-matmult-int','embench-qrduino','tacle-bsort','kissfft','raytrace','tiny','fib_rec','memory','memory_tree','dispatch','many_funcs','linked_list','json-as','json-as-simd','yyjson','utf-as','utf-as-simd','utf8proc','fastfloat','pcre2','sha256','blake-as','blake-as-simd','matmul','nbody','libtommath','fannkuch','coremark'];
const tags=['bioinformatics','fpga','compiler','formatter','interpreter','database','sql','filesystem','search','json','xml','text','base64','encryption','sort','hashing','crypto','compression','audio','image','graphics','image-processing','linear-algebra','blas','solver','stencil','statistics','numerical','graph','dynamic-programming'];
const inputs=[...names.map(name=>({id:'fixture/'+name})),...tags.map(tag=>({id:'fixture/unknown',original_contract:{tags:[tag]}})),
{id:'mechanisms/host-to-wasm-call'},{id:'mechanisms/wasm-to-host-call'},
{id:'features/probe',features:['simd']},{id:'features/probe',features:['simd'],provenance:{feature:'gc',category:'Override'}},{id:'features/probe'},
{id:'fixture/lua',provenance:{category:'Recorded category'}},{id:'fixture/unknown'},
{id:'fixture/raytrace',original_contract:{tags:['image','audio']}},{id:'fixture/lua',original_contract:{tags:['compiler','database']}}];
const source=await readFile('scripts/lib/workload-category.mjs');
const fixture={sourceSha256:createHash('sha256').update(source).digest('hex'),cases:inputs.map(input=>{let expected=null;try{expected=workloadCategory(input);}catch{}return {input,expected};})};
const text=JSON.stringify(fixture,null,2)+'\n',path='service/testdata/category-current.json';
if(process.argv.includes('--write'))await writeFile(path,text);else if(await readFile(path,'utf8')!==text)throw Error('Editorial category parity changed; inspect before --write');
console.log(`${inputs.length} editorial category fixtures verified`);
