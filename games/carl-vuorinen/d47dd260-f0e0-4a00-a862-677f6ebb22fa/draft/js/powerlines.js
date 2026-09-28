'use strict';
/* =========================================================================
   POWER LINES — lattice towers carrying three conductors and an earth wire, as a js/shore.js plugin.
   Course file: powerlines: [{ pts, h, arm, sag, balls, clear }]
     pts    the towers in order along the line, [[x, z], ...]. Each stands on the ground there, or on a concrete footing
            where it's in the water
     h      height of a tower's top (the earth wire) above its foot, or above the water where it stands in it (m, default 36)
     arm    half-width of the crossarm; the three conductors hang at -arm, 0 and +arm across the line, DROP m below the
            top (m, default 7)
     sag    how far every span's wires hang at mid-span below the straight line between its towers, as a share of the
            span (default 0.035: 10.5 m on a 300 m span)
     balls  orange and white marker balls on the earth wire over spans that cross water (default true)
     clear  half-width of the tree-free corridor cut along it on land (m, default arm + 10)
   Everything is a crash ('powerline'): each tower, and each span's conductors (one band across all three) and its
   earth wire, filed as short boxes that follow the sag. The gap between the earth wire and the conductors is open.
   On land a corridor under each span is kept clear of trees, as a real line's would be.
   Sim part (no DOM): buildPowerlines() (a SHORE plugin), powerlineSpans() for the tests: per span its ends and
   wireY(u), the conductors' height at u (0..1) along it. Game part: the meshes (the plugin's kit).
   ========================================================================= */
