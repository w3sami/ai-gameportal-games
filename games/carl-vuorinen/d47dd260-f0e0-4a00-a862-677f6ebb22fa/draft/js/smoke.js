'use strict';
/* =========================================================================
   SMOKE — airshow smoke that hangs in the air, puffs out and fades away (the biplane's, js/biplane.js).
   Low-poly like the clouds (js/clouds.js): solid faceted balls, white on top and pale blue-grey underneath, lit with
   the same wrap-round sunlight. One draw call: an instanced ball per puff, in a ring buffer. Puffs are laid every
   SPACING m along the path (not per frame, so the trail has no gaps at speed or on a slow frame), and all ageing
   (growth, drift, tumble, fading away) happens in the vertex shader from the birth time, so a new puff is the only
   thing uploaded.
   Solid, it has no blending or overdraw to pay for; what the shader does instead is keep the view clear: puffs shrink
   to nothing near the camera (the chase camera flies up the fresh trail) and when one would fill too much of the
   screen, and as puffs spread out the trail thins to fewer, further apart (each puff has a level, like a mip chain:
   every 2nd puff is level 1, every 4th level 2..., and a level shrinks away once the spread wants puffs further apart
   than it gives). A puff shrunk to nothing is a point: no pixels.
   A puff is only partly drawn even when fresh (DENSE), thins out over its life rather than shrinking, and so does
   smoke cleared by a crash (dissipate()), faster. All of it is dithering: a puff drops a share of its pixels
   in a noise pattern of its own, so it stays solid (no sorting, no blending) and overlapping ones thin out together
   rather than sharing holes. The pattern is blue noise (an even grain with no lines or clumps at any density, so it
   reads as a fade on a laptop screen as well as a phone's), each puff's shifted by its own whole number of pixels.
   makeSmoke(scene, anchor) -> { update(dt, P, on, tripod), cut(), dissipate(), clear(), mesh }
     anchor: the emitter in the plane's local frame; update(dt 0 while paused, P the plane, on: emitting this frame,
     tripod: the camera is a replay's trackside one, which never flies through the trail, so nothing is shrunk near it
     or for filling the screen);
     cut(): the plane was moved (respawn), so don't join the trail up to the new spot; dissipate(): a crash, so all the
     smoke laid so far fades away by the time the plane is back (no flying on through your own trail); clear():
     remove all smoke.
   ========================================================================= */
