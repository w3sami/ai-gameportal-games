/* Space Taxi — yksi vuoro.
 *
 * Säännöt ovat Muse Softwaren 1984 C64-pelistä: painovoima vetää koko ajan,
 * suuntasuuttimet kiihdyttävät, ja laskutelineen pitää olla alhaalla ennen
 * kosketusta. Teline alhaalla sivusuuttimet eivät toimi — se on alkuperäisen
 * kauppa ja samalla se mikä tekee lähestymisestä päätöksen eikä refleksin.
 * Matkustaja ilmestyy alustalle, kertoo minne haluaa, ja maksaa perillä sitä
 * enemmän mitä nopeammin ja pehmeämmin keikka meni. Kun molemmilla alustoilla
 * on käyty, katon luukku aukeaa.
 *
 * Kenttä on kiinteä 720x1040 ja kangas sovitetaan siihen (contain), joten
 * geometria on sama joka näytöllä. Ohjaussauva ja debug-paneeli tulevat
 * portaalin plugineista vN-aliaksella.
 */
import { createJoystick } from 'https://plugins.game.bigbools.fi/joystick/v1/index.js';
import { createDebugPanel } from 'https://plugins.game.bigbools.fi/debug-panel/v1/index.js';
import { mountBoard } from './leaderboard.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const card = document.getElementById('card');

/* ------------------------------------------------------------------ kenttä */
const W = 720, H = 1040;
const GATE = { x: 300, w: 120 };

const WALLS = [
  { x: 0, y: 0, w: GATE.x, h: 16 },                        // katto, luukun vasen puoli
  { x: GATE.x + GATE.w, y: 0, w: W - GATE.x - GATE.w, h: 16 },
  { x: 0, y: H - 16, w: W, h: 16 },                        // lattia
  { x: 0, y: 0, w: 16, h: H },
  { x: W - 16, y: 0, w: 16, h: H },
  { x: 16, y: 300, w: 214, h: 20 },                        // hylly vasemmalla, alustan 2 korkeudella
  { x: 540, y: 640, w: 164, h: 20 },                       // hylly oikealla, tankkauksen korkeudella
  { x: 16, y: 800, w: 184, h: 20 },                        // hylly vasemmalla alhaalla
];
const GATE_BAR = { x: GATE.x, y: 0, w: GATE.w, h: 16 };    // kiinni ollessaan tavallinen seinä

const PADS = [
  { id: 1, x: 250, y: 950, w: 210, h: 18, fuel: false },
  { id: 2, x: 490, y: 300, w: 214, h: 18, fuel: false },
  { id: 0, x: 285, y: 640, w: 150, h: 18, fuel: true },
];
const padById = id => PADS.find(p => p.id === id);

const TW = 54, TH = 28, GEAR = 14;                         // taksin runko ja telineen pituus
const FUEL_MAX = 100;

/* Säädettävät kertoimet yhdessä paikassa, jotta debug-paneeli pääsee niihin
   kiinni. Nämä ovat ne numerot joita vuoro 1 on olemassa hiomaan. */
const P = {
  grav: 250, thrust: 680,
  landVY: 135, landVX: 75, softVY: 50,
  burn: 12, refuel: 36, price: 0.9,
  fare: 45, tip: 55, tipTime: 22, exitBonus: 40,
};

const GEAR_BOX = { x: W - 158, y: H - 172, w: 128, h: 96 };
const MUTE_BOX = { x: 24, y: H - 74, w: 46, h: 46 };

/* ------------------------------------------------------------------ kangas */
let scale = 1, dpr = 1, lastVW = -1, lastVH = -1;

/* Kehyksen ensimmäinen mittaus voi iframen sisällä tapahtua ennen kuin frame
   on saanut oikean kokonsa, eikä resize-tapahtumaa ole luvattu seuraavan.
   Siksi koko luetaan myös joka ruudulla; työ tehdään vain jos se muuttui. */
