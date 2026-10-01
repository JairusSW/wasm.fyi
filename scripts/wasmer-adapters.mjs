import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { command, digest, harness, locked } from './lib/wasmbench.mjs';
import { patchHarness } from './lib/harness-patch.mjs';

await locked(async () => {
  const sdk=resolve(process.env.WASMBENCH_WASMER_SDK || join(homedir(),'.local/share/wasm-fyi/toolchains/wasmer-c-api-7.3.0/sdk'));
  const manifest=JSON.parse(await readFile(join(sdk,'build.json')));
  if(manifest.version!=='7.3.0' || manifest.revision!=='35c10644f7b0aad6fd9458624ceb8429fe7413c4')throw new Error('Native adapters require the pinned managed Wasmer SDK');
  if(digest(await readFile(join(sdk,'lib',manifest.library)))!==manifest.librarySha256)throw new Error('SDK library differs from its build manifest');
  const {root}=await harness();patchHarness(root);
  command('go',['run','./cmd/wasmbench','build','--runtimes','wasmer-llvm,wasmer-singlepass'],{cwd:root,stdio:'inherit',timeout:30*60_000,env:{...process.env,WASMBENCH_WASMER_SDK:sdk}});
  command(process.execPath,['--test','scripts/wasmer-adapter.test.mjs'],{stdio:'inherit',timeout:120_000,env:{...process.env,WASMBENCH_REQUIRE_WASMER_TESTS:'1'}});
},'wasmer-adapters');
