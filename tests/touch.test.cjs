const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise app.js itself: synthetic browser events, no duplicate gesture implementation.
const source = fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');

async function boot(options = {}) {
  const raf = new Map(), timers = new Map(), elements = new Map();
  const storage = options.storage || new Map();
  let nextRaf = 0, nextTimer = 0, engine;
  class EventTarget {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }
    dispatch(type, data = {}) {
      const event = { type, target: this, button: 0, pointerId: 1, clientX: 0, clientY: 0,
        defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...data };
      for (const callback of this.listeners.get(type) || []) callback(event);
      this['on' + type]?.(event);
      return event;
    }
  }
  const document = new EventTarget();
  class Element extends EventTarget {
    constructor(id) {
      super(); this.id = id; this.tagName = 'BUTTON'; this.hidden = false; this.disabled = false;
      this.style = {}; this.dataset = {}; this.attributes = {}; this.textContent = ''; this.innerHTML = '';
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    setPointerCapture(id) { this.captured = id; }
    focus() { document.activeElement = this; }
    click() { if (!this.disabled) this.dispatch('click'); }
    querySelectorAll() {
      const section = html.match(new RegExp('<section id="' + this.id + '"[\\s\\S]*?</section>'))?.[0] || '';
      return [...section.matchAll(/<button[^>]*id="([^"]+)"/g)].map(match => get(match[1]));
    }
  }
  function get(id) {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  }
  document.getElementById = get;
  const weapons = ['rocket', 'meteor', 'ball'].map(name => { const element = get(name); element.dataset.weapon = name; return element; });
  document.querySelectorAll = selector => selector === '[data-weapon]' ? weapons : [];
  document.activeElement = { tagName: 'BODY', focus() {} };
  document.hidden = false; document.documentElement = {};
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) get(match[1]).hidden = /\bhidden\b/.test(match[0]);
  get('world').tagName = 'CANVAS'; get('height').tagName = get('angle').tagName = 'INPUT';
  class SkyfallEngine {
    constructor(canvas, onEvent) {
      engine = this; this.canvas = canvas; this.onEvent = onEvent; this.loaded = false;
      this.state = 'ready'; this.score = 0; this.damage = 0; this.shots = 0; this.ammoBonus = 0; this.maxShots = 4; this.remainingAmmo = 4;
      this.orbit = { yaw: .7, pitch: .4, distance: 65, height: 10 };
      this.aim = { height: 7, angle: 0 }; this.aimValid = true; this.aimFeedback = 'valid'; this.validityReads = 0; this.validityOptions = []; this.autoAim = false; this.profile = { targetFps: 60 };
      this.picks = []; this.fires = []; this.steps = []; this.renders = 0; this.resizes = 0;
      this.resets = 0; this.recoveries = 0; this.qualityChanges = []; this.limits = { min: 1, max: options.buildingHeight || 24 }; this.metricReads = 0;
      this.supportGuideEnabled = false; this.supportInsight = options.supportInsight || null;
      this.collapse = { assessPart() { throw new Error('UI must only read cached supportInsight'); } };
    }
    async load(progress) { await options.duringLoad?.({ canvas: this.canvas, engine: this, progress }); this.loaded = true; }
    direction() {}
    recoverAim() { this.recoveries++; if (options.recoverStartsTween) this.aimTween = { elapsed: 0, duration: .2 }; }
    refreshAimValidity({ manual = false } = {}) { this.validityReads++; this.validityOptions.push({ manual }); if (typeof options.validAfterRefresh === 'boolean') this.aimValid = options.validAfterRefresh; return this.aimValid; }
    aimLimits() { assert.equal(this.loaded, true); return this.limits; }
    setQuality(value) { this.quality = value; this.qualityChanges.push(value); }
    pick(x, y) {
      this.picks.push([x, y]);
      if ((options.emptyPicks || []).includes(this.picks.length)) { this.aimValid = false; this.aimFeedback = 'empty'; this.onEvent('aimEmpty'); return false; }
      this.aimValid = true; const assisted = Boolean(options.assistedPick && this.autoAim);
      this.aimFeedback = assisted ? 'assisted' : 'valid'; this.onEvent('aimSelected', { assisted }); return true;
    }
    get canAim() { return this.loaded && this.state !== 'finished' && (this.freeMode || this.state === 'ready'); }
    fire(value) {
      if (!this.canAim || this.aimTween) return false;
      if (options.emptyAim || !this.aimValid) { this.onEvent('emptyAim'); return false; }
      this.fires.push(value); this.shots++; this.remainingAmmo--;
      this.state = 'flight'; this.onEvent('launch', {weapon: value}); return true;
    }
    shotFinished({ score, damage, shotDamage, limits, aim, volleyShots = 1 }) {
      this.state = 'ready'; this.score = score; this.damage = damage;
      if (limits) this.limits = limits;
      if (aim) this.aim = aim;
      this.onEvent('shotFinished', { score, damage, shotDamage, volleyShots, shots: this.shots, remainingAmmo: this.remainingAmmo, canContinue: true });
    }
    finish({ score, damage, cleared = false, ammoBonus = 0 }) {
      this.state = 'finished'; this.score = score; this.damage = damage; this.ammoBonus = ammoBonus;
      this.onEvent('finished', { score, damage, shots: this.shots, remainingAmmo: this.remainingAmmo, ammoBonus, cleared, canContinue: false });
    }
    reset() { this.resets++; this.state = 'ready'; this.score = 0; this.damage = 0; this.shots = 0; this.ammoBonus = 0; this.maxShots = this.freeMode ? Infinity : 4; this.remainingAmmo = this.maxShots; this.supportGuideEnabled = true; }
    resetCamera() {}
    resize() { this.resizes++; }
    step(dt) { this.steps.push(dt); options.duringStep?.(this, dt); }
    render() { this.renders++; }
    metrics() {
      this.metricReads++;
      return { fps: 0, drawCalls: this.renders, moving: 23, relevantMoving: 2, stillTime: .3, damageQuietTime: 1.5,
        shots: this.shots, shotHits: [17, 23], shotFractures: [{ id: 17, cause: 'direct' }, { id: 23, cause: 'support' }],
        support: options.supportDiagnostics || [{ floor: 2, live: 3, bearing: 2, ratio: .5, bridged: [31, 33], reason: 'stable' }] };
    }
  }
  const window = new EventTarget(); window.visualViewport = new EventTarget();
  const sandbox = { document, window, SkyfallEngine, console, URLSearchParams,
    location: { protocol: 'http:', search: options.search || '', reload() {} },
    localStorage: { getItem(key) { return storage.get(key) ?? null; }, setItem(key, value) { storage.set(key, value); } },
    requestAnimationFrame(callback) { const id = ++nextRaf; raf.set(id, callback); return id; },
    cancelAnimationFrame(id) { raf.delete(id); },
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  await vm.runInNewContext(source, sandbox, { filename: 'app.js' });
  return { document, window, engine, get, raf, storage,
    pointer(type, id, x, y) { return get('world').dispatch(type, { pointerId: id, clientX: x, clientY: y }); },
    frame(time) { const queued = [...raf.values()]; raf.clear(); for (const callback of queued) callback(time); },
  };
}

