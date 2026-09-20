'use strict';
// Thruster: flight model, input, menus, audio, progression.
const DT = 1/120, DEG = Math.PI/180;
const P = { gravity:220, thrust:540, turnRate:210 };          // flight model, fixed for the shipped game
const HULL = [[0,-14],[-9,10],[9,10],[0,11]];                 // nose, fins, tail: the points tested against the mask

// ---- Storage ----
const SKEY = 'thruster-v1';
const SDEF = { radius:64, dead:0.2, expo:1.3, buttons:0, sound:1 };
let store = { bests:{}, level:0, unlocked:0, settings:{...SDEF} };
try { const s = localStorage.getItem(SKEY); if (s){ const o = JSON.parse(s); store = Object.assign(store, o); store.settings = Object.assign({...SDEF}, o.settings||{}); } } catch (e) {}
const S = store.settings;
delete S.relative;                                            // retired: steering is always relative to the rocket
function save(){ try { localStorage.setItem(SKEY, JSON.stringify(store)); } catch (e) {} }
let li = 0;


// ---- Canvas, layers, collision mask ----
const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
let vw = 1, vh = 1, dpr = 1, Z = 1, layers = [], mainC = null, mask = null, motes = [];
function buildMain(){
  mainC = renderLayer(1, STYLE.main, 0, 0);            // tiled; see art.js
  mask = mainC.mask; mainC.mask = null;
}
function isSolid(x,y){ if (x<0||y<0||x>=L.w||y>=L.h) return true; return mask[(y|0)*L.w+(x|0)] === 1; }
function buildLayers(){
  layers = STYLE.depth.map(st => {
    const f = st.f, q = f*0.5, padX = Math.ceil(vw*(1-f)/(2*f*Z))+40, padY = Math.ceil(vh*(1-f)/(2*f*Z))+40;
    return {f, q, padX, padY, c:renderLayer(q, st, padX, padY)};
  }).reverse();
  const r = rng(L.rooms[0].seed*13+1); motes = [];
  for (let i=0;i<L.w*L.h/50000;i++) motes.push({x:r()*L.w, y:r()*L.h, s:1+r()*1.6, v:4+r()*8});
}
function resize(){
  vw = innerWidth; vh = innerHeight; dpr = Math.min(devicePixelRatio||1, 2);
  cv.width = Math.round(vw*dpr); cv.height = Math.round(vh*dpr); cv.style.width = vw+'px'; cv.style.height = vh+'px';
  Z = Math.max(Math.min(Math.max(vw/1000, 0.6), 1.15), vw/L.w, vh/L.h);
  buildLayers(); placeControls();
}
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 120); });

// ---- Full screen ----
const fsAvail = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const fsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function toggleFS(){
  const d = document, e = d.documentElement;
  try {
    const r = fsOn() ? (d.exitFullscreen || d.webkitExitFullscreen).call(d)
                     : (e.requestFullscreen || e.webkitRequestFullscreen).call(e);
    if (r && r.catch) r.catch(() => {});
  } catch (err) {}
}
function onFsChange(){
  resize();
  if (mode === 'menu') showMenu(); else if (mode === 'paused') showPause();
}
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

// ---- Audio: everything synthesised, no files ----
const Snd = (() => {
  let ac = null, noise = null, thrGain = null, thrFilt = null, wetGain = null;
  function init(){
    if (ac) return;
    try { ac = new (window.AudioContext||window.webkitAudioContext)(); } catch (e) { return; }
    const n = ac.sampleRate*2; noise = ac.createBuffer(1, n, ac.sampleRate); const d = noise.getChannelData(0); let last = 0;
    for (let i=0;i<n;i++){ const w = Math.random()*2-1; last = (last+0.02*w)/1.02; d[i] = last*3.5; }   // brown noise
    const src = ac.createBufferSource(); src.buffer = noise; src.loop = true;
    thrFilt = ac.createBiquadFilter(); thrFilt.type = 'lowpass'; thrFilt.frequency.value = 500;
    thrGain = ac.createGain(); thrGain.gain.value = 0;
    src.connect(thrFilt).connect(thrGain).connect(ac.destination); src.start();
    const ws = ac.createBufferSource(); ws.buffer = noise; ws.loop = true;                          // waterfall hush: the same noise, brighter
    const wf = ac.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 1400; wf.Q.value = 0.5;
    wetGain = ac.createGain(); wetGain.gain.value = 0; ws.connect(wf).connect(wetGain).connect(ac.destination); ws.start();
  }
  function resume(){ if (ac && ac.state === 'suspended') ac.resume(); }
  function water(on){ if (!ac) return; wetGain.gain.setTargetAtTime((on && S.sound) ? 0.5 : 0, ac.currentTime, on ? 0.05 : 0.2); }
  function thrust(on){ if (!ac) return; const g = (on && S.sound) ? 0.45 : 0; thrGain.gain.setTargetAtTime(g, ac.currentTime, on ? 0.04 : 0.1); thrFilt.frequency.setTargetAtTime(on ? 900 : 400, ac.currentTime, 0.1); }
  function burst(dur, f0, f1, vol){
    if (!ac || !S.sound) return; const t = ac.currentTime, src = ac.createBufferSource(); src.buffer = noise;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t+dur);
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t+dur);
    src.connect(f).connect(g).connect(ac.destination); src.start(t, Math.random()); src.stop(t+dur);
  }
  function tone(freq, dur, vol, type, when){
    if (!ac || !S.sound) return; const t = ac.currentTime+(when||0), o = ac.createOscillator(), g = ac.createGain();
    o.type = type||'sine'; o.frequency.setValueAtTime(freq, t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t+0.02); g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t+dur+0.05);
  }
  return {
    init, resume, thrust, water,
    explode(){ burst(1.1, 2600, 90, 1.2); tone(70, 0.5, 0.6, 'sine'); },
    land(sp){ const v = Math.min(0.7, 0.15+sp/500); burst(0.18, 700, 120, v); tone(55, 0.25, v*0.8, 'sine'); },
    finish(){ tone(523, 0.18, 0.25, 'triangle'); tone(784, 0.22, 0.25, 'triangle', 0.14); tone(1046, 0.4, 0.22, 'triangle', 0.28); },
    click(){ tone(660, 0.06, 0.08, 'square'); },
    crack(){ burst(0.28, 3200, 700, 0.35); },
    thud(){ burst(0.3, 520, 80, 0.8); tone(58, 0.25, 0.5, 'sine'); },
  };
})();

