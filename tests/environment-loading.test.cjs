'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: nextTurn } = require('node:timers/promises');

// Real Three.js objects and environment code; only browser image delivery,
// elapsed time and the GPU PMREM operation are controlled at their boundaries.
function boot({ photoFails = false, loaderThrows = false, realPhotoPMREM = false } = {}) {
  const root = path.resolve(__dirname, '../dist');
  const requests = new Map(), timers = new Map(), targets = [], generators = [];
  let now = 0, nextTimer = 0;
  const context = vm.createContext({ console,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    document: { createElement: () => ({ width: 0, height: 0,
      getContext: () => ({ createLinearGradient: () => ({ addColorStop() {} }), fillRect() {} }),
    }) },
  });
  context.window = context; context.self = context;
  vm.runInContext(fs.readFileSync(path.join(root, 'three-local.js'), 'utf8'), context);
  const T = context.THREE;
  function track(resource) {
    resource.disposeCount = 0;
    resource.addEventListener('dispose', () => resource.disposeCount++);
    return resource;
  }
  const CubeTarget = T.WebGLCubeRenderTarget;
  T.WebGLCubeRenderTarget = class extends CubeTarget {
    constructor(...args) { super(...args); track(this); targets.push(this); }
  };
  T.TextureLoader = class {
    load(url, onLoad, onProgress, onError) {
      if (loaderThrows) throw new Error('image loader unavailable');
      const texture = track(new T.Texture({ width: url.includes('city-light') ? 1024 : 512, height: 512 }));
      requests.set(url, { texture, onLoad, onError });
      return texture;
    }
  };
  const ActualPMREM = T.PMREMGenerator;
  T.PMREMGenerator = class {
    constructor(renderer) { this.renderer = renderer; this.disposed = false; generators.push(this); }
    fromEquirectangular(texture, target) {
      if (!texture.isCanvasTexture && realPhotoPMREM) {
        this.actual = new ActualPMREM(this.renderer);
        return this.actual.fromEquirectangular(texture, target);
      }
      const output = target || new T.WebGLCubeRenderTarget(256);
      if (!texture.isCanvasTexture && photoFails) throw new Error('photo PMREM GPU failure');
      return output;
    }
    dispose() { this.disposed = true; this.actual?.dispose(); }
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'environment.js'), 'utf8'), context);
  const scene = new T.Scene();
  const renderer = { capabilities: { getMaxAnisotropy: () => 4 }, coordinateSystem: T.WebGLCoordinateSystem,
    xr: { enabled: true }, target: null, face: 0, mip: 0, draws: 0,
    getRenderTarget() { return this.target; }, getActiveCubeFace() { return this.face; }, getActiveMipmapLevel() { return this.mip; },
    setRenderTarget(target, face = 0, mip = 0) { this.target = target; this.face = face; this.mip = mip; },
    render() { this.draws++; throw new Error('GPU draw failed'); },
  };
  const environment = context.SkyfallEnvironment.create(scene, renderer);
  let outcome = { status: 'pending' };
  environment.ready.then(value => { outcome = { status: 'fulfilled', value: Array.from(value) }; },
    error => { outcome = { status: 'rejected', error }; });
  const exceptions = [];
  return { scene, renderer, environment, targets, generators, timers, exceptions,
    originalTarget: environment.environmentTarget,
    outcome: () => outcome,
    deliver(name, success = true) {
      const request = requests.get('assets/' + name);
      assert.ok(request, 'fixture has the requested optional image');
      try { success ? request.onLoad(request.texture) : request.onError(new Error('network unavailable')); }
      catch (error) { exceptions.push(error); }
      return request.texture;
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); }
    },
    flush: nextTurn,
  };
}

// Missing callback exception handling must fail by leaving readiness pending;
// missing transactional cleanup must fail the real target disposal assertions.
test('photographic PMREM failure settles readiness and preserves procedural reflections', async () => {
  const h = boot({ photoFails: true });
  h.deliver('env-asphalt.jpg'); h.deliver('env-concrete.jpg');
  const photo = h.deliver('env-city-light.jpg');
  await h.flush();
  assert.equal(h.outcome().status, 'fulfilled', 'optional GPU failure cannot orphan readiness');
  assert.deepEqual(h.outcome().value, [true, true, false]);
  assert.equal(h.exceptions.length, 0, 'image delivery must not leak exceptions');
  assert.equal(h.scene.environment, h.originalTarget.texture);
  assert.equal(h.originalTarget.disposeCount, 0, 'the usable fallback remains alive');
  assert.equal(photo.disposeCount, 1);
  assert.equal(h.targets.length, 2);
  assert.equal(h.targets[1].disposeCount, 1, 'partially generated reflection output is released');
  assert.ok(h.generators.every(generator => generator.disposed), 'temporary GPU generators are released');
  assert.equal(h.timers.size, 0);
  h.environment.dispose();
});

