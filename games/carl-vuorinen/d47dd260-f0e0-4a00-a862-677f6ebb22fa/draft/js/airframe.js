'use strict';
/* =========================================================================
   AIRFRAME — shared toolkit for the aircraft models.
   A model is built from parts (lofted bodies, airfoil wings, tubes, ellipsoids) into ONE merged mesh per material
   (body, glass) plus the spinning prop, so an aircraft costs ~4 draw calls however detailed it is. Wings marked
   flex bend up in the vertex shader with uniform afFlex (k, x0) — ailerons, winglets and the shadow with them.
     createModel()                    a collection of parts and their distance functions (for occlusion)
     createAtlas(size)                regions of one livery canvas; each builder maps its own coordinates into a region
     loft(M, part, stations, o)       body of superellipse sections along z ({z, w, t, b, y, p, pt}: half width, height
                                      above / below the centre y, squareness p (2 = ellipse; pt for the top half)
     wing(M, part, o)                 tapered, swept, twisted airfoil surface with dihedral; control surfaces are split
                                      off as their own strips and hinge in the vertex shader (afDefl channels)
     tube(M, part, a, b, r0, r1, o)   tapered tube between two points;  ellipsoid(M, part, c, r, o)
     build(M, o)                      normals (faceted by default, or creased smooth), baked occlusion, merged geometry, materials
   Livery lives in a canvas texture (crisp stripes, panel lines, lettering at no geometry cost); the vertex colour
   carries the baked occlusion. The body shader adds hinge rotation, a sky-tinted rim, nav-light glow and afSun
   (direct sunlight on the aircraft, dimmed in terrain shadow); the glass shader reflects the sky gradient.
   Nose along -Z, +X to the pilot's right, +Y up.
   ========================================================================= */
