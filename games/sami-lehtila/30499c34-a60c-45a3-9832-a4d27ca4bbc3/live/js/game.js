/* Space Taxi — vuoro, jossa on useampi kenttä.
 *
 * Säännöt ovat Muse Softwaren 1984 C64-pelistä: painovoima vetää koko ajan,
 * suuntasuuttimet kiihdyttävät, ja laskutelineen pitää olla alhaalla ennen
 * kosketusta. Teline alhaalla sivusuuttimet eivät toimi. Asiakas ilmestyy
 * alustan reunaan, huutaa taksin, kertoo minne haluaa ja maksaa perillä sitä
 * enemmän mitä nopeammin ja pehmeämmin keikka meni.
 *
 * Alusta on käyty kun siellä on pysähdytty: sekä nouto että jättö merkkaa
 * paikan. Nouto arvotaan vapaasti mille tahansa alustalle, mutta määränpää on
 * aina jokin käymätön alusta — ja jos käymättömiä ei ole, asiakas pyytää ylös.
 * Näin väkäset ja jäljellä olevat keikat eivät voi mennä ristiin.
 *
 * Katosta ulos lähtenyt asiakas ei jää luukkuun: hän jatkaa kyydissä seuraavaan
 * kenttään, joten uusi kenttä alkaa jättökeikalla ja hän maksaa vasta perillä.
 * Vuoron viimeisellä kentällä hän maksaa ulosajosta, koska matka päättyy siihen.
 *
 * Taksi tulee kenttään aina katon luukusta — myös kolarin jälkeen — jarruttaa
 * paikalleen ja peli käynnistyy READY–GO:lla. Kentän lopussa on välianimaatio:
 * nousu tilinpäätöksineen ja lasku seuraavan kentän nimen kanssa. Viimeisen
 * kentän jälkeen tulee pelkkä nousu koko vuoron tilastoilla, ja loppuruudussa
 * lentää hyperavaruus (js/hyperspace.js) — kortti häivähtää siihen vasta parin
 * sekunnin päästä, jotta lennon ehtii nähdä.
 *
 * Tekstit ja puhe tulevat js/i18n.js:stä. Kieli päätellään ?lang-parametrista,
 * localStoragesta tai selaimen kielestä, ja suomea puhutaan vain jos laitteelta
 * löytyy suomenkielinen ääni.
 *
 * Kentät ovat js/levels.js:ssä, luukun ulkoasu js/gate.js, pompun malli
 * js/bounce.js, välianimaatio js/cutscene.js ja tulostaulu js/leaderboard.js.
 *
 * ?debug=1 avaa säätöpaneelin, ?test=1 ajaa pompputestin, ?lang=fi|en pakottaa
 * kielen, gate-test.html on luukun oma säätösivu.
 */
import { createJoystick } from 'https://plugins.game.bigbools.fi/joystick/v1/index.js';
import { liftFor } from './bounce.js';
import { drawGateGlow } from './gate.js';
import { createCut } from './cutscene.js';
import { createHyperspace } from './hyperspace.js';
import { LEVELS } from './levels.js';
import { mountBoard } from './leaderboard.js';
import { LANG, setLang, t, voiceFor } from './i18n.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const card = document.getElementById('card');
const panelEl = document.getElementById('panel');

/* ------------------------------------------------------------------ kenttä */
const W = 720, H = 1040;
const CEIL = 16;
const TW = 54, TH = 28, GEAR = 14;
const FUEL_MAX = 100;
const FUEL_LOW = 35;
const TAXI_PRICE = 500;
const FLEET_COUNT = 3, FLEET_PRICE = 1000;
const CLEAN_BONUS = 100;
const ENTER_Y = H * 0.15;
const HORN_R = 150;
const SQ_FALL = 0.4, SQ_WAIT = 0.3, SQ_RISE = 0.7;
const SQ_DUR = SQ_FALL + SQ_WAIT + SQ_RISE;
const GRAVE_MAX = 10;
const END_CARD_DELAY = 2600;                               // tähdet ensin, kortti sitten

let levelIndex = 0, level = LEVELS[0];
let GATE = level.gate, WALLS = [], PADS = [];

function frameWalls(gate) {
  return [
    { x: 0, y: 0, w: gate.x, h: CEIL },
    { x: gate.x + gate.w, y: 0, w: W - gate.x - gate.w, h: CEIL },
    { x: 0, y: H - 16, w: W, h: 16 },
    { x: 0, y: 0, w: 16, h: H },
    { x: W - 16, y: 0, w: 16, h: H },
  ];
}
const gateBar = () => ({ x: GATE.x, y: 0, w: GATE.w, h: CEIL });
const padById = id => PADS.find(p => p.id === id);
const numbered = () => PADS.filter(p => !p.fuel);

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
let gearSide = DEFAULT_SIDE;

const STORE = 'spacetaxi.tune';
const tuneJSON = () => JSON.stringify(Object.assign({ gearSide }, P));

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
function loadTune() { try { applyTune(localStorage.getItem(STORE) || ''); } catch (e) {} }
function saveTune() { try { localStorage.setItem(STORE, tuneJSON()); } catch (e) {} }

let GEAR_BOX, MUTE_BOX, COG_BOX, FULL_BOX, HORN_BOX;
function layout() {
  const right = gearSide === 'right';
  GEAR_BOX = { x: right ? W - 158 : 30, y: H - 172, w: 128, h: 96 };
  HORN_BOX = { x: right ? W - 158 : 30, y: H - 262, w: 128, h: 78 };
  const col = i => right ? 24 + i * 54 : W - 70 - i * 54;
  MUTE_BOX = { x: col(0), y: H - 74, w: 46, h: 46 };
  COG_BOX = { x: col(1), y: H - 74, w: 46, h: 46 };
  FULL_BOX = { x: col(2), y: H - 74, w: 46, h: 46 };
}
layout();
loadTune();

/* ------------------------------------------------------------------ kangas */
let scale = 1, dpr = 1, lastVW = -1, lastVH = -1;
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

/* ------------------------------------------------------------- koko ruutu */
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function popOut() { try { window.open(location.href, '_blank', 'noopener'); } catch (e) {} }

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
const pick = arr => arr[(Math.random() * arr.length) | 0];

/* ------------------------------------------------------------------- äänet */
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