test('GPU context loss during startup shows a retry instead of hiding the loading screen', async () => {
  const h = await boot({ duringLoad: ({ canvas }) => canvas.dispatch('webglcontextlost') });
  assert.equal(h.get('loading').hidden, false);
  assert.equal(h.get('retry').hidden, false);
  assert.match(h.get('loadingTitle').textContent, /中断/);
});

test('single-finger drag rotates horizontally and vertically without selecting a target', async () => {
  const h = await boot(), before = { ...h.engine.orbit };
  h.pointer('pointerdown', 1, 100, 100);
  h.pointer('pointermove', 1, 140, 120);
  h.pointer('pointerup', 1, 140, 120);
  assert.ok(h.engine.orbit.yaw < before.yaw);
  assert.ok(h.engine.orbit.pitch > before.pitch);
  assert.equal(h.engine.orbit.distance, before.distance);
  assert.equal(h.engine.picks.length, 0);
});

test('small tap selects the building instead of rotating', async () => {
  const h = await boot(), yaw = h.engine.orbit.yaw;
  h.pointer('pointerdown', 1, 100, 100);
  h.pointer('pointermove', 1, 102, 102);
  h.pointer('pointerup', 1, 102, 102);
  assert.equal(h.engine.orbit.yaw, yaw);
  assert.deepEqual(h.engine.picks, [[102, 102]]);
});

test('pinch-out moves the camera closer and pinch-in moves it away', async () => {
  const h = await boot();
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerdown', 2, 200, 100);
  h.pointer('pointermove', 2, 300, 100);
  assert.equal(h.engine.orbit.distance, 32.5);
  h.pointer('pointermove', 2, 200, 100);
  assert.equal(h.engine.orbit.distance, 65);
});

test('two-finger vertical drag changes target height without orbiting', async () => {
  const h = await boot(), before = { ...h.engine.orbit };
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerdown', 2, 200, 100);
  h.pointer('pointermove', 1, 100, 140); h.pointer('pointermove', 2, 200, 140);
  assert.ok(Math.abs(h.engine.orbit.height - 12.2) < 1e-10);
  assert.ok(Math.abs(h.engine.orbit.distance - before.distance) < 1e-10);
  assert.equal(h.engine.orbit.yaw, before.yaw); assert.equal(h.engine.orbit.pitch, before.pitch);
});

test('lifting the second finger never turns the remaining finger into a tap', async () => {
  const h = await boot();
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerdown', 2, 200, 100);
  h.pointer('pointerup', 2, 200, 100); h.pointer('pointerup', 1, 100, 100);
  assert.equal(h.engine.picks.length, 0);
  h.pointer('pointerdown', 3, 110, 110); h.pointer('pointerup', 3, 110, 110);
  assert.deepEqual(h.engine.picks, [[110, 110]]);
});

test('remaining finger can continue rotating after pinch without a sudden jump', async () => {
  const h = await boot();
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerdown', 2, 200, 100);
  h.pointer('pointermove', 2, 230, 100); h.pointer('pointerup', 2, 230, 100);
  const before = h.engine.orbit.yaw;
  h.pointer('pointermove', 1, 110, 100);
  assert.ok(Math.abs(h.engine.orbit.yaw - (before - .07)) < 1e-10);
  h.pointer('pointerup', 1, 110, 100); assert.equal(h.engine.picks.length, 0);
});

test('pointercancel clears stale movement and never selects a target', async () => {
  const h = await boot(), yaw = h.engine.orbit.yaw;
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointercancel', 1, 100, 100);
  h.pointer('pointermove', 1, 300, 250); h.pointer('pointerup', 1, 300, 250);
  assert.equal(h.engine.orbit.yaw, yaw); assert.equal(h.engine.picks.length, 0);
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerup', 1, 100, 100);
  assert.equal(h.engine.picks.length, 1);
});

test('lostpointercapture clears stale pointer state', async () => {
  const h = await boot(), yaw = h.engine.orbit.yaw;
  h.pointer('pointerdown', 1, 100, 100); h.pointer('lostpointercapture', 1, 100, 100);
  h.pointer('pointermove', 1, 200, 200); h.pointer('pointerup', 1, 200, 200);
  assert.equal(h.engine.orbit.yaw, yaw); assert.equal(h.engine.picks.length, 0);
});