// Actual PMREM/CubeCamera can throw after rebinding the renderer. Retaining the
// reflection object alone must not leave subsequent game draws offscreen.
test('PMREM draw failure restores the renderer target, cube face, mip and XR state', async () => {
  const h = boot({ realPhotoPMREM: true });
  const screenTarget = h.originalTarget;
  h.renderer.setRenderTarget(screenTarget, 3, 2);
  h.deliver('env-asphalt.jpg'); h.deliver('env-concrete.jpg'); h.deliver('env-city-light.jpg');
  await h.flush();
  assert.equal(h.renderer.draws, 1, 'failure happened inside the real PMREM draw path');
  assert.equal(h.renderer.getRenderTarget(), screenTarget);
  assert.equal(h.renderer.getActiveCubeFace(), 3);
  assert.equal(h.renderer.getActiveMipmapLevel(), 2);
  assert.equal(h.renderer.xr.enabled, true);
  assert.equal(h.scene.environment, h.originalTarget.texture);
  assert.deepEqual(h.outcome().value, [true, true, false]);
  assert.ok(h.generators.every(generator => generator.disposed));
  h.environment.dispose();
});

// Removing the deadline or accepting a post-timeout image must break this test.
test('stalled optional images time out and late arrivals cannot replace the fallback', async () => {
  const h = boot();
  h.advance(12000); await h.flush();
  assert.equal(h.outcome().status, 'fulfilled', 'image delivery has a finite deadline');
  assert.deepEqual(h.outcome().value, [false, false, false]);
  const asphalt = h.deliver('env-asphalt.jpg');
  const photo = h.deliver('env-city-light.jpg');
  assert.equal(asphalt.disposeCount, 1); assert.equal(photo.disposeCount, 1);
  assert.equal(h.environment.ground.material.map, null);
  assert.equal(h.scene.environment, h.originalTarget.texture);
  assert.equal(h.targets.length, 1, 'late photos do not allocate GPU reflection work');
  h.environment.dispose();
});

// Disposal must release pending waiters immediately, not only on a later event.
test('disposing during image loading settles readiness and discards subsequent arrivals', async () => {
  const h = boot();
  h.environment.dispose(); await h.flush();
  assert.equal(h.outcome().status, 'fulfilled');
  assert.deepEqual(h.outcome().value, [false, false, false]);
  assert.equal(h.timers.size, 0);
  for (const name of ['env-asphalt.jpg', 'env-concrete.jpg', 'env-city-light.jpg'])
    assert.equal(h.deliver(name).disposeCount, 1);
  assert.equal(h.originalTarget.disposeCount, 1);
  assert.equal(h.targets.length, 1);
  assert.equal(h.environment.group.parent, null);
});

test('successful optional images replace reflections and release owned resources on disposal', async () => {
  const h = boot();
  const asphalt = h.deliver('env-asphalt.jpg');
  const concrete = h.deliver('env-concrete.jpg');
  const photo = h.deliver('env-city-light.jpg');
  await h.flush();
  assert.equal(h.outcome().status, 'fulfilled');
  assert.deepEqual(h.outcome().value, [true, true, true]);
  assert.equal(h.environment.ground.material.map, asphalt);
  assert.equal(h.environment.ground.material.bumpMap, asphalt);
  assert.notEqual(h.scene.environment, h.originalTarget.texture);
  assert.equal(h.scene.environment, h.environment.environmentTarget.texture);
  assert.equal(h.originalTarget.disposeCount, 1);
  assert.equal(h.timers.size, 0);
  const current = h.environment.environmentTarget;
  h.environment.dispose(); h.environment.dispose();
  assert.equal(current.disposeCount, 1);
  for (const texture of [asphalt, concrete, photo]) assert.equal(texture.disposeCount, 1);
});

test('synchronous image loader failure is an optional fallback rather than a rejected promise', async () => {
  const h = boot({ loaderThrows: true });
  await h.flush();
  assert.equal(h.outcome().status, 'fulfilled');
  assert.deepEqual(h.outcome().value, [false, false, false]);
  assert.equal(h.scene.environment, h.originalTarget.texture);
  assert.equal(h.timers.size, 0);
  h.environment.dispose();
});
