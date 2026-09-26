'use strict';
/* =========================================================================
   GLIDE MODEL — the wingsuit (FLIGHT_MODEL 'glide'). No engine: a point mass with lift and drag, so speed only comes
   from height. Boost tucks the arms and legs in: less wing, less drag, a steeper glide and more speed.
   The path angle never goes above level: pulling up can only flatten the glide, and only while there is speed for it
   (level flight needs lift = weight, and the most lift the suit makes grows with speed squared).
   The stick asks for a bank and a path angle; the suit does what its lift allows. Uses sim.js helpers; no DOM.
   ========================================================================= */
const GLIDE_DEFAULTS = {
  FLIGHT_MODEL: 'plane',
  // each shape (spread, tucked) is set by three numbers the coefficients are derived from: LEVEL_SPEED, the slowest
  // speed that still holds level flight wings level; TRIM_SPEED, the speed of its best glide; GLIDE_RATIO, that glide
  TRIM_SPEED: 42, LEVEL_SPEED: 36, GLIDE_RATIO: 3.0,
  TUCK_TRIM_SPEED: 110, TUCK_LEVEL_SPEED: 100, TUCK_GLIDE_RATIO: 2.2,
  TUCK_PATH: 0.7,                // tucked, the stick's centre asks for this dive (rad) instead of the best glide
  TUCK_IN: 3, TUCK_OUT: 2,       // how fast the shape changes (full swing per second)
  DIVE_MAX: 0.75,                // steepest path angle the stick asks for (rad); level is the shallowest
  GAMMA_P: 2.2, GAMMA_RATE: 0.6, // path-angle loop gain (1/s) and fastest commanded change (rad/s)
  CL_MIN: -0.2, CL_K: 10,        // lift coefficient range (1 = the most the shape makes) and how fast it follows
  GLIDE_ROLL_P: 3, GLIDE_ROLL_RATE: 1.8,   // bank loop (1/s) and roll rate limit (rad/s)
  GLIDE_TURN: 1.5,               // arcade turn gain over a true coordinated turn (turning does no work, so no free energy)
  ALPHA_VIS: 0.2,                // how far the body pitches above its path at full lift (rad, looks only)
  RESPAWN_SPEED: 0,              // speed after a crash, back at the last hoop (m/s; that hoop's pass speed if faster); 0 = CRUISE
};
Object.assign(TUNE, GLIDE_DEFAULTS);
Object.assign(TUNE_DEFAULTS, GLIDE_DEFAULTS);
const gliding = () => TUNE.FLIGHT_MODEL === 'glide';

// lift = G·a·v²·CL, drag = G·a·v²·(cd0 + k·CL²); best glide 1/(2√(cd0·k)) at CL √(cd0/k), met at TRIM_SPEED
function shapeCoef(Vl, Vt, E) {
  const cl = Math.cos(Math.atan(1 / E)) * (Vl / Vt) * (Vl / Vt);
  return { a: 1 / (Vl * Vl), cd0: cl / (2 * E), k: 1 / (2 * E * cl), gam: -Math.atan(1 / E) };
}
const _ae = { a: 0, cd0: 0, k: 0, gam: 0 };
function glideAero(T) {
  const s = shapeCoef(TUNE.LEVEL_SPEED, TUNE.TRIM_SPEED, TUNE.GLIDE_RATIO);
  const t = shapeCoef(TUNE.TUCK_LEVEL_SPEED, TUNE.TUCK_TRIM_SPEED, TUNE.TUCK_GLIDE_RATIO);
  _ae.a = lerp(s.a, t.a, T); _ae.cd0 = lerp(s.cd0, t.cd0, T); _ae.k = lerp(s.k, t.k, T);
  _ae.gam = lerp(s.gam, -TUNE.TUCK_PATH, T);                // stick centre: best glide spread, a dive tucked
  return _ae;
}

// state lives in P.glide; placePlane clears it and the next step starts from the plane's velocity
function initGlide(P) {
  const gam = Math.min(0, pitchOf(P.vdir)), ae = glideAero(0), q = TUNE.G * ae.a * P.speed * P.speed;
  P.glide = { gam, psi: yawOf(P.vdir), phi: 0, cl: clamp(TUNE.G * Math.cos(gam) / Math.max(q, 1e-3), 0, 1), tuck: 0, psiDot: 0 };
}

