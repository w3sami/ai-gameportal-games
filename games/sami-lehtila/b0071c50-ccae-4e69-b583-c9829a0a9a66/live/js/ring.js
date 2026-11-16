// The note ring: the whole screen is cut into eight sectors round the car,
// one per lane, and a note is a band right across its sector that closes in
// from the edge of the screen on the ring in the middle. The eyes stay on the
// car and the notes are read out of the corner of the eye, so they are big.
// The targets sit the way the hands do on the home row, forefingers at the
// top: anticlockwise from the top F D S A, clockwise J K L Ö.
// Draws the same things as highway.js, which is the other way to show a chart.

import { LANES, ROW } from './input.js';
import { spark, shower } from './fx.js';

const AHEAD = 4;             // beats a note takes from the outer edge to the ring
const FAR = 2.06;            // the outer edge, in ring radii: past the edge of the screen
const SECTOR_KEY = 1.32;     // where each sector's big key letter stands, in ring radii
const DEG = Math.PI / 180;
const TOP_LEAN = 8 * DEG;      // how far the letters at the top (F J) lean
const BOTTOM_LEAN = 13 * DEG;  // and those at the bottom (A Ö)
const SECTOR_KEY_SIZE = 0.3;   // its height, as a fraction of the ring's smaller radius
const SIDE_EASE = 5 * DEG;     // how much the side letters (D K S L) are brought back from following the ring
const HALF = Math.PI / 8;    // half a sector
const TAP = 0.3;             // how thick a short note is, in beats of travel
const PAST = 0.5;            // beats a missed note keeps sliding inwards before it is dropped
const INK = '#1d1b26';
const TEXT = { perfect: 'Täydellinen', good: 'Hyvä', ok: 'Ok', miss: 'Ohi', stray: 'Huti', held: 'Pidetty', dropped: 'Irti' };
const TEXT_COLOR = {
  perfect: '#ffd23f', good: '#8cff6a', ok: '#bfe9ff', held: '#ffd23f',
  miss: '#ff7a6a', stray: '#ff7a6a', dropped: '#ff7a6a',
};

const LANE = {};
for (const lane of LANES) LANE[lane.id] = lane;
// Each lane's place on the ring, radians clockwise from straight up. The row's
// first key, A, is at the lower left and the rest follow clockwise, 45° apart.
const ANGLE = {};
ROW.forEach((slot, i) => { ANGLE[slot.lane] = ((202.5 + 45 * i) % 360) * Math.PI / 180; });

