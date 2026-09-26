'use strict';
/* =========================================================================
   SIMULATION CORE — no DOM, no rendering. Shared by the game and the tests.
   Conventions: plane forward = local -Z, up = +Y, right = +X.
   Rates: p = pitch up, y = yaw right, r = roll right (right wing down).
   ========================================================================= */

/* ---------- math helpers ---------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);          // frame-rate independent smoothing factor
const TAU = Math.PI * 2;
const wrapAngle = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint16Array(512), vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rand(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const v = (ix, iz) => vals[perm[(ix & 255) + perm[iz & 255]]];
  return (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    return lerp(lerp(v(ix, iz), v(ix + 1, iz), ux), lerp(v(ix, iz + 1), v(ix + 1, iz + 1), ux), uz);
  };
}
function fbm(noise, x, z, oct) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, z * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/* ---------- tuning ----------
   Defaults. config/flight.json is loaded over these at start, so it wins for any key it has. */
const TUNE = {
  CRUISE: 44, BOOST: 72, MIN_SPEED: 9, STALL: 20,
  THROTTLE_K: 0.5,        // how fast speed settles toward cruise/boost (1/s)
  G: 9.81, G_SCALE: 1.35, // energy trade along the flight path (exaggerated for swoop)
  INDUCED: 2.6,           // speed lost per rad/s of pitch rate (hard pulls bleed energy)
  GRIP: 7.0,              // how fast the flight path follows the nose (1/s)
  MAX_PITCH: 1.15, MAX_ROLL: 2.8, MAX_YAW: 0.45,  // rad/s at full authority
  RATE_K: 9,              // control-rate smoothing (1/s)
  TURN_ASSIST: 0.72,      // bank-to-turn gain: turn rate = TURN_ASSIST * turnCurve(bank) (rad/s)
  TURN_COS_MIN: 0.5,      // turnCurve follows tan(bank) until cos(bank) reaches this (0.5 = 60°), then only sin grows
  // heading-hold steering (mouse aim, autopilot); ROLL_P ~1.1 keeps the roll loop near critically damped
  BANK_GAIN: 2.0, MAX_BANK: 1.22, ROLL_P: 1.1, PITCH_P: 2.4, YAW_P: 2.0, ASSIST_LEAD: 0.15,
  // attitude steering (touch stick, and easing back to neutral): target bank + target climb, no heading to return to
  ATT_ROLL_P: 1.1, ATT_PITCH_P: 2.2, ATT_PITCH_MAX: 0.8,   // pitch loop stays critically damped at 2.2
  // touch stick: bank/climb at full throw, plus extra climb/dive that ramps in (ease-in) while held at the end
  TOUCH_BANK: 1.05, TOUCH_CLIMB: 0.45, TOUCH_CLIMB_EXTRA: 0.25, OD_THRESH: 0.8, OD_TIME: 0.8, OD_DECAY: 3,
  WEATHERVANE: 0.25,      // nose drifts toward the flight path (more so near stall)
  BOOST_DRAIN: 0.2, BOOST_REGEN: 0.085, BOOST_HOOP: 0.18,
  HOOP_R: 8, HOOP_TOL: 1.4, PLANE_R: 1.3,
  WING_HALF: 4.7,         // half span (m): pylon hits are tested along the wing, so a steep bank passes closer
  // vehicle: which model, sound and touch scheme. TOUCH_MODE 'attitude' = stick sets bank/climb, letting go levels;
  // 'rate' = stick sets roll/pitch rate, letting go holds the attitude (loops and rolls, no angle limits)
  VEHICLE: 'prop', TOUCH_MODE: 'attitude',
  CAM_DIST: 12.5, CAM_HEIGHT: 3.2, CAM_ROLL: 0.3, CAM_UP_K: 3,   // chase camera; CAM_ROLL 1 = follow roll fully
  TRAIL_G: 2.3,           // g where wingtip vapour starts
  AP_LEAD: 1.2,           // attract-mode autopilot: how far ahead along the course line it aims (s at cruise)
  AP_CLEAR: 0,            // autopilot ground clearance it holds 2 s ahead (m); 0 = 0.57 s of cruise (scales with speed)
};
// config/flight.json is the base; a course's vehicle file (config/<vehicle>.json) goes over it. boot.js resets from this.
const TUNE_DEFAULTS = Object.assign({}, TUNE);

