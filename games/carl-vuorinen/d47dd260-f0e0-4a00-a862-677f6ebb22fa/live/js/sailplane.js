'use strict';
/* =========================================================================
   SAILPLANE — FLIGHT_MODEL 'sail' (config/sailplane.json), and the rising air it climbs in.
   Like the wingsuit (js/glide.js, whose lift/drag shapes and TUNE keys it reuses) it's a point mass with lift and drag
   and no engine, but it flies a real sailplane's energy trade: pulling up zooms it higher while the speed lasts, and
   in a thermal the air itself rises under it. The stick asks for a bank and a path angle through the air: centre is the
   best glide, down dives to DIVE_MAX, up climbs at up to CLIMB_MAX, and the climb costs speed. Run out of it and it
   stalls: below STALL_SPEED the nose drops and a wing goes, the stick can't hold it up, and it flies again once it's
   STALL_RECOVER m/s faster (a stall costs 20-40 m). Under STALL_WARN it warns first (P.stallWarn 0..1: buffet, a tone).
   Boost ("Dive") is the fast shape (TUCK_* keys): flaps up, a higher trim speed, a better glide when flown fast and
   a worse one slow, so it's for the glides between thermals, not for circling.
   Mouse aim (and the autopilot) aims over the ground: in rising air the path through the air is flattened to match.
   Aim climbs only while there's speed to spare (none at STALL_WARN, all by STALL_WARN + AIM_MARGIN), so pointing at a
   high hoop zooms up to it without stalling; the stick and keys have no such limit.
   Course file: thermals: [{ x, z, r, w, top }]  columns of rising air standing on the ground at (x, z): radius r m,
     rising w m/s across the middle THERMAL_CORE share of it and fading to nothing at its edge, and fading out over the
     THERMAL_FADE m below `top` (height above the water, m): circle as long as you like, it won't take you higher.
     The air also flows in toward the core (THERMAL_INFLOW), so a circle flown off-centre drifts into the strong lift.
   Each stands on a sunny field (radius `field` m, default 0.8 r): a pale meadow on the ground, kept clear of trees so
   circling low over it is safe. Only over land: water doesn't make thermals. The scenery marks each one with a
   shimmer, specks rising in a spiral, a few birds circling near the top, and a cumulus cloud just above it.
   Sim part (no DOM): thermalLift(x, y, z), thermalAt(x, z), stepSail(P, ctl, dt), sailTip() (the start screen's line on
   rising air, to suit the course); P.vario is the total-energy climb rate (m/s: the air's rise minus the glider's own
   sink, so zooming doesn't count), P.lift the thermals' rise and P.ridge the rest (other modules' rising air,
   LIFT_PLUGINS: js/ridge.js adds ridge lift along cliffs).
   The fields are a js/shore.js plugin (tree-free boxes far underground, never hit; the kit draws the meadows).
   Game part: makeSailplaneModel(scene, modelKit) (its update() also shakes the airframe near the stall and sets the
   body's is-stall-warn / is-stall classes for the HUD), createVario(ctx, out) (vario and stall warner), and the thermal
   scenery (SCENERY_PLUGINS).
   ========================================================================= */
const SAIL_DEFAULTS = {
  CLIMB_MAX: 0.55,               // steepest climb the stick asks for (rad)
  SAIL_CL_MAX: 1.0,              // lift limit (1 = level flight at LEVEL_SPEED)
  STALL_SPEED: 19, STALL_WARN: 23.5, STALL_RECOVER: 5,   // m/s
  STALL_CL: 0.35,                // lift limit while stalled
  STALL_DIVE: 0.7, STALL_PITCH: 1.3,   // stalled: the nose drops toward this dive (rad), this fast (rad/s)
  STALL_ROLL: 0.55,              // ... and a wing drops this far (rad)
  AIM_MARGIN: 7,                 // m/s over STALL_WARN before mouse aim climbs freely
  TRIM_K: 0.6, TRIM_PUSH: 0.2, TRIM_LIFT: 0.06,   // speed stability: centre stick noses down when slow, up when fast
  THERMAL_CORE: 0.65, THERMAL_FADE: 50, THERMAL_INFLOW: 14,
  VARIO_TAU: 0.7,                // variometer lag (s)
  VARIO_ON: 0.5,                 // the vario beeps above this climb (m/s)
};
Object.assign(TUNE, SAIL_DEFAULTS);
Object.assign(TUNE_DEFAULTS, SAIL_DEFAULTS);
const sailing = () => TUNE.FLIGHT_MODEL === 'sail';

