import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, link, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { verifySeal } from './verify-seal.mjs';
import { command } from './wasmbench.mjs';
import { exportWasmFyiReport } from './wasmfyi-export.mjs';

export async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

// Deduplicate only the owned transport copy. Original experiment files remain
// untouched; tar restores every pathname, including identical hard-linked files.
export async function packEvidence(source, archive, complete = false, latestReportOnly = false, wasmFyi = false) {
  source = resolve(source); archive = resolve(archive);
  if (archive.startsWith(source + '/')) throw new Error('Archive must be outside its source');
  if (wasmFyi && !latestReportOnly) throw new Error('wasm.fyi transport requires a single latest report');
  let latestReportPath;
  if (latestReportOnly && !wasmFyi) {
    const remoteReport = (await readFile(join(source, 'latest-report.txt'), 'utf8')).trim();
    const leaf = remoteReport.split('/').at(-2);
    if (!/^[a-zA-Z0-9-]+$/.test(leaf || '') || !remoteReport.endsWith(`/experiments/${leaf}/report`))
      throw new Error('Invalid latest report pointer for evidence transport');
    latestReportPath = `experiments/${leaf}/report`;
  }
  const staging = await mkdtemp(join(dirname(archive), '.evidence-transport-'));
  if (wasmFyi) {
    try {
      const reportPaths=await readFile(join(source,'latest-reports.json'),'utf8').then(JSON.parse,error=>{if(error.code!=='ENOENT')throw error;return null;}) || [(await readFile(join(source,'latest-report.txt'),'utf8')).trim()];
      if(!Array.isArray(reportPaths)||!reportPaths.length)throw Error('Empty latest report inventory');
      const projections=[],relativePaths=[];
      for(const remoteReport of reportPaths) {
        const reportPath=resolve(remoteReport),leaf=reportPath.split('/').at(-2);
        if(!/^[a-zA-Z0-9-]+$/.test(leaf||'')||!reportPath.startsWith(source+'/')||!reportPath.endsWith('/report'))throw Error('Invalid latest report pointer for wasm.fyi transport');
        const receipt=await readFile(join(reportPath,'wasm-fyi-export.json'),'utf8').then(JSON.parse,error=>{if(error.code!=='ENOENT')throw error;return null;});
        if(receipt) {
          await verifySeal(reportPath);
          const path='wasm-fyi/'+leaf+'/report';
          if(relativePaths.includes(path))throw Error('Duplicate corpus projection path');
          await cp(reportPath,join(staging,path),{recursive:true});relativePaths.push(path);
          projections.push({path,runId:receipt.runId,sourceReportSha256:receipt.sourceReportSha256});
        } else {
          const projection=await exportWasmFyiReport(reportPath,staging);projections.push(projection);relativePaths.push(projection.path);
        }
      }
      await writeFile(join(staging,'latest-wasm-fyi-reports.json'),JSON.stringify(relativePaths)+'\n');
      await writeFile(join(staging,'latest-wasm-fyi-report.txt'),relativePaths.at(-1)+'\n');
      const projection=projections.at(-1);
      const tar=process.platform==='darwin'?'gtar':'tar';
      command(tar,['-I','zstd -T0 -3','-cf',archive,'-C',staging,'latest-wasm-fyi-reports.json','latest-wasm-fyi-report.txt','wasm-fyi']);
      const bytes = (await stat(archive)).size;
      return { sha256: await fileDigest(archive), bytes, files: 2+3*projections.length, uniqueFiles: 2+3*projections.length, format: 'tar+zstd', profile: 'wasm.fyi-v1', projection, projections };
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  const content = new Map();
  let files = 0;
  try {
    async function walk(relative = '') {
      await mkdir(join(staging, relative), { recursive: true });
      for (const entry of await readdir(join(source, relative), { withFileTypes: true })) {
        const path = relative ? relative + '/' + entry.name : entry.name;
        if (latestReportPath && path !== 'latest-report.txt' && path !== latestReportPath &&
            !latestReportPath.startsWith(path + '/') && !path.startsWith(latestReportPath + '/')) continue;
        // Completed reports already contain all sealed passes. Failed runs keep
        // their original pass directories for diagnosis.
        if (/^history\/(?:harness-[^/]+|revisions)$/.test(path)) continue;
        if (complete && /^experiments\/[^/]+\/(timing|memory|code)-[^/]+$/.test(path)) continue;
        if (entry.isDirectory()) await walk(path);
        else {
          if (!entry.isFile()) throw new Error('Evidence transport accepts regular files only');
          const original = join(source, path), target = join(staging, path);
          const sha = await fileDigest(original);
          const key = `${sha}:${(await stat(original)).mode}`;
          if (content.has(key)) await link(content.get(key), target);
          else {
            await cp(original, target, { preserveTimestamps: true });
            content.set(key, target);
          }
          files++;
        }
      }
    }
    await walk();
    command('tar', ['-cJf', archive, '-C', staging, '.'], {
      env: { ...process.env, XZ_OPT: '-T2 -9' }, timeout: 15 * 60 * 1000
    });
    return { sha256: await fileDigest(archive), bytes: (await stat(archive)).size, files, uniqueFiles: content.size };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
