// The slime: a ring of nodes, each trying to keep `radius` from the ring's
// centre, held together by neighbour springs and an area pressure. Solved as
// extended position-based dynamics (XPBD): move the nodes, pull the springs
// right for a few passes, then read velocity back off the motion.
//
// Surfaces act on each node by its nearest surface point (world.nearest):
//   - magnetism pulls the node towards it, fading out at magnetRange
//   - cling pulls the whole body into the surface it holds, so a wall or a
//     ceiling flattens it the way gravity flattens it on a floor (cling())
//   - grip steers the node's speed along the surface towards the crawl
//     target, which always leans `slide` downhill (on a wall, straight
//     down). How hard it can steer is friction × load, where load is the
//     magnet's pull plus, while touching, the share of gravity and cling
//     pressing into the surface. So a non-magnetic wall gives no grip and
//     the slime slides off it. Grip reaches as far as the magnet does:
//     nodes about to touch already move with the surface, which keeps the
//     body from rolling down a wall around the few nodes that touch it.
//   - all of the magnetism tires while the stick is left alone (suction)
//
// In ball mode (step's asBall, from ball.js) the springs firm up by
// ballStiff, the area goes back to ballPressure (a full circle at 1), the
// magnetism drops to ballMagnet, and the body bounces off a surface with
// ballBounce of the speed it landed with (bounce()). The energy left scales
// that bounce (bounceEnergy is how much of it depends on energy / energyMax),
// and the bounce spends energy for what it adds. step's `energy` is ball.js's
// { share, spend }; without one, energy is free.
//
// The ring does not turn (spinLock): left alone, grip at the touching nodes
// rolls it like a tread, and a ball that is still spinning when it pops or
// lands turns that spin into a sideways throw. unspin() takes the turning
// out of the nodes' speeds and turns the ring back to its rest orientation,
// node i at angle i / N of a full turn.
//
// The stick is { x, y } in screen directions (y down), length at most 1.
// Events go out through `on`: splat, trail, drip (see trail.js).

const TAU = Math.PI * 2;
const CONTACT = 0.04;   // gap below which a node counts as touching
const BOUNCE_FROM = 1.5;   // landing speed below which a ball just rolls
const POP_LOOK = 0.1;      // s of ball mode popSpeed() runs ahead
const FREE = { share: 1, spend: (amount) => amount };   // energy without limit or cost