// ---- Game state ----
let ship, ghost = null, best = null, particles = [], ticks = 0, gTick = 0, running = false, inputs = [], deadT = 0, shake = 0, doneT = 0;
let mode = 'menu', wet = false, caveK = 0;                   // menu | play | paused | complete; wet: rocket inside a waterfall; caveK: 0 jungle → 1 cave backdrop
const cam = {x:0,y:0};
const keys = {thrust:false,left:false,right:false};
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const normAng = a => { a = (a+Math.PI) % (2*Math.PI); if (a<0) a += 2*Math.PI; return a-Math.PI; };
const fmt = t => { const s = t/120, m = Math.floor(s/60); return `${m}:${(s-m*60).toFixed(2).padStart(5,'0')}`; };

function spawn(){ const p = L.pads.start; return {x:p.x+p.w/2, y:p.y-11, vx:0, vy:0, a:0, state:'idle', flame:0}; }
function reset(){
  ship = spawn(); best = store.bests[li] || null; ghost = best ? spawn() : null;
  ticks = 0; gTick = 0; running = false; inputs = []; particles.length = 0; deadT = 0; doneT = 0; wet = false; setMsg('',''); hazardReset();
  cam.x = ship.x - vw/(2*Z); cam.y = ship.y - vh/(2*Z);
  hud();
}
function loadLevel(i){
  li = Math.max(0, Math.min(LEVELS.length-1, i)); L = LEVELS[li]; store.level = li; menuCh = chapterOf(li); save();
  setGeom(); applyTheme(); buildMain(); buildHazards(); resize(); reset();
}

// ---- Forces: regions that push the rocket (waterfalls, wind, vents, magnets). Level data `forces`:
//   rect   {kind, x,y,w,h, ax,ay, drag?}       constant acceleration inside, optional velocity drag per second
//   circle {kind, cx,cy,r, strength}           radial, linear falloff to the edge; positive pulls in, negative pushes out
//   either may add {period, duty, phase} in seconds to cycle on and off. Timing runs on sim ticks, so replays stay exact.
//   water adds {pool:{x,w,h}} for the pool it lands in. kind ∈ water | wind | gas, which only changes how it is drawn.
const forceOn = (f, tick) => !f.period || (((tick*DT + (f.phase||0)) % f.period) / f.period) < (f.duty === undefined ? 1 : f.duty);
const inRect = (f, x, y) => x >= f.x && x <= f.x+f.w && y >= f.y && y <= f.y+f.h;
function applyForces(s, tick){
  for (const f of L.forces||[]){
    if (!forceOn(f, tick)) continue;
    if (f.r !== undefined){
      const dx = f.cx-s.x, dy = f.cy-s.y, d = Math.hypot(dx,dy); if (d > f.r || d < 1) continue;
      const a = (f.strength||0)*(1-d/f.r)/d; s.vx += dx*a*DT; s.vy += dy*a*DT;
    } else if (inRect(f, s.x, s.y)){
      s.vx += (f.ax||0)*DT; s.vy += (f.ay||0)*DT;
      if (f.drag){ const k = Math.exp(-f.drag*DT); s.vx *= k; s.vy *= k; }
    }
  }
}
const inWater = s => (L.forces||[]).some(f => f.kind === 'water' && f.r === undefined && inRect(f, s.x, s.y));

// One physics tick. Deterministic: same inputs → same run, which is what makes the ghost replay possible.
function stepShip(s, inp, tick){
  if (s.state === 'idle' || s.state === 'landed'){ if (!inp.thrust) return null; s.state = 'flying'; }
  if (s.state !== 'flying') return null;
  s.a = normAng(s.a + inp.steer*P.turnRate*DEG*DT);
  const th = inp.thrust ? P.thrust : 0;
  s.vx += Math.sin(s.a)*th*DT;
  s.vy += (-Math.cos(s.a)*th + P.gravity)*DT;
  applyForces(s, tick);
  s.flame = inp.thrust ? 1 : 0;
  const sp = Math.hypot(s.vx,s.vy), n = Math.ceil(sp*DT/2) || 1;    // substep so nothing tunnels through a wall
  for (let i=0;i<n;i++){ s.x += s.vx*DT/n; s.y += s.vy*DT/n; const hit = collide(s); if (hit) return hit; }
  return null;
}
function collide(s){
  const c = Math.cos(s.a), sn = Math.sin(s.a);
  for (let i=0;i<HULL.length;i++){
    const [lx,ly] = HULL[i], px = s.x+lx*c-ly*sn, py = s.y+lx*sn+ly*c;
    let onPad = false;
    for (const z of ZONES){
      if (px>=z.x && px<=z.x+z.w && py>=z.y-1 && py<=z.y+10){
        if (s.vy < 0){ onPad = true; break; }                   // rising off the pad: a fin dipping into the pad top while turning is not a crash
        return {type:'land', key:z.key, z, px, py, sp:Math.hypot(s.vx,s.vy)};
      }
    }
    if (!onPad && isSolid(px,py)) return {type:'crash', px, py};
  }
  return null;
}
function settle(s, z){ s.state = 'landed'; s.vx = s.vy = 0; s.a = 0; s.y = z.y-11; s.flame = 0; }
const encode = i => i.thrust | (Math.round(i.steer*15)+15) << 1;
const decode = c => ({thrust:c&1, steer:((c>>1)-15)/15});

function tick(){
  const inp = readInput();
  if (ship.state === 'dead'){ deadT -= DT; if (deadT <= 0) reset(); }
  else if (ship.state === 'finished'){ doneT -= DT; if (doneT <= 0 && mode === 'play') showComplete(); }
  else {
    if (!running && ship.state === 'idle' && inp.thrust) running = true;
    if (running){
      ticks++; inputs.push(encode(inp));
      const hit = stepShip(ship, inp, ticks-1);
      if (hit){
        if (hit.type === 'land'){
          if (hit.sp > 120) puff(hit.px, hit.py, hit.sp); Snd.land(hit.sp); settle(ship, hit.z);
          if (hit.key === 'target'){ ship.state = 'finished'; doneT = 1.3; celebrate(hit.px, hit.py); shake = 0.5; finish(); }
        } else { ship.state = 'dead'; deadT = 1.4; explode(hit.px, hit.py); shake = 1; Snd.explode(); setMsg('Crashed', ''); }
      } else if (ship.state !== 'finished'){
        const hz = updateHazards(ship);
        if (hz){ ship.state = 'dead'; deadT = 1.4; explode(hz.px, hz.py); shake = 1; Snd.explode(); setMsg('Crashed', hz.kind === 'branch' ? 'Branch' : 'Stalactite'); }
      }
      if (ship.state === 'flying' && ship.flame) emitThrust(ship);
      wet = ship.state === 'flying' && inWater(ship);
      if (wet && ticks % 3 === 0) spray(ship);
      froth();
    }
  }
  if (ghost && running && ghost.state !== 'dead'){
    const code = best.inputs[gTick++];
    if (code !== undefined){ const gh = stepShip(ghost, decode(code), gTick-1); if (gh){ if (gh.type === 'land') settle(ghost, gh.z); else ghost.state = 'dead'; } }
  }
  updateParticles();
}
let lastResult = null;
function finish(){
  const prev = store.bests[li], isBest = !prev || ticks < prev.ticks;
  if (isBest) store.bests[li] = {ticks, inputs:inputs.slice()};
  if (li >= store.unlocked) store.unlocked = Math.min(LEVELS.length-1, li+1);
  save(); Snd.finish();
  lastResult = {ticks, prev: prev ? prev.ticks : null, isBest};
}

