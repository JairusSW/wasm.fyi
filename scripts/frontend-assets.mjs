import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {siteUrl} from './lib/ai-metadata.mjs';
const publicRoot=siteUrl('',process.env.BASE_PATH||'');
// Runtime dataset publication must not be copied into a frontend build. Original
// collection/static evidence remains retained for offline conversion and audit.
const output=resolve('.wasmfyi/frontend-assets');await mkdir(output,{recursive:true});
for(const name of ['favicon.svg'])await copyFile(resolve('static',name),resolve(output,name));
await writeFile(resolve(output,'robots.txt'),'User-agent: *\nAllow: /\nSitemap: '+publicRoot+'sitemap.xml\n');
await writeFile(resolve(output,'llms.txt'),`# wasm.fyi\n\nGET /api/platforms discovers platform IDs. GET /api/benchmarks?platform=ID&phase=steady returns latest latency, peak RSS and code size with cursor pagination. POST /api/captures atomically publishes authenticated capture JSON. No reports, binaries or evidence are retained.\n`);
await copyFile(resolve(output,'llms.txt'),resolve(output,'llms-full.txt'));

await writeFile(resolve(output,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+['','benchmarks/','history/','features/','simd/','gc/','memory64/','threads/'].map(path=>'<url><loc>'+publicRoot+path+'</loc></url>').join('')+'</urlset>');
