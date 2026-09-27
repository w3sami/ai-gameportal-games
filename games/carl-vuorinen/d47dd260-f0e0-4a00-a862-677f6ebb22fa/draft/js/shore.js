'use strict';
/* Shore: piers, moored and anchored boats, beach umbrellas and huts (course format in js/sim.js).
   Course file: shore: {
     piers:     [{ x, z, len, w, head, kiosk, lamps, dir }]
                x, z   a point near where the pier meets the beach; it starts where the sand is at deck height and runs
                       out to sea along dir ([dx, dz], default coast.toSea), ending len m past the waterline
                w      deck width (m); head: width of a T-head at the end (0 = none); kiosk: a hut on the head;
                lamps: spacing of lamp posts (m, 0 = none)
     boats:     { moored, anchored, sailing, depth: [min, max], clear }
                moored: boats per pier, alongside where it's over the water; anchored: attempts to scatter boats (in clusters) where
                the water is depth m deep; sailing: the share of anchored ones under sail; none within clear m of the line
     umbrellas: { count, band: [from, to], clear }   on the sand; band = heights above the water (m)
     huts:      { count, band: [from, to], clear }   beach huts at the back of the sand
   }
   Everything is a crash. Sim part (no DOM): buildShore() (buildWorld, after the terrain), shoreHit(p) -> 'pier' |
   'boat' | 'beach' | null, shoreNear(x, z, pad). createShoreKit(): the meshes. */
const SHORE = { piers: [], boats: [], umbrellas: [], huts: [], boxes: [], grid: new Map() };
const SHORE_CELL = 40, SHORE_MARGIN = 14;                  // boxes are filed in every cell within their reach + margin
const PIER_DEF = { len: 140, w: 4, head: 0, kiosk: false, lamps: 24 };
const DECK_UP = 2.4;                                        // pier deck top above the water (m)

function shoreBox(kind, x, z, ux, uz, hu, hv, y0, y1) {    // oriented box: u along (ux, uz), v across
  const b = { kind, x, z, ux, uz, hu, hv, y0, y1 }, R = Math.hypot(hu, hv) + SHORE_MARGIN;
  for (let iz = Math.floor((z - R) / SHORE_CELL); iz <= Math.floor((z + R) / SHORE_CELL); iz++)
    for (let ix = Math.floor((x - R) / SHORE_CELL); ix <= Math.floor((x + R) / SHORE_CELL); ix++) {
      const key = treeKey(ix, iz);
      if (!SHORE.grid.has(key)) SHORE.grid.set(key, []);
      SHORE.grid.get(key).push(b);
    }
  SHORE.boxes.push(b);
  return b;
}
function shoreInBox(b, x, z, pad) {
  const dx = x - b.x, dz = z - b.z, u = dx * b.ux + dz * b.uz, v = dz * b.ux - dx * b.uz;
  return Math.abs(u) < b.hu + pad && Math.abs(v) < b.hv + pad;
}
function shoreHit(p) {
  const list = SHORE.grid.get(treeKey(Math.floor(p.x / SHORE_CELL), Math.floor(p.z / SHORE_CELL)));
  if (!list) return null;
  const pad = 0.9;                                          // the aircraft's reach around its centre (m)
  for (const b of list) if (p.y > b.y0 - pad && p.y < b.y1 + pad && shoreInBox(b, p.x, p.z, pad)) return b.kind;
  return null;
}
function shoreNear(x, z, pad) {                             // anything within pad m (pad up to SHORE_MARGIN), any height
  const list = SHORE.grid.get(treeKey(Math.floor(x / SHORE_CELL), Math.floor(z / SHORE_CELL)));
  if (list) for (const b of list) if (shoreInBox(b, x, z, pad)) return true;
  return false;
}