/* ---------- course & world ----------
   A course file (courses/<id>.json) describes one race:
   {
     id, name,
     seeds:   { a, b, c, trees }                noise seeds: hills, ridges + forest mask, micro relief, tree scatter
     terrain: { size, cx, cz, n, water, edge, carveR }  square of side `size` m centred on (cx, cz), split into n×n
                                                 cells; water level, the height the edges fall away to, and how far
                                                 from the path the valley carving reaches (m, default 440)
     relief:  { base, amp, pow, freq, ridgeAmp, ridgeFreq }   optional; hill shape (defaults: rolling hills)
     palette: { dry, forestTop, high, snow }    optional; heights [from, to] where the ground colour blends
     view:    { near, far, fog: [near, far] }   optional; camera range and fog, for big maps
     clouds:  { count, y, size, near, nearR, nearY, nearSize }   optional; all but the counts are [min, max]
     lake:    { x, z, r, depth } | null         a basin pressed into the hills
     hills:   [{ x, z, r, h }]                  bumps added to the hills (e.g. to put a ridge under a pass)
     trees:   { near, scattered, maxAlt }       placement attempts along the course and across the map; no trees above maxAlt
     points:  [[x, y, z, clearance, floorHalfWidth, wallSteepness, gate?], ...]
              first = run-in, last = run-out, every point between is a gate, in flying order. The 7th value says
              which kind: left out or 1 = hoop; 0 = waypoint that only shapes the line (e.g. to turn between gates);
              "L" / "R" = single pylon on your left / right as you pass; "G" = air gate, a pylon either side, flown
              wings level. Every kind is scored the same way: a circle of radius HOOP_R centred on the point,
              facing along the line. Pylons stand beside that circle, from the ground or water to PYLON above its
              top, so the circle is invisible and the pylon shows where it is. The terrain is carved into a valley
              along the path: floor `clearance` m below it, flat for `floorHalfWidth` m either side, walls rising
              with `wallSteepness`.
     pylon:   { r0, r1, above, gap }             optional; pylon radius at the foot and top, height above the
                                                 circle's top, and the gap between circle and pylon (m)
     rules:   { pylonHit, notLevel, missed, missR, levelTol }   optional; time penalties (s) for touching a pylon,
                                                 flying an air gate banked more than levelTol degrees, and passing a
                                                 pylon gate outside its circle but within missR m of its centre (the
                                                 gate then counts as flown). Hoops never count as missed: fly back.
     lead:    "..."                             optional; the start screen's one-line brief
   }
   buildWorld(course) (re)builds everything in this section from it. */
let COURSE = null, COURSE_DEF = [], curve = null, COURSE_LEN = 0, HOOPS = [], SAMPLES = [], PYLONS = [];
const PYLON_DEF = { r0: 2.4, r1: 0.8, above: 4, gap: 1.2 };
const RULES_DEF = { pylonHit: 3, notLevel: 2, missed: 5, missR: 70, levelTol: 15 };
let PYLON = PYLON_DEF, RULES = RULES_DEF;
let TER = null, TH = null, TDIST = null, TNEAR = null, noiseA = null, noiseB = null, noiseC = null;
const TREES = { x: [], y: [], z: [], h: [], r: [] };
const TREE_GRID = new Map(), TREE_CELL = 40;
const treeKey = (ix, iz) => (ix + 1000) * 4096 + (iz + 1000);

const RELIEF = { base: 62, amp: 300, pow: 1.35, freq: 0.0021, ridgeAmp: 55, ridgeFreq: 0.0045 };
let REL = RELIEF;
function baseHeight(x, z) {
  const n = fbm(noiseA, x * REL.freq + 11.3, z * REL.freq - 4.7, 5);
  const r = 1 - Math.abs(2 * fbm(noiseB, x * REL.ridgeFreq, z * REL.ridgeFreq, 3) - 1);
  let h = REL.base + Math.pow(n, REL.pow) * REL.amp + r * REL.ridgeAmp;
  const L = COURSE.lake;
  if (L) { const dx = x - L.x, dz = z - L.z; h -= L.depth * smoothstep(L.r, L.r * 0.35, Math.sqrt(dx * dx + dz * dz)); }
  for (const hl of COURSE.hills || []) {
    const dx = x - hl.x, dz = z - hl.z;
    h += hl.h * Math.exp(-(dx * dx + dz * dz) / (hl.r * hl.r));
  }
  return h;
}

