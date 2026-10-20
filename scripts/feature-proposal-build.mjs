import {spawnSync} from 'node:child_process';
import {proposalGapIds} from '../corpora/features/proposal-gaps.mjs';
import {proposalBinaryIds} from '../corpora/features/proposal-binary.mjs';
const family='--family='+[...proposalGapIds,...proposalBinaryIds].join(',');
for(const args of [
 ['scripts/feature-corpus.mjs','build',family],
 ['scripts/feature-performance-suite.mjs','.wasmbench/proposal-performance',family],
]) {
 const p=spawnSync(process.execPath,args,{stdio:'inherit'});
 if(p.error)throw p.error;
 if(p.status!==0)process.exit(p.status||1);
}