function noise(dur, gain, from, to, delay) {
  const a = audio(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'lowpass';
  const t0 = a.currentTime + (delay || 0);
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = a.createGain(); g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}

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

/* -------------------------------------------------------------------- puhe
   Suomea puhutaan vain jos laitteelta löytyy suomenkielinen ääni. Muuten
   englanti, koska englantilainen ääni suomenkielisellä tekstillä kuulostaa
   siltä kuin taksi olisi tilattu väärästä maasta. */
const SPEAKS = 'speechSynthesis' in window;

function speakLine(key, kind, params) {
  if (muted || !SPEAKS) return;
  const v = LANG === 'fi' ? voiceFor('fi') : null;
  const text = t('say.' + key, params, v ? 'fi' : 'en');
  try {
    const u = new SpeechSynthesisUtterance(text);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    u.pitch = clamp(0.6 + (kind % 5) * 0.34, 0.1, 2);
    u.rate = 1.06 - (kind % 3) * 0.08;
    u.volume = 0.95;
    speechSynthesis.speak(u);
  } catch (e) {}
}
function warmSpeech() {
  if (!SPEAKS) return;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
}

const sfx = {
  gear() { tone(180, 0.12, { type: 'square', gain: 0.06, to: 120 }); },
  land() { tone(220, 0.14, { type: 'triangle', gain: 0.12, to: 320 }); },
  bounce(n) { tone(300 + n * 110, 0.09, { type: 'triangle', gain: 0.10, to: 200 + n * 80 }); },
  pickup() {
    tone(520, 0.09, { type: 'triangle', gain: 0.14 });
    tone(780, 0.12, { type: 'triangle', gain: 0.12, delay: 0.07 });
  },
  hey() { tone(400, 0.16, { type: 'sawtooth', gain: 0.10, to: 250 }); },
  horn() {
    tone(392, 0.26, { type: 'square', gain: 0.10 });
    tone(494, 0.26, { type: 'square', gain: 0.08 });
    tone(330, 0.20, { type: 'square', gain: 0.07, delay: 0.24 });
  },
  squish() {
    tone(150, 0.20, { type: 'sine', gain: 0.16, to: 55 });
    noise(0.18, 0.18, 900, 120);
    tone(95, 0.14, { type: 'square', gain: 0.09, to: 42, delay: 0.16 });
    noise(0.12, 0.12, 400, 90, 0.16);
  },
  stone() {
    noise(0.55, 0.09, 260, 80);
    tone(62, 0.6, { type: 'sine', gain: 0.09, to: 120 });
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
  /** Bensavaroitus: matala ja rauhallinen, tiivistyy tankin tyhjetessä. */
  warn() { tone(196, 0.10, { type: 'square', gain: 0.06, to: 165 }); },
  /** Lähestymisvaroitus: korkea ja tiheä, teline alhaalla ja vauhtia liikaa. */
  fast() { tone(1175, 0.05, { type: 'square', gain: 0.05 }); },
  buy() {
    tone(330, 0.10, { type: 'square', gain: 0.12 });
    tone(494, 0.12, { type: 'triangle', gain: 0.14, delay: 0.09 });
    tone(659, 0.20, { type: 'triangle', gain: 0.14, delay: 0.19 });
  },
  levelStart() {
    tone(392, 0.11, { type: 'triangle', gain: 0.13 });
    tone(523, 0.11, { type: 'triangle', gain: 0.13, delay: 0.10 });
    tone(784, 0.22, { type: 'triangle', gain: 0.13, delay: 0.20 });
  },
  go() {
    tone(660, 0.09, { type: 'square', gain: 0.13 });
    tone(990, 0.16, { type: 'triangle', gain: 0.14, delay: 0.07 });
  },
  cutscene() {
    const seq = [262, 330, 392, 523, 659, 784, 1047];
    seq.forEach((f, i) => tone(f, 0.28, { type: 'triangle', gain: 0.11, delay: i * 0.33 }));
    tone(131, 2.4, { type: 'sine', gain: 0.07, to: 262 });
    tone(196, 1.6, { type: 'sine', gain: 0.06, to: 392, delay: 2.6 });
  },
  bonus() {
    tone(784, 0.10, { type: 'triangle', gain: 0.12, delay: 0.5 });
    tone(1047, 0.10, { type: 'triangle', gain: 0.12, delay: 0.6 });
    tone(1319, 0.22, { type: 'triangle', gain: 0.12, delay: 0.7 });
  },
  win() {
    tone(523, 0.12, { type: 'triangle', gain: 0.15 });
    tone(659, 0.12, { type: 'triangle', gain: 0.15, delay: 0.11 });
    tone(784, 0.14, { type: 'triangle', gain: 0.15, delay: 0.22 });
    tone(1047, 0.30, { type: 'triangle', gain: 0.14, delay: 0.34 });
    tone(1319, 0.5, { type: 'triangle', gain: 0.12, delay: 0.5 });
  },
  /** Hyppy hyperavaruuteen: vuoro suoritettu. */
  warp() {
    noise(1.6, 0.10, 180, 3000);
    tone(70, 1.4, { type: 'sawtooth', gain: 0.07, to: 520 });
  },
  /** Taksit loppu: moottorit sammuvat ja jäljelle jää hiljaisuus. */
  fade() {
    tone(220, 1.8, { type: 'sine', gain: 0.08, to: 55 });
    tone(165, 2.2, { type: 'sine', gain: 0.06, to: 41, delay: 0.3 });
    noise(1.2, 0.05, 400, 60);
  },
};

/* ------------------------------------------------------------------- tila */
const MENU = 0, PLAY = 1, OVER = 2, BUY = 3, CUT = 4, ENTER = 5;
let state = MENU;

let taxi, money, fuel, lives, job, served, gateOpen, runT, dead, deadT,
    msg, msgT, bits, lowWarn, fastWarn, graves, squishes, wreck, bounces,
    titleT, cut, enterT, goT, levelMoney0, hornFx, levelDeaths,
    runDeaths = 0, runRuns = 0, carried = null, hyper = null, endTimer = 0;

const stars = [];
for (let i = 0; i < 70; i++) {
  stars.push({ x: rand(20, W - 20), y: rand(20, H - 20), r: rand(0.6, 1.8), a: rand(0.1, 0.5), p: rand(0, 6.3) });
}

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

const api = () => ({ P, taxi, pads: PADS, walls: WALLS, t: runT, rand, say, level: levelIndex });

/** Kentän tilanne nollataan vain tässä — ei koskaan kolarissa. */
function loadLevel(i) {
  levelIndex = clamp(i, 0, LEVELS.length - 1);
  level = LEVELS[levelIndex];
  GATE = level.gate;
  WALLS = frameWalls(GATE).concat(level.walls || []);
  PADS = (level.pads || []).map(p => Object.assign({ h: 18 }, p, { bx: p.x, by: p.y }));
  served = {};
  for (const p of numbered()) served[p.id] = false;
  gateOpen = false;
  graves = []; squishes = []; bits = []; wreck = null; bounces = 0; hornFx = 0;
  msg = ''; msgT = 0; titleT = 0; goT = 0;
  lowWarn = 0; fastWarn = 0;
  job = null;
  levelMoney0 = money;
  levelDeaths = 0;
  resetTaxi();
  if (level.init) level.init(api());

  if (carried) {
    /* Edellisestä kentästä mukaan tullut asiakas: kenttä alkaa jättökeikalla
       ja mittari alkaa nollasta, koska välimatka ei ole hänen syytään. */
    const open = numbered().filter(p => !served[p.id]);
    job = {
      from: null, to: pick(open.length ? open : numbered()).id,
      phase: 'aboard', wait: 0, kind: carried.kind,
      x: 0, t: 0, walk: 0, moving: false, shown: true, flee: null,
    };
    carried = null;
  } else {
    spawnJob(null, 1.2, level.firstFrom);
  }
}

function beginEntry(showTitle) {
  taxi = {
    x: GATE.x + GATE.w / 2, y: -60,
    vx: 0, vy: 300, gear: 0, gearWant: false, landed: null,
  };
  fuel = FUEL_MAX;
  dead = false; deadT = 0; wreck = null; bounces = 0;
  gateOpen = true;
  enterT = 0; goT = 0;
  lowWarn = 0; fastWarn = 0;
  titleT = showTitle ? 2.0 : 0;
  state = ENTER;
  sfx.levelStart();
}

function beginLevel(i, showTitle) {
  loadLevel(i);
  beginEntry(showTitle);
  hideCard();
}

function newRun() {
  money = 40; lives = 3; runT = 0;
  bag = []; lastKind = -1;
  cut = null; carried = null; hyper = null;
  runDeaths = 0; runRuns = 0;
  loadLevel(0);
}

/** Taksi aloitusalustalle. Käytetään vain kentän latauksessa — pelaajan taksi
    saapuu aina luukusta. */
function resetTaxi() {
  const p = padById(level.start) || numbered()[0];
  taxi = {
    x: p.x + p.w / 2, y: p.y - (TH / 2 + GEAR),
    vx: 0, vy: 0, gear: 1, gearWant: true, landed: p,
  };
  fuel = FUEL_MAX;
  dead = false; deadT = 0; wreck = null; bounces = 0;
}

/* Uusi keikka.
 *
 * Nouto arvotaan vapaasti mille tahansa alustalle, paitsi sille jolla juuri
 * seistään — muuten taksi ei liikkuisi keikkojen välissä. Määränpää sen sijaan
 * on aina jokin käymätön alusta, ja jos sellaista ei ole, asiakas pyytää ylös.
 */
function spawnJob(avoidId, delay, forceFrom) {
  const pool = numbered().filter(p => p.id !== avoidId);
  const from = forceFrom !== undefined && padById(forceFrom)
    ? forceFrom
    : pick(pool.length ? pool : numbered()).id;
  const open = numbered().filter(p => !served[p.id] && p.id !== from);
  newJob(from, open.length ? pick(open).id : 'up', delay);
}

function newJob(from, to, delay) {
  const p = padById(from);
  const left = p.x + 20, right = p.x + p.w - 20;
  const taken = e =>
    graves.some(g => g.pad === from && Math.abs(g.x - e) < 26) ||
    squishes.some(s => s.pad === from && Math.abs(s.x - e) < 26);
  let x;
  if (taken(left) && !taken(right)) x = right;
  else if (taken(right) && !taken(left)) x = left;
  else x = Math.random() < 0.5 ? left : right;
  job = {
    from, to, phase: 'wait', wait: delay || 0,
    kind: nextAlien(),
    x, t: 0, walk: 0, moving: false, shown: false, flee: null,
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
  inBox(p, GEAR_BOX) || inBox(p, HORN_BOX) ||
  inBox(p, MUTE_BOX) || inBox(p, COG_BOX) || inBox(p, FULL_BOX);

function toggleGear() {
  if (state !== PLAY || dead) return;
  taxi.gearWant = !taxi.gearWant;
  sfx.gear();
}

/* Töötti kuuluu 150 pikselin päähän. Jos odottava asiakas kuulee sen, hän
   säikähtää ja kipittää alustan toiseen laitaan. */
function honk() {
  if (state !== PLAY || dead) return;
  sfx.horn();
  hornFx = 0.55;
  if (!job || job.phase !== 'wait' || !job.shown) return;
  const p = padById(job.from);
  if (!p) return;
  if (Math.hypot(taxi.x - job.x, taxi.y - p.y) > HORN_R) return;
  const mid = p.x + p.w / 2;
  job.flee = job.x < mid ? p.x + p.w - 20 : p.x + 20;
  say(t('msg.coming'), 1.6);
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
  if (inBox(p, HORN_BOX)) { honk(); return; }
  if (inBox(p, MUTE_BOX)) { toggleMute(); return; }
  if (inBox(p, COG_BOX)) { togglePanel(); return; }
  if (inBox(p, FULL_BOX)) toggleFullscreen();
});

/* Näppäimistöllä pärjää ilman hiirtä: kortin napit ovat omilla näppäimillään,
   töötti molemmissa shifteissä (vasen käsi sauvalla, oikea telineellä). */
addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;
  if (e.repeat) return;
  KEY[e.code] = true;

  if (!card.classList.contains('hidden')) {
    const click = sel => {
      const b = card.querySelector(sel);
      if (!b) return false;
      b.click();
      return true;
    };
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      e.preventDefault();
      if (click('#go') || click('#buy')) return;
    }
    if (e.code === 'Digit1' || e.code === 'Numpad1') { if (click('#buy')) return; }
    if (e.code === 'Digit3' || e.code === 'Numpad3') { if (click('#fleet')) return; }
    if (e.code === 'Escape' || e.code === 'KeyL') { if (click('#end')) return; }
  }

  if (e.code === 'KeyM') { toggleMute(); return; }
  if (e.code === 'KeyF') { toggleFullscreen(); return; }
  if (e.code === 'KeyP') { togglePanel(); return; }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyH') { honk(); return; }
  if (e.code === 'Space' || e.code === 'KeyG') { e.preventDefault(); toggleGear(); }
});
addEventListener('keyup', e => { KEY[e.code] = false; });

