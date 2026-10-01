'use strict';
/* =========================================================================
   FIGHTER JET — the Mountain theme's jet (vehicle 'jet'), built with js/airframe.js.
   Chined nose, bubble canopy, side intakes, double-delta wing (leading-edge root extensions into a cropped delta)
   with flaperons, all-moving stabilators, canted twin fins with rudders, ventral strakes, wingtip pods and a petal
   nozzle; the afterburner flame grows and flickers with shock diamonds while boosting.
   Two-tone grey with orange fins and tips. Nose along -Z; wing tips at ±5.6 m.
   makeFighterModel(scene, shading?) -> { group, tips, update(dt, P), tris, uniforms }
   ========================================================================= */
function makeFighterModel(scene, shading) {
  const V3 = THREE.Vector3, AF = Airframe;
  const GREY = '#9ba5ae', GREY_L = '#c3cad0', GREY_D = '#6f7a84', ORANGE = '#ff5a1f', WHITE = '#eef0ee', DARK = '#2a333c';
  const A = AF.createAtlas(512);
  const R = {
    fus: A.region(8, 8, 504, 168, -8.7, 7.3, 0, 1),         // a = z, b = angle from the top round the right side
    intake: A.region(8, 176, 252, 236, -3.4, 2.6, 0, 1),
    wingT: A.region(8, 244, 252, 340, 0, 5.75, 0, 1), wingB: A.region(260, 244, 504, 340, 0, 5.75, 0, 1),
    stabT: A.region(8, 348, 168, 396, 0, 3.4, 0, 1), stabB: A.region(176, 348, 336, 396, 0, 3.4, 0, 1),
    fin: A.region(344, 348, 504, 420, 0, 2.75, 0, 1),       // a = height, b = chord fraction
    strake: A.region(8, 404, 120, 428, 0, 0.6, 0, 1),
    pod: A.region(128, 404, 336, 428, 1.5, 4.8, 0, 1),
    nozzle: A.region(8, 436, 252, 492, 5.9, 7.3, 0, 1),
    dark: A.solid(264, 440, DARK), inlet: A.solid(288, 440, '#151b21'), grey: A.solid(312, 440, GREY),
  };
  const M = AF.createModel(), body = M.part({ crease: 0.7 }), glass = M.part({ mat: 'glass' });

  /* ---- fuselage: chined radome, cockpit, spine, tapering to the nozzle ---- */
  AF.loft(M, body, [
    { z: -8.62, w: 0.0, t: 0.0, b: 0.0, y: -0.06, p: 2 },
    { z: -8.3, w: 0.15, t: 0.13, b: 0.12, y: -0.06, p: 2.1 },
    { z: -7.5, w: 0.4, t: 0.33, b: 0.3, y: -0.05, p: 2.4 },
    { z: -6.5, w: 0.6, t: 0.47, b: 0.42, y: -0.04, p: 2.7 },
    { z: -5.4, w: 0.72, t: 0.58, b: 0.5, y: -0.03, p: 3.0 },
    { z: -4.2, w: 0.77, t: 0.66, b: 0.56, p: 3.2 },
    { z: -2.8, w: 0.8, t: 0.74, b: 0.62, p: 3.4 },
    { z: -1.0, w: 0.82, t: 0.8, b: 0.66, p: 3.6 },
    { z: 1.4, w: 0.82, t: 0.76, b: 0.68, p: 3.6 },
    { z: 3.6, w: 0.78, t: 0.66, b: 0.64, p: 3.3 },
    { z: 5.2, w: 0.7, t: 0.58, b: 0.58, p: 2.8 },
    { z: 6.1, w: 0.63, t: 0.58, b: 0.58, p: 2.3 },
  ], { seg: 16, region: R.fus });
  // nozzle: convergent petals, dark inside
  AF.loft(M, body, [
    { z: 6.05, w: 0.6, t: 0.6, b: 0.6, p: 2 }, { z: 6.45, w: 0.64, t: 0.64, b: 0.64, p: 2 },
    { z: 7.15, w: 0.55, t: 0.55, b: 0.55, p: 2 },
  ], { seg: 16, region: R.nozzle, capRegion: R.inlet });
  // canopy, and the windscreen bow
  AF.loft(M, glass, [
    { z: -6.15, w: 0.2, t: 0.02, b: 0.2, y: 0.42, p: 2 },
    { z: -5.6, w: 0.42, t: 0.26, b: 0.2, y: 0.44, p: 2 },
    { z: -4.8, w: 0.47, t: 0.48, b: 0.2, y: 0.46, p: 2.1 },
    { z: -3.9, w: 0.46, t: 0.5, b: 0.2, y: 0.48, p: 2.1 },
    { z: -3.0, w: 0.4, t: 0.38, b: 0.2, y: 0.52, p: 2 },
    { z: -2.2, w: 0.26, t: 0.14, b: 0.2, y: 0.6, p: 2 },
    { z: -1.6, w: 0.1, t: 0.02, b: 0.2, y: 0.66, p: 2 },
  ], { seg: 16 });
  AF.loft(M, body, [
    { z: -5.38, w: 0.445, t: 0.33, b: 0.2, y: 0.445, p: 2 }, { z: -5.28, w: 0.455, t: 0.36, b: 0.2, y: 0.45, p: 2 },
  ], { seg: 16, region: R.dark });
  // intakes: rounded boxes along the sides, open (dark) mouths, blending into the body aft
  for (const s of [-1, 1]) {
    const m = new THREE.Matrix4().makeTranslation(s * 0.92, -0.3, 0);
    AF.loft(M, body, [
      { z: -3.3, w: 0.36, t: 0.44, b: 0.44, p: 3.2 }, { z: -2.9, w: 0.38, t: 0.46, b: 0.46, p: 3.4 },
      { z: -0.5, w: 0.38, t: 0.46, b: 0.46, p: 3.4 }, { z: 1.6, w: 0.3, t: 0.4, b: 0.42, p: 3 },
      { z: 2.6, w: 0.12, t: 0.2, b: 0.3, p: 2.5 },
    ], { seg: 12, matrix: m, region: R.intake, capRegion: R.inlet });
  }

  /* ---- wing: LERX into a cropped 45° delta, slight anhedral, flaperons ---- */
  const wingSt = [
    { s: 0, c: 8.0, le: -3.9, t: 0.035 },
    { s: 0.95, c: 5.5, le: -1.4, t: 0.04 },
    { s: 1.35, c: 4.95, le: -0.8, t: 0.045 },
    { s: 5.3, c: 1.4, le: 2.55, t: 0.05 },
    { s: 5.6, c: 1.22, le: 2.72, t: 0.05 },
  ];
  for (const side of [-1, 1]) {
    AF.wing(M, body, { root: new V3(0, -0.28, 0), side, dihedral: -0.035, stations: wingSt, hinge: 0.8,
      surfaces: [{ from: 1.35, to: 4.7, ch: side < 0 ? 1 : 2 }], top: R.wingT, bottom: R.wingB, xs: [0, 0.03, 0.12, 0.3, 0.55, 0.8, 1] });
    // wingtip pod
    const tip = new V3(side * 5.66 * Math.cos(0.035), -0.28 - 5.66 * Math.sin(0.035), 0);
    AF.loft(M, body, [
      { z: 1.55, w: 0.0, t: 0.0, b: 0.0, p: 2 }, { z: 1.75, w: 0.06, t: 0.06, b: 0.06, p: 2 },
      { z: 2.2, w: 0.1, t: 0.1, b: 0.1, p: 2 }, { z: 4.4, w: 0.1, t: 0.1, b: 0.1, p: 2 }, { z: 4.75, w: 0.06, t: 0.06, b: 0.06, p: 2 },
    ], { seg: 8, matrix: new THREE.Matrix4().makeTranslation(tip.x, tip.y, tip.z), region: R.pod });
  }
  /* ---- all-moving stabilators (pivot at a third of the chord), with anhedral ---- */
  for (const side of [-1, 1]) {
    AF.wing(M, body, { root: new V3(0, -0.12, 0), side, dihedral: -0.1, hinge: 0, pivot: 0.32, top: R.stabT, bottom: R.stabB,
      stations: [{ s: 0.62, c: 2.25, le: 4.95, t: 0.045 }, { s: 3.05, c: 0.95, le: 6.6, t: 0.045 }, { s: 3.3, c: 0.8, le: 6.78, t: 0.04 }],
      surfaces: [{ from: 0.62, to: 3.3, ch: 3 }], xs: [0, 0.05, 0.2, 0.5, 0.8, 1] });
  }
  /* ---- canted twin fins with rudders; ventral strakes ---- */
  const CANT = 0.32;
  for (const side of [-1, 1]) {
    AF.wing(M, body, { root: new V3(side * 0.62, 0.42, 0), side, dihedral: Math.PI / 2 - CANT, hinge: 0.7, top: R.fin, bottom: R.fin,
      stations: [{ s: 0, c: 3.1, le: 3.5, t: 0.05 }, { s: 0.25, c: 2.85, le: 3.72, t: 0.05 }, { s: 2.45, c: 1.25, le: 5.85, t: 0.05 },
                 { s: 2.7, c: 1.0, le: 6.1, t: 0.045 }],
      surfaces: [{ from: 0.3, to: 2.45, ch: 4, sense: new V3(1, 0, 0) }], xs: [0, 0.05, 0.2, 0.45, 0.7, 1] });
    AF.wing(M, body, { root: new V3(side * 0.55, -0.42, 0), side, dihedral: -(Math.PI / 2 - 0.55), top: R.strake, bottom: R.strake,
      stations: [{ s: 0, c: 1.5, le: 4.3, t: 0.06 }, { s: 0.55, c: 0.75, le: 5.0, t: 0.06 }], xs: [0, 0.1, 0.4, 1] });
  }

  /* ---- livery ---- */
  const map = A.texture((ctx, on) => {
    const P = AF.poly, LINE = 'rgba(28,34,40,0.32)', LINE2 = 'rgba(28,34,40,0.18)';
    on(R.fus, GREY, (c, r) => {
      const mirror = (pts, col) => { P(c, pts, col); P(c, pts.map(([a, b]) => [a, 1 - b]), col); };
      P(c, [[-9, 0.3], [-9, 0.7], [8, 0.7], [8, 0.3]], GREY_L);                                       // light underside
      mirror([[-9, -0.01], [-9, 0.5], [-7.7, 0.5], [-7.7, -0.01]], GREY_D);                            // radome
      mirror([[-7.7, -0.01], [-7.7, 0.08], [-6.15, 0.06], [-6.15, -0.01]], DARK);                      // anti-glare
      mirror([[-1.5, -0.01], [6.2, -0.01], [6.2, 0.024], [-1.5, 0.024]], ORANGE);                      // spine stripe
      mirror([[5.6, -0.01], [7.3, -0.01], [7.3, 0.51], [5.6, 0.51]], '#5c636a');                       // hot section
      // panel lines: frames and longerons
      for (const z of [-7.7, -6.6, -2.6, -0.2, 2.2, 4.4, 5.6]) { AF.line(c, r, z, 0.04, z, 0.46, LINE); AF.line(c, r, z, 0.54, z, 0.96, LINE); }
      for (const b of [0.17, 0.83, 0.38, 0.62]) AF.line(c, r, -6.6, b, 5.6, b, LINE2);
      AF.line(c, r, -5.0, 0.12, -3.6, 0.12, LINE); AF.line(c, r, -5.0, 0.88, -3.6, 0.88, LINE);           // access panels
      AF.text(c, r, '07', -6.9, 0.27, 20, DARK, true, false);
      AF.text(c, r, '07', -6.9, 0.73, 20, DARK, false, true);
    });
    on(R.intake, GREY, (c, r) => {
      P(c, [[-3.5, 0.3], [-3.5, 0.7], [3, 0.7], [3, 0.3]], GREY_L);
      P(c, [[-3.5, 0], [-3.5, 1], [-3.05, 1], [-3.05, 0]], DARK);                                      // lip
      for (let k = 0; k < 4; k++) P(c, [[-2.85 + k * 0.28, 0.12], [-2.7 + k * 0.28, 0.12], [-2.55 + k * 0.28, 0.22], [-2.7 + k * 0.28, 0.22]], k % 2 ? WHITE : ORANGE);
      AF.line(c, r, -0.5, 0, -0.5, 1, LINE);
    });
    on(R.wingT, GREY, (c, r) => {
      P(c, [[4.95, -1], [6, -1], [6, 2], [4.95, 2]], ORANGE);
      P(c, [[4.8, -1], [4.95, -1], [4.95, 2], [4.8, 2]], WHITE);
      P(c, [[1.35, 0.8], [1.35, 1.01], [4.7, 1.01], [4.7, 0.8]], '#8f99a2');
      AF.line(c, r, 1.35, 0.8, 4.7, 0.8, LINE); AF.line(c, r, 1.35, 0.8, 1.35, 1, LINE); AF.line(c, r, 4.7, 0.8, 4.7, 1, LINE);
      AF.line(c, r, 0.9, 0.35, 5.3, 0.35, LINE2); AF.line(c, r, 0.9, 0.12, 5.3, 0.12, LINE2);
    });
    on(R.wingB, GREY_L, (c, r) => { P(c, [[4.95, -1], [6, -1], [6, 2], [4.95, 2]], ORANGE); AF.line(c, r, 1.35, 0.8, 4.7, 0.8, LINE); });
    on(R.stabT, GREY, (c, r) => { P(c, [[2.7, -1], [3.5, -1], [3.5, 2], [2.7, 2]], ORANGE); AF.line(c, r, 0.62, 0.32, 3.3, 0.32, LINE2); });
    on(R.stabB, GREY_L, (c) => { P(c, [[2.7, -1], [3.5, -1], [3.5, 2], [2.7, 2]], ORANGE); });
    on(R.fin, GREY, (c, r) => {
      P(c, [[1.0, -1], [2.8, -1], [2.8, 2], [1.6, 2]], ORANGE);                                        // swept orange top
      P(c, [[0.88, -1], [1.0, -1], [1.6, 2], [1.48, 2]], WHITE);
      AF.line(c, r, 0.3, 0.7, 2.45, 0.7, LINE);
    });
    on(R.strake, GREY_L, null);
    on(R.pod, WHITE, (c) => { P(c, [[1.4, 0], [1.4, 1], [2.25, 1], [2.25, 0]], ORANGE); P(c, [[3.6, 0], [3.6, 1], [3.9, 1], [3.9, 0]], ORANGE); });
    on(R.nozzle, '#4a5158', (c) => {                                                                   // petals
      for (let k = 0; k < 16; k++) P(c, [[6.45, k / 16 + 0.01], [7.3, k / 16 + 0.01], [7.3, k / 16 + 0.035], [6.45, k / 16 + 0.035]], '#2f353b');
      P(c, [[5.8, 0], [6.45, 0], [6.45, 1], [5.8, 1]], '#666d74');
    });
  });

  const B = AF.build(M, { map, shading, glass: '#2a2a22' });
  const g = B.group;

  /* ---- afterburner: outer flame and white-hot core fading to the tip, glow inside the nozzle, shock diamonds ---- */
  const cone = (r, len, col, seg) => {
    const geo = new THREE.ConeGeometry(r, len, seg, 4, true).rotateX(Math.PI / 2).translate(0, 0, len / 2), p = geo.attributes.position;
    const c = new THREE.Color(col), cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const f = Math.pow(Math.max(0, 1 - p.getZ(i) / len), 1.4); cols[i * 3] = c.r * f; cols[i * 3 + 1] = c.g * f; cols[i * 3 + 2] = c.b * f; }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return geo;
  };
  const addMat = () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const flameMat = addMat(), coreMat = addMat();
  const flame = new THREE.Mesh(cone(0.5, 4, '#ff9a3c', 14), flameMat);   // base at the nozzle, tip aft
  const core = new THREE.Mesh(cone(0.3, 1.7, '#fff1c8', 12), coreMat);
  flame.position.z = core.position.z = 6.95; flame.userData.noShadow = core.userData.noShadow = true; g.add(flame, core);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ff8a3a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const nozzleGlow = new THREE.Mesh(new THREE.CircleGeometry(0.52, 16), glowMat);
  nozzleGlow.position.z = 7.14; nozzleGlow.userData.noShadow = true; g.add(nozzleGlow);
  const dGeo = [];
  for (let i = 0; i < 4; i++) dGeo.push(new THREE.OctahedronGeometry(1, 0).scale(0.26 - i * 0.04, 0.26 - i * 0.04, 0.42).translate(0, 0, 0.75 + i * 0.85));
  const diaGeo = new THREE.BufferGeometry();
  { const n = dGeo.reduce((a, q) => a + q.attributes.position.count, 0), pos = new Float32Array(n * 3); let o = 0;
    for (const q of dGeo) { pos.set(q.attributes.position.array, o); o += q.attributes.position.array.length; }
    diaGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); }
  const diaMat = new THREE.MeshBasicMaterial({ color: '#ffe6b0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const diamonds = new THREE.Mesh(diaGeo, diaMat);
  diamonds.position.z = 6.95; diamonds.userData.noShadow = true; g.add(diamonds);
  if (scene) scene.add(g);

  const U = B.U, defl = U.afDefl.value, MAXD = 0.35;
  let burn = 0, t = 0;
  return {
    group: g, tris: B.tris, uniforms: U,
    tips: [new V3(-5.62, -0.08, 3.6), new V3(5.62, -0.08, 3.6)],
    update(dt, P) {
      t += dt;
      burn += ((P.boosting ? 1 : 0) - burn) * (1 - Math.exp(-8 * dt));
      const w = 0.8 + 0.3 * burn;
      const fl = 1 + 0.15 * Math.sin(t * 60);
      flame.scale.set(w, w, 0.25 + burn * fl);
      core.scale.set(1, 1, 0.35 + 0.65 * burn * (2 - fl));
      flameMat.opacity = 0.3 + 0.6 * burn; coreMat.opacity = 0.25 + 0.75 * burn;
      glowMat.opacity = 0.15 + 0.7 * burn;
      diaMat.opacity = 0.5 * burn * (0.85 + 0.15 * Math.sin(t * 47));
      diamonds.visible = burn > 0.02;
      // flaperons roll, stabilators pitch, rudders yaw (positive = trailing edge down; rudders: trailing edge right)
      const k = 1 - Math.exp(-dt * 14), cl = (v) => Math.max(-1, Math.min(1, v));
      const r = cl((P.rr || 0) / TUNE.MAX_ROLL), p = cl((P.rp || 0) / TUNE.MAX_PITCH), y = cl((P.ry || 0) / TUNE.MAX_YAW);
      defl.x += (r * MAXD - defl.x) * k; defl.y += (-r * MAXD - defl.y) * k;
      defl.z += (-p * MAXD * 0.7 - defl.z) * k; defl.w += (y * MAXD - defl.w) * k;
    },
  };
}