function makeSmoke(scene, anchor) {
  const MAX = 896;                 // puffs alive at once: LIFE * a fast dive / SPACING (past that the oldest go first)
  const SPACING = 1.2;             // m between puffs
  const LIFE = 14;                 // s until a puff is gone
  const R0 = 0.35;                 // m: puff radius as it leaves the plane
  const PUFF = [1.5, 0.12];        // m, s: it balloons to this at once (time constant), so the chase view sees it
  const R1 = 3, GROW = 2.5;        // m, s: then spreads to this, slowly
  const DENSE = 0.5;               // share of a puff's pixels drawn as it leaves the plane: thin smoke, not solid balls
                                   // (overlapping puffs keep different pixels, so where the trail is thick it fills in)
  const FADE = 0;                  // share of LIFE after which it fades out: from the start, eased (barely thinner
                                   // behind the plane, half gone by 7 s, past which it's rarely anywhere in view)
  const NEAR = [1, 3];             // m from the camera to the puff's surface: gone at the first, full size by the second
  const BIG = [0.12, 0.24];        // puff radius as a share of half the screen height: an old puff starts shrinking, gone
  const CLAMP = 0.14;              // a fresh one is only held down to this, so the chase view keeps its tail
  const FRESH = [0.4, 1];          // s: fresh up to the first, old from the second
  const THIN = 0.6;                // spread out, puffs keep about this many radii apart
  const LEVELS = 4;                // top level (every 16th puff), never thinned
  const WIND = [0.9, 0.25, 0.5];   // m/s of drift (and a slow rise)
  const JUMP = 40;                 // m in one frame: a teleport, not flight
  const GONE = [0.2, 0.7];         // s, s: dissipate(): each puff starts fading within the first (at random, so the
                                   // trail thins unevenly), gone the second after; all gone by the respawn (G.crashTimer 0.9 s)
  const GONE_SWELL = 0.35;         // and swells by this share as it fades: smoke thinning out, not a ball shrinking
  const TOP = new THREE.Color('#ffffff'), BELLY = new THREE.Color('#c2cdd8');   // as the clouds
  if (!makeSmoke.blue) {                                    // made once, shared by every smoke (the ghost's model has one too)
    const b = blueNoise(64, 1.5), d = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) { d[i * 4] = b[i]; d[i * 4 + 3] = 255; }
    const t = makeSmoke.blue = new THREE.DataTexture(d, 64, 64);
    t.magFilter = t.minFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = false;
    t.needsUpdate = true;
  }

  const ball = new THREE.IcosahedronGeometry(1, 0);         // 20 facets, non-indexed
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', ball.attributes.position); geo.setAttribute('normal', ball.attributes.normal);
  const posA = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const infA = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(-1e6), 3).setUsage(THREE.DynamicDrawUsage);   // birth, seed, level
  geo.setAttribute('aPos', posA); geo.setAttribute('aInfo', infA);
  geo.instanceCount = MAX;

  const U = {
    uTime: { value: 0 }, uLife: { value: LIFE },
    uR: { value: new THREE.Vector4(R0, PUFF[0], PUFF[1], 0) }, uR1: { value: new THREE.Vector2(R1, GROW) },
    uNear: { value: new THREE.Vector2(NEAR[0], NEAR[1]) }, uBig: { value: new THREE.Vector4(BIG[0], BIG[1], CLAMP, 0) },
    uFresh: { value: new THREE.Vector2(FRESH[0], FRESH[1]) }, uShrink: { value: 1 },   // 0: no view-keeping shrinks (tripod)
    uThin: { value: new THREE.Vector3(THIN / SPACING, LEVELS, FADE) },
    uWind: { value: new THREE.Vector3(WIND[0], WIND[1], WIND[2]) },
    uGone: { value: new THREE.Vector4(-1e7, -1e7, GONE[0], GONE[1]) },   // the last dissipate() time, the one before it
    uTop: { value: TOP }, uBelly: { value: BELLY }, uBlue: { value: makeSmoke.blue },
  };
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
  mat.userData.noSun = true;                                // not shaded by the terrain (js/sunlight.js), like the clouds
  mat.onBeforeCompile = (sh) => {
    Atmosphere.inject(sh);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = `
      attribute vec3 aPos;
      attribute vec3 aInfo;
      uniform float uTime, uLife, uShrink;
      uniform vec4 uR;
      uniform vec2 uR1, uNear, uFresh;
      uniform vec4 uBig, uGone;
      uniform vec3 uThin, uWind, uTop, uBelly;
      varying vec3 vSmoke, vFade;
      vec3 smokeTurn(vec3 p, float a, float b) {
        float ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b);
        p = vec3(ca * p.x + sa * p.z, p.y, - sa * p.x + ca * p.z);
        return vec3(p.x, cb * p.y - sb * p.z, sb * p.y + cb * p.z);
      }
    ` + sh.vertexShader.replace('#include <begin_vertex>', `
      float age = uTime - aInfo.x, seed = aInfo.y, life = age / uLife;
      float r = (uR.x + (uR.y - uR.x) * (1.0 - exp(- age / uR.z)) + (uR1.x - uR.y) * (1.0 - exp(- age / uR1.y)))
              * (0.8 + 0.4 * fract(seed * 7.13));
      // thinning: this spread wants puffs 'need' spacings apart; level L goes as need runs from 2^L to 2^(L+1)
      float need = r * uThin.x, lv = exp2(aInfo.z);
      float keep = aInfo.z >= uThin.y ? 1.0 : 1.0 - smoothstep(lv, 2.0 * lv, need);
      // drift with the wind, and wander apart a little: each puff its own way
      vec3 wander = vec3(fract(seed * 3.7) - 0.5, fract(seed * 5.3) - 0.5, fract(seed * 9.1) - 0.5) * 2.4 * (1.0 - exp(- age / uR1.y));
      vec3 smokeC = aPos + uWind * age + wander;
      float depth = - (viewMatrix * vec4(smokeC, 1.0)).z;
      // filling the screen: an old puff shrinks away (flying through a trail stays clear), a fresh one is only held to
      // CLAMP of it, so the trail from the plane runs on to the edge of the chase view
      float onScreen = r * projectionMatrix[1][1] / max(depth, 0.01);
      float big = mix(1.0, mix(min(1.0, uBig.z / onScreen), 1.0 - smoothstep(uBig.x, uBig.y, onScreen), smoothstep(uFresh.x, uFresh.y, age)), uShrink);
      float k = step(0.0, age) * step(age, uLife) * keep * big;
      // fading out (dithered: vFade.x the share of pixels kept, yz its pattern's offset): at the end of its life, and
      // when laid before a crash (dissipate()), gone within a second and swelling as it goes; laid before the crash
      // before that: long gone
      float g0 = uGone.z * fract(seed * 17.3);
      float gone = aInfo.x <= uGone.y ? 0.0 : aInfo.x <= uGone.x ? 1.0 - clamp((uTime - uGone.x - g0) / uGone.w, 0.0, 1.0) : 1.0;
      float fade = ${DENSE.toFixed(3)} * (1.0 - smoothstep(uThin.z, 1.0, life)) * gone;
      k *= fade < 0.01 ? 0.0 : 1.0 + ${GONE_SWELL.toFixed(3)} * (1.0 - gone);
      vFade = vec3(fade, floor(fract(seed * 23.1) * 64.0), floor(fract(seed * 31.7) * 64.0));
      k *= mix(1.0, smoothstep(uNear.x, uNear.y, depth - r * k), uShrink);              // and right at the camera
      vec3 dir = smokeTurn(position, seed * 6.2832 + age * (fract(seed * 11.0) - 0.5) * 0.6, fract(seed * 13.7) * 3.1416);
      vSmoke = mix(uBelly, uTop, smoothstep(-0.7, 0.6, dir.y));                         // bright top, pale belly
      vec3 transformed = smokeC + dir * r * (k < 0.03 ? 0.0 : k);                       // gone: a point, no pixels
    `);
    sh.fragmentShader = 'varying vec3 vSmoke, vFade;\nuniform sampler2D uBlue;\n' + sh.fragmentShader
      // fading: the blue noise, shifted per puff, against the share kept
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
	if ( vFade.x < 0.999 && texture2D( uBlue, ( floor( gl_FragCoord.xy ) + vFade.yz + 0.5 ) / 64.0 ).r * 0.996 + 0.002 >= vFade.x ) discard;`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb *= vSmoke;')
      // the clouds' light: the sun wraps round the sides, and the bellies take their light from the sky
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
	#if NUM_DIR_LIGHTS > 0
		float cloudWrap = clamp( ( dot( normal, directionalLights[ 0 ].direction ) + 0.9 ) / 1.9, 0.0, 1.0 );
		reflectedLight.directDiffuse = diffuseColor.rgb * RECIPROCAL_PI * directionalLights[ 0 ].color * cloudWrap;
	#endif
	#if NUM_HEMI_LIGHTS > 0
		reflectedLight.indirectDiffuse = diffuseColor.rgb * RECIPROCAL_PI * mix( hemisphereLights[ 0 ].skyColor, getHemisphereLightIrradiance( hemisphereLights[ 0 ], normal ), 0.35 ) * 1.25;
	#endif`);
  };
  mat.customProgramCacheKey = () => 'smoke-puff';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.visible = false; mesh.userData.smoke = U;   // (the uniforms, for tests)
  scene.add(mesh);

  const at = new THREE.Vector3(), last = new THREE.Vector3(), d = new THREE.Vector3(), pt = new THREE.Vector3();
  // T only ever runs on (clear() doesn't wind it back), so a birth left over from before can never come due again.
  // dirty: the whole buffers are owed to the GPU until the mesh is next drawn (at first, and after clear(), which hides
  // it). r159 uploads only the update ranges when there are any, so a range added before that draw would stand in for
  // the whole upload and leave the last run's puffs on the GPU, to hatch again as T reached their births
  let T = 0, head = 0, joined = false, carry = 0, lastBirth = -1e6, lo = -1, n = 0, dirty = true, count = 0;
  mesh.onAfterRender = () => { dirty = false; };

  function emit(p, birth) {
    const i = head; head = (head + 1) % MAX;
    posA.array[i * 3] = p.x; posA.array[i * 3 + 1] = p.y; posA.array[i * 3 + 2] = p.z;
    count++;
    let lvl = 0; while (lvl < LEVELS && !((count >> lvl) & 1)) lvl++;   // trailing zero bits: every 2nd is 1, every 4th 2...
    infA.array[i * 3] = birth; infA.array[i * 3 + 1] = Math.random(); infA.array[i * 3 + 2] = lvl;
    if (lo < 0) lo = i;
    n++; lastBirth = birth;
  }
  function flush() {                                        // upload just the slots written this frame (two runs if it wrapped)
    if (dirty) {                                            // everything, until drawn
      posA.clearUpdateRanges(); infA.clearUpdateRanges();
      if (n) posA.needsUpdate = infA.needsUpdate = true;
      lo = -1; n = 0; return;
    }
    if (!n) return;
    const runs = n >= MAX ? [[0, MAX]] : lo + n <= MAX ? [[lo, n]] : [[lo, MAX - lo], [0, lo + n - MAX]];
    for (const [s, c] of runs) { posA.addUpdateRange(s * 3, c * 3); infA.addUpdateRange(s * 3, c * 3); }
    posA.needsUpdate = infA.needsUpdate = true;
    lo = -1; n = 0;
  }

  function update(dt, P, on, tripod) {
    T += dt;
    U.uTime.value = T; U.uShrink.value = tripod ? 0 : 1;
    if (on && dt > 0) {
      at.copy(anchor).applyQuaternion(P.q).add(P.pos);
      d.subVectors(at, last);
      const L = d.length();
      if (!joined || L > JUMP) { emit(at, T); carry = 0; }  // start of a trail
      else {
        let s = SPACING - carry;                            // along this frame's path to the next puff
        while (s <= L) {                                    // born when the plane passed there, not all at once
          const f = s / L;
          emit(pt.copy(last).addScaledVector(d, f), T - dt * (1 - f));
          s += SPACING;
        }
        carry = L - (s - SPACING);
      }
      last.copy(at); joined = true;
    } else if (dt > 0) joined = false;                      // let go: the next press starts a new trail
    flush();
    mesh.visible = T - lastBirth < LIFE;
  }
  return {
    mesh,
    update,
    cut() { joined = false; },
    dissipate() { const g = U.uGone.value; g.y = g.x; g.x = T; },
    clear() {
      infA.array.fill(-1e6);                                // uploaded whole the next time the mesh is drawn
      posA.clearUpdateRanges(); infA.clearUpdateRanges(); posA.needsUpdate = infA.needsUpdate = true;
      dirty = true; lo = -1; n = 0;
      head = 0; joined = false; lastBirth = -1e6; mesh.visible = false;
    },
  };
}

