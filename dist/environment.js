/* Authored mobile streetscape. Existing CC0 source textures are packaged locally. */
(function () {
  'use strict';
  const T = window.THREE;
  function create(scene, renderer) {
    const group = new T.Group(); group.name = 'mobile_environment_v2'; scene.add(group);
    const geometries = new Set(), materials = new Set(), textures = new Set();
    const tasks = [], pendingTextures = new Set(), temp = new T.Object3D(); let environmentTarget = null, disposed = false, anisotropyBudget = 4;
    const geometry = g => { geometries.add(g); return g; };
    const material = m => { materials.add(m); return m; };
    const box = geometry(new T.BoxGeometry(1, 1, 1));
    const plane = geometry(new T.PlaneGeometry(1, 1));
    const stone = material(new T.MeshStandardMaterial({ color: 0xb8b0a1, roughness: .92 }));
    const asphalt = material(new T.MeshStandardMaterial({ color: 0xb8babb, roughness: .96, bumpScale: .025 }));
    const paving = material(new T.MeshStandardMaterial({ color: 0xd3d1c8, roughness: .94, bumpScale: .008 }));
    const seams = material(new T.MeshStandardMaterial({ color: 0x77756d, roughness: 1 }));
    const paint = material(new T.MeshStandardMaterial({ color: 0xd7ceae, roughness: .9 }));
    const concrete = material(new T.MeshStandardMaterial({ color: 0xeeeae0, roughness: .83 }));
    const darkTrim = material(new T.MeshStandardMaterial({ color: 0x3e4442, roughness: .65, metalness: .25 }));
    const windows = material(new T.MeshStandardMaterial({ color: 0x8b9697, metalness: .28, roughness: .35, envMapIntensity: .65 }));
    function batch(name, list, mat, sourceGeometry = box) {
      const mesh = new T.InstancedMesh(sourceGeometry, mat, list.length); mesh.name = name;
      list.forEach((p, i) => {
        temp.position.set(p.x || 0, p.y || 0, p.z || 0); temp.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
        temp.scale.set(p.w || 1, p.h || 1, p.d || 1); temp.updateMatrix(); mesh.setMatrixAt(i, temp.matrix);
        if (p.color != null) mesh.setColorAt(i, new T.Color(p.color));
      });
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.receiveShadow = true; mesh.castShadow = false; group.add(mesh); return mesh;
    }
    function loadTexture(url, repeats, onLoad) {
      const task = new Promise(resolve => {
        let settled = false;
        const finish = success => {
          if (settled) return;
          settled = true; clearTimeout(timer); pendingTextures.delete(cancel); resolve(success);
        };
        const cancel = () => finish(false);
        const timer = setTimeout(cancel, 12000);
        pendingTextures.add(cancel);
        try {
          const loader = new T.TextureLoader();
          loader.load(url, tex => {
            if (settled || disposed) { tex.dispose(); return; }
            let success = false;
            try {
              tex.colorSpace = T.SRGBColorSpace; tex.wrapS = tex.wrapT = T.RepeatWrapping;
              tex.repeat.set(repeats[0], repeats[1]); tex.anisotropy = Math.min(anisotropyBudget, renderer.capabilities?.getMaxAnisotropy?.() || 1);
              onLoad(tex); textures.add(tex); success = true;
            } catch {
              tex.dispose();
            } finally {
              finish(success);
            }
          }, undefined, cancel);
        } catch {
          cancel();
        }
      });
      tasks.push(task); return task;
    }
    const ground = new T.Mesh(plane, asphalt); ground.name = 'street_asphalt';
    // The inherited static GLB includes an asphalt plane at -.08. This surface
    // intentionally covers it while remaining below the authored .11 plinth.
    ground.rotation.x = -Math.PI / 2; ground.scale.set(1000, 1000, 1); ground.position.y = .02; ground.receiveShadow = true; group.add(ground);
    loadTexture('assets/env-asphalt.jpg', [250, 250], tex => { asphalt.map = tex; asphalt.bumpMap = tex; asphalt.needsUpdate = true; });
    const plaza = new T.Mesh(plane, paving); plaza.name = 'test_site_paving';
    plaza.rotation.x = -Math.PI / 2; plaza.scale.set(35.6, 27.6, 1); plaza.position.y = .04; plaza.receiveShadow = true; group.add(plaza);
    loadTexture('assets/env-concrete.jpg', [12, 9], tex => { paving.map = tex; paving.bumpMap = tex; paving.needsUpdate = true; });

    const curbs = [], joints = [], marks = [], barriers = [], trims = [], bodies = [], glazing = [];
    // The near pavement has thin real joints; the existing raised building plinth remains exposed.
    for (let x = -18; x <= 18; x += 2) joints.push({ x, y: .046, z: 0, w: .018, h: .006, d: 28 });
    for (let z = -14; z <= 14; z += 2) joints.push({ x: 0, y: .046, z, w: 36, h: .006, d: .018 });
    for (let x = -18; x < 18; x += 1.5) for (const z of [-14.1,14.1]) curbs.push({ x: x + .75, y: .13, z, w: 1.47, h: .25, d: .22 });
    for (let z = -14; z < 14; z += 1.5) for (const x of [-18.1,18.1]) curbs.push({ x, y: .13, z: z + .75, w: .22, h: .25, d: 1.47 });
    // Road lines remain sparse and purposeful instead of a screen-wide grid.
    for (let k = -65; k <= 65; k += 7) {
      marks.push({ x: k, y: .033, z: 23, w: 3.6, h: .012, d: .11 });
      marks.push({ x: k, y: .033, z: -23, w: 3.6, h: .012, d: .11 });
      marks.push({ x: 27, y: .033, z: k, w: .11, h: .012, d: 3.6 });
      marks.push({ x: -27, y: .033, z: k, w: .11, h: .012, d: 3.6 });
    }
    for (let i = 0; i < 9; i++) for (const z of [-18.6,18.6]) marks.push({ x: -5.6 + i * 1.4, y: .035, z, w: .75, h: .016, d: 4.3, color: 0xe4dfd2 });
    for (const sign of [-1,1]) for (let i = 0; i < 7; i++) {
      const x = sign * (35 + i * 3.3);
      marks.push({ x, y: .034, z: 10, w: .09, h: .014, d: 5.2, color: 0xd7d5c9 });
      marks.push({ x, y: .034, z: -10, w: .09, h: .014, d: 5.2, color: 0xd7d5c9 });
    }
    for (let i = 0; i < 8; i++) for (const sign of [-1,1]) {
      const x = -12.3 + i * 3.5, z = sign * 15.8;
      barriers.push({ x, y: .27, z, w: 2.25, h: .72, d: .44 });
      for (const side of [-1,1]) trims.push({ x: x + side * .65, y: .36, z: z + sign * .23, w: .18, h: .22, d: .016, color: 0xd78c32 });
    }

    // Real windows and roof ledges give the nearby skyline the same visual vocabulary as PC.
    const blocks = [
      [-50,-47,19,32,15], [-15,-65,21,41,17], [27,-58,17,29,18], [60,-29,18,36,16],
      [58,28,20,28,15], [15,70,23,38,18], [-30,65,19,29,16], [-65,18,18,42,17],
      [-100,-55,20,46,22], [76,-94,25,54,20], [113,43,23,47,21], [-70,112,26,53,23],
    ];
    blocks.forEach((b, index) => {
      const [sx,sz,sw,sh,sd] = b;
      // All tower surfaces stay beyond the furthest portrait orbit camera.
      const radius = index < 8 ? 185 + index % 3 * 9 : 260;
      const bearing = Math.atan2(sx, sz), x = Math.sin(bearing) * radius, z = Math.cos(bearing) * radius;
      const w = sw * 1.7, h = sh * 1.9, d = sd * 1.7;
      bodies.push({ x, y: h / 2 -.16, z, w, h, d, color: index % 3 === 0 ? 0xc4c9c6 : index % 3 === 1 ? 0xd5cdbb : 0xced2d0 });
      // Raised foundation, roof parapet and rooftop services use the same shared batch.
      bodies.push({ x, y: .5, z, w: w + .7, h: 1.3, d: d + .7, color: 0x85867e });
      bodies.push({ x: x - w * .12, y: h + 1.2, z, w: w * .35, h: 2.4, d: d * .3, color: 0x777b77 });
      trims.push({ x, y: h + .15, z: z - d / 2, w: w + .2, h: .3, d: .23 });
      trims.push({ x, y: h + .15, z: z + d / 2, w: w + .2, h: .3, d: .23 });
      trims.push({ x: x - w / 2, y: h + .15, z, w: .23, h: .3, d });
      trims.push({ x: x + w / 2, y: h + .15, z, w: .23, h: .3, d });
      const floorStep = 6.4, windowHeight = 3.8;
      const floors = Math.floor((h - 2) / floorStep), colsX = Math.floor(w / 6.2), colsZ = Math.floor(d / 6.2);
      for (let f = 0; f < floors; f++) {
        const y = 4.8 + f * floorStep;
        // Detailed nearest eight blocks; far four use broad bands to avoid subpixel window shimmer.
        if (index >= 8) {
          for (const s of [-1,1]) {
            glazing.push({ x, y, z: z + s * (d / 2 + .012), w: w - 1.5, h: 2.8, d: .025 });
            glazing.push({ x: x + s * (w / 2 + .012), y, z, w: .025, h: 2.8, d: d - 1.5 });
          }
        } else {
          for (let c = 0; c < colsX; c++) for (const s of [-1,1]) glazing.push({ x: x - w / 2 + (c + .5) * w / colsX, y, z: z + s * (d / 2 + .015), w: w / colsX - .85, h: windowHeight, d: .03, color: (c + f + index) % 7 === 0 ? 0xc0b79e : 0xb2c2c6 });
          for (let c = 0; c < colsZ; c++) for (const s of [-1,1]) glazing.push({ x: x + s * (w / 2 + .015), y, z: z - d / 2 + (c + .5) * d / colsZ, w: .03, h: windowHeight, d: d / colsZ - .85, color: (c + f) % 8 === 0 ? 0xc7bda3 : 0xb2c2c6 });
        }
      }
    });
    batch('city_building_mass', bodies, concrete);
    batch('city_glazing', glazing, windows);
    batch('roof_edges_and_safety_markers', trims, darkTrim);
    batch('pavement_curbs', curbs, stone);
    batch('pavement_joints', joints, seams);
    batch('road_markings', marks, paint);
    const barrierMesh = batch('safety_barriers', barriers, stone); barrierMesh.castShadow = true;

    // Warm neutral skylight. The photographic environment is only used in reflections;
    // it does not paste an unrelated real street behind the authored scene.
    const skyCanvas = document.createElement('canvas'); skyCanvas.width = 512; skyCanvas.height = 256;
    const ctx = skyCanvas.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#7797ae'); gradient.addColorStop(.45, '#c8cfcf'); gradient.addColorStop(.54, '#bcb4a2'); gradient.addColorStop(1, '#5d5d56');
    ctx.fillStyle = gradient; ctx.fillRect(0,0,512,256);
    const skyTexture = new T.CanvasTexture(skyCanvas); skyTexture.mapping = T.EquirectangularReflectionMapping; skyTexture.colorSpace = T.SRGBColorSpace;
    const generator = new T.PMREMGenerator(renderer); environmentTarget = generator.fromEquirectangular(skyTexture); generator.dispose(); skyTexture.dispose();
    scene.environment = environmentTarget.texture;
    scene.background = new T.Color(0xb9c5cb);
    loadTexture('assets/env-city-light.jpg', [1,1], tex => {
      tex.mapping = T.EquirectangularReflectionMapping;
      // Own the output before GPU work starts so a failed conversion cannot
      // leak a target allocated inside Three.js. Match the bundled r187 PMREM.
      const size = Math.max(256, T.MathUtils.floorPowerOfTwo(tex.image.width / 4));
      let next = new T.WebGLCubeRenderTarget(size, { minFilter: T.LinearMipmapLinearFilter,
        generateMipmaps: false, type: T.HalfFloatType, colorSpace: T.LinearSRGBColorSpace, depthBuffer: false });
      for (let level = size; level >= 8; level /= 2) next.texture.mipmaps.push({ width: level, height: level });
      next.texture.name = 'PMREM'; next.texture.isPMREMTexture = true;
      try {
        const pmrem = new T.PMREMGenerator(renderer);
        const target = renderer.getRenderTarget?.(), face = renderer.getActiveCubeFace?.(), mip = renderer.getActiveMipmapLevel?.();
        const xrEnabled = renderer.xr?.enabled;
        try { pmrem.fromEquirectangular(tex, next); } finally {
          // CubeCamera restores these only on its normal return path.
          try {
            renderer.setRenderTarget?.(target, face, mip);
          } finally {
            if (renderer.xr) renderer.xr.enabled = xrEnabled;
            pmrem.dispose();
          }
        }
        const previous = environmentTarget;
        scene.environment = next.texture; environmentTarget = next; next = null;
        previous.dispose();
      } finally {
        next?.dispose();
      }
    });
    function setQuality(profile) {
      const level = profile?.shadows ? 4 : 2;
      anisotropyBudget = level;
      for (const tex of textures) tex.anisotropy = Math.min(level, renderer.capabilities?.getMaxAnisotropy?.() || 1);
      barrierMesh.castShadow = !!profile?.shadows;
    }
    function dispose() {
      if (disposed) return; disposed = true; group.removeFromParent();
      for (const cancel of pendingTextures) cancel();
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); environmentTarget?.dispose();
    }
    let triangles = 0, drawCalls = 0;
    group.traverse(n => { if (n.isMesh) { drawCalls++; triangles += ((n.geometry.index?.count || n.geometry.attributes.position.count) / 3) * (n.isInstancedMesh ? n.count : 1); } });
    return { group, ground, ready: Promise.all(tasks), setQuality, dispose, get environmentTarget() { return environmentTarget; }, stats: {drawCalls,triangles},
      recommendedLighting: { exposure: .95, hemisphereIntensity: 1.0, sunIntensity: 3.0, sunColor: 0xffe5c3, fogColor: 0xb9c5cb, fogNear: 150, fogFar: 360 } };
  }
  window.SkyfallEnvironment = Object.freeze({ create });
})();
