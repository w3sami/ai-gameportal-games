'use strict';
/* =========================================================================
   GAME — rendering, input, audio, UI. Uses the simulation core (js/sim.js).
   startGame(api) runs once the first course has been built (see js/boot.js); api.loadCourse(entry) builds another; api.themes feeds the menu (js/menu.js).
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
  if (!s.ids) {                                             // course ids renamed to follow the level names (all at once:
    const was = { harbour: 'bay', port: 'harbour', hillside: 'cliffside', fairground: 'fairgrounds' };   // harbour moved)
    const best = {};
    for (const k in s.best) best[was[k] || k] = s.best[k];
    s.best = best; if (was[s.course]) s.course = was[s.course];
    try {                                                   // the kept runs too (js/ghost.js)
      const runs = {};
      for (const k in was) runs[k] = localStorage.getItem('skyrace.ghost.' + k);
      for (const k in was) localStorage.removeItem('skyrace.ghost.' + k);
      for (const k in was) if (runs[k] != null) localStorage.setItem('skyrace.ghost.' + was[k], runs[k]);
    } catch (e) { /* no storage */ }
    s.ids = 2;
  }
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
const resolution = createResolution(renderer);              // pixel ratio that steps down when frames run slow (js/resolution.js)
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 6500);
const view = { w: 1, h: 1 };
function resize() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  if (w === view.w && h === view.h) return;
  view.w = w; view.h = h;
  renderer.setPixelRatio(resolution.ratio());               // at most DPR 2 (DPR 3 costs 2.25x the pixels), less when slow
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
const hemiLight = new THREE.HemisphereLight('#e0eeff', '#56663e', 1.3);
scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight('#fff3df', 2.4);
sunLight.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sunLight);
Airframe.ENV.afSky.value.copy(COL.sky); Airframe.ENV.afHorizon.value.copy(COL.horizon); Airframe.ENV.afGround.value.copy(COL.forest);   // aircraft rim and glass (js/airframe.js)

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
const cloudDeck = createCloudDeck({ scene, sky, sunDisc, sun: sunLight, hemi: hemiLight, renderer });   // js/clouddeck.js
Atmosphere.init({ sunDir: SUN_DIR, sun: sunLight, sky });   // sun-tinted fog and low haze (js/atmosphere.js)

/* ---------- scenery: rebuilt whenever a course is loaded ----------
   Defaults are the Valley Run look; a course file can override palette (heights where colours blend), view (camera
   range and fog) and clouds (see the course format in js/sim.js), and add a cloud deck (js/clouddeck.js). */
const PALETTE = { dry: [40, 170], forestTop: [150, 225], high: [185, 275], snow: null, pathTint: true };
const VIEW = { near: 0.5, far: 6500, fog: [320, 2150] };
// clear: the least gap between a cloud's lowest puff and the ground under it (m); a cloud that dips lower is lifted
const CLOUDS = { count: 46, y: [190, 360], size: [16, 36], near: 18, nearR: [75, 185], nearY: [32, 82], nearSize: [9, 18], clear: 10 };
const span = (r, t) => r[0] + (r[1] - r[0]) * t;
let worldGroup = null, sunDist = 4200;
const lightStats = {};
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
  Atmosphere.configure(v, COURSE);
  lightStats.bake = Sunlight.bake(SUN_DIR);                 // terrain shadows and occlusion (js/sunlight.js)
  const k = v.far / VIEW.far;                               // sky dome, sun and outer plain grow with the view range
  sky.scale.setScalar(k); sunDisc.scale.setScalar(k); sunDist = 4200 * k;
  buildTerrainMesh(worldGroup, Math.max(9000, v.far * 1.4));
  buildTrees(worldGroup);
  buildRocks(worldGroup);
  overhangs.build(worldGroup);
  shore.build(worldGroup);
  buildClouds(worldGroup);
  cloudDeck.build(worldGroup, v);
  buildHoops(worldGroup);
  Object.assign(lightStats, Sunlight.apply(worldGroup, scene));
}

function buildTerrainMesh(group, plainR) {
  const PAL = Object.assign({}, PALETTE, COURSE.palette);
  const N = TER.N, W = N + 1, cell = TER.CELL, pos = new Float32Array(N * N * 18), col = new Float32Array(N * N * 18);
  const rand = mulberry32(5), c = new THREE.Color(), e1 = new V3(), e2 = new V3(), nrm = new V3();
  // a beach course's own sand and sea (palette.sand...); the see-through sea shows the bed darkening with depth
  const sand = new THREE.Color(PAL.sandColor || COL.sand), sea = new THREE.Color(PAL.water || COL.water);
  const deep = new THREE.Color(PAL.deepWater || PAL.water || COL.water), clearSea = PAL.waterOpacity != null && PAL.waterOpacity < 1;
  const sandTop = PAL.sand ? PAL.sand[0] : 2.2;
  let o = 0;
  function colour(x, z, h, ny, k) {
    const s = TNEAR[k] >= 0 ? SAMPLES[TNEAR[k]] : null, d = TDIST[k];
    if (h < TER.WATER + sandTop) {
      c.copy(sand);
      if (clearSea && h < TER.WATER) c.lerp(deep, smoothstep(TER.WATER - 0.3, TER.WATER - (PAL.deep || 14), h));
    } else {
      c.copy(COL.meadow).lerp(COL.dry, smoothstep(PAL.dry[0], PAL.dry[1], h));
      const f = noiseB(x * 0.006 + 40, z * 0.006 - 13), fm = COURSE.trees.mask == null ? 0.52 : COURSE.trees.mask;   // same mask as the trees
      if (f > fm) c.lerp(COL.forest, smoothstep(fm, fm + 0.14, f) * (1 - smoothstep(PAL.forestTop[0], PAL.forestTop[1], h)));
      c.lerp(COL.high, smoothstep(PAL.high[0], PAL.high[1], h));
      if (PAL.pathTint && s && d < s.width + 25) c.lerp(COL.valley, 0.45 * (1 - smoothstep(s.width, s.width + 25, d)));
      if (PAL.sand) c.lerp(sand, 1 - smoothstep(TER.WATER + PAL.sand[0], TER.WATER + PAL.sand[1], h));
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
  const terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  terrain.userData.sunGrid = true; group.add(terrain);

  const openSea = TER.EDGE < TER.WATER, wsize = openSea ? plainR * 2 : TER.SIZE;   // edges below the water: sea all round
  const wmat = new THREE.MeshLambertMaterial({ color: sea });
  if (clearSea) { wmat.transparent = true; wmat.opacity = PAL.waterOpacity; }
  const water = new THREE.Mesh(new THREE.PlaneGeometry(wsize, wsize).rotateX(-Math.PI / 2), wmat);
  water.userData.sunTex = true;
  water.renderOrder = -1;                                   // see-through: drawn before the other see-through things
  water.position.set(TER.CX, TER.WATER, TER.CZ); group.add(water);

  const S = TER.SIZE / 2, O = plainR;                       // flat plain beyond the terrain square
  const shape = new THREE.Shape([new THREE.Vector2(-O, -O), new THREE.Vector2(O, -O), new THREE.Vector2(O, O), new THREE.Vector2(-O, O)]);
  shape.holes.push(new THREE.Path([new THREE.Vector2(-S, -S), new THREE.Vector2(-S, S), new THREE.Vector2(S, S), new THREE.Vector2(S, -S)]));
  const plain = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: openSea ? deep : COL.meadow }));
  plain.position.set(TER.CX, TER.EDGE - 0.05, TER.CZ); group.add(plain);
}

function buildTrees(group) {
  const n = TREES.x.length;
  if (!n) return;
  const k = TREE_TRUNK;                                     // course.trees.trunk: crown on a bare trunk, so it needs a base
  const geo = new THREE.ConeGeometry(1, 1, 7, 1, !k).translate(0, 0.5, 0).toNonIndexed();   // cones to the ground: no base
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3(), p = new V3(), c = new THREE.Color(), rand = mulberry32(3);
  const tc = COURSE.trees.colors || ['#3b6838', '#5d8c46'], g1 = new THREE.Color(tc[0]), g2 = new THREE.Color(tc[1]);
  for (let i = 0; i < n; i++) {
    q.setFromAxisAngle(WORLD_UP, rand() * TAU);
    const h = TREES.h[i];
    mesh.setMatrixAt(i, m.compose(p.set(TREES.x[i], TREES.y[i] + k * h, TREES.z[i]), q, s.set(TREES.r[i], h * (1 - k), TREES.r[i])));
    mesh.setColorAt(i, c.copy(g1).lerp(g2, rand()));
  }
  mesh.frustumCulled = false; group.add(mesh);
  if (!k) return;
  const tg = new THREE.CylinderGeometry(0.7, 1, 1, 5, 1, true).translate(0, 0.5, 0).toNonIndexed(); tg.computeVertexNormals();
  const trunks = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ color: '#5b4633' }), n);
  for (let i = 0; i < n; i++) {
    const h = TREES.h[i], tr = trunkR(h);
    trunks.setMatrixAt(i, m.compose(p.set(TREES.x[i], TREES.y[i], TREES.z[i]), q.identity(), s.set(tr, k * h + 1, tr)));
  }
  trunks.frustumCulled = false; group.add(trunks);
}

