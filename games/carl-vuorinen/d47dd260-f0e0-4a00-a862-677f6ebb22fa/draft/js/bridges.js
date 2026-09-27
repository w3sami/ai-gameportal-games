'use strict';
/* Bridges over hoops (course format in js/sim.js): a point with gate "B" is an ordinary hoop with a bridge across the
   path over it. The 8th value of the point sets the bridge: { type, top, open, span, ... } (any key of BRIDGE_DEF below
   overrides the type's default):
     type    "beam" (concrete road bridge on piers), "arch" (stone), "truss" (steel rail bridge, truss above the main
             span), "suspension" (footbridge hung from two towers)
     top     height of the main span's underside above the water (for an arch: its crown)
     open    clear width of the main span (m)
     span    which section the hoop is in: 0 (default) the main span; 1 / -1 the next span to the right / left as you
             fly. The bridge then shifts sideways so that section is on the path, and the river swings under its main
             span. Beam and truss: the first approach span; arch: the bridge becomes a row of equal arches, as many
             as the floodplain has room for.
     deck, road, pier, step, truss, towerH   deck thickness, road width, pier thickness, spacing of the approach
             piers, truss height above the deck, tower height above the deck (m)
   The point's height is the hoop's centre, so pick it and `top` so the hoop fits under the span. The deck runs out to
   where the ground on either bank reaches it. Everything solid is a crash.
   Sim part (no DOM): bridgeSpanOffset(spec) (buildWorld uses it for the river), buildBridges(), bridgeHit(p),
   bridgeNear(). createBridgeKit(): the meshes. */
const BRIDGE_DEF = {
  beam: { open: 46, top: 22, deck: 2.4, road: 11, pier: 3, step: 34 },
  arch: { open: 52, top: 24, deck: 3.4, road: 9, archPier: 7 },
  truss: { open: 58, top: 21, deck: 1.8, road: 8, pier: 4.5, step: 30, truss: 9 },
  suspension: { open: 72, top: 21, deck: 1.1, road: 5, towerH: 24 },
};
const BRIDGES = [];
const bridgeSpec = (spec) => {
  const type = BRIDGE_DEF[spec.type] ? spec.type : 'beam';
  return Object.assign({}, BRIDGE_DEF[type], spec, { type, span: type === 'suspension' ? 0 : Math.sign(spec.span || 0) });
};
// where the hoop sits across the bridge: its section's centre, relative to the middle of the main span (+ = right)
function bridgeSpanOffset(spec) {
  const b = bridgeSpec(spec);
  if (!b.span) return 0;
  return b.span * (b.type === 'arch' ? b.open + b.archPier : b.open / 2 + b.pier / 2 + b.step / 2);
}

