'use strict';
/* =========================================================================
   GLIDER — the Lakeside theme's sailplane (vehicle 'sailplane'), built with js/airframe.js. Flight model, thermals
   and the vario are js/sailplane.js.
   A slender pod with a long flush canopy tapering into a thin tail boom, a swept fin with a T-tail; a 14 m
   multi-taper wing (straight inner panels, tapering outer ones, washed-out tips) with ailerons and winglets.
   The whole wing bends up with the load (Airframe flex, in the shader), and buffets near the stall. White, as
   gliders are, with orange tips, winglets and fin top and the contest letters SR.
   update() also sets the body's is-stall-warn / is-stall classes for the HUD (css/sailplane.css).
   Nose along -Z; wing tips at ±7 m (TUNE.WING_HALF).
   makeGliderModel(scene, shading?) -> { group, tips, update(dt, P), tris, uniforms }
   ========================================================================= */
function makeGliderModel(scene, shading) {
  const V3 = THREE.Vector3, AF = Airframe;
  const WHITE = '#f5f5f1', ORANGE = '#ff5a1f', DARK = '#2a333c', GREY = '#c9ccc8';
  const A = AF.createAtlas(512);
  const R = {
    fus: A.region(8, 8, 504, 112, -3.3, 5.8, 0, 1),         // a = z, b = angle from the top round the right side
    wingT: A.region(8, 120, 504, 176, 0, 7.2, 0, 1),        // a = span, b = chord fraction
    wingB: A.region(8, 184, 504, 240, 0, 7.2, 0, 1),
    finL: A.region(8, 248, 252, 312, 0, 1.5, 0, 1), finR: A.region(260, 248, 504, 312, 0, 1.5, 0, 1),   // one per side: letters
    tailT: A.region(8, 320, 252, 360, 0, 1.45, 0, 1), tailB: A.region(260, 320, 504, 360, 0, 1.45, 0, 1),
    winglet: A.region(8, 368, 252, 400, 0, 0.5, 0, 1),
    dark: A.solid(264, 376, DARK), white: A.solid(288, 376, WHITE), orange: A.solid(312, 376, ORANGE),
  };
  const M = AF.createModel(), body = M.part(), glass = M.part({ mat: 'glass' }), wing = M.part({ flex: true });

  /* ---- fuselage: pod and boom ---- */
  AF.loft(M, body, [
    { z: -3.25, w: 0, t: 0, b: 0, y: -0.06, p: 2 },
    { z: -3.15, w: 0.12, t: 0.11, b: 0.12, y: -0.06, p: 2 },
    { z: -2.9, w: 0.25, t: 0.23, b: 0.25, y: -0.06, p: 2 },
    { z: -2.4, w: 0.33, t: 0.31, b: 0.35, y: -0.05, p: 2.05 },
    { z: -1.6, w: 0.36, t: 0.37, b: 0.43, y: -0.03, p: 2.1 },
    { z: -0.9, w: 0.35, t: 0.4, b: 0.45, p: 2.1 },
    { z: -0.2, w: 0.3, t: 0.37, b: 0.38, y: 0.02, p: 2.1 },
    { z: 0.5, w: 0.21, t: 0.28, b: 0.26, y: 0.05, p: 2.1 },
    { z: 1.4, w: 0.15, t: 0.2, b: 0.17, y: 0.07, p: 2 },
    { z: 3.0, w: 0.11, t: 0.15, b: 0.12, y: 0.09, p: 2 },
    { z: 4.6, w: 0.085, t: 0.12, b: 0.1, y: 0.1, p: 2 },
    { z: 5.5, w: 0.06, t: 0.1, b: 0.07, y: 0.1, p: 2 },
    { z: 5.75, w: 0.03, t: 0.05, b: 0.04, y: 0.1, p: 2 },
  ], { seg: 14, region: R.fus });
  // long, flush canopy
  AF.loft(M, glass, [
    { z: -2.78, w: 0.18, t: 0.02, b: 0.15, y: 0.17, p: 2 }, { z: -2.5, w: 0.27, t: 0.13, b: 0.15, y: 0.19, p: 2 },
    { z: -2.0, w: 0.31, t: 0.23, b: 0.15, y: 0.22, p: 2.1 }, { z: -1.45, w: 0.32, t: 0.25, b: 0.15, y: 0.24, p: 2.1 },
    { z: -1.0, w: 0.28, t: 0.19, b: 0.15, y: 0.26, p: 2 }, { z: -0.65, w: 0.18, t: 0.05, b: 0.15, y: 0.28, p: 2 },
  ], { seg: 14 });
  // main wheel half out of the belly, tail skid
  AF.ellipsoid(M, body, new V3(0, -0.47, -0.95), new V3(0.07, 0.15, 0.15), { region: R.dark, seg: 10, rings: 6 });
  AF.ellipsoid(M, body, new V3(0, -0.02, 5.25), new V3(0.03, 0.05, 0.12), { region: R.dark, seg: 6, rings: 4 });

  /* ---- wing: shoulder mounted, 2.3° dihedral, multi-taper, washout; ailerons; winglets ---- */
  const wingSt = [
    { s: 0, c: 0.98, le: -1.15, t: 0.14, tw: 0.03 }, { s: 3.0, c: 0.88, le: -1.12, t: 0.14, tw: 0.025 },
    { s: 5.6, c: 0.6, le: -0.98, t: 0.13, tw: 0.0 }, { s: 6.8, c: 0.4, le: -0.88, t: 0.12, tw: -0.02 },
    { s: 7.0, c: 0.33, le: -0.84, t: 0.11, tw: -0.02 },
  ];
  const DIH = 0.04, WROOT = new V3(0, 0.26, 0);
  for (const s of [-1, 1]) {
    AF.wing(M, wing, { root: WROOT, side: s, dihedral: DIH, stations: wingSt, camber: 0.03, hinge: 0.78,
      surfaces: [{ from: 4.2, to: 6.6, ch: s < 0 ? 1 : 2 }], top: R.wingT, bottom: R.wingB });
    // winglet: up from the tip, canted out, swept
    const tip = new V3(s * 7.0 * Math.cos(DIH) - s * 0.01, WROOT.y + 7.0 * Math.sin(DIH), 0);
    AF.wing(M, wing, { root: tip, side: s, dihedral: Math.PI / 2 - 0.3, top: R.winglet, bottom: R.winglet, xs: [0, 0.1, 0.4, 1],
      stations: [{ s: 0, c: 0.33, le: -0.84, t: 0.1 }, { s: 0.38, c: 0.2, le: -0.68, t: 0.1 }, { s: 0.45, c: 0.12, le: -0.62, t: 0.08 }] });
  }
  /* ---- tail: swept fin with rudder, T-tail with elevator ---- */
  AF.wing(M, body, { root: new V3(0, 0.15, 0), side: 1, dihedral: Math.PI / 2, hinge: 0.65, top: R.finL, bottom: R.finR,   // top = left side
    stations: [{ s: 0, c: 1.2, le: 4.25, t: 0.11 }, { s: 0.3, c: 1.05, le: 4.45, t: 0.11 }, { s: 1.3, c: 0.72, le: 4.95, t: 0.1 },
               { s: 1.48, c: 0.66, le: 5.02, t: 0.1 }],
    surfaces: [{ from: 0.3, to: 1.3, ch: 4, sense: new V3(1, 0, 0) }] });
  for (const s of [-1, 1]) {
    AF.wing(M, body, { root: new V3(0, 1.62, 0), side: s, hinge: 0.55, top: R.tailT, bottom: R.tailB,
      stations: [{ s: 0, c: 0.62, le: 5.0, t: 0.1 }, { s: 1.25, c: 0.4, le: 5.1, t: 0.09 }, { s: 1.4, c: 0.3, le: 5.15, t: 0.07 }],
      surfaces: [{ from: 0.08, to: 1.25, ch: 3 }] });
  }

  /* ---- livery ---- */
  const FIN_ROT_L = Math.PI / 2, FIN_FLIP_L = false, FIN_ROT_R = Math.PI / 2, FIN_FLIP_R = true;
  const map = A.texture((ctx, on) => {
    const P = AF.poly, LINE = 'rgba(30,38,46,0.25)', BIG = (px) => '900 ' + px + 'px "Arial Black", Arial, Helvetica, sans-serif';
    on(R.fus, WHITE, (c, r) => {
      const mirror = (pts, col) => { P(c, pts, col); P(c, pts.map(([a, b]) => [a, 1 - b]), col); };
      mirror([[-3.4, -0.01], [-3.4, 0.51], [-3.02, 0.51], [-3.02, -0.01]], ORANGE);                    // nose cap
      mirror([[-2.95, 0.3], [5.8, 0.3], [5.8, 0.33], [-2.95, 0.335]], ORANGE);                          // thin side stripe
      for (const z of [-0.2, 1.4]) { AF.line(c, r, z, 0.05, z, 0.95, LINE); }
    });
    // wings: white; orange tip bands top and bottom (anti-collision); airbrake box; aileron lines
    const wingPaint = (top) => (c, r) => {
      P(c, [[6.2, -1], [7.3, -1], [7.3, 2], [6.2, 2]], ORANGE);
      P(c, [[5.95, -1], [6.08, -1], [6.08, 2], [5.95, 2]], ORANGE);
      AF.line(c, r, 4.2, 0.78, 6.6, 0.78, LINE); AF.line(c, r, 4.2, 0.78, 4.2, 1, LINE); AF.line(c, r, 6.6, 0.78, 6.6, 1, LINE);
      if (top) { AF.line(c, r, 1.9, 0.42, 3.3, 0.42, LINE, 1); AF.line(c, r, 1.9, 0.5, 3.3, 0.5, LINE, 1); AF.line(c, r, 1.9, 0.42, 1.9, 0.5, LINE, 1); AF.line(c, r, 3.3, 0.42, 3.3, 0.5, LINE, 1); }
    };
    on(R.wingT, WHITE, wingPaint(true));
    on(R.wingB, WHITE, wingPaint(false));
    on(R.winglet, ORANGE, null);
    // fin: orange top, contest letters on both sides (each side its own region so they read the right way)
    const finPaint = (rot, flipX) => (c, r) => {
      P(c, [[1.12, -1], [1.6, -1], [1.6, 2], [1.12, 2]], ORANGE);
      AF.line(c, r, 0.3, 0.65, 1.3, 0.65, LINE);
      AF.text(c, r, 'SR', 0.66, 0.38, 64, DARK, flipX, false, { font: BIG(64), rot, sx: 0.42 });
    };
    on(R.finL, WHITE, finPaint(FIN_ROT_L, FIN_FLIP_L));
    on(R.finR, WHITE, finPaint(FIN_ROT_R, FIN_FLIP_R));
    on(R.tailT, WHITE, (c, r) => { P(c, [[1.15, -1], [1.5, -1], [1.5, 2], [1.15, 2]], ORANGE); AF.line(c, r, 0.08, 0.55, 1.25, 0.55, LINE); });
    on(R.tailB, WHITE, (c) => P(c, [[1.15, -1], [1.5, -1], [1.5, 2], [1.15, 2]], ORANGE));
  });

  const B = AF.build(M, { map, shading, glass: '#24343f' });
  const g = B.group;
  if (scene) scene.add(g);

  const U = B.U, defl = U.afDefl.value, MAXD = 0.38, X0 = 0.4;
  const shake = new THREE.Quaternion(), e = new THREE.Euler(), cls = document.body.classList;
  let t = 0, warnOn = false, stallOn = false;
  return {
    group: g, tris: B.tris, uniforms: U, shadow: 1.25,
    tips: [new V3(-7.05, 0.85, -0.75), new V3(7.05, 0.85, -0.75)],
    update(dt, P) {
      t += dt;
      // the wing bends up with the load (tip ~0.35 m at 1 g, ~0.6 m at 2 g) and flutters in the buffet
      const b = P.stallWarn || 0, k = 0.05 + 0.035 * clamp((P.gload || 1) - 1, -0.5, 2) + b * 0.03 * Math.sin(t * 31);
      U.afFlex.value.set(k * 0.168, X0);
      // surfaces follow the turn rates (positive = trailing edge down; rudder: trailing edge right)
      const kk = 1 - Math.exp(-dt * 10), cl = (v) => Math.max(-1, Math.min(1, v));
      const r = cl((P.rr || 0) / TUNE.MAX_ROLL), p = cl((P.rp || 0) / TUNE.MAX_PITCH), y = cl((P.ry || 0) / TUNE.MAX_YAW);
      defl.x += (r * MAXD - defl.x) * kk; defl.y += (-r * MAXD - defl.y) * kk;
      defl.z += (-p * MAXD - defl.z) * kk; defl.w += (y * MAXD - defl.w) * kk;
      if (b > 0) {                                           // buffet: the airframe shakes as the wing nears the stall
        const a = (P.stall ? 0.035 : 0.018 * b) * (reducedMotionPref() ? 0.3 : 1);
        g.quaternion.multiply(shake.setFromEuler(e.set(Math.sin(t * 23) * a, 0, Math.sin(t * 29 + 1) * a * 1.4)));
      }
      // HUD: speed red while warning, a STALL badge while stalled (css/sailplane.css)
      if ((b > 0) !== warnOn) cls.toggle('is-stall-warn', warnOn = b > 0);
      if (!!P.stall !== stallOn) cls.toggle('is-stall', stallOn = !!P.stall);
    },
  };
}
