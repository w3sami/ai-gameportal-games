'use strict';
// Tanssiauto: a faceless cartoon car whose four spring legs are its limbs.
// World axes: x = towards the nose, y = up, z = towards the camera side.
// Corner order everywhere: 0 rear-far, 1 front-far, 2 rear-near, 3 front-near.

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------- constants
const G = 20;                 // gravity; heavier than real so the motion snaps
const BODY_MASS = 1;
const PITCH_INERTIA = 0.7;
const ROLL_INERTIA = 0.34;
const WHEEL_MASS = 0.08;
const AXLE_X = 1.15;          // wheel x from the body centre
const BODY_HALF_W = 0.8;
const WHEEL_Z = 1.3;          // wheel centre z; outside the body so the legs show
const WHEEL_R = 0.4;
const WHEEL_W = 0.34;
const REST_LEN = 0.6;         // ground clearance a relaxed leg aims for
const SQUAT_LEN = 0.2;
const MIN_LEN = 0.15;         // bump stop
const BUMP_K = 3000;
const BUMP_C = 20;
const MAX_PITCH = 0.7;
const MAX_ROLL = 0.55;
const STEP = 1 / 600;         // physics step; the bump stops need it this small
const BPM = 116;
const SPB = 60 / BPM;

const CORNERS = [
  { x: -AXLE_X, z: -1, front: false },
  { x: AXLE_X, z: -1, front: true },
  { x: -AXLE_X, z: 1, front: false },
  { x: AXLE_X, z: 1, front: true },
];

// ---------------------------------------------------------------- tuning
const tune = { frontLen: 0.9, frontLoose: 0.5, rearLen: 0.9, rearLoose: 0.5, kick: 6 };
for (const key of Object.keys(tune)) {
  const el = document.getElementById(key);
  el.addEventListener('input', () => { tune[key] = +el.value; });
  tune[key] = +el.value;
}
// Looseness 0..1 maps to a stiff, well damped leg at 0 and a soft, ringing one at 1.
function legSpring(loose) {
  const k = 420 * Math.pow(45 / 420, loose);
  const zeta = 0.55 + (0.12 - 0.55) * loose;
  return { k, c: 2 * zeta * Math.sqrt(k * BODY_MASS / 4) };
}

// ---------------------------------------------------------------- state
const car = {
  y: REST_LEN, vy: 0, pitch: 0, vPitch: 0, roll: 0, vRoll: 0, yaw: 0, vYaw: 0,
  squash: 0, vSquash: 0,          // body stretch along y, volume preserving
  cabPitch: 0, vCabPitch: 0, cabRoll: 0, vCabRoll: 0,   // cabin lags the body
  wheels: CORNERS.map(() => ({ h: 0, vh: 0, len: REST_LEN, load: 0, squash: 0 })),
  antenna: { p: [0, 2.6, 0], v: [0, 0, 0] },
};

// ---------------------------------------------------------------- input
const keysDown = new Set();
const padDown = { corner: [false, false, false, false], squat: false, stretch: false };
let autoDance = true;

const KEY_CORNERS = {
  KeyQ: [0], KeyE: [1], KeyA: [2], KeyD: [3],
  ArrowRight: [1, 3], ArrowLeft: [0, 2], ArrowUp: [0, 1], ArrowDown: [2, 3],
};

