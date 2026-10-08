// Tuning values. config/tune.json holds them; the copy below is what the game
// starts with if that file is missing or lacks a key. The debug panel
// (tuning.js) edits the live object and saves it back to config/tune.json.

export const DEFAULTS = {
  gravity: 13,               // m/s²; above Earth's for snappier hops
  step: 0.55,                // a surface rising more than this in one tick is a wall

  // ground
  tuckDrag: 0.35,            // drag multiplier while tucked (holding forward on the ground)
  tuckFriction: 0.5,         // snow friction multiplier while tucked
  tuckPush: 1.0,             // m/s² a tuck adds by pumping the terrain
  brake: 9,                  // m/s² slowdown while holding back on the ground
  carveKeep: 0.55,           // share of sideways speed a carve turns into forward speed
  chargeTime: 0.35,          // s of crouch for a full-strength jump

  // start and poles
  pushBelow: 5,              // m/s under which the jump button pushes off rather than ollies
  pushSpeed: 9,              // m/s a push-off brings the rider up to
  pushHop: 2.5,              // m/s up in a push-off
  poleBelow: 8,              // m/s under which a tuck pushes with the poles instead
  polePush: 1.6,             // m/s per pole push
  poleEvery: 0.45,           // s between pole pushes
  checkpointSlope: 14,       // degrees; starting where the slope below is gentler puts a ramp this steep under the rider
  checkpointRun: 12,         // m of that ramp's run-in

  // air
  spinResponse: 8,           // how fast spin and flip follow the stick (1/s)
  levelPitch: 1.0,           // radians from upright within which a released stick levels a flip
  levelYaw: 0,               // radians from straight within which a released stick squares a spin; 0 keeps an angled landing angled
  levelRate: 2.5,            // rad/s of that levelling

  // landing and falling
  landPitch: 0.8,            // radians off upright a landing still survives
  headFirst: 2.2,            // radians off upright beyond which a fall is head first
  landYaw: 0.8,              // radians off forward or backward before a landing skids
  sidewaysKeep: 0.55,        // speed kept by a sideways landing
  hardLoss: 0.02,            // speed lost per m/s of impact above 4 m/s (at most 40 %)
  landStunFrom: 9,           // m/s of impact where a hard landing starts to tell: crouch, sticky steering, ring, shake
  landStunTime: 1.2,         // s the sticky steering lasts after the hardest landing short of a slam
  landStunSteer: 0.75,       // share of steering lost at its worst
  slamImpact: 20,            // m/s into the slope beyond which even an upright landing slams in
  slamMound: 1,              // size of the heap a slam throws up
  slamTime: 1.6,             // s stuck in the heap before the fade
  buryTime: 1.8,             // s stuck head first in the snow
  ragdollTime: 1.6,          // s tumbling before standing up
  snowballSpeed: 13,         // m/s above which a tumble rolls up into a snowball
  snowballMax: 2.4,          // m radius the snowball grows to at most
  snowballGrow: 1.6,         // m/s the snowball's radius grows
  snowballTime: 1.8,         // s from the fall to standing up again; the last 0.6 s fade

  // stars and effects
  starSize: 2.0,             // m across
  starReach: 2.6,            // m from the rider's middle that collects a star
  snowSpray: 2.5,            // snow spray multiplier
  sprayStraight: 0.1,        // share of the spray running straight; fully sideways is all of it
  trailFrom: 10,             // m/s where the ski / board trail starts to show
  trailFull: 26,             // m/s where it is at full strength

  // bouncers and rails
  bouncePower: 10,           // m/s up from a tree top
  balloonPower: 12,
  awningPower: 13,
  awningKeep: 0.45,          // downhill speed kept off an awning
  railFriction: 1.2,         // m/s² along a rail

  camera: { dist: 10, height: 7, lookAhead: 7, fov: 55, turn: 0.35, pullBack: 0.45, rise: 0.2 },  // pullBack, rise: extra per metre the rider is above ground
  skis: { maxSpeed: 32, drag: 0.0042, friction: 0.03, turnRate: 2.0, grip: 7, spinRate: 9, flipRate: 8, hover: 0, jump: 5.4 },
  board: { maxSpeed: 28, drag: 0.0055, friction: 0.04, turnRate: 2.4, grip: 6, spinRate: 13, flipRate: 8, hover: 0.55, jump: 5.8 },
  scoreDrain: 40,            // points lost per second from the first push to the finish
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
