// The grid and what one step does to it. No DOM and no clock: the game
// (game.js) animates what step() decides, and devtools/solve.mjs searches
// the same rules for a level's solutions.
//
// A level is rows of characters:
//   #  wall          o  box
//   x  rock: a wall that sits inside a cluster (drawn as a stone, not as wall)
//   .  floor         *  lock gem: pushed while it can move, collected when it cannot
//   @  player        +  touch gem: collected when the player touches it,
//   e  enemy, walks left and right      pushed when something in a row pushes it
//   v  enemy, walks up and down      $  anchor gem: never moves, a wall to every row;
//                                       collected when the player touches it
// Anything else is floor.
//
// A row of up to MAX_CHAIN things moves when the cell beyond it is free
// floor. The level is done when no gem is left.

export const MAX_CHAIN = 3;
export const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

const OBJ = { o: 'box', '*': 'lock', '+': 'touch', $: 'anchor' };
export const isGem = (k) => k === 'lock' || k === 'touch' || k === 'anchor';

export function parseLevel(rows) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h);
  const obj = new Array(w * h).fill(null);
  const enemies = [];
  let player = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x] ?? '#', i = y * w + x;
      if (c === '#') wall[i] = 1;
      else if (c === 'x') wall[i] = 2;
      else if (OBJ[c]) obj[i] = OBJ[c];
      else if (c === '@') player = i;
      else if (c === 'e') enemies.push({ cell: i, axis: 'x' });
      else if (c === 'v') enemies.push({ cell: i, axis: 'y' });
    }
  }
  return { w, h, wall, obj, player, enemies };
}

export const gemsLeft = (s) => s.obj.reduce((n, k) => n + (isGem(k) ? 1 : 0), 0);

// What a step from the player's cell in `dir` does, without doing it.
// `blocked(i)`: an extra test for a cell a row may not move into (an
// enemy standing there); the solver passes none.
// Returns { kind, to, chain, len }:
//   bump     nothing moves
//   walk     the player moves to `to`
//   collect  the gem at `to` goes, and the player moves there
//   push     the cells in `chain` (nearest first) move one along, the player to `to`
export function step(s, dir, blocked = () => false) {
  const [dx, dy] = DIRS[dir];
  const at = (x, y) => (x < 0 || y < 0 || x >= s.w || y >= s.h ? -1 : y * s.w + x);
  const px = s.player % s.w, py = (s.player / s.w) | 0;
  const to = at(px + dx, py + dy);
  if (to < 0 || s.wall[to]) return { kind: 'bump', to: s.player };
  const first = s.obj[to];
  if (!first) return { kind: 'walk', to };
  if (first === 'touch' || first === 'anchor') return { kind: 'collect', to };

  const chain = [];
  let x = px + dx, y = py + dy, i = to;
  while (i >= 0 && !s.wall[i] && s.obj[i] && s.obj[i] !== 'anchor' && chain.length <= MAX_CHAIN) {
    chain.push(i);
    x += dx; y += dy; i = at(x, y);
  }
  const free = chain.length <= MAX_CHAIN && i >= 0 && !s.wall[i] && !s.obj[i] && !blocked(i);
  if (free) return { kind: 'push', to, chain, len: chain.length };
  if (first === 'lock') return { kind: 'collect', to };
  return { kind: 'bump', to: s.player };
}

// Carry out what step() returned. Mutates s.
export function apply(s, r, dir) {
  if (r.kind === 'collect') s.obj[r.to] = null;
  if (r.kind === 'push') {
    const [dx, dy] = DIRS[dir], d = dy * s.w + dx;
    for (let k = r.chain.length - 1; k >= 0; k--) {
      const i = r.chain[k];
      s.obj[i + d] = s.obj[i];
      s.obj[i] = null;
    }
  }
  s.player = r.to;
}

export function cloneState(s) {
  return { ...s, obj: s.obj.slice(), enemies: s.enemies.map((e) => ({ ...e })) };
}
