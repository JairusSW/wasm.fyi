// Compile the adapter library included in the WASI Preview 2 feature modules.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { digest, site, exists } from './lib/wasmbench.mjs';
import { featureCompiler } from './lib/feature-toolchain.mjs';
const revision='823d1b8f251494a06288194d0df746191f535ff7';
export const sourceAdapterSha256='3d8e5be5a162ef5e004b52587e5ecaba4e8b92691f53f97e4bea957ef2c5efe8';
export async function sourceAdapter() {
  const root=join(site,'.wasmbench/toolchains');await mkdir(root,{recursive:true});
  const output=join(root,'wasi_snapshot_preview1.source.command.wasm'),marker=output+'.json';
  const recipeSha256=digest(await readFile(join(site,'scripts/feature-adapter-source.mjs')));
  const recipe={repository:'https://github.com/bytecodealliance/wasmtime.git',revision,rust:'1.98.1',recipeSha256,sha256:sourceAdapterSha256};
  if(await exists(output)&&await exists(marker)&&JSON.stringify(JSON.parse(await readFile(marker)))===JSON.stringify(recipe)&&digest(await readFile(output))===sourceAdapterSha256)return {path:output,...recipe};
  const dir=join(site,'.wasmbench/source-builds','preview1-adapter-'+Date.now());await mkdir(dir,{recursive:true});
  async function run(program,args,options={}) {
    console.log(program,...args);
    await new Promise((ok,fail)=>{const p=spawn(program,args,{cwd:dir,env:process.env,stdio:'inherit',...options});p.on('error',fail);p.on('exit',code=>code===0?ok():fail(Error(`${program} exited ${code}`)));});
  }
  const checkout=join(dir,'wasmtime');
  await run('git',['init','--quiet',checkout]);
  await run('git',['remote','add','origin',recipe.repository],{cwd:checkout});
  await run('git',['fetch','--depth=1','origin',revision],{cwd:checkout});
  await run('git',['checkout','--detach',revision],{cwd:checkout});
  const cargo=process.env.CARGO || 'cargo';
  const env={...process.env,RUSTUP_TOOLCHAIN:'1.98.1',CARGO_PROFILE_RELEASE_LTO:'fat',CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS:'-Ctarget-feature=+bulk-memory'};
  await run(cargo,['build','--locked','-p','wasi-preview1-component-adapter','--target','wasm32-unknown-unknown','--release','--no-default-features','--features','command'],{cwd:checkout,env});
  const raw=join(checkout,'target/wasm32-unknown-unknown/release/wasi_snapshot_preview1.wasm');
  await run(cargo,['run','--locked','--release','-p','verify-component-adapter','--',raw],{cwd:checkout,env});
  const tools=await featureCompiler();
  const staged=join(dir,'adapter.wasm');
  await run(tools,['metadata','add','--name','wasi_preview1_component_adapter.command.adapter',raw,'-o',staged]);
  if(digest(await readFile(staged))!==sourceAdapterSha256)throw Error('Source-built adapter differs from the verified Rust 1.98.1 artifact');
  await copyFile(staged,output);await writeFile(marker,JSON.stringify(recipe)+'\n');
  return {path:output,...recipe};
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(await sourceAdapter());
