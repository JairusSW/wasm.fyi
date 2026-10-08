// Refresh a sealed adapter under the host lock; upstream sources stay unchanged.
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
const [rootArg,revision]=process.argv.slice(2),root=resolve(rootArg);
if(!/^[0-9a-f]{40}$/.test(revision))throw Error('An exact SDK revision is required');
const directory=join(root,'builds','wago-'+revision),receipt=JSON.parse(await readFile(join(directory,'wago-build.json')));
if(receipt.pin.revision!==revision)throw Error('SDK revision differs');
const release=await acquireMeasurementLock(join(root,'measurement-lock'));
try{
 await runCommand(process.execPath,['scripts/weekly-build.mjs',directory,'wago',join(root,'frozen-harness')],{env:{...process.env,...receipt.env,GOMAXPROCS:'1'},log:join(directory,'native-code-refresh.log')});
}finally{await release();}
