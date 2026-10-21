// Level generation and solving for Norppa.
//
// Level shape:
//   { n, size, grid: Uint8Array(size*size) of TILE codes (row-major, y*size+x),
//     start: [x, y], hole: [x, y], par: minimum moves (from BFS) }
//
// Rules: the seal slides in a straight line until the next cell is a ROCK or
// the shore (board edge). Entering SNOW stops it inside that cell. Passing
// over the HOLE drops it in and wins.

export const TILE = { ICE: 0, ROCK: 1, SNOW: 2, HOLE: 3 };
export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIR_NAMES = Object.keys(DIRS);

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function slide(level, x, y, dir) {
  const [dx, dy] = DIRS[dir];
  const { size, grid } = level;
  let cx = x, cy = y, cells = 0;
  for (;;) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) break;
    const t = grid[ny * size + nx];
    if (t === TILE.ROCK) break;
    cx = nx; cy = ny; cells++;
    if (t === TILE.HOLE) return { x: cx, y: cy, cells, won: true };
    if (t === TILE.SNOW) break;
  }
  return { x: cx, y: cy, cells, won: false };
}

// BFS from (sx, sy). Returns { moves, path: [dirName, ...] } or null.
export function solve(level, sx, sy) {
  const { size } = level;
  const N = size * size;
  const prev = new Int32Array(N).fill(-1);
  const prevDir = new Int8Array(N).fill(-1);
  const seen = new Uint8Array(N);
  const startI = sy * size + sx;
  seen[startI] = 1;
  let frontier = [startI];
  while (frontier.length) {
    const next = [];
    for (const i of frontier) {
      const x = i % size, y = (i / size) | 0;
      for (let d = 0; d < 4; d++) {
        const r = slide(level, x, y, DIR_NAMES[d]);
        if (r.cells === 0) continue;
        const j = r.y * size + r.x;
        if (r.won) {
          const path = [DIR_NAMES[d]];
          let k = i;
          while (k !== startI) { path.push(DIR_NAMES[prevDir[k]]); k = prev[k]; }
          path.reverse();
          return { moves: path.length, path };
        }
        if (seen[j]) continue;
        seen[j] = 1; prev[j] = i; prevDir[j] = d;
        next.push(j);
      }
    }
    frontier = next;
  }
  return null;
}

export function generate(n, cfg) {
  const rng = mulberry32((Math.imul(n, 2654435761) ^ cfg.seedSalt) >>> 0);
  const size = Math.min(cfg.maxSize, cfg.baseSize + Math.floor((n - 1) / cfg.sizeGrowEvery));
  const target = Math.min(cfg.maxPar, cfg.minPar + Math.floor((n - 1) * cfg.parGrowth));
  const snow = n >= cfg.snowFromLevel ? cfg.snowDensity : 0;
  let best = null;

  for (let a = 0; a < cfg.attempts; a++) {
    const grid = new Uint8Array(size * size);
    const free = [];
    for (let i = 0; i < grid.length; i++) {
      const r = rng();
      if (r < cfg.rockDensity) grid[i] = TILE.ROCK;
      else if (r < cfg.rockDensity + snow) grid[i] = TILE.SNOW;
      else free.push(i);
    }
    if (free.length < 2) continue;
    const si = free[(rng() * free.length) | 0];
    let hi = si;
    while (hi === si) hi = free[(rng() * free.length) | 0];
    grid[hi] = TILE.HOLE;
    const level = { n, size, grid, start: [si % size, (si / size) | 0], hole: [hi % size, (hi / size) | 0] };
    const sol = solve(level, level.start[0], level.start[1]);
    if (!sol) continue;
    if (sol.moves >= target && sol.moves <= target + cfg.parSlack) return { ...level, par: sol.moves };
    if (sol.moves <= target + cfg.parSlack && (!best || sol.moves > best.par)) best = { ...level, par: sol.moves };
  }
  return best;
}
