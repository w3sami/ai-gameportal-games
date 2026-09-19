/* Space Taxi — yksi vuoro.
 *
 * Säännöt ovat Muse Softwaren 1984 C64-pelistä: painovoima vetää koko ajan,
 * suuntasuuttimet kiihdyttävät, ja laskutelineen pitää olla alhaalla ennen
 * kosketusta. Teline alhaalla sivusuuttimet eivät toimi. Asiakas ilmestyy
 * alustan reunaan, huutaa taksin, kertoo minne haluaa ja maksaa perillä sitä
 * enemmän mitä nopeammin ja pehmeämmin keikka meni. Kun molemmilla alustoilla
 * on käyty, viimeinen asiakas pyytää ylös — ja vasta se avaa katon luukun.
 * Puhe on alkuperäisen tapaan asiakkaan suusta, jokaisella lajilla oma korkeus.
 *
 * Kenttä on kiinteä 720x1040 ja kangas sovitetaan siihen (contain), joten
 * geometria on sama joka näytöllä. Ohjaussauva tulee portaalin pluginista.
 * Grafiikka on koodissa: ei yhtään tiedostoa, ei yhtään ulkoista hakua.
 *
 * Säätöpaneeli (ratas alakulmassa) on pelin oma, ?debug=1 avaa sen heti, ja
 * sen JSON-kenttä siirtää arvot koneelta toiselle. ?test=1 ajaa pompputestin.
 * Luukun hehkua säädetään erillisellä sivulla gate-test.html.
 */
import { createJoystick } from 'https://plugins.game.bigbools.fi/joystick/v1/index.js';
import { liftFor } from './bounce.js';
import { drawGateGlow } from './gate.js';
import { mountBoard } from './leaderboard.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const card = document.getElementById('card');
const panelEl = document.getElementById('panel');

/* ------------------------------------------------------------------ kenttä */
const W = 720, H = 1040;
const GATE = { x: 300, w: 120 };
const CEIL = 16;

/* Luukun hehkun väri vaihtuu kentän mukaan; ensimmäinen on sininen. */
const LEVEL = 0;
const GLOW = ['#6fe3ff', '#7bf0a0', '#ff9ae0', '#ffd479', '#c79bff'];
const glowColor = () => GLOW[LEVEL % GLOW.length];

const WALLS = [
  { x: 0, y: 0, w: GATE.x, h: CEIL },                      // katto, luukun vasen puoli
  { x: GATE.x + GATE.w, y: 0, w: W - GATE.x - GATE.w, h: CEIL },
  { x: 0, y: H - 16, w: W, h: 16 },                        // lattia
  { x: 0, y: 0, w: 16, h: H },
  { x: W - 16, y: 0, w: 16, h: H },
  { x: 16, y: 300, w: 214, h: 20 },                        // hylly vasemmalla, alustan 2 korkeudella
  { x: 540, y: 640, w: 164, h: 20 },                       // hylly oikealla, tankkauksen korkeudella
  { x: 16, y: 800, w: 184, h: 20 },                        // hylly vasemmalla alhaalla
];
const GATE_BAR = { x: GATE.x, y: 0, w: GATE.w, h: CEIL };  // kiinni ollessaan tavallinen seinä

const PADS = [
  { id: 1, x: 250, y: 950, w: 210, h: 18, fuel: false },
  { id: 2, x: 490, y: 300, w: 214, h: 18, fuel: false },
  { id: 0, x: 285, y: 640, w: 150, h: 18, fuel: true },
];
const padById = id => PADS.find(p => p.id === id);

const TW = 54, TH = 28, GEAR = 14;                         // taksin runko ja telineen pituus
const FUEL_MAX = 100;

/* Säädettävät kertoimet yhdessä paikassa. Oletukset ovat puhelimella ajetusta
   säätösessiosta, ja paneelin "oletukset" palaa näihin.
   Pomppu: bounceFrom on osuus laskurajasta jonka jälkeen kosketus pompauttaa,
   bounceLift noston suurin pikselimäärä ja bounceKeep se osa vauhdista joka
   jää jäljelle. Malli ja testi ovat js/bounce.js ja js/bouncetest.js. */
const DEFAULTS = {
  grav: 250, thrust: 920,
  landVY: 215, landVX: 200, softVY: 50,
  bounceFrom: 0.5, bounceLift: 10, bounceKeep: 0.62,
  burn: 12, refuel: 63, price: 0.9,
  fare: 100, tip: 105, tipTime: 44, exitBonus: 40,
  stick: 2.05,
};
const DEFAULT_SIDE = 'left';
const P = Object.assign({}, DEFAULTS);
let gearSide = DEFAULT_SIDE;                               // kummalla puolella telinenappi on

const STORE = 'spacetaxi.tune';
const tuneJSON = () => JSON.stringify(Object.assign({ gearSide }, P));

/** Ottaa arvot vastaan JSON-tekstistä tai oliosta. Tuntemattomat avaimet
 *  ohitetaan, joten vanha vienti kelpaa vaikka kenttiä olisi tullut lisää. */
