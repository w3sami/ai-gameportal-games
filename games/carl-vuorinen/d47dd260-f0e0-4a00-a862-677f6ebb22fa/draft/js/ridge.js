'use strict';
/* =========================================================================
   RIDGE — cliffs along a shore, and the ridge lift in front of them (for FLIGHT_MODEL 'sail', js/sailplane.js).
   A breeze blows in off the water onto every cliff; where it meets the face it's pushed up, so a band of rising air
   stands in front of it: strongest close to the face from about half its height to a little over its top, weakening
   steadily further out over the water and fading out higher up. Flown close in, a glider holds its height or climbs
   without circling; behind the top edge the lift soon gives out, and further back over the land the air sinks a
   little (the lee).
   Course file: ridges: [{ pts, side, face, wobble, plateau, deep, shelf, w, out, above, back, lee }]
     pts      [[x, z, top], ...] the cliff's top edge, end to end; a smooth curve is drawn through them. top = height
              of the edge there (m); let the ends come down low so the cliff tapers into the shore
     side     which side of the pts' direction the land is on: 'left' (default) or 'right'; the water is on the other
     face     how far out from the top edge the face reaches the water (m, default 35): steep at the top, a scree
              slope at the foot. Keep it at least 3 terrain cells, or the mesh can't show a cliff
     wobble   the edge wanders up to this far either way (m, default 7), for the eye and the lift alike
     plateau  land at the top's height reaches this far back from the edge (m, default 280), then slopes down into
              the hills (the hills win wherever they're higher)
     deep, shelf  the water at the foot is at least `deep` m deep (default 18), out to `shelf` m (default 200)
     w        the lift at its strongest, right in front of the face (m/s, default 6); it weakens steadily further out
     out      how far out from the top edge the lift reaches (m, default face + 50 + 0.4 * height)
     above    how far over the top edge it reaches (m, default 25 + 0.45 * height)
     back     how far back over the land from the edge it gives out (m, default 55); lee: the sink behind that, as a
              share of w (default 0.3)
   A course without ridges gets none of this. Sim part (no DOM): buildRidges() raises the cliffs into the terrain (a
   js/shore.js plugin, so after the valley carving and before the trees, which keep off the face by its slope),
   ridgeLift(x, y, z) is the rising air (m/s, negative in the lee), added to the thermals' by js/sailplane.js
   (LIFT_PLUGINS). Game part: gulls hanging in the lift along each cliff (SCENERY_PLUGINS).
   ========================================================================= */
const RIDGE_DEF = { side: 'left', face: 35, wobble: 7, plateau: 280, deep: 18, shelf: 200, w: 6, out: null, above: null, back: 55, lee: 0.3 };
const RIDGE_STEP = 15;                                        // spacing of the smooth curve's points (m)
const RIDGE_CAP = 90;                                         // past its ends a cliff fades out over this far (m)
let _rgFor = null, _rgNoise = null;
const _rg = [];
// per ridge: the settings, the dense curve (x, z, top), its segments' unit tangents and lengths, and a bounding box
function ridgeList() {
  if (_rgFor === COURSE) return _rg;
  _rgFor = COURSE; _rg.length = 0;
  const list = (COURSE && COURSE.ridges) || [];
  if (list.length) _rgNoise = makeNoise(((COURSE.seeds && COURSE.seeds.c) || 1) * 31 + 7);
  for (const spec of list) {
    const o = Object.assign({}, RIDGE_DEF, spec);
    const c = new THREE.CatmullRomCurve3(spec.pts.map((p) => new THREE.Vector3(p[0], p[2], p[1])), false, 'centripetal');
    const n = Math.max(2, Math.ceil(c.getLength() / RIDGE_STEP)), X = [], Z = [], T = [];
    for (let i = 0; i <= n; i++) { const p = c.getPointAt(i / n); X.push(p.x); Z.push(p.z); T.push(p.y); }
    const sgn = o.side === 'right' ? -1 : 1, UX = [], UZ = [], L = [];
    for (let i = 0; i < n; i++) { const dx = X[i + 1] - X[i], dz = Z[i + 1] - Z[i], l = Math.hypot(dx, dz) || 1; UX.push(dx / l); UZ.push(dz / l); L.push(l); }
    let top = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i <= n; i++) { top = Math.max(top, T[i]); x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); z0 = Math.min(z0, Z[i]); z1 = Math.max(z1, Z[i]); }
    _rg.push({ o, X, Z, T, UX, UZ, L, n, sgn, x0, x1, z0, z1, top });
  }
  return _rg;
}
// wander of the top edge at (x, z) (m, + = further out over the water)
const ridgeWobble = (o, x, z) => o.wobble ? (fbm(_rgNoise, x * 0.012 + 5.1, z * 0.012 - 2.7, 3) - 0.5) * 2.4 * o.wobble : 0;
// nearest point of ridge R's curve to (x, z): s = distance from the top edge (+ = back over the land), top there,
// past = how far beyond an end of the curve (0 alongside it)
const RQ = { s: 0, top: 0, past: 0 };
function ridgeNear(R, x, z) {
  let bd = Infinity, bi = 0, bt = 0;
  for (let i = 0; i < R.n; i++) {
    const dx = x - R.X[i], dz = z - R.Z[i];
    const t = clamp((dx * R.UX[i] + dz * R.UZ[i]) / R.L[i], 0, 1);
    const ex = dx - R.UX[i] * R.L[i] * t, ez = dz - R.UZ[i] * R.L[i] * t, d = ex * ex + ez * ez;
    if (d < bd) { bd = d; bi = i; bt = t; }
  }
  // signed across the nearest segment, measured along its normal; past the curve's ends, how far past
  const dx = x - R.X[bi], dz = z - R.Z[bi], along = dx * R.UX[bi] + dz * R.UZ[bi];
  RQ.s = R.sgn * (dx * R.UZ[bi] - dz * R.UX[bi]);
  RQ.top = lerp(R.T[bi], R.T[bi + 1], bt);
  RQ.past = bi === 0 && along < 0 ? -along : bi === R.n - 1 && along > R.L[bi] ? along - R.L[bi] : 0;
  return RQ;
}

