// Tuning values. config/tune.json holds them; the copy below is what the game
// starts with if that file is missing or lacks a key. The debug panel
// (tuning.js) edits the live object and saves it back to config/tune.json.
//
// Lengths are in tiles (the level grid is one unit per tile), times in
// seconds, accelerations in tiles/s².

export const DEFAULTS = {
  color: '#6fdc4b',          // the slime and its trail

  // body: a ring of nodes around a centre, each trying to stay `radius` from it
  nodes: 10,                 // nodes on the ring
  radius: 1.0,               // rest distance from the centre to a node
  nodeRadius: 0.2,           // collision radius of a node, i.e. the skin's thickness
  radialStiff: 300,          // 1/s²: spring pulling each node back to its rest distance from the centre
  edgeStiff: 800,            // 1/s²: spring keeping neighbouring nodes at their spacing
  areaStiff: 200,            // 1/s²: spring holding the area at `pressure`
  pressure: 0.85,            // area aimed for, as a share of the full circle; below 1 the body can sag and flatten
  spinLock: 1,               // 0–1: share of the ring's spin and turn taken out every substep; 1 never turns
  damping: 1.5,              // 1/s of the nodes' speed relative to the body lost; the body's own flight is not slowed

  // movement
  gravity: 30,
  crawlSpeed: 7,             // speed along a surface the touching nodes aim for
  airControl: 10,            // push from the stick while nothing touches
  wallClimb: 1,              // 0–1: pushing into a wall turns into climbing up it
  letGo: 1,                  // 0–1: share of magnetism dropped while the stick points away from the surface
  slide: 0.8,                // speed the slime slides down a wall even while holding on or climbing

  // suction: all magnetism tires while the stick is left alone
  tireAfter: 1,              // s of no stick at full suction
  tireTime: 2,               // s from full suction to none after that; 0 never tires
  suctionRecover: 0.25,      // s from none back to full once the stick moves

  // ball mode (ball.js): the jump button firms the slime into a ball
  ballStiff: 15,             // × all three springs while a ball
  ballPressure: 1,           // area aimed for while a ball, as a share of the full circle
  ballMagnet: 0,             // × magnetism while a ball; 0 lets go of everything
  ballBounce: 0.7,           // share of its landing speed a ball leaves with at full energy; the bounce height is its square
  bounceEnergy: 1,           // 0–1: how much of the bounce scales with the energy left; 1 = in proportion, 0 = not at all
  chargeTime: 0.5,           // s pressed against a surface to charge a jump fully; the charge then holds, and the jump goes at release
  chargeMagnet: 6,           // × magnetism at full charge, pressing the slime flatter for a harder pop
  popTime: 0.15,             // s a tap stays a ball, so a tap is a whole pop
  popMax: 26,                // speed the springs may throw the body with; a harder pop does not happen at all
  energyMax: 100,
  energyRegen: 20,           // energy per second back while not a ball
  jumpCost: 2.4,             // energy per tiles/s a jump throws the body with (from rest on a floor about 11.5); with less, no jump
  bounceCost: 1,             // energy per tiles/s a bounce adds
  ballDrain: 5,              // energy per second spent just being a ball

  // surfaces; each tile type below multiplies these
  magnet: 150,               // pull on each node towards its surface at touch, fading to nothing at magnetRange
  cling: 30,                 // how hard the whole body presses into a wall or ceiling it holds; gravity on a floor is the same thing
  magnetRange: 0.6,          // reach of the pull beyond the skin
  friction: 3,               // grip = friction × the load pressing a node to the surface (gravity's share + magnet)

  tiles: {
    stone: { grip: 1, magnet: 1 },
    wood: { grip: 1, magnet: 0 },
    ice: { grip: 0.03, magnet: 0.5 },
    metal: { grip: 0.8, magnet: 2 },
  },

  // trail: drops that stick where they land, recycled from a fixed pool
  trail: {
    pool: 200,               // drops in all; the oldest one is reused
    spacing: 0.7,            // distance a touching node crawls per drop it leaves
    size: 0.13,              // drop radius
    life: 25,                // s a drop stays; it fades over the last third
    splatSpeed: 9,           // speed into a surface that throws drops
    splatCount: 5,           // drops per splatting node at that speed
    drip: 0.25,              // drops per second per node hanging from a ceiling
  },

  // simulation
  substeps: 10,              // per 1/60 s
  iterations: 2,             // constraint passes per substep
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
