// The note board: eight lanes receding into the distance above the car.
// Notes come out of the distance towards a row of key tiles at the hit line.
// The tiles carry the key of each lane and are the touch buttons too.
// While recording the board runs the other way: what was just pressed leaves
// the hit line and slides off into the distance.

import { LANES, ROW } from './input.js';

const AHEAD = 6;             // beats visible between the far edge and the hit line
const FORESHORTEN = 0.35;    // how fast the board shrinks with distance
const TOP = 52;              // far edge, below the buttons at the top of the screen
const PAST = 0.5;            // beats a missed note keeps sliding before it is dropped
const INK = '#1d1b26';
const TEXT = { perfect: 'Täydellinen', good: 'Hyvä', ok: 'Ok', miss: 'Ohi', stray: 'Huti', held: 'Pidetty', dropped: 'Irti' };
const TEXT_COLOR = {
  perfect: '#ffd23f', good: '#8cff6a', ok: '#bfe9ff', held: '#ffd23f',
  miss: '#ff7a6a', stray: '#ff7a6a', dropped: '#ff7a6a',
};

const LANE = {};
for (const lane of LANES) LANE[lane.id] = lane;
const SLOT = {};
ROW.forEach((slot, i) => { SLOT[slot.lane] = i; });

function layout(view) {
  const nearW = Math.min(view.w - 16, 720);
  const hitY = Math.round(view.h * 0.46);
  const farScale = 1 / (1 + AHEAD * FORESHORTEN);
  return {
    nearW, hitY,
    laneW: nearW / 8,
    tileH: Math.min(nearW / 8 * 0.62, 48),
    cx: view.w / 2,
    vanishY: (TOP - farScale * hitY) / (1 - farScale),
  };
}
function scaleAt(d) { return 1 / (1 + d * FORESHORTEN); }
// Screen point of a lane edge (0..8, left to right) d beats away from the hit line.
function at(L, edge, d) {
  const s = scaleAt(d);
  return [L.cx + (edge - 4) * L.laneW * s, L.vanishY + (L.hitY - L.vanishY) * s];
}
function quad(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

// The lane of a screen point: a column as wide as its tile, the full height of the screen.
export function laneAt(view, x) {
  const L = layout(view);
  const i = Math.floor((x - (L.cx - L.nearW / 2)) / L.laneW);
  return i >= 0 && i < 8 ? ROW[i].lane : null;
}

// The board itself. beatLines: distances in beats at which to draw a line, with a flag for bar lines.
function drawBoard(ctx, L, heldLanes, beatLines) {
  ctx.lineJoin = 'round';
  quad(ctx, [at(L, 0, AHEAD), at(L, 8, AHEAD), at(L, 8, 0), at(L, 0, 0)]);
  ctx.fillStyle = 'rgba(24, 19, 48, 0.82)';
  ctx.fill();
  ROW.forEach((slot, i) => {
    quad(ctx, [at(L, i, AHEAD), at(L, i + 1, AHEAD), at(L, i + 1, 0), at(L, i, 0)]);
    ctx.globalAlpha = heldLanes[slot.lane] ? 0.28 : 0.07;
    ctx.fillStyle = LANE[slot.lane].color;
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const a = at(L, i, AHEAD), b = at(L, i, 0);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  for (const [d, bar] of beatLines) {
    const p = at(L, 0, d), q = at(L, 8, d);
    ctx.strokeStyle = bar ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.13)';
    ctx.lineWidth = bar ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  }
}

// One note between two distances; the label sits at its near end.
function drawNote(ctx, L, lane, near, far, touch, faded) {
  const i = SLOT[lane];
  quad(ctx, [at(L, i + 0.1, far), at(L, i + 0.9, far), at(L, i + 0.9, near), at(L, i + 0.1, near)]);
  ctx.globalAlpha = faded ? 0.3 : 1;
  ctx.fillStyle = faded ? '#8a86a0' : LANE[lane].color;
  ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke();
  const s = scaleAt(near);
  if (!faded && s > 0.4) {
    const mid = at(L, i + 0.5, near + 0.11);
    ctx.fillStyle = INK;
    ctx.font = `800 ${Math.round(L.laneW * 0.34 * s)}px system-ui, sans-serif`;
    ctx.fillText(touch ? LANE[lane].icon : ROW[i].key, mid[0], mid[1]);
  }
  ctx.globalAlpha = 1;
}

// The hit line and the key tiles under it.
function drawTiles(ctx, L, heldLanes, touch) {
  const left = L.cx - L.nearW / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(left, L.hitY - 1.5, L.nearW, 3);
  ROW.forEach((slot, i) => {
    const lane = LANE[slot.lane];
    const x = left + i * L.laneW + 3, y = L.hitY + 4, w = L.laneW - 6, h = L.tileH;
    const down = !!heldLanes[slot.lane];
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fillStyle = down ? lane.color : 'rgba(24, 19, 48, 0.9)';
    ctx.fill();
    ctx.strokeStyle = lane.color; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = down ? INK : lane.color;
    if (touch) {
      ctx.font = `800 ${Math.round(h * 0.55)}px system-ui, sans-serif`;
      ctx.fillText(lane.icon, x + w / 2, y + h / 2 + 1);
    } else {
      ctx.font = `800 ${Math.round(h * 0.5)}px system-ui, sans-serif`;
      ctx.fillText(slot.key, x + w * 0.36, y + h / 2 + 1);
      ctx.font = `700 ${Math.round(h * 0.36)}px system-ui, sans-serif`;
      ctx.fillText(lane.icon, x + w * 0.72, y + h / 2 + 1);
    }
  });
}

// ---------------------------------------------------------------- effects
const BURST_TIME = 0.45;          // seconds a hit's burst lasts
const STREAK_FROM = 10;           // hits in a row before the board lights up
const STREAK_FULL = 30;           // and at which it is at full strength
const bursts = [];                // { lane, grade, at }
let streakTier = 0;               // whole tens of the streak last drawn
let flashAt = -10;                // when the streak last reached a new ten

// A note was hit: burst on its tile.
export function hitEffect(lane, grade) {
  bursts.push({ lane, grade, at: performance.now() / 1000 });
  if (bursts.length > 40) bursts.shift();
}

// The whole board answers a streak: light runs down the lanes with the beat
// and the rails glow, stronger as the streak grows.
function drawStreak(ctx, L, streak, now, beat) {
  const tier = Math.floor(streak / 10);
  if (tier > streakTier) flashAt = now;
  streakTier = tier;
  if (streak < STREAK_FROM) return;
  const level = Math.min(1, streak / STREAK_FULL);
  const hue = (now * 90) % 360;
  const frac = beat - Math.floor(beat);
  for (let k = 1; k < AHEAD; k++) {
    const d = k - frac;
    if (d <= 0.3) continue;
    quad(ctx, [at(L, 0, d), at(L, 8, d), at(L, 8, d - 0.3), at(L, 0, d - 0.3)]);
    ctx.fillStyle = `hsla(${(hue + k * 40) % 360}, 95%, 70%, ${0.07 + 0.13 * level})`;
    ctx.fill();
  }
  // The glow is two wide faint strokes under the rail, not a canvas shadow blur, which costs far too much per frame.
  ctx.save();
  ctx.strokeStyle = `hsl(${hue}, 95%, 70%)`;
  for (const [alpha, extra] of [[0.1, 24 + 20 * level], [0.2, 12 + 10 * level], [1, 0]]) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2 + 5 * level + extra;
    for (const edge of [0, 8]) {
      const a = at(L, edge, AHEAD), b = at(L, edge, 0);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  ctx.restore();
}

// Every new ten flashes the board and says so.
function drawStreakFlash(ctx, L, now) {
  const age = now - flashAt;
  if (age < 0 || age > 0.7 || streakTier < 1) return;
  const u = age / 0.7;
  quad(ctx, [at(L, 0, AHEAD), at(L, 8, AHEAD), at(L, 8, 0), at(L, 0, 0)]);
  ctx.fillStyle = `rgba(255, 255, 255, ${0.32 * (1 - u) * (1 - u)})`;
  ctx.fill();
  const p = at(L, 4, 1.4);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.globalAlpha = 1 - u * u;
  ctx.font = `800 ${Math.round(30 + 22 * u)}px system-ui, sans-serif`;
  ctx.lineWidth = 5; ctx.strokeStyle = INK;
  ctx.strokeText(`${streakTier * 10} putkeen!`, p[0], p[1]);
  ctx.fillStyle = '#ffd23f';
  ctx.fillText(`${streakTier * 10} putkeen!`, p[0], p[1]);
  ctx.globalAlpha = 1;
}

// Hits burst on their tile: the lane flashes, a ring opens and sparks fly up.
// A long note that is being held keeps its tile glowing.
function drawBursts(ctx, L, items, now) {
  const left = L.cx - L.nearW / 2;
  for (const it of items) {
    if (it.state !== 'held') continue;
    const x = left + (SLOT[it.lane] + 0.5) * L.laneW;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.ellipse(x, L.hitY, L.laneW * 0.48, L.laneW * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  for (const b of bursts) {
    const age = now - b.at;
    if (age > BURST_TIME) continue;
    const u = age / BURST_TIME;
    const i = SLOT[b.lane];
    const color = LANE[b.lane].color;
    const big = b.grade === 'perfect' || b.grade === 'held' ? 1.35 : 1;
    const x = left + (i + 0.5) * L.laneW, y = L.hitY;
    quad(ctx, [at(L, i, 2.5), at(L, i + 1, 2.5), at(L, i + 1, 0), at(L, i, 0)]);
    ctx.globalAlpha = 0.5 * (1 - u);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1 - u;
    ctx.beginPath();
    ctx.ellipse(x, y, L.laneW * (0.3 + 0.8 * u) * big, L.laneW * (0.12 + 0.3 * u) * big, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 + 5 * (1 - u); ctx.stroke();
    for (let k = 0; k < 9; k++) {
      const angle = -Math.PI * (0.12 + 0.76 * k / 8);
      const reach = L.laneW * (0.3 + 1.3 * u) * big * (0.7 + 0.3 * ((k * 7) % 5) / 4);
      const size = 2 + 6 * (1 - u);
      ctx.fillStyle = k % 2 ? '#fff' : color;
      ctx.fillRect(x + Math.cos(angle) * reach - size / 2, y + Math.sin(angle) * reach + 50 * u * u - size / 2, size, size);
    }
  }
  ctx.globalAlpha = 1;
}

// Notes to come. items: Run.items. heldLanes: lanes down right now. touch: label with icons, not keys.
// streak: hits in a row so far.
export function drawHighway(ctx, view, items, beat, heldLanes, touch, streak) {
  const L = layout(view);
  const now = performance.now() / 1000;
  const lines = [];
  for (let b = Math.ceil(beat); b < beat + AHEAD; b++) lines.push([b - beat, (b - 4) % 4 === 0]);
  drawBoard(ctx, L, heldLanes, lines);
  drawStreak(ctx, L, streak, now, beat);

  const visible = [];
  for (const it of items) {
    const d = it.beat - beat;
    if (d > AHEAD) break;
    if (it.state === 'hit') continue;
    // A long note stays for as long as it lasts: shortening while it is held, greyed once it is lost.
    if (it.state === 'held' || (it.long ? d + it.hold : d) > -PAST) visible.push(it);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // Far ones first so that near ones overlap them.
  for (let k = visible.length - 1; k >= 0; k--) {
    const it = visible[k];
    const end = it.beat - beat + Math.max(0.2, it.long ? it.hold : it.hold * 0.7);
    const near = it.state === 'held' ? 0 : Math.max(-PAST, it.beat - beat);
    const lost = it.state === 'miss' || it.state === 'dropped';
    if (end > near) drawNote(ctx, L, it.lane, near, Math.min(AHEAD, end), touch, lost);
  }
  drawTiles(ctx, L, heldLanes, touch);
  drawBursts(ctx, L, items, now);
  drawStreakFlash(ctx, L, now);
}

// Notes just made. items: Recorder.items, newest last.
export function drawRecording(ctx, view, items, beat, heldLanes, touch) {
  const L = layout(view);
  const lines = [];
  for (let b = Math.floor(beat); b > beat - AHEAD; b--) lines.push([beat - b, (b - 4) % 4 === 0]);
  drawBoard(ctx, L, heldLanes, lines);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const it of items) {
    const far = beat - it.beat;
    const near = Math.max(0, far - Math.max(0.2, it.hold));
    if (near < AHEAD) drawNote(ctx, L, it.lane, near, Math.min(AHEAD, far), touch, false);
  }
  drawTiles(ctx, L, heldLanes, touch);
}

// Nothing of the board goes on top of the car: the key tiles are above it already.
export function drawOverlay() {}

// A line of text where the judgement goes, under the key tiles.
export function drawCaption(ctx, view, text, color) {
  const L = layout(view);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '800 20px system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.fillText(text, view.w / 2, L.hitY + L.tileH + 28);
}

// Score and combo at the top left, the latest judgement under the key tiles.
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
      // With the hit, how many milliseconds before (-) or after (+) the note it came.
      const ms = run.last.offset === undefined ? '' : `  ${run.last.offset > 0 ? '+' : ''}${Math.round(run.last.offset * 1000)} ms`;
      ctx.fillText(TEXT[run.last.grade] + ms, view.w / 2, L.hitY + L.tileH + 30 - age * 16);
      ctx.globalAlpha = 1;
    }
  }
}
