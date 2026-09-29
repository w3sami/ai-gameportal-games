'use strict';
/* =========================================================================
   FARM — farmland for the Farm theme, as a js/shore.js plugin: a patchwork of fields with hedgerows and hedge trees,
   a barn to fly through, silos, a farmhouse and hay bales.
   Course file: farm: { hedges, fields, house, sheds }
     hedges  [[x0, z0, x1, z1], ...]: hedgerows placed by hand, to be flown low over (a tree at each end, unless near the line)
     fields  { angle, reach, size: [min, max], hedges, trees, seed }: rectangular fields on a grid turned `angle`
             degrees, `size` m on a side, wherever they're within `reach` m of the line (default 650). hedges: the share
             of field edges with a hedgerow (default 0.5); trees: hedge trees per 100 m of hedge (default 1.6). No hedge
             tree stands within the line's floor + 18 m, and a hedge leaves a gap where the line crosses it lower than
             6 m over its top.
     house   [x, z, fx, fz]: the farmhouse at (x, z), its front facing (fx, fz); sheds: [[x, z, fx, fz], ...] likewise
   Gates (GATE_TYPES, js/sim.js):
     "barn"  a barn built round the gate, both big doors open along the line: the gate is the doorway, so the point's
             height is the middle of the door (door bottom = floor). It counts on the way out of the far door.
             Options { w, h, len, wide }: door width and height, the barn's length (door to door) and width (m,
             defaults BARN).
   A K gate (js/aerobatic.js) with flank "silo" gets a big silo either side of it.
   Everything is a crash (CRASH_TEXT: barn, silo, house, hedge, tree, bale); the buildings also by a wingtip
   (CRASH_PLUGINS). Fields keep the game's own trees out; hedge trees are round-crowned, drawn and crashed here.
   Sim part (no DOM): buildFarm() (a SHORE plugin), FARM (fields, hedges, trees, barns, silos for the tests).
   Game part: the meshes (the plugin's kit, in CHUNK m squares so the camera culls them and no buffer gets huge) and
   the barn doorway's highlight (GATE_KITS).
   ========================================================================= */
const BARN = { w: 15, h: 11, len: 28, wide: 24 };
const SILO = { r: 4.4, gap: 1.6, above: 9 };               // radius, gap to the slot, height over its top (m)
const FARM = { fields: [], hedges: [], trees: [], barns: [], silos: [], houses: [], bales: [], tipBoxes: [] };
const FARM_TREE_NONE = -1e6;
const CHUNK = 300;                                           // scenery mesh chunks (m)
const CROPS = [
  { id: 'wheat', c: ['#d8bf62', '#cfb458'], w: 3 }, { id: 'stubble', c: ['#e2d198', '#d6c386'], w: 2, bales: true },
  { id: 'pasture', c: ['#86ad58', '#7ea452'], w: 3 }, { id: 'young', c: ['#a3c35e', '#93b650'], w: 2 },
  { id: 'plough', c: ['#8d6b4c', '#7a5b3f'], w: 2 }, { id: 'rape', c: ['#e6d13a', '#dcc632'], w: 1 },
];

function barnSize(h) { const o = h.opts || {}; return { w: o.w || BARN.w, h: o.h || BARN.h, len: o.len || BARN.len, wide: o.wide || BARN.wide }; }
GATE_TYPES.barn = {
  shape(h, u, v) { const b = barnSize(h); return Math.abs(u) < b.w / 2 - 0.4 && Math.abs(v) < b.h / 2 - 0.2; },
  along: (h) => barnSize(h).len / 2 + 0.5,                  // counts out the far door: it can still be crashed in
  disc: () => 0,                                             // the lit doorway says where
  far: 200,                                                  // hard to pick out across the fields: marked from 200 m
  top(h) { const b = barnSize(h); return b.h / 2 + 3 + b.wide * 0.32; },   // the marker over its ridge
};

