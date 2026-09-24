'use strict';
// Level rendering. The main layer's alpha channel is also the collision mask.
const PAL = { hull:'#ece6da', hullDark:'#7a7283', glass:'#8fd6ff', ghost:'#8fb0ff', start:'#7fa6c9', target:'#5ad46e' };
// ---- Geometry ----
function rng(seed){ let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// Room outline: 11–15 vertices, gently jittered, so corners stay obtuse. Nothing in the level art is curved.
function polyPts(cx,cy,rx,ry,wob,seed){
  const r = rng(seed*7919+13), n = 11+Math.floor(r()*5), pts = [];
  for (let i=0;i<n;i++){ const t = (i+(r()-0.5)*0.3)/n*6.283, s = 1+(r()-0.5)*1.6*wob; pts.push([cx+Math.cos(t)*rx*s, cy+Math.sin(t)*ry*s]); }
  return pts;
}
function poly(x,pts){ x.beginPath(); x.moveTo(pts[0][0],pts[0][1]); for (let i=1;i<pts.length;i++) x.lineTo(pts[i][0],pts[i][1]); x.closePath(); }
function mkCanvas(w,h){ const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// Releases a layer's backing stores now rather than whenever GC gets round to it. WebKit counts canvas memory against a
// hard cap and only gives it back when the canvas shrinks or is collected, so a big level swapped for another would
// otherwise hold both sets at once.
function freeLayer(lr){ if (!lr) return; for (const t of lr.tiles) t.c.width = t.c.height = 0; lr.tiles.length = 0; }

// ---- Art ----
// Low-poly shading: large flat convex facets, each a slight shift lighter or darker. Straight edges only.
function facets(x, r, x0, y0, W, H, n, smin, smax, amp){
  for (let i=0;i<n;i++){
    const cx = x0+r()*W, cy = y0+r()*H, k = 3+Math.floor(r()*3), rad = smin+r()*(smax-smin), a0 = r()*6.283, sq = 0.5+r()*0.8, pts = [];
    for (let j=0;j<k;j++){ const t = a0+(j+(r()-0.5)*0.5)/k*6.283; pts.push([cx+Math.cos(t)*rad, cy+Math.sin(t)*rad*sq]); }
    poly(x,pts); x.fillStyle = r()<0.5 ? `rgba(255,255,255,${(0.4+r()*0.6)*amp})` : `rgba(0,0,0,${(0.4+r()*0.6)*amp})`; x.fill();
  }
}
const shade = (hex, k) => { const n = parseInt(hex.slice(1),16); return `rgb(${(n>>16)*k|0},${((n>>8)&255)*k|0},${(n&255)*k|0})`; };
const shadePal = (pal, k) => { const o = {}; for (const [n,v] of Object.entries(pal)) o[n] = Array.isArray(v) ? v.map(c => shade(c,k)) : shade(v,k); return o; };
const angular = (ctx) => { ctx.lineJoin = 'miter'; ctx.lineCap = 'square'; ctx.miterLimit = 4; };
// The mass a level is cut out of. Rock by default; levels set inside a tree take wallMat:'wood' and get pal.wood plus the
// grain pass in woodGrain, so the walls read as the inside of a trunk rather than a cave.
const massCol = pal => (L.wallMat === 'wood' && pal.wood) || pal.rock;
// The pad's receding deck comes from the depth walls, which take the pad colour along its top edge.
function drawPad(x,p,col){
  x.fillStyle = p.base === 'bark' ? '#3a2816' : p.base === 'leaf' ? '#2a4d28' : '#4a4f57'; x.fillRect(p.x-6,p.y,p.w+12,12);
  x.fillStyle = col; x.fillRect(p.x,p.y,p.w,6);
  x.fillStyle = 'rgba(255,255,255,.45)'; for (let i=0;i<5;i++) x.fillRect(p.x+8+i*(p.w-16)/4-2, p.y+8, 4, 2);
}

// ---- Solid groups: every solid kind with its own colour and detail pass. All of them end up in the collision mask. ----
function groupPath(ctx, g){
  ctx.beginPath();
  for (const pts of g.polys){ ctx.moveTo(pts[0][0],pts[0][1]); for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]); ctx.closePath(); }
  for (const b of g.rects||[]) ctx.rect(b[0],b[1],b[2],b[3]);
  for (const w of g.walls||[]){ const cx = w.x+w.w/2, cy = w.y+w.h/2, ca = Math.cos(w.a||0), sa = Math.sin(w.a||0); const P = (dx,dy) => [cx+dx*ca-dy*sa, cy+dx*sa+dy*ca]; const v = [P(-w.w/2,-w.h/2),P(w.w/2,-w.h/2),P(w.w/2,w.h/2),P(-w.w/2,w.h/2)]; ctx.moveTo(v[0][0],v[0][1]); for (let i=1;i<4;i++) ctx.lineTo(v[i][0],v[i][1]); ctx.closePath(); }
}
// Bark: a few long dark and light streaks running along the axis, tapering with the trunk. Straight quads only.
function barkLines(t, items, r){
  for (const it of items){
    const dx = it.bx-it.ax, dy = it.by-it.ay, len = Math.hypot(dx,dy), ux = dx/len, uy = dy/len, nx = -uy, ny = ux, n = 2+Math.floor(it.w/28);
    for (let i=0;i<n;i++){
      const o = (r()-0.5)*0.75, t0 = r()*0.35, t1 = Math.min(1, t0+0.3+r()*0.6), lw = 1.5+r()*2.5, dark = r() < 0.7;
      const P = (tt,side) => { const hw = it.w/2*(1-tt*it.taper), off = o*hw+side*lw; return [it.ax+ux*len*tt+nx*off, it.ay+uy*len*tt+ny*off]; };
      poly(t,[P(t0,-1),P(t0,1),P(t1,1),P(t1,-1)]); t.fillStyle = dark ? 'rgba(0,0,0,.32)' : 'rgba(255,255,255,.10)'; t.fill();
    }
  }
}
// Foliage: a lighter clump offset up-left inside each blob, and a few dark notches along the underside.
function leafDetail(t, items, pal, r){
  for (const f of items){
    t.fillStyle = pal.leaf[Math.min(pal.leaf.length-1, f.tone+1)];
    poly(t, polyPts(f.x-f.r*0.12, f.y-f.ry*0.22, f.r*0.55, f.ry*0.5, 0.3, f.seed*3+1)); t.fill();
    t.fillStyle = 'rgba(0,0,0,.14)';   // flat shadow slabs low in the blob, where the leaves are undercut
    for (let i=0;i<3;i++){ const px = f.x+(r()-0.5)*f.r*1.2, py = f.y+f.ry*(0.3+r()*0.6), w = f.r*(0.2+r()*0.3), h = 8+r()*14; poly(t,[[px-w,py+h*0.3],[px+w*0.8,py-h*0.4],[px+w,py+h*0.5],[px-w*0.6,py+h]]); t.fill(); }
  }
}
function solidGroups(pal){
  const blocksOf = kind => G.blocks.filter((b,i) => (G.blockKinds ? G.blockKinds[i] : 'rock') === kind);   // pad pedestals: rock, or wood / leaves where rock makes no sense
  const gs = [ {col:pal.rock, polys:G.rocks.map(rk => rk.pts), rects:blocksOf('rock'), walls:L.walls} ];
  // branches before trunks, so a trunk's fill covers the branch outline where the two join
  for (const items of [G.branches, G.trunks]) if (items.length) gs.push({col:pal.bark, polys:items.map(it => it.pts), detail:(t,r) => barkLines(t, items, r)});
  if (blocksOf('bark').length) gs.push({col:pal.bark, polys:[], rects:blocksOf('bark')});
  for (let tone=0; tone<4; tone++){
    const fl = G.foliage.filter(f => f.tone === tone);
    if (fl.length || (tone === 1 && blocksOf('leaf').length)) gs.push({col:pal.leaf[tone], polys:fl.map(f => f.pts), rects:tone === 1 ? blocksOf('leaf') : [], edgeK:0.4, detail:(t,r) => leafDetail(t, fl, pal, r)});
  }
  return gs.filter(g => g.polys.length || (g.rects&&g.rects.length) || (g.walls&&g.walls.length));
}