const stick = createJoystick({
  target: canvas,
  toLocal: toLogical,
  radius: 96,
  ignore: onButtons,
});
stick.gain = P.stick;

function inputVector() {
  const kx = (KEY.ArrowRight || KEY.KeyD ? 1 : 0) - (KEY.ArrowLeft || KEY.KeyA ? 1 : 0);
  const ky = (KEY.ArrowDown || KEY.KeyS ? 1 : 0) - (KEY.ArrowUp || KEY.KeyW ? 1 : 0);
  let v;
  if (kx || ky) {
    const l = Math.hypot(kx, ky) || 1;
    v = { x: kx / l, y: ky / l };
  } else if (stick.active) {
    let x = stick.x * stick.gain, y = stick.y * stick.gain;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    v = { x, y };
  } else v = { x: 0, y: 0 };
  return level.input ? level.input(v, api()) : v;
}

function activeThrust() {
  if (state !== PLAY || dead || fuel <= 0) return { x: 0, y: 0 };
  const v = inputVector();
  if (taxi.gear > 0.35) v.x = 0;
  if (taxi.landed) { v.x = 0; if (v.y > 0) v.y = 0; }
  return v;
}

/* ------------------------------------------------------------- törmäykset */
function taxiBox(t2) {
  const gl = GEAR * t2.gear;
  return { x: t2.x - TW / 2, y: t2.y - TH / 2, w: TW, h: TH + gl };
}
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function solids() {
  const list = WALLS.slice();
  if (!gateOpen) list.push(gateBar());
  for (const p of PADS) list.push(p);
  return list;
}