function buildRocks(group) {                                // boulders (course.rocks): grey, a little snow on the high ones
  const n = ROCKS.x.length;
  if (!n) return;
  const PAL = Object.assign({}, PALETTE, COURSE.palette);
  const geo = new THREE.IcosahedronGeometry(1, 0).toNonIndexed(); geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new V3(), p = new V3(), c = new THREE.Color(), rand = mulberry32(17);
  for (let i = 0; i < n; i++) {
    const r = ROCKS.r[i];
    q.setFromEuler(e.set((rand() - 0.5) * 0.5, rand() * TAU, (rand() - 0.5) * 0.5));
    mesh.setMatrixAt(i, m.compose(p.set(ROCKS.x[i], ROCKS.y[i], ROCKS.z[i]), q, s.set(r * (1 + rand() * 0.3), r * 0.75, r)));
    c.copy(COL.rock).lerp(COL.high, rand() * 0.6).multiplyScalar(0.8 + rand() * 0.25);
    if (PAL.snow) c.lerp(COL.snow, 0.7 * smoothstep(PAL.snow[0] - 150, PAL.snow[1], ROCKS.y[i]));
    mesh.setColorAt(i, c);
  }
  mesh.frustumCulled = false; group.add(mesh);
}

function buildClouds(group) {
  const C = Object.assign({}, CLOUDS, COURSE.clouds), rand = mulberry32(11), puffs = [];
  const probe = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const cloud = (x, y, z, size) => {
    const n = 4 + Math.floor(rand() * 4), p = [];
    for (let i = 0; i < n; i++) p.push([x + (rand() - 0.5) * size * 2.4, y + (rand() - 0.5) * size * 0.5, z + (rand() - 0.5) * size * 1.6, size * (0.55 + rand() * 0.55)]);
    // keep clear of the ground: lift a cloud that dips into a slope, drop one that would sit inside a mountain
    let lift = 0;
    for (const [px, py, pz, s] of p) for (const [dx, dz] of probe) lift = Math.max(lift, groundAt(px + dx * s, pz + dz * s) + C.clear - (py - s * 0.9));
    if (lift > 150) return false;
    for (const q of p) { q[1] += lift; puffs.push(q); }
    return true;
  };
  for (let i = 0; i < C.count; i++) cloud(TER.X0 + rand() * TER.SIZE, span(C.y, rand()), TER.Z0 + rand() * TER.SIZE, span(C.size, rand()));
  for (let i = 0; i < C.near; i++) for (let tries = 0; tries < 8; tries++) {   // closer to the course, off to the side
    const sp = SAMPLES[Math.floor(rand() * SAMPLES.length)], a = rand() * TAU, r = span(C.nearR, rand());
    if (cloud(sp.x + Math.cos(a) * r, sp.y + span(C.nearY, rand()), sp.z + Math.sin(a) * r, span(C.nearSize, rand()))) break;
  }
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#aab9c6' }), puffs.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new V3(), s = new V3();
  puffs.forEach((pf, i) => {
    q.setFromEuler(e.set(rand() * 3, rand() * 3, rand() * 3));
    mesh.setMatrixAt(i, m.compose(p.set(pf[0], pf[1], pf[2]), q, s.set(pf[3], pf[3] * 0.62, pf[3])));
  });
  mesh.userData.clouds = true;                              // js/clouds.js reshapes and relights the puffs
  mesh.frustumCulled = false; group.add(mesh);
}

/* ---------- gates: hoops, or pylons beside an invisible circle (course format in js/sim.js) ---------- */
const ROUTE_HEX = '#ff2b95';
const hoopMat = {
  next: new THREE.MeshBasicMaterial({ color: ROUTE_HEX }),
  soon: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  later: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }),
};
for (const k in hoopMat) { hoopMat[k].userData.shared = true; hoopMat[k].userData.gate = true; }   // outlive course switches;
                                                            // gate: a gate's (clones keep it: see renderFrame)
