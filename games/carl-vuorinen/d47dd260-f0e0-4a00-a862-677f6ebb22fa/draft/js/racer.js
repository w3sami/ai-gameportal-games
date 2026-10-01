'use strict';
/* =========================================================================
   RACE PLANE — the Harbour theme's pylon racer (vehicle 'racer'), built with js/airframe.js.
   A slim fuselage: flat-topped cowl narrowing to a small pointed spinner, low ahead of the cockpit, a long
   canopy running back into a raised spine that carries its line on to the fin; a strongly tapered square-tipped wing (trailing edge swept forward) with near full-span ailerons and
   spades under the tips; titanium spring gear with wheel pants, a tail wheel and the smoke nozzle under the
   tail (`smoke`, where js/game.js starts the trail). Blue with a yellow nose and a chequered band, wings
   lettered SKY RACE, race number 27 on the sides and on top of the tailplane. Nose along -Z; wing tips at ±3.9 m (TUNE.WING_HALF).
   makeRacePlaneModel(scene, shading?) -> { group, tips, smoke, update(dt, P), tris, uniforms }
   ========================================================================= */
function makeRacePlaneModel(scene, shading) {
  const V3 = THREE.Vector3, AF = Airframe;
  const WHITE = '#f5f5f2', BLUE = '#1c3f9e', BLUE_D = '#16337f', BLUE_L = '#2a56c4', YELLOW = '#ffc21a', RED = '#e5262d', DARK = '#1d2530', GREY = '#aeb4b8';
  const A = AF.createAtlas(512);
  const R = {
    fus: A.region(8, 8, 504, 184, -3.95, 3.6, 0, 1),        // a = z, b = angle from the top round the right side
    wingTL: A.region(8, 192, 504, 256, 0, 4.0, 0, 1),       // a = span, b = chord fraction; one per side for lettering
    wingTR: A.region(8, 264, 504, 328, 0, 4.0, 0, 1),
    wingB: A.region(8, 336, 504, 380, 0, 4.0, 0, 1),
    tailTL: A.region(8, 388, 252, 428, 0, 1.45, 0, 1), tailTR: A.region(260, 388, 504, 428, 0, 1.45, 0, 1),
    tailB: A.region(8, 436, 252, 468, 0, 1.45, 0, 1),
    spinner: A.region(260, 436, 504, 456, -3.95, -3.25, 0, 1),
    fin: A.region(8, 476, 252, 506, 0, 1.4, 0, 1),
    dark: A.solid(264, 468, DARK), grey: A.solid(288, 468, GREY), white: A.solid(312, 468, WHITE), red: A.solid(336, 468, RED),
    blue: A.solid(360, 468, BLUE), yellow: A.solid(384, 468, YELLOW),
  };
  const M = AF.createModel(), body = M.part(), thin = M.part({ crease: 1.2 }), glass = M.part({ mat: 'glass' });

  /* ---- fuselage: flat-topped cowl narrowing to a small spinner, smooth top line into the canopy, slim tail ---- */
  AF.loft(M, body, [
    { z: -3.32, w: 0.38, t: 0.27, b: 0.36, y: -0.02, p: 2.2, pt: 4 },
    { z: -3.15, w: 0.49, t: 0.34, b: 0.45, y: -0.02, p: 2.3, pt: 4.5 },
    { z: -2.7, w: 0.58, t: 0.4, b: 0.52, y: -0.02, p: 2.4, pt: 5 },
    { z: -2.0, w: 0.62, t: 0.45, b: 0.53, y: -0.02, p: 2.5, pt: 5 },
    { z: -1.2, w: 0.6, t: 0.5, b: 0.5, y: -0.02, p: 2.6, pt: 4.5 },
    { z: -0.3, w: 0.53, t: 0.52, b: 0.45, p: 2.6, pt: 3.4 },
    { z: 0.5, w: 0.46, t: 0.6, b: 0.38, y: 0.02, p: 2.5, pt: 2.6 },
    { z: 1.0, w: 0.41, t: 0.68, b: 0.33, y: 0.04, p: 2.4, pt: 2.2 },
    { z: 1.4, w: 0.37, t: 0.74, b: 0.29, y: 0.05, p: 2.4, pt: 2.0 },
    { z: 2.0, w: 0.3, t: 0.66, b: 0.23, y: 0.08, p: 2.3, pt: 2.0 },
    { z: 2.9, w: 0.17, t: 0.44, b: 0.13, y: 0.12, p: 2.3, pt: 2.0 },
    { z: 3.5, w: 0.07, t: 0.26, b: 0.06, y: 0.16, p: 2.2 },
  ], { seg: 16, region: R.fus, capRegion: R.dark, bulge: 0.02 });
  AF.loft(M, body, [
    { z: -3.86, w: 0, t: 0, b: 0, y: -0.04, p: 2 }, { z: -3.76, w: 0.07, t: 0.07, b: 0.07, y: -0.04, p: 2 },
    { z: -3.58, w: 0.17, t: 0.17, b: 0.17, y: -0.04, p: 2 }, { z: -3.42, w: 0.25, t: 0.25, b: 0.25, y: -0.04, p: 2 },
    { z: -3.32, w: 0.29, t: 0.29, b: 0.29, y: -0.04, p: 2 },
  ], { seg: 12, region: R.spinner });
  // canopy: rises from the low nose and runs back into the spine, which carries its top line on to the fin
  AF.loft(M, glass, [
    { z: -1.2, w: 0.3, t: 0.02, b: 0.2, y: 0.48, p: 2.2 }, { z: -0.8, w: 0.37, t: 0.17, b: 0.2, y: 0.48, p: 2.2 },
    { z: -0.2, w: 0.4, t: 0.28, b: 0.2, y: 0.48, p: 2.3 }, { z: 0.5, w: 0.39, t: 0.32, b: 0.2, y: 0.48, p: 2.3 },
    { z: 1.0, w: 0.36, t: 0.31, b: 0.2, y: 0.48, p: 2.2 }, { z: 1.45, w: 0.32, t: 0.28, b: 0.2, y: 0.48, p: 2.1 },
  ], { seg: 16 });
  AF.loft(M, body, [
    { z: -0.92, w: 0.355, t: 0.125, b: 0.2, y: 0.48, p: 2.2 }, { z: -0.84, w: 0.365, t: 0.145, b: 0.2, y: 0.48, p: 2.2 },
  ], { seg: 16, region: R.dark });

  /* ---- short tapered low wing, big ailerons ---- */
  const wingSt = [
    { s: 0, c: 2.0, le: -1.95, t: 0.16 }, { s: 0.7, c: 1.92, le: -1.9, t: 0.155 },
    { s: 3.78, c: 0.87, le: -1.42, t: 0.115 }, { s: 3.9, c: 0.84, le: -1.41, t: 0.105 },
  ];
  for (const side of [-1, 1]) {
    const ch = side < 0 ? 1 : 2;
    AF.wing(M, body, { root: new V3(0, -0.38, 0), side, dihedral: 0.02, stations: wingSt, hinge: 0.7,
      surfaces: [{ from: 0.8, to: 3.72, ch }], top: side < 0 ? R.wingTL : R.wingTR, bottom: R.wingB });
    // aileron spade: a small triangular paddle on a strut below the wing, ahead of the hinge
    const cs = M.parts.find((q) => q.cs && q.cs.ch === ch).cs, spade = M.part({ crease: 1.2 }), strut = M.part({ crease: 1.2 });
    spade.cs = strut.cs = cs;
    const y0 = -0.38 + 3.2 * Math.sin(0.02);
    AF.wing(M, spade, { root: new V3(side * 2.98, y0 - 0.34, 0), side, xs: [0, 0.2, 0.6, 1], top: R.yellow, bottom: R.yellow,
      stations: [{ s: 0, c: 0.5, le: -1.18, t: 0.06 }, { s: 0.36, c: 0.08, le: -0.76, t: 0.06 }] });
    AF.tube(M, strut, new V3(side * 3.12, y0 - 0.06, -1.02), new V3(side * 3.12, y0 - 0.33, -0.98), 0.03, 0.03, { region: R.dark, flat: 2.2 });
  }
  /* ---- tail: tapered tailplane with rounded tips, swept fin with a big rudder ---- */
  for (const side of [-1, 1]) {
    AF.wing(M, body, { root: new V3(0, 0.14, 0), side, hinge: 0.5, top: side < 0 ? R.tailTL : R.tailTR, bottom: R.tailB,
      stations: [{ s: 0, c: 1.08, le: 2.42, t: 0.1 }, { s: 1.15, c: 0.7, le: 2.72, t: 0.09 }, { s: 1.32, c: 0.56, le: 2.82, t: 0.08 },
                 { s: 1.42, c: 0.34, le: 2.95, t: 0.05 }],
      surfaces: [{ from: 0.15, to: 1.32, ch: 3 }] });
  }
  AF.wing(M, body, { root: new V3(0, 0.38, 0), side: 1, dihedral: Math.PI / 2, hinge: 0.48, top: R.fin, bottom: R.fin,
    stations: [{ s: 0, c: 1.65, le: 1.92, t: 0.1 }, { s: 0.22, c: 1.34, le: 2.34, t: 0.1 }, { s: 1.08, c: 0.86, le: 2.92, t: 0.1 },
               { s: 1.26, c: 0.62, le: 3.1, t: 0.08 }, { s: 1.36, c: 0.34, le: 3.3, t: 0.05 }],
    surfaces: [{ from: 0.22, to: 1.26, ch: 4, sense: new V3(1, 0, 0) }] });

  /* ---- gear: titanium legs and wheel pants, tail wheel; exhausts; smoke nozzle ---- */
  for (const s of [-1, 1]) {
    AF.tube(M, thin, new V3(s * 0.42, -0.48, -1.95), new V3(s * 1.04, -1.33, -2.0), 0.08, 0.05, { region: R.grey, flat: 0.38, roll: s * 0.9 });
    AF.ellipsoid(M, body, new V3(s * 1.1, -1.46, -1.97), new V3(0.14, 0.22, 0.44), { region: R.white, seg: 10 });
    AF.tube(M, thin, new V3(s * 0.32, -0.38, -2.85), new V3(s * 0.38, -0.62, -2.55), 0.06, 0.055, { region: R.dark });
  }
  AF.tube(M, thin, new V3(0, 0.08, 3.12), new V3(0, -0.12, 3.36), 0.035, 0.03, { region: R.grey });
  AF.ellipsoid(M, body, new V3(0, -0.16, 3.38), new V3(0.05, 0.085, 0.085), { region: R.dark, seg: 8, rings: 4 });
  AF.tube(M, thin, new V3(0, 0.1, 3.2), new V3(0, 0.12, 3.62), 0.045, 0.04, { region: R.dark });

  /* ---- livery ---- */
  const map = A.texture((ctx, on) => {
    const P = AF.poly, LINE = 'rgba(10,16,30,0.35)';
    const BIG = (px) => '900 ' + px + 'px "Arial Black", Arial, Helvetica, sans-serif';
    on(R.fus, BLUE, (c, r) => {
      const mirror = (pts, col) => { P(c, pts, col); P(c, pts.map(([a, b]) => [a, 1 - b]), col); };
      mirror([[-4.0, -0.01], [-4.0, 0.51], [-2.15, 0.51], [-1.95, -0.01]], YELLOW);                    // yellow nose
      for (let row = 0; row < 2; row++) for (let k = 0; k < 24; k++) {                                 // chequered band
        const b0 = k / 24, z0 = -1.95 + row * 0.09 + (1 - Math.abs(b0 + 0.5 / 24 - 0.5) * 2) * -0.2;
        P(c, [[z0, b0], [z0 + 0.09, b0], [z0 + 0.09, b0 + 1 / 24], [z0, b0 + 1 / 24]], (row + k) % 2 ? WHITE : DARK);
      }
      mirror([[-1.7, 0.36], [3.7, 0.24], [3.7, 0.28], [-1.7, 0.4]], BLUE_L);                          // lighter flash along the side
      for (const z of [-2.85, 1.6, 2.6]) { AF.line(c, r, z, 0.06, z, 0.47, LINE); AF.line(c, r, z, 0.53, z, 0.94, LINE); }
      // race number on both sides, under the canopy
      AF.text(c, r, '27', -0.6, 0.27, 38, WHITE, true, false, { font: BIG(38) });
      AF.text(c, r, '27', -0.6, 0.73, 38, WHITE, false, true, { font: BIG(38) });
    });
    on(R.spinner, YELLOW, null);
    const wingTop = (word, flip) => (c, r) => {
      P(c, [[3.55, -1], [4.1, -1], [4.1, 2], [3.55, 2]], WHITE);
      P(c, [[0.8, 0.7], [0.8, 1.01], [3.72, 1.01], [3.72, 0.7]], BLUE_D);
      AF.line(c, r, 0.8, 0.7, 3.72, 0.7, LINE); AF.line(c, r, 0.8, 0.7, 0.8, 1, LINE);
      // big lettering along the span, tops toward the leading edge (reads from behind and above)
      AF.text(c, r, word, 2.15, 0.4, 40, WHITE, flip, false, { sx: 2.2, stroke: DARK, strokeW: 2, italic: true, font: BIG(40) });
    };
    on(R.wingTL, BLUE, wingTop('SKY', true));
    on(R.wingTR, BLUE, wingTop('RACE', false));
    on(R.wingB, WHITE, (c, r) => { P(c, [[3.55, -1], [4.1, -1], [4.1, 2], [3.55, 2]], BLUE); AF.line(c, r, 0.8, 0.7, 3.72, 0.7, LINE); });
    // race number on top of both tailplane halves, read from behind and above like the wings' lettering
    const tailTop = (flip) => (c, r) => {
      P(c, [[1.15, -1], [1.5, -1], [1.5, 2], [1.15, 2]], WHITE); AF.line(c, r, 0.15, 0.5, 1.32, 0.5, LINE);
      AF.text(c, r, '27', 0.66, 0.44, 27, WHITE, flip, false, { sx: 3.2, stroke: DARK, strokeW: 2, font: BIG(27) });
    };
    on(R.tailTL, BLUE, tailTop(true));
    on(R.tailTR, BLUE, tailTop(false));
    on(R.tailB, WHITE, (c) => P(c, [[1.15, -1], [1.5, -1], [1.5, 2], [1.15, 2]], BLUE));
    on(R.fin, BLUE, (c, r) => {
      P(c, [[1.0, -1], [1.5, -1], [1.5, 2], [1.0, 2]], YELLOW);
      AF.line(c, r, 0.22, 0.48, 1.26, 0.48, LINE);
    });
  });

  const B = AF.build(M, { map, shading });
  const g = B.group;
  const PR = AF.propeller({ radius: 1.15, chord: 0.17, tip: YELLOW, tipFrom: 0.86, body: B.meshes.body, disc: [29, 37, 48] });
  const prop = PR.prop, disc = PR.disc;
  prop.position.set(0, -0.04, -3.44); disc.position.set(0, -0.04, -3.46); g.add(prop, disc);
  if (scene) scene.add(g);

  const U = B.U, defl = U.afDefl.value, MAXD = 0.42;
  return {
    group: g, tris: B.tris + PR.tris, uniforms: U,
    tips: [new V3(-3.88, -0.3, -0.75), new V3(3.88, -0.3, -0.75)], smoke: new V3(0, 0.12, 3.62),
    update(dt, P) {
      prop.rotation.z += dt * (P.boosting ? 60 : 42);
      const k = 1 - Math.exp(-dt * 16), cl = (v) => Math.max(-1, Math.min(1, v));
      const r = cl((P.rr || 0) / TUNE.MAX_ROLL), p = cl((P.rp || 0) / TUNE.MAX_PITCH), y = cl((P.ry || 0) / TUNE.MAX_YAW);
      defl.x += (r * MAXD - defl.x) * k; defl.y += (-r * MAXD - defl.y) * k;
      defl.z += (-p * MAXD - defl.z) * k; defl.w += (y * MAXD - defl.w) * k;
    },
  };
}