// stick climb (-1..1) to a path angle: centre = trim (best glide, or TUCK_PATH tucked), up = level, down = DIVE_MAX
function stickPath(c, trim) {
  c = clamp(c, -1, 1);
  return c >= 0 ? lerp(trim, 0, c) : lerp(trim, -TUNE.DIVE_MAX, -c);
}

const _gq = new THREE.Quaternion(), _gm = new THREE.Matrix4(), _gz = new THREE.Vector3(), _gx = new THREE.Vector3(1, 0, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
// ctl as for stepFlight: att {bank, climb} (touch, letting go), aim (mouse, autopilot), or manual p/r (keys, pad)
function stepGlide(P, ctl, dt) {
  if (!P.glide) initGlide(P);
  const S = P.glide, G = TUNE.G;
  S.tuck += clamp((ctl.boost ? 1 : 0) - S.tuck, -TUNE.TUCK_OUT * dt, TUNE.TUCK_IN * dt);
  P.tuck = S.tuck; P.boosting = !!ctl.boost; P.boost = 1; P.boostLock = false;   // no meter: height is the cost
  const ae = glideAero(S.tuck);

  let bankT, gamT;
  if (ctl.att) { bankT = ctl.att.bank; gamT = stickPath(ctl.att.climb, ae.gam); }
  else if (ctl.aim) {                                        // aim: bank toward its heading, glide at its angle
    const he = wrapAngle(yawOf(ctl.aim) - S.psi) - TUNE.ASSIST_LEAD * S.psiDot;   // + = aim to the left
    bankT = clamp(-he * TUNE.BANK_GAIN, -TUNE.MAX_BANK, TUNE.MAX_BANK);
    gamT = clamp(pitchOf(ctl.aim), -TUNE.DIVE_MAX, 0);
  } else { bankT = clamp(ctl.r, -1, 1) * TUNE.TOUCH_BANK; gamT = stickPath(ctl.p, ae.gam); }

  S.phi += clamp((bankT - S.phi) * TUNE.GLIDE_ROLL_P, -TUNE.GLIDE_ROLL_RATE, TUNE.GLIDE_ROLL_RATE) * dt;
  const v = P.speed, q = G * ae.a * v * v, cphi = Math.cos(S.phi);
  // lift for the commanded path-angle change, as far as the shape allows
  const gdotCmd = clamp((gamT - S.gam) * TUNE.GAMMA_P, -TUNE.GAMMA_RATE, TUNE.GAMMA_RATE);
  const need = (v * gdotCmd + G * Math.cos(S.gam)) / Math.max(cphi, 0.2);
  S.cl += (clamp(need / q, TUNE.CL_MIN, 1) - S.cl) * damp(TUNE.CL_K, dt);
  const L = q * S.cl, D = G * ae.a * v * v * (ae.cd0 + ae.k * S.cl * S.cl);
  const gdot = (L * cphi - G * Math.cos(S.gam)) / v;
  S.psiDot = -L * Math.sin(S.phi) / (v * Math.max(Math.cos(S.gam), 0.2)) * TUNE.GLIDE_TURN;   // right bank turns right
  P.speed = Math.max(TUNE.MIN_SPEED, v - (D + G * Math.sin(S.gam)) * dt);
  S.gam = clamp(S.gam + gdot * dt, -1.5, 0);                // never above level: no height is ever gained
  S.psi = wrapAngle(S.psi + S.psiDot * dt);

  dirFromYawPitch(S.psi, S.gam, P.vdir);
  P.pos.addScaledVector(P.vdir, P.speed * dt);
  // body: along the path, banked, nose up by an angle of attack that grows with lift
  P.q.setFromRotationMatrix(_gm.lookAt(_gz.set(0, 0, 0), P.vdir, WORLD_UP));
  P.q.multiply(_gq.setFromAxisAngle(_zAxis, -S.phi)).multiply(_gq.setFromAxisAngle(_gx, TUNE.ALPHA_VIS * clamp(S.cl, 0, 1)));
  P.bank = S.phi; P.turn = S.psiDot; P.rp = P.ry = P.rr = 0;
  P.gload = lerp(P.gload, Math.abs(L) / G, damp(6, dt));
}