// ---- Hazards: stalactites (or, in the jungle, branches) that shake loose when the rocket comes near, then drop ----
// Driven only by the real rocket's position at fixed DT, so a run stays deterministic and the ghost replay still holds.
const HZ = { trigger:200, branchTrigger:360, wiggle:0.5, gravity:1.5 };   // branches wake from farther off: the jungle is open
let hazards = [];
function buildHazards(){
  hazards = (L.hazards||[]).map(h => {
    const pts = h.kind === 'branch' ? branchPts(h) : spikePts(h), tip = pts.reduce((b,p) => Math.hypot(p[0]-h.tx,p[1]-h.ty) < Math.hypot(b[0]-h.tx,b[1]-h.ty) ? p : b);
    const probe = [tip].concat(pts.filter(p => p !== tip && !isSolid(p[0],p[1])));   // landing is judged by the part that hangs in the open
    const sprite = renderSpikeSprite(pts, h.seed, h.kind, {ax:h.x, ay:h.y, bx:h.tx, by:h.ty, w:h.w, taper:h.kind === 'branch' ? 0.35 : 0.85});
    return {h, pts, probe, sprite, col: h.kind === 'branch' ? '120,86,52' : null, state:'hang', t:0, a:0, dy:0, vy:0};
  });
}
function hazardReset(){ for (const z of hazards){ z.state = 'hang'; z.t = 0; z.a = 0; z.dy = 0; z.vy = 0; } }
const posePts = (z, pts) => { const h = z.h, c = Math.cos(z.a), s = Math.sin(z.a); return pts.map(p => { const dx = p[0]-h.x, dy = p[1]-h.y; return [h.x+dx*c-dy*s, h.y+dx*s+dy*c+z.dy]; }); };
function pip(px,py,pts){ let inside = false; for (let i=0,j=pts.length-1;i<pts.length;j=i++){ const [xi,yi] = pts[i], [xj,yj] = pts[j]; if ((yi>py) !== (yj>py) && px < (xj-xi)*(py-yi)/(yj-yi)+xi) inside = !inside; } return inside; }
function updateHazards(s){
  for (const z of hazards){
    if (z.state === 'gone') continue;
    const h = z.h;
    if (z.state === 'hang'){                                   // distance from the rocket to the spike's axis
      const ax = h.tx-h.x, ay = h.ty-h.y, t = Math.max(0, Math.min(1, ((s.x-h.x)*ax+(s.y-h.y)*ay)/(ax*ax+ay*ay)));
      if (Math.hypot(s.x-(h.x+ax*t), s.y-(h.y+ay*t)) < (h.trigger || (h.kind === 'branch' ? HZ.branchTrigger : HZ.trigger))){ z.state = 'wiggle'; z.t = 0; Snd.crack(); }
    } else if (z.state === 'wiggle'){
      z.t += DT; const k = Math.min(1, z.t/HZ.wiggle); z.a = Math.sin(z.t*38)*0.07*k;
      if (Math.round(z.t*120) % 10 === 0) crumbs(h.x+(h.tx-h.x)*0.65, h.y+(h.ty-h.y)*0.65, 2, z.col);
      if (z.t >= HZ.wiggle){ z.state = 'fall'; z.vy = 0; crumbs(h.x+(h.tx-h.x)*0.6, h.y+(h.ty-h.y)*0.6, 8, z.col); }
    } else {
      z.vy += P.gravity*HZ.gravity*DT; z.dy += z.vy*DT;
      if (z.dy > 12 && posePts(z, z.probe).some(p => isSolid(p[0],p[1]))){ z.state = 'gone'; shatter(h.tx, h.ty+z.dy, z.vy, z.col); Snd.thud(); continue; }
    }
    const pts = posePts(z, z.pts), c = Math.cos(s.a), sn = Math.sin(s.a);    // hull points inside the spike, or spike vertices inside the rocket
    for (const [lx,ly] of HULL){ const px = s.x+lx*c-ly*sn, py = s.y+lx*sn+ly*c; if (pip(px,py,pts)) return {px,py,kind:h.kind}; }
    for (const p of pts){ if (Math.hypot(p[0]-s.x, p[1]-s.y) < 9) return {px:p[0], py:p[1], kind:h.kind}; }
  }
  return null;
}

