'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {engine,T}=require('./helpers/engine-harness.cjs');
function contact(part,overrides={}){
 return {type:'fragment-wall',pieceId:1335,sourcePartId:68,targetPartId:part.id,
  target:part,point:part.rest.clone(),normal:new T.Vector3(0,0,1),velocity:new T.Vector3(0,0,-10),
  mass:400,normalSpeed:10,kineticEnergy:20000,availableEnergy:20000,impulse:4000,time:.5,...overrides};
}
test('only an energetic wall collision fractures one struck member without restarting a blast',async()=>{
 const game=await engine(),target=game.parts[26],before=game.score;
 assert.equal(typeof game.fragmentImpact,'function');
 for(let i=0;i<100;i++)game.fragmentImpact(contact(target,{pieceId:i,mass:1,kineticEnergy:50,impulse:10}));
 assert.equal(target.gone,false,'small decorative chips cannot accumulate into a structural explosion');
 const result=game.fragmentImpact(contact(target));
 assert.equal(result.broken,true);assert.ok(result.spentEnergy>0&&result.spentEnergy<=20000);
 assert.equal(target.gone,true);assert.equal(target.direct,false);
 assert.equal(game.score,before+100);
 assert.equal(game.shotFractures.at(-1).cause,'fragment-impact');
 game.fragmentImpact(contact(target));assert.equal(game.score,before+100,'one member cannot score or fracture twice');
 assert.ok(game.parts.filter(p=>p!==target).every(p=>!p.gone),'contact handler cannot schedule a radial secondary blast');
 assert.ok(!game.events.some(e=>e.name==='impact'),'fragment collision cannot reuse weapon detonation');
});
test('floor landing, stale targets, and terminal contacts do not create structural damage',async()=>{
 const game=await engine(),target=game.parts[26];
 game.fragmentImpact(contact(target,{type:'floor-contact'}));assert.equal(target.gone,false);
 game.fragmentImpact(contact(target,{normalSpeed:1,kineticEnergy:50}));assert.equal(target.gone,false);
 game.state='finished';game.fragmentImpact(contact(target));assert.equal(target.gone,false);
 game.reset();assert.equal(game.score,0);assert.ok(game.parts.every(p=>!p.gone));
});
test('a falling slab meeting its child rubble cannot count as a second vertical structural impact',async()=>{
 const game=await engine(),target=game.parts[26];
 game.fragmentImpact(contact(target,{normal:new T.Vector3(0,-1,0),normalSpeed:20,kineticEnergy:20000}));
 assert.equal(target.gone,false,'coherent vertical compression is owned by the building solver, not child rubble');
 game.fragmentImpact(contact(target,{time:0,kineticEnergy:20000}));
 assert.equal(target.gone,true,'an actual heavy side contact at a touching seam still spends its incoming normal energy');
});
test('a moving structural wall cannot borrow its own speed to turn stationary rubble into a projectile',async()=>{
 const game=await engine(),target=game.parts[26];
 game.fragmentImpact(contact(target,{velocity:new T.Vector3(),normalSpeed:20,kineticEnergy:20000}));
 assert.equal(target.gone,false,'only the incoming fragment flight may supply this secondary projectile work');
 game.fragmentImpact(contact(target,{velocity:new T.Vector3(0,0,-20),normalSpeed:20,kineticEnergy:20000}));
 assert.equal(target.gone,true);
});
test('wall damage cannot spend kinetic work gained for free from another moving surface',async()=>{
 const game=await engine(),target=game.parts[26];
 game.fragmentImpact(contact(target,{availableEnergy:450}));assert.equal(target.gone,false);
 game.fragmentImpact(contact(target,{availableEnergy:20000}));assert.equal(target.gone,true);
});