function layout(view) {
  return {
    cx: view.w / 2,
    cy: view.h * 0.5,
    rx: Math.min(view.w * 0.35, view.h * 0.735),
    ry: view.h * 0.35,
    r: Math.max(14, Math.min(26, Math.min(view.w, view.h) * 0.035)),   // radius of a note
  };
}
// Ring radii away from the centre for a note d beats from its target.
function reach(d) { return 1 + d / AHEAD * (FAR - 1); }
function at(L, lane, k) {
  const a = ANGLE[lane];
  return [L.cx + Math.sin(a) * L.rx * k, L.cy - Math.cos(a) * L.ry * k];
}
function point(L, a, k) { return [L.cx + Math.sin(a) * L.rx * k, L.cy - Math.cos(a) * L.ry * k]; }
// The part of a lane's sector between two radii, as a path.
function wedge(ctx, L, lane, k0, k1, margin) {
  const a0 = ANGLE[lane] - HALF + margin, a1 = ANGLE[lane] + HALF - margin;
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) {
    const p = point(L, a0 + (a1 - a0) * i / 8, k1);
    if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
  }
  for (let i = 8; i >= 0; i--) {
    const p = point(L, a0 + (a1 - a0) * i / 8, k0);
    ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
}
// The stretch of a ring of radius k that lies in a lane's sector, as a path.
function arc(ctx, L, lane, k) {
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const p = point(L, ANGLE[lane] - HALF + 2 * HALF * i / 10, k);
    if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
  }
}
// A glowing line without the canvas shadow blur, which costs far too much per
// frame at this size: the current path stroked a few times, wide and faint
// first, then the line itself. halo is how far the glow reaches, in pixels.
function glowStroke(ctx, color, width, halo, core) {
  const alpha = ctx.globalAlpha;
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha * 0.1; ctx.lineWidth = width + halo * 2; ctx.stroke();
  ctx.globalAlpha = alpha * 0.2; ctx.lineWidth = width + halo; ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = core || color; ctx.lineWidth = width; ctx.stroke();
}
// Bloom. The glowing shapes of a frame are painted small, into a layer an
// eighth of the screen's size, and that layer is blurred once, where a blur
// costs next to nothing. It is then laid back over the picture enlarged, as
// added light, but only inside the boxes round the shapes: in a browser that
// draws without a graphics card the enlarging costs about 5 ns a pixel, 10 ms
// for a whole screen. One blur and one enlargement a frame however many
// shapes there are; a blur and an enlargement per shape cost a quarter of the
// frame rate even with a graphics card.
const BLOOM_DIV = 8;
const BLOOM_BLUR = 1.6;      // blur in the small layer, in its pixels: 13 on screen
const BLOOM_PAD = 40;        // screen pixels the light may spread past a shape
const HELD_BLOOM = 0.2;      // how much of a held note blooms, in ring radii out from the ring
const bloomQueue = [];       // { lane, k0, k1, color, strength } wanted this frame
let bloomSharp = null, bloomSoft = null;      // the small layer before and after the blur
// strength: 0..1. The band of a lane between two radii, in its colour.
function bloomWedge(lane, k0, k1, color, strength) {
  if (settings.bloom === 'off' || strength <= 0.02) return;
  bloomQueue.push({ lane, k0, k1, color, strength });
}
function flushBloom(ctx, view, L) {
  if (!bloomQueue.length) return;
  const w = Math.ceil(view.w / BLOOM_DIV), h = Math.ceil(view.h / BLOOM_DIV);
  if (!bloomSharp) {
    bloomSharp = document.createElement('canvas').getContext('2d');
    bloomSoft = document.createElement('canvas').getContext('2d');
  }
  for (const layer of [bloomSharp, bloomSoft]) {
    if (layer.canvas.width !== w || layer.canvas.height !== h) { layer.canvas.width = w; layer.canvas.height = h; }
  }
  const a = bloomSharp;
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.clearRect(0, 0, w, h);
  a.setTransform(1 / BLOOM_DIV, 0, 0, 1 / BLOOM_DIV, 0, 0);
  ctx.save();
  ctx.beginPath();
  for (const q of bloomQueue) {
    wedge(a, L, q.lane, q.k0, q.k1, 0.02);
    a.globalAlpha = q.strength;
    a.fillStyle = q.color;
    a.fill();
    // The box round the band, on screen, grown by the reach of the light.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i <= 6; i++) {
      const angle = ANGLE[q.lane] - HALF + 2 * HALF * i / 6;
      for (const k of [q.k0, q.k1]) {
        const p = point(L, angle, k);
        x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
      }
    }
    ctx.rect(x0 - BLOOM_PAD, y0 - BLOOM_PAD, x1 - x0 + 2 * BLOOM_PAD, y1 - y0 + 2 * BLOOM_PAD);
  }
  bloomQueue.length = 0;
  const b = bloomSoft;
  b.globalCompositeOperation = 'copy';
  b.filter = `blur(${BLOOM_BLUR}px)`;
  b.drawImage(a.canvas, 0, 0);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(b.canvas, 0, 0, view.w, view.h);
  ctx.restore();
}

// What the player can switch about the ring's look. Kept in localStorage.
//   bloom      'off', 'light' (a blurred glow on notes that are hit, and on
//              held ones by the ring: what a browser without a graphics card
//              can afford) or 'full' (every note glows as well, all the way in)
//   unlock     the player's own streak limits for the loose effects, by UNLOCKS id
//   force      each effect's state where it is not 'auto': 'off' or 'on', by UNLOCKS id
//   particles  the loose effects: sparks from hits and held notes, tails on
//              the notes, a shock wave from a hit on a hard beat, and the
//              shower when a streak reaches a new ten
//   rainbow  a streak cycles through the colours; otherwise it wears the sectors' own
const SETTINGS_KEY = 'tanssiauto.ringLook';
export const BLOOM_LEVELS = [['off', 'pois'], ['light', 'kevyt'], ['full', 'täysi']];
export const settings = { bloom: 'light', rainbow: false, particles: true, unlock: {}, force: {} };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (err) { /* no storage */ }
if (!BLOOM_LEVELS.some(([value]) => value === settings.bloom)) settings.bloom = 'light';
export function setLook(name, value) {
  settings[name] = value;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (err) { /* no storage */ }
}

function ellipse(ctx, L, k) {
  ctx.beginPath();
  ctx.ellipse(L.cx, L.cy, L.rx * k, L.ry * k, 0, 0, Math.PI * 2);
}

// The lane of a screen point: the eighth of the screen it lies in. The middle, where the car is, is nobody's.
export function laneAt(view, x, y) {
  const L = layout(view);
  if (Math.hypot((x - L.cx) / L.rx, (y - L.cy) / L.ry) < 0.45) return null;
  const deg = Math.atan2((x - L.cx) / L.rx, -(y - L.cy) / L.ry) * 180 / Math.PI;
  return ROW[Math.floor((((deg - 180) % 360) + 360) % 360 / 45)].lane;
}