function buildBridges() {
  BRIDGES.length = 0;
  HOOPS.forEach((h, gi) => {
    if (!h.bridgeSpec) return;
    const b = Object.assign(bridgeSpec(h.bridgeSpec), { gate: gi });
    const L = Math.hypot(h.normal.x, h.normal.z) || 1;
    b.ux = h.normal.x / L; b.uz = h.normal.z / L;           // across the bridge: the flying direction, level
    b.vx = -b.uz; b.vz = b.ux;                              // along it: right of the flying direction
    const off = bridgeSpanOffset(h.bridgeSpec);             // the hoop's section is on the path, so the middle is beside it
    b.ox = h.pos.x - b.vx * off; b.oz = h.pos.z - b.vz * off;
    b.y0 = TER.WATER; b.a = b.open / 2; b.under = b.y0 + b.top; b.deckTop = b.under + b.deck;
    const at = (v, u) => heightAt(b.ox + b.vx * v + b.ux * u, b.oz + b.vz * v + b.uz * u);
    b.ground = (v) => Math.min(at(v, -b.road / 2), at(v, 0), at(v, b.road / 2));
    // each end: the first place outside the spans that must exist where the bank is up to the deck (then a little into it)
    const need = !b.span ? b.a : b.type === 'arch' ? 3 * b.a + b.archPier + 5 : b.a + b.pier + b.step * 1.4 + 2;
    const end = (s) => { const n = s === b.span ? need : b.a; for (let d = n; d < 600; d += 2) if (b.ground(s * d) >= b.deckTop - 0.5) return d + 4; return 600; };
    b.L0 = end(-1); b.L1 = end(1);
    b.solids = [];
    const solid = (v0, v1, y0, y1, uh, holes) => b.solids.push({ v0, v1, y0, y1, uh, holes });
    const footAt = (v0, v1) => Math.min(b.ground(v0), b.ground(v1), b.ground((v0 + v1) / 2)) - 3;
    b.piers = [];
    const pier = (c, w, force) => {                         // skipped where the bank is already up to the deck
      if (!force && b.ground(c) >= b.under - 1.5) return;
      const p = { v0: c - w / 2, v1: c + w / 2, y0: footAt(c - w / 2, c + w / 2) };
      b.piers.push(p); solid(p.v0, p.v1, p.y0, b.under, b.road / 2 - 0.6);
    };
    if (b.type === 'arch') {
      // one wall, road wide: the main arch, then either equal side arches (span) or a small flood arch each side
      b.holes = [{ c: 0, a: b.a, b: b.top }];
      const a2 = Math.min(13, b.top * 0.55), flood = [];
      for (const s of [-1, 1]) {
        const L = s < 0 ? b.L0 : b.L1;
        if (b.span) {                                       // row of equal arches: the one each side always, more while the floodplain lasts
          for (let k = 1; ; k++) {
            const c = s * k * (b.open + b.archPier);
            if (k > 1 && (Math.abs(c) + b.a + 5 > L || b.ground(c) > b.y0 + b.top * 0.6)) break;
            b.holes.push({ c, a: b.a, b: b.top });
          }
          continue;
        }
        const c = s * (b.a + 6 + a2);
        if (Math.abs(c) + a2 + 5 < L && b.ground(c) < b.y0 + a2 * 0.6) flood.push({ c, a: a2, b: a2 * 1.15 });
      }
      if (flood.length === 2) b.holes.push(...flood);       // flood arches in pairs only: one on its own looks lopsided
      b.base = Math.min(b.y0 - 4, footAt(-b.L0, b.L1));
      solid(-b.L0, b.L1, b.base, b.deckTop + 1.1, b.road / 2, b.holes);
    } else if (b.type === 'suspension') {
      b.towers = [-1, 1].map((s) => {
        const c = s * (b.a + 1.6), t = { v0: c - 1.6, v1: c + 1.6, y0: footAt(c - 1.6, c + 1.6), y1: b.deckTop + b.towerH };
        solid(t.v0, t.v1, t.y0, t.y1, b.road / 2 + 1.8);
        return t;
      });
      solid(-b.L0, b.L1, b.under, b.deckTop + 1.1, b.road / 2);
    } else {
      solid(-b.L0, b.L1, b.under, b.deckTop + 1.1, b.road / 2);
      const c1 = b.a + b.pier / 2;                          // main piers, then approach piers every `step` to each end
      for (const s of [-1, 1]) {
        pier(s * c1, b.pier, true);
        for (let c = c1 + b.step; c < (s < 0 ? b.L0 : b.L1) - b.step * 0.4; c += b.step) pier(s * c, b.pier, s === b.span && c === c1 + b.step);
      }
      if (b.type === 'truss') solid(-(b.a + b.pier), b.a + b.pier, b.deckTop, b.deckTop + b.truss, b.road / 2 + 0.4);
    }
    const reach = Math.max(b.L0, b.L1) + b.road + 12;
    b.R2 = reach * reach;
    h.bridge = b;
    BRIDGES.push(b);
  });
}