/* ---------- the cliffs, raised into the terrain (a js/shore.js plugin) ---------- */
function buildRidges() {
  const RG = ridgeList();
  if (!RG.length) return;
  const W = TER.N + 1, cell = TER.CELL, water = TER.WATER;
  for (const R of RG) {
    const o = R.o, F = o.face, reach = Math.max(o.plateau + (R.top - water) * 4, o.shelf + F) + RIDGE_CAP;
    const i0 = Math.max(0, Math.floor((R.x0 - reach - TER.X0) / cell)), i1 = Math.min(TER.N, Math.ceil((R.x1 + reach - TER.X0) / cell));
    const j0 = Math.max(0, Math.floor((R.z0 - reach - TER.Z0) / cell)), j1 = Math.min(TER.N, Math.ceil((R.z1 + reach - TER.Z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * W + i, x = TER.X0 + i * cell, z = TER.Z0 + j * cell;
      const q = ridgeNear(R, x, z), fade = smoothstep(RIDGE_CAP, 0, q.past);
      if (fade <= 0) continue;
      const s = q.s + ridgeWobble(o, x, z), T = q.top, h0 = TH[k];
      let h = h0;
      if (s >= 0) {                                          // the land on top: level, a little lumpy, then down into the hills
        const bump = (fbm(_rgNoise, x * 0.02 - 9.4, z * 0.02 + 3.3, 2) - 0.5) * 7 * smoothstep(0, 25, s);
        h = Math.max(h, T + bump + Math.min(s, o.plateau) * 0.02 - Math.max(0, s - o.plateau) * 0.25);
      } else if (s > -F) {                                   // the face: steep at the top, easing into scree at the foot
        const t = (s + F) / F;
        h = Math.max(h, water - 4 + (T - water + 4) * Math.pow(t, 1.8));
      }
      const u = -s - F;                                      // out over the water from the foot: deep enough, out to the shelf
      if (u > -F * 0.5) h = Math.min(h, lerp(water - o.deep * smoothstep(-F * 0.5, o.shelf * 0.25, u), h, smoothstep(o.shelf * 0.6, o.shelf, u)));
      TH[k] = lerp(h0, h, fade);
    }
  }
}
SHORE_PLUGINS.push({ build: buildRidges, createKit: () => ({ build() {} }) });

/* ---------- the lift ---------- */
function ridgeLift(x, y, z) {
  const RG = ridgeList();
  let w = 0;
  for (let r = 0; r < RG.length; r++) {
    const R = RG[r], o = R.o;
    if (x < R.x0 - 600 || x > R.x1 + 600 || z < R.z0 - 600 || z > R.z1 + 600) continue;
    const q = ridgeNear(R, x, z), fade = smoothstep(RIDGE_CAP, 0, q.past);
    if (fade <= 0) continue;
    const H = Math.max(8, q.top - TER.WATER), d = -(q.s + ridgeWobble(o, x, z));   // d: out from the top edge
    const out = o.out != null ? o.out : o.face + 50 + 0.4 * H, above = o.above != null ? o.above : 25 + 0.45 * H;
    const hy = y - TER.WATER;
    if (hy > H + above) continue;
    let fh;
    if (d >= 0) fh = smoothstep(out, 0, d);                  // strongest close in, weaker the further out
    else {                                                   // back over the land: gives out, then the lee sinks
      const u = smoothstep(-o.back, 0, d);
      fh = u - o.lee * (1 - u) * smoothstep(-4 * o.back, -2 * o.back, d);
    }
    if (fh === 0) continue;
    // up the face from about a tenth of its height, strongest near the top, fading out over it
    const fv = smoothstep(0.1 * H, 0.55 * H, hy) * (0.75 + 0.25 * smoothstep(0.4 * H, H, hy)) * smoothstep(H + above, H + above * 0.3, hy);
    w += o.w * fh * fv * fade;
  }
  return w;
}
if (typeof LIFT_PLUGINS !== 'undefined') LIFT_PLUGINS.push(ridgeLift);

/* =========================================================================
   Game part: gulls hanging in the lift, gliding slow loops along each cliff near its top (not used by the tests)
   ========================================================================= */
if (typeof SCENERY_PLUGINS !== 'undefined') SCENERY_PLUGINS.push((group) => {
  const RG = ridgeList();
  if (!RG.length) return;
  const rand = mulberry32(((COURSE.seeds && COURSE.seeds.trees) || 1) * 5 + 17);
  // a gull: bent wings (the M shape), a short body; half span 1 before scaling
  const wing = [[0, 0, 0.3], [-0.45, 0.12, 0.05], [0, 0, -0.2], [-0.45, 0.12, 0.05], [-1, -0.05, 0.12], [-0.5, 0.1, -0.12],
    [0, 0, 0.3], [0, 0, -0.2], [0.45, 0.12, 0.05], [0.45, 0.12, 0.05], [0.5, 0.1, -0.12], [1, -0.05, 0.12],
    [0, 0.02, 0.45], [-0.06, 0.02, -0.6], [0.06, 0.02, -0.6]];
  const bp = [], bc = [], bl = [], bm = [];
  // none whose loop comes within GULL_CLEAR m of the line, so the camera never flies through one
  const GULL_CLEAR = 28;
  const gullNearLine = (x, y, z, ux, uz, A, B) => {
    for (let k = 0; k < 12; k++) {
      const th = k / 12 * TAU, px = x + ux * A * Math.sin(th) - uz * B * Math.cos(th), pz = z + uz * A * Math.sin(th) + ux * B * Math.cos(th);
      for (let j = 0; j < SAMPLES.length; j += 2) {
        const q = SAMPLES[j];
        if ((q.x - px) ** 2 + (q.y - y) ** 2 + (q.z - pz) ** 2 < GULL_CLEAR * GULL_CLEAR) return true;
      }
    }
    return false;
  };
  for (const R of RG) {
    const o = R.o, count = Math.floor(R.n * RIDGE_STEP / 90);
    for (let g = 0; g < count; g++) {
      const i = Math.min(R.n - 1, Math.floor(rand() * R.n)), T = R.T[i];
      if (T - TER.WATER < 30) continue;
      // the loop's centre: just out from the top edge and over it, in the lift but above and inside a line flown 40 m out
      const nx = R.sgn * R.UZ[i], nz = -R.sgn * R.UX[i];         // land-side normal
      const d = 8 + rand() * 14, x = R.X[i] - nx * d, z = R.Z[i] - nz * d, y = T + 16 + rand() * 30;
      const s = 1.7 + rand() * 0.5, A = 25 + rand() * 45, B = 4 + rand() * 4, sp = 0.12 + rand() * 0.06, ph = rand() * TAU;
      if (gullNearLine(x, y, z, R.UX[i], R.UZ[i], A, B)) continue;
      for (const v of wing) { bp.push(v[0] * s, v[1] * s, v[2] * s); bc.push(x, y, z); bl.push(R.UX[i], R.UZ[i], A, B); bm.push(sp, ph, rand() * TAU); }
    }
  }
  if (!bp.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  geo.setAttribute('aCtr', new THREE.Float32BufferAttribute(bc, 3));
  geo.setAttribute('aLoop', new THREE.Float32BufferAttribute(bl, 4));
  geo.setAttribute('aMove', new THREE.Float32BufferAttribute(bm, 3));
  const U = { rgTime: { value: 0 } };
  const mat = new THREE.MeshBasicMaterial({ color: '#eef0ee', side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform float rgTime;\nattribute vec3 aCtr;\nattribute vec4 aLoop;\nattribute vec3 aMove;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `float th = aMove.y + rgTime * aMove.x;
      vec2 u = aLoop.xy, n = vec2( -u.y, u.x );
      // a long flat loop along the face: pos = along * A sin + across * B cos; heading along its tangent
      vec2 off = u * aLoop.z * sin( th ) + n * aLoop.w * cos( th );
      vec2 tg = normalize( u * aLoop.z * cos( th ) - n * aLoop.w * sin( th ) );
      vec3 p = position;
      p.y += sin( rgTime * 1.3 + aMove.z ) * 0.08 * abs( p.x );        // wings flex a little in the gusts
      float bank = 0.55 * sin( th ) * sin( th );                     // the loop turns left; banked hardest round its ends
      p = vec3( p.x * cos( bank ) - p.y * sin( bank ), p.x * sin( bank ) + p.y * cos( bank ), p.z );
      vec3 fwd = vec3( tg.x, 0.0, tg.y ), rgt = vec3( -tg.y, 0.0, tg.x );
      vec3 transformed = aCtr + vec3( off.x, sin( rgTime * 0.7 + aMove.z ) * 1.5, off.y ) + rgt * p.x + vec3( 0.0, p.y, 0.0 ) + fwd * p.z;`);
  };
  mat.customProgramCacheKey = () => 'ridge-gulls';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.onBeforeRender = () => { U.rgTime.value = (performance.now() / 1000) % 10000; };
  group.add(mesh);
});
