# Architectural mobile asset v2

Source geometry: the project's existing Skyfall Blender building. This repository distributes the ready-to-use mobile geometry and textures; the original Blender project and its export scripts are not included.

## Runtime contract

- `mobile-building.glb`: 48 independently movable `chunk_f{floor}_{cell}` groups, 97 primitives, 111,327 triangles, 8,096,620 bytes.
- Parent positions are world centers. Child mesh coordinates are relative to those parents. Coordinates follow glTF Y-up.
- `mobile-building.json` keeps the original 48-group schema and adds `version:2`, material names and a 2.4-metre texture projection scale.
- Solid material: `Mobile V2 | PC concrete, frames and fitout`. Vertex colors contain the PC-inspired warm-gray palette, dark anodized frames and locally baked ambient occlusion. Embedded 512×512 JPEG albedo detail and 512×512 PNG normal use `TEXCOORD_0`.
- Glass material: `Mobile V2 | transparent architectural glass`. Ordinary alpha BLEND at 0.32; metallic0.1, roughness0.17. No transmission render pass. Single-sided. Runtime should set depthWrite=false for stable overlapping window views.
- `static_environment` includes the 240-metre base ground and central paving/lights/planters; do not use one flat override material over the entire static node. Its ground is at approximately y=-0.26 through -0.08; central sidewalk is around y=0.11.

## Texture attribution

Concrete albedo and normal are adapted from the existing PC project's CC0 photographs:

- https://polyhaven.com/a/concrete
- https://polyhaven.com/license

The architectural-concrete JPEG is a low-contrast detail multiplier. Palette color remains in vertex attributes. The runtime normal scale is0.32. These two image files are also embedded inside the GLB, so the GLB has no external resource URI.

## Format notes

The original export pipeline promotes the authored vertex color to COLOR_0. Unused white buffers are removed and colors quantized to normalized 8-bit values. If replacing the GLB, preserve the node naming, parent centers, material roles and COLOR_0 palette contract expected by `engine.js`.

The complete GLB is ready to load directly without regeneration. The repository's tests inspect its actual geometry and material data; GPU appearance and real phone frame rates require separate browser/device checks.
