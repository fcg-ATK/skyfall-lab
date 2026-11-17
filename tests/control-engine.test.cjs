const test=require('node:test');
const assert=require('node:assert/strict');
const {engine,T,advance}=require('./helpers/engine-harness.cjs');
function finish(g){let t=0;while(['flight','watch'].includes(g.state)&&t<12){g.step(1/30);t+=1/30;}return t;}

test('control: damage follows visible displacement rather than active flags or spin in yaw',async()=>{
 const g=await engine(),p=g.parts[0];p.active=true;g.updateDamage();assert.equal(p.crumbleProgress,0);
 p.node.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),.3);g.updateDamage();assert.equal(p.crumbleProgress,0);
 p.node.quaternion.setFromAxisAngle(new T.Vector3(1,0,0),.1);g.updateDamage();assert.equal(p.crumbleProgress,.3);
 p.node.position.y-=1;g.updateDamage();assert.equal(p.crumbleProgress,.8);
 p.active=false;p.phase='resting';g.updateDamage();assert.equal(p.crumbleProgress,.8);
 p.node.quaternion.copy(p.restQ);g.updateDamage();assert.equal(p.crumbleProgress,.8);
 g.fracturePart(p);g.updateDamage();assert.equal(p.crumbleProgress,1);g.reset();g.updateDamage();assert.equal(g.damage,0);
});
test('control: half the building visibly displaced reports forty percent and surviving blocks prevent false100',async()=>{
 const g=await engine();for(const p of g.parts.slice(0,g.parts.length/2)){p.node.position.y-=2;p.phase='resting';}g.updateDamage();assert.equal(g.damage,40);
 for(const p of g.parts.slice(0,-1))g.fracturePart(p);g.parts.at(-1).node.position.y-=2;g.updateDamage();assert.equal(g.damage,99);
 g.fracturePart(g.parts.at(-1));g.updateDamage();assert.equal(g.damage,100);
});
test('control: empty aim blocks all weapons before consuming ammunition',async()=>{
 const g=await engine();g.aim.height=30;const aim={...g.aim};
 for(const weapon of ['ball','rocket','meteor']){assert.equal(g.fire(weapon),false);assert.equal(g.remainingAmmo,4);assert.equal(g.state,'ready');assert.equal(g.projectile.visible,false);assert.equal(g.score,0);assert.deepEqual({...g.aim},aim);}
 assert.equal(g.events.filter(e=>e.name==='emptyAim').length,3);assert.equal(g.events.filter(e=>e.name==='launch').length,0);
});
test('control: a destroyed aiming corridor blocks a shot despite nearby surviving architecture',async()=>{
 const g=await engine();g.orbit.yaw=0;g.aim.height=10;
 const hit=g.traceAim();assert.ok(hit.contacts.length);for(const id of new Set(hit.contacts.map(h=>h.object.userData.part.id)))g.fracturePart(g.parts[id]);
 assert.ok(g.parts.some(p=>!p.gone));assert.equal(g.fire('rocket'),false);assert.equal(g.shots,0);
});
test('control: default manual aiming never picks the next target after a real shot',async()=>{
 const g=await engine();assert.equal(g.autoAim,false);const aim={...g.aim};assert.equal(g.fire('rocket'),true);finish(g);
 assert.equal(g.state,'ready');assert.deepEqual({...g.aim},aim);assert.equal(g.aimTween,null);
});
test('control: assist preserves valid aim and eases only an invalid aim over0.2seconds',async()=>{
 const g=await engine();g.autoAim=true;const original={...g.aim};assert.equal(g.recoverAim(),false);assert.deepEqual({...g.aim},original);
 g.aim.height=30;const from={...g.aim};assert.equal(g.recoverAim(),true);assert.deepEqual({...g.aim},from);assert.ok(g.aimTween);
 const to={...g.aimTween.to};assert.equal(g.fire('rocket'),false);g.step(.05);assert.notEqual(g.aim.height,from.height);assert.notEqual(g.aim.height,to.height);
 advance(g,.2);assert.equal(g.aimTween,null);assert.deepEqual({...g.aim},to);assert.ok(g.traceAim().contacts.length);
});
test('control: stable structure rearms after0.65seconds despite trailing rubble, not while parents fall',async()=>{
 const g=await engine();g.state='watch';g.structuralFragments.stats=()=>({active:500,moving:500,relevantMoving:500});
 advance(g,.6);assert.equal(g.state,'watch');advance(g,.1);assert.equal(g.state,'ready');
 g.reset();g.state='watch';const p=g.parts.at(-1);p.active=true;p.phase='falling';p.node.position.y+=6;advance(g,.9);assert.equal(g.state,'watch');
});
