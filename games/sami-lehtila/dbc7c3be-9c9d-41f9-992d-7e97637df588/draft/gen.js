import { parseLevel, solve, initialState, step } from './logic.js';

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const DN = 'NESW';
const BLOCKING = 'LD~';

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Walks a random valid route (carving floor as it goes), places the goal at its end,
// then pulls a few commands out of the route and drops them on tiles the robot passes earlier.
function attempt(rnd) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const w = 8 + Math.floor(rnd() * 3);
  const h = 5 + Math.floor(rnd() * 3);
  const g = [];
  for (let y = 0; y < h; y++) {
    g.push([]);
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      g[y].push(edge ? '#' : rnd() < 0.55 ? '_' : '#');
    }
  }
  const inside = (x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1;
  let x = 1 + Math.floor(rnd() * (w - 2));
  let y = 1 + Math.floor(rnd() * (h - 2));
  let dir = Math.floor(rnd() * 4);
  const sx = x, sy = y, sdir = dir;
  g[y][x] = '.';
  const visited = new Set([`${x},${y}`]);
  const ops = [];
  const posBefore = [];
  const push = (o) => { posBefore.push(`${x},${y}`); ops.push(o); };
  const len = 14 + Math.floor(rnd() * 6);
  let usedLever = false;
  let guard = 0;
  while (ops.length < len && guard++ < 200) {
    const r = rnd();
    const nx = x + DX[dir], ny = y + DY[dir];
    if (!usedLever && r < 0.12 && inside(nx, ny) && !visited.has(`${nx},${ny}`)) {
      const side = rnd() < 0.5 ? 'L' : 'R';
      const sd = side === 'L' ? (dir + 3) % 4 : (dir + 1) % 4;
      const lx = x + DX[sd], ly = y + DY[sd];
      if (!inside(lx, ly) || visited.has(`${lx},${ly}`)) continue;
      g[ly][lx] = 'L';
      visited.add(`${lx},${ly}`);
      push(side); push('A'); push(side === 'L' ? 'R' : 'L');
      g[ny][nx] = rnd() < 0.5 ? 'D' : '~';
      push('F');
      x = nx; y = ny; visited.add(`${x},${y}`);
      usedLever = true;
    } else if (r < 0.62) {
      if (!inside(nx, ny) || BLOCKING.includes(g[ny][nx])) continue;
      push('F');
      x = nx; y = ny; g[y][x] = '.'; visited.add(`${x},${y}`);
    } else if (r < 0.92) {
      const o = rnd() < 0.5 ? 'L' : 'R';
      if ('LR'.includes(ops.at(-1)) && ops.at(-1) !== o) continue;
      if (ops.at(-1) === o && ops.at(-2) === o) continue;
      push(o);
      dir = o === 'L' ? (dir + 3) % 4 : (dir + 1) % 4;
    } else {
      const bx = x - DX[dir], by = y - DY[dir];
      if (!inside(bx, by) || BLOCKING.includes(g[by][bx])) continue;
      push('B');
      x = bx; y = by; g[y][x] = '.'; visited.add(`${x},${y}`);
    }
  }
  if (x === sx && y === sy) return null;
  if (posBefore.includes(`${x},${y}`)) return null;
  g[y][x] = 'G';

  const k = 2 + Math.floor(rnd() * 3);
  const removable = ops.map((o, i) => i).filter((i) => i > 1);
  const removed = new Set();
  while (removed.size < k) removed.add(pick(removable));
  const cards = new Map();
  for (const i of removed) {
    const cand = [...new Set(posBefore.slice(1, i + 1))].filter((p) => {
      const [cx, cy] = p.split(',').map(Number);
      return g[cy][cx] === '.' && !cards.has(p);
    });
    if (!cand.length) return null;
    cards.set(pick(cand), ops[i].toLowerCase());
  }
  for (const [p, c] of cards) {
    const [cx, cy] = p.split(',').map(Number);
    g[cy][cx] = c;
  }
  g[sy][sx] = 'S';
  const program = ops.filter((o, i) => !removed.has(i)).join('');
  if (program.length < 11) return null;
  return { dir: DN[sdir], program, map: g.map((r) => r.join('')) };
}

export function generateLevel(seed, maxAttempts = 400) {
  const rnd = rng(seed);
  for (let i = 0; i < maxAttempts; i++) {
    const def = attempt(rnd);
    if (!def) continue;
    const level = parseLevel({ ...def, name: '' });
    let s = initialState(level);
    while (s.pc < s.program.length && !s.dead && !s.won) s = step(level, s).state;
    if (s.won) continue;
    const r = solve(level, 60000);
    if (r.inserted === null || r.inserted < 2) continue;
    return { ...def, par: r.inserted };
  }
  return null;
}
