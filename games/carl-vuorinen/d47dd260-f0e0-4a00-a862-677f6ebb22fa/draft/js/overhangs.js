'use strict';
/* Overhangs: rock the heightfield terrain can't make, placed along the course (course format in js/sim.js).
   Course file: overhangs: [{ type, at, ... }, ...]
     at      where along the line: a point index, fractions in between (7.5 = halfway from point 7 to point 8)
     type    "ledge": a slab jutting out of the valley wall over the line
               side   -1 / 1: the wall on your left / right as you fly
               above  its underside, m above the line (so above - HOOP_R is the headroom over a hoop there)
               reach  how far past the line the tip gets (m; negative stops short of it)
               thick, depth   slab thickness, and its size along the flying direction (m)
             "arch": a natural arch across the valley, legs buried in the walls either side
               above  underside of the crown, m above the line
               a      half span at the line's height (m; default: out to the further wall, plus 15)
               drop   how far below the line the legs keep curving before they go straight down (default a / 2)
               thick, depth
             "boulder": a lone big rock on the ground beside the line
               side, off   which side, and how far from the line its centre is (m)
               r      radius (m); it's a squat cluster of a few lumps, sunk a quarter into the ground
   Everything is built of lumps: ellipsoids in the line's level frame (across, up, along), and every lump is a crash.
   Sim part (no DOM): buildOverhangs() (buildWorld, after the terrain), overhangHit(p), overhangNear(x, z, pad) (keeps
   trees out of the boulders). createOverhangKit(): the meshes. */
const OVERHANG_DEF = {
  ledge: { side: -1, above: 100, reach: 30, thick: 30, depth: 60 },
  arch: { above: 110, thick: 28, depth: 44 },
  boulder: { side: 1, off: 120, r: 40 },
};
const OVERHANGS = [];
const OH_FIT = 0.88;                                       // collision radius / drawn radius (the lumps are dented inwards)

