'use strict';
/* =========================================================================
   CLOUDS — the scattered cloud puffs (buildClouds in js/game.js) get softer shapes and light:
   - rounder puffs with flat bottoms: a low-poly ball of 60 facets (the hull of 32 points spread over a sphere, a little
     irregular), flat-faceted like the terrain, or smooth (FACETED)
   - puffs stand upright (they keep their heading, lose the random tilt) so every cloud has its flat base down
   - bright tops, pale grey-blue bellies; sunlight wraps round the sides instead of cutting off at a hard terminator,
     and the bellies take their light from the sky (scattered through the cloud) more than from the ground
   The light follows the scene's sun and sky, so puffs dim under a cloud deck (js/clouddeck.js) like everything else.
   Plugs in through SCENERY_PLUGINS (js/sunlight.js): finds the puff mesh by its geometry and emissive colour.
   ========================================================================= */
const Clouds = (() => {
  const FLAT = -0.32;                                       // puff bottom (unit sphere): below this it's squashed flat
  const POINTS = 32, FACETED = true;                        // ball corners (a hull of n points has 2n - 4 facets); flat or round
  const TOP = new THREE.Color('#ffffff'), BELLY = new THREE.Color('#c2cdd8');
  const isPuffs = (o) => o.isInstancedMesh && o.geometry.type === 'IcosahedronGeometry' && o.material.emissive && o.material.emissive.getHex() === 0xaab9c6;

  // convex hull of POINTS points spread evenly (Fibonacci) over the unit sphere, nudged a little so facets vary;
  // few enough points to test every triple (a few ms, so worked out once and kept)
  let hull = null;
  function ball() {
    if (!hull) hull = makeHull();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(hull.slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(hull.slice(), 3));   // round: the sphere's own normals
    return g;
  }
  function makeHull() {
    const rand = mulberry32(23), P = [], tris = [];
    for (let i = 0; i < POINTS; i++) {
      const y = 1 - 2 * (i + 0.5) / POINTS, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5)) + (rand() - 0.5) * 0.35;
      P.push(new THREE.Vector3(Math.cos(a) * r, y + (rand() - 0.5) * 0.08, Math.sin(a) * r).normalize());
    }
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    for (let a = 0; a < POINTS; a++) for (let b = a + 1; b < POINTS; b++) for (let c = b + 1; c < POINTS; c++) {
      n.crossVectors(e1.subVectors(P[b], P[a]), e2.subVectors(P[c], P[a]));
      let pos = 0, neg = 0;
      for (let k = 0; k < POINTS; k++) { if (k === a || k === b || k === c) continue; const d = n.dot(e1.subVectors(P[k], P[a])); if (d > 1e-9) pos++; else if (d < -1e-9) neg++; }
      if (pos && neg) continue;
      tris.push(pos ? [a, c, b] : [a, b, c]);                // wind so the face looks outward
    }
    const pos = new Float32Array(tris.length * 9);
    tris.forEach((t, f) => t.forEach((k, v) => P[k].toArray(pos, f * 9 + v * 3)));
    return pos;
  }
  function puffGeometry() {
    const g = ball(), p = g.attributes.position;
    const nrm = g.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {                     // squash the bottom flat; its normals point down
      const y = p.getY(i);
      if (y < FLAT) { p.setY(i, FLAT + (y - FLAT) * 0.12); nrm.setXYZ(i, nrm.getX(i) * 0.4, -1, nrm.getZ(i) * 0.4); }
    }
    if (FACETED) g.computeVertexNormals();                  // non-indexed: one flat normal per triangle
    else g.normalizeNormals();
    for (let i = 0; i < p.count; i++) {                     // bright top, pale belly: by which way the face (or point) looks
      c.copy(BELLY).lerp(TOP, smoothstep(-0.7, 0.6, nrm.getY(i)));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }

  function puffMaterial() {
    const m = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true });
    m.userData.noSun = true;                                // not shaded by the terrain (js/sunlight.js)
    m.onBeforeCompile = (sh) => {
      Atmosphere.inject(sh);
      // wrap lighting: the sun reaches round the sides
      sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
	#if NUM_DIR_LIGHTS > 0
		float cloudWrap = clamp( ( dot( normal, directionalLights[ 0 ].direction ) + 0.9 ) / 1.9, 0.0, 1.0 );
		reflectedLight.directDiffuse = diffuseColor.rgb * RECIPROCAL_PI * directionalLights[ 0 ].color * cloudWrap;
	#endif
	// light scattered through the cloud from the sky: the bellies stay pale rather than taking the ground's colour
	#if NUM_HEMI_LIGHTS > 0
		reflectedLight.indirectDiffuse = diffuseColor.rgb * RECIPROCAL_PI * mix( hemisphereLights[ 0 ].skyColor, getHemisphereLightIrradiance( hemisphereLights[ 0 ], normal ), 0.35 ) * 1.25;
	#endif`);
    };
    m.customProgramCacheKey = () => 'cloud-puff';
    return m;
  }

  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  SCENERY_PLUGINS.push((group) => {
    group.traverse((o) => {
      if (!isPuffs(o)) return;
      o.geometry.dispose(); o.geometry = puffGeometry();
      o.material.dispose(); o.material = puffMaterial();
      for (let i = 0; i < o.count; i++) {                   // upright: keep the heading only
        o.getMatrixAt(i, _m); _m.decompose(_p, _q, _s);
        _e.setFromQuaternion(_q, 'YXZ'); _q.setFromAxisAngle(WORLD_UP, _e.y);
        o.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      o.instanceMatrix.needsUpdate = true;
    });
  });
  return {};
})();