function resize() {
  const de = document.documentElement;
  const vw = de.clientWidth || window.innerWidth || 1;
  const vh = de.clientHeight || window.innerHeight || 1;
  if (vw === lastVW && vh === lastVH) return;
  lastVW = vw; lastVH = vh;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  scale = Math.min(vw / W, vh / H);
  canvas.width = Math.round(W * scale * dpr);
  canvas.height = Math.round(H * scale * dpr);
  canvas.style.width = Math.round(W * scale) + 'px';
  canvas.style.height = Math.round(H * scale) + 'px';
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(document.documentElement);
resize();

if (!ctx.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);

/* ------------------------------------------------------------------- äänet
   Kaikki syntetisoidaan; peli ei tuo mukanaan yhtään tiedostoa. */
let actx = null, muted = false;
try { muted = localStorage.getItem('spacetaxi.muted') === '1'; } catch (e) {}

function audio() {
  if (muted) return null;
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { actx = new AC(); } catch (e) { return null; }
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function tone(freq, dur, opts) {
  const a = audio(); if (!a) return;
  opts = opts || {};
  const o = a.createOscillator(), g = a.createGain();
  o.type = opts.type || 'sine';
  const t0 = a.currentTime + (opts.delay || 0);
  o.frequency.setValueAtTime(freq, t0);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain || 0.18, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(dur, gain, from, to) {
  const a = audio(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'lowpass';
  const t0 = a.currentTime;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = a.createGain(); g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}

/* Suutin on jatkuva ääni, ei sarja napsahduksia: yksi silmukoiva kohina,
   jonka voimakkuus ja suodin seuraavat kaasua. */
let jet = null;
function jetLevel(v) {
  if (v <= 0 && !jet) return;
  const a = audio();
  if (!a) { if (jet) jet.g.gain.value = 0; return; }
  if (!jet) {
    const n = Math.floor(a.sampleRate * 2);
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = a.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
    jet = { src, f, g };
  }
  jet.g.gain.setTargetAtTime(v * 0.085, a.currentTime, 0.04);
  jet.f.frequency.setTargetAtTime(420 + v * 950, a.currentTime, 0.05);
}

const sfx = {
  gear() { tone(180, 0.12, { type: 'square', gain: 0.06, to: 120 }); },
  land() { tone(220, 0.14, { type: 'triangle', gain: 0.12, to: 320 }); },
  pickup() {
    tone(520, 0.09, { type: 'triangle', gain: 0.14 });
    tone(780, 0.12, { type: 'triangle', gain: 0.12, delay: 0.07 });
  },
  hey() { tone(400, 0.16, { type: 'sawtooth', gain: 0.10, to: 250 }); },
  pay() {
    tone(660, 0.10, { type: 'triangle', gain: 0.16 });
    tone(990, 0.12, { type: 'triangle', gain: 0.14, delay: 0.08 });
    tone(1320, 0.18, { type: 'triangle', gain: 0.10, delay: 0.16 });
  },
  gate() { tone(160, 0.5, { type: 'sawtooth', gain: 0.10, to: 640 }); },
  crash() {
    noise(0.55, 0.38, 2400, 90);
    tone(300, 0.5, { type: 'sawtooth', gain: 0.16, to: 55 });
  },
  pump() { tone(90, 0.06, { type: 'square', gain: 0.04 }); },
  warn() { tone(320, 0.11, { type: 'square', gain: 0.05 }); },
  win() {
    tone(523, 0.12, { type: 'triangle', gain: 0.15 });
    tone(659, 0.12, { type: 'triangle', gain: 0.15, delay: 0.11 });
    tone(784, 0.14, { type: 'triangle', gain: 0.15, delay: 0.22 });
    tone(1047, 0.30, { type: 'triangle', gain: 0.14, delay: 0.34 });
  },
};

/* ------------------------------------------------------------------- tila */
const MENU = 0, PLAY = 1, OVER = 2;
let state = MENU;

let taxi, money, fuel, lives, job, served, gateOpen, runT, dead, deadT,
    msg, msgT, bits, lowWarn;

const stars = [];
for (let i = 0; i < 70; i++) {
  stars.push({ x: rand(20, W - 20), y: rand(20, H - 20), r: rand(0.6, 1.8), a: rand(0.1, 0.5), p: rand(0, 6.3) });
}

function newRun() {
  money = 40; lives = 3; runT = 0;
  served = { 1: false, 2: false };
  gateOpen = false;
  bits = []; lowWarn = 0;
  msg = ''; msgT = 0;
  job = null;
  resetTaxi();
  /* Ensimmäinen asiakas on ylhäällä alustalla 2: vuoro alkaa lennolla eikä
     siitä että kaveri kävelee valmiiksi kyytiin. */
  newJob(2, 1, 1.0);
}

// Uusi taksi tulee tankki täynnä — alkuperäisessäkin polttoaine nollataan.
function resetTaxi() {
  const p = padById(1);
  taxi = {
    x: p.x + p.w / 2, y: p.y - (TH / 2 + GEAR),
    vx: 0, vy: 0, gear: 1, gearWant: true, landed: p,
  };
  fuel = FUEL_MAX;
  dead = false; deadT = 0;
}

function newJob(from, to, delay) {
  const p = padById(from);
  job = {
    from, to, phase: 'wait', wait: delay || 0,
    x: rand(p.x + 26, p.x + p.w - 26), t: 0, walk: 0, shown: false,
  };
}

function say(text, secs) { msg = text; msgT = secs || 2.4; }

function burst(x, y, color, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(speed * 0.25, speed);
    bits.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, color, r: rand(1.5, 4.5) });
  }
}

/* ------------------------------------------------------------------ syöte */
const KEY = Object.create(null);

function toLogical(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left) / r.width * W, y: (clientY - r.top) / r.height * H };
}
const inBox = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
const onButtons = p => inBox(p, GEAR_BOX) || inBox(p, MUTE_BOX);

