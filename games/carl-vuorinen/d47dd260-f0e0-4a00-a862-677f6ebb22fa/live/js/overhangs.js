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
               r      radius (m), sunk a quarter into the ground
   Ledges and arches are a rock tube swept along a spine: a six-sided cross-section every ~30 m, as coarse as the
   terrain's own cells, flaring where it meets the wall so it grows out of it, and coloured with the terrain's rock
   and snow rules so it reads as part of the same mountain. Boulders are one big low-poly rock. What you see is what you hit:
   collision is the same tube (elliptical cross-sections, a touch inside the drawn corners).
   Sim part (no DOM): buildOverhangs() (buildWorld, after the terrain), overhangHit(p), overhangNear(x, z, pad) (keeps
   trees out of the boulders). createOverhangKit(): the meshes.
   Each overhang also lists o.blobs [{ v, y, u, ra, ry, ru }]: its extent as boxes in the line's frame (across, up,
   along), for other modules (js/creek.js keeps its channel clear under arches). */
const OVERHANG_DEF = {
  ledge: { side: -1, above: 100, reach: 30, thick: 30, depth: 60 },
  arch: { above: 110, thick: 28, depth: 44 },
  boulder: { side: 1, off: 120, r: 40 },
};
const OVERHANGS = [];
const OH_FIT = 0.88;                                       // collision radius / drawn radius (drawn corners jut out a little)
const OH_SIDES = 6;                                        // cross-section corners
const OH_STEP = 30;                                        // spine spacing (m), about one terrain cell

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
    // spine node: centre (v across, y, u along), section half-sizes ra (along the line) and rb (across the spine,
    // in the across/up plane, direction (bv, by))
    const spine = o.spine = [];
    const node = (v, y, u, ra, rb, bv, by) => spine.push({ v, y, u, ra, rb, bv, by });
    const wob = () => (rand() - 0.5) * 2;

    if (type === 'ledge') {
      const s = Math.sign(o.side) || -1, under = o.cy + o.above, top = under + o.thick;
      // root: past the first place out on that side where the ground reaches the slab's top, across its whole depth
      let wall = 0;
      for (let d = 0; d < 900; d += 4) { wall = d; if (Math.min(at(s * d), at(s * d, o.depth * 0.4), at(s * d, -o.depth * 0.4)) >= top) break; }
      const root = wall + o.thick, tip = -o.reach, len = root - tip, k = Math.max(4, Math.round(len / OH_STEP));
      for (let i = 0; i <= k; i++) {
        const f = i / k, d = lerp(root, tip, f);            // f: 0 at the root, 1 at the tip
        // corbel: near the wall the underside sweeps down into it, so the slab grows out of the rock face
        const flare = o.thick * 1.6 * Math.pow(1 - smoothstep(0, 0.45, f), 2);
        // a wedge: the top climbs toward the wall, so it's thick where it holds on and thins out to the tip
        const yT = top + o.thick * 0.9 * (1 - smoothstep(0, 0.75, f)) - o.thick * 0.5 * smoothstep(0.5, 1, f) + (i ? wob() * o.thick * 0.12 : 0);
        const yU = under - flare + (i > 0 && i < k ? wob() * o.thick * 0.06 : 0) + o.thick * 0.2 * smoothstep(0.7, 1, f);
        const ra = o.depth * 0.5 * (1 - 0.5 * smoothstep(0.5, 1, f)) * (1 + 0.35 * (1 - smoothstep(0, 0.4, f)));
        node(s * d, (yT + yU) / 2, (i ? wob() * o.depth * 0.08 : 0), ra, (yT - yU) / 2, 0, 1);
      }
      o.capEnd = true;                                       // the tip is out in the air; the root is in the wall
    } else if (type === 'arch') {
      const wallAt = (s) => { for (let d = 0; d < 900; d += 4) if (at(s * d) >= o.cy) return d; return 900; };
      const a = o.a || Math.max(wallAt(-1), wallAt(1)) + 15, drop = o.drop == null ? a * 0.5 : o.drop;
      const b = o.above + drop, yc = o.cy - drop, r = o.thick * 0.5;
      const buried = (nd) => nd.y + nd.rb < Math.min(at(nd.v - nd.rb), at(nd.v), at(nd.v + nd.rb)) - 2;
      const arc = [];
      const k = Math.max(8, Math.round(Math.PI * Math.sqrt((a * a + b * b) / 2) / OH_STEP));
      for (let i = 0; i <= k; i++) {
        const ang = Math.PI * i / k, ca = Math.cos(ang), sa = Math.sin(ang);
        const nx = ca / a, ny = sa / b, nl = Math.hypot(nx, ny) || 1, ev = nx / nl, ey = ny / nl;   // outward normal
        const rb = r * (1 + 0.7 * Math.pow(1 - sa, 2)) * (1 + (i % k ? wob() * 0.12 : 0));   // heavier at the springs
        arc.push({ v: a * ca + ev * rb, y: yc + b * sa + ey * rb, u: (i % k ? wob() * o.depth * 0.06 : 0),
                   ra: o.depth * 0.5 * (1 + 0.3 * (1 - sa)), rb, bv: ev, by: ey });
      }
      // legs: carry on straight down from both springs until buried (the right leg is walked from its foot up)
      const leg = (end, s) => {
        const out = [];
        for (let y = end.y - OH_STEP; y > end.y - 900; y -= OH_STEP) {
          const nd = { v: end.v + s * wob() * r * 0.15, y, u: end.u, ra: end.ra * 1.1, rb: end.rb * 1.1, bv: s, by: 0 };
          out.push(nd);
          if (buried(nd)) break;
        }
        return out;
      };
      spine.push(...leg(arc[0], 1).reverse(), ...arc, ...leg(arc[arc.length - 1], -1));   // right foot, over the top, left foot
      o.capEnd = false;
    } else {                                                  // boulder: one squat low-poly rock
      const s = Math.sign(o.side) || 1, v = s * o.off;
      const g = Math.min(at(v - o.r * 0.5), at(v), at(v + o.r * 0.5));
      o.rock = { v, y: g + o.r * 0.3, u: 0, ra: o.r * (1 + rand() * 0.2), ry: o.r * 0.75, ru: o.r * (0.9 + rand() * 0.2), seed: Math.floor(rand() * 1e6) };
    }

    // world positions of the spine, its segments' directions, and extents (for the broad-phase and other modules)
    for (const nd of spine) { nd.x = o.cx + o.vx * nd.v + o.ux * nd.u; nd.z = o.cz + o.vz * nd.v + o.uz * nd.u; }
    const R = o.rock;
    o.blobs = R ? [{ v: R.v, y: R.y, u: R.u, ra: R.ra, ry: R.ry, ru: R.ru }]
      : spine.map((nd) => ({ v: nd.v, y: nd.y, u: nd.u, ra: Math.abs(nd.bv) * nd.rb + Math.abs(nd.by) * OH_STEP * 0.5 + 2,
                            ry: Math.abs(nd.by) * nd.rb + Math.abs(nd.bv) * OH_STEP * 0.5 + 2, ru: nd.ra }));
    let reach = 0;
    for (const bl of o.blobs) reach = Math.max(reach, Math.hypot(Math.abs(bl.v) + bl.ra, Math.abs(bl.u) + bl.ru));
    o.R2 = (reach + 20) ** 2;
    o.y0 = Math.min(...o.blobs.map((bl) => bl.y - Math.max(bl.ry, bl.ra))) - 10;
    o.y1 = Math.max(...o.blobs.map((bl) => bl.y + Math.max(bl.ry, bl.ra))) + 10;
    OVERHANGS.push(o);
  });
}

