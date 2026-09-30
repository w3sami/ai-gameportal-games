'use strict';
/* =========================================================================
   FAIR — a country fair for the Farm theme (Fairgrounds Run), as a js/shore.js plugin: tents, stalls, hay bales and
   hot air balloons, and the ribbon cut upside down at the finish.
   Course file: fair: { tents, stalls, bales, balloons, grounds }
     tents     [[x, z, fx, fz, type, w, d, style], ...]  type "marquee" (w wide across its front, d deep, a striped ridge
               roof) or "top" (a round big top, w across; d unused); front facing (fx, fz); style picks the colours
     stalls    [[x, z, fx, fz, style], ...]  market stalls (3.2 m wide), the counter facing (fx, fz)
     bales     [[x, z, fx, fz, rows], ...]  stacks of big square bales, rows high (a pyramid)
     balloons  [[x, z, alt, size, style], ...]  hot air balloons: the basket alt m above the ground (0: on the ground,
               filled and tethered), size scales the envelope (1 = about 18 m across, 25 m tall)
     grounds   [[x0, z0, x1, z1], ...]  the fairground's grass: no crop fields, hedges or trees within these rectangles
   Gates (GATE_TYPES, js/sim.js):
     "ribbon"  a ribbon between two poles, cut flying upside down (the inverted hoop's rule, js/aerobatic.js; the sign
               over it too). The point is the ribbon's middle, so its clearance is the ribbon's height. It counts
               passing between the poles within RIBBON.band m of the ribbon. Options { w }: the gap between the poles (m).
   A hoop with option bales: a stack of hay bales under it (rows high, default 3), to skim over.
   Everything is a crash (CRASH_TEXT), also by a wingtip (CRASH_PLUGINS); the balloons' envelopes are ellipsoids.
   This plugin builds before js/farm.js's, so the fields and hedges keep off the fairground.
   Sim part (no DOM): buildFair() (a SHORE plugin), FAIR (what was placed, for the tests).
   Game part: the meshes (createFairKit, in FAIR_CHUNK m squares) and the ribbon (GATE_KITS): lit when it's next, cut in
   two when flown through, the halves dropping to hang from the poles.
   ========================================================================= */
const RIBBON = { w: 26, band: 3.5, poleR: 0.45, above: 5 };     // gap between poles, counting band either side, pole radius, pole over the ribbon
const FAIR_BALE = { l: 2.4, w: 1.2, h: 0.9 };                  // a big square bale (m)
const FAIR_CHUNK = 300;
const FAIR = { tents: [], stalls: [], stacks: [], balloons: [], ribbons: [], tipBoxes: [] };
const BALLOON = { r: 9, h: 25, basket: 1.3, throat: 4 };       // envelope radius and height, basket height, basket top to envelope (size 1)

const ribbonW = (h) => (h.opts && h.opts.w) || RIBBON.w;
GATE_TYPES.ribbon = {
  shape(h, u, v) { return Math.abs(u) < ribbonW(h) / 2 - 0.8 && Math.abs(v) < RIBBON.band; },
  rule: (P, h) => GATE_TYPES.I.rule(P, h),                   // upside down, as an inverted hoop
  disc: () => 0,                                             // the ribbon is the target
  top: () => RIBBON.above + 1,
  far: 300,
  inverted: true,                                            // js/aerobatic.js: the autopilot rolls over, the sign, the callout
};