addEventListener('keydown', (e) => {
  if (e.code in KEY_CORNERS || e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyM' && !e.repeat) toggleMusic();
  keysDown.add(e.code);
});
addEventListener('keyup', (e) => keysDown.delete(e.code));
addEventListener('blur', () => keysDown.clear());

for (const btn of document.querySelectorAll('#pad button')) {
  const set = (on) => {
    if (btn.dataset.corner) padDown.corner[+btn.dataset.corner] = on;
    else padDown[btn.dataset.act] = on;
  };
  btn.addEventListener('pointerdown', (e) => { btn.setPointerCapture(e.pointerId); set(true); e.preventDefault(); });
  btn.addEventListener('pointerup', () => set(false));
  btn.addEventListener('pointercancel', () => set(false));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

const autoBtn = document.getElementById('autoBtn');
autoBtn.addEventListener('click', () => {
  autoDance = !autoDance;
  autoBtn.classList.toggle('on', autoDance);
});

// What the legs are asked to do this frame, from keys, pad and the auto dancer.
function readInput() {
  const out = { corner: [false, false, false, false], squat: false, stretch: false };
  for (const code of keysDown) {
    for (const i of KEY_CORNERS[code] || []) out.corner[i] = true;
  }
  out.squat = keysDown.has('KeyS') || keysDown.has('Space') || padDown.squat;
  out.stretch = keysDown.has('KeyW') || keysDown.has('ShiftLeft') || keysDown.has('ShiftRight') || padDown.stretch;
  for (let i = 0; i < 4; i++) out.corner[i] = out.corner[i] || padDown.corner[i];
  if (autoDance) {
    const move = autoMove();
    if (move) {
      for (const i of move.corner || []) out.corner[i] = true;
      out.squat = out.squat || !!move.squat;
      out.stretch = out.stretch || !!move.stretch;
    }
  }
  return out;
}

// ---------------------------------------------------------------- auto dance
const MOVES = {
  front: { corner: [1, 3] }, rear: { corner: [0, 2] },
  far: { corner: [0, 1] }, near: { corner: [2, 3] },
  d1: { corner: [0, 3] }, d2: { corner: [1, 2] },
  c0: { corner: [0] }, c1: { corner: [1] }, c2: { corner: [2] }, c3: { corner: [3] },
  squat: { squat: true }, stretch: { stretch: true },
};
// One move per beat, eight beats per phrase.
const PHRASES = [
  ['front', 'rear', 'front', 'rear', 'far', 'near', 'far', 'near'],
  ['squat', 'stretch', null, 'squat', 'stretch', null, 'd1', 'd2'],
  ['c3', 'c2', 'c0', 'c1', 'squat', 'stretch', 'front', 'rear'],
  ['d1', 'd2', 'd1', 'd2', 'near', 'far', 'squat', 'stretch'],
  ['far', 'far', 'near', 'near', 'front', 'squat', 'stretch', null],
];
const HOLD = 0.55;   // part of the beat a move is held; the rest is the swing back

function autoMove() {
  const beat = beatNow();
  const index = Math.floor(beat);
  if (beat - index > HOLD) return null;
  const phrase = PHRASES[(Math.floor(index / 8) * 7 + 3) % PHRASES.length];
  return MOVES[phrase[((index % 8) + 8) % 8]] || null;
}

// ---------------------------------------------------------------- music
let audio = null;
let musicOn = false;
let musicStart = 0;
let nextStep = 0;
let scheduler = 0;
const musicBtn = document.getElementById('musicBtn');
musicBtn.addEventListener('click', toggleMusic);

function beatNow() {
  if (musicOn) return (audio.ctx.currentTime - musicStart) / SPB;
  return performance.now() / 1000 / SPB;
}

function toggleMusic() {
  if (!audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const actx = new AC();
    const out = actx.createGain();
    out.gain.value = 0.5;
    out.connect(actx.destination);
    const noise = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    audio = { ctx: actx, out, noise };
  }
  musicOn = !musicOn;
  musicBtn.classList.toggle('on', musicOn);
  if (musicOn) {
    audio.ctx.resume();
    musicStart = audio.ctx.currentTime + 0.1;
    nextStep = 0;
    scheduler = setInterval(scheduleMusic, 25);
  } else {
    clearInterval(scheduler);
  }
}

const BASS = [55, 0, 0, 55, 0, 0, 65.4, 0, 73.4, 0, 0, 73.4, 0, 82.4, 0, 49];
const STAB = [220, 261.6, 329.6];

function scheduleMusic() {
  const sixteenth = SPB / 4;
  while (musicStart + nextStep * sixteenth < audio.ctx.currentTime + 0.12) {
    const t = musicStart + nextStep * sixteenth;
    const s = nextStep % 16;
    if (s % 4 === 0) kick(t);
    if (s === 4 || s === 12) clap(t);
    if (s % 2 === 0) hat(t, s % 4 === 2 ? 0.16 : 0.07);
    if (BASS[s]) tone(t, BASS[s], 'sawtooth', 0.22, 0.16, 500);
    if (s === 6 || s === 14) for (const f of STAB) tone(t, f, 'square', 0.05, 0.12, 1800);
    nextStep++;
  }
}
function kick(t) {
  const o = audio.ctx.createOscillator();
  const g = audio.ctx.createGain();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(0.9, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(g).connect(audio.out);
  o.start(t); o.stop(t + 0.24);
}
function noiseHit(t, freq, gain, len) {
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.noise;
  const f = audio.ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = freq;
  const g = audio.ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(f).connect(g).connect(audio.out);
  src.start(t, Math.random() * 0.5); src.stop(t + len + 0.02);
}
function clap(t) { noiseHit(t, 1500, 0.35, 0.14); }
function hat(t, gain) { noiseHit(t, 7000, gain, 0.05); }
function tone(t, freq, type, gain, len, cutoff) {
  const o = audio.ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const f = audio.ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = audio.ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(f).connect(g).connect(audio.out);
  o.start(t); o.stop(t + len + 0.02);
}

// ---------------------------------------------------------------- physics
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function step(dt, input) {
  const front = legSpring(tune.frontLoose);
  const rear = legSpring(tune.rearLoose);
  const sinP = Math.sin(car.pitch), cosP = Math.cos(car.pitch);
  const sinR = Math.sin(car.roll), cosR = Math.cos(car.roll);
  let force = 0, torqueP = 0, torqueR = 0, bump = 0;

  for (let i = 0; i < 4; i++) {
    const c = CORNERS[i];
    const w = car.wheels[i];
    const spring = c.front ? front : rear;
    const stroke = c.front ? tune.frontLen : tune.rearLen;

    // The actuator slews the leg's rest length; the spring does the rest.
    let goal = REST_LEN;
    if (input.squat) goal = SQUAT_LEN;
    if (input.stretch || input.corner[i]) goal = REST_LEN + stroke;
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

  // Soft stops keep the car from going over; a prototype has no upside-down.
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
  const twist = (input.corner[0] && input.corner[3] ? 1 : 0) - (input.corner[1] && input.corner[2] ? 1 : 0);
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

function stepAntenna(dt) {
  const base = bodyPoint(ANTENNA_BASE);
  const top = bodyPoint([ANTENNA_BASE[0], ANTENNA_BASE[1] + 0.9, ANTENNA_BASE[2]]);
  const a = car.antenna;
  for (let k = 0; k < 3; k++) {
    a.v[k] += ((top[k] - a.p[k]) * 240 - 4.5 * a.v[k]) * dt;
    a.p[k] += a.v[k] * dt;
  }
  return base;
}

// ---------------------------------------------------------------- shape
const BODY_PROFILE = [
  [-1.75, 0.12], [1.7, 0.12], [1.86, 0.3], [1.8, 0.56], [1.2, 0.7], [-1.7, 0.7], [-1.86, 0.52], [-1.86, 0.26],
];
const CABIN_PROFILE = [[-1.25, 0.68], [0.8, 0.68], [0.3, 1.24], [-0.95, 1.24]];
const CABIN_BASE_Y = 0.68;
const ANTENNA_BASE = [-0.85, 1.24, 0.42];
const LIGHT_BAR = [[1.855, 0.36, -0.6], [1.855, 0.36, 0.6], [1.83, 0.48, 0.6], [1.83, 0.48, -0.6]];

// An extruded side profile: two side faces and a strip of quads between them.
function prism(profile, halfW, glass) {
  const faces = [];
  faces.push({ pts: profile.map(([x, y]) => [x, y, halfW]), glass });
  faces.push({ pts: profile.map(([x, y]) => [x, y, -halfW]), glass });
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i], b = profile[(i + 1) % profile.length];
    const upright = Math.abs(b[1] - a[1]) > 0.2;
    faces.push({
      pts: [[a[0], a[1], halfW], [b[0], b[1], halfW], [b[0], b[1], -halfW], [a[0], a[1], -halfW]],
      glass: glass && upright,
    });
  }
  let cx = 0, cy = 0;
  for (const [x, y] of profile) { cx += x; cy += y; }
  return { faces, centre: [cx / profile.length, cy / profile.length, 0] };
}
const BODY = prism(BODY_PROFILE, BODY_HALF_W, false);
const CABIN = prism(CABIN_PROFILE, 0.66, true);

// ---------------------------------------------------------------- view
const CAM_YAW = -0.55, CAM_TILT = 0.3;
const camCos = Math.cos(CAM_YAW), camSin = Math.sin(CAM_YAW);
const tiltCos = Math.cos(CAM_TILT), tiltSin = Math.sin(CAM_TILT);
const VIEW = [-camSin * tiltCos, tiltSin, camCos * tiltCos];   // unit vector towards the camera
const LIGHT = normalize([0.35, 0.85, 0.4]);
let scale = 100, originX = 0, originY = 0, viewW = 0, viewH = 0;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = innerWidth; viewH = innerHeight;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = Math.min(viewW / 6.4, viewH * 0.6 / 4.8);
  originX = viewW / 2;
  originY = viewH * 0.64;
}
addEventListener('resize', resize);
resize();

function project(p) {
  const xr = p[0] * camCos + p[2] * camSin;
  const zr = -p[0] * camSin + p[2] * camCos;
  return [originX + xr * scale, originY - (p[1] * tiltCos - zr * tiltSin) * scale];
}
function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// Per-frame body transform, filled by setPose().
const pose = { sy: 1, sxz: 1, lagP: 0, lagR: 0, cY: 1, sY: 0, cP: 1, sP: 0, cR: 1, sR: 0, y: 0 };
function setPose() {
  pose.sy = 1 + car.squash;
  pose.sxz = 1 / Math.sqrt(pose.sy);
  pose.lagP = car.cabPitch - car.pitch;
  pose.lagR = car.cabRoll - car.roll;
  pose.cY = Math.cos(car.yaw); pose.sY = Math.sin(car.yaw);
  pose.cP = Math.cos(car.pitch); pose.sP = Math.sin(car.pitch);
  pose.cR = Math.cos(car.roll); pose.sR = Math.sin(car.roll);
  pose.y = car.y;
}
// Body-local point to world. Local y = 0 is the level the legs measure from.
function bodyPoint(p) {
  let x = p[0] * pose.sxz, y = p[1] * pose.sy, z = p[2] * pose.sxz;
  const above = Math.max(0, p[1] - CABIN_BASE_Y);
  x -= pose.lagP * above * 1.6;
  z -= pose.lagR * above * 1.6;
  const x1 = x * pose.cY + z * pose.sY, z1 = -x * pose.sY + z * pose.cY;
  const y2 = y * pose.cP + x1 * pose.sP, x2 = x1 * pose.cP - y * pose.sP;
  const y3 = y2 * pose.cR + z1 * pose.sR, z3 = z1 * pose.cR - y2 * pose.sR;
  return [x2, y3 + pose.y, z3];
}

// ---------------------------------------------------------------- drawing
const INK = '#1d1b26';
const PAINT = [255, 92, 64];
const GLASS = '#bfe9ff';
const TYRE = '#2c2a36';
const HUB = '#f5f1e6';
const SPRING = '#ffd23f';

function poly(points, fill, stroke, width) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    if (i) ctx.lineTo(points[i][0], points[i][1]); else ctx.moveTo(points[i][0], points[i][1]);
  }
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}