/* ---------- thermals ---------- */
let _thFor = null;
const _th = [];                                             // per thermal: x, z, r, w, top, base (ground under it)
function thermalList() {
  if (_thFor !== COURSE) {
    _thFor = COURSE; _th.length = 0;
    for (const t of (COURSE && COURSE.thermals) || []) _th.push({ x: t.x, z: t.z, r: t.r, w: t.w, top: t.top, base: groundAt(t.x, t.z) });
  }
  return _th;
}
// rising air at (x, y, z) in m/s; AIR.ux/uz get the inflow: air drawn in toward the core (THERMAL_INFLOW m/s at the
// column's edge, nothing at its centre), which walks an off-centre circle in toward the strong lift
const AIR = { ux: 0, uz: 0 };
function thermalLift(x, y, z) {
  const T = thermalList();
  let w = 0;
  AIR.ux = AIR.uz = 0;
  for (let i = 0; i < T.length; i++) {
    const t = T[i], dx = x - t.x, dz = z - t.z, d2 = dx * dx + dz * dz;
    if (d2 >= t.r * t.r || y >= t.top) continue;
    const d = Math.sqrt(d2), k = smoothstep(t.r, t.r * TUNE.THERMAL_CORE, d) * smoothstep(t.top, t.top - TUNE.THERMAL_FADE, y);
    w += t.w * k;
    if (d > 1) { const u = TUNE.THERMAL_INFLOW * k / t.r; AIR.ux -= dx * u; AIR.uz -= dz * u; }
  }
  return w;
}
// other modules add rising air of their own: fn(x, y, z) -> m/s (js/ridge.js: ridge lift in front of cliffs)
const LIFT_PLUGINS = [];
function thermalAt(x, z) {                                  // index of the thermal whose column (x, z) is in, or -1
  const T = thermalList();
  for (let i = 0; i < T.length; i++) if ((x - T[i].x) ** 2 + (z - T[i].z) ** 2 < T[i].r * T[i].r) return i;
  return -1;
}

// the start screen's line on rising air, for what this course has: thermals, ridge lift (js/ridge.js), or both
function sailTip() {
  const th = !!(COURSE.thermals && COURSE.thermals.length), rg = !!(COURSE.ridges && COURSE.ridges.length);
  const crash = 'A crash puts you back at the last hoop.';
  if (rg) return 'Where the white streaks climb a cliff the air rises, strongest right by the face: fly close along it. '
    + (th ? 'Birds circling under a cloud mark a thermal: circle in it to climb. ' : '') + crash;
  return `Rising air lifts you under the clouds where the birds circle: bank hard and circle in it to climb. There\u2019s none over water. ${crash}`;
}

