'use strict';
/* =========================================================================
   WINDMILLS — old smock mills with four lattice sails turning, and the gate that rides between two of them.
   Gate (course point's 7th value, GATE_TYPES in js/sim.js): "mill". The point is the sails' hub; the mill stands
   behind it along the line, its sails facing you as you come, turning anticlockwise as you see them. The hoop rides in
   the gap between two sails, `orbit` m from the hub, so it circles with them: fly through it wherever it has got to.
   The tower is under the hub, so while the hoop is low in front of it the way through ends in the wall: wait for it
   to come round. Options { sail, orbit, rpm, phase }: sail length and the hoop's distance from the hub (m, defaults
   MILL), turns a minute, and where the hoop starts (degrees clockwise from straight up, as you see it). The sails
   turn on the run's own clock (millTick, from the start of the run), so every run meets them the same way.
   Everything is a crash ('mill'): the tower and its stage, the cap and the turning sails, by the wingtips too.
   Sim part (no DOM): MILLS (per gate: hub, frame, tower), millTick(dt), millReset(), millHoop(m, t) -> { u, v } the
   hoop's centre in the sail plane (u right, v up from the hub) at run time t, GATE_TYPES.mill (its aim(h, P, out)
   steers the autopilot for where the hoop will be).
   Game part: createMillKit({ hoopMat }) (GATE_KITS): the mills, the sails turning and the hoop riding in them.
   ========================================================================= */
const MILL = { sail: 31, orbit: 21, rpm: 3, width: 3.2, shaft: 8, base: 6.2, neck: 4 };
const MILL_STAGE = 1.3;                                      // the gallery's reach out from the smock (m): it stays behind the sails
const MILL_STOCK = 0.35;                                     // half-width of a sail's stock (m); the lattice is on its trailing side
const MILL_CAP = 3;                                          // cap's base below the hub (m)
const MILLS = [];
let MILL_T = 0;                                              // the run's clock for the sails (s)
function millTick(dt) { MILL_T += dt; }
function millReset() { MILL_T = 0; }
const millOpts = (h) => Object.assign({}, MILL, h.opts || {});
// the hoop's angle in the gap: as far from the trailing lattice of the sail ahead of it as from the bare stock behind
function millGap(o) {
  const w = MILL_STOCK + o.width, s = MILL_STOCK;
  let lo = 0, hi = Math.PI / 2;
  for (let k = 0; k < 40; k++) { const b = (lo + hi) / 2; if (o.orbit * Math.sin(b) - w < o.orbit * Math.cos(b) - s) lo = b; else hi = b; }
  return (lo + hi) / 2;
}
// angle (clockwise from up, as you see the sails) of sail k at run time t; the hoop sits `gap` past sail 0
const millAngle = (m, t, k = 0) => m.a0 - m.w * t + k * Math.PI / 2;
function millHoop(m, t) { const a = millAngle(m, t) + m.gap; return { u: m.orbit * Math.sin(a), v: m.orbit * Math.cos(a) }; }

function buildMills() {
  MILLS.length = 0;
  HOOPS.forEach((h, i) => {
    if (h.kind !== 'mill') return;
    const o = millOpts(h), L = Math.hypot(h.normal.x, h.normal.z) || 1, fx = h.normal.x / L, fz = h.normal.z / L;
    const tx = h.pos.x + fx * o.shaft, tz = h.pos.z + fz * o.shaft, foot = groundAt(tx, tz) - 0.4;
    const m = { i, h, hub: h.pos, fx, fz, rx: -fz, rz: fx, tx, tz, foot, cap: h.pos.y - MILL_CAP, sail: o.sail, orbit: o.orbit,
                width: o.width, shaft: o.shaft, base: o.base, neck: o.neck, w: o.rpm / 60 * TAU, a0: (o.phase || 0) * Math.PI / 180,
                gap: millGap(o) };
    m.stage = m.foot + (m.cap - m.foot) * 0.34;               // the gallery round the tower
    h.mill = m;
    MILLS.push(m);
    // the yard round it stays free of the game's trees (a box far underground: never hit)
    shoreBox('yard', tx, tz, fx, fz, 26, 26, -1e6 - 1, -1e6);
  });
}
const millR = (m, y) => lerp(m.base, m.neck, clamp((y - m.foot) / (m.cap - m.foot), 0, 1));   // tower radius at height y