function applyTune(src) {
  let raw = src;
  if (typeof src === 'string') {
    try { raw = JSON.parse(src); } catch (e) { return false; }
  }
  if (!raw || typeof raw !== 'object') return false;
  let n = 0;
  for (const k of Object.keys(DEFAULTS)) {
    if (typeof raw[k] === 'number' && isFinite(raw[k])) { P[k] = raw[k]; n++; }
  }
  if (raw.gearSide === 'left' || raw.gearSide === 'right') { gearSide = raw.gearSide; layout(); n++; }
  if (typeof stick !== 'undefined' && stick) stick.gain = P.stick;
  return n > 0;
}

function loadTune() {
  try { applyTune(localStorage.getItem(STORE) || ''); } catch (e) {}
}
function saveTune() {
  try { localStorage.setItem(STORE, tuneJSON()); } catch (e) {}
}

/* Napit: iso telinenappi valitulla puolella, pikkunapit vastakkaisessa
   alakulmassa. Ohjaussauva jättää nämä kaikki rauhaan. */
let GEAR_BOX, MUTE_BOX, COG_BOX, FULL_BOX;
function layout() {
  const right = gearSide === 'right';
  GEAR_BOX = { x: right ? W - 158 : 30, y: H - 172, w: 128, h: 96 };
  const col = i => right ? 24 + i * 54 : W - 70 - i * 54;
  MUTE_BOX = { x: col(0), y: H - 74, w: 46, h: 46 };
  COG_BOX = { x: col(1), y: H - 74, w: 46, h: 46 };
  FULL_BOX = { x: col(2), y: H - 74, w: 46, h: 46 };
}
layout();
loadTune();

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

/* ------------------------------------------------------------- koko ruutu
   Peli ajetaan portaalissa iframessa, ja pyyntö menee läpi vain jos kehys on
   merkitty allowfullscreeniksi. Jos ei, sama osoite avataan omaan
   välilehteensä — siellä kangas saa koko ruudun joka tapauksessa. */
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

function popOut() {
  try { window.open(location.href, '_blank', 'noopener'); } catch (e) {}
}

function toggleFullscreen() {
  if (fsElement()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
    return;
  }
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return popOut();
  try {
    const r = req.call(el, { navigationUI: 'hide' });
    if (r && typeof r.catch === 'function') r.catch(popOut);
  } catch (e) { popOut(); }
}
document.addEventListener('fullscreenchange', () => { lastVW = -1; resize(); });
document.addEventListener('webkitfullscreenchange', () => { lastVW = -1; resize(); });

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

/* ------------------------------------------------------------------- puhe
   Alkuperäisen näytteet ("Hey taxi!", "Pad one please", "Up please") tulevat
   tässä selaimen puhesyntetisaattorilta. Korkeus ja nopeus tulevat asiakkaan
   lajista, joten eri tyypit kuulostavat eri asiakkailta kuten C64:llä. */
const SPEAKS = 'speechSynthesis' in window;

function speak(text, kind) {
  if (muted || !SPEAKS) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.pitch = clamp(0.6 + (kind % 5) * 0.34, 0.1, 2);
    u.rate = 1.06 - (kind % 3) * 0.08;
    u.volume = 0.95;
    speechSynthesis.speak(u);
  } catch (e) {}
}

/* iOS haluaa ensimmäisen puheen tulevan suoraan eleestä, joten aloitusnappi
   lämmittää syntetisaattorin äänettömällä lausahduksella. */
function warmSpeech() {
  if (!SPEAKS) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch (e) {}
}

const PAD_WORD = { 1: 'one', 2: 'two' };

const sfx = {
  gear() { tone(180, 0.12, { type: 'square', gain: 0.06, to: 120 }); },
  land() { tone(220, 0.14, { type: 'triangle', gain: 0.12, to: 320 }); },
  bounce(n) { tone(300 + n * 110, 0.09, { type: 'triangle', gain: 0.10, to: 200 + n * 80 }); },
  pickup() {
    tone(520, 0.09, { type: 'triangle', gain: 0.14 });
    tone(780, 0.12, { type: 'triangle', gain: 0.12, delay: 0.07 });
  },
  hey() { tone(400, 0.16, { type: 'sawtooth', gain: 0.10, to: 250 }); },
  squish() {
    tone(150, 0.22, { type: 'sine', gain: 0.16, to: 55 });
    noise(0.2, 0.18, 900, 120);
  },
  pay() {
    tone(660, 0.10, { type: 'triangle', gain: 0.16 });
    tone(990, 0.12, { type: 'triangle', gain: 0.14, delay: 0.08 });
    tone(1320, 0.18, { type: 'triangle', gain: 0.10, delay: 0.16 });
  },
  gate() { tone(160, 0.5, { type: 'sawtooth', gain: 0.10, to: 640 }); },
  crash() {
    noise(0.4, 0.3, 1800, 120);
    tone(260, 0.45, { type: 'square', gain: 0.13, to: 70 });
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
    msg, msgT, bits, lowWarn, graves, wreck, bounces;

const stars = [];
for (let i = 0; i < 70; i++) {
  stars.push({ x: rand(20, W - 20), y: rand(20, H - 20), r: rand(0.6, 1.8), a: rand(0.1, 0.5), p: rand(0, 6.3) });
}

/* Lajit sekoitetusta pussista, ei arvonnasta: pussi sisältää jokaisen lajin
   kerran, ja uusi sekoitus torjutaan jos sen ensimmäinen olisi sama kuin
   edellinen nostettu. Niin samaa tyyppiä ei koskaan tule kahdesti peräkkäin. */
let bag = [], lastKind = -1;
function nextAlien() {
  if (!bag.length) {
    do {
      bag = ALIENS.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    } while (bag.length > 1 && bag[0] === lastKind);
  }
  lastKind = bag.shift();
  return lastKind;
}

function newRun() {
  money = 40; lives = 3; runT = 0;
  served = { 1: false, 2: false };
  gateOpen = false;
  bits = []; graves = []; wreck = null; lowWarn = 0; bounces = 0;
  msg = ''; msgT = 0;
  job = null;
  bag = []; lastKind = -1;
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
  dead = false; deadT = 0; wreck = null; bounces = 0;
}

/* Asiakas seisoo aina alustan reunassa: keskeltä häntä ei voi väistää, kun
   taksi on leveämpi kuin väistövara. Puoli valitaan siltä laidalta jossa ei
   jo ole hautakiveä. Kohde on alustan numero tai 'up' viimeisellä keikalla. */
function newJob(from, to, delay) {
  const p = padById(from);
  const left = p.x + 20, right = p.x + p.w - 20;
  const taken = e => graves.some(g => g.pad === from && Math.abs(g.x - e) < 26);
  let x;
  if (taken(left) && !taken(right)) x = right;
  else if (taken(right) && !taken(left)) x = left;
  else x = Math.random() < 0.5 ? left : right;
  job = {
    from, to, phase: 'wait', wait: delay || 0,
    kind: nextAlien(),
    x, t: 0, walk: 0, moving: false, shown: false,
  };
}

function say(text, secs) { msg = text; msgT = secs || 2.4; }

function burst(x, y, color, n, speed, gravity) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(speed * 0.25, speed);
    bits.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 1, color, r: rand(1.5, 4.5), g: gravity,
    });
  }
}

