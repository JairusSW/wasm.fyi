import { packEvidence } from './lib/evidence-archive.mjs';
const [source, archive, ...modes] = process.argv.slice(2);
if (!source || !archive || modes.some(mode => !['--complete','--latest-report','--wasm-fyi'].includes(mode))) throw new Error('Usage: pack-evidence.mjs SOURCE ARCHIVE [--complete] [--latest-report] [--wasm-fyi]');
console.log(JSON.stringify(await packEvidence(source, archive, modes.includes('--complete'), modes.includes('--latest-report'), modes.includes('--wasm-fyi'))));
