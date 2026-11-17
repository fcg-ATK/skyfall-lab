const test=require('node:test');
const assert=require('node:assert/strict');
const {engine,T}=require('./helpers/engine-harness.cjs');
function runShot(game,limit=15){let elapsed=0;while(['flight','watch'].includes(game.state)&&elapsed<limit){game.step(1/30);elapsed+=1/30;}return elapsed;}
function aimHits(g){
 const target=new T.Vector3(g.aim.x,g.aim.height,g.aim.z),dir=g.direction();g.scene.updateMatrixWorld(true);
 const meshes=[];for(const p of g.parts)if(!p.gone)p.node.traverseVisible(n=>{if(n.isMesh)meshes.push(n);});
 return new T.Raycaster(target.clone().addScaledVector(dir,-42),dir,0,84).intersectObjects(meshes,false);
}

test('loop: fragment landing cannot multiply structural damage or change terminal score',async()=>{
 const g=await engine(),source=g.parts.find(p=>p.floor===2&&p.cell===0),bearing=g.parts.find(p=>p.floor===1&&p.cell===0);
 for(const state of ['watch','finished']){
  g.state=state;
  for(let i=0;i<10;i++)g.landing({partId:source.id,supportId:bearing.id,firstContact:true,mass:20,energy:8,kineticEnergy:120000,point:bearing.rest.clone(),floor:bearing.floor});
  assert.equal(bearing.gone,false);assert.equal(g.score,0);
 }
 g.fracturePart(bearing);assert.equal(bearing.gone,false);assert.equal(g.score,0);
});

test('loop: steep aim finds a surviving triangle and rebuilding restores a usable aim',async()=>{
 const g=await engine();for(const p of g.parts.slice(1))g.fracturePart(p);
 g.aim.height=21.5;g.aim.angle=45;assert.equal(g.retargetAim(),true);assert.ok(aimHits(g).length);
 g.parts[0].node.position.x+=20;assert.equal(g.retargetAim(),true);assert.ok(aimHits(g).length);
 g.reset();assert.ok(aimHits(g).length);assert.equal(g.aim.angle,0);assert.equal(g.aim.x,0);assert.equal(g.aim.z,0);
});

test('loop: hollow surviving base sections retarget to a real face without changing yaw',async()=>{
 const g=await engine();
 for(const {id,yaw} of [{id:g.parts.find(p=>p.floor===0&&p.center.x>0&&p.center.z>0).id,yaw:.68},{id:g.parts.find(p=>p.floor===0&&p.center.x<0&&p.center.z>0).id,yaw:Math.PI/2}])for(const angle of [-25,0,45]){
  for(const p of g.parts){p.gone=p.id!==id;p.node.visible=!p.gone;}
  g.orbit.yaw=yaw;Object.assign(g.aim,{height:21.5,x:0,z:0,angle});
  assert.equal(g.retargetAim(),true,'survivor '+id+' angle '+angle);
  const target=new T.Vector3(g.aim.x,g.aim.height,g.aim.z),hits=aimHits(g);
  assert.ok(hits.length);assert.ok(hits[0].point.distanceTo(target)<.001);
  assert.equal(g.orbit.yaw,yaw);assert.ok(g.aim.height>=g.aimLimits().min&&g.aim.height<=g.aimLimits().max);
 }
});

test('loop: the retargeted marker stays at the nearest hit after the final height clamps slope',async()=>{
 const g=await engine(),survivor=g.parts.find(p=>p.floor===2&&p.center.x>0&&p.center.z>0);for(const p of g.parts){p.gone=p!==survivor;p.node.visible=!p.gone;}
 g.orbit.yaw=0;Object.assign(g.aim,{height:21.5,x:0,z:0,angle:-25});
 assert.equal(g.retargetAim(),true);
 const target=new T.Vector3(g.aim.x,g.aim.height,g.aim.z),angle=g.aim.angle,hits=aimHits(g);
 assert.equal(g.aim.angle,angle);assert.ok(hits.length);assert.ok(hits[0].point.distanceTo(target)<.001);
});

