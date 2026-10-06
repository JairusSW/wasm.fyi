import {open,rename,rm,readFile,mkdir,lstat,copyFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {digest} from './wasmbench.mjs';

export async function durableConformanceFile(path,bytes,{immutable=false}={}){
  await mkdir(dirname(path),{recursive:true});
  if(immutable){const info=await lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error;return null});if(info){assert(info.isFile()&&!info.isSymbolicLink(),'Invalid published conformance file');const existing=await readFile(path);assert.equal(digest(existing),digest(bytes),'Changed published conformance object');return}}
  const temporary=path+'.tmp-'+randomUUID();
  try{
    const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync()}finally{await file.close()}
    await rename(temporary,path);const directory=await open(dirname(path),'r');try{await directory.sync()}finally{await directory.close()}
  }finally{await rm(temporary,{force:true})}
}

export async function readConformanceIndex(path){
  const index=await readFile(path,'utf8').then(JSON.parse,error=>{if(error.code!=='ENOENT')throw error;return {schema:1,reports:[]}});
  assert(index?.schema===1&&Array.isArray(index.reports),'Invalid retained conformance index');
  const ids=new Set();for(const row of index.reports){assert(/^[a-f0-9]{64}$/.test(row.sha256)&&row.file===row.sha256+'.json'&&!ids.has(row.sha256),'Invalid retained conformance report reference');ids.add(row.sha256)}
  return index;
}

async function fileDigest(path){const info=await lstat(path);assert(info.isFile()&&!info.isSymbolicLink(),'Invalid published conformance file');const hash=createHash('sha256');for await(const bytes of createReadStream(path,{highWaterMark:128*1024}))hash.update(bytes);return hash.digest('hex')}

export async function installConformanceCopy(source,path,expected){
  assert.equal(await fileDigest(source),expected,'Changed retained conformance source');
  const existing=await lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error;return null});
  if(existing){assert.equal(await fileDigest(path),expected,'Changed published conformance object');return}
  await mkdir(dirname(path),{recursive:true});const temporary=path+'.tmp-'+randomUUID();
  try{
    await copyFile(source,temporary);assert.equal(await fileDigest(temporary),expected,'Conformance source changed while copying');
    const file=await open(temporary,'r');try{await file.sync()}finally{await file.close()}
    await rename(temporary,path);const parent=await open(dirname(path),'r');try{await parent.sync()}finally{await parent.close()}
  }finally{await rm(temporary,{force:true})}
}