/* ------------------------------------------------------------------ syöte */
const KEY = Object.create(null);

function toLogical(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left) / r.width * W, y: (clientY - r.top) / r.height * H };
}
const inBox = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
const onButtons = p =>
  inBox(p, GEAR_BOX) || inBox(p, MUTE_BOX) || inBox(p, COG_BOX) || inBox(p, FULL_BOX);

/* Telineen saa nostaa myös alustalla seistessä: lähtö on helpompi ohjata kun
   sivusuuttimet ovat jo käytössä. Taksi laskeutuu samalla mahalleen. */
function toggleGear() {
  if (state !== PLAY || dead) return;
  taxi.gearWant = !taxi.gearWant;
  sfx.gear();
}

function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('spacetaxi.muted', muted ? '1' : '0'); } catch (e) {}
  if (muted && jet) jet.g.gain.value = 0;
  if (muted && SPEAKS) { try { speechSynthesis.cancel(); } catch (e) {} }
  if (!muted) sfx.gear();
}

canvas.addEventListener('pointerdown', e => {
  const p = toLogical(e.clientX, e.clientY);
  if (inBox(p, GEAR_BOX)) { toggleGear(); return; }
  if (inBox(p, MUTE_BOX)) { toggleMute(); return; }
  if (inBox(p, COG_BOX)) { togglePanel(); return; }
  if (inBox(p, FULL_BOX)) toggleFullscreen();
});

