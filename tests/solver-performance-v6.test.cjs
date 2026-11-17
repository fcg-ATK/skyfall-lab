'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {building}=require('./helpers/collapse-performance-fixture.cjs');
const {loadInstrumented,record,hash}=require('./helpers/solver-performance-v6-fixture.cjs');
const golden=require('./helpers/solver-performance-v6.json');
let result;
function candidate(){if(!result){const {Solver,counts}=loadInstrumented();result=record(Solver,counts);}return result;}

test('local support pruning preserves every frozen physics/support/diagnostic checkpoint exactly',()=>{
 assert.deepEqual(candidate().checkpoints,golden.checkpoints);
 assert.equal(candidate().diagnostics,golden.diagnostics);
 assert.equal(candidate().contactGatherTrace,golden.contactGatherTrace,'every collected contact retains its exact numeric fields and order');
});
test('each source/support ownership test is shared by all four contact corners',()=>{
 assert.ok(golden.work.ownsLoad>=400,'the baseline must exercise a substantial contact gather');
 assert.equal(candidate().work.ownsLoad,golden.work.ownsLoad/4);
});
test('ineligible supports never build a contact-gather snapshot',()=>{
 assert.ok(candidate().work.snapshots<golden.work.snapshots,'build snapshots only after floor and ownership eligibility');
});
test('diagnostics clones its existing assessment map without rebuilding per-part signatures',()=>{
 assert.ok(golden.work.diagnosticAssessments>40,'baseline diagnostics exercises the full standing building');
 assert.equal(candidate().work.diagnosticAssessments,1);
});
test('diagnostic loads remain independent public deep copies',()=>{
 const {Solver}=loadInstrumented(),f=building(Solver,'intact'),first=f.solver.diagnostics(),expected=hash(first);
 const value=first.flatMap(floor=>floor.loads).find(part=>part.supportIds.length);
 assert.ok(value);
 value.supportIds.push(-1);value.carriedIds.push(-2);value.centerOfLoad.y+=10;
 assert.equal(hash(f.solver.diagnostics()),expected);
 const assessment=f.solver.assessPart(value.id);assessment.supportIds.push(-3);assessment.centerOfLoad.x-=10;
 assert.equal(hash(f.solver.diagnostics()),expected);
});
