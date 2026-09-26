'use strict';
/* =========================================================================
   GAME — rendering, input, audio, UI. Uses the simulation core (js/sim.js).
   startGame(api) runs once the first course has been built (see js/boot.js); api.loadCourse(entry) builds another.
   ========================================================================= */
function startGame(api) {
const $ = (id) => document.getElementById(id);
const body = document.body;
const canvas = $('scene');
const V3 = THREE.Vector3;

/* ---------- settings (per-viewer, optional) ---------- */
const STORE_KEY = 'skyrace.v1', OLD_STORE_KEY = 'magenta-line.v1';   // prototype name; carried over once
const settings = (() => {
  const d = { invertPitch: false, muted: false, mouseSens: 1, best: {}, course: null };   // course: last picked (boot.js reads it)
  let s = d;
  try { s = Object.assign(d, JSON.parse(localStorage.getItem(STORE_KEY) || localStorage.getItem(OLD_STORE_KEY) || '{}')); } catch (e) { /* keep defaults */ }
  if (typeof s.best === 'number') s.best = { valley: s.best };              // single-course prototype saves
  if (!s.best || typeof s.best !== 'object') s.best = {};
  return s;
})();
const getBest = () => (settings.best[COURSE.id] == null ? null : settings.best[COURSE.id]);   // best times are per course
const saveSettings = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* no storage: settings last this session */ } };
const mq = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
const reducedMotion = mq('(prefers-reduced-motion: reduce)');
if (mq('(pointer: coarse)')) body.classList.add('is-touch');
const isTouchUI = () => body.classList.contains('is-touch');

/* ---------- renderer ---------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 1.5, powerPreference: 'high-performance' });
} catch (e) {
  showFatal('This game needs WebGL, which is turned off or unavailable in this browser.');
  return;
}
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 6500);
const view = { w: 1, h: 1 };
function resize() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  if (w === view.w && h === view.h) return;
  view.w = w; view.h = h;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));   // DPR 3 costs 2.25x the pixels
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  body.classList.toggle('is-portrait', h > w);
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
resize();

/* ---------- world ---------- */
const COL = {
  sky: new THREE.Color('#5c9bd2'), horizon: new THREE.Color('#cfe1ec'),
  meadow: new THREE.Color('#8cab69'), valley: new THREE.Color('#a3bb78'), forest: new THREE.Color('#62834b'),
  dry: new THREE.Color('#aca66e'), rock: new THREE.Color('#8b857a'), high: new THREE.Color('#b5afa3'),
  sand: new THREE.Color('#cfc190'), water: new THREE.Color('#5a8fb2'), snow: new THREE.Color('#eef2f4'),
};
scene.fog = new THREE.Fog(COL.horizon, 320, 2150);
scene.background = COL.horizon;
const SUN_DIR = new V3(-0.42, 0.62, 0.66).normalize();
scene.add(new THREE.HemisphereLight('#e0eeff', '#56663e', 1.3));
const sunLight = new THREE.DirectionalLight('#fff3df', 2.4);
sunLight.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sunLight);

const sky = (() => {
  const R = 4800, g = new THREE.SphereGeometry(R, 32, 16), p = g.attributes.position;
  const cols = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / R;
    c.copy(COL.horizon).lerp(COL.sky, y > 0 ? Math.pow(y, 0.55) : 0);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -2; m.frustumCulled = false; scene.add(m);
  return m;
})();
const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(95, 32), new THREE.MeshBasicMaterial({ color: '#fff7e3', fog: false, depthWrite: false }));
sunDisc.renderOrder = -1; scene.add(sunDisc);

/* ---------- scenery: rebuilt whenever a course is loaded ----------
   Defaults are the Valley Run look; a course file can override palette (heights where colours blend), view (camera
   range and fog) and clouds (see the course format in js/sim.js). */
const PALETTE = { dry: [40, 170], forestTop: [150, 225], high: [185, 275], snow: null, pathTint: true };
const VIEW = { near: 0.5, far: 6500, fog: [320, 2150] };
const CLOUDS = { count: 46, y: [190, 360], size: [16, 36], near: 18, nearR: [75, 185], nearY: [32, 82], nearSize: [9, 18] };
const span = (r, t) => r[0] + (r[1] - r[0]) * t;
let worldGroup = null, sunDist = 4200;
function disposeGroup(g) {
  scene.remove(g);
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = !o.material ? [] : Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (!m.userData.shared) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}
function buildScenery() {
  if (worldGroup) disposeGroup(worldGroup);
  worldGroup = new THREE.Group(); scene.add(worldGroup);
  const v = Object.assign({}, VIEW, COURSE.view);
  camera.near = v.near; camera.far = v.far; camera.updateProjectionMatrix();
  scene.fog.near = v.fog[0]; scene.fog.far = v.fog[1];
  const k = v.far / VIEW.far;                               // sky dome, sun and outer plain grow with the view range
  sky.scale.setScalar(k); sunDisc.scale.setScalar(k); sunDist = 4200 * k;
  buildTerrainMesh(worldGroup, Math.max(9000, v.far * 1.4));
  buildTrees(worldGroup);
  buildClouds(worldGroup);
  buildHoops(worldGroup);
}

function buildTerrainMesh(group, plainR) {
  const PAL = Object.assign({}, PALETTE, COURSE.palette);
  const N = TER.N, W = N + 1, cell = TER.CELL, pos = new Float32Array(N * N * 18), col = new Float32Array(N * N * 18);
  const rand = mulberry32(5), c = new THREE.Color(), e1 = new V3(), e2 = new V3(), nrm = new V3();
  let o = 0;
  function colour(x, z, h, ny, k) {
    const s = TNEAR[k] >= 0 ? SAMPLES[TNEAR[k]] : null, d = TDIST[k];
    if (h < TER.WATER + 2.2) c.copy(COL.sand);
    else {
      c.copy(COL.meadow).lerp(COL.dry, smoothstep(PAL.dry[0], PAL.dry[1], h));
      const f = noiseB(x * 0.006 + 40, z * 0.006 - 13);
      if (f > 0.52) c.lerp(COL.forest, smoothstep(0.52, 0.66, f) * (1 - smoothstep(PAL.forestTop[0], PAL.forestTop[1], h)));
      c.lerp(COL.high, smoothstep(PAL.high[0], PAL.high[1], h));
      if (PAL.pathTint && s && d < s.width + 25) c.lerp(COL.valley, 0.45 * (1 - smoothstep(s.width, s.width + 25, d)));
    }
    c.lerp(COL.rock, smoothstep(0.84, 0.62, ny));
    if (PAL.snow && h > PAL.snow[0]) c.lerp(COL.snow, smoothstep(PAL.snow[0], PAL.snow[1], h) * smoothstep(0.5, 0.78, ny));   // steep faces stay rock
    const j = 0.93 + rand() * 0.12;
    c.r *= j; c.g *= j; c.b *= j;
  }
  function tri(ax, ay, az, bx, by, bz, cx, cy, cz, k) {
    pos.set([ax, ay, az, bx, by, bz, cx, cy, cz], o);
    e1.set(bx - ax, by - ay, bz - az); e2.set(cx - ax, cy - ay, cz - az); nrm.crossVectors(e1, e2).normalize();
    colour((ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, nrm.y, k);
    for (let v = 0; v < 3; v++) { col[o + v * 3] = c.r; col[o + v * 3 + 1] = c.g; col[o + v * 3 + 2] = c.b; }
    o += 9;
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x0 = TER.X0 + i * cell, x1 = x0 + cell, z0 = TER.Z0 + j * cell, z1 = z0 + cell, k = j * W + i;
    const h00 = TH[k], h10 = TH[k + 1], h01 = TH[k + W], h11 = TH[k + W + 1];
    tri(x0, h00, z0, x0, h01, z1, x1, h11, z1, k);        // same split as heightAt()
    tri(x0, h00, z0, x1, h11, z1, x1, h10, z0, k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();                                 // non-indexed: flat, faceted shading
  group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })));

  const water = new THREE.Mesh(new THREE.PlaneGeometry(TER.SIZE, TER.SIZE).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: COL.water }));
  water.position.set(TER.CX, TER.WATER, TER.CZ); group.add(water);

  const S = TER.SIZE / 2, O = plainR;                       // flat plain beyond the terrain square
  const shape = new THREE.Shape([new THREE.Vector2(-O, -O), new THREE.Vector2(O, -O), new THREE.Vector2(O, O), new THREE.Vector2(-O, O)]);
  shape.holes.push(new THREE.Path([new THREE.Vector2(-S, -S), new THREE.Vector2(-S, S), new THREE.Vector2(S, S), new THREE.Vector2(S, -S)]));
  const plain = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: COL.meadow }));
  plain.position.set(TER.CX, TER.EDGE - 0.05, TER.CZ); group.add(plain);
}

