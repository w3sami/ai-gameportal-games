// Tuning values. config/tune.json holds them; the copy below is what the game
// starts with if that file is missing or lacks a key.

const DEFAULTS = {
  gravity: 13,               // m/s²; above Earth's for snappier hops
  step: 0.55,                // a surface rising more than this in one tick is a wall
  tuckDrag: 0.5,             // drag multiplier while holding forward on the ground
  brake: 9,                  // m/s² slowdown while holding back on the ground
  landPitch: 0.8,            // radians off upright a landing still survives
  landYaw: 0.8,              // radians off forward (or backward) a landing survives
  hardLanding: 28,           // m/s into the slope that is a crash however straight
  bouncePower: 10,           // m/s up from a tree top
  balloonPower: 12,
  awningPower: 13,
  railFriction: 1.2,         // m/s² along a rail
  camera: { dist: 10, height: 7, lookAhead: 7, fov: 55, turn: 0.35 },
  skis: { maxSpeed: 32, drag: 0.0042, friction: 0.03, turnRate: 2.0, grip: 7, spinRate: 9, flipRate: 8, hover: 0, jump: 5.4 },
  board: { maxSpeed: 28, drag: 0.0055, friction: 0.04, turnRate: 2.4, grip: 6, spinRate: 13, flipRate: 8, hover: 0.55, jump: 5.8 },
  points: { flip: 500, spin180: 120, airSecond: 100, bounce: 250, grindSecond: 400, star: 1000, break: 100 },
};

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' ? merge(out[k], v) : v;
  }
  return out;
}

export async function loadTune() {
  try {
    const r = await fetch('config/tune.json', { cache: 'no-store' });
    if (r.ok) return merge(DEFAULTS, await r.json());
  } catch {}
  return structuredClone(DEFAULTS);
}
