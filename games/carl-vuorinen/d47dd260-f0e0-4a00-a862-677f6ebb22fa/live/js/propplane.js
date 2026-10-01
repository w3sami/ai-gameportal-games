'use strict';
/* =========================================================================
   STUNT PLANE — the Valley's single-seat aerobatic monoplane (vehicle 'prop'), built with js/airframe.js.
   White fuselage with an orange cowl and cheat line, orange wings with white tips and undersides (so upright and
   inverted read differently), symmetric airfoil, bubble canopy, spatted taildragger gear and a two-blade prop. Ailerons, elevator and rudder follow the turn rates.
   Nose along -Z; wing tips at ±4.72 m (TUNE.WING_HALF).
   makePropPlaneModel(scene, shading?) -> { group, tips, update(dt, P), tris }
   ========================================================================= */
function makePropPlaneModel(scene, shading) {
  const V3 = THREE.Vector3, AF = Airframe;
  const ORANGE = '#ff5a1f', ORANGE_D = '#e24a14', WHITE = '#f3f1ea', DARK = '#27313b', GREY = '#b9bdbf', LIGHTGREY = '#dcdcd6';
  const A = AF.createAtlas(512);
  const R = {
    fus: A.region(8, 8, 504, 208, -4.45, 4.0, 0, 1),        // a = z, b = angle from the top round the right side
    wingT: A.region(8, 216, 504, 280, 0, 4.8, 0, 1),        // a = span, b = chord fraction
    wingB: A.region(8, 288, 504, 352, 0, 4.8, 0, 1),
    tailT: A.region(8, 360, 252, 408, 0, 1.85, 0, 1),
    tailB: A.region(260, 360, 504, 408, 0, 1.85, 0, 1),
    fin: A.region(8, 416, 252, 480, 0, 1.45, 0, 1),         // a = height, b = chord fraction
    dark: A.solid(264, 420, DARK), white: A.solid(288, 420, WHITE), grey: A.solid(312, 420, GREY),
    orange: A.solid(336, 420, ORANGE), spinner: A.region(264, 448, 504, 472, -4.45, -3.7, 0, 1),
  };
  const M = AF.createModel(), body = M.part(), body2 = M.part({ crease: 1.2 }), glass = M.part({ mat: 'glass' });

  /* ---- fuselage: round cowl, flat-sided cabin, turtledeck, tapering tail cone ---- */
  AF.loft(M, body, [
    { z: -3.75, w: 0.38, t: 0.36, b: 0.4, y: -0.02, p: 2.1 },
    { z: -3.6, w: 0.5, t: 0.48, b: 0.5, y: -0.02, p: 2.2 },
    { z: -3.3, w: 0.57, t: 0.56, b: 0.55, y: -0.02, p: 2.4 },
    { z: -2.8, w: 0.6, t: 0.6, b: 0.56, y: -0.01, p: 2.7 },
    { z: -2.3, w: 0.61, t: 0.63, b: 0.56, p: 2.9 },
    { z: -1.2, w: 0.6, t: 0.63, b: 0.55, p: 3.0 },
    { z: 0.0, w: 0.52, t: 0.6, b: 0.47, y: 0.02, p: 3.0 },
    { z: 1.2, w: 0.39, t: 0.5, b: 0.33, y: 0.06, p: 2.8 },
    { z: 2.4, w: 0.25, t: 0.4, b: 0.2, y: 0.12, p: 2.6 },
    { z: 3.4, w: 0.14, t: 0.3, b: 0.1, y: 0.18, p: 2.4 },
    { z: 3.95, w: 0.07, t: 0.2, b: 0.05, y: 0.21, p: 2.2 },
  ], { seg: 16, region: R.fus, capRegion: R.dark, bulge: 0.02 });
  // spinner
  AF.loft(M, body, [
    { z: -4.42, w: 0.0, t: 0.0, b: 0.0, p: 2 }, { z: -4.36, w: 0.08, t: 0.08, b: 0.08, p: 2 },
    { z: -4.2, w: 0.19, t: 0.19, b: 0.19, p: 2 }, { z: -3.98, w: 0.28, t: 0.28, b: 0.28, p: 2 },
    { z: -3.76, w: 0.31, t: 0.31, b: 0.31, p: 2 },
  ], { seg: 12, region: R.spinner });
  // bubble canopy (lower half buried in the fuselage)
  AF.loft(M, glass, [
    { z: -2.42, w: 0.36, t: 0.02, b: 0.2, y: 0.55, p: 2 },
    { z: -2.15, w: 0.46, t: 0.22, b: 0.2, y: 0.53, p: 2 },
    { z: -1.7, w: 0.52, t: 0.4, b: 0.2, y: 0.52, p: 2.1 },
    { z: -1.0, w: 0.53, t: 0.45, b: 0.2, y: 0.52, p: 2.2 },
    { z: -0.3, w: 0.49, t: 0.4, b: 0.2, y: 0.51, p: 2.1 },
    { z: 0.35, w: 0.38, t: 0.24, b: 0.2, y: 0.5, p: 2 },
    { z: 0.85, w: 0.2, t: 0.05, b: 0.2, y: 0.48, p: 2 },
  ], { seg: 16 });
  // canopy bow: a dark frame between the windscreen and the sliding hood
  AF.loft(M, body, [
    { z: -2.2, w: 0.475, t: 0.25, b: 0.2, y: 0.53, p: 2 }, { z: -2.12, w: 0.485, t: 0.27, b: 0.2, y: 0.53, p: 2 },
  ], { seg: 16, region: R.dark });

  /* ---- wings: tapered, washed out, 5° dihedral, rounded tips; ailerons ---- */
  const wingSt = [
    { s: 0, c: 1.78, le: -1.6, t: 0.15, tw: 0.035 },
    { s: 1.1, c: 1.74, le: -1.58, t: 0.145, tw: 0.032 },
    { s: 4.0, c: 1.2, le: -1.28, t: 0.115, tw: -0.005 },
    { s: 4.32, c: 1.1, le: -1.22, t: 0.105, tw: -0.008 },
    { s: 4.54, c: 0.94, le: -1.13, t: 0.09, tw: -0.01 },
    { s: 4.66, c: 0.7, le: -1.0, t: 0.07, tw: -0.01 },
    { s: 4.72, c: 0.36, le: -0.84, t: 0.045, tw: -0.01 },
  ];
  for (const side of [-1, 1]) {
    AF.wing(M, body, { root: new V3(0, -0.4, 0), side, dihedral: 0.087, stations: wingSt, hinge: 0.74,
      surfaces: [{ from: 2.35, to: 3.98, ch: side < 0 ? 1 : 2 }], top: R.wingT, bottom: R.wingB });
  }
  /* ---- tail: tailplane with elevator, swept fin with rudder ---- */
  const tailSt = [
    { s: 0, c: 1.05, le: 2.78, t: 0.1 }, { s: 1.45, c: 0.7, le: 3.12, t: 0.09 },
    { s: 1.68, c: 0.58, le: 3.2, t: 0.08 }, { s: 1.8, c: 0.36, le: 3.3, t: 0.05 },
  ];
  for (const side of [-1, 1]) {
    AF.wing(M, body, { root: new V3(0, 0.2, 0), side, stations: tailSt, hinge: 0.6,
      surfaces: [{ from: 0.18, to: 1.68, ch: 3 }], top: R.tailT, bottom: R.tailB });
  }
  AF.wing(M, body, { root: new V3(0, 0.3, 0), side: 1, dihedral: Math.PI / 2, hinge: 0.62, top: R.fin, bottom: R.fin,
    stations: [{ s: 0, c: 1.75, le: 2.15, t: 0.1 }, { s: 0.22, c: 1.4, le: 2.55, t: 0.1 }, { s: 1.15, c: 0.86, le: 3.12, t: 0.1 },
               { s: 1.32, c: 0.68, le: 3.26, t: 0.09 }, { s: 1.42, c: 0.38, le: 3.44, t: 0.06 }],
    surfaces: [{ from: 0.22, to: 1.32, ch: 4, sense: new V3(1, 0, 0) }] });

  /* ---- gear: taildragger. Spring-steel mains ahead of the wing with spats, a small steerable tail wheel ---- */
  for (const s of [-1, 1]) {
    AF.tube(M, body2, new V3(s * 0.45, -0.42, -2.1), new V3(s * 1.15, -1.28, -2.2), 0.08, 0.05, { region: R.grey, flat: 0.4, roll: s * 0.9 });
    AF.ellipsoid(M, body, new V3(s * 1.22, -1.4, -2.16), new V3(0.15, 0.23, 0.46), { region: R.white, seg: 10 });
    // exhaust stubs under the cowl
    AF.tube(M, body2, new V3(s * 0.3, -0.48, -2.95), new V3(s * 0.34, -0.64, -2.7), 0.055, 0.05, { region: R.dark });
  }
  AF.tube(M, body2, new V3(0, 0.1, 3.55), new V3(0, -0.12, 3.82), 0.035, 0.03, { region: R.grey });
  AF.ellipsoid(M, body, new V3(0, -0.15, 3.84), new V3(0.05, 0.09, 0.09), { region: R.dark, seg: 8, rings: 4 });

  /* ---- livery ---- */
  const map = A.texture((ctx, on) => {
    const P = AF.poly, LINE = 'rgba(30,38,46,0.28)';
    // fuselage. b: 0 top, 0.25 right side, 0.5 belly, 0.75 left side; mirror(f) draws on both halves
    on(R.fus, WHITE, (c, r) => {
      const mirror = (pts, col) => { P(c, pts, col); P(c, pts.map(([a, b]) => [a, 1 - b]), col); };
      mirror([[-4.5, 0.36], [-4.5, 0.64], [-2.95, 0.64], [-2.78, 0.36]], LIGHTGREY);                  // belly
      P(c, [[-4.5, 0.36], [-4.5, 0.64], [4, 0.64], [4, 0.36]], LIGHTGREY);
      mirror([[-4.5, -0.01], [-4.5, 0.5], [-2.95, 0.5], [-2.72, 0.12], [-2.62, -0.01]], ORANGE);      // cowl
      mirror([[-2.62, -0.01], [-2.62, 0.05], [-2.25, 0.05], [-2.25, -0.01]], DARK);                    // anti-glare
      // cheat line: along the side, sweeping up the tail to the fin
      const cheat = [[-2.82, 0.29], [-0.6, 0.285], [1.4, 0.25], [2.6, 0.17], [3.4, 0.09], [4.1, 0.05],
                     [4.1, 0.1], [3.4, 0.145], [2.6, 0.225], [1.4, 0.31], [-0.6, 0.345], [-2.9, 0.35]];
      mirror(cheat, ORANGE);
      mirror([[-2.9, 0.358], [-0.6, 0.353], [1.4, 0.318], [2.6, 0.232], [2.6, 0.244], [1.4, 0.33], [-0.6, 0.365], [-2.9, 0.37]], DARK);
      // panel lines: cowl joint, cabin doors, rear fuselage frames
      for (const z of [-2.62, 0.55, 1.75, 2.9]) { AF.line(c, r, z, 0.06, z, 0.47, LINE); AF.line(c, r, z, 0.53, z, 0.94, LINE); }
      AF.line(c, r, -3.3, 0.12, -3.3, 0.88, 'rgba(30,38,46,0.2)');
      // registration-style lettering on the rear fuselage (made up, not a real register code), both sides (the right half is mirrored, the left upside down)
      AF.text(c, r, 'SKY-RACE', 1.65, 0.2, 14, DARK, true, false);
      AF.text(c, r, 'SKY-RACE', 1.65, 0.8, 14, DARK, false, true);
    });
    on(R.spinner, WHITE, (c) => { P(c, [[-4.5, 0], [-4.5, 1], [-4.18, 1], [-4.18, 0]], ORANGE); });
    // wings: orange tops with white tips; white undersides with orange tips; darker ailerons; dark walkway
    on(R.wingT, ORANGE, (c, r) => {
      P(c, [[4.12, 0], [4.12, 1], [4.9, 1], [4.9, 0]], WHITE);
      P(c, [[4.05, 0], [4.05, 1], [4.12, 1], [4.12, 0]], DARK);
      P(c, [[2.35, 0.74], [2.35, 1.01], [3.98, 1.01], [3.98, 0.74]], ORANGE_D);
      P(c, [[0.62, 0.18], [0.62, 0.62], [1.05, 0.62], [1.05, 0.18]], '#3a434c');
      AF.line(c, r, 0.6, 0.74, 3.98, 0.74, LINE); AF.line(c, r, 2.35, 0.74, 2.35, 1, LINE); AF.line(c, r, 3.98, 0.74, 3.98, 1, LINE);
      AF.line(c, r, 0.6, 0.3, 4.0, 0.3, 'rgba(30,38,46,0.12)');
    });
    on(R.wingB, WHITE, (c, r) => {
      P(c, [[4.05, 0], [4.05, 1], [4.9, 1], [4.9, 0]], ORANGE);
      AF.line(c, r, 0.6, 0.74, 3.98, 0.74, LINE);
    });
    on(R.tailT, ORANGE, (c, r) => { P(c, [[1.5, 0], [1.5, 1], [1.9, 1], [1.9, 0]], WHITE); AF.line(c, r, 0.18, 0.6, 1.68, 0.6, LINE); });
    on(R.tailB, WHITE, (c, r) => { P(c, [[1.5, 0], [1.5, 1], [1.9, 1], [1.9, 0]], ORANGE); AF.line(c, r, 0.18, 0.6, 1.68, 0.6, LINE); });
    on(R.fin, WHITE, (c, r) => {
      P(c, [[0.62, -0.1], [1.5, -0.1], [1.5, 1.1], [0.9, 1.1]], ORANGE);                               // swept band
      P(c, [[0.54, -0.1], [0.62, -0.1], [0.9, 1.1], [0.8, 1.1]], DARK);
      AF.line(c, r, 0.22, 0.62, 1.32, 0.62, LINE);
    });
  });

  const B = AF.build(M, { map, shading });
  const g = B.group;

  /* ---- prop: two twisted blades with orange tips (spins), and the blur disc ---- */
  const PR = AF.propeller({ radius: 1.55, chord: 0.19, tip: ORANGE, tipFrom: 0.85, body: B.meshes.body, ringTint: [255, 90, 31] });
  const prop = PR.prop, disc = PR.disc;
  prop.position.set(0, 0, -3.98); disc.position.set(0, 0, -4.0); g.add(prop, disc);
  if (scene) scene.add(g);

  const U = B.U, defl = U.afDefl.value, MAXD = 0.42;
  return {
    group: g, tris: B.tris + PR.tris, uniforms: U,
    tips: [new V3(-4.68, 0.01, -0.5), new V3(4.68, 0.01, -0.5)],
    update(dt, P) {
      prop.rotation.z += dt * (P.boosting ? 55 : 34);
      // surfaces follow the turn rates (positive = trailing edge down; rudder: trailing edge right)
      const k = 1 - Math.exp(-dt * 14), cl = (v) => Math.max(-1, Math.min(1, v));
      const r = cl((P.rr || 0) / TUNE.MAX_ROLL), p = cl((P.rp || 0) / TUNE.MAX_PITCH), y = cl((P.ry || 0) / TUNE.MAX_YAW);
      defl.x += (r * MAXD - defl.x) * k; defl.y += (-r * MAXD - defl.y) * k;
      defl.z += (-p * MAXD - defl.z) * k; defl.w += (y * MAXD - defl.w) * k;
    },
  };
}
