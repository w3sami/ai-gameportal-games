// Ball mode: the jump button firms the slime up into a bouncy ball. Becoming
// a ball stiffens the springs and restores the full circle, which throws a
// flattened slime off the surface it lies on; holding the button keeps the
// ball. It starts again only on a fresh press, never by holding through a
// refill.
//
// Pressed against a surface, the button charges first: `charge` climbs from
// 0 to 1 over chargeTime, and slime.js tightens the magnet with it
// (chargeMagnet), which presses the slime flatter for a harder pop. A full
// charge holds there; the jump goes only on release, and lasts popTime.
// The charge stops building (stall()) once the pop it would give nears
// popMax or what the energy pays for. A charged release always jumps: main.js
// caps a pop that still comes out harder (slime.capPop) instead of refusing
// it, and `charged` tells it which kind of press this was.
// Pressed in the air, there is nothing to charge against: the ball begins
// at once, and holding the button keeps it.
//
// Energy is spent three ways:
//   - a jump costs jumpCost × the speed it throws the body with (main.js
//     measures it and pays with pay()); with too little energy, no jump
//   - a bounce costs what it adds, through spend() from slime.js
//   - being a ball costs ballDrain per second, and ends when energy runs out
// Energy refills at energyRegen while not a ball.
//
// `started` is true for the one update a ball began in; cancel() takes that
// ball back as if the press never happened (main.js does, when the pop would
// be too hard).

export function createBall(T) {
  let on = false, pop = 0, energy = T.energyMax, was = false;
  let started = false, before = 0;
  let charging = false, charge = 0, charged = false;

  function update(dt, held, touching) {
    const press = held && !was;
    was = held;
    energy = Math.min(energy, T.energyMax);
    started = false;
    if (press && energy > 0) {
      if (touching && T.chargeTime > 0) { charging = true; charge = 0; }
      else { started = true; charged = false; }
    }
    if (charging) {
      charge = Math.min(1, charge + dt / T.chargeTime);
      if (!held) { charging = false; started = true; charged = true; }
    }
    if (started) { on = true; pop = T.popTime; before = energy; }
    if (on) {
      energy -= T.ballDrain * dt;
      pop -= dt;
      if (energy <= 0) { energy = 0; on = false; }
      else if (!held && pop <= 0) on = false;   // a tap is still a whole pop
    } else {
      energy = Math.min(T.energyMax, energy + T.energyRegen * dt);
    }
  }

  // keep the charge where it was before this update's growth
  function stall(dt) {
    if (charging) charge = Math.max(0, charge - dt / Math.max(0.01, T.chargeTime));
  }

  function cancel() {
    if (!started) return;
    on = false; started = false; energy = before; charge = 0;
  }

  // take all of `amount` or nothing; returns whether it was taken
  function pay(amount) {
    if (amount > energy) return false;
    energy -= amount;
    return true;
  }

  // take up to `amount`; returns what there was
  function spend(amount) {
    const got = Math.max(0, Math.min(amount, energy));
    energy -= got;
    return got;
  }

  return {
    update, stall, cancel, pay, spend,
    get share() { return energy / T.energyMax; },
    get on() { return on; },
    get started() { return started; },
    // 0–1 while charging; once the ball begins it drops back to 0
    get charge() { return charging ? charge : 0; },
    get charging() { return charging; },
    get charged() { return charged; },
    get energy() { return energy; },
    reset() { on = false; pop = 0; energy = T.energyMax; charging = false; charge = 0; },
  };
}