addEventListener('keydown', e => {
  // paneelin tekstikentässä näppäimet kuuluvat sille
  if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;
  KEY[e.code] = true;
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (e.code === 'KeyF') { toggleFullscreen(); return; }
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
stick.gain = P.stick;

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

/* Ei räjähdystä: taksi hajoaa, kimpoaa kerran ja tippuu pyörien ruudusta
   alas. Se on se kuva joka klassikosta jäi mieleen. */
function crash(reason) {
  if (dead) return;
  dead = true; deadT = 0;
  lives--;
  if (job && job.phase === 'aboard') {
    newJob(job.from, job.to, 1.2);
    say('Keikka meni — ' + reason, 3);
  } else say(reason, 3);
  wreck = {
    x: taxi.x, y: taxi.y,
    vx: taxi.vx * 0.5 + rand(-60, 60),
    vy: Math.min(taxi.vy * 0.3, 40) - rand(90, 170),
    rot: 0, spin: rand(-5, 5), puff: 0,
  };
  burst(taxi.x, taxi.y, '#ffd479', 8, 220);   // irronneita paloja, ei tulipalloa
  jetLevel(0);
  if (SPEAKS) { try { speechSynthesis.cancel(); } catch (e) {} }
  sfx.crash();
}

function touchdown(pad, b) {
  const t = taxi;
  const ratio = Math.max(t.vy / P.landVY, Math.abs(t.vx) / P.landVX);

  if (t.gear < 0.85) return crash('Laskuteline ylhäällä');
  if (b.x < pad.x - 2 || b.x + b.w > pad.x + pad.w + 2) return crash('Jalka ilmassa');
  if (ratio > 1) return crash('Liian kova lasku');

  /* Vähän liian kova kosketus pompauttaa: taksi siirretään muutama pikseli
     alustan yläpuolelle ja vauhdista jää osa jäljelle. Nostoa ei käännetä
     ylöspäin — painovoima tuo sen takaisin pienemmällä vauhdilla, ja ketju
     sammuu itsestään 1–3 pompun jälkeen. Malli: js/bounce.js. */
  if (ratio > P.bounceFrom) {
    const gl = GEAR * t.gear;
    const lift = liftFor(ratio, P);
    t.y = pad.y - (TH / 2 + gl) - lift;
    t.vy = Math.max(0, t.vy) * P.bounceKeep;
    t.vx *= P.bounceKeep;
    bounces = Math.min(bounces + 1, 3);
    sfx.bounce(bounces);
    return;
  }

  const soft = t.vy;
  t.y = pad.y - (TH / 2 + GEAR * t.gear);
  t.vx = 0; t.vy = 0; t.landed = pad; t.gearWant = true;
  bounces = 0;
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
    const kind = job.kind;
    money += fare;
    served[pad.id] = true;
    say(`Kiitos! ${fare} € (tippi ${tip} €)`, 2.6);
    burst(taxi.x, taxi.y - 20, '#6fe3ff', 16, 160);
    sfx.pay();
    speak('Thanks!', kind);
    job = null;

    // Viimeinen asiakas ei mene alustalle vaan ylös, ja vasta hän avaa luukun.
    newJob(pad.id, served[1] && served[2] ? 'up' : (served[1] ? 2 : 1), 1.6);
    return;
  }

  // Asiakkaan päälle laskeutuminen jättää hautakiven. Uusi asiakas tulee
  // toiseen reunaan, ja kivi jää siihen muistuttamaan koko vuoron ajaksi.
  if (job.phase === 'wait' && pad.id === job.from && job.shown) {
    const b = taxiBox(taxi);
    if (job.x > b.x - 6 && job.x < b.x + b.w + 6) {
      if (graves.length < 10) graves.push({ pad: pad.id, x: job.x, kind: job.kind });
      say('Hups.', 1.8);
      sfx.squish();
      newJob(job.from, job.to, 1.8);
    }
  }
}

function jobStep(dt) {
  if (!job) return;
  if (job.phase === 'aboard') { job.t += dt; return; }

  if (job.wait > 0) { job.wait -= dt; return; }
  if (!job.shown) {
    job.shown = true;
    say('Hei, taksi!', 2.2);
    sfx.hey();
    speak('Hey, taxi!', job.kind);
  }

  // Kyytiin vain pysäköidystä taksista samalla alustalla.
  job.moving = false;
  if (!dead && taxi.landed && taxi.landed.id === job.from) {
    const b = taxiBox(taxi);
    const target = job.x < taxi.x ? b.x - 10 : b.x + b.w + 10;
    const d = target - job.x;
    if (Math.abs(d) < 3) {
      job.phase = 'aboard'; job.t = 0;
      if (job.to === 'up') {
        gateOpen = true;                    // luukku aukeaa vasta tästä pyynnöstä
        say('Ylös, kiitos!', 3);
        speak('Up please', job.kind);
        sfx.gate();
      } else {
        say(`Alusta ${job.to}, kiitos`, 2.4);
        speak(`Pad ${PAD_WORD[job.to] || job.to} please`, job.kind);
        sfx.pickup();
      }
      return;
    }
    job.moving = true;
    job.x += Math.sign(d) * Math.min(Math.abs(d), 95 * dt);
  }
  job.walk += dt * (job.moving ? 9 : 3);
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
    if (wreck) {
      wreck.vy += 640 * dt;
      wreck.x += wreck.vx * dt;
      wreck.y += wreck.vy * dt;
      wreck.rot += wreck.spin * dt;
      wreck.puff -= dt;
      if (wreck.puff <= 0) {
        wreck.puff = 0.06;
        bits.push({
          x: wreck.x + rand(-10, 10), y: wreck.y + rand(-8, 8),
          vx: rand(-20, 20), vy: rand(-30, -10),
          life: 1, color: '#5a6480', r: rand(3, 6), g: -20,
        });
      }
    }
    const gone = wreck && wreck.y > H + 160;
    if (gone || deadT > 3.2) {
      if (lives <= 0) return gameOver(false);
      resetTaxi();
    }
    return;
  }

  // teline animoituu; maassa taksi laskeutuu telineen mukana mahalleen
  taxi.gear += clamp((taxi.gearWant ? 1 : 0) - taxi.gear, -dt * 4, dt * 4);
  if (taxi.landed) taxi.y = taxi.landed.y - (TH / 2 + GEAR * taxi.gear);

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

  /* Liike pilkotaan osiin, jotta kova pudotus ei hyppää alustan läpi. Askel on
     pienempi kuin pompun nosto, jottei pomppu jää huomaamatta. */
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(taxi.vx), Math.abs(taxi.vy)) * dt / 4));
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