function fairBox(kind, x, z, ux, uz, hu, hv, y0, y1) {
  const b = shoreBox(kind, x, z, ux, uz, hu, hv, y0, y1);
  FAIR.tipBoxes.push(b);
  return b;
}
const fairDir = (fx, fz) => { const L = Math.hypot(fx, fz) || 1; return [fx / L, fz / L]; };
function fairLow(x, z, ux, uz, hu, hv) {                    // lowest ground under a footprint (as js/farm.js's footLow)
  let lo = Infinity;
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) lo = Math.min(lo, heightAt(x + ux * a * hu - uz * b * hv, z + uz * a * hu + ux * b * hv));
  return lo;
}
function buildFair() {
  for (const k in FAIR) FAIR[k].length = 0;
  if (!COURSE) return;
  const F = COURSE.fair || {};
  // the grounds first: js/farm.js lays no field, hedge or hedge tree over a 'farmyard', and the game's trees keep off
  for (const g of F.grounds || []) {
    const x = (g[0] + g[2]) / 2, z = (g[1] + g[3]) / 2;
    shoreBox('farmyard', x, z, 1, 0, Math.abs(g[2] - g[0]) / 2, Math.abs(g[3] - g[1]) / 2, FARM_TREE_NONE - 1, FARM_TREE_NONE);
  }
  for (const t of F.tents || []) {
    const [fx, fz] = fairDir(t[2], t[3]), type = t[4] || 'marquee', w = t[5] || 10, d = type === 'top' ? w : t[6] || 8;
    const y = fairLow(t[0], t[1], -fz, fx, w / 2, d / 2);
    const wall = type === 'top' ? 3.2 + w * 0.08 : 2.6, roof = type === 'top' ? w * 0.42 : Math.min(d * 0.45, 4.2);
    const o = { x: t[0], z: t[1], fx, fz, type, w, d, y, wall, roof, style: t[7] || 0 };
    FAIR.tents.push(o);
    if (type === 'top') {                                    // round: a box for the walls, a narrower one for the roof
      fairBox('tent', o.x, o.z, 1, 0, w * 0.42, w * 0.42, y - 1, y + wall + roof * 0.35);
      fairBox('tent', o.x, o.z, 1, 0, w * 0.2, w * 0.2, y + wall, y + wall + roof + 2.2);
    } else fairBox('tent', o.x, o.z, -fz, fx, w / 2 + 0.3, d / 2 + 0.3, y - 1, y + wall + roof + 0.4);
  }
  for (const s of F.stalls || []) {
    const [fx, fz] = fairDir(s[2], s[3]), y = fairLow(s[0], s[1], -fz, fx, 1.6, 1.3);
    FAIR.stalls.push({ x: s[0], z: s[1], fx, fz, y, style: s[4] || 0 });
    fairBox('stall', s[0], s[1], -fz, fx, 1.9, 1.7, y - 1, y + 3.4);
  }
  for (const b of F.bales || []) addBales(b[0], b[1], b[2], b[3], b[4] || 3);
  HOOPS.forEach((h) => {
    if (h.kind === 'hoop' && h.opts.bales) { const f = gateFrame(h); addBales(h.pos.x, h.pos.z, -f.fz, f.fx, h.opts.bales === true ? 3 : h.opts.bales); }
    if (h.kind === 'ribbon') buildRibbon(h);
  });
  for (const b of F.balloons || []) {
    const s = b[3] || 1, g = heightAt(b[0], b[1]), alt = b[2] || 0;
    const o = { x: b[0], z: b[1], base: g + alt, s, style: b[4] || 0, ground: !alt, r: BALLOON.r * s, h: BALLOON.h * s };
    o.cy = o.base + (BALLOON.basket + BALLOON.throat) * s + o.h * 0.58;   // the envelope's widest, where its ellipsoid is centred
    FAIR.balloons.push(o);
    if (o.ground) shoreBox('farmyard', o.x, o.z, 1, 0, o.r + 16, o.r + 16, FARM_TREE_NONE - 1, FARM_TREE_NONE);
  }
}
function addBales(x, z, fx, fz, rows) {                     // a pyramid of bales, laid across (fx, fz)
  const [ux, uz] = fairDir(fx, fz), n = rows + 1, y = fairLow(x, z, ux, uz, n * FAIR_BALE.w / 2, FAIR_BALE.l / 2);
  FAIR.stacks.push({ x, z, ux, uz, rows, y });
  fairBox('bales', x, z, ux, uz, n * FAIR_BALE.w / 2 + 0.1, FAIR_BALE.l / 2 + 0.1, y - 1, y + rows * FAIR_BALE.h);
}
function buildRibbon(h) {
  const f = gateFrame(h), W = ribbonW(h), top = h.pos.y + RIBBON.above;
  const poles = [-1, 1].map((s) => {
    const x = h.pos.x + f.rx * s * (W / 2 + RIBBON.poleR), z = h.pos.z + f.rz * s * (W / 2 + RIBBON.poleR), foot = groundAt(x, z) - 0.5;
    fairBox('pole', x, z, f.fx, f.fz, RIBBON.poleR, RIBBON.poleR, foot, top + 0.8);
    return { x, z, foot, top };
  });
  FAIR.ribbons.push({ h, poles });
  shoreBox('farmyard', h.pos.x, h.pos.z, f.fx, f.fz, 40, W / 2 + 20, FARM_TREE_NONE - 1, FARM_TREE_NONE);
}
// a balloon's envelope as an ellipsoid (a little inside the drawn one), and its basket
function balloonHit(p, pad) {
  for (const b of FAIR.balloons) {
    const dx = p.x - b.x, dz = p.z - b.z;
    if (dx * dx + dz * dz > (b.r + 6) ** 2) continue;
    const ey = (p.y - b.cy) / (b.h * 0.55 + pad), er = (b.r * 0.95 + pad);
    if ((dx * dx + dz * dz) / (er * er) + ey * ey < 1) return true;
    const bs = 0.9 * b.s + pad;
    if (Math.abs(dx) < bs && Math.abs(dz) < bs && p.y > b.base - pad && p.y < b.base + BALLOON.basket * b.s + BALLOON.throat * b.s + pad) return true;
  }
  return false;
}
const _frR = new THREE.Vector3(), _frP = new THREE.Vector3();
function fairHit(P) {
  if (FAIR.balloons.length && balloonHit(P.pos, 0.9)) return 'balloon';
  if (!FAIR.tipBoxes.length && !FAIR.balloons.length) return null;
  _frR.set(1, 0, 0).applyQuaternion(P.q);                   // the wingtips (the centre is shoreHit's)
  for (const s of [-1, -0.5, 0.5, 1]) {
    _frP.copy(P.pos).addScaledVector(_frR, s * TUNE.WING_HALF);
    if (FAIR.balloons.length && balloonHit(_frP, 0.15)) return 'balloon';
    for (const b of FAIR.tipBoxes) {
      if (_frP.y < b.y0 - 0.15 || _frP.y > b.y1 + 0.15) continue;
      if (Math.abs(_frP.x - b.x) > b.hu + b.hv + 1 || Math.abs(_frP.z - b.z) > b.hu + b.hv + 1) continue;
      if (shoreInBox(b, _frP.x, _frP.z, 0.15)) return b.kind;
    }
  }
  return null;
}
CRASH_PLUGINS.push(fairHit);
Object.assign(CRASH_TEXT, { tent: 'Hit a tent', stall: 'Hit a stall', bales: 'Hit the hay bales', balloon: 'Hit a balloon' });

