import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareHistoryPin} from './lib/prepare-history-pin.mjs';

const pins=[
 {engine:'wamr',targetType:'main',status:'planned',configurations:['wamr'],targetWeek:'2026-10-08T00:00:00.000Z',revision:'a'.repeat(40)},
 {engine:'wamr',targetType:'main',status:'planned',configurations:['wamr'],targetWeek:'2026-10-15T00:00:00.000Z',revision:'b'.repeat(40)},
 {engine:'wamr',targetType:'release',status:'planned',configurations:['wamr'],targetWeek:'2026-10-15T00:00:00.000Z',revision:'c'.repeat(40)},
];

test('profile preparation binds the requested historical week exactly',()=>{
 assert.equal(prepareHistoryPin(pins,{engine:'wamr',configuration:'wamr',week:'2026-10-08T00:00:00.000Z'}).revision,'a'.repeat(40));
 assert.equal(prepareHistoryPin(pins,{engine:'wamr',configuration:'wamr',week:'2026-10-15T00:00:00.000Z'}).revision,'b'.repeat(40));
 assert.equal(prepareHistoryPin(pins,{engine:'wamr',configuration:'wamr',week:'missing'}),null);
});

test('profile preparation defaults to the newest main snapshot',()=>{
 assert.equal(prepareHistoryPin(pins,{engine:'wamr',configuration:'wamr'}).revision,'b'.repeat(40));
});
