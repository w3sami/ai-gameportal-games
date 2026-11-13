// One level in play: the player's steps and pushes take time, enemies walk
// on their own clock, and a touch from an enemy starts the level again.
//
// A step is decided by rules.step() and written into the grid at once, so
// the cells a row is moving into are already taken while it slides; the
// renderer draws everything between where it was and where it is going.
// While a step is under way the player can do nothing else: a slow push
// is a commitment.

import { parseLevel, step, apply, cloneState, gemsLeft, DIRS } from './rules.js';

export function createGame(T, level, events = () => {}) {
  const start = parseLevel(level.rows);
  let s, act, enemies, state, timer, facing, clock, steps;

  function restart() {
    s = cloneState(start);
    act = null;               // { kind, dir, t, dur, moves: [{ kind, from, to }] }
    enemies = start.enemies.map((e) => ({ cell: e.cell, from: e.cell, dir: 1, axis: e.axis, t: 0 }));
    state = 'play';           // play | dead | won
    timer = 0;
    facing = 'down';
    clock = 0;
    steps = 0;
  }
  restart();

  const xy = (i) => [i % s.w, (i / s.w) | 0];
  const enemyAt = (i) => enemies.some((e) => e.cell === i || e.from === i);

  function begin(dir) {
    facing = dir;
    const r = step(s, dir, enemyAt);
    const from = s.player;
    if (r.kind === 'bump') {
      act = { kind: 'bump', dir, t: 0, dur: T.bump, moves: [] };
      return;
    }
    const moves = [{ kind: 'player', from, to: r.to }];
    let dur = T.walk;
    if (r.kind === 'push') {
      const [dx, dy] = DIRS[dir], d = dy * s.w + dx;
      for (const i of r.chain) moves.push({ kind: s.obj[i], from: i, to: i + d });
      dur = T.push[r.len - 1];
    }
    if (r.kind === 'collect') {
      dur = T.collect;
      events('collect', { kind: s.obj[r.to], at: xy(r.to) });
    }
    apply(s, r, dir);
    steps++;
    act = { kind: r.kind, len: r.len || 0, dir, t: 0, dur, moves };
    if (r.kind === 'push') events('push', { len: r.len });
  }

  // an enemy's next cell: on along its axis, or back if that is taken
  function enemyNext(e) {
    const [x, y] = xy(e.cell);
    const free = (d) => {
      const nx = e.axis === 'x' ? x + d : x, ny = e.axis === 'y' ? y + d : y;
      if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) return -1;
      const i = ny * s.w + nx;
      return s.wall[i] || s.obj[i] || enemies.some((o) => o !== e && (o.cell === i || o.from === i)) ? -1 : i;
    };
    let n = free(e.dir);
    if (n < 0) { e.dir = -e.dir; n = free(e.dir); }
    return n < 0 ? e.cell : n;
  }

  // positions in cells, between from and to
  const lerp = (a, b, t) => a + (b - a) * t;
  function at(from, to, t) {
    const [ax, ay] = xy(from), [bx, by] = xy(to);
    return [lerp(ax, bx, t), lerp(ay, by, t)];
  }

  function playerPos() {
    if (act && act.moves.length) {
      const m = act.moves[0];
      return at(m.from, m.to, Math.min(1, act.t / act.dur));
    }
    return xy(s.player);
  }
  const enemyPos = (e) => at(e.from, e.cell, Math.min(1, e.t / T.enemyStep));

  function update(dt, wantDir) {
    timer += dt;
    if (state === 'dead') {
      if (timer >= T.deadPause) restart();
      return;
    }
    if (state === 'play') clock += dt;

    // enemies keep walking after a win, but cannot catch anyone
    for (const e of enemies) {
      e.t += dt;
      if (e.t >= T.enemyStep) {
        e.t -= T.enemyStep;
        e.from = e.cell;
        e.cell = enemyNext(e);
      }
    }

    if (state === 'play') {
      if (act) {
        act.t += dt;
        if (act.t >= act.dur) {
          const rest = act.t - act.dur;
          act = null;
          if (!gemsLeft(s)) { state = 'won'; timer = 0; events('won', { time: clock, steps }); }
          else if (wantDir) { begin(wantDir); act.t = Math.min(rest, act.dur * 0.5); }
        }
      } else if (wantDir) begin(wantDir);

      const [px, py] = playerPos();
      for (const e of enemies) {
        const [ex, ey] = enemyPos(e);
        if (Math.hypot(px - ex, py - ey) < T.touch) {
          state = 'dead'; timer = 0; act = null;
          events('dead', { at: [px, py] });
          break;
        }
      }
    }
  }

  // what the renderer needs: every object at its drawn position
  function view() {
    const moving = new Map();
    if (act) {
      const k = Math.min(1, act.t / act.dur);
      for (const m of act.moves) if (m.kind !== 'player') moving.set(m.to, at(m.from, m.to, k));
    }
    const objs = [];
    s.obj.forEach((kind, i) => { if (kind) objs.push({ kind, pos: moving.get(i) || xy(i) }); });
    return {
      w: s.w, h: s.h, wall: s.wall, objs,
      player: { pos: playerPos(), facing, act: act && { kind: act.kind, len: act.len, k: act.t / act.dur, dir: act.dir } },
      enemies: enemies.map((e) => ({ pos: enemyPos(e), axis: e.axis, dir: e.dir })),
      state, timer, gems: gemsLeft(s), clock, steps,
    };
  }

  return { update, view, restart, get state() { return state; }, get grid() { return s; } };
}
