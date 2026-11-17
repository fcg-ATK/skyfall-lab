const test=require('node:test');
const assert=require('node:assert/strict');
const {engine}=require('./helpers/engine-harness.cjs');
test('support guide caches selected structural assessment instead of probing every rendered frame',async()=>{
 const g=await engine();let calls=0;g.collapse.assessPart=p=>{calls++;return{id:p.id,anchored:true,load:3,capacity:4,supportIds:[g.parts[0].id],carriedIds:[],criticalReason:null};};
 g.refreshAimValidity({manual:true});assert.equal(calls,2);assert.ok(g.supportInsight);assert.equal(g.supportGuideEnabled,true);
 g.render();assert.equal(g.supportMarkerMesh.visible,true);assert.ok(g.supportMarkerMesh.count>0);
 for(let i=0;i<5;i++)g.render();assert.equal(calls,2);
 g.supportGuideEnabled=false;g.render();assert.equal(g.supportMarkerMesh.visible,false);
 g.supportGuideEnabled=true;g.targetHighlightPaused=true;g.render();assert.equal(g.supportMarkerMesh.visible,false);
});
test('support guide never keeps a stale target after empty pick or displays during firing',async()=>{
 const g=await engine();g.collapse.assessPart=p=>({id:p.id,anchored:true,load:2,capacity:3,supportIds:[],carriedIds:[1]});
 g.refreshAimValidity({manual:true});g.render();assert.ok(g.supportInsight);
 g.pick(2,2);g.render();assert.equal(g.supportInsight,null);assert.equal(g.supportMarkerMesh.visible,false);
 g.reset();g.refreshAimValidity({manual:true});assert.equal(g.fire('rocket'),true);g.render();assert.equal(g.supportMarkerMesh.visible,false);
});

test('support guide assesses the first actual firing contact consistently after a facade pick and refresh',async()=>{
 const g=await engine();g.collapse.assessPart=p=>({id:p.id,anchored:true,load:1,capacity:2,supportIds:[],carriedIds:[]});
 g.aim.angle=0;assert.equal(g.pick(195,280),true);
 const firstContact=g.traceAim().contacts[0].object.userData.part;
 assert.equal(firstContact.id,47,'fixture has a roof pick behind a different first projectile contact');
 assert.equal(g.supportInsight.id,firstContact.id,'displayed structural advice must describe the member hit by the shown trajectory');
 const before=g.supportInsight.id;g.refreshAimValidity();
 assert.equal(g.supportInsight.id,before,'refreshing an unchanged aim must not switch the advised structural member');
});
