'use strict';
/* =========================================================================
   WATER — the lake/sea plane (userData.sunTex, built in js/game.js) gets a surface:
   - a few travelling waves in world space tilt the normal (faded out with distance, so far water doesn't shimmer)
   - it reflects the sky: the horizon colour (with the sun tint, js/atmosphere.js) blending to the zenith, by Fresnel;
     where hills or walls hem it in (js/sunlight.js's occlusion) it mirrors the darker banks instead
   - the sun glints off it where it isn't in shadow (js/sunlight.js), dimmer under a cloud deck
   - shallows are lighter, and foam breaks along the shore; depth comes from js/sunlight.js's texture
   See-through seas (palette.waterOpacity) turn opaque at grazing angles and clearer in the shallows.
   No per-course settings. Plugs in through SCENERY_PLUGINS and sunHooks (js/sunlight.js).
   ========================================================================= */
const Water = (() => {
  const U = {
    waterTime: { value: 0 },
    waterSky: { value: new THREE.Color('#5c9bd2') },         // zenith: the sky dome's top colour (js/game.js COL.sky)
    waterFoam: { value: new THREE.Color('#f2f6f7') },
  };
  // travelling waves: direction, wavelength (m) and slope; deep-water speed from the wavelength
  const WAVES = [[0.81, 0.59, 37, 0.05], [0.28, 0.96, 21, 0.05], [0.97, -0.24, 13.3, 0.045], [-0.53, 0.85, 8.7, 0.04], [0.62, -0.78, 5.9, 0.035]];
  const waveGLSL = WAVES.map(([dx, dz, len, s]) => {
    const k = (2 * Math.PI / len).toFixed(4), w = Math.sqrt(9.81 * 2 * Math.PI / len).toFixed(4), d = `vec2( ${dx}, ${dz} )`;
    return `\tg += ${d} * ${s.toFixed(3)} * cos( dot( p, ${d} ) * ${k} - ${w} * t );`;
  }).join('\n');
  const FRAG_FUNCS = `
uniform float waterTime;
uniform vec3 waterSky;
uniform vec3 waterFoam;
varying vec3 vWaterWP;
vec2 waterSlope( vec2 p, float t ) {
	vec2 g = vec2( 0.0 );
${waveGLSL}
	return g;
}
`;
  const FRAG_MAIN = `
	{
		vec3 wv = vWaterWP - cameraPosition;
		float wd = length( wv );
		vec3 V = - wv / max( wd, 1e-3 );
		float amp = 1.0 - smoothstep( 150.0, 1500.0, wd );
		vec2 sl = amp > 0.0 ? waterSlope( vWaterWP.xz, waterTime ) * amp : vec2( 0.0 );
		vec3 N = normalize( vec3( - sl.x, 1.0, - sl.y ) );
		float depth = sunTexel.b * 25.5;
		float shallow = 1.0 - smoothstep( 0.0, 4.0, depth );
		outgoingLight = mix( outgoingLight, outgoingLight * vec3( 1.12, 1.22, 1.1 ) + vec3( 0.015, 0.025, 0.02 ), shallow * 0.7 );
		float F = 0.03 + 0.97 * pow( 1.0 - max( dot( N, V ), 0.0 ), 5.0 );
		vec3 R = reflect( - V, N ); R.y = abs( R.y );
		vec3 zenith = mix( fogColor, waterSky, atmSunK );
		vec3 refl = mix( atmFogColor( R, fogColor ), zenith, pow( clamp( R.y, 0.0, 1.0 ), 0.55 ) );
		// hemmed in (a canyon, a harbour wall), less sky to mirror: the banks show instead, darker
		refl = mix( outgoingLight * 0.7, refl, smoothstep( 0.55, 0.95, sunAOv.y ) );
		outgoingLight = mix( outgoingLight, refl, F * 0.8 );
		float mu = dot( R, atmSunDir ), foam = 0.0;
		if ( mu > 0.9 ) outgoingLight += atmSun.rgb * atmSunK * sunAOv.x * ( 5.0 * pow( mu, 600.0 ) + 0.25 * pow( mu, 60.0 ) );
		// foam: a band along the waterline, broken up by the waves, fading with distance (skipped in open water)
		if ( depth < 1.8 && wd < 1400.0 ) {
			float br = 0.5 + 0.5 * sin( dot( vWaterWP.xz, vec2( 0.37, 0.23 ) ) + waterTime * 0.9 ) * sin( dot( vWaterWP.xz, vec2( -0.21, 0.41 ) ) - waterTime * 0.7 );
			foam = ( 1.0 - smoothstep( 0.1, 0.9 + 0.8 * br, depth ) ) * ( 1.0 - smoothstep( 250.0, 1400.0, wd ) );
			outgoingLight = mix( outgoingLight, waterFoam * ( 0.5 + 0.5 * sunAOv.x ), foam * 0.85 );
		}
		diffuseColor.a = mix( diffuseColor.a * ( 1.0 - 0.3 * shallow ), 1.0, max( F, foam ) );
	}
	#include <opaque_fragment>`;

  function hook(sh) {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vWaterWP;\n' + sh.vertexShader.replace('#include <fog_vertex>',
      '#include <fog_vertex>\n\tvWaterWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', FRAG_FUNCS + 'void main() {')
      .replace('#include <opaque_fragment>', FRAG_MAIN);
  }
  const tick = () => { U.waterTime.value = performance.now() / 1000; };

  SCENERY_PLUGINS.push((group) => {
    group.traverse((o) => {
      if (!o.isMesh || !o.userData.sunTex) return;
      o.material.userData.sunHooks = [{ key: 'water', fn: hook }];
      if (!o.material.transparent) o.renderOrder = 1;   // opaque: after the terrain, so water hidden under it isn't shaded
      o.onBeforeRender = tick;
    });
  });
  return { uniforms: U };
})();
