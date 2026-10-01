import { packEvidence } from './lib/evidence-archive.mjs';
const [source, archive, mode] = process.argv.slice(2);
if (!source || !archive || (mode && mode !== '--complete')) throw new Error('Usage: pack-evidence.mjs SOURCE ARCHIVE [--complete]');
console.log(JSON.stringify(await packEvidence(source, archive, mode === '--complete')));
