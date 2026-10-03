'use strict';
/* =========================================================================
   METRO — metro lines through the city: double-track viaducts on piers, embankments, the track on the ground, open
   cuttings and covered tunnels below the streets, with trains running both ways; and a gate that rides on a train.
   A js/city.js plugin (CITY_PLUGINS): the city keeps its buildings off the lines, skips the blocks an open cutting runs
   through (lawn either side instead) and digs the ground out under the cuttings and tunnels.
   Course file, in city: metro: { lines: [{ id, color, pts, w, speed, every, cars, tracks, pier, pierPhase }] }
     pts      [[x, z, h, 'T'?], ...]: a smooth curve through the points; h is the track bed's height above the streets,
              straight between points (eased over METRO_EASE m): on a viaduct over METRO_EMB m (piers every `pier` m,
              counted from pierPhase m along; none on another line's deck or on a road, nor right on the course line
              where it runs under the deck), an embankment below that, on the ground at 0, in a cutting below 0. 'T'
              covers the stretch to the next point: a tunnel, its ceiling METRO_ROOF m over the bed (h must be at least
              that far below 0 there)
     w        viaduct width (m, default METRO.w); color: the trains' stripe
     tracks   [{ off, dir, phase, every }]: off m right of the way the points run, dir 1 that way and -1 back; phase (m)
              shifts its trains along; every: this track's own gap between trains
     speed, every, cars    the trains' speed (m/s), the gap from one train's front to the next (m), cars a train.
              Trains run from end to end of the line and start again from the first end; they're always running (the
              run's own clock), so the ends belong out in the haze or down a tunnel
   Gate (a point's 7th value, GATE_TYPES in js/sim.js): "train", options { line, track, lo, hi }. The point is placed
   over that track (design.py), where it runs straight along the course line; the hoop rides on the middle of a train
   there, as high over the rail as the point is: on the first train ahead of you, along the line through the point, that
   is between lo and hi m past the point (lo negative: before it), or the one it's on now while that's still ahead of
   you. Overtake it or meet it head on, and fly through it wherever it has got to; miss it, and it's the next train's.
   Respawning there puts you over the track (the trains pass under). Everything is a crash: decks, piers, cutting walls,
   tunnel roofs ('metro') and the trains ('train').
   Sim part (no DOM): METRO, metroTick(dt), metroReset(), metroStep(dt, P) (the clock, then which train each gate's hoop
   is on), metroAt(L, s, off, out), metroTrainHit(P) (CRASH_PLUGINS).
   Game part: the lines (in the city's own meshes: js/city.js kit), createMetroKit() (GATE_KITS): the trains and the
   hoops riding on them.
   ========================================================================= */
const METRO = { lines: [], gates: [], T: 0, grid: new Map(), w: 10 };
const METRO_EMB = 4.5;                                        // under this the track runs on an embankment, not on piers
const METRO_DECK = 2.0, METRO_PARAPET = 1.0, METRO_RAIL = 0.55;   // girder depth, parapet over the bed, rail over the bed
const METRO_CUT = 10;                                         // half width of a cutting or tunnel (m, between the walls)
const METRO_ROOF = 14;                                        // tunnel ceiling over the bed (m)
const METRO_EASE = 18;                                        // m over which a change of gradient is eased
const METRO_CAR = { len: 17, gap: 1.2, hw: 1.45, h: 3.6 };    // a car: length, gap between cars, half width, height over the rail
const METRO_CELL = 60;                                        // grid of line samples, for the plugin's lookups
let METRO_DIG = 0;                                            // reach of the dug ground past the walls (set from the terrain's cell)

function metroTick(dt) { METRO.T += dt; }
function metroReset() { METRO.T = 0; for (const g of METRO.gates) { g.on = false; g.a = 1e6; g.j = null; } }

