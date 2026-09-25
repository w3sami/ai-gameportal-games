'use strict';
// Thruster: flight model, input, menus, audio, progression.
const DT = 1/120, DEG = Math.PI/180;
const P = { gravity:220, thrust:540, turnRate:210 };          // flight model, fixed for the shipped game
const HULL = [[0,-14],[-9,10],[9,10],[0,11]];                 // nose, fins, tail: the points tested against the mask

// ---- Storage ----
const SKEY = 'thruster-v1';
const SDEF = { radius:64, dead:0.2, expo:1.3, buttons:0, sound:1 };
let store = { bests:{}, level:0, unlocked:0, settings:{...SDEF} };
let devUnlock = false;                                        // every level open in the menu: the portal's debug toggle, see js/devmode.js. Never saved
try { const s = localStorage.getItem(SKEY); if (s){ const o = JSON.parse(s); store = Object.assign(store, o); store.settings = Object.assign({...SDEF}, o.settings||{}); } } catch (e) {}
const S = store.settings;
delete S.relative;                                            // retired: steering is always relative to the rocket
function save(){ try { localStorage.setItem(SKEY, JSON.stringify(store)); } catch (e) {} }
// A new best is recorded on the frame the rocket touches the pad, which is also the frame the confetti spawns. Stringifying
// the whole store and handing it to localStorage is a synchronous write of tens of kilobytes, right where the eye is. The
// store is already correct in memory, so the write only has to happen soon: idle time, or on the way out of the page.
let savePend = false;
function saveSoon(){
  if (savePend) return; savePend = true;
  const run = () => { savePend = false; save(); };
  if (window.requestIdleCallback) requestIdleCallback(run, {timeout:1500}); else setTimeout(run, 400);
}
function saveNow(){ if (savePend){ savePend = false; save(); } }
addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
let li = 0;


