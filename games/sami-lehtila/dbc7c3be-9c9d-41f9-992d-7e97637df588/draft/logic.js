export const OPS = {
  F: { name: 'Eteen', icon: '↑' },
  B: { name: 'Taakse', icon: '↓' },
  L: { name: 'Vasen', icon: '↺' },
  R: { name: 'Oikea', icon: '↻' },
  A: { name: 'Aktivoi', icon: '⚡' },
};

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const DIRS = { N: 0, E: 1, S: 2, W: 3 };

// Map legend: # wall, . floor, _ pit, G goal, S start, L lever, D closed door, d open door,
// ~ raised bridge (a pit until lowered), = lowered bridge, lowercase f/b/l/r/a = command card on the floor.
// A lever flips every door and bridge at once.
export function parseLevel(def) {
  const rows = def.map;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const tiles = [];
  const cards = [];
  let start = null;
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      let c = rows[y][x] ?? '_';
      if (c === ' ') c = '_';
      if (c === 'S') {
        start = { x, y, dir: DIRS[def.dir ?? 'N'] };
        c = '.';
      } else if ('fblra'.includes(c)) {
        cards.push({ x, y, op: c.toUpperCase() });
        c = '.';
      }
      row.push(c);
    }
    tiles.push(row);
  }
  if (!start) throw new Error(`Level ${def.name} has no start`);
  return { ...def, w, h, tiles, cards, start };
}

export function initialState(level) {
  let nextId = 1;
  const program = [...level.program].map((op) => ({ op, id: nextId++, ins: false }));
  const hand = [...(level.hand ?? '')].map((op) => ({ op, id: nextId++ }));
  return {
    x: level.start.x,
    y: level.start.y,
    dir: level.start.dir,
    pc: 0,
    program,
    hand,
    taken: level.cards.map(() => false),
    flip: false,
    dead: false,
    won: false,
    inserted: 0,
    nextId,
  };
}

export function tileAt(level, x, y) {
  if (y < 0 || y >= level.h || x < 0 || x >= level.w) return '_';
  return level.tiles[y][x];
}

export function doorOpen(level, state, x, y) {
  const t = tileAt(level, x, y);
  return (t === 'd') !== state.flip;
}

export function bridgeDown(level, state, x, y) {
  const t = tileAt(level, x, y);
  return (t === '=') !== state.flip;
}

function isPit(level, state, x, y) {
  const t = tileAt(level, x, y);
  if (t === '_') return true;
  if (t === '~' || t === '=') return !bridgeDown(level, state, x, y);
  return false;
}

function blocked(level, state, x, y) {
  const t = tileAt(level, x, y);
  if (t === '#' || t === 'L') return true;
  if (t === 'D' || t === 'd') return !doorOpen(level, state, x, y);
  return false;
}

function clone(state) {
  return {
    ...state,
    program: state.program.slice(),
    hand: state.hand.slice(),
    taken: state.taken.slice(),
  };
}

export function canStep(state) {
  return !state.dead && !state.won && state.pc < state.program.length;
}

// Returns { state, event } where event describes what happened, for animation and sound.
export function step(level, prev) {
  if (!canStep(prev)) return { state: prev, event: null };
  const s = clone(prev);
  const cmd = s.program[s.pc++];
  const event = { op: cmd.op, type: 'turn', pickups: [] };

  if (cmd.op === 'L') s.dir = (s.dir + 3) % 4;
  else if (cmd.op === 'R') s.dir = (s.dir + 1) % 4;
  else if (cmd.op === 'A') {
    const tx = s.x + DX[s.dir];
    const ty = s.y + DY[s.dir];
    if (tileAt(level, tx, ty) === 'L') {
      s.flip = !s.flip;
      event.type = 'activate';
      if (isPit(level, s, s.x, s.y)) {
        s.dead = true;
        event.fell = true;
      }
    } else {
      event.type = 'fizzle';
    }
  } else {
    const sign = cmd.op === 'F' ? 1 : -1;
    const nx = s.x + DX[s.dir] * sign;
    const ny = s.y + DY[s.dir] * sign;
    if (blocked(level, s, nx, ny)) {
      event.type = 'bump';
    } else {
      s.x = nx;
      s.y = ny;
      event.type = 'move';
      if (isPit(level, s, nx, ny)) {
        s.dead = true;
        event.type = 'fall';
      }
    }
  }

  if (!s.dead) {
    level.cards.forEach((c, i) => {
      if (!s.taken[i] && c.x === s.x && c.y === s.y) {
        s.taken[i] = true;
        s.hand.push({ op: c.op, id: s.nextId++ });
        event.pickups.push(i);
      }
    });
    if (tileAt(level, s.x, s.y) === 'G') {
      s.won = true;
      event.won = true;
    }
  }
  return { state: s, event };
}

export function canInsert(state, pos) {
  return !state.dead && !state.won && pos >= state.pc && pos <= state.program.length;
}

export function insert(prev, handIdx, pos) {
  if (!canInsert(prev, pos) || !prev.hand[handIdx]) return prev;
  const s = clone(prev);
  const [card] = s.hand.splice(handIdx, 1);
  s.program.splice(pos, 0, { op: card.op, id: card.id, ins: true });
  s.inserted++;
  return s;
}

export function takeBack(prev, pos) {
  const cmd = prev.program[pos];
  if (!cmd || !cmd.ins || !canInsert(prev, pos) || pos === prev.program.length) return prev;
  const s = clone(prev);
  s.program.splice(pos, 1);
  s.hand.push({ op: cmd.op, id: cmd.id });
  s.inserted--;
  return s;
}

// Fewest inserted cards that reach the goal (0-1 BFS: steps are free, insertions cost one).
export function solve(level, maxStates = 400000) {
  const start = initialState(level);
  const key = (s) =>
    [s.x, s.y, s.dir, s.flip ? 1 : 0, s.taken.map((t) => (t ? 1 : 0)).join(''),
      s.program.slice(s.pc).map((c) => c.op).join(''),
      s.hand.map((c) => c.op).sort().join('')].join('|');
  const seen = new Map([[key(start), 0]]);
  let deque = [{ s: start, path: [] }];
  let next = [];
  let cost = 0;
  while (deque.length || next.length) {
    if (!deque.length) {
      deque = next;
      next = [];
      cost++;
    }
    const { s, path } = deque.pop();
    if (s.won) return { inserted: cost, path, states: seen.size };
    if (seen.size > maxStates) return { inserted: null, states: seen.size, aborted: true };
    if (canStep(s)) {
      const n = step(level, s).state;
      const k = key(n);
      if (!n.dead && !(seen.get(k) <= cost)) {
        seen.set(k, cost);
        deque.push({ s: n, path: [...path, 'step'] });
      }
    }
    const ops = new Set();
    s.hand.forEach((c, hi) => {
      if (ops.has(c.op)) return;
      ops.add(c.op);
      for (let pos = s.pc; pos <= s.program.length; pos++) {
        const n = insert(s, hi, pos);
        const k = key(n);
        if (!(seen.get(k) <= cost + 1)) {
          seen.set(k, cost + 1);
          next.push({ s: n, path: [...path, `+${c.op}@${pos - s.pc}`] });
        }
      }
    });
  }
  return { inserted: null, states: seen.size };
}