// ---- Particles ----
function emitThrust(s){
  const dx = -Math.sin(s.a), dy = Math.cos(s.a), ox = s.x+dx*11, oy = s.y+dy*11;
  for (let i=0;i<2;i++){ const sp = 160+Math.random()*180, j = (Math.random()-0.5)*70;
    particles.push({x:ox,y:oy,vx:dx*sp+dy*j+s.vx*0.5,vy:dy*sp-dx*j+s.vy*0.5,life:0.22+Math.random()*0.18,max:0.4,sz:2.5+Math.random()*2,kind:0}); }
}
function explode(px,py){
  for (let i=0;i<50;i++){ const a = Math.random()*6.283, sp = 60+Math.random()*260; particles.push({x:px,y:py,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-80,life:0.8+Math.random()*1.2,max:2,sz:1.5+Math.random()*3,kind:1}); }
  for (let i=0;i<40;i++){ const a = Math.random()*6.283, sp = 120+Math.random()*420; particles.push({x:px,y:py,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:0.3+Math.random()*0.5,max:0.8,sz:2+Math.random()*3,kind:0}); }
  particles.push({x:px,y:py,vx:0,vy:0,life:0.45,max:0.45,sz:0,kind:2});
}
function celebrate(px,py){
  const cols = ['#5ad46e','#b8f5c2','#ffffff','#e3a23c'];
  for (let i=0;i<140;i++){ const a = -Math.PI*(0.1+0.8*Math.random()), sp = 180+Math.random()*420;
    particles.push({x:px+(Math.random()-0.5)*40,y:py,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1.0+Math.random()*1.4,max:2.4,sz:2.5+Math.random()*3.5,kind:3,col:cols[i%4]}); }
  for (let i=0;i<3;i++) particles.push({x:px,y:py,vx:0,vy:0,life:0.7+i*0.2,max:0.7+i*0.2,sz:160+i*90,kind:2,col:'rgba(120,235,150,'});
}
function crumbs(px,py,n,col){
  for (let i=0;i<n;i++) particles.push({x:px+(Math.random()-0.5)*24,y:py,vx:(Math.random()-0.5)*30,vy:20+Math.random()*50,life:0.4+Math.random()*0.4,max:0.8,sz:1.5+Math.random()*2,kind:1,col});
}
function shatter(px,py,v,col){
  for (let i=0;i<26;i++){ const a = -Math.PI*Math.random(), sp = 60+Math.random()*Math.min(420, v*0.7); particles.push({x:px+(Math.random()-0.5)*20,y:py,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:0.5+Math.random()*0.7,max:1.2,sz:2+Math.random()*4,kind:1,col}); }
}
function spray(s){
  const a = Math.random()*6.283, v = 40+Math.random()*120;
  particles.push({x:s.x+(Math.random()-0.5)*16,y:s.y+(Math.random()-0.5)*16,vx:Math.cos(a)*v+s.vx*0.3,vy:Math.sin(a)*v-40,life:0.3+Math.random()*0.3,max:0.6,sz:1.5+Math.random()*2,kind:1,col:'200,228,255'});
}
function froth(){                                                                                   // droplets thrown up where each visible waterfall meets its pool
  for (const f of L.forces||[]){ if (f.kind !== 'water' || f.r !== undefined || !f.pool) continue;
    if (f.x+f.w < cam.x-100 || f.x > cam.x+vw/Z+100 || f.y+f.h < cam.y-100 || f.y+f.h-200 > cam.y+vh/Z) continue;
    for (let k=0;k<2;k++){ const px = f.x-30+Math.random()*(f.w+60), py = f.y+f.h-f.pool.h-2, v = 140+Math.random()*260;
      particles.push({x:px,y:py,vx:(Math.random()-0.5)*220,vy:-v,life:0.4+Math.random()*0.5,max:0.9,sz:3+Math.random()*3.5,kind:1,col:'235,246,255'}); }
  }
}
function puff(px,py,sp){
  for (let i=0;i<Math.min(40, sp/12);i++){ const a = -Math.PI*Math.random(), v = 40+Math.random()*sp*0.5; particles.push({x:px,y:py,vx:Math.cos(a)*v,vy:Math.sin(a)*v*0.4,life:0.3+Math.random()*0.4,max:0.7,sz:2+Math.random()*3,kind:1}); }
}
function updateParticles(){
  for (let i=particles.length-1;i>=0;i--){ const p = particles[i]; p.life -= DT;
    if (p.kind === 1){ p.vy += P.gravity*0.6*DT; p.x += p.vx*DT; p.y += p.vy*DT; if (isSolid(p.x,p.y)) p.life = 0; }
    else if (p.kind === 3){ p.vy += P.gravity*0.9*DT; p.vx *= 0.995; p.x += p.vx*DT; p.y += p.vy*DT; if (isSolid(p.x,p.y)){ p.vy *= -0.45; p.vx *= 0.6; p.y -= p.vy*DT*2; if (Math.abs(p.vy) < 20) p.life = Math.min(p.life, 0.3); } }
    else if (p.kind === 0){ p.vx *= 0.97; p.vy *= 0.97; p.x += p.vx*DT; p.y += p.vy*DT; }
    if (p.life <= 0) particles.splice(i,1);
  }
}

