// The level's rules, once per fixed step after the slime has moved:
//
//   - a node touching a panel while it glows red kills the slime: it bursts
//     into drops and comes back after respawnTime at the last checkpoint
//     reached, with full energy. Opened doors and carried cards stay.
//   - a button opens the doors keyed to it while any node touches it; a
//     button with a `time` shuts them again that long after the last touch
//   - a card is picked up by touching it and opens the first door keyed to
//     it that the slime then touches; that uses the card up
//   - checkpoints and the exit count once the slime's centre is near them
//
// The run's clock starts with the level and stops at the exit. restart()
// puts the whole level back as it began.

const NEAR = 2;   // tiles from the centre for a checkpoint or the exit to count

export function createGame(T, world, slime, ball, trail) {
  let checkpoint = world.start;
  let dead = 0;             // s until the slime comes back, while dead
  let finished = false, time = 0;
  let message = null;       // { text, until } in run time
  const taken = new Set();  // cards picked up (as objects in world.cards)
  const carried = [];       // those not used yet
  const reached = new Set();
  const pressed = new Map();   // button → run time it was last touched

  function say(text, seconds = 2) { message = { text, until: time + seconds }; }

  // the body bursts into flying drops, thrown out from its centre
  function die() {
    const c = slime.centre();
    for (const n of slime.nodes) {
      for (let i = 0; i < 3; i++) {
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
      if (dead <= 0) { dead = 0; respawn(); }
      return;
    }
    const c = slime.centre(), r = T.nodeRadius;

    // panels
    if (slime.nodes.some((n) => n.touch && n.q.type === 'panel' && world.panel(n.q.meta) === 'on')) { die(); return; }

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

  return {
    update, restart,
    // back to the last checkpoint, the same way as dying
    toCheckpoint() { if (!dead && !finished) die(); },
    get dead() { return dead > 0; },
    get finished() { return finished; },
    get time() { return time; },
    get carried() { return carried; },
    get checkpoint() { return checkpoint; },
    isReached: (p) => reached.has(p),
    isTaken: (k) => taken.has(k),
    isPressed: (b) => pressed.has(b),
    get message() { return message && message.until > time ? message.text : ''; },
  };
}