// ---------------------------------------------------------------- effects
const BURST_TIME = 0.32;
const easeOut = (u) => 1 - (1 - u) ** 3;
const STREAK_FROM = 10;
const STREAK_FULL = 30;
const bursts = [];
// The longer the streak, the more of the loose effects join in. Hits in a row
// before each one starts; a streak that breaks takes them all away again.
// These are the defaults: the player's own limits are in settings.unlock.
// A label names what the effect is on first, since the panel lists them by
// limit, in the order they join in, and that order mixes the groups.
export const UNLOCKS = [
  ['neon', 'Auto: neonvärit', 0],             // the car lights up in the colour of the lane that was hit (main.js)
  ['sparks', 'Kehä: kipinät', 4],             // off the ring from hits and held notes
  ['tails', 'Nuotit: hännät', 8],             // behind the notes on their way in
  ['spots', 'Lattia: valokeilat', 12],        // spotlights sweeping the floor (drawn in draw.js)
  ['waves', 'Kehä: väreet', 20],              // a shock wave from a hit on a hard beat
  ['glow', 'Nuotit: hehku', 24],              // every note glows (with the full bloom)
  ['glint', 'Sade: tuike', 30],               // small twinkling dots in the showers
  ['lasers', 'Auto: lasershow', 36],          // beams inside the car (drawn in draw.js)
  ['stars', 'Sade: tähdet', 50],              // stars in the showers
  ['drizzle', 'Sade: jatkuva tihku', 60],     // it never quite stops raining
  ['gunk', 'Sade: roiskeet', 70],             // drops that splat in the showers
];
const SHOWER_KINDS = [['glint', 'glint'], ['stars', 'star'], ['gunk', 'gunk']];      // limit -> what falls
let streakNow = 0;           // the streak as of the last frame drawn
// A streak to pretend, for trying the limits out: the machine's own streak in
// the watch mode passes a hundred in a minute, after which every limit has
// been reached and no slider seems to do anything. null follows the real one.
let trialStreak = null;
export function setTrialStreak(hits) { trialStreak = hits; }
export function streakShown() { return streakNow; }
function limit(effect) { return settings.unlock[effect] ?? UNLOCKS.find(([id]) => id === effect)[2]; }
// Each effect is in one of three states: 'off', 'auto' (on once the streak
// reaches its limit) or 'on' (all the time). Off and on are for trying things
// out: everything off, then one effect after another, without touching the limits.
export const STATES = ['off', 'auto', 'on'];
export function stateOf(effect) { return STATES.includes(settings.force[effect]) ? settings.force[effect] : 'auto'; }
function unlocked(effect) {
  if (!settings.particles) return false;
  const state = stateOf(effect);
  return state === 'on' || (state === 'auto' && streakNow >= limit(effect));
}
// For effects drawn elsewhere: whether the streak has reached one. With no chart
// being followed there is no streak, and the frame loop decides for itself.
export function reached(effect) { return unlocked(effect); }
// What may fall just now, as fx.js kinds.
function fallingKinds() { return SHOWER_KINDS.filter(([effect]) => unlocked(effect)).map(([, kind]) => kind); }
export function setUnlock(effect, hits) {
  settings.unlock[effect] = hits;
  setLook('unlock', settings.unlock);
}
export function setState(effect, state) {
  settings.force[effect] = state;
  setLook('force', settings.force);
}
const waves = [];            // { lane, at }: shock waves running out from the ring
const WAVE_TIME = 0.55;      // seconds a wave takes from the ring to the edge
let glowing = {};            // lane -> [inner, outer] ring radii of each note glowing in it, as of the last frame drawn
let streakTier = 0;
let flashAt = -10;
let drizzleBeat = 0;         // the beat the drizzle last added to

// splash: the hit falls on one of the song's hard beats and gets the big burst.
export function hitEffect(lane, grade, splash) {
  if (splash && unlocked('waves')) waves.push({ lane, at: performance.now() / 1000 });
  if (waves.length > 12) waves.shift();
  bursts.push({ lane, grade, splash, at: performance.now() / 1000 });
  if (bursts.length > 40) bursts.shift();
}

