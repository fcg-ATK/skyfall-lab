const test=require('node:test');
const assert=require('node:assert/strict');
const {engine,T,advance}=require('./helpers/engine-harness.cjs');
function screen(g,p){g.updateCamera();const q=p.clone().project(g.camera),r=g.canvas.getBoundingClientRect();return [(q.x+1)*r.width/2+r.left,(1-q.y)*r.height/2+r.top];}
function simpleTarget(g){
 for(const p of g.parts){p.gone=true;p.node.visible=false;}
 const node=new T.Mesh(new T.BoxGeometry(4,4,4),new T.MeshBasicMaterial());node.position.set(0,10,0);g.model.add(node);
 const p={id:1000,node,gone:false};node.userData.part=p;g.parts=[p];
 Object.assign(g.orbit,{yaw:0,pitch:0,distance:66,height:10});Object.assign(g.aim,{x:0,z:2,height:10,angle:0});g.refreshAimValidity({manual:true});return p;
}
test('aim: a missed tap immediately invalidates the old target and protects ammunition',async()=>{
 const g=await engine();assert.equal(g.aimValid,true);g.render();const old={...g.aim};
 assert.equal(g.pick(2,2),false);assert.equal(g.aimValid,false);assert.equal(g.aimFeedback,'empty');assert.notDeepEqual({...g.aim},old);
 assert.equal(g.events.at(-1).name,'aimEmpty');g.render();assert.equal(g.guideRing.material.color.getHex(),0xff6860);
 // Even a stale valid coordinate cannot revive a rejected tap implicitly.
 Object.assign(g.aim,old);g.refreshAimValidity();assert.equal(g.aimValid,false);assert.equal(g.fire('rocket'),false);assert.equal(g.remainingAmmo,4);
 advance(g,.4);g.render();assert.equal(g.guideRing.material.color.getHex(),0x89959b);
 g.refreshAimValidity({manual:true});assert.equal(g.aimValid,true);assert.equal(g.fire('rocket'),true);
});
test('aim: picking a real facade restores feedback and valid firing without requiring render',async()=>{
 const g=await engine();simpleTarget(g);g.pick(2,2);const xy=screen(g,new T.Vector3(0,10,2));
 assert.equal(g.pick(...xy),true);assert.equal(g.aimValid,true);assert.equal(g.aimFeedback,'valid');assert.equal(g.events.at(-1).name,'aimSelected');assert.equal(g.events.at(-1).data.assisted,false);
 g.render();assert.equal(g.guideRing.material.color.getHex(),0xffd58f);assert.ok(g.traceAim().contacts.length);
});
test('aim: default-off assist does not snap; enabled assist accepts only a nearby actual triangle',async()=>{
 const g=await engine();simpleTarget(g);const xy=screen(g,new T.Vector3(2.8,10,2));
 assert.equal(g.autoAim,false);assert.equal(g.pick(...xy),false);
 Object.assign(g.aim,{x:0,z:2,height:10,angle:0});g.autoAim=true;
 assert.equal(g.pick(...xy),true);assert.equal(g.aimFeedback,'assisted');assert.equal(g.aimValid,true);assert.equal(g.events.at(-1).data.assisted,true);
 assert.ok(g.traceAim().contacts.length);const projected=screen(g,new T.Vector3(g.aim.x,g.aim.height,g.aim.z));assert.ok(Math.hypot(projected[0]-xy[0],projected[1]-xy[1])<=28.001);
});
test('aim: bounded assist never jumps from distant empty space or to hidden rubble',async()=>{
 const g=await engine(),p=simpleTarget(g);g.autoAim=true;
 assert.equal(g.pick(...screen(g,new T.Vector3(10,10,2))),false);assert.equal(g.aimValid,false);
 Object.assign(g.aim,{x:0,z:2,height:10,angle:0});p.gone=true;
 assert.equal(g.pick(...screen(g,new T.Vector3(0,10,2))),false);assert.equal(g.remainingAmmo,4);
});
test('aim: cached target validity follows actual remaining geometry after a shot',async()=>{
 const g=await engine();assert.equal(g.fire('rocket'),true);let t=0;while(g.state!=='ready'&&g.state!=='finished'&&t<12){g.step(1/30);t+=1/30;}
 assert.equal(g.aimValid,Boolean(g.traceAim().contacts.length));assert.equal(g.autoAim,false);
});

test('aim: enabling assist after an empty tap cannot replace the rejected selection with a distant target',async()=>{
 const g=await engine();simpleTarget(g);
 assert.equal(g.pick(2,2),false);const rejected={...g.aim};
 g.autoAim=true;
 assert.equal(g.recoverAim(),false,'global recovery must not override an explicit rejected tap');
 assert.equal(g.aimTween,null);assert.equal(g.aimBlockedByTap,true);assert.equal(g.aimValid,false);
 assert.deepEqual({...g.aim},rejected);assert.equal(g.fire('rocket'),false);assert.equal(g.remainingAmmo,4);
 assert.equal(g.pick(...screen(g,new T.Vector3(2.8,10,2))),true,'a new nearby assisted selection may clear the rejection');
 assert.equal(g.aimBlockedByTap,false);assert.equal(g.aimValid,true);assert.equal(g.aimFeedback,'assisted');
});
