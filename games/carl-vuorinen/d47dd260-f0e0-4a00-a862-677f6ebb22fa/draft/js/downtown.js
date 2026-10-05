'use strict';
/* =========================================================================
   DOWNTOWN — what the city centre has that the outskirts don't: skybridges, glazed walkways between two towers, to
   fly under (or upside down under). A js/city.js plugin (CITY_PLUGINS).
   Course file, in city: {
     skybridges: [{ a: [x, z], b: [x, z], y, w, h }]   from a to b (the two towers' facing walls: the course places the
                towers, js/outskirts.js towers), its floor y m above the streets, w m wide and h m tall. Lined up with
                the street grid it has the towers' own windows (lit at night); at any other angle it's plain.
     neon: { near, max, seed }   neon signs on the facades that face the course line, within near m of it (default
                130), max of them (default 240): small boards with a glowing word, across or stacked, its letters and
                border in two different tube colours (NEON_PAIRS_*), a soft glow on the wall round each, mostly down
                at street level (NEON_LOW, NEON_HIGH), never closer than NEON_GAP m to each other. Only along the line,
                so the city it flies through looks lived in at night.
   }
   A supertall with a helipad (js/city.js landmarks, pad: true) gets its lights: a string of white lamps round the edge
   of its roof, green ones round the pad, floodlights on the H, and red aviation lights blinking on the corners of
   every setback.
   Sim part: each skybridge is a shore box ('skybridge': a crash); the signs are flat on their walls, no boxes of their
   own. Game part: the skybridges' walls, roof and underside in the city's building meshes; the signs in two meshes of
   their own (the boards, words from one canvas atlas, and their glow).
   ========================================================================= */
const DOWNTOWN = { bridges: [], neon: 0 };
var CRASH_TEXT = CRASH_TEXT || {};
CRASH_TEXT.skybridge = 'Hit a skybridge';

CITY_PLUGINS.push({
  after(ctx) {
    DOWNTOWN.bridges.length = 0;
    for (const s of ctx.C.skybridges || []) {
      const [ax, az] = s.a, [bx, bz] = s.b, L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
      const w = s.w || 8, h = s.h || 6, y0 = ctx.G + s.y, b = { x: (ax + bx) / 2, z: (az + bz) / 2, ux, uz, L, w, y0, y1: y0 + h, seed: 400 + DOWNTOWN.bridges.length * 37 };
      shoreBox('skybridge', b.x, b.z, ux, uz, L / 2, w / 2, y0, b.y1);
      DOWNTOWN.bridges.push(b);
    }
  },
  kit: {
    build(K, group) {
      if (CITY.C && CITY.C.neon) group.add(neonSigns(CITY.C.neon));
      for (const b of CITY.bld) if (b.landmark && b.crown === 4) group.add(roofLights(b));
      if (!DOWNTOWN.bridges.length) return;
      const M = K.M, GLASS = K.C3('#4f5d69'), FRAME = K.C3('#8d9196'), { UX, UZ } = CITY.axes;
      for (const b of DOWNTOWN.bridges) {
        M.at(b.x, b.z);
        const along = b.ux * UX + b.uz * UZ, L = b.L / 2 + 1.5, hw = b.w / 2;   // its ends run a little into the walls
        if (Math.abs(Math.abs(along) - 1) < 1e-3 || Math.abs(along) < 1e-3) {   // on the grid: windowed like a tower
          const onU = Math.abs(along) > 0.5;
          K.walls(b, onU ? L : hw, onU ? hw : L, b.y0 + 0.6, b.y1 - 0.6, GLASS, 2, FRAME, b.y0 - 0.5);
        } else K.plainBox(b.x, b.z, b.ux, b.uz, L, hw, b.y0 + 0.6, b.y1 - 0.6, GLASS);
        K.plainBox(b.x, b.z, b.ux, b.uz, L, hw + 0.25, b.y0, b.y0 + 0.6, FRAME, false);   // floor slab and roof edge
        K.plainBox(b.x, b.z, b.ux, b.uz, L, hw + 0.25, b.y1 - 0.6, b.y1, FRAME);
        const vx = -b.uz, vz = b.ux, P = (su, sv) => [b.x + b.ux * L * su + vx * (hw + 0.25) * sv, b.y0, b.z + b.uz * L * su + vz * (hw + 0.25) * sv];
        K.quad(M, P(-1, 1), P(1, 1), P(1, -1), P(-1, -1), FRAME, [0, -1, 0]);   // underside
      }
    },
  },
});