// the line's samples, every `step` m along it: X, Z, Hb (bed height above the streets), TX, TZ (unit tangent), and the
// kind of each: 'via' | 'emb' | 'grade' | 'cut' | 'tun'
function metroBuildLine(spec, G) {
  const pts = spec.pts, n0 = pts.length;
  const cv = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
  const div = (n0 - 1) * 40, lens = cv.getLengths(div), len = lens[div];
  const sCtrl = pts.map((p, i) => lens[i * 40]);              // where each point is along the curve
  const n = Math.max(2, Math.ceil(len / 4) + 1), step = len / (n - 1);
  const L = { id: spec.id, spec, len, n, step, X: new Float32Array(n), Z: new Float32Array(n), Hb: new Float32Array(n), TX: new Float32Array(n), TZ: new Float32Array(n),
              kind: [], w: spec.w || METRO.w, G, tracks: [], piers: [] };
  const p = new THREE.Vector3(), t = new THREE.Vector3(), raw = new Float32Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const s = i * step, u = s / len;
    cv.getPointAt(u, p); cv.getTangentAt(u, t);
    const tl = Math.hypot(t.x, t.z) || 1;
    L.X[i] = p.x; L.Z[i] = p.z; L.TX[i] = t.x / tl; L.TZ[i] = t.z / tl;
    while (seg < n0 - 2 && sCtrl[seg + 1] <= s) seg++;
    const f = clamp((s - sCtrl[seg]) / Math.max(1e-6, sCtrl[seg + 1] - sCtrl[seg]), 0, 1);
    raw[i] = lerp(pts[seg][2], pts[seg + 1][2], f);
    L.kind.push(pts[seg][3] === 'T' ? 'tun' : null);
  }
  const k = Math.max(1, Math.round(METRO_EASE / 2 / step));   // ease the gradient changes (a moving average)
  for (let i = 0; i < n; i++) {
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) { sum += raw[j]; c++; }
    L.Hb[i] = sum / c;
  }
  for (let i = 0; i < n; i++) {
    const h = L.Hb[i];
    if (!L.kind[i]) L.kind[i] = h > METRO_EMB ? 'via' : h > 0.25 ? 'emb' : h > -0.25 ? 'grade' : 'cut';
  }
  return L;
}
// the point `off` m right of the line, s m along it (clamped to its ends): out.x, out.y (the bed), out.z, out.tx, out.tz
function metroAt(L, s, off, out) {
  const f = clamp(s / L.step, 0, L.n - 1.0001), i = Math.floor(f), t = f - i;
  const tx = lerp(L.TX[i], L.TX[i + 1], t), tz = lerp(L.TZ[i], L.TZ[i + 1], t), tl = Math.hypot(tx, tz) || 1;
  out.tx = tx / tl; out.tz = tz / tl;
  out.x = lerp(L.X[i], L.X[i + 1], t) - out.tz * off; out.z = lerp(L.Z[i], L.Z[i + 1], t) + out.tx * off;
  out.y = L.G + lerp(L.Hb[i], L.Hb[i + 1], t);
  return out;
}
// the nearest sample of any line within the grid's reach of (x, z): { L, i, d } (d Infinity if none)
const _mn = { L: null, i: 0, d: Infinity };
function metroNear(x, z) {
  _mn.L = null; _mn.d = Infinity;
  const ci = Math.floor(x / METRO_CELL), cj = Math.floor(z / METRO_CELL);
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const list = METRO.grid.get(treeKey(ci + di, cj + dj));
    if (!list) continue;
    for (let k = 0; k < list.length; k += 2) {
      const L = list[k], i = list[k + 1], dx = L.X[i] - x, dz = L.Z[i] - z, d = dx * dx + dz * dz;
      if (d < _mn.d) { _mn.d = d; _mn.L = L; _mn.i = i; }
    }
  }
  _mn.d = Math.sqrt(_mn.d);
  return _mn;
}

/* ---------- trains: when each one is where ---------- */
function metroTracks(L) {
  const S = L.spec, cars = S.cars || 4, tlen = cars * METRO_CAR.len + (cars - 1) * METRO_CAR.gap;
  for (const tr of S.tracks || [{ off: 2.1, dir: 1 }, { off: -2.1, dir: -1 }]) {
    const every = Math.max(tr.every || S.every || 300, tlen + 40), N = Math.ceil((L.len + tlen) / every) + 1;
    L.tracks.push({ L, off: tr.off, dir: tr.dir || 1, phase: tr.phase || 0, v: S.speed || 22, every, cars, tlen, N, loop: N * every });
  }
}
// travel coordinate q of train j's front (m from the end it starts at); it's on the line while 0 < q < len + tlen
function metroFront(tr, j) { const q = (METRO.T * tr.v + j * tr.every + tr.phase) % tr.loop; return q < 0 ? q + tr.loop : q; }
const metroS = (tr, q) => (tr.dir > 0 ? q : tr.L.len - q);   // travel coordinate -> m along the line

