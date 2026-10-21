import assert from 'node:assert/strict';

function reader(bytes) {
 let position=0;
 return {get position(){return position;},get done(){return position===bytes.length;},
  byte(){assert.ok(position<bytes.length,'Truncated section');return bytes[position++];},
  u(){let value=0,shift=0,b;do{assert.ok(shift<35,'Oversized LEB');b=this.byte();value+=(b&127)*2**shift;shift+=7;}while(b&128);return value;},
  take(n){assert.ok(position+n<=bytes.length,'Truncated payload');const v=bytes.subarray(position,position+n);position+=n;return v;}};
}
function sections(bytes) {
 const input=reader(bytes.subarray(8)),sections=[];
 while(!input.done){const id=input.byte(),payload=input.take(input.u());sections.push({id,payload});}
 return sections;
}
function custom(all,name) {
 const matches=all.filter(s=>s.id===0).map(s=>{const r=reader(s.payload);return {name:new TextDecoder().decode(r.take(r.u())),payload:r.take(s.payload.length-r.position)};}).filter(s=>s.name===name);
 assert.equal(matches.length,1,'Expected one '+name+' section');return matches[0].payload;
}

// Executing a module cannot establish whether metadata was emitted correctly.
// Validate the actual bytes, including the referenced instruction offsets.
export function checkProposalMetadata(fixture,bytes) {
 const all=sections(bytes),feature=fixture.feature;
 if(feature==='branch-hinting') {
  const r=reader(custom(all,'metadata.code.branch_hint'));
  assert.equal(r.u(),1);assert.equal(r.u(),0);assert.equal(r.u(),1);
  const offset=r.u();assert.equal(r.u(),1);const hint=r.byte();assert.ok(hint===0||hint===1);assert.ok(r.done);
  const code=reader(all.find(s=>s.id===10).payload);assert.equal(code.u(),1);
  const body=code.take(code.u());assert.ok([0x04,0x0d].includes(body[offset]),'Hint must reference an if or br_if opcode');
  return {section:'metadata.code.branch_hint',function:0,offset,hint};
 }
 if(feature==='extended-name-section') {
  const expected={'type-name':4,'table-name':5,'memory-name':6,'global-name':7,'element-name':8,'data-name':9,'field-name':10,'tag-name':11}[fixture.name];
  const r=reader(custom(all,'name')),subsections=[];
  while(!r.done){
   const id=r.byte(),payload=r.take(r.u());subsections.push(id);
   if(id===expected){
    const names=reader(payload),strings=[];
    const map=()=>{const count=names.u();assert.ok(count>0,'Empty extended name map');for(let i=0;i<count;i++){names.u();strings.push(new TextDecoder().decode(names.take(names.u())));}};
    if(id===10){const types=names.u();for(let i=0;i<types;i++){names.u();map();}}else map();
    assert.ok(names.done,'Trailing name-map bytes');
    const label='named-'+fixture.name.replace('-name','');
    assert.ok(strings.includes(label),'Missing actual extended name '+label);
   }
  }
  assert.ok(subsections.includes(expected),'Missing extended name subsection');return {section:'name',subsections};
 }
 if(feature==='compilation-hints') {
  const r=reader(custom(all,'metadata.code.compilation_priority'));
  assert.equal(r.u(),1);assert.equal(r.u(),0);assert.equal(r.u(),1);assert.equal(r.u(),0);
  const payload=r.take(r.u());assert.ok(payload.length>=1&&payload.length<=3);assert.ok(r.done);
  return {section:'metadata.code.compilation_priority',payload:[...payload]};
 }
 if(feature==='instrument-and-tracing-technology') {
  const r=reader(custom(all,'metadata.code.trace_inst'));
  assert.equal(r.u(),1);assert.equal(r.u(),0);assert.equal(r.u(),1);const offset=r.u();assert.equal(r.u(),4);
  assert.deepEqual([...r.take(4)],[0x78,0x56,0x34,0x12]);assert.ok(r.done);
  const code=reader(all.find(s=>s.id===10).payload);assert.equal(code.u(),1);const body=code.take(code.u());
  assert.equal(body[offset],0x02,'Trace offset must refer to the opening block');
  return {section:'metadata.code.trace_inst',offset,mark:0x12345678,emission:'V8 15.2 emits native trace markers on x64 only; ARM64 execution is a semantic control'};
 }
 return null;
}
