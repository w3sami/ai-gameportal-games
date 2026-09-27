'use strict';
/* =========================================================================
   CLOUDS — the scattered cloud puffs (buildClouds in js/game.js) get softer shapes and light:
   - rounder puffs (a once-subdivided icosahedron with smooth normals) with flattened bottoms
   - puffs stand upright (they keep their heading, lose the random tilt) so every cloud has its flat base down
   - bright tops, pale grey-blue bellies; sunlight wraps round the sides instead of cutting off at a hard terminator,
     and the bellies take their light from the sky (scattered through the cloud) more than from the ground
   The light follows the scene's sun and sky, so puffs dim under a cloud deck (js/clouddeck.js) like everything else.
   Plugs in through SCENERY_PLUGINS (js/sunlight.js): finds the puff mesh by its geometry and emissive colour.
   ========================================================================= */
const Clouds = (() => {
  const FLAT = -0.32;                                       // puff bottom (unit sphere): below this it's squashed flat
  const TOP = new THREE.Color('#ffffff'), BELLY = new THREE.Color('#c2cdd8');
  const isPuffs = (o) => o.isInstancedMesh && o.geometry.type === 'IcosahedronGeometry' && o.material.emissive && o.material.emissive.getHex() === 0xaab9c6;

  function puffGeometry() {
    const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
    const nrm = new Float32Array(p.count * 3), col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      nrm[i * 3] = x; nrm[i * 3 + 1] = y; nrm[i * 3 + 2] = z;                  // round: sphere normals
      if (y < FLAT) { p.setY(i, FLAT + (y - FLAT) * 0.12); nrm[i * 3] *= 0.4; nrm[i * 3 + 1] = -1; nrm[i * 3 + 2] *= 0.4; }
      c.copy(BELLY).lerp(TOP, smoothstep(-0.4, 0.55, y));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.normalizeNormals();
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
