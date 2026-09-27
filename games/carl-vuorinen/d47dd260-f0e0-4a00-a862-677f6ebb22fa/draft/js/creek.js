'use strict';
/* Creek: a mountain stream along the valley floor, with waterfalls, as a js/shore.js plugin (no DOM in the sim part).
   Course file: creek: {
     w       half-width of the channel's flat bed (m); keep it at least 0.75 of a terrain cell, or the mesh can't show it
     depth   how far the bed lies below the water (m, default 1.5); bank: the banks rise this many m per m past w (default
             1.2), and from 4 m further out at `wall` m per m (default 4), which also makes the plunge pools' walls
     falls   [[lip, foot], ...]: point indices. The water drops over a cliff at the lip point and lands in a pool at the
             foot point's floor level; the line keeps its own shape (plan it to dive down beside the fall)
     color   "#hex" water colour (optional)
   }
   The water runs along the valley floor: the line minus its clearance, never running uphill. The creek cuts its channel
   and the plunge pools into the terrain after the valley carving, so pick clearances that keep the floor below the
   hills. Trees keep out of the channel and out from under any arches (a cave: js/overhangs.js arches in a row).
   The bed is ordinary ground, so there is no crash of its own. buildCreek() runs from buildShore(); createCreekKit()
   draws the water, the falls, foam and spray. */
const CREEK = { bed: null, falls: [] };
const CREEK_NONE = -1e6;                                    // tree-free zones are shore boxes far underground: never hit

function buildCreek() {
  CREEK.bed = null; CREEK.falls.length = 0;
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

  function build(group) {
    if (!CREEK.bed) return;
    const S = SAMPLES, bed = CREEK.bed, C = COURSE.creek, hw = (C.w || 9) + 3, n = S.length, step = 2;
    // water ribbon along the floor, broken where it drops over a fall
    const pos = [], uv = [], idx = [];
    let len = 0, prev = null;
    for (let k = 0; k < n; k += step) {
      const a = S[Math.max(0, k - 2)], b = S[Math.min(n - 1, k + 2)], tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1;
      const nx = -tz / L, nz = tx / L, s = S[k], y = creekWaterAt(k);
      if (prev) len += Math.hypot(s.x - prev.x, s.z - prev.z);
      const i = pos.length / 3;
      pos.push(s.x - nx * hw, y, s.z - nz * hw, s.x + nx * hw, y, s.z + nz * hw);
      uv.push(0, len / 16, 1, len / 16);
      if (prev && Math.abs(prev.y - y) < 2.5) idx.push(i - 2, i, i - 1, i - 1, i, i + 1);
      prev = { x: s.x, z: s.z, y };
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

    // falls: a curtain from the lip to the pool, bulging out a little at the top, with foam and spray below
    const fallTex = streaks(64, 256, fallArt); fallTex.repeat.set(1, 1);
    const curtainMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#6d8a99', map: fallTex, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false });
    const foamMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#8aa0ab', transparent: true, opacity: 0.75, depthWrite: false });
    const sprayMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#9fb2bc', transparent: true, opacity: 0.32, depthWrite: false });
    const sprays = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const f of CREEK.falls) {
      const a = S[Math.max(0, f.k - 3)], b = S[Math.min(n - 1, f.k + 3)], tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1;
      const ux = tx / L, uz = tz / L, nx = -uz, nz = ux, s = S[f.k], top = f.top - 0.35, foot = f.foot - 0.35, H = top - foot;
      const wid = (C.w || 9) * 1.7, cols = 6, rows = 6, cp = [], cu = [], ci = [];
      for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
        const t = r / rows, across = (c / cols - 0.5) * wid * (1 - 0.15 * t);
        const out = 4 * Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - t * 0.5);   // arcs out over the lip, then falls
        cp.push(s.x + nx * across + ux * out, top - H * t, s.z + nz * across + uz * out);
        cu.push(c / cols, t * H / 30);
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
      const fx = s.x + ux * 5, fz = s.z + uz * 5;           // foam ring where it lands, and a cloud of spray
      const foam = new THREE.Mesh(new THREE.CircleGeometry(wid * 0.75, 14).rotateX(-Math.PI / 2), foamMat);
      foam.position.set(fx, foot + 0.15, fz); group.add(foam);
      for (let i = 0; i < 14; i++) {
        const r = 2.5 + rnd() * 4, ang = rnd() * Math.PI * 2, dist = rnd() * wid * 0.6;
        sprays.push([fx + Math.cos(ang) * dist, foot + 1 + rnd() * Math.min(10, H * 0.35), fz + Math.sin(ang) * dist, r]);
      }
    }
    if (sprays.length) {
      const sp = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), sprayMat, sprays.length);
      sprays.forEach((p, i) => { q.setFromEuler(e.set(rnd() * 3, rnd() * 3, rnd() * 3)); sp.setMatrixAt(i, m4.compose(v3.set(p[0], p[1], p[2]), q, sc.set(p[3], p[3] * 0.8, p[3]))); });
      sp.frustumCulled = false; group.add(sp);
    }
  }
  return { build };
}

SHORE_PLUGINS.push({ build: buildCreek, createKit: createCreekKit });