function buildWorld(course) {
  COURSE = course; COURSE_DEF = course.points;
  REL = Object.assign({}, RELIEF, course.relief);
  noiseA = makeNoise(course.seeds.a); noiseB = makeNoise(course.seeds.b); noiseC = makeNoise(course.seeds.c);

  // path, hoops, dense samples with interpolated valley shape
  curve = new THREE.CatmullRomCurve3(COURSE_DEF.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  curve.arcLengthDivisions = 2000;
  COURSE_LEN = curve.getLength();
  PYLON = Object.assign({}, PYLON_DEF, course.pylon);
  RULES = Object.assign({}, RULES_DEF, course.rules);
  HOOPS = [];
  for (let i = 1; i < COURSE_DEF.length - 1; i++) {
    const g = COURSE_DEF[i][6];
    if (g === 0) continue;                                   // waypoint: shapes the line and the carving, no gate
    HOOPS.push({ pos: new THREE.Vector3(COURSE_DEF[i][0], COURSE_DEF[i][1], COURSE_DEF[i][2]),
                 normal: curve.getTangent(i / (COURSE_DEF.length - 1)).normalize(),
                 kind: typeof g === 'string' ? g : 'hoop', pylons: [] });
  }
  SAMPLES = [];
  const NS = 900, nseg = COURSE_DEF.length - 1, p = new THREE.Vector3();
  for (let i = 0; i <= NS; i++) {
    const u = curve.getUtoTmapping(i / NS);
    curve.getPoint(u, p);
    const seg = Math.min(u * nseg, nseg - 1e-6), i0 = Math.floor(seg), fr = seg - i0;
    const a = COURSE_DEF[i0], b = COURSE_DEF[i0 + 1];
    SAMPLES.push({ x: p.x, y: p.y, z: p.z, clr: lerp(a[3], b[3], fr), width: lerp(a[4], b[4], fr), steep: lerp(a[5], b[5], fr) });
  }
  for (const h of HOOPS) {                                   // nearest sample to each hoop, for the autopilot
    let bd = Infinity;
    SAMPLES.forEach((sp, k) => { const d = h.pos.distanceToSquared(p.set(sp.x, sp.y, sp.z)); if (d < bd) { bd = d; h.sample = k; } });
  }

  // terrain heights: hills, carved into a valley along the path, falling away at the edges
  const t = course.terrain;
  TER = { N: t.n, SIZE: t.size, CX: t.cx, CZ: t.cz, WATER: t.water, EDGE: t.edge };
  TER.CELL = TER.SIZE / TER.N; TER.X0 = TER.CX - TER.SIZE / 2; TER.Z0 = TER.CZ - TER.SIZE / 2;
  const N = TER.N, W = N + 1, cell = TER.CELL, R = t.carveR || 440, rc = Math.ceil(R / cell);
  TH = new Float32Array(W * W); TDIST = new Float32Array(W * W).fill(1e9); TNEAR = new Int32Array(W * W).fill(-1);
  const d2 = new Float32Array(W * W).fill(1e18);
  for (let s = 0; s < SAMPLES.length; s++) {
    const sp = SAMPLES[s], gi = Math.round((sp.x - TER.X0) / cell), gj = Math.round((sp.z - TER.Z0) / cell);
    for (let j = Math.max(0, gj - rc); j <= Math.min(N, gj + rc); j++) {
      const dz = TER.Z0 + j * cell - sp.z;
      for (let i = Math.max(0, gi - rc); i <= Math.min(N, gi + rc); i++) {
        const dx = TER.X0 + i * cell - sp.x, dd = dx * dx + dz * dz, k = j * W + i;
        if (dd < d2[k]) { d2[k] = dd; TNEAR[k] = s; }
      }
    }
  }
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * W + i, x = TER.X0 + i * cell, z = TER.Z0 + j * cell;
      let h = baseHeight(x, z);
      if (TNEAR[k] >= 0) {
        const sp = SAMPLES[TNEAR[k]], d = Math.sqrt(d2[k]);
        TDIST[k] = d;
        h = Math.min(h, sp.y - sp.clr + sp.steep * Math.pow(Math.max(0, d - sp.width), 1.5));
      }
      h += (noiseC(x * 0.03, z * 0.03) - 0.5) * 5;                     // micro relief
      const e = Math.max(Math.abs(x - TER.CX), Math.abs(z - TER.CZ)) / (TER.SIZE / 2);
      TH[k] = lerp(h, TER.EDGE, smoothstep(0.8, 0.98, e));
    }
  }

  // pylons: beside each pylon gate's circle, standing on the ground or the water
  PYLONS = [];
  HOOPS.forEach((h, gi) => {
    const sides = h.kind === 'L' ? [-1] : h.kind === 'R' ? [1] : h.kind === 'G' ? [-1, 1] : [];
    if (!sides.length) return;
    const right = new THREE.Vector3().crossVectors(h.normal, WORLD_UP).setY(0).normalize();
    for (const s of sides) {
      // axis far enough out that the pylon's surface at circle height clears the circle by `gap`
      let d = TUNE.HOOP_R + PYLON.gap + PYLON.r0, x = 0, z = 0, y0 = 0;
      const y1 = h.pos.y + TUNE.HOOP_R + PYLON.above;
      for (let it = 0; it < 3; it++) {
        x = h.pos.x + right.x * s * d; z = h.pos.z + right.z * s * d; y0 = groundAt(x, z) - 0.5;
        d = TUNE.HOOP_R + PYLON.gap + lerp(PYLON.r0, PYLON.r1, clamp((h.pos.y - y0) / (y1 - y0), 0, 1));
      }
      h.pylons.push(PYLONS.length);
      PYLONS.push({ x, z, y0, y1, r0: PYLON.r0, r1: PYLON.r1, gate: gi, side: s, hit: false });
    }
  });

  // trees: flanking the path, plus clumps where the forest mask says so
  for (const key in TREES) TREES[key].length = 0;
  TREE_GRID.clear();
  const rand = mulberry32(course.seeds.trees), treeTop = course.trees.maxAlt == null ? 250 : course.trees.maxAlt;
  const forest = (x, z) => noiseB(x * 0.006 + 40, z * 0.006 - 13);    // same mask the terrain colouring uses
  const add = (x, z, scattered) => {
    if (scattered && forest(x, z) < 0.52 && rand() < 0.85) return;
    const y = heightAt(x, z);
    if (y < TER.WATER + 1.5 || y > treeTop) return;
    const e = 6, gx = heightAt(x + e, z) - heightAt(x - e, z), gz = heightAt(x, z + e) - heightAt(x, z - e);
    if (Math.hypot(gx, gz) / (2 * e) > 0.9) return;
    const cd = courseDistAt(x, z);
    if (cd.s && cd.d < cd.s.width + 12) return;
    const h = 9 + rand() * 8, r = h * (0.26 + rand() * 0.08), idx = TREES.x.length;
    TREES.x.push(x); TREES.y.push(y - 0.8); TREES.z.push(z); TREES.h.push(h); TREES.r.push(r);
    const key = treeKey(Math.floor(x / TREE_CELL), Math.floor(z / TREE_CELL));
    if (!TREE_GRID.has(key)) TREE_GRID.set(key, []);
    TREE_GRID.get(key).push(idx);
  };
  const tan = new THREE.Vector3();
  for (let n = 0; n < course.trees.near; n++) {
    const u = rand(), sp = SAMPLES[Math.floor(u * (SAMPLES.length - 1))];
    curve.getTangentAt(u, tan);
    const side = rand() < 0.5 ? -1 : 1, lat = sp.width + 14 + Math.pow(rand(), 1.6) * 200, along = (rand() - 0.5) * 40;
    const nx = -tan.z, nz = tan.x, nl = Math.hypot(nx, nz) || 1;
    add(sp.x + (nx / nl) * lat * side + tan.x * along, sp.z + (nz / nl) * lat * side + tan.z * along);
  }
  for (let n = 0; n < course.trees.scattered; n++) add(TER.X0 + 200 + rand() * (TER.SIZE - 400), TER.Z0 + 200 + rand() * (TER.SIZE - 400), true);
}

