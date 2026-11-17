/* Reuse the authored closed fracture meshes as smaller structural sections. */
(function () {
  'use strict';
  const T = window.THREE;
  const COLUMNS = 6;
  const ROWS = 4;

  function createBatches(parts, materials, model) {
    const capacity = Math.max(...parts.map(part => part.id)) + 1;
    const width = Math.min(1024, T.MathUtils.ceilPowerOfTwo(capacity * 2));
    const height = Math.ceil(capacity * 2 / width);
    const poses = new Float32Array(width * height * 4);
    const texture = new T.DataTexture(poses, width, height, T.RGBAFormat, T.FloatType);
    texture.minFilter = texture.magFilter = T.NearestFilter;
    texture.generateMipmaps = false;
    const batches = [];
    const proxyMaterials = {};
    const declarations = `
attribute float structureId;
uniform sampler2D uStructurePoses;
uniform vec2 uStructureTextureSize;
vec4 structurePose(float index) {
  vec2 pixel = vec2(mod(index, uStructureTextureSize.x), floor(index / uStructureTextureSize.x));
  return texture2D(uStructurePoses, (pixel + .5) / uStructureTextureSize);
}
vec3 structureRotate(vec3 point, vec4 rotation) {
  return point + 2.0 * cross(rotation.xyz, cross(rotation.xyz, point) + rotation.w * point);
}
`;
    function inject(material) {
      material.onBeforeCompile = shader => {
        shader.uniforms.uStructurePoses = { value: texture };
        shader.uniforms.uStructureTextureSize = { value: new T.Vector2(width, height) };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n' + declarations)
          .replace('void main() {', `void main() {
            vec4 sectionPosition = structurePose(structureId * 2.0);
            vec4 sectionRotation = structurePose(structureId * 2.0 + 1.0);`)
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
            objectNormal = structureRotate(objectNormal, sectionRotation);
            #ifdef USE_TANGENT
              objectTangent = structureRotate(objectTangent, sectionRotation);
            #endif`)
          .replace('#include <begin_vertex>', 'vec3 transformed = structureRotate(position, sectionRotation) + sectionPosition.xyz;')
          .replace('#include <project_vertex>', `#include <project_vertex>
            if (sectionPosition.w < .5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
      };
      material.customProgramCacheKey = () => 'skyfall-detailed-structure-v1';
    }
    for (const kind of ['structure', 'glass']) {
      const meshes = parts.flatMap(part => part.node.children.filter(mesh => mesh.userData.structureKind === kind));
      if (!meshes.length) continue;
      const count = meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
      const geometry = new T.BufferGeometry();
      for (const name of ['position', 'normal', 'uv', 'color']) {
        const source = meshes[0].geometry.attributes[name];
        const values = new source.array.constructor(count * source.itemSize);
        let offset = 0;
        for (const mesh of meshes) {
          const attribute = mesh.geometry.attributes[name];
          values.set(attribute.array, offset);
          offset += attribute.array.length;
        }
        geometry.setAttribute(name, new T.BufferAttribute(values, source.itemSize, source.normalized));
      }
      const identifiers = new Float32Array(count);
      let offset = 0;
      for (const mesh of meshes) {
        const size = mesh.geometry.attributes.position.count;
        identifiers.fill(mesh.userData.part.id, offset, offset + size);
        offset += size;
      }
      geometry.setAttribute('structureId', new T.BufferAttribute(identifiers, 1));
      const material = materials[kind];
      inject(material);
      const batch = new T.Mesh(geometry, material);
      batch.name = 'DetailedBuildingBatch_' + kind;
      batch.userData.structureKind = kind;
      batch.userData.isDetailBatch = true;
      batch.frustumCulled = false;
      batch.castShadow = batch.receiveShadow = kind === 'structure';
      const depthMaterial = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, side: T.DoubleSide });
      inject(depthMaterial);
      batch.customDepthMaterial = depthMaterial;
      model.add(batch);
      batches.push(batch);
      // Hidden materials keep precise Three.js raycasting and Box3 bounds on
      // every small section without submitting hundreds of GPU draw calls.
      const proxy = material.clone();
      proxy.visible = false;
      proxyMaterials[kind] = proxy;
      for (const mesh of meshes) mesh.material = proxy;
    }
    function update() {
      for (const part of parts) {
        const index = part.id * 8;
        const position = part.node.position;
        const rotation = part.node.quaternion;
        poses[index] = position.x;
        poses[index + 1] = position.y;
        poses[index + 2] = position.z;
        poses[index + 3] = part.node.visible && !part.gone ? 1 : 0;
        poses[index + 4] = rotation.x;
        poses[index + 5] = rotation.y;
        poses[index + 6] = rotation.z;
        poses[index + 7] = rotation.w;
      }
      texture.needsUpdate = true;
      // The existing residual-building highlight swaps proxy materials. Mirror
      // its two tint values onto the corresponding visible material batch.
      for (const batch of batches) {
        const kind = batch.userData.structureKind;
        const visible = parts.find(part => !part.gone && part.node.visible && part.node.children.some(mesh => mesh.userData.structureKind === kind));
        const source = visible?.node.children.find(mesh => mesh.userData.structureKind === kind)?.material || proxyMaterials[kind];
        batch.material.color.copy(source.color);
        batch.material.emissive.copy(source.emissive);
      }
    }
    function setQuality(profile) {
      for (const batch of batches) batch.castShadow = batch.userData.structureKind === 'structure' && profile.shadows;
    }
    update();
    return { update, setQuality, batches };
  }

  function refine(parts, descriptor, buffer, model, options = {}) {
    if (!parts.length || !descriptor?.pieces?.length) return { parts, descriptor };
    const originals = new Map(parts.map(part => [part.id, part]));
    const floors = [...new Set(parts.map(part => part.floor))].sort((a, b) => a - b);
    const heights = options.floorHeights || floors.map(floor => Math.min(...parts
      .filter(part => part.floor === floor).map(part => part.center.y - part.halfExtents.y)));
    const base = parts.filter(part => part.floor === floors[0]);
    const minX = Math.min(...base.map(part => part.center.x - part.halfExtents.x));
    const maxX = Math.max(...base.map(part => part.center.x + part.halfExtents.x));
    const minZ = Math.min(...base.map(part => part.center.z - part.halfExtents.z));
    const maxZ = Math.max(...base.map(part => part.center.z + part.halfExtents.z));
    const width = (maxX - minX) / COLUMNS;
    const depth = (maxZ - minZ) / ROWS;
    const groups = new Map();
    const fragments = descriptor.pieces.map(fragment => {
      const source = originals.get(fragment.partId);
      if (!source) throw new Error('建筑碎块缺少所属结构');
      const column = T.MathUtils.clamp(Math.floor((fragment.center[0] - minX) / width), 0, COLUMNS - 1);
      const row = T.MathUtils.clamp(Math.floor((fragment.center[2] - minZ) / depth), 0, ROWS - 1);
      const cell = row * COLUMNS + column;
      const id = source.floor * COLUMNS * ROWS + cell;
      if (!groups.has(id)) groups.set(id, { id, floor: source.floor, cell, column, row, fragments: [] });
      const remapped = { ...fragment, sourcePartId: fragment.partId, partId: id };
      groups.get(id).fragments.push(remapped);
      return remapped;
    });

    const materials = {};
    for (const part of parts) part.node.traverse(mesh => {
      if (!mesh.isMesh) return;
      for (const original of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const kind = /glass/i.test(mesh.name + ' ' + original.name) ? 'glass' : 'structure';
        if (materials[kind]) continue;
        const material = original.clone();
        material.vertexColors = true;
        material.side = T.DoubleSide;
        materials[kind] = material;
      }
    });
    const attributes = {};
    const formats = { position: [3, Float32Array], normal: [3, Float32Array], uv: [2, Float32Array], color: [3, Uint8Array] };
    for (const [name, [, ArrayType]] of Object.entries(formats)) {
      const record = descriptor.buffers[name];
      attributes[name] = new ArrayType(buffer, record.offset, record.length);
    }

    const refined = [];
    for (const group of [...groups.values()].sort((a, b) => a.id - b.id)) {
      const lower = heights[group.floor];
      const upper = heights[group.floor + 1] ?? Math.max(...group.fragments.map(fragment => fragment.center[1] + fragment.half[1]));
      const center = {
        x: minX + (group.column + .5) * width,
        y: (lower + upper) * .5,
        z: minZ + (group.row + .5) * depth,
      };
      const node = new T.Group();
      node.name = 'detail_f' + group.floor + '_c' + group.cell;
      node.position.set(center.x, center.y, center.z);
      const part = {
        id: group.id, floor: group.floor, cell: group.cell, kind: 'structure',
        center, halfExtents: { x: width * .5, y: (upper - lower) * .5, z: depth * .5 },
        node, nodeName: node.name, rest: node.position.clone(), restQ: node.quaternion.clone(),
        restScale: node.scale.clone(), vel: new T.Vector3(), spin: new T.Vector3(),
        sourcePartIds: [...new Set(group.fragments.map(fragment => fragment.sourcePartId))],
      };
      // Closed source fragments preserve the actual irregular fracture edges.
      // Logical grid bounds define support ownership, while raycasts still use
      // these exact authored triangles, including protruding slabs and windows.
      for (const kind of ['structure', 'glass']) {
        const selected = group.fragments.filter(fragment => fragment.kind === kind);
        if (!selected.length) continue;
        const count = selected.reduce((sum, fragment) => sum + fragment.vertexCount, 0);
        const geometry = new T.BufferGeometry();
        for (const [name, [components, ArrayType]] of Object.entries(formats)) {
          const values = new ArrayType(count * components);
          let offset = 0;
          for (const fragment of selected) {
            const start = fragment.firstVertex * components;
            const length = fragment.vertexCount * components;
            values.set(attributes[name].subarray(start, start + length), offset);
            if (name === 'position') {
              for (let i = offset; i < offset + length; i += 3) {
                values[i] += fragment.center[0] - center.x;
                values[i + 1] += fragment.center[1] - center.y;
                values[i + 2] += fragment.center[2] - center.z;
              }
            }
            offset += length;
          }
          geometry.setAttribute(name, new T.BufferAttribute(values, components, name === 'color'));
        }
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const mesh = new T.Mesh(geometry, materials[kind]);
        mesh.name = node.name + '_' + kind;
        mesh.userData.structureKind = kind;
        mesh.castShadow = kind === 'structure';
        mesh.receiveShadow = kind === 'structure';
        node.add(mesh);
      }
      node.traverse(object => { object.userData.part = part; });
      refined.push(part);
    }
    // Build completely before replacing the imported nodes. This preserves a
    // consistent scene if an asset error interrupts preparation.
    for (const part of parts) part.node.removeFromParent();
    for (const part of refined) model.add(part.node);
    const rendering = createBatches(refined, materials, model);
    model.updateWorldMatrix(true, true);
    return { parts: refined, descriptor: { ...descriptor, pieces: fragments }, rendering };
  }

  window.SkyfallStructureDetail = { refine };
})();