// farm box: a shoreBox, and also a wingtip hazard (tips) for the buildings
function farmBox(kind, x, z, ux, uz, hu, hv, y0, y1, tips) {
  const b = shoreBox(kind, x, z, ux, uz, hu, hv, y0, y1);
  if (tips) FARM.tipBoxes.push(b);
  return b;
}
function buildFarm() {
  for (const k in FARM) FARM[k].length = 0;
  if (!COURSE) return;
  HOOPS.forEach((h) => { if (h.kind === 'barn') buildBarn(h); if (h.kind === 'K' && h.opts && h.opts.flank === 'silo') buildSilos(h); });
  const F = COURSE.farm;
  if (!F) return;
  if (F.house) placeHouse(F.house, 'house');
  for (const s of F.sheds || []) placeHouse(s, 'shed');
  if (F.fields) farmFields(F.fields);
  const hr = mulberry32(911);
  for (const hg of F.hedges || []) addHedge(hg[0], hg[1], hg[2], hg[3], hr, true);
}
// a gate's frame: level right (rx, rz) and along (fx, fz)
function gateFrame(h) { const L = Math.hypot(h.normal.x, h.normal.z) || 1, fx = h.normal.x / L, fz = h.normal.z / L; return { fx, fz, rx: -fz, rz: fx }; }
function buildBarn(h) {
  const b = barnSize(h), f = gateFrame(h), floor = h.pos.y - b.h / 2, eave = floor + b.h + 3, ridge = eave + b.wide * 0.32;
  const at = (a, s) => [h.pos.x + f.fx * a + f.rx * s, h.pos.z + f.fz * a + f.rz * s];
  const barn = { x: h.pos.x, z: h.pos.z, fx: f.fx, fz: f.fz, floor, eave, ridge, ...b };
  FARM.barns.push(barn);
  const t = 0.4;                                              // wall thickness
  for (const s of [-1, 1]) {                                  // long walls
    const [x, z] = at(0, s * b.wide / 2);
    farmBox('barn', x, z, f.fx, f.fz, b.len / 2, t, floor - 2, eave, true);
  }
  for (const a of [-1, 1]) {                                  // end walls beside and above the doorway
    const side = (b.wide - b.w) / 4;
    for (const s of [-1, 1]) { const [x, z] = at(a * b.len / 2, s * (b.w / 2 + side)); farmBox('barn', x, z, f.fx, f.fz, t, side, floor - 2, eave, true); }
    const [x, z] = at(a * b.len / 2, 0);
    farmBox('barn', x, z, f.fx, f.fz, t, b.w / 2, floor + b.h, ridge, true);
    // door leaves, thrown open: hinged at the doorway's edges, swung out 150° to lean back beside the wall
    for (const s of [-1, 1]) {
      const lw = b.w / 2, ang = Math.PI * 150 / 180;
      const [hx, hz] = at(a * b.len / 2, s * lw);
      const ux = f.fx * Math.sin(ang) * a + f.rx * s * -Math.cos(ang), uz = f.fz * Math.sin(ang) * a + f.rz * s * -Math.cos(ang);
      barn.leaves = barn.leaves || [];
      barn.leaves.push({ hx, hz, ux, uz, lw, a, s });
      farmBox('barn', hx + ux * lw / 2, hz + uz * lw / 2, ux, uz, lw / 2, 0.2, floor - 1, floor + b.h, true);
    }
  }
  farmBox('barn', h.pos.x, h.pos.z, f.fx, f.fz, b.len / 2 + 0.6, b.wide / 2 + 0.6, eave, ridge + 0.5, true);   // roof
  // the farmyard round it stays free of trees
  shoreBox('yard', h.pos.x, h.pos.z, f.fx, f.fz, b.len / 2 + 30, b.wide / 2 + 25, FARM_TREE_NONE - 1, FARM_TREE_NONE);
}
function buildSilos(h) {
  const s = slotSize(h), f = gateFrame(h), d = s.w / 2 + 0.55 + SILO.gap + SILO.r;   // 0.55: the slot's tube
  const top = h.pos.y + s.h / 2 + SILO.above;
  for (const side of [-1, 1]) {
    const x = h.pos.x + f.rx * side * d, z = h.pos.z + f.rz * side * d, foot = groundAt(x, z) - 0.5;
    FARM.silos.push({ x, z, r: SILO.r, foot, top });
    farmBox('silo', x, z, f.fx, f.fz, SILO.r * 0.92, SILO.r * 0.92, foot, top + SILO.r * 0.6, true);
  }
  shoreBox('yard', h.pos.x, h.pos.z, f.fx, f.fz, 30, d + 20, FARM_TREE_NONE - 1, FARM_TREE_NONE);
}
function placeHouse(p, type) {
  const L = Math.hypot(p[2], p[3]) || 1, fx = p[2] / L, fz = p[3] / L;
  const w = type === 'house' ? 11 : 8, d = type === 'house' ? 8 : 6, wall = type === 'house' ? 6 : 3.6, roof = type === 'house' ? 4 : 2.6;
  let lo = Infinity;
  for (const a of [-1, 1]) for (const b of [-1, 1]) lo = Math.min(lo, heightAt(p[0] - fz * a * w / 2 + fx * b * d / 2, p[1] + fx * a * w / 2 + fz * b * d / 2));
  FARM.houses.push({ x: p[0], z: p[1], fx, fz, y: lo, w, d, wall, roof, type });
  farmBox(type, p[0], p[1], -fz, fx, w / 2 + 0.4, d / 2 + 0.4, lo - 1, lo + 0.5 + wall + roof + 1.2, true);
  shoreBox('yard', p[0], p[1], -fz, fx, w / 2 + 14, d / 2 + 14, FARM_TREE_NONE - 1, FARM_TREE_NONE);
}
function farmFields(o) {
  const rand = mulberry32((o.seed || 1) * 977 + 5), ang = (o.angle || 0) * Math.PI / 180;
  const ca = Math.cos(ang), sa = Math.sin(ang), reach = o.reach || 650, sz = o.size || [70, 190];
  const hedgeP = o.hedges == null ? 0.5 : o.hedges;
  TREES_PER_100 = o.trees == null ? 1.6 : o.trees;
  // grid lines along a (x turned by angle) and b, spaced size apart, over the terrain square
  const R = TER.SIZE * 0.75, cuts = () => { const c = [-R]; while (c[c.length - 1] < R) c.push(c[c.length - 1] + sz[0] + rand() * (sz[1] - sz[0])); return c; };
  const A = cuts(), B = cuts();
  const toW = (a, b) => [TER.CX + a * ca - b * sa, TER.CZ + a * sa + b * ca];
  const inside = (x, z) => Math.abs(x - TER.CX) < TER.SIZE * 0.44 && Math.abs(z - TER.CZ) < TER.SIZE * 0.44;
  const cell = new Map();                                     // "i,j" -> field
  const crop = () => { let t = rand() * CROPS.reduce((s, c) => s + c.w, 0); for (const c of CROPS) { t -= c.w; if (t <= 0) return c; } return CROPS[0]; };
  for (let j = 0; j < B.length - 1; j++) for (let i = 0; i < A.length - 1; i++) {
    const a0 = A[i], a1 = A[i + 1], b0 = B[j], b1 = B[j + 1], [cx, cz] = toW((a0 + a1) / 2, (b0 + b1) / 2);
    if (!inside(cx, cz)) continue;
    const cd = courseDistAt(cx, cz), rr = Math.hypot(a1 - a0, b1 - b0) / 2;
    if (!cd.s || cd.d - rr > reach) continue;
    const g = heightAt(cx, cz);
    if (g < TER.WATER + 0.8) continue;
    const fld = { i, j, a0, a1, b0, b1, crop: crop(), rot: rand() < 0.5 ? 0 : 1, seed: Math.floor(rand() * 1e6) };
    FARM.fields.push(fld); cell.set(i + ',' + j, fld);
    shoreBox('clear', cx, cz, ca, sa, (a1 - a0) / 2, (b1 - b0) / 2, FARM_TREE_NONE - 1, FARM_TREE_NONE);
  }
  // hedgerows along shared and outer edges; hedge trees, kept back from the line
  const edge = (p, q) => {
    if (rand() > hedgeP) return;
    const [x0, z0] = toW(p[0], p[1]), [x1, z1] = toW(q[0], q[1]);
    const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
    const gapA = 4 + rand() * 6, gapB = 4 + rand() * 6;       // gateways at the corners
    if (L - gapA - gapB < 20) return;
    addHedge(x0 + ux * gapA, z0 + uz * gapA, x0 + ux * (L - gapB), z0 + uz * (L - gapB), rand, false);
  };
  for (const fld of FARM.fields) {
    const { i, j, a0, a1, b0, b1 } = fld;
    edge([a1, b0], [a1, b1]);                             // right edge (shared with i + 1 if it exists)
    edge([a0, b1], [a1, b1]);                             // top edge
    if (!cell.has((i - 1) + ',' + j)) edge([a0, b0], [a0, b1]);
    if (!cell.has(i + ',' + (j - 1))) edge([a0, b0], [a1, b0]);
  }
  // round bales on the stubble
  for (const fld of FARM.fields) {
    if (!fld.crop.bales) continue;
    const r2 = mulberry32(fld.seed), n = 3 + Math.floor(r2() * 9);
    for (let k = 0; k < n; k++) {
      const a = lerp(fld.a0 + 8, fld.a1 - 8, r2()), b = lerp(fld.b0 + 8, fld.b1 - 8, r2()), [x, z] = toW(a, b);
      const ld = lineDistAt(x, z);
      if (ld.s && ld.d < 6) continue;
      const g = heightAt(x, z), yaw = r2() * Math.PI;
      FARM.bales.push({ x, z, y: g, yaw });
      shoreBox('bale', x, z, Math.cos(yaw), Math.sin(yaw), 0.7, 0.85, g - 0.5, g + 1.6);
    }
  }
  FARM.frame = { ca, sa, toW };
}
// a hedgerow from (x0, z0) to (x1, z1), in pieces about 12 m long that follow the ground, and its trees. A random one
// (byHand false) leaves out the pieces in a building's yard and where it crosses the line lower than it could be
// flown over, and keeps its trees back from the line; one placed by hand (farm.hedges) is meant to be flown over
function addHedge(x0, z0, x1, z1, rand, byHand) {
  const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
  const hh = 2.4 + rand() * 1.4, hw = 1.1 + rand() * 0.4, n = Math.max(1, Math.round(L / 12)), seed = Math.floor(rand() * 1e6);
  for (let k = 0; k < n; k++) {
    const sm = (k + 0.5) * L / n, x = x0 + ux * sm, z = z0 + uz * sm, g = heightAt(x, z);
    if (g < TER.WATER + 0.6 || shoreNearKind(x, z, 2, 'yard')) continue;
    if (!byHand) { const ld = lineDistAt(x, z); if (ld.s && ld.d < ld.s.width + 14 && ld.s.y - g < hh + 6) continue; }
    FARM.hedges.push({ x, z, ux, uz, len: L / n, h: hh, w: hw, seed: seed + k });
    shoreBox('hedge', x, z, ux, uz, L / n / 2, hw, g - 1, g + hh);
  }
  const nt = byHand ? 2 : Math.floor(L / 100 * TREES_PER_100 + rand());
  for (let k = 0; k < nt; k++) {
    const sm = byHand ? (k ? L - 3 : 3) : rand() * L, x = x0 + ux * sm, z = z0 + uz * sm;
    const ld = lineDistAt(x, z);
    if (ld.s && ld.d < ld.s.width + 18) continue;
    addFarmTree(x, z, 8 + rand() * 7, rand);
  }
}
let TREES_PER_100 = 1.6;
function addFarmTree(x, z, h, rand) {
  if (shoreNearKind(x, z, 4, 'yard')) return;
  const g = heightAt(x, z), r = h * (0.3 + rand() * 0.1), trunk = h * 0.32;
  if (g < TER.WATER + 0.6) return;
  FARM.trees.push({ x, z, y: g, h, r, trunk });
  shoreBox('tree', x, z, 1, 0, r * 0.8, r * 0.8, g + trunk, g + h);
  shoreBox('tree', x, z, 1, 0, 0.5, 0.5, g - 1, g + trunk);
}
function shoreNearKind(x, z, pad, kind) {
  const list = SHORE.grid.get(treeKey(Math.floor(x / SHORE_CELL), Math.floor(z / SHORE_CELL)));
  if (list) for (const b of list) if (b.kind === kind && shoreInBox(b, x, z, pad)) return true;
  return false;
}
// wingtips against the buildings
const _fmR = new THREE.Vector3(), _fmP = new THREE.Vector3();
function farmTipHit(P) {
  if (!FARM.tipBoxes.length) return null;
  _fmR.set(1, 0, 0).applyQuaternion(P.q);
  for (const s of [-1, -0.5, 0.5, 1]) {
    _fmP.copy(P.pos).addScaledVector(_fmR, s * TUNE.WING_HALF);
    for (const b of FARM.tipBoxes) {
      if (_fmP.y < b.y0 - 0.15 || _fmP.y > b.y1 + 0.15) continue;
      if (Math.abs(_fmP.x - b.x) > b.hu + b.hv + 1 || Math.abs(_fmP.z - b.z) > b.hu + b.hv + 1) continue;
      if (shoreInBox(b, _fmP.x, _fmP.z, 0.15)) return b.kind;
    }
  }
  return null;
}
CRASH_PLUGINS.push(farmTipHit);
var CRASH_TEXT = CRASH_TEXT || {};
Object.assign(CRASH_TEXT, { barn: 'Hit the barn', silo: 'Hit a silo', house: 'Hit the farmhouse', shed: 'Hit a shed', hedge: 'Clipped a hedge', bale: 'Hit a hay bale' });

