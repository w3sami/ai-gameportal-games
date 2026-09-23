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
// The pad surface is drawn on the depth layers too (darker as they recede), so when the pad sits far from the
// screen centre the pedestal's top face reads as a receding landing deck rather than a lid over the rocket.
function drawPad(x,p,col,k){
  if (k !== undefined){ x.fillStyle = shade(col,k); x.fillRect(p.x,p.y,p.w,18); return; }
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
// seamlessly. The main layer (q=1) also yields the collision mask, assembled tile by tile. Depth layers reuse the same
// code with a darker palette and a lower q. Returns {w, h, tiles:[{x, y, c}], mask?}.
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
    if (st.pads){ drawPad(x,L.pads.start,PAL.start,st.padK); drawPad(x,L.pads.target,PAL.target,st.padK); }
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
const DEPTH_F = [0.98,0.96,0.94,0.92,0.90,0.88];
const JUNGLE_PAL = { rock:'#8f959d', wood:'#775532', earth:'#b08a58', earthDark:'#8e6b42', bark:'#4b3320', leaf:['#2c5a2a','#3d7c38','#559c47','#74b85a'] };
const THEMES = {
  cave: {
    main:  { pal:{rock:'#8f959d', bark:JUNGLE_PAL.bark, leaf:JUNGLE_PAL.leaf}, amp:0.07, edge:10, pads:true, captureMask:true },   // bark and leaf so a cave level can show a glimpse of jungle
    depth: DEPTH_F.map((f,i) => ({ f, pal:Object.assign({rock:['#7d838b','#727880','#666c74','#5a6068','#4f555d','#454a52'][i]}, shadePal({bark:JUNGLE_PAL.bark, leaf:JUNGLE_PAL.leaf}, 0.87-i*0.075)), amp:0.06, edge:5, edgeAlpha:0.1, pads:true, padK:0.86-i*0.1 })),
    bg: { top:'#14161e', bottom:'#07080b', f:0.35, mote:'rgba(217,211,199,.16)',   // glows live in level space and parallax at 0.35×
      glows:[ {u:.18,v:.28,r:.5,c:'rgba(48,84,150,.42)'}, {u:.62,v:.62,r:.55,c:'rgba(28,120,122,.32)'}, {u:.42,v:.92,r:.45,c:'rgba(110,64,150,.32)'}, {u:.92,v:.14,r:.42,c:'rgba(160,110,60,.26)'}, {u:.85,v:.85,r:.4,c:'rgba(60,110,170,.28)'} ] },
  },
  jungle: {
    main:  { pal:JUNGLE_PAL, amp:0.07, edge:10, pads:true, captureMask:true },
    depth: DEPTH_F.map((f,i) => ({ f, pal:shadePal(JUNGLE_PAL, 0.87-i*0.075), amp:0.06, edge:5, edgeAlpha:0.1, pads:true, padK:0.86-i*0.1 })),
    bg: { top:'#27391d', bottom:'#150f09', f:0.35, mote:'rgba(225,240,140,.22)',    // green light high up, brown shadow low down
      glows:[ {u:.22,v:.12,r:.5,c:'rgba(140,190,80,.34)'}, {u:.70,v:.10,r:.5,c:'rgba(120,190,90,.26)'}, {u:.5,v:.55,r:.5,c:'rgba(50,100,55,.36)'}, {u:.92,v:.55,r:.45,c:'rgba(35,110,80,.30)'}, {u:.15,v:.88,r:.45,c:'rgba(110,70,38,.46)'}, {u:.8,v:.9,r:.4,c:'rgba(95,62,34,.42)'} ] },
    terrain: jungleTerrain,
  },
};
let STYLE = THEMES.cave;
function applyTheme(){ STYLE = THEMES[L.theme] || THEMES.cave; }