function drawSolid(solid, rgb) {
  const centre = bodyPoint(solid.centre);
  for (const face of solid.faces) {
    const w = face.pts.map(bodyPoint);
    const a = w[0], b = w[1], c = w[2];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = normalize([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
    const mid = [0, 0, 0];
    for (const p of w) for (let k = 0; k < 3; k++) mid[k] += p[k] / w.length;
    if (dot(n, [mid[0] - centre[0], mid[1] - centre[1], mid[2] - centre[2]]) < 0) n = [-n[0], -n[1], -n[2]];
    if (dot(n, VIEW) <= 0) continue;
    const shade = 0.7 + 0.3 * Math.max(0, dot(n, LIGHT));
    const fill = `rgb(${rgb.map((ch) => Math.round(ch * shade)).join(',')})`;
    poly(w.map(project), fill, INK, 3);
    if (face.glass) {
      const inset = w.map((p) => project([0, 1, 2].map((k) => mid[k] + (p[k] - mid[k]) * 0.76)));
      poly(inset, GLASS, INK, 2);
    }
  }
}

function drawWheel(i) {
  const c = CORNERS[i], w = car.wheels[i];
  const zc = c.z * WHEEL_Z;
  const ry = WHEEL_R * (1 - w.squash), rx = WHEEL_R * (1 + w.squash * 0.6);
  const cy = w.h + ry;
  const ring = (z, r) => {
    const pts = [];
    for (let k = 0; k < 20; k++) {
      const a = k / 20 * Math.PI * 2;
      pts.push(project([c.x + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r, z]));
    }
    return pts;
  };
  const back = ring(zc - WHEEL_W / 2, 1), face = ring(zc + WHEEL_W / 2, 1);
  poly(back, TYRE, INK, 3);
  for (let k = 0; k < 20; k++) {
    const k2 = (k + 1) % 20;
    poly([back[k], back[k2], face[k2], face[k]], TYRE, TYRE, 1);
  }
  poly(face, TYRE, INK, 3);
  poly(ring(zc + WHEEL_W / 2, 0.52), HUB, INK, 2);
}

// A coil drawn as a zigzag between the body and the wheel hub.
function drawLeg(i) {
  const c = CORNERS[i], w = car.wheels[i];
  const a = project(bodyPoint([c.x, 0.4, c.z * BODY_HALF_W]));
  const b = project([c.x, w.h + WHEEL_R * (1 - w.squash), c.z * (WHEEL_Z - WHEEL_W / 2)]);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * scale * 0.12, ny = dx / len * scale * 0.12;
  const TEETH = 9;
  const pts = [a];
  for (let k = 1; k < TEETH; k++) {
    const t = 0.08 + 0.84 * k / TEETH;
    const side = k % 2 ? 1 : -1;
    pts.push([a[0] + dx * t + nx * side, a[1] + dy * t + ny * side]);
  }
  pts.push(b);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const [colour, width] of [[INK, scale * 0.085], [SPRING, scale * 0.04]]) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.stroke();
  }
}