/* ---------- the plugin: ground, lines, boxes ---------- */
CITY_PLUGINS.push({
  terrain(C, G) {
    METRO.lines.length = 0; METRO.grid.clear(); METRO.gates.length = 0;
    const M = C.metro;
    if (!M) return;
    for (const spec of M.lines || []) {
      const L = metroBuildLine(spec, G);
      metroTracks(L);
      METRO.lines.push(L);
      for (let i = 0; i < L.n; i += 2) {
        const key = treeKey(Math.floor(L.X[i] / METRO_CELL), Math.floor(L.Z[i] / METRO_CELL));
        let list = METRO.grid.get(key); if (!list) METRO.grid.set(key, list = []);
        list.push(L, i);
      }
    }
    // dig out under the cuttings and tunnels: every grid point within a cell's diagonal of a wall goes down below the bed,
    // so no terrain triangle rises inside the walls (the walls' boxes cover the slope back up behind them)
    const W = TER.N + 1, cell = TER.CELL, reach = METRO_CUT + cell * Math.SQRT2 + 1;
    METRO_DIG = cell * Math.SQRT2 + 3;
    for (const L of METRO.lines) for (let i = 0; i < L.n; i++) {
      if (L.Hb[i] > -0.25) continue;
      const bed = G + L.Hb[i] - 1.2, x = L.X[i], z = L.Z[i];
      const i0 = Math.max(0, Math.floor((x - reach - TER.X0) / cell)), i1 = Math.min(TER.N, Math.ceil((x + reach - TER.X0) / cell));
      const j0 = Math.max(0, Math.floor((z - reach - TER.Z0) / cell)), j1 = Math.min(TER.N, Math.ceil((z + reach - TER.Z0) / cell));
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
        const gx = TER.X0 + ii * cell, gz = TER.Z0 + jj * cell;
        if (Math.hypot(gx - x, gz - z) < reach + L.step / 2) { const kk = jj * W + ii; if (TH[kk] > bed) TH[kk] = bed; }
      }
    }
  },
  exclude(x, z, rd) {
    if (!METRO.lines.length) return false;
    const q = metroNear(x, z);
    if (!q.L) return false;
    const k = q.L.kind[q.i], half = k === 'cut' || k === 'tun' ? METRO_CUT + METRO_DIG : q.L.w / 2;
    return q.d < half + rd + 6;
  },
  skipBlock(blk) {                                           // a block an open cutting runs through: lawn instead (drawn here)
    if (!METRO.lines.length) return false;
    const h = CITY.C.block / 2 + METRO_CUT + METRO_DIG, { UX, UZ, VX, VZ } = CITY.axes;
    for (const L of METRO.lines) for (let i = 0; i < L.n; i += 2) {
      if (L.kind[i] !== 'cut') continue;
      const dx = L.X[i] - blk.x, dz = L.Z[i] - blk.z;
      if (Math.abs(dx * UX + dz * UZ) < h && Math.abs(dx * VX + dz * VZ) < h) return true;
    }
    return false;
  },
  after(ctx) {
    const G = ctx.G;
    for (const L of METRO.lines) metroBoxes(L, G);
    // a row of trees along each side of an open cutting, out on its lawn
    const rt = mulberry32(5150), off = METRO_CUT + METRO_DIG + 12;
    for (const L of METRO.lines) for (let i = 0; i < L.n; i += 5) {
      if (L.kind[i] !== 'cut') continue;
      for (const sd of [-1, 1]) if (rt() < 0.85) ctx.tree(L.X[i] - L.TZ[i] * off * sd, L.Z[i] + L.TX[i] * off * sd, 8 + rt() * 5, 2.8 + rt() * 1.2);
    }
    metroGates();
  },
  kit: { build(K, group) { metroDraw(K, group); } },
});

// the line's boxes: deck and parapets, piers; embankment; cutting and tunnel walls, tunnel roof
function metroBoxes(L, G) {
  const half = L.w / 2, S = L.spec, pier = S.pier || 34;
  let nextPier = S.pierPhase || 0;
  for (let i = 0; i < L.n - 1; i++) {
    const k = L.kind[i], hb = (L.Hb[i] + L.Hb[i + 1]) / 2, x = (L.X[i] + L.X[i + 1]) / 2, z = (L.Z[i] + L.Z[i + 1]) / 2;
    const dx = L.X[i + 1] - L.X[i], dz = L.Z[i + 1] - L.Z[i], l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
    const s = i * L.step;
    if (k === 'via' || k === 'emb') shoreBox('metro', x, z, ux, uz, l / 2 + 0.3, half, k === 'via' ? G + hb - METRO_DECK : G - 1, G + hb + METRO_PARAPET);
    else if (k === 'grade') shoreBox('metro', x, z, ux, uz, l / 2 + 0.3, half, G - 1, G + 0.4);
    else {                                                   // cutting or tunnel: the walls (solid out over the dug slope)
      const top = G + (k === 'tun' ? 0.3 : 1.1), bot = G + hb - 3, wd = METRO_DIG / 2;
      for (const sd of [-1, 1]) shoreBox('metro', x - uz * sd * (METRO_CUT + wd), z + ux * sd * (METRO_CUT + wd), ux, uz, l / 2 + 0.3, wd, bot, top);
      if (k === 'tun') shoreBox('metro', x, z, ux, uz, l / 2 + 0.3, METRO_CUT + 0.5, G + hb + METRO_ROOF, G + 0.3);
    }
    // piers under the viaduct
    if (s < nextPier) continue;
    nextPier += pier;
    if (k !== 'via' || L.Hb[i] < METRO_EMB + 1) continue;
    const px = L.X[i], pz = L.Z[i];
    if (CITY.hwGrid.size) { const q = cityHighwayNear(px, pz); if (q.d < q.hw + 3) continue; }   // not on a road
    if (METRO.lines.some((O) => O !== L && metroOnDeck(O, px, pz))) continue;                     // nor on another line
    const ln = cityLineNear(px, pz);                          // nor right on the course line where it runs under the deck
    if (ln.d < 6 && ln.s.y < G + L.Hb[i]) continue;
    L.piers.push({ x: px, z: pz, ux: L.TX[i], uz: L.TZ[i], top: G + L.Hb[i] - METRO_DECK });
    shoreBox('metro', px, pz, L.TX[i], L.TZ[i], 1.3, 1.3, G - 1, G + L.Hb[i] - METRO_DECK);
  }
}
function metroOnDeck(L, x, z) {                              // within line L's footprint (plus a little)?
  for (let i = 0; i < L.n; i += 2) { const dx = L.X[i] - x, dz = L.Z[i] - z; if (dx * dx + dz * dz < (L.w / 2 + 4) ** 2) return true; }
  return false;
}