test('loop: cosmetic rubble from a neighbouring column cannot destroy a healthy bearing',async()=>{
 const g=await engine(),source=g.parts.find(p=>p.floor===2&&p.cell===0),bearing=g.parts.find(p=>p.floor===1&&p.cell===1);
 for(let i=0;i<10;i++)g.landing({partId:source.id,supportId:bearing.id,firstContact:true,mass:20,energy:8,kineticEnergy:120000,point:bearing.rest.clone(),floor:bearing.floor});
 assert.equal(bearing.gone,false);assert.equal(bearing.impactLoad,0);
});

test('loop: a partial shot returns directly to ready with damage preserved',async()=>{
 // Real wall contacts can trigger a later local crush while the first roof
 // patch is descending. Observe that complete physical chain, not the former
 // six-second no-wall shot, and keep a finite guard against a stuck round.
 const g=await engine();g.aim.height=21.5;g.fire('ball');const seconds=runShot(g,30);
 assert.equal(g.state,'ready');assert.ok(g.damage>0&&g.damage<100);assert.equal(g.shots,1);assert.equal(g.remainingAmmo,3);
 const event=g.events.find(e=>e.name==='shotFinished');assert.ok(event);assert.equal(event.data.shotDamage,g.damage);
 assert.ok(!g.events.some(e=>e.name==='finished'));assert.ok(seconds<30,'the actual wall-contact chain must naturally settle');
 assert.ok(g.parts.every(p=>p.gone||!p.active),'ready must wait for the surviving architecture');
 assert.equal(g.events.filter(e=>e.name==='shotFinished').length,1);
 const score=g.score;g.aim.height=10;assert.equal(g.fire('rocket'),true);assert.equal(g.shots,2);assert.equal(g.score,score);
});

test('loop: the initial rocket cuts a visible local gap and leaves room for follow-up shots',async()=>{
 const g=await engine();assert.equal(g.fire('rocket'),true);const seconds=runShot(g);
 assert.ok(g.damage>0&&g.damage<30,'a local rocket and its coupled strip must leave most architecture for further experiments');
 assert.equal(g.state,'ready');assert.ok(seconds<10,'the coupled local area must settle before another shot');
 assert.ok(g.parts.every(p=>p.gone||!p.active),'ready must expose fully settled architecture');
 const firstHit=g.parts.find(part=>part.id===g.metrics().shotHits[0]);
 assert.ok(firstHit?.gone,'the actual struck section must be removed');
 assert.equal(firstHit.node.visible,false);assert.ok(g.structuralFragments.stats().active>0,'the local hit must release visible rubble');
 g.render();
 const shader={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader};
 g.structureDetail.batches[0].material.onBeforeCompile(shader);
 assert.equal(shader.uniforms.uStructurePoses.value.image.data[firstHit.id*8+3],0,'the visible building batch must expose the same gap');
 g.aim.height=21.5;assert.equal(g.retargetAim(),true);assert.equal(g.fire('ball'),true);assert.equal(g.shots,2);
});

test('loop: four accepted roof shots exhaust ammo; earlier shots never open terminal results',async()=>{
 const g=await engine();
 for(let shot=1;shot<=4;shot++){g.aim.height=21.5;assert.equal(g.retargetAim(),true);assert.equal(g.fire('ball'),true);runShot(g);assert.equal(g.shots,shot);assert.equal(g.state,shot<4?'ready':'finished');}
 assert.equal(g.remainingAmmo,0);assert.equal(g.fire('rocket'),false);assert.equal(g.ammoBonus,0);
 assert.equal(g.events.filter(e=>e.name==='finished').length,1);assert.equal(g.events.filter(e=>e.name==='shotFinished').length,3);
});