function drawShadows() {
  const alpha = 0.4 / (1 + car.y * 0.8);
  const foot = [[-1.8, -0.8], [1.8, -0.8], [1.8, 0.8], [-1.8, 0.8]].map(([x, z]) => {
    const p = bodyPoint([x, 0, z]);
    return project([p[0], 0, p[2]]);
  });
  poly(foot, `rgba(10,6,30,${alpha})`);
  for (let i = 0; i < 4; i++) {
    const c = CORNERS[i], w = car.wheels[i];
    const pts = [];
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      pts.push(project([c.x + Math.cos(a) * 0.42, 0, c.z * WHEEL_Z + Math.sin(a) * 0.24]));
    }
    poly(pts, `rgba(10,6,30,${0.45 / (1 + w.h * 3)})`);
  }
}

function drawFloor(beat) {
  const frac = beat - Math.floor(beat);
  const bar = Math.floor(beat) % 4;
  ctx.fillStyle = '#2b2350';
  ctx.fillRect(0, 0, viewW, viewH);
  const disc = (r, fill) => {
    const pts = [];
    for (let k = 0; k < 40; k++) {
      const a = k / 40 * Math.PI * 2;
      pts.push(project([Math.cos(a) * r, 0, Math.sin(a) * r]));
    }
    poly(pts, fill);
  };
  disc(4.2, '#3a2f6b');
  const hue = [48, 330, 190, 280][bar];
  disc(1.2 + frac * 2.9, `hsla(${hue}, 90%, 65%, ${0.22 * (1 - frac) * (1 - frac)})`);
}

