'use strict';
/* =========================================================================
   CITY — a street grid of blocks around a downtown: houses with gardens and trees out in the suburbs, apartment
   blocks closer in, mid-rises, then glass towers at the centre; elevated highways on piers across it. A js/shore.js
   plugin: every building, pier and deck is a shore box, so it shares the shore's crash test and keeps the course's
   own trees out. The ground is levelled to city.ground across the city (rings[3] + blend), the way js/ridge.js
   raises its cliffs into the terrain.
   Course file: city: {
     seed, ground                height of the streets (m)
     centre: [x, z], angle       downtown, and the street grid's rotation (deg); a street runs through the centre
     block, street               block pitch, street included (m), and street width
     rings: [towers, mid, flats, houses]   distances from the centre out to which each kind of block stands
     tower: [min, max]           tower heights: max at the centre, min at rings[0] (and random either way); a block
                                 holds one big tower, two, or four slimmer ones
     landmarks: [{ x, z, h }]    the skyline's own supertalls, h m tall with a spire, each on its block (and its podium);
                pad: true for a flat roof with a helipad instead of the spire (a hoop can sit over it), standing as
                given, not cut back from the line (the course keeps its own clearance round it)
     mid, flats, houses: [min, max]   heights for those rings (taller nearer the centre)
     near, middle, far           detail by distance from the course line (m): full (gardens, trees, chimneys) out to
                                 near, plainer to middle, rows of rooftops only to far; nothing beyond (the inner
                                 two rings are always full)
     gap, under                  the flight corridor: nothing stands within gap m of the line's floorHalfWidth (the
                                 5th value of each point) unless its top is at least under m below the line
     blend                       how far past rings[3] the levelled ground blends back into the hills (m)
     highways: [{ pts: [[x, z, h], ...], w, lanes }]   elevated roads: deck h m above the ground at each point (0 =
                                 on the ground), w m wide; a smooth curve through the points, on piers every PIER_GAP m
                                 (none in the flight corridor where the line passes under the deck, nor on another deck)
     parks: [[x, z, r], ...]     no buildings: lawn and trees
     sprawl                      the city carries on out to this far from the centre (m) in plain blocks, no detail:
                                 every block beyond the detailed ones (by ring and distance from the line) is one or
                                 two boxes on one grey quad, so it reads as city right out into the haze; past
                                 sprawlNear m from the line it thins out to one box on about half the blocks
     clusters: [{ x, z, r, n, h: [min, max] }]   other business districts out there: n towers within r of (x, z)
   }
   Plugins (CITY_PLUGINS, js/outskirts.js): { terrain(C, G), highways(C, G) -> more highway specs, exclude(x, z, rd),
   skipBlock(blk), block(ctx, blk) -> true if it built the block, after(ctx), draw: { kind: fn(kctx, b) },
   kit: { build(kctx, group) } }; ctx: the builders below (add, fit, clash, offLimits, tree, at, ...), kctx: the
   kit's (quad, plainBox, walls, beam, jit and the M / GR / RD chunk sets); a block a plugin marks grass: true is drawn as
   one lawn quad, no streets. A highway spec may carry clear: [[from,
   to], ...] (m along it) where it stands on no piers, noBoards: true, and piersInLine: true (its piers stand every
   PIER_GAP m even where the line runs under it: the course puts the hoop between two).
   Sim part (no DOM): buildCity() (from buildShore, after the terrain); cityRayBlocked(c, d), which js/glare.js asks
   whether the sun is behind a building. createCityKit(): the meshes (the course's
   windows, lit at dusk, in a shader on the building material; see CityLook below).
   ========================================================================= */
const CITY = { on: false, G: 0, top: 0, bld: [], trees: [], blocks: [], hw: [], piers: [], stats: {}, hwGrid: new Map() };
const CITY_DEF = {
  seed: 1, ground: 20, centre: [0, 0], angle: 0, block: 110, street: 18,
  rings: [450, 900, 1500, 3200], tower: [110, 260], mid: [24, 80], flats: [12, 32], houses: [6, 8.5],
  near: 350, middle: 1000, far: 2200, gap: 14, under: 22, blend: 500, highways: [], parks: [], sprawl: 0, clusters: [], landmarks: [],
};
const PIER_GAP = 34, DECK_T = 1.6, BARRIER_H = 1.1;
const CITY_PLUGINS = [];

// nearest point of the course line (horizontally): d (m) and the sample there
const _cl = { d: 0, s: null };
function cityLineNear(x, z) {
  let bd = Infinity, bk = 0;
  for (let k = 0; k < SAMPLES.length; k += 3) { const s = SAMPLES[k], d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z); if (d < bd) { bd = d; bk = k; } }
  for (let k = Math.max(0, bk - 3); k <= Math.min(SAMPLES.length - 1, bk + 3); k++) { const s = SAMPLES[k], d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z); if (d <= bd) { bd = d; bk = k; } }
  _cl.d = Math.sqrt(bd); _cl.s = SAMPLES[bk];
  return _cl;
}
// nearest highway centreline (of them all, or only that one) within about HW_CELL m: d (m, Infinity if none that
// close), deck height above the ground there, and the road's half width. Segments are filed by their middle in a grid
const _ch = { d: Infinity, h: 0, hw: 0 }, HW_CELL = 100;
function cityHighwayNear(x, z, only) {
  _ch.d = Infinity; _ch.h = 0; _ch.hw = 0;
  const ci = Math.floor(x / HW_CELL), cj = Math.floor(z / HW_CELL);
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const list = CITY.hwGrid.get(treeKey(ci + di, cj + dj));
    if (!list) continue;
    for (let k = 0; k < list.length; k += 2) {
      const H = list[k], i = list[k + 1];
      if (only && H !== only) continue;
      const ax = H.X[i], az = H.Z[i], dx = H.X[i + 1] - ax, dz = H.Z[i + 1] - az, L2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), ex = x - ax - dx * t, ez = z - az - dz * t, d = Math.sqrt(ex * ex + ez * ez);
      if (d < _ch.d) { _ch.d = d; _ch.h = lerp(H.H[i], H.H[i + 1], t); _ch.hw = H.w / 2; }
    }
  }
  return _ch;
}

// does the ray from c along d (unit, toward the sun) hit a building, a deck or a tree? The shore grid's cells along
// its way, about half a cell apart, until it's above every roof; each box tested once, exactly (slabs)
let _rayStamp = 0;
function cityRayBlocked(c, d) {
  if (!CITY.on) return false;
  const stamp = ++_rayStamp, hz = Math.hypot(d.x, d.z);
  const tEnd = Math.min(d.y > 1e-4 ? (CITY.top - c.y) / d.y : 6000, 6000);
  if (tEnd <= 0) return false;
  const step = hz > 1e-3 ? (SHORE_CELL / 2) / hz : tEnd;
  let lastKey = -1;
  for (let t = 0; t <= tEnd + step; t += step) {
    const key = treeKey(Math.floor((c.x + d.x * t) / SHORE_CELL), Math.floor((c.z + d.z * t) / SHORE_CELL));
    if (key === lastKey) continue;
    lastKey = key;
    const list = SHORE.grid.get(key);
    if (list) for (const b of list) { if (b._ray !== stamp) { b._ray = stamp; if (rayHitsBox(c, d, b)) return true; } }
  }
  return false;
}
function rayHitsBox(o, d, b) {
  const ox = o.x - b.x, oz = o.z - b.z;
  const s = [ox * b.ux + oz * b.uz, d.x * b.ux + d.z * b.uz, b.hu, oz * b.ux - ox * b.uz, d.z * b.ux - d.x * b.uz, b.hv];
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 9; i += 3) {                          // u, v (half sizes either side), then height
    const p = i < 6 ? s[i] : o.y, q = i < 6 ? s[i + 1] : d.y, lo = i < 6 ? -s[i + 2] : b.y0, hi = i < 6 ? s[i + 2] : b.y1;
    if (Math.abs(q) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let a = (lo - p) / q, e = (hi - p) / q;
    if (a > e) { const w = a; a = e; e = w; }
    if (a > t0) t0 = a;
    if (e < t1) t1 = e;
    if (t0 > t1) return false;
  }
  return true;
}