// exact height of the rendered triangle mesh (cells split along the 00-11 diagonal)
function heightAt(x, z) {
  const gx = (x - TER.X0) / TER.CELL, gz = (z - TER.Z0) / TER.CELL;
  if (gx < 0 || gz < 0 || gx >= TER.N || gz >= TER.N) return TER.EDGE;
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, W = TER.N + 1;
  const h00 = TH[j * W + i], h10 = TH[j * W + i + 1], h01 = TH[(j + 1) * W + i], h11 = TH[(j + 1) * W + i + 1];
  return fz > fx ? h00 + (h11 - h01) * fx + (h01 - h00) * fz
                 : h00 + (h10 - h00) * fx + (h11 - h10) * fz;
}
const groundAt = (x, z) => Math.max(heightAt(x, z), TER.WATER);
function courseDistAt(x, z) {
  const i = clamp(Math.round((x - TER.X0) / TER.CELL), 0, TER.N), j = clamp(Math.round((z - TER.Z0) / TER.CELL), 0, TER.N);
  const k = j * (TER.N + 1) + i;
  return { d: TDIST[k], s: TNEAR[k] >= 0 ? SAMPLES[TNEAR[k]] : null };
}
function treeHit(p) {
  const ix = Math.floor(p.x / TREE_CELL), iz = Math.floor(p.z / TREE_CELL);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const list = TREE_GRID.get(treeKey(ix + dx, iz + dz));
    if (!list) continue;
    for (const i of list) {
      const yy = p.y - TREES.y[i];
      if (yy < -2 || yy > TREES.h[i]) continue;
      const rr = TREES.r[i] * (1 - yy / TREES.h[i]) + 0.8, ddx = p.x - TREES.x[i], ddz = p.z - TREES.z[i];
      if (ddx * ddx + ddz * ddz < rr * rr) return true;
    }
  }
  return false;
}