/** Kuinka lähellä laskurajaa ollaan: yli 1 hajottaa taksin. */
const landRatio = () => Math.max(taxi.vy / P.landVY, Math.abs(taxi.vx) / P.landVX);

/* Kolari vie taksin ja kyydissä olleen asiakkaan — syytä ei selitetä, romu
   kertoo sen itse. Kaikki muu kentän tilanne jää koskematta. */
function crash() {
  if (dead) return;
  dead = true; deadT = 0;
  lives--;
  levelDeaths++;
  if (job && job.phase === 'aboard') {
    if (job.to === 'up') gateOpen = false;
    // menetetty kyyti: sama keikka odottamaan, tai uusi jos lähtöä ei ole
    if (padById(job.from)) newJob(job.from, job.to, 1.2);
    else spawnJob(null, 1.2);
  }
  msg = ''; msgT = 0;
  wreck = {
    x: taxi.x, y: taxi.y,
    vx: taxi.vx * 0.5 + rand(-60, 60),
    vy: Math.min(taxi.vy * 0.3, 40) - rand(90, 170),
    rot: 0, spin: rand(-5, 5), puff: 0,
  };
  burst(taxi.x, taxi.y, '#ffd479', 8, 220);
  jetLevel(0);
  if (SPEAKS) { try { speechSynthesis.cancel(); } catch (e) {} }
  sfx.crash();
}

function touchdown(pad, b) {
  const t2 = taxi;
  const ratio = landRatio();

  if (t2.gear < 0.85) return crash();
  if (b.x < pad.x - 2 || b.x + b.w > pad.x + pad.w + 2) return crash();
  if (ratio > 1) return crash();

  if (ratio > P.bounceFrom) {
    const gl = GEAR * t2.gear;
    const lift = liftFor(ratio, P);
    t2.y = pad.y - (TH / 2 + gl) - lift;
    t2.vy = Math.max(0, t2.vy) * P.bounceKeep;
    t2.vx *= P.bounceKeep;
    bounces = Math.min(bounces + 1, 3);
    sfx.bounce(bounces);
    return;
  }

  const soft = t2.vy;
  t2.y = pad.y - (TH / 2 + GEAR * t2.gear);
  t2.vx = 0; t2.vy = 0; t2.landed = pad; t2.gearWant = true;
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
    served[pad.id] = true;                  // jättö merkkaa alustan käydyksi
    say(t('msg.thanks', { fare, tip }), 2.6);
    burst(taxi.x, taxi.y - 20, '#6fe3ff', 16, 160);
    sfx.pay();
    speakLine('thanks', kind);
    job = null;
    spawnJob(pad.id, 1.6);
    return;
  }

  if (job.phase === 'wait' && pad.id === job.from && job.shown) {
    const b = taxiBox(taxi);
    if (job.x > b.x - 6 && job.x < b.x + b.w + 6) {
      if (graves.length + squishes.length < GRAVE_MAX) {
        squishes.push({ pad: pad.id, x: job.x, kind: job.kind, walk: job.walk, t: 0, rang: false });
      }
      say(t('msg.oops'), 1.8);
      sfx.squish();
      newJob(job.from, job.to, SQ_DUR + 0.4);
    }
  }
}

function jobStep(dt) {
  if (!job) return;
  if (job.phase === 'aboard') { job.t += dt; return; }

  if (job.wait > 0) { job.wait -= dt; return; }
  if (!job.shown) {
    job.shown = true;
    say(t('msg.hey'), 2.2);
    sfx.hey();
    speakLine('hey', job.kind);
  }

  // töötti pani liikkeelle: juoksee laidasta toiseen ennen kyytiin nousua
  if (job.flee !== null) {
    const d = job.flee - job.x;
    job.moving = true;
    job.x += Math.sign(d) * Math.min(Math.abs(d), 150 * dt);
    job.walk += dt * 13;
    if (Math.abs(d) < 2) job.flee = null;
    return;
  }

  job.moving = false;
  if (!dead && taxi.landed && taxi.landed.id === job.from) {
    const b = taxiBox(taxi);
    const target = job.x < taxi.x ? b.x - 10 : b.x + b.w + 10;
    const d = target - job.x;
    if (Math.abs(d) < 3) {
      job.phase = 'aboard'; job.t = 0;
      served[job.from] = true;              // nouto merkkaa alustan käydyksi
      if (job.to === 'up') {
        gateOpen = true;
        say(t('msg.up'), 3);
        speakLine('up', job.kind);
        sfx.gate();
      } else {
        say(t('msg.toPad', { n: job.to }), 2.4);
        speakLine('toPad', job.kind, { n: job.to });
        sfx.pickup();
      }
      return;
    }
    job.moving = true;
    job.x += Math.sign(d) * Math.min(Math.abs(d), 95 * dt);
  }
  job.walk += dt * (job.moving ? 9 : 3);
}

/* Yliajo: tyyppi litistyy jalkoihinsa kuin kaatuva pahvikuva, häipyy, ja
   sitten hautakivi nousee maasta. Kivi kirjataan vasta lopuksi. */
function stepSquish(dt) {
  for (let i = squishes.length - 1; i >= 0; i--) {
    const s = squishes[i];
    s.t += dt;
    if (!s.rang && s.t >= SQ_FALL + SQ_WAIT) { s.rang = true; sfx.stone(); }
    if (s.t >= SQ_DUR) {
      graves.push({ pad: s.pad, x: s.x, kind: s.kind });
      squishes.splice(i, 1);
    }
  }
}

const fareNow = () => job && job.phase === 'aboard'
  ? P.fare + Math.round(P.tip * Math.max(0, 1 - job.t / P.tipTime))
  : 0;

/* Noutoalusta syttyy vasta kun asiakas on ilmestynyt, ei jo odotusajan
   aikana. */
const targetId = () => {
  if (!job) return null;
  if (job.phase === 'aboard') return job.to;
  return job.shown ? job.from : null;
};

function movePads() {
  for (const p of PADS) {
    if (!p.move) continue;
    const m = p.move;
    const a = Math.sin((runT / (m.secs || 4) + (m.phase || 0)) * Math.PI * 2);
    const nx = p.bx + (m.x || 0) * a, ny = p.by + (m.y || 0) * a;
    const dx = nx - p.x, dy = ny - p.y;
    p.x = nx; p.y = ny;
    if (taxi.landed === p) { taxi.x += dx; taxi.y += dy; }
    if (job && job.from === p.id && job.phase === 'wait') job.x += dx;
    for (const g of graves) if (g.pad === p.id) g.x += dx;
    for (const s of squishes) if (s.pad === p.id) s.x += dx;
  }
}

/* ------------------------------------------------------------ varoitukset */
function warnings(dt) {
  if (fuel < FUEL_LOW && fuel > 0 && !dead) {
    lowWarn -= dt;
    if (lowWarn <= 0) { sfx.warn(); lowWarn = 0.25 + fuel / 45; }
  } else lowWarn = 0;

  if (!dead && taxi && !taxi.landed && taxi.gear > 0.5 && landRatio() > 1) {
    fastWarn -= dt;
    if (fastWarn <= 0) { sfx.fast(); fastWarn = 0.13; }
  } else fastWarn = 0;
}

