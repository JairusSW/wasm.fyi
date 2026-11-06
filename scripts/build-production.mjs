import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {verifyBakedPages} from './verify-baked-pages.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const result=spawnSync('pnpm',['build'],{
 cwd:root,stdio:'inherit',
 env:{...process.env,WASMFYI_PRERENDER_API_ORIGIN:process.env.WASMFYI_PRERENDER_API_ORIGIN||'https://wasm.fyi'}
});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status||1);
await verifyBakedPages(resolve(root,process.env.WASMFYI_FRONTEND_OUTPUT||'build'));

const renderer=spawnSync(process.execPath,['scripts/build-homepage-renderer.mjs'],{cwd:root,stdio:'inherit',env:process.env});
if(renderer.status!==0)process.exit(renderer.status||1);
const {copyFile}=await import('node:fs/promises');
const output=resolve(root,process.env.WASMFYI_FRONTEND_OUTPUT||'build');
await copyFile(resolve(root,'.wasmfyi/homepage-renderer/homepage-baker.mjs'),resolve(output,'.homepage-baker.mjs'));
for(const [source,target] of [['watch-homepage.py','.homepage-watch.py'],['wasmfyi-homepage.service','.homepage.service'],['wasmfyi-homepage.timer','.homepage.timer']])await copyFile(resolve(root,'scripts',source),resolve(output,target));
