'use strict';
/* =========================================================================
   OUTSKIRTS — what a city has on the way in: a river with quays and bridges over it, industrial zones of warehouses,
   tanks and smokestacks, billboards along the highways, and traffic on them. A js/city.js plugin (CITY_PLUGINS).
   Course file, in city: {
     river: { pts: [[x, z], ...], w, depth }   a smooth curve through the points, w m between its quay walls; the
                quays and a riverside walk are the river's own, the blocks keep clear of them
     bridges: [{ a: [x, z], b: [x, z], w, h, ramp, type }]   road bridges over it: a deck h m above the streets from a
                to b, ramping up over ramp m at each end; type 'arch' (steel arches over the deck, no piers between
                them), 'truss' (a railway in a box truss), 'beam' (piers only) or 'suspension' (towers: [d0, d1] m
                along it, tower: their height above the deck; each tower a portal of two legs outside the deck with a
                beam a third of the way up and one at the top, cables slung between them, no piers under the spans)
     boats: [{ kind: 'ship' | 'sail', x, z, len, beam, funnelGap }]   moored along the river (pointing the way it runs
                there): a ship has twin funnels amidships, side by side, or one behind the other funnelGap m apart on
                its centreline; a low superstructure aft and containers forward; a sailboat a tall mast and its sail
     signs: [{ a: [x, z], b: [x, z], clear, h }]   a billboard on two legs, at a and b, its panel between them from clear
                m above the streets, h m tall: an advert each way, or two side by side on a wide one (a gantry)
     towers: [{ x, z, w, d, h }]   towers placed by hand (a tight spot to fly between): w by d m, h tall, standing as given
                (the line's clearance is the course's to keep); the rest of their block stays an open plaza, or in a
                business park its other towers keep away from them
     zones: [{ x, z, r, kind: 'industrial' | 'business', h }]   blocks within r: warehouses, tanks, now and then a
                smokestack; or a business park of towers h: [min, max] tall (tallest in its middle), kept off the line
     billboards: { every, size: [w, h], height }   along every highway (not the bridges), each side by turns
     traffic                    cars per km of highway, each way (0: none)
   }
   Sim part: river levelling, the bridges as highways (js/city.js builds their decks, piers and boxes), the zones'
   buildings and the billboards as shore boxes. Game part: the quays, bridge steel, buildings, billboards (one
   texture of made-up adverts) and the traffic (one instanced mesh, moved before each frame it's drawn).
   ========================================================================= */
const OUT = { river: null, boards: [], stacks: [], steel: [], boats: [], signs: [] };
const outVerge = () => OUT.verge || VERGE;
const OUT_DEF = { billboards: { every: 230, size: [16, 6], height: 13 }, traffic: 10 };

// the river's curve, every ~8 m, and the distance to it
function outRiverNear(x, z) {
  const R = OUT.river;
  if (!R || x < R.x0 || x > R.x1 || z < R.z0 || z > R.z1) return Infinity;
  let bd = Infinity, bk = 0;
  for (let k = 0; k < R.n; k += 8) { const dx = R.X[k] - x, dz = R.Z[k] - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bk = k; } }
  for (let k = Math.max(0, bk - 8); k <= Math.min(R.n - 2, bk + 8); k++) {
    const ax = R.X[k], az = R.Z[k], dx = R.X[k + 1] - ax, dz = R.Z[k + 1] - az, L2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), ex = x - ax - dx * t, ez = z - az - dz * t, d = ex * ex + ez * ez;
    if (d < bd) bd = d;
  }
  return Math.sqrt(bd);
}
const WALK = 26, VERGE = 18;                                 // riverside walk beyond each quay, and a lawn beyond that (m, at least:
                                                             // wider if the terrain's cells are coarse, see terrain())

