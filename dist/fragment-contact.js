/* Continuous finite-footprint contacts against the actual structural meshes.
   Geometry BVHs are immutable load-time resources; sync refits only poses and
   mesh bounds. Window/door voids are never filled with a cell bounding box. */
(function () {
  'use strict';
  const T = window.THREE, EPS = 1e-8;
  const abs=Math.abs,min=Math.min,max=Math.max;
  const visible = record => {
    if (record.part.gone) return false;
    for (let node=record.mesh;node;node=node.parent) if (!node.visible) return false;
    return true;
  };
  function bounds(items, first, last) {
    const box=new T.Box3();
    for (let i=first;i<last;i++) box.union(items[i].box);
    return box;
  }
  function build(items, first=0, last=items.length, leafSize=8) {
    if (first===last) return null;
    const box=bounds(items,first,last), node={box,first,last,left:null,right:null};
    if (last-first<=leafSize) return node;
    const size=new T.Vector3(); box.getSize(size);
    const axis=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z';
    const sorted=items.slice(first,last).sort((a,b)=>(a.box.min[axis]+a.box.max[axis])-(b.box.min[axis]+b.box.max[axis]));
    for(let i=0;i<sorted.length;i++) items[first+i]=sorted[i];
    const mid=(first+last)>>1;
    node.left=build(items,first,mid,leafSize); node.right=build(items,mid,last,leafSize);
    return node;
  }
  function refit(node, items) {
    if (!node) return;
    if (node.left) {
      refit(node.left,items); refit(node.right,items);
      node.box.copy(node.left.box).union(node.right.box);
    } else {
      node.box.makeEmpty();
      for(let i=node.first;i<node.last;i++) node.box.union(items[i].box);
    }
  }
  // Expanded slab test returns the earliest possible intersection, allowing
  // near-first traversal and pruning behind an already accepted real contact.
  function boxTime(box, start, delta, extent, latest) {
    let lo=0, hi=latest;
    // Explicit components keep the overwhelmingly common slab rejection out
    // of dynamic property lookups and iterator allocation. Axis order and
    // arithmetic match the original test, including its boundary tolerance.
    let a=box.min.x-extent.x-EPS,b=box.max.x+extent.x+EPS,d=delta.x,s=start.x;
    if(abs(d)<EPS) {if(s<a||s>b)return Infinity;}
    else {
      let t0=(a-s)/d,t1=(b-s)/d;
      if(t0>t1) {const temp=t0;t0=t1;t1=temp;}
      lo=max(lo,t0);hi=min(hi,t1);if(lo>hi+EPS)return Infinity;
    }
    a=box.min.y-extent.y-EPS;b=box.max.y+extent.y+EPS;d=delta.y;s=start.y;
    if(abs(d)<EPS) {if(s<a||s>b)return Infinity;}
    else {
      let t0=(a-s)/d,t1=(b-s)/d;
      if(t0>t1) {const temp=t0;t0=t1;t1=temp;}
      lo=max(lo,t0);hi=min(hi,t1);if(lo>hi+EPS)return Infinity;
    }
    a=box.min.z-extent.z-EPS;b=box.max.z+extent.z+EPS;d=delta.z;s=start.z;
    if(abs(d)<EPS) {if(s<a||s>b)return Infinity;}
    else {
      let t0=(a-s)/d,t1=(b-s)/d;
      if(t0>t1) {const temp=t0;t0=t1;t1=temp;}
      lo=max(lo,t0);hi=min(hi,t1);if(lo>hi+EPS)return Infinity;
    }
    return lo;
  }
  function geometryTree(geometry) {
    const pos=geometry.getAttribute('position'), index=geometry.index;
    if (!pos) return null;
    const count=index?index.count:pos.count, triangles=[];
    const from=Math.max(0,geometry.drawRange?.start||0), end=Math.min(count,from+(geometry.drawRange?.count??Infinity));
    for(let i=from;i+2<end;i+=3) {
      const a=new T.Vector3().fromBufferAttribute(pos,index?index.getX(i):i);
      const b=new T.Vector3().fromBufferAttribute(pos,index?index.getX(i+1):i+1);
      const c=new T.Vector3().fromBufferAttribute(pos,index?index.getX(i+2):i+2);
      const box=new T.Box3().expandByPoint(a).expandByPoint(b).expandByPoint(c);
      triangles.push({a,b,c,box});
    }
    return {triangles,root:build(triangles)};
  }
  function create(parts) {
    const records=[], geometries=new Map(),candidateSets=new WeakMap();
    let triangles=0, triangleTests=0, meshTests=0, sweeps=0, syncs=0, root=null;
    const localStart=new T.Vector3(),localEnd=new T.Vector3(),localDelta=new T.Vector3(),localExtent=new T.Vector3();
    const delta=new T.Vector3(),extent=new T.Vector3();
    const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),ab=new T.Vector3(),bc=new T.Vector3(),ca=new T.Vector3();
    const triNormal=new T.Vector3(),overlapNormal=new T.Vector3(),hitNormal=new T.Vector3(),center=new T.Vector3(),point=new T.Vector3();
    const edges=[ab,bc,ca];
    const axes=new Float64Array(39);axes[0]=axes[4]=axes[8]=1;
    const scratch=new T.Vector3(),origin=new T.Vector3(),triangle=new T.Triangle();
    for(const part of parts) {
      part.node.traverse(mesh=>{
        if(!mesh.isMesh||!mesh.geometry) return;
        let tree=geometries.get(mesh.geometry);
        if(!tree) { tree=geometryTree(mesh.geometry); geometries.set(mesh.geometry,tree); if(tree) triangles+=tree.triangles.length; }
        if(!tree?.root) return;
        records.push({part,mesh,tree,box:new T.Box3(),matrix:new T.Matrix4(),inverse:new T.Matrix4(),version:0,worldTriangles:[]});
      });
    }
    function sync() {
      syncs++;
      for(const record of records) {
        record.mesh.updateWorldMatrix(true,false);
        if(!record.version||!record.matrix.equals(record.mesh.matrixWorld)) {
          record.version++;record.matrix.copy(record.mesh.matrixWorld); record.inverse.copy(record.matrix).invert();
          record.box.copy(record.tree.root.box).applyMatrix4(record.matrix);
        }
      }
      if(!root) root=build(records,0,records.length,2);
      else refit(root,records);
    }
    // Optional coherent-query broadphase. Bounds enclose all segment endpoints
    // (and any finite extents); callers reuse this stable left-to-right list
    // only until the next pose sync. Exact mesh/triangle tests still run for
    // each sample, with the original ordering and first-contact tie policy.
    function candidates(bounds,options={}) {
      const result=[];
      if(!root)return result;
      const low=bounds.min,high=bounds.max;
      // Outward padding is intentionally conservative, including rounding of
      // a caller's union/extent arithmetic as well as both slab EPS and the
      // exact sweep's latest+EPS time tolerance beyond a segment endpoint.
      const span=max(high.x-low.x,high.y-low.y,high.z-low.z);
      const pad=EPS*(2+span)+Number.EPSILON*8*max(1,abs(low.x),abs(low.y),abs(low.z),abs(high.x),abs(high.y),abs(high.z));
      function query(node) {
        const box=node.box;
        if(high.x<box.min.x-pad||low.x>box.max.x+pad||high.y<box.min.y-pad||low.y>box.max.y+pad||high.z<box.min.z-pad||low.z>box.max.z+pad)return;
        if(node.left) {query(node.left);query(node.right);return;}
        for(let i=node.first;i<node.last;i++) {
          const record=records[i],id=record.part.id,box=record.box;
          if(!visible(record)||options.excludePartId!=null&&String(id)===String(options.excludePartId)||options.excludeIds?.has(id)||options.excludeIds?.has(String(id)))continue;
          if(high.x<box.min.x-pad||low.x>box.max.x+pad||high.y<box.min.y-pad||low.y>box.max.y+pad||high.z<box.min.z-pad||low.z>box.max.z+pad)continue;
          result.push(record);
        }
      }
      query(root);return result;
    }
    // Continuous separating-axis theorem for a translating finite box and a
    // triangle. All 13 axes are required: face-only raycasts miss window jambs
    // and corner impacts; cell boxes would close the window entirely.
    function worldTriangle(record,index) {
      const local=record.tree.triangles[index];let cached=record.worldTriangles[index];
      if(!cached) cached=record.worldTriangles[index]={version:0,a:new T.Vector3(),b:new T.Vector3(),c:new T.Vector3(),normal:new T.Vector3(),unitNormal:new T.Vector3(),normalLengthSq:0,
        abx:0,aby:0,abz:0,acx:0,acy:0,acz:0,axes:new Float64Array(130)};
      if(cached.version!==record.version) {
        a.copy(local.a).applyMatrix4(record.matrix);b.copy(local.b).applyMatrix4(record.matrix);c.copy(local.c).applyMatrix4(record.matrix);
        ab.subVectors(b,a);bc.subVectors(c,b);ca.subVectors(a,c);triNormal.crossVectors(ab,ca).negate();
        cached.a.copy(a);cached.b.copy(b);cached.c.copy(c);cached.normal.copy(triNormal);
        cached.normalLengthSq=triNormal.lengthSq();cached.unitNormal.copy(triNormal).normalize();
        cached.abx=ab.x;cached.aby=ab.y;cached.abz=ab.z;
        cached.acx=c.x-a.x;cached.acy=c.y-a.y;cached.acz=c.z-a.z;
        axes[9]=triNormal.x;axes[10]=triNormal.y;axes[11]=triNormal.z;
        for(let edgeIndex=0;edgeIndex<3;edgeIndex++) {
          const edge=edges[edgeIndex],i=12+edgeIndex*9;
          axes[i]=0;axes[i+1]=edge.z;axes[i+2]=-edge.y;
          axes[i+3]=-edge.z;axes[i+4]=0;axes[i+5]=edge.x;
          axes[i+6]=edge.y;axes[i+7]=-edge.x;axes[i+8]=0;
        }
        for(let i=0,j=0;i<39;i+=3,j+=10) {
          const x=axes[i],y=axes[i+1],z=axes[i+2],pa=a.x*x+a.y*y+a.z*z,pb=b.x*x+b.y*y+b.z*z,pc=c.x*x+c.y*y+c.z*z;
          let low=pa<pb?pa:pb,high=pa>pb?pa:pb;if(pc<low)low=pc;if(pc>high)high=pc;
          const data=cached.axes;data[j]=x;data[j+1]=y;data[j+2]=z;data[j+3]=low;data[j+4]=high;data[j+5]=x*x+y*y+z*z;
          data[j+6]=x<0?-x:x;data[j+7]=y<0?-y:y;data[j+8]=z<0?-z:z;data[j+9]=EPS*(data[j+6]+data[j+7]+data[j+8]);
        }
        cached.version=record.version;
      }
      return cached;
    }
    function triangleTime(start, latest, cached) {
      const triNormal=cached.normal,normalLengthSq=cached.normalLengthSq;
      if(normalLengthSq<1e-18) return Infinity;
      if(extent.x===0&&extent.y===0&&extent.z===0) {
        // Intact members sweep authored surface samples. Those point sweeps
        // need one exact segment/triangle test, not the 13 finite-box axes.
        // Möller–Trumbore keeps both sides and includes triangle boundaries.
        const a=cached.a,abx=cached.abx,aby=cached.aby,abz=cached.abz;
        const acx=cached.acx,acy=cached.acy,acz=cached.acz;
        const px=delta.y*acz-delta.z*acy,py=delta.z*acx-delta.x*acz,pz=delta.x*acy-delta.y*acx;
        const determinant=abx*px+aby*py+abz*pz;
        if(abs(determinant)<1e-12) return Infinity;
        const tx=start.x-a.x,ty=start.y-a.y,tz=start.z-a.z,inverse=1/determinant;
        const u=(tx*px+ty*py+tz*pz)*inverse;
        if(u<-EPS||u>1+EPS) return Infinity;
        const qx=ty*abz-tz*aby,qy=tz*abx-tx*abz,qz=tx*aby-ty*abx;
        const v=(delta.x*qx+delta.y*qy+delta.z*qz)*inverse;
        if(v<-EPS||u+v>1+EPS) return Infinity;
        const time=(acx*qx+acy*qy+acz*qz)*inverse;
        const planeOffset=tx*triNormal.x+ty*triNormal.y+tz*triNormal.z;
        const onFace=planeOffset*planeOffset<=EPS*EPS*normalLengthSq;
        if(time<0&&!onFace||time>latest+EPS) return Infinity;
        hitNormal.copy(cached.unitNormal);
        // Closed authored faces point outward. A point already on that face
        // may leave the solid; flipping its departure into an inward normal
        // would pin an intact member at zero time on every subsequent step.
        if(onFace&&hitNormal.dot(delta)>=0) return Infinity;
        if(hitNormal.dot(delta)>0) hitNormal.negate();
        return max(0,min(latest,time));
      }
      let enter=-Infinity, leave=latest, penetration=Infinity;
      overlapNormal.set(0,0,0);
      const data=cached.axes;
      for(let i=0;i<130;i+=10) {
        const x=data[i],y=data[i+1],z=data[i+2],lengthSq=data[i+5];
        if(lengthSq<1e-20) continue;
        const low=data[i+3],high=data[i+4];
        const s=start.x*x+start.y*y+start.z*z,d=delta.x*x+delta.y*y+delta.z*z;
        const ax=data[i+6],ay=data[i+7],az=data[i+8],tolerance=data[i+9];
        const r=ax*extent.x+ay*extent.y+az*extent.z;
        const gapLow=s+r-low,gapHigh=high-s+r;
        if(gapLow>=-tolerance&&gapHigh>=-tolerance) {
          const gap=gapLow<gapHigh?gapLow:gapHigh,depth=gap>0?gap*gap/lengthSq:0;
          if(depth<penetration) {
            penetration=depth;const sign=gapLow<gapHigh?-1:1;overlapNormal.set(x*sign,y*sign,z*sign);
          }
        }
        if(d*d<EPS*EPS*lengthSq) {
          if(gapLow<-tolerance||gapHigh<-tolerance) return Infinity;
          continue;
        }
        let lo=(low-r-s)/d,hi=(high+r-s)/d;
        if(lo>hi) { const temp=lo;lo=hi;hi=temp; }
        if(lo>enter) { enter=lo; const sign=d>0?-1:1;hitNormal.set(x*sign,y*sign,z*sign); }
        if(hi<leave)leave=hi;
        if(enter>leave+EPS) return Infinity;
      }
      if(leave<-EPS||enter>latest+EPS) return Infinity;
      if(enter<0) {
        // Already touching: a separating trajectory must remain separating.
        // This also prevents a t=0 face from repeatedly injecting rebounds.
        overlapNormal.normalize();if(delta.dot(overlapNormal)>=-EPS) return Infinity;
        hitNormal.copy(overlapNormal); return 0;
      }
      hitNormal.normalize();
      return max(0,min(latest,enter));
    }
    function sweep(start,end,options={}) {
      sweeps++;
      if(!root||!Number.isFinite(start.x+start.y+start.z+end.x+end.y+end.z)) return null;
      delta.subVectors(end,start);
      if(delta.lengthSq()<1e-18) return null;
      const radius=Number.isFinite(options.radius)?max(0,options.radius):0;
      extent.copy(options.halfExtents||{x:radius,y:radius,z:radius});
      extent.set(max(0,extent.x),max(0,extent.y),max(0,extent.z));
      let best=null,latest=Number.isFinite(options.maxTime)?max(0,min(1,options.maxTime)):1;
      const pool=options.candidates;
      let candidateSet=null;
      if(pool&&pool.length>4) {
        candidateSet=candidateSets.get(pool);
        if(!candidateSet) {candidateSet=new Set(pool);candidateSets.set(pool,candidateSet);}
      }
      function triangleQuery(node,record,tested=false) {
        if(!tested&&boxTime(node.box,localStart,localDelta,localExtent,latest)===Infinity) return;
        if(node.left) {
          const left=boxTime(node.left.box,localStart,localDelta,localExtent,latest),right=boxTime(node.right.box,localStart,localDelta,localExtent,latest);
          if(left<=right) {if(left!==Infinity)triangleQuery(node.left,record,true);if(right<=latest)triangleQuery(node.right,record,true);}
          else {if(right!==Infinity)triangleQuery(node.right,record,true);if(left<=latest)triangleQuery(node.left,record,true);}
          return;
        }
        for(let i=node.first;i<node.last;i++) {
          const tri=record.tree.triangles[i];
          if(boxTime(tri.box,localStart,localDelta,localExtent,latest)===Infinity) continue;
          triangleTests++;
          const cached=worldTriangle(record,i),time=triangleTime(start,latest,cached);
          if(time===Infinity||best&&time>=latest-EPS) continue;
          if(options.acceptNormal&&!options.acceptNormal(hitNormal,record.part)) continue;
          center.copy(start).addScaledVector(delta,time);
          triangle.set(cached.a,cached.b,cached.c); triangle.closestPointToPoint(center,point);
          const part=record.part,velocity=new T.Vector3();
          if(part.vel&&Number.isFinite(part.vel.x+part.vel.y+part.vel.z)) velocity.copy(part.vel);
          if(part.spin&&Number.isFinite(part.spin.x+part.spin.y+part.spin.z)) {
            origin.setFromMatrixPosition(part.node.matrixWorld);scratch.subVectors(point,origin).crossVectors(part.spin,scratch);velocity.add(scratch);
          }
          const hit={partId:part.id,part,point:point.clone(),normal:hitNormal.clone(),center:center.clone(),time,t:time,velocity};
          if(options.accept&&!options.accept(hit)) continue;
          best=hit;latest=time;
        }
      }
      function recordQuery(record) {
        if(candidateSet&&!candidateSet.has(record))return;
        const id=record.part.id;
        if(!visible(record)||options.excludePartId!=null&&String(id)===String(options.excludePartId)||options.excludeIds?.has(id)||options.excludeIds?.has(String(id)))return;
        meshTests++;
        if(boxTime(record.box,start,delta,extent,latest)===Infinity)return;
        localStart.copy(start).applyMatrix4(record.inverse);localEnd.copy(end).applyMatrix4(record.inverse);localDelta.subVectors(localEnd,localStart);
        const m=record.inverse.elements;
        localExtent.set(abs(m[0])*extent.x+abs(m[4])*extent.y+abs(m[8])*extent.z,
          abs(m[1])*extent.x+abs(m[5])*extent.y+abs(m[9])*extent.z,
          abs(m[2])*extent.x+abs(m[6])*extent.y+abs(m[10])*extent.z);
        triangleQuery(record.tree.root,record);
      }
      function meshQuery(node) {
        if(boxTime(node.box,start,delta,extent,latest)===Infinity) return;
        if(node.left) {meshQuery(node.left);meshQuery(node.right);return;}
        for(let i=node.first;i<node.last;i++)recordQuery(records[i]);
      }
      // A large coherent body's envelope can cover most of the building.
      // Retain the BVH per sample instead of scanning that entire pool; a
      // tiny ordered pool is cheaper to test directly. Membership is built
      // once per reusable candidate array and does not retain expired arrays.
      if(pool&&pool.length<=4)for(const record of pool)recordQuery(record);
      else meshQuery(root);
      return best;
    }
    const stats=()=>({meshes:records.length,geometries:geometries.size,triangles,triangleTests,meshTests,sweeps,syncs});
    sync();
    return {sync,sweep,candidates,stats};
  }
  window.SkyfallFragmentContact={create};
})();