function toggleGear() {
  if (state !== PLAY || dead) return;
  if (taxi.landed) return;                    // maassa teline pysyy alhaalla
  taxi.gearWant = !taxi.gearWant;
  sfx.gear();
}

function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('spacetaxi.muted', muted ? '1' : '0'); } catch (e) {}
  if (muted && jet) jet.g.gain.value = 0;
  if (!muted) sfx.gear();
}

canvas.addEventListener('pointerdown', e => {
  const p = toLogical(e.clientX, e.clientY);
  if (inBox(p, GEAR_BOX)) { toggleGear(); return; }
  if (inBox(p, MUTE_BOX)) toggleMute();
});

addEventListener('keydown', e => {
  KEY[e.code] = true;
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (e.code === 'Space' || e.code === 'KeyG') { e.preventDefault(); toggleGear(); }
  if (e.code === 'Enter' && state !== PLAY) { e.preventDefault(); start(); }
});
addEventListener('keyup', e => { KEY[e.code] = false; });

// Ohjaussauva syntyy sormen alle mistä tahansa, paitsi nappien päältä.
const stick = createJoystick({
  target: canvas,
  toLocal: toLogical,
  radius: 96,
  ignore: onButtons,
});

/** Ohjausvektori: näppäimet voittavat kun ne ovat pohjassa, muuten sauva. */
function inputVector() {
  const kx = (KEY.ArrowRight || KEY.KeyD ? 1 : 0) - (KEY.ArrowLeft || KEY.KeyA ? 1 : 0);
  const ky = (KEY.ArrowDown || KEY.KeyS ? 1 : 0) - (KEY.ArrowUp || KEY.KeyW ? 1 : 0);
  if (kx || ky) {
    const l = Math.hypot(kx, ky) || 1;
    return { x: kx / l, y: ky / l };
  }
  if (stick.active) {
    let x = stick.x * stick.gain, y = stick.y * stick.gain;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  return { x: 0, y: 0 };
}

/** Mitä suuttimista tulee ulos juuri nyt — sekä fysiikkaan että liekkeihin. */
function activeThrust() {
  if (state !== PLAY || dead || fuel <= 0) return { x: 0, y: 0 };
  const v = inputVector();
  if (taxi.gear > 0.35) v.x = 0;              // teline alhaalla: ei sivusuuttimia
  if (taxi.landed) { v.x = 0; if (v.y > 0) v.y = 0; }
  return v;
}

/* ------------------------------------------------------------- törmäykset */
function taxiBox(t) {
  const gl = GEAR * t.gear;
  return { x: t.x - TW / 2, y: t.y - TH / 2, w: TW, h: TH + gl };
}
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function solids() {
  const list = WALLS.slice();
  if (!gateOpen) list.push(GATE_BAR);
  for (const p of PADS) list.push(p);
  return list;
}

function crash(reason) {
  if (dead) return;
  dead = true; deadT = 0;
  lives--;
  if (job && job.phase === 'aboard') {
    newJob(job.from, job.to, 1.2);
    say('Keikka meni — ' + reason, 3);
  } else say(reason, 3);
  burst(taxi.x, taxi.y, '#ffd479', 34, 420);
  burst(taxi.x, taxi.y, '#ff5d7a', 26, 320);
  jetLevel(0);
  sfx.crash();
}

function touchdown(pad, b) {
  const t = taxi;
  if (t.gear < 0.85) return crash('Laskuteline ylhäällä');
  if (t.vy > P.landVY) return crash('Liian kova lasku');
  if (Math.abs(t.vx) > P.landVX) return crash('Sivuluisu');
  if (b.x < pad.x - 2 || b.x + b.w > pad.x + pad.w + 2) return crash('Jalka ilmassa');

  const soft = t.vy;
  t.y = pad.y - (TH / 2 + GEAR * t.gear);
  t.vx = 0; t.vy = 0; t.landed = pad; t.gearWant = true;
  sfx.land();
  onLanded(pad, soft);
}

/* --------------------------------------------------------- keikkalogiikka */
function onLanded(pad, softness) {
  if (!job) return;

  if (job.phase === 'aboard' && pad.id === job.to) {
    const mult = softness < P.softVY ? 1 : softness < P.landVY * 0.75 ? 0.6 : 0.25;
    const tip = Math.round(P.tip * Math.max(0, 1 - job.t / P.tipTime) * mult);
    const fare = P.fare + tip;
    money += fare;
    served[pad.id] = true;
    say(`Kiitos! ${fare} € (tippi ${tip} €)`, 2.6);
    burst(taxi.x, taxi.y - 20, '#6fe3ff', 16, 160);
    sfx.pay();
    job = null;

    if (served[1] && served[2]) {
      gateOpen = true;
      setTimeout(() => {
        if (state === PLAY && served[1] && served[2]) { say('Ylös, kiitos!', 4); sfx.gate(); }
      }, 900);
    } else {
      newJob(pad.id, served[1] ? 2 : 1, 1.4);
    }
    return;
  }

  /* Alkuperäisessä kyydin päälle laskeutuminen saa asiakkaan huutamaan ja
     vaihtamaan paikkaa. Sama tässä: laskeudu viereen, älä päälle. */
  if (job.phase === 'wait' && pad.id === job.from && job.shown) {
    const b = taxiBox(taxi);
    if (job.x > b.x - 6 && job.x < b.x + b.w + 6) {
      const p = padById(job.from);
      job.x = job.x < p.x + p.w / 2
        ? rand(p.x + p.w - 60, p.x + p.w - 18)
        : rand(p.x + 18, p.x + 60);
      say('Hei!', 1.4);
      sfx.hey();
    }
  }
}

function jobStep(dt) {
  if (!job) return;
  if (job.phase === 'aboard') { job.t += dt; return; }

  if (job.wait > 0) { job.wait -= dt; return; }
  if (!job.shown) { job.shown = true; say('Hei, taksi!', 2.2); sfx.hey(); }

  // Kyytiin vain pysäköidystä taksista samalla alustalla.
  if (dead || !taxi.landed || taxi.landed.id !== job.from) return;
  const b = taxiBox(taxi);
  const target = job.x < taxi.x ? b.x - 8 : b.x + b.w + 8;
  const d = target - job.x;
  job.x += Math.sign(d) * Math.min(Math.abs(d), 95 * dt);
  job.walk += dt * 9;
  if (Math.abs(d) < 3) {
    job.phase = 'aboard'; job.t = 0;
    say(`Alusta ${job.to}, kiitos`, 2.4);
    sfx.pickup();
  }
}

const fareNow = () => job && job.phase === 'aboard'
  ? P.fare + Math.round(P.tip * Math.max(0, 1 - job.t / P.tipTime))
  : 0;

/* ---------------------------------------------------------------- päivitys */
function update(dt) {
  runT += dt;
  if (msgT > 0) msgT -= dt;
  stepBits(dt);

  if (dead) {
    deadT += dt;
    jetLevel(0);
    if (deadT > 1.4) {
      if (lives <= 0) return gameOver(false);
      resetTaxi();
    }
    return;
  }

  // teline animoituu; maassa se on aina alhaalla
  const want = taxi.landed ? 1 : (taxi.gearWant ? 1 : 0);
  taxi.gear += clamp(want - taxi.gear, -dt * 4, dt * 4);

  const v = activeThrust();
  const raw = inputVector();

  if (taxi.landed) {
    jetLevel(0);
    if (taxi.landed.fuel) refuel(dt);
    // Kuiva tankki muulla kuin tankkauslautasella on vuoron loppu, ei jumi.
    if (fuel <= 0.5 && !taxi.landed.fuel) { crash('Tankki kuivui'); return; }
    if (raw.y < -0.2 && fuel > 0) taxi.landed = null;
    else { jobStep(dt); return; }
  }

  const throttle = Math.min(1, Math.hypot(v.x, v.y));
  if (throttle > 0) {
    const had = fuel;
    fuel = Math.max(0, fuel - P.burn * throttle * dt);
    if (had > 0 && fuel <= 0) say('Tankki kuiva!', 3);
  }
  jetLevel(throttle);

  if (fuel < 20 && fuel > 0) {
    lowWarn -= dt;
    if (lowWarn <= 0) { sfx.warn(); lowWarn = 0.35 + fuel / 60; }
  } else lowWarn = 0;

  taxi.vx += v.x * P.thrust * dt;
  taxi.vy += v.y * P.thrust * dt + P.grav * dt;

  /* Liike pilkotaan osiin, jotta kova pudotus ei hyppää alustan läpi. */
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(taxi.vx), Math.abs(taxi.vy)) * dt / 6));
  const sd = dt / steps;
  for (let i = 0; i < steps && !dead && state === PLAY; i++) move(sd);

  if (!dead && state === PLAY) jobStep(dt);
}