// A spot on the floor for something falling. Gunk lands on the sectors
// outside the ring; stars and glints anywhere on the floor, the open middle
// round the car included.
function landingSpot(L, kind) {
  const inner = kind === 'gunk' ? 1.08 : 0.2;
  for (let tries = 0; tries < 12; tries++) {
    // The square root spreads the spots evenly over the area and not towards the middle.
    const k = Math.sqrt(inner * inner + (FAR * FAR - inner * inner) * Math.random());
    const p = point(L, Math.random() * Math.PI * 2, k);
    if (p[0] > 0 && p[0] < L.cx * 2 && p[1] > 30 && p[1] < L.cy * 2) return p;
  }
  return point(L, Math.random() * Math.PI * 2, kind === 'gunk' ? 1.15 : 0.7);
}
// The ring's ellipse on screen.
export function ringShape(view) {
  const L = layout(view);
  return { cx: L.cx, cy: L.cy, rx: L.rx, ry: L.ry };
}

// A streak lights the ring: it glows, and a wave of colour closes in on it with every beat.
function drawStreak(ctx, L, streak, now, beat) {
  const tier = Math.floor(streak / 10);
  if (tier > streakTier) {
    flashAt = now;
    shower({ w: L.cx * 2, h: L.cy * 2 }, Math.min(90, 24 + 6 * tier), LANES.map((lane) => lane.color), fallingKinds(), (kind) => landingSpot(L, kind));
  }
  streakTier = tier;
  // From a long enough streak on it never quite stops raining.
  const whole = Math.floor(beat);
  if (unlocked('drizzle') && whole !== drizzleBeat) shower({ w: L.cx * 2, h: L.cy * 2 }, 3, LANES.map((lane) => lane.color), fallingKinds(), (kind) => landingSpot(L, kind));
  drizzleBeat = whole;
  if (streak < STREAK_FROM) return;
  const level = Math.min(1, streak / STREAK_FULL);
  const hue = (now * 90) % 360;
  const frac = beat - Math.floor(beat);
  ctx.save();
  // The waves that close in on the ring with every beat.
  if (!settings.rainbow) ctx.globalCompositeOperation = 'screen';
  for (let k = 0; k < AHEAD; k++) {
    ellipse(ctx, L, reach(k + 1 - frac));
    ctx.strokeStyle = settings.rainbow
      ? `hsla(${(hue + k * 50) % 360}, 95%, 70%, ${0.12 + 0.2 * level})`
      : `rgba(190, 190, 205, ${0.1 + 0.16 * level})`;
    ctx.lineWidth = 4 + 6 * level;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  // The ring itself: one colour going round the scale, or each stretch in its sector's own.
  if (settings.rainbow) {
    ellipse(ctx, L, 1);
    glowStroke(ctx, `hsl(${hue}, 95%, 70%)`, 2 + 4 * level, 8 + 12 * level);
  } else {
    ctx.lineCap = 'butt';
    for (const slot of ROW) {
      arc(ctx, L, slot.lane, 1);
      ctx.strokeStyle = LANE[slot.lane].color;
      ctx.globalAlpha = 0.22; ctx.lineWidth = 14 + 14 * level; ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 3 + 4 * level; ctx.stroke();
    }
  }
  ctx.restore();
}

// Every new ten flashes the ring and says so.
function drawStreakFlash(ctx, L, now) {
  const age = now - flashAt;
  if (age < 0 || age > 0.7 || streakTier < 1) return;
  const u = age / 0.7;
  ellipse(ctx, L, 1 + 0.6 * u);
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * (1 - u)})`;
  ctx.lineWidth = 14 * (1 - u) + 2;
  ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.globalAlpha = 1 - u * u;
  ctx.font = `800 ${Math.round(30 + 22 * u)}px system-ui, sans-serif`;
  ctx.lineWidth = 5; ctx.strokeStyle = INK;
  const y = L.cy - L.ry * 0.72;
  ctx.strokeText(`${streakTier * 10} putkeen!`, L.cx, y);
  ctx.fillStyle = '#ffd23f';
  ctx.fillText(`${streakTier * 10} putkeen!`, L.cx, y);
  ctx.globalAlpha = 1;
}

// Sparks off the ring out along a lane's sector: a handful from a hit, a lot
// more from a hit on a hard beat, a thin steady stream from a note being held.
function throwSparks(L, lane, count, speed, color) {
  for (let i = 0; i < count; i++) {
    const a = ANGLE[lane] - HALF + 2 * HALF * Math.random();
    const p = point(L, a, 1 + 0.03 * Math.random());
    const q = point(L, a + (Math.random() - 0.5) * 0.5, 2);
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const v = speed * (0.35 + 0.65 * Math.random());
    spark(p[0], p[1], (q[0] - p[0]) / d * v, (q[1] - p[1]) / d * v,
      0.35 + 0.55 * Math.random(), Math.random() < 0.35 ? '#fff' : color, 1.5 + 2.5 * Math.random());
  }
}

// Hits are drawn with light added on top of the picture, as a steady bloom
// that fades: nothing flickers. An ordinary hit is quiet: the note stops on
// the ring and glows for a moment. The big
// burst is kept for hits on the song's hard beats: the ring flares where it
// was struck, the sector lights up and dies, the note is thrown back out as a
// thin band and streaks fly out along the sector, all of it braking as it goes.
// A long note being held keeps the ring lit.
function drawBursts(ctx, view, L, items, now) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const it of items) {
    if (it.state !== 'held') continue;
    arc(ctx, L, it.lane, 1);
    ctx.globalAlpha = 0.85;
    glowStroke(ctx, LANE[it.lane].color, 10, 22);
    if (unlocked('sparks') && Math.random() < 0.6) throwSparks(L, it.lane, 1, 260, LANE[it.lane].color);
  }
  for (const b of bursts) {
    const age = now - b.at;
    if (unlocked('sparks') && !b.thrown) {
      b.thrown = true;
      // More of them the longer the streak, up to three times as many.
      const more = 1 + Math.min(2, streakNow / 30);
      if (age < 0.1) throwSparks(L, b.lane, Math.round((b.splash ? 16 : 5) * more), b.splash ? 900 : 520, LANE[b.lane].color);
    }
    if (age > BURST_TIME) continue;
    const u = age / BURST_TIME;
    const moved = easeOut(u), fade = 1 - u;
    const color = LANE[b.lane].color;
    const big = b.grade === 'perfect' || b.grade === 'held' ? 1.3 : 1;

    if (!b.splash) {
      const k = 1;
      wedge(ctx, L, b.lane, k, k + reach(TAP) - 1, 0.035);
      ctx.globalAlpha = 0.9 * fade;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 0.55 * fade;
      ctx.fillStyle = '#fff';
      ctx.fill();
      bloomWedge(b.lane, k, k + reach(TAP) - 1, color, 0.9 * fade);
      continue;
    }

    wedge(ctx, L, b.lane, 1, 1 + 0.5 * big, 0);
    ctx.globalAlpha = 0.4 * fade * fade;
    ctx.fillStyle = color;
    ctx.fill();
    bloomWedge(b.lane, 1, 1.12, color, fade);

    const thrown = 1.04 + 0.34 * moved * big;
    wedge(ctx, L, b.lane, thrown, thrown + 0.07 * fade, 0.03);
    ctx.globalAlpha = 0.85 * fade;
    ctx.fill();

    arc(ctx, L, b.lane, 1);
    ctx.globalAlpha = fade;
    glowStroke(ctx, color, 4 + 16 * fade * big, 16, '#fff');

    for (let k = 0; k < 11; k++) {
      const a = ANGLE[b.lane] - HALF + (k + 0.5) / 11 * 2 * HALF;
      const from = 1.03 + 0.42 * moved * big * (0.55 + 0.45 * ((k * 7) % 5) / 4);
      const p = point(L, a, from), q = point(L, a, from + 0.09 * fade);
      ctx.strokeStyle = k % 2 ? '#fff' : color;
      ctx.lineWidth = 2 + 3 * fade;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    }
  }
  ctx.restore();
  flushBloom(ctx, view, L);
}

// ---------------------------------------------------------------- the ring
// The sectors, their dividing lines and the beat rings. beatRings: distances
// in beats at which to draw a ring, with a flag for bar lines.
function drawSectors(ctx, L, heldLanes, beatRings) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const slot of ROW) {
    wedge(ctx, L, slot.lane, 1, FAR, 0);
    ctx.globalAlpha = heldLanes[slot.lane] ? 0.3 : 0.1;
    ctx.fillStyle = LANE[slot.lane].color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const [d, bar] of beatRings) {
    ellipse(ctx, L, reach(d));
    ctx.strokeStyle = bar ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = bar ? 2 : 1;
    ctx.stroke();
  }
  // A shock wave is a bright front crossing its sector, and it pushes the two
  // dividing lines beside it apart where it passes.
  const now = performance.now() / 1000;
  const fronts = [];
  for (const w of waves) {
    const u = (now - w.at) / WAVE_TIME;
    if (u < 0 || u > 1) continue;
    const k = 1 + (FAR - 1) * (1 - (1 - u) * (1 - u));
    fronts.push({ lane: w.lane, k, left: 1 - u });
    arc(ctx, L, w.lane, k);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * (1 - u)})`;
    ctx.lineWidth = 2 + 6 * (1 - u);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(245, 241, 230, 0.4)';
  ctx.lineWidth = 5;
  for (let i = 0; i < 8; i++) {
    const a = Math.PI + i * 2 * HALF;
    ctx.beginPath();
    for (let step = 0; step <= 14; step++) {
      const k = 1 + (FAR - 1) * step / 14;
      let bend = 0;
      for (const f of fronts) {
        const side = Math.atan2(Math.sin(a - ANGLE[f.lane]), Math.cos(a - ANGLE[f.lane]));
        if (Math.abs(Math.abs(side) - HALF) > 0.01) continue;      // not one of this wave's two lines
        const near = (k - f.k) / 0.09;
        bend += Math.sign(side) * 0.07 * f.left * Math.exp(-near * near);
      }
      const p = point(L, a + bend, k);
      if (step) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
    }
    ctx.stroke();
  }
  ellipse(ctx, L, 1);
  ctx.strokeStyle = 'rgba(245, 241, 230, 0.85)';
  ctx.lineWidth = 4;
  ctx.stroke();
}