/** Ulos luukusta. Viimeinen asiakas on kyydissä, joten hänkin maksaa. */
function finish() {
  let paid = P.exitBonus;
  if (job && job.phase === 'aboard') {
    paid += P.fare + Math.round(P.tip * Math.max(0, 1 - job.t / P.tipTime));
    speak('Thanks!', job.kind);
    job = null;
  }
  money += paid;
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
    b.vy += (b.g === undefined ? 200 : b.g) * dt;
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

/* Luukku: kiinni tavallinen seinä, auki pelkkää valoa. Hehku ja aallot ovat
   js/gate.js:ssä, jotta gate-test.html säätää täsmälleen samaa koodia. */
function drawGate() {
  if (!gateOpen) {
    drawWall(GATE_BAR);
    ctx.fillStyle = 'rgba(255,93,122,.5)';
    for (let x = GATE.x + 6; x < GATE.x + GATE.w - 6; x += 18) ctx.fillRect(x, 3, 8, 10);
    return;
  }
  drawGateGlow(ctx, GATE, CEIL, glowColor(), runT);
}

/* ------------------------------------------------------------------ alienit
   Viisi tyyppiä, kaikki samasta piirtorutiinista: vartalon muoto, silmien
   määrä, raajat ja tuntosarvet vaihtuvat. Kävely on jalkojen vastavaihe ja
   vartalon pomppu; odottaessa yksi käsi heiluu. Ei tiedostoja, ei latauksia. */
const ALIENS = [
  { c: '#7bf0a0', shape: 'blob', eyes: 1, arms: 2, legs: 2, ant: 0 },
  { c: '#c79bff', shape: 'tall', eyes: 3, arms: 2, legs: 2, ant: 2 },
  { c: '#ff9ae0', shape: 'dome', eyes: 2, arms: 2, legs: 4, ant: 0 },
  { c: '#6fe3ff', shape: 'squat', eyes: 2, arms: 4, legs: 2, ant: 1 },
  { c: '#ffb020', shape: 'bug', eyes: 4, arms: 2, legs: 2, ant: 2 },
];

function drawAlien(kind, x, groundY, phase, walking, waving, alpha) {
  const A = ALIENS[kind % ALIENS.length];
  const bob = (walking ? Math.abs(Math.sin(phase)) * 2 : Math.sin(phase * 0.8) * 1);
  ctx.save();
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  ctx.translate(x, groundY - bob);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = A.c; ctx.fillStyle = A.c;

  const hip = -12;
  const h = A.shape === 'tall' ? 24 : A.shape === 'squat' ? 13 : 17;
  const w = A.shape === 'tall' ? 11 : A.shape === 'squat' ? 20 : 15;
  const cy = hip - h / 2;
  const top = cy - h / 2;

  // jalat: vastavaiheessa kun kävellään
  ctx.lineWidth = 2.6;
  for (let i = 0; i < A.legs; i++) {
    const base = A.legs === 2 ? (i ? 5 : -5) : (i - (A.legs - 1) / 2) * 4.5;
    const sw = walking ? Math.sin(phase + i * Math.PI) * 5 : 0;
    ctx.beginPath();
    ctx.moveTo(base * 0.5, hip);
    ctx.lineTo(base + sw, bob);
    ctx.stroke();
  }

  // vartalo
  ctx.beginPath();
  if (A.shape === 'dome') {
    ctx.moveTo(-w / 2, hip);
    ctx.lineTo(-w / 2, cy);
    ctx.arc(0, cy, w / 2, Math.PI, 0);
    ctx.lineTo(w / 2, hip);
    ctx.closePath();
  } else if (A.shape === 'bug' || A.shape === 'blob') {
    ctx.ellipse(0, cy, w / 2, h / 2, 0, 0, 6.3);
  } else {
    ctx.roundRect(-w / 2, top, w, h, w / 2.6);
  }
  ctx.fill();

  // kädet
  ctx.lineWidth = 2.3;
  for (let i = 0; i < A.arms; i++) {
    const side = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    const sx = side * w / 2 * 0.85, sy = top + 5 + row * 6;
    let ex = sx + side * 9, ey = sy + 7;
    if (waving && side === 1 && row === 0) {
      const a = -1.15 + Math.sin(phase * 2.6) * 0.45;   // kädenheilautus
      ex = sx + Math.cos(a) * 11; ey = sy + Math.sin(a) * 11;
    } else if (walking) {
      ey = sy + 7 + Math.sin(phase + (side > 0 ? Math.PI : 0)) * 3.5;
    }
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  }

  // tuntosarvet
  ctx.lineWidth = 1.8;
  for (let i = 0; i < A.ant; i++) {
    const side = A.ant === 1 ? 0 : (i ? 1 : -1);
    const tipx = side * 6 + Math.sin(phase * 1.5 + i) * 1.5, tipy = top - 10;
    ctx.beginPath();
    ctx.moveTo(side * 3, top + 1);
    ctx.quadraticCurveTo(side * 6, top - 6, tipx, tipy);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(tipx, tipy, 2, 0, 6.3); ctx.fill();
  }

  // silmät
  const n = A.eyes, r = n === 1 ? 5.5 : n < 4 ? 2.8 : 2.2;
  const gap = n === 1 ? 0 : (n === 3 ? 5.5 : n === 4 ? 4.6 : 6);
  const ey0 = A.shape === 'tall' ? top + 7 : cy - 1;
  for (let i = 0; i < n; i++) {
    const ex = (i - (n - 1) / 2) * gap;
    ctx.fillStyle = '#0b1020';
    ctx.beginPath(); ctx.arc(ex, ey0, r, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(ex + r * 0.25, ey0 - r * 0.25, r * 0.4, 0, 6.3); ctx.fill();
  }

  ctx.restore();
}

/** Muisto yliajetusta asiakkaasta. Jää alustalle koko vuoron ajaksi. */
function drawGrave(g) {
  const p = padById(g.pad);
  ctx.save();
  ctx.translate(g.x, p.y);
  ctx.fillStyle = '#6b7488';
  ctx.beginPath();
  ctx.moveTo(-9, 0);
  ctx.lineTo(-9, -11);
  ctx.arc(0, -11, 9, Math.PI, 0);
  ctx.lineTo(9, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(57,64,81,.85)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -17); ctx.lineTo(0, -6);
  ctx.moveTo(-4.5, -13); ctx.lineTo(4.5, -13);
  ctx.stroke();
  // pieni kukkatupsu sen väriseksi jonka alle jäi
  ctx.fillStyle = ALIENS[g.kind % ALIENS.length].c;
  ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.arc(11, -3, 2.6, 0, 6.3); ctx.fill();
  ctx.restore();
}

function drawPassenger() {
  if (!job || job.phase !== 'wait' || !job.shown) return;
  const p = padById(job.from);
  drawAlien(job.kind, job.x, p.y, job.walk, job.moving, !job.moving);
}

function taxiShape(w, h, broken) {
  ctx.fillStyle = broken ? '#c9a253' : '#ffd479';
  if (!broken) { ctx.shadowColor = 'rgba(255,212,121,.5)'; ctx.shadowBlur = 16; }
  ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 9); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 9); ctx.clip();
  ctx.fillStyle = '#22293f';
  for (let i = 0; i < 9; i++) ctx.fillRect(-w / 2 + i * 6, -h / 2 + (i % 2 ? 5 : 0) + 8, 6, 5);
  if (broken) {                                  // murtuma ja nokipaikat
    ctx.fillStyle = '#1a1207';
    ctx.beginPath();
    ctx.moveTo(-4, -h / 2); ctx.lineTo(4, -2); ctx.lineTo(-2, 4); ctx.lineTo(6, h / 2);
    ctx.lineTo(14, h / 2); ctx.lineTo(14, -h / 2);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = broken ? '#3d6470' : '#7fe6ff';
  ctx.beginPath(); ctx.ellipse(-w * 0.22, -3, w * 0.2, h * 0.28, 0, 0, 6.3); ctx.fill();
  if (!broken) {
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.beginPath(); ctx.ellipse(-w * 0.28, -6, 4, 2.6, -0.4, 0, 6.3); ctx.fill();
  }
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

  taxiShape(TW, TH, false);

  const busy = job && job.phase === 'aboard';
  ctx.fillStyle = busy ? '#ff5d7a' : '#9fb0d8';
  if (busy) { ctx.shadowColor = '#ff5d7a'; ctx.shadowBlur = 12; }
  ctx.fillRect(-8, -TH / 2 - 6, 16, 6);
  ctx.shadowBlur = 0;

  ctx.restore();
}

/** Rikkinäinen taksi matkalla ulos ruudusta: pyörii, savuaa, ei törmää mihinkään. */
function drawWreck() {
  if (!wreck) return;
  ctx.save();
  ctx.translate(wreck.x, wreck.y);
  ctx.rotate(wreck.rot);
  taxiShape(TW, TH, true);
  ctx.strokeStyle = '#7b87a8'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, TH / 2 - 2); ctx.lineTo(-24, TH / 2 + 12);
  ctx.moveTo(16, TH / 2 - 2); ctx.lineTo(19, TH / 2 + 6);
  ctx.stroke();
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

/** Elämät pieninä takseina: sama muoto kuin pelissä, ei numeroa. */
function drawLives() {
  const n = Math.max(0, lives);
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.translate(W - 40 - i * 34, 40);
    ctx.scale(0.5, 0.5);
    ctx.globalAlpha = 0.9;
    taxiShape(TW, TH, false);
    ctx.strokeStyle = '#9fb0d8'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-16, TH / 2 - 2); ctx.lineTo(-20, TH / 2 + 8);
    ctx.moveTo(16, TH / 2 - 2); ctx.lineTo(20, TH / 2 + 8);
    ctx.stroke();
    ctx.restore();
  }
}