function buildTrees(group) {
  const n = TREES.x.length;
  if (!n) return;
  const geo = new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0).toNonIndexed();
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3(), p = new V3(), c = new THREE.Color(), rand = mulberry32(3);
  const g1 = new THREE.Color('#3b6838'), g2 = new THREE.Color('#5d8c46');
  for (let i = 0; i < n; i++) {
    q.setFromAxisAngle(WORLD_UP, rand() * TAU);
    mesh.setMatrixAt(i, m.compose(p.set(TREES.x[i], TREES.y[i], TREES.z[i]), q, s.set(TREES.r[i], TREES.h[i], TREES.r[i])));
    mesh.setColorAt(i, c.copy(g1).lerp(g2, rand()));
  }
  mesh.frustumCulled = false; group.add(mesh);
}

function buildClouds(group) {
  const C = Object.assign({}, CLOUDS, COURSE.clouds), rand = mulberry32(11), puffs = [];
  const cloud = (x, y, z, size) => {
    const n = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) puffs.push([x + (rand() - 0.5) * size * 2.4, y + (rand() - 0.5) * size * 0.5, z + (rand() - 0.5) * size * 1.6, size * (0.55 + rand() * 0.55)]);
  };
  for (let i = 0; i < C.count; i++) cloud(TER.X0 + rand() * TER.SIZE, span(C.y, rand()), TER.Z0 + rand() * TER.SIZE, span(C.size, rand()));
  for (let i = 0; i < C.near; i++) {                        // closer to the course, off to the side
    const sp = SAMPLES[Math.floor(rand() * SAMPLES.length)], a = rand() * TAU, r = span(C.nearR, rand());
    cloud(sp.x + Math.cos(a) * r, sp.y + span(C.nearY, rand()), sp.z + Math.sin(a) * r, span(C.nearSize, rand()));
  }
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#aab9c6' }), puffs.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new V3(), s = new V3();
  puffs.forEach((pf, i) => {
    q.setFromEuler(e.set(rand() * 3, rand() * 3, rand() * 3));
    mesh.setMatrixAt(i, m.compose(p.set(pf[0], pf[1], pf[2]), q, s.set(pf[3], pf[3] * 0.62, pf[3])));
  });
  mesh.frustumCulled = false; group.add(mesh);
}

/* ---------- hoops ---------- */
const ROUTE_HEX = '#ff2b95';
const hoopMat = {
  next: new THREE.MeshBasicMaterial({ color: ROUTE_HEX }),
  soon: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  later: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }),
};
for (const k in hoopMat) hoopMat[k].userData.shared = true;   // outlive course switches
const Z_AXIS = new V3(0, 0, 1);
let hoopMeshes = [];
const gateDisc = new THREE.Mesh(new THREE.CircleGeometry(7.4, 40),
  new THREE.MeshBasicMaterial({ color: ROUTE_HEX, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
scene.add(gateDisc);
function buildHoops(group) {
  const geo = new THREE.TorusGeometry(TUNE.HOOP_R, 0.75 * TUNE.HOOP_R / 8, 8, 44);
  hoopMeshes = HOOPS.map((h) => {
    const m = new THREE.Mesh(geo, hoopMat.later);
    m.position.copy(h.pos); m.quaternion.setFromUnitVectors(Z_AXIS, h.normal);
    m.userData.fade = 0; m.userData.flash = null;
    group.add(m);
    return m;
  });
  gateDisc.scale.setScalar((TUNE.HOOP_R - 0.6) / 7.4);
}

/* ---------- plane models (nose along -Z), one per vehicle; the course's vehicle picks ---------- */
function modelKit(g) {
  return (geo, mat, x, y, z, rz = 0) => {
    const flat = geo.index ? geo.toNonIndexed() : geo; flat.computeVertexNormals();
    const m = new THREE.Mesh(flat, mat); m.position.set(x, y, z); m.rotation.z = rz; g.add(m); return m;
  };
}
function makePropModel() {
  const g = new THREE.Group(), add = modelKit(g);
  const white = new THREE.MeshLambertMaterial({ color: '#f3f1ea' }), orange = new THREE.MeshLambertMaterial({ color: '#ff5a1f' });
  const dark = new THREE.MeshLambertMaterial({ color: '#27313b' }), glass = new THREE.MeshLambertMaterial({ color: '#2d4a63', emissive: '#0d1b28' });
  add(new THREE.CylinderGeometry(0.62, 0.3, 6.2, 8).rotateX(-Math.PI / 2), white, 0, 0, 0.35);
  add(new THREE.CylinderGeometry(0.52, 0.64, 1.0, 8).rotateX(-Math.PI / 2), orange, 0, 0, -3.1);
  add(new THREE.ConeGeometry(0.3, 0.7, 8).rotateX(-Math.PI / 2), dark, 0, 0, -3.95);
  add(new THREE.BoxGeometry(4.8, 0.16, 1.75), orange, -2.35, -0.22, -0.55, -0.07);   // wings with dihedral
  add(new THREE.BoxGeometry(4.8, 0.16, 1.75), orange, 2.35, -0.22, -0.55, 0.07);
  add(new THREE.BoxGeometry(3.4, 0.12, 1.0), orange, 0, 0.12, 3.05);
  add(new THREE.BoxGeometry(0.12, 1.45, 1.15), orange, 0, 0.8, 3.1);
  add(new THREE.BoxGeometry(0.78, 0.5, 1.5), glass, 0, 0.55, -0.85);
  const prop = add(new THREE.BoxGeometry(3.0, 0.2, 0.06), dark, 0, 0, -3.72);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.55, 24), new THREE.MeshBasicMaterial({ color: '#27313b', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  disc.position.set(0, 0, -3.74); g.add(disc);
  scene.add(g);
  return { group: g, tips: [new V3(-4.7, 0.1, 0.3), new V3(4.7, 0.1, 0.3)],
           update(dt, P) { prop.rotation.z += dt * (P.boosting ? 55 : 34); } };
}
function makeJetModel() {
  const g = new THREE.Group(), add = modelKit(g);
  const skin = new THREE.MeshLambertMaterial({ color: '#a3adb7' }), dark = new THREE.MeshLambertMaterial({ color: '#2a333c' });
  const orange = new THREE.MeshLambertMaterial({ color: '#ff5a1f' }), glass = new THREE.MeshLambertMaterial({ color: '#2d4a63', emissive: '#0d1b28' });
  // flat plates drawn in plan view: [x, z] outline, extruded `depth` downwards
  const plate = (pts, depth) => new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))), { depth, bevelEnabled: false }).rotateX(Math.PI / 2);
  add(new THREE.CylinderGeometry(0.85, 0.72, 10, 10).rotateX(-Math.PI / 2), skin, 0, 0, 0.8);
  add(new THREE.ConeGeometry(0.85, 4.2, 10).rotateX(-Math.PI / 2), skin, 0, 0, -6.3);
  add(new THREE.ConeGeometry(0.3, 1.1, 10).rotateX(-Math.PI / 2), dark, 0, 0, -8.0);
  add(new THREE.SphereGeometry(0.62, 12, 8).scale(1, 0.8, 2.8), glass, 0, 0.62, -4.0);
  add(new THREE.CylinderGeometry(0.66, 0.74, 1.1, 12).rotateX(-Math.PI / 2), dark, 0, 0, 6.3);   // nozzle
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.75, 1.0, 3.4), dark, s * 1.05, -0.2, -0.6);                          // intakes
    add(plate([[0.6 * s, -2.4], [5.6 * s, 2.6], [5.6 * s, 3.5], [0.6 * s, 4.4]], 0.18), skin, 0, -0.02, 0);   // delta wing
    add(plate([[0.6 * s, 5.0], [3.1 * s, 6.6], [3.1 * s, 7.2], [0.6 * s, 7.1]], 0.14), skin, 0, 0.1, 0);     // tailplane
    const fin = new THREE.ExtrudeGeometry(new THREE.Shape([[0, 0], [2.9, 0], [3.3, 2.6], [2.2, 2.6]].map(([a, b]) => new THREE.Vector2(a, b))),
      { depth: 0.14, bevelEnabled: false }).rotateY(-Math.PI / 2);                                // twin fins, canted out
    add(fin, orange, s * 0.85, 0.55, 3.6, -s * 0.32);
  }
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.55, 4, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 2), flameMat);   // base at origin, tip aft
  flame.position.z = 6.85; g.add(flame);
  scene.add(g);
  let burn = 0, t = 0;
  return { group: g, tips: [new V3(-5.6, 0, 3.05), new V3(5.6, 0, 3.05)],
           update(dt, P) {                                  // afterburner: flame grows and flickers while boosting
             t += dt; burn = lerp(burn, P.boosting ? 1 : 0, damp(8, dt));
             const w = 0.8 + 0.3 * burn;
             flame.scale.set(w, w, 0.25 + burn * (1 + 0.15 * Math.sin(t * 60)));
             flameMat.opacity = 0.3 + 0.55 * burn;
           } };
}
const models = { prop: makePropModel(), jet: makeJetModel() };
let planeModel = models.prop;
function setVehicleModel() {
  for (const k in models) models[k].group.visible = false;
  planeModel = models[TUNE.VEHICLE] || models.prop;
  planeModel.group.visible = true;
}