function buildShore() {
  for (const k of ['piers', 'boats', 'umbrellas', 'huts', 'boxes']) SHORE[k].length = 0;
  SHORE.grid.clear();
  const S = COURSE.shore;
  if (!S) return;
  const W = TER.WATER, deck = W + DECK_UP, rand = mulberry32(COURSE.seeds.trees * 7 + 3);
  const sea = (COURSE.coast && COURSE.coast.toSea) || [-1, 0];
  const lineDist = (x, z) => courseDistAt(x, z).d;

  // piers: from where the sand is at deck height, out to sea
  (S.piers || []).forEach((spec) => {
    const o = Object.assign({}, PIER_DEF, spec), dv = o.dir || sea, L = Math.hypot(dv[0], dv[1]) || 1;
    const ux = dv[0] / L, uz = dv[1] / L, vx = -uz, vz = ux;
    const at = (s) => heightAt(o.x + ux * s, o.z + uz * s), top = deck - 0.5;
    let s0 = 0;
    if (at(0) >= top) { while (s0 < 400 && at(s0) >= top) s0 += 1; }
    else { while (s0 > -400 && at(s0 - 1) < top) s0 -= 1; }
    s0 -= 3;                                                // a few metres onto the sand
    let sw = s0;
    while (sw < s0 + 600 && at(sw) >= W) sw += 1;           // the waterline
    const p = { x: o.x + ux * s0, z: o.z + uz * s0, ux, uz, vx, vz, len: sw - s0 + o.len, dry: sw - s0, w: o.w, head: o.head, kiosk: o.kiosk, lamps: o.lamps, deck };
    p.ex = p.x + ux * p.len; p.ez = p.z + uz * p.len;       // the seaward end of the walkway
    const mid = p.len / 2;
    shoreBox('pier', p.x + ux * mid, p.z + uz * mid, ux, uz, mid, p.w / 2, W - 20, deck + 1.15);
    if (p.head > p.w) shoreBox('pier', p.ex + ux * 5, p.ez + uz * 5, ux, uz, 5, p.head / 2, W - 20, deck + 1.15);
    if (p.kiosk && p.head > p.w) shoreBox('pier', p.ex + ux * 5, p.ez + uz * 5, ux, uz, 2.6, 2.2, deck, deck + 4.4);
    p.lampAt = [];
    if (p.lamps > 0) for (let s = p.lamps * 0.5, side = 1; s < p.len - 2; s += p.lamps, side = -side) {
      const lx = p.x + ux * s + vx * side * (p.w / 2 - 0.2), lz = p.z + uz * s + vz * side * (p.w / 2 - 0.2);
      p.lampAt.push([lx, lz, side]);
      shoreBox('pier', lx, lz, ux, uz, 0.25, 0.25, deck, deck + 4.6);
    }
    SHORE.piers.push(p);
  });

  const B = Object.assign({ moored: 4, anchored: 60, sailing: 0.3, depth: [1.4, 20], clear: 35 }, S.boats);
  const clearOf = (x, z, r) => {                            // other boats (hull reach r) and pier boxes
    for (const b of SHORE.boats) { const dx = x - b.x, dz = z - b.z, m = r + b.L / 2 + 5; if (dx * dx + dz * dz < m * m) return false; }
    return !shoreNear(x, z, Math.min(r + 6, SHORE_MARGIN));
  };
  const addBoat = (x, z, hx, hz, type, sails) => {
    const L = type === 'dinghy' ? 3.4 + rand() * 1.2 : type === 'motor' ? 6 + rand() * 5 : 7.5 + rand() * 5.5;
    const b = { x, z, hx, hz, L, type, sails, B: L * (type === 'dinghy' ? 0.42 : 0.34), seed: Math.floor(rand() * 1e6) };
    b.fb = type === 'dinghy' ? 0.45 : 0.75 + L * 0.04;      // freeboard: hull top above the water
    b.cabin = type === 'motor' ? 1.3 : type === 'sail' ? 0.6 : 0;
    b.mast = type === 'sail' ? L * 1.35 : 0;
    shoreBox('boat', x, z, hx, hz, L / 2, b.B / 2, W - 1, W + b.fb + b.cabin);
    if (b.mast) {
      const mx = x + hx * L * 0.12, mz = z + hz * L * 0.12, top = W + b.fb + b.mast;
      shoreBox('boat', mx, mz, hx, hz, 0.25, 0.25, W, top);
      if (sails) {                                          // main behind the mast, jib ahead: two boxes each (triangles)
        const boom = L * 0.5, y0 = W + b.fb + 1;
        shoreBox('boat', mx - hx * boom / 2, mz - hz * boom / 2, hx, hz, boom / 2, 0.3, y0, lerp(y0, top, 0.5));
        shoreBox('boat', mx - hx * boom / 4, mz - hz * boom / 4, hx, hz, boom / 4, 0.3, y0, lerp(y0, top, 0.85));
        const jib = L * 0.38;
        shoreBox('boat', mx + hx * jib / 2, mz + hz * jib / 2, hx, hz, jib / 2, 0.3, y0, lerp(y0, top, 0.45));
      }
    }
    SHORE.boats.push(b);
  };

  // moored alongside each pier where it's over the water, both sides, bow out or in
  for (const p of SHORE.piers) {
    let placed = 0;
    for (let tries = 0; tries < B.moored * 4 && placed < B.moored; tries++) {
      const side = rand() < 0.5 ? -1 : 1, s = lerp(p.dry, p.len, 0.3 + rand() * 0.68), type = rand() < 0.5 ? 'motor' : rand() < 0.75 ? 'sail' : 'dinghy';
      const beam = type === 'dinghy' ? 2 : type === 'motor' ? 3.4 : 3.8, off = p.w / 2 + beam / 2 + 0.7;
      const x = p.x + p.ux * s + p.vx * side * off, z = p.z + p.uz * s + p.vz * side * off;
      if (heightAt(x, z) > W - 0.8 || lineDist(x, z) < B.clear * 0.6) continue;
      let ok = true;
      for (const b of SHORE.boats) { const dx = x - b.x, dz = z - b.z; if (dx * dx + dz * dz < 13 * 13) { ok = false; break; } }
      if (!ok) continue;
      const dir = rand() < 0.5 ? 1 : -1;
      addBoat(x, z, p.ux * dir, p.uz * dir, type, false);
      placed++;
    }
  }

  // anchored in clusters (mooring fields), all swung to the sea breeze; some sailing across it
  const field = (x, z) => noiseC(x * 0.0035 + 9.1, z * 0.0035 - 3.7);
  const X0 = TER.X0 + 150, SPAN = TER.SIZE - 300;
  for (let n = 0; n < B.anchored; n++) {
    const x = X0 + rand() * SPAN, z = TER.Z0 + 150 + rand() * SPAN, depth = W - heightAt(x, z);
    if (depth < B.depth[0] || depth > B.depth[1]) continue;
    const sailing = rand() < B.sailing;
    if (!sailing && field(x, z) < 0.5 && rand() < 0.85) continue;
    if (lineDist(x, z) < B.clear) continue;
    const type = sailing ? 'sail' : rand() < 0.45 ? 'sail' : rand() < 0.8 ? 'motor' : 'dinghy';
    if (!clearOf(x, z, 8)) continue;
    let a = Math.atan2(sea[1], sea[0]) + (rand() - 0.5) * 0.6;          // bow into the wind off the sea
    if (sailing) a += (rand() < 0.5 ? 1 : -1) * (1.1 + rand() * 0.9);    // reaching across it
    addBoat(x, z, Math.cos(a), Math.sin(a), type, sailing);
  }

  // beach: umbrellas (with a towel) and huts on the sand, off the line and the piers
  const flat = (x, z) => { const e = 3; return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e) < 0.12; };
  const scatter = (spec, place) => {
    if (!spec) return;
    const band = spec.band, want = spec.count || 0, clr = spec.clear || 25;
    let placed = 0;
    for (let n = 0; n < want * 60 && placed < want; n++) {
      const x = X0 + rand() * SPAN, z = TER.Z0 + 150 + rand() * SPAN, y = heightAt(x, z);
      if (y < W + band[0] || y > W + band[1] || !flat(x, z) || lineDist(x, z) < clr || shoreNear(x, z, 4)) continue;
      if (field(x + 500, z) < 0.4 && rand() < 0.8) continue;           // busier stretches and quieter ones
      place(x, y, z); placed++;
    }
  };
  scatter(S.umbrellas, (x, y, z) => {
    const u = { x, y, z, r: 1.1 + rand() * 0.4, h: 2.2 + rand() * 0.4, c: Math.floor(rand() * 6), a: rand() * TAU, towel: rand() < 0.8, t: Math.floor(rand() * 5) };
    SHORE.umbrellas.push(u);
    shoreBox('beach', x, z, 1, 0, u.r, u.r, y - 1, y + u.h + 0.4);
  });
  scatter(S.huts, (x, y, z) => {
    const a = Math.atan2(sea[1], sea[0]) + (rand() - 0.5) * 0.3;   // door facing the sea
    const h = { x, y, z, ux: Math.cos(a), uz: Math.sin(a), w: 2.2 + rand() * 0.6, d: 2.2 + rand() * 0.4, c: Math.floor(rand() * 5) };
    SHORE.huts.push(h);
    shoreBox('beach', x, z, h.ux, h.uz, h.d / 2, h.w / 2, y - 1, y + 3.6);
  });
}

