'use strict';
/* =========================================================================
   BEDROCK — bare, glacier-smoothed granite: the rounded rock of lake islands and skerries, as a js/shore.js plugin.
   Course file: bedrock: [{ x, z, r, bare }]
     x, z, r  a patch of bare rock centred on (x, z), reaching out r m (its edge wobbles by about a fifth); it only
              covers ground above the water, so on an island it follows the shoreline down to the water's edge
     bare     the share of r kept clear of trees (default 0.7): a few pines hang on round the edge of a bigger island;
              1 keeps the whole patch bare (a skerry)
   Sun-warmed rock makes thermals as well as fields do, so a thermal over a rocky island needs no meadow under it
   (set its field to 0; js/sailplane.js).
   Only looks: the terrain's own triangles inside the patch, redrawn over it in the colour js/game.js gives steep rock
   faces (cliffs), with the same per-facet shading, so it reads as the same rock; under the shallows it darkens with
   the depth like the lake bed. Sim part (no DOM): buildBedrock() keeps trees off each bare core (tree-free boxes far
   underground, never hit). Game part: the rock surface (the plugin's kit).
   ========================================================================= */
const BEDROCK_NONE = -1e6;
function buildBedrock() {
  for (const b of (COURSE && COURSE.bedrock) || []) {
    const R = b.r * (b.bare != null ? b.bare : 0.7);
    for (let k = 0; k < 3; k++) {                             // three squares turned 30 degrees apart: roughly a disc
      const a = k * Math.PI / 6;
      shoreBox('field', b.x, b.z, Math.cos(a), Math.sin(a), R * 0.82, R * 0.82, BEDROCK_NONE, BEDROCK_NONE);
    }
  }
}
function createBedrockKit() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.userData.shared = true;
  const ROCK = new THREE.Color('#8b857a');                    // js/game.js COL.rock: the colour of every cliff face
  const c = new THREE.Color();
  return {
    build(group) {
      const B = (COURSE && COURSE.bedrock) || [];
      if (!B.length) return;
      const PAL = COURSE.palette || {}, deep = new THREE.Color(PAL.deepWater || PAL.water || '#5a8fb2'), W = TER.WATER;
      const nz = makeNoise(((COURSE.seeds && COURSE.seeds.c) || 1) * 13 + 5), rand = mulberry32(((COURSE.seeds && COURSE.seeds.c) || 1) * 29 + 1);
      const N = TER.N, GW = N + 1, cell = TER.CELL, pos = [], col = [];
      const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {   // one terrain facet, lifted a few cm
        const h = (ay + by + cy) / 3;
        c.copy(ROCK);
        if (h < W) c.lerp(deep, smoothstep(W - 0.3, W - (PAL.deep || 14), h));   // under the water: the bed darkens
        const j = 0.93 + rand() * 0.12;                        // the same facet-to-facet shading as the terrain
        pos.push(ax, ay + 0.05, az, bx, by + 0.05, bz, cx, cy + 0.05, cz);
        for (let v = 0; v < 3; v++) col.push(c.r * j, c.g * j, c.b * j);
      };
      B.forEach((b, n) => {
        const i0 = Math.max(0, Math.floor((b.x - b.r * 1.3 - TER.X0) / cell)), i1 = Math.min(N - 1, Math.ceil((b.x + b.r * 1.3 - TER.X0) / cell));
        const j0 = Math.max(0, Math.floor((b.z - b.r * 1.3 - TER.Z0) / cell)), j1 = Math.min(N - 1, Math.ceil((b.z + b.r * 1.3 - TER.Z0) / cell));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x0 = TER.X0 + i * cell, x1 = x0 + cell, z0 = TER.Z0 + j * cell, z1 = z0 + cell, k = j * GW + i;
          const h00 = TH[k], h10 = TH[k + 1], h01 = TH[k + GW], h11 = TH[k + GW + 1];
          const mx = x0 + cell / 2, mz = z0 + cell / 2, edge = b.r * (0.8 + 0.4 * nz(mx * 0.018 + n * 9.1, mz * 0.018 - n * 3.7));
          if (Math.hypot(mx - b.x, mz - b.z) > edge || Math.max(h00, h10, h01, h11) < W - 3) continue;   // outside, or deep
          tri(x0, h00, z0, x0, h01, z1, x1, h11, z1);         // the same split as the terrain (and heightAt)
          tri(x0, h00, z0, x1, h11, z1, x1, h10, z0);
        }
      });
      if (!pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, mat));
    },
  };
}
SHORE_PLUGINS.push({ build: buildBedrock, createKit: createBedrockKit });
