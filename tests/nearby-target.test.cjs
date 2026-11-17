const test=require('node:test');
const assert=require('node:assert/strict');
const {engine,T}=require('./helpers/engine-harness.cjs');
function screen(g,p){g.updateCamera();const q=p.clone().project(g.camera),r=g.canvas.getBoundingClientRect();return [(q.x+1)*r.width/2+r.left,(1-q.y)*r.height/2+r.top];}
function facade(g,{distance=66,z=-8}={}){
 for(const p of g.parts){p.gone=true;p.node.visible=false;}
 const node=new T.Mesh(new T.BoxGeometry(4,4,1),new T.MeshBasicMaterial());node.position.set(0,10,z);g.model.add(node);
 const p={id:1000,node,gone:false};node.userData.part=p;g.parts=[p];
 Object.assign(g.orbit,{yaw:0,pitch:0,distance,height:10});Object.assign(g.aim,{x:0,z:3,height:10,angle:0});g.autoAim=true;g.refreshAimValidity({manual:true});return p;
}
test('nearby: recessed remaining facade is selected near the tap despite obsolete impact depth',async()=>{
 const g=await engine();facade(g);const xy=screen(g,new T.Vector3(2.8,10,-7.5));
 assert.equal(g.pick(...xy),true);assert.equal(g.aimFeedback,'assisted');assert.equal(g.aimValid,true);assert.ok(g.aim.z<0);assert.ok(g.traceAim().contacts.length);
});
test('nearby: close zoom can absorb an aiming error within2m without a fixed28px cutoff',async()=>{
 const g=await engine();facade(g,{distance:26,z:0});const xy=screen(g,new T.Vector3(3.3,10,.5));
 const edge=screen(g,new T.Vector3(2,10,.5));assert.ok(Math.abs(xy[0]-edge[0])>28);
 assert.equal(g.pick(...xy),true);const selected=screen(g,new T.Vector3(g.aim.x,g.aim.height,g.aim.z));assert.ok(Math.hypot(selected[0]-xy[0],selected[1]-xy[1])<=48.001);
});
test('nearby: distant clicks and non-target background geometry stay invalid with no ammo use',async()=>{
 const g=await engine(),p=facade(g);const xy=screen(g,new T.Vector3(8,10,-7.5));assert.equal(g.pick(...xy),false);
 p.gone=true;p.node.visible=false;
 const background=new T.Mesh(new T.BoxGeometry(5,5,1),new T.MeshBasicMaterial());background.position.set(0,10,-8);g.scene.add(background);
 assert.equal(g.pick(...screen(g,new T.Vector3(0,10,-7.5))),false);assert.equal(g.fire('rocket'),false);assert.equal(g.shots,0);
});
test('nearby: assistance remains opt-in even for a recessed facade and a direct hit remains precise',async()=>{
 const g=await engine();facade(g);g.autoAim=false;assert.equal(g.pick(...screen(g,new T.Vector3(2.8,10,-7.5))),false);
 assert.equal(g.pick(...screen(g,new T.Vector3(0,10,-7.5))),true);assert.equal(g.aimFeedback,'valid');
});