function move(dt) {
  const before = taxiBox(taxi);
  const prevBottom = before.y + before.h;
  taxi.x += taxi.vx * dt;
  taxi.y += taxi.vy * dt;
  const b = taxiBox(taxi);

  if (gateOpen && b.y + b.h < 0) return finish();

  if (taxi.vy >= 0) {
    for (const p of PADS) {
      if (b.x + b.w > p.x && b.x < p.x + p.w && b.y + b.h > p.y && prevBottom <= p.y + 1) {
        return touchdown(p, b);
      }
    }
  }
  for (const r of solids()) if (hit(b, r)) return crash('Törmäys');
}

function refuel(dt) {
  if (fuel >= FUEL_MAX || money <= 0) return;
  const want = Math.min(P.refuel * dt, FUEL_MAX - fuel, money / P.price);
  if (want <= 0) return;
  fuel += want;
  money -= want * P.price;
  if (Math.random() < dt * 12) sfx.pump();
}

function finish() {
  money += P.exitBonus;
  sfx.win();
  gameOver(true);
}

function gameOver(won) {
  state = OVER;
  jetLevel(0);
  money = Math.round(money);
  showCard(won ? overWon() : overLost(), money, { cleared: won, seconds: runT });
}

function stepBits(dt) {
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.vy += 200 * dt;
    b.vx *= Math.pow(0.15, dt);
    b.life -= dt * 1.3;
    if (b.life <= 0) bits.splice(i, 1);
  }
}