/* ---------- game part ---------- */
function createFairKit() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.shared = true;
  const Mx = createMesher(), { BOX, CBOX, CYL, CONE, PRISM, ICO } = Mx.G;
  const C = (h) => new THREE.Color(h);
  const CANVAS = C('#f4f1e8'), POST = C('#8a6a48'), WOOD = C('#a37a4e'), HAY = C('#dcc27a'), HAY2 = C('#cdb163');
  const WICKER = C('#8b5e34'), DARK = C('#3a3430'), GOLD = C('#e8c14a'), ROPE = C('#d9d2bf');
  // colour pairs per style: stripes, trim
  const STRIPES = [['#d63a33', '#f4f1e8'], ['#2f6fc4', '#f4f1e8'], ['#e2b72e', '#d63a33'], ['#2e9a5a', '#f4f1e8'], ['#7a4bb8', '#f2d24a'], ['#e0782a', '#f4f1e8']].map((p) => p.map(C));
  const ENVELOPE = [['#e2352e', '#f6c22c', '#2b62c4'], ['#f2f0e6', '#2d8f4e', '#e2352e'], ['#7b3fb8', '#f28a2a', '#f6c22c'],
    ['#1f9ab0', '#f2f0e6', '#e2352e'], ['#f6c22c', '#e2352e', '#2b2b2b'], ['#e85aa0', '#f2f0e6', '#3f6fd0']].map((p) => p.map(C));
  // round pieces n to the circle, one slice each (so a slice can take its own colour): a cone's wedge and a wall panel,
  // both of radius 1, height 1, from angle 0 to 2π/n, faces out
  const slices = new Map();
  function slice(n) {
    if (slices.has(n)) return slices.get(n);
    const a = TAU / n, c = Math.cos(a), s = Math.sin(a), geo = (P) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); return g.attributes.position; };
    // three.js y-rotation takes +x toward -z, so angle a sits at (cos a, -sin a); wound anticlockwise seen from outside,
    // so their fronts face out
    const wedge = geo([1, 0, 0, c, 0, -s, 0, 1, 0]);
    const panel = geo([1, 0, 0, c, 1, -s, 1, 1, 0, 1, 0, 0, c, 0, -s, c, 1, -s]);
    slices.set(n, { wedge, panel, a });
    return slices.get(n);
  }
  function bigTop(o) {                                       // round walls in panels, a striped cone, a flag on the king pole
    const n = 14, S = slice(n), [c0, c1] = STRIPES[o.style % STRIPES.length], R = o.w / 2;
    Mx.frame(o.x, o.y, o.z, o.fx, o.fz);
    for (let k = 0; k < n; k++) {
      Mx.part(S.panel, k % 2 ? CANVAS : c0, 0, -0.6, 0, R, o.wall + 0.6, R, k * S.a);
      Mx.part(S.wedge, k % 2 ? c1 : c0, 0, o.wall, 0, R * 1.06, o.roof, R * 1.06, k * S.a);
    }
    Mx.part(BOX, DARK, 0, 0, -R + 0.05, 2.4, 2.6, 0.2);         // the way in
    Mx.part(CYL, POST, 0, o.wall + o.roof - 0.4, 0, 0.15, 2.6, 0.15);
    Mx.part(BOX, c1 === CANVAS ? c0 : c1, 0.9, o.wall + o.roof + 1.2, 0, 1.6, 0.9, 0.06);
    // a scalloped valance round the eaves
    for (let k = 0; k < n; k++) Mx.part(S.panel, c1 === CANVAS ? c0 : c1, 0, o.wall - 0.5, 0, R * 1.06 + 0.02, 0.5, R * 1.06 + 0.02, k * S.a);
  }
  function marquee(o) {                                      // box walls, a ridge roof in stripes along it, poles at the gables
    const [c0, c1] = STRIPES[o.style % STRIPES.length];
    Mx.frame(o.x, o.y, o.z, o.fx, o.fz);                        // local -z out of its front: width along x, depth along z
    Mx.part(BOX, CANVAS, 0, -0.6, 0, o.w, o.wall + 0.6, o.d);
    Mx.part(BOX, DARK, 0, 0, -o.d / 2 - 0.02, o.w * 0.5, o.wall - 0.4, 0.06);   // open front
    const k = Math.max(3, Math.round(o.w / 1.6));
    for (let i = 0; i < k; i++) {                               // the roof's ridge runs along x: stripes across it
      const x = -o.w / 2 + (i + 0.5) * o.w / k;
      Mx.part(PRISM, i % 2 ? c1 : c0, x, o.wall, 0, o.d + 0.5, o.roof, o.w / k + 0.01, Math.PI / 2);
    }
    for (const s of [-1, 1]) {
      Mx.part(CYL, POST, s * (o.w / 2 + 0.1), o.wall + o.roof - 0.3, 0, 0.1, 1.6, 0.1);
      Mx.part(BOX, c0, s * (o.w / 2 + 0.1) + 0.55, o.wall + o.roof + 0.7, 0, 1.0, 0.55, 0.05);
    }
    for (let i = 0; i < k; i++) Mx.part(BOX, i % 2 ? c1 : c0, -o.w / 2 + (i + 0.5) * o.w / k, o.wall - 0.45, -o.d / 2 - 0.26, o.w / k + 0.01, 0.45, 0.06);   // valance
  }
  function stall(o) {                                        // counter, back board, posts and a striped awning sloping down to the front
    const [c0, c1] = STRIPES[o.style % STRIPES.length], w = 3.2, d = 2.4;
    Mx.frame(o.x, o.y, o.z, o.fx, o.fz);
    Mx.part(BOX, WOOD, 0, -0.4, -d / 2 + 0.35, w, 1.4, 0.7);
    Mx.part(BOX, c0, 0, 0.3, -d / 2 - 0.01, w, 0.35, 0.02);
    Mx.part(BOX, WOOD, 0, -0.4, d / 2 - 0.1, w, 2.9, 0.2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) Mx.part(BOX, POST, sx * (w / 2 - 0.08), -0.4, sz * (d / 2 - 0.1), 0.14, sz < 0 ? 2.7 : 3.0, 0.14);
    const k = 5, tilt = Math.atan2(0.5, d);
    for (let i = 0; i < k; i++) Mx.part(CBOX, i % 2 ? c1 : c0, -w / 2 - 0.1 + (i + 0.5) * (w + 0.2) / k, 2.55, -0.1, (w + 0.2) / k + 0.01, 0.08, d + 0.7, 0, -tilt);
    Mx.part(BOX, GOLD, -0.6, 1.0, -d / 2 + 0.35, 0.5, 0.35, 0.4);   // goods on the counter
    Mx.part(BOX, c1 === CANVAS ? c0 : c1, 0.5, 1.0, -d / 2 + 0.35, 0.6, 0.3, 0.4);
  }
  function bales(o) {                                        // rows of bales laid across, each row one fewer, staggered
    Mx.frame(o.x, o.y, o.z, o.ux, o.uz);
    const { l, w, h } = FAIR_BALE;
    for (let r = 0; r < o.rows; r++) {
      const n = o.rows + 1 - r;
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * w;
        Mx.part(BOX, (i + r) % 3 ? HAY : HAY2, x, r * h - (r ? 0.02 : 0.3), 0, w - 0.06, h + (r ? 0 : 0.3), l);
        Mx.part(BOX, HAY2, x, r * h + h * 0.3, -l / 2 - 0.01, w - 0.04, 0.05, 0.02);   // twine
      }
    }
  }
  // envelope: a lathe profile (radius, height as shares of the size), in gores; bands of colour up it
  const PROFILE = [[0.2, 0], [0.34, 0.12], [0.62, 0.3], [0.92, 0.5], [1.0, 0.62], [0.95, 0.76], [0.78, 0.89], [0.45, 0.975], [0, 1]];
  const gores = new Map();
  function gore(n, band) {                                     // one gore of the envelope between profile points band[0]..band[1]
    const key = n + ':' + band;
    if (gores.has(key)) return gores.get(key);
    const pts = PROFILE.slice(band[0], band[1] + 1).map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-3), y));
    const g = new THREE.LatheGeometry(pts, 1, 0, TAU / n);
    gores.set(key, Mx.flat(g));
    return gores.get(key);
  }
  const BANDS = [[0, 2], [2, 6], [6, 8]];                      // throat, middle, crown
  function balloon(o) {
    const n = 12, [c0, c1, c2] = ENVELOPE[o.style % ENVELOPE.length], s = o.s, R = BALLOON.r * s, H = BALLOON.h * s;
    const y0 = (BALLOON.basket + BALLOON.throat) * s;
    Mx.frame(o.x, o.base, o.z, 1, 0);
    for (let k = 0; k < n; k++) {
      // LatheGeometry sweeps from +z toward +x; turn each gore k slices round
      Mx.part(gore(n, BANDS[0]), c2, 0, y0, 0, R, H, R, k * TAU / n);
      Mx.part(gore(n, BANDS[1]), k % 2 ? c1 : c0, 0, y0, 0, R, H, R, k * TAU / n);
      Mx.part(gore(n, BANDS[2]), k % 3 === 0 ? c2 : c0, 0, y0, 0, R, H, R, k * TAU / n);
    }
    const b = 0.9 * s;
    Mx.part(BOX, WICKER, 0, 0, 0, b * 2, BALLOON.basket * s, b * 2);
    Mx.part(BOX, DARK, 0, BALLOON.basket * s - 0.1 * s, 0, b * 2 + 0.1, 0.18 * s, b * 2 + 0.1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {        // cables up to the throat
      const x0 = sx * b * 0.9, z0 = sz * b * 0.9, x1 = sx * R * 0.14, z1 = sz * R * 0.14, len = Math.hypot(x1 - x0, y0 - BALLOON.basket * s, z1 - z0);
      Mx.frame(o.x + (x0 + x1) / 2, o.base, o.z + (z0 + z1) / 2, 1, 0);
      Mx.part(CYL, DARK, 0, BALLOON.basket * s, 0, 0.06 * s, len, 0.06 * s);
      Mx.frame(o.x, o.base, o.z, 1, 0);
    }
    Mx.part(CYL, DARK, 0, BALLOON.basket * s + 0.9 * s, 0, 0.5 * s, 0.6 * s, 0.5 * s);   // burner
    if (o.ground) {                                          // tethered: lines from the throat out to stakes, a crew's trailer
      for (let k = 0; k < 4; k++) {
        const a = k * TAU / 4 + 0.6, fx = Math.cos(a), fz = Math.sin(a), out = R * 1.3, up = y0 + H * 0.28;
        Mx.frame(o.x + fx * out / 2, o.base, o.z + fz * out / 2, fx, fz);
        Mx.part(CBOX, ROPE, 0, up / 2, 0, 0.08, 0.08, Math.hypot(out, up), 0, -Math.atan2(up, out));
        Mx.frame(o.x + fx * out, o.base, o.z + fz * out, fx, fz);
        Mx.part(BOX, WOOD, 0, -0.3, 0, 0.25, 0.8, 0.25);
      }
      Mx.frame(o.x + R * 1.6, o.base, o.z - R * 0.4, 0, 1);
      Mx.part(BOX, C('#c9c3b5'), 0, 0, 0, 2.2, 1.9, 4.6);
      Mx.part(BOX, DARK, 0, 0, 2.6, 0.2, 0.5, 1.2);
    }
  }
  function ribbonPoles(r) {                                  // tall striped posts with a gold ball
    for (const p of r.poles) {
      Mx.frame(p.x, p.foot, p.z, 1, 0);
      const H = p.top - p.foot, band = 1.8;
      for (let y = 0, k = 0; y < H; y += band, k++) Mx.part(CYL, k % 2 ? CANVAS : STRIPES[1][0], 0, y, 0, RIBBON.poleR, Math.min(band, H - y), RIBBON.poleR);
      Mx.part(ICO, GOLD, 0, H + 0.45, 0, 0.6, 0.6, 0.6);
    }
  }
  return {
    build(group) {
      const chunks = new Map(), put = (fn, o) => {
        const k = Math.floor(o.x / FAIR_CHUNK) + ',' + Math.floor(o.z / FAIR_CHUNK);
        if (!chunks.has(k)) chunks.set(k, []);
        chunks.get(k).push([fn, o]);
      };
      for (const o of FAIR.tents) put(o.type === 'top' ? bigTop : marquee, o);
      for (const o of FAIR.stalls) put(stall, o);
      for (const o of FAIR.stacks) put(bales, o);
      for (const o of FAIR.balloons) put(balloon, o);
      for (const r of FAIR.ribbons) put(ribbonPoles, { x: r.h.pos.x, z: r.h.pos.z, poles: r.poles });
      for (const list of chunks.values()) {
        Mx.reset();
        for (const [fn, o] of list) fn(o);
        const m = Mx.mesh(mat);
        if (m) group.add(m);
      }
    },
  };
}
{ // before js/farm.js's plugin, so its fields see the fairground
  const at = SHORE_PLUGINS.findIndex((p) => p.build === buildFarm);
  SHORE_PLUGINS.splice(at < 0 ? SHORE_PLUGINS.length : at, 0, { build: buildFair, createKit: createFairKit });
}