// One rendering of the level at canvas scale q: terrain with facets, cave cut out, solids put back.
// The layer is produced as a grid of tiles no larger than TILE on a side. Big levels would otherwise need one canvas of
// 20M+ pixels, past the size browsers keep on the GPU, and every frame's drawImage turns into a software blit. Each tile
// re-runs the same deterministic drawing offset to its corner (off-tile geometry is clipped for free), so the tiles fit
// seamlessly. The main layer (q=1) also yields the collision mask, assembled tile by tile. Returns {w, h, tiles:[{x, y, c}], mask?}.
const TILE = 2048, TM = 2;                                           // TM: tiles overlap by this many pixels so scaled edges never show a seam
function renderLayer(q, st, padX, padY){
  const W = Math.ceil((L.w+2*padX)*q), H = Math.ceil((L.h+2*padY)*q), pal = st.pal, out = {w:W, h:H, tiles:[], mask:st.captureMask ? new Uint8Array(L.w*L.h) : null};
  // One scratch canvas for the solids, re-sized to each tile (which also clears it and frees the previous store at once)
  // and released at the end. A fresh one per tile left up to ~70 dead 16 MB canvases per level build waiting on GC.
  const tc = mkCanvas(1, 1), t = tc.getContext('2d');
  for (let ty=0; ty<H; ty+=TILE) for (let tx=0; tx<W; tx+=TILE){
    const tw = Math.min(TILE, W-tx), th = Math.min(TILE, H-ty), c = mkCanvas(tw+2*TM,th+2*TM), x = c.getContext('2d'), r = rng(L.rooms[0].seed*31+7);
    x.fillStyle = massCol(pal); x.fillRect(0,0,tw+2*TM,th+2*TM);
    x.translate(padX*q-tx+TM, padY*q-ty+TM); x.scale(q,q);
    if (STYLE.terrain) STYLE.terrain(x, rng(L.rooms[0].seed*47+11), pal, -400, -400, L.w+800, L.h+800);
    facets(x, r, -400, -400, L.w+800, L.h+800, Math.round(L.w*L.h/60000), 260, 800, st.amp);
    x.globalCompositeOperation = 'destination-out'; x.fillStyle = '#000';
    for (const pts of G.caves){ poly(x,pts); x.fill(); }
    for (const p of G.clear) x.fillRect(p[0], p[1], p[2], p[3]);
    // a faint shadow band just inside every cave edge, so the outline reads without a drawn line. Done before the solids
    // go in, so the band stays on the terrain and never crosses a stump or spike that straddles a room edge.
    const edgeCol = `rgba(0,0,0,${st.edgeAlpha||0.14})`, edgeW = st.edge || 10;
    x.globalCompositeOperation = 'source-atop'; x.strokeStyle = edgeCol; angular(x); x.lineWidth = edgeW;
    for (const pts of G.caves){ poly(x,pts); x.stroke(); }
    for (const p of G.clear) x.strokeRect(p[0],p[1],p[2],p[3]);
    // solids (rocks, trunks, foliage, pad blocks) on a scratch canvas, composited behind the terrain so overlaps never show.
    // Each group is filled, faceted, detailed and edge-shaded inside its own clip, so one group's edge never marks another.
    tc.width = tw+2*TM; tc.height = th+2*TM; t.translate(padX*q-tx+TM, padY*q-ty+TM); t.scale(q,q);
    for (const g of solidGroups(pal)){
      t.save(); groupPath(t,g); t.clip();
      t.fillStyle = g.col; t.fillRect(-400,-400,L.w+800,L.h+800);
      facets(t, r, -400, -400, L.w+800, L.h+800, Math.round(L.w*L.h/45000), 60, 240, st.amp);
      if (g.detail) g.detail(t, r);
      t.strokeStyle = `rgba(0,0,0,${(st.edgeAlpha||0.14)*(g.edgeK||1)})`; angular(t); t.lineWidth = edgeW; groupPath(t,g); t.stroke();
      t.restore();
    }
    x.globalCompositeOperation = 'destination-over'; x.save(); x.setTransform(1,0,0,1,0,0); x.drawImage(tc,0,0); x.restore();
    x.globalCompositeOperation = 'source-over';
    if (out.mask){                                                    // main layer: q = 1, no padding, so tile pixel (i,j) is level pixel (tx+i, ty+j)
      const d = x.getImageData(TM,TM,tw,th).data, m = out.mask;
      for (let j=0;j<th;j++){ const row = (ty+j)*L.w+tx, src = j*tw*4+3; for (let i=0;i<tw;i++) m[row+i] = d[src+i*4] > 100 ? 1 : 0; }
    }
    if (st.pads){ drawPad(x,L.pads.start,PAL.start); drawPad(x,L.pads.target,PAL.target); }
    out.tiles.push({x:tx, y:ty, c});
  }
  tc.width = tc.height = 0;
  return out;
}
// Draws a tiled layer with its origin at screen (ox,oy) and scale k, skipping tiles outside the viewport.
function drawLayer(ctx, lr, ox, oy, k, vw, vh){
  for (const t of lr.tiles){
    const dx = ox+(t.x-TM)*k, dy = oy+(t.y-TM)*k, dw = t.c.width*k, dh = t.c.height*k;
    if (dx > vw || dy > vh || dx+dw < 0 || dy+dh < 0) continue;
    ctx.drawImage(t.c, dx, dy, dw, dh);
  }
}
// Falling hazards are drawn live rather than baked into the layers, so each gets a small sprite in the level's style.
function renderSpikeSprite(pts, seed, kind, axis){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for (const p of pts){ x0=Math.min(x0,p[0]); y0=Math.min(y0,p[1]); x1=Math.max(x1,p[0]); y1=Math.max(y1,p[1]); }
  const pad = 6, c = mkCanvas(Math.ceil(x1-x0)+2*pad, Math.ceil(y1-y0)+2*pad), x = c.getContext('2d'), r = rng(seed*17+3), pal = STYLE.main.pal;
  x.translate(pad-x0, pad-y0);
  x.save(); poly(x,pts); x.clip();
  x.fillStyle = kind === 'branch' ? pal.bark : pal.rock; x.fillRect(x0-pad,y0-pad,x1-x0+2*pad,y1-y0+2*pad);
  facets(x, r, x0, y0, x1-x0, y1-y0, 7, 18, 70, 0.09);
  if (kind === 'branch' && axis) barkLines(x, [axis], r);
  x.strokeStyle = 'rgba(0,0,0,.16)'; angular(x); x.lineWidth = 8; poly(x,pts); x.stroke();
  x.restore();
  return {c, ox:x0-pad, oy:y0-pad};
}

