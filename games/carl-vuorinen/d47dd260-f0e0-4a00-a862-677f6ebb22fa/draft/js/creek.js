'use strict';
/* Creek: a mountain stream along the valley floor, with waterfalls, as a js/shore.js plugin (no DOM in the sim part).
   Course file: creek: {
     w       half-width of the channel's flat bed (m); keep it at least 0.75 of a terrain cell, or the mesh can't show it
     depth   how far the bed lies below the water (m, default 1.5); bank: the banks rise this many m per m past w (default
             1.2), and from 4 m further out at `wall` m per m (default 4), which also makes the plunge pools' walls
     falls   [[lip, foot], ...]: point indices. The water drops over a cliff at the lip point and lands in a pool at the
             foot point's floor level; the line keeps its own shape (plan it to dive down beside the fall)
     color   "#hex" water colour (optional)
     cave    [from, to]: point indices. Between them the creek runs through a tunnel: the hillside is drawn on over the
             valley (the same terrain, as if never carved), with a vaulted ceiling roof m over the line inside
             (caveRoof, default 19) and a rock face over each mouth. The ceiling is solid; the walls are the carved
             terrain, as everywhere else.
   }
   The water runs along the valley floor: the line minus its clearance, never running uphill. The creek cuts its channel
   and the plunge pools into the terrain after the valley carving, so pick clearances that keep the floor below the
   hills. Trees keep out of the channel, off the hillside over the cave, and out from under any js/overhangs.js arches.
   The bed is ordinary ground; the cave's ceiling is the only crash of its own ('cave'). buildCreek() runs from
   buildShore(); createCreekKit() draws the water, the falls, foam and spray, and the cave. */
const CREEK = { bed: null, falls: [], cave: null };
const CAVE_HW = 22;                                          // the ceiling's half width (m): its edges stay inside the walls
const caveCeil = (roof, v) => roof - roof * 0.45 * Math.min(1, (v / CAVE_HW) ** 2);   // ceiling height over the line
const CREEK_NONE = -1e6;                                    // tree-free zones are shore boxes far underground: never hit

