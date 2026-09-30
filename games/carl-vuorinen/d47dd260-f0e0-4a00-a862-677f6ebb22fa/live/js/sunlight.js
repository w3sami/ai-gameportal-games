'use strict';
/* =========================================================================
   SUNLIGHT — baked sun shadows and ambient occlusion from the terrain, for all static scenery.
   The sun never moves and the terrain never changes, so this is worked out once per course load and costs
   nothing per frame: bake() marches a soft-edged ray toward the sun and measures how much sky each terrain
   vertex sees (on every other vertex, filled in, with shadow edges redone at full resolution); apply(group)
   hands the result to every lit mesh in the scenery:
     terrain (userData.sunGrid)  per vertex, straight from the grid
     big flat water (userData.sunTex)  per pixel, from a small texture of the grid
     everything else  per vertex (per instance for instanced meshes), ray-marched from where it stands,
                      darkened a little near the ground so buildings and piers sit on it
   Shadow takes away direct sunlight only; occlusion takes away sky light only. Emissive materials (spray), unlit
   ones and any with userData.noSun (clouds) are left alone. Terrain casts shadow; objects don't.
   The texture's blue channel is the water depth over the terrain (0..25.5 m), for js/water.js.
   Other modules plug in without touching js/game.js:
     SCENERY_PLUGINS  functions run on the finished scenery group (before the lighting goes on)
     material.userData.sunHooks = [{ key, fn(shader) }]  extra shader edits, applied after this module's own;
                      a 'tex' material's fragment shader has vec4 sunTexel (the texel) and vec2 sunAOv to use
   ========================================================================= */
