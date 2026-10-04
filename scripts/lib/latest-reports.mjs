import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function latestReports(site,hub=false) {
 const prefix=hub?'latest-hub':'latest';
 const reports=await readFile(join(site,'.wasmbench',prefix+'-reports.json'),'utf8').then(JSON.parse,error=>{if(error.code!=='ENOENT')throw error;return null;});
 if(reports){if(!Array.isArray(reports)||!reports.length||reports.some(p=>typeof p!=='string'||!p))throw Error('Invalid latest report inventory');return reports;}
 return [(await readFile(join(site,'.wasmbench',prefix+'-report.txt'),'utf8')).trim()];
}
