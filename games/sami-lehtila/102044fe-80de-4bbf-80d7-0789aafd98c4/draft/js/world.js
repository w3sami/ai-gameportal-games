// The level's solid parts and the questions physics asks of them: which
// solids a circle overlaps (to push it out), and where the nearest surface
// is (for magnetism, grip and drops that stick).
//
// Solids are the tile grid plus movers: platforms and doors, rectangles
// whose place is a function of the world's clock (setTime). Everything that
// moves goes through the clock, so slime.js can step it a substep at a time
// and wind it back after a look ahead.
//
// A tile is a whole cell, or with a `slope` half of it: the right triangle
// in one corner, 'br' (bottom right), 'bl', 'tr' or 'tl', whose long side
// is a 45° surface facing the opposite corner.
//
// The things that are not solid (start, checkpoints, exit, buttons, cards)
// are listed for game.js and render.js.

import { LEGEND } from './level.js';

const TAU = Math.PI * 2;
const DOOR_TIME = 0.5;   // s for a door to slide fully open or shut
const R2 = Math.SQRT1_2;

// Each slope: its corners (in the cell, 0–1), its long side from a to b
// with the outward normal n, the sides of the cell it covers whole, and the
// step to the next cell along its long side.
const SLOPES = {
  br: { pts: [[1, 0], [1, 1], [0, 1]], a: [0, 1], b: [1, 0], n: [-R2, -R2], covers: [[1, 0], [0, 1]], step: [1, -1] },
  bl: { pts: [[0, 0], [1, 1], [0, 1]], a: [0, 0], b: [1, 1], n: [R2, -R2], covers: [[-1, 0], [0, 1]], step: [1, 1] },
  tr: { pts: [[0, 0], [1, 0], [1, 1]], a: [0, 0], b: [1, 1], n: [-R2, R2], covers: [[1, 0], [0, -1]], step: [1, 1] },
  tl: { pts: [[0, 0], [1, 0], [0, 1]], a: [0, 1], b: [1, 0], n: [R2, R2], covers: [[-1, 0], [0, -1]], step: [1, -1] },
};
export { SLOPES };

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
  const slopeAt = (cx, cy) => SLOPES[metaAt(cx, cy)?.slope] || null;
  // whether the tile at a cell fills its whole side towards (dx, dy)
  function covers(cx, cy, dx, dy) {
    if (!at(cx, cy)) return false;
    const sl = slopeAt(cx, cy);
    return !sl || sl.covers.some(([x, y]) => x === dx && y === dy);
  }
  // whether a point is inside the tile at its cell
  function inTile(cx, cy, x, y) {
    if (!at(cx, cy)) return false;
    const sl = slopeAt(cx, cy);
    return !sl || (x - cx - sl.a[0]) * sl.n[0] + (y - cy - sl.a[1]) * sl.n[1] < 0;
  }

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

  // A panel's turn, { state, k }: state 'off', 'warn' (about to glow red)
  // or 'on' (red, burns), and k how far into that state it is, 0–1.
  function turn(e, t = time) {
    const { off, warn, on } = T.panel;
    const cycle = off + warn + on;
    if (cycle <= 0) return { state: 'off', k: 0 };
    const u = (((t + (e?.phase || 0) * cycle) % cycle) + cycle) % cycle;
    if (u < off) return { state: 'off', k: u / off };
    if (u < off + warn) return { state: 'warn', k: (u - off) / warn };
    return { state: 'on', k: (u - off - warn) / on };
  }
  const panel = (e, t) => turn(e, t).state;

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
  const insideTile = (cx, cy, x, y) => exit(cx, cy, 1, 1, x, y, (dx, dy) => !covers(cx + dx, cy + dy, -dx, -dy));
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
        const hit = tileSurface(cx, cy, x, y, range);
        if (hit) visit(Object.assign(hit, { type, vx: 0, vy: 0, meta: metaAt(cx, cy), mover: null }));
      }
    }
    for (const m of movers) {
      if (!live(m)) continue;
      const hit = surface(m.x, m.y, m.w, m.h, x, y, range, () => insideMover(m, x, y));
      if (hit) visit(Object.assign(hit, { type: m.type, vx: m.vx, vy: m.vy, meta: m.e, mover: m }));
    }
  }

  // A slope's surface: outside, the nearest point of its triangle; inside,
  // the way out through its long side or an open short side, whichever is
  // closest.
  function slopeSurface(cx, cy, sl, x, y, range) {
    const lx = x - cx, ly = y - cy;
    if ((lx - sl.a[0]) * sl.n[0] + (ly - sl.a[1]) * sl.n[1] >= 0 || lx < 0 || ly < 0 || lx > 1 || ly > 1) {
      let best = null;
      for (let i = 0; i < 3; i++) {
        const [ax, ay] = sl.pts[i], [bx, by] = sl.pts[(i + 1) % 3];
        const ex = bx - ax, ey = by - ay, k = Math.max(0, Math.min(1, ((lx - ax) * ex + (ly - ay) * ey) / (ex * ex + ey * ey)));
        const px = ax + ex * k, py = ay + ey * k, d = Math.hypot(lx - px, ly - py);
        if (!best || d < best.d) best = { d, px, py };
      }
      if (best.d > 1e-9) {
        if (best.d > range) return null;
        return { d: best.d, px: cx + best.px, py: cy + best.py, nx: (lx - best.px) / best.d, ny: (ly - best.py) / best.d };
      }
    }
    const depth = -((lx - sl.a[0]) * sl.n[0] + (ly - sl.a[1]) * sl.n[1]);
    let hit = { d: -depth, px: x + sl.n[0] * depth, py: y + sl.n[1] * depth, nx: sl.n[0], ny: sl.n[1] };
    for (const [dx, dy] of sl.covers) {
      if (covers(cx + dx, cy + dy, -dx, -dy)) continue;
      const d = dx > 0 ? 1 - lx : dx < 0 ? lx : dy > 0 ? 1 - ly : ly;
      if (d < -hit.d) hit = { d: -d, px: x + dx * d, py: y + dy * d, nx: dx, ny: dy };
    }
    return hit;
  }

  function tileSurface(cx, cy, x, y, range) {
    const sl = slopeAt(cx, cy);
    if (sl) return slopeSurface(cx, cy, sl, x, y, range);
    return surface(cx, cy, 1, 1, x, y, range, () => insideTile(cx, cy, x, y));
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
        if (type) push(tileSurface(cx, cy, p.x, p.y, r), type);
      }
    }
    for (const m of movers) {
      if (live(m)) push(surface(m.x, m.y, m.w, m.h, p.x, p.y, r, () => insideMover(m, p.x, p.y)), m.type);
    }
    return hit;
  }

  function solidAt(x, y) {
    if (inTile(Math.floor(x), Math.floor(y), x, y)) return true;
    return movers.some((m) => live(m) && x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h);
  }

  // The panels' glowing faces, for drawing: each run of panel cells of one
  // phase along a face open to the room is one strip { x, y, tx, ty, nx,
  // ny, len, e }: (x, y) the face's start corner, (tx, ty) the way along it,
  // (nx, ny) its outward normal, len its length in tiles along the face.
  const panels = [];
  const isPanel = (x, y, e) => at(x, y) === 'panel' && metaAt(x, y)?.phase === e.phase;
  for (const [nx, ny] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const ax = ny ? 1 : 0, ay = ny ? 0 : 1;   // along the face
    const face = (x, y, e) => isPanel(x, y, e) && !slopeAt(x, y) && !covers(x + nx, y + ny, -nx, -ny);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const e = metaAt(x, y);
        if (!face(x, y, e)) continue;
        // only the first cell of a run starts a strip
        if (face(x - ax, y - ay, e)) continue;
        let len = 1;
        while (face(x + ax * len, y + ay * len, e)) len++;
        panels.push({ x: x + (nx > 0 ? 1 : 0), y: y + (ny > 0 ? 1 : 0), tx: ax, ty: ay, nx, ny, len, e });
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = metaAt(x, y), sl = slopeAt(x, y);
      if (at(x, y) !== 'panel' || !sl) continue;
      const same = (cx, cy) => isPanel(cx, cy, e) && slopeAt(cx, cy) === sl;
      const [sx, sy] = sl.step;
      if (same(x - sx, y - sy)) continue;
      let len = 1;
      while (same(x + sx * len, y + sy * len)) len++;
      panels.push({ x: x + sl.a[0], y: y + sl.a[1], tx: sx * R2, ty: sy * R2, nx: sl.n[0], ny: sl.n[1], len: len * Math.SQRT2, e });
    }
  }

  // The editor's brush: a tile character takes effect at once; anything else
  // (a thing, or empty) leaves the cell empty until the world is built again.
  function setCell(cx, cy, ch) {
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return;
    const e = legend[ch];
    grid[cy * w + cx] = e?.tile || null;
    meta[cy * w + cx] = e?.tile ? e : null;
  }

  setTime(0);

  return {
    legend, setCell,
    w, h, at, metaAt, slopeAt, covers, solidAt, nearest, collide, start, checkpoints, exits, buttons, cards,
    movers, doors, panels, panel, turn, setTime, setDoor, isOpen, keyColor,
    get time() { return time; },
  };
}
