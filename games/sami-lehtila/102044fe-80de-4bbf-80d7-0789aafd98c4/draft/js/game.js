// The level's rules, once per fixed step after the slime has moved:
//
//   - a node touching a panel while it glows red burns the slime's health
//     (0–1) by 1 / burnTime a second, so one node kills in burnTime and
//     more nodes faster. Health comes back over healTime, starting
//     healDelay after the last burn. At none the slime bursts into drops
//     and comes back after respawnTime at the last checkpoint reached, with
//     full health. Opened doors and carried cards stay.
//   - squeezed below crushArea of its full area (slime.squeeze) for longer
//     than crushTime (a door shutting on it, a platform pressing it into a
//     wall), the slime dies the same way
//   - a button opens the doors keyed to it while any node touches it; a
//     button with a `time` shuts them again that long after the last touch
//   - a card is picked up by touching it and opens the first door keyed to
//     it that the slime then touches; that uses the card up
//   - checkpoints and the exit count once the slime's centre is near them
//   - the first time a pad throws a slime rather than a ball, a message
//     says a ball bounces higher
//
// The run's clock starts with the level and stops at the exit. restart()
// puts the whole level back as it began.

const NEAR = 2;   // tiles from the centre for a checkpoint or the exit to count

export function createGame(T, world, slime, ball, trail) {
  let checkpoint = world.start;
  let dead = 0;             // s until the slime comes back, while dead
  let finished = false, time = 0;
  let message = null;       // { text, until } in run time
  let health = 1, cool = 0; // cool: s since the last burn
  let crushed = 0;          // s squeezed past crushArea
  let burns = [];           // surface points burning right now, for the smoke
  const taken = new Set();  // cards picked up (as objects in world.cards)
  const carried = [];       // those not used yet
  const reached = new Set();
  const pressed = new Map();   // button → run time it was last touched
  let padHint = false;

  // how far into dying, 0–1; 0 while alive
  const dying = () => (dead > 0 ? 1 - dead / Math.max(0.01, T.respawnTime) : 0);

  function say(text, seconds = 2) { message = { text, until: time + seconds }; }

  // the body throws drops out from its centre and goes limp (slime.limp);
  // render.js shrinks it away over the end of respawnTime
  function die() {
    const c = slime.centre();
    for (const n of slime.nodes) {
      for (let i = 0; i < 2; i++) {
        const s = 4 + Math.random() * 8;
        const dx = n.x - c.x + (Math.random() - 0.5), dy = n.y - c.y + (Math.random() - 0.5), l = Math.hypot(dx, dy) || 1;
        trail.on('drip', { x: n.x, y: n.y, vx: n.vx * 0.3 + (dx / l) * s, vy: n.vy * 0.3 + (dy / l) * s - 4 });
      }
    }
    dead = T.respawnTime;
  }

  function respawn() {
    slime.place(checkpoint.x, checkpoint.y);
    ball.reset();
    health = 1; burns = []; crushed = 0;
  }

  function restart() {
    for (const d of world.doors) { d.from = d.to = 0; d.since = -1e9; }
    world.setTime(world.time);
    taken.clear(); carried.length = 0; reached.clear(); pressed.clear();
    checkpoint = world.start; dead = 0; finished = false; time = 0; message = null;
    trail.clear();
    respawn();
  }

  // whether any node is within `reach` of the segment a–b
  function touches(ax, ay, bx, by, reach) {
    const lx = bx - ax, ly = by - ay, l2 = lx * lx + ly * ly || 1e-9;
    return slime.nodes.some((n) => {
      const k = Math.max(0, Math.min(1, ((n.x - ax) * lx + (n.y - ay) * ly) / l2));
      return Math.hypot(n.x - ax - lx * k, n.y - ay - ly * k) < reach;
    });
  }

  function update(dt) {
    if (!finished) time += dt;
    if (dead > 0) {
      dead -= dt;
      slime.limp = Math.min(1, dying() * 5);
      if (dead <= 0) { dead = 0; respawn(); }
      return;
    }
    const c = slime.centre(), r = T.nodeRadius;

    // panels
    burns = slime.nodes.filter((n) => n.touch && n.q.type === 'panel' && world.panel(n.q.meta) === 'on')
      .map((n) => ({ x: n.q.px, y: n.q.py, nx: n.q.nx, ny: n.q.ny }));
    if (burns.length) {
      health -= (burns.length * dt) / Math.max(0.01, T.burnTime);
      cool = 0;
      if (health <= 0) { health = 0; burns = []; die(); return; }
    } else {
      cool += dt;
      if (cool > T.healDelay) health = Math.min(1, health + dt / Math.max(0.01, T.healTime));
    }

    crushed = slime.squeeze < T.crushArea ? crushed + dt : 0;
    if (crushed > T.crushTime) { die(); return; }

    // buttons: a plate a tile wide on its surface
    for (const b of world.buttons) {
      const tx = -b.ny * 0.45, ty = b.nx * 0.45;
      if (touches(b.x - tx, b.y - ty, b.x + tx, b.y + ty, r + 0.3)) {
        if (!pressed.has(b)) for (const d of world.doors) if (d.e.key === b.char) world.setDoor(d, 1);
        pressed.set(b, time);
      }
    }
    // timed buttons shut their doors again
    for (const d of world.doors) {
      const b = world.buttons.find((x) => x.char === d.e.key);
      if (!b || !b.e.time || !world.isOpen(d)) continue;
      if (time - (pressed.get(b) ?? -1e9) > b.e.time) { world.setDoor(d, 0); pressed.delete(b); }
    }

    // cards
    for (const k of world.cards) {
      if (taken.has(k) || Math.hypot(c.x - k.x, c.y - k.y) > T.radius + 0.6) continue;
      taken.add(k); carried.push(k);
      say('Kortti mukana');
    }
    for (const d of world.doors) {
      if (world.isOpen(d) || world.buttons.some((b) => b.char === d.e.key)) continue;
      if (!slime.nodes.some((n) => n.touch && n.q.mover === d)) continue;
      const i = carried.findIndex((k) => k.char === d.e.key);
      if (i >= 0) { carried.splice(i, 1); world.setDoor(d, 1); }
      else if (!message || message.until < time) say('Ovi tarvitsee kortin');
    }

    // checkpoints and the exit
    for (const p of world.checkpoints) {
      if (reached.has(p) || Math.hypot(c.x - p.x, c.y - p.y) > NEAR + T.radius) continue;
      reached.add(p); checkpoint = p;
      say('Tarkistuspiste', 1.2);
    }
    if (!finished && world.exits.some((p) => Math.hypot(c.x - p.x, c.y - p.y) < NEAR + T.radius)) {
      finished = true;
      say('Maali!', 1e9);
    }
  }

  // a pad threw the body (slime.js's 'pad' event)
  function pad(e) {
    if (e.ball || padHint || dead) return;
    padHint = true;
    say('Pallona alusta heittää kovempaa', 2.5);
  }

  return {
    update, restart, pad, say,
    // back to the last checkpoint, the same way as dying
    toCheckpoint() { if (!dead && !finished) die(); },
    get dead() { return dead > 0; },
    get dying() { return dying(); },
    get finished() { return finished; },
    get time() { return time; },
    get health() { return health; },
    get burns() { return burns; },
    get carried() { return carried; },
    get checkpoint() { return checkpoint; },
    isReached: (p) => reached.has(p),
    isTaken: (k) => taken.has(k),
    isPressed: (b) => pressed.has(b),
    get message() { return message && message.until > time ? message.text : ''; },
  };
}
