'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const {fixture,measure}=require('./helpers/contact-parity-fixture.cjs');
const current=path.resolve(__dirname,'../dist');
const reference=process.env.CONTACT_V4_DIST||path.resolve(__dirname,'../../skyfall-collapse-v4/dist');
const available=fs.existsSync(path.join(reference,'fragment-contact.js'));
// Frozen v4 outputs include ids, times, contact points, normals, centres and
// transported velocities. Keep this check useful in a standalone checkout;
// a local v4 checkout additionally permits exact field-by-field diagnostics.
const v4Hash='aa20c90d498f0176300243698826d031db1b32e6ba6372af25187d0e35562db7';
function matchesV4(next) {
  assert.equal(next.hits,1776);
  assert.equal(next.results.length,7383);
  assert.equal(createHash('sha256').update(JSON.stringify(next.results)).digest('hex'),v4Hash);
  if(available)assert.deepEqual(next.results,fixture(reference).run(true).results);
}

test('optimized contact preserves all v4 hit fields for moving/rotated exact geometry, openings and ties', ()=>{
  matchesV4(fixture(current).run(true));
});

test('conservative candidate batches preserve every exact v4 contact and rejection', ()=>{
  matchesV4(fixture(current).run(true,true));
});

test('large candidate pools retain spatial pruning and respect candidate restrictions', ()=>{
  const subject=fixture(current,1),contact=subject.collider;
  const pool=contact.candidates({min:{x:-100,y:-100,z:-100},max:{x:100,y:100,z:100}});
  assert.ok(pool.length>20);
  const sample=subject.queries[0][0].clone().set(.13,3,-3),end=sample.clone().set(.13,3,10);
  const before=contact.stats();
  assert.equal(contact.sweep(sample,end,{candidates:pool}).partId,'tie-first');
  const visits=contact.stats().meshTests-before.meshTests;
  assert.ok(visits<pool.length/2,'a coherent group envelope must not turn every sample into a linear mesh scan: '+visits);
  const filtered=pool.filter(record=>record.part.id!=='tie-first'&&record.part.id!=='tie-second');
  assert.equal(contact.sweep(sample,end,{candidates:filtered}).partId,103,'large-pool BVH traversal must keep the supplied restriction');
});

test('candidate bounds include the exact sweep time tolerance beyond long segment endpoints', ()=>{
  const context=vm.createContext({window:{},console});
  for(const file of ['three-local.js','fragment-contact.js'])
    vm.runInContext(fs.readFileSync(path.join(current,file),'utf8'),context);
  const T=context.window.THREE,node=new T.Group();
  node.add(new T.Mesh(new T.PlaneGeometry(6,6),new T.MeshBasicMaterial()));
  const contact=context.window.SkyfallFragmentContact.create([{id:'plane',node,gone:false}]);
  for(const radius of [0,.1]) {
    const start=new T.Vector3(0,0,-100),end=new T.Vector3(0,0,-radius-5e-7);
    const bounds=new T.Box3().setFromPoints([start,end]);
    bounds.min.addScalar(-radius);bounds.max.addScalar(radius);
    const options={radius},ordinary=contact.sweep(start,end,options);
    assert.ok(ordinary,'v4 permits the endpoint within delta * EPS of the plane');
    assert.equal(ordinary.time,1);
    const pool=contact.candidates(bounds,options);
    assert.equal(pool.length,1,'candidate padding must include the exact time tolerance');
    const batched=contact.sweep(start,end,{...options,candidates:pool});
    assert.ok(batched);assert.equal(batched.time,ordinary.time);
    assert.deepEqual(batched.point.toArray(),ordinary.point.toArray());
    assert.deepEqual(batched.normal.toArray(),ordinary.normal.toArray());
  }
});

// Explicit opt-in: timing is diagnostic and should not make ordinary CI flaky.
test('contact CPU benchmark improves the same exact geometry workload', {skip:!available||!process.env.CONTACT_PERF}, ()=>{
  const old=fixture(reference,6000), next=fixture(current,6000);
  const baseline=measure(old), candidate=measure(next);
  console.log(JSON.stringify({node:process.version,baseline,candidate,ratio:candidate.medianMs/baseline.medianMs,
    old:old.collider.stats(),next:next.collider.stats()}));
  assert.ok(candidate.medianMs<baseline.medianMs*.85,'same queries must run at least 15% faster');
});
