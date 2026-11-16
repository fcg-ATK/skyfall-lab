/* Skyfall Mobile: bounded, visual destruction simulation. Not an engineering solver. */
(function () {
  'use strict';
  const T = window.THREE;
  const P = window.SkyfallPhysics;
  const V = (p) => new T.Vector3(p.x, p.y, p.z);
  const clamp = T.MathUtils.clamp;
  class SkyfallEngine {
    constructor(canvas, onEvent) {
      this.canvas = canvas; this.onEvent = onEvent || (() => {});
      this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.2;
      this.renderer.shadowMap.type = T.PCFShadowMap;
      this.renderer.shadowMap.autoUpdate = false;
      this.scene = new T.Scene(); this.scene.background = new T.Color(0xaab8bb);
      this.scene.fog = new T.Fog(0xb8b9af, 150, 360);
      this.camera = new T.PerspectiveCamera(43, 1, 0.3, 600);
      this.orbit = { yaw: 0.68, pitch: 0.3, distance: 66, height: 10 };
      this.aim = { height: 7, angle: 0, x: 0, z: 0 };
      this.weapon = 'rocket'; this.parts = []; this.time = 0;
      this.temp = new T.Object3D(); this.ray = new T.Raycaster(); this.ndc = new T.Vector2();
      this.fillLight = new T.HemisphereLight(0xe5edf0, 0x827d72, 1.1);
      this.scene.add(this.fillLight);
      this.sun = new T.DirectionalLight(0xfff0d8, 3.8);
      this.sun.position.set(-26, 50, 30); this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      Object.assign(this.sun.shadow.camera, { left: -29, right: 29, top: 29, bottom: -29, near: 1, far: 110 });
      this.sun.shadow.normalBias = 0.035; this.sun.shadow.bias = -0.00008;
      this.sun.shadow.radius = 2;
      this.scene.add(this.sun);
      this.flash = new T.PointLight(0xff8f36, 0, 45, 1.7); this.scene.add(this.flash);
      this.buildEnvironment(); this.buildPools(); this.buildProjectile(); this.buildGuide();
      this.structuralFragments = window.SkyfallStructuralFragments.create(this.scene);
      this.powder = window.SkyfallPowder.create(this.scene);
      this.impactFX = window.SkyfallImpactFX.create(this.scene);
      this.setQuality('balanced'); this.reset();
    }
    buildEnvironment() {
      this.environment = window.SkyfallEnvironment.create(this.scene, this.renderer);
      this.envTarget = this.environment.environmentTarget;
      this.scene.environmentIntensity = 0.65;
    }
    buildPools() {
      this.fragments = []; this.dust = []; this.rings = []; this.rubble = [];
      const geo = new T.IcosahedronGeometry(1, 0);
      this.fragmentMesh = new T.InstancedMesh(geo, new T.MeshStandardMaterial({ roughness: 0.76, metalness: 0.18, vertexColors: false }), 400);
      this.fragmentMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); this.fragmentMesh.frustumCulled = false; this.fragmentMesh.count = 0;
      this.scene.add(this.fragmentMesh);
      const glassGeo = new T.BufferGeometry();
      glassGeo.setAttribute('position', new T.Float32BufferAttribute([-.6,-.35,0, .7,-.2,0, -.1,.7,.025],3));
      glassGeo.computeVertexNormals();
      this.glassMesh = new T.InstancedMesh(glassGeo, new T.MeshStandardMaterial({ color:0x9fbec1, roughness:.12, metalness:.6, side:T.DoubleSide, envMapIntensity:1.6 }),400);
      this.glassMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); this.glassMesh.frustumCulled=false; this.glassMesh.count=0; this.scene.add(this.glassMesh);
      const image = document.createElement('canvas'); image.width = image.height = 128;
      const ctx = image.getContext('2d');
      for (let i = 0; i < 24; i++) {
        const a = i * 2.399, r = (i % 5) * 5, x = 64 + Math.sin(a) * r, y = 64 + Math.cos(a) * r;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 26 + i % 15);
        g.addColorStop(0, 'rgba(255,255,255,0.13)'); g.addColorStop(0.55, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
      }
      const dg = new T.PlaneGeometry(1, 1);
      this.dustAlpha = new T.InstancedBufferAttribute(new Float32Array(150), 1).setUsage(T.DynamicDrawUsage);
      this.dustColor = new T.InstancedBufferAttribute(new Float32Array(450), 3).setUsage(T.DynamicDrawUsage);
      dg.setAttribute('aAlpha', this.dustAlpha); dg.setAttribute('aTint', this.dustColor);
      const mat = new T.ShaderMaterial({ uniforms: { map: { value: new T.CanvasTexture(image) } }, transparent: true, depthWrite: false,
        vertexShader: 'attribute float aAlpha; attribute vec3 aTint; varying vec2 vUv; varying float vAlpha; varying vec3 vTint; void main(){vUv=uv;vAlpha=aAlpha;vTint=aTint;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}',
        fragmentShader: 'uniform sampler2D map; varying vec2 vUv; varying float vAlpha; varying vec3 vTint; void main(){float a=texture2D(map,vUv).a*vAlpha;if(a<0.006)discard;gl_FragColor=vec4(vTint,a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}' });
      this.dustMesh = new T.InstancedMesh(dg, mat, 150); this.dustMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); this.dustMesh.frustumCulled = false; this.dustMesh.count = 0; this.dustMesh.renderOrder = 5; this.scene.add(this.dustMesh);
      const ringGeo = new T.RingGeometry(0.94, 1, 48);
      for (let i = 0; i < 4; i++) {
        const m = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: 0xffbd71, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
        m.visible = false; this.scene.add(m); this.rings.push({ mesh: m, age: 10 });
      }
    }
    buildProjectile() {
      this.projectile = new T.Group(); this.scene.add(this.projectile);
      const rock = new T.IcosahedronGeometry(1, 2), vertices = rock.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
        const r = 1 + .1 * Math.sin(x * 9 + y * 5) * Math.cos(z * 8 - x * 4) + .055 * Math.cos(y * 17 + z * 11);
        vertices.setXYZ(i, x * r, y * r, z * r);
      }
      rock.computeVertexNormals();
      this.projectileCore = new T.Mesh(rock, new T.MeshStandardMaterial({ color: 0x28231f, roughness: 0.94, emissive: 0x9e2506, emissiveIntensity: .35 }));
      this.projectile.add(this.projectileCore);
      this.ballCore = new T.Mesh(new T.SphereGeometry(.85, 20, 14), new T.MeshStandardMaterial({ color: 0x686b6c, metalness: .92, roughness: .2, envMapIntensity: 1.3 }));
      this.projectile.add(this.ballCore);
      this.rocket = new T.Group();
      const body = new T.Mesh(new T.CylinderGeometry(0.14, 0.24, 2.1, 10), new T.MeshStandardMaterial({ color: 0xd7d6cc, metalness: 0.7, roughness: 0.28 }));
      body.rotation.x = Math.PI / 2; this.rocket.add(body);
      const tip = new T.Mesh(new T.ConeGeometry(0.23, 0.8, 10), new T.MeshStandardMaterial({ color: 0xe98a35, metalness: 0.5, roughness: 0.3 }));
      tip.rotation.x = -Math.PI / 2; tip.position.z = -1.3; this.rocket.add(tip);
      const fins = new T.Mesh(new T.BoxGeometry(0.85, 0.055, 0.55), body.material); fins.position.z = 0.8; this.rocket.add(fins);
      const fins2 = fins.clone(); fins2.rotation.z = Math.PI / 2; this.rocket.add(fins2); this.projectile.add(this.rocket);
      const flameMaterial = new T.ShaderMaterial({ transparent:true, depthWrite:false, blending:T.AdditiveBlending, side:T.DoubleSide,
        vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader:'varying vec2 vUv; void main(){float fade=pow(sin(vUv.y*3.14159),1.6); float streak=.5+.5*sin(vUv.x*63.0+vUv.y*23.0); gl_FragColor=vec4(mix(vec3(1.0,.14,.015),vec3(1.0,.75,.25),fade),fade*(.16+streak*.21));\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}' });
      const flameGeometry = new T.ConeGeometry(.75, 3, 12, 1, true); flameGeometry.rotateX(Math.PI / 2);
      this.flame = new T.Mesh(flameGeometry, flameMaterial);
      this.projectile.add(this.flame); this.projectile.visible = false;
    }
    buildGuide() {
      this.guide = new T.Group(); this.scene.add(this.guide);
      this.arrow = new T.ArrowHelper(new T.Vector3(0, 0, -1), new T.Vector3(0, 7, 25), 16, 0xffc16c, 1.5, 0.75); this.guide.add(this.arrow);
      this.guideRing = new T.Mesh(new T.TorusGeometry(0.65, 0.035, 5, 40), new T.MeshBasicMaterial({ color: 0xffd58f, depthTest: false, transparent: true, opacity: 0.85 }));
      this.guideRing.renderOrder = 9; this.guide.add(this.guideRing);
    }
    async load(onProgress = () => {}) {
      const assets = window.SkyfallLoading.createLoader({ onProgress });
      this.cancelLoading = () => assets.cancel();
      let building, manifest, fragmentDescription, fragmentBuffer;
      try {
        [building, manifest, fragmentDescription, fragmentBuffer] = await Promise.all([
          assets.asset('assets/mobile-building.glb', { label: '建筑模型', rawBytes: 8096620, gzipBytes: 2726978 }),
          assets.asset('assets/mobile-building.json', { label: '建筑结构', rawBytes: 20013, gzipBytes: 2413 }),
          assets.asset('assets/pc-fragments.json', { label: '碎块结构', rawBytes: 1229792, gzipBytes: 185008 }),
          assets.asset('assets/pc-fragments.bin', { label: '破碎细节', rawBytes: 22719180, gzipBytes: 5409197 })
        ]);
      } catch (error) { assets.cancel(); throw error; }
      onProgress({ stage: '正在解码建筑与材质…' });
      const gltf = await window.SkyfallLoading.withTimeout(new T.GLTFLoader().parseAsync(building, 'assets/'), 45000, '建筑解码');
      this.manifest = JSON.parse(new TextDecoder().decode(manifest)); this.model = gltf.scene; this.scene.add(this.model);
      // Streetscape maps enhance an already complete procedural environment.
      // Their network/GPU processing must never gate entry into the game.
      this.model.traverse(n => {
        if (!n.isMesh) return;
        const glass = /glass/i.test(n.name) || /glass/i.test(n.material?.name || '');
        n.castShadow = !glass; n.receiveShadow = !glass;
        const materials = Array.isArray(n.material) ? n.material : [n.material];
        for (const m of materials) {
          if (glass) { m.roughness = .16; m.metalness = .08; m.envMapIntensity = 1.15; m.depthWrite = false; m.side = T.FrontSide; }
          else { m.envMapIntensity = .45; if (m.normalScale) m.normalScale.set(.32, .32); }
          for (const key of ['map','normalMap','roughnessMap']) if(m[key]) m[key].anisotropy = Math.min(4, this.renderer.capabilities?.getMaxAnisotropy?.() || 1);
        }
      });
      this.parts = this.manifest.pieces.map((data, id) => {
        const node = this.model.getObjectByName(data.nodeName || data.name);
        if (!node) throw new Error('模型结构缺失：' + (data.nodeName || data.name));
        const part = { ...data, id, node, center: data.center || data.position, rest: node.position.clone(), restQ: node.quaternion.clone(), restScale: node.scale.clone(), vel: new T.Vector3(), spin: new T.Vector3() };
        node.traverse(n => { n.userData.part = part; }); return part;
      });
      onProgress({ stage: '正在准备建筑碎裂与碰撞…' });
      await new Promise(resolve => setTimeout(resolve, 0));
      this.structuralFragments.prepare(this.parts, JSON.parse(new TextDecoder().decode(fragmentDescription)), fragmentBuffer);
      this.collapse=window.SkyfallCollapse.create(this.parts,{
        floorHeights:this.manifest.floorHeights,
        groundAt:(x,z)=>this.structuralFragments.groundHeight?.(x,z)??.24,
        activate:p=>this.breakPart(p),
        fracture:(p,contact)=>{p.crushEnergy=contact.energy;p.hitPoint=new T.Vector3(contact.point.x,contact.point.y,contact.point.z);this.fracturePart(p);this.landing({point:p.hitPoint,partId:p.id,floor:p.floor,energy:contact.energy});}
      });
      this.reset(); this.loaded = true;
    }
    setQuality(mode) {
      this.quality = mode; this.profile = P.qualityProfile(mode); this.renderer.shadowMap.enabled = this.profile.shadows;
      this.environment?.setQuality(this.profile);
      this.powder?.setQuality(this.profile); this.impactFX?.setQuality(this.profile);this.structuralFragments?.setQuality(this.profile);
      this.renderer.shadowMap.needsUpdate = true; this.resize();
      if (this.dust) this.dust.splice(this.profile.dust);
      if (this.fragments) this.fragments.splice(this.profile.fragments);
    }
    resize() {
      const width = this.canvas.clientWidth || innerWidth, height = this.canvas.clientHeight || innerHeight;
      const ratio = Math.min(devicePixelRatio || 1, this.profile?.pixelRatio || 1.25, Math.sqrt((this.profile?.maxPixels || 1100000) / (width * height)));
      this.renderer.setPixelRatio(ratio); this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    }
    resetCamera() { Object.assign(this.orbit, { yaw: 0.68, pitch: 0.3, distance: 66, height: 10 }); }
    reset() {
      this.state = 'ready'; this.time = 0; this.watchTime = 0; this.score = 0; this.damage = 0; this.plan = [];
      this.slow = 0; this.hitStop = 0; this.shake = 0; this.effectTime = 0; this.projectile.visible = false; this.shot = null; this.flash.intensity = 0;
      this.floorBeats=new Map();this.landingBeats=new Map();this.collapse?.reset();this.structuralFragments?.reset();this.powder?.reset();this.impactFX?.reset();this.onEvent('reset');
      this.fragments.length = 0; this.dust.length = 0;
      this.rubble.length = 0;
      this.rings.forEach(r => { r.mesh.visible = false; r.age = 10; });
      for (const p of this.parts) { p.node.position.copy(p.rest); p.node.quaternion.copy(p.restQ); p.node.scale.copy(p.restScale); p.node.visible=true; p.node.traverse(n=>{if(n.isMesh)n.visible=true;}); p.phase='intact';p.active=false;p.gone=false;p.direct=false;p.delay=Infinity;p.crumbleProgress=0;p.age=0;p.hitPoint=null;p.crushEnergy=0;p.impactLoad=0;p.blast=false;p.vel.set(0,0,0);p.spin.set(0,0,0); }
      this.guide.visible = true; this.renderer.shadowMap.needsUpdate = true;
    }
    direction() {
      // Keep the launcher above pavement while still aiming at the chosen height.
      const minimumAngle = -Math.floor(Math.atan2(Math.max(0, this.aim.height - 1.5), 42) * 180 / Math.PI);
      this.aim.angle = clamp(this.aim.angle, minimumAngle, 45);
      const a = -this.aim.angle * Math.PI / 180, y = this.orbit.yaw;
      return new T.Vector3(-Math.sin(y) * Math.cos(a), Math.sin(a), -Math.cos(y) * Math.cos(a));
    }
    fire(weapon) {
      if (!this.loaded || this.state !== 'ready') return false;
      this.weapon = weapon; const dir = this.direction(), target = new T.Vector3(this.aim.x, this.aim.height, this.aim.z);
      const start = target.clone().addScaledVector(dir, -42);
      this.projectile.position.copy(start); this.projectile.quaternion.setFromUnitVectors(new T.Vector3(0, 0, -1), dir);
      this.projectileCore.visible = weapon === 'meteor'; this.ballCore.visible = weapon === 'ball'; this.rocket.visible = weapon === 'rocket'; this.flame.visible = weapon !== 'ball';
      this.projectileCore.scale.setScalar(weapon === 'meteor' ? 1.2 : 0.85);
      this.projectileCore.material.emissiveIntensity = weapon === 'meteor' ? .4 : 0;
      this.projectileCore.material.metalness = weapon === 'ball' ? 0.85 : 0.1;
      this.flame.position.set(0, 0, weapon === 'meteor' ? 1.1 : 1.65); this.flame.scale.set(0.4, 0.4, weapon === 'meteor' ? 4 : 1.6);
      this.projectile.visible = true; this.guide.visible = false;
      this.shot = { dir, speed: weapon === 'meteor' ? 62 : weapon === 'rocket' ? 78 : 48, traveled: 0, hit: false, penetrated: new Set(), emit: 0, stopped: false, exitBurst: false };
      this.state = 'flight'; this.watchTime = 0; this.onEvent('launch', { weapon }); return true;
    }
    pick(x, y) {
      if (this.state !== 'ready' || !this.model) return false;
      const rect = this.canvas.getBoundingClientRect(); this.ndc.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1);
      this.ray.near = 0; this.ray.far = Infinity; this.ray.setFromCamera(this.ndc, this.camera);
      const hit = this.ray.intersectObjects(this.parts.map(p => p.node), true)[0];
      if (!hit) return false;
      this.aim.height = clamp(hit.point.y, 1, 30); this.aim.x = hit.point.x; this.aim.z = hit.point.z; return true;
    }
    addDust(position, count, energy = 1, fire = false, direction = null) {
      for (let i = 0; i < count; i++) {
        if (this.dust.length >= this.profile.dust) this.dust.shift();
        const angle = Math.random() * Math.PI * 2, speed = (0.7 + Math.random() * 2.5) * energy;
        const velocity = new T.Vector3(Math.sin(angle) * speed, .3 + Math.random() * energy, Math.cos(angle) * speed);
        if(direction) velocity.addScaledVector(direction, energy * 2.2);
        this.dust.push({ p: position.clone().add(new T.Vector3((Math.random() - .5) * 1.2, Math.random() * .4, (Math.random() - .5) * 1.2)), v: velocity, age: 0, life: fire ? .18 + Math.random() * .2 : 1.8 + Math.random() * 1.5, size: fire ? .35 + energy * .3 : .32 + Math.random() * .55 + Math.min(1.1,energy*.22), fire });
      }
    }
    addFragments(position, count, power, glass = false, direction = null) {
      for (let i = 0; i < count; i++) {
        if (this.fragments.length >= this.profile.fragments) this.fragments.shift();
        const dir = new T.Vector3(Math.random() - 0.5, Math.random() * 0.65, Math.random() - 0.5).normalize();
        const pos = position.clone().addScaledVector(dir, Math.random()*.8);
        dir.multiplyScalar((2 + Math.random() * 6) * power);
        if(direction) dir.addScaledVector(direction, (glass ? 8 : 6) * power);
        this.fragments.push({ p: pos, v: dir, r: new T.Euler(Math.random() * 4, Math.random() * 4, 0), spin: 2+Math.random() * 8, scale: glass ? .12 + Math.random() * .3 : .09 + Math.random() * .28, age: 0, glass, color: new T.Color(glass ? (i % 2 ? 0xc0e2ea : 0x47727b) : (i % 2 ? 0x8b887c : 0xb5ac98)) });
      }
    }
    explode(point, power, scale = 1) {
      this.flash.position.copy(point); this.flash.intensity = (this.weapon==='ball'?35:180) * power * scale;
      this.shake = Math.max(this.shake, Math.min(1.8,power*.65*scale));
      this.impactFX.burst(point, this.shot.dir, this.weapon, scale);
      this.addDust(point, Math.round(3*power*scale), .7*scale, false, this.shot.dir);
      this.addFragments(point, Math.round(14*power*scale), power*.8, false, this.shot.dir);
      this.addFragments(point, Math.round(16*power*scale), power*.75, true, this.shot.dir);
      this.powder.emit(point,{direction:this.shot.dir,energy:power*scale,count:Math.round(150*power*scale),spread:1.2,falling:false});
    }
    impact(point, part) {
      const shot = this.shot; if (shot.penetrated.has(part.id)) return;
      shot.penetrated.add(part.id);
      const first = !shot.hit; shot.hit = true;
      const power = this.weapon === 'meteor' ? 2.3 : this.weapon === 'rocket' ? 1.6 : 0.9;
      part.direct = true; part.hitPoint=point.clone();
      if(!part.gone)this.fracturePart(part);
      if (first) { this.slow=1.2; this.hitStop=.045; this.state='watch';shot.entryPoint=point.clone();this.onEvent('impact',{weapon:this.weapon});this.explode(point,power); }
      else if(!shot.exitBurst && point.distanceTo(shot.entryPoint)>3) { shot.exitBurst=true; this.explode(point,power,.45); this.onEvent('penetration',{weapon:this.weapon}); }
      else { this.addFragments(point, 5, power*.6, false, shot.dir); }
      // Only real triangle contact starts damage. The local blast then reaches nearby supports.
      const plan = P.collapsePlan(this.parts, [part.id], this.weapon, Math.random);
      for (const entry of plan) {
        const p = this.parts.find(p => p.id === entry.id); if (!p || p.active) continue;
        p.delay = Math.min(p.delay, this.time + entry.delay);p.blast=true;
      }
    }
    breakPart(p) {
      const fresh=p.phase==='intact';
      p.active=true;p.age=0;p.phase='falling';p.crumbleProgress=.2;
      // Newly unsupported architecture starts at rest and joins its connected
      // falling mass in the same solver substep; never inject a timed explosion.
      if(fresh){p.vel.set(0,Math.min(0,p.vel.y),0);p.spin.set(0,0,0);}
      if(p.direct)this.fracturePart(p);
    }
    fracturePart(p) {
      if(p.gone)return;
      p.node.updateWorldMatrix(true,true);
      const direction=this.shot?.dir||new T.Vector3(0,0,-1);
      this.structuralFragments.release(p,{point:p.hitPoint||p.node.position,direction,velocity:p.vel,angularVelocity:p.spin,direct:p.direct,weapon:this.weapon,cause:p.direct?'blast':'compression',energy:p.crushEnergy||Math.abs(p.vel.y)});
      p.phase='fragmented';p.gone=true;p.active=true;p.crumbleProgress=1;p.node.visible=false;
      const samples=this.structuralFragments.sample(p.id,8);
      for(let i=0;i<samples.length;i++) {
        const point=samples[i].position;
        this.powder.emit(point,{direction,energy:p.direct?1.2:.6,count:this.quality==='low'?9:17,spread:.45,falling:!p.direct});
        if(i%3===0)this.addDust(point,1,.55,false,new T.Vector3(point.x,0,point.z).normalize());
      }
      this.onEvent('fracture',{weapon:this.weapon,floor:p.floor,energy:p.direct?1:.6});
      this.score+=150+Math.floor(Math.random()*100);
      this.renderer.shadowMap.needsUpdate=true;
    }
    supports() { return this.collapse?.supports()||[]; }
    landing(event) {
      // Count real first-contact kinetic energy before cosmetic rate limiting.
      // Small decorative chips never act as structural loads.
      if(event.firstContact && event.mass>=12 && event.energy>=3 && event.supportId!=null){
        const support=this.parts.find(p=>p.id===event.supportId);
        if(support&&!support.gone&&!support.active){
          support.impactLoad=(support.impactLoad||0)+Math.min(120000,event.kineticEnergy||0);
          if(support.impactLoad>=650000){support.crushEnergy=event.energy;support.hitPoint=event.point.clone();this.fracturePart(support);}
        }
      }
      const key=event.partId??event.floor;
      if(this.time-(this.landingBeats.get(key)??-Infinity)<.18)return;
      this.landingBeats.set(key,this.time);
      const last=this.floorBeats.get(event.floor)??-Infinity;
      // One audible beat per storey/landing wave, while actual local impacts add dust.
      const energy=clamp(event.energy||1,.25,2);
      this.addDust(event.point,Math.min(3,Math.ceil(energy)),.55+this.damage/180);
      if(this.time-last<.55)return;
      this.floorBeats.set(event.floor,this.time);
      this.shake=Math.max(this.shake,.12+energy*.12);
      this.onEvent('floorImpact',{weapon:this.weapon,floor:event.floor,energy});
      this.addFragments(event.point,this.quality==='low'?3:6,.5);
      this.score+=90;
    }
    step(realDt) {
      const clockDt=Math.min(Math.max(0,realDt),.05);
      const dt=clockDt*(this.hitStop>0?0:this.slow>0?.22:1);
      this.hitStop=Math.max(0,this.hitStop-realDt);
      this.slow = Math.max(0, this.slow - realDt); this.time += dt; this.effectTime+=clockDt;
      this.flash.intensity *= Math.exp(-clockDt * 14); this.shake *= Math.exp(-clockDt * 7);
      this.impactFX.step(clockDt);
      const shot = this.shot;
      if (shot && this.projectile.visible) {
        if (!shot.stopped) {
          const old = this.projectile.position.clone(), next = old.clone().addScaledVector(shot.dir, shot.speed * dt), distance = old.distanceTo(next);
          this.ray.set(old, shot.dir); this.ray.near = 0; this.ray.far = distance;
          const live=[];
          for(const p of this.parts) if(!p.gone && !shot.penetrated.has(p.id))
            p.node.traverseVisible(n=>{if(n.isMesh)live.push(n);});
          this.scene.updateMatrixWorld(true);
          const contacts=this.ray.intersectObjects(live,false), encountered=new Set();
          for(const hit of contacts) {
            const part=hit.object.userData.part;
            if(!part || encountered.has(part.id))continue;
            encountered.add(part.id); this.impact(hit.point,part);
            if(shot.stopped)break;
          }
          if (!shot.stopped) this.projectile.position.copy(next);
          shot.traveled += distance;
          shot.emit += dt;
          if (this.weapon !== 'ball' && shot.emit > 0.045) { shot.emit = 0; this.addDust(this.projectile.position, 1, .35, true); }
          if (shot.traveled > 115 || next.y < 0) {
            this.projectile.visible = false;
            if (!shot.hit) { this.state = 'watch'; this.onEvent('miss'); }
          }
        } else if (this.time - shot.stopTime > 0.55) this.projectile.visible = false;
        this.flame.scale.x = this.flame.scale.y = (this.weapon === 'meteor' ? 1.05 : 0.3) * (0.85 + Math.random() * 0.3);
      }
      // Only a local blast has a brief propagation schedule. All upper motion
      // and secondary failure come from live support and physical contact.
      for(const p of this.parts)if(!p.gone&&p.blast&&this.time>=p.delay){p.direct=true;this.fracturePart(p);}
      if(this.collapse.step(dt))this.renderer.shadowMap.needsUpdate=true;
      let damaged=0;
      for(const p of this.parts){
        if(p.active&&!p.gone)p.crumbleProgress=Math.max(p.crumbleProgress,.2+Math.min(.35,(p.rest.y-p.node.position.y)/50));
        damaged+=p.crumbleProgress;
      }
      this.damage=this.parts.length?Math.round(damaged/this.parts.length*100):0;
      this.powder.step(dt);
      const movingBefore=this.structuralFragments.stats().moving;
      for(const event of this.structuralFragments.step(dt,this.supports()))this.landing(event);
      if(movingBefore || this.structuralFragments.stats().moving)this.renderer.shadowMap.needsUpdate=true;
      this.damage=this.parts.length?Math.round(this.parts.reduce((sum,p)=>sum+p.crumbleProgress,0)/this.parts.length*100):0;
      for (const f of this.fragments) {
        f.age += dt;
        if (f.p.y > f.scale * 0.35 || f.v.lengthSq() > 0.08) {
          f.v.y -= dt * 13; f.p.addScaledVector(f.v, dt); f.r.x += dt * f.spin; f.r.z += dt * f.spin * 0.5;
          if (f.p.y < f.scale * 0.35) { f.p.y = f.scale * 0.35; f.v.y = Math.abs(f.v.y) * 0.15; f.v.x *= 0.55; f.v.z *= 0.55; }
        }
      }
      for (const d of this.dust) {
        d.age+=dt; d.p.addScaledVector(d.v,dt); d.v.multiplyScalar(Math.exp(-dt*.55));
        if(!d.fire && d.p.y<.25){d.p.y=.25;d.v.y=.15;}
      }
      this.dust = this.dust.filter(d => d.age < d.life);
      for (const r of this.rings) { r.age += dt; if (r.age >= 1) r.mesh.visible = false; else { r.mesh.scale.setScalar(1 + r.age * 24 * r.power); r.mesh.material.opacity = (1 - r.age) * 0.7; } }
      if (this.state === 'watch') {
        this.watchTime += dt;
        const unsettled=this.parts.some(p=>p.active&&!p.gone)||this.structuralFragments.stats().moving>0;
        if (this.watchTime > (shot?.hit ? 10 : 1.2)&&!unsettled) { this.state = 'finished'; this.onEvent('finished', { score: this.score, damage: this.damage }); }
      }
    }
    render() {
      const o = this.orbit;
      // Portrait gets an automatic wider view without changing the user's zoom setting.
      const d = o.distance * (this.camera.aspect < 0.8 ? 1.22 : 1);
      this.camera.position.set(Math.sin(o.yaw) * Math.cos(o.pitch) * d, o.height + Math.sin(o.pitch) * d, Math.cos(o.yaw) * Math.cos(o.pitch) * d);
      const kick=this.shake, phase=this.effectTime;
      this.camera.position.x += Math.sin(phase*67)*kick*.32;
      this.camera.position.y += Math.sin(phase*83+1)*kick*.24;
      this.camera.lookAt(0, o.height, 0);
      this.camera.rotateZ(Math.sin(phase*49)*kick*.006);
      const fov=43-kick*.65;
      if(Math.abs(this.camera.fov-fov)>.01){this.camera.fov=fov;this.camera.updateProjectionMatrix();}
      const dir = this.direction(), target = new T.Vector3(this.aim.x, this.aim.height, this.aim.z);
      this.arrow.position.copy(target).addScaledVector(dir, -27); this.arrow.setDirection(dir); this.arrow.setLength(18, 1.5, 0.7);
      this.guideRing.position.copy(target); this.guideRing.quaternion.copy(this.camera.quaternion);
      let stoneCount=0,glassCount=0;
      this.fragments.forEach(f => {
        this.temp.position.copy(f.p); this.temp.rotation.copy(f.r); this.temp.scale.set(f.scale, f.scale * (f.glass ? .85 : .55), f.scale * .8); this.temp.updateMatrix();
        if(f.glass)this.glassMesh.setMatrixAt(glassCount++,this.temp.matrix);
        else {this.fragmentMesh.setMatrixAt(stoneCount,this.temp.matrix);this.fragmentMesh.setColorAt(stoneCount++,f.color);}
      });
      this.fragmentMesh.count=stoneCount;this.glassMesh.count=glassCount;this.glassMesh.instanceMatrix.needsUpdate=true;
      this.fragmentMesh.instanceMatrix.needsUpdate = true; if (this.fragmentMesh.instanceColor) this.fragmentMesh.instanceColor.needsUpdate = true;
      this.dustMesh.count = this.dust.length;
      this.dust.forEach((p, i) => {
        const t = p.age / p.life, size = p.size * (1 + t * (p.fire ? 1.2 : 3.1));
        this.temp.position.copy(p.p); this.temp.quaternion.copy(this.camera.quaternion); this.temp.scale.setScalar(size); this.temp.updateMatrix(); this.dustMesh.setMatrixAt(i, this.temp.matrix);
        this.dustAlpha.setX(i, Math.min(1, t * 12) * (1 - t) * (p.fire ? 1.6 : 0.57));
        this.dustColor.setXYZ(i, p.fire ? 1 : 0.51, p.fire ? 0.32 + (1 - t) * 0.35 : 0.49, p.fire ? 0.05 : 0.45);
      });
      this.dustMesh.instanceMatrix.needsUpdate = true; this.dustAlpha.needsUpdate = true; this.dustColor.needsUpdate = true;
      this.impactFX.render(this.camera);
      this.powder.render(this.camera,this.canvas.clientHeight||innerHeight,this.renderer.getPixelRatio?.()||1);
      this.structuralFragments.render();
      this.renderer.render(this.scene, this.camera);
    }
    metrics() { return { drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, dust: this.dust.length, fragments: this.fragments.length, structureFragments:this.structuralFragments.stats().active,powder:this.powder.stats().active, width: this.canvas.width, height: this.canvas.height, state: this.state, damage: this.damage }; }
  }
  window.SkyfallEngine = SkyfallEngine;
})();
