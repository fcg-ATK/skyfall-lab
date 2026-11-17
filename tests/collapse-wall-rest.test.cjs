'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/wall-rest-fixture.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
function settled(){
 const f=fixture();
 for(let i=0;i<240&&f.solver.assessPart(f.body).reason!=='wall contact';i++)f.solver.step(1/120);
 assert.equal(f.solver.assessPart(f.body).reason,'wall contact','finite V-wall contacts must pass the real gravity/raycast/strength certificate');
 return f;
}
function state(f){return copy([f.body,...f.walls].map(p=>({position:p.node.position,quaternion:p.node.quaternion,velocity:p.vel,spin:p.spin,active:p.active,gone:p.gone,phase:p.phase})));}
test('a gravity-balanced light body rests on finite strong walls and transfers its weight once',()=>{
 const f=settled(),rest=state(f),body=f.solver.assessPart(f.body);
 assert.equal(body.anchored,true);assert.equal(body.grounded,false);
 assert.deepEqual(Array.from(body.supportIds).sort(),[1,2]);
 assert.ok(Math.abs(body.load-.0025)<1e-12);
 for(const wall of f.walls){const s=f.solver.assessPart(wall);assert.ok(Math.abs(s.load-1.00125)<1e-12);assert.ok(s.capacity>s.load);assert.deepEqual(Array.from(s.carriedIds),[0]);}
 for(let i=0;i<120;i++)f.solver.step(1/120);
 assert.deepEqual(state(f),rest,'a certified static rest remains in exactly its safe pose');
 assert.equal(f.events.length,0);
});
test('destroying every actual wall anchor wakes the body into free fall',()=>{
 const f=settled(),y=f.body.node.position.y;
 for(const p of f.walls){p.gone=true;p.node.visible=false;}
 for(let i=0;i<24;i++)f.solver.step(1/120);
 assert.equal(f.body.active,true);assert.equal(f.body.gone,false);
 assert.ok(f.body.node.position.y<y-.1,'there is no retained ghost support after both finite walls disappear');
 assert.notEqual(f.solver.assessPart(f.body).reason,'wall contact');
});
test('a new external impulse wakes the wall rest and preserves separating momentum',()=>{
 const f=settled(),y=f.body.node.position.y;f.body.vel.y=2;
 f.solver.step(1/120);
 assert.equal(f.body.active,true);assert.ok(f.body.node.position.y>y);assert.ok(f.body.vel.y>1.9);
 assert.notEqual(f.solver.assessPart(f.body).reason,'wall contact');
});
test('reset removes wall-rest and jam state before restoring the initial scene',()=>{
 const f=settled();f.solver.reset();
 [f.body,...f.walls].forEach((p,i)=>Object.assign(p,copy(f.initial[i])));f.events.length=0;f.stats.hits=0;
 const fresh=fixture({knownJam:false});
 for(let i=0;i<20;i++){f.solver.step(1/120);fresh.solver.step(1/120);}
 assert.deepEqual(state(f),state(fresh));assert.deepEqual(f.events,fresh.events);assert.equal(f.stats.hits,fresh.stats.hits);
});
