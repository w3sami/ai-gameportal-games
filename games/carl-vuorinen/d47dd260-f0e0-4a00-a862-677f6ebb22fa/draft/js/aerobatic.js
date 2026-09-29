'use strict';
/* =========================================================================
   AEROBATICS — attitude gates for the biplane (Farm), and its roll detents. Kept out of js/sim.js and js/game.js.
   Gates (course points' 7th value, GATE_TYPES in js/sim.js; 8th value = options):
     "K"  knife-edge slot: a tall, narrow capsule, too narrow for level wings. Forgiving: it counts anywhere within a
          hoop's circle round it (as if it were a hoop), and the wings only have to be on edge enough to fit its width
          and height, wherever you cross (rules.knife s if not, default 2). Options { w, h, flank }: the
          slot's inner width and height (m, default SLOT_W and 2 HOOP_R), flank: "silo" puts a silo either side
          (js/farm.js).
     "I"  inverted hoop: a hoop flown upside down, within INV_TOL of it (rules.inverted s if not, default 2), INV_SCALE
          times a hoop's size (option { r } for its own radius), so mind its height above the ground. Dashed magenta
          and blue all round, the dashes turning slowly while it's the next gate.
   Both carry a sign above them: the plane seen head-on, turned the way to fly through (on edge, upside down).
   Flying (touch and controller): as the stunt plane, the stick's left/right banks up to TOUCH_BANK, and holding it at
   the end of its throw rolls on past that (ROLL_ON rad/s); up/down is the elevator, a pitch rate toward the plane's
   top (aeroStick: on edge it turns, upside down it dives, a full pull loops). Letting go within ROLL_DETENT of knife edge
   or inverted holds it there; anywhere else levels out as usual. Taking the stick again carries on from what it held.
   Sim part (no DOM): GATE_TYPES.K / .I, aeroStick(P, x, y, dt) (the stick held), aeroHold(P) (let go),
   aeroRollTo(P, next) (the autopilot's roll for the gate ahead), slotSize(h).
   Game part: createAeroGateKit({ hoopMat }) -> { build(group), update(s), pass(i), reset() } (GATE_KITS, js/sim.js):
   the slots, the hoops for "I", the signs, the pass flash, and a toast announcing each of these gates ahead of it.
   ========================================================================= */
const AERO_DEFAULTS = { ROLL_DETENT: 0, ROLL_ON: 2.4, INV_TOL: 0.6, SLOT_W: 5.2, INV_SCALE: 2 };
Object.assign(TUNE, AERO_DEFAULTS);
Object.assign(TUNE_DEFAULTS, AERO_DEFAULTS);
const TIP_GRACE = 0.25;                                      // how far a wingtip may poke past the slot's inside (m)

const invR = (h) => (h.opts && h.opts.r) || TUNE.HOOP_R * TUNE.INV_SCALE;   // an inverted hoop's radius
function slotSize(h) {
  const o = h.opts || {};
  return { w: o.w || TUNE.SLOT_W, h: o.h || TUNE.HOOP_R * 2 };
}
// the plane's position and a point along its right wing in the gate's plane: u right, v up from its centre
function _gateUV(h, p) {
  const n = h.normal, rl = Math.hypot(n.x, n.z) || 1, dx = p.x - h.pos.x, dy = p.y - h.pos.y, dz = p.z - h.pos.z;
  return { u: (-dx * n.z + dz * n.x) / rl, v: dy * rl - (dx * n.x + dz * n.z) * n.y / rl };
}
const _aeR = new THREE.Vector3(), _aeTip = new THREE.Vector3();
GATE_TYPES.K = {
  shape(h, u, v) { return u * u + v * v < (TUNE.HOOP_R + TUNE.HOOP_TOL) ** 2; },
  disc: () => 0,                                             // a round disc would spill out of the slot
  top: (h) => slotSize(h).h / 2,
  rule(P, h) {
    // the wings' span across and up the gate, as if the slot were centred on the plane: does it fit?
    const s = slotSize(h), c = _gateUV(h, P.pos);
    _aeR.set(1, 0, 0).applyQuaternion(P.q);
    const t = _gateUV(h, _aeTip.copy(P.pos).addScaledVector(_aeR, TUNE.WING_HALF));
    const du = Math.abs(t.u - c.u), dv = Math.abs(t.v - c.v), hw = s.w / 2 + TIP_GRACE;
    const ey = Math.max(0, dv - (s.h / 2 - s.w / 2));           // round ends of radius w/2
    if (du > hw || du * du + ey * ey > hw * hw) return { sec: RULES.knife == null ? 2 : RULES.knife, text: 'Wings not on edge' };
    return null;
  },
};
GATE_TYPES.I = {
  shape(h, u, v) { return u * u + v * v < (invR(h) + TUNE.HOOP_TOL) ** 2; },
  disc: (h) => invR(h) - 0.6 * TUNE.INV_SCALE,
  top: invR,
  rule(P) {
    return Math.abs(P.bank) > Math.PI - TUNE.INV_TOL ? null : { sec: RULES.inverted == null ? 2 : RULES.inverted, text: 'Not upside down' };
  },
};

