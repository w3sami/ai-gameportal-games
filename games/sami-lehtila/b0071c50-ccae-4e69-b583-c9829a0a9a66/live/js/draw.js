// Drawing the stage and the car: a fixed oblique camera, flat-shaded prisms
// with ink outlines, coil-spring legs and the cartoon secondary motion.

import { car, CORNERS, BODY_HALF_W, WHEEL_R, WHEEL_W, axleSpread, wheelZ } from './car.js';

const canvas = document.getElementById('stage');
export const ctx = canvas.getContext('2d');
export const view = { w: 0, h: 0, scale: 100 };

// ---------------------------------------------------------------- shape
const BODY_PROFILE = [
  [-1.75, 0.12], [1.7, 0.12], [1.86, 0.3], [1.8, 0.56], [1.2, 0.7], [-1.7, 0.7], [-1.86, 0.52], [-1.86, 0.26],
];
const CABIN_PROFILE = [[-1.25, 0.68], [0.8, 0.68], [0.3, 1.24], [-0.95, 1.24]];
const CABIN_BASE_Y = 0.68;
const ANTENNA_BASE = [-0.85, 1.24, 0.42];
// One wide bar instead of two lamps: two lamps read as eyes, and the car has no face.
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
// The camera looks at the car from a little above. At rest it sees the nose
// and the near side; orbit turns it round the car.
const CAM_YAW = -0.55, CAM_TILT = 0.3;
let scale = 100, originX = 0, originY = 0;

// The picture has perspective: the camera stands camDist metres from the car,
// and REF_DIST is the distance at which a zoom of 1 fills the stage as planned.
const REF_DIST = 12;
const NEAR = 1.5;                 // nothing is drawn as if closer to the lens than this
let camCos, camSin, tiltCos, tiltSin, rollCos, rollSin, zoom, panX, panY, camDist;
let VIEW = [0, 0, 1];             // unit vector towards the camera
let camPos = [0, 0, REF_DIST];    // where the camera is
let unitPx = 100;                 // pixels per metre at the centre of the stage
// cam: { orbit, tilt, zoom, roll, dx, dy, dist }, see camera.js.
export function setCamera(cam) {
  camCos = Math.cos(CAM_YAW + cam.orbit); camSin = Math.sin(CAM_YAW + cam.orbit);
  tiltCos = Math.cos(CAM_TILT + cam.tilt); tiltSin = Math.sin(CAM_TILT + cam.tilt);
  rollCos = Math.cos(cam.roll); rollSin = Math.sin(cam.roll);
  VIEW = [-camSin * tiltCos, tiltSin, camCos * tiltCos];
  zoom = cam.zoom; panX = cam.dx; panY = cam.dy; camDist = cam.dist;
  camPos = [VIEW[0] * camDist, VIEW[1] * camDist, VIEW[2] * camDist];
  unitPx = scale * zoom * REF_DIST / camDist;
}
const LIGHT = normalize([0.35, 0.85, 0.4]);
setCamera({ orbit: 0, tilt: 0, zoom: 1, roll: 0, dx: 0, dy: 0, dist: REF_DIST });
// Where the floor sits and how much of the screen height the car's world gets.
const STAGES = {
  stage: { ground: 0.66, height: 0.6 },
  board: { ground: 0.86, height: 0.46 },      // the car low, under the note board
  ring: { ground: 0.63, height: 0.5 },       // the car in the middle of the note ring
};
let stage = STAGES.stage;

// One of the names in STAGES.
export function setStage(name) { stage = STAGES[name]; resize(); }

export function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = innerWidth; view.h = innerHeight;
  canvas.width = Math.round(view.w * dpr);
  canvas.height = Math.round(view.h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = view.scale = Math.min(view.w / 6.4, view.h * stage.height / 4.8);
  originX = view.w / 2;
  originY = view.h * stage.ground;
}