export function createSlime(T, world, emit) {
  let nodes = [];
  let on = emit;   // silenced while popSpeed() looks ahead
  // Suction, 0–1, multiplies all magnetism. It tires when the stick is left
  // alone off a floor: full for tireAfter seconds, then gone over tireTime,
  // so a slime that stops on a wall or a ceiling falls off. Any stick, or
  // standing on a floor, brings it back over suctionRecover. tireTime 0
  // never tires.
  let suction = 1, idle = 0;

  function breathe(dt, stick) {
    if (T.tireTime <= 0) { suction = 1; idle = 0; return; }
    // standing on a floor is rest: gravity holds the slime there, and a tired
    // magnet would only leave it rounder and its jump weaker
    const floor = nodes.some((n) => n.touch && n.q.ny < -0.7);
    if (floor || Math.hypot(stick.x, stick.y) > 0.2) {
      idle = 0;
      suction = Math.min(1, suction + dt / Math.max(0.01, T.suctionRecover));
    } else {
      idle += dt;
      if (idle > T.tireAfter) suction = Math.max(0, suction - dt / T.tireTime);
    }
  }

  function build(x, y) {
    const N = Math.max(3, Math.round(T.nodes)), R = T.radius;
    nodes = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const nx = x + Math.cos(a) * R, ny = y + Math.sin(a) * R;
      nodes.push({ x: nx, y: ny, px: nx, py: ny, vx: 0, vy: 0, inx: 0, iny: 0, q: null, touch: false, crawled: 0 });
    }
  }

  function centre() {
    let x = 0, y = 0;
    for (const n of nodes) { x += n.x; y += n.y; }
    return { x: x / nodes.length, y: y / nodes.length };
  }

  function velocity() {
    let x = 0, y = 0;
    for (const n of nodes) { x += n.vx; y += n.vy; }
    return { x: x / nodes.length, y: y / nodes.length };
  }

  function area() {
    let a = 0;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i], q = nodes[(i + 1) % nodes.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }

  // XPBD: each constraint is a spring of stiffness k (1/s², per unit mass),
  // as compliance 1/k scaled by the substep. Its multiplier λ accumulates
  // over the iterations of one substep, so more iterations converge on the
  // same spring rather than a stiffer one. Arrays: [edges…, radials…, area].
  let lambda = [];
  // spinLock of the ring's spin and of its turn away from rest, taken out
  function unspin() {
    const k = Math.max(0, Math.min(1, T.spinLock));
    if (!k) return;
    const N = nodes.length, c = centre(), v = velocity();
    let w = 0, r2 = 0, cross = 0, dot = 0;
    for (let i = 0; i < N; i++) {
      const n = nodes[i], rx = n.x - c.x, ry = n.y - c.y;
      w += rx * (n.vy - v.y) - ry * (n.vx - v.x);
      r2 += rx * rx + ry * ry;
      // best-fit turn from the rest ring (2D shape matching)
      const a = (i / N) * TAU, qx = Math.cos(a), qy = Math.sin(a);
      cross += qx * ry - qy * rx;
      dot += qx * rx + qy * ry;
    }
    if (r2 < 1e-9) return;
    w = (w / r2) * k;
    const t = -Math.atan2(cross, dot) * k, cos = Math.cos(t), sin = Math.sin(t);
    for (const n of nodes) {
      const rx = n.x - c.x, ry = n.y - c.y;
      n.vx += w * ry; n.vy -= w * rx;
      const x = c.x + rx * cos - ry * sin, y = c.y + rx * sin + ry * cos;
      n.px += x - n.x; n.py += y - n.y;   // a turn of the frame, not a motion
      n.x = x; n.y = y;
    }
  }

  // ball mode (ball.js): springs × ballStiff, area at ballPressure, magnetism × ballMagnet
  let ball = false, firm = 1;
  // where ball mode's energy comes from: { share, spend(amount) → got } (ball.js)
  let wallet = FREE;
  // the bounce's multiplier from the energy left
  let power = 1;
  // A ball's bounce is the whole body's: on landing, the speed it came in
  // with is kept, and once the body has squashed to a stop against the
  // surface it leaves again at ballBounce of that speed (restitution: the
  // height comes back as its square).
  let impact = null;

  function bounce(touched, inx, iny) {
    let nx = 0, ny = 0, vx = 0, vy = 0, count = 0;
    for (const n of nodes) {
      vx += n.vx; vy += n.vy;
      if (n.touch) { nx += n.q.nx; ny += n.q.ny; count++; }
    }
    if (!ball || !count) { impact = null; return; }
    const l = Math.hypot(nx, ny);
    if (l < 1e-6) return;
    nx /= l; ny /= l; vx /= nodes.length; vy /= nodes.length;
    const came = -(inx * nx + iny * ny);
    if (!touched && came > BOUNCE_FROM) impact = { nx, ny, speed: came };
    if (!impact) return;
    const out = vx * impact.nx + vy * impact.ny;
    if (out < 0) return;   // still squashing
    let add = Math.max(0, T.ballBounce * power * impact.speed - out);
    // the bounce is paid for: bounceCost per unit of speed it adds, and
    // what the energy left cannot pay for is not added
    if (T.bounceCost > 0) add = wallet.spend(add * T.bounceCost) / T.bounceCost;
    for (const n of nodes) { n.vx += impact.nx * add; n.vy += impact.ny * add; }
    impact = null;
  }

  function xpbd(i, C, wsum, k, h) {
    if (k <= 0 || wsum < 1e-12) return 0;
    const a = 1 / (k * h * h);
    const dl = (-C - a * lambda[i]) / (wsum + a);
    lambda[i] += dl;
    return dl;
  }

  function solve(h) {
    const N = nodes.length, R = T.radius;
    // neighbours keep their spacing
    const edge = 2 * R * Math.sin(Math.PI / N);
    for (let i = 0; i < N; i++) {
      const a = nodes[i], b = nodes[(i + 1) % N];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6;
      const dl = xpbd(i, d - edge, 2, T.edgeStiff * firm, h);
      a.x -= (dx / d) * dl; a.y -= (dy / d) * dl;
      b.x += (dx / d) * dl; b.y += (dy / d) * dl;
    }
    // each node towards its rest distance from the centre
    const c = centre();
    for (let i = 0; i < N; i++) {
      const n = nodes[i];
      const dx = n.x - c.x, dy = n.y - c.y, d = Math.hypot(dx, dy) || 1e-6;
      const dl = xpbd(N + i, d - R, 1, T.radialStiff * firm, h);
      n.x += (dx / d) * dl; n.y += (dy / d) * dl;
    }
    // pressure: move every node along the area's gradient
    const rest = (ball ? T.ballPressure : T.pressure) * (N / 2) * R * R * Math.sin(TAU / N);
    const g = [];
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const prev = nodes[(i + N - 1) % N], next = nodes[(i + 1) % N];
      const gx = (next.y - prev.y) / 2, gy = (prev.x - next.x) / 2;
      g.push(gx, gy);
      sum += gx * gx + gy * gy;
    }
    const dl = xpbd(2 * N, area() - rest, sum, T.areaStiff * firm, h);
    for (let i = 0; i < N; i++) { nodes[i].x += g[2 * i] * dl; nodes[i].y += g[2 * i + 1] * dl; }
    // out of the walls
    for (const n of nodes) world.collide(n, T.nodeRadius);
  }

  // A node's own magnetism, as a share of T.magnet: the tile's multiplier,
  // fading out over magnetRange, let go while the stick points away, and
  // times the suction left.
  function hold(q, stick) {
    const gap = Math.max(0, q.d - T.nodeRadius);
    if (gap >= T.magnetRange) return 0;
    const away = Math.max(0, (stick.x * q.nx + stick.y * q.ny - 0.3) / 0.7);
    return (ball ? T.ballMagnet : 1) * suction * T.tiles[q.type].magnet
      * (1 - gap / T.magnetRange) * (1 - T.letGo * away);
  }

  // Cling: the whole body is pulled into the surface it holds on to, so that
  // it presses against a wall or a ceiling with T.cling, the way gravity
  // presses it onto a floor, and spreads out on it the same way. The pull
  // points along the held nodes' normals, weighted by how hard each holds;
  // it is full once three nodes hold, and the tiles' magnet multiplier
  // scales it. Gravity's own share into the surface counts towards it.
  function cling(stick) {
    let sx = 0, sy = 0, sum = 0, count = 0;
    for (const n of nodes) {
      if (!n.q) continue;
      const w = hold(n.q, stick);
      if (w <= 0) continue;
      sx -= n.q.nx * w; sy -= n.q.ny * w; sum += w; count++;
    }
    const l = Math.hypot(sx, sy);
    if (!count || l < 0.3 * sum) return { x: 0, y: 0 };   // held from opposite sides: no one way in
    const dx = sx / l, dy = sy / l;
    const want = T.cling * (sum / count) * Math.min(1, count / 3);
    const extra = Math.max(0, want - T.gravity * dy);
    return { x: dx * extra, y: dy * extra };
  }

  function step(dt, stick, asBall = false, energy = FREE) {
    ball = asBall;
    wallet = energy;
    power = 1 - T.bounceEnergy * (1 - Math.max(0, Math.min(1, wallet.share)));
    firm = ball ? T.ballStiff : 1;
    if (nodes.length !== Math.max(3, Math.round(T.nodes))) { const c = centre(); build(c.x, c.y); }
    breathe(dt, stick);
    const subs = Math.max(1, Math.round(T.substeps)), h = dt / subs;
    const r = T.nodeRadius, reach = T.magnetRange;
    for (let s = 0; s < subs; s++) {
      unspin();
      const grounded = nodes.some((n) => n.touch);
      // damping works on the nodes' motion relative to the body only, so it
      // calms the wobble without slowing a jump or a fall
      const keep = Math.exp(-T.damping * h);
      const body = velocity();
      const pull = cling(stick);
      const fx = pull.x, fy = T.gravity + pull.y;   // what presses the whole body

      for (const n of nodes) {
        let ax = fx, ay = fy;
        n.load = 0;
        const q = n.q;
        if (q) {
          const m = T.magnet * hold(q, stick);
          ax -= q.nx * m; ay -= q.ny * m;
          n.load = (n.touch ? Math.max(0, -(fx * q.nx + fy * q.ny)) : 0) + m;
        }
        if (!grounded) { ax += stick.x * T.airControl; ay += stick.y * T.airControl; }
        n.vx = body.x + (n.vx - body.x) * keep + ax * h;
        n.vy = body.y + (n.vy - body.y) * keep + ay * h;
        n.inx = n.vx; n.iny = n.vy;
        n.px = n.x; n.py = n.y;
        n.x += n.vx * h; n.y += n.vy * h;
      }

      let inx = 0, iny = 0;
      for (const n of nodes) { inx += n.inx / nodes.length; iny += n.iny / nodes.length; }

      lambda = new Array(2 * nodes.length + 1).fill(0);
      for (let i = 0; i < T.iterations; i++) solve(h);

      for (const n of nodes) {
        n.vx = (n.x - n.px) / h;
        n.vy = (n.y - n.py) / h;
        const q = (n.q = world.nearest(n.x, n.y, r + reach));
        const was = n.touch;
        n.touch = !!q && q.d <= r + CONTACT;
        if (!q) continue;

        const nx = q.nx, ny = q.ny;
        if (n.touch) {
          const vn = n.vx * nx + n.vy * ny;
          if (vn < 0) { n.vx -= nx * vn; n.vy -= ny * vn; }
          const hit = -(n.inx * nx + n.iny * ny);
          if (!was && hit > T.trail.splatSpeed) on('splat', { x: q.px, y: q.py, nx, ny, vx: n.inx, vy: n.iny, power: hit / T.trail.splatSpeed });
        }

        // crawl: the stick along the surface; pushed into a wall, up the wall
        const tx = -ny, ty = nx;
        let want = stick.x * tx + stick.y * ty;
        if (Math.abs(nx) > 0.6) {
          const into = Math.max(0, -(stick.x * nx + stick.y * ny));
          want += T.wallClimb * into * (ty < 0 ? 1 : -1);
        }
        // and always a little downhill: slide × the slope's share of gravity
        want = Math.max(-1, Math.min(1, want)) * T.crawlSpeed + T.slide * ty;
        const vt = n.vx * tx + n.vy * ty;
        const most = T.friction * T.tiles[q.type].grip * n.load * h;
        const dv = Math.max(-most, Math.min(most, want - vt));
        n.vx += tx * dv; n.vy += ty * dv;

        if (!n.touch) continue;
        n.crawled += Math.abs(vt) * h;
        if (n.crawled > T.trail.spacing) {
          n.crawled -= T.trail.spacing;
          on('trail', { x: q.px, y: q.py, nx, ny });
        }
        if (ny > 0.7 && Math.random() < T.trail.drip * h) on('drip', { x: q.px, y: q.py + r * 2, vx: n.vx * 0.3, vy: n.vy });
      }
      bounce(grounded, inx, iny);
    }
  }

  // the skin: each node pushed out from the centre by its radius
  function outline() {
    const c = centre();
    return nodes.map((n) => {
      const dx = n.x - c.x, dy = n.y - c.y, d = Math.hypot(dx, dy) || 1;
      return { x: n.x + (dx / d) * T.nodeRadius, y: n.y + (dy / d) * T.nodeRadius };
    });
  }

  build(world.start.x, world.start.y);

  // How hard ball mode would throw the body right now: ball mode's first
  // POP_LOOK seconds are run ahead and undone, next to the same seconds as a
  // slime, and the answer is the largest difference in the body's speed.
  // Gravity, surfaces and the stick act on both runs alike, so what is left
  // is what the firmed-up springs add. A slime pressed flat (say, into a
  // ceiling corner) has a lot stored in them.
  function popSpeed(stick, dt) {
    const frames = Math.max(1, Math.round(POP_LOOK / dt));
    const run = (asBall) => {
      const saved = save();
      const out = [];
      for (let f = 0; f < frames; f++) { step(dt, stick, asBall, FREE); out.push(velocity()); }
      load(saved);
      return out;
    };
    on = () => {};
    const slime = run(false), firmed = run(true);
    on = emit;
    let most = 0;
    for (let f = 0; f < frames; f++) {
      most = Math.max(most, Math.hypot(firmed[f].x - slime[f].x, firmed[f].y - slime[f].y));
    }
    return most;
  }

  function save() {
    return { nodes: structuredClone(nodes), suction, idle, ball, firm, power, wallet, impact: impact && { ...impact } };
  }
  function load(s) {
    ({ nodes, suction, idle, ball, firm, power, wallet, impact } = s);
  }

  return {
    step, outline, centre, velocity, build, popSpeed,
    get nodes() { return nodes; },
    get suction() { return suction; },
    reset() { build(world.start.x, world.start.y); suction = 1; idle = 0; },
  };
}