function label(ctx, text, p, size, color) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(size)}px system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.fillText(text, p[0], p[1] + 1);
}
// A sector's big key letter, turned by rot radians clockwise. It is laid on
// the picture with the screen blend, which only ever lightens: over the dark
// floor it is its own colour, over a note of that colour it is a paler shape
// in the band, and nothing behind it is blotted out. A soft glow of the same
// colour lifts it off the background in place of a hard outline.
// Light on light would swallow the letter where a held note glows behind it.
// lit: the glowing bands of the letter's lane, as [inner, outer] ring radii.
// Inside each band, and only there, the letter is drawn again as dark ink, so
// that it changes where the band's edge crosses it and not all at once.
function keyLetter(ctx, L, lane, text, p, size, color, rot, lit) {
  const paint = (ink) => {
    ctx.translate(p[0], p[1]);
    ctx.rotate(rot);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(size)}px system-ui, sans-serif`;
    if (ink) {
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = INK;
      ctx.fillText(text, 0, 2);
      return;
    }
    // The glow is the letter's outline stroked wide and faint under it. Measured
    // in the browser that draws without a graphics card: text drawn directly
    // costs 0.05 ms a letter, a canvas shadow blur or a turned ready-made image
    // of the letter close to 1 ms.
    ctx.globalCompositeOperation = 'screen';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.14; ctx.lineWidth = size * 0.2; ctx.strokeText(text, 0, 2);
    ctx.globalAlpha = 0.22; ctx.lineWidth = size * 0.09; ctx.strokeText(text, 0, 2);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 2);
  };
  ctx.save();
  paint(false);
  ctx.restore();
  for (const [k0, k1] of lit || []) {
    ctx.save();
    wedge(ctx, L, lane, k0, k1, 0.035);
    ctx.clip();
    paint(true);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- sector letters
// Each sector's big key letter has a place, a size and a turn. A preset gives
// them for every lane; what the gizmo (gizmo.js) changes is kept per preset in
// localStorage and wins over the preset.
//   even   nothing set: every letter in the middle of its sector, turned by defaultTurn()
//   drawn  placed by hand with the gizmo, 16.11.2026: bigger and turned more freely
const PRESETS = {
  even: {},
  drawn: {
    squat: { k: 1.387, a: 0.068, size: 0.397, rot: 0.313 },
    q: { k: 1.336, a: -0.085, size: 0.510, rot: 0.991 },
    a: { k: 1.300, a: 0.042, size: 0.437, rot: -0.711 },
    s: { k: 1.339, a: -0.176, size: 0.426, rot: -0.325 },
    w: { k: 1.325, a: 0.147, size: 0.426, rot: 0.428 },
    d: { k: 1.300, a: -0.042, size: 0.458, rot: 0.564 },
    e: { k: 1.301, a: 0.016, size: 0.510, rot: -1.068 },
    stretch: { k: 1.390, a: -0.045, size: 0.397, rot: -0.227 },
  },
};
export const LETTER_PRESETS = [['drawn', 'Piirretty'], ['even', 'Tasainen']];
const LETTERS_KEY = 'tanssiauto.letterSets';
let preset = 'drawn';
let edits = { even: {}, drawn: {} };      // preset -> lane -> { k, a, size, rot }
try {
  const saved = JSON.parse(localStorage.getItem(LETTERS_KEY) || 'null');
  if (saved && PRESETS[saved.preset]) preset = saved.preset;
  if (saved && saved.edits) edits = { even: saved.edits.even || {}, drawn: saved.edits.drawn || {} };
} catch (err) { /* no storage */ }
function store() {
  try { localStorage.setItem(LETTERS_KEY, JSON.stringify({ preset, edits })); } catch (err) { /* no storage */ }
}

// The turn a letter gets when nobody has set one: the four sectors nearest the
// top and the bottom lean a little the way the ring goes, the four at the
// sides follow the ring, eased a few degrees towards upright. No letter is
// ever upside down: in the lower half the top of the letter points inwards.
function defaultTurn(L, lane, p) {
  const a = ANGLE[lane];
  const fromUpright = Math.atan2(Math.sin(a), Math.abs(Math.cos(a)));
  if (Math.abs(fromUpright) < Math.PI / 6) {
    return Math.sign(Math.sin(a) * Math.cos(a)) * (Math.cos(a) > 0 ? TOP_LEAN : BOTTOM_LEAN);
  }
  let turn = Math.atan2(p[0] - L.cx, -(p[1] - L.cy));
  if (Math.cos(turn) < 0) turn += Math.PI;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));      // -90°..90°
  return turn - Math.sign(turn) * SIDE_EASE;
}

// Where a sector's letter is and how it is drawn.
//   k     distance from the centre, in ring radii
//   a     angle away from the middle of its sector, radians clockwise
//   size  height, as a fraction of the ring's smaller radius
//   rot   turn, radians clockwise
// x, y and px are the same on screen; cx, cy the centre of the ring.
export function letterOf(view, lane) {
  const L = layout(view);
  const set = edits[preset][lane] || PRESETS[preset][lane] || {};
  const k = set.k ?? SECTOR_KEY, a = set.a ?? 0, size = set.size ?? SECTOR_KEY_SIZE;
  const p = point(L, ANGLE[lane] + a, k);
  const rot = set.rot ?? defaultTurn(L, lane, p);
  return { k, a, size, rot, x: p[0], y: p[1], px: size * Math.min(L.rx, L.ry), cx: L.cx, cy: L.cy };
}
export function setLetter(lane, { k, a, size, rot }) {
  edits[preset][lane] = { k, a, size, rot };
  store();
}
// Drops what the gizmo has changed in the current preset.
export function resetLetters() {
  edits[preset] = {};
  store();
}
export function letterPreset() { return preset; }
export function setLetterPreset(name) {
  if (!PRESETS[name]) return;
  preset = name;
  store();
}
// The current preset with the gizmo's changes on top, for copying out.
export function letterSettings() { return { preset, letters: { ...PRESETS[preset], ...edits[preset] } }; }
// A screen point as distance from the centre in ring radii, and angle away from the middle of a lane's sector.
export function sectorCoords(view, lane, x, y) {
  const L = layout(view);
  const nx = (x - L.cx) / L.rx, ny = -(y - L.cy) / L.ry;
  const a = Math.atan2(nx, ny) - ANGLE[lane];
  return { k: Math.hypot(nx, ny), a: Math.atan2(Math.sin(a), Math.cos(a)), unit: Math.min(L.rx, L.ry) };
}

// alive: the note is being held; it glows.
function drawNote(ctx, L, lane, near, far, touch, faded, alive) {
  const k0 = reach(near), k1 = reach(Math.max(far, near + TAP));
  wedge(ctx, L, lane, k0, k1, 0.035);
  ctx.globalAlpha = faded ? 0.3 : 1;
  ctx.fillStyle = faded ? '#8a86a0' : LANE[lane].color;
  // The full bloom: the note carries a glow of its own colour. This is the
  // canvas shadow blur, once for every note on screen, which a graphics card
  // does not notice and a browser drawing without one cannot afford.
  if (settings.bloom === 'full' && !faded && unlocked('glow')) {
    ctx.shadowColor = LANE[lane].color;
    ctx.shadowBlur = alive ? 46 : 26;
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke();
  // A tail behind a note on its way in: the same band three times over, thinner each time.
  if (unlocked('tails') && !faded && !alive) {
    let from = k1;
    for (const [length, alpha] of [[0.05, 0.38], [0.07, 0.22], [0.1, 0.1]]) {
      wedge(ctx, L, lane, from, from + length, 0.035);
      ctx.globalAlpha = alpha;
      ctx.fill();
      from += length;
    }
  }
  ctx.globalAlpha = 1;
  if (alive) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = LANE[lane].color;
    ctx.fill();
    ctx.restore();
  }
}

function drawTargets(ctx, view, L, heldLanes, touch, now) {
  // A target that was just hit swells and settles.
  const pop = {};
  for (const b of bursts) {
    const age = now - b.at;
    if (age < 0.18) pop[b.lane] = 0.4 * (1 - age / 0.18);
  }
  for (const slot of ROW) {
    const lane = LANE[slot.lane];
    const p = at(L, slot.lane, 1);
    const down = !!heldLanes[slot.lane];
    ctx.beginPath(); ctx.arc(p[0], p[1], L.r * 1.2 * (1 + (pop[slot.lane] || 0)), 0, Math.PI * 2);
    ctx.fillStyle = down ? lane.color : 'rgba(24, 19, 48, 0.85)';
    ctx.fill();
    ctx.strokeStyle = lane.color; ctx.lineWidth = 3; ctx.stroke();
    label(ctx, touch ? lane.icon : slot.key, p, L.r * 1.25, down ? INK : lane.color);
    // The same key, big, out in the sector where its notes come from.
    const big = letterOf(view, slot.lane);
    keyLetter(ctx, L, slot.lane, touch ? lane.icon : slot.key, [big.x, big.y], big.px, lane.color, big.rot, glowing[slot.lane]);
  }
}

// Notes to come. items: Run.items. heldLanes: lanes down right now. touch: label with icons, not keys.
// streak: hits in a row so far.
export function drawHighway(ctx, view, items, beat, heldLanes, touch, streak) {
  const L = layout(view);
  const now = performance.now() / 1000;
  if (trialStreak !== null) streak = trialStreak;
  streakNow = streak;
  const rings = [];
  for (let b = Math.ceil(beat); b < beat + AHEAD; b++) rings.push([b - beat, (b - 4) % 4 === 0]);
  drawSectors(ctx, L, heldLanes, rings);
  drawStreak(ctx, L, streak, now, beat);

  const visible = [];
  glowing = {};
  for (const it of items) {
    const d = it.beat - beat;
    if (d > AHEAD) break;
    if (it.state === 'hit') continue;
    if (it.state === 'held' || (it.long ? d + it.hold : d) > -PAST) visible.push(it);
  }
  // Far ones first so that near ones overlap them.
  for (let k = visible.length - 1; k >= 0; k--) {
    const it = visible[k];
    const end = it.beat - beat + (it.long ? it.hold : TAP);
    const near = it.state === 'held' ? 0 : Math.max(-PAST, it.beat - beat);
    const lost = it.state === 'miss' || it.state === 'dropped';
    const far = Math.min(AHEAD, Math.max(near, end));
    drawNote(ctx, L, it.lane, near, far, touch, lost, it.state === 'held');
    if (it.state === 'held') {
      const band = [reach(near), reach(Math.max(far, near + TAP))];
      (glowing[it.lane] = glowing[it.lane] || []).push(band);
      // Only the stretch by the ring glows: laying light over the whole of a
      // long band costs a box as big as the band.
      bloomWedge(it.lane, band[0], Math.min(band[1], band[0] + HELD_BLOOM), LANE[it.lane].color, 0.4);
    }
  }
  drawBursts(ctx, view, L, items, now);
  drawStreakFlash(ctx, L, now);
}

// Notes just made leave their target outwards. items: Recorder.items.
export function drawRecording(ctx, view, items, beat, heldLanes, touch) {
  const L = layout(view);
  const rings = [];
  for (let b = Math.floor(beat); b > beat - AHEAD; b--) rings.push([beat - b, (b - 4) % 4 === 0]);
  glowing = {};
  drawSectors(ctx, L, heldLanes, rings);
  for (const it of items) {
    const far = beat - it.beat;
    const near = Math.max(0, far - it.hold);
    if (near < AHEAD) drawNote(ctx, L, it.lane, near, Math.min(AHEAD, far), touch, false);
  }
}

// The targets and the sectors' big letters, drawn after everything else so
// that neither a note nor the car ever covers a key. A note carries no letter
// of its own: its sector says which key it is.
export function drawOverlay(ctx, view, heldLanes, touch) {
  drawTargets(ctx, view, layout(view), heldLanes, touch, performance.now() / 1000);
}

// A line of text where the judgement goes, under the car.
export function drawCaption(ctx, view, text, color) {
  const L = layout(view);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '800 20px system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.fillText(text, L.cx, L.cy + L.ry * 0.72);
}

// Score and combo at the top left, the latest judgement under the car.
export function drawHud(ctx, view, run, t) {
  const L = layout(view);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '800 28px system-ui, sans-serif';
  ctx.fillStyle = '#f5f1e6';
  ctx.fillText(String(run.score), 14, 72);
  if (run.combo > 1) {
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`${run.combo} putkeen`, 14, 98);
  }
  if (run.last && t !== null) {
    const age = t - run.last.t;
    if (age >= 0 && age < 0.6) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = 1 - age / 0.6;
      ctx.font = '800 24px system-ui, sans-serif';
      ctx.fillStyle = TEXT_COLOR[run.last.grade];
      const ms = run.last.offset === undefined ? '' : `  ${run.last.offset > 0 ? '+' : ''}${Math.round(run.last.offset * 1000)} ms`;
      ctx.fillText(TEXT[run.last.grade] + ms, L.cx, L.cy + L.ry * 0.72 - age * 16);
      ctx.globalAlpha = 1;
    }
  }
}
