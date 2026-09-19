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
  mainC = renderLayer(1, STYLE.main, 0, 0);
  const d = mainC.maskAlpha; mainC.maskAlpha = null;
  mask = new Uint8Array(L.w*L.h);
  for (let i=0,j=3;i<mask.length;i++,j+=4) mask[i] = d[j] > 100 ? 1 : 0;
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
  let ac = null, noise = null, thrGain = null, thrFilt = null;
  function init(){
    if (ac) return;
    try { ac = new (window.AudioContext||window.webkitAudioContext)(); } catch (e) { return; }
    const n = ac.sampleRate*2; noise = ac.createBuffer(1, n, ac.sampleRate); const d = noise.getChannelData(0); let last = 0;
    for (let i=0;i<n;i++){ const w = Math.random()*2-1; last = (last+0.02*w)/1.02; d[i] = last*3.5; }   // brown noise
    const src = ac.createBufferSource(); src.buffer = noise; src.loop = true;
    thrFilt = ac.createBiquadFilter(); thrFilt.type = 'lowpass'; thrFilt.frequency.value = 500;
    thrGain = ac.createGain(); thrGain.gain.value = 0;
    src.connect(thrFilt).connect(thrGain).connect(ac.destination); src.start();
  }
  function resume(){ if (ac && ac.state === 'suspended') ac.resume(); }
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
    init, resume, thrust,
    explode(){ burst(1.1, 2600, 90, 1.2); tone(70, 0.5, 0.6, 'sine'); },
    land(sp){ const v = Math.min(0.7, 0.15+sp/500); burst(0.18, 700, 120, v); tone(55, 0.25, v*0.8, 'sine'); },
    finish(){ tone(523, 0.18, 0.25, 'triangle'); tone(784, 0.22, 0.25, 'triangle', 0.14); tone(1046, 0.4, 0.22, 'triangle', 0.28); },
    click(){ tone(660, 0.06, 0.08, 'square'); },
  };
})();

// ---- Game state ----
let ship, ghost = null, best = null, particles = [], ticks = 0, gTick = 0, running = false, inputs = [], deadT = 0, shake = 0, doneT = 0;
let mode = 'menu';                                           // menu | play | paused | complete | watch | watched
let rival = null, watched = null, ghostRun = null, watchT = 0;  // someone else's run, loaded from the board
const cam = {x:0,y:0};
const keys = {thrust:false,left:false,right:false};
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const normAng = a => { a = (a+Math.PI) % (2*Math.PI); if (a<0) a += 2*Math.PI; return a-Math.PI; };
const fmt = t => { const s = t/120, m = Math.floor(s/60); return `${m}:${(s-m*60).toFixed(2).padStart(5,'0')}`; };

function spawn(){ const p = L.pads.start; return {x:p.x+p.w/2, y:p.y-11, vx:0, vy:0, a:0, state:'idle', flame:0}; }
function reset(){
  ship = spawn(); best = store.bests[li] || null;
  ghostRun = rival || best; ghost = ghostRun ? spawn() : null;      // a rival from the board flies in place of your own best
  ticks = 0; gTick = 0; running = false; inputs = []; particles.length = 0; deadT = 0; doneT = 0; watchT = 0; setMsg('','');
  cam.x = ship.x - vw/(2*Z); cam.y = ship.y - vh/(2*Z);
  hud();
}
function loadLevel(i){
  li = Math.max(0, Math.min(LEVELS.length-1, i)); L = LEVELS[li]; store.level = li; save();
  rival = watched = null;                                            // a ghost belongs to the level it was flown on
  setGeom(); buildMain(); resize(); reset();
}