/* ------------------------------------------------------------ sisääntulo */
function updateEnter(dt) {
  runT += dt;
  enterT += dt;
  if (titleT > 0) titleT -= dt;
  if (hornFx > 0) hornFx -= dt;
  stepBits(dt);
  stepSquish(dt);
  movePads();

  const d = ENTER_Y - taxi.y;
  taxi.vy = clamp(d * 2.6, 0, 300);
  taxi.y += taxi.vy * dt;
  jetLevel(clamp(1 - taxi.vy / 300, 0.15, 1) * 0.5);
  if (taxi.y > 90) gateOpen = false;

  if (d < 3 || enterT > 4) {
    taxi.y = ENTER_Y;
    taxi.vy = 0;
    goT = 0.8;
    state = PLAY;
    sfx.go();
  }
}

/* ---------------------------------------------------------------- päivitys */
function update(dt) {
  runT += dt;
  if (msgT > 0) msgT -= dt;
  if (titleT > 0) titleT -= dt;
  if (goT > 0) goT -= dt;
  if (hornFx > 0) hornFx -= dt;
  stepBits(dt);
  stepSquish(dt);
  movePads();
  if (level.update) level.update(dt, api());

  if (dead) {
    deadT += dt;
    jetLevel(0);
    lowWarn = 0; fastWarn = 0;
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
      if (lives <= 0) return taxiLost();
      beginEntry(false);                     // korvaava taksi tulee luukusta
    }
    return;
  }

  taxi.gear += clamp((taxi.gearWant ? 1 : 0) - taxi.gear, -dt * 4, dt * 4);
  if (taxi.landed) taxi.y = taxi.landed.y - (TH / 2 + GEAR * taxi.gear);

  warnings(dt);                              // piippaukset myös alustalla

  const v = activeThrust();
  const raw = inputVector();

  if (taxi.landed) {
    jetLevel(0);
    if (taxi.landed.fuel) refuel(dt);
    if (fuel <= 0.5 && !taxi.landed.fuel) { crash(); return; }
    if (raw.y < -0.2 && fuel > 0) taxi.landed = null;
    else { jobStep(dt); return; }
  }

  const throttle = Math.min(1, Math.hypot(v.x, v.y));
  if (throttle > 0) {
    const had = fuel;
    fuel = Math.max(0, fuel - P.burn * throttle * dt);
    if (had > 0 && fuel <= 0) say(t('msg.dry'), 3);
  }
  jetLevel(throttle);

  taxi.vx += v.x * P.thrust * dt;
  taxi.vy += v.y * P.thrust * dt + P.grav * dt;

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
  for (const r of solids()) if (hit(b, r)) return crash();
}

function refuel(dt) {
  if (fuel >= FUEL_MAX || money <= 0) return;
  const want = Math.min(P.refuel * dt, FUEL_MAX - fuel, money / P.price);
  if (want <= 0) return;
  fuel += want;
  money -= want * P.price;
  if (Math.random() < dt * 12) sfx.pump();
}

/* Ulos luukusta. Jos kenttiä on vielä jäljellä, kyydissä oleva asiakas jatkaa
   matkaa seuraavaan kenttään ja maksaa vasta siellä perillä. Viimeisellä
   kentällä matka päättyy tähän, joten hän maksaa nyt. */
function finish() {
  const nextIndex = levelIndex < LEVELS.length - 1 ? levelIndex + 1 : null;
  let paid = P.exitBonus;
  if (job && job.phase === 'aboard') {
    if (nextIndex === null) {
      paid += P.fare + Math.round(P.tip * Math.max(0, 1 - job.t / P.tipTime));
      speakLine('thanks', job.kind);
    } else {
      carried = { kind: job.kind };
    }
    job = null;
  }
  money += paid;
  jetLevel(0);
  startCut(nextIndex);
}

function taxiLost() {
  jetLevel(0);
  if (money >= TAXI_PRICE) {
    state = BUY;
    showCard(buyCard(), 0, null);
  } else gameOver(false);
}

/* Ostetut taksit jatkavat samaa kenttää: käydyt alustat, hautakivet ja
   odottava asiakas säilyvät, uusi auto vain tulee sisään katon luukusta. */
function buyTaxis(count, price) {
  money -= price;
  lives = count;
  sfx.buy();
  beginEntry(false);
  hideCard();
}

/* Vuoro päättyy. Ensin pelkkä tausta — suoritetusta vuorosta hyperavaruus,
   loppuneista takseista valuvat tähdet — ja vasta parin sekunnin päästä kortti
   häivähtää päälle. Pysäytyskuva kentästä näyttäisi siltä kuin peli olisi
   jäänyt jumiin, ja heti ilmestyvä kortti veisi koko efektin. */