// ---- Depth walls ----
// The level reads as a slab with depth: every rock, trunk and leaf edge carries a wall face receding toward the screen
// centre, with the perspective the old parallax layers had (screen = centre + (p - centre)·f, f from 1 back to FBACK).
// The faces come from the collision mask's outline, traced once per level: it already holds every solid there is, and
// the level art being straight-edged, it simplifies to a few hundred segments. Each face takes its colour from the main
// layer just inside the rock, averaged along the outline, so trunks get bark walls and canopy green ones. Drawn every
// frame as flat quads under the main layer, which hides the half of each face that runs into rock.
const WALLS = (() => {
  const S = 4, INSET = 3, EPS = 4.5, FBACK = 0.88, BANDS = 1, K0 = 0.9, K1 = 0.45, SMOOTH = 50;
  const FB = [], BK = [];                                           // band edges in f, and each band's shade: the value at its middle
  for (let i=0;i<=BANDS;i++) FB.push(1-(1-FBACK)*i/BANDS);
  for (let i=0;i<BANDS;i++) BK.push(K0+(K1-K0)*(i+0.5)/BANDS);
  const LX = -0.35/Math.hypot(0.35,0.94), LY = -0.94/Math.hypot(0.35,0.94);   // light from above, a little left
  let segs = [];
  // The main layer shrunk 8×. Transparent pixels average out, so a sample near an edge still reads the solid's colour.
  function colourMap(){
    const K = 8, w = Math.ceil(L.w/K), h = Math.ceil(L.h/K), c = mkCanvas(w, h), x = c.getContext('2d', {willReadFrequently:true});
    for (const t of mainC.tiles) x.drawImage(t.c, TM, TM, t.c.width-2*TM, t.c.height-2*TM, t.x/K, t.y/K, (t.c.width-2*TM)/K, (t.c.height-2*TM)/K);
    const d = x.getImageData(0, 0, w, h).data; c.width = c.height = 0;
    return (px, py) => { const i = (Math.max(0, Math.min(h-1, py/K|0))*w + Math.max(0, Math.min(w-1, px/K|0)))*4; return d[i+3] > 20 ? [d[i], d[i+1], d[i+2]] : null; };
  }
  function dp(pts, out){                                            // Douglas–Peucker; both ends kept
    const st = [[0, pts.length-1]], keep = new Uint8Array(pts.length); keep[0] = keep[pts.length-1] = 1;
    while (st.length){ const [a, b] = st.pop(), A = pts[a], B = pts[b], dx = B[0]-A[0], dy = B[1]-A[1], l = Math.hypot(dx,dy) || 1;
      let md = 0, mi = -1; for (let i=a+1;i<b;i++){ const d = Math.abs((pts[i][0]-A[0])*dy-(pts[i][1]-A[1])*dx)/l; if (d > md){ md = d; mi = i; } }
      if (md > EPS){ keep[mi] = 1; st.push([a, mi], [mi, b]); } }
    for (let i=0;i<pts.length;i++) if (keep[i]) out.push(pts[i]);
  }
  function build(){
    // Coarse grid of the mask with a solid border, then the cell edges between solid and open, oriented so the open
    // side is on the left of travel: n = (dy, -dx) points into the open.
    const W = Math.ceil(L.w/S)+2, H = Math.ceil(L.h/S)+2, g = new Uint8Array(W*H).fill(1), m = mask, lw = L.w, lh = L.h;
    for (let y=1;y<H-1;y++){ const py = Math.min(lh-1, (y-1)*S+S/2|0), row = py*lw;
      for (let x=1;x<W-1;x++){ const px = (x-1)*S+S/2|0; g[y*W+x] = px >= lw || m[row+px] === 1 ? 1 : 0; } }
    const VW = W+1, out = new Map(), used = new Set(), E = (a, b) => a*4194304 + b;
    const add = (a, b) => { let l = out.get(a); if (!l) out.set(a, l = []); l.push(b); };
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (!g[y*W+x]) continue; const o = y*VW+x;
      if (y>0   && !g[(y-1)*W+x]) add(o, o+1);
      if (y<H-1 && !g[(y+1)*W+x]) add(o+VW+1, o+VW);
      if (x>0   && !g[y*W+x-1])   add(o+VW, o);
      if (x<W-1 && !g[y*W+x+1])   add(o+1, o+VW+1); }
    const col = colourMap(), pads = Object.entries(L.pads);
    segs = [];
    for (const [start, list] of out) for (const first of list){
      if (used.has(E(start, first))) continue;
      const pts = []; let a = start, b = first;
      for (;;){                                                     // walk the chain; at a saddle take the right-hand turn
        used.add(E(a, b)); pts.push(a);
        const nl = (out.get(b) || []).filter(c => !used.has(E(b, c)));
        if (!nl.length){ pts.push(b); break; }
        let nb = nl[0];
        if (nl.length > 1){ const dx = b%VW - a%VW, dy = (b/VW|0) - (a/VW|0), turn = c => dx*((c/VW|0) - (b/VW|0)) - dy*(c%VW - b%VW); nb = nl.reduce((p, q) => turn(q) > turn(p) ? q : p); }
        a = b; b = nb;
      }
      if (pts.length < 8) continue;                                 // under ~32 px of outline: a speck, not a wall
      const P = pts.map(v => [(v%VW - 1)*S, ((v/VW|0) - 1)*S]), simp = [];
      if (pts[0] === pts[pts.length-1]){                            // closed loop: split at the far point so DP has two distinct ends
        let fi = 0, fd = -1; for (let i=1;i<P.length;i++){ const d = (P[i][0]-P[0][0])**2 + (P[i][1]-P[0][1])**2; if (d > fd){ fd = d; fi = i; } }
        dp(P.slice(0, fi+1), simp); simp.pop(); dp(P.slice(fi), simp);
      } else dp(P, simp);
      // The front edge is tucked INSET px into the rock so it never shows ahead of the terrain. The offset is taken once per
      // vertex, along the bisector of its two edges (a miter), so neighbouring faces share their corners exactly. Offsetting
      // each segment along its own normal split every corner in two and left a thin wedge of backdrop between the faces,
      // one that grew with the zoom.
      const V = simp.filter((p, i) => i === 0 || Math.hypot(p[0]-simp[i-1][0], p[1]-simp[i-1][1]) >= 1);
      const closed = V.length > 2 && Math.hypot(V[0][0]-V[V.length-1][0], V[0][1]-V[V.length-1][1]) < 1;
      if (closed) V.pop();
      const nV = V.length; if (nV < 2) continue;
      const nrm = i => { const a = V[i], b = V[(i+1)%nV], l = Math.hypot(b[0]-a[0], b[1]-a[1]); return [(b[1]-a[1])/l, -(b[0]-a[0])/l]; };
      const O = V.map((p, i) => {
        const nA = closed || i > 0 ? nrm((i-1+nV)%nV) : null, nB = closed || i < nV-1 ? nrm(i) : null, A = nA || nB, B = nB || nA;
        let mx = A[0]+B[0], my = A[1]+B[1]; const ml = Math.hypot(mx, my);
        if (ml < 1e-6){ mx = A[0]; my = A[1]; } else { mx /= ml; my /= ml; }
        const k = INSET/Math.max(0.35, mx*A[0]+my*A[1]);              // miter length, capped at sharp spikes
        return [p[0]-mx*k, p[1]-my*k];
      });
      const chain = [];
      for (let i=0; i<(closed ? nV : nV-1); i++){
        const j = (i+1)%nV, [x0,y0] = V[i], [x1,y1] = V[j], dx = x1-x0, dy = y1-y0, l = Math.hypot(dx,dy);
        const nx = dy/l, ny = -dx/l, mx = (x0+x1)/2, my = (y0+y1)/2;
        const cs = [col(mx-nx*14, my-ny*14), col(mx-nx*30, my-ny*30)].filter(Boolean);                  // two depths in, past the edge shadow
        let pad = null;
        for (const [k, p] of pads) if (ny < -0.7 && my > p.y-8 && my < p.y+8 && mx > p.x-8 && mx < p.x+p.w+8){ const n = parseInt(PAL[k].slice(1),16); pad = [n>>16, (n>>8)&255, n&255]; }
        chain.push({x0:O[i][0], y0:O[i][1], x1:O[j][0], y1:O[j][1], nx, ny, l, pad, c: cs.length ? cs.reduce((a, v) => [a[0]+v[0]/cs.length, a[1]+v[1]/cs.length, a[2]+v[2]/cs.length], [0,0,0]) : null,
                    bx0:Math.min(x0,x1), by0:Math.min(y0,y1), bx1:Math.max(x0,x1), by1:Math.max(y0,y1)});
      }
      for (let i=0;i<chain.length;i++){                             // length-weighted colour over SMOOTH px either side, so facets do not stripe the wall
        const s = chain[i]; let r = 0, gg = 0, bb = 0, w = 0;
        const acc = j => { const t = chain[j]; if (t.c){ r += t.c[0]*t.l; gg += t.c[1]*t.l; bb += t.c[2]*t.l; w += t.l; } return t.l; };
        for (let j=i, d=0; j>=0 && d<SMOOTH; j--) d += acc(j);
        for (let j=i+1, d=0; j<chain.length && d<SMOOTH; j++) d += acc(j);
        const c = s.pad || (w ? [r/w, gg/w, bb/w] : [110,114,120]), lit = 0.97 + 0.16*(s.nx*-LX + s.ny*-LY);
        s.keys = BK.map(k => { const q = v => Math.min(255, Math.round(v*lit*k/4)*4); return `rgb(${q(c[0])},${q(c[1])},${q(c[2])})`; });
        delete s.c; delete s.pad; delete s.l; segs.push(s);
      }
    }
  }
  // Cull to what the extrusion can reach on screen, skip faces that run into rock, then fill band by band from the back,
  // one path per colour.
  function draw(sx, sy){
    const cx = vw/2, cy = vh/2, mg = 0.14*Math.max(vw, vh)/Z, X0 = cam.x-mg, Y0 = cam.y-mg, X1 = cam.x+vw/Z+mg, Y1 = cam.y+vh/Z+mg, vis = [];
    for (const s of segs){
      if (s.bx1 < X0 || s.bx0 > X1 || s.by1 < Y0 || s.by0 > Y1) continue;
      const ax = (s.x0-cam.x)*Z+sx, ay = (s.y0-cam.y)*Z+sy, bx = (s.x1-cam.x)*Z+sx, by = (s.y1-cam.y)*Z+sy;
      if (s.nx*(cx-(ax+bx)/2) + s.ny*(cy-(ay+by)/2) <= 0) continue;
      const ex = bx-ax, ey = by-ay, el = Math.hypot(ex, ey) || 1, ox = ex/el*0.7, oy = ey/el*0.7;   // overlap neighbours by a hair: no AA seams
      vis.push(s, ax-ox, ay-oy, bx+ox, by+oy);
    }
    for (let band = BANDS-1; band >= 0; band--){
      const fa = FB[band], fb = FB[band+1], paths = new Map();
      for (let i=0;i<vis.length;i+=5){
        const key = vis[i].keys[band], ax = vis[i+1], ay = vis[i+2], bx = vis[i+3], by = vis[i+4];
        let p = paths.get(key); if (!p) paths.set(key, p = new Path2D());
        p.moveTo(cx+(ax-cx)*fa, cy+(ay-cy)*fa); p.lineTo(cx+(bx-cx)*fa, cy+(by-cy)*fa); p.lineTo(cx+(bx-cx)*fb, cy+(by-cy)*fb); p.lineTo(cx+(ax-cx)*fb, cy+(ay-cy)*fb); p.closePath();
      }
      for (const [key, p] of paths){ ctx.fillStyle = key; ctx.fill(p); }
    }
  }
  return {build, draw};
})();