/* ---------- the fields under the thermals (a js/shore.js plugin) ---------- */
const FIELD_NONE = -1e6;                                    // tree-free zones: boxes far underground, never hit
const fieldR = (t) => (t.field != null ? t.field : t.r * 0.8);
function buildFields() {
  for (const t of (COURSE && COURSE.thermals) || []) {
    const R = fieldR(t);
    for (let k = 0; k < 3; k++) {                           // three squares turned 30 degrees apart: roughly a disc
      const a = k * Math.PI / 6;
      shoreBox('field', t.x, t.z, Math.cos(a), Math.sin(a), R * 0.8, R * 0.8, FIELD_NONE, FIELD_NONE);
    }
  }
}
function createFieldKit() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.userData.shared = true;
  const A = new THREE.Color('#b9c46a'), B = new THREE.Color('#d8c77a'), c = new THREE.Color();
  return {
    build(group) {
      const T = (COURSE && COURSE.thermals) || [];
      if (!T.length) return;
      const pos = [], col = [];
      T.forEach((t, n) => {
        const R = fieldR(t), step = 6, rows = Math.ceil(R / step), rot = n * 1.3;
        const at = (i, j) => {                              // a square grid, rounded off by the wobbly edge below
          const x = t.x + (i * Math.cos(rot) - j * Math.sin(rot)) * step, z = t.z + (i * Math.sin(rot) + j * Math.cos(rot)) * step;
          const d = Math.hypot(x - t.x, z - t.z), edge = R * (0.82 + 0.18 * noiseC(x * 0.02 + n * 7, z * 0.02));
          const h = heightAt(x, z);
          return { x, z, y: h + 0.35, ok: d < edge && h > TER.WATER + 0.8, row: i };
        };
        for (let j = -rows; j < rows; j++) for (let i = -rows; i < rows; i++) {
          const a = at(i, j), b = at(i + 1, j), d = at(i, j + 1), e = at(i + 1, j + 1);
          c.copy(A).lerp(B, (i & 2) ? 0.85 : 0.25);         // crop rows, two cells wide
          for (const tri of [[a, d, e], [a, e, b]]) {
            if (!tri[0].ok || !tri[1].ok || !tri[2].ok) continue;
            for (const v of tri) { pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); }
          }
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
SHORE_PLUGINS.push({ build: buildFields, createKit: createFieldKit });

/* ---------- flight model ---------- */
// stick centre: the best-glide path, nosed down when slower than the trim speed and up a little when faster, so letting
// go after a zoom or a dive settles back to the trim speed (TRIM_K rad per 100 % off it, at most TRIM_PUSH / TRIM_LIFT)
function sailTrim(ae, tuck, v) {
  const vt = lerp(TUNE.TRIM_SPEED, TUNE.TUCK_TRIM_SPEED, tuck);
  return ae.gam + clamp(TUNE.TRIM_K * (v - vt) / vt, -TUNE.TRIM_PUSH, TUNE.TRIM_LIFT);
}
// stick climb (-1..1) to a path angle through the air: centre = trim, down = the dive limit, up = CLIMB_MAX
function sailPath(c, trim, dive) {
  c = clamp(c, -1, 1);
  return c >= 0 ? lerp(trim, TUNE.CLIMB_MAX, c) : lerp(trim, -dive, -c);
}
// state for the game side (instruments, sound): the last step's stall and warning
const SAIL_FX = { stall: false, warn: 0 };
function initSail(P) {
  P.glide = { gam: clamp(pitchOf(P.vdir), -1.4, TUNE.CLIMB_MAX), psi: yawOf(P.vdir), phi: 0, cl: 0.5, tuck: 0, psiDot: 0, stall: false, drop: 1, drops: 0 };
  P.vario = 0; P.lift = 0; P.stall = false; P.stallWarn = 0;
}
const _sq = new THREE.Quaternion(), _sm = new THREE.Matrix4(), _sz = new THREE.Vector3(), _sx = new THREE.Vector3(1, 0, 0), _sZ = new THREE.Vector3(0, 0, 1);
// ctl as for stepFlight: att {bank, climb} (touch, controller, letting go), aim (mouse, autopilot), or manual p/r (keys)
function stepSail(P, ctl, dt) {
  if (!P.glide) initSail(P);
  const S = P.glide, G = TUNE.G;
  S.tuck += clamp((ctl.boost ? 1 : 0) - S.tuck, -TUNE.TUCK_OUT * dt, TUNE.TUCK_IN * dt);
  P.tuck = S.tuck; P.boosting = !!ctl.boost; P.boost = 1; P.boostLock = false;   // no meter: height is the cost
  const ae = glideAero(S.tuck), v = P.speed, dive = lerp(TUNE.DIVE_MAX, TUNE.TUCK_DIVE_MAX, S.tuck);
  const wt = thermalLift(P.pos.x, P.pos.y, P.pos.z), trim = sailTrim(ae, S.tuck, v);
  let w = wt;
  for (let i = 0; i < LIFT_PLUGINS.length; i++) w += LIFT_PLUGINS[i](P.pos.x, P.pos.y, P.pos.z);

  // stall: the wing lets go below STALL_SPEED and flies again STALL_RECOVER m/s faster
  if (!S.stall && v < TUNE.STALL_SPEED) {
    S.stall = true;
    S.drop = Math.abs(S.phi) > 0.05 ? Math.sign(S.phi) : (S.drops++ % 2 ? 1 : -1);   // the low wing goes, else alternate
  } else if (S.stall && v > TUNE.STALL_SPEED + TUNE.STALL_RECOVER) S.stall = false;

  let bankT, gamT;
  if (ctl.att) { bankT = ctl.att.bank; gamT = sailPath(ctl.att.climb, trim, dive); }
  else if (ctl.aim) {                                        // aim: bank toward its heading, fly its angle over the ground
    const he = wrapAngle(yawOf(ctl.aim) - S.psi) - TUNE.ASSIST_LEAD * S.psiDot;   // + = aim to the left
    bankT = clamp(-he * TUNE.BANK_GAIN, -TUNE.MAX_BANK, TUNE.MAX_BANK);
    const up = lerp(trim, TUNE.CLIMB_MAX, smoothstep(TUNE.STALL_WARN + 1.5, TUNE.STALL_WARN + TUNE.AIM_MARGIN, v));   // climb on spare speed only
    gamT = clamp(Math.asin(clamp(ctl.aim.y - w / Math.max(v, 1), -1, 1)), -dive, up);
  } else { bankT = clamp(ctl.r, -1, 1) * TUNE.TOUCH_BANK; gamT = sailPath(ctl.p, trim, dive); }
  if (S.stall) { gamT = -TUNE.STALL_DIVE; bankT = bankT * 0.3 + S.drop * TUNE.STALL_ROLL; }   // stalled: nose and a wing drop

  S.phi += clamp((bankT - S.phi) * TUNE.GLIDE_ROLL_P, -TUNE.GLIDE_ROLL_RATE, TUNE.GLIDE_ROLL_RATE) * (S.stall ? 1.4 : 1) * dt;
  const q = G * ae.a * v * v, cphi = Math.cos(S.phi);
  const gdotCmd = clamp((gamT - S.gam) * TUNE.GAMMA_P, -(S.stall ? TUNE.STALL_PITCH : TUNE.GAMMA_RATE_DOWN), TUNE.GAMMA_RATE);
  const need = (v * gdotCmd + G * Math.cos(S.gam)) / Math.max(cphi, 0.2);
  S.cl += (clamp(need / q, TUNE.CL_MIN, S.stall ? TUNE.STALL_CL : TUNE.SAIL_CL_MAX) - S.cl) * damp(TUNE.CL_K, dt);
  const L = q * S.cl, D = G * ae.a * v * v * (ae.cd0 + ae.k * S.cl * S.cl) + G * Math.pow(v / TUNE.VMAX, 12);
  let gdot = (L * cphi - G * Math.cos(S.gam)) / v;
  if (gdotCmd < 0 && gdot > gdotCmd) gdot = gdotCmd;         // nosing over (see GAMMA_RATE_DOWN in js/glide.js)
  S.psiDot = -L * Math.sin(S.phi) / (v * Math.max(Math.cos(S.gam), 0.2)) * TUNE.GLIDE_TURN;   // right bank turns right
  P.speed = Math.max(TUNE.MIN_SPEED, v - (D + G * Math.sin(S.gam)) * dt);
  S.gam = clamp(S.gam + gdot * dt, -1.45, TUNE.CLIMB_MAX + 0.15);
  S.psi = wrapAngle(S.psi + S.psiDot * dt);

  dirFromYawPitch(S.psi, S.gam, P.vdir);
  P.pos.addScaledVector(P.vdir, P.speed * dt);
  P.pos.x += AIR.ux * dt; P.pos.y += w * dt; P.pos.z += AIR.uz * dt;   // the air carries it up (and in)
  P.lift = wt; P.ridge = w - wt;                          // thermal lift only in P.lift: js/game.js's "circle" hint reads it
  P.vario = lerp(P.vario, w - v * D / G, damp(1 / TUNE.VARIO_TAU, dt));   // total energy: air's rise minus own sink
  P.q.setFromRotationMatrix(_sm.lookAt(_sz.set(0, 0, 0), P.vdir, WORLD_UP));
  P.q.multiply(_sq.setFromAxisAngle(_sZ, -S.phi)).multiply(_sq.setFromAxisAngle(_sx, TUNE.ALPHA_VIS * clamp(S.cl, 0, 1.3)));
  P.bank = S.phi; P.turn = S.psiDot; P.rp = P.ry = P.rr = 0;
  P.gload = lerp(P.gload, Math.abs(L) / G, damp(6, dt));
  P.stall = S.stall;
  P.stallWarn = S.stall ? 1 : clamp((TUNE.STALL_WARN - P.speed) / (TUNE.STALL_WARN - TUNE.STALL_SPEED), 0, 1);
  SAIL_FX.stall = P.stall; SAIL_FX.warn = P.stallWarn;
}

/* =========================================================================
   Game part (needs a scene / an audio context; not used by the tests)
   ========================================================================= */

// white glider: long thin wings with orange tips and a little flex under load, slim boom, T-tail
function makeSailplaneModel(scene, modelKit) {
  const V3 = THREE.Vector3, g = new THREE.Group(), add = modelKit(g);
  const white = new THREE.MeshLambertMaterial({ color: '#f5f5f1' }), orange = new THREE.MeshLambertMaterial({ color: '#ff5a1f' });
  const glass = new THREE.MeshLambertMaterial({ color: '#2d4a63', emissive: '#0d1b28' }), dark = new THREE.MeshLambertMaterial({ color: '#2a333c' });
  // flat plate drawn in plan view ([x, z] outline), `t` thick, centred on y = 0
  const plate = (pts, t) => new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))), { depth: t, bevelEnabled: false })
    .rotateX(Math.PI / 2).translate(0, t / 2, 0);
  add(new THREE.SphereGeometry(0.5, 12, 8).scale(1, 1.05, 3.4), white, 0, 0, -1.3);            // pod
  add(new THREE.CylinderGeometry(0.34, 0.1, 5.4, 8).rotateX(-Math.PI / 2), white, 0, 0.08, 2.7);   // tail boom: thick at the pod
  add(new THREE.SphereGeometry(0.4, 12, 8).scale(1, 0.72, 2.6), glass, 0, 0.33, -2.1);           // canopy
  // fin: side profile [aft, up] with a swept leading edge, 0.1 thick; the T-tail sits on its top
  const fin = (pts) => new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))), { depth: 0.1, bevelEnabled: false })
    .rotateY(-Math.PI / 2).translate(0.05, 0, 0);
  add(fin([[0, 0], [1.15, 0], [1.2, 1.1], [0.72, 1.1]]), white, 0, 0.12, 4.4);
  add(fin([[0.72, 1.1], [1.2, 1.1], [1.22, 1.52], [0.95, 1.52]]), orange, 0, 0.12, 4.4);
  add(new THREE.BoxGeometry(2.8, 0.07, 0.5), white, 0, 1.66, 5.5);                               // T-tail
  add(new THREE.SphereGeometry(0.16, 8, 6).scale(1, 1, 1.3), dark, 0, -0.5, -0.9);              // wheel
  const flex = [];
  for (const s of [-1, 1]) {
    // wing: inner panel with a little dihedral, outer panel hinged at 3.6 m that flexes up with the load
    const inner = new THREE.Group(); inner.position.set(0, 0.28, -0.6); inner.rotation.z = s * 0.04; g.add(inner);
    const ik = modelKit(inner);
    ik(plate([[0.3 * s, -0.55], [3.7 * s, -0.5], [3.7 * s, 0.28], [0.3 * s, 0.45]], 0.12), white, 0, 0, 0);
    const outer = new THREE.Group(); outer.position.set(3.65 * s, 0, 0); inner.add(outer);
    const ok = modelKit(outer);
    ok(plate([[0, -0.5], [2.6 * s, -0.43], [2.6 * s, 0.13], [0, 0.28]], 0.1), white, 0, 0, 0);
    ok(plate([[2.6 * s, -0.43], [3.55 * s, -0.36], [3.55 * s, 0.02], [2.6 * s, 0.13]], 0.08), orange, 0, 0, 0);
    ok(new THREE.BoxGeometry(0.05, 0.45, 0.32), orange, 3.57 * s, 0.2, -0.15, -s * 0.2);          // winglet
    flex.push(outer);
  }
  scene.add(g);
  const shake = new THREE.Quaternion(), e = new THREE.Euler(), cls = document.body.classList;
  let t = 0, warnOn = false, stallOn = false;
  return { group: g, tips: [new V3(-7.1, 0.9, -0.7), new V3(7.1, 0.9, -0.7)], shadow: 1.25,
           update(dt, P) {
             t += dt;
             const b = P.stallWarn || 0, k = 0.05 + 0.035 * clamp((P.gload || 1) - 1, -0.5, 2) + b * 0.03 * Math.sin(t * 31);
             flex[0].rotation.z = -k; flex[1].rotation.z = k;
             if (b > 0) {                                   // buffet: the airframe shakes as the wing nears the stall
               const a = (P.stall ? 0.035 : 0.018 * b) * (reducedMotionPref() ? 0.3 : 1);
               g.quaternion.multiply(shake.setFromEuler(e.set(Math.sin(t * 23) * a, 0, Math.sin(t * 29 + 1) * a * 1.4)));
             }
             // HUD: speed red while warning, a STALL badge while stalled (css/sailplane.css)
             if ((b > 0) !== warnOn) cls.toggle('is-stall-warn', warnOn = b > 0);
             if (!!P.stall !== stallOn) cls.toggle('is-stall', stallOn = !!P.stall);
           } };
}
const reducedMotionPref = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// variometer: short soft beeps while climbing, higher and quicker the faster the climb; quiet otherwise. Near the stall
// the stall warner takes over: low quick beeps that speed up, and a fast low warble while stalled.
function createVario(ctx, out) {
  const osc = ctx.createOscillator(), lp = ctx.createBiquadFilter(), gain = ctx.createGain();
  osc.type = 'triangle'; osc.frequency.value = 600;
  lp.type = 'lowpass'; lp.frequency.value = 1800;
  gain.gain.value = 0;
  osc.connect(lp).connect(gain).connect(out); osc.start();
  let next = 0;
  return {
    update(climb, level) {
      const t = ctx.currentTime, warn = SAIL_FX.warn;
      if (!(level > 0) || (climb < TUNE.VARIO_ON && !(warn > 0))) { next = 0; return; }   // a beep already scheduled just plays out
      let f, period, on, vol;
      if (warn > 0) {                                       // stall warner
        f = SAIL_FX.stall ? 300 : 380; period = SAIL_FX.stall ? 0.09 : lerp(0.3, 0.13, warn); on = period * 0.55;
        vol = 0.05 * level * (SAIL_FX.stall ? 1.2 : 0.7 + 0.3 * warn);
      } else {
        const c = clamp(climb, 0, 9);
        f = 560 + c * 62; period = lerp(0.62, 0.2, c / 9); on = period * 0.42; vol = 0.045 * level * (0.8 + 0.2 * c / 9);
      }
      osc.frequency.setTargetAtTime(f, t, 0.04);
      if (next < t) next = t + 0.02;
      while (next < t + 0.1) {                              // schedule the beeps starting in the next 0.1 s
        const g = gain.gain;
        g.setValueAtTime(0, next); g.linearRampToValueAtTime(vol, next + 0.012);
        g.setValueAtTime(vol, next + on - 0.02); g.linearRampToValueAtTime(0, next + on);
        next += period;
      }
    },
  };
}