function gameOver(won) {
  state = OVER;
  jetLevel(0);
  money = Math.round(money);
  hyper = createHyperspace({ W, H, rand, mode: won ? 'warp' : 'drift' });
  if (won) sfx.warp(); else sfx.fade();
  hideCard();

  const html = won ? overWon() : overLost();
  const pending = money;
  const meta = { cleared: won, seconds: runT, level: levelIndex + 1 };
  clearTimeout(endTimer);
  endTimer = setTimeout(() => {
    if (state === OVER) showCard(html, pending, meta, true);
  }, END_CARD_DELAY);
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

/* Kentän tilinpäätös ja välianimaatio. nextIndex === null tarkoittaa vuoron
   viimeistä ruutua: pelkkä nousu, koko vuoron luvut, ja sen jälkeen kortti. */
function startCut(nextIndex) {
  const earned = Math.round(money - levelMoney0);
  const runs = graves.length + squishes.length;
  const cleanDrive = levelDeaths === 0, cleanPads = runs === 0;
  const bonus = (cleanDrive ? CLEAN_BONUS : 0) + (cleanPads ? CLEAN_BONUS : 0);
  money += bonus;
  runDeaths += levelDeaths;
  runRuns += runs;

  const last = nextIndex === null;
  const nxt = last ? level : LEVELS[nextIndex];

  const stats = last ? [
    { text: t('cut.shift'), head: true },
    { text: t('cut.levels', { n: LEVELS.length }) },
    { text: t('cut.time', { n: Math.round(runT) }) },
    {
      icon: 'wreck', good: runDeaths === 0,
      text: t(runDeaths === 0 ? 'cut.crashesClean' : 'cut.crashes', { n: runDeaths, b: CLEAN_BONUS }),
    },
    {
      icon: 'grave', good: runRuns === 0,
      text: t(runRuns === 0 ? 'cut.runsClean' : 'cut.runs', { n: runRuns, b: CLEAN_BONUS }),
    },
    { text: t('cut.cash', { n: Math.round(money) }) },
  ] : [
    { text: t('cut.clear', { name: level.name.toUpperCase() }), head: true },
    { text: t('cut.pads', { n: numbered().length }) },
    { text: t('cut.earned', { n: earned }) },
    {
      icon: 'wreck', good: cleanDrive,
      text: t(cleanDrive ? 'cut.crashesClean' : 'cut.crashes', { n: levelDeaths, b: CLEAN_BONUS }),
    },
    {
      icon: 'grave', good: cleanPads,
      text: t(cleanPads ? 'cut.runsClean' : 'cut.runs', { n: runs, b: CLEAN_BONUS }),
    },
    { text: t('cut.cash', { n: Math.round(money) }) },
  ];

  cut = createCut({
    W, H, TW, TH, rand,
    upSecs: last ? 3.6 : 3,
    downSecs: last ? 0 : 2.4,
    fromGlow: level.glow || '#6fe3ff',
    toGlow: nxt.glow || '#6fe3ff',
    name: nxt.name,
    label: t('cut.level', { i: (nextIndex || 0) + 1, t: LEVELS.length }),
    stats,
    body: () => taxiShape(TW, TH, false),
  });
  cut.idx = nextIndex;
  state = CUT;
  if (last) sfx.win();
  else {
    sfx.cutscene();
    if (bonus) sfx.bonus();
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

  if (!r.win) return;
  for (let y = r.y + 22, row = 0; y < r.y + r.h - 18; y += 38, row++) {
    for (let x = r.x + 14, colN = 0; x < r.x + r.w - 20; x += 34, colN++) {
      const lit = ((row * 7 + colN * 13 + r.x) % 5) < 2;
      ctx.fillStyle = lit ? 'rgba(255,212,121,.30)' : 'rgba(120,160,255,.09)';
      ctx.fillRect(x, y, 18, 22);
    }
  }
}

/* Käyty alusta on aina vihreä pallo väkäsineen — sama merkki riippumatta
   siitä onko alusta juuri nyt kohde vai ei. */
function drawPad(p) {
  const isTarget = !p.fuel && p.id === targetId();
  const done = !p.fuel && served[p.id];
  const col = p.fuel ? '#ffd479' : (isTarget ? '#6fe3ff' : '#ff5d7a');

  ctx.fillStyle = p.fuel ? '#3a3320' : (isTarget ? '#20394a' : '#3a2230');
  ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, 4); ctx.fill();

  ctx.fillStyle = col;
  ctx.shadowColor = col; ctx.shadowBlur = isTarget ? 22 : 12;
  ctx.fillRect(p.x + 6, p.y, p.w - 12, 3);
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(30,40,70,.85)';
  ctx.fillRect(p.x + 12, p.y + p.h, 8, 14);
  ctx.fillRect(p.x + p.w - 20, p.y + p.h, 8, 14);

  const bx = p.x + p.w / 2, by = p.y + p.h + 22;
  ctx.textAlign = 'center';

  if (done) {
    ctx.fillStyle = '#7bf0a0';
    ctx.shadowColor = '#7bf0a0'; ctx.shadowBlur = isTarget ? 18 : 10;
    ctx.beginPath(); ctx.arc(bx, by, 12, 0, 6.3); ctx.fill();
    ctx.shadowBlur = 0;
    if (isTarget) {
      ctx.strokeStyle = '#6fe3ff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(bx, by, 15, 0, 6.3); ctx.stroke();
    }
    ctx.strokeStyle = '#08111e'; ctx.lineWidth = 3;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx - 5.5, by);
    ctx.lineTo(bx - 1.5, by + 4.5);
    ctx.lineTo(bx + 5.5, by - 4.5);
    ctx.stroke();
    return;
  }

  ctx.beginPath(); ctx.arc(bx, by, 13, 0, 6.3);
  ctx.fillStyle = 'rgba(8,13,30,.75)'; ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = isTarget ? 2.5 : 1.6; ctx.stroke();
  ctx.fillStyle = col;
  if (p.fuel) {
    ctx.beginPath();
    ctx.moveTo(bx, by - 7);
    ctx.quadraticCurveTo(bx + 6, by + 1, bx, by + 6);
    ctx.quadraticCurveTo(bx - 6, by + 1, bx, by - 7);
    ctx.fill();
  } else {
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(String(p.id), bx, by + 5);
  }
}

function drawGate() {
  if (!gateOpen) {
    drawWall(gateBar());
    ctx.fillStyle = 'rgba(255,93,122,.5)';
    for (let x = GATE.x + 6; x < GATE.x + GATE.w - 6; x += 18) ctx.fillRect(x, 3, 8, 10);
    return;
  }
  drawGateGlow(ctx, GATE, CEIL, level.glow || '#6fe3ff', runT);
}

/* ------------------------------------------------------------------ alienit */
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

  ctx.lineWidth = 2.6;
  for (let i = 0; i < A.legs; i++) {
    const base = A.legs === 2 ? (i ? 5 : -5) : (i - (A.legs - 1) / 2) * 4.5;
    const sw = walking ? Math.sin(phase + i * Math.PI) * 5 : 0;
    ctx.beginPath();
    ctx.moveTo(base * 0.5, hip);
    ctx.lineTo(base + sw, bob);
    ctx.stroke();
  }

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

  ctx.lineWidth = 2.3;
  for (let i = 0; i < A.arms; i++) {
    const side = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    const sx = side * w / 2 * 0.85, sy = top + 5 + row * 6;
    let ex = sx + side * 9, ey = sy + 7;
    if (waving && side === 1 && row === 0) {
      const a = -1.15 + Math.sin(phase * 2.6) * 0.45;
      ex = sx + Math.cos(a) * 11; ey = sy + Math.sin(a) * 11;
    } else if (walking) {
      ey = sy + 7 + Math.sin(phase + (side > 0 ? Math.PI : 0)) * 3.5;
    }
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  }

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

function drawGraveAt(x, y, kind) {
  ctx.save();
  ctx.translate(x, y);
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
  ctx.fillStyle = ALIENS[kind % ALIENS.length].c;
  ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.arc(11, -3, 2.6, 0, 6.3); ctx.fill();
  ctx.restore();
}

function drawGrave(g) {
  const p = padById(g.pad);
  if (p) drawGraveAt(g.x, p.y, g.kind);
}

function drawSquish(s) {
  const p = padById(s.pad);
  if (!p) return;

  if (s.t < SQ_FALL + SQ_WAIT) {
    const f = clamp(s.t / SQ_FALL, 0, 1);
    const e = 1 - Math.pow(1 - f, 3);
    const alpha = s.t > SQ_FALL ? clamp(1 - (s.t - SQ_FALL) / SQ_WAIT, 0, 1) : 1;
    ctx.save();
    ctx.translate(s.x, p.y);
    ctx.scale(1 + e * 0.55, 1 - e * 0.94);
    drawAlien(s.kind, 0, 0, s.walk, false, false, alpha);
    ctx.restore();
    if (s.t < SQ_FALL) return;
    ctx.save();
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = ALIENS[s.kind % ALIENS.length].c;
    ctx.beginPath(); ctx.ellipse(s.x, p.y - 2, 16, 3, 0, 0, 6.3); ctx.fill();
    ctx.restore();
    return;
  }

  const r = clamp((s.t - SQ_FALL - SQ_WAIT) / SQ_RISE, 0, 1);
  const e = 1 - Math.pow(1 - r, 2);
  ctx.save();
  ctx.beginPath(); ctx.rect(s.x - 20, p.y - 46, 40, 46); ctx.clip();
  drawGraveAt(s.x, p.y + (1 - e) * 26, s.kind);
  ctx.restore();
}

