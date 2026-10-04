import {latestReports} from './lib/latest-reports.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { command, config, site, locked } from './lib/wasmbench.mjs';
// Serialize collection independently; update-data owns the installation lock.
await locked(async () => {
  const settings=await config();
  if(settings.collection.includeFeatures!==false) {
  command(process.execPath,['scripts/history.mjs','plan'],{stdio:'inherit'});
  command(process.execPath,['scripts/conformance.mjs','collect'],{stdio:'inherit'});
  const conformance=(await readFile(join(site,'.wasmbench/latest-conformance-report.txt'),'utf8')).trim();
  command(process.execPath,['scripts/publish-conformance.mjs',conformance],{stdio:'inherit'});
  if(!process.argv.includes('--local'))command(process.execPath,['scripts/hub.mjs','conformance'],{stdio:'inherit'});
  }
  if((process.env.WASMBENCH_RUNTIMES || settings.collection.runtimes.join(',')).includes('wasmer-'))command(process.execPath,['--test','scripts/wasmer-adapter.test.mjs'],{stdio:'inherit',env:{...process.env,WASMBENCH_REQUIRE_WASMER_TESTS:'1'}});
  command(process.execPath, ['scripts/bench.mjs', 'collect'], { stdio: 'inherit' });
  const report = (await readFile(join(site, '.wasmbench/latest-report.txt'), 'utf8')).trim();
  const reports = await latestReports(site);
  if (!process.argv.includes('--local')) {
    command(process.execPath, ['scripts/hub.mjs', 'collect'], { stdio: 'inherit' });
    reports.push(...await latestReports(site,true));
  }
  if (settings.collection.includeFeatures!==false&&!process.env.WASMBENCH_SKIP_FEATURES) {
    const featureEnv = { ...process.env, WASMBENCH_SUITE: 'corpora/features/manifest.json', WASMBENCH_VALIDATION_PROFILE: 'all', WASMBENCH_WARMUP: '0', WASMBENCH_RECORD_FAILURES: '1' };
    command(process.execPath, ['scripts/bench.mjs','build'], { stdio:'inherit',env:featureEnv });
    command(process.execPath,['--test','scripts/extra-feature-adapters.test.mjs'],{stdio:'inherit',env:{...featureEnv,WASMBENCH_REQUIRE_EXTRA_FEATURE_TESTS:'1'}});
    if((featureEnv.WASMBENCH_RUNTIMES || settings.collection.featureRuntimes?.join(',') || '').includes('wasmer-'))command(process.execPath,['--test','scripts/wasmer-adapter.test.mjs'],{stdio:'inherit',env:{...featureEnv,WASMBENCH_REQUIRE_WASMER_TESTS:'1'}});
    command(process.execPath, ['scripts/feature-corpus.mjs', 'check'], { stdio: 'inherit', env: featureEnv });
    command(process.execPath, ['scripts/bench.mjs', 'collect'], { stdio: 'inherit', env: featureEnv });
    reports.push(...await latestReports(site));
    if (!process.argv.includes('--local')) {
      command(process.execPath, ['scripts/hub.mjs', 'collect'], { stdio: 'inherit', env: featureEnv });
      reports.push(...await latestReports(site,true));
    }
  }
  if (settings.collection.includeFeatures!==false&&!process.env.WASMBENCH_SKIP_FEATURES) {
    command(process.execPath, ['scripts/thread-workers.mjs'], { stdio: 'inherit' });
    if (!process.argv.includes('--local')) command(process.execPath, ['scripts/hub.mjs','threads'], { stdio: 'inherit' });
  }
  command(process.execPath,['scripts/deduplicate-evidence.mjs'],{stdio:'inherit'});
  command(process.execPath, ['scripts/update-data.mjs', '--append', ...reports], { stdio: 'inherit' });
}, 'refresh');