// ---- Rendering ----
function drawShip(s, isGhost){
  ctx.save(); ctx.translate(s.x,s.y); ctx.rotate(s.a);
  if (isGhost) ctx.globalAlpha = 0.45;
  if (s.flame){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const len = (isGhost?10:16)+Math.random()*12;
    ctx.fillStyle = isGhost ? 'rgba(140,170,255,.6)' : 'rgba(255,140,50,.85)';
    ctx.beginPath(); ctx.moveTo(-5,10); ctx.lineTo(0,10+len); ctx.lineTo(5,10); ctx.closePath(); ctx.fill();
    if (!isGhost){ ctx.fillStyle = 'rgba(255,240,200,.9)'; ctx.beginPath(); ctx.moveTo(-2.5,10); ctx.lineTo(0,10+len*.55); ctx.lineTo(2.5,10); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
  ctx.fillStyle = isGhost ? PAL.ghost : PAL.hull;
  ctx.beginPath(); ctx.moveTo(0,-14); ctx.lineTo(7,4); ctx.lineTo(9,10); ctx.lineTo(3,9); ctx.lineTo(0,11); ctx.lineTo(-3,9); ctx.lineTo(-9,10); ctx.lineTo(-7,4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = isGhost ? 'rgba(255,255,255,.3)' : PAL.hullDark;
  ctx.beginPath(); ctx.moveTo(7,4); ctx.lineTo(9,10); ctx.lineTo(3,9); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-7,4); ctx.lineTo(-9,10); ctx.lineTo(-3,9); ctx.closePath(); ctx.fill();
  if (!isGhost){ ctx.fillStyle = PAL.glass; ctx.beginPath(); ctx.arc(0,-3,2.6,0,6.283); ctx.fill(); }
  ctx.restore();
}
function drawParticles(){
  for (const p of particles){ const t = Math.max(0, p.life/p.max);
    if (p.kind === 0){ ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `hsla(${20+40*t},100%,${55+35*t}%,${t})`; ctx.beginPath(); ctx.arc(p.x,p.y,p.sz*t+0.5,0,6.283); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; }
    else if (p.kind === 1){ ctx.fillStyle = `rgba(${p.col||'236,230,218'},${t*0.9})`; ctx.fillRect(p.x-p.sz/2,p.y-p.sz/2,p.sz,p.sz); }
    else if (p.kind === 3){ ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, t*1.5); ctx.fillStyle = p.col; ctx.fillRect(p.x-p.sz/2,p.y-p.sz/2,p.sz,p.sz*0.6); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    else { ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = (p.col||'rgba(255,190,120,')+t+')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x,p.y,(1-t)*(p.sz||110),0,6.283); ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; }
  }
}

const CAVE_IN = { top:'#0a0b10', bottom:'#030305' };
const inRockZone = (x, y) => (L.rockZones||[]).some(z => { const dx = (x-z.x)/z.r, dy = (y-z.y)/(z.ry||z.r); return dx*dx+dy*dy <= 1; });
const mixHex = (a, b, k) => { const A = parseInt(a.slice(1),16), B = parseInt(b.slice(1),16), ch = sh => Math.round(((A>>sh)&255)*(1-k)+((B>>sh)&255)*k); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; };

// Force fields. Pools go under the terrain (so the floor clips them), the curtains over the rocket (a waterfall half-hides what is inside it). Animation is
// visual only and runs on wall time; the force itself runs on sim ticks. Everything drawn is a rect, in keeping with the level art.
function drawForces(t, over){
  const vx0 = cam.x-100, vy0 = cam.y-100, vx1 = cam.x+vw/Z+100, vy1 = cam.y+vh/Z+100;
  for (const f of L.forces||[]){
    if (f.r !== undefined){ if (over) drawRadial(f, t); continue; }
    if (f.x > vx1 || f.x+f.w < vx0 || f.y > vy1 || f.y+f.h < vy0) continue;
    if (f.kind === 'water'){
      if (!over){ if (f.pool){ const p = f.pool, py = f.y+f.h-p.h; ctx.fillStyle = 'rgba(70,130,210,.6)'; ctx.fillRect(p.x, py, p.w, p.h);
        ctx.fillStyle = 'rgba(210,235,255,.45)'; for (let i=0;i<5;i++){ const rx = p.x + ((t*70 + i*p.w/5) % p.w); ctx.fillRect(rx, py+2, Math.min(22, p.x+p.w-rx), 2); }
        for (let i=0;i<16;i++){ const hx = ((i*7919)%89)/89, hy = ((i*104729)%67)/67, ph = (t*(1.2+hy) + hx*7) % 1, fw = 24+hy*40, fx = f.x+f.w/2+(hx-0.5)*(f.w+150)-fw/2, fh = 8+12*Math.sin(ph*3.1416);   // froth: white slabs heaving on the surface
          ctx.fillStyle = `rgba(240,248,255,${0.4+0.5*Math.sin(ph*3.1416)})`; ctx.fillRect(fx, py-fh*0.7, fw, fh); } } continue; }
      ctx.fillStyle = 'rgba(110,165,235,.26)'; ctx.fillRect(f.x, f.y, f.w, f.h);
      const n = Math.floor(f.w/9);                                                                   // strands of varying weight, each with highlights rolling down every ~220 px
      for (let i=0;i<n;i++){ const hx = ((i*7919)%97)/97, cx = f.x+4.5+i*9, sw = 3+hx*5;
        ctx.fillStyle = `rgba(150,200,250,${0.10+hx*0.16})`; ctx.fillRect(cx-sw/2, f.y, sw, f.h);
        const len = 50+hx*90, step = 220+hx*80; ctx.fillStyle = `rgba(225,242,255,${0.28+hx*0.2})`;
        for (let yy = ((t*(800+hx*250) + hx*step) % step) - len; yy < f.h; yy += step){ const y0 = Math.max(f.y, f.y+yy), y1 = Math.min(f.y+f.h, f.y+yy+len); if (y1 > y0) ctx.fillRect(cx-1.5, y0, 3, y1-y0); } }
      ctx.fillStyle = 'rgba(235,245,255,.4)'; ctx.fillRect(f.x-6, f.y, f.w+12, 10);                    // the lip
      for (let i=0;i<10;i++){ const ph = (t*0.7 + i*0.1) % 1, mx = f.x+f.w/2+(i-4.5)*(f.w+80)*0.11, my = f.y+f.h-40-ph*110, ms = 44*(1-ph)+10;   // mist billowing up from the foot
        ctx.fillStyle = `rgba(225,240,255,${0.32*(1-ph)})`; ctx.fillRect(mx-ms/2, my-ms*0.3, ms, ms*0.6); }
    } else if (over){                                                                                   // wind, gas: streaks along the push, faint when off
      const on = forceOn(f, ticks), len = Math.hypot(f.ax||0, f.ay||0) || 1, ux = (f.ax||0)/len, uy = (f.ay||0)/len, span = Math.abs(ux)*f.w + Math.abs(uy)*f.h;
      ctx.strokeStyle = f.kind === 'gas' ? `rgba(170,225,130,${on?.4:.08})` : `rgba(225,232,240,${on?.35:.07})`; ctx.lineWidth = 2; ctx.beginPath();
      const n = Math.floor(f.w*f.h/9000);
      for (let i=0;i<n;i++){ const hx = ((i*7919)%1000)/1000, hy = ((i*104729)%1000)/1000, d = ((t*(on?420:60) + hx*span*3) % span), sl = 30+hy*40;
        let px = f.x + (ux < 0 ? f.w : 0) + (uy !== 0 ? hx*f.w : 0) + ux*d, py = f.y + (uy < 0 ? f.h : 0) + (ux !== 0 ? hy*f.h : 0) + uy*d;
        if (!inRect(f, px, py)) continue; const qx = Math.max(f.x, Math.min(f.x+f.w, px+ux*sl)), qy = Math.max(f.y, Math.min(f.y+f.h, py+uy*sl)); ctx.moveTo(px,py); ctx.lineTo(qx,qy); }
      ctx.stroke();
    }
  }
}
function drawRadial(f, t){                                                                             // a magnet: sparks converging (pull) or leaving (push)
  const on = forceOn(f, ticks); ctx.strokeStyle = `rgba(255,200,120,${on?.45:.08})`; ctx.lineWidth = 2; ctx.beginPath();
  for (let i=0;i<14;i++){ const a = i/14*6.283 + t*0.3, ph = ((t*0.8 + i*0.13) % 1), d = (f.strength >= 0 ? 1-ph : ph)*f.r, d2 = Math.max(0, d-18); ctx.moveTo(f.cx+Math.cos(a)*d, f.cy+Math.sin(a)*d); ctx.lineTo(f.cx+Math.cos(a)*d2, f.cy+Math.sin(a)*d2); }
  ctx.stroke();
}

let last = performance.now(), acc = 0;
function frame(now){
  let dt = (now-last)/1000; last = now; if (dt > 0.1) dt = 0.1;
  if (mode === 'play'){ acc += dt; while (acc >= DT){ tick(); acc -= DT; } } else acc = 0;
  render(dt);
  requestAnimationFrame(frame);
}
function render(dt){
  const k = 1-Math.exp(-5*dt);
  cam.x += (ship.x + ship.vx*0.3 - vw/(2*Z) - cam.x)*k;
  cam.y += (ship.y + ship.vy*0.3 - vh/(2*Z) - cam.y)*k;
  cam.x = Math.max(0, Math.min(L.w - vw/Z, cam.x)); cam.y = Math.max(0, Math.min(L.h - vh/Z, cam.y));
  shake *= Math.exp(-4*dt);
  const sx = reduced ? 0 : (Math.random()-.5)*shake*14, sy = reduced ? 0 : (Math.random()-.5)*shake*14;

  ctx.setTransform(dpr,0,0,dpr,0,0);
  // inside a rock zone the backdrop crossfades to the cave theme's, so a cave carved into a jungle level feels like a cave
  caveK += ((inRockZone(ship.x, ship.y) ? 1 : 0) - caveK)*(1-Math.exp(-3*dt));
  const cb = THEMES.cave.bg, jb = STYLE.bg, k2 = STYLE === THEMES.cave ? 0 : caveK;
  const vg = ctx.createLinearGradient(0,0,0,vh); vg.addColorStop(0,mixHex(jb.top, CAVE_IN.top, k2)); vg.addColorStop(1,mixHex(jb.bottom, CAVE_IN.bottom, k2));   // darker than the cave chapter itself: a hole in the daylight
  ctx.fillStyle = vg; ctx.fillRect(0,0,vw,vh);
  const glow = (g, am) => {
    const bf = jb.f, gx = (g.u*L.w-cam.x)*Z*bf + vw/2*(1-bf), gy = (g.v*L.h-cam.y)*Z*bf + vh/2*(1-bf), rad = g.r*(L.w+L.h)*0.5*Z*0.7;
    if (am < 0.02 || gx < -rad || gx > vw+rad || gy < -rad || gy > vh+rad) return;
    const a0 = parseFloat(g.c.match(/[\d.]+\)$/)[0]), c0 = g.c.replace(/[\d.]+\)$/, (a0*am).toFixed(3)+')');
    const rg = ctx.createRadialGradient(gx,gy,0,gx,gy,rad); rg.addColorStop(0,c0); rg.addColorStop(0.55,g.c.replace(/[\d.]+\)$/,(0.12*am).toFixed(3)+')')); rg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(Math.max(0,gx-rad),Math.max(0,gy-rad),Math.min(vw,gx+rad)-Math.max(0,gx-rad),Math.min(vh,gy+rad)-Math.max(0,gy-rad));
  };
  for (const g of jb.glows) glow(g, 1-k2);
  if (k2 > 0) for (const g of cb.glows) glow(g, k2*0.6);
  for (const ly of layers){   // true perspective about the screen centre: screen = (p - cam)·f·Z + centre·(1-f)
    const ox = -(cam.x+ly.padX)*Z*ly.f + vw/2*(1-ly.f) + sx*ly.f, oy = -(cam.y+ly.padY)*Z*ly.f + vh/2*(1-ly.f) + sy*ly.f, kk = Z*ly.f/ly.q;
    drawLayer(ctx, ly.c, ox, oy, kk, vw, vh);
  }
  if (hazards.length){
    ctx.save(); ctx.translate(-cam.x*Z+sx, -cam.y*Z+sy); ctx.scale(Z,Z);
    for (const z of hazards){ if (z.state === 'gone') continue; const h = z.h, sp = z.sprite;
      ctx.save(); ctx.translate(h.x, h.y+z.dy); ctx.rotate(z.a); ctx.drawImage(sp.c, sp.ox-h.x, sp.oy-h.y); ctx.restore(); }
    ctx.restore();
  }
  const tsec = performance.now()/1000;
  ctx.save(); ctx.translate(-cam.x*Z+sx, -cam.y*Z+sy); ctx.scale(Z,Z); drawForces(tsec, false); ctx.restore();   // pools, under the terrain
  drawLayer(ctx, mainC, -cam.x*Z+sx, -cam.y*Z+sy, Z, vw, vh);

  ctx.save(); ctx.translate(-cam.x*Z+sx, -cam.y*Z+sy); ctx.scale(Z,Z);
  drawParticles();
  if (ghost) drawShip(ghost, true);
  if (ship.state !== 'dead') drawShip(ship, false);
  drawForces(tsec, true);
  ctx.restore();
  const mf = 1.3; ctx.fillStyle = STYLE.bg.mote || 'rgba(217,211,199,.16)';
  for (const m of motes){ if (mode === 'play'){ m.y -= m.v*dt; if (m.y < 0) m.y += L.h; } const mx = (m.x-cam.x)*Z*mf + vw/2*(1-mf) + sx*mf, my = (m.y-cam.y)*Z*mf + vh/2*(1-mf) + sy*mf; if (mx>-4 && mx<vw+4 && my>-4 && my<vh+4) ctx.fillRect(mx, my, m.s, m.s); }

  Snd.thrust(mode === 'play' && ship.state === 'flying' && ship.flame);
  Snd.water(mode === 'play' && wet);
  timerEl.textContent = fmt(ticks);
  if (!S.buttons) hdgEl.style.transform = `rotate(${ship.a}rad) translateY(${-S.radius+4}px)`;
}