// thermal scenery: a faint shimmering column, specks drifting up in a spiral, birds circling near the top, a cumulus cap
const ThermalScenery = (() => {
  const U = { thTime: { value: 0 } };
  const tick = () => { U.thTime.value = (performance.now() / 1000) % 10000; };
  let streakTex = null, fadeTex = null, dotTex = null;
  function textures() {
    if (streakTex) return;
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const x = c.getContext('2d'), rand = mulberry32(77);
    for (let i = 0; i < 26; i++) {                          // thin wavy streaks
      const x0 = rand() * 128, a = 0.25 + rand() * 0.6, w = 1 + rand() * 2.5;
      x.strokeStyle = `rgba(255,255,255,${a.toFixed(2)})`; x.lineWidth = w; x.beginPath();
      for (let y = 0; y <= 256; y += 8) { const xx = x0 + Math.sin(y / 256 * TAU * 2 + i) * 5; if (y) x.lineTo(xx, y); else x.moveTo(xx, y); }
      x.stroke();
    }
    streakTex = new THREE.CanvasTexture(c); streakTex.wrapS = streakTex.wrapT = THREE.RepeatWrapping; streakTex.repeat.set(4, 2.5);
    const f = document.createElement('canvas'); f.width = 4; f.height = 64;
    const fx = f.getContext('2d'), gr = fx.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, '#000'); gr.addColorStop(0.3, '#fff'); gr.addColorStop(0.75, '#bbb'); gr.addColorStop(1, '#000');   // top .. bottom
    fx.fillStyle = gr; fx.fillRect(0, 0, 4, 64);
    fadeTex = new THREE.CanvasTexture(f);
    const d = document.createElement('canvas'); d.width = d.height = 32;
    const dx = d.getContext('2d'), rg = dx.createRadialGradient(16, 16, 1, 16, 16, 16);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.45, 'rgba(255,255,255,0.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    dx.fillStyle = rg; dx.fillRect(0, 0, 32, 32);
    dotTex = new THREE.CanvasTexture(d);
  }

  function build(group) {
    const T = thermalList();
    if (!T.length) return;
    textures();
    const rand = mulberry32(COURSE.seeds.trees * 3 + 11);
    // columns: one open cylinder each, its streaks scrolling up
    const colMat = new THREE.MeshBasicMaterial({ color: '#fff6dc', map: streakTex, alphaMap: fadeTex, transparent: true, opacity: 0.2,
      depthWrite: false, side: THREE.DoubleSide });
    for (const t of T) {
      const H = t.top - t.base + 20;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.55, t.r * 0.62, H, 28, 1, true), colMat);
      m.position.set(t.x, t.base + H / 2 - 10, t.z);
      m.onBeforeRender = () => { streakTex.offset.y = -(performance.now() / 1000) * 0.06; };
      m.renderOrder = 2;
      group.add(m);
    }
    // specks: each spirals up its column and starts again at the bottom
    const n = 110, pos = [], prm = [], hh = [];
    for (const t of T) for (let i = 0; i < n; i++) {
      pos.push(t.x, t.base, t.z);
      prm.push(rand() * TAU, t.r * (0.12 + 0.5 * Math.sqrt(rand())), rand(), 0.05 + rand() * 0.04);
      hh.push(t.top - t.base);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    pg.setAttribute('aPrm', new THREE.Float32BufferAttribute(prm, 4));
    pg.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1));
    const pm = new THREE.PointsMaterial({ color: '#fffdf2', map: dotTex, size: 2.6, transparent: true, opacity: 0.85, depthWrite: false });
    pm.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'uniform float thTime;\nattribute vec4 aPrm;\nattribute float aH;\nvarying float vFade;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        `float u = fract( aPrm.z + thTime * aPrm.w );
        float a = aPrm.x + thTime * 0.3 + u * 5.0;
        vec3 transformed = position + vec3( cos( a ) * aPrm.y, u * aH, sin( a ) * aPrm.y );
        vFade = smoothstep( 0.0, 0.12, u ) * ( 1.0 - smoothstep( 0.8, 1.0, u ) );`);
      sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('#include <premultiplied_alpha_fragment>', 'gl_FragColor.a *= vFade;\n#include <premultiplied_alpha_fragment>');
    };
    pm.customProgramCacheKey = () => 'thermal-specks';
    const pts = new THREE.Points(pg, pm);
    pts.frustumCulled = false; pts.onBeforeRender = tick; pts.renderOrder = 3;
    group.add(pts);
    // birds: a few big soaring birds circling each column near the top, flapping now and then
    const bp = [], bc = [], bb = [];
    const wing = [[0, 0, 0.35], [-1.6, 0.25, -0.1], [-0.4, 0, -0.35], [0, 0, 0.35], [0.4, 0, -0.35], [1.6, 0.25, -0.1], [0, 0, 0.35], [0, 0, -0.6], [-0.4, 0, -0.35], [0, 0, 0.35], [0.4, 0, -0.35], [0, 0, -0.6]];
    for (const t of T) for (let k = 0; k < 3; k++) {
      const R = 26 + rand() * 30, y = t.top - 60 + rand() * 70, ph = rand() * TAU, sp = (0.28 + rand() * 0.1) * (rand() < 0.5 ? -1 : 1), s = 1.6 + rand() * 0.5;
      for (const v of wing) { bp.push(v[0] * s, v[1] * s, v[2] * s); bc.push(t.x, y, t.z); bb.push(R, ph, sp, rand() * TAU); }
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    bg.setAttribute('aCtr', new THREE.Float32BufferAttribute(bc, 3));
    bg.setAttribute('aBird', new THREE.Float32BufferAttribute(bb, 4));
    const bm = new THREE.MeshBasicMaterial({ color: '#2b2a28', side: THREE.DoubleSide });
    bm.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'uniform float thTime;\nattribute vec3 aCtr;\nattribute vec4 aBird;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        `float a = aBird.y + thTime * aBird.z;
        float flap = sin( thTime * 9.0 + aBird.w ) * smoothstep( 0.75, 0.95, sin( thTime * 0.45 + aBird.w ) );
        vec3 p = position; p.y += abs( p.x ) * flap * 0.5;
        float hd = a - sign( aBird.z ) * 1.5707963;           // heading: along the circle
        float bank = sign( aBird.z ) * 0.35;                 // into the turn
        p = vec3( p.x * cos( bank ) - p.y * sin( bank ), p.x * sin( bank ) + p.y * cos( bank ), p.z );
        vec3 fwd = vec3( -sin( hd ), 0.0, -cos( hd ) ), rgt = vec3( cos( hd ), 0.0, -sin( hd ) );
        vec3 transformed = aCtr + vec3( sin( a ), 0.0, cos( a ) ) * aBird.x + rgt * p.x + vec3( 0.0, p.y, 0.0 ) + fwd * p.z;`);
    };
    bm.customProgramCacheKey = () => 'thermal-birds';
    const birds = new THREE.Mesh(bg, bm);
    birds.frustumCulled = false; birds.onBeforeRender = tick;
    group.add(birds);
    // cumulus caps: puffs for js/clouds.js to shape (tagged like js/game.js's), base 45 m over the top
    const puffs = [];
    for (const t of T) {
      const size = 0.28 * t.r, cnt = 7 + Math.floor(rand() * 3);
      for (let i = 0; i < cnt; i++) {
        const a = rand() * TAU, d = Math.sqrt(rand()) * t.r * 0.55, s = size * (0.7 + rand() * 0.5);
        puffs.push([t.x + Math.cos(a) * d, t.top + 45 + s * 0.35 + rand() * size * 0.5, t.z + Math.sin(a) * d * 0.8, s]);
      }
    }
    const cm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#aab9c6' }), puffs.length);
    const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    puffs.forEach((pf, i) => { q.setFromEuler(e.set(0, rand() * TAU, 0)); cm.setMatrixAt(i, mx.compose(p.set(pf[0], pf[1], pf[2]), q, s.set(pf[3], pf[3] * 0.62, pf[3]))); });
    cm.userData.clouds = true;                              // js/clouds.js reshapes and relights tagged puffs
    cm.frustumCulled = false; group.add(cm);
  }
  // first in line, so js/clouds.js (a later plugin) shapes the cumulus puffs like every other cloud
  if (typeof SCENERY_PLUGINS !== 'undefined') SCENERY_PLUGINS.unshift(build);
  return { uniforms: U };
})();