/* ---------- the trains as a crash ---------- */
const _mt = new THREE.Vector3(), _mtA = { x: 0, y: 0, z: 0, tx: 0, tz: 0 }, _mtB = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
function metroCarPose(tr, s, out) {                          // a car's middle (on the rail), its heading and pitch
  const L = tr.L, d = METRO_CAR.len / 2 - 2.2;
  metroAt(L, s - d, tr.off, _mtA); metroAt(L, s + d, tr.off, _mtB);
  const dx = _mtB.x - _mtA.x, dz = _mtB.z - _mtA.z, dy = _mtB.y - _mtA.y, l = Math.hypot(dx, dz) || 1;
  out.x = (_mtA.x + _mtB.x) / 2; out.z = (_mtA.z + _mtB.z) / 2; out.y = (_mtA.y + _mtB.y) / 2 + METRO_RAIL;
  out.ux = dx / l; out.uz = dz / l; out.pitch = Math.atan2(dy, l);
  return out;
}
const _mc = { x: 0, y: 0, z: 0, ux: 1, uz: 0, pitch: 0 };
function metroTrainHit(P) {
  if (!METRO.lines.length) return null;
  const C = METRO_CAR, W = TUNE.WING_HALF, px = P.pos.x, pz = P.pos.z, py = P.pos.y;
  _mt.set(1, 0, 0).applyQuaternion(P.q);
  let hit = null;
  for (const L of METRO.lines) {
    for (const tr of L.tracks) for (let j = 0; j < tr.N && !hit; j++) {
      const q = metroFront(tr, j);
      if (q <= 0 || q - tr.tlen >= L.len) continue;
      metroAt(L, metroS(tr, q - tr.tlen / 2), tr.off, _mtA);   // quick reject: far from the train's middle
      if (Math.abs(_mtA.y + 2 - py) > 14 || (_mtA.x - px) ** 2 + (_mtA.z - pz) ** 2 > (tr.tlen / 2 + 25) ** 2) continue;
      for (let k = 0; k < tr.cars; k++) {
        const qc = q - k * (C.len + C.gap) - C.len / 2;
        if (qc < -C.len / 2 || qc > L.len + C.len / 2) continue;
        const c = metroCarPose(tr, metroS(tr, qc), _mc);
        for (let sd = -1; sd <= 1; sd++) {
          const pad = sd ? 0.25 : 0.9, x = px + _mt.x * W * sd - c.x, y = py + _mt.y * W * sd - c.y, z = pz + _mt.z * W * sd - c.z;
          const u = x * c.ux + z * c.uz, v = z * c.ux - x * c.uz, yy = y - u * Math.tan(c.pitch);
          if (Math.abs(u) < C.len / 2 + pad && Math.abs(v) < C.hw + pad && yy > -0.4 - pad && yy < C.h + pad) { hit = 'train'; break; }
        }
        if (hit) break;
      }
    }
    if (hit) break;
  }
  return hit;
}
CRASH_PLUGINS.push(metroTrainHit);
var CRASH_TEXT = CRASH_TEXT || {};
CRASH_TEXT.metro = 'Hit the metro';
CRASH_TEXT.train = 'Hit a train';