const Z_AXIS = new V3(0, 0, 1);
let hoopMeshes = [];      // per gate: its hoop mesh, or null for a pylon gate
let gateMeshes = [];      // the gates' marks, for Show hoops (renderFrame)
const gateQ = [];         // per gate: orientation (+Z along the line)
const pylons = createPylonKit(ROUTE_HEX);   // pylon gates' meshes and highlighting (js/pylons.js)
const bridges = createBridgeKit();          // bridges over some hoops (js/bridges.js)
const overhangs = createOverhangKit();      // rock ledges, arches, boulders (js/overhangs.js)
const gateKits = GATE_KITS.map((f) => f({ hoopMat }));   // gate kinds from other modules (js/aerobatic.js, js/farm.js, js/windmills.js)
const shore = createShoreKit();              // piers, boats, beach umbrellas and huts (js/shore.js)
const gateDisc = new THREE.Mesh(new THREE.CircleGeometry(7.4, 40),
  new THREE.MeshBasicMaterial({ color: ROUTE_HEX, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
scene.add(gateDisc);
function buildHoops(group) {
  const geo = new THREE.TorusGeometry(TUNE.HOOP_R, 0.75 * TUNE.HOOP_R / 8, 8, 44);
  gateQ.length = 0;
  hoopMeshes = HOOPS.map((h, i) => {
    gateQ[i] = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, h.normal);
    if (h.kind !== 'hoop') return null;
    const m = new THREE.Mesh(geo, hoopMat.later);
    m.position.copy(h.pos); m.quaternion.copy(gateQ[i]);
    m.userData.fade = 0; m.userData.flash = null;
    group.add(m);
    return m;
  });
  const pylonGroup = new THREE.Group(); group.add(pylonGroup);
  pylons.build(pylonGroup);
  bridges.build(group);
  for (const k of gateKits) k.build(group);
  gateDisc.scale.setScalar((TUNE.HOOP_R - 0.6) / 7.4);
  // what Show hoops hides: the other modules' gates are drawn in the hoops' materials (passed them as hoopMat), or are
  // js/aerobatic.js's dashed rings, and the pylons' arrows are their only flat shapes (js/pylons.js). Everything else stays:
  // the pylons themselves, the ribbon (just its magenta bows go), and the scenery (mills, barns, the fair)
  gateMeshes = [];
  group.traverse((o) => { if (o.isMesh && ((o.material && o.material.userData.gate) || o.userData.dashed)) gateMeshes.push(o); });
  pylonGroup.traverse((o) => { if (o.isMesh && o.geometry.type === 'ShapeGeometry') gateMeshes.push(o); });
}
function resetPylons() { pylons.reset(); }
const gateNoun = () => (HOOPS.length && HOOPS[0].kind !== 'hoop' ? 'gate' : 'hoop');

/* ---------- plane models (nose along -Z), one per vehicle; the course's vehicle picks ---------- */
function modelKit(g) {
  return (geo, mat, x, y, z, rz = 0) => {
    const flat = geo.index ? geo.toNonIndexed() : geo; flat.computeVertexNormals();
    const m = new THREE.Mesh(flat, mat); m.position.set(x, y, z); m.rotation.z = rz; g.add(m); return m;
  };
}
const MODEL_MAKERS = { prop: () => makePropPlaneModel(scene), jet: () => makeFighterModel(scene), racer: () => makeRacePlaneModel(scene), wingsuit: () => makeWingsuitFlyerModel(scene),
  sailplane: () => makeGliderModel(scene), biplane: () => makeBiplaneModel(scene, modelKit) };   // js/glider.js, js/biplane.js
const models = {};
for (const v in MODEL_MAKERS) models[v] = MODEL_MAKERS[v]();
let planeModel = models.prop;
// the ghost (js/ghost.js): a see-through second one of the aircraft, made the first time it's needed. It trails no
// smoke or vapour: those are drawn for planeModel only
const ghostModels = {};
function ghostModel() {
  const v = MODEL_MAKERS[TUNE.VEHICLE] ? TUNE.VEHICLE : 'prop';
  if (!ghostModels[v]) {
    const m = ghostModels[v] = MODEL_MAKERS[v]();
    const pre = [];
    m.group.traverse((o) => {
      if (!o.material) return;
      o.material = o.material.clone(); o.material.transparent = true; o.material.opacity *= 0.5; o.renderOrder = 1;
      if (o.material.depthWrite) pre.push(o);
    });
    // depth first, so only the nearest surface shows through (no wing seen through the fuselage)
    for (const o of pre) {
      const d = new THREE.Mesh(o.geometry, o.material.clone());
      d.material.colorWrite = false; d.renderOrder = 0.99;
      o.add(d);                                              // a child, so it follows spinning props and moving limbs
    }
    m.group.visible = false;
  }
  return ghostModels[v];
}
function setVehicleModel() {
  for (const k in models) models[k].group.visible = false;
  for (const k in ghostModels) ghostModels[k].group.visible = false;
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
  // fadeLen: the first metres behind the head fade in (by distance, so it can't pulse with the sample rate)
  constructor(max, w0 = 0.12, w1 = 0.9, fadeLen = 0) {
    this.max = max; this.pts = []; this.pool = []; this.w0 = w0; this.w1 = w1; this.fadeLen = fadeLen; this.live = null;
    this.pos = new Float32Array(max * 6); this.col = new Float32Array(max * 8);
    const idx = [];
    for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, trailMat); this.mesh.frustumCulled = false; scene.add(this.mesh);
  }
  clear() { while (this.pts.length) this.pool.push(this.pts.pop()); this.live = null; this.geo.setDrawRange(0, 0); }
  // a fixed sample (behind the live head, if there is one)
  push(p, a, now) {
    const pt = this.pts.length >= this.max ? this.pts.pop() : (this.pool.pop() || { p: new V3(), t: 0, a: 0 });
    pt.p.copy(p); pt.t = now; pt.a = a;
    if (this.live && this.pts[0] === this.live) this.pts.splice(1, 0, pt); else this.pts.unshift(pt);
  }
  // the live head: moves to the emitter every frame, so the trail starts exactly there between samples
  head(p, a, now) {
    if (!this.live || this.pts[0] !== this.live) { this.live = null; this.push(p, a, now); this.live = this.pts[0]; }
    this.live.p.copy(p); this.live.t = now; this.live.a = a;
  }
  update(now, life, camPos) {
    while (this.pts.length && now - this.pts[this.pts.length - 1].t > life) {
      const q = this.pts.pop(); if (q === this.live) this.live = null; this.pool.push(q);
    }
    const n = this.pts.length, d = Trail.d, s = Trail.s, c = Trail.c, prev = Trail.prev;
    let dist = 0;
    prev.set(0, 0, 0);
    for (let i = 0; i < n; i++) {
      const cur = this.pts[i];
      // direction along the trail from neighbours at least 20 cm apart (a fresh sample sits on the head)
      let lo = Math.max(0, i - 1), hi = Math.min(n - 1, i + 1);
      d.copy(this.pts[lo].p).sub(this.pts[hi].p);
      while (d.lengthSq() < 0.04 && (hi < n - 1 || lo > 0)) {
        if (hi < n - 1) hi++; else lo--;
        d.copy(this.pts[lo].p).sub(this.pts[hi].p);
      }
      if (d.lengthSq() < 1e-8) d.set(0, 0, 1);
      c.copy(camPos).sub(cur.p);
      s.crossVectors(c, d);
      // seen end-on the cross product is noise: keep the previous point's sideways direction
      if (s.lengthSq() < 1e-4 * c.lengthSq() * d.lengthSq() && prev.lengthSq() > 0) s.copy(prev); else s.normalize();
      prev.copy(s);
      if (i > 0) dist += cur.p.distanceTo(this.pts[i - 1].p);
      const age = (now - cur.t) / life, w = this.w0 + age * this.w1;
      let al = cur.a * (1 - age) * (1 - age);
      if (this.fadeLen > 0) al *= smoothstep(0, this.fadeLen, dist);
      const o = i * 6;
      this.pos[o] = cur.p.x + s.x * w; this.pos[o + 1] = cur.p.y + s.y * w; this.pos[o + 2] = cur.p.z + s.z * w;
      this.pos[o + 3] = cur.p.x - s.x * w; this.pos[o + 4] = cur.p.y - s.y * w; this.pos[o + 5] = cur.p.z - s.z * w;
      this.col.fill(1, i * 8, i * 8 + 8); this.col[i * 8 + 3] = al; this.col[i * 8 + 7] = al;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
  }
}
Trail.d = new V3(); Trail.s = new V3(); Trail.c = new V3(); Trail.prev = new V3();
const trails = [new Trail(150), new Trail(150)];
const smoke = { trail: new Trail(200, 0.25, 2.4, 1.2), last: 0 };   // race plane's tail smoke: 60 Hz samples and a live head

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
    if (TUNE.VEHICLE === 'wingsuit') {                      // no engine: wind, and fabric buffeting that builds with speed
      this.eng.gain.setTargetAtTime(0, t, 0.2);
      this.rumble.gain.setTargetAtTime(level * (0.05 + smoothstep(TUNE.CRUISE, TUNE.BOOST * 1.2, v) * 0.5), t, 0.15);
      this.rumbleF.frequency.setTargetAtTime(110 + (P.tuck || 0) * 90 + v, t, 0.2);
      return;
    }
    if (sailing()) {                                        // sailplane: quiet airflow, and the variometer while racing
      this.eng.gain.setTargetAtTime(0, t, 0.2);
      this.rumble.gain.setTargetAtTime(level * (0.03 + smoothstep(TUNE.CRUISE, TUNE.BOOST * 1.2, v) * 0.3), t, 0.15);
      this.rumbleF.frequency.setTargetAtTime(140 + v * 1.5, t, 0.2);
      if (!this.vario) this.vario = createVario(this.ctx, this.master);
      this.vario.update(P.vario || 0, level >= 1 && planeModel.group.visible ? 1 : 0);
      return;
    }
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
    const racer = TUNE.VEHICLE === 'racer', bi = TUNE.VEHICLE === 'biplane';   // racer: angrier six-cylinder; biplane: deep radial
    const f = ((P.boosting ? 78 : 58) + v * 0.35) * (racer ? 1.15 : bi ? 0.8 : 1);
    this.osc[0].frequency.setTargetAtTime(f, t, 0.25); this.osc[1].frequency.setTargetAtTime(f * 2.01, t, 0.25);
    this.eng.gain.setTargetAtTime(level * (P.boosting ? 0.06 : 0.035), t, 0.2);
    this.engF.frequency.setTargetAtTime((P.boosting ? 950 : 420) * (racer ? 1.3 : bi ? 0.85 : 1), t, 0.3);
  },
  tone(freq, when, dur, vol, type = 'sine', out = this.master) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(out); o.start(when); o.stop(when + dur + 0.05);
  },
  // struck bell: the note plus a quicker-dying octave and twelfth, so it rings bright and then settles
  bell(f, when, dur, vol) {
    const out = this.chimes();
    this.tone(f, when, dur, vol, 'sine', out); this.tone(f * 2, when, dur * 0.35, vol * 0.3, 'sine', out); this.tone(f * 3, when, dur * 0.18, vol * 0.12, 'sine', out);
  },
  // bonus chimes get a short, dark echo so they sparkle over the engine instead of clicking off
  chimes() {
    if (this.chimeBus) return this.chimeBus;
    const c = this.ctx, bus = c.createGain(), d = c.createDelay(0.5), fb = c.createGain(), lp = c.createBiquadFilter(), wet = c.createGain();
    d.delayTime.value = 0.12; fb.gain.value = 0.3; lp.type = 'lowpass'; lp.frequency.value = 2800; wet.gain.value = 0.3;
    bus.connect(this.master); bus.connect(d); d.connect(lp); lp.connect(fb).connect(d); lp.connect(wet).connect(this.master);
    return this.chimeBus = bus;
  },
  hoop() {                                                  // gate passed: the same plain two-note chime every time, C6 up to G6
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    this.tone(1046.5, t, 0.3, 0.1); this.tone(1567.98, t + 0.09, 0.45, 0.1);
  },
  thump() {                                                 // pylon hit: dull whump of an air-filled pylon
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    this.pop(t, 0.5); this.tone(82, t, 0.35, 0.3); this.tone(61, t + 0.03, 0.4, 0.2, 'triangle');
  },
  bonus() {                                                 // time bonus: a quick sparkle up the chord, well past the hoop's G6
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    [1046.5, 1318.51, 1567.98, 2093, 2637.02].forEach((f, i) => this.bell(f, t + i * 0.045, i === 4 ? 0.9 : 0.35, i === 4 ? 0.09 : 0.06));
  },
  penalty() {                                               // penalty or missed gate: two falling buzzes
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    this.tone(330, t, 0.16, 0.06, 'square'); this.tone(247, t + 0.15, 0.24, 0.06, 'square');
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
const G = { state: 'attract', next: 0, started: false, time: 0, pen: 0, invuln: 0, crashTimer: 0, lap: 'attract', pauseReason: null, clock: 0, hints: new Set() };
const aim = { yaw: 0, pitch: 0 };
const aimDir = new V3(0, 0, -1);
const START_POS = new V3(), START_DIR = new V3();         // set per course by applyCourse()
const cam = { dir: new V3(0, 0, -1), up: new V3(0, 1, 0), dist: 12.5, fov: 60, shake: 0, vx: 0, vy: 0, boost: 0, punchT: 1e9 };

function setAimFrom(dir, maxPitch = 0.7) { aim.yaw = yawOf(dir); aim.pitch = clamp(pitchOf(dir), -maxPitch, maxPitch); dirFromYawPitch(aim.yaw, aim.pitch, aimDir); }

function resetRun() {
  G.finishCam = null;                                       // (also calls off a finish's pending panel and lap)
  G.rec = null; G.replay = null;                            // js/replay.js: startRun and restart begin a new recording
  if (G.ghost) G.ghost.model.group.visible = false;
  G.ghost = null;
  placePlane(P, START_POS, START_DIR, TUNE.CRUISE);
  P.boost = 1; P.boostLock = false; P.boosting = false; P.smokeLeft = 1; P.smokeLock = false;
  G.next = 0; G.started = false; G.time = 0; G.pen = 0; G.bonus = 0; G.invuln = 0.4; G.crashTimer = 0; G.liftHint = false; G.hints = new Set();
  setAimFrom(START_DIR); input.neutral = true;
  resetGates();
  P.smoking = false;
  planeModel.group.visible = true;
  updateCamera(0, true);
}

function resetGates() {                                   // gates, pylons and trails as at the start of a run (also a replay's loop)
  hoopMeshes.forEach((m) => { if (!m) return; m.visible = true; m.userData.fade = 0; if (m.userData.flash) { m.userData.flash.dispose(); m.userData.flash = null; } });
  resetPylons();
  for (const k of gateKits) k.reset();
  trails.forEach((t) => t.clear()); smoke.trail.clear();
  for (const v in models) if (models[v].puffs) models[v].puffs.clear();
}

function respawn() {
  if (G.rec) G.rec.cut();                                   // the replay jumps here rather than sweeping across
  const h = G.next > 0 ? HOOPS[G.next - 1] : null;
  const pos = h ? h.pos.clone().addScaledVector(h.normal, 4) : START_POS;
  // wingsuit: back at the hoop with the speed you had there, or RESPAWN_SPEED if more, since the next stretch may need it
  // (capped at the course's rules.respawnMax, where tight turns right after a hoop can't be made any faster)
  let v = gliding() && h ? Math.max(TUNE.RESPAWN_SPEED || TUNE.CRUISE, G.hoopSpeed || 0) : sailing() && h ? TUNE.RESPAWN_SPEED || TUNE.CRUISE : TUNE.CRUISE;
  if (h && RULES.respawnMax) v = Math.min(v, RULES.respawnMax);
  placePlane(P, pos, h ? h.normal : START_DIR, v);
  setAimFrom(P.vdir); input.neutral = true;
  G.invuln = 1.2;
  planeModel.group.visible = true;
  trails.forEach((t) => t.clear()); smoke.trail.clear();
  if (planeModel.puffs) planeModel.puffs.cut();
  updateCamera(0, true);
}

// missed: a pylon gate passed outside its circle; it counts as flown, with a penalty and no boost refill
function onHoop(missed = false) {
  const i = G.next, h = HOOPS[i];
  G.next++; G.hoopSpeed = P.speed;
  if (!missed) P.boost = Math.min(1, P.boost + TUNE.BOOST_HOOP);
  if (!missed && TUNE.SMOKE) P.smokeLeft = Math.min(1, P.smokeLeft + TUNE.SMOKE_HOOP);   // the smoke meter (js/airshow.js)
  flashGate(i);
  if (G.state !== 'playing') return;
  if (i === 0) G.started = true;
  if (missed) penalty(RULES.missed, `Missed ${gateNoun()} ${i + 1}`);
  else {
    const notLevel = h.kind === 'G' && Math.abs(P.bank) > RULES.levelTol * Math.PI / 180;
    const rule = GATE_TYPES[h.kind] && GATE_TYPES[h.kind].rule, pen = rule && rule(P, h);   // js/aerobatic.js: attitude gates
    if (!notLevel && !pen) Sound.hoop();                    // a penalised gate gets only the penalty sound, not bling then buzz
    if (notLevel) penalty(RULES.notLevel, 'Not level through the gate');
    if (pen) penalty(pen.sec, pen.text);
  }
  bump($('hud-hoops'));
  if (G.next >= HOOPS.length) finishRun();
}
function flashGate(i) {                                    // passed: the gate flashes and fades (a replay repeats this)
  for (const k of gateKits) k.pass(i);
  const m = hoopMeshes[i];
  if (m) {
    if (m.userData.flash) m.userData.flash.dispose();
    m.userData.flash = hoopMat.next.clone(); m.userData.flash.transparent = true; m.userData.flash.depthWrite = false;
    m.material = m.userData.flash; m.userData.fade = 1;
  }
}
// a loop or slalom broken off (js/aerobatic.js): its gates again from the first, so a crash's respawn puts you on the
// straight before it
function rewindTo(i, text) {
  if (i >= G.next) return;
  G.next = i;
  if (G.state === 'playing' && text) showToast(text, 2600);
}
let penTimer = 0;
function penalty(sec, what) {
  if (!sec) return;
  G.time += sec; G.pen += sec;
  Sound.penalty();
  showToast(`${what}: +${sec} s`, 1800);
  hud.time.classList.remove('is-bonus'); hud.time.classList.add('is-pen'); bump(hud.time);
  clearTimeout(penTimer); penTimer = setTimeout(() => hud.time.classList.remove('is-pen'), 1100);
}
function timeBonus(sec, what) {                            // time off (js/airshow.js: smoke through the aerobatics)
  if (!sec || G.state !== 'playing') return;
  const off = Math.min(sec, G.time);
  G.time -= off; G.bonus += off;
  Sound.bonus();
  showToast(`${what}: \u2212${sec} s`, 1800);
  hud.time.classList.remove('is-pen'); hud.time.classList.add('is-bonus'); bump(hud.time);
  clearTimeout(penTimer); penTimer = setTimeout(() => hud.time.classList.remove('is-bonus'), 1100);
}
function onPylonHit(k) {
  pylons.hit(k, P.pos);
  if (G.state !== 'playing') return;
  cam.shake = reducedMotion ? 0 : 0.45;
  Sound.thump();
  penalty(RULES.pylonHit, 'Pylon hit');
}

function onCrash(kind) {
  G.crashTimer = 0.9;
  cam.shake = reducedMotion ? 0 : 1;
  planeModel.group.visible = false;
  if (G.state !== 'playing') return;
  Sound.crash();
  flash();
  // modules with crashes of their own name them in CRASH_TEXT (js/powerlines.js, js/turbines.js)
  const what = (typeof CRASH_TEXT !== 'undefined' && CRASH_TEXT[kind]) || { tree: 'Clipped a tree', bridge: 'Hit the bridge', pier: 'Hit the pier',
    boat: 'Hit a boat', rock: 'Hit the rocks', crane: 'Hit a crane', cargo: 'Hit the containers', dock: 'Hit the quay', cave: 'Hit the cave roof',
    boulder: 'Hit a boulder', beach: 'Crashed on the beach' }[kind] || 'Crashed';
  showToast(G.next > 0 ? `${what}. Back to ${gateNoun()} ${G.next}.` : `${what}. Back to the start.`);
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
  pad: { x: 0, y: 0, boost: false },   // controller (js/pad.js): shaped like the touch stick, up = +y
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
  body.classList.toggle('is-pad', d === 'pad');
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
  if (G.state === 'replay' && (e.code === 'Escape' || e.code === 'Backspace')) {   // (and not on to the menu's own Esc)
    e.preventDefault(); e.stopImmediatePropagation(); toMenu(); return;
  }
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') && G.state !== 'playing') return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (G.state === 'playing') pause('key'); else if (G.state === 'paused' && e.code === 'KeyP') resumeFromUser();
    return;
  }
  if (e.code === 'KeyR' && G.state !== 'attract' && G.state !== 'replay') { e.preventDefault(); restart(); return; }
  if (FLIGHT_KEYS.has(e.code)) {
    e.preventDefault();
    if (G.state === 'playing') { input.keys.add(e.code); if (!e.code.startsWith('Shift') && e.code !== 'Space') setDevice('mouse'); }
  }
});
window.addEventListener('keyup', (e) => input.keys.delete(e.code));
window.addEventListener('blur', () => { input.keys.clear(); stickEnd(); boostEnd(); });