function buildCreek() {
  CREEK.bed = null; CREEK.falls.length = 0; CREEK.cave = null;
  const C = COURSE.creek;
  if (!C) return;
  const S = SAMPLES, n = S.length, bed = new Float32Array(n), w = C.w || 9, depth = C.depth || 1.5, bank = C.bank || 1.2, wall = C.wall || 4;
  for (let k = 0; k < n; k++) bed[k] = S[k].y - S[k].clr;
  const sampleOf = (i) => {                                // the sample nearest course point i
    const p = COURSE_DEF[i]; let bk = 0, bd = Infinity;
    for (let k = 0; k < n; k++) { const s = S[k], d = (s.x - p[0]) ** 2 + (s.y - p[1]) ** 2 + (s.z - p[2]) ** 2; if (d < bd) { bd = d; bk = k; } }
    return bk;
  };
  const falls = (C.falls || []).map(([li, fi]) => [sampleOf(li), sampleOf(fi)]);
  for (const [kl, kf] of falls) for (let k = kl; k <= kf; k++) bed[k] = Math.min(bed[k], bed[kf]);
  for (let k = 1; k < n; k++) bed[k] = Math.min(bed[k], bed[k - 1]);   // water never runs uphill
  CREEK.bed = bed;
  for (const [kl] of falls) CREEK.falls.push({ k: kl, top: bed[Math.max(0, kl - 1)], foot: bed[kl] });

  // channel and plunge pools, cut into the terrain around the line
  const W = TER.N + 1;
  for (let k = 0; k < W * W; k++) {
    if (TNEAR[k] < 0) continue;
    const d = TDIST[k], b = bed[TNEAR[k]];
    if (d > w + 80) continue;
    TH[k] = Math.min(TH[k], b - depth + depth * smoothstep(w * 0.6, w, d) + Math.max(0, d - w) * bank + Math.max(0, d - w - 4) * (wall - bank));
  }
  // no trees in the water, nor on the rock of an arch (their lumps would poke through it)
  for (let k = 0; k < n - 8; k += 8) {
    const a = S[k], b = S[k + 8], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    shoreBox('creek', (a.x + b.x) / 2, (a.z + b.z) / 2, (b.x - a.x) / L, (b.z - a.z) / L, L / 2 + 1, w + 3, CREEK_NONE, CREEK_NONE);
  }
  if (C.cave) {                                            // tunnel: solid ceiling, and no trees on the hillside over it
    const k0 = sampleOf(C.cave[0]), k1 = sampleOf(C.cave[1]), roof = C.caveRoof || 19;
    CREEK.cave = { k0, k1, roof };
    for (let k = k0; k < k1; k += 2) {
      const a = S[k], b = S[Math.min(k1, k + 2)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, y = (a.y + b.y) / 2;
      shoreBox('cave', cx, cz, ux, uz, L / 2 + 0.3, 8, y + caveCeil(roof, 8), y + 500);
      for (const sd of [-1, 1]) shoreBox('cave', cx - uz * sd * 13, cz + ux * sd * 13, ux, uz, L / 2 + 0.3, 5, y + caveCeil(roof, 18), y + 500);
    }
    for (let k = Math.max(0, k0 - 6); k < Math.min(n - 6, k1 + 6); k += 6) {
      const a = S[k], b = S[k + 6], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      shoreBox('creek', (a.x + b.x) / 2, (a.z + b.z) / 2, (b.x - a.x) / L, (b.z - a.z) / L, L / 2 + 1, 75, CREEK_NONE, CREEK_NONE);
    }
  }
  for (const o of OVERHANGS) {
    if (o.type !== 'arch') continue;
    let hv = 0, hu = 0;
    for (const bl of o.blobs) { hv = Math.max(hv, Math.abs(bl.v) + bl.ra); hu = Math.max(hu, Math.abs(bl.u) + bl.ru); }
    shoreBox('creek', o.cx, o.cz, o.ux, o.uz, Math.min(hu, 12), hv, CREEK_NONE, CREEK_NONE);
  }
}
const creekWaterAt = (k) => CREEK.bed[k] - 0.35;           // the water surface over sample k

/* ---------- look ---------- */
function createCreekKit() {
  // scrolling streak textures: the creek's ripples and a fall's falling water
  const streaks = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const rnd = mulberry32(77);
  const flowArt = (x, w, h) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(210,230,240,${0.25 + rnd() * 0.4})`; x.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 10, 1 + rnd() * 2); }
  };
  const fallArt = (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, i % 2 ? '#d9ecf5' : '#ffffff');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { x.fillStyle = `rgba(150,190,215,${0.2 + rnd() * 0.35})`; x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 6 + rnd() * 26); }
  };
  const scroll = (tex, rate) => function () { tex.offset.y = (performance.now() / 1000 * rate) % 1; };

  // flat-shaded triangles with per-face colours, like the terrain's
  function faceted() {
    const pos = [], col = [];
    return {
      tri(a, b, c, colr) { for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); col.push(colr.r, colr.g, colr.b); } },
      mesh(mat) {
        if (!pos.length) return null;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.computeVertexNormals();
        return new THREE.Mesh(g, mat);
      },
    };
  }
  // the ground colour the terrain would have here (the same blend as js/game.js's terrain, without the path tint)
  const TC = { meadow: new THREE.Color('#8cab69'), dry: new THREE.Color('#aca66e'), forest: new THREE.Color('#62834b'),
    rock: new THREE.Color('#8b857a'), high: new THREE.Color('#b5afa3'), snow: new THREE.Color('#eef2f4') };
  const tcol = new THREE.Color(), crnd = mulberry32(5);
  function groundColour(x, z, h, ny) {
    const PAL = Object.assign({ dry: [40, 170], forestTop: [150, 225], high: [185, 275], snow: null }, COURSE.palette);
    tcol.copy(TC.meadow).lerp(TC.dry, smoothstep(PAL.dry[0], PAL.dry[1], h));
    const f = noiseB(x * 0.006 + 40, z * 0.006 - 13), fm = COURSE.trees.mask == null ? 0.52 : COURSE.trees.mask;
    if (f > fm) tcol.lerp(TC.forest, smoothstep(fm, fm + 0.14, f) * (1 - smoothstep(PAL.forestTop[0], PAL.forestTop[1], h)));
    tcol.lerp(TC.high, smoothstep(PAL.high[0], PAL.high[1], h));
    tcol.lerp(TC.rock, smoothstep(0.84, 0.62, ny));
    if (PAL.snow && h > PAL.snow[0]) tcol.lerp(TC.snow, smoothstep(PAL.snow[0], PAL.snow[1], h) * smoothstep(0.5, 0.78, ny));
    const j = 0.93 + crnd() * 0.12;
    return tcol.clone().multiplyScalar(j);
  }
  const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _nm = new THREE.Vector3();
  const normalY = (a, b, c) => { _e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); _e2.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]); return Math.abs(_nm.crossVectors(_e1, _e2).normalize().y); };

  // the tunnel: the hillside drawn over the carved valley, a vaulted ceiling inside, and a rock face over each mouth
  function buildCave(group) {
    const CV = CREEK.cave, S = SAMPLES, micro = COURSE.terrain.micro == null ? 5 : COURSE.terrain.micro;
    const hill = (x, z) => baseHeight(x, z) + (noiseC(x * 0.03, z * 0.03) - 0.5) * micro;   // the terrain, uncarved
    const rows = [];
    for (let k = CV.k0; k <= CV.k1; k = k >= CV.k1 ? CV.k1 + 1 : Math.min(CV.k1, k + 2)) {
      const a = S[Math.max(0, k - 2)], b = S[Math.min(S.length - 1, k + 2)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L, s = S[k];
      let pw = 20;                                            // out to where the carving stops, either side, and a little more
      for (const sd of [-1, 1]) for (let v = 20; v < 400; v += 4) { const x = s.x + nx * sd * v, z = s.z + nz * sd * v; if (heightAt(x, z) >= hill(x, z) - 0.3) { pw = Math.max(pw, v + 8); break; } }
      rows.push({ s, nx, nz, pw });
    }
    const pwMax = Math.max(...rows.map((r) => r.pw)), cols = Math.ceil(pwMax / 5) * 2;
    for (const r of rows) {
      r.pts = [];
      for (let c = 0; c <= cols; c++) {
        const v = (c / cols - 0.5) * 2 * pwMax, x = r.s.x + r.nx * v, z = r.s.z + r.nz * v;
        r.pts.push([x, Math.max(heightAt(x, z), hill(x, z)), z, v]);
      }
    }
    const top = faceted();
    for (let i = 0; i < rows.length - 1; i++) for (let c = 0; c < cols; c++) {
      const a = rows[i].pts[c], b = rows[i].pts[c + 1], d = rows[i + 1].pts[c], e = rows[i + 1].pts[c + 1];
      for (const [p, q, t] of [[a, d, e], [a, e, b]]) {
        const h = (p[1] + q[1] + t[1]) / 3;
        top.tri(p, q, t, groundColour((p[0] + q[0] + t[0]) / 3, (p[2] + q[2] + t[2]) / 3, h, normalY(p, q, t)));
      }
    }
    const topMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    const tm = top.mesh(topMat); if (tm) group.add(tm);
    // vaulted ceiling and the faces over the two mouths, in dark rock
    const rock = faceted(), R = (base) => new THREE.Color(base).multiplyScalar(0.85 + crnd() * 0.25);
    const ceil = (r, v) => [r.s.x + r.nx * v, r.s.y + caveCeil(CV.roof, v), r.s.z + r.nz * v];
    const CC = 8;
    for (let i = 0; i < rows.length - 1; i++) for (let c = 0; c < CC; c++) {
      const v0 = (c / CC - 0.5) * 2 * CAVE_HW, v1 = ((c + 1) / CC - 0.5) * 2 * CAVE_HW;
      const a = ceil(rows[i], v0), b = ceil(rows[i], v1), d = ceil(rows[i + 1], v0), e = ceil(rows[i + 1], v1);
      rock.tri(a, d, e, R('#6e6960')); rock.tri(a, e, b, R('#6e6960'));
    }
    for (const r of [rows[0], rows[rows.length - 1]]) {
      const bot = (p) => { const g = heightAt(p[0], p[2]); return Math.abs(p[3]) < CAVE_HW ? Math.max(g, r.s.y + caveCeil(CV.roof, p[3])) : g; };
      for (let c = 0; c < cols; c++) {
        const p = r.pts[c], q = r.pts[c + 1], pb = bot(p), qb = bot(q);
        if (p[1] - pb < 0.2 && q[1] - qb < 0.2) continue;
        const A = [p[0], p[1], p[2]], B = [q[0], q[1], q[2]], C2 = [q[0], Math.min(qb, q[1]), q[2]], D = [p[0], Math.min(pb, p[1]), p[2]];
        rock.tri(A, D, C2, R('#857f75')); rock.tri(A, C2, B, R('#857f75'));
      }
    }
    const rm = rock.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    if (rm) group.add(rm);
  }

  function build(group) {
    if (!CREEK.bed) return;
    const S = SAMPLES, bed = CREEK.bed, C = COURSE.creek, hw = (C.w || 9) + 3, n = S.length, step = 2;
    // water ribbon along the floor, broken where it drops over a fall or runs out past a cliff edge
    const pos = [], uv = [], idx = [];
    let len = 0, prev = null;
    for (let k = 0; k < n; k += step) {
      const a = S[Math.max(0, k - 2)], b = S[Math.min(n - 1, k + 2)], tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1;
      const nx = -tz / L, nz = tx / L, s = S[k], y = creekWaterAt(k);
      if (prev) len += Math.hypot(s.x - prev.x, s.z - prev.z);
      const i = pos.length / 3, onBed = heightAt(s.x, s.z) > y - 8;   // off a cliff edge the ground is far below
      pos.push(s.x - nx * hw, y, s.z - nz * hw, s.x + nx * hw, y, s.z + nz * hw);
      uv.push(0, len / 16, 1, len / 16);
      if (prev && prev.onBed && onBed && Math.abs(prev.y - y) < 1.2 * Math.hypot(s.x - prev.x, s.z - prev.z) + 0.5) idx.push(i - 2, i, i - 1, i - 1, i, i + 1);   // steeper: a fall
      prev = { x: s.x, z: s.z, y, onBed };
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const flow = streaks(32, 128, flowArt); flow.repeat.set(2, 1);
    const water = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: C.color || '#6fa6c8', map: flow, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    water.renderOrder = -1;
    water.onBeforeRender = scroll(flow, -0.5);             // ripples run downstream
    water.frustumCulled = false; group.add(water);

    // falls: the water pours over the actual cliff edge and down its face to the pool, with foam and spray below
    const fallTex = streaks(64, 256, fallArt); fallTex.repeat.set(1, 1);
    const curtainMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#6d8a99', map: fallTex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const foamMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#8aa0ab', transparent: true, opacity: 0.75, depthWrite: false });
    const sprayMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#9fb2bc', transparent: true, opacity: 0.32, depthWrite: false });
    const sprays = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const f of CREEK.falls) {
      const a = S[Math.max(0, f.k - 3)], b = S[Math.min(n - 1, f.k + 3)], tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1;
      const ux = tx / L, uz = tz / L, nx = -uz, nz = ux, s = S[f.k], top = f.top - 0.35, foot = f.foot - 0.35;
      // walk down the line to find where the ground leaves the upper pool and where it reaches the lower one
      let tTop = -40, tBot = null;
      for (let t = -40; t <= 40; t += 0.5) { if (heightAt(s.x + ux * t, s.z + uz * t) > f.top - 1.2) tTop = t; }
      for (let t = tTop; t <= 60; t += 0.5) { if (heightAt(s.x + ux * t, s.z + uz * t) < f.foot + 1.2) { tBot = t; break; } }
      if (tBot == null) tBot = tTop + 12;
      const wid = (C.w || 9) * 1.7, cols = 6, rows = 10, cp = [], cu = [], ci = [];
      for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
        const t = lerp(tTop - 1.5, tBot + 1.5, r / rows), across = (c / cols - 0.5) * wid;
        const x = s.x + ux * t + nx * across, z = s.z + uz * t + nz * across;
        const y = r === 0 ? top : clamp(heightAt(x - ux * 2.5, z - uz * 2.5) + 0.4, foot, top);   // 2.5 m out in front of the cliff face
        cp.push(x, y, z); cu.push(c / cols, (top - y) / 30 + r * 0.02);
      }
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * (cols + 1) + c;
        ci.push(i, i + cols + 1, i + 1, i + 1, i + cols + 1, i + cols + 2);
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
      cg.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
      cg.setIndex(ci); cg.computeVertexNormals();
      const curtain = new THREE.Mesh(cg, curtainMat);
      curtain.onBeforeRender = scroll(fallTex, 1.6);        // water pours down
      curtain.frustumCulled = false; group.add(curtain);
      const fx = s.x + ux * (tBot + 4), fz = s.z + uz * (tBot + 4);   // foam where it lands, and a cloud of spray
      const foam = new THREE.Mesh(new THREE.CircleGeometry(wid * 0.7, 14).rotateX(-Math.PI / 2), foamMat);
      foam.position.set(fx, foot + 0.15, fz); group.add(foam);
      for (let i = 0; i < 14; i++) {
        const r = 2.5 + rnd() * 4, ang = rnd() * Math.PI * 2, dist = rnd() * wid * 0.6;
        sprays.push([fx + Math.cos(ang) * dist, foot + 1 + rnd() * Math.min(10, (top - foot) * 0.35), fz + Math.sin(ang) * dist, r]);
      }
    }
    if (sprays.length) {
      const sp = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), sprayMat, sprays.length);
      sprays.forEach((p, i) => { q.setFromEuler(e.set(rnd() * 3, rnd() * 3, rnd() * 3)); sp.setMatrixAt(i, m4.compose(v3.set(p[0], p[1], p[2]), q, sc.set(p[3], p[3] * 0.8, p[3]))); });
      sp.frustumCulled = false; group.add(sp);
    }
    if (CREEK.cave) buildCave(group);
  }
  return { build };
}

SHORE_PLUGINS.push({ build: buildCreek, createKit: createCreekKit });