/* ------------------------------------------------------------------ piirto */
function drawWall(r) {
  ctx.fillStyle = '#1b2440';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(120,160,255,.22)';
  ctx.fillRect(r.x, r.y, r.w, 2);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(r.x, r.y + r.h - 2, r.w, 2);
}

function drawPad(p) {
  ctx.fillStyle = p.fuel ? '#2a4030' : '#2b3556';
  ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, 4); ctx.fill();

  const lit = p.fuel ? '#7bf0a0' : (served[p.id] ? '#6fe3ff' : '#ffd479');
  ctx.fillStyle = lit;
  ctx.shadowColor = lit; ctx.shadowBlur = 14;
  ctx.fillRect(p.x + 6, p.y, p.w - 12, 3);
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(30,40,70,.85)';
  ctx.fillRect(p.x + 12, p.y + p.h, 8, 16);
  ctx.fillRect(p.x + p.w - 20, p.y + p.h, 8, 16);

  ctx.fillStyle = 'rgba(233,237,255,.5)';
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(p.fuel ? 'TANKKAUS' : 'ALUSTA ' + p.id, p.x + 8, p.y + p.h + 30);
  if (!p.fuel && served[p.id]) {
    ctx.fillStyle = '#6fe3ff';
    ctx.fillText('✓', p.x + p.w - 18, p.y + p.h + 30);
  }
}

