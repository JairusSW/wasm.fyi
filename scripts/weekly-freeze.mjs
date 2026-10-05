// Align the isolated per-engine adapters without deleting their compiled SDK cache.
import {readFile,mkdir,cp,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,dirname,resolve} from 'node:path';
const [directoryArg,analyzerBase]=process.argv.slice(2),directory=resolve(directoryArg),base=join(directory,'frozen-harness');
const files=execFileSync('git',['-C',base,'ls-files','-z']).toString().split('\0').filter(Boolean);
const analyzer='adapters/wasmtime/target/release/wasm-analyze';
await mkdir(dirname(join(base,analyzer)),{recursive:true});await cp(join(analyzerBase,analyzer),join(base,analyzer));
for(const engine of ['wago','wazero','wasmtime','wasmer','wavm','v8']){
 const root=join(directory,'harness',engine);await mkdir(root,{recursive:true});
 for(const path of files){await mkdir(dirname(join(root,path)),{recursive:true});await cp(join(base,path),join(root,path));}
 await mkdir(dirname(join(root,analyzer)),{recursive:true});await cp(join(base,analyzer),join(root,analyzer));
}
execFileSync('go',['build','-trimpath','-o',join(directory,'controller'),'./cmd/wasmbench'],{cwd:base,env:{...process.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'},stdio:'inherit'});
await writeFile(join(directory,'harness-pin.json'),JSON.stringify({revision:execFileSync('git',['-C',base,'rev-parse','HEAD']).toString().trim(),files:files.length})+'\n');
console.log('All engine adapters aligned to frozen harness');