function drawHud() {
  ctx.fillStyle = '#e9edff';
  ctx.font = '700 30px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(Math.floor(money) + ' €', 26, 56);

  const f = clamp(fuel / FUEL_MAX, 0, 1);
  bar(26, 74, 200, 11, f, f > 0.45 ? '#7bf0a0' : f > 0.2 ? '#ffd479' : '#ff5d7a', 'POLTTOAINE');

  drawLives();

  ctx.textAlign = 'right';
  ctx.fillStyle = '#8a97be';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText(
    gateOpen ? 'ulos ylhäältä' : `keikat ${(served[1] ? 1 : 0) + (served[2] ? 1 : 0)}/2`,
    W - 26, 74
  );

  const fare = fareNow();
  if (fare) {
    ctx.fillStyle = '#ffd479';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(fare + ' €', W - 26, 108);
    ctx.fillStyle = 'rgba(233,237,255,.45)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(job.to === 'up' ? 'MITTARI  →  ULOS' : 'MITTARI  →  ALUSTA ' + job.to, W - 26, 124);
  }

  if (msgT > 0) {
    ctx.globalAlpha = Math.min(1, msgT * 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e9edff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(msg, W / 2, 190);
    ctx.globalAlpha = 1;
  }
}

function smallBox(b, draw) {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#9fb0d8'; ctx.fillStyle = '#9fb0d8';
  ctx.lineWidth = 2; ctx.lineCap = 'round';
  draw(b.x + b.w / 2, b.y + b.h / 2);
  ctx.restore();
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

  smallBox(MUTE_BOX, (mx, my) => {
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
  });

  // ratas: avaa säätöpaneelin
  smallBox(COG_BOX, (mx, my) => {
    ctx.beginPath(); ctx.arc(mx, my, 6, 0, 6.3); ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(a) * 8, my + Math.sin(a) * 8);
      ctx.lineTo(mx + Math.cos(a) * 12, my + Math.sin(a) * 12);
      ctx.stroke();
    }
  });

  /* Koko ruutu: nuolet ulos, ja kokoruututilassa sisään. */
  const out = !fsElement();
  smallBox(FULL_BOX, (mx, my) => {
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const ox = mx + sx * 11, oy = my + sy * 11;
      const ix = mx + sx * 4, iy = my + sy * 4;
      ctx.beginPath();
      if (out) {
        ctx.moveTo(ox - sx * 7, oy); ctx.lineTo(ox, oy); ctx.lineTo(ox, oy - sy * 7);
      } else {
        ctx.moveTo(ix - sx * 7, iy); ctx.lineTo(ix, iy); ctx.lineTo(ix, iy - sy * 7);
      }
      ctx.stroke();
    }
  });
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
  for (const gr of graves) drawGrave(gr);
  drawPassenger();
  drawTaxi(v);
  drawWreck();

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

