/* A subtle residual-structure cue without extra meshes or render passes. */
(function () {
  'use strict';
  const T = window.THREE;
  const warm = new T.Color(0xffd58f);

  function create(parts) {
    const entries = [], byPart = new Map(), copies = new Map();
    let enabled = false;
    function highlightMaterial(original) {
      if (!original) return original;
      if (copies.has(original)) return copies.get(original);
      const copy = original.clone();
      // Keep all authored textures, opacity and lighting response. A small
      // warm fill also lifts dark faces without turning them into solid yellow.
      if (copy.color) copy.color.lerp(warm, .06);
      if (copy.emissive) copy.emissive.lerp(warm, .05);
      copies.set(original, copy);
      return copy;
    }
    for (const part of parts) {
      const group = [];
      part.node.traverse(mesh => {
        if (!mesh.isMesh || !mesh.material) return;
        const original = mesh.material;
        const highlighted = Array.isArray(original) ? original.map(highlightMaterial) : highlightMaterial(original);
        const entry = { part, mesh, original, highlighted };
        entries.push(entry); group.push(entry);
      });
      byPart.set(part, group);
    }
    function visible(mesh) {
      for (let node = mesh; node; node = node.parent) if (!node.visible) return false;
      return true;
    }
    function apply(entry) {
      const value = enabled && !entry.part.gone && visible(entry.mesh) ? entry.highlighted : entry.original;
      if (entry.mesh.material !== value) entry.mesh.material = value;
    }
    function update(value) {
      value = !!value;
      if (value === enabled) return;
      enabled = value;
      for (const entry of entries) apply(entry);
    }
    function refreshPart(part) {
      const group = byPart.get(part);
      if (group) for (const entry of group) apply(entry);
    }
    return { update, refreshPart };
  }
  window.SkyfallTargetHighlight = { create };
})();