test('pinch camera distance and two-finger height remain within safe limits', async () => {
  const h = await boot();
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerdown', 2, 200, 100);
  h.pointer('pointermove', 2, 10000, 100);
  assert.equal(h.engine.orbit.distance, 19);
  h.pointer('pointermove', 2, 106, 100);
  assert.equal(h.engine.orbit.distance, 115);
  h.pointer('pointermove', 1, 100, 10000); h.pointer('pointermove', 2, 106, 10000);
  assert.equal(h.engine.orbit.height, 33);
});

test('hiding the page cancels RAF and clears gestures; returning schedules one RAF without a time jump', async () => {
  const h = await boot(); h.frame(1); h.frame(34);
  assert.equal(h.engine.steps.length, 1); assert.equal(h.raf.size, 1);
  h.pointer('pointerdown', 1, 100, 100);
  h.document.hidden = true; h.document.dispatch('visibilitychange');
  assert.equal(h.raf.size, 0);
  h.frame(100000); assert.equal(h.engine.steps.length, 1);
  h.document.hidden = false; h.document.dispatch('visibilitychange');
  assert.equal(h.raf.size, 1);
  h.frame(200000); assert.equal(h.engine.steps.length, 1);
  h.frame(200034); assert.equal(h.engine.steps.length, 2);
  assert.ok(h.engine.steps[1] < .05);
  h.pointer('pointerup', 1, 100, 100); assert.equal(h.engine.picks.length, 0);
});

test('slow frames preserve elapsed time for the engine settlement clock', async () => {
  const h=await boot(); h.frame(1); h.frame(201); h.frame(401);
  assert.deepEqual(h.engine.steps,[.2,.2]);
});

test('open help blocks firing, orbit and tap, and pauses simulation', async () => {
  const h = await boot(); h.get('helpBtn').click();
  assert.equal(h.get('help').hidden, false);
  h.get('fire').click(); h.document.dispatch('keydown', { code: 'Space' });
  assert.equal(h.engine.fires.length, 0);
  const yaw = h.engine.orbit.yaw;
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointermove', 1, 200, 100); h.pointer('pointerup', 1, 200, 100);
  assert.equal(h.engine.orbit.yaw, yaw); assert.equal(h.engine.picks.length, 0);
  h.frame(1); h.frame(34); assert.equal(h.engine.steps.length, 0);
  h.get('closeHelp').click(); h.get('fire').click(); assert.equal(h.engine.fires.length, 1);
});

test('shot settlement updates the HUD without a modal or focus change and the next tap fires immediately', async () => {
  const h = await boot(); h.get('fire').focus(); h.get('fire').click();
  h.engine.shotFinished({ score: 1400, damage: 33, shotDamage: 33 });
  assert.equal(h.get('result').hidden, true);
  assert.equal(h.document.activeElement, h.get('fire'));
  assert.equal(h.get('fire').disabled, false);
  assert.equal(h.get('ammo').textContent, '∞');
  assert.equal(h.get('height').disabled, false); assert.equal(h.get('meteor').disabled, false);
  h.get('meteor').click(); h.get('fire').click();
  assert.deepEqual(h.engine.fires, ['rocket', 'meteor']);
  h.engine.shotFinished({ score: 2600, damage: 61, shotDamage: 28 });
  assert.match(h.get('status').textContent, /本发拆除28% · 累计61% · 已用2发/);
  assert.equal(h.get('result').hidden, true); assert.equal(h.engine.resets, 0);
});

test('players can aim, switch weapons and fire during flight and collapse, with one combined damage report', async () => {
  const h = await boot({ emptyPicks: [2] });
  h.get('fire').click();
  assert.equal(h.engine.state, 'flight');
  assert.equal(h.get('fire').disabled, false);
  h.get('meteor').click();
  h.pointer('pointerdown', 1, 100, 160); h.pointer('pointerup', 1, 100, 160);
  h.document.dispatch('keydown', { code: 'Space' });
  assert.deepEqual(h.engine.fires, ['rocket', 'meteor']);

  h.engine.state = 'watch'; h.engine.onEvent('impact', {weapon: 'rocket'});
  h.get('ball').click();
  assert.equal(h.get('height').disabled, false); assert.equal(h.get('angle').disabled, false);
  h.get('height').dispatch('input', { target: { value: 6 } });
  h.pointer('pointerdown', 2, 30, 30); h.pointer('pointerup', 2, 30, 30);
  h.get('fire').click();
  assert.equal(h.get('toast').textContent, '这里已经空了，换个位置试试');
  assert.equal(h.engine.shots, 2); assert.equal(h.engine.state, 'watch');
  h.pointer('pointerdown', 3, 120, 220); h.pointer('pointerup', 3, 120, 220);
  h.get('fire').click();
  assert.deepEqual(h.engine.fires, ['rocket', 'meteor', 'ball']);
  h.engine.shotFinished({ score: 3400, damage: 53, shotDamage: 53, volleyShots: 3 });
  assert.match(h.get('status').textContent, /本轮连续3发，共拆除53% · 累计53% · 已用3发/);
  assert.equal(h.get('result').hidden, true); assert.equal(h.get('fire').disabled, false);
});

test('settlement refreshes slider bounds and preserves the engine retargeted aim on surviving geometry', async () => {
  const h = await boot(); h.get('fire').click();
  h.engine.shotFinished({ score: 1700, damage: 40, shotDamage: 40,
    limits: { min: .5, max: 8.5 }, aim: { height: 4.5, angle: -4, x: -2, z: 3 } });
  assert.equal(Number(h.get('height').min), .5); assert.equal(Number(h.get('height').max), 8.5);
  assert.equal(Number(h.get('height').value), 4.5); assert.equal(Number(h.get('angle').value), -4);
  assert.deepEqual(h.engine.aim, { height: 4.5, angle: -4, x: -2, z: 3 });
});