// One physics tick. Deterministic: same inputs → same run, which is what makes the ghost replay possible.
function stepShip(s, inp){
  if (s.state === 'idle' || s.state === 'landed'){ if (!inp.thrust) return null; s.state = 'flying'; }
  if (s.state !== 'flying') return null;
  s.a = normAng(s.a + inp.steer*P.turnRate*DEG*DT);
  const th = inp.thrust ? P.thrust : 0;
  s.vx += Math.sin(s.a)*th*DT;
  s.vy += (-Math.cos(s.a)*th + P.gravity)*DT;
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
  if (mode === 'play'){
    const inp = readInput();
    if (ship.state === 'dead'){ deadT -= DT; if (deadT <= 0) reset(); }
    else if (ship.state === 'finished'){ doneT -= DT; if (doneT <= 0) showComplete(); }
    else {
      if (!running && ship.state === 'idle' && inp.thrust) running = true;
      if (running){
        ticks++; inputs.push(encode(inp));
        const hit = stepShip(ship, inp);
        if (hit){
          if (hit.type === 'land'){
            if (hit.sp > 120) puff(hit.px, hit.py, hit.sp); Snd.land(hit.sp); settle(ship, hit.z);
            if (hit.key === 'target'){ ship.state = 'finished'; doneT = 1.3; celebrate(hit.px, hit.py); shake = 0.5; buzz(180, 0.35); finish(); }
          } else { ship.state = 'dead'; deadT = 1.4; explode(hit.px, hit.py); shake = 1; Snd.explode(); buzz(280, 0.85); setMsg('Crashed', ''); }
        }
        if (ship.state === 'flying' && ship.flame) emitThrust(ship);
      }
    }
  }
  // The ghost flies on the player's clock while racing, and on its own while watched.
  if (ghost && (running || mode === 'watch') && ghost.state !== 'dead' && ghost.state !== 'finished'){
    if (ghostRun.pts) playPath(ghost, ghostRun, gTick++);         // a run from the board: a path, drawn between its samples
    else {
      const code = ghostRun.inputs[gTick++];
      if (code === undefined) ghost.state = 'finished';
      else {
        const gh = stepShip(ghost, decode(code));
        if (gh){
          if (gh.type === 'land'){ settle(ghost, gh.z); if (gh.key === 'target') ghost.state = 'finished'; }
          else ghost.state = 'dead';
        }
      }
    }
    if (mode === 'watch' && !watchT && (ghost.state === 'dead' || ghost.state === 'finished')) watchT = 1.2;
  }
  if (watchT > 0){ watchT -= DT; if (watchT <= 0){ watchT = 0; showWatched(); } }
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
function drawShip(s, isGhost, alpha){
  ctx.save(); ctx.translate(s.x,s.y); ctx.rotate(s.a);
  if (isGhost) ctx.globalAlpha = alpha || 0.45;
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
    else if (p.kind === 1){ ctx.fillStyle = `rgba(236,230,218,${t*0.9})`; ctx.fillRect(p.x-p.sz/2,p.y-p.sz/2,p.sz,p.sz); }
    else if (p.kind === 3){ ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, t*1.5); ctx.fillStyle = p.col; ctx.fillRect(p.x-p.sz/2,p.y-p.sz/2,p.sz,p.sz*0.6); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    else { ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = (p.col||'rgba(255,190,120,')+t+')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x,p.y,(1-t)*(p.sz||110),0,6.283); ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; }
  }
}

let last = performance.now(), acc = 0;
function frame(now){
  let dt = (now-last)/1000; last = now; if (dt > 0.1) dt = 0.1;
  padFrame(now);
  if (mode === 'play' || mode === 'watch'){ acc += dt; while (acc >= DT){ tick(); acc -= DT; } } else acc = 0;
  render(dt);
  requestAnimationFrame(frame);
}
function render(dt){
  const k = 1-Math.exp(-5*dt), eye = (mode === 'watch' && ghost) ? ghost : ship;
  cam.x += (eye.x + eye.vx*0.3 - vw/(2*Z) - cam.x)*k;
  cam.y += (eye.y + eye.vy*0.3 - vh/(2*Z) - cam.y)*k;
  cam.x = Math.max(0, Math.min(L.w - vw/Z, cam.x)); cam.y = Math.max(0, Math.min(L.h - vh/Z, cam.y));
  shake *= Math.exp(-4*dt);
  const sx = reduced ? 0 : (Math.random()-.5)*shake*14, sy = reduced ? 0 : (Math.random()-.5)*shake*14;

  ctx.setTransform(dpr,0,0,dpr,0,0);
  const vg = ctx.createLinearGradient(0,0,0,vh); vg.addColorStop(0,STYLE.bg.top); vg.addColorStop(1,STYLE.bg.bottom); ctx.fillStyle = vg; ctx.fillRect(0,0,vw,vh);
  for (const g of STYLE.bg.glows){
    const bf = STYLE.bg.f, gx = (g.u*L.w-cam.x)*Z*bf + vw/2*(1-bf), gy = (g.v*L.h-cam.y)*Z*bf + vh/2*(1-bf), rad = g.r*(L.w+L.h)*0.5*Z*0.7;
    if (gx < -rad || gx > vw+rad || gy < -rad || gy > vh+rad) continue;
    const rg = ctx.createRadialGradient(gx,gy,0,gx,gy,rad); rg.addColorStop(0,g.c); rg.addColorStop(0.55,g.c.replace(/[\d.]+\)$/,'0.12)')); rg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(Math.max(0,gx-rad),Math.max(0,gy-rad),Math.min(vw,gx+rad)-Math.max(0,gx-rad),Math.min(vh,gy+rad)-Math.max(0,gy-rad));
  }
  for (const ly of layers){   // true perspective about the screen centre: screen = (p - cam)·f·Z + centre·(1-f)
    const ox = -(cam.x+ly.padX)*Z*ly.f + vw/2*(1-ly.f) + sx*ly.f, oy = -(cam.y+ly.padY)*Z*ly.f + vh/2*(1-ly.f) + sy*ly.f, kk = Z*ly.f/ly.q;
    ctx.drawImage(ly.c, ox, oy, ly.c.width*kk, ly.c.height*kk);
  }
  ctx.drawImage(mainC, -cam.x*Z+sx, -cam.y*Z+sy, L.w*Z, L.h*Z);

  ctx.save(); ctx.translate(-cam.x*Z+sx, -cam.y*Z+sy); ctx.scale(Z,Z);
  drawParticles();
  if (ghost) drawShip(ghost, true, mode === 'watch' ? 0.8 : 0.45);   // the watched run is the thing on screen, not a hint
  if (ship.state !== 'dead') drawShip(ship, false);
  ctx.restore();
  const mf = 1.3; ctx.fillStyle = 'rgba(217,211,199,.16)';
  for (const m of motes){ if (mode === 'play'){ m.y -= m.v*dt; if (m.y < 0) m.y += L.h; } const mx = (m.x-cam.x)*Z*mf + vw/2*(1-mf) + sx*mf, my = (m.y-cam.y)*Z*mf + vh/2*(1-mf) + sy*mf; if (mx>-4 && mx<vw+4 && my>-4 && my<vh+4) ctx.fillRect(mx, my, m.s, m.s); }

  Snd.thrust((mode === 'play' && ship.state === 'flying' && ship.flame) || (mode === 'watch' && ghost && ghost.flame));
  timerEl.textContent = fmt(mode === 'watch' ? gTick : ticks);
  if (!S.buttons) hdgEl.style.transform = `rotate(${ship.a}rad) translateY(${-S.radius+4}px)`;
}