/* ---------- plane state & flight model ---------- */
function makePlane() {
  return { pos: new THREE.Vector3(), q: new THREE.Quaternion(), vdir: new THREE.Vector3(0, 0, -1),
           speed: TUNE.CRUISE, rp: 0, ry: 0, rr: 0, bank: 0, turn: 0, boosting: false, boost: 1, boostLock: false, gload: 1 };
}
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _lr = new THREE.Vector3(), _lu = new THREE.Vector3();
const _w = new THREE.Vector3(), _ax = new THREE.Vector3(), _l = new THREE.Vector3(), _vel = new THREE.Vector3();
const _dq = new THREE.Quaternion(), _qi = new THREE.Quaternion();

function placePlane(P, pos, dir, speed) {
  P.pos.copy(pos); P.vdir.copy(dir).normalize();
  // Matrix4.lookAt points local -Z at the target: nose along dir, wings level
  P.q.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), P.vdir, WORLD_UP));
  P.speed = speed; P.rp = P.ry = P.rr = 0; P.bank = 0; P.turn = 0; P.gload = 1; P.apAround = false;
}

function forwardOf(P, out) { return out.set(0, 0, -1).applyQuaternion(P.q); }

// bank angle relative to the horizon; + = right wing down
function computeBank(P, f) {
  const horiz = Math.hypot(f.x, f.z);
  if (horiz < 0.03) return { bank: 0, horiz };
  const up = _u.set(0, 1, 0).applyQuaternion(P.q);
  _lr.set(-f.z, 0, f.x).normalize();
  _lu.crossVectors(_lr, f);
  return { bank: Math.atan2(up.dot(_lr), up.dot(_lu)), horiz };
}