function resolveControl(dt) {
  const k = input.keys, inv = settings.invertPitch ? -1 : 1;
  let p = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  let r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  let y = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
  const boost = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('Space') || input.boost.active || input.pad.boost;
  const ctl = { att: null, aim: null, p: 0, r: 0, y: 0, boost: boost && !TUNE.SMOKE, smoke: boost && !!TUNE.SMOKE };   // biplane: no boost, it smokes
  if (!input.neutral) { P.rollHold = P.stickBase = null; P.rollOn = 0; }   // aiming or flying by hand: where to settle once let go is
  if (p || r || y) {                                        // chosen afresh then (js/aerobatic.js)
    ctl.p = clamp(p, -1, 1) * inv; ctl.r = clamp(r, -1, 1); ctl.y = clamp(y, -1, 1);   // manual flying: raw rates, loops allowed
    input.manual = true; input.neutral = true; P.rollHold = P.stickBase = null; P.rollOn = 0;
    syncAim();
    return ctl;
  }
  input.manual = false;
  // the controller's stick flies exactly like the touch stick (js/pad.js shapes it the same way); a thumb on the screen wins
  const st = input.stick.active ? input.stick : (input.pad.x || input.pad.y) ? input.pad : null;
  if (!st) input.climb.od = 0;                              // the pad has no release event: reset the climb ramp here
  if (st && TUNE.TOUCH_MODE === 'rate') {                   // jet: roll and pitch rates, no angle limits
    ctl.r = st.x; ctl.p = st.y * inv;
    input.neutral = true;
    syncAim();
    return ctl;
  }
  if (st) {                                                 // horizontal = bank angle, vertical = climb angle
    if (TUNE.ROLL_DETENT) {                                  // the biplane (js/aerobatic.js): bank as here, but the stick's
      const a = aeroStick(P, st.x, st.y * inv, dt);         // up/down is the elevator, and the end of the throw rolls on
      ctl.p = a.p; ctl.r = a.r;
    } else ctl.att = { bank: st.x * TUNE.TOUCH_BANK, climb: touchClimb(input.climb, st.y * inv, dt) };
    input.neutral = true;
    syncAim();
    return ctl;
  }
  if (input.neutral && TUNE.TOUCH_MODE === 'rate' && (input.device === 'touch' || input.device === 'pad')) { syncAim(); return ctl; }   // let go: hold attitude
  if (input.neutral) {                                      // nothing held: roll level, flatten out, keep heading
    ctl.att = { bank: TUNE.ROLL_DETENT ? aeroHold(P) : 0, climb: 0 };   // (the biplane: or hold knife edge / inverted)
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
  const ctl = { aim: autopilotAim(P, G.next, aimDir), p: 0, r: 0, y: 0, boost: false }, roll = aeroRollTo(P, G.next);   // js/aerobatic.js
  if (TUNE.SMOKE) ctl.smoke = airshowAuto(P, G.next);      // shows the smoke bonus being flown (js/airshow.js)
  if (roll != null) ctl.rollTo = roll;
  return ctl;
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
  if (G.finishCam) {                                        // finished: the camera stays put, turning to watch the plane go
    const f = G.finishCam;
    f.look.lerp(P.pos, snap ? 1 : damp(6, dt));
    camera.position.copy(f.pos);
    camera.up.copy(WORLD_UP);
    camera.lookAt(f.look);
  }
  if (G.replay) {                                           // replay: trackside tripods (js/replay.js)
    const rc = G.replay.player.cam;
    camera.position.copy(rc.pos);
    camera.up.copy(WORLD_UP);
    camera.lookAt(rc.look);
  }

  const sp = clamp((P.speed - TUNE.CRUISE) / (TUNE.BOOST - TUNE.CRUISE), -0.4, 1.3);
  if (!reducedMotion && !G.replay) {
    const s = cam.shake * 0.03 + Math.max(0, sp) * 0.0022;
    if (s > 0) { const t = G.clock; camera.rotateZ(Math.sin(t * 37) * s); camera.rotateX(Math.sin(t * 29 + 1.3) * s * 0.7); }
  }
  cam.shake = Math.max(0, cam.shake - dt * 2.2);
  const minV = 2 * Math.atan(Math.tan((66 * Math.PI / 180) / 2) / camera.aspect) * 180 / Math.PI;   // portrait: keep ~66° across
  const fovWant = G.replay ? G.replay.player.cam.fov * Math.max(1, minV / 60)   // (the replay eases its own zoom)
    : clamp(Math.max(60 + sp * (reducedMotion ? 3 : 11), minV), 40, 100);
  cam.fov = snap || G.replay ? fovWant : lerp(cam.fov, fovWant, damp(3, dt));
  // with a panel open, frame the plane beside it (right in landscape, above it in portrait)
  const panel = !body.classList.contains('state-playing') && !body.classList.contains('state-replay'), portrait = view.h > view.w;   // (not before a finish's results show)
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
    if (!m) continue;
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
  pylons.update(gatesHidden() ? -1 : G.next, t);           // (hidden: no gate is next, so every pylon keeps its plain paint)
  pylons.animate(dt);
  for (const k of gateKits) k.update({ next: G.next, t, dt, P, playing: G.state === 'playing', crashing: G.crashTimer > 0, fresh: getBest() == null, toast: showToast, rewind: G.replay ? () => {} : rewindTo, bonus: timeBonus });
  if (G.next < HOOPS.length) {                              // faint target disc on the next gate (for pylons: the scoring circle)
    const gt = GATE_TYPES[HOOPS[G.next].kind], dr = gt && gt.disc ? gt.disc(HOOPS[G.next]) : TUNE.HOOP_R - 0.6;   // js/aerobatic.js
    gateDisc.visible = dr > 0; gateDisc.scale.setScalar(dr / 7.4);
    gateDisc.position.copy(HOOPS[G.next].pos); gateDisc.quaternion.copy(gateQ[G.next]);
    gateDisc.material.opacity = (0.09 + Math.sin(t * 6) * 0.04) * (hoopMeshes[G.next] ? 1 : 0.55);
  } else gateDisc.visible = false;

  // shadow: the aircraft's silhouette (js/planeshadow.js); the aircraft itself dims in terrain shadow
  const gy = groundAt(P.pos.x, P.pos.z), alt = P.pos.y - gy;
  blob.visible = false;
  planeModel.group.updateMatrixWorld();
  PlaneShadow.update(renderer, planeModel, alt, SUN_DIR);
  if (planeModel.uniforms) planeModel.uniforms.afSun.value = 0.3 + 0.7 * Sunlight.at(P.pos.x, P.pos.y, P.pos.z)[0];

  // streaks
  const inten = smoothstep(TUNE.CRUISE * 0.98, TUNE.BOOST * 0.97, P.speed) * (planeModel.group.visible && !G.replay ? 1 : 0);   // (a trackside camera sees none)
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
  const ti = planeModel.group.visible && planeModel.trails !== false ? Math.max(gTrail, cam.boost * 0.75) + smoothstep(TUNE.CRUISE * 1.27, TUNE.CRUISE * 1.59, P.speed) * 0.3 : 0;
  for (let i = 0; i < 2; i++) {
    _v.copy(planeModel.tips[i]).applyQuaternion(P.q).add(P.pos);
    trails[i].push(_v, ti * 0.6, t);
    trails[i].update(t, 0.9, camera.position);
  }
  if (planeModel.smoke) {
    _v.copy(planeModel.smoke).applyQuaternion(P.q).add(P.pos);
    const sa = planeModel.group.visible ? 0.32 : 0;
    if (t - smoke.last >= 1 / 60) {                         // history at a steady 60 Hz whatever the frame rate
      smoke.last = Math.max(smoke.last + 1 / 60, t - 0.05);
      smoke.trail.push(_v, sa, t);
    }
    smoke.trail.head(_v, sa, t);                            // and the start always at the nozzle
    smoke.trail.update(t, 3, camera.position);
  }
  if (planeModel.puffs) planeModel.puffs.update(G.state === 'paused' ? 0 : dt, P, planeModel.group.visible && P.smoking);   // js/smoke.js

  if (G.ghost) {                                            // the ghost: its run as far in as this one is
    const gh = G.ghost, S = Replay.at(gh.track, gh.t, gh.S), m = gh.model;
    m.group.visible = S.visible && gh.t <= gh.track.duration;
    if (m.group.visible) { m.group.position.copy(S.pos); m.group.quaternion.copy(S.q); m.update(G.state === 'paused' ? 0 : dt, S); }
  }

  sky.position.copy(camera.position);
  sunDisc.position.copy(camera.position).addScaledVector(SUN_DIR, sunDist);
  sunDisc.lookAt(camera.position);
  cloudDeck.update(camera.position.y);
  Atmosphere.update(scene.fog);                             // after the deck: it sets the fog colour and sunlight
}

/* ---------- HUD & UI ---------- */
const hud = { time: $('hud-time'), hoops: $('hud-hoops'), speed: $('hud-speed'), g: $('hud-g'), vario: $('hud-vario'), boost: $('hud-boost'), arrow: $('arrow'), arrowIcon: $('arrow-icon'), arrowDist: $('arrow-dist'),
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
const FAR_HOOP = 1000;                                      // m
function updateHUD() {
  if (G.state !== 'playing' && G.state !== 'paused') return;
  setText(hud.time, 'time', fmtTime(G.time));
  setText(hud.hoops, 'hoops', `${G.next}/${HOOPS.length}`);
  setText(hud.speed, 'speed', `${Math.round(P.speed * 3.6)} km/h`);
  if (hud.vario && sailing()) {                             // sailplane: climb rate (total energy), green when rising
    const vr = Math.round((P.vario || 0) * 10) / 10;
    setText(hud.vario, 'vario', `${vr > 0 ? '+' : vr < 0 ? '\u2212' : ''}${Math.abs(vr).toFixed(1)} m/s`); hud.vario.classList.toggle('is-up', vr >= TUNE.VARIO_ON);
  }
  if (hud.g && (gliding() || sailing())) {                  // wingsuit, sailplane: height above the ground instead of g
    const agl = Math.max(0, P.pos.y - groundAt(P.pos.x, P.pos.z));
    setText(hud.g, 'g', `${agl < 100 ? Math.round(agl) : Math.round(agl / 10) * 10} m`); hud.g.classList.toggle('is-low', agl < 25);
  } else if (hud.g) { const gl = Math.max(0, P.gload); setText(hud.g, 'g', `${gl.toFixed(1)} g`); hud.g.classList.toggle('is-high', gl >= 9); }
  const b = Math.round((TUNE.SMOKE ? P.smokeLeft : P.boost) * 100) / 100;   // the smoke meter, for the biplane
  if (hud.last.boost !== b) { hud.last.boost = b; hud.boost.style.transform = `scaleX(${b})`; hud.boostBtn.style.setProperty('--level', b); }
  body.classList.toggle('is-boosting', P.boosting);
  body.classList.toggle('is-smoking', !!P.smoking);
  body.classList.toggle('boost-empty', TUNE.SMOKE ? !!P.smokeLock : P.boostLock);

  // pointer to the next hoop: at the screen edge when it's out of view, above it when it's in view but over FAR_HOOP away
  let showArrow = false;
  if (G.next < HOOPS.length && G.crashTimer <= 0) {
    const h = HOOPS[G.next].pos, gt = GATE_TYPES[HOOPS[G.next].kind];   // other gate kinds may mark from nearer, over their top
    const far = (gt && gt.far) || FAR_HOOP, top = gt && gt.top ? gt.top(HOOPS[G.next]) : TUNE.HOOP_R;
    _v.copy(h).project(camera);
    camera.getWorldDirection(_camFwd);
    const behind = _rel.copy(h).sub(camera.position).dot(_camFwd) < 0;
    let x = _v.x, y = _v.y;
    const dist = _rel.length();
    if (behind) { x = -x; y = -y; if (Math.abs(x) + Math.abs(y) < 1e-3) y = -1; }
    const offscreen = behind || Math.abs(x) > 0.9 || Math.abs(y) > 0.85;
    hud.arrow.classList.toggle('is-above', !offscreen);
    if (!offscreen && dist > far) {                         // far but on screen: arrow just above the hoop, pointing down at it
      showArrow = true;
      const sx = (x + 1) * 0.5 * view.w, sy = (1 - y) * 0.5 * view.h;
      const rpx = top / dist * (view.h / 2) / Math.tan(camera.fov * Math.PI / 360);   // hoop radius (or its top) on screen
      hud.arrow.style.transform = `translate(${sx}px, ${Math.max(64, sy - rpx - 26)}px)`;
      hud.arrowIcon.style.transform = 'rotate(90deg)';
      setText(hud.arrowDist, 'dist', `${Math.round(dist / 10) * 10} m`);
    } else if (offscreen) {
      showArrow = true;
      const ang = Math.atan2(y * view.h, x * view.w), c = Math.cos(ang), s = Math.sin(ang);
      const k = Math.min((view.w / 2 - 52) / Math.max(Math.abs(c), 1e-4), (view.h / 2 - 56) / Math.max(Math.abs(s), 1e-4));
      hud.arrow.style.transform = `translate(${view.w / 2 + c * k}px, ${view.h / 2 - s * k}px)`;
      hud.arrowIcon.style.transform = `rotate(${-ang}rad)`;
      setText(hud.arrowDist, 'dist', `${Math.round(dist / 10) * 10} m`);
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
  body.classList.remove('state-attract', 'state-playing', 'state-paused', 'state-finished', 'state-replay');
  body.classList.add('state-' + s);
}
function focusEl(id) { const el = $(id); if (el) setTimeout(() => el.focus({ preventScroll: true }), 30); }
function blurActive() { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
function renderBest() {
  const b = getBest();
  $('start-best').textContent = b != null ? `Best ${fmtTime(b)}` : '';
  const gi = ghostInfo();                                   // a kept run: race it or watch it (js/ghost.js)
  $('ghost-btns').hidden = !gi;
  if (gi) { $('btn-ghost').title = `Race your ${fmtTime(gi.time)} run`; ghostTrack(); }   // (unpacked now, ready for the click)
  $('start-course').textContent = `${COURSE.name}, ${HOOPS.length} ${gateNoun()}s`;
  const lead = $('start-lead'), refill = $('start-refill');
  if (lead) lead.textContent = COURSE.lead || 'Fly through every hoop in order. The clock starts at the first one.';
  const pen = gateNoun() === 'gate' ? `Penalties: pylon hit +${RULES.pylonHit} s, banked air gate +${RULES.notLevel} s, missed gate +${RULES.missed} s. ` : '';
  if (refill) refill.textContent = gliding() ? `There\u2019s no flying back up: a missed hoop adds ${RULES.missed} s, and a crash puts you back at the last one.`
    : sailing() ? sailTip()
    : TUNE.SMOKE ? `${pen}Keep smoke on during aerobatic manoeuvres for a time bonus.`
    : `${pen}Boost refills over time and with every ${gateNoun()}.`;
  menu.render();
}

/* ---------- start menu: themes, then levels (js/menu.js) ---------- */
const VEHICLE_NAME = { prop: 'Stunt plane', jet: 'Fighter jet', racer: 'Race plane', wingsuit: 'Wingsuit', sailplane: 'Sailplane', biplane: 'Biplane' };
// Loads run one at a time; picking again while one loads just retargets it, and the last pick wins.
let switching = null, wantCourse = null;
function switchCourse(entry) {
  if (G.state !== 'attract') return Promise.resolve(false);
  if (!switching && entry && entry.id === COURSE.id) return Promise.resolve(true);   // already loaded (else the async body
                                                                                     // finishes before `switching` is set, and sticks)
  wantCourse = entry;
  if (switching) return switching;
  body.classList.add('is-loading');
  switching = (async () => {
    try {
      while (wantCourse && wantCourse.id !== COURSE.id) {
        const e = wantCourse;
        try {
          await api.loadCourse(e);                        // rebuilds the sim world; the scene follows here
          settings.course = e.id; saveSettings();
          applyCourse(); resetRun();
        } catch (err) {
          console.error(err);
          showToast('That course didn\u2019t load. Try again.');
          if (wantCourse === e) wantCourse = null;
        }
      }
    } finally { switching = null; wantCourse = null; body.classList.remove('is-loading'); }
    return true;
  })();
  return switching;
}
const menu = createMenu({
  themes: api.themes,
  best: () => settings.best,
  courseId: () => COURSE.id,
  vehicleName: (v) => VEHICLE_NAME[v] || v,
  fmtTime,
  load: switchCourse,
  isMenu: () => G.state === 'attract',
  toMenu: () => toMenu(),
  restart: () => restart(),
  run: () => ({ started: G.started, time: G.time }),
});
function applyCourse() {                                    // scene, plane, start point and texts for the loaded course
  START_POS.set(COURSE_DEF[0][0], COURSE_DEF[0][1], COURSE_DEF[0][2]);
  START_DIR.copy(HOOPS[0].pos).sub(START_POS).normalize();
  buildScenery();
  setVehicleModel();
  for (const v in models) body.classList.toggle('vehicle-' + v, TUNE.VEHICLE === v);
  body.classList.toggle('course-pylons', gateNoun() === 'gate');
  G.ghostWanted = false; G.ghostPick = null;
  const bl = hud.boostBtn.querySelector('span'); if (bl) bl.textContent = gliding() ? 'Tuck' : sailing() ? 'Dive' : TUNE.SMOKE ? 'Smoke' : 'Boost';
  smoke.trail.clear();
  renderBest();
}

function startRun() {
  if (switching) return;
  if (G.state === 'attract' && !menu.canStart()) { menu.show('levels'); return; }
  Sound.init();
  blurActive();
  resetRun();
  hud.last = {};
  G.rec = Replay.recorder(); startGhost();
  setState('playing');
  if (input.device === 'mouse' && !input.mouse.locked) tryLock({ onFail: cursorSteer });
  const vs = G.ghost ? (G.ghostPick ? G.ghostPick.who : 'your best run') : null;
  showToast(`${vs ? `Racing ${vs}. ` : ''}The clock starts at the first ${gateNoun()}.`, vs ? 3200 : 2600);
}
function restart() {
  if (G.state === 'attract' || G.state === 'replay') return;
  const wasPaused = G.state === 'paused';
  resetRun(); hud.last = {}; G.rec = Replay.recorder(); startGhost();
  if (wasPaused) resumeFromUser(); else { setState('playing'); if (input.device === 'mouse' && !input.mouse.locked && !input.mouse.lockFailed) tryLock({ onFail: cursorSteer }); }
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
  menu.onPause();
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
  if (G.rec) G.rec.sample(0, P, G.next, true);              // the finishing moment itself (this frame's own sample comes later)
  const gi = ghostInfo(), run = G.rec && G.rec.finish();
  if (run && (!gi || t < gi.time)) {                        // the fastest run is kept as the ghost (js/ghost.js)
    const id = COURSE.id, k = courseKey();
    Object.assign(ghostRun, { id, key: k, track: run });
    Ghost.save(id, k, t, run).then(() => { if (COURSE.id === id) renderBest(); });
  }
  for (const fn of finishHooks) fn({ id: COURSE.id, key: courseKey(), time: t, track: run });   // js/boards.js posts it
  Sound.finish();
  $('finish-time').textContent = fmtTime(t);
  $('finish-best').textContent = prev == null ? 'First time on this course, saved as your best.'
    : best ? `New best, ${(prev - t).toFixed(2)} s faster.` : `Best ${fmtTime(prev)}, ${(t - prev).toFixed(2)} s off.`;
  if (G.pen > 0) $('finish-best').textContent += ` Includes ${G.pen} s of penalties.`;
  if (G.bonus > 0) $('finish-best').textContent += ` Smoke bonus \u2212${Math.round(G.bonus * 100) / 100} s.`;
  renderBest();
  const fin = menu.onFinish(prev == null);
  if (fin.note) $('finish-best').textContent += ' ' + fin.note;
  // the clock stops here, but the results wait FINISH_HOLD s: the camera stays where it was and watches the plane fly on
  // through the finish (the HUD shows the final time meanwhile)
  G.state = 'finished';
  const fc = G.finishCam = { pos: camera.position.clone(), look: _look.clone() };
  const still = () => G.state === 'finished' && G.finishCam === fc;   // not restarted or left meanwhile
  setTimeout(() => {
    if (!still()) return;
    setState('finished');
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    focusEl(fin.focus);
    startReplay();                                          // behind the results: the run again, on a loop
  }, FINISH_HOLD * 1000);
  // no replay (a run too short to show): a victory lap behind the results instead: fly on down the run-out, then fly
  // the course again from the start (heading back to the first gate from here would cut straight across the hills)
  setTimeout(() => { if (still()) resetRun(); }, FINISH_HOLD * 1000 + (gliding() ? 4000 : 2500));
}
const FINISH_HOLD = 1;                                      // s from crossing the finish to the results
// replay (js/replay.js): the recording runs from the start through the finish hold, then plays on a loop from
// trackside cameras until the player flies again or leaves; the plane is posed from it, nothing is simulated
function startReplay() {
  const tr = G.rec && G.rec.finish();
  G.rec = null;
  if (G.ghost) G.ghost.model.group.visible = false;
  G.ghost = null;
  if (!tr || tr.duration < 3) return false;
  return playTrack(tr);
}
function playTrack(tr) {
  const probe = makePlane(); probe.speed = 0;             // a whole plane: crash plugins may read its attitude (js/farm.js)
  const solid = (p) => { probe.pos.copy(p); const c = crashed(probe); return !!c && c !== 'ground'; };
  planeModel.group.visible = true;                          // (a finish mid-crash would measure it empty)
  const dims = new THREE.Box3().setFromObject(planeModel.group).getSize(new V3());
  const size = clamp(Math.max(dims.x, dims.y, dims.z), 1.5, 30) || 9;   // the model's span or length, whichever is more
  // (the frame is kept at least a gate tall: zoomed in on a small wingsuit, a gate would fill the screen)
  G.replay = { size, player: Replay.player(tr, { ground: groundAt, solid, size, gates: HOOPS.length,
    avoid: HOOPS.map((h) => h.pos), avoidR: TUNE.HOOP_R * 3, minFrame: TUNE.HOOP_R * 2 }), level: 0.35 };
  G.finishCam = null; G.crashTimer = 0;                     // (also calls off the victory lap)
  stepReplay(0);
  return true;
}
function stepReplay(dt) {
  const r = G.replay, ev = r.player.step(dt), S = r.player.S;
  if (ev.loop) { resetGates(); G.next = 0; }
  else if (ev.cut) { trails.forEach((t) => t.clear()); smoke.trail.clear(); if (planeModel.puffs) planeModel.puffs.cut(); }
  P.pos.copy(S.pos); P.q.copy(S.q); P.vdir.copy(S.vdir);
  P.speed = S.speed; P.gload = S.gload; P.tuck = S.tuck; P.boosting = S.boosting; P.smoking = S.smoking;
  P.stallWarn = 0; P.stall = false;
  planeModel.group.visible = S.visible;
  if (S.next > G.next) for (let i = G.next; i < S.next; i++) flashGate(i);
  else if (S.next < G.next) { for (const k of gateKits) k.reset(); for (let i = 0; i < S.next; i++) flashGate(i); }   // a loop broken off
  G.next = S.next;
  r.level = 0.35 * clamp(60 / Math.max(1, r.player.cam.pos.distanceTo(P.pos)), 0.15, 1);   // engine fades with distance
}

/* ---------- ghost (js/ghost.js): the fastest run kept, to race against or watch from the menu ---------- */
const courseKey = () => Ghost.key(COURSE, TUNE.VEHICLE);
function coursePlace() {                                    // [theme, level], from 1, in the menu's order
  for (let t = 0; t < api.themes.length; t++) {
    const l = api.themes[t].levels.findIndex((e) => e.id === COURSE.id);
    if (l >= 0) return [t + 1, l + 1];
  }
  return [0, 0];
}
const ghostRun = { id: null, key: null, track: null };      // the kept run of the course loaded, once unpacked
const ghostInfo = () => Ghost.info(COURSE.id, courseKey());
function ghostReady() { return ghostRun.track && ghostRun.id === COURSE.id && ghostRun.key === courseKey() ? ghostRun.track : null; }
async function ghostTrack() {
  if (ghostReady()) return ghostRun.track;
  const id = COURSE.id, k = courseKey(), tr = await Ghost.load(id, k);
  if (tr && COURSE.id === id) Object.assign(ghostRun, { id, key: k, track: tr });
  return tr;
}
function startGhost() {                                     // with Race ghost (and Fly again or a restart after it)
  const tr = !G.ghostWanted ? null : G.ghostPick ? G.ghostPick.track : ghostReady();
  G.ghost = tr ? { track: tr, S: Replay.state(), t: 0, model: ghostModel() } : null;
}
// someone else's run, from the leaderboard (js/boards.js): who is 'Aino, 1:32.10'
function raceTrack(track, who) {
  if (G.state !== 'attract' || switching || !track) return false;
  G.ghostPick = { track, who }; G.ghostWanted = true;
  startRun();
  return true;
}
function watchTrack(track, who) {
  if (G.state !== 'attract' || switching || !track) return false;
  playWatch(track, who);
  return true;
}
async function raceGhost() {
  if (G.state !== 'attract' || switching) return;
  if (!ghostReady() && !(await ghostTrack())) return;       // (unpacked when the menu showed it, so normally at once:
  if (G.state !== 'attract') return;                        // the click still counts for the mouse lock and sound)
  G.ghostPick = null; G.ghostWanted = true;
  startRun();
}
async function watchReplay() {                              // the kept run from trackside, until Back to menu or Esc
  if (G.state !== 'attract' || switching) return;
  const tr = ghostReady() || await ghostTrack(), gi = ghostInfo();
  if (!tr || G.state !== 'attract') return;
  playWatch(tr, gi ? fmtTime(gi.time) : '');
}
function playWatch(tr, label) {
  Sound.init(); blurActive();
  resetRun();
  $('watch-time').textContent = label;
  $('opt-gates-label').textContent = gateNoun() === 'gate' ? 'Show gates' : 'Show hoops';
  setState('replay');
  playTrack(tr);
  focusEl('btn-watch-exit');
}

function toMenu() {
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  resetRun(); setState('attract'); menu.show('levels');
}

$('btn-start').addEventListener('click', () => { G.ghostWanted = false; G.ghostPick = null; startRun(); });
$('btn-ghost').addEventListener('click', raceGhost);
$('btn-watch').addEventListener('click', watchReplay);
$('btn-watch-exit').addEventListener('click', toMenu);
$('btn-resume').addEventListener('click', resumeFromUser);
// pause screen's Restart and Menu: js/menu.js, which asks first once the clock is running (R restarts at once)
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
const frameHooks = [], finishHooks = [];
function update(dt) {
  G.clock += dt;
  for (const fn of frameHooks) fn(dt);                      // polled input (js/pad.js) lands before this frame's physics
  if (G.replay) stepReplay(dt);
  else if (G.state !== 'paused') {
    if (G.crashTimer > 0) {
      G.crashTimer -= dt;
      if (G.state === 'playing' && G.started) G.time += dt;          // crashing costs time
      // the wingsuit can't fly back to an earlier hoop, so the demo and the lap behind the results start again from the top
      if (G.crashTimer <= 0) { if (G.state !== 'playing' && gliding()) resetRun(); else respawn(); }
    } else {
      const ctl = G.state === 'playing' ? resolveControl(dt) : autoControl();
      P.smoking = TUNE.SMOKE ? smokeMeter(P, !!ctl.smoke, dt) : false;   // js/airshow.js
      const steps = Math.ceil(dt / (1 / 120)), h = dt / steps;
      for (let s = 0; s < steps; s++) {
        prevPos.copy(P.pos);
        (sailing() ? stepSail : gliding() ? stepGlide : stepFlight)(P, ctl, h);
        if (G.state === 'playing' && G.started) G.time += h;
        const cross = G.next < HOOPS.length ? gateCross(prevPos, P.pos, G.next) : null;
        if (cross) {
          const lap = G.state !== 'playing';                       // demo or victory lap (read before onHoop: finishing changes the state)
          onHoop(cross === 'miss');
          if (lap && G.next >= HOOPS.length) { resetRun(); break; }   // lap done: again from the start
        }
        if (G.state === 'playing' && PYLONS.length) { const k = pylonHit(P); if (k >= 0) onPylonHit(k); }
        if (G.invuln > 0) G.invuln -= h;
        else { const c = crashed(P); if (c) { onCrash(c); break; } }
      }
    }
  }
  if (G.rec && G.state !== 'paused') G.rec.sample(dt, P, G.next, planeModel.group.visible);   // js/replay.js
  if (G.ghost && G.rec) G.ghost.t = G.rec.elapsed;         // on the clock of the recording it came from
  if (G.state === 'playing' && sailing() && !G.liftHint && (P.lift || 0) > 3 && getBest() == null && G.crashTimer <= 0) {
    G.liftHint = true;                                      // first thermal of a run, until the course is finished once
    showToast('Rising air! Bank hard and circle in it to climb.', 3200);
  }
  // other rising air (js/ridge.js, js/cloudstreet.js) registers its own hint in LIFT_HINTS: { id, min, at(P), text },
  // shown the first time a run meets it, likewise
  if (G.state === 'playing' && sailing() && typeof LIFT_HINTS !== 'undefined' && getBest() == null && G.crashTimer <= 0)
    for (const hn of LIFT_HINTS) if (!G.hints.has(hn.id) && hn.at(P) > hn.min) { G.hints.add(hn.id); showToast(hn.text, 3200); break; }
  boostEdges();
  updateCamera(dt, false);
  updateVisuals(dt);
  updateHUD();
  Sound.update(P, G.state === 'playing' ? 1 : G.state === 'paused' ? 0 : G.replay ? G.replay.level : 0.35);
}
// Show hoops (the replay bar): unticked, a replay looks like the real thing: the gates' marks (hoops, the target disc, the
// pylons' arrows) are left out of the picture, and the pylons stay in their plain paint instead of lighting up as the
// next gate (updateVisuals). The marks are hidden only for the render, so the gate kits' own showing and fading carries
// on underneath and comes back as it was
let showGates = true;
const hiddenNow = [];
function gatesHidden() { return !showGates && G.state === 'replay'; }
function renderFrame() {
  const hide = gatesHidden();
  if (hide) for (const o of [...gateMeshes, gateDisc]) if (o.visible) { o.visible = false; hiddenNow.push(o); }
  renderer.render(scene, camera);
  while (hiddenNow.length) hiddenNow.pop().visible = true;
}
$('opt-gates').addEventListener('change', (e) => { showGates = e.target.checked; });
let last = performance.now(), errShown = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 1 / 20);   // clamp: tab switches and hitches don't teleport the plane
  last = now;
  resolution.frame(now, G.perf ? G.perf.update + G.perf.render : 0);
  if (dt <= 0) return;
  try { const t0 = performance.now(); update(dt); const t1 = performance.now(); renderFrame(); G.perf = { update: t1 - t0, render: performance.now() - t1 }; }
  catch (err) { if (!errShown) { errShown = true; console.error(err); showToast('Something broke: ' + (err && err.message), 8000); } }
}
resetRun();
setState('attract');
requestAnimationFrame((t) => { last = t; frame(t); });
// for add-on modules (js/pad.js): read the state, feed input, and use the same actions the keys do
window.Skyrace = {
  input, setDevice, restart,
  onFrame: (fn) => { frameHooks.push(fn); },
  // js/boards.js: the course flown, each finish with its run, and someone else's run to race or watch
  course: { get id() { return COURSE.id; }, get name() { return COURSE.name; }, get key() { return courseKey(); }, get place() { return coursePlace(); } },
  fmtTime,
  onFinish: (fn) => { finishHooks.push(fn); },
  race: raceTrack,
  watch: watchTrack,
  get state() { return G.state; },
  get crashing() { return G.crashTimer > 0; },
  get hoop() { return G.next; },
};
window.__ml = { G, P, get HOOPS() { return HOOPS; }, get PYLONS() { return PYLONS; }, input, settings, finishRun, switchCourse, get replay() { return G.replay; }, get ghost() { return G.ghost; }, menu, lightStats, resolution, teleport(i) { G.next = i; respawn(); } };
}