/* ---------- look ---------- */
function createShoreKit() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.shared = true;
  const flatPos = (g) => (g.index ? g.toNonIndexed() : g).attributes.position;
  const BOX = flatPos(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));          // base at y = 0
  const CYL = flatPos(new THREE.CylinderGeometry(1, 1, 1, 6, 1).translate(0, 0.5, 0));
  const CONE = flatPos(new THREE.ConeGeometry(1, 1, 8, 1).translate(0, 0.5, 0));
  const PYR = flatPos(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0));
  // hull plan: 1 wide, 1 long, bow at -z, straight sides to a rounded point; extruded 1 up
  const hs = new THREE.Shape();
  hs.moveTo(-0.5, -0.5); hs.lineTo(0.5, -0.5); hs.lineTo(0.5, 0.1);
  hs.quadraticCurveTo(0.45, 0.38, 0, 0.5); hs.quadraticCurveTo(-0.45, 0.38, -0.5, 0.1); hs.lineTo(-0.5, -0.5);
  const HULL = flatPos(new THREE.ExtrudeGeometry(hs, { depth: 1, bevelEnabled: false, curveSegments: 4 }).rotateX(-Math.PI / 2));

  const C = (h) => new THREE.Color(h);
  const WOOD = C('#a07c55'), PILE = C('#5a4735'), RAIL = C('#e9e4d8'), METAL = C('#4d5358'), LAMP = C('#fff4c8');
  const WHITE = C('#f4f4f0'), GLASS = C('#2b3a46'), SAIL = C('#fbfaf5'), COVER = C('#2f5f8f'), TEAK = C('#b98d5f');
  const HULLS = ['#f4f4f0', '#f4f4f0', '#f4f4f0', '#1f3354', '#b8342e', '#e8e0c8'].map(C);
  const STRIPE = ['#1f5f9f', '#c23b32', '#2f8f7a', '#e8b030', '#233554'].map(C);
  const BRIGHT = ['#e8413c', '#f2b92e', '#2f7fd0', '#f4f4f0', '#f08a2c', '#2fa8a0'].map(C);
  const TOWEL = ['#e84f7a', '#3b8fd9', '#f2c94c', '#6cc24a', '#ffffff'].map(C);
  const HUT = ['#e9f0f4', '#f6d3cf', '#cfe3f6', '#fbe7b0', '#d8efd7'].map(C);
  const ROOF = C('#9e3b30');

  let pos = [], col = [];
  const F = new THREE.Matrix4(), Lm = new THREE.Matrix4(), M = new THREE.Matrix4();
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pp = new THREE.Vector3();
  const ax = new THREE.Vector3(), ay = new THREE.Vector3(0, 1, 0), az = new THREE.Vector3();
  let jseed = 1;
  const jit = () => { jseed = (jseed * 16807) % 2147483647; return 0.93 + (jseed / 2147483647) * 0.12; };
  // local frame: x right, y up, z back (forward = -z along (fx, fz))
  function frame(x, y, z, fx, fz) { F.makeBasis(ax.set(-fz, 0, fx), ay, az.set(-fx, 0, -fz)).setPosition(x, y, z); }
  function part(geo, c, px, py, pz, sx, sy, sz, ry = 0, rx = 0) {
    q.setFromEuler(e.set(rx, ry, 0));
    Lm.compose(pp.set(px, py, pz), q, sc.set(sx, sy, sz));
    M.multiplyMatrices(F, Lm);
    const j = jit();
    for (let i = 0; i < geo.count; i++) {
      v.fromBufferAttribute(geo, i).applyMatrix4(M);
      pos.push(v.x, v.y, v.z); col.push(c.r * j, c.g * j, c.b * j);
    }
  }
  function tri2(c, a, b, d) {                               // a double-sided triangle in the local frame
    const j = jit();
    for (const [p1, p2, p3] of [[a, b, d], [a, d, b]]) for (const pt of [p1, p2, p3]) {
      v.set(pt[0], pt[1], pt[2]).applyMatrix4(F);
      pos.push(v.x, v.y, v.z); col.push(c.r * j, c.g * j, c.b * j);
    }
  }

  function pier(p) {
    const W = TER.WATER, d = p.deck, L = p.len, w = p.w;
    frame(p.x, 0, p.z, p.ux, p.uz);
    part(BOX, WOOD, 0, d - 0.45, -L / 2, w, 0.45, L);                         // deck
    for (const s of [-1, 1]) {
      part(BOX, RAIL, s * (w / 2 - 0.06), d + 1.0, -L / 2, 0.12, 0.1, L);     // top rail
      for (let t = 0; t <= L; t += 2.5) part(BOX, RAIL, s * (w / 2 - 0.06), d, -t, 0.1, 1.05, 0.1);
      for (let t = 1; t <= L; t += 5) {                                       // pilings down to the bed
        const gx = p.x + p.ux * t + p.vx * s * (w / 2 - 0.3), gz = p.z + p.uz * t + p.vz * s * (w / 2 - 0.3), g = heightAt(gx, gz) - 0.5;
        if (g < d - 0.5) part(CYL, PILE, s * (w / 2 - 0.3), g, -t, 0.24, d - 0.45 - g, 0.24);
      }
    }
    if (p.head > w) {
      part(BOX, WOOD, 0, d - 0.45, -L - 5, p.head, 0.45, 10);
      for (const s of [-1, 1]) {
        part(BOX, RAIL, s * (p.head / 2 - 0.06), d + 1.0, -L - 5, 0.12, 0.1, 10);
        part(BOX, RAIL, s * (p.head + w) / 4, d + 1.0, -L + 0.06, (p.head - w) / 2, 0.1, 0.12);
      }
      part(BOX, RAIL, 0, d + 1.0, -L - 9.94, p.head, 0.1, 0.12);
      for (let t = -p.head / 2 + 1; t < p.head / 2; t += 3) for (const zz of [-L - 1, -L - 5, -L - 9]) {
        const lx = t, gx = p.x + p.ux * -zz + p.vx * lx, gz = p.z + p.uz * -zz + p.vz * lx, g = heightAt(gx, gz) - 0.5;
        if (g < d - 0.5) part(CYL, PILE, lx, g, zz, 0.26, d - 0.45 - g, 0.26);
      }
    }
    if (p.kiosk && p.head > w) {
      part(BOX, WHITE, 0, d, -L - 5, 4.6, 2.9, 3.8);
      part(BOX, GLASS, 0, d + 1.1, -L - 5, 4.7, 1.0, 3.9);
      part(PYR, ROOF, 0, d + 2.9, -L - 5, 5.6, 1.5, 4.6);
    }
    for (const [lx, lz] of p.lampAt) {
      frame(lx, 0, lz, p.ux, p.uz);
      part(CYL, METAL, 0, d, 0, 0.08, 4.2, 0.08);
      part(BOX, LAMP, 0, d + 4.1, 0, 0.35, 0.45, 0.35);
    }
  }

  function boat(b) {
    const W = TER.WATER, L = b.L, Bw = b.B, top = W + b.fb, r = mulberry32(b.seed);
    frame(b.x, 0, b.z, b.hx, b.hz);
    const hullC = b.type === 'dinghy' ? BRIGHT[Math.floor(r() * 6)] : HULLS[Math.floor(r() * HULLS.length)];
    const stripe = STRIPE[Math.floor(r() * STRIPE.length)];
    part(HULL, hullC, 0, W - 0.35, 0, Bw, b.fb + 0.35 - 0.22, L);
    part(HULL, b.type === 'dinghy' ? hullC : stripe, 0, top - 0.22, 0, Bw * 1.01, 0.22, L * 1.005);
    if (b.type === 'motor') {
      const cl = L * 0.36, cz = -L * 0.02;
      part(BOX, WHITE, 0, top, cz, Bw * 0.72, b.cabin, cl);
      part(BOX, GLASS, 0, top + b.cabin * 0.45, cz, Bw * 0.74, b.cabin * 0.38, cl * 1.02);
      part(BOX, TEAK, 0, top, L * 0.3, Bw * 0.8, 0.08, L * 0.3);                   // aft deck
    } else if (b.type === 'sail') {
      const mz = -L * 0.12, mt = top + b.mast;
      part(BOX, WHITE, 0, top, L * 0.02, Bw * 0.6, b.cabin, L * 0.4);
      part(CYL, METAL, 0, top, mz, 0.11, b.mast, 0.11);
      const boom = L * 0.5, by = top + 1;
      if (b.sails) {
        tri2(SAIL, [0, by, mz + 0.15], [0, mt - 0.3, mz + 0.15], [0, by, mz + boom]);
        tri2(SAIL, [0, top + 0.3, -L * 0.48], [0, lerp(by, mt, 0.8), mz - 0.15], [0, top + 0.3, mz - 0.4]);
        part(BOX, METAL, 0, by - 0.05, mz + boom / 2, 0.1, 0.1, boom);
      } else {
        part(BOX, COVER, 0, by - 0.1, mz + boom * 0.45, 0.4, 0.4, boom * 0.9);       // sail cover on the boom
      }
    } else {
      part(BOX, TEAK, 0, top - 0.25, 0, Bw * 0.9, 0.06, 0.3);                      // a thwart
    }
  }

  function umbrella(u) {
    frame(u.x, 0, u.z, Math.cos(u.a), Math.sin(u.a));
    part(CYL, WHITE, 0, u.y - 0.3, 0, 0.04, u.h + 0.3, 0.04);
    part(CONE, BRIGHT[u.c], 0, u.y + u.h - 0.35, 0, u.r, 0.55, u.r);
    if (u.towel) part(BOX, TOWEL[u.t], 1.3, u.y - 0.02, 0.4, 0.9, 0.06, 1.8);
  }
  function hut(h) {
    frame(h.x, 0, h.z, h.ux, h.uz);
    part(BOX, HUT[h.c], 0, h.y - 0.6, 0, h.w, 3.0, h.d);
    part(BOX, GLASS, 0, h.y, -h.d / 2 - 0.01, 0.9, 1.9, 0.05);                      // door, seaward
    part(PYR, ROOF, 0, h.y + 2.4, 0, h.w * 1.25, 1.2, h.d * 1.25);
  }

  function build(group) {
    if (!SHORE.piers.length && !SHORE.boats.length && !SHORE.umbrellas.length && !SHORE.huts.length) return;
    pos = []; col = []; jseed = 12345;
    SHORE.piers.forEach(pier); SHORE.boats.forEach(boat); SHORE.umbrellas.forEach(umbrella); SHORE.huts.forEach(hut);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();                                                       // non-indexed: flat faces
    group.add(new THREE.Mesh(g, mat));
    pos = []; col = [];
  }
  return { build };
}
