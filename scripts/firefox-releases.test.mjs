import {test} from 'node:test';
import assert from 'node:assert/strict';
import {firefoxReleases} from './lib/firefox-releases.mjs';
test('includes minor, ESR and beta releases with their actual archive names',()=>{
 const rows=firefoxReleases({releases:{'firefox-157.0':{date:'2026-09-29'},'firefox-157.0.1':{date:'2026-10-06'},'firefox-140.17.0esr':{version:'140.17.0',date:'2026-09-29'},'firefox-158.0b1':{date:'2026-09-29'}}});
 assert.deepEqual(rows.map(r=>r.tag_name),['157.0','157.0.1','140.17.0esr','158.0b1']);
 assert.equal(rows[2].html_url,'https://archive.mozilla.org/pub/firefox/releases/140.17.0esr/');
 assert.equal(rows[2].prerelease,false);assert.equal(rows[3].prerelease,true);
});
test('rejects a malformed version ledger rather than dropping coverage silently',()=>{
 assert.throws(()=>firefoxReleases({}),/missing/);
 assert.throws(()=>firefoxReleases({releases:{'firefox-157.0':{date:'unknown'}}}),/Malformed/);
});