// altitude cue: soft shadow directly under the plane
const blob = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c), color: '#1e2a14', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  scene.add(m);
  return m;
})();

// speed streaks: static in the world, so the plane rushing past them reads as speed
const STREAKS = 90;
const streakMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, fog: false });
const streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.06, 1), streakMat, STREAKS);
streaks.frustumCulled = false; scene.add(streaks);
const streakPos = Array.from({ length: STREAKS }, () => new V3(1e9, 0, 0));

// wingtip vapour trails (camera-facing ribbons, time-based fade)
const trailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
class Trail {
  constructor(max) {
    this.max = max; this.pts = []; this.pool = [];
    this.pos = new Float32Array(max * 6); this.col = new Float32Array(max * 8);
    const idx = [];
    for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, trailMat); this.mesh.frustumCulled = false; scene.add(this.mesh);
  }
  clear() { while (this.pts.length) this.pool.push(this.pts.pop()); this.geo.setDrawRange(0, 0); }
  push(p, a, now) {
    const pt = this.pts.length >= this.max ? this.pts.pop() : (this.pool.pop() || { p: new V3(), t: 0, a: 0 });
    pt.p.copy(p); pt.t = now; pt.a = a; this.pts.unshift(pt);
  }
  update(now, life, camPos) {
    while (this.pts.length && now - this.pts[this.pts.length - 1].t > life) this.pool.push(this.pts.pop());
    const n = this.pts.length, d = Trail.d, s = Trail.s;
    for (let i = 0; i < n; i++) {
      const cur = this.pts[i], a = this.pts[Math.max(0, i - 1)].p, b = this.pts[Math.min(n - 1, i + 1)].p;
      d.copy(a).sub(b); if (d.lengthSq() < 1e-8) d.set(0, 0, 1);
      s.copy(camPos).sub(cur.p).cross(d).normalize();
      const age = (now - cur.t) / life, w = 0.12 + age * 0.9, al = cur.a * (1 - age) * (1 - age);
      const o = i * 6;
      this.pos[o] = cur.p.x + s.x * w; this.pos[o + 1] = cur.p.y + s.y * w; this.pos[o + 2] = cur.p.z + s.z * w;
      this.pos[o + 3] = cur.p.x - s.x * w; this.pos[o + 4] = cur.p.y - s.y * w; this.pos[o + 5] = cur.p.z - s.z * w;
      this.col.fill(1, i * 8, i * 8 + 8); this.col[i * 8 + 3] = al; this.col[i * 8 + 7] = al;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
  }
}
Trail.d = new V3(); Trail.s = new V3();
const trails = [new Trail(150), new Trail(150)];