// ---- HUD ----
const timerEl = $('timer'), lvlEl = $('lvl'), bestEl = $('bestline'), msgMain = $('msgMain'), msgSub = $('msgSub');
function setMsg(a,b){ msgMain.textContent = a; msgSub.textContent = b; }
function hud(){
  lvlEl.textContent = `${li+1}. ${L.name}`;
  bestEl.textContent = best ? `Best ${fmt(best.ticks)}, ghost flying` : '';
}

// ---- Menus ----
const modal = $('modal'), box = $('box');
function openModal(html){ box.innerHTML = html; modal.classList.add('open'); document.body.classList.remove('play'); }
function closeModal(){ modal.classList.remove('open'); }
// Levels are grouped into chapters (CHAPTERS in levels.js). The menu shows one chapter at a time, with arrows to move between them.
const chapterOf = i => { let c = 0; for (let k=0;k<CHAPTERS.length;k++) if (i >= CHAPTERS[k].start) c = k; return c; };
const chapterRange = c => [CHAPTERS[c].start, c+1 < CHAPTERS.length ? CHAPTERS[c+1].start : LEVELS.length];
let menuCh = 0;
function tiles(){
  const [a,b] = chapterRange(menuCh), ch = CHAPTERS[menuCh];
  return `<div class="chap"><button class="nav" data-ch="-1" ${menuCh===0?'disabled':''} aria-label="Previous chapter">◀</button><h2>Chapter ${menuCh+1}: ${ch.name}</h2><button class="nav" data-ch="1" ${menuCh===CHAPTERS.length-1?'disabled':''} aria-label="Next chapter">▶</button></div>` +
    `<div class="grid">` + LEVELS.slice(a,b).map((l,k) => { const i = a+k, bst = store.bests[i], locked = i > store.unlocked;
    return `<button class="tile${i===li?' sel':''}" data-l="${i}" ${locked?'disabled':''}><b>${i+1}</b><small>${l.name}</small><em>${locked ? 'locked' : bst ? fmt(bst.ticks) : '—'}</em></button>`; }).join('') + `</div>`;
}
function settingsRow(){
  return `<div class="settings"><div class="row">
    <button class="tog${S.sound?' on':''}" data-set="sound">Sound ${S.sound?'on':'off'}</button>
    <button class="tog on" data-set="buttons">Controls: ${S.buttons?'buttons':'joystick'}</button>
    <button class="tog" data-set="radius">Controls size: ${S.radius<=52?'small':S.radius<=76?'medium':'large'}</button>
    ${fsAvail ? `<button class="tog${fsOn()?' on':''}" data-fs="1">Full screen ${fsOn()?'on':'off'}</button>` : ''}
  </div></div>`;
}
function showMenu(){
  mode = 'menu';
  openModal(`<h1>THRUST<span>ER</span></h1><div class="tag">Fly the cave. Reach the green pad. Beat the clock.</div>
    <div class="cols">
      <div><b>Touch</b><br>${S.buttons ? '◀ ▶ buttons to steer' : 'Left half: drag to steer'}<br>Right half: hold to thrust<br>Touching a pad lands you</div>
      <div><b>Keyboard</b><br><kbd>◀</kbd> <kbd>▶</kbd> or <kbd>A</kbd> <kbd>D</kbd> steer<br><kbd>Space</kbd> <kbd>▲</kbd> <kbd>W</kbd> thrust<br><kbd>R</kbd> restart, <kbd>Esc</kbd> pause, <kbd>F</kbd> full screen</div>
    </div>
    ${tiles()}
    <div class="row"><button class="btn pri" data-act="start">Fly level ${li+1}</button></div>${settingsRow()}`);
}
function showPause(){
  mode = 'paused';
  openModal(`<h1>PAUSED</h1><div class="tag">${li+1}. ${L.name}</div>
    <div class="row"><button class="btn pri" data-act="resume">Resume</button><button class="btn" data-act="restart">Restart level</button><button class="btn" data-act="menu">Levels</button></div>${settingsRow()}`);
}
function showComplete(){
  mode = 'complete'; const r = lastResult, lastLevel = li === LEVELS.length-1, chEnd = !lastLevel && chapterOf(li+1) !== chapterOf(li);
  const sub = r.isBest ? (r.prev ? `New best, ${((r.prev-r.ticks)/120).toFixed(2)}s faster` : 'First landing here') : `Best ${fmt(r.prev)}`;
  let extra = '';
  if (lastLevel && Object.keys(store.bests).length === LEVELS.length){
    const total = LEVELS.reduce((a,_,i) => a+store.bests[i].ticks, 0);
    extra = `<p>All ${LEVELS.length} levels flown. Sum of your best times: <b>${fmt(total)}</b>.</p>`;
  }
  if (chEnd) extra += `<p>Chapter ${chapterOf(li)+1}: ${CHAPTERS[chapterOf(li)].name} complete. Next up: ${CHAPTERS[chapterOf(li+1)].name}.</p>`;
  openModal(`<h2>${lastLevel ? 'Final level complete' : `Level ${li+1} complete`}</h2><div class="big">${fmt(r.ticks)}</div><div class="sub${r.isBest?' good':''}">${sub}</div>${extra}
    <div class="row">${lastLevel ? `<button class="btn pri" data-act="menu">Levels</button>` : `<button class="btn pri" data-act="next">Next level</button>`}<button class="btn" data-act="restart">Fly again</button>${lastLevel ? '' : `<button class="btn" data-act="menu">Levels</button>`}</div>`);
}
function play(){ closeModal(); mode = 'play'; document.body.classList.add('play'); Snd.init(); Snd.resume(); placeControls(); }
box.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return; Snd.init(); Snd.click();
  if (t.dataset.l !== undefined){ loadLevel(+t.dataset.l); showMenu(); return; }
  if (t.dataset.ch){ menuCh = Math.max(0, Math.min(CHAPTERS.length-1, menuCh + +t.dataset.ch)); showMenu(); return; }
  if (t.dataset.fs){ toggleFS(); return; }                      // the label is refreshed by onFsChange
  if (t.dataset.set){
    const k = t.dataset.set;
    if (k === 'radius') S.radius = S.radius <= 52 ? 64 : S.radius <= 76 ? 88 : 52; else S[k] = S[k] ? 0 : 1;
    if (k === 'buttons') clearTouch();
    save(); placeControls(); Snd.thrust(false);
    if (mode === 'menu') showMenu(); else showPause(); return;
  }
  switch (t.dataset.act){
    case 'start': reset(); play(); break;
    case 'resume': play(); break;
    case 'restart': reset(); play(); break;
    case 'next': loadLevel(li+1); play(); break;
    case 'menu': reset(); showMenu(); break;
  }
});
$('pauseBtn').addEventListener('click', () => { if (mode === 'play') showPause(); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; clearTouch(); if (mode === 'play' && ship.state === 'flying') showPause(); });