// blue noise: an N x N tile (wrapping) of thresholds, each pixel's rank * 256 / N^2, from void-and-cluster (Ulichney
// 1993): spread a tenth of the pixels evenly, then rank them by taking the tightest cluster out each time, and the rest
// by filling the largest void each time ('tightest' and 'largest' by a Gaussian of SIGMA px). About 50 ms for 64 x 64,
// once at start; seeded, so it's the same pattern every time
function blueNoise(N, SIGMA) {
  const R = Math.ceil(SIGMA * 3.5), K = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) K.push(dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA)));
  const M = N * N, E = new Float32Array(M), on = new Uint8Array(M), rank = new Uint16Array(M);
  const splat = (i, s) => {                                 // add (s 1) or take away (s -1) one pixel's share of the energy
    const x = i % N, y = (i / N) | 0;
    for (let k = 0; k < K.length; k += 3) E[((y + K[k + 1] + N) % N) * N + (x + K[k] + N) % N] += s * K[k + 2];
  };
  const pick = (want, sign) => {                            // the most (sign 1) or least (-1) crowded pixel that is / isn't on
    let best = -1, bv = -Infinity;
    for (let i = 0; i < M; i++) if (on[i] === want && sign * E[i] > bv) { bv = sign * E[i]; best = i; }
    return best;
  };
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let n = 0; n < M / 10;) { const i = (rnd() * M) | 0; if (!on[i]) { on[i] = 1; splat(i, 1); n++; } }
  for (let guard = 0; guard < M; guard++) {                 // even them out: the tightest cluster moves to the largest void
    const c = pick(1, 1); on[c] = 0; splat(c, -1);
    const v = pick(0, -1); on[v] = 1; splat(v, 1);
    if (v === c) break;
  }
  const on0 = on.slice(), E0 = E.slice(), ones = on.reduce((a, b) => a + b, 0);
  for (let r = ones - 1; r >= 0; r--) { const c = pick(1, 1); on[c] = 0; splat(c, -1); rank[c] = r; }
  on.set(on0); E.set(E0);
  for (let r = ones; r < M; r++) { const v = pick(0, -1); on[v] = 1; splat(v, 1); rank[v] = r; }
  const out = new Uint8Array(M);
  for (let i = 0; i < M; i++) out[i] = (rank[i] * 256 / M) | 0;
  return out;
}