// ---- Canvas, layers, collision mask ----
const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
let vw = 1, vh = 1, dpr = 1, Z = 1, mainC = null, mask = null, motes = [];
function buildMain(){
  freeLayer(mainC);
  mainC = renderLayer(1, STYLE.main, 0, 0);            // tiled; see art.js
  mask = mainC.mask; mainC.mask = null;
  WALLS.build();                                       // depth walls, traced from the mask; see art.js
}
function isSolid(x,y){ if (x<0||y<0||x>=L.w||y>=L.h) return true; return mask[(y|0)*L.w+(x|0)] === 1; }
function buildMotes(){
  const r = rng(L.rooms[0].seed*13+1); motes = [];
  for (let i=0;i<L.w*L.h/50000;i++) motes.push({x:r()*L.w, y:r()*L.h, s:1+r()*1.6, v:4+r()*8});
}
function resize(){
  vw = innerWidth; vh = innerHeight; dpr = Math.min(devicePixelRatio||1, 2);
  cv.width = Math.round(vw*dpr); cv.height = Math.round(vh*dpr); cv.style.width = vw+'px'; cv.style.height = vh+'px';
  Z = Math.max(Math.min(Math.max(vw/1000, 0.6), 1.15), vw/L.w, vh/L.h);
  placeControls();                                     // nothing in the level art depends on the viewport any more
  redraw();
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
  let ac = null, noise = null, thrGain = null, thrFilt = null, wetGain = null, thrOn = -1, wetOn = -1;
  let white = null, fxBus = null, verbIn = null, sat = null;
  let windGain = null, windLp = null, howlA = null, howlB = null, windStep = -1;
  function init(){
    if (ac) return;
    try { ac = new (window.AudioContext||window.webkitAudioContext)(); } catch (e) { return; }
    const n = ac.sampleRate*2; noise = ac.createBuffer(1, n, ac.sampleRate); const d = noise.getChannelData(0); let last = 0;
    for (let i=0;i<n;i++){ const w = Math.random()*2-1; last = (last+0.02*w)/1.02; d[i] = last*3.5; }   // brown noise
    // Thrust: the brown-noise roar, plus a growl (sub-160 Hz noise, driven, then cut at 700 Hz so its overtones fill the low
    // mids without adding air), both wobbled by an irregular level flutter of held 15–60 ms steps. Nothing above ~1 kHz
    // is added: brighter versions read as hiss. All of it runs continuously behind thrGain; thrust() only flips that.
    const sr0 = ac.sampleRate, loopSrc = b => { const s = ac.createBufferSource(); s.buffer = b; s.loop = true; s.start(0, Math.random()*b.duration); return s; };
    const lpf = (f, q) => { const x = ac.createBiquadFilter(); x.type = 'lowpass'; x.frequency.value = f; x.Q.value = q||0.7; return x; };
    const gn = v => { const g = ac.createGain(); g.gain.value = v; return g; };
    const mb = ac.createBuffer(1, sr0*3, sr0), m = mb.getChannelData(0); let lv = 1, sm = 1;
    for (let i=0, next=0;i<m.length;i++){ if (i >= next){ lv = Math.random() < 0.15 ? 1.7+Math.random()*0.5 : 0.3+Math.random(); next = i + sr0*(0.015+Math.random()*0.045); }
      sm += (lv-sm)*0.005; m[i] = sm-1; }                                                           // zero-mean, added onto a gain of 1
    const flut = gn(1); loopSrc(mb).connect(gn(0.55)).connect(flut.gain);
    thrFilt = lpf(500); loopSrc(noise).connect(thrFilt).connect(flut);
    const drv = ac.createWaveShaper(), dc = new Float32Array(1024); for (let i=0;i<1024;i++) dc[i] = Math.tanh((i/511.5-1)*3); drv.curve = dc;
    loopSrc(noise).connect(lpf(160, 1)).connect(gn(2)).connect(drv).connect(lpf(700)).connect(lpf(700)).connect(gn(0.6)).connect(flut);
    thrGain = ac.createGain(); thrGain.gain.value = 0;
    flut.connect(thrGain).connect(ac.destination);
    const ws = ac.createBufferSource(); ws.buffer = noise; ws.loop = true;                          // waterfall hush: the same noise, brighter
    const wf = ac.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 1400; wf.Q.value = 0.5;
    wetGain = ac.createGain(); wetGain.gain.value = 0; ws.connect(wf).connect(wetGain).connect(ac.destination); ws.start();
    // Crash kit: white noise, a dark ~1.5 s cave reverb, and a compressor bus so stacked crashes (crash, R, crash) never
    // clip. There is no debris layer: a bed of clicks was tried, and read as a rattle even when softened.
    const sr = ac.sampleRate;
    white = ac.createBuffer(1, sr, sr); { const w = white.getChannelData(0); for (let i=0;i<w.length;i++) w[i] = Math.random()*2-1; }
    fxBus = ac.createDynamicsCompressor();
    fxBus.threshold.value = -16; fxBus.knee.value = 10; fxBus.ratio.value = 5; fxBus.attack.value = 0.002; fxBus.release.value = 0.3;
    const fxOut = ac.createGain(); fxOut.gain.value = 0.62; fxBus.connect(fxOut).connect(ac.destination);
    const ir = ac.createBuffer(2, Math.round(sr*1.8), sr);
    for (let ch=0;ch<2;ch++){ const r = ir.getChannelData(ch); let lp = 0;
      for (let i=0;i<r.length;i++){ const t = i/sr; lp += (Math.random()*2-1 - lp)*0.18; r[i] = lp*Math.exp(-t/0.3)*(t < 0.012 ? t/0.012 : 1); } }
    const verb = ac.createConvolver(); verb.buffer = ir; verbIn = ac.createGain(); verbIn.gain.value = 0.4; verbIn.connect(verb).connect(fxBus);
    sat = new Float32Array(1024); for (let i=0;i<1024;i++){ const x = i/511.5-1; sat[i] = Math.tanh(x*3)/Math.tanh(3); }
    // Wind: mostly howl. Two narrow resonant bands of white noise, each drifting on its own slow clock so they wander in
    // and out of each other, over a quiet whoosh whose lowpass opens with the gust. wind() raises the howls' pitch with
    // the gust too, so how hard it is pushing can be heard as well as seen.
    const wander = (secs, rate) => { const b = ac.createBuffer(1, sr*secs, sr), a = b.getChannelData(0); let tg = 0, v = 0;   // smooth zero-mean ±1 drift
      for (let i=0, nx=0;i<a.length;i++){ if (i >= nx){ tg = Math.random()*2-1; nx = i + sr*rate*(0.5+Math.random()); } v += (tg-v)*0.00003; a[i] = v; }
      const e = a[a.length-1]; for (let i=0;i<a.length;i++) a[i] -= e*i/a.length;                  // no step at the loop point
      return b; };
    const wsum = gn(1), wlo = ac.createBiquadFilter(); wlo.type = 'highpass'; wlo.frequency.value = 180;
    windLp = lpf(650, 0.5); const swell = gn(1); loopSrc(wander(9, 0.9)).connect(gn(0.35)).connect(swell.gain);
    loopSrc(white).connect(wlo).connect(windLp).connect(swell).connect(gn(0.3)).connect(wsum);   // whoosh, kept low
    const band = (f, q, secs, rate, depth, vol) => { const b = ac.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q;
      loopSrc(wander(secs, rate)).connect(gn(depth)).connect(b.frequency); loopSrc(white).connect(b).connect(gn(vol)).connect(wsum); return b; };
    howlA = band(600, 7, 11, 1.6, 220, 2.4);
    howlB = band(950, 9, 13, 2.1, 260, 2.04);
    windGain = gn(0); wsum.connect(windGain).connect(ac.destination);
  }
  function resume(){ if (ac && ac.state === 'suspended') ac.resume(); }
  // Both are called every frame. Each call used to append fresh automation events to the params' timelines, three per
  // frame and forever; now they only schedule when the state actually flips (the sound toggle counts as a flip).
  function water(on){ if (!ac) return; const k = on && S.sound ? 1 : 0; if (k === wetOn) return; wetOn = k; wetGain.gain.setTargetAtTime(k ? 0.5 : 0, ac.currentTime, on ? 0.05 : 0.2); }
  function thrust(on){ if (!ac) return; const k = on && S.sound ? 1 : 0; if (k === thrOn) return; thrOn = k;
    thrGain.gain.setTargetAtTime(k ? 0.26 : 0, ac.currentTime, on ? 0.04 : 0.1); thrFilt.frequency.setTargetAtTime(on ? 900 : 400, ac.currentTime, 0.1); }
  // k: strength of the wind field the rocket is in, 0 outside. Also called every frame, so it is quantised to twentieths
  // and only schedules when the step changes, the same rule as water() and thrust().
  function wind(k){ if (!ac) return; const q = S.sound ? Math.round(k*20) : 0; if (q === windStep) return; windStep = q;
    const v = q/20, t = ac.currentTime, p = 1+0.45*(v-0.6);
    windGain.gain.setTargetAtTime(0.285*v, t, 0.12); windLp.frequency.setTargetAtTime(650+850*v, t, 0.2);
    howlA.frequency.setTargetAtTime(600*p, t, 0.35); howlB.frequency.setTargetAtTime(950*p, t, 0.35); }
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
  // One looped noise source through a filter chain and an envelope into the crash bus and the cave send.
  // env: [attack, peak, hold, decay τ]. Filter stages are factories that build their node at the start time.
  function voice(buf, rate, filt, env){
    const t = ac.currentTime+0.005, s = ac.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; s.loop = true;
    const g = ac.createGain(), [at, pk, hold, tau] = env, end = t+at+hold+tau*6;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t+at); g.gain.setTargetAtTime(0, t+at+hold, tau);
    let node = s; for (const f of filt){ f(t); node.connect(f.node); node = f.node; }
    node.connect(g); g.connect(fxBus); g.connect(verbIn);
    s.start(t, Math.random()*buf.duration); s.stop(end);
  }
  const bq = (type, f0, f1, dur, q) => { const f = x => { f.node = ac.createBiquadFilter(); f.node.type = type; f.node.Q.value = q||0.7;
    f.node.frequency.setValueAtTime(f0, x); if (f1) f.node.frequency.exponentialRampToValueAtTime(f1, x+dur); }; return f; };
  const bqp = (type, pts, q) => { const f = x => { f.node = ac.createBiquadFilter(); f.node.type = type; f.node.Q.value = q||0.7;
    f.node.frequency.setValueAtTime(pts[0][0], x); for (let i=1;i<pts.length;i++) f.node.frequency.exponentialRampToValueAtTime(pts[i][0], x+pts[i][1]); }; return f; };
  const drive = () => { const f = () => { f.node = ac.createWaveShaper(); f.node.curve = sat; }; return f; };
  // No pitched layer: a falling sine with a fast attack is how a kick drum is made, and it read as a hit. The low end is
  // driven brown noise swelling in over ~40 ms, and the fireball's filter blooms open before it closes: a 'whoomp'. No
  // snap on top either: even a soft one pulled it back towards a hit.
  function boom(){
    if (!ac || !S.sound) return; const v = () => 0.9+Math.random()*0.2;
    voice(white,   v(), [bqp('lowpass', [[500,0],[2200*v(),0.05],[150,0.55]], 0.8)],      [0.02,  0.8, 0.06,  0.21]);   // fireball
    voice(noise,   v(), [bq('lowpass', 150, 70, 0.85, 1.1), drive(), bq('lowpass', 900)], [0.04,  0.9, 0.08,  0.27]);   // low whoomp; the drive keeps it audible on phone speakers
    voice(noise,   v(), [bq('lowpass', 260, 90, 1.1)],                                    [0.07,  1.1, 0.08,  0.29]);   // rumble
  }
  return {
    init, resume, thrust, water, wind,
    explode: boom,
    land(sp){ const v = Math.min(0.7, 0.15+sp/500); burst(0.18, 700, 120, v); tone(55, 0.25, v*0.8, 'sine'); },
    finish(){ tone(523, 0.18, 0.25, 'triangle'); tone(784, 0.22, 0.25, 'triangle', 0.14); tone(1046, 0.4, 0.22, 'triangle', 0.28); },
    click(){ tone(660, 0.06, 0.08, 'square'); },
    crack(){ burst(0.28, 3200, 700, 0.35); },
    thud(){ burst(0.3, 520, 80, 0.8); tone(58, 0.25, 0.5, 'sine'); },
  };
})();

// ---- Game state ----
let ship, ghost = null, gPath = null, best = null, particles = [], ticks = 0, gTick = 0, running = false, gRec = [], deadT = 0, shake = 0, doneT = 0;
let mode = 'menu', wet = false, caveK = 0;                   // menu | play | paused | complete; wet: rocket inside a waterfall; caveK: 0 jungle → 1 cave backdrop
const cam = {x:0,y:0};
const keys = {thrust:false,left:false,right:false};
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const normAng = a => { a = (a+Math.PI) % (2*Math.PI); if (a<0) a += 2*Math.PI; return a-Math.PI; };
const fmt = t => { const s = t/120, m = Math.floor(s/60); return `${m}:${(s-m*60).toFixed(2).padStart(5,'0')}`; };

