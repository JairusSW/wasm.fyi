import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Probe the actual prepared controller, not a source checkout or help string.
// This command performs no measurement, export, or archived-tool execution.
export async function verifySiteExportContract(binary,{cwd,env=process.env,signal,execute=exec}={}) {
  signal?.throwIfAborted();
  let response;
  try {
    const {stdout}=await execute(binary,['export-site','--describe'],{cwd,env,signal,timeout:30_000,maxBuffer:16*1024});
    response=JSON.parse(stdout);
    assert(response&&response.schema===1&&response.format==='site-v2'&&response.exportSchema===2&&response.verification==='source-recomputed');
    for(const [field,ceiling] of Object.entries({chunkBytes:256*1024,binaryBytes:16*1024*1024,inventoryObjects:512,inventoryPages:512}))
      assert(Number.isSafeInteger(response[field])&&response[field]>0&&response[field]<=ceiling);
  } catch(error) {
    signal?.throwIfAborted();
    throw new Error('API collection requires a controller supporting the bounded site-v2 export contract; prepare a compatible pinned producer before collecting.',{cause:error});
  }
  signal?.throwIfAborted();
  return response;
}
