'use strict';
/* =========================================================================
   JETMAN — the Cityscape theme's flyer (vehicle 'jetwing'), built with js/airframe.js.
   A pilot lying belly down, arms along his sides and legs together, with a rigid carbon wing strapped to his back:
   about 1.6 m across, swept, with turned-down tips, and two small jet turbines slung under it, one each side.
   Light colours so it reads against the dark of a dusk city: a white suit with orange panels, an orange helmet with
   a white stripe and a dark visor; a white wing with an orange leading edge, chevron and tips, dark pinstripes and a
   carbon trailing edge; silver turbines with orange intakes; a white strobe.
   The exhaust lights up with the jets' spool (P.tuck, see js/jetwing.js), so replays and ghosts show it too: a hot
   ring at each nozzle and a short flickering plume behind it.
   Nose (head) along -Z; wingtips at about ±0.82 m.
   makeJetwingModel(scene, shading?) -> { group, tips, update(dt, P), tris, uniforms }
   ========================================================================= */
function makeJetwingModel(scene, shading) {
  const V3 = THREE.Vector3, AF = Airframe;
  const BLACK = '#1d2126', DARK = '#2c333b', CARBON = '#2a2e33', ORANGE = '#ff6a1a', WHITE = '#f4f2ec', GREY = '#c3c8cc', STEEL = '#9aa1a7', SUIT = '#eceae4';
  const A = AF.createAtlas(512);
  const R = {
    torso: A.region(8, 8, 252, 136, -0.74, 0.12, 0, 1),
    helmet: A.region(260, 8, 504, 136, -0.15, 0.15, 0, 1),
    wingT: A.region(8, 144, 504, 264, 0, 0.84, 0, 1),        // a = span from the centre, b = chord fraction
    wingB: A.region(8, 272, 504, 360, 0, 0.84, 0, 1),
    black: A.solid(8, 400, BLACK), dark: A.solid(32, 400, DARK), grey: A.solid(56, 400, GREY), steel: A.solid(80, 400, STEEL),
    white: A.solid(104, 400, WHITE), orange: A.solid(128, 400, ORANGE), soot: A.solid(152, 400, '#121416'),
    leg: A.region(8, 424, 252, 504, 0, 0.45, 0, 1),         // a tube's own length (from its first end), b round it
    arm: A.region(260, 424, 380, 504, 0, 0.3, 0, 1),
    eng: A.region(388, 424, 504, 504, 0, 0.36, 0, 1),
    strobe: A.solid(224, 400, '#ffffff'),
  };
  const M = AF.createModel(), body = M.part(), glass = M.part({ mat: 'glass' }), flash = M.part({ glow: 2 });

  /* ---- pilot: torso, helmet, arms along the sides, legs together ---- */
  AF.loft(M, body, [
    { z: -0.7, w: 0.06, t: 0.05, b: 0.05, y: 0.02, p: 2 },
    { z: -0.64, w: 0.14, t: 0.08, b: 0.07, y: 0.02, p: 2.2 },
    { z: -0.56, w: 0.21, t: 0.1, b: 0.095, p: 2.5 },
    { z: -0.42, w: 0.2, t: 0.115, b: 0.11, p: 2.7 },
    { z: -0.26, w: 0.175, t: 0.105, b: 0.105, p: 2.7 },
    { z: -0.1, w: 0.16, t: 0.1, b: 0.1, p: 2.6 },
    { z: 0.04, w: 0.17, t: 0.1, b: 0.095, p: 2.6 },
    { z: 0.12, w: 0.13, t: 0.075, b: 0.08, p: 2.4 },
  ], { seg: 14, region: R.torso });
  AF.ellipsoid(M, body, new V3(0, 0.07, -0.79), new V3(0.12, 0.125, 0.14), { region: R.helmet, seg: 14, rings: 8 });
  AF.ellipsoid(M, glass, new V3(0, 0.03, -0.865), new V3(0.1, 0.075, 0.085), { seg: 12, rings: 6 });
  for (const s of [-1, 1]) {
    AF.tube(M, body, new V3(s * 0.2, 0.0, -0.5), new V3(s * 0.23, -0.02, -0.22), 0.058, 0.05, { region: R.arm, seg: 8 });      // upper arm
    AF.tube(M, body, new V3(s * 0.23, -0.02, -0.22), new V3(s * 0.21, -0.03, 0.04), 0.048, 0.04, { region: R.arm, seg: 8 });    // forearm
    AF.ellipsoid(M, body, new V3(s * 0.2, -0.035, 0.09), new V3(0.035, 0.03, 0.055), { region: R.dark, seg: 8, rings: 4 });     // glove
    AF.tube(M, body, new V3(s * 0.09, -0.01, 0.08), new V3(s * 0.11, -0.03, 0.5), 0.075, 0.058, { region: R.leg, seg: 8, flat: 0.8 });   // thigh
    AF.tube(M, body, new V3(s * 0.11, -0.03, 0.5), new V3(s * 0.1, 0.0, 0.9), 0.055, 0.04, { region: R.leg, seg: 8, flat: 0.8 });       // shin, knee a little bent
    AF.ellipsoid(M, body, new V3(s * 0.1, 0.0, 0.97), new V3(0.04, 0.034, 0.08), { region: R.orange, seg: 8, rings: 5 });               // boot
  }
  // harness plate between the back and the wing
  AF.loft(M, body, [
    { z: -0.5, w: 0.1, t: 0.03, b: 0.02, y: 0.13, p: 3 }, { z: -0.44, w: 0.15, t: 0.05, b: 0.02, y: 0.14, p: 3.5 },
    { z: -0.08, w: 0.15, t: 0.05, b: 0.02, y: 0.13, p: 3.5 }, { z: -0.02, w: 0.1, t: 0.03, b: 0.02, y: 0.12, p: 3 },
  ], { seg: 12, region: R.dark });

  /* ---- the wing: swept, thin, tips turned down ---- */
  const wingSt = [
    { s: 0, c: 0.651, le: -0.44, t: 0.079 }, { s: 0.12, c: 0.616, le: -0.405, t: 0.075 }, { s: 0.28, c: 0.528, le: -0.334, t: 0.07 },
    { s: 0.48, c: 0.422, le: -0.238, t: 0.066 }, { s: 0.68, c: 0.317, le: -0.141, t: 0.062 }, { s: 0.768, c: 0.264, le: -0.097, t: 0.062, y: -0.03 },
    { s: 0.816, c: 0.211, le: -0.062, t: 0.053, y: -0.09 },
  ];
  const WING_Y = 0.2;
  for (const s of [-1, 1]) AF.wing(M, body, { root: new V3(0, WING_Y, 0), side: s, dihedral: 0.03, stations: wingSt, camber: 0.02, top: R.wingT, bottom: R.wingB });
  // two turbines on short pylons under the wing: intake lip, casing, nozzle cone
  const ENG = [];
  for (const s of [-1, 1]) for (const sp of [0.42]) {                // one turbine under each wing
    const st = AF.stationAt(wingSt, sp), x = s * sp, y = WING_Y - 0.12, z0 = st.le + 0.04, z1 = z0 + 0.5;
    AF.tube(M, body, new V3(x, WING_Y - 0.03, z0 + 0.15), new V3(x, y + 0.04, z0 + 0.22), 0.02, 0.02, { region: R.steel, seg: 6 });   // pylon
    AF.tube(M, body, new V3(x, y, z0), new V3(x, y, z0 + 0.04), 0.068, 0.072, { region: R.orange, seg: 12 });   // intake lip
    AF.tube(M, body, new V3(x, y, z0 + 0.04), new V3(x, y, z1 - 0.1), 0.072, 0.07, { region: R.eng, seg: 12 });
    AF.tube(M, body, new V3(x, y, z1 - 0.1), new V3(x, y, z1), 0.066, 0.05, { region: R.soot, seg: 12 });
    ENG.push(new V3(x, y, z1));
  }
  // light: a white strobe on the back of the harness
  AF.ellipsoid(M, flash, new V3(0, WING_Y + 0.07, 0.18), new V3(0.025, 0.02, 0.03), { region: R.strobe, seg: 6, rings: 3 });

  /* ---- livery ---- */
  const map = A.texture((ctx, on) => {
    const P = AF.poly;
    const band = (c, a0, a1, b0, b1, col) => P(c, [[a0, b0], [a1, b0], [a1, b1], [a0, b1]], col);
    on(R.torso, SUIT, (c) => {                              // b: 0 the back, 0.25 / 0.75 the sides, 0.5 the chest
      band(c, -0.8, -0.5, -0.1, 1.1, ORANGE);                                                          // shoulder yoke
      band(c, -0.5, 0.15, 0.2, 0.3, ORANGE); band(c, -0.5, 0.15, 0.7, 0.8, ORANGE);                    // side panels
      band(c, -0.5, 0.15, 0.3, 0.32, DARK); band(c, -0.5, 0.15, 0.68, 0.7, DARK);                      // their piping
      band(c, -0.02, 0.04, -0.1, 1.1, DARK);                                                           // belt
      band(c, -0.42, -0.1, 0.44, 0.56, '#d9d6cf');                                                     // chest pad
    });
    on(R.helmet, ORANGE, (c) => {
      band(c, -0.2, 0.2, -0.05, 0.06, WHITE); band(c, -0.2, 0.2, 0.94, 1.05, WHITE);                  // white crown stripe
      band(c, -0.2, 0.2, 0.06, 0.08, DARK); band(c, -0.2, 0.2, 0.92, 0.94, DARK);
      band(c, 0.09, 0.2, -0.05, 1.05, DARK);                                                           // neck ring
    });
    on(R.leg, SUIT, (c) => {
      band(c, 0, 0.45, 0.22, 0.3, ORANGE); band(c, 0, 0.45, 0.7, 0.78, ORANGE);                        // side stripes
      band(c, 0.37, 0.45, -0.1, 1.1, ORANGE);                                                          // knee / ankle cuff
    });
    on(R.arm, SUIT, (c) => {
      band(c, 0, 0.3, 0.22, 0.3, ORANGE); band(c, 0, 0.3, 0.7, 0.78, ORANGE);
      band(c, 0.24, 0.3, -0.1, 1.1, DARK);                                                             // cuff
    });
    on(R.eng, '#d6dade', (c) => {
      band(c, 0.02, 0.05, -0.1, 1.1, DARK);                                                            // seams
      band(c, 0.2, 0.23, -0.1, 1.1, DARK);
      band(c, 0.23, 0.36, 0.4, 0.6, ORANGE);                                                           // warning flash
    });
    on(R.wingT, WHITE, (c, r) => {                          // a: span from the centre, b: 0 at the leading edge .. 1 trailing
      P(c, [[-0.08, -0.1], [0.88, -0.1], [0.88, 0.1], [-0.08, 0.07]], ORANGE);                             // leading edge
      P(c, [[0, 0.22], [0.496, 0.42], [0.496, 0.6], [0, 0.42]], ORANGE);                                 // chevron, point forward
      P(c, [[0, 0.2], [0.496, 0.4], [0.496, 0.42], [0, 0.22]], DARK); P(c, [[0, 0.42], [0.496, 0.6], [0.496, 0.62], [0, 0.44]], DARK);   // its pinstripes
      band(c, 0.688, 0.88, -0.1, 1.1, ORANGE);                                                           // tips
      band(c, 0.656, 0.688, -0.1, 1.1, DARK);
      band(c, -0.08, 0.88, 0.88, 1.1, CARBON);                                                           // carbon trailing edge
      for (let x = 0.53; x < 0.64; x += 0.04) band(c, x, x + 0.014, 0.5, 0.82, DARK);                   // vent slots
    });
    on(R.wingB, '#dcdcd8', (c) => {
      band(c, -0.08, 0.88, -0.1, 0.12, ORANGE);
      band(c, 0.688, 0.88, -0.1, 1.1, ORANGE);
      band(c, 0.12, 0.6, 0.45, 0.58, ORANGE);
      band(c, -0.08, 0.88, 0.88, 1.1, CARBON);
    });
  });

  const B = AF.build(M, { map, shading, glass: '#141c26' });
  const g = B.group;
  // reads in the dark: with the sun this low a wing's top gets little direct light, so the livery lights itself a
  // little (its own texture as a dim emissive map) and the rim is stronger, to set it off against shaded facades
  for (const o of g.children) if (o.material && o.material.map) { o.material.emissive.set('#5a5a5a'); o.material.emissiveMap = o.material.map; }
  B.U.afRim.value = 0.26;

  /* ---- exhaust: a hot ring at each nozzle and a plume behind it, additive, sized and lit by the spool ---- */
  const plumeTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 64;
    const x = cv.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,200,140,0.75)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 4, 64);
    return new THREE.CanvasTexture(cv);
  })();
  // a cone along +z from the nozzle, its texture running from the root (v = 1 at the base) to the tip
  const plumeGeo = new THREE.ConeGeometry(1, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  { const uv = plumeGeo.attributes.uv, p = plumeGeo.attributes.position; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - p.getZ(i)); }
  const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, side: THREE.DoubleSide };
  const plumeMat = new THREE.MeshBasicMaterial(Object.assign({ map: plumeTex, color: '#ffb070', opacity: 0 }, add));
  const coreMat = new THREE.MeshBasicMaterial(Object.assign({ map: plumeTex, color: '#fff2d8', opacity: 0 }, add));
  const ringMat = new THREE.MeshBasicMaterial(Object.assign({ color: '#ff8a3a', opacity: 0 }, add));
  const ringGeo = new THREE.CircleGeometry(0.048, 12);
  const plumes = ENG.map((e) => {
    const p = new THREE.Mesh(plumeGeo, plumeMat), c = new THREE.Mesh(plumeGeo, coreMat), r = new THREE.Mesh(ringGeo, ringMat);
    for (const m of [p, c, r]) { m.position.copy(e); m.renderOrder = 2; g.add(m); }
    r.position.z += 0.002;
    return { p, c, r };
  });
  if (scene) scene.add(g);

  /* ---- wingtip trails while the jets burn: two thin ribbons turned to the camera, fading over TRAIL_LIFE s ---- */
  const TIPS = [new V3(-0.816, WING_Y - 0.09, 0.03), new V3(0.816, WING_Y - 0.09, 0.03)], TRAIL_LIFE = 0.2, TRAIL_MAX = 16;
  const trailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
  trailMat.userData.noSun = true;
  const _a = new V3(), _d = new V3(), _s = new V3(), _c = new V3();
  const tipTrails = TIPS.map(() => {
    const pos = new Float32Array(TRAIL_MAX * 6), col = new Float32Array(TRAIL_MAX * 8), idx = [];
    for (let i = 0; i < TRAIL_MAX - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx); geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, trailMat); mesh.frustumCulled = false; mesh.renderOrder = 2;
    const tr = { pts: [], pos, col, geo, mesh, last: -1 };
    mesh.onBeforeRender = (renderer, sc, camera) => {       // the ribbon, square to the view, thin at the tip and widening a little
      const n = tr.pts.length;
      for (let i = 0; i < n; i++) {
        const q = tr.pts[i], lo = tr.pts[Math.max(0, i - 1)], hi = tr.pts[Math.min(n - 1, i + 1)];
        _d.copy(lo.p).sub(hi.p); if (_d.lengthSq() < 1e-8) _d.set(0, 0, 1);
        _s.crossVectors(_c.copy(camera.position).sub(q.p), _d).normalize();
        // (faded out where it nears the camera: the chase camera flies in the trail's wake, and close by it'd be a streak)
        const age = (t - q.t) / TRAIL_LIFE, w = 0.02 + age * 0.03, near = smoothstep(3, 7, _c.length()), al = q.a * (1 - age) * (1 - age) * 0.9 * near, o = i * 6;
        pos[o] = q.p.x + _s.x * w; pos[o + 1] = q.p.y + _s.y * w; pos[o + 2] = q.p.z + _s.z * w;
        pos[o + 3] = q.p.x - _s.x * w; pos[o + 4] = q.p.y - _s.y * w; pos[o + 5] = q.p.z - _s.z * w;
        col.fill(1, i * 8, i * 8 + 8); col[i * 8 + 3] = al; col[i * 8 + 7] = al;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
    };
    if (scene) scene.add(mesh);
    return tr;
  });
  function updateTrails(T) {
    for (let k = 0; k < 2; k++) {
      const tr = tipTrails[k];
      while (tr.pts.length && t - tr.pts[tr.pts.length - 1].t > TRAIL_LIFE) tr.pts.pop();
      if (!g.visible) { tr.pts.length = 0; continue; }
      if (T < 0.05 && !tr.pts.length) continue;
      _a.copy(TIPS[k]).applyQuaternion(g.quaternion).add(g.position);   // (the game has just placed the group)
      if (tr.pts.length && t - tr.last < 1 / 60) { tr.pts[0].p.copy(_a); tr.pts[0].t = t; tr.pts[0].a = T; continue; }   // the head follows the tip
      tr.pts.unshift({ p: _a.clone(), t, a: T }); tr.last = t;
      if (tr.pts.length > TRAIL_MAX) tr.pts.length = TRAIL_MAX;
    }
  }

  let t = 0;
  return {
    group: g, tris: B.tris, uniforms: B.U, shadow: 0.3, trails: false,   // (its own thin wingtip trails below; the game's vapour is too broad for this wing)
    tips: [new V3(-0.816, WING_Y - 0.09, 0.03), new V3(0.816, WING_Y - 0.09, 0.03)],
    update(dt, P) {
      t += dt;
      const T = clamp(P.tuck || 0, 0, 1), on = T > 0.01;
      // each mesh's own material: a ghost (js/game.js) swaps in a see-through copy per mesh, drawn at half strength
      const k = plumes[0].p.material === plumeMat ? 1 : 0.5;
      updateTrails(k === 1 ? T : 0);                         // (a ghost leaves none)
      plumes.forEach((pl, i) => {
        pl.p.material.opacity = 0.55 * T * k; pl.c.material.opacity = 0.8 * T * k; pl.r.material.opacity = Math.min(1, 0.3 + T) * k;
        const f = 1 + 0.12 * Math.sin(t * 61 + i * 1.7) + 0.08 * Math.sin(t * 37 + i * 2.9);
        pl.p.visible = pl.c.visible = on;
        pl.p.scale.set(0.06, 0.06, (0.35 + 0.95 * T) * f);
        pl.c.scale.set(0.035, 0.035, (0.2 + 0.45 * T) * f);
      });
    },
  };
}