/* ---------- neon signs ---------- */
const NEON_GAP = 13;                                         // m between signs
const NEON_LOW = 4, NEON_HIGH = 32;                          // their bottoms: this far over the street, and up to this much higher
const NEON_ACROSS = ['HOTEL', 'BAR', 'SUSHI', 'RAMEN', 'CLUB', '24H', 'CAFE', 'KINO', 'PIZZA', 'JAZZ', 'ARCADE', 'LIVE'];
const NEON_UP = ['HOTEL', 'BAR', 'SUSHI', 'CLUB', 'KINO', 'JAZZ', '24H', 'NOODLE'];
// neon tube colours, and each word's pair of them: [its letters, its border]
const NEON = { pink: '#ff3fb4', cyan: '#38eaff', yellow: '#ffe04a', orange: '#ff7a3a', red: '#ff2b2b', white: '#f2f4ff' };
const NEON_PAIRS_ACROSS = [['red', 'white'], ['white', 'pink'], ['cyan', 'red'], ['yellow', 'cyan'], ['pink', 'cyan'], ['white', 'red'],
  ['orange', 'white'], ['red', 'yellow'], ['cyan', 'white'], ['yellow', 'red'], ['pink', 'white'], ['white', 'cyan']];
const NEON_PAIRS_UP = [['white', 'pink'], ['red', 'cyan'], ['yellow', 'red'], ['cyan', 'white'], ['pink', 'yellow'], ['orange', 'cyan'],
  ['white', 'orange'], ['red', 'white']];