function spawn(){ const p = L.pads.start; return {x:p.x+p.w/2, y:p.y-11, vx:0, vy:0, a:0, state:'idle', flame:0}; }
// Render interpolation. The sim steps at 120 Hz and the display runs at whatever it runs at, so a frame usually lands
// between two ticks: at 60 Hz that is two ticks a frame give or take jitter, at 90 Hz a 1-1-2 cadence, at 144 Hz some
// frames get none. Drawing the latest tick as-is shows that cadence as judder against the smoothly following camera.
// Instead the pose at the start of the last tick is kept, and render() draws the blend at acc/DT between it and the
// current one. Render-side only: nothing the sim reads is touched, so runs and ghosts stay exact.
const PREV = {x:0, y:0, a:0}, SR = {x:0, y:0, a:0, flame:0}, GR = {};
function snapPrev(){ PREV.x = ship.x; PREV.y = ship.y; PREV.a = ship.a; for (const z of hazards){ z.pdy = z.dy; z.pa = z.a; } }
function reset(){
  ship = spawn(); best = store.bests[li] || null; ghost = null; gPath = null;
  if (best && best.path){ try { gPath = GP.decode(GP.unb64(best.path)); ghost = GP.pose(gPath, 0, {}); } catch (e) { gPath = null; ghost = null; } }
  ticks = 0; gTick = 0; running = false; gRec = []; for (const p of particles) PPOOL.push(p); particles.length = 0; deadT = 0; doneT = 0; wet = false; setMsg('',''); hazardReset();
  cam.x = ship.x - vw/(2*Z); cam.y = ship.y - vh/(2*Z);
  snapPrev();                                                // a restart is a jump, not a move: nothing to blend from
  redraw();
  hud();
}
function loadLevel(i){
  li = Math.max(0, Math.min(LEVELS.length-1, i)); L = LEVELS[li]; store.level = li; menuCh = chapterOf(li); menuSel = li; save();
  for (const z of hazards) z.sprite.c.width = z.sprite.c.height = 0;
  setGeom(); applyTheme(); buildMain(); buildHazards(); buildMotes(); resize(); reset();
}

// ---- Forces: regions that push the rocket (waterfalls, wind, vents, magnets). Level data `forces`:
//   rect   {kind, x,y,w,h, ax,ay, drag?}       constant acceleration inside, optional velocity drag per second
//   circle {kind, cx,cy,r, strength}           radial, linear falloff to the edge; positive pulls in, negative pushes out
//   either may add {period, duty, phase} in seconds to cycle on and off. Timing runs on sim ticks, so replays stay exact.
//   water adds {pool:{x,w,h}} for the pool it lands in. kind ∈ water | wind | gas, which only changes how it is drawn.
// A cycling force does not snap on. `duty` is the time it spends at full strength; the build and the dying away are added
// around that, so the window is duty + ramp + 1.5·ramp long and the lull is whatever is left of the period. Ramps are
// squeezed proportionally if they would not fit. The envelope is a pure function of the tick — no stored state — so a
// replay still lands on the same numbers.
const RAMP = 0.6;
function forceLevel(f, tick){
  if (!f.period) return 1;
  const duty = f.duty === undefined ? 1 : f.duty; if (duty >= 1) return 1;
  const full = f.period*duty, rp = f.ramp === undefined ? RAMP : f.ramp;
  const sq = Math.min(1, (f.period-full)/(2.5*rp || 1));     // never let build + decay run past the end of the cycle
  const ri = rp*sq, ro = rp*1.5*sq, on = full+ri+ro;
  const t = (((tick*DT + (f.phase||0)) % f.period) + f.period) % f.period;
  if (t >= on) return 0;
  const u = Math.max(0, Math.min(1, ri > 0 ? t/ri : 1, ro > 0 ? (on-t)/ro : 1));
  return u*u*(3-2*u);                                        // smoothstep: no kink where the ramp meets the plateau
}
const forceOn = (f, tick) => forceLevel(f, tick) > 0;
const inRect = (f, x, y) => x >= f.x && x <= f.x+f.w && y >= f.y && y <= f.y+f.h;
function applyForces(s, tick, fs){
  for (const f of fs || L.forces || []){
    const k = forceLevel(f, tick); if (k <= 0) continue;
    if (f.r !== undefined){
      const dx = f.cx-s.x, dy = f.cy-s.y, d = Math.hypot(dx,dy); if (d > f.r || d < 1) continue;
      const a = (f.strength||0)*k*(1-d/f.r)/d; s.vx += dx*a*DT; s.vy += dy*a*DT;
    } else if (inRect(f, s.x, s.y)){
      s.vx += (f.ax||0)*k*DT; s.vy += (f.ay||0)*k*DT;
      if (f.drag){ const q = Math.exp(-f.drag*k*DT); s.vx *= q; s.vy *= q; }
    }
  }
}
const inWater = s => (L.forces||[]).some(f => f.kind === 'water' && f.r === undefined && inRect(f, s.x, s.y));
function windAt(s){ let k = 0; for (const f of L.forces||[]) if (f.kind === 'wind' && f.r === undefined && inRect(f, s.x, s.y)) k = Math.max(k, forceLevel(f, ticks)); return k; }   // for the sound only

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
// Saves from before ghost paths hold a tick-by-tick input recording. Those still replay exactly (the flight model has
// not moved), so each one is converted to a path once, at startup, rather than thrown away along with the ghost.
// The replay needs no collision mask: a finished run never touches rock, and only a pad can stop it early. Forces do
// apply, so a converted ghost still drifts down a waterfall the way it did on the run.
function padZones(lev){ return Object.values(lev.pads).map(p => ({x:p.x-14, w:p.w+28, y:p.y})); }
function stepFree(s, inp, zones, fs, tick){
  if (s.state === 'idle' || s.state === 'landed'){ if (!inp.thrust) return; s.state = 'flying'; }
  if (s.state !== 'flying') return;
  s.a = normAng(s.a + inp.steer*P.turnRate*DEG*DT);
  const th = inp.thrust ? P.thrust : 0;
  s.vx += Math.sin(s.a)*th*DT; s.vy += (-Math.cos(s.a)*th + P.gravity)*DT;
  applyForces(s, tick, fs);
  s.flame = inp.thrust ? 1 : 0;
  const sp = Math.hypot(s.vx,s.vy), n = Math.ceil(sp*DT/2) || 1;
  for (let i=0;i<n;i++){
    s.x += s.vx*DT/n; s.y += s.vy*DT/n;
    if (s.vy < 0) continue;
    const c = Math.cos(s.a), sn = Math.sin(s.a);
    for (const [lx,ly] of HULL){
      const px = s.x+lx*c-ly*sn, py = s.y+lx*sn+ly*c;
      for (const z of zones) if (px>=z.x && px<=z.x+z.w && py>=z.y-1 && py<=z.y+10){ settle(s, z); return; }
    }
  }
}
function migrateBests(){
  let changed = false;
  for (const key of Object.keys(store.bests)){
    const b = store.bests[key], lev = LEVELS[key];
    if (!b || !b.inputs) continue;
    if (!b.path && lev){
      try {
        const zones = padZones(lev), fs = lev.forces || [], p0 = lev.pads.start, step = GP.STEP;
        const s = {x:p0.x+p0.w/2, y:p0.y-11, vx:0, vy:0, a:0, state:'idle', flame:0}, rec = [GP.sample(s)];
        for (let t=1;t<=b.inputs.length;t++){
          const c = b.inputs[t-1]|0;
          stepFree(s, {thrust:c&1, steer:((c>>1)-15)/15}, zones, fs, t-1);
          if (t % step === 0) rec.push(GP.sample(s));
        }
        const tail = b.inputs.length % step; if (tail) rec.push(GP.sample(s));
        b.path = GP.b64(GP.encode(rec, step, tail));
      } catch (e) {}
    }
    delete b.inputs; changed = true;                            // the time is kept whether or not the ghost converted
  }
  if (changed) save();
}