test('aim slider uses the loaded building height and clamps out-of-range input', async () => {
  const h = await boot({ buildingHeight: 23.75 });
  assert.equal(Number(h.get('height').min), 1);
  assert.equal(Number(h.get('height').max), 23.75);
  h.get('height').dispatch('input', { target: { value: 30 } });
  assert.equal(h.engine.aim.height, 23.75);
  assert.equal(Number(h.get('height').value), 23.75);
  h.get('height').dispatch('input', { target: { value: -3 } });
  assert.equal(h.engine.aim.height, 1);
});

test('slow frames never override any of the three persisted manual quality modes', async () => {
  for (const quality of ['high', 'balanced', 'low']) {
    const h = await boot({ storage: new Map([['skyfall-mobile-quality', quality]]) });
    h.frame(1);
    for (let i = 1; i <= 240; i++) h.frame(1 + i * 80);
    assert.equal(h.engine.quality, quality);
    assert.deepEqual(h.engine.qualityChanges, [quality]);
  }
  const h = await boot();
  for (const quality of ['low', 'high', 'balanced']) {
    h.get('qualityBtn').click();
    assert.equal(h.engine.quality, quality);
    const reopened = await boot({ storage: h.storage });
    assert.equal(reopened.engine.quality, quality);
  }
});

test('preview score records ignore prior rules and survive reopening', async () => {
  const storage = new Map([['skyfall-mobile-best', '999999'], ['skyfall-mobile-best-fixed-v1', '9999'], ['skyfall-mobile-best-loop-v1', '8888'], ['skyfall-mobile-quality', 'high']]);
  const h = await boot({ storage });
  assert.equal(h.get('best').textContent, '0');
  assert.equal(h.engine.quality, 'high');
  h.get('fire').click(); h.engine.finish({ score: 5700, damage: 100, cleared: true, ammoBonus: 900 });
  assert.equal(storage.get('skyfall-local-detail-preview-best'), '5700');
  assert.equal(storage.get('skyfall-mobile-best-fixed-v1'), '9999');
  assert.equal(storage.get('skyfall-mobile-best-loop-v1'), '8888');
  const reopened = await boot({ storage });
  assert.equal(reopened.get('best').textContent, (5700).toLocaleString());
  reopened.get('fire').click(); reopened.engine.shotFinished({ score: 2300, damage: 48, shotDamage: 48 });
  reopened.get('fire').click(); reopened.engine.finish({ score: 5400, damage: 100, cleared: true, ammoBonus: 600 });
  assert.equal(storage.get('skyfall-local-detail-preview-best'), '5700');
});

test('a terminal engine event opens one result with a single rebuild action and no zero bonus line', async () => {
  const h = await boot();
  for (let shot = 1; shot <= 4; shot++) {
    h.get('fire').click();
    if (shot < 4) h.engine.shotFinished({ score: shot * 800, damage: shot * 15, shotDamage: 15 });
    else h.engine.finish({ score: 3200, damage: 60 });
  }
  assert.equal(h.engine.fires.length, 4);
  assert.equal(h.get('result').hidden, false); assert.equal(h.document.activeElement, h.get('again'));
  assert.equal(h.get('finalShots').textContent, '4'); assert.equal(h.get('ammoBonusRow').hidden, true);
  assert.match(h.get('resultTitle').textContent, /弹药用尽/);
  assert.match(h.get('fire').innerHTML, /重建/);
  assert.deepEqual(h.get('result').querySelectorAll().map(button => button.id), ['again']);
  h.get('fire').click(); assert.equal(h.engine.resets, 0, 'modal blocks the underlying fire control');
  h.get('again').click();
  assert.equal(h.engine.resets, 1); assert.equal(h.get('result').hidden, true);
  assert.equal(h.engine.damage, 0); assert.equal(h.get('ammo').textContent, '∞');
});

test('a full clear displays remaining-ammo bonus and a later zero-bonus clear hides that row', async () => {
  const h = await boot(); h.get('fire').click();
  h.engine.finish({ score: 5700, damage: 100, cleared: true, ammoBonus: 900 });
  assert.equal(h.get('ammoBonusRow').hidden, false); assert.equal(h.get('finalBonus').textContent, '900');
  assert.match(h.get('resultTitle').textContent, /全楼拆除完成/);
  h.get('again').click();
  assert.equal(h.engine.resets, 1); assert.equal(h.engine.score, 0); assert.equal(h.engine.shots, 0);
  for (let shot = 1; shot <= 4; shot++) {
    h.get('fire').click();
    if (shot < 4) h.engine.shotFinished({ score: shot * 1000, damage: shot * 21, shotDamage: 21 });
    else h.engine.finish({ score: 4800, damage: 100, cleared: true });
  }
  assert.equal(h.get('ammoBonusRow').hidden, true);
  h.document.dispatch('keydown', { key: 'Escape' }); h.get('fire').click();
  assert.equal(h.engine.resets, 2, 'the finished main control also rebuilds');
  h.get('fire').click(); h.engine.shotFinished({ score: 900, damage: 20, shotDamage: 20 }); h.get('reset').click();
  assert.equal(h.engine.resets, 3); assert.equal(h.engine.damage, 0);
});

test('debug telemetry is hidden and never sampled unless debug=1 is present', async () => {
  for (const search of ['', '?debug=0', '?mode=debug', '?debug=10']) {
    const h = await boot({ search }); h.frame(1); h.frame(501);
    assert.equal(h.get('debugPanel').hidden, true); assert.equal(h.engine.metricReads, 0);
  }
});

