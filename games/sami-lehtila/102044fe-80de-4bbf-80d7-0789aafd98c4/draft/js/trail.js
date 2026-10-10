// Slime drops: a fixed pool (tune.trail.pool) reused oldest first. A drop
// either flies (thrown by a splat, or dripping off a ceiling) or sticks where
// it hit a surface, flattened against it, until its life runs out.
//
// Drop: { state: 'fly' | 'stuck', x, y, vx, vy, nx, ny, r, age, on, ox, oy }
// (nx, ny) is the surface's outward normal once stuck. A drop stuck on a
// platform or a door (`on`) rides it at (ox, oy) from its corner, and falls
// off once that is no longer on the mover's edge (a door sliding open).

export function createTrail(T, world) {
  let drops = [], next = 0;

  function take() {
    const size = Math.max(1, Math.round(T.trail.pool));
    if (drops.length > size) { drops.length = size; next = 0; }
    let d;
    if (drops.length < size) drops.push((d = {}));
    else { d = drops[next % size]; next = (next + 1) % size; }
    d.age = 0;
    d.r = T.trail.size * (0.6 + Math.random() * 0.7);
    return d;
  }

  function stick(x, y, nx, ny, mover) {
    const d = take();
    Object.assign(d, { state: 'stuck', x, y, vx: 0, vy: 0, nx, ny });
    d.x += -ny * (Math.random() - 0.5) * 0.15;
    d.y += nx * (Math.random() - 0.5) * 0.15;
    ride(d, mover);
  }

  function ride(d, mover) {
    d.on = mover || null;
    if (mover) { d.ox = d.x - mover.x; d.oy = d.y - mover.y; }
  }

  const EDGE = 0.05;
  function onEdge(d) {
    const m = d.on;
    return d.ox >= -EDGE && d.oy >= -EDGE && d.ox <= m.w + EDGE && d.oy <= m.h + EDGE;
  }

  function fly(x, y, vx, vy) {
    const d = take();
    Object.assign(d, { state: 'fly', x, y, vx, vy, nx: 0, ny: -1, on: null });
    d.r *= 0.8;
  }

  function on(type, e) {
    if (type === 'trail') stick(e.x, e.y, e.nx, e.ny, e.mover);
    else if (type === 'drip') fly(e.x, e.y, e.vx, e.vy);
    else if (type === 'splat') {
      const count = Math.round(T.trail.splatCount * Math.min(3, e.power));
      // inbound speed bounced off the surface, sprayed out over a fan
      const vn = e.vx * e.nx + e.vy * e.ny;
      const bx = (e.vx - 2 * vn * e.nx) * 0.35, by = (e.vy - 2 * vn * e.ny) * 0.35;
      for (let i = 0; i < count; i++) {
        const s = 2 + Math.random() * 5, a = (Math.random() - 0.5) * 2.2;
        const c = Math.cos(a), sn = Math.sin(a);
        const dx = e.nx * c - e.ny * sn, dy = e.nx * sn + e.ny * c;
        fly(e.x + e.nx * 0.1, e.y + e.ny * 0.1, bx + dx * s, by + dy * s);
      }
      stick(e.x, e.y, e.nx, e.ny, e.mover);
    }
  }

  function update(dt) {
    for (const d of drops) {
      if (!d.state) continue;
      d.age += dt;
      if (d.age > T.trail.life) { d.state = null; continue; }
      if (d.state === 'stuck') {
        if (!d.on) continue;
        if (onEdge(d)) { d.x = d.on.x + d.ox; d.y = d.on.y + d.oy; continue; }
        Object.assign(d, { state: 'fly', vx: d.on.vx, vy: d.on.vy, on: null });
      }
      const ox = d.x, oy = d.y;
      d.vy += T.gravity * dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
      if (!world.solidAt(d.x, d.y)) continue;
      const q = world.nearest(ox, oy, 1.5);
      if (!q) { d.state = null; continue; }
      Object.assign(d, { state: 'stuck', x: q.px, y: q.py, nx: q.nx, ny: q.ny, vx: 0, vy: 0 });
      ride(d, q.mover);
    }
  }

  return {
    on, update,
    get drops() { return drops; },
    clear() { drops = []; next = 0; },
  };
}