function buildOverhangs() {
  OVERHANGS.length = 0;
  const n = COURSE_DEF.length - 1, p = new THREE.Vector3(), tg = new THREE.Vector3();
  (COURSE.overhangs || []).forEach((spec, idx) => {
    const type = OVERHANG_DEF[spec.type] ? spec.type : 'ledge';
    const o = Object.assign({ type }, OVERHANG_DEF[type], spec), rand = mulberry32(911 + idx * 37);
    const t = clamp(o.at / n, 0, 1);
    curve.getPoint(t, p); curve.getTangent(t, tg);
    const L = Math.hypot(tg.x, tg.z) || 1;
    o.ux = tg.x / L; o.uz = tg.z / L;                        // along: the flying direction, level
    o.vx = -o.uz; o.vz = o.ux;                               // across: to the right
    o.cx = p.x; o.cy = p.y; o.cz = p.z;
    const at = (v, u = 0) => heightAt(o.cx + o.vx * v + o.ux * u, o.cz + o.vz * v + o.uz * u);
    const blobs = o.blobs = [];
    // lump centred v across, y up, u along from the line point; radii across, up, along
    const lump = (v, y, u, ra, ry, ru) => blobs.push({ v, y, u, ra, ry, ru,
      x: o.cx + o.vx * v + o.ux * u, z: o.cz + o.vz * v + o.uz * u, seed: Math.floor(rand() * 1e6) });
    const buried = (v, y, r) => y + r < Math.min(at(v - r * 0.5), at(v), at(v + r * 0.5)) - 2;

    if (type === 'ledge') {
      // a slab: rows of flattened lumps from inside the wall out to the tip, two or three deep along the line, with a
      // lumpier crest near the root. Undersides sit at `under` (collision), so above is exact.
      const s = Math.sign(o.side) || -1, under = o.cy + o.above, top = under + o.thick;
      let wall = 0;                                          // first place out on that side where the ground reaches the slab's top
      for (let d = 0; d < 900; d += 4) { wall = d; if (at(s * d) >= top) break; }
      const root = wall + o.thick * 1.5, tip = -o.reach, len = root - tip;
      const k = Math.max(4, Math.ceil(len / (o.thick * 0.45))), rows = o.depth > o.thick * 1.6 ? 3 : 2;
      for (let i = 0; i <= k; i++) {
        const f = i / k, d = lerp(root, tip, f) + (rand() - 0.5) * o.thick * 0.2;
        const taper = 1 - 0.5 * smoothstep(0.6, 1, f);        // thinner and narrower towards the tip
        for (let j = 0; j < rows; j++) {
          const uj = (j / (rows - 1) - 0.5) * o.depth * 0.55 * taper + (rand() - 0.5) * o.depth * 0.12;
          const sz = 0.8 + rand() * 0.45, ry = o.thick * 0.5 * taper * sz;
          lump(s * d, under + ry * OH_FIT, uj, o.thick * 0.75 * sz, ry, o.depth * (0.42 / rows * 2) * taper * sz);
        }
        if (f < 0.55 && rand() < 0.8) {                      // crest lumps on top near the root: a heavier base
          const r2 = o.thick * (0.5 + rand() * 0.4);
          lump(s * (d + (rand() - 0.5) * 12), top - r2 * 0.1, (rand() - 0.5) * o.depth * 0.5, r2 * 1.2, r2 * 0.8, r2 * 1.1);
        }
      }
    } else if (type === 'arch') {
      const wallAt = (s) => { for (let d = 0; d < 900; d += 4) if (at(s * d) >= o.cy) return d; return 900; };
      const a = o.a || Math.max(wallAt(-1), wallAt(1)) + 15, drop = o.drop == null ? a * 0.5 : o.drop;
      const b = o.above + drop, yc = o.cy - drop, r = o.thick * 0.5;
      // big overlapping lumps along the underside's half ellipse, pushed out by their radius, plus a rougher second
      // layer on the outside; then straight down each side until buried
      const k = Math.max(10, Math.ceil(Math.PI * Math.sqrt((a * a + b * b) / 2) / (o.thick * 0.32)));
      for (let i = 0; i <= k; i++) {
        const ang = Math.PI * (i + (rand() - 0.5) * 0.4) / k, ca = Math.cos(ang), sa = Math.sin(ang);
        const nx = ca / a, ny = sa / b, nl = Math.hypot(nx, ny) || 1, ex = nx / nl, ey = ny / nl;   // outward normal
        const sz = 0.85 + rand() * 0.35, rr = r * sz, crown = sa * sa;
        const v = a * ca + ex * rr * OH_FIT, y = yc + b * sa + ey * rr * OH_FIT;
        if (!buried(v, y, rr)) lump(v, y, (rand() - 0.5) * o.depth * 0.15, rr * 1.15, rr * (1 + 0.25 * crown), o.depth * 0.5 * sz);
        if (rand() < 0.6) {                                  // outer layer: thicker, lumpier back
          const r2 = r * (0.6 + rand() * 0.35), v2 = v + ex * rr * 0.9, y2 = y + ey * rr * 0.9;
          if (!buried(v2, y2, r2)) lump(v2, y2, (rand() - 0.5) * o.depth * 0.35, r2 * 1.2, r2, r2 * 1.3);
        }
      }
      for (const s of [-1, 1]) {                             // legs: keep stacking down until the lump is in the ground
        const v = s * (a + r * OH_FIT);
        for (let y = yc - r * 0.5; y > yc - 900; y -= r * 0.9) {
          if (buried(v, y, r * 1.2)) break;
          lump(v + s * (rand() - 0.3) * r * 0.4, y, (rand() - 0.5) * o.depth * 0.2, r * 1.35, r * 1.1, o.depth * 0.55);
        }
      }
    } else {                                                  // boulder: a squat cluster
      const s = Math.sign(o.side) || 1, v0 = s * o.off;
      const m = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < m; i++) {
        const r = o.r * (i ? 0.55 + rand() * 0.25 : 1), v = v0 + (i ? (rand() - 0.5) * o.r * 1.2 : 0), u = i ? (rand() - 0.5) * o.r * 1.4 : 0;
        const g = Math.min(at(v - r * 0.5, u), at(v, u), at(v + r * 0.5, u));
        lump(v, g + r * 0.8 * 0.5, u, r * (1 + rand() * 0.2), r * 0.8, r * (0.9 + rand() * 0.2));
      }
    }
    let reach = 0;
    for (const bl of blobs) reach = Math.max(reach, Math.hypot(bl.v, bl.u) + Math.max(bl.ra, bl.ru));
    o.R2 = (reach + 10) ** 2;
    o.y0 = Math.min(...blobs.map((bl) => bl.y - bl.ry)) - 5; o.y1 = Math.max(...blobs.map((bl) => bl.y + bl.ry)) + 5;
    OVERHANGS.push(o);
  });
}