function tick(){
  snapPrev();
  const inp = readInput();
  if (ship.state === 'dead'){ deadT -= DT; if (deadT <= 0) reset(); }
  else if (ship.state === 'finished'){ doneT -= DT; if (doneT <= 0 && mode === 'play') showComplete(); }
  else {
    if (!running && ship.state === 'idle' && inp.thrust){ running = true; gRec = [GP.sample(ship)]; }
    if (running){
      ticks++;
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
      if (ship.state !== 'dead' && ship.state !== 'finished' && ticks % GP.STEP === 0) gRec.push(GP.sample(ship));
      if (ship.state === 'flying' && ship.flame) emitThrust(ship);
      wet = ship.state === 'flying' && inWater(ship);
      if (wet && ticks % 3 === 0) spray(ship);
      froth();
    }
  }
  if (ghost && running) GP.pose(gPath, ++gTick, ghost);       // the ghost is replayed, not re-simulated
  updateParticles();
}
let lastResult = null;
function finish(){
  const prev = store.bests[li], isBest = !prev || ticks < prev.ticks;
  if (isBest){
    const tail = ticks % GP.STEP; if (tail) gRec.push(GP.sample(ship));             // the landed pose closes the path
    store.bests[li] = {ticks, path:GP.b64(GP.encode(gRec, GP.STEP, tail))};
  }
  if (li >= store.unlocked) store.unlocked = Math.min(LEVELS.length-1, li+1);
  saveSoon(); Snd.finish();
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
    const rad = Math.max(...pts.map(p => Math.hypot(p[0]-h.x, p[1]-h.y)));   // reach from the pivot; rotation keeps it, the drop moves the pivot
    return {h, pts, probe, sprite, rad, col: h.kind === 'branch' ? '120,86,52' : null, state:'hang', t:0, a:0, dy:0, vy:0};
  });
}
function hazardReset(){ for (const z of hazards){ z.state = 'hang'; z.t = 0; z.a = 0; z.dy = 0; z.vy = 0; z.pa = 0; z.pdy = 0; } }
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
    // The rocket's hull reaches 14 px from its centre and the vertex test is 9 px, so beyond rad+16 of the pivot neither
    // test can hit: skip posing the spike at all. Same answers as before, without two arrays per hazard per tick.
    if (Math.hypot(s.x-h.x, s.y-h.y-z.dy) > z.rad+16) continue;
    const pts = posePts(z, z.pts), c = Math.cos(s.a), sn = Math.sin(s.a);    // hull points inside the spike, or spike vertices inside the rocket
    for (const [lx,ly] of HULL){ const px = s.x+lx*c-ly*sn, py = s.y+lx*sn+ly*c; if (pip(px,py,pts)) return {px,py,kind:h.kind}; }
    for (const p of pts){ if (Math.hypot(p[0]-s.x, p[1]-s.y) < 9) return {px:p[0], py:p[1], kind:h.kind}; }
  }
  return null;
}