const Airframe = (() => {
  const V3 = THREE.Vector3;
  const ENV = {                                             // shared by every aircraft material
    afSky: { value: new THREE.Color('#5c9bd2') }, afHorizon: { value: new THREE.Color('#cfe1ec') },
    afGround: { value: new THREE.Color('#62834b') },
  };
  const opts = { shading: 'flat' };                         // 'flat' (faceted, the game's look) or 'smooth' (creased normals)

  /* ---------- livery atlas ---------- */
  function createAtlas(size = 512) {
    const regions = [];
    const A = {
      size,
      // pixel rect [x0, x1) x [y0, y1) holds part coordinates a in [a0, a1] (across) and b in [b0, b1] (down)
      region(x0, y0, x1, y1, a0, a1, b0, b1) {
        const r = { x0, y0, x1, y1, a0, a1, b0, b1,
          uv: (a, b) => [(x0 + (a - a0) / (a1 - a0) * (x1 - x0)) / size, 1 - (y0 + (b - b0) / (b1 - b0) * (y1 - y0)) / size],
          px: (a, b) => [x0 + (a - a0) / (a1 - a0) * (x1 - x0), y0 + (b - b0) / (b1 - b0) * (y1 - y0)] };
        regions.push(r); return r;
      },
      solid(x0, y0, color) {                                // a flat swatch: every uv lands in its middle
        const r = A.region(x0, y0, x0 + 16, y0 + 16, 0, 1, 0, 1), c = [(x0 + 8) / size, 1 - (y0 + 8) / size];
        r.color = color; r.uv = () => c; return r;
      },
      texture(paint) {
        const cv = document.createElement('canvas'); cv.width = cv.height = size;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, size, size);
        for (const r of regions) if (r.color) { ctx.fillStyle = r.color; ctx.fillRect(r.x0 - 3, r.y0 - 3, 22, 22); }
        // draw(ctx) in the region's own coordinates; base fills it (with 3 px of bleed for the mipmaps)
        const on = (r, base, draw) => {
          ctx.save();
          ctx.beginPath(); ctx.rect(r.x0 - 3, r.y0 - 3, r.x1 - r.x0 + 6, r.y1 - r.y0 + 6); ctx.clip();
          if (base) { ctx.fillStyle = base; ctx.fillRect(r.x0 - 3, r.y0 - 3, r.x1 - r.x0 + 6, r.y1 - r.y0 + 6); }
          const sx = (r.x1 - r.x0) / (r.a1 - r.a0), sy = (r.y1 - r.y0) / (r.b1 - r.b0);
          ctx.setTransform(sx, 0, 0, sy, r.x0 - r.a0 * sx, r.y0 - r.b0 * sy);
          if (draw) draw(ctx, r);
          ctx.restore();
        };
        paint(ctx, on);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
        return t;
      },
    };
    return A;
  }
  // canvas helpers in region coordinates
  function poly(ctx, pts, color) {
    ctx.fillStyle = color; ctx.beginPath();
    pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
    ctx.closePath(); ctx.fill();
  }
  // a panel line from (a0, b0) to (a1, b1), `w` pixels wide whatever the region's scale
  function line(ctx, r, a0, b0, a1, b1, color, w = 1) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const p = r.px(a0, b0), q = r.px(a1, b1);
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    ctx.restore();
  }
  // text centred on (a, b), `h` pixels tall; flipX / flipY for mirrored halves; o: { sx (horizontal stretch, for
  // regions with more pixels per metre one way), rot (rad, e.g. for fins whose span runs across), stroke, strokeW, font, italic }
  function text(ctx, r, str, a, b, h, color, flipX, flipY, o = {}) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const p = r.px(a, b);
    ctx.translate(p[0], p[1]); ctx.rotate(o.rot || 0); ctx.scale((flipX ? -1 : 1) * (o.sx || 1), flipY ? -1 : 1);
    ctx.font = (o.italic ? 'italic ' : '') + (o.font || 'bold ' + h + 'px Arial, Helvetica, sans-serif');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (o.stroke) { ctx.lineJoin = 'round'; ctx.strokeStyle = o.stroke; ctx.lineWidth = o.strokeW || 3; ctx.strokeText(str, 0, 0); }
    ctx.fillStyle = color; ctx.fillText(str, 0, 0);
    ctx.restore();
  }

  /* ---------- parts ---------- */
  function createModel() {
    const M = { parts: [], sdfs: [] };
    // o: { mat: 'body' | 'glass', crease (rad), cs: control surface, glow: 0 | 1 steady | 2 strobe, ao: false,
    //      node: a separately moving piece (its own mesh, built in model coordinates; occlusion still sees everything),
    //      flex: bends up with afFlex (wings): y += k * max(|x| - x0, 0)^2 }
    M.part = (o = {}) => {
      const p = { pos: [], uv: [], mat: o.mat || 'body', crease: o.crease == null ? 0.6 : o.crease, cs: null,
                  glow: o.glow || 0, flip: false, ao: o.ao !== false, node: o.node || '', flex: o.flex ? 1 : 0 };
      M.parts.push(p); return p;
    };
    return M;
  }
  function tri(p, a, b, c, ua, ub, uc) {
    if (p.flip) { const t = b; b = c; c = t; const s = ub; ub = uc; uc = s; }
    p.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    p.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  const ZERO_UV = [0, 0];

  /* ---------- lofted body ---------- */
  const lerp = (a, b, t) => a + (b - a) * t;
  function sectionAt(st, z) {
    if (z <= st[0].z) return st[0];
    for (let i = 1; i < st.length; i++) if (z <= st[i].z) {
      const a = st[i - 1], b = st[i], t = (z - a.z) / (b.z - a.z || 1);
      return { z, w: lerp(a.w, b.w, t), t: lerp(a.t, b.t, t), b: lerp(a.b, b.b, t), y: lerp(a.y || 0, b.y || 0, t), p: lerp(a.p || 2.5, b.p || 2.5, t), pt: lerp(a.pt || a.p || 2.5, b.pt || b.p || 2.5, t) };
    }
    return st[st.length - 1];
  }
  // o: { seg (even), region (a = z, b = angle 0..1 from the top round the +X side), matrix (rigid), capRegion }
  function loft(M, part, stations, o = {}) {
    const seg = o.seg || 12, mtx = o.matrix || null, region = o.region;
    const flip0 = part.flip;
    if (mtx && mtx.determinant() < 0) part.flip = !part.flip;
    const rings = stations.map((s) => {
      const pts = [], eB = 2 / (s.p || 2.5), eT = 2 / (s.pt || s.p || 2.5);
      for (let k = 0; k <= seg; k++) {
        const th = k / seg * Math.PI * 2, sn = Math.sin(th), cs = Math.cos(th), e = cs >= 0 ? eT : eB;
        const v = new V3(s.w * Math.sign(sn) * Math.pow(Math.abs(sn), e),
          (s.y || 0) + (cs >= 0 ? s.t : s.b) * Math.sign(cs) * Math.pow(Math.abs(cs), e), s.z);
        if (mtx) v.applyMatrix4(mtx);
        pts.push(v);
      }
      return pts;
    });
    const uv = (s, k) => (region ? region.uv(s.z, k / seg) : ZERO_UV);
    for (let i = 0; i + 1 < rings.length; i++) {
      const r0 = rings[i], r1 = rings[i + 1], s0 = stations[i], s1 = stations[i + 1];
      for (let k = 0; k < seg; k++) {
        tri(part, r0[k], r1[k], r1[k + 1], uv(s0, k), uv(s1, k), uv(s1, k + 1));
        tri(part, r0[k], r1[k + 1], r0[k + 1], uv(s0, k), uv(s1, k + 1), uv(s0, k + 1));
      }
    }
    const cap = (i, front) => {
      const s = stations[i];
      if (s.w < 1e-4 && s.t < 1e-4) return;
      const c = new V3(0, (s.y || 0) + (s.t - s.b) * 0.5, s.z + (front ? -1 : 1) * (o.bulge || 0));
      if (mtx) c.applyMatrix4(mtx);
      const cr = o.capRegion, cu = cr ? cr.uv(s.z, 0.5) : uv(s, seg / 2);
      for (let k = 0; k < seg; k++) {
        const a = rings[i][k], b = rings[i][k + 1], ua = cr ? cu : uv(s, k), ub = cr ? cu : uv(s, k + 1);
        if (front) tri(part, c, a, b, cu, ua, ub); else tri(part, c, b, a, cu, ub, ua);
      }
    };
    cap(0, true); cap(stations.length - 1, false);
    part.flip = flip0;
    // distance (roughly) to the surface: radial distance to the local section, then past the ends
    const inv = mtx ? mtx.clone().invert() : null, z0 = stations[0].z, z1 = stations[stations.length - 1].z, q = new V3();
    M.sdfs.push((P) => {
      q.copy(P); if (inv) q.applyMatrix4(inv);
      const s = sectionAt(stations, q.z), x = q.x, y = q.y - s.y, h = y > 0 ? s.t : s.b, r = Math.hypot(x, y);
      let dr;
      if (s.w < 1e-3 || h < 1e-3) dr = r;
      else {
        const pp = y > 0 ? (s.pt || s.p) : s.p, rho = Math.pow(Math.pow(Math.abs(x / s.w), pp) + Math.pow(Math.abs(y / h), pp), 1 / pp);
        dr = rho > 1e-6 ? r * (1 - 1 / rho) : -Math.min(s.w, h);
      }
      const dz = Math.max(z0 - q.z, q.z - z1, 0);
      return dz > 0 ? Math.hypot(Math.max(dr, 0), dz) : dr;
    });
    return rings;
  }

  /* ---------- airfoil surfaces ---------- */
  const thick = (x) => 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
  function stationAt(st, s) {
    if (s <= st[0].s) return st[0];
    for (let i = 1; i < st.length; i++) if (s <= st[i].s + 1e-9) {
      const a = st[i - 1], b = st[i], t = (s - a.s) / (b.s - a.s || 1);
      return { s, c: lerp(a.c, b.c, t), le: lerp(a.le, b.le, t), t: lerp(a.t, b.t, t), tw: lerp(a.tw || 0, b.tw || 0, t), y: lerp(a.y || 0, b.y || 0, t) };
    }
    return st[st.length - 1];
  }
  /* o: { root: V3, side: ±1, dihedral (rad, tip up), stations: [{s, c, le, t, tw, y}] (s along the span, c chord,
          le leading edge's z, t thickness / chord, tw nose-up twist, y offset), camber (fraction of chord),
          surfaces: [{from, to, ch, sense: V3}] (positive deflection moves the trailing edge along `sense`, default down),
          hinge (chord fraction where the surfaces split off, all of them; 0 = all-moving), pivot (hinge line's chord fraction), top, bottom (regions: a = s, b = chord fraction), xs (chord samples) }
     part: the fixed parts; control surfaces become parts of their own (same material) */
  function wing(M, part, o) {
    const side = o.side || 1, phi = o.dihedral || 0, root = o.root || new V3(), camber = o.camber || 0;
    const surfaces = o.surfaces || [], h = surfaces.length ? (o.hinge == null ? 0.72 : o.hinge) : 1;
    const pivot = o.pivot == null ? h : o.pivot;                // the hinge line's chord fraction (all-moving: h 0, pivot ~0.3)
    let xs = o.xs || [0, 0.015, 0.06, 0.15, 0.3, 0.5, 0.72, 1];
    if (h < 1 && !xs.some((x) => Math.abs(x - h) < 1e-6)) xs = xs.concat([h]).sort((a, b) => a - b);
    const cph = Math.cos(phi), sph = Math.sin(phi);
    // local (s along span, y up, z aft) -> model
    const toModel = (s, x, yy, st) => {
      const c = st.c, dz = (x - 0.25) * c, dy = yy * c, ca = Math.cos(st.tw || 0), sa = Math.sin(st.tw || 0);
      const ly = dy * ca - dz * sa + (st.y || 0), lz = st.le + 0.25 * c + dz * ca + dy * sa, lx = side * s;
      const ang = side * phi, cr = Math.cos(ang), sr = Math.sin(ang);
      return new V3(root.x + lx * cr - ly * sr, root.y + lx * sr + ly * cr, root.z + lz);
    };
    const yU = (x, st) => (x >= 1 ? 0.001 : st.t * thick(x) * 0.5) + camber * 4 * x * (1 - x);
    const yL = (x, st) => (x >= 1 ? -0.001 : -st.t * thick(x) * 0.5) + camber * 4 * x * (1 - x);
    // span stations, with the control surfaces' ends added
    const bounds = new Set();
    for (const f of surfaces) { bounds.add(f.from); bounds.add(f.to); }
    let st = o.stations.slice();
    for (const b of bounds) if (!st.some((x) => Math.abs(x.s - b) < 1e-6)) st.push(stationAt(o.stations, b));
    st.sort((a, b) => a.s - b.s);
    const sMin = st[0].s, sMax = st[st.length - 1].s;
    // one strip: chord samples `ring` (each {x, up}) over stations `ss`, with end caps
    const strip = (p, ss, ring, closeFace) => {
      const flip0 = p.flip; if (side < 0) p.flip = !p.flip;
      const P = ss.map((s) => ring.map((r) => toModel(s.s, r.x, r.up ? yU(r.x, s) : yL(r.x, s), s)));
      const reg = (r) => (r.up ? o.top : o.bottom) || o.top;
      const uv = (s, r, onSide) => { const g = onSide || reg(r); return g ? g.uv(s.s, r.x) : ZERO_UV; };
      const n = ring.length;
      for (let i = 0; i + 1 < ss.length; i++) {
        for (let j = 0; j < n; j++) {
          const k = (j + 1) % n;
          if (k === 0 && !closeFace) continue;
          const g = ring[j].up === ring[k].up ? reg(ring[j]) : o.top;
          const A = P[i][j], B = P[i][k], C = P[i + 1][k], D = P[i + 1][j];
          tri(p, A, D, C, uv(ss[i], ring[j], g), uv(ss[i + 1], ring[j], g), uv(ss[i + 1], ring[k], g));
          tri(p, A, C, B, uv(ss[i], ring[j], g), uv(ss[i + 1], ring[k], g), uv(ss[i], ring[k], g));
        }
      }
      for (const [i, rootEnd] of [[0, true], [ss.length - 1, false]]) {
        const pts = P[i], c = pts.reduce((a, v) => a.add(v), new V3()).multiplyScalar(1 / n), cu = uv(ss[i], { x: 0.5, up: true }, o.top);
        for (let j = 0; j < n; j++) {
          const k = (j + 1) % n;
          if (rootEnd) tri(p, c, pts[j], pts[k], cu, cu, cu); else tri(p, c, pts[k], pts[j], cu, cu, cu);
        }
      }
      p.flip = flip0;
    };
    const fwd = xs.filter((x) => x <= h + 1e-9), aft = xs.filter((x) => x >= h - 1e-9);
    // front strip: upper surface hinge -> leading edge, lower leading edge -> hinge
    const ringF = fwd.slice().reverse().map((x) => ({ x, up: true })).concat(fwd.slice(1).map((x) => ({ x, up: false })));
    if (h > 0) strip(part, st, ringF, true);
    if (h < 1) {
      // aft strips: upper trailing edge -> hinge, lower hinge -> trailing edge; split at the surfaces' ends
      const ringA = aft.slice().reverse().map((x) => ({ x, up: true })).concat(aft.map((x) => ({ x, up: false })));
      const cuts = [...new Set([sMin, sMax, ...bounds])].sort((a, b) => a - b);
      for (let i = 0; i + 1 < cuts.length; i++) {
        const a = cuts[i], b = cuts[i + 1], ss = st.filter((x) => x.s >= a - 1e-9 && x.s <= b + 1e-9);
        if (ss.length < 2) continue;
        const f = surfaces.find((q) => a >= q.from - 1e-9 && b <= q.to + 1e-9);
        let p = part;
        if (f) {
          p = M.part({ mat: part.mat, crease: part.crease, node: part.node, flex: part.flex });
          const sa = stationAt(st, a), sb = stationAt(st, b);
          const H0 = toModel(a, pivot, (yU(pivot, sa) + yL(pivot, sa)) / 2, sa), H1 = toModel(b, pivot, (yU(pivot, sb) + yL(pivot, sb)) / 2, sb);
          const axis = H1.clone().sub(H0).normalize();
          // orient so a positive angle moves the trailing edge along `sense`
          const T = toModel((a + b) / 2, 1, 0, stationAt(st, (a + b) / 2)).sub(H0), sense = f.sense || new V3(0, -1, 0);
          if (new V3().crossVectors(axis, T).dot(sense) < 0) axis.negate();
          p.cs = { hinge: H0, axis, ch: f.ch };
        }
        strip(p, ss, ringA, true);
      }
    }
    // distance: a box in the wing's frame round each span position's chord and thickness
    const q = new V3(), ang = side * phi, cr = Math.cos(ang), sr = Math.sin(ang);
    M.sdfs.push((P) => {
      const x = P.x - root.x, y = P.y - root.y;
      const lx = x * cr + y * sr, ly = -x * sr + y * cr, s = side * lx, z = P.z - root.z;
      const S = stationAt(st, Math.min(Math.max(s, sMin), sMax));
      const ex = Math.abs(s - (sMin + sMax) / 2) - (sMax - sMin) / 2;
      const ez = Math.abs(z - (S.le + S.c / 2)) - S.c / 2, ey = Math.abs(ly - (S.y || 0)) - S.t * S.c * 0.5;
      q.set(Math.max(ex, 0), Math.max(ey, 0), Math.max(ez, 0));
      return q.length() + Math.min(Math.max(ex, ey, ez), 0);
    });
  }

  /* ---------- tubes and ellipsoids ---------- */
  const _Z = new V3(0, 0, 1);
  // o: { seg, region (solid), flat (section height / width), roll (rad about the tube) }
  function tube(M, part, a, b, r0, r1, o = {}) {
    const d = b.clone().sub(a), L = d.length(), f = o.flat || 1;
    const m = new THREE.Matrix4().compose(a, new THREE.Quaternion().setFromUnitVectors(_Z, d.normalize())
      .multiply(new THREE.Quaternion().setFromAxisAngle(_Z, o.roll || 0)), new V3(1, 1, 1));
    loft(M, part, [{ z: 0, w: r0, t: r0 * f, b: r0 * f, p: 2 }, { z: L, w: r1, t: r1 * f, b: r1 * f, p: 2 }],
      { seg: o.seg || 6, matrix: m, region: o.region });
  }
  // c: centre, r: V3 radii; o: { seg, rings, region, p, matrix (extra rotation) }; a region's a runs along the
  // ellipsoid's own z (-r.z..r.z), not the model's
  function ellipsoid(M, part, c, r, o = {}) {
    const n = o.rings || 6, st = [];
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * i / n, s = Math.sin(a);
      st.push({ z: -Math.cos(a) * r.z, w: r.x * s + 1e-5, t: r.y * s + 1e-5, b: r.y * s + 1e-5, p: o.p || 2 });
    }
    const m = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z);
    if (o.matrix) m.multiply(o.matrix);
    loft(M, part, st, { seg: o.seg || 10, matrix: m, region: o.region });
  }

  /* ---------- normals ---------- */
  function normals(p, smooth) {
    const P = p.pos, nf = P.length / 9, N = new Float32Array(P.length);
    const fn = new Float32Array(nf * 3), fu = new Float32Array(nf * 3);
    const a = new V3(), b = new V3(), c = new V3();
    for (let f = 0; f < nf; f++) {
      a.fromArray(P, f * 9); b.fromArray(P, f * 9 + 3); c.fromArray(P, f * 9 + 6);
      c.sub(b); b.sub(a); b.cross(c);                       // area-weighted face normal
      fn[f * 3] = b.x; fn[f * 3 + 1] = b.y; fn[f * 3 + 2] = b.z;
      const l = b.length() || 1;
      fu[f * 3] = b.x / l; fu[f * 3 + 1] = b.y / l; fu[f * 3 + 2] = b.z / l;
    }
    if (!smooth) {
      for (let f = 0; f < nf; f++) for (let v = 0; v < 3; v++) N.set(fu.subarray(f * 3, f * 3 + 3), f * 9 + v * 3);
      return N;
    }
    const key = (i) => Math.round(P[i] * 2e3) + ',' + Math.round(P[i + 1] * 2e3) + ',' + Math.round(P[i + 2] * 2e3);
    const at = new Map();
    for (let f = 0; f < nf; f++) for (let v = 0; v < 3; v++) {
      const k = key(f * 9 + v * 3); let l = at.get(k); if (!l) at.set(k, (l = [])); l.push(f);
    }
    const cosC = Math.cos(p.crease);
    for (let f = 0; f < nf; f++) {
      const ux = fu[f * 3], uy = fu[f * 3 + 1], uz = fu[f * 3 + 2];
      for (let v = 0; v < 3; v++) {
        let x = 0, y = 0, z = 0;
        for (const g of at.get(key(f * 9 + v * 3))) {
          if (ux * fu[g * 3] + uy * fu[g * 3 + 1] + uz * fu[g * 3 + 2] < cosC) continue;
          x += fn[g * 3]; y += fn[g * 3 + 1]; z += fn[g * 3 + 2];
        }
        const l = Math.hypot(x, y, z);
        const o = f * 9 + v * 3;
        if (l > 1e-12) { N[o] = x / l; N[o + 1] = y / l; N[o + 2] = z / l; } else { N[o] = ux; N[o + 1] = uy; N[o + 2] = uz; }
      }
    }
    return N;
  }

  /* ---------- baked occlusion: distance-field AO (steps out along the normal) ---------- */
  const AO_STEPS = [0.04, 0.1, 0.2, 0.36, 0.6], AO_W = [0.3, 0.26, 0.2, 0.14, 0.1];
  function occlusion(M, P, N, i, cache) {
    const k = Math.round(P[i] * 100) + ',' + Math.round(P[i + 1] * 100) + ',' + Math.round(P[i + 2] * 100) + ',' +
      Math.round(N[i] * 8) + ',' + Math.round(N[i + 1] * 8) + ',' + Math.round(N[i + 2] * 8);
    let r = cache.get(k);
    if (r != null) return r;
    const q = new V3();
    let occ = 0;
    for (let s = 0; s < AO_STEPS.length; s++) {
      const h = AO_STEPS[s];
      q.set(P[i] + N[i] * h, P[i + 1] + N[i + 1] * h, P[i + 2] + N[i + 2] * h);
      let d = Infinity;
      for (const f of M.sdfs) { const v = f(q); if (v < d) d = v; }
      occ += AO_W[s] * Math.max(0, Math.min(1, (h - d) / h));
    }
    r = Math.max(0, 1 - 1.35 * occ);
    cache.set(k, r);
    return r;
  }

  /* ---------- materials ---------- */
  const BODY_VERT_HEAD = 'attribute vec3 csH;\nattribute vec4 csA;\nattribute float afGlow;\nattribute float afFlexW;\nuniform vec4 afDefl;\nuniform vec2 afFlex;\nvarying float vGlow;\n';
  const BODY_NORMAL = `#include <beginnormal_vertex>
  float csAng = csA.x < 0.5 ? 0.0 : csA.x < 1.5 ? afDefl.x : csA.x < 2.5 ? afDefl.y : csA.x < 3.5 ? afDefl.z : afDefl.w;
  vec3 csK = csA.yzw; float csC = cos( csAng ), csS = sin( csAng );
  objectNormal = objectNormal * csC + cross( csK, objectNormal ) * csS + csK * dot( csK, objectNormal ) * ( 1.0 - csC );
  float flX = max( abs( position.x ) - afFlex.y, 0.0 ), flSlope = 2.0 * afFlex.x * flX * sign( position.x ) * afFlexW;
  objectNormal = normalize( vec3( objectNormal.x - flSlope * objectNormal.y, objectNormal.y + flSlope * objectNormal.x, objectNormal.z ) );`;
  const BODY_BEGIN = `#include <begin_vertex>
  vec3 csQ = transformed - csH;
  transformed = mix( transformed, csH + csQ * csC + cross( csK, csQ ) * csS + csK * dot( csK, csQ ) * ( 1.0 - csC ), step( 0.5, csA.x ) );
  transformed.y += afFlex.x * flX * flX * afFlexW;            // wing bending
  vGlow = afGlow;`;
  const SUN_LIGHTS = () => THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= afSun;');
  const FRAG_HEAD = 'uniform vec3 afSky;\nuniform vec3 afHorizon;\nuniform vec3 afGround;\nuniform float afSun;\nuniform float afRim;\nuniform float afStrobe;\n';
  function bodyMaterial(map, U) {
    const m = new THREE.MeshPhongMaterial({ map, vertexColors: true, shininess: 38, specular: new THREE.Color(0.16, 0.16, 0.16) });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, ENV, U);
      sh.vertexShader = BODY_VERT_HEAD + sh.vertexShader
        .replace('#include <beginnormal_vertex>', BODY_NORMAL).replace('#include <begin_vertex>', BODY_BEGIN);
      sh.fragmentShader = FRAG_HEAD + 'varying float vGlow;\n' + sh.fragmentShader
        .replace('#include <lights_fragment_begin>', SUN_LIGHTS())
        .replace('#include <opaque_fragment>', `{
  vec3 rN = normalize( normal ), rW = inverseTransformDirection( rN, viewMatrix );
  float rF = pow( 1.0 - clamp( dot( rN, normalize( vViewPosition ) ), 0.0, 1.0 ), 5.0 );
  outgoingLight += mix( afHorizon, afSky, clamp( rW.y * 0.5 + 0.5, 0.0, 1.0 ) ) * rF * afRim;
  outgoingLight += diffuseColor.rgb * afHorizon * 0.22 * clamp( -rW.y, 0.0, 1.0 );   // haze bounce under the wings
  float gl = vGlow > 1.5 ? afStrobe : vGlow;
  outgoingLight = mix( outgoingLight, diffuseColor.rgb * 2.2, clamp( gl, 0.0, 1.0 ) );
}
#include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'airframe-body';
    keepPatchOnClone(m);
    return m;
  }
  function glassMaterial(color, U) {
    const m = new THREE.MeshPhongMaterial({ color, shininess: 110, specular: new THREE.Color(0.7, 0.7, 0.7) });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, ENV, U);
      sh.fragmentShader = FRAG_HEAD + sh.fragmentShader
        .replace('#include <lights_fragment_begin>', SUN_LIGHTS())
        .replace('#include <opaque_fragment>', `{
  vec3 gN = normalize( normal ), gV = normalize( vViewPosition );
  vec3 gR = inverseTransformDirection( reflect( -gV, gN ), viewMatrix );
  vec3 env = gR.y > 0.0 ? mix( afHorizon, afSky, pow( gR.y, 0.55 ) ) : mix( afHorizon * 0.8, afGround * 0.8, clamp( -gR.y * 5.0, 0.0, 1.0 ) );
  float fr = 0.18 + 0.82 * pow( 1.0 - clamp( dot( gN, gV ), 0.0, 1.0 ), 4.0 );
  outgoingLight = mix( outgoingLight, env * ( 0.55 + 0.45 * afSun ), fr * 0.8 );
}
#include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'airframe-glass';
    keepPatchOnClone(m);
    return m;
  }
  // Material.clone() drops onBeforeCompile; the see-through ghost clones the materials and must keep the shader
  function keepPatchOnClone(m) {
    const base = m.clone;
    m.clone = function () { const c = base.call(this); c.onBeforeCompile = this.onBeforeCompile; c.customProgramCacheKey = this.customProgramCacheKey; keepPatchOnClone(c); return c; };
  }

  /* ---------- build: normals, occlusion, merge ---------- */
  // o: { map (texture), glass (colour), shading, ao (default true) } -> { group, meshes: {body, glass, 'node:body', ...}, U }
  // (meshes share one material per kind, so separate nodes cost a draw call each but no extra shader state)
  function build(M, o = {}) {
    const smooth = (o.shading || opts.shading) === 'smooth', doAO = o.ao !== false;
    const U = { afDefl: { value: new THREE.Vector4() }, afSun: { value: 1 }, afRim: { value: 0.14 }, afStrobe: { value: 0 }, afFlex: { value: new THREE.Vector2(0, 0) } };
    const byMat = {};
    const cache = new Map();
    for (const p of M.parts) {
      if (!p.pos.length) continue;
      const N = normals(p, smooth), n = p.pos.length / 3;
      const col = new Float32Array(n * 3), csH = new Float32Array(n * 3), csA = new Float32Array(n * 4), glow = new Float32Array(n), flex = new Float32Array(n).fill(p.flex);
      for (let v = 0; v < n; v++) {
        const a = doAO && p.ao ? occlusion(M, p.pos, N, v * 3, cache) : 1, g = 0.5 + 0.5 * a;
        col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = g;
        glow[v] = p.glow;
        if (p.cs) {
          csH[v * 3] = p.cs.hinge.x; csH[v * 3 + 1] = p.cs.hinge.y; csH[v * 3 + 2] = p.cs.hinge.z;
          csA[v * 4] = p.cs.ch; csA[v * 4 + 1] = p.cs.axis.x; csA[v * 4 + 2] = p.cs.axis.y; csA[v * 4 + 3] = p.cs.axis.z;
        }
      }
      const key = (p.node ? p.node + ':' : '') + p.mat;
      (byMat[key] = byMat[key] || []).push({ pos: p.pos, N, uv: p.uv, col, csH, csA, glow, flex });
    }
    const group = new THREE.Group(), meshes = {}, mats = {};
    let tris = 0;
    for (const key in byMat) {
      const mat = key.includes(':') ? key.split(':')[1] : key;
      const L = byMat[key], cat = (k, w) => {
        const tot = L.reduce((s, x) => s + x[k].length, 0), out = new Float32Array(tot);
        let off = 0; for (const x of L) { out.set(x[k], off); off += x[k].length; }
        return new THREE.BufferAttribute(out, w);
      };
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', cat('pos', 3)); g.setAttribute('normal', cat('N', 3)); g.setAttribute('uv', cat('uv', 2));
      g.setAttribute('color', cat('col', 3)); g.setAttribute('csH', cat('csH', 3)); g.setAttribute('csA', cat('csA', 4));
      g.setAttribute('afGlow', cat('glow', 1)); g.setAttribute('afFlexW', cat('flex', 1));
      g.computeBoundingSphere();
      tris += g.attributes.position.count / 3;
      const material = mats[mat] || (mats[mat] = mat === 'glass' ? glassMaterial(o.glass || '#1c3144', U) : bodyMaterial(o.map || null, U));
      const mesh = new THREE.Mesh(g, material);
      group.add(mesh); meshes[key] = mesh;
    }
    return { group, meshes, U, tris };
  }


  /* ---------- propeller: twisted blades (own mesh, spins about z) and a blur disc ---------- */
  // o: { radius, blades (2), chord (max), color, tip (colour of the tips), tipFrom (fraction of radius), body (the
  //      body mesh, whose material is reused), disc: [r, g, b] tint, ringTint } -> { prop, disc, tris }
  function propeller(o) {
    const PM = createModel(), PA = createAtlas(64), Rr = o.radius, ch = o.chord || Rr * 0.125;
    const reg = PA.region(4, 4, 60, 28, 0, Rr, 0, 1), n = o.blades || 2;
    const st = [{ s: Rr * 0.08, c: ch * 0.85, le: -ch * 0.42, t: 0.2, tw: 1.0 }, { s: Rr * 0.32, c: ch, le: -ch * 0.5, t: 0.14, tw: 1.18 },
                { s: Rr * 0.77, c: ch * 0.8, le: -ch * 0.4, t: 0.1, tw: 1.32 }, { s: Rr * 0.95, c: ch * 0.52, le: -ch * 0.26, t: 0.08, tw: 1.36 },
                { s: Rr, c: ch * 0.26, le: -ch * 0.13, t: 0.06, tw: 1.36 }];
    for (let k = 0; k < n; k++) {
      const p = PM.part({ ao: false });
      wing(PM, p, { side: 1, top: reg, bottom: reg, xs: [0, 0.05, 0.2, 0.45, 0.75, 1], stations: st });
      if (k) {                                              // rotate this blade's copy about z
        const a = 2 * Math.PI * k / n, c = Math.cos(a), sn = Math.sin(a), P = p.pos;
        for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1]; P[i] = x * c - y * sn; P[i + 1] = x * sn + y * c; }
      }
    }
    const tipFrom = (o.tipFrom || 0.85) * Rr;
    const map = PA.texture((ctx, on) => on(reg, o.color || '#2b333b', (c) => { if (o.tip) poly(c, [[tipFrom, -1], [tipFrom, 2], [Rr * 2, 2], [Rr * 2, -1]], o.tip); }));
    const B = build(PM, { map, shading: 'smooth', ao: false }), prop = B.meshes.body;
    prop.material.dispose(); prop.material = o.body.material.clone(); prop.material.map = map;
    const t = o.disc || [39, 49, 59], ring = o.ringTint || t;
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const x = cv.getContext('2d'), gr = x.createRadialGradient(64, 64, 8, 64, 64, 64), rgba = (c, a) => 'rgba(' + c.join(',') + ',' + a + ')';
    gr.addColorStop(0, rgba(t, 0)); gr.addColorStop(0.2, rgba(t, 0.25)); gr.addColorStop(0.8, rgba(t, 0.16));
    gr.addColorStop(0.84, rgba(ring, o.ringTint ? 0.24 : 0.16)); gr.addColorStop(0.97, rgba(ring, o.ringTint ? 0.2 : 0.14)); gr.addColorStop(1, rgba(ring, 0));
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(Rr * 1.005, 32), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    return { prop, disc, tris: B.tris };
  }

  return { ENV, opts, propeller, createAtlas, createModel, loft, wing, tube, ellipsoid, build, poly, line, text, sectionAt, stationAt };
})();
