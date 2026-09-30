'use strict';
/* Port: a container harbour, as a js/shore.js plugin (its boxes share the shore's crash test and tree exclusion).
   Course file: port: {
     deck: 3.5                                quay deck height above the water (m)
     quays:  [{ x0, x1, z0, z1 }]             deck rectangles, solid down to the bed
     cranes: [{ x, z, sea: [dx, dz], boom, gauge, color }]   ship-to-shore gantry crane at the quay edge point (x, z), sea
                                              pointing out over the water: legs gauge m apart across the quay (default 34),
                                              the portal beams PORTAL_UP m above the deck, so the line can run between the
                                              legs along the quay, gauge / 2 + 3 m in from the edge; the boom reaches
                                              boom m out over the water (default 62), about 45 m up
     yards:  [{ x0, x1, z0, z1, tiers: [min, max] }]   container stacks in blocks of 8 x 7, long side along x
     ships:  [{ type, x, z, dir: [dx, dz], len, beam }]   centre and bow direction; type 'container' (stacks on deck),
                                              'tanker' or 'bulk'
     tugs:   [{ x, z, dir }]
     masts:  [[x, z], ...]                    floodlight masts (36 m)
     sheds:  [{ x, z, w, l, h, dir }]         warehouses: l along dir
     breakwaters: [{ from: [x, z], to: [x, z], light }]   rubble mound; light: a lighthouse at the `to` end
   }
   Everything is a crash: 'dock', 'crane', 'cargo', 'ship', 'shed', 'rock'. */
const PORT = { quays: [], cranes: [], stacks: [], ships: [], tugs: [], masts: [], sheds: [], breakwaters: [] };
const PORTAL_UP = 26;                                       // underside of a crane's portal beams above the deck (m)
let PORT_DECK = 0;

// a local frame on the ground: x right, z back (forward = -z along (fx, fz)), the same as createMesher().frame
function portFrame(x, z, fx, fz) {
  const L = Math.hypot(fx, fz) || 1;
  fx /= L; fz /= L;
  return {
    x, z, fx, fz,
    at(lx, lz) { return [x - fz * lx - fx * lz, z + fx * lx - fz * lz]; },
    box(kind, lx, lz, sx, sz, y0, y1) { const p = this.at(lx, lz); shoreBox(kind, p[0], p[1], fx, fz, sz / 2, sx / 2, y0, y1); },
  };
}
function deckAt(x, z) {                                     // quay deck, or the ground
  for (const q of PORT.quays) if (x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) return PORT_DECK;
  return groundAt(x, z);
}

