// The car: a rigid body on four spring legs, and the wheels at their ends.
// World axes: x = towards the nose, y = up, z = towards the camera side.
// Corner order everywhere: 0 rear-far, 1 front-far, 2 rear-near, 3 front-near.
// The legs are driven by lanes, the game's eight inputs: q e a d stretch one
// leg each (corners 0 1 2 3), w and s spread the front and rear axle, squat
// shortens every leg and stretch lengthens every leg.

export const G = 20;                 // gravity; heavier than real so the motion snaps
export const BODY_MASS = 1;
const PITCH_INERTIA = 0.7;
const ROLL_INERTIA = 0.34;
const WHEEL_MASS = 0.08;
export const AXLE_X = 1.15;          // wheel x from the body centre
export const BODY_HALF_W = 0.8;
export const WHEEL_Z = 1.3;          // wheel centre z; outside the body so the legs show
export const WHEEL_R = 0.4;
export const WHEEL_W = 0.34;
export const REST_LEN = 0.6;         // ground clearance a relaxed leg aims for
const SQUAT_LEN = 0.2;
const MIN_LEN = 0.15;                // bump stop
const BUMP_K = 3000;
const BUMP_C = 20;
const SPREAD_OUT = 0.9;              // how far a spread axle pushes its wheels sideways
const SPREAD_DROP = 0.3;             // a splayed leg reaches less far down
const MAX_PITCH = 0.7;
const MAX_ROLL = 0.55;
export const STEP = 1 / 600;         // physics step; the bump stops need it this small

export const CORNERS = [
  { x: -AXLE_X, z: -1, front: false, lane: 'q' },
  { x: AXLE_X, z: -1, front: true, lane: 'e' },
  { x: -AXLE_X, z: 1, front: false, lane: 'a' },
  { x: AXLE_X, z: 1, front: true, lane: 'd' },
];

// The player's suspension. Each key is also the id of its slider in index.html.
export const tune = { frontLen: 0.9, frontLoose: 0.5, rearLen: 0.9, rearLoose: 0.5, kick: 6 };

export function bindTune() {
  for (const key of Object.keys(tune)) {
    const el = document.getElementById(key);
    el.addEventListener('input', () => { tune[key] = +el.value; });
    tune[key] = +el.value;
  }
}

// Looseness 0..1 maps to a stiff, well damped leg at 0 and a soft, ringing one at 1.
function legSpring(loose) {
  const k = 420 * Math.pow(45 / 420, loose);
  const zeta = 0.55 + (0.12 - 0.55) * loose;
  return { k, c: 2 * zeta * Math.sqrt(k * BODY_MASS / 4) };
}

