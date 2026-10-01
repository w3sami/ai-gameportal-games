'use strict';
/* =========================================================================
   SMOKE — airshow smoke that hangs in the air, puffs out and fades away (the biplane's, js/biplane.js).
   Low-poly like the clouds (js/clouds.js): faceted balls, white on top and pale blue-grey underneath, lit with the same
   wrap-round sunlight, and see-through: blended over what's behind them. One draw call: an instanced ball per puff.
   Puffs are laid every SPACING m along the path (not per frame, so the trail has no gaps at speed or on a slow frame)
   into a ring buffer on the CPU; each frame the live ones are copied out sorted far to near from the camera (so they
   blend in the right order) and uploaded, and all ageing (growth, drift, tumble, fading) happens in the vertex shader
   from the birth time.
   A puff starts DENSE (its opacity leaving the plane) and thins out over its life; smoke cleared by a crash
   (dissipate()) thins out faster, swelling as it goes. The shader also keeps the view clear: puffs shrink to nothing
   near the camera (the chase camera flies up the fresh trail) and when one would fill too much of the screen, and as
   puffs spread out the trail thins to fewer, further apart (each puff has a level, like a mip chain: every 2nd puff is
   level 1, every 4th level 2..., and a level shrinks away once the spread wants puffs further apart than it gives).
   A puff shrunk to nothing is a point: no pixels, and no overdraw.
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
  const DENSE = 0.6;               // a puff's opacity as it leaves the plane: thin smoke, not solid balls (overlapping
                                   // puffs build up, so where the trail is thick it fills in)
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

  const ball = new THREE.IcosahedronGeometry(1, 0);         // 20 facets, non-indexed
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', ball.attributes.position); geo.setAttribute('normal', ball.attributes.normal);
  const ringP = new Float32Array(MAX * 3), ringI = new Float32Array(MAX * 3).fill(-1e6);   // the puffs: position; birth, seed, level
  const posA = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);   // the live
  const infA = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);   // ones, sorted
  geo.setAttribute('aPos', posA); geo.setAttribute('aInfo', infA);
  geo.instanceCount = 0;

  const U = {
    uTime: { value: 0 }, uLife: { value: LIFE },
    uR: { value: new THREE.Vector4(R0, PUFF[0], PUFF[1], 0) }, uR1: { value: new THREE.Vector2(R1, GROW) },
    uNear: { value: new THREE.Vector2(NEAR[0], NEAR[1]) }, uBig: { value: new THREE.Vector4(BIG[0], BIG[1], CLAMP, 0) },
    uFresh: { value: new THREE.Vector2(FRESH[0], FRESH[1]) }, uShrink: { value: 1 },   // 0: no view-keeping shrinks (tripod)
    uThin: { value: new THREE.Vector3(THIN / SPACING, LEVELS, FADE) },
    uWind: { value: new THREE.Vector3(WIND[0], WIND[1], WIND[2]) },
    uGone: { value: new THREE.Vector4(-1e7, -1e7, GONE[0], GONE[1]) },   // the last dissipate() time, the one before it
    uTop: { value: TOP }, uBelly: { value: BELLY },
  };
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, transparent: true, depthWrite: false });
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
      varying vec3 vSmoke;
      varying float vFade;
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
      // opacity: DENSE thinning out over its life; laid before a crash (dissipate()), gone within a second and swelling
      // as it goes; laid before the crash before that: long gone
      float g0 = uGone.z * fract(seed * 17.3);
      float gone = aInfo.x <= uGone.y ? 0.0 : aInfo.x <= uGone.x ? 1.0 - clamp((uTime - uGone.x - g0) / uGone.w, 0.0, 1.0) : 1.0;
      float fade = ${DENSE.toFixed(3)} * (1.0 - smoothstep(uThin.z, 1.0, life)) * gone;
      k *= fade < 0.01 ? 0.0 : 1.0 + ${GONE_SWELL.toFixed(3)} * (1.0 - gone);
      vFade = fade;
      k *= mix(1.0, smoothstep(uNear.x, uNear.y, depth - r * k), uShrink);              // and right at the camera
      vec3 dir = smokeTurn(position, seed * 6.2832 + age * (fract(seed * 11.0) - 0.5) * 0.6, fract(seed * 13.7) * 3.1416);
      vSmoke = mix(uBelly, uTop, smoothstep(-0.7, 0.6, dir.y));                         // bright top, pale belly
      vec3 transformed = smokeC + dir * r * (k < 0.03 ? 0.0 : k);                       // gone: a point, no pixels
    `);
    sh.fragmentShader = 'varying vec3 vSmoke;\nvarying float vFade;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb *= vSmoke;\n\tdiffuseColor.a = vFade;')
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
  // T only ever runs on (clear() doesn't wind it back), so a birth left over from before can never come due again
  let T = 0, head = 0, joined = false, carry = 0, lastBirth = -1e6, count = 0, cam = null;
  mesh.onBeforeRender = (renderer, sc, camera) => { cam = camera; };   // (sorted by in the next update())

  // the live puffs into posA/infA, far to near from the camera (by their centres, drift included), as many as are live
  const order = new Int32Array(MAX), dist = new Float32Array(MAX), idx = [];
  function sortDraw() {
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    let m = 0;
    for (let i = 0; i < MAX; i++) {
      const age = T - ringI[i * 3];
      if (age < 0 || age > LIFE) continue;
      const dx = ringP[i * 3] + WIND[0] * age - cx, dy = ringP[i * 3 + 1] + WIND[1] * age - cy, dz = ringP[i * 3 + 2] + WIND[2] * age - cz;
      order[m] = i; dist[i] = dx * dx + dy * dy + dz * dz; m++;
    }
    idx.length = m;
    for (let k = 0; k < m; k++) idx[k] = order[k];
    idx.sort((a, b) => dist[b] - dist[a]);
    const sp = posA.array, sf = infA.array;
    for (let k = 0; k < m; k++) {
      const i = idx[k];
      sp[k * 3] = ringP[i * 3]; sp[k * 3 + 1] = ringP[i * 3 + 1]; sp[k * 3 + 2] = ringP[i * 3 + 2];
      sf[k * 3] = ringI[i * 3]; sf[k * 3 + 1] = ringI[i * 3 + 1]; sf[k * 3 + 2] = ringI[i * 3 + 2];
    }
    geo.instanceCount = m;
    posA.needsUpdate = infA.needsUpdate = true;              // (all of it: a partial upload pending from a frame that
  }                                                          // wasn't drawn could leave stale puffs on the GPU)

  function emit(p, birth) {
    const i = head; head = (head + 1) % MAX;
    ringP[i * 3] = p.x; ringP[i * 3 + 1] = p.y; ringP[i * 3 + 2] = p.z;
    count++;
    let lvl = 0; while (lvl < LEVELS && !((count >> lvl) & 1)) lvl++;   // trailing zero bits: every 2nd is 1, every 4th 2...
    ringI[i * 3] = birth; ringI[i * 3 + 1] = Math.random(); ringI[i * 3 + 2] = lvl;
    lastBirth = birth;
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
    mesh.visible = T - lastBirth < LIFE;
    if (mesh.visible && cam) sortDraw();
  }
  return {
    mesh,
    update,
    cut() { joined = false; },
    dissipate() { const g = U.uGone.value; g.y = g.x; g.x = T; },
    clear() {
      ringI.fill(-1e6); geo.instanceCount = 0;
      head = 0; joined = false; lastBirth = -1e6; mesh.visible = false;
    },
  };
}