function drawGate() {
  const g = GATE;
  if (gateOpen) {
    const pulse = 0.55 + Math.sin(runT * 5) * 0.45;
    ctx.fillStyle = `rgba(111,227,255,${(0.14 + pulse * 0.16).toFixed(3)})`;
    ctx.fillRect(g.x, 0, g.w, 60);
    ctx.strokeStyle = '#6fe3ff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.globalAlpha = 0.5 + pulse * 0.5;
    for (let i = 0; i < 3; i++) {
      const y = 46 - i * 14;
      ctx.beginPath();
      ctx.moveTo(g.x + 30, y + 10); ctx.lineTo(g.x + g.w / 2, y); ctx.lineTo(g.x + g.w - 30, y + 10);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else {
    drawWall(GATE_BAR);
    ctx.fillStyle = 'rgba(255,93,122,.5)';
    for (let x = g.x + 6; x < g.x + g.w - 6; x += 18) ctx.fillRect(x, 3, 8, 10);
  }
}

function drawPassenger() {
  if (!job || job.phase !== 'wait' || !job.shown) return;
  const p = padById(job.from);
  const bob = Math.sin(job.walk) * 2;
  ctx.save();
  ctx.translate(job.x, p.y - 2 + bob);
  ctx.strokeStyle = '#ffe6a3'; ctx.fillStyle = '#ffe6a3';
  ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, -26, 5, 0, 6.3); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -21); ctx.lineTo(0, -9);
  ctx.moveTo(0, -18); ctx.lineTo(-7, -13);
  ctx.moveTo(0, -18); ctx.lineTo(7, -13);
  ctx.moveTo(0, -9); ctx.lineTo(-6, 0);
  ctx.moveTo(0, -9); ctx.lineTo(6, 0);
  ctx.stroke();
  ctx.restore();
}

function drawTaxi(v) {
  if (dead || !taxi) return;
  const t = taxi, gl = GEAR * t.gear;
  ctx.save();
  ctx.translate(t.x, t.y);

  const flame = (dx, dy, rot, len) => {
    ctx.save();
    ctx.translate(dx, dy); ctx.rotate(rot);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(255,240,180,.95)');
    g.addColorStop(0.5, 'rgba(255,150,60,.7)');
    g.addColorStop(1, 'rgba(255,60,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(0, len);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  const j = () => rand(0.8, 1.2);
  if (v.y < -0.05) { const l = 26 * -v.y * j(); flame(-14, TH / 2, 0, l); flame(14, TH / 2, 0, l); }
  if (v.y > 0.05) flame(0, -TH / 2, Math.PI, 18 * v.y * j());
  if (v.x > 0.05) flame(-TW / 2, 0, -Math.PI / 2, 20 * v.x * j());
  if (v.x < -0.05) flame(TW / 2, 0, Math.PI / 2, 20 * -v.x * j());

  if (gl > 0.5) {
    ctx.strokeStyle = '#9fb0d8'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-16, TH / 2 - 2); ctx.lineTo(-20, TH / 2 + gl);
    ctx.moveTo(16, TH / 2 - 2); ctx.lineTo(20, TH / 2 + gl);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-27, TH / 2 + gl); ctx.lineTo(-13, TH / 2 + gl);
    ctx.moveTo(13, TH / 2 + gl); ctx.lineTo(27, TH / 2 + gl);
    ctx.stroke();
  }

  ctx.fillStyle = '#ffd479';
  ctx.shadowColor = 'rgba(255,212,121,.5)'; ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.roundRect(-TW / 2, -TH / 2, TW, TH, 9); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  ctx.beginPath(); ctx.roundRect(-TW / 2, -TH / 2, TW, TH, 9); ctx.clip();
  ctx.fillStyle = '#22293f';
  for (let i = 0; i < 9; i++) ctx.fillRect(-TW / 2 + i * 6, -TH / 2 + (i % 2 ? 5 : 0) + 8, 6, 5);
  ctx.restore();

  ctx.fillStyle = '#7fe6ff';
  ctx.beginPath(); ctx.ellipse(-12, -3, 11, 8, 0, 0, 6.3); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.beginPath(); ctx.ellipse(-15, -6, 4, 2.6, -0.4, 0, 6.3); ctx.fill();

  const busy = job && job.phase === 'aboard';
  ctx.fillStyle = busy ? '#ff5d7a' : '#9fb0d8';
  if (busy) { ctx.shadowColor = '#ff5d7a'; ctx.shadowBlur = 12; }
  ctx.fillRect(-8, -TH / 2 - 6, 16, 6);
  ctx.shadowBlur = 0;

  ctx.restore();
}