// ---- Themes ----
// Wood mass: for a level cut into a tree rather than into rock. Long vertical grain in flat parallel bands, a knot here
// and there where the fibres part, painted over the whole mass before the terrain bands go on, so only the wall band
// between canopy and ground keeps it. Straight edges only, like everything else.
function woodGrain(x, r, pal, X, Y, W, H){
  const n = Math.max(14, Math.round(W/55));
  for (let i=0;i<n;i++){
    const cx = X+(i+(r()-0.5)*0.9)*W/n, w = 9+r()*34, lean = (r()-0.5)*110, y0 = Y-H*0.1+r()*H*0.55, y1 = y0+H*(0.3+r()*0.75);
    poly(x, [[cx-w/2,y0],[cx+w/2,y0],[cx+w/2+lean,y1],[cx-w/2+lean,y1]]);
    x.fillStyle = r()<0.66 ? `rgba(0,0,0,${(0.09+r()*0.15).toFixed(3)})` : `rgba(255,255,255,${(0.04+r()*0.07).toFixed(3)})`; x.fill();
  }
  for (let i=0, k=Math.max(4, Math.round(W*H/900000)); i<k; i++){     // knots: rings of hard grain round a dark core
    const kx = X+r()*W, ky = Y+r()*H, kr = 28+r()*56, sd = Math.floor(r()*1e6);
    for (let j=3;j>=1;j--){ poly(x, polyPts(kx, ky, kr*j/3, kr*j/3*0.72, 0.24, sd+j)); x.fillStyle = j === 2 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.24)'; x.fill(); }
  }
}
// Jungle terrain: the solid mass is painted in bands before the cave is cut, so room ceilings come out as layered
// canopy, walls as rock face and floors as earth. Band edges are jagged polylines; nothing here is curved either.
function jungleTerrain(x, r, pal, X, Y, W, H){
  const bands = (gy, cy, x0, x1) => {
    const band = (yEdge, amp, step, col, up) => {
      const pts = []; let px = x0;
      while (px < x1){ pts.push([px, yEdge+(r()-0.5)*2*amp]); px += step*(0.6+r()*0.8); }
      pts.push([x1, yEdge+(r()-0.5)*2*amp]);
      const yFar = up ? Y : Y+H; pts.push([x1, yFar], [x0, yFar]);
      poly(x, pts); x.fillStyle = col; x.fill();
    };
    band(gy, 40, 160, pal.earth, false);
    band(gy+150, 30, 230, pal.earthDark, false);
    band(cy+90, 80, 110, pal.leaf[0], true);
    band(cy, 70, 95, pal.leaf[1], true);
    band(cy-100, 60, 85, pal.leaf[2], true);
  };
  if (L.wallMat === 'wood') woodGrain(x, r, pal, X, Y, W, H);   // the mass is a tree: grain first, bands over it
  bands(L.groundY !== undefined ? L.groundY : L.h*0.8, L.canopyY !== undefined ? L.canopyY : L.h*0.3, X, L.plateau ? L.plateau.x0 : X+W);
  // plateau: a second band pair from x0 rightwards, for a high jungle beyond a cliff. The seam should sit inside a rock zone.
  if (L.plateau){ const p = L.plateau; x.fillStyle = massCol(pal); x.fillRect(p.x0, Y, X+W-p.x0, H); if (L.wallMat === 'wood') woodGrain(x, r, pal, p.x0, Y, X+W-p.x0, H); bands(p.groundY, p.canopyY, p.x0, X+W); }
  // rock zones: cave rock painted over the bands, exactly the cave theme's fill. Cut rooms inside read as cave, and game.js
  // crossfades the backdrop to the cave theme's while the rocket is inside one.
  for (const z of L.rockZones||[]){ poly(x, polyPts(z.x, z.y, z.r, z.ry||z.r, z.wob||0.12, z.seed)); x.fillStyle = pal.rock; x.fill(); }
}
const JUNGLE_PAL = { rock:'#8f959d', wood:'#775532', earth:'#b08a58', earthDark:'#8e6b42', bark:'#4b3320', leaf:['#2c5a2a','#3d7c38','#559c47','#74b85a'] };
const THEMES = {
  cave: {
    main:  { pal:{rock:'#8f959d', bark:JUNGLE_PAL.bark, leaf:JUNGLE_PAL.leaf}, amp:0.07, edge:10, pads:true, captureMask:true },   // bark and leaf so a cave level can show a glimpse of jungle
    bg: { top:'#14161e', bottom:'#07080b', f:0.35, mote:'rgba(217,211,199,.16)',   // glows live in level space and parallax at 0.35×
      glows:[ {u:.18,v:.28,r:.5,c:'rgba(48,84,150,.42)'}, {u:.62,v:.62,r:.55,c:'rgba(28,120,122,.32)'}, {u:.42,v:.92,r:.45,c:'rgba(110,64,150,.32)'}, {u:.92,v:.14,r:.42,c:'rgba(160,110,60,.26)'}, {u:.85,v:.85,r:.4,c:'rgba(60,110,170,.28)'} ] },
  },
  jungle: {
    main:  { pal:JUNGLE_PAL, amp:0.07, edge:10, pads:true, captureMask:true },
    bg: { top:'#27391d', bottom:'#150f09', f:0.35, mote:'rgba(225,240,140,.22)',    // green light high up, brown shadow low down
      glows:[ {u:.22,v:.12,r:.5,c:'rgba(140,190,80,.34)'}, {u:.70,v:.10,r:.5,c:'rgba(120,190,90,.26)'}, {u:.5,v:.55,r:.5,c:'rgba(50,100,55,.36)'}, {u:.92,v:.55,r:.45,c:'rgba(35,110,80,.30)'}, {u:.15,v:.88,r:.45,c:'rgba(110,70,38,.46)'}, {u:.8,v:.9,r:.4,c:'rgba(95,62,34,.42)'} ] },
    terrain: jungleTerrain,
  },
};
let STYLE = THEMES.cave;
function applyTheme(){ STYLE = THEMES[L.theme] || THEMES.cave; }
