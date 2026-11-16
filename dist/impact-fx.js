/* Four fixed GPU batches for mobile impact layers. No per-impact GPU allocation. */
(function () {
  'use strict';
  const T = window.THREE;
  const clamp = T.MathUtils.clamp;
  const vertex = `
    attribute vec4 aEffect;
    varying vec2 vUv;
    varying vec4 vEffect;
    void main() {
      vUv = uv; vEffect = aEffect;
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }`;
  const output = `
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  `;
  const heatFragment = `
    uniform sampler2D cloudMap;
    varying vec2 vUv;
    varying vec4 vEffect;
    void main() {
      float age = vEffect.x;
      vec2 p = vUv * 2.0 - 1.0;
      vec4 cloud = texture2D(cloudMap, vUv);
      vec3 tint;
      float alpha;
      if (vEffect.z < 0.5) {
        float core = exp(-dot(p,p)*8.0);
        float rays = exp(-abs(p.x)*52.0) * exp(-abs(p.y)*3.0)
                   + exp(-abs(p.y)*52.0) * exp(-abs(p.x)*3.0);
        alpha = min(1.0, core + rays * 0.3) * vEffect.y;
        tint = vec3(12.0, 8.5, 4.8);
      } else {
        // Two different noise frequencies break both the silhouette and the
        // hot interior into lobes. The core burns away into dark orange edges.
        vec2 swirl = vec2(sin(age*7.0+vEffect.w), cos(age*6.0+vEffect.w))*0.065;
        float folds = texture2D(cloudMap, clamp(vUv*0.79+0.1+swirl,0.0,1.0)).g;
        float heat = clamp(cloud.r*0.72 + folds*0.53 - age*0.7, 0.0, 1.0);
        float scallop = smoothstep(0.14+age*0.17, 0.64, cloud.r+folds*0.25);
        alpha = cloud.a * scallop * vEffect.y;
        tint = mix(vec3(0.19,0.018,0.003), vec3(2.9,0.42,0.018), smoothstep(0.12,0.65,heat));
        tint = mix(tint, vec3(7.5,3.8,0.65), smoothstep(0.65,0.98,heat));
      }
      if (alpha < 0.008) discard;
      gl_FragColor = vec4(tint, alpha);
      ${output}
    }`;
  const shockFragment = `
    varying vec2 vUv;
    varying vec4 vEffect;
    void main() {
      vec2 p = vUv*2.0-1.0;
      float angle = atan(p.y,p.x);
      float radius = length(p) + sin(angle*9.0+vEffect.w)*0.006;
      float edge = exp(-pow((radius-0.88)*86.0,2.0));
      float wake = exp(-pow((radius-0.82)*19.0,2.0))*0.12;
      float broken = 0.67+0.33*sin(angle*5.0+vEffect.w);
      float alpha = (edge+wake)*broken*vEffect.y;
      if (alpha < 0.005) discard;
      gl_FragColor = vec4(mix(vec3(2.8,1.9,0.8),vec3(0.75,0.8,0.82),vEffect.x),alpha);
      ${output}
    }`;
  const smokeFragment = `
    uniform sampler2D cloudMap;
    varying vec2 vUv;
    varying vec4 vEffect;
    void main() {
      vec4 cloud = texture2D(cloudMap,vUv);
      float alpha = cloud.a * (0.36+cloud.r*0.64) * vEffect.y;
      if (alpha < 0.005) discard;
      // Linear-space charcoal and warm powdered concrete; smoke stays translucent.
      vec3 dark = mix(vec3(0.035,0.028,0.023), vec3(0.12,0.10,0.085),cloud.r);
      vec3 grit = mix(vec3(0.20,0.16,0.11), vec3(0.37,0.30,0.22),cloud.r);
      gl_FragColor = vec4(mix(dark,grit,vEffect.z),alpha);
      ${output}
    }`;
  const sparkFragment = `
    varying vec2 vUv;
    varying vec4 vEffect;
    void main() {
      vec2 p = abs(vUv*2.0-1.0);
      float tip = 1.0-smoothstep(0.62,1.0,p.x);
      float alpha = (1.0-smoothstep(0.12,1.0,p.y))*tip*vEffect.y;
      if (alpha < 0.008) discard;
      vec3 hot = mix(vec3(5.0,2.6,0.65), vec3(1.4,0.16,0.015),vEffect.x);
      vec3 grit = mix(vec3(0.48,0.38,0.24), vec3(0.11,0.085,0.06),vEffect.x);
      gl_FragColor = vec4(mix(hot,grit,vEffect.z),alpha);
      ${output}
    }`;

  function cloudTexture() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(128, 128);
    const hash = (x, y) => { const n = Math.sin(x*127.1+y*311.7+17.3)*43758.5453; return n-Math.floor(n); };
    function noise(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y), fx = x-ix, fy = y-iy;
      const u = fx*fx*(3-2*fx), v = fy*fy*(3-2*fy);
      return (hash(ix,iy)*(1-u)+hash(ix+1,iy)*u)*(1-v)+(hash(ix,iy+1)*(1-u)+hash(ix+1,iy+1)*u)*v;
    }
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const nx = (x-63.5)/63.5, ny = (y-63.5)/63.5;
      const broad = noise(x/19,y/19)*0.63+noise(x/8,y/8)*0.25+noise(x/3.4,y/3.4)*0.12;
      const fine = noise(x/7+17,y/7+31)*0.65+noise(x/2.7,y/2.7)*0.35;
      const angle = Math.atan2(ny,nx), radius = Math.hypot(nx,ny);
      const edge = 0.75 + Math.sin(angle*5+0.4)*0.075 + Math.sin(angle*9+1.6)*0.045 + (broad-.5)*.2;
      const mask = clamp((edge-radius)*8,0,1);
      const index = (y*128+x)*4;
      image.data[index] = Math.round(broad*255); image.data[index+1] = Math.round(fine*255);
      image.data[index+2] = 255; image.data[index+3] = Math.round(mask*mask*(3-2*mask)*255);
    }
    ctx.putImageData(image,0,0);
    const texture = new T.CanvasTexture(canvas);
    // The RGB channels encode scalar noise, never display colours.
    texture.colorSpace = T.NoColorSpace; texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter = T.LinearFilter;
    texture.name = 'impact_cloud_noise_128';
    return texture;
  }

  function create(scene) {
    const group = new T.Group(); group.name = 'mobile_impact_fx'; scene.add(group);
    const texture = cloudTexture(), dummy = new T.Object3D();
    const axisZ = new T.Vector3(0,0,1), direction = new T.Vector3(), right = new T.Vector3(), up = new T.Vector3();
    const billboard = new T.Quaternion(), spin = new T.Quaternion(), cameraRight = new T.Vector3(), cameraUp = new T.Vector3();
    let serial = 0, quality = 'balanced';
    function layer(name, capacity, fragment, order, blending = T.NormalBlending) {
      const geometry = new T.PlaneGeometry(1,1);
      const effect = new T.InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(T.DynamicDrawUsage);
      geometry.setAttribute('aEffect',effect);
      const material = new T.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment,
        uniforms: { cloudMap: { value: texture } }, transparent: true, depthWrite: false, depthTest: true,
        blending, side: T.DoubleSide, forceSinglePass: true, toneMapped: true });
      const mesh = new T.InstancedMesh(geometry,material,capacity); mesh.name = 'impact_'+name;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.frustumCulled = false;
      mesh.count = 0; mesh.visible = false; mesh.renderOrder = order; group.add(mesh);
      const pool = Array.from({ length: capacity }, () => ({ active: false, age: 0, life: 1, delay: 0, order: 0,
        origin: new T.Vector3(), velocity: new T.Vector3(), quaternion: new T.Quaternion(),
        size: 1, stretch: 1, angle: 0, turn: 0, kind: 0, opacity: 1, seed: 0 }));
      return { name, capacity, limit: capacity, mesh, effect, pool };
    }
    const heat = layer('heat',48,heatFragment,9);
    const shock = layer('shock',8,shockFragment,10,T.AdditiveBlending);
    const smoke = layer('smoke',16,smokeFragment,8);
    const sparks = layer('sparks',160,sparkFragment,11);
    const batches = [heat,shock,smoke,sparks];
    function acquire(batch, point, life, delay = 0) {
      let particle = null;
      for (let i = 0; i < batch.limit; i++) {
        const candidate = batch.pool[i];
        if (!candidate.active) { particle = candidate; break; }
        if (!particle || candidate.order < particle.order) particle = candidate;
      }
      particle.active = true; particle.age = 0; particle.life = life; particle.delay = delay; particle.order = ++serial;
      particle.origin.copy(point); particle.velocity.set(0,0,0); particle.quaternion.identity();
      particle.size = 1; particle.stretch = 1; particle.angle = 0; particle.turn = 0; particle.kind = 0;
      particle.opacity = 1; particle.seed = serial*2.399963;
      return particle;
    }
    function finite(v) { return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z); }
    function burst(point, incoming, weapon = 'rocket', scale = 1) {
      if (!finite(point) || !finite(incoming)) return;
      direction.copy(incoming);
      if (direction.lengthSq() < .00001) direction.set(0,0,-1); else direction.normalize();
      right.set(0,1,0);
      if (Math.abs(direction.y) > .95) right.set(1,0,0);
      right.cross(direction).normalize(); up.crossVectors(direction,right).normalize();
      const size = clamp(Number.isFinite(scale) ? scale : 1,.15,2.5);
      const meteor = weapon === 'meteor', ball = weapon === 'ball';
      const power = size*(meteor ? 1.75 : ball ? .65 : 1);
      const countScale = quality === 'low' ? .65 : quality === 'high' ? 1.15 : 1;
      if (!ball) {
        const core = acquire(heat,point,.05);
        core.origin.addScaledVector(direction,-.45); core.size = 2.8*power; core.kind = 0;
        // Uneven lobes form a short cone, with a rear-facing wash outside the
        // facade. A generic expanding orange sphere would hide the impact point.
        const lobes = Math.round((meteor ? 9 : 6)*countScale);
        for (let i = 0; i < lobes; i++) {
          const p = acquire(heat,point,.43+(i%4)*.05);
          const angle = i*2.399963+serial*.17, lateral = (.2+(i%3)*.27)*power;
          p.origin.addScaledVector(direction,-.35-(i%3)*.22*power)
            .addScaledVector(right,Math.cos(angle)*lateral).addScaledVector(up,Math.sin(angle)*lateral);
          p.velocity.copy(direction).multiplyScalar((i%3 === 0 ? 5 : -3)*power)
            .addScaledVector(right,Math.cos(angle)*3.8*power).addScaledVector(up,Math.sin(angle)*3.8*power);
          p.velocity.y += 1.6*power; p.size = (1.6+(i%3)*.3)*power;
          p.angle = angle; p.turn = (i%2 ? 1 : -1)*.8; p.kind = 1; p.opacity = .92;
        }
        const ring = acquire(shock,point,.4);
        ring.origin.addScaledVector(direction,-.5); ring.size = power;
        ring.quaternion.setFromUnitVectors(axisZ,direction);
      }
      const smokeCount = quality === 'low' ? (ball ? 1 : 2) : ball ? 2 : meteor ? 4 : 3;
      for (let i = 0; i < smokeCount; i++) {
        const p = acquire(smoke,point,ball ? .65 : 1.15+i*.12,ball ? .04 : .14+i*.025);
        const angle = i*2.399963+serial*.23;
        p.origin.addScaledVector(direction,-.65).addScaledVector(right,Math.cos(angle)*power*.55);
        p.velocity.copy(direction).multiplyScalar(-.45*power).addScaledVector(right,Math.cos(angle)*.8*power);
        p.velocity.y = ball ? .5 : 1.4+(i%2)*.5;
        p.size = (ball ? .85 : 1.8)*power; p.opacity = ball ? .19 : .22;
        p.angle = angle; p.turn = (i%2 ? -.22 : .2); p.kind = ball ? 1 : 0;
      }
      const sparkCount = Math.round((ball ? 18 : meteor ? 34 : 26)*countScale);
      for (let i = 0; i < sparkCount; i++) {
        const p = acquire(sparks,point,.32+(i%7)*.095);
        const angle = i*2.399963+serial*.11, speed = (6+(i%7)*2.1)*power;
        // Most energy continues down the shot line; every fourth shard sprays
        // back from the entry surface to remain visible outside the building.
        const sign = i%4 === 0 ? -1 : 1;
        p.velocity.copy(direction).multiplyScalar(speed*sign)
          .addScaledVector(right,Math.cos(angle)*speed*.47).addScaledVector(up,Math.sin(angle)*speed*.47);
        p.velocity.y += 1.4*power;
        p.origin.addScaledVector(direction,sign*.3);
        p.size = (.025+(i%3)*.012)*Math.sqrt(power); p.stretch = .25+(i%5)*.09;
        p.kind = ball && i%3 !== 0 ? 1 : 0; p.opacity = 1;
      }
    }
    function step(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      for (const batch of batches) for (let i = 0; i < batch.limit; i++) {
        const p = batch.pool[i]; if (!p.active) continue;
        p.age += dt; if (p.age >= p.delay+p.life) p.active = false;
      }
    }
    function render(camera) {
      camera.getWorldQuaternion(billboard);
      cameraRight.set(1,0,0).applyQuaternion(billboard); cameraUp.set(0,1,0).applyQuaternion(billboard);
      for (const batch of batches) {
        let count = 0;
        for (let i = 0; i < batch.limit; i++) {
          const p = batch.pool[i]; if (!p.active || p.age < p.delay) continue;
          const age = p.age-p.delay, t = clamp(age/p.life,0,1);
          let opacity = p.opacity;
          dummy.position.copy(p.origin); dummy.quaternion.copy(billboard);
          if (batch === heat) {
            dummy.position.addScaledVector(p.velocity,.22*(1-Math.exp(-age/.22)));
            const expansion = p.kind === 0 ? .8+t*.5 : .52+1.05*(1-Math.exp(-age*9));
            dummy.scale.set(p.size*expansion,p.size*expansion*(p.kind ? 1.12 : 1),1);
            opacity *= p.kind === 0 ? Math.pow(1-t,.7) : Math.min(1,(1-t)*3.2);
          } else if (batch === shock) {
            dummy.quaternion.copy(p.quaternion);
            dummy.scale.setScalar((.4+15.5*(1-Math.exp(-age*5.5)))*p.size);
            opacity *= Math.pow(1-t,1.8)*.75;
          } else if (batch === smoke) {
            dummy.position.addScaledVector(p.velocity,age);
            dummy.scale.set(p.size*(.8+t*1.7),p.size*(.95+t*1.7),1);
            opacity *= Math.min(1,age/.12)*Math.pow(1-t,1.25);
          } else {
            const travel = (1-Math.exp(-age*1.2))/1.2;
            dummy.position.addScaledVector(p.velocity,travel); dummy.position.y -= age*age*4.2;
            const vx = p.velocity.dot(cameraRight)*Math.exp(-age*1.2)-8.4*age*cameraRight.y;
            const vy = p.velocity.dot(cameraUp)*Math.exp(-age*1.2)-8.4*age*cameraUp.y;
            p.angle = Math.atan2(vy,vx);
            const streak = p.kind ? p.size*2.4 : Math.max(p.size*3,Math.hypot(vx,vy)*.018+p.stretch*(1-t));
            dummy.scale.set(streak,p.size,1); opacity *= Math.min(1,(1-t)*4);
          }
          if (batch !== shock) {
            spin.setFromAxisAngle(axisZ,p.angle+p.turn*age); dummy.quaternion.multiply(spin);
          }
          dummy.updateMatrix(); batch.mesh.setMatrixAt(count,dummy.matrix);
          batch.effect.setXYZW(count,t,opacity,p.kind,p.seed);
          count++;
        }
        batch.mesh.count = count; batch.mesh.visible = count > 0;
        if (count) { batch.mesh.instanceMatrix.needsUpdate = true; batch.effect.needsUpdate = true; }
      }
    }
    function reset() {
      for (const batch of batches) {
        for (const p of batch.pool) p.active = false;
        batch.mesh.count = 0; batch.mesh.visible = false;
      }
      serial = 0;
    }
    function setQuality(profile) {
      quality = typeof profile === 'string' ? profile : profile?.fragments <= 100 ? 'low' : profile?.fragments >= 300 ? 'high' : 'balanced';
      const limits = quality === 'low' ? [16,3,6,56] : quality === 'high' ? [48,8,16,160] : [32,6,10,100];
      for (let j = 0; j < batches.length; j++) {
        const batch = batches[j]; batch.limit = limits[j];
        for (let i = batch.limit; i < batch.capacity; i++) batch.pool[i].active = false;
        // Trim the already submitted draw immediately; render() repacks survivors.
        batch.mesh.count = Math.min(batch.mesh.count,batch.limit);
      }
    }
    function stats() {
      const layers = { flash: 0, fire: 0, shock: 0, smoke: 0, sparks: 0 };
      let active = 0, pending = 0, capacity = 0;
      for (const batch of batches) {
        capacity += batch.limit;
        for (let i = 0; i < batch.limit; i++) {
          const p = batch.pool[i]; if (!p.active) continue;
          active++;
          if (p.age < p.delay) { pending++; continue; }
          layers[batch === heat ? (p.kind ? 'fire' : 'flash') : batch.name]++;
        }
      }
      return { active, pending, layers, capacity, allocated: 232, maxDrawCalls: 4, textureSize: 128, quality };
    }
    setQuality('balanced');
    return { burst, step, render, reset, setQuality, stats };
  }
  window.SkyfallImpactFX = Object.freeze({ create });
})();