test('debug panel reports rendered FPS, live draw calls and expandable shot and support details', async () => {
  const h = await boot({ search: '?debug=1' });
  assert.equal(h.get('debugPanel').hidden, false); assert.equal(h.get('debugDetails').hidden, true);
  h.frame(1); for (let n = 1; n <= 30; n++) h.frame(1 + n * 20);
  assert.match(h.get('debugSummary').textContent, /FPS 50/);
  h.get('debugToggle').click();
  assert.match(h.get('debugSummary').textContent, /Draw 30/);
  assert.equal(h.get('debugDetails').hidden, false); assert.equal(h.get('debugToggle').attributes['aria-expanded'], 'true');
  const details = h.get('debugDetails').textContent;
  for (const field of ['23', '2', '0.30', '1.50', '17', '23', 'direct', 'support', '0.50', 'stable']) assert.ok(details.includes(field), field);
  h.get('debugToggle').click(); assert.equal(h.get('debugDetails').hidden, true);
});

test('both window and visual viewport resizing update the engine viewport', async () => {
  const h = await boot(); h.window.dispatch('resize'); h.window.visualViewport.dispatch('resize');
  assert.equal(h.engine.resizes, 2);
});

test('aim assistance is off for each new session and its accessible toggle controls the engine', async () => {
  const h = await boot();
  assert.equal(h.engine.autoAim, false); assert.equal(h.get('autoAimToggle').attributes['aria-pressed'], 'false');
  h.get('autoAimToggle').click();
  assert.equal(h.engine.autoAim, true); assert.equal(h.get('autoAimToggle').attributes['aria-pressed'], 'true');
  h.get('reset').click(); assert.equal(h.engine.autoAim, true, 'rebuilding keeps the session choice');
  h.get('autoAimToggle').click(); assert.equal(h.engine.autoAim, false);
  h.get('autoAimToggle').click();
  const reopened = await boot({ storage: h.storage });
  assert.equal(reopened.engine.autoAim, false); assert.equal(reopened.get('autoAimToggle').attributes['aria-pressed'], 'false');
});

test('an empty-target rejection shows guidance without opening results or consuming ammo', async () => {
  const h = await boot({ emptyAim: true }); h.get('fire').focus(); h.get('fire').click();
  assert.equal(h.get('toast').hidden, false); assert.equal(h.get('toast').textContent, '这里已经空了，换个位置试试');
  assert.equal(h.get('ammo').textContent, '∞'); assert.equal(h.engine.shots, 0);
  assert.equal(h.get('fire').disabled, false); assert.equal(h.get('result').hidden, true);
  assert.equal(h.document.activeElement, h.get('fire'));
});

test('terminal grades use the final demolition thresholds and keep the background status short', async () => {
  const h = await boot();
  for (const [damage, cleared, grade] of [[0, false, 'C'], [59, false, 'C'], [60, false, 'B'], [79, false, 'B'], [80, false, 'A'], [99, false, 'A'], [100, true, 'S']]) {
    h.get('reset').click(); h.get('fire').click(); h.engine.finish({ score: 1000, damage, cleared });
    assert.equal(h.get('finalGrade').textContent, grade, 'damage ' + damage);
    assert.equal(h.get('finalDamage').textContent, damage + '%'); assert.equal(h.get('status').textContent, '挑战结束');
  }
});

test('debug panels yield to help and results and restore only for debug sessions', async () => {
  for (const search of ['', '?debug=1']) {
    const h = await boot({ search }); h.get('helpBtn').click();
    assert.equal(h.get('debugPanel').hidden, true); const sampled = h.engine.metricReads;
    h.frame(1); h.frame(601); assert.equal(h.get('debugPanel').hidden, true); assert.equal(h.engine.metricReads, sampled);
    h.get('closeHelp').click(); assert.equal(h.get('debugPanel').hidden, search !== '?debug=1');
    h.get('fire').click(); h.engine.finish({ score: 5700, damage: 100, cleared: true, ammoBonus: 900 });
    assert.equal(h.get('debugPanel').hidden, true);
    h.get('again').click(); assert.equal(h.get('debugPanel').hidden, search !== '?debug=1');
  }
});

test('expanded debug details expose hit counts and the ids borrowing support across a gap', async () => {
  const h = await boot({ search: '?debug=1' }); h.get('debugToggle').click();
  assert.match(h.get('debugDetails').textContent, /hitCount 2/);
  assert.match(h.get('debugDetails').textContent, /bridged \[31, 33\]/);
});

test('settlement reads back manual aim without moving it when the remaining roof is lower', async () => {
  const h = await boot(); Object.assign(h.engine.aim, { height: 18, angle: 12, x: -3, z: 5 }); h.get('fire').click();
  h.engine.shotFinished({ score: 1700, damage: 40, shotDamage: 40, limits: { min: 1, max: 8.5 } });
  assert.deepEqual(h.engine.aim, { height: 18, angle: 12, x: -3, z: 5 });
  assert.equal(Number(h.get('height').max), 8.5); assert.match(h.get('heightValue').textContent, /18.0 m.*高于残楼/);
});

test('fire during assisted movement launches from the current aim without waiting for another tap', async () => {
  const h = await boot();
  h.get('autoAimToggle').click(); h.get('fire').click();
  h.engine.aimTween = { elapsed: 0, duration: .2 };
  h.engine.aim.height = 4.5;
  h.engine.shotFinished({ score: 1700, damage: 40, shotDamage: 40 });
  assert.equal(h.get('fire').disabled, false); assert.equal(h.get('heightValue').textContent, '4.5 m');
  h.get('fire').click(); assert.equal(h.engine.fires.length, 2);
  assert.equal(h.engine.aimTween, null); assert.equal(h.engine.aim.height, 4.5);
});