function buildPort() {
  for (const k in PORT) PORT[k].length = 0;
  const S = COURSE.port;
  if (!S) return;
  const W = TER.WATER, D = PORT_DECK = W + (S.deck || 3.5), rand = mulberry32(COURSE.seeds.trees * 13 + 5);

  for (const q of S.quays || []) {
    const Q = { x0: Math.min(q.x0, q.x1), x1: Math.max(q.x0, q.x1), z0: Math.min(q.z0, q.z1), z1: Math.max(q.z0, q.z1) };
    PORT.quays.push(Q);
    shoreBox('dock', (Q.x0 + Q.x1) / 2, (Q.z0 + Q.z1) / 2, 1, 0, (Q.x1 - Q.x0) / 2, (Q.z1 - Q.z0) / 2, W - 30, D);
  }

  // gantry cranes: legs on two rails, portal beams across and along, girders from the boom tip to the backreach,
  // machinery house, A-frame and stays
  for (const c of S.cranes || []) {
    const sea = c.sea || [-1, 0], f = portFrame(c.x, c.z, sea[0], sea[1]);
    const g = c.gauge || 34, boom = c.boom || 62, back = g + 17, r1 = 3, r2 = 3 + g, mid = 3 + g / 2;
    PORT.cranes.push({ f, g, boom, back, color: c.color });
    for (const lx of [-9, 9]) for (const lz of [r1, r2]) f.box('crane', lx, lz, 1.8, 1.8, D, D + 44);
    for (const lx of [-9, 9]) f.box('crane', lx, mid, 1.6, g + 1.8, D + PORTAL_UP, D + PORTAL_UP + 3);
    for (const lz of [r1, r2]) f.box('crane', 0, lz, 19.8, 1.6, D + PORTAL_UP, D + PORTAL_UP + 3);
    f.box('crane', 0, (back - boom) / 2, 18, back + boom, D + 42, D + 46);
    f.box('crane', 0, mid + 4, 14, 18, D + 46, D + 53);
    for (const lx of [-7, 7]) {
      f.box('crane', lx, 8, 1.4, 1.4, D + 46, D + 68);
      for (const [z1, y1] of [[-boom, D + 46], [back, D + 46]]) {     // stays, as a run of small boxes
        for (let i = 0; i < 6; i++) {
          const za = lerp(8, z1, i / 6), zb = lerp(8, z1, (i + 1) / 6), ya = lerp(D + 68, y1, i / 6), yb = lerp(D + 68, y1, (i + 1) / 6);
          f.box('crane', lx, (za + zb) / 2, 0.8, Math.abs(zb - za) + 0.8, Math.min(ya, yb) - 0.4, Math.max(ya, yb) + 0.4);
        }
      }
    }
    f.box('crane', 0, 8, 15.4, 1.4, D + 66, D + 68);
    f.box('crane', 0, -12, 3.5, 4, D + 37.5, D + 42);
  }

  // container yards: blocks of 8 bays (40 ft, along x) by 7 rows, centred in the rectangle
  for (const y of S.yards || []) {
    const x0 = Math.min(y.x0, y.x1), x1 = Math.max(y.x0, y.x1), z0 = Math.min(y.z0, y.z1), z1 = Math.max(y.z0, y.z1), T = y.tiers || [1, 4];
    const BX = 12.8 * 8, BZ = 2.84 * 7, GX = 14, GZ = 12;
    const nx = Math.max(1, Math.floor((x1 - x0 + GX) / (BX + GX))), nz = Math.max(1, Math.floor((z1 - z0 + GZ) / (BZ + GZ)));
    const ox = x0 + (x1 - x0 - (nx * BX + (nx - 1) * GX)) / 2, oz = z0 + (z1 - z0 - (nz * BZ + (nz - 1) * GZ)) / 2;
    for (let bi = 0; bi < nx; bi++) for (let bj = 0; bj < nz; bj++) for (let bay = 0; bay < 8; bay++) for (let row = 0; row < 7; row++) {
      if (rand() < 0.08) continue;
      const t = T[0] + Math.floor(rand() * (T[1] - T[0] + 1));
      const x = ox + bi * (BX + GX) + bay * 12.8 + 6.4, z = oz + bj * (BZ + GZ) + row * 2.84 + 1.42, base = deckAt(x, z);
      PORT.stacks.push({ x, z, base, t, seed: Math.floor(rand() * 1e6) });
      shoreBox('cargo', x, z, 1, 0, 6.1, 1.22, base, base + t * 2.6);
    }
  }

  // ships: hull, accommodation and bridge aft, funnel; container bays, or a tanker's or bulk carrier's deck
  for (const s of S.ships || []) {
    const dir = s.dir || [1, 0], f = portFrame(s.x, s.z, dir[0], dir[1]);
    const type = s.type || 'container', L = s.len || 220, B = s.beam || 32, T = W + (s.freeboard || (type === 'container' ? 11 : 9));
    const zA = L / 2 - 0.17 * L, zF = L / 2 - 0.08 * L, sh = { f, type, L, B, T, zA, zF, seed: Math.floor(rand() * 1e6), bays: [] };
    f.box('ship', 0, 0, B, L, W - 10, T);
    f.box('ship', 0, zA, B * 0.78, 15, T, T + 22);
    f.box('ship', 0, zA - 2, B + 4, 8, T + 22, T + 25);
    f.box('ship', 0, zF, 6, 8, T, T + 20);
    const r = mulberry32(sh.seed);
    if (type === 'container') {
      for (let z = -L / 2 + 0.14 * L + 6.6; z < zA - 17; z += 13.2) {          // bay centres, from the bow aft
        const fr = (z + L / 2) / L, w = B * (fr < 0.25 ? 0.55 + 0.45 * fr / 0.25 : 1);
        const rows = Math.floor((w - 2) / 2.5), tiers = 2 + Math.floor(r() * 5), stacks = [];
        for (let i = 0; i < rows; i++) stacks.push(r() < 0.06 ? 0 : tiers - (r() < 0.3 ? 1 : 0));
        sh.bays.push({ z, stacks });
        f.box('ship', 0, z, rows * 2.5, 12.4, T, T + tiers * 2.6);
      }
    } else if (type === 'bulk') {
      sh.cranes = [];
      for (let i = 0; i < 4; i++) {                           // deck cranes between the hatches, jibs forward
        const z = lerp(-L * 0.32, zA - 20, i / 3) - 6, x = (i % 2 ? 1 : -1) * (B / 2 - 4);
        sh.cranes.push([x, z]);
        f.box('ship', x, z, 3, 3, T, T + 10);
        f.box('ship', x, z - 10.5, 2, 21, T + 9, T + 24);
      }
      f.box('ship', 0, (zA - L * 0.36) / 2, B * 0.62, zA - 12 + L * 0.36, T, T + 2);
    } else f.box('ship', 0, 0, B * 0.7, L * 0.55, T, T + 3);
    PORT.ships.push(sh);
  }

  for (const t of S.tugs || []) {
    const dir = t.dir || [1, 0], f = portFrame(t.x, t.z, dir[0], dir[1]);
    PORT.tugs.push({ f, seed: Math.floor(rand() * 1e6) });
    f.box('ship', 0, 0, 11, 32, W - 4, W + 3.2);
    f.box('ship', 0, -2, 7, 12, W + 3.2, W + 11);
  }

  for (const [x, z] of S.masts || []) {
    const b = deckAt(x, z);
    PORT.masts.push({ x, z, b });
    shoreBox('crane', x, z, 1, 0, 0.8, 0.8, b, b + 36);
    shoreBox('crane', x, z, 1, 0, 2.6, 1.1, b + 34, b + 37.5);
  }

  for (const s of S.sheds || []) {
    const dir = s.dir || [0, 1], f = portFrame(s.x, s.z, dir[0], dir[1]), w = s.w || 35, l = s.l || 80, h = s.h || 12;
    let lo = Infinity, hi = -Infinity;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) { const p = f.at(a * w / 2, b * l / 2), y = deckAt(p[0], p[1]); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    PORT.sheds.push({ f, w, l, base: lo - 1.5, top: hi + h, roof: w * 0.18, c: Math.floor(rand() * 4) });
    f.box('shed', 0, 0, w, l, lo - 2, hi + h + w * 0.18);
  }

  for (const b of S.breakwaters || []) {
    const [x0, z0] = b.from, [x1, z1] = b.to, len = Math.hypot(x1 - x0, z1 - z0) || 1, ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    const bw = { x1, z1, light: !!b.light, lumps: [] };
    for (let s = 0; s <= len; s += 5) {
      const o = (rand() - 0.5) * 5;
      bw.lumps.push([x0 + ux * s - uz * o, z0 + uz * s + ux * o, 5 + rand() * 4, rand() * TAU, Math.floor(rand() * 3)]);
    }
    PORT.breakwaters.push(bw);
    shoreBox('rock', (x0 + x1) / 2, (z0 + z1) / 2, ux, uz, len / 2 + 5, 10, W - 30, W + 4.5);
    if (bw.light) shoreBox('rock', x1, z1, 1, 0, 5, 5, W, W + 21);
  }
}

