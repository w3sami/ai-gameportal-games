'use strict';
/* =========================================================================
   JETWING — the Cityscape theme's flyer (FLIGHT_MODEL 'jetwing'): a rigid carbon wing strapped to the pilot's back,
   two small jet turbines under it (the real "jetman" rig). A point mass with lift and drag like the wingsuit
   (js/glide.js), with two differences: the wing is stiff and glides better, and Boost spools the turbines up.
     jets off  it glides: the stick's centre is the best glide, up flattens it and, with speed to spare, zooms above
               the horizon (paid for with speed), down dives
     jets on   thrust: the stick's centre holds height, up climbs at up to CLIMB_MAX, down dives; it pulls up and
               noses over far quicker than the fighter, though it's slower
   On the jets it's free to roll and loop (JET_FREE): the attitude core of the stunt plane and biplane (js/sim.js
   stepFlight's body rates, attitude() and assist(); touch and the controller through js/aerobatic.js's aeroStick, so
   the stick's side banks, its end the steepest bank (ROLL_EDGE false); its up/down asks for a climb angle (centre:
   level, held through a bank, so a turn keeps its height) until the end of its throw, where it becomes the elevator
   and a full pull loops; let go and it levels out), with this wing's own thrust, drag and gravity (less of it going up: JET_CLIMB; and FREE_CLIMB
   lets the stick hold a climb up to near vertical). The path follows the nose (GRIP) as the stunt plane's does.
   Jets off it's back to the glide above, picked up from wherever the jets left it (upside down it rolls upright).
   The boost meter is the fuel: it drains only while the jets burn (BOOST_DRAIN) and every hoop fills it (BOOST_HOOP;
   1 = full), so a course is mostly flown on the jets with a glide at the end of the longer legs.
   The stick asks for a bank and a path angle; the wing does what its lift allows, so a slow zoom runs out of lift and
   the nose falls through on its own. The spool (0..1) rides in P.tuck, which the replay records, so replays and
   ghosts show the jets lit. Uses sim.js and glide.js helpers (shapeCoef); no DOM.
   ========================================================================= */
const JETWING_DEFAULTS = {
  THRUST: 0.55,          // thrust at full spool, in g
  SPOOL_UP: 3, SPOOL_DOWN: 1.8,   // how fast the turbines spool (full swing per second)
  CLIMB_MAX: 0.85,       // steepest climb the stick asks for with the jets on (rad)
  FREE_CLIMB: 0,         // ... when free to roll and loop (JET_FREE): the steepest climb the stick holds short of the
                         // end of its throw (rad; 0: CLIMB_MAX), so a near-vertical climb can be held, not just looped
  JET_CLIMB: 0,          // climb assist (arcade): the share of gravity along a climbing path the jets cancel at full
                         // spool, so going up costs little speed while level flight, acceleration and top speed don't change
  ZOOM_MAX: 0.5,         // ... and off: a zoom on spare speed (rad); mouse aim only zooms above ZOOM_SPEED
  ZOOM_SPEED: 50,        // m/s
  JET_DIVE: 1.0,         // steepest dive the stick asks for (rad)
  CL_MAX: 2.4,           // most lift the wing pulls with when fast, as a share of what holds level flight at
                         // LEVEL_SPEED (arcade); it falls to 1 by LEVEL_SPEED, so a slow wing stalls honestly
  PULL_DRAG: 0.35,       // share of the induced drag a manoeuvre costs over what holding the path would (arcade: a
                         // hard pull-up doesn't bleed half the speed); steady flight keeps the full glide polar
  JET_TURN: 1.8,         // arcade turn gain over a true coordinated turn
  JET_ROLL_P: 6, JET_ROLL_RATE: 3.2,   // bank loop (1/s) and roll rate limit (rad/s)
  JET_FREE: true,        // on the jets: roll and loop freely (below); false keeps the glide's controls on the jets too
  JET_GRIP: 6,           // on the jets: how fast the path swings to the nose (1/s)
  RESPAWN_BOOST: null,   // back at a hoop after a crash, the meter is at least this (config/jetwing.json: 1, the hoop's own
                         // refill); null leaves it as it was, as for every other vehicle
};
Object.assign(TUNE, JETWING_DEFAULTS);
Object.assign(TUNE_DEFAULTS, JETWING_DEFAULTS);
const jetwinging = () => TUNE.FLIGHT_MODEL === 'jetwing';