const SCENERY_PLUGINS = [];
const Sunlight = (() => {
  const SOFT = 10;            // shadow edge softness: 1 / tan(penumbra angle)
  const AO_STRENGTH = 0.5;    // how much a fully enclosed spot loses of its sky light
  const FLOOR = 0.3;          // sunlight left in full shadow (stands in for light bounced off the sunlit slopes)
  const CONTACT = [0.7, 3.5]; // near the ground: sky light down to [0] at the foot, full from [1] m up
  let W = 0, N = 0, cell = 1, X0 = 0, Z0 = 0, maxH = 0, sx = 0, sz = 0, rise = 1;
  let vis = null, ao = null, surf = null;
  const B = 8;                // block size (cells) for skipping empty air: bmax = highest point within one block around
  let BW = 0, bmax = null;
  let timing = null;
  const U = { sunTex: { value: null }, sunTexXf: { value: new THREE.Vector4() } };

  // height of the terrain (or the water over it) in grid units, bilinear
  function hAt(gx, gz) {
    if (gx < 0 || gz < 0 || gx > N || gz > N) return -1e9;
    const i = Math.min(Math.floor(gx), N - 1), j = Math.min(Math.floor(gz), N - 1), fx = gx - i, fz = gz - j, k = j * W + i;
    return (surf[k] * (1 - fx) + surf[k + 1] * fx) * (1 - fz) + (surf[k + W] * (1 - fx) + surf[k + W + 1] * fx) * fz;
  }
  // soft visibility of the sun from grid point (gx, gz) at height y
  function march(gx, gz, y, t0) {
    let res = 1, t = t0;
    while (true) {
      const ry = y + t * rise;
      if (ry > maxH) break;
      const px = gx + sx * t / cell, pz = gz + sz * t / cell;
      if (px < 0 || pz < 0 || px > N || pz > N) break;       // left the grid: the plain beyond is low
      // nothing within a block of here reaches the ray (with room for the soft edge): skip a block
      if (ry - bmax[Math.floor(pz / B) * BW + Math.floor(px / B)] > t / SOFT) { t += B * cell; continue; }
      const th = hAt(px, pz);
      res = Math.min(res, SOFT * (ry - th) / t);
      if (res <= 0) return 0;
      t += Math.max(cell * 0.7, t * 0.02);
    }
    return res * res * (3 - 2 * res);
  }

  function bake(sunDir) {
    const t0 = performance.now();
    N = TER.N; W = N + 1; cell = TER.CELL; X0 = TER.X0; Z0 = TER.Z0;
    const hl = Math.hypot(sunDir.x, sunDir.z);
    sx = sunDir.x / hl; sz = sunDir.z / hl; rise = sunDir.y / hl;
    surf = new Float32Array(W * W); maxH = -Infinity;
    for (let k = 0; k < W * W; k++) { surf[k] = Math.max(TH[k], TER.WATER); if (surf[k] > maxH) maxH = surf[k]; }
    BW = Math.ceil(W / B);
    const raw = new Float32Array(BW * BW).fill(-Infinity);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const b = Math.floor(j / B) * BW + Math.floor(i / B); if (surf[j * W + i] > raw[b]) raw[b] = surf[j * W + i]; }
    bmax = new Float32Array(BW * BW);
    for (let bj = 0; bj < BW; bj++) for (let bi = 0; bi < BW; bi++) {
      let m = -Infinity;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = bi + di, c = bj + dj; if (a >= 0 && c >= 0 && a < BW && c < BW && raw[c * BW + a] > m) m = raw[c * BW + a]; }
      bmax[bj * BW + bi] = m;
    }
    vis = new Float32Array(W * W); ao = new Float32Array(W * W);
    // both worked out on every other grid point, then filled in; shadow edges (where the four around disagree)
    // are ray-marched again at full resolution
    const xs = []; for (let i = 0; i <= N; i += 2) xs.push(i); if (xs[xs.length - 1] !== N) xs.push(N);
    const S = xs.length, hv = new Float32Array(S * S), ha = new Float32Array(S * S);
    for (let b = 0; b < S; b++) for (let a = 0; a < S; a++) { const k = xs[b] * W + xs[a]; hv[b * S + a] = march(xs[a], xs[b], surf[k] + 0.5, cell * 0.7); }
    const t1 = performance.now();
    // occlusion: horizon angle in 8 lattice directions out to 16 steps, cosine-weighted (sin^2 of the horizon);
    // the samples land on grid points, so no interpolation
    const DX = [1, 1, 0, -1, -1, -1, 0, 1], DZ = [0, 1, 1, 1, 0, -1, -1, -1], DL = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];
    const dists = [1, 2, 4, 8, 16];
    for (let b = 0; b < S; b++) for (let a = 0; a < S; a++) {
      const i = xs[a], j = xs[b], h0 = surf[j * W + i];
      let occ = 0;
      for (let r = 0; r < 8; r++) {
        let best = 0;
        for (let n = 0; n < 5; n++) {
          const d = dists[n], ii = i + DX[r] * d, jj = j + DZ[r] * d;
          if (ii < 0 || jj < 0 || ii > N || jj > N) break;
          const tn = (surf[jj * W + ii] - h0) / (d * DL[r] * cell);
          if (tn > best) best = tn;
        }
        occ += best * best / (1 + best * best);               // sin^2(atan(best))
      }
      ha[b * S + a] = 1 - AO_STRENGTH * occ / 8;
    }
    const t2 = performance.now();
    let edges = 0;
    for (let j = 0; j <= N; j++) {
      const b = Math.min(j >> 1, S - 2), fz = (j - xs[b]) / (xs[b + 1] - xs[b]);
      for (let i = 0; i <= N; i++) {
        const a = Math.min(i >> 1, S - 2), fx = (i - xs[a]) / (xs[a + 1] - xs[a]), q = b * S + a, k = j * W + i;
        const v00 = hv[q], v10 = hv[q + 1], v01 = hv[q + S], v11 = hv[q + S + 1];
        ao[k] = (ha[q] * (1 - fx) + ha[q + 1] * fx) * (1 - fz) + (ha[q + S] * (1 - fx) + ha[q + S + 1] * fx) * fz;
        if (Math.max(v00, v10, v01, v11) - Math.min(v00, v10, v01, v11) < 0.03) vis[k] = (v00 * (1 - fx) + v10 * fx) * (1 - fz) + (v01 * (1 - fx) + v11 * fx) * fz;
        else if (fx === 0 && fz === 0) vis[k] = v00;
        else { vis[k] = march(i, j, surf[k] + 0.5, cell * 0.7); edges++; }
      }
    }
    timing = { vis: t1 - t0, ao: t2 - t1, fill: performance.now() - t2, edges: edges / (W * W) };
    // texture for surfaces sampled per pixel (water)
    const px = new Uint8Array(W * W * 4);
    for (let k = 0; k < W * W; k++) {
      px[k * 4] = Math.round(vis[k] * 255); px[k * 4 + 1] = Math.round(ao[k] * 255);
      px[k * 4 + 2] = Math.round(clamp((TER.WATER - TH[k]) * 10, 0, 255)); px[k * 4 + 3] = 255;   // water depth, 0.1 m steps
    }
    if (U.sunTex.value) U.sunTex.value.dispose();
    const tex = new THREE.DataTexture(px, W, W, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    U.sunTex.value = tex;
    // grid points sit at texel centres: uv = (x - X0 + cell/2) / (W * cell)
    U.sunTexXf.value.set(X0 - cell / 2, Z0 - cell / 2, 1 / (W * cell), 1 / (W * cell));
    return performance.now() - t0;
  }

  function gridAt(arr, x, z) {                              // bilinear lookup of a grid in world coordinates
    const gx = clamp((x - X0) / cell, 0, N), gz = clamp((z - Z0) / cell, 0, N);
    const i = Math.min(Math.floor(gx), N - 1), j = Math.min(Math.floor(gz), N - 1), fx = gx - i, fz = gz - j, k = j * W + i;
    return (arr[k] * (1 - fx) + arr[k + 1] * fx) * (1 - fz) + (arr[k + W] * (1 - fx) + arr[k + W + 1] * fx) * fz;
  }
  // sun visibility and sky light at any world point (an object's vertex, the plane)
  function at(x, y, z) {
    const gx = (x - X0) / cell, gz = (z - Z0) / cell;
    const inside = gx >= 0 && gz >= 0 && gx <= N && gz <= N;
    const ground = inside ? hAt(gx, gz) : TER.EDGE, above = Math.max(0, y - ground);
    const v = inside ? march(gx, gz, Math.max(y, ground + 0.5), 0.5) : 1;
    const g = inside ? gridAt(ao, x, z) : 1;
    const a = lerp(g, 1, smoothstep(0, 40, above)) * lerp(CONTACT[0], 1, smoothstep(0, CONTACT[1], above));
    return [v, a];
  }
  const visAt = (x, z) => (vis ? gridAt(vis, x, z) : 1);

  /* ---- shader: direct sun scaled by x, sky light by y ---- */
  const lightsBegin = THREE.ShaderChunk.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= ' + FLOOR.toFixed(3) + ' + ' + (1 - FLOOR).toFixed(3) + ' * sunAOv.x;');
  function patch(material, mode) {                          // mode: 'attr' (vertex attribute sunAO) or 'tex'
    const hooks = material.userData.sunHooks || [], sig = [mode, ...hooks.map((h) => h.key)].join('+');
    if (material.userData.sunMode === sig) return;
    material.userData.sunMode = sig;
    const tex = mode === 'tex';
    material.onBeforeCompile = (sh) => {
      Atmosphere.inject(sh);
      if (tex) Object.assign(sh.uniforms, U);
      sh.vertexShader = (tex ? 'uniform vec4 sunTexXf;\nvarying vec2 vSunUV;\n' : 'attribute vec2 sunAO;\nvarying vec2 vSunAO;\n') +
        sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n' + (tex
          ? '\tvec4 sunWP = vec4( transformed, 1.0 );\n\t#ifdef USE_INSTANCING\n\t\tsunWP = instanceMatrix * sunWP;\n\t#endif\n\tsunWP = modelMatrix * sunWP;\n\tvSunUV = ( sunWP.xz - sunTexXf.xy ) * sunTexXf.zw;'
          : '\tvSunAO = sunAO;'));
      sh.fragmentShader = (tex ? 'uniform sampler2D sunTex;\nvarying vec2 vSunUV;\n' : 'varying vec2 vSunAO;\n') +
        sh.fragmentShader
          .replace('#include <lights_fragment_begin>', (tex ? 'vec4 sunTexel = texture2D( sunTex, vSunUV );\nvec2 sunAOv = sunTexel.rg;\n' : 'vec2 sunAOv = vSunAO;\n') + lightsBegin)
          .replace('#include <lights_fragment_end>', 'irradiance *= sunAOv.y;\n#include <lights_fragment_end>');
      for (const h of hooks) h.fn(sh);
    };
    material.customProgramCacheKey = () => 'sun-' + sig;
    material.needsUpdate = true;
  }
  function unpatch(material) {
    if (!material.userData.sunMode) return;
    delete material.userData.sunMode;
    delete material.onBeforeCompile; delete material.customProgramCacheKey;   // back to the prototype's
    material.needsUpdate = true;
  }
  const lit = (m) => (m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshStandardMaterial) && !m.userData.noSun && !(m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0);

  const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = new THREE.Vector3();
  function apply(group, scene) {
    const t0 = performance.now();
    for (const plug of SCENERY_PLUGINS) plug(group);
    const users = new Map();                                // material -> meshes using it anywhere in the scene
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (!users.has(m)) users.set(m, []); users.get(m).push(o); }
    });
    const inGroup = new Set(); group.traverse((o) => inGroup.add(o));
    group.updateMatrixWorld(true);
    let verts = 0;
    const geoUsers = new Map();                             // a geometry shared by several meshes needs one copy each
    group.traverse((o) => { if (o.isMesh) geoUsers.set(o.geometry, (geoUsers.get(o.geometry) || 0) + 1); });
    const own = (o) => { if (geoUsers.get(o.geometry) > 1) { geoUsers.set(o.geometry, geoUsers.get(o.geometry) - 1); o.geometry = o.geometry.clone(); } };
    for (const [mat, meshes] of users) {
      if (!lit(mat) || !meshes.every((o) => inGroup.has(o) && !Array.isArray(o.material))) { unpatch(mat); continue; }
      const tex = meshes.some((o) => o.userData.sunTex);
      if (tex && !meshes.every((o) => o.userData.sunTex)) { unpatch(mat); continue; }
      if (!tex) for (const o of meshes) { own(o); verts += fill(o); }
      patch(mat, tex ? 'tex' : 'attr');
    }
    return { ms: performance.now() - t0, verts };
  }
  function fill(o) {                                        // give a mesh its sunAO attribute
    const g = o.geometry, p = g.attributes.position;
    if (o.isInstancedMesh) {
      if (!g.boundingSphere) g.computeBoundingSphere();
      const a = new Float32Array(o.count * 2);
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, _m);
        _c.copy(g.boundingSphere.center).applyMatrix4(_m).applyMatrix4(o.matrixWorld);   // an instance: from its middle
        const [v, s] = at(_c.x, _c.y, _c.z); a[i * 2] = v; a[i * 2 + 1] = s;
      }
      g.setAttribute('sunAO', new THREE.InstancedBufferAttribute(a, 2));
      return o.count;
    }
    const a = new Float32Array(p.count * 2);
    if (o.userData.sunGrid) {                               // terrain: vertices sit on grid points
      const arr = p.array;
      for (let i = 0; i < p.count; i++) {
        const gi = Math.round((arr[i * 3] - X0) / cell), gj = Math.round((arr[i * 3 + 2] - Z0) / cell), k = clamp(gj, 0, N) * W + clamp(gi, 0, N);
        a[i * 2] = vis[k]; a[i * 2 + 1] = ao[k];
      }
    } else {
      const cache = new Map();                              // flat-shaded meshes repeat each corner several times
      for (let i = 0; i < p.count; i++) {
        _v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        const key = ((Math.round(_v.x * 4) + 131072) * 262144 + (Math.round(_v.z * 4) + 131072)) * 65536 + (Math.round(_v.y * 4) + 32768);
        let r = cache.get(key);
        if (!r) { r = at(_v.x, _v.y, _v.z); cache.set(key, r); }
        a[i * 2] = r[0]; a[i * 2 + 1] = r[1];
      }
    }
    g.setAttribute('sunAO', new THREE.BufferAttribute(a, 2));
    return p.count;
  }

  return { bake, apply, at, visAt, get timing() { return timing; } };
})();