// is point (x, y, z) inside any part of mill m at run time t (pad m of reach)?
function millPartHit(m, x, y, z, t, pad) {
  const dx = x - m.hub.x, dz = z - m.hub.z, d = dx * m.fx + dz * m.fz, u = dx * m.rx + dz * m.rz, v = y - m.hub.y;
  if (d < -2 || d > m.shaft + m.base + 4) return false;
  // tower and stage
  const ex = x - m.tx, ez = z - m.tz, rr = ex * ex + ez * ez;
  if (y < m.cap + 0.2 && y > m.foot - 1) { const r = millR(m, y) + pad; if (rr < r * r) return true; }
  if (Math.abs(y - m.stage) < 0.7 + pad) { const r = millR(m, m.stage) + MILL_STAGE + pad; if (rr < r * r) return true; }
  // cap (a dome over the top) and the windshaft to the hub
  if (y >= m.cap && y < m.cap + 6 + pad) { const r = (m.neck + 0.6) * Math.sqrt(Math.max(0, 1 - ((y - m.cap) / 6.2) ** 2)) + pad; if (rr < r * r) return true; }
  if (d > -1.8 && d < m.shaft && u * u + v * v < (1.4 + pad) ** 2) return true;
  // the sails: in their plane, each a stock with its lattice on the trailing side
  if (Math.abs(d) > 0.5 + pad) return false;
  const r2 = u * u + v * v;
  if (r2 > (m.sail + pad + 0.5) ** 2) return false;
  for (let k = 0; k < 4; k++) {
    const a = millAngle(m, t, k), s = Math.sin(a), c = Math.cos(a);
    const al = u * s + v * c, ac = u * c - v * s;            // along the stock, across it (+ toward its trailing side)
    if (al > -1 && al < m.sail + pad && ac > -MILL_STOCK - pad && ac < MILL_STOCK + m.width + pad) return true;
  }
  return false;
}
const _mlR = new THREE.Vector3();
function millHit(P) {
  if (!MILLS.length) return null;
  _mlR.set(1, 0, 0).applyQuaternion(P.q);
  const W = TUNE.WING_HALF;
  for (const m of MILLS) {
    const dx = P.pos.x - m.tx, dz = P.pos.z - m.tz;
    if (dx * dx + dz * dz > (m.sail + m.shaft + W + 4) ** 2) continue;
    for (let s = -1; s <= 1; s++)                             // the centre and both wingtips
      if (millPartHit(m, P.pos.x + _mlR.x * W * s, P.pos.y + _mlR.y * W * s, P.pos.z + _mlR.z * W * s, MILL_T, s ? 0.25 : 0.7)) return 'mill';
  }
  return null;
}
CRASH_PLUGINS.push(millHit);
var CRASH_TEXT = CRASH_TEXT || {};
CRASH_TEXT.mill = 'Hit a windmill';

GATE_TYPES.mill = {
  // scored on the hoop's circle wherever it has got to (u, v: the crossing point from the hub, in the sail plane)
  shape(h, u, v) { const c = millHoop(h.mill, MILL_T); return (u - c.u) ** 2 + (v - c.v) ** 2 < (TUNE.HOOP_R + TUNE.HOOP_TOL) ** 2; },
  disc: () => 0,                                             // the hoop moves; a disc at the hub would point at the wall
  top: (h) => h.mill.sail + 2,
  // autopilot: from the approach, aim where the hoop will be on arrival (null once past the sails: the line again)
  aim(h, P, out) {
    const m = h.mill, along = (P.pos.x - m.hub.x) * m.fx + (P.pos.z - m.hub.z) * m.fz;
    if (along > 0.5 || along < -P.speed * 9) return null;
    const c = millHoop(m, MILL_T + Math.max(0, -along) / Math.max(P.speed, 1));
    out.set(m.hub.x + m.rx * c.u - P.pos.x, m.hub.y + c.v - P.pos.y, m.hub.z + m.rz * c.u - P.pos.z);
    return out.normalize();
  },
};