const PL_DEF = { h: 36, arm: 7, sag: 0.035, balls: true, clear: null };
const PL_DROP = 8.5;                                          // conductors below the top (m): crossarm 6 m down, insulators 2.5 m
const PL_SEG = 12;                                            // crash boxes along a span: about this long (m)
const PL_PAD = 0.35;                                          // wire thickness in the crash boxes, either side (m)
const PL_TREE_NONE = -1e6;                                    // tree-free corridor boxes: far underground, never hit
let _plFor = null;
const _pl = [];
// per line: settings and towers { x, z, foot, top, fx, fz (the line's direction there), wet }; per span: a, b towers, length
function powerlineList() {
  if (_plFor === COURSE) return _pl;
  _plFor = COURSE; _pl.length = 0;
  for (const spec of (COURSE && COURSE.powerlines) || []) {
    const o = Object.assign({}, PL_DEF, spec), T = [];
    spec.pts.forEach((p, i) => {
      const a = spec.pts[Math.max(0, i - 1)], b = spec.pts[Math.min(spec.pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, g = heightAt(p[0], p[1]), wet = g < TER.WATER + 0.5;
      const foot = wet ? TER.WATER + 1.2 : g;
      T.push({ x: p[0], z: p[1], ground: g, foot, top: foot + o.h, fx: dx / l, fz: dz / l, wet });
    });
    const S = [];
    for (let i = 0; i + 1 < T.length; i++) {
      const a = T[i], b = T[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
      const ca = a.top - PL_DROP, cb = b.top - PL_DROP, sag = o.sag * L;
      let wet = 0;                                             // share of the span over water, for the marker balls
      for (let k = 1; k < 20; k++) if (heightAt(lerp(a.x, b.x, k / 20), lerp(a.z, b.z, k / 20)) < TER.WATER) wet++;
      S.push({ a, b, L, ux: (b.x - a.x) / L, uz: (b.z - a.z) / L, sag, wet: wet / 19,
               wireY: (u) => lerp(ca, cb, u) - 4 * sag * u * (1 - u),
               earthY: (u) => lerp(a.top, b.top, u) - 4 * sag * u * (1 - u) });
    }
    _pl.push({ o, T, S });
  }
  return _pl;
}
const powerlineSpans = () => powerlineList().flatMap((l) => l.S.map((s) => Object.assign({ arm: l.o.arm }, s)));

/* ---------- crash boxes and the tree-free corridor (a js/shore.js plugin) ---------- */
function buildPowerlines() {
  for (const L of powerlineList()) {
    const o = L.o;
    for (const t of L.T) {
      shoreBox('powerline', t.x, t.z, t.fx, t.fz, 2.4, 2.4, t.ground - 2, t.top - 6.5);                 // the lattice body
      shoreBox('powerline', t.x, t.z, t.fx, t.fz, 0.8, o.arm + 0.6, t.top - 6.7, t.top - 5.3);          // crossarm
      shoreBox('powerline', t.x, t.z, t.fx, t.fz, 0.9, 0.9, t.top - 6.5, t.top);                        // peak
      for (const s of [-1, 0, 1])                                                                       // insulators
        shoreBox('powerline', t.x - t.fz * s * o.arm, t.z + t.fx * s * o.arm, t.fx, t.fz, 0.4, 0.4, t.top - PL_DROP, t.top - 6);
    }
    for (const s of L.S) {
      const n = Math.max(2, Math.ceil(s.L / PL_SEG));
      for (let k = 0; k < n; k++) {
        const u0 = k / n, u1 = (k + 1) / n, um = (u0 + u1) / 2;
        const x = lerp(s.a.x, s.b.x, um), z = lerp(s.a.z, s.b.z, um), hu = s.L / n / 2;
        const c0 = s.wireY(u0), c1 = s.wireY(u1), e0 = s.earthY(u0), e1 = s.earthY(u1);
        // lowest point inside the segment (the sag's bottom may fall between its ends)
        const cm = Math.min(c0, c1, s.wireY(clamp(0.5, u0, u1))), em = Math.min(e0, e1, s.earthY(clamp(0.5, u0, u1)));
        shoreBox('powerline', x, z, s.ux, s.uz, hu, o.arm + PL_PAD, cm - PL_PAD, Math.max(c0, c1) + PL_PAD);
        shoreBox('powerline', x, z, s.ux, s.uz, hu, PL_PAD, em - PL_PAD, Math.max(e0, e1) + PL_PAD);
      }
      // corridor: no trees within `clear` m of the line (trees keep 6 m off any box), filed in pieces along the span
      const cw = Math.max(1, (o.clear != null ? o.clear : o.arm + 10) - 6);
      for (let k = 0; k < n; k += 2) {
        const um = (k + 1) / n, x = lerp(s.a.x, s.b.x, um), z = lerp(s.a.z, s.b.z, um);
        shoreBox('field', x, z, s.ux, s.uz, s.L / n + 1, cw, PL_TREE_NONE, PL_TREE_NONE);
      }
    }
  }
}

/* ---------- meshes ---------- */
function createPowerlineKit() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.shared = true;
  const Mx = createMesher(), { BOX, CYL, ICO } = Mx.G;
  const C = (h) => new THREE.Color(h);
  const STEEL = C('#8e979d'), GLASS = C('#9fb3a6'), CONCRETE = C('#b7b1a6'), WIRE = C('#3b4044');
  const BALL = [C('#ff6a1a'), C('#f4f4f0')];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), m = new THREE.Matrix4();
  const sc = new THREE.Vector3(), pp = new THREE.Vector3(), v = new THREE.Vector3();
  // a thin rod from a to b (world space), as a 6-sided cylinder of radius r, added straight to the mesher's buffers
  const pos = [], col = [];
  function rod(a, b, r, c) {
    d.subVectors(b, a); const L = d.length();
    if (L < 1e-3) return;
    q.setFromUnitVectors(up, d.divideScalar(L));
    m.compose(pp.copy(a), q, sc.set(r, L, r));
    for (let i = 0; i < CYL.count; i++) { v.fromBufferAttribute(CYL, i).applyMatrix4(m); pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); }
  }
  function tower(t, o) {
    const V = (x, y, z) => new THREE.Vector3(t.x + (-t.fz) * x + t.fx * z, y, t.z + t.fx * x + t.fz * z);   // x across, z along
    const y0 = t.foot, y1 = t.top - 6.5, H = y1 - y0, b0 = 3.2, b1 = 1.0;
    const hw = (y) => lerp(b0, b1, (y - y0) / H);
    if (t.wet) { Mx.frame(t.x, 0, t.z, t.fx, t.fz); Mx.part(BOX, CONCRETE, 0, t.ground - 1, 0, 8.5, t.foot - t.ground + 1, 8.5); }
    else { Mx.frame(t.x, 0, t.z, t.fx, t.fz); Mx.part(BOX, CONCRETE, 0, t.ground - 1, 0, 8, 1.6, 8); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(V(sx * b0, y0, sz * b0), V(sx * b1, y1, sz * b1), 0.22, STEEL);   // legs
    const lv = [y0, y0 + H * 0.3, y0 + H * 0.55, y0 + H * 0.75, y1];
    for (let k = 0; k + 1 < lv.length; k++) {                // X bracing on all four faces between levels
      const ya = lv[k], yb = lv[k + 1], wa = hw(ya), wb = hw(yb);
      for (const s of [-1, 1]) {
        rod(V(-wa, ya, s * wa), V(wb, yb, s * wb), 0.1, STEEL); rod(V(wa, ya, s * wa), V(-wb, yb, s * wb), 0.1, STEEL);
        rod(V(s * wa, ya, -wa), V(s * wb, yb, wb), 0.1, STEEL); rod(V(s * wa, ya, wa), V(s * wb, yb, -wb), 0.1, STEEL);
        rod(V(-wb, yb, s * wb), V(wb, yb, s * wb), 0.1, STEEL); rod(V(s * wb, yb, -wb), V(s * wb, yb, wb), 0.1, STEEL);
      }
    }
    // crossarm: a truss the width of the line, then the peak for the earth wire
    for (const sz of [-1, 1]) {
      rod(V(-o.arm - 0.4, t.top - 6, sz * 0.7), V(o.arm + 0.4, t.top - 6, sz * 0.7), 0.16, STEEL);
      rod(V(-b1, t.top - 6.5 + 1.4, sz * 0.7), V(-o.arm - 0.4, t.top - 6, sz * 0.7), 0.1, STEEL);
      rod(V(b1, t.top - 6.5 + 1.4, sz * 0.7), V(o.arm + 0.4, t.top - 6, sz * 0.7), 0.1, STEEL);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(V(sx * b1, y1, sz * b1), V(0, t.top, 0), 0.14, STEEL);
    for (const s of [-1, 0, 1]) rod(V(s * o.arm, t.top - 6, 0), V(s * o.arm, t.top - PL_DROP, 0), 0.22, GLASS);   // insulator strings
  }
  function wire(s, off, yOf, r, c) {                         // one wire along a span, off m across it, sagging
    const n = Math.max(6, Math.ceil(s.L / 15)), a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const u0 = k / n, u1 = (k + 1) / n;
      a.set(lerp(s.a.x, s.b.x, u0) - s.uz * off, yOf(u0), lerp(s.a.z, s.b.z, u0) + s.ux * off);
      b.set(lerp(s.a.x, s.b.x, u1) - s.uz * off, yOf(u1), lerp(s.a.z, s.b.z, u1) + s.ux * off);
      rod(a, b, r, c);
    }
  }
  return {
    build(group) {
      const PL = powerlineList();
      if (!PL.length) return;
      Mx.reset(); pos.length = 0; col.length = 0;
      for (const L of PL) {
        for (const t of L.T) tower(t, L.o);
        for (const s of L.S) {
          for (const off of [-L.o.arm, 0, L.o.arm]) wire(s, off, s.wireY, 0.16, WIRE);
          wire(s, 0, s.earthY, 0.1, WIRE);
          if (L.o.balls && s.wet > 0.3) {                    // marker balls, every 40 m or so along the earth wire
            const nb = Math.max(1, Math.round(s.L / 40) - 1);
            for (let k = 1; k <= nb; k++) {
              const u = k / (nb + 1);
              Mx.frame(lerp(s.a.x, s.b.x, u), 0, lerp(s.a.z, s.b.z, u), s.ux, s.uz);
              Mx.part(ICO, BALL[k & 1], 0, s.earthY(u) - 0.3, 0, 1.1, 1.1, 1.1);
            }
          }
        }
      }
      const parts = Mx.mesh(mat);
      if (parts) group.add(parts);
      if (pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.computeVertexNormals();
        group.add(new THREE.Mesh(g, mat));
      }
    },
  };
}
SHORE_PLUGINS.push({ build: buildPowerlines, createKit: createPowerlineKit });
var CRASH_TEXT = CRASH_TEXT || {};
CRASH_TEXT.powerline = 'Hit the power line';
