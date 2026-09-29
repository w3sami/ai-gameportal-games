'use strict';
/* =========================================================================
   BIPLANE — the aerobatic biplane's model (Farm theme; tuning in config/biplane.json, gates in js/aerobatic.js).
   A Pitts-style single-seater: short round-cowled fuselage, staggered upper and lower wings on N-struts, spatted gear,
   and airshow smoke from under the fuselage while the button is held (js/smoke.js). Nose along -Z; the upper wing's tips (±3.6 m)
   are TUNE.WING_HALF.
   makeBiplaneModel(scene, modelKit) -> { group, tips, puffs, update(dt, P) } (js/game.js's `models`).
   ========================================================================= */
function makeBiplaneModel(scene, modelKit) {
  const V3 = THREE.Vector3, g = new THREE.Group(), add = modelKit(g);
  const L = (c, e) => new THREE.MeshLambertMaterial(e ? { color: c, emissive: e } : { color: c });
  const red = L('#d8231f'), white = L('#f5f2ea'), dark = L('#262d34'), metal = L('#9aa3ab'), glass = L('#2d4a63', '#0d1b28');
  // fuselage: round cowl tapering to the tail
  add(new THREE.CylinderGeometry(0.62, 0.2, 4.9, 12).rotateX(-Math.PI / 2), red, 0, 0, 0.55);
  add(new THREE.CylinderGeometry(0.68, 0.64, 0.9, 14).rotateX(-Math.PI / 2), white, 0, 0, -2.1);    // cowl ring
  add(new THREE.CylinderGeometry(0.5, 0.68, 0.35, 14).rotateX(-Math.PI / 2), dark, 0, 0, -2.7);     // cowl lip
  add(new THREE.ConeGeometry(0.24, 0.5, 10).rotateX(-Math.PI / 2), white, 0, 0, -3.1);              // spinner
  add(new THREE.BoxGeometry(0.1, 0.9, 1.2), white, 0.42, 0.05, 0.6, 0.12);                          // side stripes
  add(new THREE.BoxGeometry(0.1, 0.9, 1.2), white, -0.42, 0.05, 0.6, -0.12);
  // open cockpit behind the upper wing: coaming, windscreen, pilot's helmet
  add(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 12), dark, 0, 0.5, 0.75);
  add(new THREE.BoxGeometry(0.6, 0.32, 0.06), glass, 0, 0.66, 0.3, 0).rotation.x = -0.5;
  add(new THREE.SphereGeometry(0.2, 10, 8), white, 0, 0.72, 0.8);
  // wings: upper staggered forward, lower on the fuselage's belly; white stripes near the tips
  const wing = (span, y, z, dihedral) => {
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(span / 2, 0.14, 1.25), red, s * span / 4, y, z, s * dihedral);
      add(new THREE.BoxGeometry(0.45, 0.15, 1.27), white, s * (span / 2 - 0.55), y + s * Math.sin(dihedral) * (span / 4 - 0.55), z, s * dihedral);
    }
  };
  wing(7.2, 1.05, -0.95, 0);
  wing(6.4, -0.48, -0.55, 0.05);
  for (const s of [-1, 1]) {
    // N-struts between the wings, cabane struts from the fuselage to the upper wing
    add(new THREE.BoxGeometry(0.08, 1.55, 0.1), metal, s * 2.55, 0.3, -1.25, 0).rotation.x = 0.2;
    add(new THREE.BoxGeometry(0.08, 1.55, 0.1), metal, s * 2.55, 0.3, -0.4, 0).rotation.x = 0.2;
    add(new THREE.BoxGeometry(0.07, 0.75, 0.08), metal, s * 0.45, 0.7, -1.2, -s * 0.35);
    // landing gear: legs and spats
    add(new THREE.BoxGeometry(0.1, 1.0, 0.18), metal, s * 0.75, -0.95, -1.3, s * 0.45);
    add(new THREE.SphereGeometry(0.28, 10, 6).scale(0.65, 1, 1.9), red, s * 0.98, -1.45, -1.3);
  }
  add(new THREE.BoxGeometry(0.1, 0.12, 0.7), metal, 0, -0.55, -1.3);
  // tail: tailplane, fin and rudder with white stripes
  add(new THREE.BoxGeometry(2.6, 0.1, 0.8), red, 0, 0.1, 2.75);
  add(new THREE.BoxGeometry(0.1, 1.2, 0.95), red, 0, 0.7, 2.85);
  add(new THREE.BoxGeometry(0.12, 0.22, 0.97), white, 0, 0.72, 2.86);
  add(new THREE.BoxGeometry(0.12, 0.22, 0.97), white, 0, 1.06, 2.86);
  const prop = add(new THREE.BoxGeometry(2.3, 0.18, 0.06), dark, 0, 0, -3.0);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.18, 24), new THREE.MeshBasicMaterial({ color: '#262d34', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  disc.position.set(0, 0, -3.02); g.add(disc);
  scene.add(g);
  return { group: g, tips: [new V3(-3.6, 1.05, -0.4), new V3(3.6, 1.05, -0.4)], puffs: makeSmoke(scene, new V3(0, -0.8, 0.9)),
           update(dt, P) { prop.rotation.z += dt * (P.boosting ? 58 : 40); } };
}
