// The level's solid parts and the questions physics asks of them: which
// solids a circle overlaps (to push it out), and where the nearest surface
// is (for magnetism, grip and drops that stick).
//
// Solids are the tile grid plus movers: platforms and doors, rectangles
// whose place is a function of the world's clock (setTime). Everything that
// moves goes through the clock, so slime.js can step it a substep at a time
// and wind it back after a look ahead.
//
// The things that are not solid (start, checkpoints, exit, buttons, cards)
// are listed for game.js and render.js.

import { LEGEND } from './level.js';

const TAU = Math.PI * 2;
const DOOR_TIME = 0.5;   // s for a door to slide fully open or shut

export function buildWorld(level, T) {
  const rows = level.rows, legend = { ...LEGEND, ...level.legend };
  const h = rows.length, w = rows[0].length;
  const grid = new Array(w * h).fill(null);   // tile type per cell
  const meta = new Array(w * h).fill(null);   // its legend entry
  const cells = {};                           // character → cells, for things
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x], e = legend[c];
      if (!e) continue;
      if (e.tile) { grid[y * w + x] = e.tile; meta[y * w + x] = e; }
      else (cells[c] ||= []).push({ x, y });
    }
  }

  // tile type at a cell, or null when empty; outside the map is stone
  const at = (cx, cy) => (cx < 0 || cy < 0 || cx >= w || cy >= h ? 'stone' : grid[cy * w + cx]);
  const metaAt = (cx, cy) => (cx < 0 || cy < 0 || cx >= w || cy >= h ? null : meta[cy * w + cx]);

  // ---- things -----------------------------------------------------------------

  // the floor point under a marker cell: where the slime sits
  const spot = ({ x, y }) => ({ x: x + 0.5, y: y + 1 });
  let start = { x: w / 2, y: h / 2 };
  const checkpoints = [], exits = [], buttons = [], cards = [], movers = [];

  // a button lies on the surface below its cell, else beside it, else above
  function attach({ x, y }) {
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      if (at(x + dx, y + dy)) return { nx: -dx, ny: -dy, x: x + 0.5 + dx * 0.5, y: y + 0.5 + dy * 0.5 };
    }
    return { nx: 0, ny: -1, x: x + 0.5, y: y + 1 };
  }

  // 4-connected runs of one character, as bounding rectangles
  function groups(list) {
    const left = new Set(list.map((c) => c.x + ',' + c.y)), out = [];
    for (const c of list) {
      if (!left.has(c.x + ',' + c.y)) continue;
      let x0 = c.x, x1 = c.x, y0 = c.y, y1 = c.y;
      const todo = [c];
      left.delete(c.x + ',' + c.y);
      while (todo.length) {
        const p = todo.pop();
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = p.x + dx + ',' + (p.y + dy);
          if (left.has(k)) { left.delete(k); todo.push({ x: p.x + dx, y: p.y + dy }); }
        }
      }
      out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
    return out;
  }

  for (const [c, list] of Object.entries(cells)) {
    const e = legend[c];
    if (e.kind === 'start') start = spot(list[0]);
    else if (e.kind === 'checkpoint') for (const p of list) checkpoints.push(spot(p));
    else if (e.kind === 'exit') for (const p of list) exits.push(spot(p));
    else if (e.kind === 'button') for (const p of list) buttons.push({ char: c, e, ...attach(p) });
    else if (e.kind === 'card') for (const p of list) cards.push({ char: c, e, x: p.x + 0.5, y: p.y + 0.5 });
    else if (e.kind === 'door' || e.kind === 'platform') {
      for (const r of groups(list)) {
        movers.push({
          kind: e.kind, char: c, e, type: e.tile || e.kind,
          x0: r.x, y0: r.y, w0: r.w, h0: r.h, x: r.x, y: r.y, w: r.w, h: r.h, vx: 0, vy: 0,
          from: 0, to: 0, since: -1e9,   // a door's openness: from → to, starting at `since`
        });
      }
    }
  }
  const doors = movers.filter((m) => m.kind === 'door');
  const keyColor = (key) => legend[key]?.color || '#ccc';
  for (const d of doors) d.color = keyColor(d.e.key);

  // ---- the clock ----------------------------------------------------------------

  let time = 0;

  function openness(d, t) {
    const k = Math.max(0, Math.min(1, (t - d.since) / DOOR_TIME));
    return d.from + (d.to - d.from) * k;
  }

  function setTime(t) {
    time = t;
    for (const m of movers) {
      if (m.kind === 'platform') {
        const { dx = 0, dy = 0, period = 4, phase = 0 } = m.e;
        const a = TAU * (t / period + phase);
        const s = (1 - Math.cos(a)) / 2, ds = (Math.PI / period) * Math.sin(a);
        m.x = m.x0 + dx * s; m.y = m.y0 + dy * s;
        m.vx = dx * ds; m.vy = dy * ds;
      } else {
        const shut = 1 - openness(m, t);
        if (m.h0 >= m.w0) m.h = m.h0 * shut; else m.w = m.w0 * shut;
      }
    }
  }

  // open (1) or shut (0) a door, sliding from where it is now
  function setDoor(d, to) {
    if (d.to === to) return;
    d.from = openness(d, time); d.to = to; d.since = time;
  }
  const isOpen = (d) => d.to === 1;

  // a panel's turn: 'off', 'warn' (about to glow red) or 'on' (red, kills)
  function panel(e, t = time) {
    const { off, warn, on } = T.panel;
    const cycle = off + warn + on;
    if (cycle <= 0) return 'off';
    const u = (((t + (e?.phase || 0) * cycle) % cycle) + cycle) % cycle;
    return u < off ? 'off' : u < off + warn ? 'warn' : 'on';
  }

  // ---- surfaces -----------------------------------------------------------------

  const live = (m) => m.w > 1e-3 && m.h > 1e-3;

  // a point inside a box leaves through its closest face, of those `open`
  // lets through; a box closed on all sides has no way out
  function exit(bx, by, bw, bh, x, y, open) {
    const faces = [
      [x - bx, -1, 0, bx, y, open(-1, 0)],
      [bx + bw - x, 1, 0, bx + bw, y, open(1, 0)],
      [y - by, 0, -1, x, by, open(0, -1)],
      [by + bh - y, 0, 1, x, by + bh, open(0, 1)],
    ];
    let hit = null;
    for (const [depth, nx, ny, px, py, ok] of faces) {
      if (!ok) continue;
      if (!hit || -depth < hit.d) hit = { d: -depth, px, py, nx, ny };
    }
    return hit;
  }
  const insideTile = (cx, cy, x, y) => exit(cx, cy, 1, 1, x, y, (dx, dy) => !at(cx + dx, cy + dy));
  const insideMover = (m, x, y) => exit(m.x, m.y, m.w, m.h, x, y, () => true);

  // Each solid near (x, y) as a surface hit: { d, px, py, nx, ny, type, vx,
  // vy, meta, mover }. d is the distance (negative when inside), (px, py)
  // the point on the surface, (nx, ny) the outward normal, (vx, vy) the
  // surface's own speed, meta the tile's legend entry and mover the
  // platform or door, if it is one.
  function each(x, y, range, visit) {
    const x0 = Math.floor(x - range), x1 = Math.floor(x + range);
    const y0 = Math.floor(y - range), y1 = Math.floor(y + range);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const type = at(cx, cy);
        if (!type) continue;
        const hit = surface(cx, cy, 1, 1, x, y, range, () => insideTile(cx, cy, x, y));
        if (hit) visit(Object.assign(hit, { type, vx: 0, vy: 0, meta: metaAt(cx, cy), mover: null }));
      }
    }
    for (const m of movers) {
      if (!live(m)) continue;
      const hit = surface(m.x, m.y, m.w, m.h, x, y, range, () => insideMover(m, x, y));
      if (hit) visit(Object.assign(hit, { type: m.type, vx: m.vx, vy: m.vy, meta: m.e, mover: m }));
    }
  }

  function surface(bx, by, bw, bh, x, y, range, inside) {
    const px = Math.max(bx, Math.min(bx + bw, x)), py = Math.max(by, Math.min(by + bh, y));
    const dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
    if (d > 0) return d > range ? null : { d, px, py, nx: dx / d, ny: dy / d };
    return inside();
  }

  // the nearest surface within `range`, or null
  function nearest(x, y, range) {
    let best = null;
    each(x, y, range, (hit) => { if (!best || hit.d < best.d) best = hit; });
    return best;
  }

  // Push a circle out of every solid it overlaps. Returns the summed push
  // normal and the type of the last solid pushed against, or null.
  // Each solid is measured from where the earlier pushes left the circle, so
  // two tiles side by side do not both push it.
  function collide(p, r) {
    let hit = null;
    const push = (q, type) => {
      if (!q || q.d >= r) return;
      p.x += q.nx * (r - q.d); p.y += q.ny * (r - q.d);
      hit = hit || { nx: 0, ny: 0, type };
      hit.nx += q.nx; hit.ny += q.ny; hit.type = type;
    };
    const x0 = Math.floor(p.x - r), x1 = Math.floor(p.x + r);
    const y0 = Math.floor(p.y - r), y1 = Math.floor(p.y + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const type = at(cx, cy);
        if (type) push(surface(cx, cy, 1, 1, p.x, p.y, r, () => insideTile(cx, cy, p.x, p.y)), type);
      }
    }
    for (const m of movers) {
      if (live(m)) push(surface(m.x, m.y, m.w, m.h, p.x, p.y, r, () => insideMover(m, p.x, p.y)), m.type);
    }
    return hit;
  }

  function solidAt(x, y) {
    if (at(Math.floor(x), Math.floor(y))) return true;
    return movers.some((m) => live(m) && x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h);
  }

  // every panel cell, for drawing its glow
  const panels = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y * w + x] === 'panel') panels.push({ x, y, e: meta[y * w + x] });

  setTime(0);

  return {
    w, h, at, metaAt, solidAt, nearest, collide, start, checkpoints, exits, buttons, cards,
    movers, doors, panels, panel, setTime, setDoor, isOpen, keyColor,
    get time() { return time; },
  };
}