// ---- Particles ----
// Pooled: a waterfall throws up 240 droplets a second and the exhaust another 240, each a fresh object that lived half a
// second. Dead particles go back to PPOOL and are refilled in place, so steady flight allocates nothing.
const PPOOL = [];
function addP(x, y, vx, vy, life, max, sz, kind, col){
  const p = PPOOL.pop() || {};
  p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = max; p.sz = sz; p.kind = kind; p.col = col;
  particles.push(p);
}
function emitThrust(s){
  const dx = -Math.sin(s.a), dy = Math.cos(s.a), ox = s.x+dx*11, oy = s.y+dy*11;
  for (let i=0;i<2;i++){ const sp = 160+Math.random()*180, j = (Math.random()-0.5)*70;
    addP(ox, oy, dx*sp+dy*j+s.vx*0.5, dy*sp-dx*j+s.vy*0.5, 0.22+Math.random()*0.18, 0.4, 2.5+Math.random()*2, 0, null); }
}
function explode(px,py){
  for (let i=0;i<50;i++){ const a = Math.random()*6.283, sp = 60+Math.random()*260; addP(px, py, Math.cos(a)*sp, Math.sin(a)*sp-80, 0.8+Math.random()*1.2, 2, 1.5+Math.random()*3, 1, null); }
  for (let i=0;i<40;i++){ const a = Math.random()*6.283, sp = 120+Math.random()*420; addP(px, py, Math.cos(a)*sp, Math.sin(a)*sp, 0.3+Math.random()*0.5, 0.8, 2+Math.random()*3, 0, null); }
  addP(px, py, 0, 0, 0.45, 0.45, 0, 2, null);
}
function celebrate(px,py){
  const cols = ['90,212,110','184,245,194','255,255,255','227,162,60'];   // rgb triples: the alpha is quantised and cached, see PFX
  for (let i=0;i<140;i++){ const a = -Math.PI*(0.1+0.8*Math.random()), sp = 180+Math.random()*420;
    addP(px+(Math.random()-0.5)*40, py, Math.cos(a)*sp, Math.sin(a)*sp, 1.0+Math.random()*1.4, 2.4, 2.5+Math.random()*3.5, 3, cols[i%4]); }
  for (let i=0;i<3;i++) addP(px, py, 0, 0, 0.7+i*0.2, 0.7+i*0.2, 160+i*90, 2, 'rgba(120,235,150,');
}
function crumbs(px,py,n,col){
  for (let i=0;i<n;i++) addP(px+(Math.random()-0.5)*24, py, (Math.random()-0.5)*30, 20+Math.random()*50, 0.4+Math.random()*0.4, 0.8, 1.5+Math.random()*2, 1, col||null);
}
function shatter(px,py,v,col){
  for (let i=0;i<26;i++){ const a = -Math.PI*Math.random(), sp = 60+Math.random()*Math.min(420, v*0.7); addP(px+(Math.random()-0.5)*20, py, Math.cos(a)*sp, Math.sin(a)*sp, 0.5+Math.random()*0.7, 1.2, 2+Math.random()*4, 1, col||null); }
}
function spray(s){
  const a = Math.random()*6.283, v = 40+Math.random()*120;
  addP(s.x+(Math.random()-0.5)*16, s.y+(Math.random()-0.5)*16, Math.cos(a)*v+s.vx*0.3, Math.sin(a)*v-40, 0.3+Math.random()*0.3, 0.6, 1.5+Math.random()*2, 1, '200,228,255');
}
function froth(){                                                                                   // droplets thrown up where each visible waterfall meets its pool
  for (const f of L.forces||[]){ if (f.kind !== 'water' || f.r !== undefined || !f.pool) continue;
    if (f.x+f.w < cam.x-100 || f.x > cam.x+vw/Z+100 || f.y+f.h < cam.y-100 || f.y+f.h-200 > cam.y+vh/Z) continue;
    for (let k=0;k<2;k++){ const px = f.x-30+Math.random()*(f.w+60), py = f.y+f.h-f.pool.h-2, v = 140+Math.random()*260;
      addP(px, py, (Math.random()-0.5)*220, -v, 0.4+Math.random()*0.5, 0.9, 3+Math.random()*3.5, 1, '235,246,255'); }
  }
}
function puff(px,py,sp){
  for (let i=0;i<Math.min(40, sp/12);i++){ const a = -Math.PI*Math.random(), v = 40+Math.random()*sp*0.5; addP(px, py, Math.cos(a)*v, Math.sin(a)*v*0.4, 0.3+Math.random()*0.4, 0.7, 2+Math.random()*3, 1, null); }
}
function updateParticles(){
  for (let i=particles.length-1;i>=0;i--){ const p = particles[i]; p.life -= DT;
    if (p.kind === 1){ p.vy += P.gravity*0.6*DT; p.x += p.vx*DT; p.y += p.vy*DT; if (isSolid(p.x,p.y)) p.life = 0; }
    else if (p.kind === 3){ p.vy += P.gravity*0.9*DT; p.vx *= 0.995; p.x += p.vx*DT; p.y += p.vy*DT; if (isSolid(p.x,p.y)){ p.vy *= -0.45; p.vx *= 0.6; p.y -= p.vy*DT*2; if (Math.abs(p.vy) < 20) p.life = Math.min(p.life, 0.3); } }
    else if (p.kind === 0){ p.vx *= 0.97; p.vy *= 0.97; p.x += p.vx*DT; p.y += p.vy*DT; }
    if (p.life <= 0){ PPOOL.push(p); particles[i] = particles[particles.length-1]; particles.pop(); }   // swap-remove: what moves down was already stepped this frame
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
// Particle paint kit. Two things here are only about cost. Colours come out of a table quantised to 16 steps of alpha, so
// no rgba() string is built or re-parsed while a burst is alive. And a fire spark is a pre-rendered disc blitted at size
// rather than an arc path filled in a colour mixed per particle per frame — hue, lightness and alpha all ride the spark's
// life, so a single step index covers the lot.
const PFX = (() => {
  const STEPS = 16, tab = new Map(), DEF = '236,230,218', R = 16, GLOW = [];
  for (let i=0;i<12;i++){
    const t = i/11, c = mkCanvas(2*R+2, 2*R+2), x = c.getContext('2d');
    x.fillStyle = `hsla(${20+40*t},100%,${55+35*t}%,${t})`;
    x.beginPath(); x.arc(R+1, R+1, R, 0, 6.283); x.fill(); GLOW.push(c);
  }
  const col = (rgb, a) => { let v = tab.get(rgb); if (!v){ v = []; for (let i=0;i<=STEPS;i++) v.push(`rgba(${rgb},${(i/STEPS).toFixed(3)})`); tab.set(rgb, v); } return v[(a*STEPS + 0.5)|0]; };
  return {col, DEF, GLOW, k:(R+1)/R};
})();
// Drawn in two passes, plain then additive, so the composite mode is set twice a frame rather than twice per particle.
// A 140-piece celebration used to cost some 560 canvas state changes in the frame it spawned, and each one breaks the
// batch the driver was building; even ordinary flight was flipping it a hundred-odd times a frame for the exhaust. The
// picture is the same: additive blending does not care what order things are added in, and nothing here is opaque.
function drawParticles(){
  let additive = 0;
  for (const p of particles){                                        // pass one: matte grit, spray, froth, debris
    if (p.kind !== 1){ additive++; continue; }
    const t = Math.max(0, p.life/p.max);
    ctx.fillStyle = PFX.col(p.col || PFX.DEF, t*0.9);
    ctx.fillRect(p.x-p.sz/2, p.y-p.sz/2, p.sz, p.sz);
  }
  if (!additive) return;
  ctx.globalCompositeOperation = 'lighter';                          // pass two: sparks, confetti, shockwave rings
  for (const p of particles){
    if (p.kind === 1) continue;
    const t = Math.max(0, p.life/p.max);
    if (p.kind === 0){ const r = (p.sz*t+0.5)*PFX.k; ctx.drawImage(PFX.GLOW[(t*11 + 0.5)|0], p.x-r, p.y-r, 2*r, 2*r); }
    else if (p.kind === 3){ ctx.fillStyle = PFX.col(p.col, Math.min(1, t*1.5)); ctx.fillRect(p.x-p.sz/2, p.y-p.sz/2, p.sz, p.sz*0.6); }
    else { ctx.strokeStyle = (p.col||'rgba(255,190,120,')+t+')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, (1-t)*(p.sz||110), 0, 6.283); ctx.stroke(); }
  }
  ctx.globalCompositeOperation = 'source-over';
}

const CAVE_IN = { top:'#0a0b10', bottom:'#030305' };
const inRockZone = (x, y) => (L.rockZones||[]).some(z => { const dx = (x-z.x)/z.r, dy = (y-z.y)/(z.ry||z.r); return dx*dx+dy*dy <= 1; });
const mixHex = (a, b, k) => { const A = parseInt(a.slice(1),16), B = parseInt(b.slice(1),16), ch = sh => Math.round(((A>>sh)&255)*(1-k)+((B>>sh)&255)*k); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; };

// Backdrop glows: big soft radial lights in level space, drifting at the backdrop's parallax (bf). Painting five or six
// full-screen radial gradients every frame cost as much as all the terrain together, so each set is baked once into a
// small canvas laid out in parallax space (level px × Z × bf) and blitted as one scaled image. Source-over is associative,
// so glows composited among themselves first and then over the sky come out as they did painted one by one. A jungle
// level keeps a second, cave plane for the crossfade inside rock zones. Rebaked when the level, theme or zoom changes.
const GLOWS = (() => {
  let key = '', planes = [];
  function bake(glows, bf, am){
    const R = g => g.r*(L.w+L.h)*0.5*Z*0.7, P = glows.map(g => ({g, x:g.u*L.w*Z*bf, y:g.v*L.h*Z*bf, r:R(g)}));
    const x0 = Math.min(...P.map(p => p.x-p.r)), y0 = Math.min(...P.map(p => p.y-p.r)), x1 = Math.max(...P.map(p => p.x+p.r)), y1 = Math.max(...P.map(p => p.y+p.r));
    // Painted at twice the kept resolution and halved, so the gradients' own dither averages out instead of being
    // blown up into a visible mottle when the plane is stretched to the screen.
    const s = Math.min(0.25, 1024/Math.max(x1-x0, y1-y0)), W = Math.ceil((x1-x0)*s), H = Math.ceil((y1-y0)*s);
    const big = mkCanvas(2*W, 2*H), x = big.getContext('2d');
    x.scale(2*s, 2*s); x.translate(-x0, -y0);
    for (const p of P){                                           // the stops the live version used; am is baked in, not applied as alpha later,
      const a0 = parseFloat(p.g.c.match(/[\d.]+\)$/)[0]), rg = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);   // because overlapping glows do not scale linearly
      rg.addColorStop(0, p.g.c.replace(/[\d.]+\)$/, (a0*am).toFixed(3)+')')); rg.addColorStop(0.55, p.g.c.replace(/[\d.]+\)$/, (0.12*am).toFixed(3)+')')); rg.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = rg; x.fillRect(p.x-p.r, p.y-p.r, 2*p.r, 2*p.r);
    }
    const c = mkCanvas(W, H), cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(big, 0, 0, W, H); big.width = big.height = 0;
    return {c, x0, y0, s};
  }
  function draw(pl, bf, am){
    if (am < 0.02) return;
    const ox = pl.x0 - cam.x*Z*bf + vw/2*(1-bf), oy = pl.y0 - cam.y*Z*bf + vh/2*(1-bf), w = pl.c.width/pl.s, h = pl.c.height/pl.s;
    const ix0 = Math.max(0, ox), iy0 = Math.max(0, oy), ix1 = Math.min(vw, ox+w), iy1 = Math.min(vh, oy+h);
    if (ix1 <= ix0 || iy1 <= iy0) return;
    ctx.globalAlpha = am;
    ctx.drawImage(pl.c, (ix0-ox)*pl.s, (iy0-oy)*pl.s, (ix1-ix0)*pl.s, (iy1-iy0)*pl.s, ix0, iy0, ix1-ix0, iy1-iy0);
    ctx.globalAlpha = 1;
  }
  return (jb, k2) => {
    const k = li + '|' + Z + '|' + (STYLE === THEMES.cave ? 'c' : 'j');
    if (k !== key){ key = k; for (const p of planes) p.c.width = p.c.height = 0;
      planes = [bake(jb.glows, jb.f, 1)]; if (STYLE !== THEMES.cave) planes.push(bake(THEMES.cave.bg.glows, jb.f, 0.6)); }
    draw(planes[0], jb.f, 1-k2);                                  // exact at either end of the crossfade, a close blend between
    if (k2 > 0 && planes[1]) draw(planes[1], jb.f, k2);
  };
})();