/* ---------- the gate on a train ---------- */
function metroGates() {
  METRO.gates.length = 0;
  HOOPS.forEach((h, i) => {
    if (h.kind !== 'train') return;
    const o = h.opts || {}, L = METRO.lines.find((l) => l.id === o.line) || METRO.lines[0];
    if (!L) return;
    const tr = L.tracks[o.track || 0] || L.tracks[0];
    // the track's height under the point (for the hoop's height over it) and which way along the line the course runs
    let best = 0, bd = Infinity;
    for (let k = 0; k < L.n; k++) { const d = (L.X[k] - h.pos.x) ** 2 + (L.Z[k] - h.pos.z) ** 2; if (d < bd) { bd = d; best = k; } }
    const up = h.pos.y - (L.G + L.Hb[best]);                 // the hoop's height over the bed
    const g = { i, h, L, tr, up, du: 0, dv: 0, lo: o.lo != null ? o.lo : -200, hi: o.hi != null ? o.hi : 800, s0: best * L.step,
                sgn: Math.sign(L.TX[best] * h.normal.x + L.TZ[best] * h.normal.z) || 1, on: false, a: 1e6, j: null, pos: new THREE.Vector3() };
    h.metro = g;
    METRO.gates.push(g);
  });
}
// the clock, then each gate's train: the nearest one ahead of the plane (along the line through the point) within lo..hi
function metroStep(dt, P) {
  metroTick(dt);
  for (const g of METRO.gates) {
    const h = g.h, tr = g.tr, ap = P ? (P.pos.x - h.pos.x) * h.normal.x + (P.pos.y - h.pos.y) * h.normal.y + (P.pos.z - h.pos.z) * h.normal.z : -1e9;
    const at = (j) => { const q = metroFront(tr, j); return q <= 0 || q - tr.tlen >= tr.L.len ? null : (metroS(tr, q - tr.tlen / 2) - g.s0) * g.sgn; };
    // the nearest train ahead within lo..hi; the one it's on now counts even once it has run out of them, so a hoop
    // that's about to be flown through doesn't hop to the next train
    let a = 1e6, pick = null;
    for (let j = 0; j < tr.N; j++) {
      const aj = at(j);                                      // the train's middle, m past the point
      if (aj == null || aj <= ap || (j !== g.j && (aj < g.lo || aj > g.hi))) continue;
      if (aj < a) { a = aj; pick = j; }
    }
    g.j = pick;
    g.on = g.j != null; g.a = 1e6;
    if (g.on) {                                              // where it really is: over the track at the train's middle
      const q = metroFront(tr, g.j);
      metroAt(tr.L, metroS(tr, q - tr.tlen / 2), tr.off, _mtB);
      g.pos.set(_mtB.x, _mtB.y + g.up, _mtB.z);
      const n = h.normal, dx = g.pos.x - h.pos.x, dy = g.pos.y - h.pos.y, dz = g.pos.z - h.pos.z;
      g.a = dx * n.x + dy * n.y + dz * n.z;                  // the plane it's scored in, m along the gate's normal
      const hx = dx - n.x * g.a, hy = dy - n.y * g.a, hz = dz - n.z * g.a, rl = Math.hypot(n.x, n.z) || 1;
      g.du = hx * -n.z / rl + hz * n.x / rl; g.dv = hy * rl - (hx * n.x + hz * n.z) * n.y / rl;   // and where in it
    }
  }
}
GATE_TYPES.train = {
  // scored on the hoop's circle where it has got to: the plane it's in moves along the line with it (along)
  along: (h) => (h.metro && h.metro.on ? h.metro.a : 1e6),
  shape: (h, u, v) => !!(h.metro && h.metro.on) && (u - h.metro.du) ** 2 + (v - h.metro.dv) ** 2 < (TUNE.HOOP_R + TUNE.HOOP_TOL) ** 2,
  disc: () => 0,                                             // it moves: a disc at the point would mark the wrong place
  top: () => TUNE.HOOP_R + 2,
  // autopilot: along the line as usual, but on past the point to wherever the hoop has got to (the usual search for the
  // nearest point of the line stops at the point, so past it the aim would turn back)
  aim(h, P, out) {
    const g = h.metro;
    if (!g) return false;
    const n = SAMPLES.length - 1, step = COURSE_LEN / n, k0 = g.i > 0 ? HOOPS[g.i - 1].sample : 0;
    const k1 = clamp(h.sample + Math.round((g.on ? g.a : 600) / step), k0 + 1, n);
    let best = k0, bd = Infinity;
    for (let k = k0; k <= k1; k++) { const sp = SAMPLES[k], d = (sp.x - P.pos.x) ** 2 + (sp.y - P.pos.y) ** 2 + (sp.z - P.pos.z) ** 2; if (d < bd) { bd = d; best = k; } }
    const lead = (COURSE.autopilot && COURSE.autopilot.lead) || TUNE.AP_LEAD;
    const t = SAMPLES[Math.min(k1 + 2, best + Math.max(1, Math.round(TUNE.CRUISE * lead / step)))];
    out.set(t.x - P.pos.x, t.y - P.pos.y, t.z - P.pos.z).normalize();
    return true;
  },
};

