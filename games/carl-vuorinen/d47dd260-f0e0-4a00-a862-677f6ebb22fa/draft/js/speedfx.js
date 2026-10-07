'use strict';
/* =========================================================================
   SPEEDFX — flying low and fast kicks the surface up behind you: spray off water, dust off the ground, powder off
   snow, sand off a beach. Strongest a few metres up, gone by ~18 m (scaled by the vehicle: CAM_DIST / 12.5, with a
   floor so the small ones still show), and only from just under cruise speed up, so it reads as "fast and close",
   not just "low". The rest of the sense of speed (FOV, pull-back, shake, air streaks, wingtip trails) is js/game.js's.
   GPU-animated: a particle's start, velocity and birth time are written once when it spawns and the vertex shader
   flies it (drag + gravity), so nothing is updated per particle per frame. Dimmed with the fog colour, so it doesn't
   glow at dusk or night.
   Plugs in through SCENERY_PLUGINS (js/sunlight.js) and spawns in onBeforeRender; reads the aircraft from
   Skyrace.player (falling back to the test hook __ml.P until js/game.js exposes it; add `player: P,` to
   window.Skyrace next time game.js is edited) and the frame time from Skyrace.onFrame, and shows nothing without them.
   ========================================================================= */
const SpeedFX = (() => {
  const TUNE_FX = {
    washRate: 520,      // particles/s at full strength over water (land: 0.6 of it)
    washAlt: [4, 18],   // m above the surface: full strength below the first, none above the second (× vehicle scale)
    washSpeed: [0.75, 1],   // from this × CRUISE to × BOOST: speed's share of the strength
    washAlpha: 0.32,
    minScale: 0.8,      // vehicle scale floor for the wash (the wingsuit and jetpack are 0.44 and 0.64 by camera)
  };
  const N = 384;        // particle pool (ring buffer)
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  /* ---------- wash particles ---------- */
  const aP0 = new Float32Array(N * 3), aV = new Float32Array(N * 3), aBirth = new Float32Array(N).fill(-1e4);
  const aLife = new Float32Array(N).fill(1), aKind = new Float32Array(N * 4);   // kind: gravity, drag, size0, size1
  const aCol = new Float32Array(N * 3), aAlpha = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  const attrs = {
    position: new THREE.BufferAttribute(aP0, 3), aV: new THREE.BufferAttribute(aV, 3), aBirth: new THREE.BufferAttribute(aBirth, 1),
    aLife: new THREE.BufferAttribute(aLife, 1), aKind: new THREE.BufferAttribute(aKind, 4), aCol: new THREE.BufferAttribute(aCol, 3), aAlpha: new THREE.BufferAttribute(aAlpha, 1),
  };
  for (const k in attrs) { attrs[k].setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, attrs[k]); }
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const washU = { uTime: { value: 0 }, uPx: { value: 400 }, uNear: { value: 8 }, uAlpha: { value: TUNE_FX.washAlpha }, uLight: { value: 1 } };
  const washMat = new THREE.ShaderMaterial({
    uniforms: washU, transparent: true, depthWrite: false, fog: false,
    vertexShader: `
uniform float uTime, uPx, uNear;
attribute vec3 aV, aCol;
attribute float aBirth, aLife, aAlpha;
attribute vec4 aKind;
varying float vA;
varying vec3 vC;
void main() {
	float t = uTime - aBirth, k = t / aLife;
	if (k < 0.0 || k > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
	float d = aKind.y, e = (1.0 - exp(-d * t)) / d;
	vec3 p = position + aV * e + vec3(0.0, aKind.x * (t - e) / d, 0.0);
	vec4 mv = modelViewMatrix * vec4(p, 1.0);
	gl_Position = projectionMatrix * mv;
	float size = mix(aKind.z, aKind.w, sqrt(k));
	gl_PointSize = min(256.0, size * uPx / max(0.5, -mv.z));
	vA = smoothstep(0.0, 0.08, k) * (1.0 - k) * (1.0 - k) * smoothstep(uNear * 0.4, uNear, -mv.z);   // thins out right at the lens
	vC = aCol;
	vA *= aAlpha;
}`,
    fragmentShader: `
uniform float uAlpha, uLight;
varying float vA;
varying vec3 vC;
void main() {
	vec2 q = gl_PointCoord * 2.0 - 1.0;
	float r2 = dot(q, q);
	if (r2 > 1.0) discard;
	float a = (1.0 - r2) * (1.0 - r2) * vA * uAlpha;
	gl_FragColor = vec4(vC * uLight, a);
}`,
  });

  /* ---------- per frame ---------- */
  const _vh = new THREE.Vector3(), _side = new THREE.Vector3(), _sz = new THREE.Vector2();
  const _c = new THREE.Color(), _fog = new THREE.Color();
  const WATER_C = new THREE.Color('#ffffff'), DUST_C = new THREE.Color('#c9b896'), SNOW_C = new THREE.Color('#f2f6fb'), SAND_C = new THREE.Color('#e3d3a8');
  const st = { clock: 0, hooked: false, tick: 0, done: -1, pend: 0, head: 0, debt: 0, wash: 0, prox: 0 };

  let pal = {};                                              // the course's palette: its snow line and beach
  function surfaceAt(x, z) {                                 // [height, kind]: kind 0 water, 1 dust, 2 snow, 3 sand
    const h = heightAt(x, z), wl = TER.WATER;
    if (h < wl - 0.15) return [wl, 0];
    if (pal.snow && h > pal.snow[0]) return [h, 2];
    if (h < wl + (pal.sand ? pal.sand[0] : 2.2)) return [h, 3];
    return [h, 1];
  }

  function spawn(P, sy, kind, e, cs) {
    const i = st.head; st.head = (st.head + 1) % N;
    _vh.set(P.vdir.x, 0, P.vdir.z);
    const hl = _vh.length(); if (hl < 1e-3) _vh.set(0, 0, -1); else _vh.multiplyScalar(1 / hl);
    _side.set(-_vh.z, 0, _vh.x);
    const lat = (Math.random() * 2 - 1), back = (Math.random() * 3 - 1) * cs;
    const x = P.pos.x - _vh.x * back + _side.x * lat * 3.5 * cs, z = P.pos.z - _vh.z * back + _side.z * lat * 3.5 * cs;
    aP0[i * 3] = x; aP0[i * 3 + 1] = sy + 0.15; aP0[i * 3 + 2] = z;
    const hs = P.speed * hl * (0.6 + Math.random() * 0.35), out = (1.5 + Math.random() * 4) * Math.sign(lat || 1) * (0.6 + e);
    const water = kind === 0, up = water ? (3 + Math.random() * 8) * (0.4 + e) : (0.8 + Math.random() * 2.2) * (0.6 + e);
    aV[i * 3] = _vh.x * hs + _side.x * out; aV[i * 3 + 1] = up; aV[i * 3 + 2] = _vh.z * hs + _side.z * out;
    aBirth[i] = st.clock;
    aLife[i] = water ? 0.6 + Math.random() * 0.5 : 1.1 + Math.random() * 0.9;
    aKind[i * 4] = water ? -7.5 : -0.4; aKind[i * 4 + 1] = water ? 1.8 : 2.4;                    // dragged along at first (the wake moves with you), then left behind
    aKind[i * 4 + 2] = (0.3 + Math.random() * 0.4) * cs; aKind[i * 4 + 3] = (water ? 3.2 : 4.5) * cs * (0.6 + Math.random() * 0.8);
    _c.copy(water ? WATER_C : kind === 2 ? SNOW_C : kind === 3 ? SAND_C : DUST_C).lerp(_fog, 0.25);
    aAlpha[i] = water ? 1 : kind === 1 ? 1.5 : 1.3;            // dust is thinner stuff: fewer, denser puffs
    aCol[i * 3] = _c.r; aCol[i * 3 + 1] = _c.g; aCol[i * 3 + 2] = _c.b;
    return i;
  }

  function markRange(from, count) {                          // upload only what spawned (the ring may wrap)
    if (count <= 0) return;
    for (const k in attrs) {
      const a = attrs[k], sz = a.itemSize;
      if (count >= N) a.clearUpdateRanges();                 // no ranges: the whole buffer
      else if (from + count <= N) a.addUpdateRange(from * sz, count * sz);
      else { a.addUpdateRange(from * sz, (N - from) * sz); a.addUpdateRange(0, (from + count - N) * sz); }
      a.needsUpdate = true;
    }
  }

  function step(renderer, scene, camera) {
    const S = window.Skyrace;
    if (!S) return;
    if (!st.hooked) { st.hooked = true; S.onFrame((d) => { st.pend += d; st.tick++; }); }   // the game's own frame time
    if (st.tick === st.done) return;                         // once per frame
    st.done = st.tick;
    let dt = st.pend; st.pend = 0;
    const state = S.state;
    if (state === 'paused') dt = 0;
    st.clock += dt;
    washU.uTime.value = st.clock;
    if (scene.fog) _fog.copy(scene.fog.color); else _fog.setRGB(0.8, 0.85, 0.9);
    const lum = 0.2126 * _fog.r + 0.7152 * _fog.g + 0.0722 * _fog.b;
    washU.uLight.value = Math.min(1, Math.max(0.35, lum * 1.5));
    const sz = renderer.getDrawingBufferSize(_sz);
    washU.uPx.value = sz.y * camera.projectionMatrix.elements[5] * 0.5;

    // the wash
    const P = S.player || (window.__ml && window.__ml.P), cs = Math.min(2.1, Math.max(TUNE_FX.minScale, (TUNE.CAM_DIST || 12.5) / 12.5));
    washU.uNear.value = 9 * cs;
    let e = 0, kind = 1, sy = 0;
    if (P && !S.crashing && dt > 0 && typeof heightAt === 'function') {
      const s = surfaceAt(P.pos.x, P.pos.z); sy = s[0]; kind = s[1];
      const alt = P.pos.y - sy;
      st.prox = 1 - sstep(TUNE_FX.washAlt[0] * cs, TUNE_FX.washAlt[1] * cs, alt);
      const sk = sstep(TUNE.CRUISE * TUNE_FX.washSpeed[0], TUNE.BOOST * TUNE_FX.washSpeed[1], P.speed);
      e = st.prox * sk * (alt > -1 ? 1 : 0);
    } else st.prox = 0;
    st.wash = e;
    if (e > 0.02) {
      st.debt += e * TUNE_FX.washRate * (kind === 0 ? 1 : 0.6) * dt;
      const from = st.head; let n = 0;
      while (st.debt >= 1 && n < N) { spawn(P, sy, kind, e, cs); st.debt -= 1; n++; }
      markRange(from, n);
    } else st.debt = 0;
  }

  SCENERY_PLUGINS.push((group) => {
    aBirth.fill(-1e4); markRange(0, N); st.head = 0; st.debt = 0;
    pal = Object.assign({}, typeof PALETTE !== 'undefined' ? PALETTE : {}, COURSE && COURSE.palette);
    const pts = new THREE.Points(geo, washMat);
    pts.frustumCulled = false; pts.renderOrder = 5;
    pts.onBeforeRender = step;                                // world-space, so a frame-late spawn upload doesn't show
    group.add(pts);
  });
  // for tests and tuning
  return { TUNE: TUNE_FX, state: st, uniforms: washU };
})();
