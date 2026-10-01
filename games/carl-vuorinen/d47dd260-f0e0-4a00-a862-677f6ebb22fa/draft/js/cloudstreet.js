'use strict';
/* =========================================================================
   CLOUD STREETS — a row of cumulus lined up along the wind, with a band of rising air under the whole row, for
   FLIGHT_MODEL 'sail' (js/sailplane.js). Under a street a glider needn't circle: flown straight along it, it climbs
   under each cloud and holds on in the gaps, fast enough in Dive to race along without losing height. Off to either
   side the air sinks a little, so wandering out of it costs.
   Course file: streets: [{ pts, base, w, width, every, gap, sink }]
     pts    the street's line on the ground, start to end, [[x, z], ...] (straight between the points)
     base   the clouds' flat base (m above the water); the lift fades out over the FADE m below it
     w      rising air under a cloud's middle (m/s, default 5.5); in the gaps between clouds `gap` of it (default 0.45)
     width  half-width of the band (m, default 100): full lift across its middle half, nothing at its edge; past the
            edge the air sinks at `sink` of w (default 0.25) out to about twice the width
     every  cloud spacing along it (m, default 300); the clouds are spread evenly over its length, so it's a guide
   The lift tapers in over the first half-cloud and out over the last. Sim part (no DOM): streetLift(x, y, z) (m/s,
   negative in the sink), added to the rest by js/sailplane.js (LIFT_PLUGINS); streetList() for the tests.
   Game part: the clouds (puffs for js/clouds.js to shape), specks drifting up under them, and birds gliding along
   the row (SCENERY_PLUGINS); the first time a run meets the lift, a hint (LIFT_HINTS, read by js/game.js).
   ========================================================================= */
const STREET_DEF = { w: 5.5, gap: 0.45, width: 100, every: 300, sink: 0.25 };
const STREET_FADE = 60, STREET_TOP = 10;                      // lift fades out from FADE + TOP m under the base to TOP m under it
let _stFor = null;
const _st = [];
function streetList() {
  if (_stFor === COURSE) return _st;
  _stFor = COURSE; _st.length = 0;
  for (const spec of (COURSE && COURSE.streets) || []) {
    const o = Object.assign({}, STREET_DEF, spec), P = spec.pts, X = [], Z = [], A = [0];
    for (const p of P) { X.push(p[0]); Z.push(p[1]); }
    for (let i = 1; i < P.length; i++) A.push(A[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]));
    const L = A[A.length - 1], n = Math.max(1, Math.round(L / o.every)), sp = L / n, pad = o.width * 2.5;
    _st.push({ o, X, Z, A, L, n, sp, x0: Math.min(...X) - pad, x1: Math.max(...X) + pad, z0: Math.min(...Z) - pad, z1: Math.max(...Z) + pad });
  }
  return _st;
}
// where (x, z) is along street S: a = distance along it, d = distance off its line (0 past the ends' squares), past
const SQ = { a: 0, d: 0, past: 0 };
function streetNear(S, x, z) {
  let bd = Infinity;
  for (let i = 0; i + 1 < S.X.length; i++) {
    const sx = S.X[i + 1] - S.X[i], sz = S.Z[i + 1] - S.Z[i], l = S.A[i + 1] - S.A[i];
    const t = ((x - S.X[i]) * sx + (z - S.Z[i]) * sz) / (l * l), tc = clamp(t, 0, 1);
    const ex = x - S.X[i] - sx * tc, ez = z - S.Z[i] - sz * tc, d = Math.hypot(ex, ez);
    if (d < bd) { bd = d; SQ.a = S.A[i] + l * tc; SQ.past = t < 0 && i === 0 ? -t * l : t > 1 && i === S.X.length - 2 ? (t - 1) * l : 0; }
  }
  SQ.d = SQ.past > 0 ? Math.sqrt(Math.max(0, bd * bd - SQ.past * SQ.past)) : bd;
  return SQ;
}
function streetLift(x, y, z) {
  const ST = streetList();
  let w = 0;
  for (let s = 0; s < ST.length; s++) {
    const S = ST[s], o = S.o;
    if (x < S.x0 || x > S.x1 || z < S.z0 || z > S.z1) continue;
    const top = o.base - STREET_TOP;
    if (y >= top) continue;
    const q = streetNear(S, x, z);
    if (q.past > 0 || q.d > o.width * 2.4) continue;
    const kv = smoothstep(top, top - STREET_FADE, y);
    const ends = smoothstep(0, S.sp * 0.5, q.a) * smoothstep(S.L, S.L - S.sp * 0.5, q.a);
    const c = 0.5 + 0.5 * Math.cos(TAU * (q.a - S.sp / 2) / S.sp);          // 1 under each cloud's middle, 0 between
    const core = smoothstep(o.width, o.width * 0.5, q.d);
    const sink = smoothstep(o.width * 0.9, o.width * 1.4, q.d) * smoothstep(o.width * 2.4, o.width * 1.8, q.d);
    w += kv * ends * o.w * (lerp(o.gap, 1, c) * core - o.sink * sink);
  }
  return w;
}
if (typeof LIFT_PLUGINS !== 'undefined') LIFT_PLUGINS.push(streetLift);
var LIFT_HINTS = LIFT_HINTS || [];
LIFT_HINTS.push({ id: 'street', min: 2, at: (P) => streetLift(P.pos.x, P.pos.y, P.pos.z),
  text: 'Cloud street! Fly straight along under the clouds: no need to circle.' });