// inside the swept tube? For each spine segment: nearest point on it, the section there (interpolated), and an
// ellipse test in that section's frame (along the line, across the spine), rounded off past the segment's ends
function overhangHit(p) {
  const m = 1.2;                                             // the aircraft's reach around its centre (m)
  for (const o of OVERHANGS) {
    const dx = p.x - o.cx, dz = p.z - o.cz;
    if (dx * dx + dz * dz > o.R2 || p.y < o.y0 || p.y > o.y1) continue;
    const u = dx * o.ux + dz * o.uz, v = dx * o.vx + dz * o.vz;
    if (o.rock) {
      const R = o.rock, a = (v - R.v) / (R.ra * OH_FIT + m), y = (p.y - R.y) / (R.ry * OH_FIT + m), w = (u - R.u) / (R.ru * OH_FIT + m);
      if (a * a + y * y + w * w < 1) return true;
      continue;
    }
    const S = o.spine;
    for (let i = 0; i < S.length - 1; i++) {
      const A = S[i], B = S[i + 1], sv = B.v - A.v, sy = B.y - A.y, su = B.u - A.u, L2 = sv * sv + sy * sy + su * su || 1;
      const raw = ((v - A.v) * sv + (p.y - A.y) * sy + (u - A.u) * su) / L2, t = clamp(raw, 0, 1);
      const cv = A.v + sv * t, cy = A.y + sy * t, cu = A.u + su * t;
      const ra = lerp(A.ra, B.ra, t) * OH_FIT + m, rb = lerp(A.rb, B.rb, t) * OH_FIT + m;
      const bv = lerp(A.bv, B.bv, t), by = lerp(A.by, B.by, t), bl = Math.hypot(bv, by) || 1;
      const qv = v - cv, qy = p.y - cy, qu = u - cu;
      const qb = (qv * bv + qy * by) / bl;                   // across the spine, in the across/up plane
      // beyond either end of the segment: how far, in section radii, so every section closes off round (the joints of
      // a bend overlap; the tip is a blunt end)
      const over = (raw > 1 ? raw - 1 : raw < 0 ? -raw : 0) * Math.sqrt(L2) / rb;
      if ((qu / ra) ** 2 + (qb / rb) ** 2 + over * over < 1) return true;
    }
  }
  return false;
}
function overhangNear(x, z, pad) {                          // is (x, z) under a boulder (trees stay out)
  for (const o of OVERHANGS) {
    if (!o.rock) continue;
    const dx = x - o.cx, dz = z - o.cz, u = dx * o.ux + dz * o.uz, v = dx * o.vx + dz * o.vz, R = o.rock;
    const a = (v - R.v) / (R.ra + pad), w = (u - R.u) / (R.ru + pad);
    if (a * a + w * w < 1) return true;
  }
  return false;
}