/* ---------- sound ---------- */
const Sound = {
  ctx: null,
  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = settings.muted ? 0 : 0.9; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; brown = (brown + 0.02 * w) / 1.02; d[i] = brown * 2.2 + w * 0.35; }
    this.noiseBuf = buf;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 500; this.windF.Q.value = 0.7;
    this.wind = ctx.createGain(); this.wind.gain.value = 0;
    noise.connect(this.windF).connect(this.wind).connect(this.master);
    this.hissF = ctx.createBiquadFilter(); this.hissF.type = 'highpass'; this.hissF.frequency.value = 2600;
    this.hiss = ctx.createGain(); this.hiss.gain.value = 0;
    noise.connect(this.hissF).connect(this.hiss).connect(this.master);
    this.engF = ctx.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 420; this.engF.Q.value = 2.5;
    this.eng = ctx.createGain(); this.eng.gain.value = 0;
    this.osc = [['sawtooth', 62], ['square', 124.5]].map(([type, f]) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(this.engF); o.start(); return o; });
    this.cough = ctx.createGain();                          // own stage so sputter() doesn't fight update()'s per-frame automation
    this.engF.connect(this.eng).connect(this.cough).connect(this.master);
    this.rumbleF = ctx.createBiquadFilter(); this.rumbleF.type = 'lowpass'; this.rumbleF.frequency.value = 150;   // jet roar
    this.rumble = ctx.createGain(); this.rumble.gain.value = 0;
    noise.connect(this.rumbleF).connect(this.rumble).connect(this.cough);
    noise.start();
  },
  update(P, level) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    // speeds relative to cruise, so the jet's wind sounds like the plane's rather than a whistle
    const t = this.ctx.currentTime, v = P.speed, rel = v / TUNE.CRUISE, s = clamp(v / TUNE.BOOST, 0, 1.3), jet = TUNE.VEHICLE === 'jet';
    this.wind.gain.setTargetAtTime(level * (0.05 + s * s * 0.45), t, 0.1);
    this.windF.frequency.setTargetAtTime(260 + rel * 484, t, 0.1);
    this.hiss.gain.setTargetAtTime(level * smoothstep(1.09, 1.82, rel) * 0.07, t, 0.15);
    if (this.jet !== jet) { this.jet = jet; this.osc[0].type = jet ? 'triangle' : 'sawtooth'; this.osc[1].type = jet ? 'sine' : 'square'; }
    if (jet) {                                              // turbine whine over low-passed noise; afterburner opens the roar up
      const w = 780 + rel * 240 + (P.boosting ? 140 : 0);
      this.osc[0].frequency.setTargetAtTime(w, t, 0.25); this.osc[1].frequency.setTargetAtTime(w * 1.51, t, 0.25);
      this.eng.gain.setTargetAtTime(level * 0.014, t, 0.2);
      this.engF.frequency.setTargetAtTime(4000, t, 0.3);
      this.rumble.gain.setTargetAtTime(level * (P.boosting ? 0.55 : 0.2), t, 0.2);
      this.rumbleF.frequency.setTargetAtTime(P.boosting ? 260 : 150, t, 0.3);
      return;
    }
    this.rumble.gain.setTargetAtTime(0, t, 0.2);
    const f = (P.boosting ? 78 : 58) + v * 0.35;
    this.osc[0].frequency.setTargetAtTime(f, t, 0.25); this.osc[1].frequency.setTargetAtTime(f * 2.01, t, 0.25);
    this.eng.gain.setTargetAtTime(level * (P.boosting ? 0.06 : 0.035), t, 0.2);
    this.engF.frequency.setTargetAtTime(P.boosting ? 950 : 420, t, 0.3);
  },
  tone(freq, when, dur, vol, type = 'sine') {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(this.master); o.start(when); o.stop(when + dur + 0.05);
  },
  hoop(i) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const steps = [0, 2, 4, 7, 9], n = steps[i % 5] + 12 * Math.floor(i / 5), f = 440 * Math.pow(2, n / 12), t = this.ctx.currentTime;
    this.tone(f, t, 0.45, 0.16); this.tone(f * 2, t, 0.25, 0.05, 'triangle');
  },
  finish() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, t + i * 0.11, 0.7, 0.14));
  },
  crash() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx, t = c.currentTime, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noiseBuf; f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(90, t + 0.7);
    g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    src.connect(f).connect(g).connect(this.master); src.start(t); src.stop(t + 0.85);
  },
  whoosh() {                                                // boost press: rising band of noise
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx, t = c.currentTime, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noiseBuf; f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(350, t); f.frequency.exponentialRampToValueAtTime(2200, t + 0.4);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random() * 1.2); src.stop(t + 0.6);
  },
  sputter() {                                               // boost ran dry: engine coughs three times
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, g = this.cough.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(1, t);
    for (let i = 0; i < 3; i++) {
      const a = t + i * 0.11;
      g.linearRampToValueAtTime(0.15, a + 0.02); g.linearRampToValueAtTime(1, a + 0.08);
      this.pop(a, 0.2 - i * 0.05);
    }
  },
  pop(when, vol) {
    const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noiseBuf; f.type = 'lowpass'; f.frequency.value = 500;
    g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
    src.connect(f).connect(g).connect(this.master); src.start(when, Math.random() * 1.5); src.stop(when + 0.08);
  },
  setMuted(m) { if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05); },
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); },
};

/* ---------- game state ---------- */
const P = makePlane();
const G = { state: 'attract', next: 0, started: false, time: 0, invuln: 0, crashTimer: 0, lap: 'attract', pauseReason: null, clock: 0 };
const aim = { yaw: 0, pitch: 0 };
const aimDir = new V3(0, 0, -1);
const START_POS = new V3(), START_DIR = new V3();         // set per course by applyCourse()
const cam = { dir: new V3(0, 0, -1), up: new V3(0, 1, 0), dist: 12.5, fov: 60, shake: 0, vx: 0, vy: 0, boost: 0, punchT: 1e9 };

function setAimFrom(dir, maxPitch = 0.7) { aim.yaw = yawOf(dir); aim.pitch = clamp(pitchOf(dir), -maxPitch, maxPitch); dirFromYawPitch(aim.yaw, aim.pitch, aimDir); }

function resetRun() {
  placePlane(P, START_POS, START_DIR, TUNE.CRUISE);
  P.boost = 1; P.boostLock = false; P.boosting = false;
  G.next = 0; G.started = false; G.time = 0; G.invuln = 0.4; G.crashTimer = 0;
  setAimFrom(START_DIR); input.neutral = true;
  hoopMeshes.forEach((m) => { m.visible = true; m.userData.fade = 0; if (m.userData.flash) { m.userData.flash.dispose(); m.userData.flash = null; } });
  trails.forEach((t) => t.clear());
  planeModel.group.visible = true;
  updateCamera(0, true);
}

function respawn() {
  const h = G.next > 0 ? HOOPS[G.next - 1] : null;
  const pos = h ? h.pos.clone().addScaledVector(h.normal, 4) : START_POS;
  placePlane(P, pos, h ? h.normal : START_DIR, TUNE.CRUISE);
  setAimFrom(P.vdir); input.neutral = true;
  G.invuln = 1.2;
  planeModel.group.visible = true;
  trails.forEach((t) => t.clear());
  updateCamera(0, true);
}

function onHoop() {
  const i = G.next;
  G.next++;
  P.boost = Math.min(1, P.boost + TUNE.BOOST_HOOP);
  const m = hoopMeshes[i];
  if (m.userData.flash) m.userData.flash.dispose();
  m.userData.flash = hoopMat.next.clone(); m.userData.flash.transparent = true; m.userData.flash.depthWrite = false;
  m.material = m.userData.flash; m.userData.fade = 1;
  if (G.state !== 'playing') return;
  if (i === 0) G.started = true;
  Sound.hoop(i);
  bump($('hud-hoops'));
  if (G.next >= HOOPS.length) finishRun();
}

function onCrash(kind) {
  G.crashTimer = 0.9;
  cam.shake = reducedMotion ? 0 : 1;
  planeModel.group.visible = false;
  if (G.state !== 'playing') return;
  Sound.crash();
  flash();
  showToast(G.next > 0 ? `${kind === 'tree' ? 'Clipped a tree' : 'Crashed'}. Back to hoop ${G.next}.` : `${kind === 'tree' ? 'Clipped a tree' : 'Crashed'}. Back to the start.`);
}

/* ---------- input ---------- */
const input = {
  keys: new Set(),
  mouse: { locked: false, lockFailed: false, cursorX: 0, cursorY: 0, cursorActive: false },
  stick: { active: false, id: -1, bx: 0, by: 0, x: 0, y: 0 },
  boost: { active: false, id: -1 },
  device: isTouchUI() ? 'touch' : 'mouse',
  manual: false,
  neutral: true,        // no active input: ease wings level and flatten the climb, keep the heading
  climb: { od: 0, odSign: 0 },   // ramp state for holding the stick at the end of its vertical throw
  padStart: false,
};
const FLIGHT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space']);
// Touch stick commands a bank angle and a climb angle. Big throw + expo curve = fine control near centre.
const STICK_R = 80, AIM_LEASH = 1.05;
const stickEl = $('stick'), knobEl = $('stick-knob');
const shapeAxis = (v, dz) => { const a = Math.abs(v); return a < dz ? 0 : Math.sign(v) * Math.pow(Math.min(1, (a - dz) / (1 - dz)), 1.7); };
const _nose = new V3();
function syncAim() { setAimFrom(forwardOf(P, _nose)); }   // aim where the nose already points: nothing to swing back to

