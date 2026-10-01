'use strict';
/* =========================================================================
   RIDGE — cliffs along a shore, and the ridge lift in front of them (for FLIGHT_MODEL 'sail', js/sailplane.js).
   A breeze blows in off the water onto every cliff; where it meets the face it's pushed up, so a band of rising air
   stands in front of it: strongest close to the face from about half its height to a little over its top, weakening
   steadily further out over the water and fading out higher up. Flown close in, a glider holds its height or climbs
   without circling; behind the top edge the lift soon gives out, and further back over the land the air sinks a
   little (the lee).
   Course file: ridges: [{ pts, side, face, wobble, rough, gully, plateau, deep, shelf, w, out, above, back, lee }]
     pts      [[x, z, top], ...] the cliff's top edge, end to end; a smooth curve is drawn through them. top = height
              of the edge there (m); let the ends come down low so the cliff tapers into the shore
     side     which side of the pts' direction the land is on: 'left' (default) or 'right'; the water is on the other
     face     how far out from the top edge the face reaches the water (m, default 35, varying by about a quarter
              either way along the cliff): steep at the top, a scree slope at the foot, some stretches sheerer than
              others. Keep it at least 3 terrain cells, or the mesh can't show a cliff
     wobble   headlands and coves: the edge juts out or sets back up to about this far (m, default 12)
     rough    the top rises and falls up to about this far off the pts' heights (m, default 12), and here and there a
              notch is cut down into it, up to `gully` m deep (default 24, at most 0.3 of the cliff's height)
              All the variety is laid out along the cliff, so the lift follows the same edge the eye sees; it fades
              out where the cliff is low, so its tapering ends stay plain.
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
   (LIFT_PLUGINS). Game part: the wind drawn as streaks flowing in and up each cliff's face (SCENERY_PLUGINS).
   ========================================================================= */
const RIDGE_DEF = { side: 'left', face: 35, wobble: 12, rough: 12, gully: 24, plateau: 280, deep: 18, shelf: 200, w: 6, out: null, above: null, back: 55, lee: 0.3 };
const RIDGE_STEP = 15;                                        // spacing of the smooth curve's points (m)
const RIDGE_CAP = 90;                                         // past its ends a cliff fades out over this far (m)
let _rgFor = null;
const _rg = [];
// per ridge: the settings, the dense curve (x, z, top), its segments' unit tangents and lengths, a bounding box, and per
// point the variety: WB how far the edge juts out (m), TP the top there (curve top + roughness - gullies), FC the
// face's width, PW its shape (higher = sheerer at the top)
function ridgeList() {
  if (_rgFor === COURSE) return _rg;
  _rgFor = COURSE; _rg.length = 0;
  const list = (COURSE && COURSE.ridges) || [];
  list.forEach((spec, r) => {
    const o = Object.assign({}, RIDGE_DEF, spec), nz = makeNoise(((COURSE.seeds && COURSE.seeds.c) || 1) * 31 + 7 + r * 101);
    const c = new THREE.CatmullRomCurve3(spec.pts.map((p) => new THREE.Vector3(p[0], p[2], p[1])), false, 'centripetal');
    const len = c.getLength(), n = Math.max(2, Math.ceil(len / RIDGE_STEP)), X = [], Z = [], T = [], WB = [], TP = [], FC = [], PW = [];
    for (let i = 0; i <= n; i++) {
      const p = c.getPointAt(i / n), a = i / n * len, H = p.y - TER.WATER, k = smoothstep(15, 60, H);   // low ends stay plain
      X.push(p.x); Z.push(p.z); T.push(p.y);
      // headlands and coves a few hundred m long, with smaller jags on them
      WB.push(((fbm(nz, a * 0.004, 3.1, 2) - 0.5) * 2.6 + (nz(a * 0.022, 8.7) - 0.5) * 0.7) * o.wobble * k);
      // the skyline: rolling highs and lows, and now and then a notch cut down into the top
      const g = smoothstep(0.66, 0.8, nz(a * 0.011 + 40.5, 17.2));
      TP.push(p.y + ((fbm(nz, a * 0.007 + 20.3, 5.9, 3) - 0.5) * 2.6 * o.rough - g * Math.min(o.gully, 0.3 * H)) * k);
      FC.push(o.face * (0.72 + 0.56 * nz(a * 0.009 + 60.1, 2.4)));
      PW.push(1.4 + 1.1 * nz(a * 0.013 + 80.7, 9.3));
    }
    const sgn = o.side === 'right' ? -1 : 1, UX = [], UZ = [], L = [];
    for (let i = 0; i < n; i++) { const dx = X[i + 1] - X[i], dz = Z[i + 1] - Z[i], l = Math.hypot(dx, dz) || 1; UX.push(dx / l); UZ.push(dz / l); L.push(l); }
    let top = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i <= n; i++) { top = Math.max(top, TP[i]); x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); z0 = Math.min(z0, Z[i]); z1 = Math.max(z1, Z[i]); }
    _rg.push({ o, X, Z, T, WB, TP, FC, PW, UX, UZ, L, n, sgn, x0, x1, z0, z1, top });
  });
  return _rg;
}
// nearest point of ridge R's curve to (x, z): s = distance from the (jutting) top edge (+ = back over the land), and
// the top, face width and shape there; past = how far beyond an end of the curve (0 alongside it)
const RQ = { s: 0, top: 0, face: 0, pw: 0, past: 0 };
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
  RQ.s = R.sgn * (dx * R.UZ[bi] - dz * R.UX[bi]) + lerp(R.WB[bi], R.WB[bi + 1], bt);
  RQ.top = lerp(R.TP[bi], R.TP[bi + 1], bt);
  RQ.face = lerp(R.FC[bi], R.FC[bi + 1], bt);
  RQ.pw = lerp(R.PW[bi], R.PW[bi + 1], bt);
  RQ.past = bi === 0 && along < 0 ? -along : bi === R.n - 1 && along > R.L[bi] ? along - R.L[bi] : 0;
  return RQ;
}

