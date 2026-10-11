import test from 'node:test';
import assert from 'node:assert/strict';
import {historyPinAllowed} from './lib/history-window.mjs';
test('June28 is inclusive and older retained pins are excluded from new jobs',()=>{
 const template={historyNotBefore:'2026-06-28'};
 assert.equal(historyPinAllowed({targetWeek:'2026-06-28T10:00:00.000Z'},template),true);
 assert.equal(historyPinAllowed({targetWeek:'2026-07-05T10:00:00.000Z'},template),true);
 assert.equal(historyPinAllowed({targetWeek:'2026-06-21T10:00:00.000Z'},template),false);
 assert.equal(historyPinAllowed({targetWeek:'2026-06-21T10:00:00.000Z'}),true);
 assert.throws(()=>historyPinAllowed({targetWeek:'bad'},template));
 assert.throws(()=>historyPinAllowed({targetWeek:'2026-06-28'},{historyNotBefore:'2026-02-30'}));
});