/* ------------------------------------------------------------ säätöpaneeli
   Pelin oma, ei debug-pluginin: auki rattaasta, arvot jäävät selaimeen.
   JSON-kenttä on sekä vienti että tuonti — samalla tekstillä arvot siirtyvät
   puhelimelta koneelle tai keskusteluun. */
const SLIDERS = [
  { key: 'grav', label: 'painovoima', min: 80, max: 500, step: 10 },
  { key: 'thrust', label: 'työntö', min: 300, max: 1200, step: 20 },
  { key: 'landVY', label: 'lasku vy max', min: 40, max: 300, step: 5 },
  { key: 'landVX', label: 'lasku vx max', min: 10, max: 200, step: 5 },
  { key: 'bounceFrom', label: 'pomppu alkaa x', min: 0.2, max: 0.95, step: 0.05 },
  { key: 'bounceLift', label: 'pompun nosto px', min: 2, max: 30, step: 1 },
  { key: 'bounceKeep', label: 'pompun jäävä vauhti', min: 0.2, max: 0.9, step: 0.02 },
  { key: 'burn', label: 'kulutus / s', min: 0, max: 40, step: 1 },
  { key: 'refuel', label: 'tankkaus / s', min: 5, max: 80, step: 1 },
  { key: 'price', label: 'bensan hinta', min: 0, max: 3, step: 0.1 },
  { key: 'fare', label: 'perusmaksu', min: 0, max: 200, step: 5 },
  { key: 'tip', label: 'tippi max', min: 0, max: 200, step: 5 },
  { key: 'tipTime', label: 'tipin kesto s', min: 5, max: 60, step: 1 },
  { key: 'stick', label: 'sauvan herkkyys', min: 0.2, max: 2.5, step: 0.05 },
];

let panelNote = '';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function pbutton(cls, text, fn) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}

function buildPanel() {
  panelEl.replaceChildren(el('h2', null, 'säädöt'));

  // telinenapin puoli
  const sideRow = el('div', 'row');
  const seg = el('div', 'seg');
  const mk = (side, text) => pbutton(gearSide === side ? 'on' : null, text, () => {
    gearSide = side; layout(); saveTune(); buildPanel();
  });
  seg.append(mk('left', 'vasen'), mk('right', 'oikea'));
  sideRow.append(el('label', null, 'telinenappi'), seg);
  panelEl.append(sideRow);

  for (const s of SLIDERS) {
    const row = el('div', 'row');
    const lab = el('label');
    const val = el('b', null, String(P[s.key]));
    lab.append(document.createTextNode(s.label), val);
    const input = el('input');
    input.type = 'range';
    input.min = s.min; input.max = s.max; input.step = s.step;
    input.value = P[s.key];
    input.addEventListener('input', () => {
      P[s.key] = +input.value;
      val.textContent = input.value;
      if (s.key === 'stick') stick.gain = P.stick;
      saveTune();
      if (ta && ta !== document.activeElement) ta.value = tuneJSON();
    });
    row.append(lab, input);
    panelEl.append(row);
  }

  const foot = el('div', 'foot');
  foot.append(
    pbutton('btn sm ghost', 'oletukset', () => {
      Object.assign(P, DEFAULTS);
      gearSide = DEFAULT_SIDE; layout();
      stick.gain = P.stick;
      saveTune();
      panelNote = 'oletukset palautettu';
      buildPanel();
    }),
    pbutton('btn sm', 'sulje', togglePanel),
  );
  panelEl.append(foot);

  // vienti ja tuonti
  const io = el('div', 'row io');
  io.append(el('label', null, 'arvot JSONina'));
  const ta = el('textarea');
  ta.spellcheck = false;
  ta.autocapitalize = 'off';
  ta.autocomplete = 'off';
  ta.value = tuneJSON();
  const note = el('p', 'note', panelNote);
  panelNote = '';

  const ioButtons = el('div', 'foot');
  ioButtons.append(
    pbutton('btn sm ghost', 'kopioi', () => {
      ta.value = tuneJSON();
      ta.focus(); ta.select();
      /* Leikepöytä voi olla iframessa kielletty. Silloin teksti jää valituksi
         ja sen saa käsin — ei erillistä virhettä. */
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value)
          .then(() => { note.textContent = 'kopioitu leikepöydälle'; })
          .catch(() => { note.textContent = 'valittu — kopioi käsin'; });
      } else note.textContent = 'valittu — kopioi käsin';
    }),
    pbutton('btn sm', 'tuo', () => {
      if (applyTune(ta.value)) {
        saveTune();
        panelNote = 'arvot otettu käyttöön';
        buildPanel();
      } else note.textContent = 'ei kelvollista JSONia';
    }),
  );
  io.append(ta, ioButtons, note);

  // pompputesti nykyisillä arvoilla, tulos konsoliin
  io.append(pbutton('btn sm ghost', 'aja pompputesti', () => {
    import('./bouncetest.js')
      .then(m => {
        const bad = m.run(P);
        note.textContent = bad ? `${bad} riviä haarukan ulkopuolella (konsoli)` : 'pomput 1–3, kaikki ok';
      })
      .catch(() => { note.textContent = 'testiä ei saatu ladattua'; });
  }));
  panelEl.append(io);
}