/* ---------- the cliffs, raised into the terrain (a js/shore.js plugin) ---------- */
function buildRidges() {
  const RG = ridgeList();
  if (!RG.length) return;
  const W = TER.N + 1, cell = TER.CELL, water = TER.WATER, bumpN = makeNoise(((COURSE.seeds && COURSE.seeds.c) || 1) * 17 + 3);
  for (const R of RG) {
    const o = R.o, reach = Math.max(o.plateau + (R.top - water) * 4, o.shelf + o.face * 1.3) + o.wobble + RIDGE_CAP;
    const i0 = Math.max(0, Math.floor((R.x0 - reach - TER.X0) / cell)), i1 = Math.min(TER.N, Math.ceil((R.x1 + reach - TER.X0) / cell));
    const j0 = Math.max(0, Math.floor((R.z0 - reach - TER.Z0) / cell)), j1 = Math.min(TER.N, Math.ceil((R.z1 + reach - TER.Z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * W + i, x = TER.X0 + i * cell, z = TER.Z0 + j * cell;
      const q = ridgeNear(R, x, z), fade = smoothstep(RIDGE_CAP, 0, q.past);
      if (fade <= 0) continue;
      const s = q.s, T = q.top, F = q.face, h0 = TH[k];
      let h = h0;
      if (s >= 0) {                                          // the land on top: level, a little lumpy, then down into the hills
        const bump = (fbm(bumpN, x * 0.02 - 9.4, z * 0.02 + 3.3, 2) - 0.5) * 7 * smoothstep(0, 25, s);
        h = Math.max(h, T + bump + Math.min(s, o.plateau) * 0.02 - Math.max(0, s - o.plateau) * 0.25);
      } else if (s > -F) {                                   // the face: steep at the top, easing into scree at the foot
        const t = (s + F) / F;
        h = Math.max(h, water - 4 + (T - water + 4) * Math.pow(t, q.pw));
      }
      const u = -s - F;                                      // out over the water from the foot: deep enough, out to the shelf
      if (u > -F * 0.5) h = Math.min(h, lerp(water - o.deep * smoothstep(-F * 0.5, o.shelf * 0.25, u), h, smoothstep(o.shelf * 0.6, o.shelf, u)));
      TH[k] = lerp(h0, h, fade);
    }
  }
}
SHORE_PLUGINS.push({ build: buildRidges, createKit: () => ({ build() {} }) });
var LIFT_HINTS = LIFT_HINTS || [];                           // js/game.js: the first ridge lift of a run gets a hint
LIFT_HINTS.push({ id: 'ridge', min: 2.5, at: (P) => ridgeLift(P.pos.x, P.pos.y, P.pos.z),
  text: 'Ridge lift! Stay close to the cliff and it holds you up.' });

/* ---------- the lift ---------- */
function ridgeLift(x, y, z) {
  const RG = ridgeList();
  let w = 0;
  for (let r = 0; r < RG.length; r++) {
    const R = RG[r], o = R.o;
    if (x < R.x0 - 600 || x > R.x1 + 600 || z < R.z0 - 600 || z > R.z1 + 600) continue;
    const q = ridgeNear(R, x, z), fade = smoothstep(RIDGE_CAP, 0, q.past);
    if (fade <= 0) continue;
    const H = Math.max(8, q.top - TER.WATER), d = -q.s;       // d: out from the top edge
    const out = o.out != null ? o.out : q.face + 50 + 0.4 * H, above = o.above != null ? o.above : 25 + 0.45 * H;
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
   Game part: the wind, drawn (not used by the tests). Streamlines traced through the lift itself: in off the water
   low down, bending up as they near the cliff, climbing its face and spilling over the top. Pale streaks run along
   them wherever the air rises (the level run-in stays unseen), so they show where the lift starts and how strong it is.
   ========================================================================= */
const WIND_LINE = { every: 26, speed: 16, dash: 22, gap: 38, width: 0.7, near: 250, far: 1100, flow: 5, clear: [7, 20] };
// one streamline from `d` m out and `y` m up at curve point i of ridge R, keeping `clear` m off the rock: [[x, y, z], ...]
// every 4 m
function traceWind(R, i, d, y, clear) {
  const nx = R.sgn * R.UZ[i], nz = -R.sgn * R.UX[i];          // land-side normal at the start; the line keeps it
  let x = R.X[i] - nx * (d - R.WB[i]), z = R.Z[i] - nz * (d - R.WB[i]);
  const pts = [], step = 4;
  for (let k = 0; k < 120; k++) {
    // it keeps `clear` m off the rock ahead, so near the face it curves up early and climbs in the air in front of it
    // rather than being drawn onto it
    let g = 0;
    for (let a = 0; a <= clear; a += clear / 4) g = Math.max(g, groundAt(x + nx * a, z + nz * a) + 3);
    if (y < g) y = lerp(y, g, 0.6);                          // eased, so the bend is a curve, not a kink
    pts.push([x, y, z]);
    const q = ridgeNear(R, x, z);
    if (q.s > R.o.back * 1.4) break;                         // well back over the top
    const w = ridgeLift(x, y, z);
    x += nx * step; z += nz * step; y += step * w / WIND_LINE.flow;
  }
  return pts;
}
if (typeof SCENERY_PLUGINS !== 'undefined') SCENERY_PLUGINS.push((group) => {
  const RG = ridgeList();
  if (!RG.length) return;
  const rand = mulberry32(((COURSE.seeds && COURSE.seeds.trees) || 1) * 5 + 17);
  const pos = [], dir = [], side = [], along = [];
  const idx = [];
  for (const R of RG) {
    const per = WIND_LINE.every / RIDGE_STEP;
    for (let f = rand() * per; f < R.n; f += per * (0.6 + rand() * 0.8)) {
      const i = Math.min(R.n - 1, Math.floor(f)), H = R.TP[i] - TER.WATER;
      if (H < 25) continue;
      // mostly low starts, so the lines meet the face and climb it; a few higher ones cross over the top
      const y = TER.WATER + H * (rand() < 0.8 ? 0.06 + rand() * 0.45 : 0.5 + rand() * 0.5), d = 70 + rand() * 90;
      const pts = traceWind(R, i, d, y, WIND_LINE.clear[0] + rand() * (WIND_LINE.clear[1] - WIND_LINE.clear[0]));   // some hug it, some stand off
      if (pts.length < 8) continue;
      const base = pos.length / 3;
      let u = rand() * 100;                                  // streaks start at a random place along each line
      for (let k = 0; k < pts.length; k++) {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
        if (k) u += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]);
        for (const sd of [-1, 1]) {
          pos.push(pts[k][0], pts[k][1], pts[k][2]); dir.push(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
          side.push(sd); along.push(u, k / (pts.length - 1));
        }
        if (k) { const v = base + k * 2; idx.push(v - 2, v - 1, v, v - 1, v + 1, v); }
      }
    }
  }
  if (!pos.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 2));
  geo.setIndex(idx);
  const W = WIND_LINE, U = { wTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `attribute vec3 aDir; attribute float aSide; attribute vec2 aAlong;
      varying vec2 vAlong; varying float vDist; varying float vRise;
      void main() {
        vec3 view = cameraPosition - position;
        vRise = normalize( aDir ).y;
        vec3 s = normalize( cross( normalize( aDir ), view ) );    // a ribbon turned to face the camera
        vec3 p = position + s * aSide * ${(W.width / 2).toFixed(2)};
        vAlong = aAlong; vDist = length( view );
        gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
      }`,
    fragmentShader: `uniform float wTime; varying vec2 vAlong; varying float vDist; varying float vRise;
      void main() {
        float c = fract( ( vAlong.x - wTime * ${W.speed.toFixed(1)} ) / ${(W.dash + W.gap).toFixed(1)} ) * ${(W.dash + W.gap).toFixed(1)};
        float a = smoothstep( 0.0, 3.0, c ) * ( 1.0 - smoothstep( ${(W.dash - 4).toFixed(1)}, ${W.dash.toFixed(1)}, c ) );   // a streak, soft at both ends
        a *= smoothstep( 0.0, 0.12, vAlong.y ) * ( 1.0 - smoothstep( 0.85, 1.0, vAlong.y ) );   // the line fades in and out
        a *= smoothstep( 0.12, 0.45, vRise );                   // only where the air rises: the level run-in over the water stays unseen
        a *= smoothstep( ${W.far.toFixed(1)}, ${W.near.toFixed(1)}, vDist ) * smoothstep( 25.0, 60.0, vDist );   // far off, and close by the camera
        if ( a < 0.01 ) discard;
        gl_FragColor = vec4( 1.0, 1.0, 1.0, a * 0.6 );
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.userData.hint = true;   // (js/game.js: a mark, not scenery)
  mesh.onBeforeRender = () => { U.wTime.value = (performance.now() / 1000) % 1000; };
  group.add(mesh);
});