/* ---------- scenery ---------- */
if (typeof SCENERY_PLUGINS !== 'undefined') SCENERY_PLUGINS.unshift((group) => {   // first, so js/clouds.js shapes the puffs
  const ST = streetList();
  if (!ST.length) return;
  const rand = mulberry32(((COURSE.seeds && COURSE.seeds.trees) || 1) * 7 + 29);
  const U = { stTime: { value: 0 } }, tick = () => { U.stTime.value = (performance.now() / 1000) % 10000; };
  const at = (S, a) => {                                       // point a m along street S: x, z and the unit direction
    let i = 0;
    while (i < S.A.length - 2 && S.A[i + 1] < a) i++;
    const l = S.A[i + 1] - S.A[i], t = (a - S.A[i]) / l, ux = (S.X[i + 1] - S.X[i]) / l, uz = (S.Z[i + 1] - S.Z[i]) / l;
    return { x: S.X[i] + ux * l * t, z: S.Z[i] + uz * l * t, ux, uz };
  };
  // clouds: a big cumulus over each lift cell, smaller puffs bridging the gaps so the row reads as one street
  const puffs = [];
  for (const S of ST) {
    const W = S.o.width, B = S.o.base;
    for (let k = 0; k < S.n; k++) {
      const c = at(S, (k + 0.5) * S.sp), big = 0.9 + rand() * 0.25;
      for (let i = 0; i < 18; i++) {
        const along = (rand() - 0.5) * S.sp * 0.6, across = (rand() - 0.5) * W * 1.1 * big, s = W * (0.34 + rand() * 0.26) * big;
        const tall = 1 - Math.min(1, Math.hypot(along / (S.sp * 0.3), across / (W * 0.55)));   // heaped up in the middle
        puffs.push([c.x + c.ux * along - c.uz * across, B + s * 0.2 + tall * s * 0.9 + rand() * s * 0.2, c.z + c.uz * along + c.ux * across, s]);
      }
      if (k + 1 < S.n) for (let i = 0; i < 6; i++) {        // the bridge to the next one
        const g = at(S, (k + 1) * S.sp + (rand() - 0.5) * S.sp * 0.4), s = W * (0.24 + rand() * 0.14), across = (rand() - 0.5) * W * 0.6;
        puffs.push([g.x - g.uz * across, B + s * 0.2 + rand() * s * 0.3, g.z + g.ux * across, s]);
      }
    }
  }
  const cm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#aab9c6' }), puffs.length);
  const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  puffs.forEach((pf, i) => { q.setFromEuler(e.set(0, rand() * TAU, 0)); cm.setMatrixAt(i, mx.compose(p.set(pf[0], pf[1], pf[2]), q, sc.set(pf[3], pf[3] * 0.62, pf[3]))); });
  cm.userData.clouds = true;                                   // js/clouds.js reshapes and relights tagged puffs
  cm.frustumCulled = false; group.add(cm);

  // specks: drifting up under the clouds (more under each cloud's middle), from the ground to the base
  const dc = document.createElement('canvas'); dc.width = dc.height = 32;
  const dx = dc.getContext('2d'), rg = dx.createRadialGradient(16, 16, 1, 16, 16, 16);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.45, 'rgba(255,255,255,0.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  dx.fillStyle = rg; dx.fillRect(0, 0, 32, 32);
  const dot = new THREE.CanvasTexture(dc);
  const pos = [], prm = [];
  for (const S of ST) {
    const cnt = Math.round(S.L / 6);
    for (let i = 0; i < cnt; i++) {
      let a = rand() * S.L;
      if (rand() < 0.6) a = (Math.floor(a / S.sp) + 0.5 + (rand() - 0.5) * 0.5) * S.sp;   // bunched under the clouds
      const c = at(S, clamp(a, 0, S.L)), across = (rand() - 0.5) * S.o.width * 1.1, g = groundAt(c.x - c.uz * across, c.z + c.ux * across);
      pos.push(c.x - c.uz * across, g, c.z + c.ux * across);
      prm.push(S.o.base - STREET_TOP - g, rand(), 0.025 + rand() * 0.02, rand() * TAU);
    }
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pg.setAttribute('aPrm', new THREE.Float32BufferAttribute(prm, 4));
  const pm = new THREE.PointsMaterial({ color: '#fffdf2', map: dot, size: 2.6, transparent: true, opacity: 0.8, depthWrite: false });
  pm.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform float stTime;\nattribute vec4 aPrm;\nvarying float vFade;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `float u = fract( aPrm.y + stTime * aPrm.z );
      vec3 transformed = position + vec3( sin( stTime * 0.4 + aPrm.w ) * 4.0, u * aPrm.x, cos( stTime * 0.3 + aPrm.w ) * 4.0 );
      vFade = smoothstep( 0.0, 0.1, u ) * ( 1.0 - smoothstep( 0.85, 1.0, u ) );`);
    sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('#include <premultiplied_alpha_fragment>', 'gl_FragColor.a *= vFade;\n#include <premultiplied_alpha_fragment>');
  };
  pm.customProgramCacheKey = () => 'street-specks';
  const pts = new THREE.Points(pg, pm);
  pts.frustumCulled = false; pts.onBeforeRender = tick; pts.renderOrder = 3; pts.userData.hint = true;   // (js/game.js: a mark, not scenery)
  group.add(pts);

  // birds: gliding along the street under the clouds, rising and sinking a little with the cells, wrapping round
  const wing = [[0, 0, 0.35], [-1.6, 0.25, -0.1], [-0.4, 0, -0.35], [0, 0, 0.35], [0.4, 0, -0.35], [1.6, 0.25, -0.1], [0, 0, 0.35], [0, 0, -0.6], [-0.4, 0, -0.35], [0, 0, 0.35], [0.4, 0, -0.35], [0, 0, -0.6]];
  const bp = [], b0 = [], bd = [], bb = [];
  for (const S of ST) {
    const a0 = at(S, 0), a1 = at(S, S.L);
    for (let k = 0; k < 5; k++) {
      const s = 1.6 + rand() * 0.5, y = S.o.base - 60 - rand() * 60, across = (rand() - 0.5) * S.o.width * 0.8;
      const ox = -a0.uz * across, oz = a0.ux * across, u0 = rand(), sp = 9 + rand() * 3, ph = rand() * TAU;   // per bird, not per corner
      for (const v of wing) {
        bp.push(v[0] * s, v[1] * s, v[2] * s); b0.push(a0.x + ox, y, a0.z + oz); bd.push(a1.x - a0.x, 0, a1.z - a0.z);
        bb.push(u0, sp, S.sp, ph);
      }
    }
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  bg.setAttribute('aFrom', new THREE.Float32BufferAttribute(b0, 3));
  bg.setAttribute('aRun', new THREE.Float32BufferAttribute(bd, 3));
  bg.setAttribute('aBird', new THREE.Float32BufferAttribute(bb, 4));
  const bm = new THREE.MeshBasicMaterial({ color: '#2b2a28', side: THREE.DoubleSide });
  bm.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform float stTime;\nattribute vec3 aFrom;\nattribute vec3 aRun;\nattribute vec4 aBird;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `float L = length( aRun.xz );
      float u = fract( aBird.x + stTime * aBird.y / L );
      float a = u * L;
      float flap = sin( stTime * 9.0 + aBird.w ) * smoothstep( 0.8, 0.97, sin( stTime * 0.5 + aBird.w ) );
      vec3 p = position; p.y += abs( p.x ) * flap * 0.5;
      vec3 fwd = vec3( aRun.x, 0.0, aRun.z ) / L, rgt = vec3( -fwd.z, 0.0, fwd.x );
      float bob = cos( 6.2831853 * ( a - aBird.z * 0.5 ) / aBird.z ) * 8.0;   // up under the clouds, down between
      vec3 transformed = aFrom + fwd * a + vec3( 0.0, bob, 0.0 ) + rgt * p.x + vec3( 0.0, p.y, 0.0 ) + fwd * p.z;
      if ( u < 0.02 || u > 0.98 ) transformed = aFrom + vec3( 0.0, -9999.0, 0.0 );`);
  };
  bm.customProgramCacheKey = () => 'street-birds';
  const birds = new THREE.Mesh(bg, bm);
  birds.frustumCulled = false; birds.onBeforeRender = tick;
  group.add(birds);
});