// ---- Wind and gas: streaks along the push, with leaves, grit and dust riding them ----
// The field's strength is the force's own envelope (forceLevel), read a beat early so the air visibly stirs just before it
// pushes — what you see is what the rocket is about to get. Everything else here comes off the wall clock and a per-streak
// hash, never the sim, so none of it can shift a run or a ghost. Flow distance is integrated (s.flow) rather than taken as
// wall time times a changing speed — the latter differentiates to spd + t·spd', and with t large a slowing gust drags the
// whole field backwards.
const WFX = new WeakMap();                                          // force object -> {k, gp, flow, bits}
const WLEAD = Math.round(0.25/DT);                                  // ticks the visuals run ahead of the push
const WIND_LEAF = ['#4e8a3c','#3d7c38','#67a84e','#8a6a34','#a5823f','#2c5a2a'], WIND_GRIT = ['#9aa0a8','#b3ab9c','#7f858d','#c9c2b4'];
const WIND_DUST = {jungle:['#d7e4a6','#cfe0b4','#e9e3c8','#b9d18e'], cave:['#dcd6c9','#c4cbd4','#eae4d6']};
const WTIER = [[1,0.15],[2,0.26],[3.4,0.4]];                        // streak weights: line width, alpha at full strength
const hash2 = (i,k) => { let x = (i*374761393 + k*668265263) | 0; x = Math.imul(x ^ x>>>13, 1274126177); return ((x ^ x>>>16) >>> 0) / 4294967296; };
const isAir = f => f.r === undefined && (f.kind === 'wind' || f.kind === 'gas');
function windState(f){ let s = WFX.get(f); if (!s){ s = {k:forceLevel(f,0), gp:hash2((f.x|0)+1,(f.y|0)+3)*6.283, flow:0, bits:[]}; WFX.set(f,s); } return s; }
const gustAt = (s,t) => 0.72 + 0.34*Math.sin(t*0.37 + s.gp) + 0.16*Math.sin(t*1.06 + s.gp*2.1);   // two octaves, seeded per zone so two fields never pulse together
const windSpd = (s,g) => (40 + 310*s.k)*(0.55+0.5*g);
// One airborne bit. dust: tiny, never sinks, still drifting through the lull. Otherwise a leaf (jungle) or a grit sliver (cave).
function windBit(f, ux, uy, x0, y0, x1, y1, scatter, dust){
  const R = Math.random, jungle = L.theme === 'jungle';
  let x, y;
  if (scatter){ x = x0+R()*(x1-x0); y = y0+R()*(y1-y0); }
  else {                                                            // blown in from whichever edge the wind comes from
    x = ux > 0 ? x0-30-R()*140 : ux < 0 ? x1+30+R()*140 : x0+R()*(x1-x0);
    y = uy > 0 ? y0-30-R()*140 : uy < 0 ? y1+30+R()*140 : y0+R()*(y1-y0);
    if (ux && uy){ if (R() < 0.5) y = y0+R()*(y1-y0); else x = x0+R()*(x1-x0); }
  }
  if (dust){
    const cols = f.kind === 'gas' ? ['#bfe79c','#d8f0bc'] : WIND_DUST[jungle ? 'jungle' : 'cave'], a = R()*6.283, idl = 5+R()*13;
    return {x, y, vx:0, vy:0, dust:true, ph:R()*6.283, pr:0.5+R()*1.3, fa:5+R()*14, g:0.85+R()*0.5, dr:2.2+R()*2.2,
            ix:Math.cos(a)*idl, iy:Math.sin(a)*idl*0.5, sz:1+R()*1.6, al:0.3+R()*0.45, col:cols[(R()*cols.length)|0]};
  }
  const cols = f.kind === 'gas' ? ['#a9dd85','#87c45f','#c7e8a6'] : jungle ? WIND_LEAF : WIND_GRIT;
  const leaf = jungle && f.kind !== 'gas' ? R() < 0.82 : R() < 0.15;
  return {x, y, vx:0, vy:0, a:R()*6.283, sp:(R()<0.5?-1:1)*(0.7+R()*2.3), ph:R()*6.283, pr:1.5+R()*3, fa:14+R()*34,
          g:0.7+R()*0.65, dr:1.3+R()*1.8, sz:(leaf?5:3)+R()*(leaf?7:5), col:cols[(R()*cols.length)|0], leaf};
}
// Populations are sized from the visible part of the zone, so a 6000 px wide field is no denser on screen than a small one.
function updateWindFx(dt, t){
  for (const f of L.forces||[]){
    if (!isAir(f)) continue;
    const s = windState(f);
    s.k = Math.max(forceLevel(f, ticks), forceLevel(f, ticks+WLEAD));   // same envelope as the push, a quarter second early
    const am = Math.hypot(f.ax||0, f.ay||0) || 1, ux = (f.ax||0)/am, uy = (f.ay||0)/am;
    const x0 = Math.max(f.x, cam.x-160), y0 = Math.max(f.y, cam.y-160), x1 = Math.min(f.x+f.w, cam.x+vw/Z+160), y1 = Math.min(f.y+f.h, cam.y+vh/Z+160);
    if (x1 <= x0 || y1 <= y0){ s.bits.length = 0; continue; }       // off screen: let the field empty out
    const gust = gustAt(s,t);
    s.flow += windSpd(s, Math.max(0.15, Math.min(1.45, gust)))*dt;
    const spd = (75 + am*0.42)*(0.25+0.75*s.k)*Math.max(0.3, gust); // the debris trails the air a little
    for (const b of s.bits){
      b.ph += b.pr*dt;
      const fl = Math.sin(b.ph), m = 1-Math.exp(-b.dr*dt);
      if (b.dust){ const ds = spd*b.g*0.85;                         // motes ride the air and keep drifting through the lull
        b.vx += (ux*ds - uy*fl*b.fa + b.ix*(1-0.6*s.k) - b.vx)*m;
        b.vy += (uy*ds + ux*fl*b.fa + b.iy*(1-0.6*s.k) - b.vy)*m;
      } else {
        b.vx += (ux*spd*b.g - uy*fl*b.fa - b.vx)*m;
        b.vy += (uy*spd*b.g + ux*fl*b.fa + (1-s.k)*150 - b.vy)*m;   // leaves sag as the gust drops
        b.a += b.sp*dt*(0.35 + Math.hypot(b.vx,b.vy)/520);
      }
      b.x += b.vx*dt; b.y += b.vy*dt;
    }
    let nd = 0, nu = 0;
    for (let i=s.bits.length-1;i>=0;i--){ const b = s.bits[i];
      if (b.x < x0-240 || b.x > x1+240 || b.y < y0-240 || b.y > y1+240) s.bits.splice(i,1); else if (b.dust) nu++; else nd++; }
    const area = (x1-x0)*(y1-y0), wantD = Math.round(Math.max(6, Math.min(46, area/24000))*(0.45+0.55*s.k)), wantU = Math.round(Math.max(10, Math.min(80, area/13000)));
    const edge = () => Math.random() < 0.3+0.7*s.k;                 // in still air they appear where they are, not blown in
    for (let g=0; nd < wantD && g < 10; g++, nd++) s.bits.push(windBit(f, ux, uy, x0, y0, x1, y1, nd < wantD*0.6 || !edge(), false));
    for (let g=0; nu < wantU && g < 14; g++, nu++) s.bits.push(windBit(f, ux, uy, x0, y0, x1, y1, nu < wantU*0.7 || !edge(), true));
  }
}
// The bits go in under the main layer, so the terrain occludes them for nothing.
function drawWindBits(f){
  const s = WFX.get(f); if (!s) return;
  for (const b of s.bits){
    if (b.dust){ ctx.globalAlpha = b.al*(0.75+0.25*Math.sin(b.ph)); ctx.fillStyle = b.col; ctx.fillRect(b.x-b.sz/2, b.y-b.sz/2, b.sz, b.sz); ctx.globalAlpha = 1; continue; }
    const flat = 0.2+0.8*Math.abs(Math.cos(b.ph));                  // the tumble: a leaf goes edge-on twice a turn
    ctx.save(); ctx.translate(b.x,b.y); ctx.rotate(b.a); ctx.fillStyle = b.col;
    if (b.leaf){ const w = b.sz, h = b.sz*0.52*flat;
      ctx.beginPath(); ctx.moveTo(-w,0); ctx.lineTo(0,-h); ctx.lineTo(w,0); ctx.lineTo(0,h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.26)'; ctx.beginPath(); ctx.moveTo(-w,0); ctx.lineTo(0,h); ctx.lineTo(w,0); ctx.closePath(); ctx.fill();
    } else ctx.fillRect(-b.sz*0.7, -b.sz*0.18*flat, b.sz*1.4, Math.max(1, b.sz*0.36*flat));
    ctx.restore();
  }
}
// Streaks: three weights, one stroke each. Every streak gets its own lane, phase, speed, length and meander from the hash.
function drawWindStreaks(f, t){
  const s = windState(f), am = Math.hypot(f.ax||0, f.ay||0) || 1, ux = (f.ax||0)/am, uy = (f.ay||0)/am, nx = -uy, ny = ux;
  const span = Math.abs(ux)*f.w + Math.abs(uy)*f.h, cross = Math.abs(nx)*f.w + Math.abs(ny)*f.h;
  const bx = f.x + ((ux < 0 || nx < 0) ? f.w : 0), by = f.y + ((uy < 0 || ny < 0) ? f.h : 0);
  const gust = Math.max(0.15, Math.min(1.45, gustAt(s,t))), k = s.k;
  const CX = v => Math.max(f.x, Math.min(f.x+f.w, v)), CY = v => Math.max(f.y, Math.min(f.y+f.h, v));
  const base = f.kind === 'gas' ? '170,225,130' : '225,232,240', n = Math.max(24, Math.min(240, Math.round(f.w*f.h/9000)));
  angular(ctx); ctx.lineCap = 'butt';
  for (let ti=0; ti<3; ti++){
    const g2 = ti === 2 ? gust*gust*0.8 : 1;                        // the heavy lines only show at the top of a gust
    ctx.lineWidth = WTIER[ti][0]; ctx.strokeStyle = `rgba(${base},${(WTIER[ti][1]*(0.12+0.88*k)*g2).toFixed(3)})`;
    ctx.beginPath();
    for (let i=ti; i<n; i+=3){
      const c = hash2(i,1)*cross, ph = hash2(i,2), sf = 0.6+hash2(i,3)*0.85, sl = 26+hash2(i,4)*(ti === 2 ? 150 : 80),
            wl = 0.002+hash2(i,5)*0.005, wa = 5+hash2(i,6)*22, d = (s.flow*sf + ph*span*3.7) % span;
      const Q = dd => { const o = c + Math.sin(ph*6.283 + t*0.12 + dd*wl)*wa; return [bx+ux*dd+nx*o, by+uy*dd+ny*o]; };   // the lane meanders in space; the streak slides along it
      const p1 = Q(d), p2 = Q(d-sl*0.45), p3 = Q(d-sl);
      if (!inRect(f,p1[0],p1[1]) && !inRect(f,p3[0],p3[1])) continue;
      ctx.moveTo(CX(p3[0]),CY(p3[1])); ctx.lineTo(CX(p2[0]),CY(p2[1])); ctx.lineTo(CX(p1[0]),CY(p1[1]));
    }
    ctx.stroke();
  }
}

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
    } else if (isAir(f)){                                                                               // wind, gas: bits under the terrain, streaks over it
      if (over) drawWindStreaks(f, t); else drawWindBits(f);
    }
  }
}
function drawRadial(f, t){                                                                             // a magnet: sparks converging (pull) or leaving (push)
  const k = forceLevel(f, ticks); ctx.strokeStyle = `rgba(255,200,120,${(0.08+0.37*k).toFixed(3)})`; ctx.lineWidth = 2; ctx.beginPath();
  for (let i=0;i<14;i++){ const a = i/14*6.283 + t*0.3, ph = ((t*0.8 + i*0.13) % 1), d = (f.strength >= 0 ? 1-ph : ph)*f.r, d2 = Math.max(0, d-18); ctx.moveTo(f.cx+Math.cos(a)*d, f.cy+Math.sin(a)*d); ctx.lineTo(f.cx+Math.cos(a)*d2, f.cy+Math.sin(a)*d2); }
  ctx.stroke();
}