// the ribbon: lit like a hoop when it's next; flown through, it parts in the middle and each half drops to hang from
// its pole, swinging
function createRibbonKit(ctx) {
  const M = ctx.hoopMat;
  const RED = new THREE.MeshLambertMaterial({ color: '#e0262e', emissive: '#8a1016', side: THREE.DoubleSide });   // lit either side
  RED.userData.shared = true;
  let items = [];
  function mend(it) {
    it.cut = false; it.t = 0;
    for (const hf of it.halves) { hf.ang = 0; hf.vel = 0; hf.pivot.quaternion.copy(it.q); hf.bow.visible = true; }
  }
  return {
    build(group) {
      items = [];
      HOOPS.forEach((h, i) => {
        if (h.kind !== 'ribbon') return;
        const f = gateFrame(h), W = ribbonW(h), halves = [];
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(-f.fx, 0, -f.fz), WORLD_UP));
        for (const s of [-1, 1]) {
          // a pivot at the pole, the half ribbon reaching in to the middle (with a bow at its end), sagging a little
          const pivot = new THREE.Group();
          pivot.position.set(h.pos.x + f.rx * s * W / 2, h.pos.y, h.pos.z + f.rz * s * W / 2);
          pivot.quaternion.copy(q);
          // (the pivot's local +x is the gate's left: lookAt points +z along the line)
          const len = W / 2, strip = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.7, 8, 1).translate(s * len / 2, 0, 0), RED);
          const p = strip.geometry.attributes.position;
          for (let k = 0; k < p.count; k++) { const x = Math.abs(p.getX(k)) / len; p.setY(k, p.getY(k) - Math.sin(x * Math.PI / 2) * 0.35); }
          strip.geometry.computeVertexNormals();
          const bow = new THREE.Mesh(new THREE.TetrahedronGeometry(0.7), M.later);
          bow.position.set(s * (len - 0.4), -0.35, 0); bow.scale.set(1, 1, 0.3);
          pivot.add(strip, bow); group.add(pivot);
          halves.push({ pivot, s, bow, strip, ang: 0, vel: 0 });
        }
        items.push({ i, h, q, halves, cut: false, t: 0 });
      });
    },
    update(s) {
      for (const it of items) {
        const r = it.i - s.next;
        if (r > 0 && it.cut) mend(it);                    // sent back before it (a restart)
        for (const hf of it.halves) hf.bow.material = r === 0 ? M.next : r === 1 ? M.soon : M.later;
        if (!it.cut) {
          if (r === 0) { const w = 1 + Math.sin(s.t * 6) * 0.08; for (const hf of it.halves) hf.bow.scale.set(w, w, 0.3 * w); }
          continue;
        }
        // cut: each half falls about its pole (a pendulum with a little damping), fluttering as it goes
        it.t += s.dt;
        for (const hf of it.halves) {
          const target = -hf.s * Math.PI / 2;                   // hanging straight down
          hf.vel += (-(hf.ang - target) * 9 - hf.vel * 1.1) * s.dt;
          hf.ang += hf.vel * s.dt;
          hf.pivot.quaternion.copy(it.q);
          hf.pivot.rotateZ(hf.ang);
          hf.pivot.rotateX(Math.sin(it.t * 11 + hf.s) * 0.35 * Math.exp(-it.t * 0.4));
          hf.bow.visible = it.t < 0.15;
        }
      }
    },
    pass(i) {
      const it = items.find((x) => x.i === i);
      if (!it) return;
      it.cut = true; it.t = 0;
      for (const hf of it.halves) hf.vel = -hf.s * 5;           // snapped apart: the chase camera, a moment behind, sees it part
    },
    reset() { for (const it of items) mend(it); },
  };
}
GATE_KITS.push(createRibbonKit);