function project(p) {
  const xr = p[0] * camCos + p[2] * camSin;
  const zr = -p[0] * camSin + p[2] * camCos;
  const towards = p[1] * tiltSin + zr * tiltCos;       // how far the point is on the camera's side of the centre
  const s = scale * zoom * REF_DIST / Math.max(NEAR, camDist - towards);
  const x = (xr - panX) * s, y = (p[1] * tiltCos - zr * tiltSin - panY) * s;
  return [originX + x * rollCos - y * rollSin, originY - (x * rollSin + y * rollCos)];
}
function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// Per-frame body transform, filled by setPose().
const pose = { sy: 1, sxz: 1, lagP: 0, lagR: 0, cY: 1, sY: 0, cP: 1, sP: 0, cR: 1, sR: 0, y: 0 };
export function setPose() {
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

// The antenna tip is a point on a soft spring chasing its rest position.
export function stepAntenna(dt) {
  const top = bodyPoint([ANTENNA_BASE[0], ANTENNA_BASE[1] + 0.9, ANTENNA_BASE[2]]);
  const a = car.antenna;
  for (let k = 0; k < 3; k++) {
    a.v[k] += ((top[k] - a.p[k]) * 240 - 4.5 * a.v[k]) * dt;
    a.p[k] += a.v[k] * dt;
  }
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
    if (dot(n, [camPos[0] - mid[0], camPos[1] - mid[1], camPos[2] - mid[2]]) <= 0) continue;
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
  const zc = wheelZ(i);
  const lean = -c.z * 0.35 * axleSpread(i);   // a spread wheel leans its top inwards
  const ry = WHEEL_R * (1 - w.squash), rx = WHEEL_R * (1 + w.squash * 0.6);
  const cy = w.h + ry;
  const ring = (z, r) => {
    const pts = [];
    for (let k = 0; k < 20; k++) {
      const a = k / 20 * Math.PI * 2;
      pts.push(project([c.x + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r, z + Math.sin(a) * ry * r * lean]));
    }
    return pts;
  };
  // The disc towards the camera is drawn last and carries the hub.
  const side = camPos[2] >= zc ? WHEEL_W / 2 : -WHEEL_W / 2;
  const back = ring(zc - side, 1), face = ring(zc + side, 1);
  poly(back, TYRE, INK, 3);
  for (let k = 0; k < 20; k++) {
    const k2 = (k + 1) % 20;
    poly([back[k], back[k2], face[k2], face[k]], TYRE, TYRE, 1);
  }
  poly(face, TYRE, INK, 3);
  poly(ring(zc + side, 0.52), HUB, INK, 2);
}

// A coil drawn as a zigzag between the body and the wheel hub.
function drawLeg(i) {
  const c = CORNERS[i], w = car.wheels[i];
  const a = project(bodyPoint([c.x, 0.4, c.z * BODY_HALF_W]));
  const b = project([c.x, w.h + WHEEL_R * (1 - w.squash), wheelZ(i) - c.z * WHEEL_W / 2]);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * unitPx * 0.12, ny = dx / len * unitPx * 0.12;
  const TEETH = 9;
  const pts = [a];
  for (let k = 1; k < TEETH; k++) {
    const t = 0.08 + 0.84 * k / TEETH;
    const side = k % 2 ? 1 : -1;
    pts.push([a[0] + dx * t + nx * side, a[1] + dy * t + ny * side]);
  }
  pts.push(b);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const [colour, width] of [[INK, unitPx * 0.085], [SPRING, unitPx * 0.04]]) {
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
      pts.push(project([c.x + Math.cos(a) * 0.42, 0, wheelZ(i) + Math.sin(a) * 0.24]));
    }
    poly(pts, `rgba(10,6,30,${0.45 / (1 + w.h * 3)})`);
  }
}

function drawFloor(beat) {
  const whole = Math.floor(beat);
  const frac = beat - whole;
  const bar = ((whole % 4) + 4) % 4;
  ctx.fillStyle = '#2b2350';
  ctx.fillRect(0, 0, view.w, view.h);
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

function drawAntenna() {
  const tip = car.antenna.p;
  const a = project(bodyPoint(ANTENNA_BASE));
  const m = project(bodyPoint([ANTENNA_BASE[0], ANTENNA_BASE[1] + 0.5, ANTENNA_BASE[2]]));
  const t = project(tip);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.quadraticCurveTo(m[0], m[1], t[0], t[1]);
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath();
  ctx.arc(t[0], t[1], unitPx * 0.075, 0, Math.PI * 2);
  ctx.fillStyle = SPRING; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.stroke();
}

export function drawBackground(beat) {
  drawFloor(beat);
}

// Legs and wheels on the far side of the car go behind the body, the others in
// front of it, each group farthest first.
export function drawCar() {
  ctx.lineJoin = 'round';
  drawShadows();
  const corners = [0, 1, 2, 3]
    .map((i) => ({ i, depth: -CORNERS[i].x * camSin + wheelZ(i) * camCos }))
    .sort((a, b) => a.depth - b.depth);
  for (const c of corners) if (c.depth < 0) { drawLeg(c.i); drawWheel(c.i); }
  // The cabin sits on the roof side of the body. When the car tips so far that
  // the camera sees its underside, the cabin is behind the body, not on top of it.
  const o = bodyPoint([0, 0, 0]), up = bodyPoint([0, 1, 0]);
  const toCam = [camPos[0] - o[0], camPos[1] - o[1], camPos[2] - o[2]];
  const roofFacesCamera = dot([up[0] - o[0], up[1] - o[1], up[2] - o[2]], toCam) > 0;
  if (!roofFacesCamera) { drawAntenna(); drawSolid(CABIN, PAINT); }
  drawSolid(BODY, PAINT);
  const nose = bodyPoint([1, 0, 0]);
  if (dot([nose[0] - o[0], nose[1] - o[1], nose[2] - o[2]], toCam) > 0) {
    poly(LIGHT_BAR.map((p) => project(bodyPoint(p))), '#fff3b0', INK, 2);
  }
  if (roofFacesCamera) { drawSolid(CABIN, PAINT); drawAntenna(); }
  for (const c of corners) if (c.depth >= 0) { drawLeg(c.i); drawWheel(c.i); }
}