/* ---------- game part: the lines, drawn into the city's meshes ---------- */
function metroDraw(K, group) {
  if (!METRO.lines.length) return;
  const C3 = K.C3, M = K.M, G = CITY.G;
  const CONC = C3('#b9b4aa'), CONC_D = C3('#8f8a82'), UNDER = C3('#d8d2c6'), BED = C3('#5d564f'), BALLAST = C3('#6e665c');
  const RAIL = C3('#a7a9ab'), WALL = C3('#a29d94'), TUNW = C3('#262422'), TUNC = C3('#1f1e1c'), LAWN = C3('#5f7d45');
  const lamps = [];                                          // tunnel lamps and portal lights: unlit quads (below)
  for (const L of METRO.lines) {
    const half = L.w / 2;
    // across: the mean of the neighbours' directions, so the pieces join up
    const nrm = (i) => { const a = Math.max(0, i - 1), b = Math.min(L.n - 1, i + 1), dx = L.X[b] - L.X[a], dz = L.Z[b] - L.Z[a], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
    for (let i = 0; i < L.n - 1; i++) {
      const k = L.kind[i], k2 = L.kind[i + 1], [nax, naz] = nrm(i), [nbx, nbz] = nrm(i + 1);
      const ya = G + L.Hb[i], yb = G + L.Hb[i + 1];
      const A = (o, y) => [L.X[i] + nax * o, y, L.Z[i] + naz * o], B = (o, y) => [L.X[i + 1] + nbx * o, y, L.Z[i + 1] + nbz * o];
      const side = (o, y0a, y1a, y0b, y1b, col, sd) => K.quad(M, A(o, y0a), B(o, y0b), B(o, y1b), A(o, y1a), col, [nax * sd, 0, naz * sd]);
      const top = (o0, o1, da, db, col) => K.quad(M, A(o0, ya + da), B(o0, yb + db), B(o1, yb + db), A(o1, ya + da), col, [0, 1, 0]);
      M.at((L.X[i] + L.X[i + 1]) / 2, (L.Z[i] + L.Z[i + 1]) / 2);
      // the bed and the two tracks: ballast strips and rails
      const bedW = k === 'cut' || k === 'tun' ? METRO_CUT : half - 0.4;
      top(-bedW, bedW, 0.02, 0.02, BED);
      for (const tr of L.tracks) {
        const o = tr.off;
        top(o - 1.5, o + 1.5, 0.08, 0.08, BALLAST);
        for (const r of [-0.72, 0.72]) {
          top(o + r - 0.06, o + r + 0.06, 0.3, 0.3, RAIL);
          side(o + r - 0.06, ya + 0.08, ya + 0.3, yb + 0.08, yb + 0.3, RAIL, -1);
          side(o + r + 0.06, ya + 0.08, ya + 0.3, yb + 0.08, yb + 0.3, RAIL, 1);
        }
      }
      if (k === 'via' || k === 'emb' || k === 'grade') {
        if (k !== 'grade') for (const sd of [-1, 1]) {
          const e = sd * half, e2 = sd * (half - 0.35);
          const y0a = k === 'via' ? ya - METRO_DECK : G - 0.3, y0b = k2 === 'via' ? yb - METRO_DECK : G - 0.3;
          side(e, y0a, ya + METRO_PARAPET, y0b, yb + METRO_PARAPET, k === 'via' ? CONC : WALL, sd);   // girder side and parapet
          side(e2, ya, ya + METRO_PARAPET, yb, yb + METRO_PARAPET, CONC_D, -sd);
          K.quad(M, A(e2, ya + METRO_PARAPET), B(e2, yb + METRO_PARAPET), B(e, yb + METRO_PARAPET), A(e, ya + METRO_PARAPET), CONC, [0, 1, 0]);
        }
        if (k === 'via') K.quad(M, A(-half, ya - METRO_DECK), B(-half, yb - METRO_DECK), B(half, yb - METRO_DECK), A(half, ya - METRO_DECK), UNDER, [0, -1, 0]);
        continue;
      }
      // cutting or tunnel: the walls, a parapet and lawn along the top of an open cutting; a ceiling inside a tunnel
      const tun = k === 'tun';
      for (const sd of [-1, 1]) {
        const e = sd * METRO_CUT;
        side(e, ya - 0.2, G + (tun ? 0 : 1.1), yb - 0.2, G + (tun ? 0 : 1.1), tun ? TUNW : WALL, -sd);
        if (!tun) {
          K.quad(M, A(e, G + 1.1), B(e, G + 1.1), B(e + sd * 0.5, G + 1.1), A(e + sd * 0.5, G + 1.1), CONC, [0, 1, 0]);
          side(e + sd * 0.5, G - 0.2, G + 1.1, G - 0.2, G + 1.1, CONC, sd);
          K.quad(M, A(e + sd * 0.5, G + 0.06), B(e + sd * 0.5, G + 0.06), B(e + sd * (METRO_DIG + 24), G + 0.06), A(e + sd * (METRO_DIG + 24), G + 0.06), LAWN, [0, 1, 0]);
        }
      }
      if (tun) {
        K.quad(M, A(-METRO_CUT, ya + METRO_ROOF), B(-METRO_CUT, yb + METRO_ROOF), B(METRO_CUT, yb + METRO_ROOF), A(METRO_CUT, ya + METRO_ROOF), TUNC, [0, -1, 0]);
        if (i % 4 === 0) for (const sd of [-1, 1]) lamps.push([L.X[i] + nax * sd * (METRO_CUT - 0.05), ya + METRO_ROOF - 3, L.Z[i] + naz * sd * (METRO_CUT - 0.05), -nax * sd, -naz * sd, 1.6, 0.35]);
      }
      // a portal: the headwall over the mouth, both faces, up to the parapet
      if (tun !== (k2 === 'tun') || (i === 0 && tun)) {
        const j = tun !== (k2 === 'tun') ? i + 1 : i, x = L.X[j], z = L.Z[j], y = G + L.Hb[j], [nx, nz] = nrm(j), tx = nz, tz = -nx;
        const face = (dir) => {                              // dir: the side it faces, along the line
          const P = (o, yy, f) => [x + nx * o + tx * f, yy, z + nz * o + tz * f];
          const f = dir * 0.05;
          K.quad(M, P(-METRO_CUT - 2, y + METRO_ROOF, f), P(METRO_CUT + 2, y + METRO_ROOF, f), P(METRO_CUT + 2, G + 1.1, f), P(-METRO_CUT - 2, G + 1.1, f), CONC, [tx * dir, 0, tz * dir]);
          K.quad(M, P(-METRO_CUT - 2, G + 1.1, f), P(METRO_CUT + 2, G + 1.1, f), P(METRO_CUT + 2, G + 1.1, f - dir * 1.2), P(-METRO_CUT - 2, G + 1.1, f - dir * 1.2), CONC_D, [0, 1, 0]);
          for (let o = -METRO_CUT + 1.5; o <= METRO_CUT - 1.4; o += 2.5) lamps.push([x + nx * o + tx * f * 2, y + METRO_ROOF - 0.6, z + nz * o + tz * f * 2, tx * dir, tz * dir, 0.9, 0.3]);
        };
        face(tun ? 1 : -1);
      }
    }
    // piers: a column and a cap under the girder
    for (const p of L.piers) {
      M.at(p.x, p.z);
      K.plainBox(p.x, p.z, p.ux, p.uz, 1.1, 1.3, G - 0.3, p.top - 1.2, CONC_D, false);
      K.plainBox(p.x, p.z, p.ux, p.uz, 1.5, half - 1.2, p.top - 1.2, p.top, CONC, false);
    }
  }
  if (lamps.length) {                                        // little lit rectangles, unlit by the scene's light
    const pos = [];
    for (const [x, y, z, fx, fz, w, h] of lamps) {
      const rx = fz, rz = -fx, c = (a, b) => [x + rx * a * w / 2 + fx * 0.02, y + b * h / 2, z + rz * a * w / 2 + fz * 0.02];
      const p = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
      for (const q of [0, 1, 2, 0, 2, 3]) pos.push(...p[q]);
      for (const q of [0, 2, 1, 0, 3, 2]) pos.push(...p[q]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({ color: '#ffe2b0' });
    mat.userData.noSun = true;
    group.add(new THREE.Mesh(g, mat));
  }
}

/* ---------- game part: the trains, and the hoops riding on them ---------- */
function createMetroKit(ctx) {
  const HM = ctx.hoopMat;
  let items = [], hoops = [];
  // a car, length along z (+z its front), x across, y up from the rail: body, stripe, window band, doors, roof
  function carGeometry(stripe) {
    const pos = [], col = [], C = METRO_CAR, hw = C.hw, hl = C.len / 2;
    const box = (x0, x1, y0, y1, z0, z1, c) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).toNonIndexed();
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); col.push(c.r, c.g, c.b); }
    };
    const body = new THREE.Color('#d9dcdc'), dark = new THREE.Color('#2c2f33'), roof = new THREE.Color('#9fa4a8'), st = new THREE.Color(stripe);
    box(-hw * 0.8, hw * 0.8, 0.1, 0.75, -hl + 1.5, hl - 1.5, dark);                 // underframe, bogies
    box(-hw, hw, 0.75, C.h - 0.25, -hl, hl, body);                                  // body
    box(-hw - 0.02, hw + 0.02, 1.0, 1.35, -hl + 0.1, hl - 0.1, st);                 // stripe
    box(-hw * 0.92, hw * 0.92, C.h - 0.25, C.h, -hl + 0.4, hl - 0.4, roof);         // roof
    for (const z of [-hl * 0.55, 0, hl * 0.55]) box(-hw - 0.03, hw + 0.03, 1.4, C.h - 0.5, z - 0.7, z + 0.7, new THREE.Color('#8e9497'));   // doors
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  // the lit window band and the cab lights, as unlit quads: wins (both sides), head (white, +z end), tail (red, -z end)
  function quadsGeometry(list) {
    const pos = [], col = [];
    for (const [a, b, c, d, cl] of list) for (const p of [a, b, c, a, c, d]) { pos.push(...p); col.push(...cl); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }
  function winGeometry() {
    const C = METRO_CAR, hw = C.hw + 0.035, hl = C.len / 2, W = [1, 0.88, 0.62], list = [];
    const zs = [[-hl + 0.8, -hl * 0.55 - 0.9], [-hl * 0.55 + 0.9, -0.9], [0.9, hl * 0.55 - 0.9], [hl * 0.55 + 0.9, hl - 0.8]];
    for (const [z0, z1] of zs) {
      list.push([[hw, 1.75, z1], [hw, 1.75, z0], [hw, 2.75, z0], [hw, 2.75, z1], W]);
      list.push([[-hw, 1.75, z0], [-hw, 1.75, z1], [-hw, 2.75, z1], [-hw, 2.75, z0], W]);
    }
    return quadsGeometry(list);
  }
  function lampGeometry(front) {
    const C = METRO_CAR, z = (C.len / 2 + 0.04) * (front ? 1 : -1), s = front ? 1 : -1, c = front ? [1, 0.97, 0.86] : [0.95, 0.1, 0.06], list = [];
    for (const x of [-0.9, 0.9]) list.push([[x - 0.22 * s, 1.0, z], [x + 0.22 * s, 1.0, z], [x + 0.22 * s, 1.3, z], [x - 0.22 * s, 1.3, z], c]);
    if (front) list.push([[-1.1, 2.0, z], [1.1, 2.0, z], [1.1, 2.9, z], [-1.1, 2.9, z], [0.55, 0.62, 0.66]]);   // the cab's windscreen
    return quadsGeometry(list);
  }
  function build(group) {
    items = []; hoops = [];
    if (!METRO.lines.length) return;
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true }); lit.userData.noSun = true;   // (instanced: no terrain shade)
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }); glow.userData.noSun = true;
    const wg = winGeometry(), hg = lampGeometry(true), tg = lampGeometry(false);
    for (const L of METRO.lines) {
      const ncar = L.tracks.reduce((n, tr) => n + tr.N * tr.cars, 0), ntr = L.tracks.reduce((n, tr) => n + tr.N, 0);
      const body = new THREE.InstancedMesh(carGeometry(L.spec.color || '#3b7dd8'), lit, ncar);
      const wins = new THREE.InstancedMesh(wg, glow, ncar); wins.instanceMatrix = body.instanceMatrix;
      const head = new THREE.InstancedMesh(hg, glow, ntr), tail = new THREE.InstancedMesh(tg, glow, ntr);
      for (const m of [body, wins, head, tail]) { m.frustumCulled = false; group.add(m); }
      items.push({ L, body, wins, head, tail });
    }
    const ring = new THREE.TorusGeometry(TUNE.HOOP_R, 0.75 * TUNE.HOOP_R / 8, 8, 44);
    for (const g of METRO.gates) {
      const m = new THREE.Mesh(ring, HM.later);
      m.visible = false;
      group.add(m);
      hoops.push({ g, m, fade: 0, flash: null, at: new THREE.Vector3() });
    }
  }
  const paused = () => typeof window !== 'undefined' && window.Skyrace && window.Skyrace.state === 'paused';
  const m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), eu = new THREE.Euler(0, 0, 0, 'YXZ'), pv = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3(0, 0, 0);
  function place(mesh, idx, c, flip) {
    eu.set(-c.pitch * (flip ? -1 : 1), Math.atan2(c.ux, c.uz) + (flip ? Math.PI : 0), 0);
    mesh.setMatrixAt(idx, m4.compose(pv.set(c.x, c.y, c.z), qn.setFromEuler(eu), one));
  }
  const pose = { x: 0, y: 0, z: 0, ux: 1, uz: 0, pitch: 0 };
  function update(s) {
    if (!METRO.lines.length) return;
    if (!paused()) metroStep(s.dt, s.P);
    for (const it of items) {
      let nc = 0, nt = 0;
      const C = METRO_CAR, L = it.L;
      for (const tr of L.tracks) for (let j = 0; j < tr.N; j++) {
        const q = metroFront(tr, j), on = q > 0 && q - tr.tlen < L.len;
        for (let k = 0; k < tr.cars; k++) {
          const qc = q - k * (C.len + C.gap) - C.len / 2;
          if (on && qc > -C.len / 2 && qc < L.len + C.len / 2) { metroCarPose(tr, metroS(tr, qc), pose); place(it.body, nc, pose, tr.dir < 0); }
          else it.body.setMatrixAt(nc, m4.compose(pv.set(0, -1e4, 0), qn.identity(), zero));
          if (k === 0) { if (on && qc > -C.len / 2 && qc < L.len + C.len / 2) place(it.head, nt, pose, tr.dir < 0); else it.head.setMatrixAt(nt, m4.compose(pv.set(0, -1e4, 0), qn.identity(), zero)); }
          if (k === tr.cars - 1) { if (on && qc > -C.len / 2 && qc < L.len + C.len / 2) place(it.tail, nt, pose, tr.dir < 0); else it.tail.setMatrixAt(nt, m4.compose(pv.set(0, -1e4, 0), qn.identity(), zero)); }
          nc++;
        }
        nt++;
      }
      it.body.instanceMatrix.needsUpdate = true; it.head.instanceMatrix.needsUpdate = true; it.tail.instanceMatrix.needsUpdate = true;
    }
    for (const hp of hoops) {
      const i = hp.g.i, m = hp.m;
      if (i < s.next) {
        if (hp.fade > 0) {                                   // passed: flashes and fades where it was, riding on with the train
          hp.fade = Math.max(0, hp.fade - s.dt * 2.4);
          hp.at.addScaledVector(hp.g.h.normal, hp.g.tr.v * s.dt * Math.sign(hp.g.tr.dir * hp.g.sgn));
          m.position.copy(hp.at); hp.flash.opacity = hp.fade; m.material = hp.flash; m.visible = hp.fade > 0;
          m.scale.setScalar(1 + (1 - hp.fade) * 0.7);
        } else m.visible = false;
        continue;
      }
      m.visible = hp.g.on;
      if (!hp.g.on) continue;
      m.position.copy(hp.g.pos);
      metroAt(hp.g.tr.L, metroS(hp.g.tr, metroFront(hp.g.tr, hp.g.j) - hp.g.tr.tlen / 2), 0, _mtA);
      m.quaternion.setFromUnitVectors(_mzAxis, _mtv.set(_mtA.tx, 0, _mtA.tz));   // square to the track
      const rel = i - s.next;
      m.material = rel === 0 ? HM.next : rel === 1 ? HM.soon : HM.later;
      m.scale.setScalar(rel === 0 ? 1 + Math.sin(s.t * 6) * 0.035 : 1);
    }
  }
  function pass(i) {
    const hp = hoops.find((x) => x.g.i === i);
    if (!hp) return;
    if (hp.flash) hp.flash.dispose();
    hp.flash = HM.next.clone(); hp.flash.transparent = true; hp.flash.depthWrite = false;
    hp.fade = 1; hp.at.copy(hp.m.position);
  }
  function reset() { metroReset(); for (const hp of hoops) { hp.fade = 0; hp.m.scale.setScalar(1); } }
  return { build, update, pass, reset };
}
const _mzAxis = new THREE.Vector3(0, 0, 1), _mtv = new THREE.Vector3();
GATE_KITS.push(createMetroKit);