export const car = {
  y: REST_LEN, vy: 0, pitch: 0, vPitch: 0, roll: 0, vRoll: 0, yaw: 0, vYaw: 0,
  squash: 0, vSquash: 0,          // body stretch along y, volume preserving
  cabPitch: 0, vCabPitch: 0, cabRoll: 0, vCabRoll: 0,   // cabin lags the body
  wheels: CORNERS.map(() => ({ h: 0, vh: 0, len: REST_LEN, load: 0, squash: 0 })),
  spread: [{ s: 0, v: 0 }, { s: 0, v: 0 }],   // front axle, rear axle; 0 = wheels in, 1 = out
  antenna: { p: [0, 2.6, 0], v: [0, 0, 0] },
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function axleSpread(i) { return car.spread[CORNERS[i].front ? 0 : 1].s; }
export function wheelZ(i) { return CORNERS[i].z * (WHEEL_Z + SPREAD_OUT * axleSpread(i)); }

// One physics step. lanes: { q, e, a, d, w, s, squat, stretch } booleans.
export function step(dt, lanes) {
  const front = legSpring(tune.frontLoose);
  const rear = legSpring(tune.rearLoose);
  const sinP = Math.sin(car.pitch), cosP = Math.cos(car.pitch);
  const sinR = Math.sin(car.roll), cosR = Math.cos(car.roll);
  let force = 0, torqueP = 0, torqueR = 0, bump = 0;

  // Underdamped on purpose: the wheels overshoot and wobble as they go out.
  const spreadGoal = [lanes.w ? 1 : 0, lanes.s ? 1 : 0];
  for (let a = 0; a < 2; a++) {
    const sp = car.spread[a];
    sp.v += ((spreadGoal[a] - sp.s) * 300 - 16 * sp.v) * dt;
    sp.s += sp.v * dt;
  }

  for (let i = 0; i < 4; i++) {
    const c = CORNERS[i];
    const w = car.wheels[i];
    const spring = c.front ? front : rear;
    const stroke = c.front ? tune.frontLen : tune.rearLen;

    // The actuator slews the leg's rest length; the spring does the rest.
    let goal = REST_LEN;
    if (lanes.squat) goal = SQUAT_LEN;
    if (lanes.stretch || lanes[c.lane]) goal = REST_LEN + stroke;
    goal = Math.max(SQUAT_LEN, goal - SPREAD_DROP * Math.max(0, axleSpread(i)));
    const slew = tune.kick * dt;
    w.len += clamp(goal - w.len, -slew, slew);

    const cz = c.z * BODY_HALF_W;
    const cornerY = car.y + c.x * sinP + cz * sinR;
    const cornerV = car.vy + c.x * cosP * car.vPitch + cz * cosR * car.vRoll;
    const len = cornerY - w.h;
    const lenV = cornerV - w.vh;
    let f = spring.k * (w.len - len) - spring.c * lenV;
    if (len < MIN_LEN) {
      f += BUMP_K * (MIN_LEN - len) - BUMP_C * lenV;
      bump += MIN_LEN - len;
    }
    w.load = f;
    force += f;
    torqueP += f * c.x;
    torqueR += f * cz;

    w.vh += (-f / WHEEL_MASS - G) * dt;
    w.h += w.vh * dt;
    if (w.h < 0) { w.h = 0; if (w.vh < 0) w.vh *= -0.15; }
    const tyre = w.h < 0.01 ? clamp(f / 110, 0, 0.28) : 0;
    w.squash += (tyre - w.squash) * Math.min(1, 40 * dt);
  }

  // Soft stops keep the car from going over.
  if (Math.abs(car.pitch) > MAX_PITCH) {
    torqueP -= 90 * (car.pitch - Math.sign(car.pitch) * MAX_PITCH) + 5 * car.vPitch;
  }
  if (Math.abs(car.roll) > MAX_ROLL) {
    torqueR -= 60 * (car.roll - Math.sign(car.roll) * MAX_ROLL) + 3 * car.vRoll;
  }

  car.vy += (force / BODY_MASS - G) * dt;
  car.y += car.vy * dt;
  car.vPitch += (torqueP / PITCH_INERTIA - 0.6 * car.vPitch) * dt;
  car.pitch += car.vPitch * dt;
  car.vRoll += (torqueR / ROLL_INERTIA - 0.6 * car.vRoll) * dt;
  car.roll += car.vRoll * dt;

  // Diagonal legs twist the body around its vertical axis.
  const twist = (lanes.q && lanes.d ? 1 : 0) - (lanes.e && lanes.a ? 1 : 0);
  car.vYaw += ((0.32 * twist - car.yaw) * 120 - 9 * car.vYaw) * dt;
  car.yaw += car.vYaw * dt;

  // Secondary motion: stretch with vertical speed, squash on the bump stops.
  const squashGoal = clamp(car.vy * 0.035, -0.2, 0.3) - clamp(bump * 1.2, 0, 0.25);
  car.vSquash += ((squashGoal - car.squash) * 260 - 13 * car.vSquash) * dt;
  car.squash += car.vSquash * dt;
  car.vCabPitch += ((car.pitch - car.cabPitch) * 110 - 6 * car.vCabPitch) * dt;
  car.cabPitch += car.vCabPitch * dt;
  car.vCabRoll += ((car.roll - car.cabRoll) * 110 - 6 * car.vCabRoll) * dt;
  car.cabRoll += car.vCabRoll * dt;
}