const _R = new THREE.Vector3(), _U = new THREE.Vector3(), _B = new THREE.Vector3();
// tan-shaped like a real coordinated turn (gentle at small bank, strong past ~45°), capped so knife-edge
// doesn't explode, fading to zero when inverted
const turnCurve = (bank) => Math.sin(bank) / Math.max(Math.cos(bank), TUNE.TURN_COS_MIN);
// current heading rate of the nose (+ = turning left), from the smoothed body rates plus bank-to-turn
function headingRate(P, bank, horiz, auth) {
  _R.set(1, 0, 0).applyQuaternion(P.q); _U.set(0, 1, 0).applyQuaternion(P.q); _B.set(0, 0, 1).applyQuaternion(P.q);
  return _R.y * P.rp - _U.y * P.ry - _B.y * P.rr - TUNE.TURN_ASSIST * turnCurve(bank) * horiz * auth;
}
// heading-hold steering: bank toward the aim's heading (with lead so it rolls out before arriving),
// and pull/yaw toward it in the plane's own frame
function assist(P, f, bank, horiz, aim, auth) {
  const he = wrapAngle(Math.atan2(-aim.x, -aim.z) - Math.atan2(-f.x, -f.z));   // + = aim to the left
  const w = smoothstep(0.08, 0.35, Math.min(horiz, Math.hypot(aim.x, aim.z)));
  const heLead = he - TUNE.ASSIST_LEAD * headingRate(P, bank, horiz, auth);
  const bankT = clamp(-heLead * TUNE.BANK_GAIN, -TUNE.MAX_BANK, TUNE.MAX_BANK) * w;
  _l.copy(aim).applyQuaternion(_qi.copy(P.q).invert());
  const fwd = Math.max(-_l.z, 0.15);
  return {
    p: clamp(Math.atan2(_l.y, fwd) * TUNE.PITCH_P, -1, 1),
    y: clamp(Math.atan2(_l.x, fwd) * TUNE.YAW_P, -1, 1),
    r: clamp(wrapAngle(bankT - bank) * TUNE.ROLL_P, -1, 1),
  };
}

// attitude steering: ease to a target bank and a target climb angle (world frame). Nothing to "return to",
// so letting go just rolls the wings level and flattens the climb, keeping whatever heading results.
function attitude(P, f, bank, bankT, climbT) {
  const r = clamp(wrapAngle(bankT - bank) * TUNE.ATT_ROLL_P, -1, 1);
  const w = clamp((climbT - Math.asin(clamp(f.y, -1, 1))) * TUNE.ATT_PITCH_P, -TUNE.ATT_PITCH_MAX, TUNE.ATT_PITCH_MAX);
  _lr.set(-f.z, 0, f.x);
  const L = _lr.length();
  if (L < 1e-4) return { p: w / TUNE.MAX_PITCH, y: 0, r };
  _lr.divideScalar(L);
  _R.set(1, 0, 0).applyQuaternion(P.q); _U.set(0, 1, 0).applyQuaternion(P.q);
  // rotate the nose about the level-right axis: split between body pitch and body yaw by bank
  return { p: clamp(w * _lr.dot(_R) / TUNE.MAX_PITCH, -1, 1), y: clamp(-w * _lr.dot(_U) / TUNE.MAX_YAW, -1, 1), r };
}

// touch climb target: normal range ±TOUCH_CLIMB; holding the end of the throw adds up to TOUCH_CLIMB_EXTRA
// with an ease-in, so a brief accidental full pull barely changes anything but a deliberate hold goes steeper
function touchClimb(st, y, dt) {
  const s = Math.sign(y);
  if (Math.abs(y) > TUNE.OD_THRESH) {
    if (s !== st.odSign) { st.od = 0; st.odSign = s; }
    st.od = Math.min(1, st.od + dt / TUNE.OD_TIME);
  } else st.od = Math.max(0, st.od - dt * TUNE.OD_DECAY);
  return y * TUNE.TOUCH_CLIMB + st.odSign * st.od * st.od * TUNE.TOUCH_CLIMB_EXTRA;
}