function buildCity() {
  CITY.on = false;
  for (const k of ['bld', 'trees', 'blocks', 'hw', 'piers']) CITY[k].length = 0;
  CITY.hwGrid.clear();
  if (!COURSE.city) return;
  const C = CITY.C = Object.assign({}, CITY_DEF, COURSE.city);
  CITY.on = true;
  const G = CITY.G = C.ground, [cx, cz] = C.centre, R = C.rings, rand = mulberry32(C.seed * 7919 + 1);
  const a = C.angle * Math.PI / 180, UX = Math.cos(a), UZ = Math.sin(a), VX = -UZ, VZ = UX;   // grid axes
  CITY.axes = { UX, UZ, VX, VZ };
  const st = { tower: 0, mid: 0, flats: 0, house: 0, row: 0, tree: 0, far: 0, dropped: 0 };

  // level ground: G - 0.3 under the whole city (the street mesh sits on G), blending back over C.blend
  const Rcity = Math.max(R[3], C.sprawl || 0), W = TER.N + 1, cell = TER.CELL, Rf = Rcity + C.blend;
  for (let j = 0; j <= TER.N; j++) for (let i = 0; i <= TER.N; i++) {
    const x = TER.X0 + i * cell, z = TER.Z0 + j * cell, d = Math.hypot(x - cx, z - cz);
    if (d > Rf) continue;
    const k = j * W + i;
    TH[k] = lerp(TH[k], G - 0.3, smoothstep(Rf, Rcity, d));
  }
  for (const pl of CITY_PLUGINS) if (pl.terrain) pl.terrain(C, G);

  // highways: a smooth curve through the points, every ~8 m, with the deck's height
  const specs = C.highways.concat(...CITY_PLUGINS.map((pl) => (pl.highways ? pl.highways(C, G) : [])));
  for (const spec of specs) {
    const pts = spec.pts.map((p) => new THREE.Vector3(p[0], p[2] || 0, p[1]));
    const cv = new THREE.CatmullRomCurve3(pts, false, 'centripetal'), len = cv.getLength(), n = Math.max(2, Math.ceil(len / 8) + 1);
    const H = { w: spec.w || 26, lanes: spec.lanes || 3, X: [], Z: [], H: [], n, len, spec, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      cv.getPointAt(i / (n - 1), p);
      H.X.push(p.x); H.Z.push(p.z); H.H.push(Math.max(0, p.y));
      H.x0 = Math.min(H.x0, p.x); H.x1 = Math.max(H.x1, p.x); H.z0 = Math.min(H.z0, p.z); H.z1 = Math.max(H.z1, p.z);
    }
    CITY.hw.push(H);
    for (let i = 0; i < n - 1; i++) {
      const key = treeKey(Math.floor((H.X[i] + H.X[i + 1]) / 2 / HW_CELL), Math.floor((H.Z[i] + H.Z[i + 1]) / 2 / HW_CELL));
      let list = CITY.hwGrid.get(key); if (!list) CITY.hwGrid.set(key, list = []);
      list.push(H, i);
    }
  }
  // their decks and piers, as boxes
  CITY.hw.forEach((H, hi) => {
    let along = PIER_GAP / 2, dist = 0;
    const clear = H.spec.clear || [];
    for (let i = 0; i < H.n - 1; i++) {
      const dx = H.X[i + 1] - H.X[i], dz = H.Z[i + 1] - H.Z[i], L = Math.hypot(dx, dz) || 1, h = (H.H[i] + H.H[i + 1]) / 2;
      const top = G + Math.max(0.25, h);
      if (h > 1.5) shoreBox('highway', (H.X[i] + H.X[i + 1]) / 2, (H.Z[i] + H.Z[i + 1]) / 2, dx / L, dz / L, L / 2 + 0.4, H.w / 2, top - DECK_T, top + BARRIER_H);
      along += L; dist += L;
      if (along < PIER_GAP) continue;
      along = 0;
      const px = H.X[i], pz = H.Z[i], ph = H.H[i];
      if (ph < 4 || clear.some(([d0, d1]) => dist > d0 && dist < d1)) continue;
      // not in the flight corridor where the line runs under this deck (unless the spec keeps them: piersInLine, and
      // the course puts its hoop between two of them), nor on another road
      const ln = cityLineNear(px, pz);
      if (!H.spec.piersInLine && ln.d < ln.s.width + 6 && ln.s.y < G + ph) continue;
      if (CITY.hw.some((O, oi) => oi !== hi && cityHighwayNear(px, pz, O).d < O.w / 2 + 3 && Math.abs(_ch.h - ph) > 2)) continue;
      CITY.piers.push({ x: px, z: pz, ux: dx / L, uz: dz / L, top: G + ph - DECK_T, w: H.w });
      shoreBox('highway', px, pz, dx / L, dz / L, 1.3, 1.6, G - 1, G + ph - DECK_T);
    }
  });

  // what may stand where: off the roads, out of the parks and the flight corridor (unless the line is well above).
  // The footprint (half sizes hu along the grid's u, hv along v) is tested against every nearby point of the line;
  // clash() returns the worst one as { s, du, dv } (the point relative to the centre, in grid axes), or null
  const parks = C.parks || [];
  const _cs = { s: null, du: 0, dv: 0 };
  const clash = (x, z, hu, hv, top) => {
    let worst = Infinity;
    _cs.s = null;
    const reach = hu + hv + 120;
    for (let k = 0; k < SAMPLES.length; k++) {
      const s = SAMPLES[k], dx = s.x - x, dz = s.z - z;
      if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
      if (top <= s.y - C.under) continue;
      const du = dx * UX + dz * UZ, dv = dx * VX + dz * VZ;
      const d = Math.hypot(Math.max(Math.abs(du) - hu, 0), Math.max(Math.abs(dv) - hv, 0)) - (s.width + C.gap);
      if (d < 0 && d < worst) { worst = d; _cs.s = s; _cs.du = du; _cs.dv = dv; }
    }
    return _cs.s ? _cs : null;
  };
  const offLimits = (x, z, rd) => {
    for (const [px, pz, pr] of parks) if (Math.hypot(x - px, z - pz) < pr + rd) return true;
    for (const pl of CITY_PLUGINS) if (pl.exclude && pl.exclude(x, z, rd)) return true;
    const q = cityHighwayNear(x, z);
    return q.d < q.hw + rd + 5;
  };
  const blocked = (x, z, rd, top) => offLimits(x, z, rd) || !!clash(x, z, rd * 0.7, rd * 0.7, top);
  // a building in the corridor is cut back from the side facing the line, so the route runs down a street of facades
  // (as long as at least `min` m of it is left); null if it can't stand
  const fit = (x, z, hu, hv, top, min) => {
    for (let it = 0; it < 3; it++) {
      if (offLimits(x, z, Math.min(hu, hv))) return null;
      const c = clash(x, z, hu, hv, top);
      if (!c) return { x, z, hu, hv };
      const clr = c.s.width + C.gap, alongU = Math.abs(c.du) - hu > Math.abs(c.dv) - hv, comp = -(alongU ? c.du : c.dv), h = alongU ? hu : hv;
      const sg = Math.sign(comp) || 1, far = Math.abs(comp) + h, nh = (far - clr) / 2;
      if (nh < min / 2) return null;
      const shift = sg * ((far + clr) / 2 - Math.abs(comp));      // move the centre away from the line
      if (alongU) { x += UX * shift; z += UZ * shift; hu = nh; } else { x += VX * shift; z += VZ * shift; hv = nh; }
    }
    return clash(x, z, hu, hv, top) ? null : { x, z, hu, hv };
  };
  const add = (b) => {                                       // a building: its boxes, tier by tier (b.tiers: [hu, hv, y1])
    let y0 = b.y0;
    for (const [hu, hv, y1] of b.tiers) { shoreBox(b.k, b.x, b.z, UX, UZ, hu, hv, y0, y1 + (b.cap || 0) * (y1 === b.tiers[b.tiers.length - 1][2] ? 1 : 0)); y0 = y1; }
    CITY.bld.push(b);
    const sk = b.k === 'podium' ? 'mid' : b.k; st[sk] = (st[sk] || 0) + 1;
  };
  const tree = (x, z, h, r) => {
    if (blocked(x, z, r, G + h)) return;
    CITY.trees.push({ x, z, h, r, c: rand() });
    shoreBox('tree', x, z, 1, 0, r * 0.75, r * 0.75, G + h * 0.35, G + h);
    st.tree++;
  };
  const at = (bx, bz, u, v) => [bx + UX * u + VX * v, bz + UZ * u + VZ * v];
  const span = (r, t) => r[0] + (r[1] - r[0]) * t;
  const ctx = { C, G, R, UX, UZ, VX, VZ, at, span, clash, fit, offLimits, add, tree, st, lineNear: cityLineNear, highwayNear: cityHighwayNear };

  // blocks: the grid's cells (a street runs through the centre), out to the last ring, each by its ring and detail
  const B = C.block, S = C.street, inner = B - S, nB = Math.ceil(Rcity / B) + 1;
  ctx.B = B; ctx.inner = inner;
  // other business districts out in the sprawl: towers on their own blocks of the grid, placed first
  const taken = new Set(), frand = mulberry32(C.seed * 104729 + 3);   // (their own numbers: the detailed city stays as it was)
  for (const cl of C.clusters || []) {
    const n = cl.n || 12, hr = cl.h || [70, 170];
    let placed = 0;
    for (let i = 0; i < n * 3 && placed < n; i++) {
      const a2 = frand() * Math.PI * 2, rr = Math.sqrt(frand()) * cl.r;
      const gu = Math.round(((cl.x - cx + Math.cos(a2) * rr) * UX + (cl.z - cz + Math.sin(a2) * rr) * UZ) / B - 0.5) + 0.5;
      const gv = Math.round(((cl.x - cx + Math.cos(a2) * rr) * VX + (cl.z - cz + Math.sin(a2) * rr) * VZ) / B - 0.5) + 0.5;
      const [x, z] = at(cx, cz, gu * B, gv * B);
      const key = (gu - 0.5) + ',' + (gv - 0.5);
      if (taken.has(key)) continue;
      if (Math.hypot(x - cx, z - cz) <= R[3] && cityLineNear(x, z).d < C.far) continue;   // only out in the sprawl
      const t = rr / cl.r, H = span([hr[1], hr[0]], t) * (0.75 + frand() * 0.35), hu = 14 + frand() * 10, hv = 14 + frand() * 10;
      if (clash(x, z, hu, hv, G + H)) continue;
      taken.add(key);                                        // (the sprawl leaves its block to it)
      const kind = frand(), tiers = kind < 0.5 ? [[hu, hv, G + H]] : [[hu, hv, G + H * 0.7], [hu * 0.75, hv * 0.75, G + H]];
      add({ k: 'tower', x, z, y0: G, tiers, st: 1, c: Math.floor(frand() * 6), crown: frand() < 0.5 ? 1 : 2, cap: H * 0.1, seed: Math.floor(frand() * 999), cluster: true });
      placed++;
    }
  }
  for (const lm of C.landmarks || []) {                      // the supertalls: centred on their blocks, cut back from the line
    const i = Math.floor(((lm.x - cx) * UX + (lm.z - cz) * UZ) / B), j = Math.floor(((lm.x - cx) * VX + (lm.z - cz) * VZ) / B);
    const [x0, z0] = at(cx, cz, (i + 0.5) * B, (j + 0.5) * B), hw = lm.w || inner / 2 - 8;
    const F = lm.pad ? (offLimits(x0, z0, hw) ? null : { x: x0, z: z0, hu: hw, hv: hw }) : fit(x0, z0, hw, hw, G + lm.h * 1.25, 28);
    if (!F) continue;
    taken.add(i + ',' + j);
    const H = lm.h, tiers = [[F.hu, F.hv, G + H * 0.5], [F.hu * 0.84, F.hv * 0.84, G + H * 0.75], [F.hu * 0.66, F.hv * 0.66, G + H * 0.9], [F.hu * 0.5, F.hv * 0.5, G + H]];
    add({ k: 'tower', x: F.x, z: F.z, y0: G, tiers, st: 1, c: Math.floor(frand() * 6), crown: lm.pad ? 4 : 3, cap: lm.pad ? 0 : H * 0.22, seed: Math.floor(frand() * 999), landmark: true });
  }
  for (let j = -nB; j < nB; j++) for (let i = -nB; i < nB; i++) {
    const [bx, bz] = at(cx, cz, (i + 0.5) * B, (j + 0.5) * B);
    const d = Math.hypot(bx - cx, bz - cz);
    if (d > Rcity) continue;
    const ring = d < R[0] ? 0 : d < R[1] ? 1 : d < R[2] ? 2 : 3;
    const dl = cityLineNear(bx, bz).d;
    const detail = ring <= 1 ? 2 : d > R[3] ? -1 : dl < C.near ? 2 : dl < C.middle ? 1 : dl < C.far ? 0 : -1;
    const blk = { x: bx, z: bz, i, j, ring, detail, park: false, d, dl };
    if (CITY_PLUGINS.some((pl) => pl.skipBlock && pl.skipBlock(blk))) continue;
    if (CITY_PLUGINS.some((pl) => pl.block && pl.block(ctx, blk))) { CITY.blocks.push(blk); continue; }
    if (detail < 0) {                                        // far off: plain blocks, if the city reaches this far
      if (!C.sprawl || parks.some(([px, pz, pr]) => Math.hypot(bx - px, bz - pz) < pr)) continue;
      const q = cityHighwayNear(bx, bz);
      CITY.blocks.push({ x: bx, z: bz, ring, detail: -1, park: false, d });
      if (q.d < q.hw + B * 0.45 || taken.has(i + ',' + j)) continue;   // a highway runs through, or a cluster's tower: just the street
      if (dl > (C.sprawlNear || 1e9) && frand() < 0.45) continue;   // well off the line: sparser, and one box at most
      const two = dl <= (C.sprawlNear || 1e9) && frand() < 0.5, hgt = (r) => ring === 2 ? 12 + r * 22 : 7 + r * (d > R[3] ? 16 : 9);
      const parts = two ? [[-inner / 4, inner / 4 - 3, inner / 2 - 4], [inner / 4, inner / 4 - 3, inner / 2 - 4]] : [[0, inner / 2 - 6 - frand() * 8, inner / 2 - 6 - frand() * 8]];
      for (const [ou, hu, hv] of parts) {
        const [x, z] = at(bx, bz, ou, 0), top = G + Math.round(hgt(frand()) / 3.1) * 3.1;
        if (clash(x, z, hu, hv, top)) { st.dropped++; continue; }
        add({ k: 'far', x, z, y0: G, tiers: [[hu, hv, top]], st: frand() < 0.6 ? 3 : 2, c: Math.floor(frand() * 1000), seed: Math.floor(frand() * 999) });
      }
      continue;
    }
    const park = parks.some(([px, pz, pr]) => Math.hypot(bx - px, bz - pz) < pr);
    const hq = cityHighwayNear(bx, bz), road = hq.d < hq.hw + B * 0.5;
    CITY.blocks.push({ x: bx, z: bz, ring, detail, park, d });
    const near = 1 - d / R[3];                               // 1 at the centre .. 0 at the edge
    const seed = Math.floor(rand() * 1e6);
    if (park) {
      for (let n = 0; n < 7; n++) { const [x, z] = at(bx, bz, (rand() - 0.5) * inner * 0.85, (rand() - 0.5) * inner * 0.85); tree(x, z, 9 + rand() * 6, 3.5 + rand() * 2); }
      continue;
    }
    if (ring === 0) {                                        // towers: one big one, two, or four slimmer ones, on a podium
      const t = clamp(d / R[0], 0, 1), Hm = span([C.tower[1], C.tower[0]], Math.pow(t, 0.6));
      const lay = rand(), n = lay < 0.3 ? 1 : lay < 0.65 ? 2 : 4, pod = 9 + Math.floor(rand() * 3) * 4;
      const q4 = inner / 4 - 3;
      const list = taken.has(i + ',' + j) ? []                // a landmark's block: just its podium
        : n === 1 ? [[0, 0, inner / 2 - 4 - rand() * 6, inner / 2 - 4 - rand() * 6]]
        : n === 2 ? (rand() < 0.5 ? [[-inner / 4, 0, q4, inner / 2 - 6], [inner / 4, 0, q4, inner / 2 - 6]] : [[0, -inner / 4, inner / 2 - 6, q4], [0, inner / 4, inner / 2 - 6, q4]])
        : [[-inner / 4, -inner / 4, q4 - rand() * 3, q4 - rand() * 3], [inner / 4, -inner / 4, q4 - rand() * 3, q4 - rand() * 3],
           [-inner / 4, inner / 4, q4 - rand() * 3, q4 - rand() * 3], [inner / 4, inner / 4, q4 - rand() * 3, q4 - rand() * 3]];
      for (let [ou, ov, hu, hv] of list) {
        if (n === 4 && rand() < 0.15) continue;              // now and then a gap
        const H = Math.max(C.tower[0] * 0.6, Hm * (0.45 + rand() * 0.8) * (n === 4 ? 0.8 : n === 2 ? 0.9 : 1)), [x0, z0] = at(bx, bz, ou, ov);
        const F = fit(x0, z0, hu, hv, G + H * 1.2, n === 4 ? 16 : 22);
        if (!F) { st.dropped++; continue; }
        const { x, z } = F; hu = F.hu; hv = F.hv;
        const kind = rand(), tiers = [];
        if (kind < 0.45) tiers.push([hu, hv, G + H]);                                            // straight up
        else if (kind < 0.8) tiers.push([hu, hv, G + H * 0.62], [hu * 0.82, hv * 0.82, G + H * 0.86], [hu * 0.62, hv * 0.62, G + H]);   // setbacks
        else tiers.push([hu, hv, G + H * 0.55], [hu * 0.7, hv * 0.92, G + H]);                    // slimmer top
        const crown = rand(), cap = crown < 0.25 ? 0 : crown < 0.55 ? 6 : crown < 0.8 ? H * 0.12 : H * 0.18;
        add({ k: 'tower', x, z, y0: G, tiers, st: 1, c: Math.floor(rand() * 6), crown: crown < 0.25 ? 0 : crown < 0.55 ? 1 : crown < 0.8 ? 2 : 3, cap, seed: Math.floor(rand() * 999) });
      }
      const PF = fit(bx, bz, inner / 2 - 1, inner / 2 - 1, G + pod, 14);
      if (PF) add({ k: 'podium', x: PF.x, z: PF.z, y0: G, tiers: [[PF.hu, PF.hv, G + pod]], st: 2, c: Math.floor(rand() * 4), seed: Math.floor(rand() * 999) });
      continue;
    }
    if (ring === 1) {                                        // mid-rises on four lots, now and then a plaza
      for (const [qu, qv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (rand() < 0.1) continue;
        const [x0, z0] = at(bx, bz, qu * inner / 4, qv * inner / 4);
        const H = span(C.mid, clamp(near * 1.6 - 0.6 + rand() * 0.5, 0, 1)), top = G + Math.round(H / 3.8) * 3.8;
        const F = fit(x0, z0, inner / 4 - 2 - rand() * 4, inner / 4 - 2 - rand() * 4, top, 14);
        if (!F) { st.dropped++; continue; }
        const { x, z, hu, hv } = F;
        const tiers = rand() < 0.35 ? [[hu, hv, top - 7.6], [hu * 0.8, hv * 0.8, top]] : [[hu, hv, top]];
        add({ k: 'mid', x, z, y0: G, tiers, st: rand() < 0.55 ? 2 : 3, c: Math.floor(rand() * 6), seed: Math.floor(rand() * 999), roofBox: rand() < 0.7 });
      }
      continue;
    }
    if (ring === 2) {                                        // apartment blocks: slabs, a courtyard ring, or point blocks
      const lay = rand(), Hn = (r) => G + Math.round(span(C.flats, clamp((d - R[1]) / (R[2] - R[1]) < 0.5 ? 0.55 + r * 0.45 : r * 0.7, 0, 1)) / 3.1) * 3.1;
      const slabs = [];
      if (road && lay < 0.5) slabs.push([0, -inner / 4 + 2, inner / 2 - 6, 7.5], [0, inner / 4 - 2, inner / 2 - 6, 7.5]);
      else if (lay < 0.4) slabs.push([0, -inner / 4 + 2, inner / 2 - 6 - rand() * 10, 7.5], [0, inner / 4 - 2, inner / 2 - 6 - rand() * 10, 7.5]);
      else if (lay < 0.75) {
        const e = inner / 2 - 8;
        slabs.push([0, -e, inner / 2 - 2, 7], [0, e, inner / 2 - 2, 7], [-inner / 2 + 9, 0, 7, e - 7.5], [inner / 2 - 9, 0, 7, e - 7.5]);
      } else for (const [qu, qv] of [[-1, -1], [1, 1], [1, -1]]) slabs.push([qu * inner / 4, qv * inner / 4, 10 + rand() * 3, 10 + rand() * 3, true]);
      for (const [ou, ov, hu, hv, point] of slabs) {
        const [x0, z0] = at(bx, bz, ou, ov), top = point ? Hn(0.8 + rand() * 0.2) + 9.3 : Hn(rand());
        const F = fit(x0, z0, hu, hv, top + 3, 12);
        if (!F) { st.dropped++; continue; }
        add({ k: 'flats', x: F.x, z: F.z, y0: G, tiers: [[F.hu, F.hv, top]], st: 3, c: Math.floor(rand() * 7), seed: Math.floor(rand() * 999), roofBox: rand() < 0.6 });
      }
      if (detail >= 1) for (let n = 0; n < 3; n++) { const [x, z] = at(bx, bz, (rand() - 0.5) * inner * 0.3, (rand() - 0.5) * inner * 0.3); tree(x, z, 8 + rand() * 4, 3 + rand() * 1.5); }
      continue;
    }
    // houses: two rows of four lots facing the streets, trees in the gardens; far off, each row is one roofline
    const swap = (seed % 2) === 1, lw = inner / 4, ld = inner / 2;
    const atL = (u, v) => (swap ? at(bx, bz, v, u) : at(bx, bz, u, v));
    for (const side of [-1, 1]) {
      if (detail === 0) {
        const [x, z] = atL(0, side * (ld - 13)), hh = span(C.houses, rand());
        if (offLimits(x, z, 5.5) || clash(x, z, swap ? 5.5 : inner / 2 - 4, swap ? inner / 2 - 4 : 5.5, G + hh + 4)) { st.dropped++; continue; }
        add({ k: 'row', x, z, y0: G, tiers: swap ? [[5.5, inner / 2 - 4, G + hh]] : [[inner / 2 - 4, 5.5, G + hh]], st: 4, c: Math.floor(rand() * 1000), roofC: Math.floor(rand() * 1000), ridge: swap ? 'v' : 'u', seed: Math.floor(rand() * 999), cap: 3.5 });
        continue;
      }
      for (let n = 0; n < 4; n++) {
        if (rand() < 0.06) continue;
        const u = -inner / 2 + lw * (n + 0.5) + (rand() - 0.5) * 2, v = side * (ld - 7 - 5 - rand() * 3);
        const hw = 4.5 + rand() * 1.8, hd = 4.2 + rand() * 1.2, hh = span(C.houses, rand()), [x, z] = atL(u, v);
        const rh = 2.6 + rand() * 1.4;
        if (offLimits(x, z, Math.max(hw, hd)) || clash(x, z, swap ? hd : hw, swap ? hw : hd, G + hh + rh)) { st.dropped++; continue; }
        add({ k: 'house', x, z, y0: G, tiers: swap ? [[hd, hw, G + hh]] : [[hw, hd, G + hh]], st: 4, c: Math.floor(rand() * 1000), roofC: Math.floor(rand() * 1000), ridge: swap ? 'v' : 'u',
              hip: rand() < 0.3, chimney: detail === 2 && rand() < 0.5, seed: Math.floor(rand() * 999), cap: rh, full: detail === 2 });
        if (detail === 2 || rand() < 0.5) { const [tx, tz] = atL(u + (rand() - 0.5) * 10, side * (8 + rand() * 6)); tree(tx, tz, 7 + rand() * 6, 2.6 + rand() * 1.6); }
      }
      if (detail === 2 && rand() < 0.7) { const [tx, tz] = atL((rand() - 0.5) * inner * 0.8, side * (ld - 2)); tree(tx, tz, 8 + rand() * 4, 3 + rand()); }   // street tree
    }
  }
  for (const pl of CITY_PLUGINS) if (pl.after) pl.after(ctx);
  CITY.stats = st;
  CITY.top = SHORE.boxes.reduce((m, bx) => Math.max(m, bx.y1), G);
}
SHORE_PLUGINS.push({ build: buildCity, createKit: () => createCityKit() });
if (typeof GLARE_BLOCKERS !== 'undefined') GLARE_BLOCKERS.push((c, d) => (cityRayBlocked(c, d) ? 0 : 1));   // no dazzle through buildings (js/glare.js)
var CRASH_TEXT = CRASH_TEXT || {};
Object.assign(CRASH_TEXT, { tower: 'Hit a tower', far: 'Hit a building', mid: 'Hit a building', podium: 'Hit a building', flats: 'Hit a building', house: 'Hit a house', row: 'Hit the rooftops', highway: 'Hit the highway' });

/* ---------- look ----------
   Everything in a few big meshes per 6 x 6 blocks (so frustum culling works): buildings (one material), ground (streets,
   pavements, lots and lawns, drawn just above the levelled terrain) and the highways. Buildings carry a vertex
   attribute cityWin = (u, v, style, seed): u along the facade, v up from the building's foot, so CityLook's shader
   draws the windows (curtain wall, office, flats, houses), reflects the sky in the glass and lights some at dusk.
   Style 5: a highway deck, u along the road and v across, for its lane markings. */
const CityLook = {
  U: { cityZen: { value: new THREE.Color('#3f6fa8') }, cityHor: { value: new THREE.Color('#e9b98a') }, citySunC: { value: new THREE.Color('#ffd2a0') },
       citySunD: { value: new THREE.Vector3(-0.9, 0.2, 0.3).normalize() }, cityLights: { value: 1 }, cityGround: { value: new THREE.Color('#3a3c40') } },
  hooks() {
    const U = this.U;
    return [{ key: 'city-win', fn(sh) {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'attribute vec4 cityWin;\nvarying vec4 vWin;\nvarying vec3 vCityW;\nvarying vec3 vCityN;\n' + sh.vertexShader.replace('#include <fog_vertex>', `#include <fog_vertex>
  vWin = cityWin;
  vCityW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vCityN = normalize( mat3( modelMatrix ) * objectNormal );`);
      sh.fragmentShader = `uniform vec3 cityZen;
uniform vec3 cityHor;
uniform vec3 citySunC;
uniform vec3 citySunD;
uniform vec3 cityGround;
uniform float cityLights;
varying vec4 vWin;
varying vec3 vCityW;
varying vec3 vCityN;
float cityHash( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
float cityGlass = 0.0, cityRefl = 0.0, cityLit = 0.0;
vec3 cityLitC = vec3( 0.0 );
` + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
  float cwS = floor( vWin.z + 0.5 );
  if ( cwS > 0.5 && cwS < 4.5 ) {
    // floor height, column width, window width and height (shares of the cell), lit share, reflectivity
    vec4 g1 = vec4( 3.8, 1.6, 0.92, 0.74 ); vec2 g2 = vec2( 0.1, 1.0 ); vec3 lc = vec3( 1.0, 0.86, 0.66 );
    if ( cwS > 1.5 ) { g1 = vec4( 3.8, 3.0, 0.62, 0.56 ); g2 = vec2( 0.16, 0.55 ); lc = vec3( 0.95, 0.93, 0.85 ); }
    if ( cwS > 2.5 ) { g1 = vec4( 3.1, 3.4, 0.46, 0.5 ); g2 = vec2( 0.22, 0.4 ); lc = vec3( 1.0, 0.72, 0.42 ); }
    if ( cwS > 3.5 ) { g1 = vec4( 2.9, 3.9, 0.34, 0.46 ); g2 = vec2( 0.2, 0.35 ); lc = vec3( 1.0, 0.7, 0.4 ); }
    vec2 cell = vec2( vWin.x / g1.y, ( vWin.y - 0.6 ) / g1.x ), id = floor( cell ), f = fract( cell );
    vec2 fw = max( fwidth( cell ), vec2( 1e-4 ) ), hw = g1.zw * 0.5;
    vec2 m2 = smoothstep( hw + fw * 0.7, hw - fw * 0.7, abs( f - 0.5 ) );
    float avg = g1.z * g1.w, far = smoothstep( 0.3, 0.8, max( fw.x, fw.y ) );
    float m = mix( m2.x * m2.y, avg, far ) * step( 0.0, vWin.y - 0.6 );
    float seed = floor( vWin.w + 0.5 );   // (a varying: not exactly the same at every pixel)
    float r = cityHash( id + vec2( seed * 7.13, seed * 3.71 ) );
    float lit = mix( step( r, g2.x ) * m2.x * m2.y, g2.x * avg, far ) * step( 0.0, vWin.y - 0.6 );
    if ( cwS < 1.5 ) lit *= 0.7 + 0.6 * cityHash( vec2( id.y, seed ) );   // whole floors on or off, more or less
    lit *= 1.0 - 0.9 * smoothstep( 0.0, 0.35, dot( normalize( vCityN ), citySunD ) );   // lamps don't show on a sunlit wall
    cityGlass = m; cityRefl = g2.y; cityLit = lit * cityLights; cityLitC = lc * ( 0.75 + 0.5 * cityHash( id.yx + 3.1 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.035, 0.04, 0.05 ), m );
  } else if ( cwS > 4.5 ) {
    // highway deck: dashed lines between the lanes, solid edge lines, centre median left as it is
    float lat = abs( vWin.y ), lw = 3.6, edge = vWin.w;
    float fwl = max( fwidth( lat ), 1e-3 );
    float lanes = 0.0;
    for ( int i = 1; i < 4; i++ ) { float c = 1.2 + lw * float( i ); if ( c < edge - 1.5 ) lanes = max( lanes, smoothstep( 0.12 + fwl, 0.12 - fwl, abs( lat - c ) ) * step( 0.5, fract( vWin.x / 12.0 ) ) ); }
    float e = smoothstep( 0.14 + fwl, 0.14 - fwl, abs( lat - ( edge - 1.0 ) ) ) + smoothstep( 0.12 + fwl, 0.12 - fwl, abs( lat - 1.2 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.78, 0.76, 0.7 ), clamp( lanes + e, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.3, 1.0, fwl * 4.0 ) ) );
  }`)
        .replace('#include <opaque_fragment>', `if ( cityGlass > 0.0 ) {
    vec3 cwV = normalize( vCityW - cameraPosition ), cwN = normalize( vCityN );
    vec3 cwR = reflect( cwV, cwN );
    float fr = 0.1 + 0.9 * pow( 1.0 - max( dot( -cwV, cwN ), 0.0 ), 4.0 );
    vec3 sky = mix( cityHor, cityZen, smoothstep( 0.0, 0.55, cwR.y ) );
    float sd = max( dot( cwR, citySunD ), 0.0 );
    sky += citySunC * ( 3.0 * pow( sd, 300.0 ) + 0.5 * pow( sd, 10.0 ) );
    sky = mix( sky, cityGround, smoothstep( 0.02, -0.25, cwR.y ) );
    outgoingLight = mix( outgoingLight, sky, cityGlass * cityRefl * fr );
    outgoingLight += cityLitC * cityLit * ( 1.0 - 0.6 * fr );
  }
  #include <opaque_fragment>`);
    } }];
  },
};