function bar(x, y, w, h, f, color, label) {
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
  if (f > 0) {
    ctx.fillStyle = color;
    ctx.shadowColor = color; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.roundRect(x, y, Math.max(h, w * f), h, h / 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = 'rgba(233,237,255,.5)';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y - 6);
}

function drawHud() {
  ctx.fillStyle = '#e9edff';
  ctx.font = '700 30px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(Math.floor(money) + ' €', 26, 56);

  const f = clamp(fuel / FUEL_MAX, 0, 1);
  bar(26, 74, 200, 11, f, f > 0.45 ? '#7bf0a0' : f > 0.2 ? '#ffd479' : '#ff5d7a', 'POLTTOAINE');

  ctx.textAlign = 'right';
  ctx.fillStyle = '#8a97be';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText('taksit ' + Math.max(0, lives), W - 26, 40);
  ctx.fillText(
    served[1] && served[2] ? 'ulos ylhäältä' : `keikat ${(served[1] ? 1 : 0) + (served[2] ? 1 : 0)}/2`,
    W - 26, 62
  );

  const fare = fareNow();
  if (fare) {
    ctx.fillStyle = '#ffd479';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(fare + ' €', W - 26, 98);
    ctx.fillStyle = 'rgba(233,237,255,.45)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText('MITTARI  →  ALUSTA ' + job.to, W - 26, 114);
  }

  if (msgT > 0) {
    ctx.globalAlpha = Math.min(1, msgT * 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e9edff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(msg, W / 2, 160);
    ctx.globalAlpha = 1;
  }
}

function drawButtons() {
  const b = GEAR_BOX, down = taxi && taxi.gear > 0.5;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = down ? 'rgba(111,227,255,.18)' : 'rgba(255,255,255,.07)';
  ctx.strokeStyle = down ? 'rgba(111,227,255,.8)' : 'rgba(233,237,255,.3)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 16); ctx.fill(); ctx.stroke();

  const cx = b.x + b.w / 2, cy = b.y + 38;
  ctx.strokeStyle = down ? '#6fe3ff' : '#9fb0d8';
  ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 18, cy - 12); ctx.lineTo(cx + 18, cy - 12);
  if (down) {
    ctx.moveTo(cx - 12, cy - 12); ctx.lineTo(cx - 16, cy + 10);
    ctx.moveTo(cx + 12, cy - 12); ctx.lineTo(cx + 16, cy + 10);
    ctx.moveTo(cx - 22, cy + 10); ctx.lineTo(cx - 10, cy + 10);
    ctx.moveTo(cx + 10, cy + 10); ctx.lineTo(cx + 22, cy + 10);
  } else {
    ctx.moveTo(cx - 12, cy - 12); ctx.lineTo(cx - 10, cy - 2);
    ctx.moveTo(cx + 12, cy - 12); ctx.lineTo(cx + 10, cy - 2);
  }
  ctx.stroke();

  ctx.fillStyle = down ? '#6fe3ff' : '#9fb0d8';
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(down ? 'TELINE ALHAALLA' : 'TELINE YLHÄÄLLÄ', cx, b.y + b.h - 14);
  ctx.restore();

  const m = MUTE_BOX, mx = m.x + m.w / 2, my = m.y + m.h / 2;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#9fb0d8'; ctx.fillStyle = '#9fb0d8';
  ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(mx - 9, my - 4); ctx.lineTo(mx - 5, my - 4); ctx.lineTo(mx - 1, my - 8);
  ctx.lineTo(mx - 1, my + 8); ctx.lineTo(mx - 5, my + 4); ctx.lineTo(mx - 9, my + 4);
  ctx.closePath(); ctx.fill();
  if (muted) {
    ctx.beginPath();
    ctx.moveTo(mx + 3, my - 5); ctx.lineTo(mx + 11, my + 5);
    ctx.moveTo(mx + 11, my - 5); ctx.lineTo(mx + 3, my + 5);
    ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(mx - 1, my, 7, -0.9, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(mx - 1, my, 12, -0.8, 0.8); ctx.stroke();
  }
  ctx.restore();
}

function draw(v) {
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b1230');
  g.addColorStop(1, '#04070f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  for (const s of stars) {
    ctx.globalAlpha = s.a * (0.6 + Math.sin(runT * 1.6 + s.p) * 0.4);
    ctx.fillStyle = '#9fc4ff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.3); ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(120,160,255,.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  for (const r of WALLS) drawWall(r);
  drawGate();
  for (const p of PADS) drawPad(p);
  drawPassenger();
  drawTaxi(v);

  for (const b of bits) {
    ctx.globalAlpha = clamp(b.life, 0, 1);
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.3); ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (state !== MENU) drawHud();
  stick.draw(ctx);
  drawButtons();
}

/* ------------------------------------------------------------------ kortti */
function showCard(html, pending, meta) {
  card.classList.remove('hidden');
  card.innerHTML = html;
  const lb = card.querySelector('#lb');
  if (lb) mountBoard(lb, pending || 0, meta);
  const go = card.querySelector('#go');
  if (go) go.addEventListener('click', start);
}

const menuCard = () => `
  <h1>Space <span>Taxi</span></h1>
  <p>Nosta tyyppi kyytiin ja vie hänet toiselle alustalle. Mitä nopeammin ja
     pehmeämmin, sitä isompi tippi.</p>
  <p><b>Laskuteline pitää laskea ennen kosketusta</b> — ja alhaalla se sammuttaa
     sivusuuttimet, joten suunta on oltava valmiina.</p>
  <p>Keskellä tankataan omalla rahalla. Kun molemmilla alustoilla on käyty,
     katon luukku aukeaa.</p>
  <p class="hint">Vedä mistä tahansa ruudulta — sauva syntyy sormen alle.<br>
     Nappi oikeassa alakulmassa laskee telineen.<br>
     Näppäimillä <kbd>WASD</kbd>/nuolet &middot; teline <kbd>väli</kbd> &middot; äänet <kbd>M</kbd></p>
  <div id="lb"></div>
  <button id="go" class="btn">Aja vuoro</button>`;

const overWon = () => `
  <h1>Vuoro <span>selvä</span></h1>
  <div class="big">${Math.round(money)} €</div>
  <p>Molemmat keikat ajettu ja ulos katosta — ${Math.round(runT)} sekuntia,
     ${Math.max(0, lives)} taksia ehjänä.</p>
  <div id="lb"></div>
  <button id="go" class="btn">Uusi vuoro</button>`;

const overLost = () => `
  <h1>Taksit <span>loppu</span></h1>
  <div class="big">${Math.round(money)} €</div>
  <p>Vuoro katkesi ${Math.round(runT)} sekunnin kohdalla.
     Keikkoja tehtynä ${(served[1] ? 1 : 0) + (served[2] ? 1 : 0)}/2.</p>
  <p class="hint">Pehmeä lasku maksaa itsensä takaisin tippinä.</p>
  <div id="lb"></div>
  <button id="go" class="btn">Uusi vuoro</button>`;

function start() {
  newRun();
  state = PLAY;
  card.classList.add('hidden');
}

newRun();                                  // valikon takana näkyy oikea kenttä
showCard(menuCard(), 0, null);

/* ------------------------------------------------------------ debug-paneeli */
createDebugPanel({ title: 'space taxi' })
  .slider({ label: 'painovoima', min: 80, max: 500, step: 10, value: P.grav, onInput: v => { P.grav = v; } })
  .slider({ label: 'työntö', min: 300, max: 1200, step: 20, value: P.thrust, onInput: v => { P.thrust = v; } })
  .slider({ label: 'lasku vy max', min: 40, max: 300, step: 5, value: P.landVY, onInput: v => { P.landVY = v; } })
  .slider({ label: 'lasku vx max', min: 10, max: 200, step: 5, value: P.landVX, onInput: v => { P.landVX = v; } })
  .slider({ label: 'kulutus/s', min: 0, max: 40, step: 1, value: P.burn, onInput: v => { P.burn = v; } })
  .slider({ label: 'tipin kesto s', min: 5, max: 60, step: 1, value: P.tipTime, onInput: v => { P.tipTime = v; } })
  .slider({ label: 'sauvan herkkyys', min: 0.2, max: 2.5, step: 0.05, value: stick.gain, onInput: v => { stick.gain = v; } })
  .readout('vx / vy', () => taxi ? Math.round(taxi.vx) + ' / ' + Math.round(taxi.vy) : '–')
  .readout('teline', () => taxi ? taxi.gear.toFixed(2) : '–')
  .readout('alusta', () => taxi && taxi.landed ? (taxi.landed.fuel ? 'tankki' : taxi.landed.id) : 'ilmassa')
  .readout('polttoaine', () => Math.round(fuel))
  .readout('saldo', () => Math.round(money) + ' €')
  .readout('keikka', () => job ? job.phase + ' ' + job.from + '→' + job.to : '–')
  .button('tankki täyteen', () => { fuel = FUEL_MAX; })
  .button('avaa luukku', () => { served[1] = served[2] = true; gateOpen = true; });

/* -------------------------------------------------------------------- loop */
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  resize();

  const v = activeThrust();               // sama vektori fysiikkaan ja liekkeihin
  if (state === PLAY) update(dt);
  else stepBits(dt);

  draw(v);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