function drawPassenger() {
  if (!job || job.phase !== 'wait' || !job.shown) return;
  const p = padById(job.from);
  if (!p) return;
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
  if (broken) {
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
  const t2 = taxi, gl = GEAR * t2.gear;
  ctx.save();
  ctx.translate(t2.x, t2.y);

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

function drawHorn() {
  if (hornFx <= 0 || !taxi) return;
  const p = 1 - hornFx / 0.55;
  ctx.save();
  ctx.globalAlpha = (1 - p) * 0.5;
  ctx.strokeStyle = '#ffd479';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(taxi.x, taxi.y, HORN_R * p, 0, 6.3); ctx.stroke();
  ctx.restore();
}

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
  const blink = fuel < FUEL_LOW ? 0.55 + Math.sin(runT * 9) * 0.45 : 1;
  ctx.globalAlpha = blink;
  bar(26, 74, 200, 11, f, f > 0.45 ? '#7bf0a0' : f > 0.2 ? '#ffd479' : '#ff5d7a', t('ui.fuel'));
  ctx.globalAlpha = 1;

  drawLives();

  const total = numbered().length;
  const done = numbered().filter(p => served[p.id]).length;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8a97be';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText(gateOpen && state === PLAY ? t('ui.exit') : t('ui.pads', { d: done, t: total }), W - 26, 74);
  ctx.fillStyle = 'rgba(233,237,255,.35)';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText(`${levelIndex + 1}/${LEVELS.length} · ${level.name.toUpperCase()}`, W - 26, 92);

  const fare = fareNow();
  if (fare) {
    ctx.fillStyle = '#ffd479';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(fare + ' €', W - 26, 124);
    ctx.fillStyle = 'rgba(233,237,255,.45)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(job.to === 'up' ? t('ui.meterUp') : t('ui.meterPad', { n: job.to }), W - 26, 140);
  }

  if (msgT > 0) {
    ctx.globalAlpha = Math.min(1, msgT * 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e9edff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(msg, W / 2, 230);
    ctx.globalAlpha = 1;
  }

  if (titleT > 0) {
    ctx.globalAlpha = clamp(titleT / 0.8, 0, 1) * 0.85;
    ctx.textAlign = 'center';
    ctx.fillStyle = level.glow || '#6fe3ff';
    ctx.shadowColor = level.glow || '#6fe3ff';
    ctx.shadowBlur = 20;
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.fillText(level.name.toUpperCase(), W / 2, H * 0.34);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  if (state === ENTER || goT > 0) {
    const ready = state === ENTER;
    ctx.textAlign = 'center';
    ctx.globalAlpha = ready ? 0.55 + Math.sin(runT * 9) * 0.35 : clamp(goT / 0.45, 0, 1);
    ctx.fillStyle = ready ? '#e9edff' : '#7bf0a0';
    ctx.shadowColor = ready ? 'rgba(233,237,255,.6)' : '#7bf0a0';
    ctx.shadowBlur = 18;
    ctx.font = ready ? '700 46px system-ui, sans-serif' : '700 58px system-ui, sans-serif';
    ctx.fillText(ready ? t('ui.ready') : t('ui.go'), W / 2, H * 0.5);
    ctx.shadowBlur = 0;
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
  const hot = fastWarn > 0;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = hot ? 'rgba(255,93,122,.2)' : down ? 'rgba(111,227,255,.18)' : 'rgba(255,255,255,.07)';
  ctx.strokeStyle = hot ? 'rgba(255,93,122,.9)' : down ? 'rgba(111,227,255,.8)' : 'rgba(233,237,255,.3)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 16); ctx.fill(); ctx.stroke();

  const cx = b.x + b.w / 2, cy = b.y + 38;
  ctx.strokeStyle = hot ? '#ff5d7a' : down ? '#6fe3ff' : '#9fb0d8';
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

  ctx.fillStyle = hot ? '#ff5d7a' : down ? '#6fe3ff' : '#9fb0d8';
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(hot ? t('ui.tooFast') : down ? t('ui.gearDown') : t('ui.gearUp'), cx, b.y + b.h - 14);
  ctx.restore();

  const hb = HORN_BOX, honking = hornFx > 0;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = honking ? 'rgba(255,212,121,.22)' : 'rgba(255,255,255,.07)';
  ctx.strokeStyle = honking ? 'rgba(255,212,121,.9)' : 'rgba(233,237,255,.3)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(hb.x, hb.y, hb.w, hb.h, 16); ctx.fill(); ctx.stroke();

  const hx = hb.x + hb.w / 2, hy = hb.y + 30;
  ctx.strokeStyle = honking ? '#ffd479' : '#9fb0d8';
  ctx.fillStyle = honking ? '#ffd479' : '#9fb0d8';
  ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx - 12, hy - 5); ctx.lineTo(hx - 4, hy - 5);
  ctx.lineTo(hx + 8, hy - 13); ctx.lineTo(hx + 8, hy + 13);
  ctx.lineTo(hx - 4, hy + 5); ctx.lineTo(hx - 12, hy + 5);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(hx + 10, hy, 9, -0.9, 0.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(hx + 10, hy, 15, -0.8, 0.8); ctx.stroke();
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(t('ui.horn'), hx, hb.y + hb.h - 12);
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

/** Tausta: kentän oma taivas tai avaruus, ja valinnainen aurinko. */
function drawSky() {
  const sky = level.sky || ['#0b1230', '#04070f'];
  const g = ctx.createLinearGradient(0, 0, 0, H);
  sky.forEach((c, i) => g.addColorStop(sky.length === 1 ? 0 : i / (sky.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (level.sun) {
    const s = level.sun;
    const halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 2.4);
    halo.addColorStop(0, (s.color || '#ffd089') + 'cc');
    halo.addColorStop(0.35, (s.color || '#ffd089') + '44');
    halo.addColorStop(1, (s.color || '#ffd089') + '00');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 2.4, 0, 6.3); ctx.fill();
    ctx.fillStyle = s.color || '#ffd089';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.3); ctx.fill();
  }

  const dim = level.sky ? 0.3 : 1;
  for (const s of stars) {
    ctx.globalAlpha = s.a * (0.6 + Math.sin(runT * 1.6 + s.p) * 0.4) * dim;
    ctx.fillStyle = '#9fc4ff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.3); ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(120,160,255,.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
}

function draw(v) {
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  drawSky();

  if (level.drawBack) level.drawBack(ctx, api());

  for (const r of WALLS) drawWall(r);
  drawGate();
  for (const p of PADS) drawPad(p);
  for (const gr of graves) drawGrave(gr);
  for (const s of squishes) drawSquish(s);
  drawPassenger();
  drawTaxi(v);
  drawHorn();
  drawWreck();

  for (const b of bits) {
    ctx.globalAlpha = clamp(b.life, 0, 1);
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.3); ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (level.drawFront) level.drawFront(ctx, api());

  if (state !== MENU) drawHud();
  stick.draw(ctx);
  drawButtons();
}

/* ------------------------------------------------------------ säätöpaneeli
   Paneeli on kehittäjän työkalu ja pysyy suomeksi. */
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

  const lvlRow = el('div', 'row');
  const lvlSeg = el('div', 'seg');
  LEVELS.forEach((lv, i) => {
    lvlSeg.append(pbutton(levelIndex === i && (state === PLAY || state === ENTER) ? 'on' : null, lv.name, () => {
      startLevel(i);
      buildPanel();
    }));
  });
  lvlRow.append(el('label', null, 'kenttä'), lvlSeg);
  panelEl.append(lvlRow);

  const langRow = el('div', 'row');
  const langSeg = el('div', 'seg');
  const lang = (code, text) => pbutton(LANG === code ? 'on' : null, text, () => {
    setLang(code);
    if (state === MENU) showCard(menuCard(), 0, null);
    buildPanel();
  });
  langSeg.append(lang('fi', 'suomi'), lang('en', 'english'));
  langRow.append(el('label', null, 'kieli'), langSeg);
  panelEl.append(langRow);

  const sideRow = el('div', 'row');
  const seg = el('div', 'seg');
  const mk = (side, text) => pbutton(gearSide === side ? 'on' : null, text, () => {
    gearSide = side; layout(); saveTune(); buildPanel();
  });
  seg.append(mk('left', 'vasen'), mk('right', 'oikea'));
  sideRow.append(el('label', null, 'napit'), seg);
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
function hideCard() {
  clearTimeout(endTimer);
  card.classList.add('hidden');
  card.style.transition = '';
  card.style.opacity = '';
}

function showCard(html, pending, meta, fade) {
  card.classList.remove('hidden');
  card.innerHTML = html;
  if (fade) {                                // häivytys tähtien päälle
    card.style.transition = 'none';
    card.style.opacity = '0';
    requestAnimationFrame(() => {
      card.style.transition = 'opacity .9s ease';
      card.style.opacity = '1';
    });
  } else {
    card.style.transition = '';
    card.style.opacity = '';
  }
  const lb = card.querySelector('#lb');
  if (lb) mountBoard(lb, pending || 0, meta);
  const go = card.querySelector('#go');
  if (go) go.addEventListener('click', start);
  const buy = card.querySelector('#buy');
  if (buy) buy.addEventListener('click', () => buyTaxis(1, TAXI_PRICE));
  const fleet = card.querySelector('#fleet');
  if (fleet) fleet.addEventListener('click', () => buyTaxis(FLEET_COUNT, FLEET_PRICE));
  const end = card.querySelector('#end');
  if (end) end.addEventListener('click', () => gameOver(false));
  const set = card.querySelector('#set');
  if (set) set.addEventListener('click', togglePanel);
  const fs = card.querySelector('#fs');
  if (fs) fs.addEventListener('click', toggleFullscreen);
}

const buttons = label => `
  <button id="go" class="btn">${label}</button>
  <button id="fs" class="btn ghost">${t('card.full')}</button>
  <button id="set" class="btn ghost">${t('card.tune')}</button>
  <p class="hint">${t('card.keys')}</p>`;

const menuCard = () => `
  <h1>${t('menu.t1')} <span>${t('menu.t2')}</span></h1>
  <p>${t('menu.p1')}</p>
  <p>${t('menu.p2')}</p>
  <p>${t('menu.p3', { bonus: CLEAN_BONUS, levels: LEVELS.length, price: TAXI_PRICE, fleet: FLEET_PRICE })}</p>
  <p class="hint">${t('menu.hint')}</p>
  <div id="lb"></div>
  ${buttons(t('card.play'))}`;

const buyCard = () => `
  <h1>${t('buy.t1')} <span>${t('buy.t2')}</span></h1>
  <div class="big">${Math.floor(money)} €</div>
  <p>${t('buy.p')}</p>
  <button id="buy" class="btn">${t('buy.one', { p: TAXI_PRICE })}</button>
  ${money >= FLEET_PRICE
    ? `<button id="fleet" class="btn">${t('buy.fleet', { c: FLEET_COUNT, p: FLEET_PRICE })}</button>`
    : ''}
  <button id="end" class="btn ghost">${t('buy.end')}</button>
  <p class="hint">${t('buy.keys')}</p>`;

const overWon = () => `
  <h1>${t('won.t1')} <span>${t('won.t2')}</span></h1>
  <div class="big">${Math.round(money)} €</div>
  <p>${t('won.p', { levels: LEVELS.length, secs: Math.round(runT), taxis: Math.max(0, lives) })}</p>
  <div id="lb"></div>
  ${buttons(t('card.again'))}`;

const overLost = () => `
  <h1>${t('lost.t1')} <span>${t('lost.t2')}</span></h1>
  <div class="big">${Math.round(money)} €</div>
  <p>${t('lost.p', { i: levelIndex + 1, t: LEVELS.length, name: level.name, secs: Math.round(runT) })}</p>
  <p class="hint">${t('lost.hint')}</p>
  <div id="lb"></div>
  ${buttons(t('card.again'))}`;

function start() {
  warmSpeech();
  money = 40; lives = 3; runT = 0;
  bag = []; lastKind = -1;
  cut = null; carried = null; hyper = null;
  runDeaths = 0; runRuns = 0;
  beginLevel(0, true);
}

function startLevel(i) {
  warmSpeech();
  money = 40; lives = 3; runT = 0;
  bag = []; lastKind = -1;
  cut = null; carried = null; hyper = null;
  runDeaths = 0; runRuns = 0;
  beginLevel(i, true);
}

newRun();                                  // valikon takana näkyy oikea kenttä
showCard(menuCard(), 0, null);

/* Liput osoitteesta: ?debug=1 säätöpaneeli, ?test=1 pompputesti, ?lang=fi|en. */
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

  if (state === CUT) {
    cut.update(dt);
    jetLevel(0.45);
    if (cut.done) {
      jetLevel(0);
      const nextIndex = cut.idx;
      cut = null;
      if (nextIndex === null) gameOver(true);   // vuoron viimeinen ruutu ohi
      else beginLevel(nextIndex, false);
    } else {
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      cut.draw(ctx);
      requestAnimationFrame(loop);
      return;
    }
  }

  if (state === ENTER) {
    updateEnter(dt);
    draw({ x: 0, y: clamp(1 - taxi.vy / 300, 0.25, 1) });
    requestAnimationFrame(loop);
    return;
  }

  if (state === OVER && hyper) {               // loppuruudun tausta
    hyper.update(dt);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    hyper.draw(ctx);
    requestAnimationFrame(loop);
    return;
  }

  const v = activeThrust();
  if (state === PLAY) update(dt);
  else stepBits(dt);

  draw(v);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