function bridgeHit(p) {
  const m = 0.9;                                            // plane's reach around its centre
  for (const b of BRIDGES) {
    const dx = p.x - b.ox, dz = p.z - b.oz;
    if (dx * dx + dz * dz > b.R2) continue;
    const u = dx * b.ux + dz * b.uz, v = dx * b.vx + dz * b.vz;
    for (const s of b.solids) {
      if (Math.abs(u) > s.uh + m || v < s.v0 - m || v > s.v1 + m || p.y < s.y0 - m || p.y > s.y1 + m) continue;
      if (s.holes && s.holes.some((o) => { const hv = (v - o.c) / (o.a - m), hy = (p.y - b.y0) / (o.b - m); return hv * hv + hy * hy < 1; })) continue;
      return true;
    }
  }
  return false;
}
function bridgeNear(x, z, pad) {                          // keeps trees off the decks and abutments
  for (const b of BRIDGES) {
    const dx = x - b.ox, dz = z - b.oz, u = dx * b.ux + dz * b.uz, v = dx * b.vx + dz * b.vz;
    if (Math.abs(u) < b.road / 2 + pad && v > -b.L0 - pad && v < b.L1 + pad) return true;
  }
  return false;
}

/* ---------- look ---------- */
function createBridgeKit() {
  const shared = (m) => { m.userData.shared = true; return m; };
  const MAT = {
    concrete: shared(new THREE.MeshLambertMaterial({ color: '#cfcac0' })),
    stone: shared(new THREE.MeshLambertMaterial({ color: '#b39c7e' })),
    stoneDark: shared(new THREE.MeshLambertMaterial({ color: '#8f7b62' })),
    road: shared(new THREE.MeshLambertMaterial({ color: '#5d5e62' })),
    rail: shared(new THREE.MeshLambertMaterial({ color: '#4b5057' })),
    steel: shared(new THREE.MeshLambertMaterial({ color: '#b5462e' })),
    tower: shared(new THREE.MeshLambertMaterial({ color: '#e9e6df' })),
    cable: shared(new THREE.MeshLambertMaterial({ color: '#3a3f46' })),
  };
  const Y = new THREE.Vector3(0, 1, 0), ZA = new THREE.Vector3(0, 0, 1);

  // Bridge-local frame: x = along the span (v), y = up, z = against the flying direction; parts are collected per
  // material and merged, so a bridge is a handful of draw calls however many members it has.
  function collector() {
    const parts = new Map();
    const add = (geo, mat, m4) => {
      let g = geo.index ? geo.toNonIndexed() : geo;
      if (g !== geo) geo.dispose();
      if (m4) g.applyMatrix4(m4);
      if (!parts.has(mat)) parts.set(mat, []);
      parts.get(mat).push(g);
    };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    const box = (v0, v1, y0, y1, zh, mat, zc = 0) => {
      if (v1 - v0 < 0.01 || y1 - y0 < 0.01) return;
      add(new THREE.BoxGeometry(v1 - v0, y1 - y0, zh * 2), mat, m4.makeTranslation((v0 + v1) / 2, (y0 + y1) / 2, zc));
    };
    const beam = (a, b, t, mat) => {                        // square member from a to b, t thick
      const d = new THREE.Vector3().subVectors(b, a), len = d.length();
      q.setFromUnitVectors(ZA, d.divideScalar(len));
      add(new THREE.BoxGeometry(t, t, len), mat, m4.compose(p.addVectors(a, b).multiplyScalar(0.5), q, s));
    };
    const merge = (group) => {
      for (const [mat, list] of parts) {
        let n = 0; for (const g of list) n += g.attributes.position.count;
        const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
        let o = 0;
        for (const g of list) { pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        group.add(new THREE.Mesh(geo, mat));
      }
    };
    return { add, box, beam, merge };
  }

  function railings(c, b, v0, v1, y) {                      // posts and a top rail along both edges of the deck
    for (const zs of [-1, 1]) {
      const z = zs * (b.road / 2 - 0.15);
      c.box(v0, v1, y + 0.95, y + 1.1, 0.12, MAT.rail, z);
      for (let v = v0; v <= v1; v += 3) c.box(v - 0.08, v + 0.08, y, y + 1, 0.08, MAT.rail, z);
    }
  }
  function roadDeck(c, b, mat) {
    c.box(-b.L0, b.L1, b.under, b.deckTop - 0.25, b.road / 2, mat);
    c.box(-b.L0, b.L1, b.deckTop - 0.25, b.deckTop, b.road / 2 - 0.2, MAT.road);
    c.box(-b.L0, b.L1, b.deckTop - 0.25, b.deckTop + 0.25, 0.3, mat, b.road / 2 - 0.3);   // kerbs
    c.box(-b.L0, b.L1, b.deckTop - 0.25, b.deckTop + 0.25, 0.3, mat, -(b.road / 2 - 0.3));
  }

  function buildBeam(c, b) {
    roadDeck(c, b, MAT.concrete);
    railings(c, b, -b.L0, b.L1, b.deckTop);
    for (const p of b.piers) {                               // wall pier with a cap, rounded look from a narrower core
      c.box(p.v0, p.v1, p.y0, b.under - 1.2, b.road / 2 - 1.4, MAT.concrete);
      c.box(p.v0 - 0.4, p.v1 + 0.4, b.under - 1.2, b.under, b.road / 2 - 0.6, MAT.concrete);
    }
  }
  function buildTruss(c, b) {
    roadDeck(c, b, MAT.concrete);
    for (const p of b.piers) c.box(p.v0, p.v1, p.y0, b.under, b.road / 2 - 0.6, MAT.stone);
    const x0 = -(b.a + b.pier), x1 = b.a + b.pier, n = Math.max(4, Math.round((x1 - x0) / 7)), H = b.truss, y = b.deckTop;
    const P = (x, yy, z) => new THREE.Vector3(x, yy, z);
    for (const zs of [-1, 1]) {
      const z = zs * (b.road / 2 + 0.2);
      for (let i = 0; i <= n; i++) {
        const xa = x0 + (x1 - x0) * i / n, top = i > 0 && i < n;
        if (top) c.beam(P(xa, y, z), P(xa, y + H, z), 0.45, MAT.steel);
        if (i < n) {
          const xb = x0 + (x1 - x0) * (i + 1) / n;
          c.beam(P(xa, y + 0.2, z), P(xb, y + 0.2, z), 0.6, MAT.steel);                    // bottom chord
          if (i > 0 && i < n - 1) c.beam(P(xa, y + H, z), P(xb, y + H, z), 0.6, MAT.steel); // top chord
          if (i === 0) c.beam(P(xa, y, z), P(xb, y + H, z), 0.6, MAT.steel);                 // end posts
          else if (i === n - 1) c.beam(P(xa, y + H, z), P(xb, y, z), 0.6, MAT.steel);
          else if (i < n / 2) c.beam(P(xa, y + H, z), P(xb, y, z), 0.35, MAT.steel);          // diagonals toward the middle
          else c.beam(P(xa, y, z), P(xb, y + H, z), 0.35, MAT.steel);
        }
      }
    }
    for (let i = 1; i < n; i++) {                            // overhead cross bracing
      const x = x0 + (x1 - x0) * i / n;
      c.beam(P(x, y + H, -(b.road / 2 + 0.2)), P(x, y + H, b.road / 2 + 0.2), 0.3, MAT.steel);
    }
    railings(c, b, -b.L0, x0, b.deckTop); railings(c, b, x1, b.L1, b.deckTop);
  }
  function buildArch(c, b) {
    // wall outline: the bottom edge goes up and over each arch
    const sh = new THREE.Shape(), holes = b.holes.slice().sort((p, q) => p.c - q.c), base = b.base, top = b.deckTop;
    sh.moveTo(-b.L0, base);
    for (const o of holes) {
      sh.lineTo(o.c - o.a, base); sh.lineTo(o.c - o.a, b.y0);
      for (let k = 1; k <= 24; k++) { const t = Math.PI - Math.PI * k / 24; sh.lineTo(o.c + o.a * Math.cos(t), b.y0 + o.b * Math.sin(t)); }
      sh.lineTo(o.c + o.a, base);
    }
    sh.lineTo(b.L1, base); sh.lineTo(b.L1, top); sh.lineTo(-b.L0, top); sh.closePath();
    const wall = new THREE.ExtrudeGeometry(sh, { depth: b.road, bevelEnabled: false, curveSegments: 1 });
    wall.translate(0, 0, -b.road / 2);
    c.add(wall, MAT.stone);
    for (const o of holes) {                                 // darker voussoir ring on both faces
      for (const zs of [-1, 1]) for (let k = 0; k < 14; k++) {
        const t0 = Math.PI * k / 14, t1 = Math.PI * (k + 1) / 14, r = 1.15;
        const a = new THREE.Vector3(o.c + (o.a + r / 2) * Math.cos(t0), b.y0 + (o.b + r / 2) * Math.sin(t0), zs * (b.road / 2 + 0.1));
        const e = new THREE.Vector3(o.c + (o.a + r / 2) * Math.cos(t1), b.y0 + (o.b + r / 2) * Math.sin(t1), zs * (b.road / 2 + 0.1));
        c.beam(a, e, r, MAT.stoneDark);
      }
    }
    c.box(-b.L0, b.L1, top, top + 1.1, 0.35, MAT.stone, b.road / 2 - 0.35);     // parapets
    c.box(-b.L0, b.L1, top, top + 1.1, 0.35, MAT.stone, -(b.road / 2 - 0.35));
    c.box(-b.L0, b.L1, top - 0.15, top + 0.05, b.road / 2 - 0.7, MAT.road);
    c.box(-b.L0 - 0.3, b.L1 + 0.3, top - 0.9, top - 0.5, b.road / 2 + 0.3, MAT.stoneDark);   // string course
  }
  function buildSuspension(c, b) {
    c.box(-b.L0, b.L1, b.under, b.deckTop, b.road / 2, MAT.tower);
    railings(c, b, -b.L0, b.L1, b.deckTop);
    const zc = b.road / 2 + 0.9, V = (x, y, z) => new THREE.Vector3(x, y, z);
    const tops = b.towers.map((t) => {
      const x = (t.v0 + t.v1) / 2, yt = t.y1;
      for (const zs of [-1, 1]) c.box(t.v0 + 0.5, t.v1 - 0.5, t.y0, yt, 0.7, MAT.tower, zs * zc);   // legs
      c.box(t.v0 + 0.5, t.v1 - 0.5, yt - 2.2, yt - 0.8, zc, MAT.tower);                                 // crossbeam
      c.box(t.v0 + 0.5, t.v1 - 0.5, b.under - 1.4, b.under, zc, MAT.tower);                             // deck beam
      return { x, y: yt - 0.4 };
    });
    const [tl, tr] = tops, sag = (x) => {                      // main span: parabola down to just over the deck
      const k = (x - tl.x) / (tr.x - tl.x);
      return lerp(tl.y, tr.y, k) - (tl.y - (b.deckTop + 1.6)) * 4 * k * (1 - k);
    };
    for (const zs of [-1, 1]) {
      const z = zs * zc, N = 20;
      for (let i = 0; i < N; i++) {
        const xa = lerp(tl.x, tr.x, i / N), xb = lerp(tl.x, tr.x, (i + 1) / N);
        c.beam(V(xa, sag(xa), z), V(xb, sag(xb), z), 0.35, MAT.cable);
        if (i > 0) c.beam(V(xa, sag(xa), z), V(xa, b.deckTop, z), 0.1, MAT.cable);   // hangers
      }
      c.beam(V(tl.x, tl.y, z), V(-b.L0 + 2, b.deckTop + 0.5, z), 0.35, MAT.cable);    // back stays to the anchors
      c.beam(V(tr.x, tr.y, z), V(b.L1 - 2, b.deckTop + 0.5, z), 0.35, MAT.cable);
    }
    for (const x of [-b.L0 + 2, b.L1 - 2]) c.box(x - 2, x + 2, b.deckTop - 2, b.deckTop + 1, zc + 0.8, MAT.concrete);   // anchor blocks
  }

  function build(group) {
    for (const b of BRIDGES) {
      const g = new THREE.Group();
      g.position.set(b.ox, 0, b.oz);
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(b.vx, 0, b.vz), Y, new THREE.Vector3(-b.ux, 0, -b.uz)));
      const c = collector();
      ({ beam: buildBeam, truss: buildTruss, arch: buildArch, suspension: buildSuspension })[b.type](c, b);
      c.merge(g);
      group.add(g);
    }
  }
  return { build };
}
