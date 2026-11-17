'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dist = path.resolve(__dirname, '../dist');
const context = vm.createContext({ window: {}, console });
vm.runInContext(fs.readFileSync(path.join(dist, 'three-local.js'), 'utf8'), context);
const file = path.join(dist, 'fragment-contact.js');
if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
const T = context.window.THREE, V = (x=0,y=0,z=0) => new T.Vector3(x,y,z);
function part(id, z=0, geometry = new T.BoxGeometry(6,6,.1)) {
  const node = new T.Group(), mesh = new T.Mesh(geometry, new T.MeshBasicMaterial());
  node.add(mesh); node.position.z=z;
  return { id, node, vel:V(), spin:V(), gone:false };
}
function collider(parts) {
  assert.ok(context.window.SkyfallFragmentContact, 'actual structural triangle collider must be available');
  const result = context.window.SkyfallFragmentContact.create(parts); result.sync(); return result;
}

// A cell envelope has a clear 2x2 window. Turning it into one solid broadphase
// box, forgetting the mesh world matrix, or checking endpoints loses these.
test('swept contact uses actual visible mesh triangles and keeps window openings clear', () => {
  const wall=part('window'); wall.node.clear();
  for (const [x,y,w,h] of [[-2,0,2,6],[2,0,2,6],[0,-2,2,2],[0,2,2,2]]) {
    const mesh=new T.Mesh(new T.BoxGeometry(w,h,.1),new T.MeshBasicMaterial());
    mesh.position.set(x,y,0); wall.node.add(mesh);
  }
  const c=collider([wall]);
  assert.equal(c.sweep(V(0,0,-10),V(0,0,10),{halfExtents:V(.2,.2,.2)}),null,'a fitting fragment crosses the window');
  const hit=c.sweep(V(1.5,0,-10),V(1.5,0,10),{halfExtents:V(.2,.2,.2)});
  assert.equal(hit.partId,'window');
  assert.ok(Math.abs(hit.time-.4875)<1e-6,'thin wall must be intercepted before the center crosses it');
  assert.ok(Math.abs(hit.point.z+.05)<1e-6);
  assert.ok(hit.normal.z<-.99);
  const edge=c.sweep(V(.85,0,-2),V(.85,0,2),{halfExtents:V(.3,.2,.2)});
  assert.ok(edge,'finite piece footprint hits a jamb even when its center fits');
});

test('first contact is independent of part order and excludes the released source or ignored group', () => {
  const a=part('near',0), b=part('far',3), c=collider([b,a]);
  assert.equal(c.sweep(V(0,0,-4),V(0,0,8)).partId,'near');
  assert.equal(c.sweep(V(0,0,-4),V(0,0,8),{excludePartId:'near'}).partId,'far');
  assert.equal(c.sweep(V(0,0,-4),V(0,0,8),{excludeIds:new Set(['near','far'])}),null);
  assert.equal(c.sweep(V(0,0,-4),V(0,0,8),{accept:hit=>hit.partId==='far'}).partId,'far');
  assert.equal(c.sweep(V(0,0,-4),V(0,0,8),{acceptNormal:(normal,part)=>part.id==='far'&&normal.z<-.9}).partId,'far');
  assert.equal(c.sweep(V(0,0,-4),V(0,0,8),{maxTime:.2}),null,'a known earlier sample prunes later surface contacts');
  assert.ok(Math.abs(c.sweep(V(0,0,-4),V(0,0,8),{maxTime:.4}).time-.3291666666)<1e-6,'pruning preserves time on the original segment');
});

test('sync follows translated rotated and parent-scaled proxy geometry, and gone parts stop blocking immediately', () => {
  const p=part(1), parent=new T.Group(); parent.add(p.node);
  parent.position.set(7,2,-3); parent.rotation.y=Math.PI/2; parent.scale.set(1,2,1.5);
  p.vel.set(2,0,0); p.spin.set(0,1,0);
  const c=collider([p]);
  const hit=c.sweep(V(3,2,-3),V(11,2,-3));
  assert.ok(hit); assert.ok(Math.abs(hit.point.x-6.925)<1e-6);
  assert.ok(hit.normal.x<-.99);
  parent.position.x=12; c.sync();
  assert.equal(c.sweep(V(3,2,-3),V(11,2,-3)),null);
  assert.ok(c.sweep(V(8,2,-3),V(16,2,-3)));
  p.gone=true;
  assert.equal(c.sweep(V(8,2,-3),V(16,2,-3)),null,'damage can remove a target before the next sync');
  p.gone=false; parent.visible=false;
  assert.equal(c.sweep(V(8,2,-3),V(16,2,-3)),null,'hidden parent geometry cannot become an invisible wall');
});

test('triangle BVH bounds a local query on a detailed mesh instead of scanning the whole wall', () => {
  const c=collider([part(1,0,new T.PlaneGeometry(40,40,120,120))]);
  const before=c.stats().triangleTests;
  const hit=c.sweep(V(.13,.17,-10),V(.13,.17,10),{halfExtents:V(.1,.1,.1)});
  assert.ok(hit);
  const checked=c.stats().triangleTests-before;
  assert.ok(checked<200,'local contact must prune the 28,800-triangle wall: '+checked);
  assert.equal(c.stats().triangles,28800);
});

test('contact moving away from a touching face does not reflect back into the wall', () => {
  const c=collider([part(1)]);
  assert.equal(c.sweep(V(0,0,-.15),V(0,0,-1),{halfExtents:V(.1,.1,.1)}),null);
  assert.ok(c.sweep(V(0,0,-.15),V(0,0,1),{halfExtents:V(.1,.1,.1)}));
});

test('zero-radius intact corner samples hit the exact boundary of a thin wall triangle', () => {
  const wall=part(1,0,new T.BoxGeometry(.05,3,1));wall.node.position.y=1.5;
  const c=collider([wall]);
  for(const z of [-.5,.5])for(const y of [1,3]) {
    const hit=c.sweep(V(-.03,y,z),V(.02,y-.000681,z),{radius:0});
    assert.ok(hit,'corner sample must not fall through a triangle edge at y='+y+',z='+z);
    assert.ok(hit.normal.x<-.99);assert.ok(Math.abs(hit.point.x+.025)<1e-6);
  }
});

test('zero-radius samples on authored closed faces may depart but cannot enter the solid at time zero', () => {
  const wall=part(1),c=collider([wall]);
  for(const side of [-1,1]) {
    const start=V(.13,.17,.05*side);
    assert.equal(c.sweep(start,V(.13,.17,.5*side),{radius:0}),null,
      'an outgoing point on the '+side+' face must not reflect back into it');
    const inward=c.sweep(start,V(.13,.17,0),{radius:0});
    assert.ok(inward,'an entering point remains blocked by the actual face');
    assert.ok(inward.time<1e-7);assert.ok(inward.normal.z*side>.99);
  }
});

test('positive-time point crossings remain two-sided even when approaching a back face', () => {
  const c=collider([part(1,0,new T.PlaneGeometry(6,6))]);
  for(const side of [-1,1]) {
    const hit=c.sweep(V(.13,.17,-2*side),V(.13,.17,2*side),{radius:0});
    assert.ok(hit);assert.ok(Math.abs(hit.time-.5)<1e-8);assert.ok(hit.normal.z*side<-.99);
  }
});
