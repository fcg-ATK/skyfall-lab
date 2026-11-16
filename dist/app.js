/* Browser UI, gestures and audio. All resources are relative for GitHub Pages. */
(async function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const qualityNames = { balanced: '平衡', low: '省电', high: '精细' };
  let engine, paused = false, weapon = 'rocket', soundOn = true, best = 0, quality = 'balanced';
  const audio = typeof window.SkyfallAudio === 'function' ? new window.SkyfallAudio() : null;
  let prev = 0, elapsed = 0, lastHud = 0, toastTimer, frameId, badFrames = 0, autoQuality = true;
  let restoredFocus, resultShown = false;
  const pointers = new Map(); let gesture, single;
  const canvas = $('world'), downloads = new Map();
  let startupFailed = false, startupTimer;
  const inWeChat = typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent || '');
  $('browserHint').hidden = !inWeChat;
  function loadingFailure(error, title = '场景加载遇到了问题') {
    startupFailed = true; paused = true; clearTimeout(startupTimer); engine?.cancelLoading?.();
    $('loading').hidden = false; $('loadingTitle').textContent = title;
    $('loadingText').textContent = location.protocol === 'file:' ? '请通过试玩网址打开，不能直接双击 HTML 文件。' : (error.message || '加载未完成，请重新加载。');
    $('loadingProgress').textContent = inWeChat ? '也可点微信右上角“…”→“在浏览器打开”再试。' : '可切换网络后重试，或使用新版系统浏览器。';
    $('retry').hidden = false; $('retry').onclick = () => location.reload();
    syncAudioPause();
  }
  // Install before WebGL construction and all asset work, not after loading.
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); loadingFailure(new Error('手机图形资源暂时不足，请关闭其他大型页面后重新加载。'), '画面暂时中断');
  });
  function loadingProgress(value) {
    if (startupFailed) return;
    if (value.stage) { $('loadingText').textContent = value.stage; return; }
    downloads.set(value.label, value);
    let loaded = 0, total = 0;
    for (const resource of downloads.values()) { loaded += resource.loaded; total += resource.total || 0; }
    $('loadingText').textContent = '正在下载' + value.label + '…';
    $('loadingProgress').textContent = '已下载 ' + (loaded / 1048576).toFixed(1) + ' / ' + (total / 1048576).toFixed(1) + ' MB';
    const ratio = total ? Math.min(.95, loaded / total * .95) : 0;
    $('loadingBar').style.width = Math.round(ratio * 100) + '%';
  }
  try { best = Number(localStorage.getItem('skyfall-mobile-best')) || 0; quality = localStorage.getItem('skyfall-mobile-quality') || 'balanced'; } catch {}
  if (!Object.hasOwn(qualityNames, quality)) quality = 'balanced';
  $('best').textContent = best.toLocaleString();
  function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3400);
  }
  function unlockAudio() {
    if (soundOn) audio?.unlock();
  }
  // Touch activates audio on release; an earlier pointerdown resume can stay pending.
  // Keep these listeners throughout play so a later gesture can retry a blocked resume.
  for (const event of ['pointerdown', 'pointerup', 'touchend', 'click']) {
    document.addEventListener(event, unlockAudio, { capture: true, passive: true });
  }
  document.addEventListener('keydown', unlockAudio, { capture: true });
  audio?.setHidden(Boolean(document.hidden));
  // Audio must observe visibility changes even while engine.load() is still pending.
  document.addEventListener('visibilitychange', () => audio?.setHidden(Boolean(document.hidden)));
  function modalOpen() { return !$('help').hidden || !$('result').hidden; }
  function syncAudioPause() { audio?.setPaused(paused || modalOpen()); }
  function showModal(id) {
    pointers.clear(); single = gesture = null; restoredFocus = document.activeElement;
    $(id).hidden = false; $(id === 'help' ? 'closeHelp' : 'again').focus();
    syncAudioPause();
  }
  function hideModal(id) { $(id).hidden = true; restoredFocus?.focus?.(); prev = 0; syncAudioPause(); }
  function updateHud() {
    if (!engine) return;
    $('score').textContent = engine.score.toLocaleString(); $('damage').textContent = engine.damage + '%';
    const ready = engine.state === 'ready', finished = engine.state === 'finished';
    $('fire').disabled = !engine.loaded || (!ready && !finished);
    $('fire').innerHTML = '<span>' + (ready ? '发射' : finished ? '再试一次' : '观察倒塌') + '</span><svg><use href="#i-arrow"/></svg>';
    document.querySelectorAll('[data-weapon]').forEach(b => { b.disabled = !ready; });
    $('height').disabled = $('angle').disabled = !ready;
  }
  function onEvent(name, data) {
    audio?.play(name, data);
    if (name === 'launch') { $('status').textContent = '已发射 · 拖动视角观察'; $('aimPanel').hidden = true; $('aimToggle').setAttribute('aria-expanded', 'false'); }
    if (name === 'impact') $('status').textContent = '命中！观察失稳与连锁坍塌';
    if (name === 'miss') $('status').textContent = '这次没有命中 · 调低高度或换个方向';
    if (name === 'finished' && !resultShown) {
      resultShown = true; $('finalScore').textContent = data.score.toLocaleString(); $('finalDamage').textContent = data.damage + '%';
      best = Math.max(best, data.score); $('best').textContent = best.toLocaleString();
      try { localStorage.setItem('skyfall-mobile-best', String(best)); } catch {}
      showModal('result');
    }
    updateHud();
  }
  function syncAim() {
    engine.direction();
    $('angle').min = -Math.floor(Math.atan2(Math.max(0, engine.aim.height - 1.5), 42) * 180 / Math.PI);
    $('height').value = engine.aim.height; $('angle').value = engine.aim.angle;
    $('heightValue').textContent = engine.aim.height.toFixed(1) + ' m';
    $('angleValue').textContent = engine.aim.angle + '°';
  }
  function reset() {
    if (!engine?.loaded) return;
    audio?.reset();
    engine.reset(); resultShown = false; paused = false; $('result').hidden = true;
    syncAudioPause();
    $('pauseBtn').setAttribute('aria-pressed', 'false'); $('pauseBtn').innerHTML = '<svg><use href="#i-pause"/></svg>';
    $('status').textContent = '建筑已重建 · 换个位置再试试'; updateHud();
  }
  function chooseQuality(mode, automatic = false) {
    quality = mode; engine.setQuality(mode); $('qualityBtn').textContent = '画质：' + qualityNames[mode];
    if (!automatic) { autoQuality = false; try { localStorage.setItem('skyfall-mobile-quality', mode); } catch {} }
    badFrames = 0;
  }
  try {
    engine = new SkyfallEngine($('world'), onEvent);
    chooseQuality(quality, true); $('loadingText').textContent = '正在载入建筑与街区…';
    const deadline = new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('场景准备超时，请重新加载或换系统浏览器打开。')), 180000); });
    await Promise.race([engine.load(loadingProgress), deadline]); clearTimeout(startupTimer);
    if (startupFailed) return;
    $('loading').hidden = true; updateHud(); syncAim();
  } catch (error) {
    console.error(error);
    if (!startupFailed) loadingFailure(error); return;
  }
  function multiBaseline() {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return null;
    return { span: Math.hypot(a.x - b.x, a.y - b.y), cy: (a.y + b.y) / 2 };
  }
  canvas.addEventListener('pointerdown', e => {
    if (modalOpen() || e.button > 0) return;
    e.preventDefault(); canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) single = { x: e.clientX, y: e.clientY, moved: false };
    else { if (single) single.moved = true; gesture = multiBaseline(); }
  });
  canvas.addEventListener('pointermove', e => {
    const old = pointers.get(e.pointerId); if (!old) return;
    const dx = e.clientX - old.x, dy = e.clientY - old.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const next = multiBaseline();
      if (gesture && next.span > 5 && gesture.span > 5) {
        engine.orbit.distance = clamp(engine.orbit.distance * gesture.span / next.span, 19, 115);
        engine.orbit.height = clamp(engine.orbit.height + (next.cy - gesture.cy) * .055, 1.5, 33);
      }
      gesture = next;
    } else if (single) {
      if (Math.hypot(e.clientX - single.x, e.clientY - single.y) > 5) single.moved = true;
      if (single.moved) { engine.orbit.yaw -= dx * .007; engine.orbit.pitch = clamp(engine.orbit.pitch + dy * .005, -.04, 1.2); }
    }
  });
  function pointerEnd(e) {
    if (!pointers.has(e.pointerId)) return;
    const canPick = e.type === 'pointerup' && pointers.size === 1 && single && !single.moved;
    pointers.delete(e.pointerId);
    if (canPick && engine.pick(e.clientX, e.clientY)) { syncAim(); $('status').textContent = '撞击点已更新 · 金色箭头指示发射方向'; }
    if (pointers.size === 0) single = gesture = null;
    else { const p = [...pointers.values()][0]; single = { ...p, moved: true }; gesture = multiBaseline(); }
  }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, pointerEnd);
  canvas.addEventListener('wheel', e => { if (modalOpen()) return; e.preventDefault(); engine.orbit.distance = clamp(engine.orbit.distance * Math.exp(e.deltaY * .001), 19, 115); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  document.querySelectorAll('[data-weapon]').forEach(button => button.addEventListener('click', () => {
    if (engine.state !== 'ready') return; weapon = button.dataset.weapon; engine.weapon = weapon;
    document.querySelectorAll('[data-weapon]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    $('status').textContent = weapon === 'meteor' ? '陨石 · 炽热贯穿与大范围粉碎' : weapon === 'ball' ? '铁球 · 重击贯穿与承重破坏' : '火箭 · 高速贯穿与连锁爆破';
  }));
  $('fire').onclick = () => { if (modalOpen() || paused) return; unlockAudio(); if (engine.state === 'finished') reset(); else engine.fire(weapon); };
  $('reset').onclick = reset; $('again').onclick = () => { hideModal('result'); reset(); }; $('inspect').onclick = () => hideModal('result');
  $('home').onclick = () => engine.resetCamera();
  $('zoomIn').onclick = () => { engine.orbit.distance = clamp(engine.orbit.distance * .84, 19, 115); };
  $('zoomOut').onclick = () => { engine.orbit.distance = clamp(engine.orbit.distance * 1.19, 19, 115); };
  $('aimToggle').onclick = () => { $('aimPanel').hidden = !$('aimPanel').hidden; $('aimToggle').setAttribute('aria-expanded', String(!$('aimPanel').hidden)); };
  $('height').oninput = e => { engine.aim.height = Number(e.target.value); syncAim(); };
  $('angle').oninput = e => { engine.aim.angle = Number(e.target.value); syncAim(); };
  $('pauseBtn').onclick = () => {
    paused = !paused; $('pauseBtn').setAttribute('aria-pressed', String(paused));
    syncAudioPause();
    $('pauseBtn').innerHTML = paused ? '<span style="font-size:12px">继续</span>' : '<svg><use href="#i-pause"/></svg>';
    $('status').textContent = paused ? '已暂停 · 点继续恢复' : '继续观察你的破坏实验';
  };
  $('sound').onclick = () => {
    soundOn = !soundOn; $('sound').setAttribute('aria-pressed', String(soundOn)); $('sound').style.opacity = soundOn ? '1' : '.5';
    $('sound').setAttribute('aria-label', soundOn ? '关闭音效' : '打开音效'); audio?.setEnabled(soundOn); if (soundOn) unlockAudio();
    toast(soundOn ? '音效已打开' : '音效已关闭');
  };
  $('qualityBtn').onclick = () => { const modes = ['balanced', 'low', 'high']; chooseQuality(modes[(modes.indexOf(quality) + 1) % 3]); toast('已切换' + qualityNames[quality] + '画质'); };
  $('helpBtn').onclick = () => showModal('help'); $('closeHelp').onclick = () => hideModal('help');
  $('fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else toast('这款浏览器可用“添加到主屏幕”获得更完整的画面');
    } catch { toast('可横屏游玩，或在浏览器菜单中添加到主屏幕'); }
  };
  document.addEventListener('keydown', e => {
    if (modalOpen()) {
      const modal = !$('help').hidden ? $('help') : $('result');
      if (e.key === 'Escape') { hideModal(modal.id); return; }
      if (e.key === 'Tab') {
        const buttons = [...modal.querySelectorAll('button:not([disabled])')], first = buttons[0], last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      return;
    }
    if (/INPUT|BUTTON|SELECT/.test(document.activeElement.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) $('fire').click(); }
    if (e.code === 'ArrowLeft') engine.orbit.yaw += .12;
    if (e.code === 'ArrowRight') engine.orbit.yaw -= .12;
  });
  window.addEventListener('resize', () => engine.resize());
  window.visualViewport?.addEventListener('resize', () => engine.resize());
  document.addEventListener('visibilitychange', () => {
    prev = 0; elapsed = 0; pointers.clear(); single = gesture = null;
    if (document.hidden) { cancelAnimationFrame(frameId); }
    else { frameId = requestAnimationFrame(frame); }
  });
  function frame(now) {
    if (document.hidden) return;
    frameId = requestAnimationFrame(frame);
    if (!prev) { prev = now; return; }
    elapsed += (now - prev) / 1000; prev = now;
    const interval = 1 / engine.profile.targetFps;
    if (elapsed < interval - .001) return;
    const dt = Math.min(elapsed, .1); elapsed = 0;
    if (!paused && !modalOpen()) engine.step(dt);
    engine.render();
    if (now - lastHud > 220) { updateHud(); lastHud = now; }
    // Sustained slow frames reduce fill rate and shadow cost once, with visible notice.
    if (!paused && !modalOpen() && autoQuality && quality !== 'low') {
      badFrames = dt > .052 ? badFrames + 1 : Math.max(0, badFrames - 1);
      if (badFrames > 45) { chooseQuality('low', true); toast('已自动切换省电画质，让运行更轻松'); }
    }
  }
  frameId = requestAnimationFrame(frame);
})();