function setDevice(d) {
  if (input.device === d) return;
  input.device = d;
  body.classList.toggle('is-touch', d === 'touch');
}
function stickEnd() {
  if (!input.stick.active) return;
  input.stick.active = false; input.stick.id = -1; input.stick.x = input.stick.y = 0; stickEl.classList.remove('is-on');
  input.neutral = true; input.climb.od = 0;                                      // let go = ease to level
}
function boostEnd() { input.boost.active = false; input.boost.id = -1; }
function capture(id) { try { canvas.setPointerCapture(id); } catch (e) { /* synthetic or already released */ } }

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') {
    setDevice('mouse');
    if (G.state === 'playing' && !input.mouse.locked && !input.mouse.lockFailed) tryLock();
    return;
  }
  setDevice('touch');
  if (G.state !== 'playing') return;
  e.preventDefault();
  if (e.clientX < view.w * 0.5 && !input.stick.active) {
    Object.assign(input.stick, { active: true, id: e.pointerId, bx: e.clientX, by: e.clientY, x: 0, y: 0 });
    stickEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; knobEl.style.transform = '';
    stickEl.classList.add('is-on'); body.classList.add('stick-used'); capture(e.pointerId);
  } else if (!input.boost.active) {
    input.boost.active = true; input.boost.id = e.pointerId; capture(e.pointerId);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') {
    input.mouse.cursorX = e.clientX; input.mouse.cursorY = e.clientY; input.mouse.cursorActive = true;
    if (input.mouse.lockFailed && G.state === 'playing') input.neutral = false;
    return;
  }
  const st = input.stick;
  if (!st.active || e.pointerId !== st.id) return;
  let dx = e.clientX - st.bx, dy = e.clientY - st.by;
  const d = Math.hypot(dx, dy);
  if (d > STICK_R) {                          // base follows the thumb past the ring
    const k = (d - STICK_R) / d; st.bx += dx * k; st.by += dy * k; dx = e.clientX - st.bx; dy = e.clientY - st.by;
    stickEl.style.transform = `translate(${st.bx}px, ${st.by}px)`;
  }
  st.x = shapeAxis(dx / STICK_R, 0.06); st.y = shapeAxis(-dy / STICK_R, 0.12);   // bigger vertical dead zone: turning shouldn't climb
  knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
});
const pointerEnd = (e) => {
  if (e.pointerId === input.stick.id) stickEnd();
  if (e.pointerId === input.boost.id) boostEnd();
};
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('lostpointercapture', pointerEnd);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

document.addEventListener('mousemove', (e) => {
  if (!input.mouse.locked || G.state !== 'playing') return;
  if (input.neutral) { syncAim(); input.neutral = false; }
  const sens = 0.0022 * settings.mouseSens;
  aim.yaw -= e.movementX * sens;
  aim.pitch = clamp(aim.pitch - e.movementY * sens * (settings.invertPitch ? -1 : 1), -1.35, 1.35);
});

// Pointer Lock: Esc always releases it, and Chrome refuses to re-lock for about a second afterwards.
let lockCb = null, lockWorked = false, lockPromises = false;
function tryLock(cb = {}) {
  if (!canvas.requestPointerLock) { input.mouse.lockFailed = true; body.classList.add('is-cursor-steer'); if (cb.onFail) cb.onFail(); return; }
  lockCb = cb;
  let attempts = 0;
  const attempt = (opts) => {
    attempts++;
    let p;
    try { p = opts ? canvas.requestPointerLock(opts) : canvas.requestPointerLock(); } catch (err) { p = Promise.reject(err); }
    if (!p || typeof p.then !== 'function') return;          // Safari: events decide
    lockPromises = true;
    p.catch((err) => {
      if (document.pointerLockElement === canvas) return;
      if (opts && err && err.name === 'NotSupportedError') return attempt(null);   // raw input unsupported
      if (attempts < 3) return setTimeout(() => { if (lockCb === cb) attempt(null); }, 1100);
      lockFailedNow();
    });
  };
  attempt({ unadjustedMovement: true });
}
function lockFailedNow() { const cb = lockCb; lockCb = null; if (cb && cb.onFail) cb.onFail(); }
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  input.mouse.locked = locked;
  body.classList.toggle('is-locked', locked);
  if (locked) {
    lockWorked = true; input.mouse.lockFailed = false; body.classList.remove('is-cursor-steer');
    const cb = lockCb; lockCb = null; if (cb && cb.onLocked) cb.onLocked();
  } else if (G.state === 'playing' && input.device === 'mouse') pause('lock');
});
document.addEventListener('pointerlockerror', () => { if (!lockPromises) lockFailedNow(); });
const cursorSteer = () => { input.mouse.lockFailed = true; body.classList.add('is-cursor-steer'); };

window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') && G.state !== 'playing') return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (G.state === 'playing') pause('key'); else if (G.state === 'paused' && e.code === 'KeyP') resumeFromUser();
    return;
  }
  if (e.code === 'KeyR' && G.state !== 'attract') { e.preventDefault(); restart(); return; }
  if (FLIGHT_KEYS.has(e.code)) {
    e.preventDefault();
    if (G.state === 'playing') { input.keys.add(e.code); if (!e.code.startsWith('Shift') && e.code !== 'Space') setDevice('mouse'); }
  }
});
window.addEventListener('keyup', (e) => input.keys.delete(e.code));
window.addEventListener('blur', () => { input.keys.clear(); stickEnd(); boostEnd(); });

function readPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) if (gp && gp.connected && gp.axes.length >= 2) return gp;
  return null;
}
const padAxis = (v) => (Math.abs(v) < 0.15 ? 0 : Math.sign(v) * (Math.abs(v) - 0.15) / 0.85);
const pressed = (gp, i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4));