/* ---------- game part ---------- */
function createFarmKit() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const fieldMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.userData.shared = true; fieldMat.userData.shared = true;
  const Mx = createMesher(), { BOX, CBOX, CYL, CONE, ICO, PRISM } = Mx.G;
  const C = (h) => new THREE.Color(h);
  const RED = C('#9c2b22'), TRIM = C('#f1ede3'), ROOF = C('#4a4d52'), FLOOR = C('#8a7a62'), HAY = C('#d9c070'), DARK = C('#2a2522');
  const CONC = C('#c9c6bd'), STEEL = C('#aeb4b8'), HEDGE = [C('#4d6b32'), C('#56753a'), C('#45622c')], LEAF = [C('#4f7433'), C('#5c8140'), C('#476a2f')];
  const TRUNK = C('#5b4631'), YELLOW = C('#e3c476'), GLASS = C('#2f3d47');
  const col = new THREE.Color();

  function fields(group, list) {
    if (!list.length) return;
    const pos = [], cols = [], { toW } = FARM.frame, step = 16, margin = 1.6;
    for (const f of list) {
      const a0 = f.a0 + margin, a1 = f.a1 - margin, b0 = f.b0 + margin, b1 = f.b1 - margin;
      const na = Math.max(1, Math.round((a1 - a0) / step)), nb = Math.max(1, Math.round((b1 - b0) / step));
      const c0 = C(f.crop.c[0]), c1 = C(f.crop.c[1]), rows = f.crop.id !== 'pasture';
      const r = mulberry32(f.seed), tint = 0.94 + r() * 0.1;
      const V = [];
      for (let j = 0; j <= nb; j++) for (let i = 0; i <= na; i++) {
        const [x, z] = toW(lerp(a0, a1, i / na), lerp(b0, b1, j / nb));
        V.push([x, heightAt(x, z) + 0.25, z]);
      }
      for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) {
        const k = j * (na + 1) + i, a = V[k], b = V[k + 1], d = V[k + na + 1], e = V[k + na + 2];
        if (a[1] < TER.WATER + 0.5 || e[1] < TER.WATER + 0.5) continue;
        const band = f.rot ? i : j;
        col.copy(c0).lerp(c1, rows ? (band & 1) : ((i * 7 + j * 13) % 5) / 5).multiplyScalar(tint * (0.97 + r() * 0.06));
        for (const t of [[a, d, e], [a, e, b]]) for (const v of t) { pos.push(v[0], v[1], v[2]); cols.push(col.r, col.g, col.b); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, fieldMat));
  }
  function hedge(hg) {                                        // lumps along the piece, following the ground
    const r = mulberry32(hg.seed), n = Math.max(2, Math.round(hg.len / 6));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n - 0.5, x = hg.x + hg.ux * t * hg.len, z = hg.z + hg.uz * t * hg.len, g = heightAt(x, z), s = 0.85 + r() * 0.3;
      Mx.frame(x, g, z, hg.ux, hg.uz);
      Mx.part(ICO, HEDGE[Math.floor(r() * 3)], 0, hg.h * 0.5 * s, 0, hg.w * 1.15, hg.h * 0.58 * s, 4.1, r() * 0.4);
    }
  }
  function tree(t) {                                          // round crown on a trunk
    const r = mulberry32(Math.floor(t.x * 13 + t.z * 7));
    Mx.frame(t.x, t.y, t.z, 1, 0);
    Mx.part(CYL, TRUNK, 0, -0.5, 0, 0.35 + t.h * 0.02, t.trunk + 1.2, 0.35 + t.h * 0.02);
    const leaf = LEAF[Math.floor(r() * 3)];
    Mx.part(ICO, leaf, 0, t.trunk + (t.h - t.trunk) * 0.5, 0, t.r, (t.h - t.trunk) * 0.55, t.r, r() * 3);
    Mx.part(ICO, leaf, t.r * 0.35, t.trunk + (t.h - t.trunk) * 0.62, t.r * 0.2, t.r * 0.7, (t.h - t.trunk) * 0.4, t.r * 0.7, r() * 3);
  }
  function bale(b) {
    Mx.frame(b.x, b.y, b.z, Math.cos(b.yaw), Math.sin(b.yaw));
    Mx.part(CYL, HAY, 0, 0.78, -0.65, 0.78, 1.3, 0.78, 0, Math.PI / 2);   // on its side
  }
  function barn(b) {
    Mx.frame(b.x, b.floor, b.z, b.fx, b.fz);                    // local -z along the line, x across
    const L = b.len, W = b.wide, E = b.eave - b.floor, Rg = b.ridge - b.eave, t = 0.4, dw = b.w, dh = b.h;
    Mx.part(BOX, FLOOR, 0, -2, 0, W, 2.05, L + 1);                                          // floor slab
    for (const s of [-1, 1]) Mx.part(BOX, RED, s * (W / 2 - t / 2), 0, 0, t, E, L);        // long walls
    for (const a of [-1, 1]) {
      const z = a * (L / 2 - t / 2), side = (W - dw) / 2;
      for (const s of [-1, 1]) Mx.part(BOX, RED, s * (dw / 2 + side / 2), 0, z, side, E, t);   // beside the doorway
      Mx.part(BOX, RED, 0, dh, z, dw, E - dh, t);                                               // above it
      Mx.part(PRISM, RED, 0, E, z, W, Rg, t);                                                   // gable
      // white trim: door frame, corner boards, a hay door above
      for (const s of [-1, 1]) Mx.part(BOX, TRIM, s * (dw / 2 + 0.2), 0, a * (L / 2 + 0.05), 0.4, dh + 0.4, 0.15);
      Mx.part(BOX, TRIM, 0, dh, a * (L / 2 + 0.05), dw + 0.8, 0.4, 0.15);
      for (const s of [-1, 1]) Mx.part(BOX, TRIM, s * (W / 2 - 0.1), 0, a * (L / 2 + 0.05), 0.3, E, 0.15);
      Mx.part(BOX, TRIM, 0, E + 0.8, a * (L / 2 + 0.06), 3.2, 2.6, 0.12);                   // hay door
      Mx.part(BOX, RED, 0, E + 0.95, a * (L / 2 + 0.1), 2.8, 2.3, 0.12);
    }
    // gambrel roof: two steep lower slopes, two flatter upper ones. The mesher only tilts about local x, so these are
    // drawn in a frame turned to face across the barn (local x along it, z across)
    Mx.frame(b.x, b.floor, b.z, -b.fz, b.fx);
    const yk = Rg * 0.62, xk = W / 2 * 0.45, lowA = Math.atan2(yk, W / 2 - xk), upA = Math.atan2(Rg - yk, xk);
    for (const s of [-1, 1]) {
      Mx.part(CBOX, ROOF, 0, E + yk / 2, s * (W / 2 + xk) / 2, L + 1.4, 0.3, Math.hypot(W / 2 - xk, yk) + 0.6, 0, s * lowA);
      Mx.part(CBOX, ROOF, 0, E + (yk + Rg) / 2, s * xk / 2, L + 1.4, 0.3, Math.hypot(xk, Rg - yk) + 0.3, 0, s * upA);
    }
    Mx.frame(b.x, b.floor, b.z, b.fx, b.fz);
    for (const lf of b.leaves || []) {                          // door leaves, open
      Mx.frame(lf.hx + lf.ux * lf.lw / 2, b.floor, lf.hz + lf.uz * lf.lw / 2, lf.ux, lf.uz);   // local z along the leaf
      Mx.part(BOX, RED, 0, 0, 0, 0.25, dh - 0.2, lf.lw - 0.2);
      for (const y of [0, (dh - 0.5) / 2, dh - 0.5]) Mx.part(BOX, TRIM, 0, y, 0, 0.32, 0.3, lf.lw - 0.2);
      for (const z of [-1, 1]) Mx.part(BOX, TRIM, 0, 0, z * (lf.lw / 2 - 0.25), 0.32, dh - 0.2, 0.3);
    }
    // inside: hay stacked along the walls, clear of the doorway's line
    for (const s of [-1, 1]) for (let z = -L / 2 + 3; z < L / 2 - 3; z += 2.6) {
      Mx.part(BOX, HAY, s * (W / 2 - 1.6), 0, z, 2.2, 1.2 + ((z * 3) & 1) * 1.1, 2.3);
    }
  }
  function silo(s) {
    Mx.frame(s.x, s.foot, s.z, 1, 0);
    const H = s.top - s.foot;
    Mx.part(CYL, CONC, 0, 0, 0, s.r, H, s.r);
    for (let y = 3; y < H; y += 3.2) Mx.part(CYL, STEEL, 0, y, 0, s.r + 0.08, 0.25, s.r + 0.08);
    Mx.part(CONE, STEEL, 0, H, 0, s.r + 0.2, s.r * 0.6, s.r + 0.2);
    Mx.part(BOX, DARK, 0, 0, -s.r, 0.5, H, 0.3);                // ladder chute
  }
  function house(o) {
    Mx.frame(o.x, o.y, o.z, o.fx, o.fz);
    const { w, d, wall, roof } = o, body = o.type === 'house' ? YELLOW : RED;
    Mx.part(BOX, C('#8b857a'), 0, -1, 0, w + 0.3, 1.6, d + 0.3);
    Mx.part(BOX, body, 0, 0.5, 0, w, wall, d);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) Mx.part(BOX, TRIM, sx * (w / 2 - 0.05), 0.5, sz * (d / 2 - 0.05), 0.22, wall, 0.22);
    Mx.part(PRISM, body, 0, 0.5 + wall, 0, d, roof, w, Math.PI / 2);
    for (const s of [-1, 1]) Mx.part(BOX, ROOF, 0, 0.5 + wall + roof / 2 - 0.05, s * d / 4, w + 0.8, 0.18, Math.hypot(d / 2, roof) + 0.5, 0, s * Math.atan2(roof, d / 2));
    if (o.type === 'house') {
      Mx.part(BOX, C('#7b3a2c'), w * 0.25, 0.5 + wall + roof * 0.3, d * 0.1, 0.7, roof * 0.95, 0.7);   // chimney
      for (const fl of [1.3, 4.1]) for (const x of [-0.3, 0, 0.3]) {
        Mx.part(BOX, TRIM, x * w, fl, -d / 2 - 0.04, 1.2, 1.35, 0.1);
        Mx.part(BOX, GLASS, x * w, fl + 0.12, -d / 2 - 0.08, 0.9, 1.1, 0.08);
      }
    } else Mx.part(BOX, DARK, 0, 0.5, -d / 2 - 0.04, w * 0.55, wall * 0.8, 0.1);
  }
  return {
    // in CHUNK m squares, one mesh each for the fields and the rest: small buffers the camera can cull (one mesh for the
    // whole farm is over 700k vertices, which some GPUs draw a thousand times slower)
    build(group) {
      const chunks = new Map(), key = (x, z) => Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
      const put = (kind, o, x, z) => {
        const k = key(x, z);
        if (!chunks.has(k)) chunks.set(k, { fields: [], items: [] });
        if (kind === 'field') chunks.get(k).fields.push(o); else chunks.get(k).items.push([kind, o]);
      };
      for (const f of FARM.fields) { const [x, z] = FARM.frame.toW((f.a0 + f.a1) / 2, (f.b0 + f.b1) / 2); put('field', f, x, z); }
      for (const o of FARM.hedges) put(hedge, o, o.x, o.z);
      for (const o of FARM.trees) put(tree, o, o.x, o.z);
      for (const o of FARM.bales) put(bale, o, o.x, o.z);
      for (const o of FARM.barns) put(barn, o, o.x, o.z);
      for (const o of FARM.silos) put(silo, o, o.x, o.z);
      for (const o of FARM.houses) put(house, o, o.x, o.z);
      for (const ch of chunks.values()) {
        fields(group, ch.fields);
        Mx.reset();
        for (const [fn, o] of ch.items) fn(o);
        const m = Mx.mesh(mat);
        if (m) group.add(m);
      }
    },
  };
}
SHORE_PLUGINS.push({ build: buildFarm, createKit: createFarmKit });