/* ---------- look ---------- */
function createPortKit() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.shared = true;
  const Mx = createMesher(), { BOX, CBOX, CYL, CONE, ICO, PRISM } = Mx.G, frame = Mx.frame, part = Mx.part;
  // ship hull plan: long parallel sides, a fine bow at -z and a rounded stern; extruded 1 up
  const hs = new THREE.Shape();
  hs.moveTo(-0.5, -0.44); hs.quadraticCurveTo(-0.5, -0.5, -0.4, -0.5); hs.lineTo(0.4, -0.5); hs.quadraticCurveTo(0.5, -0.5, 0.5, -0.44);
  hs.lineTo(0.5, 0.22); hs.quadraticCurveTo(0.49, 0.44, 0, 0.5); hs.quadraticCurveTo(-0.49, 0.44, -0.5, 0.22); hs.lineTo(-0.5, -0.44);
  const SHIP = Mx.flat(new THREE.ExtrudeGeometry(hs, { depth: 1, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2));

  const C = (h) => new THREE.Color(h);
  const CONCRETE = C('#9c9a93'), ASPHALT = C('#6d6f72'), FENDER = C('#2a2b2d'), WHITE = C('#eeeeea'), GLASS = C('#2b3a46');
  const DARK = C('#34383c'), GREY = C('#8d9196'), LAMP = C('#fff4c8'), BOOT = C('#a1362a'), DECK = C('#6b6f6a');
  const TANKDECK = C('#8b3a2a'), HATCH = C('#51705f'), YELLOW = C('#e0b020'), RED = C('#c9432b');
  const ROCK = ['#8f8a82', '#a39e95', '#7b776f'].map(C), ROOFC = C('#5d6a73');
  const BOXES = ['#3d7fb8', '#b53a2c', '#2e7d4f', '#d9772b', '#8d9297', '#e6e6e0', '#d8b43a', '#7a4b33', '#2c8c8c', '#26406b'].map(C);
  const HULLS = ['#233a5e', '#2a2a2e', '#8e2b22', '#2f5a46', '#3b4a5c'].map(C);
  const FUNNEL = ['#d6452f', '#1f3f73', '#e1b43a', '#2e7d4f', '#eeeeea'].map(C);
  const WALLS = ['#c9ced2', '#b8c4cc', '#d6d0c2', '#a9b6bd'].map(C);
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  // a thin bar between (lz0, y0) and (lz1, y1) at lx, in the current frame
  const rod = (c, lx, z0, y0, z1, y1, t = 0.6) => {
    const dz = z1 - z0, dy = y1 - y0;
    part(CBOX, c, lx, (y0 + y1) / 2, (z0 + z1) / 2, t, t, Math.hypot(dz, dy), 0, Math.atan2(-dy, dz));
  };

  function quays() {
    const W = TER.WATER, D = PORT_DECK;
    const inQuay = (x, z) => PORT.quays.some((q) => x >= q.x0 - 1 && x <= q.x1 + 1 && z >= q.z0 - 1 && z <= q.z1 + 1);
    for (const q of PORT.quays) {
      const wx = q.x1 - q.x0, wz = q.z1 - q.z0;
      frame((q.x0 + q.x1) / 2, 0, (q.z0 + q.z1) / 2, 0, -1);            // local x = world x, local z = world z
      part(BOX, CONCRETE, 0, W - 6, 0, wx, D - 0.3 - (W - 6), wz);
      part(BOX, ASPHALT, 0, D - 0.3, 0, wx, 0.3, wz);
      // fenders on faces that meet open water
      const sides = [[q.x0, q.z0, 1, 0, 0, -1, wx], [q.x0, q.z1, 1, 0, 0, 1, wx], [q.x0, q.z0, 0, 1, -1, 0, wz], [q.x1, q.z0, 0, 1, 1, 0, wz]];
      for (const [sx, sz, dx, dz, nx, nz, len] of sides) for (let t = 9; t < len; t += 18) {
        const x = sx + dx * t, z = sz + dz * t, ox = x + nx * 5, oz = z + nz * 5;
        if (heightAt(ox, oz) > W - 1 || inQuay(ox, oz)) continue;
        frame(x + nx * 0.3, 0, z + nz * 0.3, nx, nz);
        part(BOX, FENDER, 0, W + 0.3, 0, 2.6, D - 0.8 - W, 0.6);
      }
    }
  }

  function crane(c) {
    const D = PORT_DECK, { f, g, boom, back } = c, col = C(c.color || '#c9432b'), r1 = 3, r2 = 3 + g, mid = 3 + g / 2;
    frame(f.x, 0, f.z, f.fx, f.fz);
    for (const lx of [-9, 9]) {
      for (const lz of [r1, r2]) { part(BOX, col, lx, D, lz, 1.8, 44, 1.8); part(BOX, DARK, lx, D, lz, 2.6, 1.6, 9); }   // leg, bogie
      part(BOX, col, lx, D + PORTAL_UP, mid, 1.6, 3, g + 1.8);                  // portal beam across the lane
      rod(col, lx, r1, D + 6, mid, D + PORTAL_UP, 0.5); rod(col, lx, r2, D + 6, mid, D + PORTAL_UP, 0.5);   // knee braces
    }
    for (const lz of [r1, r2]) part(BOX, col, 0, D + PORTAL_UP, lz, 19.8, 3, 1.6);
    for (const lx of [-8, 8]) part(BOX, col, lx, D + 42, (back - boom) / 2, 1.6, 4, back + boom);   // girders
    for (let lz = -boom + 1; lz <= back; lz += 12) part(BOX, col, 0, D + 42, lz, 16, 0.8, 0.8);
    for (const lz of [r1, r2]) part(BOX, col, 0, D + 42, lz, 19.8, 4, 1.8);
    part(BOX, WHITE, 0, D + 46, mid + 4, 14, 7, 18);                            // machinery house
    for (const lx of [-7, 7]) {
      part(BOX, col, lx, D + 46, 8, 1.4, 22, 1.4);                              // A-frame
      rod(col, lx, 8, D + 68, -boom, D + 46, 0.45); rod(col, lx, 8, D + 68, back, D + 46, 0.45);   // stays
    }
    part(BOX, col, 0, D + 66, 8, 15.4, 2, 1.4);
    part(BOX, WHITE, 0, D + 37.5, -12, 3.5, 4.5, 4); part(BOX, GLASS, 0, D + 38.3, -12, 3.6, 1.6, 4.1);   // trolley cab
  }

  function stacks() {
    for (const s of PORT.stacks) {
      const r = mulberry32(s.seed);
      frame(s.x, 0, s.z, 0, -1);
      for (let i = 0; i < s.t; i++) part(BOX, pick(r, BOXES), 0, s.base + i * 2.6, 0, 12.2, 2.52, 2.44);
    }
  }

  function ship(s) {
    const W = TER.WATER, { f, L, B, T, zA, zF } = s, r = mulberry32(s.seed);
    frame(f.x, 0, f.z, f.fx, f.fz);
    const hullC = pick(r, HULLS);
    part(SHIP, hullC, 0, W - 10, 0, B, T - W + 10, L);
    part(SHIP, BOOT, 0, W - 0.4, 0, B * 1.004, 1.8, L * 1.002);
    part(SHIP, DECK, 0, T - 0.1, 0, B * 0.96, 0.2, L * 0.96);
    part(BOX, WHITE, 0, T, zA, B * 0.78, 22, 15);                                // accommodation
    for (let k = 0; k < 6; k++) part(BOX, GLASS, 0, T + 3.2 + k * 3.1, zA, B * 0.785, 0.9, 15.06);
    part(BOX, WHITE, 0, T + 22, zA - 2, B + 4, 3, 8);                            // bridge and wings
    part(BOX, GLASS, 0, T + 22.8, zA - 2, B + 4.06, 1.3, 8.06);
    const fc = pick(r, FUNNEL);
    part(BOX, fc, 0, T, zF, 6, 18, 8); part(BOX, DARK, 0, T + 18, zF, 6.06, 2, 8.06);
    part(BOX, WHITE, 0, T, -L / 2 + 0.07 * L, 0.5, 9, 0.5);                      // foremast
    if (s.type === 'container') {
      for (const bay of s.bays) {
        const n = bay.stacks.length;
        bay.stacks.forEach((t, i) => { for (let k = 0; k < t; k++) part(BOX, pick(r, BOXES), (i - (n - 1) / 2) * 2.5, T + k * 2.6, bay.z, 2.44, 2.52, 12.2); });
      }
    } else if (s.type === 'bulk') {
      for (let i = 0; i < 7; i++) part(BOX, HATCH, 0, T, lerp(-L * 0.34, zA - 16, i / 6), B * 0.62, 2, L * 0.075);
      for (const [x, z] of s.cranes) {
        part(CYL, YELLOW, x, T, z, 1.4, 10, 1.4);
        part(BOX, YELLOW, x, T + 10, z, 2.4, 2.4, 3);
        rod(YELLOW, x, z - 1, T + 11, z - 20, T + 23, 0.8);
      }
    } else {                                                                     // tanker: red deck, pipe rack, manifold
      part(BOX, TANKDECK, 0, T, (zA - 8 - L * 0.4) / 2, B * 0.9, 0.2, zA - 8 + L * 0.4);
      part(BOX, GREY, 0, T, (zA - 8 - L * 0.4) / 2, 1.6, 1.8, zA - 10 + L * 0.4);
      part(BOX, GREY, 0, T, -L * 0.05, B * 0.7, 2.6, 3);
      part(BOX, YELLOW, B * 0.3, T, -L * 0.05, 1, 6, 1);
    }
  }

  function tug(t) {
    const W = TER.WATER, { f } = t, r = mulberry32(t.seed), hc = r() < 0.5 ? RED : C('#2a2a2e');
    frame(f.x, 0, f.z, f.fx, f.fz);
    part(SHIP, hc, 0, W - 4, 0, 11, 7.2, 32);
    part(SHIP, FENDER, 0, W + 1.8, 0, 11.3, 0.9, 32.4);
    part(BOX, WHITE, 0, W + 3.2, -2, 7, 3.6, 12);
    part(BOX, WHITE, 0, W + 6.8, -4, 5.6, 2.8, 5.6); part(BOX, GLASS, 0, W + 7.6, -4, 5.66, 1.3, 5.66);
    for (const s of [-1, 1]) part(BOX, hc, s * 2, W + 6.8, 3, 1.2, 4, 1.6);
    part(BOX, WHITE, 0, W + 9.6, -4, 0.3, 1.8, 0.3);
  }

  function extras() {
    for (const m of PORT.masts) {
      frame(m.x, 0, m.z, 0, -1);
      part(CYL, GREY, 0, m.b, 0, 0.5, 36, 0.5);
      part(BOX, GREY, 0, m.b + 34, 0, 5, 1.2, 2);
      part(BOX, LAMP, 0, m.b + 34.1, 1.05, 4.6, 1, 0.2);
    }
    for (const s of PORT.sheds) {
      frame(s.f.x, 0, s.f.z, s.f.fx, s.f.fz);
      part(BOX, WALLS[s.c], 0, s.base, 0, s.w, s.top - s.base, s.l);
      part(PRISM, ROOFC, 0, s.top, 0, s.w * 1.04, s.roof, s.l * 1.02);
      for (const e of [-1, 1]) part(BOX, DARK, 0, s.base, e * (s.l / 2 + 0.02), s.w * 0.3, s.top - s.base - 3, 0.1);   // doors at the ends
    }
    const W = TER.WATER;
    for (const b of PORT.breakwaters) {
      for (const [x, z, r, a, k] of b.lumps) { frame(x, 0, z, Math.cos(a), Math.sin(a)); part(ICO, ROCK[k], 0, W + 0.4, 0, r * 1.3, r * 0.55, r); }
      if (!b.light) continue;
      frame(b.x1, 0, b.z1, 0, -1);
      part(CYL, CONCRETE, 0, W, 0, 5, 3.5, 5);
      part(CYL, WHITE, 0, W + 3.5, 0, 2.2, 13.5, 2.2);
      part(CYL, RED, 0, W + 9, 0, 2.25, 3, 2.25);
      part(CYL, GLASS, 0, W + 17, 0, 1.6, 2.2, 1.6);
      part(CONE, RED, 0, W + 19.2, 0, 2, 1.8, 2);
    }
  }

  function build(group) {
    if (!COURSE.port) return;
    Mx.reset();
    quays(); PORT.cranes.forEach(crane); stacks(); PORT.ships.forEach(ship); PORT.tugs.forEach(tug); extras();
    const m = Mx.mesh(mat);
    if (m) group.add(m);
  }
  return { build };
}

SHORE_PLUGINS.push({ build: buildPort, createKit: createPortKit });