test('loop: full clear awards remaining ammo times 300 once',async()=>{
 const g=await engine();g.shots=2;for(const p of g.parts)g.fracturePart(p);g.state='watch';runShot(g);
 assert.equal(g.state,'finished');assert.equal(g.score,g.parts.length*100+600);assert.equal(g.ammoBonus,600);assert.equal(g.remainingAmmo,2);
 for(let i=0;i<90;i++)g.step(1/30);assert.equal(g.score,g.parts.length*100+600);
 assert.equal(g.events.find(e=>e.name==='finished').data.ammoBonus,600);
});

test('loop: roof removal shrinks height limit and retargets an actual surviving triangle',async()=>{
 const g=await engine();const oldMax=g.aimLimits().max;
 for(const p of g.parts.filter(p=>p.floor===5))g.fracturePart(p);
 g.aim.height=21.5;assert.equal(g.retargetAim(),true);const limits=g.aimLimits();
 assert.ok(limits.max<oldMax-3);assert.ok(g.aim.height<=limits.max);
 const target=new T.Vector3(g.aim.x,g.aim.height,g.aim.z),dir=g.direction(),origin=target.clone().addScaledVector(dir,-42);
 g.scene.updateMatrixWorld(true);const live=[];for(const p of g.parts)if(!p.gone)p.node.traverseVisible(n=>{if(n.isMesh)live.push(n);});
 const hits=new T.Raycaster(origin,dir,0,84).intersectObjects(live,false);
 assert.ok(hits.length);assert.ok(hits[0].point.distanceTo(target)<.1,'aim marker must sit on surviving geometry');
});

test('loop: debug metrics identify current supports and unique fracture causes',async()=>{
 const g=await engine();g.aim.height=12;g.fire('rocket');runShot(g);
 const m=g.metrics();assert.ok(m.support.length);assert.ok(m.shotHits.length>=1);assert.ok(m.shotFractures.length>=1);
 assert.ok(m.support.every(row=>Number.isFinite(row.ratio)&&typeof row.reason==='string'));
 assert.equal(new Set(m.shotFractures.map(f=>f.id)).size,m.shotFractures.length);
 assert.ok(m.shotFractures.every(f=>typeof f.cause==='string'));
 assert.ok(Number.isFinite(m.stillTime)&&Number.isFinite(m.damageQuietTime)&&Number.isFinite(m.relevantMoving));
});


test('free preview accepts more than four shots and reset keeps unlimited ammunition', async () => {
  const game = await engine();
  game.freeMode = true;
  game.reset();
  for (let shot = 1; shot <= 5; shot++) {
    game.aim.height = 21.5;
    assert.equal(game.retargetAim(), true);
    assert.equal(game.fire('ball'), true);
    runShot(game);
    assert.equal(game.shots, shot);
    assert.equal(game.state, 'ready');
    assert.equal(game.remainingAmmo, Infinity);
  }
  assert.equal(game.events.filter(event => event.name === 'finished').length, 0);
  game.reset();
  assert.equal(game.shots, 0);
  assert.equal(game.maxShots, Infinity);
  assert.equal(game.remainingAmmo, Infinity);
  assert.equal(game.state, 'ready');
});

test('free preview full demolition has a finite score and can rebuild the complete structure', async () => {
  const game = await engine();
  game.freeMode = true;
  game.reset();
  game.shots = 5;
  for (const part of game.parts) game.fracturePart(part);
  game.state = 'watch';
  runShot(game);
  assert.equal(game.state, 'finished');
  assert.equal(game.damage, 100);
  assert.equal(game.score, game.parts.length * 100);
  assert.equal(game.ammoBonus, 0);
  const event = game.events.find(event => event.name === 'finished');
  assert.ok(Number.isFinite(event.data.score));
  assert.ok(Number.isFinite(event.data.ammoBonus));
  game.reset();
  assert.equal(game.score, 0);
  assert.equal(game.damage, 0);
  assert.equal(game.structuralFragments.stats().active, 0);
  assert.ok(game.parts.every(part => !part.gone && part.node.visible));
  assert.equal(game.remainingAmmo, Infinity);
});