// ---- Input ----
const stick = {active:false, id:null, ox:0, oy:0, dx:0, dy:0}, thrTouch = {active:false, id:null};
const btn = {l:false, r:false}, arrows = new Map();            // pointerId -> 'l' | 'r'
function readInput(){
  const kb = ((keys.right||btn.r)?1:0) - ((keys.left||btn.l)?1:0);
  let steer = kb;
  if (!S.buttons && stick.active){
    const R = S.radius, d = Math.min(1, Math.hypot(stick.dx, stick.dy)/R);
    if (d >= S.dead){
      const m = Math.pow((d-S.dead)/(1-S.dead), S.expo);
      const proj = stick.dx*Math.cos(ship.a) + stick.dy*Math.sin(ship.a);   // project onto the rocket's right-hand side
      steer = Math.max(-1, Math.min(1, proj/(d*R)))*m;
    } else steer = 0;
  }
  steer = Math.round(steer*15)/15;                                   // quantise so the recorded input replays exactly
  return {thrust:(keys.thrust||thrTouch.active) ? 1 : 0, steer};
}
const stickEl = $('stick'), knobEl = $('knob'), thrEl = $('thr'), ctl = $('ctl'), hdgEl = $('hdg'), padL = $('padL'), padR = $('padR');
let CG = null;                                                  // control-layout geometry (G is the level geometry)
function ctlGeom(){
  const sc = S.radius/64, R = S.radius;
  const T = Math.min(110*sc, vw*0.32, vh*0.3);
  const gap = 12*sc;
  const A = Math.min(78*sc, (vw*0.46-gap)/2, vh*0.24);
  const cy = vh - 40 - Math.max(R, T/2, A/2);
  let cx = Math.max(Math.min(vw*0.25, 150), (S.buttons ? A+gap/2 : R) + 12, T/2 + 10);
  cx = Math.min(cx, vw*0.42);
  return {R, T, A, gap, cx, cy, tx:vw-cx, ty:cy, lx:cx-(A+gap)/2, rx:cx+(A+gap)/2};
}
function placeControls(){
  const g = CG = ctlGeom();
  ctl.classList.toggle('btns', !!S.buttons);
  stickEl.style.width = stickEl.style.height = 2*g.R+'px'; stickEl.style.margin = `-${g.R}px 0 0 -${g.R}px`;
  $('dead').style.width = $('dead').style.height = 2*g.R*S.dead+'px';
  const kn = Math.round(52*g.R/64);
  knobEl.style.width = knobEl.style.height = kn+'px'; knobEl.style.margin = `${-kn/2}px 0 0 ${-kn/2}px`;
  thrEl.style.width = thrEl.style.height = g.T+'px'; thrEl.style.margin = `${-g.T/2}px 0 0 ${-g.T/2}px`; thrEl.style.fontSize = Math.round(g.T*0.25)+'px';
  for (const [el, x] of [[padL, g.lx], [padR, g.rx]]){
    el.style.width = el.style.height = g.A+'px'; el.style.margin = `${-g.A/2}px 0 0 ${-g.A/2}px`; el.style.fontSize = Math.round(g.A*0.32)+'px';
    el.style.transform = `translate(${x}px,${g.cy}px)`;
  }
  if (!stick.active){ stickEl.style.transform = `translate(${g.cx}px,${g.cy}px)`; knobEl.style.transform = 'translate(0,0)'; }
  if (!thrTouch.active) thrEl.style.transform = `translate(${g.tx}px,${g.ty}px)`;
}
function stickMove(x,y){
  let dx = x-stick.ox, dy = y-stick.oy; const d = Math.hypot(dx,dy), R = S.radius;
  if (d > R){ dx *= R/d; dy *= R/d; }
  knobEl.style.transform = `translate(${dx}px,${dy}px)`; stick.dx = dx; stick.dy = dy;
}
// Contiguous thumb zones: each arrow owns half the pair's width and everything below it to the screen edge.
function hitArrow(x,y){
  const g = CG; if (!g) return null;
  const w = (g.A+g.gap)/2, h = g.A/2 + g.gap;
  if (y < g.cy-h) return null;
  if (x >= g.lx-w && x < g.lx+w) return 'l';
  if (x >= g.rx-w && x <= g.rx+w) return 'r';
  return null;
}
function syncBtn(){
  btn.l = btn.r = false;
  for (const v of arrows.values()) btn[v] = true;
  padL.classList.toggle('on', btn.l); padR.classList.toggle('on', btn.r);
}
function clearTouch(){
  arrows.clear(); syncBtn();
  stick.active = false; stick.dx = stick.dy = 0; stickEl.classList.remove('live');
  thrTouch.active = false; thrEl.classList.remove('live','on');
  placeControls();
}
ctl.addEventListener('pointerdown', e => {
  if (mode !== 'play') return; e.preventDefault(); ctl.setPointerCapture(e.pointerId);
  if (S.buttons){
    const h = hitArrow(e.clientX, e.clientY);
    if (h){ arrows.set(e.pointerId, h); syncBtn(); return; }
  }
  if (e.clientX < vw/2){
    if (S.buttons || stick.active) return;
    stick.active = true; stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.dx = stick.dy = 0;
    stickEl.classList.add('live'); stickEl.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; knobEl.style.transform = 'translate(0,0)';
  } else {
    if (thrTouch.active) return;
    thrTouch.active = true; thrTouch.id = e.pointerId;
    thrEl.classList.add('live','on'); thrEl.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
  }
});
ctl.addEventListener('pointermove', e => {
  if (arrows.has(e.pointerId)){ const h = hitArrow(e.clientX, e.clientY); if (h) arrows.set(e.pointerId, h); else arrows.delete(e.pointerId); syncBtn(); return; }
  if (stick.active && e.pointerId === stick.id) stickMove(e.clientX, e.clientY);
});
const release = e => {
  if (arrows.delete(e.pointerId)) syncBtn();
  if (stick.active && e.pointerId === stick.id){ stick.active = false; stick.dx = stick.dy = 0; stickEl.classList.remove('live'); placeControls(); }
  if (thrTouch.active && e.pointerId === thrTouch.id){ thrTouch.active = false; thrEl.classList.remove('live','on'); placeControls(); }
};
ctl.addEventListener('pointerup', release); ctl.addEventListener('pointercancel', release);
ctl.addEventListener('contextmenu', e => e.preventDefault());