// ---- HUD ----
const timerEl = $('timer'), lvlEl = $('lvl'), bestEl = $('bestline'), msgMain = $('msgMain'), msgSub = $('msgSub');
function setMsg(a,b){ msgMain.textContent = a; msgSub.textContent = b; }
function hud(){
  lvlEl.textContent = `${li+1}. ${L.name}`;
  bestEl.textContent = mode === 'watch' && watched ? `Watching ${watched.name}, ${fmt(watched.ticks)}`
    : rival ? `Racing ${rival.name}, ${fmt(rival.ticks)}`
    : best ? `Best ${fmt(best.ticks)}, ghost flying` : '';
}

// ---- Menus ----
const modal = $('modal'), box = $('box');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
function openModal(html){ box.innerHTML = html; modal.classList.add('open'); document.body.classList.remove('play','watch');
  if (window.LB) window.LB.mount(box); }                      // the boards fill themselves in; before the module lands there simply is none
function closeModal(){ modal.classList.remove('open'); }
function tiles(){
  return `<div class="grid">` + LEVELS.map((l,i) => { const b = store.bests[i], locked = i > store.unlocked;
    return `<button class="tile${i===li?' sel':''}" data-l="${i}" ${locked?'disabled':''}><b>${i+1}</b><small>${l.name}</small><em>${locked ? 'locked' : b ? fmt(b.ticks) : '—'}</em></button>`; }).join('') + `</div>`;
}
// A board holds whole numbers, and for a time attack the honest one is milliseconds.
const msOf = t => Math.round(t*1000/120);
function lbBlock(postTicks){
  const post = postTicks ? ` data-lb-post="${msOf(postTicks)}"` : '';
  return `<div data-lb-level="${li}" data-lb-title="${li+1}. ${L.name}"${post}></div>`;
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
      <div><b>Gamepad</b><br>Stick points where to fly<br>D-pad turns, <kbd>A</kbd> or a trigger thrusts<br><kbd>X</kbd> restart, <kbd>Start</kbd> pause<br>Press a button to wake it up</div>
    </div>
    <h2>Level</h2>${tiles()}
    <div class="row"><button class="btn pri" data-act="start">Fly level ${li+1}</button></div>
    ${lbBlock(0)}${settingsRow()}`);
}
function showPause(){
  mode = 'paused';
  openModal(`<h1>PAUSED</h1><div class="tag">${li+1}. ${L.name}</div>
    <div class="row"><button class="btn pri" data-act="resume">Resume</button><button class="btn" data-act="restart">Restart level</button><button class="btn" data-act="menu">Levels</button></div>${settingsRow()}`);
}
function showComplete(){
  mode = 'complete'; const r = lastResult, lastLevel = li === LEVELS.length-1;
  const sub = r.isBest ? (r.prev ? `New best, ${((r.prev-r.ticks)/120).toFixed(2)}s faster` : 'First landing here') : `Best ${fmt(r.prev)}`;
  let extra = '';
  if (lastLevel && Object.keys(store.bests).length === LEVELS.length){
    const total = LEVELS.reduce((a,_,i) => a+store.bests[i].ticks, 0);
    extra = `<p>All ten levels flown. Sum of your best times: <b>${fmt(total)}</b>.</p>`;
  }
  openModal(`<h2>${lastLevel ? 'Final level complete' : `Level ${li+1} complete`}</h2><div class="big">${fmt(r.ticks)}</div><div class="sub${r.isBest?' good':''}">${sub}</div>${extra}
    <div class="row">${lastLevel ? `<button class="btn pri" data-act="menu">Levels</button>` : `<button class="btn pri" data-act="next">Next level</button>`}<button class="btn" data-act="restart">Fly again</button>${lastLevel ? '' : `<button class="btn" data-act="menu">Levels</button>`}</div>
    ${lbBlock(store.bests[li].ticks)}`);
}
function showWatched(){
  mode = 'watched';
  openModal(`<h2>${esc(watched.name)}'s run</h2><div class="big">${fmt(watched.ticks)}</div>
    <div class="sub">${li+1}. ${L.name}</div>
    <div class="row"><button class="btn pri" data-act="race">Race this ghost</button><button class="btn" data-act="rewatch">Watch again</button><button class="btn" data-act="menu">Levels</button></div>`);
}
function play(){ closeModal(); mode = 'play'; document.body.classList.add('play'); document.body.classList.remove('watch'); Snd.init(); Snd.resume(); placeControls(); padGate = true; }
box.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return; Snd.init(); Snd.click();
  if (t.dataset.l !== undefined){ loadLevel(+t.dataset.l); showMenu(); return; }
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
    case 'race': if (watched){ rival = watched; reset(); play(); } break;
    case 'rewatch': if (watched){ mode = 'watch'; reset(); closeModal(); document.body.classList.add('play','watch'); hud(); } break;
    case 'menu': rival = watched = null; reset(); showMenu(); break;
  }
});
$('pauseBtn').addEventListener('click', () => { if (mode === 'play') showPause(); else if (mode === 'watch') showWatched(); });
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
  } else if (!kb){
    const ps = padSteer();
    if (ps !== null) steer = ps;
  }
  steer = Math.round(steer*15)/15;                                   // quantise so the recorded input replays exactly
  return {thrust:(keys.thrust||thrTouch.active||padThrust()) ? 1 : 0, steer};
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
  if (e.target && e.target.tagName === 'INPUT') return;          // the name field on a board owns every key while it has focus
  if (mode === 'watch'){ if (e.key === 'Escape') showWatched(); return; }
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
    else if (mode === 'watched' && watched){ rival = watched; reset(); play(); }
  }
  else if (mode === 'complete' && e.key.toLowerCase() === 'r'){ reset(); play(); }
});
addEventListener('keyup', e => { const k = KEYMAP[e.key]; if (k) keys[k] = false; });

// ---- Controller ----
// The gamepad plugin is a module and this file is not, so it arrives by dynamic
// import: the game runs without it and picks it up the moment it lands. `keys`
// is off because this file already reads the keyboard, and a key counted twice
// is a key pressed twice.
//
// A controller is invisible to the browser until one of its buttons is pressed,
// and invisible again whenever the window is not focused — inside the portal
// that means the frame has to have been clicked. So "no controller" and
// "controller nobody has touched" look the same from here, which is why the
// menu says press a button rather than claiming there is nothing plugged in.
let pad = null;
import('https://plugins.game.bigbools.fi/gamepad/v1/index.js')
  .then(m => { pad = m.createGamepad({ keys:false, actions:{
    thrust: ['A', 'RT', 'LT', 'RB'],
    select: ['A'],
    back:   ['B', 'Back'],
    start:  ['Start'],
    again:  ['X'],
  }}); })
  .catch(() => {});                                       // blocked or offline: touch and keys are untouched

// Thrust carried over from the menu would launch the run on the frame it opens,
// so the button has to come up once before it counts as flying.
let padGate = false;
const padThrust = () => !!pad && !padGate && pad.held('thrust');
const buzz = (duration, strong) => { if (pad) pad.rumble({duration, strong, weak:strong*0.6}); };

// The stick points where the rocket should go, the same promise the touch stick
// makes. The d-pad turns instead: "left" on a d-pad means left of the rocket,
// not left of the screen. Returns null when the pad is saying nothing, so the
// touch stick and the keys keep the last word.
function padSteer(){
  if (!pad || !pad.connected) return null;
  const dp = (pad.held('Right') ? 1 : 0) - (pad.held('Left') ? 1 : 0);
  if (dp) return dp;
  const d = Math.min(1, Math.hypot(pad.x, pad.y));        // the plugin has already taken its dead zone out
  if (!d) return null;
  const proj = (pad.x*Math.cos(ship.a) + pad.y*Math.sin(ship.a))/d;   // cosine to the rocket's right-hand side
  return Math.max(-1, Math.min(1, proj))*Math.pow(d, S.expo);
}

// Everything in a modal is a real button, so the controller cursor is nothing
// but a selected element: left and right walk the document order, up and down
// take the nearest thing that way, which is what turns the ten level tiles into
// a grid instead of a list. Clicking the element is what runs the game's own
// handler, so there is no second copy of what a menu does.
const navItems = () => [...box.querySelectorAll('button:not(:disabled), input')].filter(el => el.offsetParent);
let padSel = null;
function padMark(el){
  if (padSel && padSel !== el) padSel.classList.remove('gp');
  padSel = el || null;
  if (!padSel) return;
  padSel.classList.add('gp');
  padSel.scrollIntoView({block:'nearest'});
}
function padNav(x, y){
  const items = navItems(); if (!items.length) return;
  const i = items.indexOf(padSel);
  if (i < 0){ padMark(items[0]); return; }
  if (x){ padMark(items[(i+x+items.length) % items.length]); return; }
  const a = padSel.getBoundingClientRect(), ax = a.left+a.width/2, ay = a.top+a.height/2;
  let best = null, score = Infinity;
  for (const el of items){
    if (el === padSel) continue;
    const b = el.getBoundingClientRect(), fwd = (b.top+b.height/2-ay)*y;
    if (fwd < 4) continue;                                // behind us, or the same row
    const s = fwd + Math.abs(b.left+b.width/2-ax)*2.2;    // drifting sideways costs more than reaching further
    if (s < score){ score = s; best = el; }
  }
  if (best) padMark(best);
}
// A shove moves the cursor once and then repeats, the way a held arrow key does.
let navDir = 0, navAt = 0;
function padDir(now){
  let x = (pad.held('Right') ? 1 : 0) - (pad.held('Left') ? 1 : 0);
  let y = (pad.held('Down') ? 1 : 0) - (pad.held('Up') ? 1 : 0);
  if (!x && !y){
    if (Math.abs(pad.x) > 0.5) x = Math.sign(pad.x);
    else if (Math.abs(pad.y) > 0.5) y = Math.sign(pad.y);
  }
  if (x && y) y = 0;
  const dir = x*3 + y;
  if (!dir){ navDir = 0; return null; }
  if (dir !== navDir){ navDir = dir; navAt = now+380; return [x, y]; }
  if (now < navAt) return null;
  navAt = now+110;
  return [x, y];
}
// A toggle redraws the whole menu underneath the cursor, so the thing it stood
// on is remembered by what it is rather than by where it was: the board fills
// itself in late and shifts every index below it.
let padKeep = '';
function padActivate(){
  if (!padSel) return;
  if (padSel.tagName === 'INPUT'){ padSel.focus(); return; }   // a name still wants a keyboard; this is where it is typed
  const d = padSel.dataset;
  padKeep = d.set ? `[data-set="${d.set}"]` : d.fs ? '[data-fs]' : '';
  Snd.init(); padSel.click();
}
// Start is the obvious move in whatever is on screen, which is what Enter does.
function padStart(){
  Snd.init();
  if (mode === 'menu'){ reset(); play(); }
  else if (mode === 'paused') play();
  else if (mode === 'complete'){ if (li < LEVELS.length-1){ loadLevel(li+1); play(); } else { reset(); showMenu(); } }
  else if (mode === 'watched' && watched){ rival = watched; reset(); play(); }
}
function padBack(){
  if (mode === 'paused'){ Snd.init(); play(); }
  else if (mode === 'complete' || mode === 'watched'){ rival = watched = null; reset(); showMenu(); }
}
function padFrame(now){
  if (!pad) return;
  pad.poll();                                             // once a frame, before anything asks it a question
  if (padGate && !pad.held('thrust')) padGate = false;
  if (!pad.connected) return;
  if (mode === 'play'){
    if (pad.pressed('start') || pad.pressed('back')) showPause();
    else if (pad.pressed('again')) reset();
    return;
  }
  if (mode === 'watch'){
    if (pad.pressed('start') || pad.pressed('back') || pad.pressed('select')) showWatched();
    return;
  }
  // A modal is open. The board fills itself in late and redraws itself after a
  // post, so the cursor is checked against the live DOM every frame rather than
  // trusted to still be on screen.
  if (!padSel || !padSel.isConnected || !padSel.offsetParent){
    padMark((padKeep && box.querySelector(padKeep)) || box.querySelector('.btn.pri') || navItems()[0]);
    padKeep = '';
  }
  const d = padDir(now);
  if (d) padNav(d[0], d[1]);
  if (pad.pressed('select')) padActivate();
  else if (pad.pressed('start')) padStart();
  else if (pad.pressed('back')) padBack();
  else if (pad.pressed('again') && mode === 'complete'){ reset(); play(); }
}

// ---- Ghost replays ----
// A run that travels to another player is stored as a path — ten positions a
// second, drawn smoothly between them — not as the inputs that flew it. Inputs
// are smaller, but they only replay true in the browser that recorded them:
// Math.sin and a canvas fill are not promised to agree between engines, and a
// ghost that drifts by a hair ends up in a wall. A path flies what was flown,
// on any machine. Sampling the inputs instead would not do: at 100 ms the
// steering is a different run, and it would fly somewhere else entirely.
const A64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const IX = {}; for (let i=0;i<64;i++) IX[A64[i]] = i;
const CAP = 1900;                                             // chars: a board entry carries 2 kB, and the time shares it
const w12 = v => A64[(v>>6)&63] + A64[v&63];
const w18 = v => A64[(v>>12)&63] + A64[(v>>6)&63] + A64[v&63];

// Flies a stored run again, off screen, to read its path out of the physics.
function pathOf(run, iv){
  const s = spawn(), pts = [], take = () => pts.push({x:s.x, y:s.y, a:s.a, f:s.flame});
  take();
  for (let t = 0; t < run.inputs.length; t++){
    const hit = stepShip(s, decode(run.inputs[t]));
    if (hit){ if (hit.type !== 'land') break; settle(s, hit.z); if (hit.key === 'target'){ take(); return pts; } }
    if ((t+1) % iv === 0) take();
  }
  take();
  return pts;
}
// Position to two units, heading to six bits, thrust to one bit per sample.
function packReplay(run){
  for (const iv of [12, 24, 48]){                             // 100 ms, then coarser rather than nothing
    const pts = pathOf(run, iv);
    let out = 'p' + A64[iv] + w18(run.inputs.length), px = 0, py = 0, bits = '';
    for (let i = 0; i < pts.length; i++){
      const p = pts[i], qx = Math.round(p.x/2), qy = Math.round(p.y/2), dx = qx-px, dy = qy-py;
      if (i && Math.abs(dx) < 32 && Math.abs(dy) < 32) out += A64[dx+31] + A64[dy+31];
      else out += A64[63] + w12(Math.max(0,qx)) + w12(Math.max(0,qy));   // 63 as a delta means: the two coordinates follow whole
      out += A64[Math.round((normAng(p.a)+Math.PI)/(2*Math.PI)*63)];
      px = qx; py = qy; bits += p.f ? '1' : '0';
    }
    let flags = '';
    for (let i = 0; i < bits.length; i += 6) flags += A64[parseInt(bits.slice(i,i+6).padEnd(6,'0'), 2)];
    out += '.' + flags;
    if (out.length <= CAP) return out;
  }
  return null;                                                // a run this long does not fit, and a cut ghost is worse than none
}
function unpackReplay(str){
  try {
    if (typeof str !== 'string' || str[0] !== 'p') return null;
    const iv = IX[str[1]], ticks = (IX[str[2]]<<12)|(IX[str[3]]<<6)|IX[str[4]];
    const cut = str.lastIndexOf('.'), body = str.slice(5, cut), flags = str.slice(cut+1);
    const pts = []; let i = 0, x = 0, y = 0;
    while (i < body.length){
      if (IX[body[i]] === 63){ x = (IX[body[i+1]]<<6)|IX[body[i+2]]; y = (IX[body[i+3]]<<6)|IX[body[i+4]]; i += 5; }
      else { x += IX[body[i]]-31; y += IX[body[i+1]]-31; i += 2; }
      const a = IX[body[i++]]/63*2*Math.PI - Math.PI, n = pts.length;
      pts.push({x:x*2, y:y*2, a, f:(IX[flags[n/6|0]] >> (5-n%6)) & 1});
    }
    return (iv && ticks && pts.length > 1) ? {ticks, iv, pts} : null;
  } catch (e) { return null; }                                // a blob from a future version of the game, or a hand-edited one
}
// Where a replayed ghost is at tick t. The four samples around it give a curve
// rather than a chord, which is what keeps a coarsely sampled run off the walls:
// measured over a minute of flight, the worst miss drops from 7.6 units to 3.3,
// against a rocket 25 units long. It costs nothing on the wire.
const spline = (a,b,c,d,t) => 0.5*(2*b + (c-a)*t + (2*a-5*b+4*c-d)*t*t + (3*b-3*c+d-a)*t*t*t);
function playPath(g, rep, t){
  const pts = rep.pts, n = pts.length;
  if (t >= rep.ticks){ const p = pts[n-1]; g.x = p.x; g.y = p.y; g.a = p.a; g.flame = 0; g.state = 'finished'; return; }
  const i = Math.min(Math.floor(t/rep.iv), n-2), tA = i*rep.iv, tB = i === n-2 ? rep.ticks : (i+1)*rep.iv;
  const u = tB > tA ? (t-tA)/(tB-tA) : 0;
  const o = pts[Math.max(i-1,0)], p = pts[i], q = pts[i+1], r = pts[Math.min(i+2,n-1)];
  g.x = spline(o.x, p.x, q.x, r.x, u); g.y = spline(o.y, p.y, q.y, r.y, u);
  g.a = p.a + normAng(q.a-p.a)*u; g.flame = p.f; g.state = 'flying';
}

// ---- What the leaderboard may ask of the game ----
// The board knows times and names; the game knows flying. This is the whole of
// what passes between them, and the replay is opaque on the board's side.
const Thruster = {
  replay(lv){ const run = lv === li && store.bests[lv]; return run ? packReplay(run) : null; },
  watch(lv, name, replay){ return start(lv, name, replay, true); },
  race(lv, name, replay){ return start(lv, name, replay, false); },
};
function start(lv, name, replay, watching){
  if (lv !== li) loadLevel(lv);
  const rep = unpackReplay(replay);
  if (!rep) return false;                                     // nothing is shown rather than something wrong
  rival = watched = {name:String(name), ticks:rep.ticks, iv:rep.iv, pts:rep.pts};
  reset();
  if (!watching){ play(); return true; }
  mode = 'watch'; closeModal(); document.body.classList.add('play','watch'); Snd.init(); Snd.resume(); hud();
  return true;
}
window.Thruster = Thruster;

// ---- Go ----
li = Math.min(store.level||0, store.unlocked||0); L = LEVELS[li]; setGeom();
resize(); buildMain(); reset(); showMenu(); requestAnimationFrame(frame);