// the barn's doorway, lit like a hoop when it's the next gate
function createBarnGateKit(ctx) {
  const M = ctx.hoopMat;
  let items = [];
  return {
    build(group) {
      items = [];
      HOOPS.forEach((h, i) => {
        if (h.kind !== 'barn') return;
        const b = barnSize(h), f = gateFrame(h), r = 0.35, meshes = [];
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(-f.fx, 0, -f.fz), WORLD_UP));
        // a frame just inside the entrance: two posts and the lintel
        const bar = (w, hh, x, y) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, r * 2), M.later);
          m.position.set(x, y, 0).applyQuaternion(q).add(h.pos).addScaledVector(new THREE.Vector3(f.fx, 0, f.fz), -b.len / 2 - 0.35);
          m.quaternion.copy(q); group.add(m); meshes.push(m);
        };
        for (const s of [-1, 1]) bar(r * 2, b.h, s * (b.w / 2 - r), 0);
        bar(b.w, r * 2, 0, b.h / 2 - r);
        items.push({ i, meshes });
      });
    },
    update(s) {
      for (const it of items) {
        const rel = it.i - s.next, mat = rel === 0 ? M.next : rel === 1 ? M.soon : M.later;
        for (const m of it.meshes) { m.visible = rel >= 0; m.material = mat; }
      }
    },
    pass() {},
    reset() {},
  };
}
GATE_KITS.push(createBarnGateKit);