/* ---------- look ---------- */
function createOverhangKit() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.shared = true;
  // the terrain's palette and colouring rules (js/game.js buildTerrainMesh), so rock tops weather like the slopes
  const COL = { meadow: '#8cab69', dry: '#aca66e', forest: '#62834b', high: '#b5afa3', rock: '#8b857a', snow: '#eef2f4' };
  for (const k in COL) COL[k] = new THREE.Color(COL[k]);
  const PAL_DEF = { dry: [40, 170], forestTop: [150, 225], high: [185, 275], snow: null };
  const c = new THREE.Color();
  function colour(x, z, h, ny, PAL, rand) {
    c.copy(COL.meadow).lerp(COL.dry, smoothstep(PAL.dry[0], PAL.dry[1], h));
    const f = noiseB(x * 0.006 + 40, z * 0.006 - 13), fm = COURSE.trees.mask == null ? 0.52 : COURSE.trees.mask;
    if (f > fm) c.lerp(COL.forest, smoothstep(fm, fm + 0.14, f) * (1 - smoothstep(PAL.forestTop[0], PAL.forestTop[1], h)));
    c.lerp(COL.high, smoothstep(PAL.high[0], PAL.high[1], h));
    c.lerp(COL.rock, Math.max(smoothstep(0.84, 0.62, ny), 0.7));   // bare rock even on top: no meadow on a ledge
    if (PAL.snow && h > PAL.snow[0]) c.lerp(COL.snow, smoothstep(PAL.snow[0], PAL.snow[1], h) * smoothstep(0.5, 0.78, ny));
    const j = 0.93 + rand() * 0.12;
    c.r *= j; c.g *= j; c.b *= j;
  }

  function build(group) {
    if (!OVERHANGS.length) return;
    const PAL = Object.assign({}, PAL_DEF, COURSE.palette), rand = mulberry32(23);
    const pos = [], col = [];
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3(), out = new THREE.Vector3();
    // one flat triangle, wound to face away from `inside` (a point within the rock)
    const tri = (a, b, d, inside) => {
      e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); e2.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
      nrm.crossVectors(e1, e2);
      const cx = (a[0] + b[0] + d[0]) / 3, cy = (a[1] + b[1] + d[1]) / 3, cz = (a[2] + b[2] + d[2]) / 3;
      out.set(cx - inside[0], cy - inside[1], cz - inside[2]);
      if (nrm.dot(out) < 0) { const t = b; b = d; d = t; nrm.negate(); }
      nrm.normalize();
      pos.push(...a, ...b, ...d);
      colour(cx, cz, cy, nrm.y, PAL, rand);
      for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
    };
    for (const o of OVERHANGS) {
      const W = (v, y, u) => [o.cx + o.vx * v + o.ux * u, y, o.cz + o.vz * v + o.uz * u];
      if (o.rock) {                                          // boulder: an icosahedron, corners pushed in and out
        const R = o.rock, g = new THREE.IcosahedronGeometry(1, 0), P = g.attributes.position, rr = mulberry32(R.seed);
        const jit = new Map(), q = [];
        for (let i = 0; i < P.count; i++) {
          const key = `${P.getX(i).toFixed(3)},${P.getY(i).toFixed(3)},${P.getZ(i).toFixed(3)}`;
          if (!jit.has(key)) jit.set(key, 0.82 + rr() * 0.3);
          const f = jit.get(key);
          q.push(W(R.v + P.getX(i) * R.ra * f, R.y + P.getY(i) * R.ry * f, R.u + P.getZ(i) * R.ru * f));
        }
        const ctr = W(R.v, R.y, R.u);
        for (let i = 0; i < q.length; i += 3) tri(q[i], q[i + 1], q[i + 2], ctr);
        g.dispose();
        continue;
      }
      // swept tube: a ring of OH_SIDES corners per spine node, each corner nudged in and out
      const S = o.spine, rings = [], rr = mulberry32(o.at * 1000 + 7), twist = rr() * TAU;
      for (let i = 0; i < S.length; i++) {
        const nd = S[i], ring = [];
        for (let k = 0; k < OH_SIDES; k++) {
          const ang = twist + i * 0.5 + (k + (rr() - 0.5) * 0.5) * TAU / OH_SIDES, f = 0.85 + rr() * 0.3;
          const au = Math.cos(ang) * nd.ra * f, ab = Math.sin(ang) * nd.rb * f;
          ring.push(W(nd.v + nd.bv * ab, nd.y + nd.by * ab, nd.u + au));
        }
        rings.push(ring);
      }
      for (let i = 0; i < S.length - 1; i++) {
        const A = rings[i], B = rings[i + 1], mid = W((S[i].v + S[i + 1].v) / 2, (S[i].y + S[i + 1].y) / 2, (S[i].u + S[i + 1].u) / 2);
        for (let k = 0; k < OH_SIDES; k++) {
          const k1 = (k + 1) % OH_SIDES;
          tri(A[k], B[k], B[k1], mid); tri(A[k], B[k1], A[k1], mid);
        }
      }
      if (o.capEnd) {                                        // blunt point at the tip
        const e = S[S.length - 1], f = S[S.length - 2], L = Math.hypot(e.v - f.v, e.y - f.y, e.u - f.u) || 1;
        const k = Math.min(e.ra, e.rb) * 0.6 / L, apex = W(e.v + (e.v - f.v) * k, e.y + (e.y - f.y) * k - e.rb * 0.3, e.u + (e.u - f.u) * k);
        const ring = rings[rings.length - 1], ctr = W(e.v, e.y, e.u);
        for (let j = 0; j < OH_SIDES; j++) tri(ring[j], ring[(j + 1) % OH_SIDES], apex, ctr);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();                                 // non-indexed: flat, faceted, like the terrain
    group.add(new THREE.Mesh(g, mat));
  }
  return { build };
}