const KEYMAP = {ArrowUp:'thrust',w:'thrust',W:'thrust',' ':'thrust',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};
addEventListener('keydown', e => {
  const k = KEYMAP[e.key];
  if (mode === 'play'){
    if (k){ e.preventDefault(); keys[k] = true; return; }
    if (e.repeat) return;
    if (e.key === 'Escape' || e.key.toLowerCase() === 'p') showPause();
    else if (e.key.toLowerCase() === 'r') reset();
    else if (e.key.toLowerCase() === 'f') toggleFS();
    return;
  }
  if (e.repeat) return;
  if (e.key.toLowerCase() === 'f'){ toggleFS(); return; }
  if (mode === 'paused' && e.key === 'Escape'){ Snd.init(); play(); }
  else if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); Snd.init();
    if (mode === 'menu'){ reset(); play(); }
    else if (mode === 'paused') play();
    else if (mode === 'complete'){ if (li < LEVELS.length-1){ loadLevel(li+1); play(); } else { reset(); showMenu(); } }
  }
  else if (mode === 'complete' && e.key.toLowerCase() === 'r'){ reset(); play(); }
});
addEventListener('keyup', e => { const k = KEYMAP[e.key]; if (k) keys[k] = false; });

// ---- Go ----
li = Math.min(store.level||0, store.unlocked||0); L = LEVELS[li]; menuCh = chapterOf(li); setGeom(); applyTheme();
resize(); buildMain(); buildHazards(); reset(); showMenu(); requestAnimationFrame(frame);
