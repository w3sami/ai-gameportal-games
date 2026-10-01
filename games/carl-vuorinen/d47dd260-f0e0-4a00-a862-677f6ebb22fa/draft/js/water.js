'use strict';
/* =========================================================================
   WATER — the lake/sea plane (userData.sunTex, built in js/game.js) gets a surface:
   - travelling waves in world space tilt the normal, scaled patch by patch by drifting gust fields and bent by a warp,
     so the pattern never repeats; waves finer than a pixel are dropped (no far-off moiré) and turned into roughness,
     which dims the mirror and widens the glint, so calm and rough patches still read from high up
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
  // travelling waves around a prevailing wind: wavelengths spread geometrically and directions fanned out (wider for the
  // short ones), both jittered from a fixed seed so no two waves line up into a lattice; the long waves and the chop are
  // scaled by drifting gust fields (below), so the lake has calm and rough patches instead of one pattern
  const WIND = 0.62;                                        // rad; direction the waves travel (x, z)
  const rnd = ((s) => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; })(20260928);
  const WAVES = [];
  for (let i = 0, len = 44; i < 8; i++, len /= 1.42 + 0.12 * rnd()) {
    const a = WIND + (rnd() * 2 - 1) * (0.35 + 0.1 * i), s = 0.05 - 0.0028 * i;
    WAVES.push([Math.cos(a), Math.sin(a), len, s, rnd() * 6.2832]);
  }
  const MAX_LEN = WAVES[0][2];
  // slope variance when every wave is finer than a pixel, per gust channel: (long, chop) x (even, odd)
  const vs = (lo, odd) => WAVES.reduce((v, w, i) => v + ((i < 4) === lo && i % 2 === odd ? w[3] * w[3] : 0), 0).toFixed(6);
  const VARS = `dot( g2, vec2( ${vs(true, 0)}, ${vs(true, 1)} ) ) + dot( c2, vec2( ${vs(false, 0)}, ${vs(false, 1)} ) )`;
  const waveGLSL = WAVES.map(([dx, dz, len, s, ph], i) => {
    const k = (2 * Math.PI / len).toFixed(4), w = Math.sqrt(9.81 * 2 * Math.PI / len).toFixed(4);
    const d = `vec2( ${dx.toFixed(4)}, ${dz.toFixed(4)} )`, gst = (i < 4 ? 'ga' : 'gc') + (i % 2 ? '.y' : '.x');
    return `\td = ${d}; a = ${s.toFixed(4)} * ${gst};
\tf = 1.0 - smoothstep( 0.12, 0.33, length( vec2( dot( d, vh ) * fpa, dot( d, vp ) * fpb ) ) * ${(1 / len).toFixed(5)} );
\tg += d * ( a * f ) * cos( dot( q, d ) * ${k} - ${w} * t + ${ph.toFixed(3)} ); vr += a * a * ( 1.0 - f * f );`;
  }).join('\n');

  // gust fields and crest warp: smooth value noise read from a small random texture (4 independent channels a fetch)
  const NOISE = (() => {
    const n = 64, data = new Uint8Array(n * n * 4);
    for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256);
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  })();
  U.waterNoise = { value: NOISE };
  U.waterPix = { value: 0.0016 };                           // radians per drawing-buffer pixel, set each frame

  const FRAG_FUNCS = `
uniform float waterTime;
uniform vec3 waterSky;
uniform vec3 waterFoam;
uniform sampler2D waterNoise;
uniform float waterPix;
varying vec3 vWaterWP;
vec4 waterN( vec2 uv ) {                                  // C1 value noise, one texel = one cell
\tuv = uv * 64.0 - 0.5;
\tvec2 i = floor( uv ), f = fract( uv );
\treturn texture2D( waterNoise, ( i + f * f * ( 3.0 - 2.0 * f ) + 0.5 ) / 64.0 );
}
// slope of the surface at p; vh/vp: horizontal view direction and its perpendicular, fpa/fpb: pixel footprint (m)
// along/across it. Waves too fine for the pixel are dropped (no moiré far off) and their slope variance returned
// in vr instead, so the shading can treat them as roughness. rough: the gust fields, 0 calm .. 1 rough
vec2 waterSlope( vec2 p, float t, vec2 vh, float fpa, float fpb, out float vr, out float rough ) {
\tvec2 drift = - vec2( ${Math.cos(WIND).toFixed(4)}, ${Math.sin(WIND).toFixed(4)} ) * t;
\tvec4 n1 = waterN( mat2( 0.8, 0.6, -0.6, 0.8 ) * ( p + drift * 1.5 ) / 12000.0 );     // ~190 m patches
\tvec4 n2 = waterN( mat2( 0.28, -0.96, 0.96, 0.28 ) * ( p + drift * 2.5 ) / 5800.0 );  // ~90 m, faded out far off
\tvec4 n = mix( n1, mix( n1, n2, 0.4 ), 1.0 - smoothstep( 25.0, 70.0, fpa ) );
\t// long waves follow the big patches; the short ones (the chop) the finer mix, so it comes and goes on its own
\tvec2 gst = mix( smoothstep( 0.3, 0.7, n.rg ), vec2( 0.5 ), smoothstep( 60.0, 200.0, fpa ) );   // too far to resolve
\tvec2 gc = mix( gst, smoothstep( 0.25, 0.75, n2.rg ), 1.0 - smoothstep( 25.0, 70.0, fpa ) );
\trough = 0.25 * ( gst.x + gst.y + gc.x + gc.y );
\tvec2 ga = 0.1 + 1.4 * gst; gc = 0.1 + 1.4 * gc;
\tvr = 0.0;
\tif ( fpb * 3.0 > ${MAX_LEN.toFixed(1)} ) { vec2 g2 = ga * ga, c2 = gc * gc; vr = ${VARS}; return vec2( 0.0 ); }
\tvec2 q = p + ( n.ba - 0.5 ) * 20.0;                     // bent crests: up to ±10 m of phase warp
\tvec2 vp = vec2( - vh.y, vh.x ), g = vec2( 0.0 ), d;
\tfloat a, f;
${waveGLSL}
\treturn g;
}
`;
  const FRAG_MAIN = `
	{
		vec3 wv = vWaterWP - cameraPosition;
		float wd = length( wv );
		vec3 V = - wv / max( wd, 1e-3 );
		float hv = length( V.xz ), fpb = wd * waterPix, vr, rough;
		vec2 vh = hv > 1e-4 ? - V.xz / hv : vec2( 1.0, 0.0 );
		vec2 sl = waterSlope( vWaterWP.xz, waterTime, vh, fpb / max( V.y, 0.02 ), fpb, vr, rough );
		vec3 N = normalize( vec3( - sl.x, 1.0, - sl.y ) );
		float sig = sqrt( vr * 0.5 );                          // unresolved slope, per axis
		float depth = sunTexel.b * 25.5;
		float shallow = 1.0 - smoothstep( 0.0, 4.0, depth );
		outgoingLight = mix( outgoingLight, outgoingLight * vec3( 1.12, 1.22, 1.1 ) + vec3( 0.015, 0.025, 0.02 ), shallow * 0.7 );
		vec3 zenith = mix( fogColor, waterSky, atmSunK ), R = reflect( - V, N ), refl = vec3( 0.0 );
		R.y = abs( R.y );
		// the unresolved slopes, as two facets tilted toward and away from the eye: at grazing, rough water mirrors less
		// and more of the zenith (darker); from above it catches some horizon (lighter). One facet when calm
		float F = 0.0;
		for ( int i = 0; i < 2; i ++ ) {
			vec3 Nt = normalize( N + vec3( vh.x, 0.0, vh.y ) * ( i == 0 ? 1.4 : -1.4 ) * sig );
			float Ft = 0.03 + 0.97 * pow( 1.0 - max( dot( Nt, V ), 0.02 ), 5.0 );
			vec3 Rt = reflect( - V, Nt ); Rt.y = abs( Rt.y );
			refl += Ft * mix( atmFogColor( Rt, fogColor ), zenith, pow( clamp( Rt.y, 0.0, 1.0 ), 0.55 ) );
			F += Ft;
		}
		refl /= F; F *= 0.5;
		// hemmed in (a canyon, a harbour wall), less sky to mirror: the banks show instead, darker
		refl = mix( outgoingLight * 0.7, refl, smoothstep( 0.55, 0.95, sunAOv.y ) );
		outgoingLight = mix( outgoingLight, refl, F * 0.8 );
		float mu = dot( R, atmSunDir ), foam = 0.0;
		// unresolved slopes widen the glint into a glitter path (lobe exponent from the slope spread, energy kept)
		float e1 = 1.0 / ( 1.0 / 600.0 + 4.0 * sig * sig ), e2 = 1.0 / ( 1.0 / 60.0 + 4.0 * sig * sig );
		if ( mu > 0.8 ) outgoingLight += atmSun.rgb * atmSunK * sunAOv.x * ( 5.0 * e1 / 600.0 * pow( mu, e1 ) + 0.25 * e2 / 60.0 * pow( mu, e2 ) );
		// foam: a band along the waterline, broken up by the waves, fading with distance (skipped in open water)
		if ( depth < 1.8 && wd < 1400.0 ) {
			vec4 fn = waterN( vWaterWP.xz / 800.0 + vec2( 0.004, -0.003 ) * waterTime );      // ~12 m cells, lapping in and out
			float br = mix( fn.r, fn.g, 0.5 + 0.5 * sin( waterTime * 0.8 + fn.b * 6.2832 ) );
			br = smoothstep( 0.2, 0.8, br ) * ( 0.6 + 0.8 * rough );
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
  const tick = (renderer, scene, camera) => {
    U.waterTime.value = performance.now() / 1000;
    U.waterPix.value = 2 * Math.tan(camera.fov * Math.PI / 360) / camera.zoom / Math.max(renderer.domElement.height, 1);
  };

  SCENERY_PLUGINS.push((group) => {
    group.traverse((o) => {
      if (!o.isMesh || !o.userData.sunTex) return;
      const h = o.material.userData.sunHooks || (o.material.userData.sunHooks = []);   // appended: other modules hook in too
      if (!h.some((x) => x.key === 'water')) h.push({ key: 'water', fn: hook });
      if (!o.material.transparent) o.renderOrder = 1;   // opaque: after the terrain, so water hidden under it isn't shaded
      o.onBeforeRender = tick;
    });
  });
  return { uniforms: U };
})();
