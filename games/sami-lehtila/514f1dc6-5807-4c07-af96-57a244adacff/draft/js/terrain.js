// The snow surface as a height function.
//
// groundAt is the slope itself: the course profile plus the banks at the
// edges. heightAt adds every rideable thing that stands on it — kickers,
// house roofs and the temporary start ramp — so the rider physics asks one
// function where the surface is.
// A surface that rises more than a step within one tick is a wall.

import { COURSE } from './course.js';

export const HALF_WIDTH = COURSE.halfWidth;
const SMOOTH = 8;             // metres either side over which grade changes blend
const BUCKET = 10;            // metres of z per feature bucket

let tune = null;              // live tuning values; the start ramp reads them
let prof = null;              // base height at every metre downhill, index = -z
let firstGrade = 0;
const buckets = new Map();    // bucket index -> features overlapping it

export function buildTerrain(T) {
  tune = T;
  const grades = [];
  for (const [len, grade] of COURSE.profile) for (let i = 0; i < len; i++) grades.push(grade);
  firstGrade = grades[0];
  const n = grades.length;
  prof = new Float32Array(n + 1);
  let h = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -SMOOTH; k <= SMOOTH; k++) s += grades[Math.min(n - 1, Math.max(0, i + k))];
    prof[i] = h;
    h -= s / (2 * SMOOTH + 1);
  }
  prof[n] = h;

  buckets.clear();
  for (const it of COURSE.items) {
    const f = featureOf(it);
    if (!f) continue;
    for (let b = bucketOf(f.zMax); b <= bucketOf(f.zMin); b++) {
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b).push(f);
    }
  }
}

const bucketOf = (z) => Math.floor(-z / BUCKET);

export function baseAt(z) {
  const d = -z;
  if (d <= 0) return -d * firstGrade;
  const n = prof.length - 1;
  if (d >= n) return prof[n];
  const i = Math.floor(d), t = d - i;
  return prof[i] + (prof[i + 1] - prof[i]) * t;
}

export function bankAt(x) {
  const a = Math.abs(x) - HALF_WIDTH;
  return a > 0 ? a * a * 0.05 : 0;
}

export const groundAt = (x, z) => baseAt(z) + bankAt(x);

/** withRamp false leaves out the start ramp: the course as built. */
export function heightAt(x, z, withRamp = true) {
  let h = groundAt(x, z);
  const list = buckets.get(bucketOf(z));
  if (list) for (const f of list) {
    const v = f.height(x, z);
    if (v > h) h = v;
  }
  if (withRamp && ramp) {
    const v = rampHeight(ramp, x, z);
    if (v > h) h = v;
  }
  return h;
}

/** The feature whose surface is on top at x, z, or null for plain snow. */
export function surfaceAt(x, z) {
  let h = groundAt(x, z), top = null;
  const list = buckets.get(bucketOf(z));
  if (list) for (const f of list) {
    const v = f.height(x, z);
    if (v > h) { h = v; top = f; }
  }
  return top;
}

// Ramp shape: height fraction at t (0 at the foot, 1 at the lip).
export const rampCurve = (t) => Math.pow(t, 1.6);
export const KICKER_TAPER = 1.2;

// Start ramp: when the rider stands up at a checkpoint (or the start) whose
// slope below is gentler than tune.checkpointSlope, a snow ramp appears under
// them for that one start: a run-in falling at exactly that angle for
// checkpointRun metres (shorter if it would stand taller than RAMP_MAX_H) and
// a one-metre top. Nobody rides into it from behind, so its back is steep.
// There is at most one; physics places and clears it, world.js draws it.
const RAMP_MAX_RUN = 25, RAMP_MAX_H = 3.5, RAMP_HALF = 2.5;
let ramp = null, rampVersion = 0;

export function placeStartRamp(x, z) {
  const deg = tune?.checkpointSlope ?? 14, run = Math.min(RAMP_MAX_RUN, tune?.checkpointRun ?? 12);
  const tanA = (heightAt(x, z, false) - heightAt(x, z - 10, false)) / 10;
  const tanT = Math.tan((deg * Math.PI) / 180);
  ramp = null;
  if (tanT > tanA + 1e-3) {
    const H = Math.min(RAMP_MAX_H, (tanT - tanA) * run);
    ramp = { x, z, H, L: H / (tanT - tanA), back: H, half: RAMP_HALF, slope: (Math.atan(tanA) * 180) / Math.PI };
  }
  rampVersion++;
  return ramp;
}

export function clearStartRamp() {
  if (!ramp) return;
  ramp = null;
  rampVersion++;
}

export const startRamp = () => ({ ramp, version: rampVersion });

function rampHeight(r, x, z) {
  const dz = r.z - z;                                // metres downhill of the top
  if (dz > r.L || dz < -1 - r.back) return -Infinity;
  const ax = Math.abs(x - r.x);
  const s = ax <= r.half ? 1 : 1 - (ax - r.half) / KICKER_TAPER;
  if (s <= 0) return -Infinity;
  const rel = dz >= 0 ? r.H * (1 - dz / r.L) : dz >= -1 ? r.H : r.H * (1 + (1 + dz) / r.back);
  return groundAt(x, z) + rel * s;
}

function featureOf(it) {
  if (it.type === 'kicker') {
    const half = it.w / 2;
    return {
      kind: 'kicker', it, zMin: it.z, zMax: it.z + it.len,
      height(x, z) {
        const dz = z - it.z;
        if (dz < 0 || dz > it.len) return -Infinity;
        const ax = Math.abs(x - it.x);
        const s = ax <= half ? 1 : 1 - (ax - half) / KICKER_TAPER;
        if (s <= 0) return -Infinity;
        return baseAt(z) + it.h * rampCurve(1 - dz / it.len) * s;
      },
    };
  }
  if (it.type === 'house') {
    const floor = baseAt(it.z);
    const hw = it.w / 2, hd = it.d / 2;
    return {
      kind: 'roof', it, zMin: it.z - hd, zMax: it.z + hd,
      height(x, z) {
        const ax = Math.abs(x - it.x), az = Math.abs(z - it.z);
        if (ax > hw || az > hd) return -Infinity;
        const r = it.ridge === 'z' ? 1 - ax / hw : 1 - az / hd;
        return floor + it.wallH + it.roofH * r;
      },
    };
  }
  return null;
}

/** Floor level of a house: the slope height at its centre. */
export const houseFloor = (it) => baseAt(it.z);
export const courseLength = () => prof.length - 1;