// ctl: { att: {bank, climb}|null, aim: Vector3|null, p, r, y (manual, -1..1), boost: bool }
function stepFlight(P, ctl, dt) {
  const f = forwardOf(P, _f);
  const { bank, horiz } = computeBank(P, f);
  P.bank = bank;
  const auth = clamp(P.speed / TUNE.CRUISE, 0.3, 1.15);
  const c = ctl.att ? attitude(P, f, bank, ctl.att.bank, ctl.att.climb) : ctl.aim ? assist(P, f, bank, horiz, ctl.aim, auth) : ctl;
  const k = damp(TUNE.RATE_K, dt);
  P.rp += (c.p * TUNE.MAX_PITCH * auth - P.rp) * k;
  P.rr += (c.r * TUNE.MAX_ROLL * auth - P.rr) * k;
  P.ry += (c.y * TUNE.MAX_YAW * auth - P.ry) * k;

  _w.set(P.rp, -P.ry, -P.rr);                               // local angular velocity
  const wl = _w.length();
  if (wl > 1e-7) { _dq.setFromAxisAngle(_w.multiplyScalar(1 / wl), wl * dt); P.q.multiply(_dq); }

  const turn = -TUNE.TURN_ASSIST * turnCurve(bank) * horiz * auth;  // bank-to-turn
  P.turn = turn;
  if (turn !== 0) { _dq.setFromAxisAngle(WORLD_UP, turn * dt); P.q.premultiply(_dq); }

  const sink = clamp((TUNE.STALL * 1.3 - P.speed) / (TUNE.STALL * 0.6), 0, 1);
  forwardOf(P, f);
  const dfv = clamp(f.dot(P.vdir), -1, 1);                  // weathervane: nose toward flight path
  if (dfv < 0.999999) {
    _ax.crossVectors(f, P.vdir);
    const al = _ax.length();
    if (al > 1e-7) { _dq.setFromAxisAngle(_ax.divideScalar(al), Math.acos(dfv) * damp(TUNE.WEATHERVANE + 2 * sink, dt)); P.q.premultiply(_dq); }
  }
  P.q.normalize();

  // boost energy
  const wantBoost = ctl.boost && !P.boostLock && P.boost > 0;
  P.boosting = wantBoost;
  if (wantBoost) { P.boost = Math.max(0, P.boost - TUNE.BOOST_DRAIN * dt); if (P.boost === 0) P.boostLock = true; }
  else { P.boost = Math.min(1, P.boost + TUNE.BOOST_REGEN * dt); if (P.boostLock && P.boost > 0.2) P.boostLock = false; }

  // energy: throttle toward target, gravity along the path, induced drag from pulling
  forwardOf(P, f);
  const target = P.boosting ? TUNE.BOOST : TUNE.CRUISE;
  const pull = Math.abs(P.rp) + Math.abs(P.turn);            // hard turns cost energy whichever way they're made
  const dv = TUNE.THROTTLE_K * (target - P.speed) - TUNE.G * TUNE.G_SCALE * P.vdir.y - TUNE.INDUCED * pull * (P.speed / TUNE.CRUISE);
  P.speed = Math.max(TUNE.MIN_SPEED, P.speed + dv * dt);

  const grip = TUNE.GRIP * clamp((P.speed - 8) / (TUNE.CRUISE - 8), 0.12, 1.25);
  P.vdir.lerp(f, damp(grip, dt));
  const vl = P.vdir.length();
  if (vl < 1e-6) P.vdir.copy(f); else P.vdir.divideScalar(vl);
  if (sink > 0) {
    _vel.copy(P.vdir).multiplyScalar(P.speed);
    _vel.y -= TUNE.G * sink * dt;
    P.speed = _vel.length(); P.vdir.copy(_vel).divideScalar(P.speed);
  }
  P.gload = lerp(P.gload, 1 + pull * P.speed / TUNE.G, damp(6, dt));
  P.pos.addScaledVector(P.vdir, P.speed * dt);
}

/* ---------- aim helpers ---------- */
function dirFromYawPitch(yaw, pitch, out) {     // yaw + = left of -Z
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}
function yawOf(d) { return Math.atan2(-d.x, -d.z); }
function pitchOf(d) { return Math.asin(clamp(d.y, -1, 1)); }