// The stick's left/right: the bank up to TOUCH_BANK, as the stunt plane; holding the end of the throw (past OD_THRESH,
// as for extra climb) rolls on at ROLL_ON rad/s instead, round to knife edge, inverted and back, without turning on
// the way. It counts from the attitude the plane was holding when the stick was taken, so from knife edge the stick
// centred stays on edge. Returns the bank to roll to (aeroStick).
function aeroBank(P, x, dt) {
  if (P.stickBase == null) { P.stickBase = P.rollHold || 0; P.rollOn = 0; }
  P.rollHold = null;
  if (Math.abs(x) <= TUNE.OD_THRESH) { P.rollOn = 0; return wrapAngle(P.stickBase + x * TUNE.TOUCH_BANK); }
  // at the end of the throw: keep rolling that way (the target leads the plane by what makes attitude() roll at
  // ROLL_ON), all the way round for as long as it's held. P.rollOn also stops bank-to-turn meanwhile (js/sim.js)
  P.rollOn = Math.sign(x);
  return wrapAngle(P.bank + P.rollOn * Math.min(1.4, TUNE.ROLL_ON / TUNE.MAX_ROLL / TUNE.ATT_ROLL_P));
}
// The stick held, all of it: up/down is the elevator, a pitch rate toward the plane's top whatever its attitude (on
// edge it turns, upside down it dives, from level a full pull loops); left/right is aeroBank's bank. Pulling with
// left/right centred leaves the roll alone (a loop doesn't roll level over the top) and meanwhile remembers the
// nearest of level, knife edge or inverted, so easing off the pull holds that. Returns { p, r } for stepFlight.
const PULL_FREE = 0.35, X_CENTRE = 0.15;
function aeroStick(P, x, y, dt) {
  const bankT = aeroBank(P, x, dt);
  if (!P.rollOn && Math.abs(x) < X_CENTRE && Math.abs(y) > PULL_FREE) {
    let near = 0;
    for (const d of DETENTS) if (Math.abs(wrapAngle(d - P.bank)) < Math.abs(wrapAngle(near - P.bank))) near = d;
    P.stickBase = near;
    return { p: y, r: 0 };
  }
  return { p: y, r: clamp(wrapAngle(bankT - P.bank) * TUNE.ATT_ROLL_P, -1, 1) };
}
// let go (and with the mouse, until it moves): hold knife edge or inverted if within ROLL_DETENT of it, otherwise level
// out. Chosen once, when let go (P.rollHold: cleared while the stick or keys are used, and by placePlane), so levelling
// out from past knife edge doesn't catch on it on the way. Returns the bank to fly.
const DETENTS = [Math.PI / 2, -Math.PI / 2, Math.PI];
function aeroHold(P) {
  P.stickBase = null; P.rollOn = 0;
  if (P.rollHold == null) {
    P.rollHold = 0;
    for (const d of DETENTS) if (Math.abs(wrapAngle(d - P.bank)) < TUNE.ROLL_DETENT) P.rollHold = d;
  }
  return P.rollHold;
}
// autopilot (attract mode, victory lap, tests): roll for the attitude gate ahead from ~1 s out; on edge to whichever
// side is nearer
function aeroRollTo(P, next) {
  const h = HOOPS[next];
  if (!h || (h.kind !== 'K' && h.kind !== 'I')) return null;
  const along = (P.pos.x - h.pos.x) * h.normal.x + (P.pos.y - h.pos.y) * h.normal.y + (P.pos.z - h.pos.z) * h.normal.z;
  if (along < -P.speed * 1.15 || along > 2) return null;
  return h.kind === 'I' ? Math.PI : (P.bank < 0 ? -Math.PI / 2 : Math.PI / 2);
}

