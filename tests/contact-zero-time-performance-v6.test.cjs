'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,cases,exercise,capture,revive}=require('./helpers/contact-zero-time-fixture.cjs');
const golden=revive(require('./helpers/contact-zero-time-v812.json'));
const rt=runtime();

test('an accepted zero-time point or finite-box hit stops redundant SAT work',()=>{
 for(const spec of cases.filter(c=>c.name.startsWith('dense'))){
  const result=exercise(rt,spec);
  assert.equal(result.snapshot.time,0);
  assert.deepEqual(result.snapshot,golden.results[spec.name].snapshot);
  assert.equal(result.triangleTests,1,spec.name+': one accepted coplanar triangle already owns the first-hit tie');
 }
});

test('rejected zero-time hits and normals must continue to the first accepted contact',()=>{
 for(const spec of cases.filter(c=>c.rejectHits||c.rejectNormals)){
  const result=exercise(rt,spec);
  assert.equal(result.snapshot.time,0);
  assert.equal(result.triangleTests,3,'the first two rejected triangles cannot terminate a query');
  assert.equal(result.acceptCalls||result.normalCalls,3);
 }
});

test('maxTime zero alone does not terminate a query with no accepted hit',()=>{
 for(const spec of cases.filter(c=>c.rejectAll)){
  const result=exercise(rt,spec);
  assert.equal(result.snapshot,null);assert.equal(result.acceptCalls,128);
  assert.equal(result.triangleTests,128,'all still-eligible zero-time candidates must reach the rejecting callback');
 }
});

test('accepted zero-time termination crosses mesh BVHs and candidate pools without bypassing visibility or exclusions',()=>{
 for(const spec of cases.filter(c=>c.many)){
  const result=exercise(rt,spec);
  assert.equal(result.snapshot.partId,6,'hidden, gone, excluded and normal-rejected records cannot own the contact');
  assert.equal(result.meshTests,2,'only the rejected record and first accepted record need exact tests');
  assert.equal(result.triangleTests,65);
 }
});

test('all zero-time, rejected and positive-time contact fields retain the frozen v8.12 results',()=>{
 assert.deepEqual(capture(rt),golden.results);
});