// autopilot used by the attract mode: pure pursuit along the course line (which runs through every hoop centre and
// is what the valley carving keeps clear), aiming AP_LEAD s of cruise ahead of the nearest point on the leg to the next
// hoop, but never past that hoop
function autopilotAim(P, hoopIdx, out) {
  const i = Math.min(hoopIdx, HOOPS.length - 1), v = TUNE.CRUISE, h = HOOPS[i];
  const k0 = i > 0 ? HOOPS[i - 1].sample : 0, k1 = h.sample;
  // missed approach: once the hoop is about to go by off-centre, fly out along the line behind it and come round again
  const along = _ax.copy(P.pos).sub(h.pos).dot(h.normal), lat = Math.sqrt(Math.max(0, P.pos.distanceToSquared(h.pos) - along * along));
  if (along > -v * 0.25 && along < v * 3 && lat > TUNE.HOOP_R + TUNE.HOOP_TOL) P.apAround = true;
  else if (along < -v * 2.5) P.apAround = false;
  if (P.apAround) {
    const b = SAMPLES[Math.max(k0, k1 - Math.round(v * 4 / (COURSE_LEN / (SAMPLES.length - 1))))];
    out.set(b.x - P.pos.x, b.y - P.pos.y, b.z - P.pos.z).normalize();
    return avoidGround(P, out, v);
  }
  let best = k0, bd = Infinity;
  for (let k = k0; k <= k1; k++) {
    const s = SAMPLES[k], dx = s.x - P.pos.x, dy = s.y - P.pos.y, dz = s.z - P.pos.z, d = dx * dx + dy * dy + dz * dz;
    if (d < bd) { bd = d; best = k; }
  }
  const step = COURSE_LEN / (SAMPLES.length - 1);
  // the aim point stops at the hoop, so the last stretch homes in on its centre instead of cutting the corner
  const t = SAMPLES[Math.min(k1, best + Math.max(1, Math.round(v * TUNE.AP_LEAD / step)))];
  out.set(t.x - P.pos.x, t.y - P.pos.y, t.z - P.pos.z).normalize();
  return avoidGround(P, out, v);
}
function avoidGround(P, out, v) {                          // don't aim into the ground (2 s look-ahead)
  const ahead = _l.copy(P.pos).addScaledVector(P.vdir, v * 2.05), need = TUNE.AP_CLEAR || v * 0.57;
  const clearance = ahead.y - groundAt(ahead.x, ahead.z);
  if (clearance < need) out.y = Math.max(out.y, 0.25 * (1 - clearance / need));
  return out.normalize();
}

// segment a->b crossing gate i's plane in the course direction: 'pass' inside its circle; for pylon gates, 'miss'
// when outside it (wrong side of the pylon, too wide, too high) but within RULES.missR of the centre; else null
function gateCross(a, b, i) {
  const h = HOOPS[i];
  const d0 = _ax.copy(a).sub(h.pos).dot(h.normal), d1 = _l.copy(b).sub(h.pos).dot(h.normal);
  if (!(d0 < 0 && d1 >= 0)) return null;
  const t = d0 / (d0 - d1);
  const hx = a.x + (b.x - a.x) * t - h.pos.x, hy = a.y + (b.y - a.y) * t - h.pos.y, hz = a.z + (b.z - a.z) * t - h.pos.z;
  const r2 = hx * hx + hy * hy + hz * hz;
  if (r2 < (TUNE.HOOP_R + TUNE.HOOP_TOL) ** 2) return 'pass';
  return h.kind !== 'hoop' && r2 < RULES.missR * RULES.missR ? 'miss' : null;
}
const passedHoop = (a, b, i) => gateCross(a, b, i) === 'pass';
// first standing pylon touched by the plane (tested at five points along the wing), or -1
function pylonHit(P) {
  _R.set(1, 0, 0).applyQuaternion(P.q);
  const W = TUNE.WING_HALF;
  for (let k = 0; k < PYLONS.length; k++) {
    const py = PYLONS[k];
    if (py.hit) continue;
    const dx0 = P.pos.x - py.x, dz0 = P.pos.z - py.z, reach = W + py.r0 + 1;
    if (dx0 * dx0 + dz0 * dz0 > reach * reach) continue;
    for (let s = -2; s <= 2; s++) {
      const e = W * s / 2, x = P.pos.x + _R.x * e, y = P.pos.y + _R.y * e, z = P.pos.z + _R.z * e;
      if (y < py.y0 || y > py.y1) continue;
      const r = lerp(py.r0, py.r1, (y - py.y0) / (py.y1 - py.y0)) + 0.25, dx = x - py.x, dz = z - py.z;
      if (dx * dx + dz * dz < r * r) return k;
    }
  }
  return -1;
}
function crashed(P) {
  if (P.pos.y - TUNE.PLANE_R < groundAt(P.pos.x, P.pos.z)) return 'ground';
  if (treeHit(P.pos)) return 'tree';
  return null;
}