function resolveControl(dt) {
  const k = input.keys, inv = settings.invertPitch ? -1 : 1;
  let p = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  let r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  let y = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
  let boost = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('Space') || input.boost.active;
  const gp = readPad();
  if (gp) {
    r += padAxis(gp.axes[0]); p += -padAxis(gp.axes[1]);
    y += (pressed(gp, 5) ? 1 : 0) - (pressed(gp, 4) ? 1 : 0);
    boost = boost || pressed(gp, 0) || pressed(gp, 7);
  }
  const ctl = { att: null, aim: null, p: 0, r: 0, y: 0, boost };
  if (p || r || y) {                                        // manual flying: raw rates, loops allowed
    ctl.p = clamp(p, -1, 1) * inv; ctl.r = clamp(r, -1, 1); ctl.y = clamp(y, -1, 1);
    input.manual = true; input.neutral = true;
    syncAim();
    return ctl;
  }
  input.manual = false;
  if (input.stick.active && TUNE.TOUCH_MODE === 'rate') {  // jet touch: roll and pitch rates, no angle limits
    ctl.r = input.stick.x; ctl.p = input.stick.y * inv;
    input.neutral = true;
    syncAim();
    return ctl;
  }
  if (input.stick.active) {                                 // touch: horizontal = bank angle, vertical = climb angle
    ctl.att = { bank: input.stick.x * TUNE.TOUCH_BANK, climb: touchClimb(input.climb, input.stick.y * inv, dt) };
    input.neutral = true;
    syncAim();
    return ctl;
  }
  if (input.neutral && TUNE.TOUCH_MODE === 'rate' && input.device === 'touch') { syncAim(); return ctl; }   // let go: hold attitude
  if (input.neutral) {                                      // nothing held: roll level, flatten out, keep heading
    ctl.att = { bank: 0, climb: 0 };
    syncAim();
    return ctl;
  }
  if (input.mouse.lockFailed && input.mouse.cursorActive && input.device === 'mouse') {
    const v = _aimTmp.set((input.mouse.cursorX / view.w) * 2 - 1, -(input.mouse.cursorY / view.h) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
    aim.yaw = yawOf(v); aim.pitch = pitchOf(v);
  }
  dirFromYawPitch(aim.yaw, aim.pitch, aimDir);
  const ang = aimDir.angleTo(P.vdir);                       // keep the aim on a leash so it stays on screen
  if (ang > AIM_LEASH) {
    if (ang > 3) aimDir.copy(P.vdir); else aimDir.copy(P.vdir).lerp(_aimTmp.copy(dirFromYawPitch(aim.yaw, aim.pitch, _aimTmp)), AIM_LEASH / ang).normalize();
    aim.yaw = yawOf(aimDir); aim.pitch = pitchOf(aimDir);
  }
  ctl.aim = aimDir;
  return ctl;
}
const _aimTmp = new V3();

function autoControl() {                                    // attract mode and victory lap
  if (G.next >= HOOPS.length) { dirFromYawPitch(yawOf(P.vdir), 0.08, aimDir); return { aim: aimDir, p: 0, r: 0, y: 0, boost: false }; }
  return { aim: autopilotAim(P, G.next, aimDir), p: 0, r: 0, y: 0, boost: false };
}

/* ---------- camera ---------- */
const BOOST_CAM_BACK = 1.2;                                 // m of extra pull-back while boosting
const BOOST_FOV_PUNCH = 4, BOOST_PUNCH_RISE = 0.1;          // deg of FOV kick on boost press; s to reach it, then decays at 4/s
const _cf = new V3(), _cu = new V3(), _want = new V3(), _wantUp = new V3(), _look = new V3();
function updateCamera(dt, snap) {
  forwardOf(P, _cf);
  _want.copy(P.vdir).multiplyScalar(0.55).addScaledVector(_cf, 0.45);
  if (G.state === 'playing' && input.device === 'mouse' && !input.manual) _want.addScaledVector(aimDir, 0.45);
  _want.normalize();
  _cu.set(0, 1, 0).applyQuaternion(P.q);
  // follow roll partially; CAM_ROLL 1 (jet) follows fully, since a part-rolled up vector goes degenerate in a loop
  const follow = TUNE.CAM_ROLL >= 1 ? 1 : reducedMotion ? Math.min(0.12, TUNE.CAM_ROLL) : TUNE.CAM_ROLL;
  _wantUp.copy(WORLD_UP).lerp(_cu, follow).normalize();
  const cs = TUNE.CAM_DIST / 12.5;                          // camera scale relative to the stunt plane's
  const boostOn = P.boosting && planeModel.group.visible ? 1 : 0;   // smoothed boost flag: reacts on press, not as speed builds
  cam.boost = snap ? boostOn : lerp(cam.boost, boostOn, damp(boostOn ? 5 : 2, dt));
  const wantDist = TUNE.CAM_DIST + (clamp((P.speed - TUNE.CRUISE) / TUNE.CRUISE, -0.34, 0.68) * 3.08 + cam.boost * BOOST_CAM_BACK) * cs;
  if (snap) { cam.dir.copy(_want); cam.up.copy(_wantUp); cam.dist = wantDist; }
  else {
    cam.dir.lerp(_want, damp(4.2, dt)).normalize();
    cam.up.lerp(_wantUp, damp(TUNE.CAM_UP_K, dt)).normalize();
    cam.dist = lerp(cam.dist, wantDist, damp(2.5, dt));
  }
  camera.position.copy(P.pos).addScaledVector(cam.dir, -cam.dist).addScaledVector(cam.up, TUNE.CAM_HEIGHT);
  const floor = groundAt(camera.position.x, camera.position.z) + 1.5;
  if (camera.position.y < floor) camera.position.y = floor;
  _look.copy(P.pos).addScaledVector(cam.dir, 16 * cs).addScaledVector(cam.up, 1.2 * cs);
  camera.up.copy(cam.up);
  camera.lookAt(_look);

  const sp = clamp((P.speed - TUNE.CRUISE) / (TUNE.BOOST - TUNE.CRUISE), -0.4, 1.3);
  if (!reducedMotion) {
    const s = cam.shake * 0.03 + Math.max(0, sp) * 0.0022;
    if (s > 0) { const t = G.clock; camera.rotateZ(Math.sin(t * 37) * s); camera.rotateX(Math.sin(t * 29 + 1.3) * s * 0.7); }
  }
  cam.shake = Math.max(0, cam.shake - dt * 2.2);
  const minV = 2 * Math.atan(Math.tan((66 * Math.PI / 180) / 2) / camera.aspect) * 180 / Math.PI;   // portrait: keep ~66° across
  const fovWant = clamp(Math.max(60 + sp * (reducedMotion ? 3 : 11), minV), 40, 100);
  cam.fov = snap ? fovWant : lerp(cam.fov, fovWant, damp(3, dt));
  // with a panel open, frame the plane beside it (right in landscape, above it in portrait)
  const panel = G.state !== 'playing', portrait = view.h > view.w;
  const tx = panel && !portrait ? 0.21 : 0, ty = panel && portrait ? 0.2 : 0;
  cam.vx = snap ? tx : lerp(cam.vx, tx, damp(3, dt)); cam.vy = snap ? ty : lerp(cam.vy, ty, damp(3, dt));
  if (snap) cam.punchT = 1e9; else cam.punchT += dt;
  const pt = cam.punchT, punch = pt < BOOST_PUNCH_RISE ? smoothstep(0, BOOST_PUNCH_RISE, pt) : Math.exp(-(pt - BOOST_PUNCH_RISE) * 4);
  camera.fov = cam.fov + punch * (reducedMotion ? 0 : BOOST_FOV_PUNCH);
  if (Math.abs(cam.vx) + Math.abs(cam.vy) > 1e-4) camera.setViewOffset(view.w, view.h, -cam.vx * view.w, cam.vy * view.h, view.w, view.h);
  else { camera.clearViewOffset(); }
}

/* ---------- per-frame visuals ---------- */
const _v = new V3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new V3(), _ba = new V3(), _bb = new V3(), _camFwd = new V3(), _rel = new V3();
function updateVisuals(dt) {
  const t = G.clock;
  planeModel.group.position.copy(P.pos);
  planeModel.group.quaternion.copy(P.q);
  planeModel.update(dt, P);

  for (let i = 0; i < hoopMeshes.length; i++) {
    const m = hoopMeshes[i];
    if (i < G.next) {
      if (m.userData.fade > 0) {
        m.userData.fade = Math.max(0, m.userData.fade - dt * 2.4);
        m.scale.setScalar(1 + (1 - m.userData.fade) * 0.7);
        m.userData.flash.opacity = m.userData.fade;
        m.visible = m.userData.fade > 0;
      } else m.visible = false;
      continue;
    }
    m.visible = true;
    const rel = i - G.next;
    m.material = rel === 0 ? hoopMat.next : rel === 1 ? hoopMat.soon : hoopMat.later;
    m.scale.setScalar(rel === 0 ? 1 + Math.sin(t * 6) * 0.035 : 1);
  }
  if (G.next < HOOPS.length) {
    gateDisc.visible = true;
    gateDisc.position.copy(hoopMeshes[G.next].position); gateDisc.quaternion.copy(hoopMeshes[G.next].quaternion);
    gateDisc.material.opacity = 0.09 + Math.sin(t * 6) * 0.04;
  } else gateDisc.visible = false;

  // shadow
  const gy = groundAt(P.pos.x, P.pos.z), alt = P.pos.y - gy;
  blob.visible = planeModel.group.visible && alt < 170;
  if (blob.visible) {
    blob.position.set(P.pos.x, gy + 0.3, P.pos.z);
    if (gy > TER.WATER) {
      const e = 4, gx = heightAt(P.pos.x + e, P.pos.z) - heightAt(P.pos.x - e, P.pos.z), gz = heightAt(P.pos.x, P.pos.z + e) - heightAt(P.pos.x, P.pos.z - e);
      _v.set(-gx / (2 * e), 1, -gz / (2 * e)).normalize();
      blob.quaternion.setFromUnitVectors(WORLD_UP, _v);
    } else blob.quaternion.identity();
    _q.setFromAxisAngle(WORLD_UP, yawOf(P.vdir)); blob.quaternion.multiply(_q);
    blob.scale.set(9 + alt * 0.05, 1, 7 + alt * 0.04);
    blob.material.opacity = 0.5 * (1 - smoothstep(15, 170, alt));
  }

  // streaks
  const inten = smoothstep(TUNE.CRUISE * 0.98, TUNE.BOOST * 0.97, P.speed) * (planeModel.group.visible ? 1 : 0);
  streakMat.opacity = 0.45 * inten;
  streaks.visible = inten > 0.02;
  if (streaks.visible) {
    camera.getWorldDirection(_camFwd);
    _q.setFromUnitVectors(Z_AXIS, P.vdir);
    _ba.crossVectors(P.vdir, WORLD_UP); if (_ba.lengthSq() < 0.01) _ba.set(1, 0, 0); _ba.normalize();
    _bb.crossVectors(_ba, P.vdir).normalize();
    const len = P.speed * 0.09, reach = 90 * TUNE.CAM_DIST / 12.5;   // recycle range grows with the chase distance
    for (let i = 0; i < STREAKS; i++) {
      const p = streakPos[i];
      _rel.copy(p).sub(camera.position);
      if (_rel.dot(_camFwd) < 1 || _rel.lengthSq() > reach * reach) {
        const r = 4 + Math.random() * 20, a = Math.random() * TAU;
        p.copy(P.pos).addScaledVector(P.vdir, 25 + Math.random() * 60).addScaledVector(_ba, Math.cos(a) * r).addScaledVector(_bb, Math.sin(a) * r);
      }
      streaks.setMatrixAt(i, _m.compose(p, _q, _s.set(1, 1, len)));
    }
    streaks.instanceMatrix.needsUpdate = true;
  }

  // wingtip trails: pulling hard, going fast, or boosting (boost draws them as strongly as a hard bank)
  const gTrail = clamp((P.gload - TUNE.TRAIL_G) / (TUNE.TRAIL_G * 1.09), 0, 1) * 0.75;
  const ti = planeModel.group.visible ? Math.max(gTrail, cam.boost * 0.75) + smoothstep(TUNE.CRUISE * 1.27, TUNE.CRUISE * 1.59, P.speed) * 0.3 : 0;
  for (let i = 0; i < 2; i++) {
    _v.copy(planeModel.tips[i]).applyQuaternion(P.q).add(P.pos);
    trails[i].push(_v, ti * 0.6, t);
    trails[i].update(t, 0.9, camera.position);
  }

  sky.position.copy(camera.position);
  sunDisc.position.copy(camera.position).addScaledVector(SUN_DIR, sunDist);
  sunDisc.lookAt(camera.position);
}

/* ---------- HUD & UI ---------- */
const hud = { time: $('hud-time'), hoops: $('hud-hoops'), speed: $('hud-speed'), boost: $('hud-boost'), arrow: $('arrow'), arrowIcon: $('arrow-icon'), arrowDist: $('arrow-dist'),
  reticle: $('reticle'), nose: $('nose'), boostBtn: $('boost-btn'), last: {} };
const fmtTime = (s) => { const cs = Math.floor(s * 100 + 1e-6), m = Math.floor(cs / 6000), r = cs % 6000; return `${m}:${String(Math.floor(r / 100)).padStart(2, '0')}.${String(r % 100).padStart(2, '0')}`; };
function setText(el, key, val) { if (hud.last[key] !== val) { hud.last[key] = val; el.textContent = val; } }
function bump(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
function toScreen(p, out) {
  _v.copy(p).project(camera);
  out.x = (_v.x + 1) * 0.5 * view.w; out.y = (1 - _v.y) * 0.5 * view.h; out.z = _v.z;
  return out;
}
const _sp = { x: 0, y: 0, z: 0 };
function updateHUD() {
  if (G.state !== 'playing' && G.state !== 'paused') return;
  setText(hud.time, 'time', fmtTime(G.time));
  setText(hud.hoops, 'hoops', `${G.next}/${HOOPS.length}`);
  setText(hud.speed, 'speed', `${Math.round(P.speed * 3.6)} km/h`);
  const b = Math.round(P.boost * 100) / 100;
  if (hud.last.boost !== b) { hud.last.boost = b; hud.boost.style.transform = `scaleX(${b})`; hud.boostBtn.style.setProperty('--level', b); }
  body.classList.toggle('is-boosting', P.boosting);
  body.classList.toggle('boost-empty', P.boostLock);

  // off-screen pointer to the next hoop
  let showArrow = false;
  if (G.next < HOOPS.length && G.crashTimer <= 0) {
    const h = HOOPS[G.next].pos;
    _v.copy(h).project(camera);
    camera.getWorldDirection(_camFwd);
    const behind = _rel.copy(h).sub(camera.position).dot(_camFwd) < 0;
    let x = _v.x, y = _v.y;
    if (behind) { x = -x; y = -y; if (Math.abs(x) + Math.abs(y) < 1e-3) y = -1; }
    if (behind || Math.abs(x) > 0.9 || Math.abs(y) > 0.85) {
      showArrow = true;
      const ang = Math.atan2(y * view.h, x * view.w), c = Math.cos(ang), s = Math.sin(ang);
      const k = Math.min((view.w / 2 - 52) / Math.max(Math.abs(c), 1e-4), (view.h / 2 - 56) / Math.max(Math.abs(s), 1e-4));
      hud.arrow.style.transform = `translate(${view.w / 2 + c * k}px, ${view.h / 2 - s * k}px)`;
      hud.arrowIcon.style.transform = `rotate(${-ang}rad)`;
      setText(hud.arrowDist, 'dist', `${Math.round(_rel.length() / 10) * 10} m`);
    }
  }
  hud.arrow.classList.toggle('is-on', showArrow);

  // mouse-aim reticle and nose marker
  const showAim = G.state === 'playing' && input.device === 'mouse' && input.mouse.locked && !input.manual && G.crashTimer <= 0;
  hud.reticle.classList.toggle('is-on', showAim); hud.nose.classList.toggle('is-on', showAim);
  if (showAim) {
    toScreen(_rel.copy(camera.position).addScaledVector(aimDir, 500), _sp);
    hud.reticle.style.transform = `translate(${_sp.x}px, ${_sp.y}px)`;
    toScreen(_rel.copy(P.pos).addScaledVector(forwardOf(P, _cf), 500), _sp);
    hud.nose.style.transform = `translate(${_sp.x}px, ${_sp.y}px)`;
  }
}

let toastTimer = 0;
function showToast(msg, ms = 2200) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('is-on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('is-on'), ms);
}
function flash() { const el = $('flash'); el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); }
function showFatal(msg) { $('fatal-msg').textContent = msg; body.classList.add('is-fatal'); }

function setState(s) {
  G.state = s;
  body.classList.remove('state-attract', 'state-playing', 'state-paused', 'state-finished');
  body.classList.add('state-' + s);
}
function focusEl(id) { const el = $(id); if (el) setTimeout(() => el.focus({ preventScroll: true }), 30); }
function blurActive() { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
function renderBest() {
  const b = getBest();
  $('start-best').textContent = b != null ? `Best ${fmtTime(b)}` : '';
  $('start-course').textContent = `${COURSE.name}, ${HOOPS.length} hoops`;
  renderPicker();
}

/* ---------- course picker (start screen, shown once there's more than one course) ---------- */
const VEHICLE_NAME = { prop: 'Stunt plane', jet: 'Fighter jet' };
const pickEl = $('course-pick');
let switching = false;
function renderPicker() {
  if (!pickEl) return;
  pickEl.hidden = api.courses.length < 2;
  pickEl.replaceChildren(...api.courses.map((c) => {
    const b = document.createElement('button'), name = document.createElement('b'), meta = document.createElement('span');
    const best = settings.best[c.id];
    b.type = 'button'; b.className = 'pick'; b.setAttribute('aria-pressed', String(c.id === COURSE.id));
    name.textContent = c.name;
    meta.textContent = (VEHICLE_NAME[c.vehicle || 'prop'] || c.vehicle) + (best != null ? ` · ${fmtTime(best)}` : '');
    b.append(name, meta);
    b.addEventListener('click', () => switchCourse(c));
    return b;
  }));
}
async function switchCourse(entry) {
  if (switching || G.state !== 'attract' || entry.id === COURSE.id) return;
  switching = true; body.classList.add('is-loading');
  try {
    await api.loadCourse(entry);                            // rebuilds the sim world; the scene follows here
    settings.course = entry.id; saveSettings();
    applyCourse(); resetRun();
    focusEl('btn-start');
  } catch (err) {
    console.error(err);
    showToast('That course didn\u2019t load. Try again.');
  } finally { switching = false; body.classList.remove('is-loading'); }
}
function applyCourse() {                                    // scene, plane, start point and texts for the loaded course
  START_POS.set(COURSE_DEF[0][0], COURSE_DEF[0][1], COURSE_DEF[0][2]);
  START_DIR.copy(HOOPS[0].pos).sub(START_POS).normalize();
  buildScenery();
  setVehicleModel();
  body.classList.toggle('vehicle-jet', TUNE.VEHICLE === 'jet');
  renderBest();
}

function startRun() {
  if (switching) return;
  Sound.init();
  blurActive();
  resetRun();
  hud.last = {};
  setState('playing');
  if (!isTouchUI() && !input.mouse.locked) tryLock({ onFail: cursorSteer });
  showToast('The clock starts at the first hoop.', 2600);
}
function restart() {
  if (G.state === 'attract') return;
  const wasPaused = G.state === 'paused';
  resetRun(); hud.last = {};
  if (wasPaused) resumeFromUser(); else { setState('playing'); if (!isTouchUI() && !input.mouse.locked && !input.mouse.lockFailed) tryLock({ onFail: cursorSteer }); }
}
function pause(reason) {
  if (G.state !== 'playing') return;
  G.pauseReason = reason;
  setState('paused');
  $('lock-note').hidden = reason !== 'lock';
  $('lock-note').textContent = 'Resume to take the mouse again.';
  input.keys.clear(); stickEnd(); boostEnd();
  Sound.suspend();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  focusEl('btn-resume');
}
function resume() {
  if (G.state !== 'paused') return;
  blurActive();
  Sound.init();
  setState('playing');
}
function resumeFromUser() {
  if (G.state !== 'paused') return;
  if (input.device === 'mouse' && !input.mouse.lockFailed && !isTouchUI()) {
    $('lock-note').hidden = false; $('lock-note').textContent = 'Taking the mouse…';
    tryLock({
      onLocked: () => { $('lock-note').textContent = 'Resume to take the mouse again.'; resume(); },
      onFail: () => {
        if (lockWorked) $('lock-note').textContent = 'The browser needs one more click. Select Resume again.';
        else { cursorSteer(); resume(); }
      },
    });
  } else resume();
}
function finishRun() {
  const t = G.time, prev = getBest(), best = prev == null || t < prev;
  if (best) { settings.best[COURSE.id] = t; saveSettings(); }
  Sound.finish();
  $('finish-time').textContent = fmtTime(t);
  $('finish-best').textContent = prev == null ? 'First time on this course, saved as your best.'
    : best ? `New best, ${(prev - t).toFixed(2)} s faster.` : `Best ${fmtTime(prev)}, ${(t - prev).toFixed(2)} s off.`;
  renderBest();
  setState('finished');
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  setTimeout(() => {                                        // victory lap behind the results
    if (G.state !== 'finished') return;
    G.next = 0;
    hoopMeshes.forEach((m) => { m.userData.fade = 0; if (m.userData.flash) { m.userData.flash.dispose(); m.userData.flash = null; } });
  }, 1200);
  focusEl('btn-again');
}
function toMenu() {
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  resetRun(); setState('attract'); focusEl('btn-start');
}

$('btn-start').addEventListener('click', startRun);
$('btn-resume').addEventListener('click', resumeFromUser);
$('btn-restart').addEventListener('click', restart);
$('btn-again').addEventListener('click', startRun);
$('btn-menu').addEventListener('click', toMenu);
$('btn-pause').addEventListener('click', () => pause('button'));
const invertEl = $('opt-invert'), soundEl = $('opt-sound'), sensEl = $('opt-sens');
invertEl.checked = settings.invertPitch; soundEl.checked = !settings.muted; sensEl.value = settings.mouseSens;
invertEl.addEventListener('change', () => { settings.invertPitch = invertEl.checked; saveSettings(); });
soundEl.addEventListener('change', () => { settings.muted = !soundEl.checked; Sound.setMuted(settings.muted); saveSettings(); });
sensEl.addEventListener('input', () => { settings.mouseSens = parseFloat(sensEl.value) || 1; saveSettings(); });
applyCourse();
document.addEventListener('visibilitychange', () => { if (document.hidden) { pause('hidden'); Sound.suspend(); } });
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); pause('hidden'); });

