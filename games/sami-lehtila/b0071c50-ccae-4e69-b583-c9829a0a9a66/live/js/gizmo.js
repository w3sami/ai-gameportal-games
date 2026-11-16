// A gizmo for placing the ring's big sector letters by hand. Each letter hangs
// on a ray from the centre. Dragging the letter moves it, the round knob above
// it turns it and the square knob beside it sizes it. With mirroring on, the
// letter across the vertical centre line follows as a mirror image.
// The settings themselves live in ring.js.

import { ROW } from './input.js';
import { letterOf, setLetter, sectorCoords } from './ring.js';

const PAIR = { s: 'w', w: 's', a: 'd', d: 'a', q: 'e', e: 'q', squat: 'stretch', stretch: 'squat' };
const KNOB = 9;            // radius of a knob, pixels
const REACH = 22;          // how far outside the letter the knobs sit, pixels
const KEY = {};
for (const slot of ROW) KEY[slot.lane] = slot.key;

export const gizmo = { active: false, mirror: true, selected: null };
let drag = null;           // { lane, part: 'move' | 'turn' | 'size' }

function knobs(l) {
  const up = [Math.sin(l.rot), -Math.cos(l.rot)], right = [Math.cos(l.rot), Math.sin(l.rot)];
  const d = l.px * 0.6 + REACH;
  return {
    turn: [l.x + up[0] * d, l.y + up[1] * d],
    size: [l.x + right[0] * d, l.y + right[1] * d],
  };
}

function apply(lane, set) {
  setLetter(lane, set);
  if (gizmo.mirror) setLetter(PAIR[lane], { k: set.k, a: -set.a, size: set.size, rot: -set.rot });
}

// Returns true when the press landed on the gizmo.
export function gizmoDown(view, x, y) {
  if (gizmo.selected) {
    const l = letterOf(view, gizmo.selected), k = knobs(l);
    for (const part of ['turn', 'size']) {
      if (Math.hypot(x - k[part][0], y - k[part][1]) < KNOB + 8) { drag = { lane: gizmo.selected, part }; return true; }
    }
  }
  let best = null, bestGap = Infinity;
  for (const slot of ROW) {
    const l = letterOf(view, slot.lane);
    const gap = Math.hypot(x - l.x, y - l.y);
    if (gap < Math.max(30, l.px * 0.6) && gap < bestGap) { best = slot.lane; bestGap = gap; }
  }
  gizmo.selected = best;
  drag = best ? { lane: best, part: 'move' } : null;
  return !!best;
}

export function gizmoMove(view, x, y) {
  if (!drag) return;
  const l = letterOf(view, drag.lane);
  const set = { k: l.k, a: l.a, size: l.size, rot: l.rot };
  if (drag.part === 'move') {
    const c = sectorCoords(view, drag.lane, x, y);
    set.k = c.k; set.a = c.a;
  } else if (drag.part === 'turn') {
    set.rot = Math.atan2(x - l.x, -(y - l.y));
  } else {
    const unit = sectorCoords(view, drag.lane, x, y).unit;
    set.size = Math.max(0.05, (Math.hypot(x - l.x, y - l.y) - REACH) / 0.6 / unit);
  }
  apply(drag.lane, set);
}

export function gizmoUp() { drag = null; }

// The wheel sizes the selected letter, or turns it with shift held.
export function gizmoWheel(view, deltaY, shift) {
  if (!gizmo.selected) return;
  const l = letterOf(view, gizmo.selected);
  const set = { k: l.k, a: l.a, size: l.size, rot: l.rot };
  const step = deltaY < 0 ? 1 : -1;
  if (shift) set.rot += step * Math.PI / 180;
  else set.size = Math.max(0.05, set.size * (1 + 0.04 * step));
  apply(gizmo.selected, set);
}

// The selected letter's numbers, for the panel.
export function gizmoReadout(view) {
  if (!gizmo.selected) return 'Valitse kirjain.';
  const l = letterOf(view, gizmo.selected);
  const deg = (r) => Math.round(r * 180 / Math.PI * 10) / 10;
  return `${KEY[gizmo.selected]}: etäisyys ${l.k.toFixed(2)} · sivuun ${deg(l.a)}° · koko ${l.size.toFixed(2)} · kierto ${deg(l.rot)}°`;
}

export function drawGizmo(ctx, view) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const slot of ROW) {
    const l = letterOf(view, slot.lane);
    const on = slot.lane === gizmo.selected;
    ctx.setLineDash(on ? [] : [6, 8]);
    ctx.strokeStyle = on ? '#fff' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = on ? 2.5 : 1.5;
    ctx.beginPath(); ctx.moveTo(l.cx, l.cy); ctx.lineTo(l.x, l.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(l.x, l.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    if (!on) continue;
    const k = knobs(l);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(l.x, l.y, l.px * 0.6, 0, Math.PI * 2); ctx.stroke();
    for (const part of ['turn', 'size']) {
      ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(k[part][0], k[part][1]); ctx.stroke();
    }
    ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#1d1b26';
    ctx.beginPath(); ctx.arc(k.turn[0], k.turn[1], KNOB, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.rect(k.size[0] - KNOB, k.size[1] - KNOB, KNOB * 2, KNOB * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
