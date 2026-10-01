'use strict';
/* =========================================================================
   GRAIN — fine surface texture on the terrain, so flying low reads as speed and big flat facets don't look empty:
   a small tiling noise texture (made here, no files) multiplies the terrain colour at two scales,
     fine   metre-scale grain close to the plane, gone by a few hundred metres
     coarse patches tens of metres across that break up the facets further out
   projected along each facet's main axis (tops from above, walls from the side), so steep faces don't smear.
   Per pixel: two texture reads, skipped where both have faded out. Mipmaps keep it from shimmering.
   Plugs in through SCENERY_PLUGINS and sunHooks (js/sunlight.js).
   ========================================================================= */
const Grain = (() => {
  const SIZE = 256;
  const FINE = { tile: 26, amount: 0.12, fade: [70, 450] };      // tile: metres per texture repeat
  const COARSE = { tile: 310, amount: 0.1, fade: [500, 2600] };
  const U = { grainTex: { value: null } };

  function noiseTexture() {                                  // tiling value noise, octaves of 64..4 texels
    const v = new Float32Array(SIZE * SIZE), rand = mulberry32(41);
    let amp = 1;
    for (let per = 64; per >= 4; per /= 2, amp *= 0.6) {
      const n = SIZE / per, lat = new Float32Array(n * n);
      for (let k = 0; k < n * n; k++) lat[k] = rand();
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const gx = x / per, gy = y / per, i = Math.floor(gx), j = Math.floor(gy);
        const fx = gx - i, fy = gy - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const i1 = (i + 1) % n, j1 = (j + 1) % n;
        const a = lat[j * n + i], b = lat[j * n + i1], c = lat[j1 * n + i], d = lat[j1 * n + i1];
        v[y * SIZE + x] += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy);
      }
    }
    let lo = Infinity, hi = -Infinity;
    for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; }
    const px = new Uint8Array(SIZE * SIZE * 4);
    for (let k = 0; k < SIZE * SIZE; k++) { const g = Math.round((v[k] - lo) / (hi - lo) * 255); px[k * 4] = px[k * 4 + 1] = px[k * 4 + 2] = g; px[k * 4 + 3] = 255; }
    const t = new THREE.DataTexture(px, SIZE, SIZE, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  }

  const f = (x) => x.toFixed(4);
  function hook(sh) {
    if (!U.grainTex.value) U.grainTex.value = noiseTexture();
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vGrainWP;\nvarying vec3 vGrainN;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n\tvGrainN = objectNormal;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n\tvGrainWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = 'uniform sampler2D grainTex;\nvarying vec3 vGrainWP;\nvarying vec3 vGrainN;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
	{
		float gd = distance( vGrainWP, cameraPosition );
		if ( gd < ${f(COARSE.fade[1])} ) {
			vec3 an = abs( vGrainN );
			vec2 gp = an.y > 0.6 ? vGrainWP.xz : an.x > an.z ? vGrainWP.zy : vGrainWP.xy;   // along the facet's main axis
			float fine = ( 1.0 - smoothstep( ${f(FINE.fade[0])}, ${f(FINE.fade[1])}, gd ) ) * ${f(FINE.amount)};
			float coarse = ( 1.0 - smoothstep( ${f(COARSE.fade[0])}, ${f(COARSE.fade[1])}, gd ) ) * ${f(COARSE.amount)};
			float g = coarse * ( texture2D( grainTex, gp / ${f(COARSE.tile)} ).r - 0.5 ) * 2.0;
			if ( fine > 0.0 ) g += fine * ( texture2D( grainTex, gp / ${f(FINE.tile)} + 0.37 ).r - 0.5 ) * 2.0;
			diffuseColor.rgb *= 1.0 + g;
		}
	}`);
  }

  SCENERY_PLUGINS.push((group) => {
    group.traverse((o) => {
      if (!o.isMesh || !o.userData.sunGrid) return;
      const h = o.material.userData.sunHooks || (o.material.userData.sunHooks = []);
      if (!h.some((x) => x.key === 'grain')) h.push({ key: 'grain', fn: hook });
    });
  });
  return { uniforms: U };
})();