/* ---------- main loop ---------- */
// boost edges: press kicks the FOV and whooshes (not on rapid re-taps), running dry sputters
const fx = { was: false, lock: false, lastStart: -9 };
function boostEdges() {
  if (G.state === 'playing') {
    if (P.boosting && !fx.was && G.clock - fx.lastStart > 0.4) { fx.lastStart = G.clock; cam.punchT = 0; Sound.whoosh(); }
    if (P.boostLock && !fx.lock) Sound.sputter();
  }
  fx.was = P.boosting; fx.lock = P.boostLock;
}

const prevPos = new V3();
function update(dt) {
  G.clock += dt;
  const gp = readPad();
  if (gp) {
    const st = pressed(gp, 9);
    if (st && !input.padStart) { if (G.state === 'playing') pause('button'); else if (G.state === 'paused') resume(); else if (G.state !== 'paused') startRun(); }
    input.padStart = st;
    if (G.state === 'playing' && (Math.abs(gp.axes[0]) > 0.3 || Math.abs(gp.axes[1]) > 0.3)) setDevice('mouse');
  }
  if (G.state !== 'paused') {
    if (G.crashTimer > 0) {
      G.crashTimer -= dt;
      if (G.state === 'playing' && G.started) G.time += dt;          // crashing costs time
      if (G.crashTimer <= 0) respawn();
    } else {
      const ctl = G.state === 'playing' ? resolveControl(dt) : autoControl();
      const steps = Math.ceil(dt / (1 / 120)), h = dt / steps;
      for (let s = 0; s < steps; s++) {
        prevPos.copy(P.pos);
        stepFlight(P, ctl, h);
        if (G.state === 'playing' && G.started) G.time += h;
        if (G.next < HOOPS.length && passedHoop(prevPos, P.pos, G.next)) {
          onHoop();
          if (G.state !== 'playing' && G.next >= HOOPS.length) {   // attract lap done: go round again
            if (G.state === 'attract') { resetRun(); break; }
            G.next = 0;
          }
        }
        if (G.invuln > 0) G.invuln -= h;
        else { const c = crashed(P); if (c) { onCrash(c); break; } }
      }
    }
  }
  boostEdges();
  updateCamera(dt, false);
  updateVisuals(dt);
  updateHUD();
  Sound.update(P, G.state === 'playing' ? 1 : G.state === 'paused' ? 0 : 0.35);
}
let last = performance.now(), errShown = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 1 / 20);   // clamp: tab switches and hitches don't teleport the plane
  last = now;
  if (dt <= 0) return;
  try { const t0 = performance.now(); update(dt); const t1 = performance.now(); renderer.render(scene, camera); G.perf = { update: t1 - t0, render: performance.now() - t1 }; }
  catch (err) { if (!errShown) { errShown = true; console.error(err); showToast('Something broke: ' + (err && err.message), 8000); } }
}
resetRun();
setState('attract');
requestAnimationFrame((t) => { last = t; frame(t); });
window.__ml = { G, P, get HOOPS() { return HOOPS; }, input, settings, finishRun, switchCourse, teleport(i) { G.next = i; respawn(); } };
}