test('enabling assistance requests recovery once and leaves valid or manually changed aim alone afterward', async () => {
  const h = await boot(), original = { ...h.engine.aim };
  h.get('autoAimToggle').click();
  assert.equal(h.engine.recoveries, 1); assert.deepEqual(h.engine.aim, original);
  h.frame(1); h.frame(601); h.frame(1201);
  h.get('height').dispatch('input', { target: { value: 11 } });
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointermove', 1, 125, 110); h.pointer('pointerup', 1, 125, 110);
  h.pointer('pointerdown', 2, 100, 100); h.pointer('pointerup', 2, 100, 100); h.frame(1801);
  assert.equal(h.engine.recoveries, 1); assert.equal(h.engine.aim.height, 11);
});

test('turning assistance off immediately cancels movement at its current position', async () => {
  const h = await boot({ recoverStartsTween: true }); h.get('autoAimToggle').click();
  assert.equal(h.get('fire').disabled, false); assert.equal(h.get('autoAimToggle').disabled, false);
  h.engine.aim.height = 6.5; h.get('autoAimToggle').click();
  assert.equal(h.engine.autoAim, false); assert.equal(h.engine.aimTween, null);
  assert.equal(h.engine.aim.height, 6.5); assert.equal(h.get('fire').disabled, false);
});

