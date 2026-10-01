'use strict';
/* =========================================================================
   BIPLANE — the aerobatic biplane's model (Farm theme; tuning in config/biplane.json, gates in js/aerobatic.js),
   built with js/airframe.js.
   A classic two-seat aerobatic biplane: big round cowl with a pointed spinner, short fuselage with a bubble canopy
   behind the upper wing, swept and staggered upper wing on cabane struts, straight lower wing on the belly, both with
   rounded tips and ailerons, N-struts between them, spatted gear and a tail wheel, a rounded fin and rudder.
   Red with a white sunburst on the wings and tailplane (rays fanning from the leading edge at the root back to the
   trailing edge and tips), white sweeps along the fuselage, diamonds on the fin.
   Airshow smoke from under the fuselage while the button is held (js/smoke.js), which clears away after a crash.
   Nose along -Z; the upper wing's tips (±3.6 m) are TUNE.WING_HALF.
   makeBiplaneModel(scene, modelKit) -> { group, tips, puffs, update(dt, P) } (js/game.js's `models`; modelKit unused)
   ========================================================================= */
function makeBiplaneModel(scene) {
  const V3 = THREE.Vector3, AF = Airframe;
  const RED = '#d8231f', RED_D = '#b81a17', WHITE = '#f5f2ea', DARK = '#262d34', METAL = '#9aa3ab';
  const A = AF.createAtlas(512);
  const R = {
    fus: A.region(8, 8, 504, 136, -3.0, 3.55, 0, 1),        // a = z, b = angle from the top round the right side
    upT: A.region(8, 144, 504, 200, 0, 3.7, 0, 1), upB: A.region(8, 208, 504, 264, 0, 3.7, 0, 1),     // a = span, b = chord
    loT: A.region(8, 272, 504, 328, 0, 3.4, 0, 1), loB: A.region(8, 336, 504, 392, 0, 3.4, 0, 1),
    tailT: A.region(8, 400, 252, 440, 0, 1.3, 0, 1), tailB: A.region(260, 400, 504, 440, 0, 1.3, 0, 1),
    finL: A.region(8, 448, 252, 496, 0, 1.25, 0, 1), finR: A.region(260, 448, 504, 496, 0, 1.25, 0, 1),
    dark: A.solid(8, 498, DARK), white: A.solid(32, 498, WHITE), metal: A.solid(56, 498, METAL), red: A.solid(80, 498, RED),
    pant: A.region(112, 496, 232, 510, -0.45, 0.45, 0, 1),  // spats (ellipsoids: their own z)
  };
  const M = AF.createModel(), body = M.part(), thin = M.part({ crease: 1.2 }), glass = M.part({ mat: 'glass' });

  /* ---- fuselage: round cowl, flat-sided body with a rounded turtle deck, short tail ---- */
  AF.loft(M, body, [
    { z: -2.9, w: 0.44, t: 0.42, b: 0.44, y: -0.02, p: 2 },
    { z: -2.75, w: 0.58, t: 0.56, b: 0.58, y: -0.02, p: 2.1 },
    { z: -2.4, w: 0.64, t: 0.62, b: 0.63, y: -0.02, p: 2.2 },
    { z: -1.9, w: 0.64, t: 0.61, b: 0.62, y: -0.02, p: 2.4 },
    { z: -1.5, w: 0.58, t: 0.58, b: 0.58, p: 2.8, pt: 2.4 },
    { z: -0.6, w: 0.52, t: 0.56, b: 0.52, p: 3.0, pt: 2.4 },
    { z: 0.4, w: 0.42, t: 0.5, b: 0.42, y: 0.02, p: 3.0, pt: 2.3 },
    { z: 1.4, w: 0.3, t: 0.4, b: 0.3, y: 0.05, p: 2.8, pt: 2.2 },
    { z: 2.4, w: 0.18, t: 0.3, b: 0.18, y: 0.1, p: 2.6, pt: 2.1 },
    { z: 3.2, w: 0.08, t: 0.21, b: 0.08, y: 0.14, p: 2.4 },
    { z: 3.48, w: 0.03, t: 0.14, b: 0.03, y: 0.15, p: 2.2 },
  ], { seg: 16, region: R.fus, capRegion: R.dark, bulge: 0.02 });
  AF.loft(M, body, [                                         // pointed spinner
    { z: -3.42, w: 0, t: 0, b: 0, y: -0.02, p: 2 }, { z: -3.3, w: 0.08, t: 0.08, b: 0.08, y: -0.02, p: 2 },
    { z: -3.1, w: 0.2, t: 0.2, b: 0.2, y: -0.02, p: 2 }, { z: -2.92, w: 0.28, t: 0.28, b: 0.28, y: -0.02, p: 2 },
  ], { seg: 12, region: R.red });
  // bubble canopy over the cockpit behind the upper wing, and its bow
  AF.loft(M, glass, [
    { z: -0.55, w: 0.24, t: 0.02, b: 0.2, y: 0.5, p: 2 }, { z: -0.3, w: 0.33, t: 0.2, b: 0.2, y: 0.5, p: 2 },
    { z: 0.1, w: 0.36, t: 0.3, b: 0.2, y: 0.5, p: 2.1 }, { z: 0.55, w: 0.33, t: 0.27, b: 0.2, y: 0.49, p: 2 },
    { z: 0.95, w: 0.22, t: 0.12, b: 0.2, y: 0.47, p: 2 }, { z: 1.25, w: 0.08, t: 0.02, b: 0.2, y: 0.45, p: 2 },
  ], { seg: 14 });
  AF.loft(M, body, [
    { z: -0.36, w: 0.315, t: 0.165, b: 0.2, y: 0.5, p: 2 }, { z: -0.29, w: 0.325, t: 0.19, b: 0.2, y: 0.5, p: 2 },
  ], { seg: 14, region: R.dark });

  /* ---- wings: upper swept 8° and staggered forward on cabanes; lower straight on the belly with a little dihedral.
     Symmetric sections, rounded tips, ailerons on all four panels ---- */
  const UPY = 1.08, LOY = -0.42, LODIH = 0.05;
  const upSt = [
    { s: 0, c: 1.25, le: -1.38, t: 0.12 }, { s: 3.2, c: 1.25, le: -0.93, t: 0.12 }, { s: 3.45, c: 1.12, le: -0.85, t: 0.115 },
    { s: 3.58, c: 0.82, le: -0.72, t: 0.1 }, { s: 3.63, c: 0.45, le: -0.56, t: 0.08 },
  ];
  const loSt = [
    { s: 0, c: 1.2, le: -0.98, t: 0.12 }, { s: 2.95, c: 1.2, le: -0.95, t: 0.12 }, { s: 3.2, c: 1.08, le: -0.89, t: 0.115 },
    { s: 3.33, c: 0.78, le: -0.76, t: 0.1 }, { s: 3.38, c: 0.42, le: -0.6, t: 0.08 },
  ];
  for (const s of [-1, 1]) {
    const ch = s < 0 ? 1 : 2;
    AF.wing(M, body, { root: new V3(0, UPY, 0), side: s, stations: upSt, hinge: 0.76,
      surfaces: [{ from: 1.15, to: 3.2, ch }], top: R.upT, bottom: R.upB });
    AF.wing(M, body, { root: new V3(0, LOY, 0), side: s, dihedral: LODIH, stations: loSt, hinge: 0.76,
      surfaces: [{ from: 1.15, to: 2.95, ch }], top: R.loT, bottom: R.loB });
    // N-struts at 2.5 m: front and rear posts from the lower spar line up to the upper one (leaning forward with the
    // stagger) and a diagonal; flat streamlined sections so they don't shimmer
    const x = s * 2.5, yL = LOY + 2.5 * Math.sin(LODIH) + 0.06, yU = UPY - 0.06;
    const lz = (st, f) => { const q = AF.stationAt(st, 2.5); return q.le + q.c * f; };
    const strut = (a, b) => AF.tube(M, thin, a, b, 0.05, 0.05, { region: R.red, flat: 0.4, seg: 6 });
    strut(new V3(x, yL, lz(loSt, 0.2)), new V3(x, yU, lz(upSt, 0.2)));
    strut(new V3(x, yL, lz(loSt, 0.65)), new V3(x, yU, lz(upSt, 0.65)));
    strut(new V3(x, yL, lz(loSt, 0.65)), new V3(x, yU, lz(upSt, 0.2)));
    // cabane struts from the fuselage's shoulders up to the upper wing's centre section
    AF.tube(M, thin, new V3(s * 0.38, 0.42, -1.55), new V3(s * 0.48, UPY - 0.06, -1.15), 0.035, 0.035, { region: R.metal, seg: 6 });
    AF.tube(M, thin, new V3(s * 0.38, 0.42, -0.85), new V3(s * 0.48, UPY - 0.06, -0.5), 0.035, 0.035, { region: R.metal, seg: 6 });
    // gear: legs and spats; exhausts under the cowl
    AF.tube(M, thin, new V3(s * 0.38, -0.5, -1.55), new V3(s * 0.86, -1.3, -1.5), 0.06, 0.045, { region: R.red, flat: 0.5, seg: 6 });
    AF.ellipsoid(M, body, new V3(s * 0.92, -1.42, -1.48), new V3(0.13, 0.22, 0.44), { region: R.pant, seg: 10 });
    AF.tube(M, thin, new V3(s * 0.32, -0.5, -2.2), new V3(s * 0.38, -0.66, -1.95), 0.055, 0.05, { region: R.dark });
  }
  /* ---- tail: tailplane with rounded tips and elevator, rounded fin and big rudder; tail wheel ---- */
  for (const s of [-1, 1]) {
    AF.wing(M, body, { root: new V3(0, 0.16, 0), side: s, hinge: 0.55, top: R.tailT, bottom: R.tailB,
      stations: [{ s: 0, c: 0.95, le: 2.45, t: 0.1 }, { s: 0.95, c: 0.82, le: 2.55, t: 0.09 }, { s: 1.15, c: 0.65, le: 2.63, t: 0.08 },
                 { s: 1.25, c: 0.36, le: 2.78, t: 0.06 }],
      surfaces: [{ from: 0.12, to: 1.15, ch: 3 }] });
  }
  AF.wing(M, body, { root: new V3(0, 0.3, 0), side: 1, dihedral: Math.PI / 2, hinge: 0.45, top: R.finL, bottom: R.finR,   // top = left side
    stations: [{ s: 0, c: 1.15, le: 2.4, t: 0.1 }, { s: 0.3, c: 1.08, le: 2.5, t: 0.1 }, { s: 0.85, c: 0.92, le: 2.62, t: 0.1 },
               { s: 1.08, c: 0.72, le: 2.75, t: 0.09 }, { s: 1.2, c: 0.4, le: 2.92, t: 0.07 }],
    surfaces: [{ from: 0.12, to: 1.08, ch: 4, sense: new V3(1, 0, 0) }] });
  AF.tube(M, thin, new V3(0, 0.05, 3.1), new V3(0, -0.12, 3.32), 0.03, 0.025, { region: R.metal });
  AF.ellipsoid(M, body, new V3(0, -0.16, 3.34), new V3(0.045, 0.075, 0.075), { region: R.dark, seg: 8, rings: 4 });

  /* ---- livery ---- */
  const map = A.texture((ctx, on) => {
    const P = AF.poly, LINE = 'rgba(40,10,10,0.3)';
    // sunburst, as on the real thing: white rays fan out from a point on the leading edge at the root (the upper wing's
    // centre, so both halves share one rising sun) back toward the trailing edge and out to the tip. Laid out as true
    // angles in metres (the texture's chord axis is a fraction): shallow rays reach the tip, steeper ones the
    // trailing edge; a red strip stays along the leading edge
    const sunburst = (span, chord, wedges, apexB = 0.05) => (c, r) => {
      const c0 = chord * apexB, tc = (chord - c0) / span;     // tan of the ray through the tip's trailing-edge corner
      const hit = (deg) => {
        const t = Math.tan(deg * Math.PI / 180);
        return t < tc ? [span + 0.05, (c0 + (span + 0.05) * t) / chord] : [(chord - c0) / t, 1.04];
      };
      for (const [d0, d1] of wedges) {
        const pts = [[-0.02, apexB], hit(d0)];
        if (Math.tan(d0 * Math.PI / 180) < tc && Math.tan(d1 * Math.PI / 180) >= tc) pts.push([span + 0.05, 1.04]);
        pts.push(hit(d1));
        P(c, pts, WHITE);
      }
    };
    const WING_RAYS = [[1.6, 5.6], [9, 14.5], [18.5, 25.5], [31.5, 41]];
    for (const [reg, span] of [[R.upT, 3.63], [R.upB, 3.63], [R.loT, 3.38], [R.loB, 3.38]]) {
      on(reg, RED, (c, r) => { sunburst(span, 1.22, WING_RAYS)(c, r); AF.line(c, r, 1.15, 0.76, span - 0.45, 0.76, LINE); });
    }
    const TAIL_RAYS = [[3, 9], [16, 26], [36, 50]];
    on(R.tailT, RED, (c, r) => { sunburst(1.25, 0.9, TAIL_RAYS, 0.06)(c, r); AF.line(c, r, 0.12, 0.55, 1.15, 0.55, LINE); });
    on(R.tailB, RED, (c) => sunburst(1.25, 0.9, TAIL_RAYS, 0.06)(c));
    // fin: white diamonds stacked on the rudder (drawn upright: a = height, b = chord)
    const diamonds = (c, r) => {
      for (const [a, b] of [[0.35, 0.68], [0.65, 0.66], [0.95, 0.64]]) P(c, [[a - 0.11, b], [a, b - 0.09], [a + 0.11, b], [a, b + 0.09]], WHITE);
      AF.line(c, r, 0.12, 0.45, 1.08, 0.45, LINE);
    };
    on(R.finL, RED, diamonds);
    on(R.finR, RED, diamonds);
    on(R.fus, RED, (c, r) => {
      const mirror = (pts, col) => { P(c, pts, col); P(c, pts.map(([a, b]) => [a, 1 - b]), col); };
      // a white sweep round the cowl front, curving back along the side; pinstripes on to the tail
      mirror([[-3.05, -0.01], [-3.05, 0.51], [-2.78, 0.51], [-2.78, 0.3], [-2.2, 0.27], [-1.4, 0.3], [-1.4, 0.335], [-2.35, 0.32], [-2.62, 0.3], [-2.62, -0.01]], WHITE);
      mirror([[-1.4, 0.3], [3.6, 0.16], [3.6, 0.19], [-1.4, 0.335]], WHITE);
      mirror([[-1.2, 0.36], [3.6, 0.22], [3.6, 0.235], [-1.2, 0.375]], WHITE);
      for (const z of [-1.9, 1.4]) { AF.line(c, r, z, 0.05, z, 0.45, LINE); AF.line(c, r, z, 0.55, z, 0.95, LINE); }
    });
    on(R.pant, RED, (c) => { P(c, [[-0.5, 0.2], [0.5, 0.26], [0.5, 0.33], [-0.5, 0.27]], WHITE); P(c, [[-0.5, 0.8], [0.5, 0.74], [0.5, 0.67], [-0.5, 0.73]], WHITE); });
  });

  const B = AF.build(M, { map, glass: '#24343f' });
  const g = B.group;
  const PR = AF.propeller({ radius: 1.15, chord: 0.17, tip: WHITE, tipFrom: 0.88, body: B.meshes.body, disc: [38, 45, 52] });
  const prop = PR.prop, disc = PR.disc;
  prop.position.set(0, -0.02, -3.0); disc.position.set(0, -0.02, -3.02); g.add(prop, disc);
  scene.add(g);
  const puffs = makeSmoke(scene, new V3(0, -0.8, 0.9));
  const U = B.U, defl = U.afDefl.value, MAXD = 0.42;
  let shown = true;
  return { group: g, tips: [new V3(-3.6, 1.08, -0.35), new V3(3.6, 1.08, -0.35)], puffs, tris: B.tris + PR.tris, uniforms: U,
           update(dt, P) {
             prop.rotation.z += dt * (P.boosting ? 58 : 40);
             const k = 1 - Math.exp(-dt * 16), cl = (v) => Math.max(-1, Math.min(1, v));
             const r = cl((P.rr || 0) / TUNE.MAX_ROLL), p = cl((P.rp || 0) / TUNE.MAX_PITCH), y = cl((P.ry || 0) / TUNE.MAX_YAW);
             defl.x += (r * MAXD - defl.x) * k; defl.y += (-r * MAXD - defl.y) * k;
             defl.z += (-p * MAXD - defl.z) * k; defl.w += (y * MAXD - defl.w) * k;
             if (shown && !g.visible) puffs.dissipate();    // gone from view: a crash (in play, the demo or a replay)
             shown = g.visible;
           } };
}
