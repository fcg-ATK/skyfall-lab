/* Original, synthesized effects. No downloaded samples or external audio assets. */
(function () {
  'use strict';
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  class SkyfallAudio {
    constructor() {
      this.context = null; this.enabled = true; this.paused = false; this.hidden = false;
      this.sources = new Set(); this.lastEvents = new Map(); this.pending = [];
      this.maxSources = 28; this.resuming = null;
    }
    get blocked() { return !this.enabled || this.paused || this.hidden; }
    unlock() {
      if (this.blocked) return Promise.resolve(false);
      try {
        if (!this.context) {
          const Context = window.AudioContext || window.webkitAudioContext;
          if (!Context) return Promise.resolve(false);
          const ctx = this.context = new Context();
          this.master = ctx.createGain(); this.master.gain.value = .66;
          this.compressor = ctx.createDynamicsCompressor();
          const settings = { threshold: -16, knee: 16, ratio: 10, attack: .003, release: .24 };
          for (const [key, value] of Object.entries(settings)) this.compressor[key].value = value;
          this.master.connect(this.compressor); this.compressor.connect(ctx.destination);
          this.noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 2), ctx.sampleRate);
          this.debris = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 2), ctx.sampleRate);
          const white = this.noise.getChannelData(0), debris = this.debris.getChannelData(0);
          let grain = 0;
          for (let i = 0; i < white.length; i++) {
            white[i] = Math.random() * 2 - 1;
            // Sparse, uneven clicks form the settling debris, not continuous static.
            if (Math.random() < 48 / ctx.sampleRate) grain = .25 + Math.random() * .75;
            grain *= .992;
            debris[i] = white[i] * grain;
          }
        }
        // A prior resume may still be blocked by autoplay policy. Every new gesture
        // must reach the native API while its user activation is available.
        return this.resume(true);
      } catch {
        this.stop(); return Promise.resolve(false);
      }
    }
    resume(retry = false) {
      const ctx = this.context;
      if (!ctx || this.blocked || ctx.state === 'closed') return Promise.resolve(false);
      if (ctx.state === 'running') return Promise.resolve(true);
      if (!this.resuming || retry) {
        const attempt = Promise.resolve(ctx.resume()).then(() => {
          if (this.blocked) { this.suspend(); return false; }
          const pending = this.pending.splice(0);
          for (const [kind, data] of pending) this.play(kind, data);
          return ctx.state === 'running';
        }).catch(() => {
          if (this.resuming === attempt) this.pending.length = 0;
          return false;
        }).finally(() => { if (this.resuming === attempt) this.resuming = null; });
        this.resuming = attempt;
      }
      return this.resuming;
    }
    suspend() {
      try { this.context?.suspend()?.catch(() => {}); } catch { /* A closed context is already silent. */ }
    }
    syncState() {
      if (this.blocked) { this.stop(); this.suspend(); }
      else { try { this.resume(); } catch { /* Playback remains optional. */ } }
    }
    setEnabled(value) { this.enabled = Boolean(value); this.syncState(); }
    setPaused(value) { this.paused = Boolean(value); this.syncState(); }
    setHidden(value) { this.hidden = Boolean(value); this.syncState(); }
    release(voice, stop = false) {
      if (!this.sources.delete(voice)) return;
      voice.source.onended = null;
      if (stop) { try { voice.source.stop(this.context.currentTime); } catch {} }
      for (const node of voice.nodes) { try { node.disconnect(); } catch {} }
    }
    stop() {
      this.pending.length = 0;
      for (const voice of [...this.sources]) this.release(voice, true);
      this.lastEvents.clear();
    }
    reset() { this.stop(); }
    voice(source, nodes, duration, volume, delay = 0, attack = .004) {
      // Steal the oldest tail before connecting a new source: the graph stays bounded.
      while (this.sources.size >= this.maxSources) this.release(this.sources.values().next().value, true);
      const ctx = this.context, now = ctx.currentTime + delay, gain = ctx.createGain();
      let tail = source;
      for (const node of nodes) { tail.connect(node); tail = node; }
      tail.connect(gain); gain.connect(this.master);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.linearRampToValueAtTime(volume, now + attack);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      const voice = { source, nodes: [source, ...nodes, gain] };
      this.sources.add(voice); source.onended = () => this.release(voice);
      source.start(now); source.stop(now + duration + .015);
    }
    noiseHit(duration, volume, from, to, type = 'lowpass', debris = false, delay = 0) {
      const ctx = this.context, now = ctx.currentTime + delay;
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter();
      source.buffer = debris ? this.debris : this.noise;
      filter.type = type; filter.Q.value = type === 'bandpass' ? .75 : .6;
      filter.frequency.setValueAtTime(from, now);
      filter.frequency.exponentialRampToValueAtTime(to, now + duration);
      this.voice(source, [filter], duration, volume, delay, debris ? .025 : .002);
    }
    tone(duration, volume, from, to, type = 'sine', delay = 0, attack = .004) {
      const source = this.context.createOscillator(), now = this.context.currentTime + delay;
      source.type = type; source.frequency.setValueAtTime(from, now);
      source.frequency.exponentialRampToValueAtTime(to, now + duration);
      this.voice(source, [], duration, volume, delay, attack);
    }
    play(kind, data = {}) {
      if (kind === 'reset') { this.reset(); return; }
      if (this.blocked || !this.context) return;
      if (!['launch', 'impact', 'penetration', 'fracture', 'strain', 'floorImpact'].includes(kind)) return;
      if (kind === 'strain' && (!Number.isFinite(data.energy ?? 1) || (data.energy ?? 1) <= 0)) return;
      if (this.context.state !== 'running') {
        if (this.resuming && this.pending.length < 4) this.pending.push([kind, data]);
        return;
      }
      const now = this.context.currentTime, floor = data.floor ?? 'global';
      const key = kind + ':' + (kind === 'fracture' || kind === 'floorImpact' || kind === 'strain' ? floor : 'weapon');
      const cooldown = kind === 'strain' ? .55 : kind === 'floorImpact' ? .28 : kind === 'fracture' ? .085 : kind === 'penetration' ? .075 : .06;
      if (now - (this.lastEvents.get(key) ?? -Infinity) < cooldown) return;
      // Reap old keys so unknown floor identifiers cannot grow this map indefinitely.
      for (const [entry, time] of this.lastEvents) if (now - time > 2) this.lastEvents.delete(entry);
      this.lastEvents.set(key, now);
      const weapon = data.weapon || 'rocket';
      const energy = clamp(Math.sqrt(Number.isFinite(data.energy) ? Math.max(0, data.energy) : 1), .35, 1.15);
      try {
        if (kind === 'launch') {
          if (weapon === 'rocket') {
            this.noiseHit(.55, .17, 420, 1900, 'bandpass');
            this.tone(.38, .035, 110, 210, 'sawtooth');
          } else if (weapon === 'meteor') {
            this.noiseHit(.8, .15, 280, 1500, 'lowpass'); this.tone(.7, .15, 65, 42);
          } else {
            this.noiseHit(.24, .07, 850, 300, 'bandpass'); this.tone(.3, .07, 190, 105, 'triangle');
          }
        } else if (kind === 'impact') {
          if (weapon === 'meteor') {
            this.noiseHit(1.35, .30, 950, 65); this.tone(1.2, .38, 63, 25);
            this.tone(.65, .16, 130, 45); this.noiseHit(.11, .13, 2400, 550, 'highpass');
          } else if (weapon === 'ball') {
            this.tone(.62, .29, 79, 33); this.tone(.52, .17, 193, 148, 'triangle');
            this.tone(.31, .08, 409, 310); this.noiseHit(.24, .19, 2100, 220);
          } else {
            this.noiseHit(.09, .25, 3800, 900, 'highpass');
            this.noiseHit(.44, .28, 1700, 100); this.tone(.43, .34, 116, 36);
          }
        } else if (kind === 'penetration') {
          this.noiseHit(.18, .12, weapon === 'meteor' ? 900 : 2600, 260, 'bandpass');
          this.tone(.3, .13, weapon === 'meteor' ? 68 : 112, 37);
        } else if (kind === 'fracture') {
          this.noiseHit(.12, .105 * energy, 4400, 1400, 'bandpass');
          this.noiseHit(.2, .095 * energy, 850, 140);
        } else if (kind === 'strain') {
          // A quiet short bend/grind marks actual loss of bearing. The long
          // rumble belongs to later collisions, not an invented collapse timer.
          this.tone(.36, .045 * energy, 148, 83, 'triangle', 0, .04);
          this.noiseHit(.32, .065 * energy, 630, 180, 'bandpass', true);
        } else if (kind === 'floorImpact') {
          this.tone(.38, .17 * energy, 83, 38);
          this.tone(1.3, .18 * energy, 57, 27, 'sine', .075, .095);
          this.noiseHit(.23, .16 * energy, 850, 100);
          this.noiseHit(1.03, .19 * energy, 1900, 320, 'bandpass', true, .035);
        }
      } catch { this.stop(); /* Hardware/context errors must never interrupt the game. */ }
    }
  }
  window.SkyfallAudio = SkyfallAudio;
})();