function createCityKit() {
  const C3 = (h) => new THREE.Color(h);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.shared = true; mat.userData.sunHooks = CityLook.hooks(); mat.extensions = { derivatives: true };
  const gmat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  gmat.userData.shared = true;
  // a highway on the ground: its deck is drawn pulled further toward the camera than the streets under it, which
  // otherwise win from a few hundred metres off (their own pull, against the terrain, grows with distance)
  const rmat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 });
  rmat.userData.shared = true; rmat.userData.sunHooks = CityLook.hooks(); rmat.extensions = { derivatives: true };
  // palettes: towers' spandrels and mullions (the glass is the shader's), concrete, flats, houses, roofs
  const TOWER = ['#6f7a84', '#3d4a56', '#8a7458', '#a7adb2', '#2f3a42', '#5f6f6a'].map(C3);
  const MID = ['#b9ad98', '#a5553f', '#8f9296', '#cfc6b2', '#7d6a5a', '#b7b8b2'].map(C3);
  const FLATS = ['#e2d7bd', '#d6d4cc', '#c98e6b', '#e8e2d2', '#b9c2c6', '#d9c49a', '#c7b3a3'].map(C3);
  // houses: whites and creams, the painted timber colours (red ochre, yellow, blue, green, grey) and some brick
  const HOUSE = ['#efe9dc', '#e3d3b3', '#c9d3d6', '#e8dca6', '#d4c2ad', '#bfc7b5', '#a8432f', '#d9b44a', '#7d9cbf', '#8fae7a',
    '#e3a48c', '#6e747b', '#b5654a', '#f2e6c8', '#9fb7c9', '#c9c06a', '#8a5a44', '#d7d2c4'].map(C3);
  const ROOF = ['#7a3b2e', '#4a4b50', '#6a4a37', '#5d3a33', '#2f3236', '#a14f34', '#3f5a4c', '#6b6f73'].map(C3);
  const FAR = ['#cbbfa8', '#b9b4aa', '#d6ccb6', '#a99f92', '#c7a68c', '#bfc4c6', '#d9d0bd', '#9e8c7c'].map(C3);
  const FLATROOF = C3('#6e6c69'), ROOFBOX = C3('#9a9792'), TRUNK = C3('#5b4633'), MAST = C3('#c9c9c4'), PAD_MARK = C3('#e8e6df');
  const TREE = ['#4f7a3a', '#5d8a40', '#6b8f3f', '#45703a'].map(C3);
  const URBAN = C3('#6a6966'), ASPHALT = C3('#4b4d51'), WALK = C3('#9c9a95'), PLAZA = C3('#a29f97'), LAWN = C3('#7a9a52'), YARD = C3('#86a05a'), LOT = C3('#8c8b86');
  const DECK = C3('#6a6c70'), DECKSIDE = C3('#a8a59d'), BARRIER = C3('#c4c1b8'), PIER = C3('#a39f96');
  const ICO = new THREE.OctahedronGeometry(1, 0).attributes.position;    // tree crowns: 8 facets (already non-indexed)

  // one chunk's arrays; triangles come out facing `want` (their normal is flipped to point that way)
  const CH = 6 * 110;
  function chunks() {
    const map = new Map();
    let cur = null;
    return {
      at(x, z) { const key = Math.floor(x / CH) * 4096 + Math.floor(z / CH); cur = map.get(key); if (!cur) map.set(key, cur = { p: [], c: [], w: [] }); },
      tri(a, b, c, col, wa, wb, wc, nx, ny, nz) {
        const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
        const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
        if (cx * nx + cy * ny + cz * nz < 0) { const t = b; b = c; c = t; const tw = wb; wb = wc; wc = tw; }
        cur.p.push(...a, ...b, ...c);
        cur.c.push(col.r, col.g, col.b, col.r, col.g, col.b, col.r, col.g, col.b);
        cur.w.push(...wa, ...wb, ...wc);
      },
      meshes(material, group) {
        for (const ch of map.values()) {
          if (!ch.p.length) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(ch.p, 3));
          g.setAttribute('color', new THREE.Float32BufferAttribute(ch.c, 3));
          g.setAttribute('cityWin', new THREE.Float32BufferAttribute(ch.w, 4));
          g.computeVertexNormals(); g.computeBoundingSphere();
          group.add(new THREE.Mesh(g, material));
          tris += ch.p.length / 9;
        }
      },
    };
  }
  const W0 = [0, 0, 0, 0];
  let tris = 0, M = null, GR = null, RD = null;
  const jit = (c, r) => { const k = 0.92 + r * 0.14; return _jc.setRGB(c.r * k, c.g * k, c.b * k); };
  const _jc = new THREE.Color();

  // quad a b c d (a b along the bottom, d c along the top, as seen from `n` side)
  function quad(K, a, b, c, d, col, n, wa = W0, wb = W0, wc = W0, wd = W0) {
    K.tri(a, b, c, col, wa, wb, wc, n[0], n[1], n[2]); K.tri(a, c, d, col, wa, wc, wd, n[0], n[1], n[2]);
  }
  // a box's walls (windowed) and roof; u runs on round the corners so the windows line up; v from vBase
  function walls(b, hu, hv, y0, y1, col, style, roofCol, vBase) {
    const { UX, UZ, VX, VZ } = CITY.axes, cx = b.x, cz = b.z;
    const P = (su, sv, y) => [cx + UX * hu * su + VX * hv * sv, y, cz + UZ * hu * su + VZ * hv * sv];
    const sides = [[-1, -1, 1, -1, hu * 2, [-VX, 0, -VZ]], [1, -1, 1, 1, hv * 2, [UX, 0, UZ]], [1, 1, -1, 1, hu * 2, [VX, 0, VZ]], [-1, 1, -1, -1, hv * 2, [-UX, 0, -UZ]]];
    let u = (b.seed % 7) * 1.1;
    for (const [au, av, bu, bv, len, n] of sides) {
      const w = (uu, y) => [uu, y - vBase, style, b.seed];
      quad(M, P(au, av, y0), P(bu, bv, y0), P(bu, bv, y1), P(au, av, y1), col, n, w(u, y0), w(u + len, y0), w(u + len, y1), w(u, y1));
      u += len;
    }
    if (roofCol) quad(M, P(-1, -1, y1), P(1, -1, y1), P(1, 1, y1), P(-1, 1, y1), roofCol, [0, 1, 0]);
  }
  function plainBox(x, z, ux, uz, hu, hv, y0, y1, col, top = true) {
    const vx = -uz, vz = ux, P = (su, sv, y) => [x + ux * hu * su + vx * hv * sv, y, z + uz * hu * su + vz * hv * sv];
    for (const [au, av, bu, bv, n] of [[-1, -1, 1, -1, [-vx, 0, -vz]], [1, -1, 1, 1, [ux, 0, uz]], [1, 1, -1, 1, [vx, 0, vz]], [-1, 1, -1, -1, [-ux, 0, -uz]]])
      quad(M, P(au, av, y0), P(bu, bv, y0), P(bu, bv, y1), P(au, av, y1), col, n);
    if (top) quad(M, P(-1, -1, y1), P(1, -1, y1), P(1, 1, y1), P(-1, 1, y1), col, [0, 1, 0]);
  }
  // pitched roof over a footprint: gable along the ridge axis, or hipped
  function roof(b, hu, hv, y0, rh, col, wallCol) {
    const { UX, UZ, VX, VZ } = CITY.axes, o = 0.45, alongU = b.ridge !== 'v';
    const P = (u, v, y) => [b.x + UX * u + VX * v, y, b.z + UZ * u + VZ * v];
    const L = (alongU ? hu : hv) + o, Wd = (alongU ? hv : hu) + o;   // half length along the ridge, half width across
    const Q = alongU ? (r, s, y) => P(r, s, y) : (r, s, y) => P(s, r, y);
    const top = y0 + rh, hip = b.hip ? Math.min(L * 0.8, Wd) : 0;
    const nA = alongU ? [-VX, 1, -VZ] : [-UX, 1, -UZ], nB = alongU ? [VX, 1, VZ] : [UX, 1, UZ];
    quad(M, Q(-L, -Wd, y0), Q(L, -Wd, y0), Q(L - hip, 0, top), Q(-L + hip, 0, top), col, nA);
    quad(M, Q(L, Wd, y0), Q(-L, Wd, y0), Q(-L + hip, 0, top), Q(L - hip, 0, top), col, nB);
    const nE = alongU ? [UX, 0.3, UZ] : [VX, 0.3, VZ];
    M.tri(Q(L, -Wd, y0), Q(L, Wd, y0), Q(L - hip, 0, top), hip ? col : wallCol, W0, W0, W0, nE[0], nE[1], nE[2]);
    M.tri(Q(-L, Wd, y0), Q(-L, -Wd, y0), Q(-L + hip, 0, top), hip ? col : wallCol, W0, W0, W0, -nE[0], nE[1], -nE[2]);
    quad(M, Q(-L, -Wd, y0 - 0.25), Q(L, -Wd, y0 - 0.25), Q(L, Wd, y0 - 0.25), Q(-L, Wd, y0 - 0.25), col, [0, -1, 0]);   // eaves underside
  }
  function treeMesh(t) {
    const h = t.h, r = t.r, G = CITY.G, col = jit(TREE[Math.floor(t.c * 4)], t.c), cy = G + h - r * 0.95;
    const s = [r * 1.08, r * 0.95, r * 1.08], rot = t.c * 6.28, cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i < ICO.count; i += 3) {
      const v = [];
      for (let k = 0; k < 3; k++) { const x = ICO.getX(i + k) * s[0], y = ICO.getY(i + k) * s[1], z = ICO.getZ(i + k) * s[2]; v.push([t.x + x * cr - z * sr, cy + y, t.z + x * sr + z * cr]); }
      const mx = (v[0][0] + v[1][0] + v[2][0]) / 3 - t.x, my = (v[0][1] + v[1][1] + v[2][1]) / 3 - cy, mz = (v[0][2] + v[1][2] + v[2][2]) / 3 - t.z;
      M.tri(v[0], v[1], v[2], col, W0, W0, W0, mx, my, mz);
    }
    plainBox(t.x, t.z, 1, 0, 0.22, 0.22, G, cy - r * 0.5, TRUNK, false);
  }

  // a box between two points (a beam, a cable), size m square; `up` keeps its sides square to the world's up
  const _b0 = new THREE.Vector3(), _b1 = new THREE.Vector3(), _bs = new THREE.Vector3(), _bu = new THREE.Vector3();
  function beam(K, p0, p1, size, col) {
    _b0.set(...p0); _b1.set(...p1).sub(_b0);
    const L = _b1.length(); if (L < 1e-4) return;
    _b1.divideScalar(L);
    _bs.crossVectors(_b1, Math.abs(_b1.y) > 0.95 ? _bu.set(1, 0, 0) : _bu.set(0, 1, 0)).normalize().multiplyScalar(size / 2);
    _bu.crossVectors(_bs, _b1).normalize().multiplyScalar(size / 2);
    const P = (t, a, c) => [_b0.x + _b1.x * L * t + _bs.x * a + _bu.x * c, _b0.y + _b1.y * L * t + _bs.y * a + _bu.y * c, _b0.z + _b1.z * L * t + _bs.z * a + _bu.z * c];
    for (const [a1, c1, a2, c2] of [[1, 1, 1, -1], [1, -1, -1, -1], [-1, -1, -1, 1], [-1, 1, 1, 1]]) {
      const nx = (a1 + a2) / 2, nc = (c1 + c2) / 2;
      const n = [_bs.x * nx * 2 / size + _bu.x * nc * 2 / size, _bs.y * nx * 2 / size + _bu.y * nc * 2 / size, _bs.z * nx * 2 / size + _bu.z * nc * 2 / size];
      quad(K, P(0, a1, c1), P(0, a2, c2), P(1, a2, c2), P(1, a1, c1), col, n);
    }
  }
  const kctx = { C3, W0, quad, plainBox, walls, beam, jit, get M() { return M; }, get GR() { return GR; }, get RD() { return RD; }, chunks };
  const DRAW = Object.assign({}, ...CITY_PLUGINS.map((pl) => pl.draw || {}));
  const LOTS = {};

  function building(b) {
    if (DRAW[b.k]) return DRAW[b.k](kctx, b);
    const r = mulberry32(b.seed * 31 + 7), G = CITY.G;
    if (b.k === 'tower') {
      let y0 = b.y0;
      const col = TOWER[b.c], last = b.tiers.length - 1;
      b.tiers.forEach(([hu, hv, y1], i) => { walls(b, hu, hv, y0, y1, col, 1, FLATROOF, b.y0); y0 = y1; });
      const [hu, hv, top] = b.tiers[last];
      if (b.crown === 1) plainBox(b.x, b.z, CITY.axes.UX, CITY.axes.UZ, hu * 0.55, hv * 0.55, top, top + b.cap, ROOFBOX);
      else if (b.crown === 2) {                                // a glass crown: a slimmer top, then a mast
        walls({ x: b.x, z: b.z, seed: b.seed }, hu * 0.78, hv * 0.78, top, top + b.cap * 0.6, col, 1, FLATROOF, b.y0);
        plainBox(b.x, b.z, 1, 0, 0.6, 0.6, top + b.cap * 0.6, top + b.cap, MAST);
      } else if (b.crown === 3) {                              // a spire: stepped, then a needle
        plainBox(b.x, b.z, CITY.axes.UX, CITY.axes.UZ, hu * 0.5, hv * 0.5, top, top + b.cap * 0.25, col);
        plainBox(b.x, b.z, CITY.axes.UX, CITY.axes.UZ, hu * 0.25, hv * 0.25, top + b.cap * 0.25, top + b.cap * 0.4, col);
        plainBox(b.x, b.z, 1, 0, 0.5, 0.5, top + b.cap * 0.4, top + b.cap, MAST);
      } else if (b.crown === 4) {                              // a helipad: a raised deck with a pale H on it
        const { UX, UZ } = CITY.axes, d = Math.min(hu, hv) * 0.72, w = d * 0.11, y = top + 0.6;
        plainBox(b.x, b.z, UX, UZ, d, d, top, y, ROOFBOX);
        for (const s of [-1, 1]) plainBox(b.x + UX * s * d * 0.32, b.z + UZ * s * d * 0.32, UX, UZ, w, d * 0.48, y, y + 0.08, PAD_MARK);
        plainBox(b.x, b.z, UX, UZ, d * 0.32, w, y, y + 0.08, PAD_MARK);
      }
      return;
    }
    if (b.k === 'podium' || b.k === 'mid' || b.k === 'flats') {
      const pal = b.k === 'flats' ? FLATS : b.k === 'podium' ? MID : MID, col = pal[b.c % pal.length];
      let y0 = b.y0;
      for (const [hu, hv, y1] of b.tiers) { walls(b, hu, hv, y0, y1, col, b.st, FLATROOF, b.y0); y0 = y1; }
      const [hu, hv, top] = b.tiers[b.tiers.length - 1];
      plainBox(b.x, b.z, CITY.axes.UX, CITY.axes.UZ, hu + 0.3, hv + 0.3, top, top + 0.8, col, false);   // parapet
      if (b.roofBox) plainBox(b.x + (r() - 0.5) * hu, b.z + (r() - 0.5) * hv, CITY.axes.UX, CITY.axes.UZ, 2 + r() * 3, 2 + r() * 3, top, top + 2.5 + r() * 2, ROOFBOX);
      return;
    }
    if (b.k === 'far') {                                     // the sprawl: a plain box, windowed, flat roof
      const [hu, hv, top] = b.tiers[0];
      walls(b, hu, hv, b.y0, top, jit(FAR[b.c % FAR.length], (b.c % 97) / 97), b.st, FLATROOF, b.y0);
      return;
    }
    if (b.k === 'house' || b.k === 'row') {
      const [hu, hv, top] = b.tiers[0], col = jit(HOUSE[b.c % HOUSE.length], (b.c % 89) / 89).clone(), rc = jit(ROOF[b.roofC % ROOF.length], (b.roofC % 83) / 83).clone();
      walls(b, hu, hv, b.y0, top, col, 4, null, b.y0);
      roof(b, hu, hv, top, b.cap, rc, col);
      if (b.chimney) plainBox(b.x + CITY.axes.UX * hu * 0.5, b.z + CITY.axes.UZ * hu * 0.5, CITY.axes.UX, CITY.axes.UZ, 0.45, 0.45, top, top + b.cap + 1.1, ROOF[1]);
    }
  }

  function ground(blk) {
    const { UX, UZ, VX, VZ } = CITY.axes, B = CITY.C.block, S = CITY.C.street, y = CITY.G;
    const P = (u, v) => [blk.x + UX * u + VX * v, y, blk.z + UZ * u + VZ * v];
    if (blk.grass || blk.detail < 0) { const o = B / 2; quad(GR, P(-o, -o), P(o, -o), P(o, o), P(-o, o), blk.grass ? LAWN : URBAN, [0, 1, 0]); return; }   // grass (a plugin's), the sprawl: one quad
    const ring = (o, i, col) => {                           // the frame between half-sizes o and i
      quad(GR, P(-o, -o), P(o, -o), P(i, -i), P(-i, -i), col, [0, 1, 0]); quad(GR, P(o, -o), P(o, o), P(i, i), P(i, -i), col, [0, 1, 0]);
      quad(GR, P(o, o), P(-o, o), P(-i, i), P(i, i), col, [0, 1, 0]); quad(GR, P(-o, o), P(-o, -o), P(-i, -i), P(-i, i), col, [0, 1, 0]);
    };
    const o = B / 2, s = B / 2 - S / 2, l = s - 2.5;
    ring(o, s, ASPHALT); ring(s, l, WALK);
    const lot = blk.lot ? (LOTS[blk.lot] || (LOTS[blk.lot] = C3(blk.lot))) : blk.park ? LAWN : blk.ring === 0 ? PLAZA : blk.ring === 1 ? LOT : blk.ring === 2 ? YARD : LAWN;
    quad(GR, P(-l, -l), P(l, -l), P(l, l), P(-l, l), lot, [0, 1, 0]);
  }

  function highway(H) {
    const G = CITY.G, w = H.w / 2;
    let u = 0;
    for (let i = 0; i < H.n - 1; i++) {
      const ax = H.X[i], az = H.Z[i], bx = H.X[i + 1], bz = H.Z[i + 1], L = Math.hypot(bx - ax, bz - az) || 1;
      // across: the mean of this segment's and the neighbours' directions, so the deck's edges join up
      const nrm = (k) => { const k0 = Math.max(0, k - 1), k1 = Math.min(H.n - 1, k + 1), dx = H.X[k1] - H.X[k0], dz = H.Z[k1] - H.Z[k0], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
      const [nax, naz] = nrm(i), [nbx, nbz] = nrm(i + 1);
      const ya = G + Math.max(0.25, H.H[i]), yb = G + Math.max(0.25, H.H[i + 1]);
      M.at((ax + bx) / 2, (az + bz) / 2);
      const A = (s, y) => [ax + nax * s, y, az + naz * s], Bp = (s, y) => [bx + nbx * s, y, bz + nbz * s];
      const wv = (uu, s) => [uu, s, 5, w];
      const onGround = H.H[i] < 1.5 && H.H[i + 1] < 1.5;
      if (onGround) RD.at((ax + bx) / 2, (az + bz) / 2);
      quad(onGround ? RD : M, A(-w, ya), Bp(-w, yb), Bp(w, yb), A(w, ya), DECK, [0, 1, 0], wv(u, -w), wv(u + L, -w), wv(u + L, w), wv(u, w));
      for (const sd of [-1, 1]) {                              // deck edge, and the barrier on it
        const e = sd * w;
        quad(M, A(e, ya - DECK_T), Bp(e, yb - DECK_T), Bp(e, yb), A(e, ya), DECKSIDE, [nax * sd, 0, naz * sd]);
        const e2 = sd * (w - 0.5);
        quad(M, A(e, ya), Bp(e, yb), Bp(e, yb + BARRIER_H), A(e, ya + BARRIER_H), BARRIER, [nax * sd, 0, naz * sd]);
        quad(M, A(e2, ya), Bp(e2, yb), Bp(e2, yb + BARRIER_H), A(e2, ya + BARRIER_H), BARRIER, [-nax * sd, 0, -naz * sd]);
        quad(M, A(e2, ya + BARRIER_H), Bp(e2, yb + BARRIER_H), Bp(e, yb + BARRIER_H), A(e, ya + BARRIER_H), BARRIER, [0, 1, 0]);
      }
      for (const sd of [-1, 1]) quad(M, A(sd * 0.35, ya), Bp(sd * 0.35, yb), Bp(sd * 0.35, yb + 0.9), A(sd * 0.35, ya + 0.9), BARRIER, [nax * sd, 0, naz * sd]);   // median
      if (H.H[i] > 1.5 || H.H[i + 1] > 1.5) quad(M, A(-w, ya - DECK_T), Bp(-w, yb - DECK_T), Bp(w, yb - DECK_T), A(w, ya - DECK_T), DECKSIDE, [0, -1, 0]);
      u += L;
    }
  }
  function pier(p) {
    const G = CITY.G;
    M.at(p.x, p.z);
    plainBox(p.x, p.z, p.ux, p.uz, 1.3, 1.6, G - 0.3, p.top - 1.4, PIER, false);
    plainBox(p.x, p.z, p.ux, p.uz, 1.6, p.w / 2 - 2, p.top - 1.4, p.top, PIER, false);   // hammerhead
  }

  function build(group) {
    if (!CITY.on) return;
    tris = 0;
    M = chunks(); GR = chunks(); RD = chunks();
    for (const b of CITY.bld) { M.at(b.x, b.z); building(b); }
    for (const t of CITY.trees) { M.at(t.x, t.z); treeMesh(t); }
    for (const H of CITY.hw) highway(H);
    for (const p of CITY.piers) pier(p);
    for (const blk of CITY.blocks) { GR.at(blk.x, blk.z); ground(blk); }
    const g = new THREE.Group(); g.userData.city = true;
    for (const pl of CITY_PLUGINS) if (pl.kit) pl.kit.build(kctx, g);
    M.meshes(mat, g); GR.meshes(gmat, g); RD.meshes(rmat, g);
    group.add(g);
    CITY.stats.tris = tris;
    // the sky the glass reflects, and the sun in it (js/skylight.js, when the course sets its own light)
    if (typeof Skylight !== 'undefined' && Skylight.current) {
      const L = Skylight.current, U = CityLook.U;
      U.cityZen.value.copy(L.sky); U.cityHor.value.copy(L.horizon); U.citySunC.value.copy(L.sunColor); U.citySunD.value.copy(L.sunDir);
      U.cityLights.value = L.lights == null ? 0.3 : L.lights;
    }
    M = GR = RD = null;
  }
  return { build };
}
