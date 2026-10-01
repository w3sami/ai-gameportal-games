'use strict';
/* =========================================================================
   WINGSUIT — the Glacier theme's flyer (vehicle 'wingsuit'), built with js/airframe.js.
   Belly down, head first: a lofted torso with the container on the back, full-face helmet with a reflective
   visor and a small camera, arms along the leading edges of inflated arm wings (airfoil section, cell ribs),
   legs with booties and the leg wing between them. Orange suit with dark panels and white chevrons.
   One suit: the arm wings join the body along its side from the armpit to the thigh, their trailing edges curving
   inward to the hands; the legs spread in a V inside the leg wing, whose trailing edge curves inward between the
   feet. Arms, legs and the leg wing are their own pieces (Airframe nodes) so the tuck can move them: the arms
   sweep back to the body's sides (straight; the fabric folds between arm and body), the legs close and the leg
   wing narrows with them.
   Nose (head) along -Z; hands at about ±0.74 m.
   makeWingsuitFlyerModel(scene, shading?) -> { group, tips, trails: false, update(dt, P), tris, uniforms }
   ========================================================================= */
function makeWingsuitFlyerModel(scene, shading) {
  const V3 = THREE.Vector3, AF = Airframe;
  const ORANGE = '#ff5a1f', ORANGE_D = '#e04812', DARK = '#2a333d', DARK2 = '#353f4a', WHITE = '#f3f1ea', BLACK = '#1b2128', GREY = '#9aa3ab';
  const A = AF.createAtlas(512);
  const R = {
    torso: A.region(8, 8, 252, 136, -0.74, 0.1, 0, 1),       // a = z, b = angle from the back round the right side
    helmet: A.region(260, 8, 504, 136, -0.15, 0.15, 0, 1),   // ellipsoid: its own z (centre 0)
    armT: A.region(8, 144, 504, 240, 0, 0.58, 0, 1),        // a = span from the shoulder, b = chord fraction
    armB: A.region(8, 248, 504, 320, 0, 0.58, 0, 1),
    legT: A.region(8, 328, 252, 424, 0, 0.28, 0, 1), legB: A.region(260, 328, 504, 424, 0, 0.28, 0, 1),
    rig: A.region(8, 432, 252, 488, -0.6, -0.05, 0, 1),
    dark: A.solid(264, 440, DARK), black: A.solid(288, 440, BLACK), white: A.solid(312, 440, WHITE), orange: A.solid(336, 440, ORANGE),
    grey: A.solid(360, 440, GREY), legs: A.solid(384, 440, ORANGE_D),
  };
  const M = AF.createModel(), body = M.part(), glass = M.part({ mat: 'glass' });

  /* ---- torso, container, helmet ---- */
  AF.loft(M, body, [
    { z: -0.71, w: 0.055, t: 0.05, b: 0.05, y: 0.03, p: 2 },
    { z: -0.65, w: 0.13, t: 0.07, b: 0.07, y: 0.02, p: 2.2 },
    { z: -0.58, w: 0.21, t: 0.1, b: 0.095, p: 2.5 },
    { z: -0.45, w: 0.205, t: 0.12, b: 0.11, p: 2.7 },
    { z: -0.3, w: 0.18, t: 0.11, b: 0.11, p: 2.7 },
    { z: -0.15, w: 0.16, t: 0.1, b: 0.1, p: 2.6 },
    { z: 0.0, w: 0.17, t: 0.1, b: 0.1, p: 2.6 },
    { z: 0.08, w: 0.13, t: 0.075, b: 0.08, p: 2.4 },
  ], { seg: 14, region: R.torso });
  AF.loft(M, body, [                                         // container on the back
    { z: -0.57, w: 0.12, t: 0.02, b: 0.03, y: 0.135, p: 3 }, { z: -0.53, w: 0.15, t: 0.05, b: 0.03, y: 0.135, p: 3.5 },
    { z: -0.15, w: 0.15, t: 0.055, b: 0.03, y: 0.13, p: 3.5 }, { z: -0.09, w: 0.12, t: 0.02, b: 0.03, y: 0.125, p: 3 },
  ], { seg: 12, region: R.rig });
  AF.ellipsoid(M, body, new V3(0, 0.15, -0.06), new V3(0.03, 0.02, 0.03), { region: R.orange, seg: 8, rings: 4 });   // pilot-chute handle
  AF.ellipsoid(M, body, new V3(0, 0.07, -0.8), new V3(0.12, 0.125, 0.14), { region: R.helmet, seg: 14, rings: 8 });
  AF.ellipsoid(M, glass, new V3(0, 0.035, -0.872), new V3(0.1, 0.075, 0.085), { seg: 12, rings: 6 });             // visor
  AF.loft(M, body, [                                         // helmet camera
    { z: -0.86, w: 0.02, t: 0.02, b: 0.02, y: 0.205, p: 4 }, { z: -0.85, w: 0.022, t: 0.025, b: 0.02, y: 0.205, p: 4 },
    { z: -0.79, w: 0.022, t: 0.025, b: 0.02, y: 0.205, p: 4 },
  ], { seg: 8, region: R.black });

  /* ---- arms: inflated wings joined to the body along its side, from the armpit to the thigh. The inner edge sits
     inside the torso and the leg, so the suit is one piece; the trailing edge curves inward to the hand ---- */
  const ROOT_X = 0.15, DROOP = 0.08;
  const armSt = [
    { s: 0, c: 0.885, le: -0.565, t: 0.1 }, { s: 0.05, c: 0.805, le: -0.555, t: 0.1 }, { s: 0.1, c: 0.71, le: -0.55, t: 0.105 },
    { s: 0.2, c: 0.56, le: -0.54, t: 0.11 }, { s: 0.3, c: 0.38, le: -0.53, t: 0.12 }, { s: 0.4, c: 0.23, le: -0.52, t: 0.12 },
    { s: 0.5, c: 0.13, le: -0.51, t: 0.12 }, { s: 0.55, c: 0.075, le: -0.505, t: 0.11 }, { s: 0.57, c: 0.04, le: -0.5, t: 0.09 },
  ];
  const ARM_ROOT = (s) => new V3(s * ROOT_X, 0, 0), HIP = (s) => new V3(s * 0.1, -0.01, 0.04);
  for (const s of [-1, 1]) {
    const p = M.part({ node: s < 0 ? 'armL' : 'armR', crease: 0.7 });
    AF.wing(M, p, { root: ARM_ROOT(s), side: s, dihedral: -DROOP, stations: armSt, camber: 0.025, top: R.armT, bottom: R.armB,
      xs: [0, 0.03, 0.1, 0.25, 0.45, 0.7, 1] });
    // the arm along the leading edge: x measured from the wing's inner edge, following its droop
    const at = (x, z) => new V3(s * (ROOT_X + x * Math.cos(DROOP)), -x * Math.sin(DROOP) + 0.01, z);
    AF.tube(M, p, at(0.03, -0.52), at(0.3, -0.5), 0.063, 0.052, { region: R.dark, seg: 8 });   // upper arm
    AF.tube(M, p, at(0.3, -0.5), at(0.55, -0.48), 0.05, 0.039, { region: R.dark, seg: 8 });    // forearm
    AF.ellipsoid(M, p, at(0.595, -0.475), new V3(0.045, 0.028, 0.058), { region: R.black, seg: 8, rings: 4 });   // glove
  }
  /* ---- legs in a V, inside the leg wing; its edges follow the legs and its trailing edge curves inward
     between the feet ---- */
  const KNEE = (s) => new V3(s * 0.17, -0.02, 0.47), ANKLE = (s) => new V3(s * 0.235, -0.02, 0.86);
  for (const s of [-1, 1]) {
    const p = M.part({ node: s < 0 ? 'legL' : 'legR', crease: 0.7 }), H = HIP(s);
    AF.tube(M, p, new V3(H.x, H.y - 0.01, H.z), KNEE(s), 0.072, 0.056, { region: R.legs, seg: 8, flat: 0.78 });
    AF.tube(M, p, KNEE(s), ANKLE(s), 0.054, 0.04, { region: R.legs, seg: 8, flat: 0.78 });
    AF.ellipsoid(M, p, new V3(s * 0.24, -0.04, 0.95), new V3(0.036, 0.03, 0.075), { region: R.black, seg: 8, rings: 5 });   // shoe
  }
  const legSt = [
    { s: 0, c: 0.74, le: 0.04, t: 0.11 }, { s: 0.08, c: 0.76, le: 0.04, t: 0.11 }, { s: 0.135, c: 0.81, le: 0.04, t: 0.105 },
    { s: 0.17, c: 0.64, le: 0.25, t: 0.11 }, { s: 0.21, c: 0.42, le: 0.5, t: 0.12 }, { s: 0.25, c: 0.195, le: 0.74, t: 0.12 },
    { s: 0.27, c: 0.08, le: 0.86, t: 0.11 }, { s: 0.275, c: 0.04, le: 0.9, t: 0.09 },
  ];
  for (const s of [-1, 1]) {
    AF.wing(M, M.part({ node: 'tail', crease: 0.7 }), { root: new V3(0, -0.02, 0), side: s, stations: legSt, camber: 0.02,
      top: R.legT, bottom: R.legB, xs: [0, 0.04, 0.15, 0.4, 0.7, 1] });
  }

  /* ---- livery ---- */
  const map = A.texture((ctx, on) => {
    const P = AF.poly, RIB = 'rgba(20,26,32,0.3)', RIB_U = 'rgba(255,255,255,0.12)';
    on(R.torso, DARK, (c) => {
      const mirror = (pts, col) => { P(c, pts, col); P(c, pts.map(([a, b]) => [a, 1 - b]), col); };
      mirror([[-0.6, -0.01], [-0.5, -0.01], [-0.5, 0.3], [-0.6, 0.3]], ORANGE);                        // shoulder band
      mirror([[-0.6, 0.18], [0.1, 0.22], [0.1, 0.29], [-0.6, 0.25]], ORANGE);                          // side seams
      P(c, [[-0.8, 0.3], [0.2, 0.3], [0.2, 0.7], [-0.8, 0.7]], ORANGE);                                // orange front
      // harness: shoulder straps converging toward the hips, a short chest strap between them
      P(c, [[-0.6, 0.37], [-0.6, 0.405], [0.06, 0.465], [0.06, 0.435]], BLACK);
      P(c, [[-0.6, 0.63], [-0.6, 0.595], [0.06, 0.535], [0.06, 0.565]], BLACK);
      P(c, [[-0.36, 0.42], [-0.33, 0.42], [-0.33, 0.58], [-0.36, 0.58]], BLACK);
    });
    on(R.helmet, WHITE, (c) => {
      P(c, [[-0.2, -0.01], [0.2, -0.01], [0.2, 0.05], [-0.2, 0.05]], ORANGE);                         // stripe over the top
      P(c, [[-0.2, 0.95], [0.2, 0.95], [0.2, 1.01], [-0.2, 1.01]], ORANGE);
    });
    on(R.rig, '#c9ccc8', (c) => {
      P(c, [[-0.7, -0.01], [-0.48, -0.01], [-0.48, 1.01], [-0.7, 1.01]], DARK);                        // reserve flap
      P(c, [[-0.62, 0.2], [0, 0.2], [0, 0.24], [-0.62, 0.24]], DARK); P(c, [[-0.62, 0.76], [0, 0.76], [0, 0.8], [-0.62, 0.8]], DARK);
    });
    // arm wings: dark sleeve along the leading edge, orange with a white chevron, cell ribs every 8 cm
    on(R.armT, ORANGE, (c, r) => {
      P(c, [[-0.1, -0.1], [0.64, -0.1], [0.64, 0.12], [-0.1, 0.06]], DARK);                            // sleeve along the arm
      P(c, [[0.24, 0.42], [0.31, 0.42], [0.5, 1.1], [0.42, 1.1]], WHITE);
      P(c, [[0.13, 0.55], [0.18, 0.55], [0.33, 1.1], [0.27, 1.1]], ORANGE_D);
      P(c, [[0.5, 0.12], [0.64, 0.12], [0.64, 1.1], [0.54, 1.1]], DARK);                               // dark wing tip
      for (let x = 0.1; x < 0.52; x += 0.07) AF.line(c, r, x, 0.13, x, 1, RIB, 1);
    });
    on(R.armB, ORANGE_D, (c, r) => {                                                                   // underside: orange too
      P(c, [[-0.1, -0.1], [0.64, -0.1], [0.64, 0.12], [-0.1, 0.06]], DARK);
      P(c, [[0.5, 0.12], [0.64, 0.12], [0.64, 1.1], [0.54, 1.1]], DARK);
      for (let x = 0.1; x < 0.52; x += 0.07) AF.line(c, r, x, 0.13, x, 1, RIB, 1);
    });
    on(R.legT, ORANGE, (c, r) => {
      P(c, [[-0.1, 0.5], [0.3, 0.26], [0.3, 0.33], [-0.1, 0.59]], WHITE);                              // chevron
      P(c, [[-0.1, -0.1], [0.025, -0.1], [0.025, 1.1], [-0.1, 1.1]], DARK);                             // centre seam
      for (let x = 0.06; x < 0.27; x += 0.05) AF.line(c, r, x, 0.05, x, 1, RIB, 1);
      for (let b = 0.3; b < 1; b += 0.23) AF.line(c, r, 0.0, b, 0.28, b, RIB, 1);
    });
    on(R.legB, ORANGE_D, (c, r) => {
      P(c, [[-0.1, -0.1], [0.012, -0.1], [0.012, 1.1], [-0.1, 1.1]], BLACK);                          // centre seam
      for (let x = 0.06; x < 0.27; x += 0.05) AF.line(c, r, x, 0.05, x, 1, RIB, 1);
    });
  });

  const B = AF.build(M, { map, shading, glass: '#1e2a36' });
  const g = B.group, mesh = B.meshes;
  // each moving piece in a pivot at its joint (the geometry is in model coordinates, so offset it back)
  const pivot = (m, at) => {
    const pv = new THREE.Group(); pv.position.copy(at); g.add(pv);
    g.remove(m); m.position.copy(at).negate(); pv.add(m);
    return pv;
  };
  // tuck: the arms sweep back to the body's sides, straight, while the fabric between arm and body folds like a fan:
  // each point turns about the shoulder by an angle that is full along the arm and falls to nothing at the wing's
  // join with the body, whose lower part follows the closing legs. Worked out on the CPU, only when the tuck changes.
  const SWEEP = 1.25, LEG_IN = 0.16, sMax = armSt[armSt.length - 1].s;
  const folds = [-1, 1].map((s) => {
    const m = mesh[s < 0 ? 'armL:body' : 'armR:body'], pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal;
    const rest = Float32Array.from(pos.array), restN = Float32Array.from(nor.array), n = pos.count;
    const f = new Float32Array(n), out = new Float32Array(n), shoulder = new V3(s * 0.2, 0, -0.52);
    for (let i = 0; i < n; i++) {
      const x = rest[i * 3], z = rest[i * 3 + 2];
      const sp = Math.max(0, (Math.abs(x) - ROOT_X) / Math.cos(DROOP)), st = AF.stationAt(armSt, Math.min(sp, sMax));
      const u = Math.min(1, Math.max(0, (z - st.le) / st.c)), outward = Math.min(1, sp / sMax);
      f[i] = 1 - u * (1 - outward);                         // share of the sweep: 1 along the arm, 0 at the join
      out[i] = 1 - outward;                                  // how much the point follows the legs (the join's lower part)
    }
    return { s, m, pos, nor, rest, restN, f, out, shoulder };
  });
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new V3();
  let lastT = -1;
  const foldArms = (T) => {
    const legSin = Math.sin(LEG_IN * T);
    for (const F of folds) {
      const P = F.pos.array, N = F.nor.array, sh = F.shoulder;
      for (let i = 0; i < F.f.length; i++) {
        const a = SWEEP * T * F.f[i];
        _q.setFromEuler(_e.set(0, -F.s * a, -F.s * 0.12 * T * F.f[i]));
        _v.set(F.rest[i * 3] - sh.x, F.rest[i * 3 + 1] - sh.y, F.rest[i * 3 + 2] - sh.z).applyQuaternion(_q).add(sh);
        const zr = F.rest[i * 3 + 2];
        if (zr > 0.04) _v.x -= F.s * (zr - 0.04) * legSin * F.out[i];   // stay on the closing leg
        P[i * 3] = _v.x; P[i * 3 + 1] = _v.y; P[i * 3 + 2] = _v.z;
        _v.set(F.restN[i * 3], F.restN[i * 3 + 1], F.restN[i * 3 + 2]).applyQuaternion(_q);
        N[i * 3] = _v.x; N[i * 3 + 1] = _v.y; N[i * 3 + 2] = _v.z;
      }
      F.pos.needsUpdate = true; F.nor.needsUpdate = true;
      F.m.geometry.computeBoundingSphere();
    }
  };
  const legs = [pivot(mesh['legL:body'], HIP(-1)), pivot(mesh['legR:body'], HIP(1))];
  const tail = mesh['tail:body'];
  if (scene) scene.add(g);

  return {
    group: g, tris: B.tris, uniforms: B.U, trails: false, shadow: 0.25,
    tips: [new V3(-0.74, -0.05, -0.48), new V3(0.74, -0.05, -0.48)],
    update(dt, P) {                                        // tuck: arms back to the sides, legs together, leg wing narrows
      const T = P.tuck || 0;
      if (Math.abs(T - lastT) > 0.002) { foldArms(T); lastT = T; }
      legs.forEach((l, i) => { l.rotation.y = (i ? -1 : 1) * LEG_IN * T; });
      tail.scale.x = 1 - 0.5 * T;
    },
  };
}
