'use strict';
/* =========================================================================
   WIND TURBINES — white three-bladed turbines, turning, as a js/shore.js plugin.
   Course file: turbines: { face, h, r, rpm, list: [[x, z], [x, z, h, r], ...] }
     face   [dx, dz] the way the rotors face: into the wind (default [0, 1])
     h      hub height above the ground (m, default 70); r: rotor radius (m, default 30); rpm: turns a minute (default 13)
     list   where each stands, optionally with its own hub height and rotor radius
   Everything is a crash ('turbine'): the tower, the nacelle and the whole disc the blades sweep (at their speed a
   glider doesn't get through between them), filed as boxes: the disc as horizontal slices that follow its circle.
   Sim part (no DOM): buildTurbines() (a SHORE plugin), turbineList() for the tests: per turbine x, z, foot, hub, r,
   fx, fz (facing) and the rotor's centre rx, rz. Game part: the meshes, the rotors turning in onBeforeRender.
   ========================================================================= */
const TB_DEF = { face: [0, 1], h: 70, r: 30, rpm: 13 };
const TB_ROTOR = 5.5;                                         // rotor plane ahead of the tower's axis (m)
const TB_SLICES = 12;                                         // horizontal crash slices across the disc
let _tbFor = null;
const _tb = [];
function turbineList() {
  if (_tbFor === COURSE) return _tb;
  _tbFor = COURSE; _tb.length = 0;
  const spec = COURSE && COURSE.turbines;
  if (!spec) return _tb;
  const o = Object.assign({}, TB_DEF, spec), fl = Math.hypot(o.face[0], o.face[1]) || 1, fx = o.face[0] / fl, fz = o.face[1] / fl;
  for (const p of spec.list || []) {
    const foot = heightAt(p[0], p[1]), h = p[2] || o.h, r = p[3] || o.r;
    _tb.push({ x: p[0], z: p[1], foot, hub: foot + h, r, fx, fz, rx: p[0] + fx * TB_ROTOR, rz: p[1] + fz * TB_ROTOR, rpm: o.rpm });
  }
  return _tb;
}

/* ---------- crash boxes (a js/shore.js plugin) ---------- */
function buildTurbines() {
  for (const t of turbineList()) {
    shoreBox('turbine', t.x, t.z, t.fx, t.fz, 2.4, 2.4, t.foot - 2, t.hub);                            // tower
    shoreBox('turbine', t.x + t.fx * 1.5, t.z + t.fz * 1.5, t.fx, t.fz, 6, 2, t.hub - 2.2, t.hub + 2.4);   // nacelle and hub
    // the swept disc: slices across it (u = across the wind, v = along it), each as wide as the circle gets in it
    for (let k = 0; k < TB_SLICES; k++) {
      const ya = -t.r + 2 * t.r * k / TB_SLICES, yb = ya + 2 * t.r / TB_SLICES, ym = Math.abs(ya + yb) / 2 < t.r / TB_SLICES ? 0 : Math.min(Math.abs(ya), Math.abs(yb));
      const half = Math.sqrt(Math.max(0, t.r * t.r - ym * ym)) + 1.2;
      shoreBox('turbine', t.rx, t.rz, -t.fz, t.fx, half, 1.6, t.hub + ya - 1.2, t.hub + yb + 1.2);
    }
  }
}

/* ---------- meshes ---------- */
function createTurbineKit() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.shared = true;
  const Mx = createMesher(), { BOX, CYL, CONE } = Mx.G;
  const C = (h) => new THREE.Color(h);
  const WHITE = C('#eef0ee'), GREY = C('#c9ccca'), RED = C('#c8362e'), CONCRETE = C('#b3ada2');
  // one rotor: three tapered blades with red tips and the spinner, in the rotor's own frame (blades in x-y, +z facing
  // the wind), built once per radius
  const _v = new THREE.Vector3(), _m = new THREE.Matrix4();
  const turn = (attr, a) => { _m.makeRotationZ(a); for (let i = 0; i < attr.count; i++) attr.setXYZ(i, ..._v.fromBufferAttribute(attr, i).applyMatrix4(_m).toArray()); };
  const plate = (pts, t) => Mx.flat(new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))), { depth: t, bevelEnabled: false }).translate(0, 0, -t / 2));
  function rotorGeometry(R) {
    Mx.reset();
    Mx.frame(0, 0, 0, 0, -1);                                 // identity: the rotor frame is the mesher's
    const blade = plate([[-0.6, 1.2], [1.6, 3.5], [1.1, R * 0.45], [0.45, R * 0.88], [-0.4, R * 0.88], [-0.55, R * 0.45]], 0.35);
    const tip = plate([[0.45, R * 0.88], [0.3, R], [-0.25, R], [-0.4, R * 0.88]], 0.3);
    for (let k = 0; k < 3; k++) {
      Mx.part(blade, WHITE, 0, 0, 0, 1, 1, 1);
      Mx.part(tip, RED, 0, 0, 0, 1, 1, 1);
      turn(blade, TAU / 3); turn(tip, TAU / 3);
    }
    Mx.part(CONE, WHITE, 0, 0, 0.3, 1.5, 3.0, 1.5, 0, Math.PI / 2);   // spinner, pointing into the wind
    return Mx.mesh(mat).geometry;
  }
  return {
    build(group) {
      const TB = turbineList();
      if (!TB.length) return;
      Mx.reset();
      const TOWER = Mx.flat(new THREE.CylinderGeometry(1.25, 2.2, 1, 12, 1).translate(0, 0.5, 0));   // tapering, 1 m tall
      for (const t of TB) {
        const H = t.hub - t.foot;
        Mx.frame(t.x, 0, t.z, t.fx, t.fz);
        Mx.part(CYL, CONCRETE, 0, t.foot - 1.5, 0, 5, 2.2, 5);                        // foundation
        Mx.part(TOWER, WHITE, 0, t.foot, 0, 1, H - 1.2, 1);
        Mx.part(BOX, WHITE, 0, t.hub - 2, -1.5, 3.2, 3.6, 9.5);                       // nacelle, its front at the rotor
        Mx.part(BOX, GREY, 0, t.hub + 1.6, 1.8, 0.5, 0.4, 0.5);                       // anemometer mast
      }
      const body = Mx.mesh(mat);
      if (body) group.add(body);
      const geos = new Map();                                 // one rotor geometry per radius
      for (const t of TB) {
        if (!geos.has(t.r)) geos.set(t.r, rotorGeometry(t.r));
        const holder = new THREE.Group();                     // at the hub, turned to face the wind
        holder.position.set(t.rx, t.hub, t.rz);
        holder.rotation.y = Math.atan2(t.fx, t.fz);
        const rotor = new THREE.Mesh(geos.get(t.r), mat), w = t.rpm / 60 * TAU, ph = (t.x * 0.37 + t.z * 0.11) % TAU;
        rotor.rotation.z = ph;
        rotor.onBeforeRender = function () {                  // world matrices are already done this frame: redo this one's
          this.rotation.z = ph - (performance.now() / 1000) * w;
          this.updateMatrix(); this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
        };
        holder.add(rotor);
        group.add(holder);
      }
    },
  };
}
SHORE_PLUGINS.push({ build: buildTurbines, createKit: createTurbineKit });
var CRASH_TEXT = CRASH_TEXT || {};
CRASH_TEXT.turbine = 'Hit a wind turbine';
