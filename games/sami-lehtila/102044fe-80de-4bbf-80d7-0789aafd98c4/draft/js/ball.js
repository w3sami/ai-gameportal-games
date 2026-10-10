// Ball mode: the jump button firms the slime up into a bouncy ball. A press
// stiffens the springs and restores the full circle, which throws a
// flattened slime off the surface it lies on; holding the button keeps the
// ball. Being a ball spends energy (ballDrain per second) and ends when it
// runs out; it starts again only on a fresh press, never by holding through
// a refill. Energy refills at energyRegen while not a ball.

//
// `started` is true for the one update a ball began in; cancel() takes that
// ball back as if the press never happened (main.js does, when the pop would
// be too hard).

export function createBall(T) {
  let on = false, pop = 0, energy = T.energyMax, was = false;
  let started = false, before = 0;

  function update(dt, held) {
    const press = held && !was;
    was = held;
    energy = Math.min(energy, T.energyMax);
    started = press && energy > 0;
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

  function cancel() {
    if (!started) return;
    on = false; started = false; energy = before;
  }

  return {
    update, cancel,
    get on() { return on; },
    get started() { return started; },
    get energy() { return energy; },
    reset() { on = false; pop = 0; energy = T.energyMax; },
  };
}