// Outside play the sim is stopped and a menu sits over the scene behind a full-screen backdrop blur. Repainting the
// scene every frame there made the browser re-blur it every frame too, for a picture that has stopped moving: a steady
// GPU load, and battery, for as long as someone reads the leaderboard. So once play stops, the scene is drawn for
// another SETTLE frames (long enough for the camera to come to rest) and then left alone until something changes it.
// Waterfalls and wind behind a menu hold still as a result. redraw() wakes it: reset and resize call it.
const SETTLE = 60;
let last = performance.now(), acc = 0, still = 0;
function redraw(){ still = 0; }
function frame(now){
  let dt = (now-last)/1000; last = now; if (dt > 0.1) dt = 0.1;
  if (mode === 'play'){ acc += dt; while (acc >= DT){ tick(); acc -= DT; } still = 0; } else acc = 0;
  if (still < SETTLE){ render(dt); if (mode !== 'play') still++; }
  requestAnimationFrame(frame);
}
function render(dt){
  const al = mode === 'play' ? Math.min(1, acc/DT) : 1, mix = (a, b) => a+(b-a)*al;   // outside play the sim is still: draw it as it is
  SR.x = mix(PREV.x, ship.x); SR.y = mix(PREV.y, ship.y); SR.a = PREV.a + normAng(ship.a-PREV.a)*al; SR.flame = ship.flame;
  const k = 1-Math.exp(-5*dt);
  cam.x += (SR.x + ship.vx*0.3 - vw/(2*Z) - cam.x)*k;
  cam.y += (SR.y + ship.vy*0.3 - vh/(2*Z) - cam.y)*k;
  cam.x = Math.max(0, Math.min(L.w - vw/Z, cam.x)); cam.y = Math.max(0, Math.min(L.h - vh/Z, cam.y));
  shake *= Math.exp(-4*dt);
  const sx = reduced ? 0 : (Math.random()-.5)*shake*14, sy = reduced ? 0 : (Math.random()-.5)*shake*14;

  ctx.setTransform(dpr,0,0,dpr,0,0);
  // inside a rock zone the backdrop crossfades to the cave theme's, so a cave carved into a jungle level feels like a cave
  caveK += ((inRockZone(SR.x, SR.y) ? 1 : 0) - caveK)*(1-Math.exp(-3*dt));
  const jb = STYLE.bg, k2 = STYLE === THEMES.cave ? 0 : caveK;
  const vg = ctx.createLinearGradient(0,0,0,vh); vg.addColorStop(0,mixHex(jb.top, CAVE_IN.top, k2)); vg.addColorStop(1,mixHex(jb.bottom, CAVE_IN.bottom, k2));   // darker than the cave chapter itself: a hole in the daylight
  ctx.fillStyle = vg; ctx.fillRect(0,0,vw,vh);
  GLOWS(jb, k2);
  WALLS.draw(sx, sy);
  if (hazards.length){
    ctx.save(); ctx.translate(-cam.x*Z+sx, -cam.y*Z+sy); ctx.scale(Z,Z);
    for (const z of hazards){ if (z.state === 'gone') continue; const h = z.h, sp = z.sprite;
      ctx.save(); ctx.translate(h.x, h.y+mix(z.pdy, z.dy)); ctx.rotate(mix(z.pa, z.a)); ctx.drawImage(sp.c, sp.ox-h.x, sp.oy-h.y); ctx.restore(); }
    ctx.restore();
  }
  const tsec = performance.now()/1000;
  if (L.forces) updateWindFx(dt, tsec);                                                                 // wind fields: visual state only, wall time
  ctx.save(); ctx.translate(-cam.x*Z+sx, -cam.y*Z+sy); ctx.scale(Z,Z); drawForces(tsec, false); ctx.restore();   // pools and airborne bits, under the terrain
  drawLayer(ctx, mainC, -cam.x*Z+sx, -cam.y*Z+sy, Z, vw, vh);

  ctx.save(); ctx.translate(-cam.x*Z+sx, -cam.y*Z+sy); ctx.scale(Z,Z);
  drawParticles();
  if (ghost && gPath) drawShip(GP.pose(gPath, Math.max(0, gTick-1+al), GR), true);   // the path is a spline in ticks: sample it between them
  if (ship.state !== 'dead') drawShip(SR, false);
  drawForces(tsec, true);
  ctx.restore();
  const mf = 1.3; ctx.fillStyle = STYLE.bg.mote || 'rgba(217,211,199,.16)';
  for (const m of motes){ if (mode === 'play'){ m.y -= m.v*dt; if (m.y < 0) m.y += L.h; } const mx = (m.x-cam.x)*Z*mf + vw/2*(1-mf) + sx*mf, my = (m.y-cam.y)*Z*mf + vh/2*(1-mf) + sy*mf; if (mx>-4 && mx<vw+4 && my>-4 && my<vh+4) ctx.fillRect(mx, my, m.s, m.s); }

  Snd.thrust(mode === 'play' && ship.state === 'flying' && ship.flame);
  Snd.water(mode === 'play' && wet);
  Snd.wind(mode === 'play' && ship.state === 'flying' ? windAt(ship) : 0);
  if (ticks !== hudTicks){ hudTicks = ticks; timerEl.textContent = fmt(ticks); }        // DOM writes only when something shows a change
  if (!S.buttons){ const t = `rotate(${SR.a.toFixed(3)}rad) translateY(${-S.radius+4}px)`; if (t !== hudHdg){ hudHdg = t; hdgEl.style.transform = t; } }
}
let hudTicks = -1, hudHdg = '';