test('manual target and camera input cancel assistance motion without scheduling it again', async () => {
  for (const action of ['pick', 'drag', 'pinch', 'wheel', 'home', 'zoomIn', 'zoomOut', 'keyboard', 'height', 'angle']) {
    const h = await boot({ recoverStartsTween: true }); h.get('autoAimToggle').click();
    assert.ok(h.engine.aimTween, action);
    if (action === 'pick') { h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerup', 1, 100, 100); }
    else if (action === 'drag') { h.pointer('pointerdown', 1, 100, 100); h.pointer('pointermove', 1, 125, 110); }
    else if (action === 'pinch') { h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerdown', 2, 200, 100); h.pointer('pointermove', 2, 240, 100); }
    else if (action === 'wheel') h.get('world').dispatch('wheel', { deltaY: 50 });
    else if (action === 'keyboard') h.document.dispatch('keydown', { code: 'ArrowLeft' });
    else if (action === 'height' || action === 'angle') h.get(action).dispatch('input', { target: { value: 8 } });
    else h.get(action).click();
    assert.equal(h.engine.aimTween, null, action); assert.equal(h.engine.autoAim, true);
    assert.equal(h.engine.recoveries, 1); assert.equal(h.get('fire').disabled, false);
  }
});

test('empty taps keep fire available for guidance until a building is selected', async () => {
  const h = await boot({ emptyPicks: [1] }); const reads = h.engine.validityReads;
  h.pointer('pointerdown', 1, 20, 20); h.pointer('pointerup', 1, 20, 20);
  assert.equal(h.get('toast').hidden, false); assert.equal(h.get('toast').textContent, '点在空处了，点楼体');
  assert.match(h.get('status').textContent, /重新瞄准/); assert.equal(h.get('fire').disabled, false);
  assert.match(h.get('fire').innerHTML, /发射/); h.get('fire').click(); assert.equal(h.engine.shots, 0);
  assert.equal(h.get('toast').textContent, '这里已经空了，换个位置试试');
  assert.equal(h.engine.validityReads, reads, 'an empty pick must not validate the old target again');
  h.pointer('pointerdown', 2, 150, 200); h.pointer('pointerup', 2, 150, 200);
  assert.equal(h.get('fire').disabled, false); assert.equal(h.get('toast').hidden, true);
  assert.match(h.get('status').textContent, /已瞄准楼体/); h.get('fire').click(); assert.equal(h.engine.shots, 1);
});

test('assisted selection is distinguished from ordinary selection only when the player enabled it', async () => {
  const h = await boot({ assistedPick: true });
  h.pointer('pointerdown', 1, 150, 200); h.pointer('pointerup', 1, 150, 200);
  assert.match(h.get('status').textContent, /已瞄准楼体/); assert.doesNotMatch(h.get('status').textContent, /辅助/);
  h.get('autoAimToggle').click(); h.pointer('pointerdown', 2, 151, 200); h.pointer('pointerup', 2, 151, 200);
  assert.match(h.get('status').textContent, /辅助瞄准.*附近楼体/); assert.equal(h.get('fire').disabled, false);
});

test('manual camera and slider changes refresh validity immediately while periodic HUD updates use cached validity', async () => {
  for (const action of ['drag', 'pinch', 'wheel', 'home', 'zoomIn', 'zoomOut', 'keyboard', 'height', 'angle']) {
    const h = await boot(); const before = h.engine.validityReads;
    if (action === 'drag') { h.pointer('pointerdown', 1, 100, 100); h.pointer('pointermove', 1, 125, 110); }
    else if (action === 'pinch') { h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerdown', 2, 200, 100); h.pointer('pointermove', 2, 240, 100); }
    else if (action === 'wheel') h.get('world').dispatch('wheel', { deltaY: 50 });
    else if (action === 'keyboard') h.document.dispatch('keydown', { code: 'ArrowLeft' });
    else if (action === 'height' || action === 'angle') h.get(action).dispatch('input', { target: { value: 8 } });
    else h.get(action).click();
    assert.equal(h.engine.validityReads, before + 1, action);
    assert.equal(h.engine.validityOptions.at(-1).manual, true, action + ' explicitly replaces the empty-tap target');
    h.engine.aimValid = false; h.frame(1); h.frame(501); h.frame(1001);
    assert.equal(h.engine.validityReads, before + 1, action + ' periodic HUD must not raycast');
    assert.equal(h.get('fire').disabled, false);
  }
});

test('after a corridor is destroyed, firing over the gap gives guidance until a surviving target is picked', async () => {
  const h = await boot(); h.get('fire').click(); const before = h.engine.validityReads;
  h.engine.aimValid = false; h.engine.shotFinished({ score: 1700, damage: 40, shotDamage: 40 });
  assert.equal(h.engine.validityReads, before + 1); assert.equal(h.get('fire').disabled, false);
  assert.equal(h.engine.validityOptions.at(-1).manual, false, 'settlement must preserve a rejected manual target');
  assert.match(h.get('fire').innerHTML, /发射/); assert.equal(h.get('height').disabled, false);
  const ammo = h.engine.remainingAmmo;
  h.get('fire').click(); h.get('fire').click();
  assert.equal(h.get('toast').textContent, '这里已经空了，换个位置试试');
  assert.equal(h.engine.shots, 1); assert.equal(h.engine.remainingAmmo, ammo);
  h.pointer('pointerdown', 1, 120, 180); h.pointer('pointerup', 1, 120, 180);
  h.get('fire').click(); assert.equal(h.engine.shots, 2);
});

test('results show the next rating gap and a positive message for a true full clear', async () => {
  const h = await boot();
  for (const [damage, cleared, hint] of [[69, false, '距A级还差11%'], [54, false, '距B级还差6%'], [80, false, '距S级还差20%'], [99, false, '距S级还差1%']]) {
    h.get('reset').click(); h.engine.finish({ score: 1000, damage, cleared });
    assert.equal(h.get('resultHint').textContent, hint);
  }
  h.get('reset').click(); h.engine.finish({ score: 5700, damage: 100, cleared: true, ammoBonus: 900 });
  assert.equal(h.get('resultHint').textContent, '换一个落点，再试一种拆法。'); assert.doesNotMatch(h.get('resultHint').textContent, /还差/);
});

test('manual validity changes replace stale aim feedback together with the fire state', async () => {
  const options = { validAfterRefresh: true }; const h = await boot(options);
  options.validAfterRefresh = false; h.get('angle').dispatch('input', { target: { value: 8 } });
  assert.equal(h.get('fire').disabled, false); assert.match(h.get('status').textContent, /重新瞄准/);
  h.engine.onEvent('aimEmpty'); options.validAfterRefresh = true;
  h.get('height').dispatch('input', { target: { value: 8 } });
  assert.equal(h.get('fire').disabled, false); assert.equal(h.get('toast').hidden, true);
  assert.match(h.get('status').textContent, /已瞄准楼体/);
});

test('pause and modal state suspend target highlights and rebuilding restores the overlay state', async () => {
  const h = await boot();
  assert.equal(h.engine.targetHighlightPaused, false);
  h.get('pauseBtn').click(); assert.equal(h.engine.targetHighlightPaused, true);
  h.get('helpBtn').click(); h.get('closeHelp').click(); assert.equal(h.engine.targetHighlightPaused, true);
  h.get('pauseBtn').click(); assert.equal(h.engine.targetHighlightPaused, false);
  h.get('helpBtn').click(); assert.equal(h.engine.targetHighlightPaused, true);
  h.get('closeHelp').click(); assert.equal(h.engine.targetHighlightPaused, false);
  h.get('fire').click(); h.engine.finish({ score: 5700, damage: 100, cleared: true, ammoBonus: 900 });
  assert.equal(h.engine.targetHighlightPaused, true);
  h.get('again').click(); assert.equal(h.engine.targetHighlightPaused, false);
});

test('finished assisted movement replaces stale warm-target guidance only after the aim becomes valid', async () => {
  for (const valid of [true, false]) {
    const h = await boot({ recoverStartsTween: true, duringStep(engine) { engine.aimTween = null; engine.aimValid = valid; } });
    h.engine.aimValid = false; h.engine.onEvent('aimEmpty'); h.get('autoAimToggle').click();
    assert.match(h.get('status').textContent, /暖色楼体/);
    h.frame(1); h.frame(34);
    assert.equal(h.get('fire').disabled, false);
    if (valid) {
      assert.equal(h.get('status').textContent, '辅助瞄准已就绪 · 可发射');
      assert.equal(h.get('toast').hidden, true);
    } else assert.match(h.get('status').textContent, /暖色楼体/);
  }
});

test('support guidance defaults on independently from aim assistance and preserves its session choice on rebuild', async () => {
  const h = await boot();
  assert.equal(h.engine.supportGuideEnabled, true); assert.equal(h.engine.autoAim, false);
  assert.equal(h.get('supportGuideToggle').attributes['aria-pressed'], 'true');
  assert.equal(h.get('supportGuideToggle').textContent, '承重提示：开');
  h.get('supportGuideToggle').click();
  assert.equal(h.engine.supportGuideEnabled, false); assert.equal(h.get('supportGuide').hidden, true);
  h.get('reset').click();
  assert.equal(h.engine.supportGuideEnabled, false); assert.equal(h.get('supportGuideToggle').attributes['aria-pressed'], 'false');
  h.get('autoAimToggle').click(); assert.equal(h.engine.supportGuideEnabled, false);
  const reopened = await boot({ storage: h.storage });
  assert.equal(reopened.engine.supportGuideEnabled, true); assert.equal(reopened.engine.autoAim, false);
});

test('support guidance explains cached support, carried structure and critical state without evaluating the solver', async () => {
  const h = await boot({ supportInsight: { anchored: true, supportIds: [3, 5], carriedIds: [15], criticalReason: null } });
  assert.equal(h.get('supportGuide').hidden, false);
  assert.equal(h.get('supportHint').textContent, '下方2处支撑 · 承托上方1片楼体');
  const before = h.engine.validityReads;
  h.engine.supportInsight = { anchored: true, supportIds: [], carriedIds: [8, 16, 24], criticalReason: null };
  h.engine.onEvent('aimSelected', {});
  assert.equal(h.get('supportHint').textContent, '这里承托着上方3片楼体');
  h.engine.supportInsight = { anchored: true, supportIds: [3], carriedIds: [8], criticalReason: 'capacity-overload' };
  h.engine.onEvent('aimSelected', {});
  assert.equal(h.get('supportHint').textContent, '此处承重吃紧，失效可能引发连锁坍塌');
  h.frame(1); h.frame(501); h.frame(1001);
  assert.equal(h.engine.validityReads, before, 'HUD updates must not trace aim or reassess support');
  assert.equal(h.get('result').hidden, true);
});

test('empty aim replaces stale support text with an invitation to select the remaining building', async () => {
  const h = await boot({ emptyPicks: [1], supportInsight: { anchored: true, supportIds: [3], carriedIds: [] } });
  h.pointer('pointerdown', 1, 20, 20); h.pointer('pointerup', 1, 20, 20);
  assert.equal(h.get('supportHint').textContent, '点选残楼，查看它由哪里支撑');
  assert.equal(h.get('supportGuide').hidden, false); assert.equal(h.get('fire').disabled, false);
  assert.match(html, /青色仍在承重 · 橙色承重吃紧/);
});

test('support guidance hides immediately for flight, tween, pause and modals then restores when ready', async () => {
  const h = await boot({ supportInsight: { anchored: true, supportIds: [1], carriedIds: [] } });
  h.get('pauseBtn').click(); assert.equal(h.get('supportGuide').hidden, true);
  h.get('pauseBtn').click(); assert.equal(h.get('supportGuide').hidden, false);
  h.get('helpBtn').click(); assert.equal(h.get('supportGuide').hidden, true);
  h.get('closeHelp').click(); assert.equal(h.get('supportGuide').hidden, false);
  h.get('fire').click(); assert.equal(h.get('supportGuide').hidden, true);
  h.engine.shotFinished({ score: 1000, damage: 20, shotDamage: 20 });
  assert.equal(h.get('supportGuide').hidden, false);
  h.engine.aimTween = {}; h.engine.onEvent('aimSelected', {}); assert.equal(h.get('supportGuide').hidden, true);
  h.engine.aimTween = null; h.engine.onEvent('aimSelected', {}); assert.equal(h.get('supportGuide').hidden, false);
  h.engine.finish({ score: 3000, damage: 62 }); assert.equal(h.get('supportGuide').hidden, true);
  h.get('again').click(); assert.equal(h.get('supportGuide').hidden, false);
});

test('debug support details expose the selected cached load path and per-floor failure ids without recomputing it', async () => {
  const h = await boot({ search: '?debug=1',
    supportInsight: { id: 17, state: 'standing', anchored: true, supportIds: [9, 10], carriedIds: [25, 33], load: 3.25, capacity: 2.5, unbracedHeight: 7.5, reason: 'overload', criticalReason: 'unbraced load exceeds capacity' },
    supportDiagnostics: [{ floor: 2, live: 3, bearing: 2, ratio: .5, bridged: [31], reason: 'stable', overloaded: [17], failures: [{ id: 18, reason: 'unbraced load exceeds capacity' }] }],
  });
  const before = h.engine.validityReads; h.get('debugToggle').click();
  const details = h.get('debugDetails').textContent;
  for (const value of ['selected #17', 'state standing', 'anchored true', 'supportIds [9, 10]', 'carriedIds [25, 33]', 'load/capacity 3.25/2.50', 'unbracedHeight 7.50', 'reason overload', 'criticalReason unbraced load exceeds capacity', 'overloaded [17]', 'failures [18:unbraced load exceeds capacity]']) assert.ok(details.includes(value), value);
  assert.doesNotMatch(details, /\b(?:kg|kN|MPa)\b/);
  h.engine.supportInsight = null; h.engine.aimValid = false; h.engine.onEvent('aimEmpty');
  assert.match(h.get('debugDetails').textContent, /selected support —/);
  assert.doesNotMatch(h.get('debugDetails').textContent, /selected #17/);
  assert.equal(h.engine.validityReads, before);
});

test('support guidance keeps a short lower-only message and explains a slender critical remnant', async () => {
  const h = await boot({ supportInsight: { supportIds: [1], carriedIds: [] } });
  assert.equal(h.get('supportHint').textContent, '下方1处结构仍在支撑');
  h.engine.supportInsight = { supportIds: [1], carriedIds: [3, 4], criticalReason: 'unbraced load exceeds capacity' };
  h.engine.onEvent('aimSelected', {});
  assert.equal(h.get('supportHint').textContent, '侧向支撑不足，此处承重已超限');
});


test('free preview HUD keeps unlimited ammo and no terminal modal after five settled shots', async () => {
  const h = await boot();
  assert.equal(h.engine.freeMode, true);
  for (let shot = 1; shot <= 5; shot++) {
    h.get('fire').click();
    h.engine.shotFinished({ score: shot * 100, damage: shot * 2, shotDamage: 2 });
    assert.equal(h.engine.fires.length, shot);
    assert.equal(h.get('ammo').textContent, '∞');
    assert.equal(h.get('result').hidden, true);
    assert.equal(h.get('fire').disabled, false);
  }
  h.get('reset').click();
  assert.equal(h.engine.shots, 0);
  assert.equal(h.get('ammo').textContent, '∞');
});
