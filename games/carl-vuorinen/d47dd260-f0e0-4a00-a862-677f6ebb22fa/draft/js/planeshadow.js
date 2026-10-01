'use strict';
/* =========================================================================
   PLANE SHADOW — the aircraft's real silhouette on the ground, replacing the round blob.
   Each frame the aircraft is drawn from the light's direction into a small render target (only its alpha is used,
   so every model works as it is, and the faint prop disc casts a faint disc). Every lit scenery material projects
   that target (a sunHooks entry, js/sunlight.js) and takes away direct sunlight where the plane blocks it: the
   same thing the baked terrain shadow does, so the plane's shadow on already-shaded ground adds nothing.
   The penumbra widens and the shadow fades with distance from the plane, per pixel: a low pass shows a crisp
   shape (a wing tip nearer the ground is sharper than the tail), a high one a soft, faint smudge.
   Light direction: TUNE.SHADOW_SUN blends from straight down (0, the old altitude cue) to the sun (1).
   PlaneShadow.update(renderer, model, alt, sunDir)   after the model is posed, before the frame renders
   ========================================================================= */
Object.assign(TUNE, { SHADOW_SUN: 1 });
if (typeof TUNE_DEFAULTS !== 'undefined') Object.assign(TUNE_DEFAULTS, { SHADOW_SUN: 1 });
const PlaneShadow = (() => {
  const SIZE = 256, CAM_D = 60;
  const MAX_D = 240;                                        // no shadow this far from the plane along the light
  const U = {
    psView: { value: new THREE.Matrix4() },
    psK: { value: new THREE.Vector4(10, CAM_D, 0, 0.08) },  // half size (m), camera distance, strength, texel (m)
    psTex: { value: null },
  };
  let rt = null;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 100);
  const dir = new THREE.Vector3(), _down = new THREE.Vector3(0, 1, 0), _c = new THREE.Color(), _box = new THREE.Box3();
  const radii = new WeakMap();                              // model -> bounding radius about its origin

  const VERT = `
  vec4 psW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    psW = instanceMatrix * psW;
  #endif
  psW = psView * ( modelMatrix * psW );
  vPs = vec3( psW.xy / psK.x * 0.5 + 0.5, -psW.z - psK.y );`;
  const FRAG_FN = `uniform sampler2D psTex;
uniform vec4 psK;
varying vec3 vPs;
float psTap( vec2 uv, float lod ) {
#if __VERSION__ >= 300
  return textureLod( psTex, uv, lod ).a;
#else
  return texture2D( psTex, uv, lod ).a;
#endif
}
float psShadow() {
  if ( psK.z <= 0.0 || vPs.z < 0.25 || vPs.x < 0.0 || vPs.y < 0.0 || vPs.x > 1.0 || vPs.y > 1.0 ) return 0.0;
  float d = vPs.z, blur = 0.05 + d * 0.02;               // penumbra (m): the sun's disc, exaggerated a little
  float lod = log2( max( blur / psK.w, 1.0 ) ), o = 0.3 * blur / ( 2.0 * psK.x );
  float a = 0.25 * ( psTap( vPs.xy + vec2( o, o * 0.4 ), lod ) + psTap( vPs.xy + vec2( -o * 0.4, o ), lod )
                   + psTap( vPs.xy + vec2( -o, -o * 0.4 ), lod ) + psTap( vPs.xy + vec2( o * 0.4, -o ), lod ) );
  return a * psK.z * ( 1.0 - smoothstep( 25.0, ${MAX_D.toFixed(1)}, d ) );
}
`;
  function inject(sh) {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform mat4 psView;\nuniform vec4 psK;\nvarying vec3 vPs;\n' +
      sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>' + VERT);
    sh.fragmentShader = FRAG_FN + sh.fragmentShader.replace(/\* sunAOv\.x;/, '* min( sunAOv.x, 1.0 - psShadow() );');
  }
  // every lit scenery material gets the hook (js/sunlight.js only patches lit ones; the rest ignore it)
  SCENERY_PLUGINS.push((group) => group.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const hooks = m.userData.sunHooks || (m.userData.sunHooks = []);
      if (!hooks.some((h) => h.key === 'planeShadow')) hooks.push({ key: 'planeShadow', fn: inject });
    }
  }));

  function radiusOf(model) {
    let r = radii.get(model);
    if (r) return r;
    const g = model.group, q = g.quaternion.clone(), p = g.position.clone(), s = g.scale.clone();
    g.position.set(0, 0, 0); g.quaternion.identity(); g.scale.set(1, 1, 1); g.updateMatrixWorld(true);
    _box.setFromObject(g);
    r = Math.max(_box.min.length(), _box.max.length()) * 1.04;
    g.position.copy(p); g.quaternion.copy(q); g.scale.copy(s); g.updateMatrixWorld(true);
    radii.set(model, r);
    return r;
  }

  function update(renderer, model, alt, sunDir) {
    const g = model && model.group, k = U.psK.value;
    const mix = TUNE.SHADOW_SUN == null ? 1 : TUNE.SHADOW_SUN;
    dir.copy(_down).lerp(sunDir, mix).normalize();
    if (!g || !g.visible || alt / Math.max(dir.y, 0.2) > MAX_D) { k.z = 0; return; }
    if (!rt) {
      rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
      U.psTex.value = rt.texture;
    }
    const r = radiusOf(model) * g.scale.x;
    cam.left = cam.bottom = -r; cam.right = cam.top = r;
    cam.near = CAM_D - r - 1; cam.far = CAM_D + r + 1;
    cam.position.copy(g.position).addScaledVector(dir, CAM_D);
    cam.up.set(0, 0, -1);
    cam.lookAt(g.position);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    U.psView.value.copy(cam.matrixWorldInverse);
    k.set(r, CAM_D, 0.82, 2 * r / SIZE);
    // draw the plane on its own (alpha only matters); the scene's clear colour and target come back after
    const prevRT = renderer.getRenderTarget(), prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(_c);
    const hidden = [];
    g.traverse((o) => { if (o.userData.noShadow && o.visible) { o.visible = false; hidden.push(o); } });
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear();
    g.updateMatrixWorld();
    renderer.render(g, cam);
    for (const o of hidden) o.visible = true;
    renderer.setRenderTarget(prevRT); renderer.setClearColor(_c, prevAlpha);
  }

  return { update, uniforms: U };
})();
