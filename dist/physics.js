/* Lightweight game rules. Collapse uses live support/contact motion, not an engineering simulation. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SkyfallPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const finiteVector = (v) => v && ['x', 'y', 'z'].every(axis => Number.isFinite(v[axis]));
  const PROFILES = {
    low: { pixelRatio: 0.9, maxPixels: 600000, dust: 45, fragments: 100, shadows: false, targetFps: 30 },
    balanced: { pixelRatio: 1.25, maxPixels: 1100000, dust: 80, fragments: 200, shadows: true, targetFps: 30 },
    high: { pixelRatio: 1.5, maxPixels: 1800000, dust: 120, fragments: 320, shadows: true, targetFps: 60 },
  };
  const WEAPONS = {
    ball: { radius: 6.5 },
    rocket: { radius: 4.2 },
    meteor: { radius: 5.5 },
  };

  function qualityProfile(mode) {
    return { ...(Object.hasOwn(PROFILES, mode) ? PROFILES[mode] : PROFILES.balanced) };
  }

  // Slab test over a finite swept segment. Expanding by radius is a conservative
  // broad phase for a spherical projectile; the renderer may refine via mesh hit.
  function segmentBox(start, end, center, halfExtents, radius = 0) {
    if (![start, end, center, halfExtents].every(finiteVector) || !Number.isFinite(radius)) return null;
    if (['x', 'y', 'z'].some(axis => halfExtents[axis] < 0)) return null;
    const padding = Math.max(0, radius);
    let enter = 0, leave = 1;
    for (const axis of ['x', 'y', 'z']) {
      const min = center[axis] - halfExtents[axis] - padding;
      const max = center[axis] + halfExtents[axis] + padding;
      const delta = end[axis] - start[axis];
      if (Math.abs(delta) < 1e-12) {
        if (start[axis] < min || start[axis] > max) return null;
        continue;
      }
      let first = (min - start[axis]) / delta;
      let last = (max - start[axis]) / delta;
      if (first > last) [first, last] = [last, first];
      enter = Math.max(enter, first);
      leave = Math.min(leave, last);
      if (enter > leave) return null;
    }
    return enter;
  }

  function distanceToSector(point, piece) {
    // Imported mesh AABBs overlap neighbouring sectors. Their distance can be
    // zero several cells away and is only a collision broad phase, not a blast
    // distance. Structural damage uses sector centres on the struck storey.
    return Math.hypot(point.x - piece.center.x, point.z - piece.center.z);
  }

  function collapsePlan(pieces, hitIds, weapon, random = () => 0.5) {
    if (!Array.isArray(pieces) || !hitIds || typeof hitIds[Symbol.iterator] !== 'function') return [];
    const unique = new Map();
    for (const piece of pieces) {
      if (!piece || piece.id == null || !Number.isInteger(piece.floor) || !finiteVector(piece.center)
          || !finiteVector(piece.halfExtents) || piece.halfExtents.x <= 0 || piece.halfExtents.z <= 0) continue;
      if (!unique.has(piece.id)) unique.set(piece.id, piece);
    }
    const hitSet = new Set(Array.from(hitIds).filter(id => unique.has(id)));
    if (!hitSet.size) return [];
    const config = Object.hasOwn(WEAPONS, weapon) ? WEAPONS[weapon] : WEAPONS.rocket;
    const sample = () => {
      const n = typeof random === 'function' ? random() : 0.5;
      return Number.isFinite(n) ? clamp(n, 0, 1) : 0.5;
    };
    const floorMap = new Map();
    for (const piece of unique.values()) {
      if (!floorMap.has(piece.floor)) floorMap.set(piece.floor, []);
      floorMap.get(piece.floor).push(piece);
    }
    const plan = new Map();
    const add = (id, delay) => {
      if (!plan.has(id) || delay < plan.get(id)) plan.set(id, delay);
    };
    for (const id of hitSet) add(id, 0);

    // Lateral blast stays on the struck storey. The precise ball has no blast,
    // even when imported sector bounds or centres overlap.
    for (const id of hitSet) {
      const hit = unique.get(id);
      for (const piece of floorMap.get(hit.floor)) {
        if (hitSet.has(piece.id)) continue;
        const distance = distanceToSector(hit.center, piece);
        if (config.radius > 0 && distance <= config.radius) add(piece.id, 0.28 + distance / 130 + sample() * 0.02);
      }
    }

    // One local cutting charge follows the first real contact down its own
    // bearing for at most two more storeys. Check every physical link and stop
    // at the first gap; missing metadata cannot infer a shared column.
    if (config === WEAPONS.rocket) {
      let hit = unique.get(hitSet.values().next().value);
      if (hit.cell != null && hit.halfExtents.y > 0) {
        for (let depth = 1; depth <= 2; depth++) {
          const candidates = [...unique.values()].filter(piece => {
            if (piece.floor !== hit.floor - 1 || piece.cell !== hit.cell || piece.halfExtents.y <= 0) return false;
            const alignment = Math.min(hit.halfExtents.x, hit.halfExtents.z, piece.halfExtents.x, piece.halfExtents.z) * 0.5;
            const gap = hit.center.y - hit.halfExtents.y - piece.center.y - piece.halfExtents.y;
            return distanceToSector(hit.center, piece) <= alignment && Math.abs(gap) <= 0.2;
          }).sort((a, b) => distanceToSector(hit.center, a) - distanceToSector(hit.center, b));
          if (!candidates.length) break;
          hit = candidates[0];
          add(hit.id, 0.16 * depth);
        }
      }
    }

    return [...plan].map(([id, delay]) => ({ id, delay })).sort((a, b) => a.delay - b.delay);
  }

  function dustBudget(brokenVolume, speed, quality = 'balanced') {
    if (!Number.isFinite(brokenVolume) || !Number.isFinite(speed) || brokenVolume <= 0 || speed <= 0) return 0;
    const cap = qualityProfile(quality).dust;
    return Math.min(cap, Math.max(1, Math.floor(Math.sqrt(brokenVolume) * Math.sqrt(speed) * 0.6)));
  }

  return Object.freeze({ segmentBox, collapsePlan, dustBudget, qualityProfile });
});