CITY_PLUGINS.push({
  terrain(C, G) {
    OUT.river = null; OUT.boards.length = 0; OUT.stacks.length = 0;
    OUT.C = Object.assign({}, OUT_DEF, { billboards: Object.assign({}, OUT_DEF.billboards, C.billboards), traffic: C.traffic != null ? C.traffic : OUT_DEF.traffic });
    if (!C.river) return;
    OUT.verge = VERGE;
    const rv = C.river, cv = new THREE.CatmullRomCurve3(rv.pts.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
    const n = Math.ceil(cv.getLength() / 8) + 1, R = OUT.river = { w: rv.w || 140, depth: rv.depth || 6, X: [], Z: [], n, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    const p = new THREE.Vector3(), pad = R.w + 200;
    for (let i = 0; i < n; i++) {
      cv.getPointAt(i / (n - 1), p); R.X.push(p.x); R.Z.push(p.z);
      R.x0 = Math.min(R.x0, p.x - pad); R.x1 = Math.max(R.x1, p.x + pad); R.z0 = Math.min(R.z0, p.z - pad); R.z1 = Math.max(R.z1, p.z + pad);
    }
    // the bed: every grid point within a cell's diagonal of the quay goes down to it, so no terrain triangle can rise
    // inside the walls; the slope back up from there (another diagonal) is under the walk and the lawn (OUT.verge)
    const W = TER.N + 1, half = R.w / 2, reach = half + TER.CELL * Math.SQRT2;
    OUT.verge = Math.max(VERGE, TER.CELL * 2 * Math.SQRT2 + 2 - WALK);
    for (let j = 0; j <= TER.N; j++) for (let i = 0; i <= TER.N; i++) {
      const x = TER.X0 + i * TER.CELL, z = TER.Z0 + j * TER.CELL;
      if (outRiverNear(x, z) < reach) TH[j * W + i] = TER.WATER - R.depth;
    }
  },
  // the bridges are highways: straight, ramping up to their deck; arches stand on no piers between their feet
  highways(C) {
    return (C.bridges || []).map((b) => {
      const [ax, az] = b.a, [bx, bz] = b.b, L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, r = Math.min(b.ramp || 200, L * 0.4);
      const pt = (d, h) => [ax + ux * d, az + uz * d, h];
      return { w: b.w || 20, noBoards: true, bridge: b, pts: [pt(0, 0), pt(r * 0.5, b.h * 0.45), pt(r, b.h), pt(L / 2, b.h), pt(L - r, b.h), pt(L - r * 0.5, b.h * 0.45), pt(L, 0)],
        clear: b.type === 'arch' ? [[r + 4, L - r - 4]] : b.type === 'suspension' ? [[r + 2, L - r - 2]] : [] };
    });
  },
  exclude(x, z, rd) { return outRiverNear(x, z) < (OUT.river ? OUT.river.w / 2 + WALK + outVerge() : 0) + rd; },
  skipBlock(blk) {                                           // blocks the river, its walk or the lawn would cut into
    return OUT.river ? outRiverNear(blk.x, blk.z) < OUT.river.w / 2 + WALK + outVerge() + 50 : false;
  },
  block(ctx, blk) {
    const z = (ctx.C.zones || []).find((q) => Math.hypot(blk.x - q.x, blk.z - q.z) < q.r);
    const rnd = mulberry32((blk.i * 7349 + blk.j * 1931) ^ 0x5bd1), { G, inner, at } = ctx;
    const loc = (t) => [(t.x - blk.x) * ctx.UX + (t.z - blk.z) * ctx.UZ, (t.x - blk.x) * ctx.VX + (t.z - blk.z) * ctx.VZ];
    const own = (ctx.C.towers || []).filter((t) => { const [u, v] = loc(t); return Math.abs(u) <= ctx.B / 2 && Math.abs(v) <= ctx.B / 2; });
    for (const t of own) {                                   // hand-placed towers first
      const hw = t.w / 2, hd = (t.d || t.w) / 2;
      ctx.add({ k: 'tower', x: t.x, z: t.z, y0: G, tiers: [[hw, hd, G + t.h * 0.72], [hw * 0.84, hd * 0.84, G + t.h]], st: 1, c: Math.floor(rnd() * 6), crown: 2, cap: t.h * 0.1, seed: Math.floor(rnd() * 999) });
    }
    if (!z || (z.kind !== 'business' && z.kind !== 'industrial')) {
      if (!own.length) return false;
      blk.lot = '#a29f97';
      return true;
    }
    if (z.kind === 'business') {                             // a business park: four towers a block, each cut back from the line
      blk.lot = '#a29f97';                                   // on its own, so they crowd right up to it on both sides
      const t = Math.hypot(blk.x - z.x, blk.z - z.z) / z.r, hr = z.h || [70, 140], q = inner / 4;
      for (const [qu, qv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (rnd() < 0.15) continue;
        const H = ctx.span([hr[1], hr[0]], t) * (0.65 + rnd() * 0.5), [x0, z0] = at(blk.x, blk.z, qu * q, qv * q);
        if (own.some((o) => Math.abs(o.x - x0) < o.w / 2 + q && Math.abs(o.z - z0) < (o.d || o.w) / 2 + q)) continue;
        const F = ctx.fit(x0, z0, q - 3 - rnd() * 3, q - 3 - rnd() * 3, G + H * 1.15, 12);
        if (!F) continue;
        const tiers = rnd() < 0.5 ? [[F.hu, F.hv, G + H]] : [[F.hu, F.hv, G + H * 0.7], [F.hu * 0.8, F.hv * 0.8, G + H]];
        ctx.add({ k: 'tower', x: F.x, z: F.z, y0: G, tiers, st: 1, c: Math.floor(rnd() * 6), crown: rnd() < 0.5 ? 1 : 2, cap: H * 0.1, seed: Math.floor(rnd() * 999) });
      }
      return true;
    }
    blk.lot = '#8b8880';
    const lay = rnd(), parts = lay < 0.45 ? [[0, 0, inner / 2 - 4, inner / 2 - 14]] : [[0, -inner / 4, inner / 2 - 4, inner / 4 - 4], [0, inner / 4 + 2, inner / 2 - 10, inner / 4 - 6]];
    for (const [ou, ov, hu, hv] of parts) {
      const [x, zz] = at(blk.x, blk.z, ou, ov), top = G + 9 + rnd() * 7;
      if (ctx.offLimits(x, zz, Math.min(hu, hv)) || ctx.clash(x, zz, hu, hv, top + 4)) continue;
      ctx.add({ k: 'warehouse', x, z: zz, y0: G, tiers: [[hu, hv, top]], c: Math.floor(rnd() * 1000), saw: rnd() < 0.4, seed: Math.floor(rnd() * 999), cap: 0 });
    }
    if (rnd() < 0.3) {                                       // a smokestack, or a pair of tanks, in a corner of the yard
      const [x, zz] = at(blk.x, blk.z, (rnd() < 0.5 ? -1 : 1) * (inner / 2 - 8), (rnd() < 0.5 ? -1 : 1) * (inner / 2 - 8));
      if (rnd() < 0.5) {
        const H = 55 + rnd() * 35;
        if (!ctx.offLimits(x, zz, 4) && !ctx.clash(x, zz, 3.5, 3.5, G + H)) { ctx.add({ k: 'stack', x, z: zz, y0: G, tiers: [[3.4, 3.4, G + H]], seed: Math.floor(rnd() * 999) }); OUT.stacks.push([x, zz]); }
      } else {
        const r = 7 + rnd() * 3, H = 9 + rnd() * 5;
        if (!ctx.offLimits(x, zz, r) && !ctx.clash(x, zz, r, r, G + H)) ctx.add({ k: 'tank', x, z: zz, y0: G, tiers: [[r, r, G + H]], seed: Math.floor(rnd() * 999) });
      }
    }
    return true;
  },
  // billboards: along the highways (on the ground or up beside an elevated deck), each side by turns
  after(ctx) {
    const R = OUT.river;
    if (R) {                                                 // a row of trees along each walk
      const rt = mulberry32(911), off = R.w / 2 + WALK + 7;
      for (let k = 0; k < R.n - 1; k += 2) {
        const dx = R.X[k + 1] - R.X[k], dz = R.Z[k + 1] - R.Z[k], l = Math.hypot(dx, dz) || 1;
        for (const sd of [-1, 1]) if (rt() < 0.8) ctx.tree(R.X[k] - dz / l * off * sd, R.Z[k] + dx / l * off * sd, 8 + rt() * 5, 2.8 + rt() * 1.4);
      }
    }
    outSteel(ctx.G); outBoats(ctx); outSigns(ctx);
    const B = OUT.C.billboards, rnd = mulberry32(4242), G = ctx.G, [bw, bh] = B.size;
    for (const H of CITY.hw) {
      if (H.spec.noBoards) continue;
      let next = B.every * (0.3 + rnd() * 0.7), dist = 0, side = rnd() < 0.5 ? -1 : 1;
      for (let i = 0; i < H.n - 1; i++) {
        const dx = H.X[i + 1] - H.X[i], dz = H.Z[i + 1] - H.Z[i], L = Math.hypot(dx, dz) || 1;
        dist += L;
        if (dist < next) continue;
        next = dist + B.every * (0.8 + rnd() * 0.4); side = -side;
        const ux = dx / L, uz = dz / L, nx = -uz * side, nz = ux * side, off = H.w / 2 + 9;
        const x = H.X[i] + nx * off, z = H.Z[i] + nz * off, top = G + Math.max(B.height, H.H[i] + 9) + bh;
        if (outRiverNear(x, z) < (OUT.river ? OUT.river.w / 2 + WALK + outVerge() : 0) + 10) continue;
        if (OUT.signs.some((sg) => Math.hypot(sg.x - x, sg.z - z) < 60)) continue;
        if (ctx.clash(x, z, bw / 2, bw / 2, top)) continue;
        if (CITY.hw.some((O) => O !== H && cityHighwayNear(x, z, O).d < O.w / 2 + 6)) continue;
        // facing back down the road, turned a little toward it, so the traffic (and anyone flying along it) reads it
        const a = Math.atan2(-ux, -uz) + side * 0.25, fx = Math.sin(a), fz = Math.cos(a);
        OUT.boards.push({ x, z, top, fx, fz, ad: Math.floor(rnd() * 8), ad2: Math.floor(rnd() * 8) });
        shoreBox('board', x, z, fz, -fx, bw / 2, 0.6, top - bh - 0.5, top + 0.3);
        shoreBox('board', x, z, 1, 0, 0.6, 0.6, G - 1, top - bh);
      }
    }
  },
  draw: {
    warehouse(K, b) {                                        // corrugated sheds: plain walls, a dark band of doors, flat or sawtooth roof
      const [hu, hv, top] = b.tiers[0], cols = ['#9aa3a8', '#7f8f99', '#b7b2a6', '#8c7f73', '#6f8a86', '#a9a39a', '#5f6a73'];
      const col = K.jit(K.C3(cols[b.c % cols.length]), (b.c % 71) / 71).clone(), { UX, UZ, VX, VZ } = CITY.axes;
      K.walls(b, hu, hv, b.y0, top, col, 0, b.saw ? null : K.C3('#6d6a65'), b.y0);
      for (let k = -1; k <= 1; k++) {                        // loading doors on the long side
        const x = b.x + UX * k * hu * 0.55 - VX * (hv + 0.15), z = b.z + UZ * k * hu * 0.55 - VZ * (hv + 0.15);
        K.plainBox(x, z, UX, UZ, 3, 0.2, b.y0, b.y0 + 5, K.C3('#3a3d40'), false);
      }
      if (b.saw) {                                           // sawtooth: north lights along the short axis
        const n = Math.max(2, Math.round(hu / 7)), w = (hu * 2) / n, P = (u, v, y) => [b.x + UX * u + VX * v, y, b.z + UZ * u + VZ * v];
        for (let s = 0; s < n; s++) {
          const u0 = -hu + s * w, u1 = u0 + w;
          K.quad(K.M, P(u0, -hv, top), P(u0, hv, top), P(u1, hv, top + 3.5), P(u1, -hv, top + 3.5), K.C3('#7c7a75'), [-UX, 1, -UZ]);
          K.quad(K.M, P(u1, -hv, top), P(u1, hv, top), P(u1, hv, top + 3.5), P(u1, -hv, top + 3.5), K.C3('#3f4e5c'), [UX, 0, UZ]);   // the glazing
          K.M.tri(P(u0, -hv, top), P(u1, -hv, top), P(u1, -hv, top + 3.5), col, K.W0, K.W0, K.W0, -VX, 0, -VZ);
          K.M.tri(P(u0, hv, top), P(u1, hv, top), P(u1, hv, top + 3.5), col, K.W0, K.W0, K.W0, VX, 0, VZ);
        }
      }
    },
    stack(K, b) {                                            // smokestack: an octagonal tube, red and white bands near the top
      const [r, , top] = b.tiers[0], H = top - b.y0;
      outPrism(K, b.x, b.z, r * 1.25, r * 0.85, b.y0, b.y0 + H * 0.7, 8, K.C3('#a49d93'));
      outPrism(K, b.x, b.z, r * 0.85, r * 0.8, b.y0 + H * 0.7, b.y0 + H * 0.8, 8, K.C3('#c8432e'));
      outPrism(K, b.x, b.z, r * 0.8, r * 0.76, b.y0 + H * 0.8, b.y0 + H * 0.9, 8, K.C3('#eeeae2'));
      outPrism(K, b.x, b.z, r * 0.76, r * 0.72, b.y0 + H * 0.9, top, 8, K.C3('#c8432e'), true);
    },
    tank(K, b) {
      const [r, , top] = b.tiers[0];
      outPrism(K, b.x, b.z, r, r, b.y0, top, 12, K.C3('#d9d6ce'), false);
      outPrism(K, b.x, b.z, r, r * 0.15, top, top + r * 0.18, 12, K.C3('#bcb8ae'), true);   // a shallow cone roof
    },
  },
  kit: { build(K, group) { outKitBuild(K, group); } },
});
var CRASH_TEXT = CRASH_TEXT || {};
Object.assign(CRASH_TEXT, { board: 'Hit a billboard', warehouse: 'Hit a warehouse', stack: 'Hit a smokestack', tank: 'Hit a tank', boat: 'Hit a boat', funnel: 'Hit a funnel', mast: 'Hit a mast' });

// an n-sided tube from radius r0 at y0 to r1 at y1 (a cap on top if asked)
function outPrism(K, x, z, r0, r1, y0, y1, n, col, cap) {
  for (let i = 0; i < n; i++) {
    const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
    K.quad(K.M, [x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0], [x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0],
      [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1], [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1], col, [Math.cos(am), 0, Math.sin(am)]);
    if (cap) K.M.tri([x, y1, z], [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1], [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1], col, K.W0, K.W0, K.W0, 0, 1, 0);
  }
}

/* ---------- look ---------- */
const OutLook = {
  adTex: null,
  // eight made-up adverts in one texture, 4 x 2 (each 256 x 96, the panel's 16:6)
  ads() {
    if (this.adTex) return this.adTex;
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 192;
    const c = cv.getContext('2d');
    const AD = [
      ['#1d6fd6', '#ffd23f', 'SKYRACE', 'fly the city'], ['#ff5a1f', '#ffffff', 'JETWING', 'flight school'],
      ['#2b2b2b', '#ff3b6b', 'NOODLE KING', 'open late'], ['#f2c14e', '#2b2b2b', 'SUNSET COLA', 'ice cold'],
      ['#ff2b95', '#ffffff', 'MAGENTA LINE', 'express bus'], ['#3aa76d', '#ffffff', 'CITY ZOO', 'new penguins'],
      ['#7a3cff', '#ffe066', 'HOVER PIZZA', '20 min or free'], ['#0f2a44', '#7fd4ff', 'BOOL BANK', 'true or false?'],
    ];
    AD.forEach(([bg, fg, big, small], k) => {
      const x = (k % 4) * 256, y = Math.floor(k / 4) * 96;
      const g = c.createLinearGradient(x, y, x + 256, y + 96); g.addColorStop(0, bg); g.addColorStop(1, '#000000');
      c.fillStyle = bg; c.fillRect(x, y, 256, 96);
      c.globalAlpha = 0.25; c.fillStyle = g; c.fillRect(x, y, 256, 96); c.globalAlpha = 1;
      c.fillStyle = fg; c.beginPath(); c.arc(x + 216, y + 48, 26, 0, Math.PI * 2); c.fill();   // a logo disc
      c.fillStyle = bg; c.font = 'bold 30px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(big[0], x + 216, y + 50);
      c.fillStyle = fg; c.textAlign = 'left'; c.font = 'bold 34px sans-serif'; c.fillText(big, x + 12, y + 38, 180);
      c.font = '20px sans-serif'; c.fillText(small, x + 14, y + 72, 180);
      c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 4; c.strokeRect(x + 2, y + 2, 252, 92);
    });
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 4;
    return (this.adTex = t);
  },
};

function outKitBuild(K, group) {
  const C3 = K.C3, G = CITY.G, M = K.M;
  /* the quays: a wall each side, from the riverbed up to a parapet, and the walk behind it */
  const R = OUT.river;
  if (R) {
    const half = R.w / 2, WALL = C3('#a8a196'), WALK_C = C3('#9b968c'), VERGE_C = C3('#7a9a52'), y0 = TER.WATER - R.depth, y1 = G + 0.9;
    const nrm = (k) => { const k0 = Math.max(0, k - 1), k1 = Math.min(R.n - 1, k + 1), dx = R.X[k1] - R.X[k0], dz = R.Z[k1] - R.Z[k0], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
    for (let k = 0; k < R.n - 1; k++) {
      const [ax, az] = nrm(k), [bx, bz] = nrm(k + 1);
      for (const sd of [-1, 1]) {
        const A = (o, y) => [R.X[k] + ax * o * sd, y, R.Z[k] + az * o * sd], Bp = (o, y) => [R.X[k + 1] + bx * o * sd, y, R.Z[k + 1] + bz * o * sd];
        M.at(R.X[k], R.Z[k]);
        K.quad(M, A(half, y0), Bp(half, y0), Bp(half, y1), A(half, y1), WALL, [-ax * sd, 0, -az * sd]);              // the wall, facing the water
        K.quad(M, A(half, y1), Bp(half, y1), Bp(half + 0.6, y1), A(half + 0.6, y1), WALL, [0, 1, 0]);
        K.quad(M, A(half + 0.6, G), Bp(half + 0.6, G), Bp(half + 0.6, y1), A(half + 0.6, y1), WALL, [ax * sd, 0, az * sd]);
        K.GR.at(R.X[k], R.Z[k]);
        K.quad(K.GR, A(half + 0.6, G), Bp(half + 0.6, G), Bp(half + WALK, G), A(half + WALK, G), WALK_C, [0, 1, 0]);
        K.quad(K.GR, A(half + WALK, G), Bp(half + WALK, G), Bp(half + WALK + outVerge(), G), A(half + WALK + outVerge(), G), VERGE_C, [0, 1, 0]);
      }
    }
  }
  /* bridge steel (laid out, and given its boxes, by outSteel), the boats and the gantries */
  const COLS = { steel: C3('#c9472e'), grey: C3('#7d8288'), tower: C3('#d8d3c8'), cable: C3('#5e6266') };
  for (const bm of OUT.steel) { M.at(bm.p0[0], bm.p0[2]); K.beam(M, bm.p0, bm.p1, bm.size, COLS[bm.col]); }
  outDrawBoats(K);
  outDrawSigns(K, group);
  /* billboards: a pole, the back of the frame, and an advert each side (unlit, so they glow a little at dusk) */
  if (OUT.boards.length) {
    const [bw, bh] = OUT.C.billboards.size, POLE = C3('#5d6166'), FRAME = C3('#3d4044');
    const pos = [], uv = [];
    for (const bd of OUT.boards) {
      M.at(bd.x, bd.z);
      K.plainBox(bd.x, bd.z, bd.fz, -bd.fx, 0.5, 0.5, G - 0.3, bd.top - bh, POLE, false);
      K.plainBox(bd.x, bd.z, bd.fz, -bd.fx, bw / 2 + 0.3, 0.35, bd.top - bh - 0.4, bd.top + 0.3, FRAME);
      // the two faces: (fx, fz) points the way the front faces
      const rx = bd.fz, rz = -bd.fx;                       // along the panel
      for (const [sgn, ad] of [[1, bd.ad], [-1, bd.ad2]]) {
        const ox = bd.fx * 0.4 * sgn, oz = bd.fz * 0.4 * sgn, u0 = (ad % 4) / 4, v0 = 1 - Math.floor(ad / 4) / 2, u1 = u0 + 0.25, v1 = v0 - 0.5;
        const c = (s, y) => [bd.x + ox + rx * bw / 2 * s * sgn, y, bd.z + oz + rz * bw / 2 * s * sgn];
        const p0 = c(-1, bd.top - bh), p1 = c(1, bd.top - bh), p2 = c(1, bd.top), p3 = c(-1, bd.top);
        pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
        uv.push(u0, v1, u1, v1, u1, v0, u0, v1, u1, v0, u0, v0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({ map: OutLook.ads(), color: '#d8d0c4' });
    mat.userData.noSun = true;
    group.add(new THREE.Mesh(g, mat));
  }
  /* traffic: cars along the lanes of every highway, both ways, moved just before each frame draws them */
  const per = OUT.C.traffic;
  if (per > 0 && CITY.hw.length) {
    const cars = [], rnd = mulberry32(777);
    for (const H of CITY.hw) {
      if (H.spec.bridge && H.spec.bridge.type === 'truss') continue;   // the railway
      const cum = [0];
      for (let i = 1; i < H.n; i++) cum.push(cum[i - 1] + Math.hypot(H.X[i] - H.X[i - 1], H.Z[i] - H.Z[i - 1]));
      const len = cum[H.n - 1], lanes = Math.max(1, Math.min(3, Math.floor((H.w / 2 - 2) / 3.6)));
      const n = Math.round(len / 1000 * per * 2);
      for (let k = 0; k < n; k++) {
        const dir = k % 2 ? 1 : -1, lane = Math.floor(rnd() * lanes);
        cars.push({ H, cum, len, dir, lat: dir * (1.2 + 3.6 * (lane + 0.5)), s: rnd() * len, v: 24 + rnd() * 9 + (lanes - lane) * 2 });
      }
    }
    if (!cars.length) return;
    const body = new THREE.BoxGeometry(1.9, 1.1, 4.4).translate(0, 0.75, 0), cab = new THREE.BoxGeometry(1.7, 0.7, 2.2).translate(0, 1.6, -0.2);
    const geo = mergeGeo([body, cab]);
    const cmat = new THREE.MeshLambertMaterial({ color: '#ffffff' }); cmat.userData.noSun = true;   // (instanced: no per-vertex terrain shade)
    const mesh = new THREE.InstancedMesh(geo, cmat, cars.length);
    const col = new THREE.Color(), CAR = ['#d8d8d4', '#2b2e33', '#9aa0a6', '#b8322b', '#2f5c9e', '#e4e1d8', '#4a5a3e', '#c9a43a'];
    cars.forEach((c, i) => mesh.setColorAt(i, col.set(CAR[Math.floor(rnd() * CAR.length)])));
    mesh.frustumCulled = false;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    let last = performance.now();
    mesh.onBeforeRender = () => {
      const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1); last = now;
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i], H = c.H;
        c.s = (c.s + c.v * dt * c.dir + c.len) % c.len;
        let lo = 0, hi = H.n - 1;                            // the segment it's on
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c.cum[mid] <= c.s) lo = mid; else hi = mid; }
        const t = (c.s - c.cum[lo]) / Math.max(1e-6, c.cum[hi] - c.cum[lo]);
        const dx = H.X[hi] - H.X[lo], dz = H.Z[hi] - H.Z[lo], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
        p.set(lerp(H.X[lo], H.X[hi], t) + nx * c.lat, G + Math.max(0.25, lerp(H.H[lo], H.H[hi], t)), lerp(H.Z[lo], H.Z[hi], t) + nz * c.lat);
        q.setFromEuler(e.set(0, Math.atan2(dx, dz) + (c.dir < 0 ? Math.PI : 0), 0));
        mesh.setMatrixAt(i, m4.compose(p, q, one));
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    group.add(mesh);
  }
}
// two box geometries as one, flat-shaded
function mergeGeo(list) {
  const pos = [];
  for (const g of list) { const n = g.index ? g.toNonIndexed() : g; pos.push(...n.attributes.position.array); }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.computeVertexNormals();
  return out;
}

/* ---------- bridge steel: beams [p0, p1, size, colour], boxes for the ones you could hit ---------- */
function outSteel(G) {
  OUT.steel.length = 0;
  const beam = (p0, p1, size, col, hit) => {
    OUT.steel.push({ p0, p1, size, col });
    if (!hit) return;
    const dx = p1[0] - p0[0], dz = p1[2] - p0[2], L = Math.hypot(dx, dz), ux = L > 0.5 ? dx / L : 1, uz = L > 0.5 ? dz / L : 0;
    shoreBox('bridge', (p0[0] + p1[0]) / 2, (p0[2] + p1[2]) / 2, ux, uz, L / 2 + size / 2, size / 2 + 0.3, Math.min(p0[1], p1[1]) - size / 2, Math.max(p0[1], p1[1]) + size / 2);
  };
  for (const H of CITY.hw) {
    const b = H.spec.bridge;
    if (!b || b.type === 'beam') continue;
    const [ax, az] = b.a, [bx, bz] = b.b, L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, vx = -uz, vz = ux;
    const r = Math.min(b.ramp || 200, L * 0.4), deck = G + b.h, w = H.w / 2;
    const P = (d, o, y) => [ax + ux * d + vx * o, y, az + uz * d + vz * o];
    if (b.type === 'arch') {
      const s0 = r, s1 = L - r, rise = (s1 - s0) * 0.2, N = 16, Y = (t) => deck + 0.5 + rise * 4 * t * (1 - t);
      for (const sd of [-1, 1]) {
        const o = sd * (w + 0.4);
        for (let i = 0; i < N; i++) {
          const t0 = i / N, t1 = (i + 1) / N;
          beam(P(lerp(s0, s1, t0), o, Y(t0)), P(lerp(s0, s1, t1), o, Y(t1)), 1.6, 'steel', true);
          if (i > 0) beam(P(lerp(s0, s1, t0), o, deck + 0.5), P(lerp(s0, s1, t0), o, Y(t0)), 0.3, 'grey', false);   // hanger
        }
      }
      for (let i = 2; i < N - 1; i += 3) { const t = i / N; beam(P(lerp(s0, s1, t), -w, Y(t)), P(lerp(s0, s1, t), w, Y(t)), 0.8, 'steel', true); }
    } else if (b.type === 'truss') {
      const s0 = r, s1 = L - r, ht = 9, panels = Math.max(4, Math.round((s1 - s0) / 9)), dl = (s1 - s0) / panels;
      for (const sd of [-1, 1]) {
        const o = sd * (w + 0.3);
        beam(P(s0, o, deck + ht), P(s1, o, deck + ht), 1.0, 'grey', true);
        beam(P(s0, o, deck + ht / 2), P(s1, o, deck + ht / 2), 0.1, 'grey', true);   // (the sides' box; drawn as a hairline)
        for (let i = 0; i <= panels; i++) {
          const d = s0 + i * dl;
          beam(P(d, o, deck), P(d, o, deck + ht), 0.6, 'grey', false);
          if (i < panels) beam(P(d, o, i % 2 ? deck + ht : deck), P(d + dl, o, i % 2 ? deck : deck + ht), 0.5, 'grey', false);
        }
      }
      for (let i = 0; i <= panels; i += 2) { const d = s0 + i * dl; beam(P(d, -w, deck + ht), P(d, w, deck + ht), 0.5, 'grey', true); }
      // the sides are solid to the crash test (a box the height of the truss along each side)
      for (const sd of [-1, 1]) { const [cx, , cz] = P((s0 + s1) / 2, sd * (w + 0.3), 0); shoreBox('bridge', cx, cz, ux, uz, (s1 - s0) / 2, 0.8, deck, deck + ht + 0.6); }
    } else if (b.type === 'suspension') {
      const [d0, d1] = b.towers, T = b.tower || 80, o = w + 2.5, legW = 4;
      const cableY = (d) => {                                // the main cable's height along the bridge
        if (d <= d0) return lerp(deck + 1.5, deck + T, smoothstep(r, d0, d) * 0.4 + (d - r) / (d0 - r) * 0.6);
        if (d >= d1) return lerp(deck + 1.5, deck + T, smoothstep(L - r, d1, d) * 0.4 + (L - r - d) / (L - r - d1) * 0.6);
        const t = (d - d0) / (d1 - d0); return deck + 4 + (T - 4) * Math.pow(2 * t - 1, 2);
      };
      for (const d of [d0, d1]) {
        const base = Math.min(G, groundAt(...P(d, 0, 0).filter((_, k) => k !== 1))) - 1;
        for (const sd of [-1, 1]) beam(P(d, sd * o, base), P(d, sd * o, deck + T), legW, 'tower', true);
        beam(P(d, -o, deck - 3), P(d, o, deck - 3), 3, 'tower', true);                   // under the deck
        beam(P(d, -o, deck + T * 0.3), P(d, o, deck + T * 0.3), 3.2, 'tower', true);     // a third of the way up
        beam(P(d, -o, deck + T - 2), P(d, o, deck + T - 2), 4, 'tower', true);           // the top
      }
      const step = 10;
      for (const sd of [-1, 1]) {
        let prev = null;
        for (let d = r; d <= L - r + 0.1; d += step) {
          const p = P(d, sd * o, cableY(d));
          if (prev) beam(prev, p, 1.0, 'cable', true);
          if (d > r + 1 && d < L - r - 1 && Math.abs(d - d0) > 3 && Math.abs(d - d1) > 3) beam(P(d, sd * (w + 0.6), deck + 1), P(d, sd * (w + 0.6), p[1]), 0.25, 'cable', false);
          prev = p;
        }
      }
    }
  }
}

/* ---------- boats: a ship (twin funnels side by side amidships) and sailboats, moored along the river ---------- */
function outRiverDir(x, z) {                                 // the way the river runs nearest (x, z)
  const R = OUT.river;
  let bd = Infinity, bk = 0;
  for (let k = 0; k < R.n - 1; k++) { const d = (R.X[k] - x) ** 2 + (R.Z[k] - z) ** 2; if (d < bd) { bd = d; bk = k; } }
  const dx = R.X[bk + 1] - R.X[bk], dz = R.Z[bk + 1] - R.Z[bk], l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}
function outBoats(ctx) {
  OUT.boats.length = 0;
  if (!OUT.river) return;
  const Wy = TER.WATER;
  for (const spec of ctx.C.boats || []) {
    const [ux, uz] = outRiverDir(spec.x, spec.z), vx = -uz, vz = ux, rnd = mulberry32(Math.round(spec.x * 7 + spec.z * 13));
    const bt = Object.assign({ ux, uz, vx, vz, c: Math.floor(rnd() * 1000) }, spec);
    const P = (u, v) => [spec.x + ux * u + vx * v, spec.z + uz * u + vz * v];
    const box = (u, v, hu, hv, y0, y1, kind) => { const [x, z] = P(u, v); shoreBox(kind || 'boat', x, z, ux, uz, hu, hv, y0, y1); };
    if (spec.kind === 'ship') {
      const L = spec.len || 200, Bm = spec.beam || 50, deck = Wy + 10;
      Object.assign(bt, { L, Bm, deck, fr: 4.5, fh: 30 });
      bt.funnels = spec.funnelGap ? [[-spec.funnelGap / 2, 0], [spec.funnelGap / 2, 0]] : [[0, -(Bm / 2 - 6)], [0, Bm / 2 - 6]];
      const fwd = Math.max(...bt.funnels.map((f) => f[0]));
      box(-L * 0.08, 0, L * 0.42, Bm / 2, Wy - 3, deck);                             // the hull (the bow is pointed: two boxes)
      box(L * 0.4, 0, L * 0.1, Bm * 0.3, Wy - 3, deck);
      box(-L / 2 + 26, 0, 22, Bm / 2 - 3, deck, deck + 7);                           // the superstructure, aft
      for (const [fu, fv] of bt.funnels) box(fu, fv, bt.fr, bt.fr, deck, deck + bt.fh, 'funnel');
      bt.cargo = [];                                         // containers forward, two high, clear of the middle line
      const rows = Bm > 40 ? [-Bm / 2 + 7, -Bm / 2 + 16, Bm / 2 - 16, Bm / 2 - 7] : [-Bm / 2 + 5, -Bm / 2 + 11, Bm / 2 - 11, Bm / 2 - 5];
      for (let u = fwd + 18; u < L * 0.36; u += 13) for (const v of rows) {
        const n = 1 + Math.floor(rnd() * 2); bt.cargo.push([u, v, n, Math.floor(rnd() * 6)]);
        box(u, v, 6.1, 1.25, deck, deck + 2.6 * n);
      }
    } else {                                                 // a sailboat: hull, mast, sail
      const L = spec.len || 13, mast = L * 1.9;
      Object.assign(bt, { L, mast, sail: Math.floor(rnd() * 4) });
      box(0, 0, L / 2, 2.2, Wy - 1, Wy + 1.4);
      box(L * 0.08, 0, 0.4, 0.4, Wy + 1.4, Wy + 1.4 + mast, 'mast');
      box(-L * 0.12, 0, L * 0.22, 0.3, Wy + 3, Wy + 1.4 + mast * 0.92, 'mast');
    }
    OUT.boats.push(bt);
  }
}
function outDrawBoats(K) {
  const M = K.M, Wy = TER.WATER, C3 = K.C3;
  for (const bt of OUT.boats) {
    const { ux, uz, vx, vz } = bt, P = (u, v, y) => [bt.x + ux * u + vx * v, y, bt.z + uz * u + vz * v];
    M.at(bt.x, bt.z);
    // an outline in the boat's own (u, v), extruded from y0 to y1
    const prism = (pts, y0, y1, side, top) => {
      for (let i = 0; i < pts.length; i++) {
        const [u0, v0] = pts[i], [u1, v1] = pts[(i + 1) % pts.length], du = u1 - u0, dv = v1 - v0;
        const n = [ux * dv - vx * du, 0, uz * dv - vz * du];             // outward for a clockwise-in-(u, v) outline
        K.quad(M, P(u0, v0, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v0, y1), side, [-n[0], 0, -n[2]]);
      }
      if (top) for (let i = 1; i < pts.length - 1; i++) M.tri(P(...pts[0], y1), P(...pts[i], y1), P(...pts[i + 1], y1), top, K.W0, K.W0, K.W0, 0, 1, 0);
    };
    if (bt.kind === 'ship') {
      const { L, Bm, deck } = bt, h = Bm / 2;
      const hull = [[-L / 2, -h], [-L / 2, h], [L * 0.3, h], [L / 2, 0], [L * 0.3, -h]];
      prism(hull, Wy - 3, Wy + 0.8, C3('#9b2f25'), null);                        // red below the waterline
      prism(hull, Wy + 0.8, deck, C3('#1f3550'), C3('#6f6a62'));                 // navy hull, deck
      K.plainBox(...P(-L / 2 + 26, 0, 0).filter((_, k) => k !== 1), ux, uz, 22, h - 3, deck, deck + 7, C3('#ecebe6'));   // superstructure
      K.plainBox(...P(-L / 2 + 40, 0, 0).filter((_, k) => k !== 1), ux, uz, 6, h - 8, deck + 7, deck + 9.5, C3('#3a4652'));   // its bridge windows
      for (const [fu, fv] of bt.funnels) {                   // the funnels: buff, a red band, black tops
        const [fx, , fz] = P(fu, fv, 0);
        outPrism(K, fx, fz, bt.fr, bt.fr, deck, deck + bt.fh * 0.72, 10, C3('#e3cf9a'));
        outPrism(K, fx, fz, bt.fr, bt.fr, deck + bt.fh * 0.72, deck + bt.fh * 0.88, 10, C3('#c8362a'));
        outPrism(K, fx, fz, bt.fr, bt.fr * 0.95, deck + bt.fh * 0.88, deck + bt.fh, 10, C3('#1b1d20'), true);
      }
      const CC = ['#c8442e', '#2f6fa8', '#e0b23c', '#3c8a5a', '#d7d2c6', '#7a4aa0'].map(C3);
      for (const [u, v, n, c] of bt.cargo) K.plainBox(...P(u, v, 0).filter((_, k) => k !== 1), ux, uz, 6.1, 1.25, deck, deck + 2.6 * n, CC[c]);
    } else {
      const { L, mast } = bt;
      prism([[-L / 2, -1.6], [-L / 2, 1.6], [L * 0.2, 2.2], [L / 2, 0], [L * 0.2, -2.2]], Wy - 1, Wy + 1.4, C3('#f2f0ea'), C3('#b98f5f'));
      const [mx, , mz] = P(L * 0.08, 0, 0);
      K.plainBox(mx, mz, ux, uz, 0.25, 0.25, Wy + 1.4, Wy + 1.4 + mast, C3('#d0d0cc'), true);
      const SAIL = ['#f4f1e8', '#f4f1e8', '#e8584a', '#3d7cc9'][bt.sail];
      const a = P(L * 0.06, 0, Wy + 3), b = P(L * 0.06, 0, Wy + 1.4 + mast * 0.95), c = P(-L * 0.36, 0, Wy + 3);
      M.tri(a, b, c, C3(SAIL), K.W0, K.W0, K.W0, vx, 0, vz); M.tri(a, c, b, C3(SAIL), K.W0, K.W0, K.W0, -vx, 0, -vz);   // both faces
    }
  }
}

/* ---------- billboard gantries over the road ---------- */
function outSigns(ctx) {
  OUT.signs.length = 0;
  const G = ctx.G, rnd = mulberry32(31337);
  for (const sg of ctx.C.signs || []) {
    const [ax, az] = sg.a, [bx, bz] = sg.b, L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    const x = (ax + bx) / 2, z = (az + bz) / 2, y0 = G + sg.clear, y1 = y0 + sg.h;
    OUT.signs.push({ x, z, ux, uz, L, y0, y1, ad: [Math.floor(rnd() * 8), Math.floor(rnd() * 8), Math.floor(rnd() * 8), Math.floor(rnd() * 8)] });
    for (const [px, pz] of [sg.a, sg.b]) shoreBox('board', px, pz, ux, uz, 1, 1, G - 1, y1);
    shoreBox('board', x, z, ux, uz, L / 2 + 1, 0.8, y0 - 0.6, y1 + 0.4);
  }
}
function outDrawSigns(K, group) {
  if (!OUT.signs.length) return;
  const M = K.M, G = CITY.G, LEG = K.C3('#6a6e73'), FRAME = K.C3('#3d4044'), pos = [], uv = [];
  for (const s of OUT.signs) {
    const nx = -s.uz, nz = s.ux;                             // the panel faces along the road (both ways)
    for (const e of [-1, 1]) {
      const px = s.x + s.ux * s.L / 2 * e, pz = s.z + s.uz * s.L / 2 * e;
      M.at(px, pz); K.plainBox(px, pz, s.ux, s.uz, 1, 1, G - 0.3, s.y1 + 0.4, LEG);
    }
    M.at(s.x, s.z);
    K.plainBox(s.x, s.z, s.ux, s.uz, s.L / 2 + 1, 0.5, s.y0 - 0.6, s.y1 + 0.4, FRAME);
    const n = s.L > 24 ? 2 : 1;                              // one advert a face, or two side by side on a wide one
    for (const sgn of [1, -1]) for (let half = 0; half < n; half++) {
      const ad = s.ad[(sgn > 0 ? 0 : 2) + half], u0 = (ad % 4) / 4, v0 = 1 - Math.floor(ad / 4) / 2, u1 = u0 + 0.25, v1 = v0 - 0.5;
      const e0 = n === 2 ? (half - 1) * sgn : -sgn, e1 = n === 2 ? half * sgn : sgn, o = 0.55 * sgn;
      const c = (e, y) => [s.x + s.ux * (s.L / 2 - 1) * e + nx * o, y, s.z + s.uz * (s.L / 2 - 1) * e + nz * o];
      const p0 = c(e0, s.y0), p1 = c(e1, s.y0), p2 = c(e1, s.y1), p3 = c(e0, s.y1);
      pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3); uv.push(u0, v1, u1, v1, u1, v0, u0, v1, u1, v0, u0, v0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ map: OutLook.ads(), color: '#d8d0c4', side: THREE.DoubleSide });
  mat.userData.noSun = true;
  group.add(new THREE.Mesh(g, mat));
}
