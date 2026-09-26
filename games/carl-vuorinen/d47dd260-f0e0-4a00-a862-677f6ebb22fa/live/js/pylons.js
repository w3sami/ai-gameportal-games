'use strict';
/* Pylon gates' look (course format in js/sim.js): meshes, which gate is lit as next, and the hit animation.
   Kept out of js/game.js so the look can change without touching the game loop.
   createPylonKit(routeHex) is called once by startGame(); build(group) after every course load (PYLONS/HOOPS from sim.js).
   Look: every pylon is white with a coloured band (blue = air gate, red = single pylon); the next gate's pylons swap
   to coloured with a white band and a route-coloured tip. Single pylons of the next and following gate carry a
   chevron pointing to the side to pass. */
function createPylonKit(routeHex) {
  const shared = (m) => { m.userData.shared = true; return m; };   // survive disposeGroup() on course switches
  const MAT = {
    white: shared(new THREE.MeshLambertMaterial({ color: '#f4f4f0' })),
    G: shared(new THREE.MeshLambertMaterial({ color: '#2f6fe0' })),        // air gate: between the pair, wings level
    single: shared(new THREE.MeshLambertMaterial({ color: '#ff4a1c' })),   // single pylon: pass on the chevron's side
    tip: shared(new THREE.MeshBasicMaterial({ color: routeHex })),
  };
  const CHEVRON = {
    next: shared(new THREE.MeshBasicMaterial({ color: routeHex, side: THREE.DoubleSide })),
    soon: shared(new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide })),
  };
  const CHEVRON_PTS = [[-2.2, 2.3], [-0.5, 2.3], [2.3, 0], [-0.5, -2.3], [-2.2, -2.3], [0.6, 0]];
  let meshes = [];   // per PYLONS entry: its group (userData: body segments, band, tip, hit animation)
  let gates = [];    // per gate: { pylons: [group], chevrons: [mesh], colour, state } or null for a hoop

  // tapered pylon, foot at the group's origin: body, band, body, tip
  function buildPylon(group, py) {
    const g = new THREE.Group(), H = py.y1 - py.y0;
    const seg = (a, b) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(lerp(py.r0, py.r1, b), lerp(py.r0, py.r1, a), (b - a) * H, 16), MAT.white);
      m.position.y = (a + b) / 2 * H; g.add(m); return m;
    };
    g.userData = { body: [seg(0, 0.62), seg(0.7, 0.85)], band: seg(0.62, 0.7), tip: seg(0.85, 1), hitT: -1, lean: new THREE.Vector3() };
    g.position.set(py.x, py.y0, py.z);
    group.add(g);
    return g;
  }
  function paint(gate, next) {
    for (const g of gate.pylons) {
      const u = g.userData;
      for (const b of u.body) b.material = next ? gate.colour : MAT.white;
      u.band.material = next ? MAT.white : gate.colour;
      u.tip.material = next ? MAT.tip : MAT.white;
    }
  }
  function build(group) {
    meshes = PYLONS.map((py) => buildPylon(group, py));
    const chevronGeo = new THREE.ShapeGeometry(new THREE.Shape(CHEVRON_PTS.map(([x, y]) => new THREE.Vector2(x, y))));
    gates = HOOPS.map((h) => {
      if (h.kind === 'hoop') return null;
      const gate = { pylons: h.pylons.map((k) => meshes[k]), chevrons: [], colour: h.kind === 'G' ? MAT.G : MAT.single, state: null };
      if (h.kind !== 'G') {                                  // chevron on the pylon's face, pointing at the circle
        const py = PYLONS[h.pylons[0]], x = new THREE.Vector3(h.pos.x - py.x, 0, h.pos.z - py.z).normalize();
        const z = new THREE.Vector3(-h.normal.x, 0, -h.normal.z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
        const c = new THREE.Mesh(chevronGeo, CHEVRON.next);
        c.position.set(py.x, h.pos.y, py.z).addScaledVector(z, lerp(py.r0, py.r1, (h.pos.y - py.y0) / (py.y1 - py.y0)) + 0.3);
        c.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
        c.visible = false; group.add(c); gate.chevrons.push(c);
      }
      paint(gate, false);
      return gate;
    });
  }
  // next: index of the next gate; t: clock for the chevron pulse
  function update(next, t) {
    gates.forEach((gate, i) => {
      if (!gate) return;
      const rel = i - next, state = rel === 0 ? 'next' : rel === 1 ? 'soon' : 'off';
      if (state !== gate.state) { gate.state = state; paint(gate, state === 'next'); }
      for (const c of gate.chevrons) {
        c.visible = state !== 'off';
        c.material = state === 'next' ? CHEVRON.next : CHEVRON.soon;
        c.scale.setScalar(state === 'next' ? 1 + Math.sin(t * 6) * 0.06 : 1);
      }
    });
  }
  // hit pylons sag and lean away from where they were struck
  function animate(dt) {
    for (const g of meshes) {
      const u = g.userData;
      if (u.hitT < 0 || u.hitT > 1) continue;
      u.hitT += dt;
      const k = smoothstep(0, 0.5, u.hitT);
      g.scale.set(1 + 0.35 * k, 1 - 0.8 * k, 1 + 0.35 * k);
      g.rotation.set(u.lean.z * 0.5 * k, 0, -u.lean.x * 0.5 * k);
    }
  }
  function hit(k, from) {
    const py = PYLONS[k], u = meshes[k].userData;
    py.hit = true;                                           // one penalty per pylon per run; it stays deflated
    u.hitT = 0; u.lean.set(py.x - from.x, 0, py.z - from.z).normalize();
  }
  function reset() {
    PYLONS.forEach((py) => { py.hit = false; });
    for (const g of meshes) { g.userData.hitT = -1; g.scale.set(1, 1, 1); g.rotation.set(0, 0, 0); }
  }
  return { build, update, animate, hit, reset };
}
