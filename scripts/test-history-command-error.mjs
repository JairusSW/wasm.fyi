import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,appendFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {historyCommandError} from './lib/history-command-error.mjs';

test('failure diagnostics exclude earlier source errors and bound output',()=>{
 const root=mkdtempSync(join(tmpdir(),'history-command-error-'));
 try {
  const path=join(root,'build.log'),previous='Could not resolve host: github.com\n';
  writeFileSync(path,previous);appendFileSync(path,'genuine compiler error');
  const error=historyCommandError('cargo',1,path,Buffer.byteLength(previous));
  assert.match(error.message,/genuine compiler error/);
  assert.doesNotMatch(error.message,/Could not resolve/);
  appendFileSync(path,'x'.repeat(32000)+'\nfatal: Could not resolve host: github.com');
  const bounded=historyCommandError('git',128,path,0);
  assert.match(bounded.message,/Could not resolve/);
  assert.ok(bounded.message.length<16450);
 } finally {rmSync(root,{recursive:true,force:true});}
});