function togglePanel() {
  if (panelEl.classList.contains('hidden')) { buildPanel(); panelEl.classList.remove('hidden'); }
  else panelEl.classList.add('hidden');
}

/* ------------------------------------------------------------------ kortti */
function showCard(html, pending, meta) {
  card.classList.remove('hidden');
  card.innerHTML = html;
  const lb = card.querySelector('#lb');
  if (lb) mountBoard(lb, pending || 0, meta);
  const go = card.querySelector('#go');
  if (go) go.addEventListener('click', start);
  const set = card.querySelector('#set');
  if (set) set.addEventListener('click', togglePanel);
  const fs = card.querySelector('#fs');
  if (fs) fs.addEventListener('click', toggleFullscreen);
}

const buttons = `
  <button id="go" class="btn">%s</button>
  <button id="fs" class="btn ghost">Koko ruutu</button>
  <button id="set" class="btn ghost">Säädöt</button>`;

const menuCard = () => `
  <h1>Space <span>Taxi</span></h1>
  <p>Nosta alien kyytiin ja vie hänet toiselle alustalle. Mitä nopeammin ja
     pehmeämmin, sitä isompi tippi. Laskeudu viereen, älä päälle.</p>
  <p><b>Laskuteline pitää laskea ennen kosketusta</b> — ja alhaalla se sammuttaa
     sivusuuttimet, joten nosta se heti lähdössä. Vauhdikas kosketus pompauttaa,
     liian kova hajottaa.</p>
  <p>Keskellä tankataan omalla rahalla. Kun molemmilla alustoilla on käyty,
     viimeinen asiakas pyytää ylös ja katon luukku aukeaa.</p>
  <p class="hint">Vedä mistä tahansa ruudulta — sauva syntyy sormen alle.<br>
     Iso nappi laskee telineen, ratas avaa säädöt, nuolinappi koko ruudun.<br>
     Näppäimillä <kbd>WASD</kbd>/nuolet &middot; teline <kbd>väli</kbd> &middot;
     koko ruutu <kbd>F</kbd> &middot; äänet <kbd>M</kbd></p>
  <div id="lb"></div>
  ${buttons.replace('%s', 'Aja vuoro')}`;

const overWon = () => `
  <h1>Vuoro <span>selvä</span></h1>
  <div class="big">${Math.round(money)} €</div>
  <p>Kaikki keikat ajettu ja ulos katosta — ${Math.round(runT)} sekuntia,
     ${Math.max(0, lives)} taksia ehjänä${graves.length ? `, ${graves.length} hautakiveä` : ''}.</p>
  <div id="lb"></div>
  ${buttons.replace('%s', 'Uusi vuoro')}`;

const overLost = () => `
  <h1>Taksit <span>loppu</span></h1>
  <div class="big">${Math.round(money)} €</div>
  <p>Vuoro katkesi ${Math.round(runT)} sekunnin kohdalla.
     Keikkoja tehtynä ${(served[1] ? 1 : 0) + (served[2] ? 1 : 0)}/2${graves.length ? `, hautakiviä ${graves.length}` : ''}.</p>
  <p class="hint">Pehmeä lasku maksaa itsensä takaisin tippinä.</p>
  <div id="lb"></div>
  ${buttons.replace('%s', 'Uusi vuoro')}`;

function start() {
  warmSpeech();                            // iOS: ensimmäinen puhe eleen alta
  newRun();
  state = PLAY;
  card.classList.add('hidden');
}

newRun();                                  // valikon takana näkyy oikea kenttä
showCard(menuCard(), 0, null);

/* Liput osoitteesta: ?debug=1 avaa säätöpaneelin, ?test=1 ajaa pompputestin. */
try {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of q) {
    const key = k.toLowerCase();
    const on = v !== '0' && v !== 'false';
    if (key === 'debug' && on) togglePanel();
    if (key === 'test' && on) import('./bouncetest.js').then(m => m.run(P)).catch(() => {});
  }
} catch (e) {}

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
