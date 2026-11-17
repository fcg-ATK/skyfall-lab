/* Browser UI, gestures and audio. All resources are relative for GitHub Pages. */
(async function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const qualityNames = { balanced: '平衡', low: '省电', high: '精细' };
  let engine, paused = false, weapon = 'rocket', soundOn = true, best = 0, quality = 'balanced';
  const audio = typeof window.SkyfallAudio === 'function' ? new window.SkyfallAudio() : null;
  let prev = 0, elapsed = 0, lastHud = 0, toastTimer, frameId;
  let restoredFocus, resultShown = false;
  const debugEnabled = new URLSearchParams(location.search).get('debug') === '1';
  let debugFrames = 0, debugElapsed = 0, debugFps = 0;
  const pointers = new Map(); let gesture, single;
  const canvas = $('world'), downloads = new Map();
  let startupFailed = false, startupTimer;
  const inWeChat = typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent || '');
  $('browserHint').hidden = !inWeChat;
  $('debugPanel').hidden = !debugEnabled;
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
  try { best = Number(localStorage.getItem('skyfall-local-detail-preview-best')) || 0; quality = localStorage.getItem('skyfall-mobile-quality') || 'balanced'; } catch {}
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
  function syncAudioPause() {
    const blocked = paused || modalOpen();
    audio?.setPaused(blocked);
    if (engine) engine.targetHighlightPaused = blocked;
    updateSupportGuide();
  }
  function showModal(id) {
    pointers.clear(); single = gesture = null; restoredFocus = document.activeElement;
    $(id).hidden = false; $(id === 'help' ? 'closeHelp' : 'again').focus();
    syncAudioPause(); updateDebug();
  }
  function hideModal(id) { $(id).hidden = true; restoredFocus?.focus?.(); prev = 0; syncAudioPause(); updateDebug(); }
  function updateDebug() {
    $('debugPanel').hidden = !debugEnabled || modalOpen();
    if ($('debugPanel').hidden || !engine?.loaded) return;
    const m = engine.metrics();
    const selected = engine.aimValid === false ? null : engine.supportInsight;
    const architecture = engine.parts || [];
    const directCells = new Set(architecture.filter(p => p.direct).map(p => p.cell));
    const structural = architecture.filter(p => p.active && !p.gone);
    const coupled = structural.filter(p => !directCells.has(p.cell));
    $('debugSummary').textContent = 'FPS ' + debugFps + ' · Draw ' + m.drawCalls;
    const fixed = value => Number(value || 0).toFixed(2);
    $('debugDetails').textContent = [
      'moving ' + m.moving + ' · relevantMoving ' + m.relevantMoving,
      'structural ' + structural.length + ' · coupled ' + coupled.length,
      'stillTime ' + fixed(m.stillTime) + 's · damageQuietTime ' + fixed(m.damageQuietTime) + 's',
      'shots ' + m.shots + ' · remainingAmmo ' + engine.remainingAmmo,
      'hitCount ' + (m.shotHits || []).length + ' · shotHits [' + (m.shotHits || []).join(', ') + ']',
      'shotFractures ' + ((m.shotFractures || []).map(f => f.id + ':' + f.cause).join(', ') || '—'),
      ...(selected ? [
        'selected #' + selected.id + ' · state ' + selected.state + ' · anchored ' + selected.anchored,
        'supportIds [' + (selected.supportIds || []).join(', ') + '] · carriedIds [' + (selected.carriedIds || []).join(', ') + ']',
        'load/capacity ' + fixed(selected.load) + '/' + fixed(selected.capacity) + ' · unbracedHeight ' + fixed(selected.unbracedHeight),
        'reason ' + selected.reason + ' · criticalReason ' + (selected.criticalReason || '—'),
      ] : ['selected support —']),
      'support · floor live bearing ratio reason',
      ...(m.support || []).map(s => s.floor + 'F · ' + s.live + ' · ' + s.bearing + ' · ' + fixed(s.ratio) + ' · ' + s.reason + ' · bridged [' + (s.bridged || []).join(', ') + ']'
        + (s.overloaded ? ' · overloaded [' + s.overloaded.join(', ') + ']' : '')
        + (s.failures ? ' · failures [' + s.failures.map(f => f.id + ':' + f.reason).join(', ') + ']' : '')),
    ].join('\n');
  }
  function updateHud() {
    if (!engine) return;
    $('score').textContent = engine.score.toLocaleString(); $('damage').textContent = engine.damage + '%';
    $('ammo').textContent = engine.freeMode ? '∞' : engine.remainingAmmo + ' / ' + engine.maxShots;
    const ready = engine.state === 'ready' && !engine.aimTween, finished = engine.state === 'finished';
    const emptyTarget = ready && engine.aimValid === false;
    $('fire').disabled = !engine.loaded || emptyTarget || (!ready && !finished);
    $('fire').setAttribute('data-aim-empty', String(emptyTarget));
    $('fire').innerHTML = '<span>' + (ready ? emptyTarget ? '重新瞄准' : '发射' : finished ? '重建' : engine.aimTween ? '调整瞄准' : '观察倒塌') + '</span><svg><use href="#i-arrow"/></svg>';
    document.querySelectorAll('[data-weapon]').forEach(b => { b.disabled = !ready; });
    $('height').disabled = $('angle').disabled = !ready;
    $('autoAimToggle').disabled = engine.state !== 'ready';
    $('supportGuideToggle').disabled = engine.state !== 'ready';
    updateSupportGuide();
    updateDebug();
  }
  function updateSupportGuide() {
    const visible = Boolean(engine?.loaded && engine.supportGuideEnabled && engine.state === 'ready' && !engine.aimTween && !paused && !modalOpen());
    $('supportGuide').hidden = !visible;
    $('game').setAttribute('data-support-visible', String(visible));
    if (!visible) return;
    const insight = engine.supportInsight;
    let message = '点选楼体，查看承重关系';
    if (engine.aimValid === false) message = '点选残楼，查看它由哪里支撑';
    else if (insight?.criticalReason === 'unbraced load exceeds capacity') message = '侧向支撑不足，此处承重已超限';
    else if (insight?.criticalReason) message = '此处承重吃紧，失效可能引发连锁坍塌';
    else if (insight?.supportIds?.length && insight?.carriedIds?.length) message = '下方' + insight.supportIds.length + '处支撑 · 承托上方' + insight.carriedIds.length + '片楼体';
    else if (insight?.supportIds?.length) message = '下方' + insight.supportIds.length + '处结构仍在支撑';
    else if (insight?.carriedIds?.length) message = '这里承托着上方' + insight.carriedIds.length + '片楼体';
    else if (insight?.anchored) message = '此处直接落地承重';
    $('supportHint').textContent = message;
    $('supportGuide').setAttribute('data-critical', String(Boolean(engine.aimValid && insight?.criticalReason)));
  }
  function syncSupportGuide() {
    $('supportGuideToggle').setAttribute('aria-pressed', String(engine.supportGuideEnabled));
    $('supportGuideToggle').textContent = '承重提示：' + (engine.supportGuideEnabled ? '开' : '关');
  }
  function onEvent(name, data) {
    audio?.play(name, data);
    if (name === 'launch') { $('status').textContent = '已发射 · 拖动视角观察'; $('aimPanel').hidden = true; $('aimToggle').setAttribute('aria-expanded', 'false'); }
    if (name === 'impact') $('status').textContent = '命中！观察失稳与连锁坍塌';
    if (name === 'strain') $('status').textContent = data?.kind === 'tipping' ? '支撑断开 · 楼体正在偏转' : '支撑失效 · 楼层正在下坠';
    if (name === 'miss') $('status').textContent = '这次没有命中 · 调低高度或换个方向';
    if (name === 'emptyAim') { toast('这里已经空了，换个位置试试'); $('status').textContent = '重新瞄准 · 暖色楼体仍可打'; }
    if (name === 'aimEmpty') {
      toast('点在空处了，点楼体'); $('status').textContent = '重新瞄准 · 暖色楼体仍可打'; syncAim();
    }
    if (name === 'aimSelected') {
      clearTimeout(toastTimer); $('toast').hidden = true;
      $('status').textContent = data?.assisted ? '已辅助瞄准附近楼体 · 可发射' : '已瞄准楼体 · 可发射'; syncAim();
    }
    if (name === 'shotFinished') {
      $('status').textContent = '本发拆除' + data.shotDamage + '% · 累计' + data.damage + '% · 已用' + data.shots + '发';
      syncAim(); engine.refreshAimValidity?.();
      if (engine.aimValid === false && !engine.aimTween) $('status').textContent += ' · 暖色楼体仍可打';
    }
    if (name === 'finished' && !resultShown) {
      resultShown = true; $('finalScore').textContent = data.score.toLocaleString(); $('finalDamage').textContent = data.damage + '%';
      const grade = data.cleared && data.damage === 100 ? 'S' : data.damage >= 80 ? 'A' : data.damage >= 60 ? 'B' : 'C';
      $('finalGrade').textContent = grade; $('finalGrade').setAttribute('data-grade', grade);
      $('finalShots').textContent = String(data.shots); $('finalBonus').textContent = String(data.ammoBonus || 0);
      $('ammoBonusRow').hidden = !data.cleared || !(data.ammoBonus > 0);
      $('resultTitle').textContent = data.cleared ? '全楼拆除完成。' : '弹药用尽，本轮结束。';
      $('resultHint').textContent = grade === 'S' ? '换一个落点，再试一种拆法。' : grade === 'A' ? '距S级还差' + (100 - data.damage) + '%' : grade === 'B' ? '距A级还差' + (80 - data.damage) + '%' : '距B级还差' + (60 - data.damage) + '%';
      $('status').textContent = '挑战结束';
      best = Math.max(best, data.score); $('best').textContent = best.toLocaleString();
      try { localStorage.setItem('skyfall-local-detail-preview-best', String(best)); } catch {}
      showModal('result');
    }
    updateHud();
  }
  function syncAim(clampInput = false) {
    const limits = engine.aimLimits();
    $('height').min = limits.min; $('height').max = limits.max;
    if (clampInput) {
      engine.aim.height = clamp(engine.aim.height, limits.min, limits.max);
      engine.direction();
    }
    $('angle').min = -Math.floor(Math.atan2(Math.max(0, engine.aim.height - 1.5), 42) * 180 / Math.PI);
    $('height').value = engine.aim.height; $('angle').value = engine.aim.angle;
    $('heightValue').textContent = engine.aim.height.toFixed(1) + ' m' + (engine.aim.height > limits.max ? '（高于残楼）' : '');
    $('angleValue').textContent = engine.aim.angle + '°';
  }
  function reset() {
    if (!engine?.loaded) return;
    audio?.reset();
    const autoAim = engine.autoAim, supportGuideEnabled = engine.supportGuideEnabled;
    engine.reset(); engine.autoAim = autoAim; engine.supportGuideEnabled = supportGuideEnabled; syncSupportGuide(); resultShown = false; paused = false; $('result').hidden = true;
    syncAudioPause();
    $('pauseBtn').setAttribute('aria-pressed', 'false'); $('pauseBtn').innerHTML = '<svg><use href="#i-pause"/></svg>';
    $('status').textContent = '建筑已重建 · 自由试拆'; syncAim(); refreshAim();
  }
  function chooseQuality(mode) {
    quality = mode; engine.setQuality(mode); $('qualityBtn').textContent = '画质：' + qualityNames[mode];
    try { localStorage.setItem('skyfall-mobile-quality', mode); } catch {}
  }
  function syncAutoAim() {
    $('autoAimToggle').setAttribute('aria-pressed', String(engine.autoAim));
    $('autoAimToggle').textContent = '辅助瞄准：' + (engine.autoAim ? '开' : '关');
  }
  function cancelAimTween() {
    if (!engine.aimTween) return;
    engine.aimTween = null; syncAim(); updateHud();
  }
  function refreshAim(manual = false) {
    const wasValid = engine.aimValid;
    if (engine.state === 'ready') engine.refreshAimValidity?.({ manual });
    if (engine.state === 'ready' && !engine.aimTween && wasValid !== engine.aimValid) {
      if (engine.aimValid) {
        clearTimeout(toastTimer); $('toast').hidden = true; $('status').textContent = '已瞄准楼体 · 可发射';
      } else $('status').textContent = '重新瞄准 · 暖色楼体仍可打';
    }
    updateHud();
  }
  try {
    engine = new SkyfallEngine($('world'), onEvent);
    engine.freeMode = true;
    engine.autoAim = false; syncAutoAim();
    engine.supportGuideEnabled = true; syncSupportGuide();
    chooseQuality(quality); $('loadingText').textContent = '正在载入建筑与街区…';
    const deadline = new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('场景准备超时，请重新加载或换系统浏览器打开。')), 180000); });
    await Promise.race([engine.load(loadingProgress), deadline]); clearTimeout(startupTimer);
    if (startupFailed) return;
    $('loading').hidden = true; syncAudioPause(); syncAim(); refreshAim();
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
        cancelAimTween();
        engine.orbit.distance = clamp(engine.orbit.distance * gesture.span / next.span, 19, 115);
        engine.orbit.height = clamp(engine.orbit.height + (next.cy - gesture.cy) * .055, 1.5, 33);
        refreshAim(true);
      }
      gesture = next;
    } else if (single) {
      if (Math.hypot(e.clientX - single.x, e.clientY - single.y) > 5) single.moved = true;
      if (single.moved) { cancelAimTween(); engine.orbit.yaw -= dx * .007; engine.orbit.pitch = clamp(engine.orbit.pitch + dy * .005, -.04, 1.2); refreshAim(true); }
    }
  });
  function pointerEnd(e) {
    if (!pointers.has(e.pointerId)) return;
    const canPick = e.type === 'pointerup' && pointers.size === 1 && single && !single.moved;
    pointers.delete(e.pointerId);
    if (canPick) cancelAimTween();
    if (canPick) { engine.pick(e.clientX, e.clientY); syncAim(); updateHud(); }
    if (pointers.size === 0) single = gesture = null;
    else { const p = [...pointers.values()][0]; single = { ...p, moved: true }; gesture = multiBaseline(); }
  }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, pointerEnd);
  canvas.addEventListener('wheel', e => { if (modalOpen()) return; e.preventDefault(); cancelAimTween(); engine.orbit.distance = clamp(engine.orbit.distance * Math.exp(e.deltaY * .001), 19, 115); refreshAim(true); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  document.querySelectorAll('[data-weapon]').forEach(button => button.addEventListener('click', () => {
    if (engine.state !== 'ready') return; weapon = button.dataset.weapon; engine.weapon = weapon;
    document.querySelectorAll('[data-weapon]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    $('status').textContent = weapon === 'meteor' ? '陨石 · 接触后范围冲击，波及相邻楼层' : weapon === 'ball' ? '铁球 · 局部穿透，最多击穿两处结构' : '火箭 · 沿列下切，瞄准中下部承重列';
  }));
  $('fire').onclick = () => { if (modalOpen() || paused) return; unlockAudio(); if (engine.state === 'finished') reset(); else engine.fire(weapon); };
  $('reset').onclick = reset; $('again').onclick = () => { hideModal('result'); reset(); };
  if (debugEnabled) $('debugToggle').onclick = () => {
    $('debugDetails').hidden = !$('debugDetails').hidden;
    $('debugToggle').setAttribute('aria-expanded', String(!$('debugDetails').hidden));
    $('debugToggle').textContent = $('debugDetails').hidden ? '展开' : '收起'; updateDebug();
  };
  $('home').onclick = () => { cancelAimTween(); engine.resetCamera(); refreshAim(true); };
  $('zoomIn').onclick = () => { cancelAimTween(); engine.orbit.distance = clamp(engine.orbit.distance * .84, 19, 115); refreshAim(true); };
  $('zoomOut').onclick = () => { cancelAimTween(); engine.orbit.distance = clamp(engine.orbit.distance * 1.19, 19, 115); refreshAim(true); };
  $('aimToggle').onclick = () => { $('aimPanel').hidden = !$('aimPanel').hidden; $('aimToggle').setAttribute('aria-expanded', String(!$('aimPanel').hidden)); };
  $('autoAimToggle').onclick = () => {
    engine.autoAim = !engine.autoAim;
    if (!engine.autoAim) cancelAimTween();
    else if (engine.state === 'ready') engine.recoverAim?.();
    syncAutoAim(); syncAim(); refreshAim();
  };
  $('supportGuideToggle').onclick = () => {
    engine.supportGuideEnabled = !engine.supportGuideEnabled; syncSupportGuide(); updateHud();
  };
  $('height').oninput = e => { cancelAimTween(); engine.aim.height = Number(e.target.value); syncAim(true); refreshAim(true); };
  $('angle').oninput = e => { cancelAimTween(); engine.aim.angle = Number(e.target.value); syncAim(true); refreshAim(true); };
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
    if (e.code === 'ArrowLeft') { cancelAimTween(); engine.orbit.yaw += .12; refreshAim(true); }
    if (e.code === 'ArrowRight') { cancelAimTween(); engine.orbit.yaw -= .12; refreshAim(true); }
  });
  window.addEventListener('resize', () => engine.resize());
  window.visualViewport?.addEventListener('resize', () => engine.resize());
  document.addEventListener('visibilitychange', () => {
    prev = 0; elapsed = 0; debugFrames = 0; debugElapsed = 0; pointers.clear(); single = gesture = null;
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
    // Engine bounds physical substeps; preserve wall time for the stillness timer.
    const dt = elapsed; elapsed = 0;
    const wasAiming = Boolean(engine.aimTween);
    if (!paused && !modalOpen()) engine.step(dt);
    if (wasAiming && !engine.aimTween) {
      engine.refreshAimValidity?.();
      if (engine.state === 'ready') {
        $('status').textContent = engine.aimValid ? '辅助瞄准已就绪 · 可发射' : '重新瞄准 · 暖色楼体仍可打';
        if (engine.aimValid) { clearTimeout(toastTimer); $('toast').hidden = true; }
      }
    }
    if (wasAiming || engine.aimTween) { syncAim(); updateHud(); }
    engine.render();
    if (debugEnabled) {
      debugFrames++; debugElapsed += dt;
      if (debugElapsed >= .5) {
        debugFps = Math.round(debugFrames / debugElapsed); debugFrames = 0; debugElapsed = 0; updateDebug();
      }
    }
    if (now - lastHud > 220) { updateHud(); lastHud = now; }
  }
  frameId = requestAnimationFrame(frame);
})();
