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
// The pad surface is drawn on the depth layers too (darker as they recede), so when the pad sits far from the
// screen centre the pedestal's top face reads as a receding landing deck rather than a lid over the rocket.
function drawPad(x,p,col,k){
  if (k !== undefined){ x.fillStyle = shade(col,k); x.fillRect(p.x,p.y,p.w,18); return; }
  x.fillStyle = '#4a4f57'; x.fillRect(p.x-6,p.y,p.w+12,12);
  x.fillStyle = col; x.fillRect(p.x,p.y,p.w,6);
  x.fillStyle = 'rgba(255,255,255,.45)'; for (let i=0;i<5;i++) x.fillRect(p.x+8+i*(p.w-16)/4-2, p.y+8, 4, 2);
}

// One rendering of the level at canvas scale q: flat rock with facets, cave cut out, solids put back.
// The main layer (q=1) also yields the collision mask. Depth layers reuse it with darker rock and a lower q.
function renderLayer(q, st, padX, padY){
  const W = Math.ceil((L.w+2*padX)*q), H = Math.ceil((L.h+2*padY)*q), c = mkCanvas(W,H), x = c.getContext('2d'), r = rng(L.rooms[0].seed*31+7);
  x.fillStyle = st.rock; x.fillRect(0,0,W,H);
  x.translate(padX*q, padY*q); x.scale(q,q);
  facets(x, r, -400, -400, L.w+800, L.h+800, Math.round(L.w*L.h/60000), 260, 800, st.amp);
  const angular = (ctx) => { ctx.lineJoin = 'miter'; ctx.lineCap = 'square'; ctx.miterLimit = 4; };
  const caveShapes = (fill) => {
    x.fillStyle = fill; x.strokeStyle = fill; angular(x);
    for (const pts of G.caves){ poly(x,pts); x.fill(); }
    for (const p of G.clear) x.fillRect(p[0], p[1], p[2], p[3]);
  };
  x.globalCompositeOperation = 'destination-out'; caveShapes('#000');
  // solids (pillars, walls, pad blocks) on a scratch canvas, composited behind the rock so overlaps never show
  const tc = mkCanvas(W,H), t = tc.getContext('2d'); t.translate(padX*q, padY*q); t.scale(q,q);
  const solidPath = (ctx) => { ctx.beginPath();
    for (const rk of G.rocks){ ctx.moveTo(rk.pts[0][0],rk.pts[0][1]); for (let i=1;i<rk.pts.length;i++) ctx.lineTo(rk.pts[i][0],rk.pts[i][1]); ctx.closePath(); }
    for (const b of G.blocks) ctx.rect(b[0],b[1],b[2],b[3]);
    for (const w of L.walls){ const cx = w.x+w.w/2, cy = w.y+w.h/2, ca = Math.cos(w.a||0), sa = Math.sin(w.a||0); const P = (dx,dy) => [cx+dx*ca-dy*sa, cy+dx*sa+dy*ca]; const v = [P(-w.w/2,-w.h/2),P(w.w/2,-w.h/2),P(w.w/2,w.h/2),P(-w.w/2,w.h/2)]; ctx.moveTo(v[0][0],v[0][1]); for (let i=1;i<4;i++) ctx.lineTo(v[i][0],v[i][1]); ctx.closePath(); } };
  solidPath(t); t.fillStyle = st.rock; t.fill();
  t.save(); solidPath(t); t.clip(); facets(t, r, -400, -400, L.w+800, L.h+800, Math.round(L.w*L.h/45000), 60, 240, st.amp); t.restore();
  t.globalCompositeOperation = 'source-atop'; t.strokeStyle = `rgba(0,0,0,${st.edgeAlpha||0.14})`; angular(t); t.lineWidth = st.edge||10; solidPath(t); t.stroke();
  x.globalCompositeOperation = 'destination-over'; x.save(); x.setTransform(1,0,0,1,0,0); x.drawImage(tc,0,0); x.restore();
  // a faint shadow band just inside every edge, so the outline reads without a drawn line
  x.globalCompositeOperation = 'source-atop';
  x.strokeStyle = `rgba(0,0,0,${st.edgeAlpha||0.14})`; angular(x);
  const edgeW = st.edge || 10;
  x.lineWidth = edgeW; for (const pts of G.caves){ poly(x,pts); x.stroke(); }
  for (const p of G.clear) x.strokeRect(p[0],p[1],p[2],p[3]);
  x.globalCompositeOperation = 'source-over';
  if (st.captureMask) c.maskAlpha = x.getImageData(0,0,W,H).data;
  if (st.pads){ drawPad(x,L.pads.start,PAL.start,st.padK); drawPad(x,L.pads.target,PAL.target,st.padK); }
  return c;
}
const STYLE = {
  main:  { rock:'#8f959d', amp:0.07, edge:10, pads:true, captureMask:true },
  depth: [0.98,0.96,0.94,0.92,0.90,0.88].map((f,i) => ({ f, rock:['#7d838b','#727880','#666c74','#5a6068','#4f555d','#454a52'][i], amp:0.06, edge:5, edgeAlpha:0.1, pads:true, padK:0.86-i*0.1 })),
  bg: { top:'#14161e', bottom:'#07080b', f:0.35,   // glows live in level space and parallax at 0.35×
    glows:[ {u:.18,v:.28,r:.5,c:'rgba(48,84,150,.42)'}, {u:.62,v:.62,r:.55,c:'rgba(28,120,122,.32)'}, {u:.42,v:.92,r:.45,c:'rgba(110,64,150,.32)'}, {u:.92,v:.14,r:.42,c:'rgba(160,110,60,.26)'}, {u:.85,v:.85,r:.4,c:'rgba(60,110,170,.28)'} ] },
};
