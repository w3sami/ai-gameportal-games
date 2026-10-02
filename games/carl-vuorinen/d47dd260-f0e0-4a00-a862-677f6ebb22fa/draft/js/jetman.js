'use strict';
/* =========================================================================
   JETMAN — the Cityscape theme's flyer (vehicle 'jetwing'), built with js/airframe.js.
   A pilot lying belly down, arms along his sides and legs together, with a rigid carbon wing strapped to his back:
   about 2 m across, swept, with turned-down tips, and four small jet turbines slung under it, two each side.
   Black suit, white helmet with a reflective visor; the wing dark carbon with an orange chevron and white tips.
   The exhaust lights up with the jets' spool (P.tuck, see js/jetwing.js), so replays and ghosts show it too: a hot
   ring at each nozzle and a short flickering plume behind it.
   Nose (head) along -Z; wingtips at about ±1.02 m.
   makeJetwingModel(scene, shading?) -> { group, tips, update(dt, P), tris, uniforms }
   ========================================================================= */
function makeJetwingModel(scene, shading) {
  const V3 = THREE.Vector3, AF = Airframe;
  const BLACK = '#1d2126', DARK = '#2c333b', CARBON = '#24282d', ORANGE = '#ff6a1a', WHITE = '#f1efe8', GREY = '#8d959c', STEEL = '#5d646b';
  const A = AF.createAtlas(512);
  const R = {
    torso: A.region(8, 8, 252, 136, -0.74, 0.12, 0, 1),
    helmet: A.region(260, 8, 504, 136, -0.15, 0.15, 0, 1),
    wingT: A.region(8, 144, 504, 264, 0, 1.05, 0, 1),        // a = span from the centre, b = chord fraction
    wingB: A.region(8, 272, 504, 360, 0, 1.05, 0, 1),
    black: A.solid(8, 400, BLACK), dark: A.solid(32, 400, DARK), grey: A.solid(56, 400, GREY), steel: A.solid(80, 400, STEEL),
    white: A.solid(104, 400, WHITE), orange: A.solid(128, 400, ORANGE), soot: A.solid(152, 400, '#121416'),
  };
  const M = AF.createModel(), body = M.part(), glass = M.part({ mat: 'glass' });

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
    AF.tube(M, body, new V3(s * 0.2, 0.0, -0.5), new V3(s * 0.23, -0.02, -0.22), 0.058, 0.05, { region: R.dark, seg: 8 });     // upper arm
    AF.tube(M, body, new V3(s * 0.23, -0.02, -0.22), new V3(s * 0.21, -0.03, 0.04), 0.048, 0.04, { region: R.dark, seg: 8 });   // forearm
    AF.ellipsoid(M, body, new V3(s * 0.2, -0.035, 0.09), new V3(0.035, 0.03, 0.055), { region: R.black, seg: 8, rings: 4 });
    AF.tube(M, body, new V3(s * 0.09, -0.01, 0.08), new V3(s * 0.11, -0.03, 0.5), 0.075, 0.058, { region: R.black, seg: 8, flat: 0.8 });   // thigh
    AF.tube(M, body, new V3(s * 0.11, -0.03, 0.5), new V3(s * 0.1, 0.0, 0.9), 0.055, 0.04, { region: R.black, seg: 8, flat: 0.8 });       // shin, knee a little bent
    AF.ellipsoid(M, body, new V3(s * 0.1, 0.0, 0.97), new V3(0.04, 0.034, 0.08), { region: R.dark, seg: 8, rings: 5 });                  // boot
  }
  // harness plate between the back and the wing
  AF.loft(M, body, [
    { z: -0.5, w: 0.1, t: 0.03, b: 0.02, y: 0.13, p: 3 }, { z: -0.44, w: 0.15, t: 0.05, b: 0.02, y: 0.14, p: 3.5 },
    { z: -0.08, w: 0.15, t: 0.05, b: 0.02, y: 0.13, p: 3.5 }, { z: -0.02, w: 0.1, t: 0.03, b: 0.02, y: 0.12, p: 3 },
  ], { seg: 12, region: R.steel });

  /* ---- the wing: swept, thin, tips turned down ---- */
  const wingSt = [
    { s: 0, c: 0.74, le: -0.5, t: 0.09 }, { s: 0.15, c: 0.7, le: -0.46, t: 0.085 }, { s: 0.35, c: 0.6, le: -0.38, t: 0.08 },
    { s: 0.6, c: 0.48, le: -0.27, t: 0.075 }, { s: 0.85, c: 0.36, le: -0.16, t: 0.07 }, { s: 0.96, c: 0.3, le: -0.11, t: 0.07, y: -0.03 },
    { s: 1.02, c: 0.24, le: -0.07, t: 0.06, y: -0.09 },
  ];
  const WING_Y = 0.2;
  for (const s of [-1, 1]) AF.wing(M, body, { root: new V3(0, WING_Y, 0), side: s, dihedral: 0.03, stations: wingSt, camber: 0.02, top: R.wingT, bottom: R.wingB });
  // four turbines on short pylons under the wing: intake lip, casing, nozzle cone
  const ENG = [];
  for (const s of [-1, 1]) for (const sp of [0.36, 0.64]) {
    const st = AF.stationAt(wingSt, sp), x = s * sp, y = WING_Y - 0.12, z0 = st.le + 0.04, z1 = z0 + 0.5;
    AF.tube(M, body, new V3(x, WING_Y - 0.03, z0 + 0.15), new V3(x, y + 0.04, z0 + 0.22), 0.02, 0.02, { region: R.steel, seg: 6 });   // pylon
    AF.tube(M, body, new V3(x, y, z0), new V3(x, y, z0 + 0.04), 0.068, 0.072, { region: R.grey, seg: 12 });
    AF.tube(M, body, new V3(x, y, z0 + 0.04), new V3(x, y, z1 - 0.1), 0.072, 0.07, { region: R.steel, seg: 12 });
    AF.tube(M, body, new V3(x, y, z1 - 0.1), new V3(x, y, z1), 0.066, 0.05, { region: R.soot, seg: 12 });
    ENG.push(new V3(x, y, z1));
  }

  /* ---- livery ---- */
  const map = A.texture((ctx, on) => {
    const P = AF.poly;
    on(R.torso, BLACK, (c) => {
      const mirror = (pts, col) => { P(c, pts, col); P(c, pts.map(([a, b]) => [a, 1 - b]), col); };
      mirror([[-0.6, 0.2], [0.12, 0.24], [0.12, 0.28], [-0.6, 0.24]], ORANGE);                       // side seams
      P(c, [[-0.58, 0.4], [-0.58, 0.6], [-0.5, 0.6], [-0.5, 0.4]], DARK);                            // chest panel
    });
    on(R.helmet, WHITE, (c) => {
      P(c, [[-0.2, -0.01], [0.2, -0.01], [0.2, 0.06], [-0.2, 0.06]], ORANGE);
      P(c, [[-0.2, 0.94], [0.2, 0.94], [0.2, 1.01], [-0.2, 1.01]], ORANGE);
    });
    on(R.wingT, CARBON, (c, r) => {
      P(c, [[0, 0.04], [0.55, 0.3], [0.55, 0.46], [0, 0.2]], ORANGE);                                 // chevron, point forward
      P(c, [[0.88, -0.1], [1.1, -0.1], [1.1, 1.1], [0.88, 1.1]], WHITE);                              // tips
      P(c, [[0.84, -0.1], [0.88, -0.1], [0.88, 1.1], [0.84, 1.1]], ORANGE);
      for (let x = 0.1; x < 0.84; x += 0.12) AF.line(c, r, x, 0.02, x, 0.98, 'rgba(255,255,255,0.05)', 1);   // carbon weave hint
    });
    on(R.wingB, '#3a3f45', (c) => {
      P(c, [[0.88, -0.1], [1.1, -0.1], [1.1, 1.1], [0.88, 1.1]], WHITE);
      P(c, [[0.2, 0.55], [0.7, 0.55], [0.7, 0.68], [0.2, 0.68]], ORANGE);
    });
  });

  const B = AF.build(M, { map, shading, glass: '#1e2a36' });
  const g = B.group;

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

  let t = 0;
  return {
    group: g, tris: B.tris, uniforms: B.U, shadow: 0.3, trails: false,   // no vapour: on the jets it would trail all the time
    tips: [new V3(-1.02, WING_Y - 0.09, -0.07 + 0.12), new V3(1.02, WING_Y - 0.09, -0.07 + 0.12)],
    update(dt, P) {
      t += dt;
      const T = clamp(P.tuck || 0, 0, 1), on = T > 0.01;
      // each mesh's own material: a ghost (js/game.js) swaps in a see-through copy per mesh, drawn at half strength
      const k = plumes[0].p.material === plumeMat ? 1 : 0.5;
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
