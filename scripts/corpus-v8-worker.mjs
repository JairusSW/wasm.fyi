import { readFileSync } from 'node:fs';
import { checkV8 } from './lib/v8-corpus.mjs';
try {
  const workload=JSON.parse(readFileSync(0,'utf8'));
  process.stdout.write(JSON.stringify(await checkV8(workload))+'\n');
} catch(error) {
  process.stdout.write(JSON.stringify({status:'failed',reason:error.message})+'\n');
  process.exitCode=1;
}