let _neonAtlas = null;
// one 1024 x 1024 canvas: 12 words across (3 columns of 4 rows, 340 x 128) on the top half, 8 stacked (128 x 512) below
function neonAtlas() {
  if (_neonAtlas) return _neonAtlas;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1024;
  const g = cv.getContext('2d'), across = [], up = [];
  const panel = (x, y, w, h, col) => {
    g.shadowBlur = 0; g.fillStyle = 'rgba(12, 8, 22, 0.88)'; g.fillRect(x + 4, y + 4, w - 8, h - 8);
    g.strokeStyle = col; g.lineWidth = 5; g.shadowColor = col; g.shadowBlur = 14; g.strokeRect(x + 10, y + 10, w - 20, h - 20);
  };
  const glow = (text, x, y, col) => {                        // a tube: a wide glow, then the bright core
    g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 22; g.fillText(text, x, y);
    g.shadowBlur = 6; g.fillStyle = '#fff7fb'; g.globalAlpha = 0.3; g.fillText(text, x, y); g.globalAlpha = 1;
  };
  g.textAlign = 'center'; g.textBaseline = 'middle';
  NEON_ACROSS.forEach((w, i) => {
    const x = (i % 3) * 340, y = Math.floor(i / 3) * 128, [tc, bc] = NEON_PAIRS_ACROSS[i % NEON_PAIRS_ACROSS.length].map((k) => NEON[k]);
    panel(x, y, 340, 128, bc);
    g.font = `bold ${w.length > 5 ? 58 : 72}px sans-serif`; glow(w, x + 170, y + 66, tc);
    across.push([x / 1024, 1 - (y + 128) / 1024, (x + 340) / 1024, 1 - y / 1024, 0, tc]);
  });
  NEON_UP.forEach((w, i) => {
    const x = i * 128, y = 512, [tc, bc] = NEON_PAIRS_UP[i % NEON_PAIRS_UP.length].map((k) => NEON[k]), n = w.length, step = Math.min(84, 440 / n);
    panel(x, y, 128, 512, bc);
    g.font = `bold ${Math.round(step * 0.86)}px sans-serif`;
    for (let k = 0; k < n; k++) glow(w[k], x + 64, y + 256 + (k - (n - 1) / 2) * step, tc);
    up.push([x / 1024, 1 - (y + 512) / 1024, (x + 128) / 1024, 1 - y / 1024, n, tc]);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  mat.userData.shared = true;                                // kept from course to course, with its texture
  const hc = document.createElement('canvas'); hc.width = hc.height = 64;
  const hg = hc.getContext('2d'), gr = hg.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  hg.fillStyle = gr; hg.fillRect(0, 0, 64, 64);
  const halo = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(hc), vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
  halo.userData.shared = true;
  return (_neonAtlas = { mat, halo, across, up });
}
// the signs: for each building near the line, the walls that face it, then boards on those walls, low down, in a
// shuffled order that favours the nearer walls; one mesh for the boards, one for the glow
function neonSigns(cfg) {
  const A = neonAtlas(), G = CITY.G, { UX, UZ, VX, VZ } = CITY.axes, near = cfg.near || 130, max = cfg.max || 240;
  const rnd = mulberry32(cfg.seed || 4242), cand = [];
  for (const b of CITY.bld) {
    if (b.k !== 'tower' && b.k !== 'mid' && b.k !== 'podium' && b.k !== 'flats') continue;
    if (cityLineNear(b.x, b.z).d > near + 80) continue;
    const [hu0, hv0] = b.tiers[0];
    for (const [nx, nz, ext, half] of [[UX, UZ, hu0, hv0], [-UX, -UZ, hu0, hv0], [VX, VZ, hv0, hu0], [-VX, -VZ, hv0, hu0]]) {
      const fx = b.x + nx * ext, fz = b.z + nz * ext, L = cityLineNear(fx, fz);
      const dx = L.s.x - fx, dz = L.s.z - fz, d = Math.hypot(dx, dz);
      if (d > near || d < 10 || (dx * nx + dz * nz) / d < 0.55) continue;   // must face the line
      for (let k = 0; k < 3; k++) cand.push({ b, nx, nz, d, half, r: rnd() * (0.4 + d / near) });   // a few tries a wall, nearer walls first
    }
  }
  cand.sort((a, c) => a.r - c.r);
  const pos = [], uv = [], placed = [], hpos = [], huv = [], hcol = [], _c = new THREE.Color();
  for (const c of cand) {
    if (placed.length >= max) break;
    const upright = rnd() < 0.4, cell = upright ? A.up[Math.floor(rnd() * A.up.length)] : A.across[Math.floor(rnd() * A.across.length)];
    const h = upright ? 5 + cell[4] * 1.4 : 2 + rnd() * 1.4, w = upright ? h / 4 : h * 340 / 128;
    let y = G + NEON_LOW + h / 2 + Math.pow(rnd(), 1.8) * NEON_HIGH;   // mostly at street level, shopfronts and bars
    // the tier at that height (setbacks step in): the wall is that tier's
    let y0 = c.b.y0, tier = null;
    for (const t of c.b.tiers) { if (y + h / 2 < t[2] - 1.5 && y - h / 2 > y0) { tier = t; break; } y0 = t[2]; }
    if (!tier) {                                             // too high for it: as high as the building allows
      const t0 = c.b.tiers[0]; y = Math.min(y, t0[2] - h / 2 - 1); if (y - h / 2 < G + 3) continue; tier = t0;
    }
    const ext = Math.abs(c.nx * UX + c.nz * UZ) > 0.5 ? tier[0] : tier[1], half = Math.abs(c.nx * UX + c.nz * UZ) > 0.5 ? tier[1] : tier[0];
    if (w > half * 2 - 3) continue;
    const tx = -c.nz, tz = c.nx, off = (rnd() - 0.5) * (half * 2 - w - 3);
    const cx = c.b.x + c.nx * (ext + 0.5) + tx * off, cz = c.b.z + c.nz * (ext + 0.5) + tz * off;
    if (placed.some((p) => Math.hypot(p[0] - cx, p[1] - y, p[2] - cz) < NEON_GAP)) continue;
    placed.push([cx, y, cz]);
    const P = (s, v) => [cx + tx * s * w / 2, y + v * h / 2, cz + tz * s * w / 2];
    const [u0, v0, u1, v1] = cell, a = P(1, -1), bq = P(-1, -1), cq = P(-1, 1), d = P(1, 1);   // seen from outside: left to right
    pos.push(...a, ...bq, ...cq, ...a, ...cq, ...d);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    const k = Math.max(w, h) * 0.9, H = (s, v) => [cx + tx * s * (w / 2 + k) - c.nx * 0.2, y + v * (h / 2 + k), cz + tz * s * (w / 2 + k) - c.nz * 0.2];
    hpos.push(...H(1, -1), ...H(-1, -1), ...H(-1, 1), ...H(1, -1), ...H(-1, 1), ...H(1, 1));   // the glow on the wall round it
    huv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    _c.set(cell[5]); for (let i = 0; i < 6; i++) hcol.push(_c.r, _c.g, _c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  const grp = new THREE.Group(), hgeo = new THREE.BufferGeometry();
  hgeo.setAttribute('position', new THREE.Float32BufferAttribute(hpos, 3));
  hgeo.setAttribute('uv', new THREE.Float32BufferAttribute(huv, 2));
  hgeo.setAttribute('color', new THREE.Float32BufferAttribute(hcol, 3));
  hgeo.computeBoundingSphere();
  grp.add(new THREE.Mesh(hgeo, A.halo), new THREE.Mesh(geo, A.mat));
  grp.userData.neon = DOWNTOWN.neon = placed.length;
  return grp;
}

/* ---------- the helipad tower's lights ---------- */
// glowing points (the neon signs' soft glow as their sprite), sized in metres so they read from far off; the red ones
// blink, a second on and a second off, by fading their material before each draw
const _lightMats = {};
function roofLights(b) {
  const halo = neonAtlas().halo.map, { UX, UZ, VX, VZ } = CITY.axes, grp = new THREE.Group();
  const P = (u, v, y) => [b.x + UX * u + VX * v, y, b.z + UZ * u + VZ * v];
  const points = (list, size, blink) => {
    const pos = [], col = [], c = new THREE.Color();
    for (const [p, hex] of list) { pos.push(...p); c.set(hex); col.push(c.r, c.g, c.b); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const key = size + (blink ? 'b' : '');                     // one material each, kept from course to course
    const m = _lightMats[key] || (_lightMats[key] = new THREE.PointsMaterial({ map: halo, size, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.userData.shared = true;
    const pts = new THREE.Points(g, m);
    if (blink) pts.onBeforeRender = () => { m.opacity = 0.15 + 0.85 * (Math.floor(performance.now() / 1000) % 2); };
    return pts;
  };
  const edge = (hu, hv, y, step, hex) => {                   // lamps along a rectangle's edge, about step m apart
    const out = [];
    for (const [a, c, len] of [[[-1, -1], [1, -1], hu], [[1, -1], [1, 1], hv], [[1, 1], [-1, 1], hu], [[-1, 1], [-1, -1], hv]]) {
      const n = Math.max(1, Math.round(len * 2 / step));
      for (let i = 0; i < n; i++) { const t = i / n; out.push([P((a[0] + (c[0] - a[0]) * t) * hu, (a[1] + (c[1] - a[1]) * t) * hv, y), hex]); }
    }
    return out;
  };
  const [hu, hv, top] = b.tiers[b.tiers.length - 1], d = Math.min(hu, hv) * 0.72;
  grp.add(points(edge(hu + 0.2, hv + 0.2, top + 0.9, 4, '#fff1d6'), 4.5));                 // the roof's edge
  grp.add(points(edge(d + 0.3, d + 0.3, top + 0.9, 3.5, '#5dff7a'), 3.6));                 // round the pad
  grp.add(points([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [P(u * d * 0.6, v * d * 0.6, top + 2), '#fff8e8']), 9));   // on the H
  const red = [];
  for (const [tu, tv, y1] of b.tiers) for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) red.push([P(u * tu, v * tv, y1 + 1), '#ff2a1a']);
  grp.add(points(red, 9, true));
  return grp;
}
