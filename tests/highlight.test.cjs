'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {engine,T,context}=require('./helpers/engine-harness.cjs');

function fixture(){
 const scene=new T.Scene(),model=new T.Group();scene.add(model);
 const shared=new T.MeshStandardMaterial({color:0x7c878d,roughness:.73});shared.map=new T.Texture();
 const glass=new T.MeshStandardMaterial({color:0x8cabbb,transparent:true,opacity:.68});
 const mesh=new T.Mesh(new T.BoxGeometry(),[shared,glass]),second=new T.Mesh(new T.BoxGeometry(),shared);
 const hidden=new T.Group(),hiddenMesh=new T.Mesh(new T.BoxGeometry(),shared);hidden.add(hiddenMesh);hidden.visible=false;
 const gone=new T.Mesh(new T.BoxGeometry(),shared),background=new T.Mesh(new T.BoxGeometry(),shared);
 model.add(mesh,second,hidden,gone);scene.add(background);
 const parts=[{id:1,node:mesh,gone:false},{id:2,node:second,gone:false},{id:3,node:hidden,gone:false},{id:4,node:gone,gone:true}];
 assert.ok(context.SkyfallTargetHighlight,'residual-target highlight manager must be available');
 const manager=context.SkyfallTargetHighlight.create(parts);
 return {manager,scene,model,mesh,second,hidden,hiddenMesh,gone,background,shared,glass,parts};
}

test('highlight: only visible surviving structure gets a subtle material copy, with no shared-material leak',()=>{
 const f=fixture(),original=f.mesh.material,sharedColor=f.shared.color.clone(),sharedEmission=f.shared.emissive.clone();
 const nodes=f.scene.children.length,geometry=f.mesh.geometry;
 f.manager.update(true);
 assert.notEqual(f.mesh.material,original);assert.notEqual(f.mesh.material[0],f.shared);
 assert.equal(f.second.material,f.mesh.material[0],'shared source materials reuse a bounded highlight copy');
 assert.notEqual(f.mesh.material[0].color.getHex(),sharedColor.getHex());
 assert.equal(f.mesh.material[0].map,f.shared.map);assert.equal(f.mesh.material[0].roughness,.73);
 assert.equal(f.mesh.material[1].transparent,true);assert.equal(f.mesh.material[1].opacity,.68);
 assert.equal(f.background.material,f.shared);assert.equal(f.hiddenMesh.material,f.shared);assert.equal(f.gone.material,f.shared);
 assert.ok(f.shared.color.equals(sharedColor));assert.ok(f.shared.emissive.equals(sharedEmission));
 assert.equal(f.scene.children.length,nodes);assert.equal(f.mesh.geometry,geometry,'highlight must not add outline geometry or another scene pass');
 f.manager.update(false);assert.equal(f.mesh.material,original);assert.equal(f.second.material,f.shared);
});

test('highlight: stable frames allocate no new materials and removed or reset parts restore their originals',()=>{
 const f=fixture();let disposed=0;f.shared.addEventListener('dispose',()=>disposed++);f.glass.addEventListener('dispose',()=>disposed++);
 const original=f.mesh.material;f.manager.update(true);const tinted=f.mesh.material;
 let current=f.second.material,writes=0;
 Object.defineProperty(f.second,'material',{configurable:true,get:()=>current,set:value=>{writes++;current=value;}});
 for(let i=0;i<90;i++)f.manager.update(true);
 assert.equal(writes,0,'an unchanged highlight mode must not reassign every mesh each frame');
 f.parts[0].gone=true;f.manager.refreshPart(f.parts[0]);assert.equal(f.mesh.material,original);
 f.manager.update(false);f.parts[0].gone=false;f.manager.update(true);
 assert.equal(f.mesh.material,tinted,'rounds reuse highlight material copies');
 f.hidden.visible=true;f.manager.refreshPart(f.parts[2]);assert.notEqual(f.hiddenMesh.material,f.shared);
 f.manager.update(false);assert.equal(f.hiddenMesh.material,f.shared);assert.equal(disposed,0);
});

test('highlight: real GLB residuals stand out only while reaiming and shard materials stay unchanged',async()=>{
 const g=await engine(),entries=[];
 for(const p of g.parts)p.node.traverse(n=>{if(n.isMesh)entries.push({p,mesh:n,original:n.material});});
 const shardMeshes=g.scene.children.filter(n=>n.name.startsWith('ActualPCFragments_'));
 const shards=shardMeshes.map(mesh=>({mesh,material:mesh.material,color:mesh.material.color.clone(),emissive:mesh.material.emissive.clone()}));
 assert.ok(entries.length>48);assert.ok(new Set(entries.flatMap(e=>Array.isArray(e.original)?e.original:[e.original])).size<entries.length,'fixture contains real shared materials');
 g.aimValid=false;g.aimBlockedByTap=true;g.syncTargetHighlight();
 assert.ok(entries.every(e=>e.mesh.material!==e.original),'all surviving actual meshes highlight even with assist off');
 assert.equal(g.autoAim,false);
 for(const s of shards){assert.equal(s.mesh.material,s.material);assert.ok(s.material.color.equals(s.color));assert.ok(s.material.emissive.equals(s.emissive));}
 const removed=g.parts[0];g.fracturePart(removed);
 assert.ok(entries.filter(e=>e.p===removed).every(e=>e.mesh.material===e.original));
 g.targetHighlightPaused=true;g.syncTargetHighlight();assert.ok(entries.every(e=>e.mesh.material===e.original));
 g.targetHighlightPaused=false;g.aimTween={};g.syncTargetHighlight();assert.ok(entries.every(e=>e.mesh.material===e.original));
 g.aimTween=null;g.state='watch';g.syncTargetHighlight();assert.ok(entries.every(e=>e.mesh.material===e.original));
 g.state='ready';g.syncTargetHighlight();assert.ok(entries.filter(e=>!e.p.gone).every(e=>e.mesh.material!==e.original));
 g.reset();assert.ok(entries.every(e=>e.mesh.material===e.original));
 g.aimValid=false;g.syncTargetHighlight();
 assert.equal(g.fire('rocket'),true);assert.ok(entries.every(e=>e.mesh.material===e.original),'launch restores all original architecture materials immediately');
 for(const s of shards){assert.ok(s.material.color.equals(s.color));assert.ok(s.material.emissive.equals(s.emissive));}
});