function initJetwing(P) {
  const gam = pitchOf(P.vdir), s = shapeCoef(TUNE.LEVEL_SPEED, TUNE.TRIM_SPEED, TUNE.GLIDE_RATIO);
  const q = TUNE.G * s.a * P.speed * P.speed;
  P.glide = { gam, psi: yawOf(P.vdir), phi: 0, cl: clamp(TUNE.G * Math.cos(gam) / Math.max(q, 1e-3), 0, 1), th: 0, psiDot: 0, ae: s };
}

const _jq = new THREE.Quaternion(), _jm = new THREE.Matrix4(), _jz = new THREE.Vector3(), _jx = new THREE.Vector3(1, 0, 0);
const _jzAxis = new THREE.Vector3(0, 0, 1);
// ctl as for stepFlight: att {bank, climb} (touch, letting go), aim (mouse, autopilot), or manual p/r (keys, pad)
function stepJetwing(P, ctl, dt) {
  if (!P.glide || P.glide.ae == null) initJetwing(P);
  const S = P.glide, G = TUNE.G, ae = S.ae;

  // fuel and spool: the meter drains while the jets burn, locks when dry until it's back over a fifth
  const want = !!ctl.boost && !P.boostLock && P.boost > 0;
  P.boosting = want;
  if (want) { P.boost = Math.max(0, P.boost - TUNE.BOOST_DRAIN * dt); if (P.boost === 0) P.boostLock = true; }
  else { P.boost = Math.min(1, P.boost + TUNE.BOOST_REGEN * dt); if (P.boostLock && P.boost > 0.2) P.boostLock = false; }
  S.th += clamp((want ? 1 : 0) - S.th, -TUNE.SPOOL_DOWN * dt, TUNE.SPOOL_UP * dt);
  const th = S.th, v = P.speed;
  P.tuck = th;

  if (TUNE.JET_FREE && want) { if (!S.free) toFree(P, S); stepJetsFree(P, ctl, dt, S, th); return; }
  if (S.free) toGlide(P, S);
  // what the stick asks for: centre = best glide off, level on; up = zoom off, climb on
  const trim = lerp(ae.gam, 0, th), up = lerp(TUNE.ZOOM_MAX, TUNE.CLIMB_MAX, th), dive = TUNE.JET_DIVE;
  const pathFor = (c) => (c >= 0 ? lerp(trim, up, Math.min(c, 1)) : lerp(trim, -dive, Math.min(-c, 1)));
  let bankT, gamT;
  if (ctl.att) { bankT = ctl.att.bank; gamT = pathFor(ctl.att.climb); }
  else if (ctl.aim) {                                        // aim: bank toward its heading, fly its path angle
    const he = wrapAngle(yawOf(ctl.aim) - S.psi) - TUNE.ASSIST_LEAD * S.psiDot;   // + = aim to the left
    bankT = clamp(-he * TUNE.BANK_GAIN, -TUNE.MAX_BANK, TUNE.MAX_BANK);
    const zoom = TUNE.ZOOM_MAX * smoothstep(TUNE.ZOOM_SPEED, TUNE.ZOOM_SPEED + 20, v);   // no stalling it by aiming high
    gamT = clamp(pitchOf(ctl.aim), -dive, lerp(zoom, TUNE.CLIMB_MAX, th));
  } else { bankT = clamp(ctl.r, -1, 1) * TUNE.TOUCH_BANK; gamT = pathFor(clamp(ctl.p, -1, 1)); }

  S.phi += clamp((bankT - S.phi) * TUNE.JET_ROLL_P, -TUNE.JET_ROLL_RATE, TUNE.JET_ROLL_RATE) * dt;
  const q = G * ae.a * v * v, cphi = Math.cos(S.phi), cg = Math.cos(S.gam);
  // lift for the commanded path change, as far as the wing allows
  const gdotCmd = clamp((gamT - S.gam) * TUNE.GAMMA_P, -TUNE.GAMMA_RATE_DOWN, TUNE.GAMMA_RATE);
  const need = (v * gdotCmd + G * cg) / Math.max(cphi, 0.2);
  const clMax = lerp(1, TUNE.CL_MAX, smoothstep(TUNE.LEVEL_SPEED, TUNE.LEVEL_SPEED * 1.6, v));
  S.cl += (clamp(need / q, TUNE.CL_MIN, clMax) - S.cl) * damp(TUNE.CL_K, dt);
  const cl0 = Math.min(G * cg / q, clMax), cl2 = cl0 * cl0 + TUNE.PULL_DRAG * (S.cl * S.cl - cl0 * cl0);   // see PULL_DRAG
  const L = q * S.cl, D = G * ae.a * v * v * (ae.cd0 + ae.k * cl2) + G * Math.pow(v / TUNE.VMAX, 12);
  let gdot = (L * cphi - G * cg) / v;
  if (gdotCmd < 0 && gdot > gdotCmd) gdot = gdotCmd;         // nosing over: as fast as asked (a push adds no energy)
  S.psiDot = -L * Math.sin(S.phi) / (v * Math.max(cg, 0.2)) * TUNE.JET_TURN;   // right bank turns right
  P.speed = Math.max(TUNE.MIN_SPEED, v + (TUNE.THRUST * G * th - D - G * Math.sin(S.gam)) * dt);
  S.gam = clamp(S.gam + gdot * dt, -1.5, 1.45);
  S.psi = wrapAngle(S.psi + S.psiDot * dt);

  dirFromYawPitch(S.psi, S.gam, P.vdir);
  P.pos.addScaledVector(P.vdir, P.speed * dt);
  // body: along the path, banked, nose up by an angle of attack that grows with lift
  P.q.setFromRotationMatrix(_jm.lookAt(_jz.set(0, 0, 0), P.vdir, WORLD_UP));
  P.q.multiply(_jq.setFromAxisAngle(_jzAxis, -S.phi)).multiply(_jq.setFromAxisAngle(_jx, TUNE.ALPHA_VIS * clamp(S.cl, 0, 1.3)));
  P.bank = S.phi; P.turn = S.psiDot; P.rp = P.ry = P.rr = 0;
  P.gload = lerp(P.gload, Math.abs(L) / G, damp(6, dt));
}

