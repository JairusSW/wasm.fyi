// Regression check for the eager full-dataset loading path.
import assert from 'node:assert/strict';
const origin=process.argv[2]||'http://localhost:8080';
const response=await fetch(origin+'/api/summary');
assert.equal(response.status,200,'Startup must have a bounded summary endpoint');
const bytes=new Uint8Array(await response.arrayBuffer());
assert.ok(bytes.length<100_000,`Summary is too large: ${bytes.length} bytes`);
const body=JSON.parse(new TextDecoder().decode(bytes));
assert.ok(Array.isArray(body.platforms),'Summary must list machines');
assert.ok(!JSON.stringify(body).includes('samplesNs'),'Startup must not carry ordered samples');
assert.ok(!JSON.stringify(body).includes('history.cells'),'Startup must not carry historical cells');
console.log(JSON.stringify({status:'passed',summaryBytes:bytes.length,machines:body.platforms.length}));