/* ---------- game part: the gates' meshes ---------- */
function createAeroGateKit(ctx) {
  const M = ctx.hoopMat;                                     // the hoops' own materials: next, soon, later
  let items = [];                                            // per attitude gate: { i, meshes: [mesh], fade, flash }
  const tube = 0.55;
  // capsule outline in the xy plane: straight sides, round ends
  class Capsule extends THREE.Curve {
    constructor(w, h) { super(); this.r = w / 2; this.s = h / 2 - w / 2; this.L = 4 * this.s + TAU * this.r; }
    getPoint(t, out = new THREE.Vector3()) {
      let d = t * this.L; const r = this.r, s = this.s;
      if (d < 2 * s) return out.set(r, -s + d, 0); d -= 2 * s;
      if (d < Math.PI * r) { const a = d / r; return out.set(r * Math.cos(a), s + r * Math.sin(a), 0); } d -= Math.PI * r;
      if (d < 2 * s) return out.set(-r, s - d, 0); d -= 2 * s;
      const a = Math.PI + d / r; return out.set(r * Math.cos(a), -s + r * Math.sin(a), 0);
    }
  }
  // the sign: the biplane head-on (upper and lower wings, round cowl, fin, wheels), about 10 m across, in the xy plane
  function signGeometry() {
    const parts = [];
    const box = (w, h, x, y) => parts.push(new THREE.PlaneGeometry(w, h).translate(x, y, 0));
    box(6.2, 0.5, 0, 1.05);                                  // upper wing
    box(5.4, 0.45, 0, -0.35);                                // lower wing
    for (const s of [-1, 1]) { box(0.16, 1.4, s * 2.1, 0.35); box(0.12, 0.9, s * 0.45, 0.55); }   // struts
    parts.push(new THREE.CircleGeometry(0.62, 20).translate(0, 0.15, 0.01));   // cowl
    box(0.2, 1.1, 0, 1.55);                                  // fin
    for (const s of [-1, 1]) { box(0.12, 0.8, s * 0.55, -0.95); parts.push(new THREE.CircleGeometry(0.28, 12).translate(s * 0.7, -1.4, 0.01)); }   // gear
    return mergeFlat(parts).scale(SIGN_K, SIGN_K, 1);
  }
  const SIGN_K = 1.6;
  function mergeFlat(geos) {
    const pos = [];
    for (const g of geos) { const n = g.index ? g.toNonIndexed() : g; pos.push(...n.attributes.position.array); }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return out;
  }
  const SIGN = signGeometry();
  // inverted hoop: magenta and blue dashes all round (flat colour per triangle, so the dash ends stay crisp)
  const DASHES = 20, DASH = [M.next.color.clone(), new THREE.Color('#4a90f0')];   // the route's magenta, light blue
  function dashedRing(R) {
    const g = new THREE.TorusGeometry(R, 0.75 * TUNE.HOOP_R / 8 * 1.4, 8, DASHES * 6).toNonIndexed(), p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i += 3) {
      const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      const c = DASH[Math.floor((Math.atan2(y, x) / TAU + 1) * DASHES) % 2];
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }
  const shared = (m) => { m.userData.shared = true; return m; };
  const DM = {                                               // its states: next and soon solid, later see-through
    next: shared(new THREE.MeshBasicMaterial({ vertexColors: true })),
    later: shared(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false })),
  };
  DM.soon = DM.next;
  function build(group) {
    items = [];
    const ringGeo = new Map();                               // per radius
    HOOPS.forEach((h, i) => {
      if (h.kind !== 'K' && h.kind !== 'I') return;
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), h.normal.clone().negate(), WORLD_UP));
      const meshes = [];
      const add = (geo, x, y, rz) => {
        const m = new THREE.Mesh(geo, M.later);
        m.position.set(x, y, 0).applyQuaternion(q).add(h.pos);
        m.quaternion.copy(q); if (rz) m.rotateZ(rz);
        group.add(m); meshes.push(m); return m;
      };
      if (h.kind === 'K') {
        const s = slotSize(h);
        add(new THREE.TubeGeometry(new Capsule(s.w + tube * 2, s.h + tube * 2), 72, tube, 8, true), 0, 0, 0);
        add(SIGN, 0, s.h / 2 + tube + 1.2 + 3.1 * SIGN_K, Math.PI / 2).userData.sign = true;   // on its side
      } else {
        const R = invR(h);
        if (!ringGeo.has(R)) ringGeo.set(R, dashedRing(R));
        add(ringGeo.get(R), 0, 0, 0).userData.dashed = true;
        add(SIGN, 0, R + 1.8 + 1.7 * SIGN_K, Math.PI).userData.sign = true;               // upside down
      }
      for (const m of meshes) if (m.userData.sign) { m.material = M.later; m.renderOrder = 1; }
      items.push({ i, h, meshes, q, fade: 0, flash: null });
    });
  }
  const signSide = new Map();                                // double-sided copies of the hoop materials for the flat signs
  const sided = (m) => { if (!signSide.has(m)) { const c = m.clone(); c.side = THREE.DoubleSide; c.userData.shared = true; signSide.set(m, c); } return signSide.get(m); };
  // announcements: each attitude gate is called out ANNOUNCE s before it's reached, but no sooner than QUIET s after the
  // previous gate or a crash (so a penalty or crash message has been read first)
  const ANNOUNCE = 6, QUIET = 1.9, announced = new Set();
  let lastNext = -1, quietFrom = 0;
  const callout = (it) => {
    const prev = HOOPS[it.i - 1];
    if (it.h.kind === 'I') return 'Inverted next: roll upside down.';
    return prev && prev.kind === 'K' ? 'Knife edge again: stay on the wingtip.' : 'Knife edge next: roll onto a wingtip.';
  };
  // s: { next, t, dt, P, playing, crashing, fresh (no best time yet), toast(text, ms) }
  function update(s) {
    if (s.next !== lastNext || s.crashing) { lastNext = s.next; quietFrom = s.t; }
    for (const it of items) {
      if (it.i < s.next) {
        if (it.fade > 0) {
          it.fade = Math.max(0, it.fade - s.dt * 2.4);
          it.flash.opacity = it.signFlash.opacity = it.fade;
          for (const m of it.meshes) { m.material = m.userData.sign ? it.signFlash : it.flash; m.visible = it.fade > 0; }
          it.meshes[0].scale.setScalar(1 + (1 - it.fade) * 0.7);
        } else for (const m of it.meshes) m.visible = false;
        continue;
      }
      const rel = it.i - s.next, st = rel === 0 ? 'next' : rel === 1 ? 'soon' : 'later';
      for (const m of it.meshes) { m.visible = true; m.material = m.userData.sign ? sided(M[st]) : m.userData.dashed ? DM[st] : M[st]; }
      const ring = it.meshes[0];
      ring.scale.setScalar(rel === 0 ? 1 + Math.sin(s.t * 6) * 0.035 : 1);
      // the next inverted hoop's dashes turn slowly round it, rolling the way you roll into it
      if (ring.userData.dashed) { ring.quaternion.copy(it.q); if (rel === 0) ring.rotateZ(s.t * 1.2); }
      if (rel === 0 && s.playing && !s.crashing && !announced.has(it.i) && s.t - quietFrom > QUIET
          && s.P.pos.distanceTo(it.h.pos) < Math.max(s.P.speed, 1) * ANNOUNCE) {
        announced.add(it.i);
        s.toast(callout(it), 2600);
      }
    }
  }
  function pass(i) {
    const it = items.find((x) => x.i === i);
    if (!it) return;
    if (it.flash) { it.flash.dispose(); it.signFlash.dispose(); }
    const fl = (m) => { const c = m.clone(); c.transparent = true; c.depthWrite = false; return c; };
    it.flash = fl(it.meshes[0].userData.dashed ? DM.next : M.next);
    it.signFlash = fl(sided(M.next));
    it.fade = 1;
  }
  function reset() { announced.clear(); lastNext = -1; for (const it of items) { it.fade = 0; it.meshes[0].scale.setScalar(1); } }
  return { build, update, pass, reset };
}
GATE_KITS.push(createAeroGateKit);
