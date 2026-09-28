'use strict';
/* =========================================================================
   TILES — the terrain (one mesh from js/game.js) is cut into 6 x 6 tiles after it's built, so three's
   frustum culling skips the parts behind and beside the camera; before, every triangle of the map was drawn every
   frame. Near tiles also draw first (three sorts opaque meshes front to back), so hills hide more of what's behind
   them before it's shaded. Looks exactly the same; typically 20-65% fewer triangles for 5-25 more draw calls.
   Plugs in through SCENERY_PLUGINS (js/sunlight.js); relies on js/game.js laying the terrain out as 6 vertices per
   grid cell, row by row (it checks the count and leaves the mesh whole if that ever changes).
   ========================================================================= */
const TerrainTiles = (() => {
  const PER_SIDE = 6;                                      // 8 x 8 culled only a few % more, for ~40% more draw calls
  SCENERY_PLUGINS.push((group) => {
    const src = group.children.find((o) => o.isMesh && o.userData.sunGrid && !o.userData.tile);
    if (!src) return;
    const N = TER.N, g = src.geometry, per = Math.ceil(N / PER_SIDE);
    if (g.index || g.attributes.position.count !== N * N * 6) return;
    const names = Object.keys(g.attributes);
    for (let tj = 0; tj < N; tj += per) for (let ti = 0; ti < N; ti += per) {
      const w = Math.min(per, N - ti), h = Math.min(per, N - tj), tg = new THREE.BufferGeometry();
      for (const name of names) {
        const a = g.attributes[name], k = a.itemSize * 6, out = new Float32Array(w * h * k);
        for (let j = 0; j < h; j++) {                        // one row of the tile: w cells, contiguous in the source
          const s = ((tj + j) * N + ti) * k;
          out.set(a.array.subarray(s, s + w * k), j * w * k);
        }
        tg.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
      }
      tg.computeBoundingSphere();
      const m = new THREE.Mesh(tg, src.material);
      m.userData.sunGrid = true; m.userData.tile = true;
      group.add(m);
    }
    group.remove(src); g.dispose();
  });
  return {};
})();
