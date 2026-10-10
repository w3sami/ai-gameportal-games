// The tile grid and the two questions physics asks of it: which tiles a
// circle overlaps (to push it out), and where the nearest surface is (for
// magnetism, grip and drops that stick).

import { TILE_TYPES } from './level.js';

export function buildWorld(rows) {
  const h = rows.length, w = rows[0].length;
  const grid = [];
  let start = { x: w / 2, y: h / 2 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      grid.push(TILE_TYPES[c] || null);
      if (c === 'S') start = { x: x + 0.5, y: y + 0.5 };
    }
  }

  // tile type at a cell, or null when empty; outside the map is stone
  const at = (cx, cy) => (cx < 0 || cy < 0 || cx >= w || cy >= h ? 'stone' : grid[cy * w + cx]);
  const solidAt = (x, y) => at(Math.floor(x), Math.floor(y)) !== null;

  // Nearest surface point to (x, y) within `range`, as
  // { d, px, py, nx, ny, type }: d is the distance (negative when inside a
  // tile), (px, py) the point on the surface and (nx, ny) the outward normal.
  // null when nothing is that close.
  function nearest(x, y, range) {
    let best = null;
    const x0 = Math.floor(x - range), x1 = Math.floor(x + range);
    const y0 = Math.floor(y - range), y1 = Math.floor(y + range);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const type = at(cx, cy);
        if (!type) continue;
        const px = Math.max(cx, Math.min(cx + 1, x)), py = Math.max(cy, Math.min(cy + 1, y));
        let dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
        let hit;
        if (d > 0) {
          if (d > range || (best && d >= best.d)) continue;
          hit = { d, px, py, nx: dx / d, ny: dy / d, type };
        } else {
          hit = inside(cx, cy, x, y, type);
          if (!hit || (best && hit.d >= best.d)) continue;
        }
        best = hit;
      }
    }
    return best;
  }

  // a point inside a solid tile leaves through the closest face that opens
  // onto an empty tile; a tile buried on all sides has no way out
  function inside(cx, cy, x, y, type) {
    const faces = [
      [x - cx, -1, 0, cx, y, at(cx - 1, cy)],
      [cx + 1 - x, 1, 0, cx + 1, y, at(cx + 1, cy)],
      [y - cy, 0, -1, x, cy, at(cx, cy - 1)],
      [cy + 1 - y, 0, 1, x, cy + 1, at(cx, cy + 1)],
    ];
    let hit = null;
    for (const [depth, nx, ny, px, py, next] of faces) {
      if (next) continue;
      if (!hit || -depth < hit.d) hit = { d: -depth, px, py, nx, ny, type };
    }
    return hit;
  }

  // Push a circle out of every tile it overlaps. Returns the summed push
  // normal and the type of the last tile pushed against, or null.
  function collide(p, r) {
    let hit = null;
    const x0 = Math.floor(p.x - r), x1 = Math.floor(p.x + r);
    const y0 = Math.floor(p.y - r), y1 = Math.floor(p.y + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const type = at(cx, cy);
        if (!type) continue;
        const px = Math.max(cx, Math.min(cx + 1, p.x)), py = Math.max(cy, Math.min(cy + 1, p.y));
        const dx = p.x - px, dy = p.y - py, d = Math.hypot(dx, dy);
        let nx, ny, push;
        if (d > 0) {
          if (d >= r) continue;
          nx = dx / d; ny = dy / d; push = r - d;
        } else {
          const h = inside(cx, cy, p.x, p.y, type);
          if (!h) continue;
          nx = h.nx; ny = h.ny; push = r - h.d;
        }
        p.x += nx * push; p.y += ny * push;
        hit = hit || { nx: 0, ny: 0, type };
        hit.nx += nx; hit.ny += ny; hit.type = type;
      }
    }
    return hit;
  }

  return { w, h, at, solidAt, nearest, collide, start };
}
