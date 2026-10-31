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