/* ---------- on the jets: free to roll and loop ---------- */
const _jf = new THREE.Vector3(), _jw = new THREE.Vector3(), _jdq = new THREE.Quaternion(), _jax = new THREE.Vector3();
function toFree(P, S) {                                      // from the glide: its attitude is already P.q
  S.free = true; P.rp = P.rr = P.ry = 0;
}
function toGlide(P, S) {                                     // jets off: carry on gliding from the same path and bank
  S.free = false;
  S.gam = clamp(pitchOf(P.vdir), -1.5, 1.45); S.psi = yawOf(P.vdir); S.psiDot = 0;
  S.phi = computeBank(P, forwardOf(P, _jf)).bank;           // upside down: +-PI, and the glide rolls it upright
  const q = TUNE.G * S.ae.a * P.speed * P.speed;
  S.cl = clamp(TUNE.G * Math.cos(S.gam) / Math.max(q, 1e-3), 0, 1);
}
// the stick's up/down short of the end of its throw (-1..1) to the climb angle to hold: down dives at up to CLIMB_MAX;
// up climbs at CLIMB_MAX at the end, or with FREE_CLIMB, steepening over the last of the throw to that (the middle of it
// much as without), so a near-vertical climb can be held without the climbs short of it getting twitchier
function freeClimb(s) {
  const k = TUNE.CLIMB_MAX, top = TUNE.FREE_CLIMB || k;
  return s <= 0 ? s * k : k * s + (top - k) * s * s * s;
}
function stepJetsFree(P, ctl, dt, S, th) {
  const G = TUNE.G, ae = S.ae, v = P.speed, f = forwardOf(P, _jf);
  const { bank, horiz } = computeBank(P, f);
  P.bank = bank;
  const auth = clamp(v / TUNE.CRUISE, 0.3, 1.15);
  // let go: level out at level flight (a glide's stick fraction is a climb here, of up to CLIMB_MAX)
  let c = ctl.att ? attitude(P, f, bank, ctl.att.bank, freeClimb(ctl.att.climb)) : ctl.aim ? assist(P, f, bank, horiz, ctl.aim, auth) : ctl;
  if (!ctl.att && !ctl.aim && Math.abs(ctl.p) <= TUNE.OD_THRESH) {
    // the stick short of the end of its throw: a climb angle to hold (whatever the bank), not a pitch rate, so a thumb
    // that wanders a little doesn't send the nose wandering; past it, the elevator (keys are always all the way)
    const a = attitude(P, f, bank, bank, freeClimb(ctl.p / TUNE.OD_THRESH));
    c = { p: a.p, y: a.y + (ctl.y || 0), r: ctl.r };
  }
  if (ctl.rollTo != null) c = { p: c.p, y: c.y, r: clamp(wrapAngle(ctl.rollTo - bank) * TUNE.ROLL_P * 1.6, -1, 1) };
  const k = damp(TUNE.RATE_K, dt);
  P.rp += (c.p * TUNE.MAX_PITCH * auth - P.rp) * k;
  P.rr += (c.r * TUNE.MAX_ROLL * auth - P.rr) * k;
  P.ry += (c.y * TUNE.MAX_YAW * auth - P.ry) * k;
  _jw.set(P.rp, -P.ry, -P.rr);
  const wl = _jw.length();
  if (wl > 1e-7) { _jdq.setFromAxisAngle(_jw.multiplyScalar(1 / wl), wl * dt); P.q.multiply(_jdq); }
  const turn = -bankTurn(P, bank, horiz, auth);              // bank-to-turn (faded on edge and while rolling on)
  P.turn = turn;
  if (turn !== 0) { _jdq.setFromAxisAngle(WORLD_UP, turn * dt); P.q.premultiply(_jdq); }
  // too slow to fly (over the top of a loop run out of speed): the path sags and the nose follows it down
  const sink = clamp((TUNE.LEVEL_SPEED - v) / (TUNE.LEVEL_SPEED * 0.4), 0, 1);
  forwardOf(P, f);
  const dfv = clamp(f.dot(P.vdir), -1, 1);
  if (dfv < 0.999999) {
    _jax.crossVectors(f, P.vdir);
    const al = _jax.length();
    if (al > 1e-7) { _jdq.setFromAxisAngle(_jax.divideScalar(al), Math.acos(dfv) * damp(TUNE.WEATHERVANE + 2 * sink, dt)); P.q.premultiply(_jdq); }
  }
  P.q.normalize();
  // energy: thrust, gravity along the path, drag; the lift that bends the path costs induced drag as in the glide
  forwardOf(P, f);
  const q = G * ae.a * v * v, cg = Math.sqrt(Math.max(0, 1 - P.vdir.y * P.vdir.y));
  const L = G * cg * Math.abs(Math.cos(bank)) + v * (Math.abs(P.rp) + Math.abs(turn) * cg);
  const cl = Math.min(L / Math.max(q, 1e-3), TUNE.CL_MAX), cl0 = Math.min(G * cg / Math.max(q, 1e-3), 1);
  const D = G * ae.a * v * v * (ae.cd0 + ae.k * (cl0 * cl0 + TUNE.PULL_DRAG * Math.max(0, cl * cl - cl0 * cl0))) + G * Math.pow(v / TUNE.VMAX, 12);
  const up = P.vdir.y > 0 ? 1 - TUNE.JET_CLIMB * th : 1;     // climb assist: the jets take some of gravity going up
  P.speed = Math.max(TUNE.MIN_SPEED, v + (TUNE.THRUST * G * th - D - G * P.vdir.y * up) * dt);
  P.vdir.lerp(f, damp(TUNE.JET_GRIP * clamp(v / TUNE.LEVEL_SPEED, 0.3, 1.2), dt)).normalize();
  if (sink > 0) {                                            // gravity takes the path, not the jets
    _jw.copy(P.vdir).multiplyScalar(P.speed); _jw.y -= G * sink * dt;
    P.speed = _jw.length(); P.vdir.copy(_jw).divideScalar(P.speed);
  }
  P.pos.addScaledVector(P.vdir, P.speed * dt);
  S.cl = cl;
  P.gload = lerp(P.gload, L / G, damp(6, dt));
}
