'use strict';
/* =========================================================================
   GLARE — the sun dazzles when you look toward it:
     core   the disc blazes out past its edge
     halo   a soft glow that spills well beyond it, onto the screen edge when the sun is just out of frame
     rays   a faint starburst, fixed to the screen like a lens's
     veil   the whole picture washes out a little, most when you look straight at the sun
     ghosts the lens flare: tinted discs, rings and six-sided aperture shapes strung along the line from the sun through
            the middle of the screen and out the other side, so they swing across the view opposite the sun as you turn;
            only while the sun itself is in frame (GHOSTS: where along the line, size, shape, tint)
   Hidden by what's between the camera and the sun: terrain (the soft sun shadow of js/sunlight.js, so it fades as
   the sun slips behind a ridge), overhangs, cloud puffs, and the cloud deck from below or inside. Eased in and out
   over a fraction of a second so it flares rather than flickers.
   One full-screen additive quad, drawn last; when there's no glare its corners collapse to a point, so it costs a
   draw call and no pixels. The sun direction comes from Atmosphere.uniforms (js/atmosphere.js).
   Plugs in through SCENERY_PLUGINS (js/sunlight.js), so js/game.js needs no changes.
   ========================================================================= */
const Glare = (() => {
  const TUNE = {
    core: 0.5, halo: 0.3, rays: 0.14, veil: 0.16,   // strengths at full glare
    reach: 70,        // degrees off the view direction where the glare has faded out entirely
    ease: 9,          // 1/s: how fast it follows the sun going behind something and coming out
    color: '#fff0d4',
    ghosts: 1,        // strength of the whole ghost chain
  };
  // k: position along the sun-to-centre line (1 the sun, 0 the middle of the screen, negative past it); r: radius in
  // short sides of the screen; shape: disc, hex (the aperture) or ring; c: tint times strength
  const GHOSTS = [
    { k: 0.62, r: 0.03, shape: 'hex', c: [0.13, 0.1, 0.06] },
    { k: 0.3, r: 0.014, shape: 'disc', c: [0.08, 0.14, 0.09] },
    { k: -0.12, r: 0.055, shape: 'hex', c: [0.05, 0.07, 0.1] },
    { k: -0.38, r: 0.022, shape: 'disc', c: [0.12, 0.07, 0.1] },
    { k: -0.66, r: 0.1, shape: 'hex', c: [0.04, 0.06, 0.08] },
    { k: -1.0, r: 0.045, shape: 'ring', c: [0.12, 0.09, 0.05] },
    { k: -1.35, r: 0.17, shape: 'disc', c: [0.025, 0.035, 0.055] },
  ];
  const U = {
    glSun: { value: new THREE.Vector2() },              // sun position, NDC
    glAspect: { value: 1 },
    glK: { value: new THREE.Vector4() },                // core, halo, rays, veil
    glGhost: { value: 0 },                              // ghost chain strength
    glColor: { value: new THREE.Color(TUNE.color) },
    glOn: { value: 0 },
  };
  const VERT = `
uniform float glOn;
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = vec4( position.xy * glOn, 0.0, 1.0 );   // glOn 0: a point, no pixels
}`;
  const f = (x) => x.toFixed(4);
  const GHOST_GLSL = GHOSTS.map((g) => {
    const shape = g.shape === 'hex' ? 'glHex( q ) / ' + f(g.r) : 'length( q ) / ' + f(g.r);
    const fill = g.shape === 'ring' ? 'smoothstep( 0.72, 0.9, s ) * ( 1.0 - smoothstep( 0.9, 1.0, s ) )'
      : '( 1.0 - smoothstep( 0.82, 1.0, s ) ) * ( 0.55 + 0.45 * smoothstep( 0.4, 0.95, s ) )';   // brighter rim
    return `  q = ( vP - glSun * ${f(g.k)} ) * sc; s = ${shape}; if ( s < 1.0 ) gh += vec3( ${g.c.map(f).join(', ')} ) * ${fill};`;
  }).join('\n');
  const FRAG = `
uniform float glGhost;
float glHex( vec2 q ) { q = abs( q ); return max( q.x * 0.866 + q.y * 0.5, q.y ); }   // flat-topped hexagon, apothem 1
uniform vec2 glSun;
uniform float glAspect;
uniform vec4 glK;
uniform vec3 glColor;
varying vec2 vP;
void main() {
  vec2 sc = vec2( glAspect, 1.0 ) * ( 0.5 / min( glAspect, 1.0 ) );   // NDC to lengths of the screen's short side
  vec2 d = ( vP - glSun ) * sc;
  float r = length( d );
  float core = exp( - r * r / 0.0011 );
  float halo = 0.4 * exp( - r / 0.05 ) + 0.6 * exp( - r / 0.28 );
  float a = atan( d.y, d.x );
  float rays = pow( abs( cos( a * 3.0 ) ), 48.0 ) + 0.6 * pow( abs( cos( a * 5.0 + 0.7 ) ), 90.0 );   // 6 long, 10 fine
  rays *= exp( - r / 0.16 ) * smoothstep( 0.012, 0.05, r );
  float veil = 0.55 + 0.45 * exp( - r / 0.45 );
  vec3 gh = vec3( 0.0 );
  if ( glGhost > 0.0 ) {
    vec2 q; float s;
${GHOST_GLSL}
  }
  gl_FragColor = vec4( glColor * ( glK.x * core + glK.y * halo + glK.z * rays + glK.w * veil ) + gh * glGhost, 1.0 );
}`;
  const material = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, transparent: true,
    depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  material.userData.shared = true;                          // outlives course switches
  material.userData.noSun = true;

  let puffs = new Float32Array(0), deck = null, level = 0, last = 0;
  const st = { target: 0, level: 0, vis: 0 };               // for tests
  const _f = new THREE.Vector3(), _p = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const cosReach = Math.cos(TUNE.reach * Math.PI / 180);

  // how much of the sun the camera at c sees, 0..1
  function visibility(c, sd) {
    let v = Sunlight.at(c.x, c.y, c.z)[0];                  // terrain, soft-edged
    if (v <= 0) return 0;
    if (deck) {                                             // under or in the deck: hidden (as the sky dome fades there)
      const th = deck.top - deck.base;
      v *= smoothstep(deck.top - th * 0.35, deck.top + 25, c.y);
      if (v <= 0) return 0;
    }
    for (let i = 0; i < puffs.length; i += 4) {             // cloud puffs, as soft-edged spheres
      const qx = puffs[i] - c.x, qy = puffs[i + 1] - c.y, qz = puffs[i + 2] - c.z, R = puffs[i + 3];
      const t = Math.max(0, qx * sd.x + qy * sd.y + qz * sd.z);
      const ex = qx - sd.x * t, ey = qy - sd.y * t, ez = qz - sd.z * t, e2 = ex * ex + ey * ey + ez * ez;
      if (e2 < R * R) { v *= smoothstep(0.5, 1, Math.sqrt(e2) / R); if (v <= 0) return 0; }
    }
    if (typeof OVERHANGS !== 'undefined' && OVERHANGS.length) {   // rock: sampled along the ray (it's all big)
      for (let t = 2; t < 400; t += 3) {
        _p.copy(c).addScaledVector(sd, t);
        if (overhangHit(_p)) return 0;
      }
    }
    return v;
  }

  function beforeRender(renderer, scene, camera) {
    const now = performance.now(), dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    const sd = Atmosphere.uniforms.atmSunDir.value;
    camera.getWorldDirection(_f);
    const cosA = _f.dot(sd);
    let target = 0;
    if (cosA > cosReach) target = visibility(camera.position, sd);
    st.vis = target;
    level += (target - level) * (1 - Math.exp(-TUNE.ease * dt));
    if (target === 0 && level < 0.004) level = 0;
    st.target = target; st.level = level;
    if (level <= 0) { U.glOn.value = 0; return; }
    _p.copy(camera.position).addScaledVector(sd, 100).project(camera);   // includes any view offset
    U.glSun.value.set(_p.x, _p.y);
    U.glAspect.value = camera.aspect;
    // how squarely you look at it: veil strongest dead ahead; everything fades toward the reach angle
    const edge = smoothstep(cosReach, cosReach + (1 - cosReach) * 0.35, cosA);
    const r = Math.hypot(_p.x * camera.aspect, _p.y) * 0.5 / Math.min(camera.aspect, 1);
    const ahead = Math.exp(-r * r / 0.22);
    const k = level * edge;
    U.glK.value.set(TUNE.core * k, TUNE.halo * k, TUNE.rays * k, TUNE.veil * k * ahead);
    const inFrame = cosA > 0 ? smoothstep(1.25, 0.95, Math.max(Math.abs(_p.x), Math.abs(_p.y))) : 0;
    U.glGhost.value = TUNE.ghosts * level * inFrame;
    U.glOn.value = 1;
  }

  SCENERY_PLUGINS.push((group) => {
    const list = [];
    group.traverse((o) => {
      if (!o.isInstancedMesh || !o.userData.clouds) return;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, _m); _m.premultiply(o.matrixWorld).decompose(_p, _q, _s);
        list.push(_p.x, _p.y, _p.z, Math.max(_s.x, _s.z) * 0.85);
      }
    });
    puffs = new Float32Array(list);
    deck = COURSE && COURSE.deck ? COURSE.deck : null;
    level = 0; last = 0;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false; mesh.renderOrder = 20;       // after every other see-through thing
    mesh.onBeforeRender = beforeRender;
    group.add(mesh);
  });
  // for tests: what the camera at p sees of the sun, and the puffs it checks
  return { TUNE, uniforms: U, state: st, visibility: (p) => visibility(p, Atmosphere.uniforms.atmSunDir.value), get puffs() { return puffs; } };
})();
