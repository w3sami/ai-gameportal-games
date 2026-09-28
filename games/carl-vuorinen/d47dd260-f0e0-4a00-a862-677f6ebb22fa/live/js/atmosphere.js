'use strict';
/* =========================================================================
   ATMOSPHERE — aerial perspective for every fogged material, and the sky dome to match.
   Replaces three's fog chunks (before anything compiles), so no material needs its own code:
   - the fog colour warms and brightens toward the sun and cools a little away from it
   - an exponential haze layer lies in the low ground: valleys and canyon floors read deeper than ridges
   The linear fog (near/far per course) is unchanged; the haze adds to it, capped, so hoops stay in sight.
   Course format (all optional): view.haze = { density, base, height, max, glow }
     density  haze per metre at the base height, as a multiple of 1/fogFar (default 0.35)
     base     height (m) where the haze is densest (default: low ground, from the terrain)
     height   scale height (m): the haze thins by e every this much above base (default: from the relief)
     max      most the haze can add on top of the linear fog, 0..1 (default 0.3)
     glow     strength of the sun tint in the fog, 0..1 (default 0.55)
   ========================================================================= */
const Atmosphere = (() => {
  const U = {
    atmSunDir: { value: new THREE.Vector3(0, 1, 0) },
    atmSun: { value: new THREE.Vector4(1, 1, 1, 0) },          // rgb: fog colour toward the sun, a: glow strength
    atmHaze: { value: new THREE.Vector4(0, 0, 100, 0) },       // density (1/m), base (m), scale height (m), max
    atmSunK: { value: 1 },                                       // sunlight getting through, 0..1 (less under a cloud deck)
  };
  // shared by the fog and the sky dome: the fog colour seen along direction d
  const GLSL = `
uniform vec3 atmSunDir;
uniform vec4 atmSun;
uniform vec4 atmHaze;
uniform float atmSunK;
vec3 atmFogColor( vec3 d, vec3 base ) {
  float mu = dot( d, atmSunDir );
  float toward = max( mu, 0.0 ), away = max( - mu, 0.0 );
  vec3 c = mix( base, base * vec3( 0.9, 0.95, 1.03 ), atmSun.a * 0.6 * away * away );
  return mix( c, atmSun.rgb, atmSun.a * ( 0.55 * pow( toward, 5.0 ) + 0.45 * pow( toward, 28.0 ) ) );
}`;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogWorld;\n#endif';
  // camera-to-vertex in world space: transpose of the view rotation (no transpose() in GLSL ES 1.0)
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogWorld = vec3( dot( viewMatrix[ 0 ].xyz, mvPosition.xyz ), dot( viewMatrix[ 1 ].xyz, mvPosition.xyz ), dot( viewMatrix[ 2 ].xyz, mvPosition.xyz ) );\n#endif';
  C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
${GLSL}
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	float atmL = length( vFogWorld );
	vec3 atmD = vFogWorld / max( atmL, 1e-3 );
	if ( atmHaze.w > 0.0 ) {
		// optical depth of an exponential layer along the ray: integral of density * exp(-(y - base) / H)
		float atmH = atmHaze.z;
		float y0 = max( cameraPosition.y - atmHaze.y, 0.0 ), y1 = max( cameraPosition.y + vFogWorld.y - atmHaze.y, 0.0 );   // no denser below the base
		float e0 = exp( - y0 / atmH ), k = ( y1 - y0 ) / atmH;
		float od = atmHaze.x * atmL * ( abs( k ) > 1e-3 ? ( e0 - exp( - y1 / atmH ) ) / k : e0 );
		fogFactor = 1.0 - ( 1.0 - fogFactor ) * ( 1.0 - min( 1.0 - exp( - od ), atmHaze.w ) );
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, atmFogColor( atmD, fogColor ), fogFactor );
#endif`;
  // every built-in material gets the shared uniforms (materials with their own onBeforeCompile call inject())
  function inject(shader) { Object.assign(shader.uniforms, U); }
  THREE.Material.prototype.onBeforeCompile = function (shader) { inject(shader); };

  const warm = new THREE.Color('#fff2d8');
  let sunLight = null, sunBase = 1, glow = 0.55;

  // the dome is fog-free with its own gradient: blend the same sun tint in toward the horizon, plus a halo
  function patchSky(material) {
    material.onBeforeCompile = (sh) => {
      inject(sh);
      sh.vertexShader = 'varying vec3 vSkyDir;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvSkyDir = position;');
      sh.fragmentShader = 'varying vec3 vSkyDir;\n' + GLSL + '\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
	vec3 skyD = normalize( vSkyDir );
	float skyMu = max( dot( skyD, atmSunDir ), 0.0 );
	diffuseColor.rgb = mix( diffuseColor.rgb, atmFogColor( skyD, diffuseColor.rgb ), 1.0 - smoothstep( 0.0, 0.3, max( skyD.y, 0.0 ) ) );
	diffuseColor.rgb += atmSun.rgb * atmSun.a * ( 0.5 * pow( skyMu, 400.0 ) + 0.22 * pow( skyMu, 40.0 ) );`);
    };
    material.customProgramCacheKey = () => 'atm-sky';
    material.needsUpdate = true;
  }

  function init({ sunDir, sun, sky }) {
    U.atmSunDir.value.copy(sunDir).normalize();
    sunLight = sun; sunBase = sun.intensity || 1;
    if (sky) patchSky(sky.material);
  }

  // per course: haze from the terrain's low ground and relief unless the course sets it
  function configure(view, course) {
    const hz = Object.assign({}, (course.view || {}).haze);
    glow = hz.glow != null ? hz.glow : 0.55;
    const hs = [];
    for (let k = 0; k < TH.length; k += 97) hs.push(Math.max(TH[k], TER.WATER));
    hs.sort((a, b) => a - b);
    const lo = hs[Math.floor(hs.length * 0.01)], hi = hs[Math.floor(hs.length * 0.95)];
    const base = hz.base != null ? hz.base : lo;
    const H = hz.height != null ? hz.height : clamp((hi - lo) * 0.16, 30, 450);
    const dens = (hz.density != null ? hz.density : 0.35) / view.fog[1];
    U.atmHaze.value.set(dens, base, H, hz.max != null ? hz.max : 0.3);
  }

  // every frame: the sun tint follows the fog colour and the sunlight (both change under a cloud deck)
  function update(fog) {
    const k = sunLight ? clamp(sunLight.intensity / sunBase, 0, 1) : 1;
    U.atmSunK.value = k;
    const c = U.atmSun.value, f = fog.color;
    c.set(lerp(f.r, warm.r, 0.75) * 1.06, lerp(f.g, warm.g, 0.75) * 1.06, lerp(f.b, warm.b, 0.75) * 1.06, glow * k * k);
  }

  // the haze the fog shader would add at point p seen from camera c (for tests)
  function hazeAt(cx, cy, cz, px, py, pz) {
    const [dens, base, H, max] = U.atmHaze.value.toArray();
    if (max <= 0) return 0;
    const L = Math.hypot(px - cx, py - cy, pz - cz);
    const y0 = Math.max(cy - base, 0), y1 = Math.max(py - base, 0), e0 = Math.exp(-y0 / H), k = (y1 - y0) / H;
    const od = dens * L * (Math.abs(k) > 1e-3 ? (e0 - Math.exp(-y1 / H)) / k : e0);
    return Math.min(1 - Math.exp(-od), max);
  }

  return { init, configure, update, inject, hazeAt, uniforms: U };
})();
