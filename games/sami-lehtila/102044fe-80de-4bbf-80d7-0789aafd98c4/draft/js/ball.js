// Ball mode: the jump button firms the slime up into a bouncy ball. Becoming
// a ball stiffens the springs and restores the full circle, which throws a
// flattened slime off the surface it lies on; holding the button keeps the
// ball. It starts again only on a fresh press.
//
// Pressed against a surface, the button charges first: `charge` climbs from
// 0 to 1 over chargeTime, and slime.js tightens the magnet with it
// (chargeMagnet), which presses the slime flatter for a harder pop. A full
// charge holds there; the jump goes only on release, and lasts popTime.
// The charge stops building (stall()) once the pop it would give nears
// popMax. A charged release always jumps: main.js caps a pop that still
// comes out harder (slime.capPop) instead of refusing it, and `charged`
// tells it which kind of press this was.
// Pressed in the air, there is nothing to charge against: the ball begins
// at once, and holding the button keeps it.
//
// `started` is true for the one update a ball began in; cancel() takes that
// ball back as if the press never happened (main.js does, when an uncharged
// pop would be too hard).

export function createBall(T) {
  let on = false, pop = 0, was = false, started = false;
  let charging = false, charge = 0, charged = false;

  function update(dt, held, touching) {
    const press = held && !was;
    was = held;
    started = false;
    if (press) {
      if (touching && T.chargeTime > 0) { charging = true; charge = 0; }
      else { started = true; charged = false; }
    }
    if (charging) {
      charge = Math.min(1, charge + dt / T.chargeTime);
      if (!held) { charging = false; started = true; charged = true; }
    }
    if (started) { on = true; pop = T.popTime; }
    if (on) {
      pop -= dt;
      if (!held && pop <= 0) on = false;   // a tap is still a whole pop
    }
  }

  // keep the charge where it was before this update's growth
  function stall(dt) {
    if (charging) charge = Math.max(0, charge - dt / Math.max(0.01, T.chargeTime));
  }

  function cancel() {
    if (!started) return;
    on = false; started = false; charge = 0;
  }

  return {
    update, stall, cancel,
    get on() { return on; },
    get started() { return started; },
    // 0–1 while charging; once the ball begins it drops back to 0
    get charge() { return charging ? charge : 0; },
    get charging() { return charging; },
    get charged() { return charged; },
    reset() { on = false; pop = 0; charging = false; charge = 0; },
  };
}