function drawAntenna(base) {
  const tip = car.antenna.p;
  const mid = bodyPoint([ANTENNA_BASE[0], ANTENNA_BASE[1] + 0.5, ANTENNA_BASE[2]]);
  const a = project(base), m = project(mid), t = project(tip);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.quadraticCurveTo(m[0], m[1], t[0], t[1]);
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath();
  ctx.arc(t[0], t[1], scale * 0.075, 0, Math.PI * 2);
  ctx.fillStyle = SPRING; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.stroke();
}

function draw(antennaBase) {
  ctx.lineJoin = 'round';
  drawFloor(beatNow());
  drawShadows();
  drawLeg(0); drawLeg(1);
  drawWheel(0); drawWheel(1);
  drawSolid(BODY, PAINT);
  drawSolid(CABIN, PAINT);
  poly(LIGHT_BAR.map((p) => project(bodyPoint(p))), '#fff3b0', INK, 2);
  drawAntenna(antennaBase);
  drawLeg(2); drawLeg(3);
  drawWheel(2); drawWheel(3);
}

// ---------------------------------------------------------------- loop
const padButtons = [...document.querySelectorAll('#pad button')];
let last = performance.now();
let pending = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const input = readInput();
  for (const btn of padButtons) {
    const on = btn.dataset.corner ? input.corner[+btn.dataset.corner] : input[btn.dataset.act];
    btn.classList.toggle('on', on);
  }
  pending += dt;
  while (pending >= STEP) { step(STEP, input); pending -= STEP; }
  setPose();
  const antennaBase = stepAntenna(dt);
  draw(antennaBase);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.tanssiauto = { car, tune };