/* ---------- game part: the mills, the sails and the hoop riding in them ---------- */
function createMillKit(ctx) {
  const M = ctx.hoopMat;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.shared = true;
  const Mx = createMesher(), { BOX, CYL } = Mx.G;
  const C = (h) => new THREE.Color(h);
  const BRICK = C('#9c5a43'), BODY = C('#4d4a45'), TRIM = C('#ece6d6'), CAP = C('#5f6e5a'), WOOD = C('#6b4a30');
  const DOOR = C('#3a5a3e'), WIN = C('#27313a'), LATTICE = C('#e9e1cc');
  const OCT = Mx.flat(new THREE.CylinderGeometry(1, 1, 1, 8, 1).translate(0, 0.5, 0));
  const DOME = Mx.flat(new THREE.SphereGeometry(1, 10, 5, 0, TAU, 0, Math.PI / 2));
  let items = [];
  // one set of sails: four stocks with their lattices, in x-y (x right, y up as you see them from the front, +z toward
  // you), sail k at angle a0 + k·90° clockwise from up. A sail's own frame: along = +y, trailing side = +x.
  function sailGeometry(m) {
    const pos = [], col = [], mtx = new THREE.Matrix4(), unit = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().attributes.position, v = new THREE.Vector3();
    const put = (cx, cy, cz, w, h, d, rz, c) => {             // a box w x h x d, centred at (cx, cy, cz), turned rz about z
      mtx.makeRotationZ(rz).scale(v.set(w, h, d)).setPosition(cx, cy, cz);
      for (let i = 0; i < unit.count; i++) { v.fromBufferAttribute(unit, i).applyMatrix4(mtx); pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); }
    };
    const L = m.sail, W = m.width;
    for (let k = 0; k < 4; k++) {
      const a = m.a0 + k * Math.PI / 2, s = Math.sin(a), c = Math.cos(a);
      const P = (x, y) => [x * c + y * s, -x * s + y * c];
      // a bar from (x0, y0) to (x1, y1) in the sail's frame, hw wide, ht thick, its face z forward
      const bar = (x0, y0, x1, y1, hw, ht, z, col) => {
        const p0 = P(x0, y0), p1 = P(x1, y1), dx = p1[0] - p0[0], dy = p1[1] - p0[1];
        put((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, z, hw * 2, Math.hypot(dx, dy), ht * 2, Math.atan2(-dx, dy), col);
      };
      bar(0, 0.6, 0, L + 0.4, MILL_STOCK, 0.45, 0.1, WOOD);                                      // stock
      for (const xo of [MILL_STOCK + 0.1, MILL_STOCK + W]) bar(xo, 4, xo, L, 0.1, 0.14, 0.3, LATTICE);   // hemlaths
      for (let y = 4; y <= L + 0.01; y += 1.6) bar(MILL_STOCK, y, MILL_STOCK + W, y, 0.08, 0.1, 0.3, LATTICE);   // sail bars
      bar(-MILL_STOCK - 0.25, 5, -MILL_STOCK - 0.25, L, 0.22, 0.06, 0.2, LATTICE);                  // leading board
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  function bodyGeometry() {
    Mx.reset();
    for (const m of MILLS) {
      const H = m.cap - m.foot, brick = Math.min(6, H * 0.18);
      Mx.frame(m.tx, 0, m.tz, m.fx, m.fz);
      const r0 = m.base, rb = millR(m, m.foot + brick);
      Mx.part(OCT, BRICK, 0, m.foot - 1.5, 0, r0 + 0.5, brick + 1.5, r0 + 0.5, Math.PI / 8);     // brick base
      // the smock: a tapering octagon up to the cap
      Mx.part(Mx.flat(new THREE.CylinderGeometry(m.neck, rb, H - brick, 8, 1).translate(0, (H - brick) / 2, 0)), BODY, 0, m.foot + brick, 0, 1, 1, 1, Math.PI / 8);
      const rs = millR(m, m.stage);
      Mx.part(OCT, TRIM, 0, m.stage - 0.35, 0, rs + MILL_STAGE, 0.35, rs + MILL_STAGE, Math.PI / 8);   // stage
      for (let k = 0; k < 8; k++) {                                                                // its rail posts
        const a = k * TAU / 8 + Math.PI / 8;
        Mx.part(BOX, TRIM, Math.sin(a) * (rs + MILL_STAGE - 0.2), m.stage, Math.cos(a) * (rs + MILL_STAGE - 0.2), 0.14, 1.1, 0.14);
      }
      Mx.part(OCT, TRIM, 0, m.cap - 0.4, 0, m.neck + 0.7, 0.45, m.neck + 0.7, Math.PI / 8);      // curb under the cap
      Mx.part(DOME, CAP, 0, m.cap, 0, m.neck + 0.6, 6, m.neck + 0.6);                              // cap
      Mx.part(CYL, WOOD, 0, m.hub.y, 0, 0.9, m.shaft - 0.6, 0.9, 0, Math.PI / 2);          // windshaft, out to the sails
      // fantail at the back of the cap, on two braces
      Mx.part(BOX, WOOD, 0, m.cap + 1.2, -(m.neck + 2.4), 0.3, 0.3, 3.4);
      Mx.part(BOX, TRIM, 0, m.cap + 1.4, -(m.neck + 4.2), 3.6, 0.2, 0.25);
      Mx.part(BOX, TRIM, 0, m.cap - 0.4, -(m.neck + 4.2), 0.2, 3.6, 0.25);
      // door at the foot facing the line, windows up the smock
      Mx.part(BOX, DOOR, 0, m.foot + 0.2, r0 + 0.35, 2.2, 3.4, 0.3);
      for (const [f, a] of [[0.45, 0], [0.62, Math.PI * 0.75], [0.8, -Math.PI * 0.6]]) {
        const y = m.foot + H * f, r = millR(m, y) + 0.05;
        Mx.part(BOX, WIN, -Math.sin(a) * r, y, -Math.cos(a) * r, 1.1, 1.5, 0.2, a);
      }
    }
    return Mx.mesh(mat);
  }
  const hoopGeo = () => new THREE.TorusGeometry(TUNE.HOOP_R, 0.75 * TUNE.HOOP_R / 8, 8, 44);
  function build(group) {
    items = [];
    if (!MILLS.length) return;
    const body = bodyGeometry();
    if (body) group.add(body);
    const ring = hoopGeo();
    for (const m of MILLS) {
      // the sails' frame at the hub: x = your right, y = up, z = back toward you
      const holder = new THREE.Group();
      holder.position.copy(m.hub);
      holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(m.rx, 0, m.rz), WORLD_UP, new THREE.Vector3(-m.fx, 0, -m.fz)));
      const rotor = new THREE.Group();
      rotor.add(new THREE.Mesh(sailGeometry(m), mat));
      // the hoop rides `gap` past sail 0, turning with the sails but held by nothing, like every other hoop in the air
      const a = m.a0 + m.gap, hx = m.orbit * Math.sin(a), hy = m.orbit * Math.cos(a);
      const hoop = new THREE.Mesh(ring, M.later);
      hoop.position.set(hx, hy, 0.6);
      rotor.add(hoop);
      holder.add(rotor);
      group.add(holder);
      items.push({ m, rotor, hoop, fade: 0, flash: null });
    }
  }
  const paused = () => typeof window !== 'undefined' && window.Skyrace && window.Skyrace.state === 'paused';
  // s: { next, t, dt, P, playing, crashing, ... } (js/game.js)
  function update(s) {
    if (!paused()) millTick(s.dt);
    for (const it of items) {
      it.rotor.rotation.z = it.m.w * MILL_T;                  // anticlockwise as you see it: the angles fall
      const i = it.m.i, h = it.hoop;
      if (i < s.next) {
        if (it.fade > 0) {
          it.fade = Math.max(0, it.fade - s.dt * 2.4);
          it.flash.opacity = it.fade; h.material = it.flash; h.visible = it.fade > 0;
          h.scale.setScalar(1 + (1 - it.fade) * 0.7);
        } else h.visible = false;
        continue;
      }
      const rel = i - s.next;
      h.visible = true; h.material = rel === 0 ? M.next : rel === 1 ? M.soon : M.later;
      h.scale.setScalar(rel === 0 ? 1 + Math.sin(s.t * 6) * 0.035 : 1);
    }
  }
  function pass(i) {
    const it = items.find((x) => x.m.i === i);
    if (!it) return;
    if (it.flash) it.flash.dispose();
    it.flash = M.next.clone(); it.flash.transparent = true; it.flash.depthWrite = false;
    it.fade = 1;
  }
  function reset() { millReset(); for (const it of items) { it.fade = 0; it.hoop.scale.setScalar(1); it.hoop.visible = true; } }
  return { build, update, pass, reset };
}
SHORE_PLUGINS.push({ build: buildMills, createKit: () => ({ build() {} }) });
GATE_KITS.push(createMillKit);