function overhangHit(p) {
  const m = 1.2;                                             // the aircraft's reach around its centre (m)
  for (const o of OVERHANGS) {
    const dx = p.x - o.cx, dz = p.z - o.cz;
    if (dx * dx + dz * dz > o.R2 || p.y < o.y0 || p.y > o.y1) continue;
    const u = dx * o.ux + dz * o.uz, v = dx * o.vx + dz * o.vz;
    for (const b of o.blobs) {
      const a = (v - b.v) / (b.ra * OH_FIT + m), y = (p.y - b.y) / (b.ry * OH_FIT + m), w = (u - b.u) / (b.ru * OH_FIT + m);
      if (a * a + y * y + w * w < 1) return true;
    }
  }
  return false;
}
function overhangNear(x, z, pad) {                          // is (x, z) under a boulder (trees stay out)
  for (const o of OVERHANGS) {
    if (o.type !== 'boulder') continue;
    const dx = x - o.cx, dz = z - o.cz, u = dx * o.ux + dz * o.uz, v = dx * o.vx + dz * o.vz;
    for (const b of o.blobs) { const a = (v - b.v) / (b.ra + pad), w = (u - b.u) / (b.ru + pad); if (a * a + w * w < 1) return true; }
  }
  return false;
}

/* ---------- look ---------- */
function createOverhangKit() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.shared = true;
  const rock = new THREE.Color('#9a948a'), light = new THREE.Color('#c2bcb0'), dark = new THREE.Color('#7b766d');
  const snow = new THREE.Color('#eef2f4'), c = new THREE.Color();
  const unit = new THREE.IcosahedronGeometry(1, 1);          // non-indexed: flat faces
  const UP = unit.attributes.position;
  function build(group) {
    if (!OVERHANGS.length) return;
    const PAL = COURSE.palette || {}, per = UP.count;
    let total = 0;
    for (const o of OVERHANGS) total += o.blobs.length * per;
    const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
    const q = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
    let k = 0;
    for (const o of OVERHANGS) for (const b of o.blobs) {
      const noise = makeNoise(b.seed), k0 = k;
      for (let i = 0; i < per; i++, k++) {
        q.fromBufferAttribute(UP, i);
        // dent inwards by a noise of the direction, so shared corners of neighbouring faces move together
        const f = 0.76 + 0.24 * noise(q.x * 1.7 + q.z * 0.9 + 5, q.y * 1.9 - q.z * 0.7 + 5);
        const lv = q.x * b.ra * f, ly = q.y * b.ry * f, lu = q.z * b.ru * f;
        pos[k * 3] = o.cx + o.vx * (b.v + lv) + o.ux * (b.u + lu);
        pos[k * 3 + 1] = b.y + ly;
        pos[k * 3 + 2] = o.cz + o.vz * (b.v + lv) + o.uz * (b.u + lu);
      }
      for (let t = k0; t < k; t += 3) {                      // one colour per face: rock, lighter on top, snow if high
        const A = t * 3, B = A + 3, C = A + 6;
        e1.set(pos[B] - pos[A], pos[B + 1] - pos[A + 1], pos[B + 2] - pos[A + 2]);
        e2.set(pos[C] - pos[A], pos[C + 1] - pos[A + 1], pos[C + 2] - pos[A + 2]);
        nrm.crossVectors(e1, e2).normalize();
        const y = (pos[A + 1] + pos[B + 1] + pos[C + 1]) / 3, j = 0.9 + ((t * 2654435761) >>> 0) % 1000 / 1000 * 0.18;
        c.copy(dark).lerp(rock, smoothstep(-0.6, 0.2, nrm.y)).lerp(light, smoothstep(0.3, 0.9, nrm.y) * 0.6);
        if (PAL.snow && y > PAL.snow[0]) c.lerp(snow, smoothstep(PAL.snow[0], PAL.snow[1], y) * smoothstep(0.5, 0.8, nrm.y));
        for (let v = 0; v < 3; v++) { col[A + v * 3] = c.r * j; col[A + v * 3 + 1] = c.g * j; col[A + v * 3 + 2] = c.b * j; }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, mat));
  }
  return { build };
}