// ---- HUD ----
const timerEl = $('timer'), lvlEl = $('lvl'), bestEl = $('bestline'), msgMain = $('msgMain'), msgSub = $('msgSub');
function setMsg(a,b){ msgMain.textContent = a; msgSub.textContent = b; }
function hud(){
  lvlEl.textContent = `${li+1}. ${L.name}`;
  bestEl.textContent = best ? `Best ${fmt(best.ticks)}${ghost ? ', ghost flying' : ''}` : '';
}

// ---- Menus ----
const modal = $('modal'), box = $('box');
function openModal(html){ box.innerHTML = html; modal.classList.add('open'); document.body.classList.remove('play'); }
function closeModal(){ modal.classList.remove('open'); }
// Levels are grouped into chapters (CHAPTERS in levels.js). The menu shows one chapter at a time, with arrows to move between them.
const chapterOf = i => { let c = 0; for (let k=0;k<CHAPTERS.length;k++) if (i >= CHAPTERS[k].start) c = k; return c; };
const chapterRange = c => [CHAPTERS[c].start, c+1 < CHAPTERS.length ? CHAPTERS[c+1].start : LEVELS.length];
let menuCh = 0, menuSel = 0;                                   // menuSel: the level picked in the menu, which is built only once it is flown
function tiles(){
  const [a,b] = chapterRange(menuCh), ch = CHAPTERS[menuCh];
  return `<div class="chap"><button class="nav" data-ch="-1" ${menuCh===0?'disabled':''} aria-label="Previous chapter">◀</button><h2>Chapter ${menuCh+1}: ${ch.name}</h2><button class="nav" data-ch="1" ${menuCh===CHAPTERS.length-1?'disabled':''} aria-label="Next chapter">▶</button></div>` +
    `<div class="grid">` + LEVELS.slice(a,b).map((l,k) => { const i = a+k, bst = store.bests[i], locked = !devUnlock && i > store.unlocked;
    return `<button class="tile${i===menuSel?' sel':''}" data-l="${i}" ${locked?'disabled':''}><b>${i+1}</b><small>${l.name}</small><em>${locked ? 'locked' : bst ? fmt(bst.ticks) : '—'}</em></button>`; }).join('') + `</div>`;
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
    <div class="row"><button class="btn pri" data-act="start">Fly level ${menuSel+1}</button></div>${settingsRow()}`);
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
// Building a level is synchronous and takes from a tenth of a second to a few on the big jungle levels, during which
// nothing can paint. So the build goes in a task of its own after a frame that shows "Loading…": the tap visibly lands,
// and the freeze reads as loading rather than as a hang. busy swallows a second tap queued behind the first.
const loadEl = document.createElement('div');
loadEl.textContent = 'Loading…';
loadEl.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:50;display:none;pointer-events:none;padding:10px 18px;border-radius:10px;background:rgba(13,14,18,.88);border:1px solid rgba(255,255,255,.12);font-weight:600;letter-spacing:.04em';
document.body.append(loadEl);
let busy = false;
function withLoading(fn){
  if (busy) return; busy = true; loadEl.style.display = 'block';
  requestAnimationFrame(() => setTimeout(() => { try { fn(); } finally { busy = false; loadEl.style.display = 'none'; } }, 0));
}
// Picking a tile only moves the selection; the level is built when it is flown. Browsing chapter 2 used to cost a full
// build per tap. The scene behind the menu keeps showing the level last flown until then.
function fly(){
  if (!mainC || busy) return;                                  // still building the first level
  if (menuSel !== li) withLoading(() => { loadLevel(menuSel); play(); });
  else { reset(); play(); }
}
function flyNext(){ withLoading(() => { loadLevel(li+1); play(); }); }
box.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return; Snd.init(); Snd.click();
  if (t.dataset.l !== undefined){ const n = +t.dataset.l;       // first tap picks the level, a second tap on it flies
    if (n === menuSel) fly(); else { menuSel = n; showMenu(); } return; }
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
    case 'start': fly(); break;
    case 'resume': play(); break;
    case 'restart': reset(); play(); break;
    case 'next': flyNext(); break;
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
  steer = Math.round(steer*15)/15;                                   // quantise so the steering feels the same on every device
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
    if (mode === 'menu') fly();
    else if (mode === 'paused') play();
    else if (mode === 'complete'){ if (li < LEVELS.length-1) flyNext(); else { reset(); showMenu(); } }
  }
  else if (mode === 'complete' && e.key.toLowerCase() === 'r'){ reset(); play(); }
});
addEventListener('keyup', e => { const k = KEYMAP[e.key]; if (k) keys[k] = false; });

// ---- Go ----
migrateBests();
li = Math.min(store.level||0, store.unlocked||0); L = LEVELS[li]; menuCh = chapterOf(li); menuSel = li; setGeom(); applyTheme();
resize(); showMenu();                                          // the menu goes up first, so a returning pilot on a big level sees it at once
withLoading(() => { buildMain(); buildHazards(); buildMotes(); reset(); requestAnimationFrame(frame); });
