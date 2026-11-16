// Camera work in the manner of a music video: a list of moving shots, cut
// from one to the next on the beat as if several cameras were filming.
//
// A shot is [kind, length in beats, settings]. The list loops. Lengths are
// even and the list adds up to whole bars, so every cut lands on a beat and
// the loop starts on a bar. Angles are radians of orbit round the car: 0 is
// the resting view of the nose and the near side. A kind returns
// { orbit, tilt, zoom, roll, dx, dy, dist } for u = 0..1 through the shot (b is
// the same in beats); tilt is added to the resting tilt, dx and dy pan in
// metres, dist is how far the camera stands from the car. The picture has
// perspective, so a dolly, which moves the camera, looks different from a zoom.

const lerp = (a, b, u) => a + (b - a) * u;
const inOut = (u) => u * u * (3 - 2 * u);          // starts and stops gently
const out = (u) => 1 - (1 - u) ** 3;               // arrives fast, settles
const into = (u) => u * u * u;                     // gathers speed

const KINDS = {
  // a drive round the car at eye level
  arc: (u, s) => ({ orbit: lerp(s.from, s.to, inOut(u)) }),
  // a fast swing of the camera that brakes at the end
  whip: (u, s) => ({ orbit: lerp(s.from, s.to, out(u)), zoom: 1.1, tilt: -0.08 }),
  // rocking from side to side once per two beats
  swing: (u, s, b) => ({ orbit: s.at + 0.45 * Math.sin(Math.PI * b), zoom: 1.15, tilt: -0.1 }),
  // Dollies: the camera rides a straight rail.
  // Past the car, turning to keep it in frame. d is how near the rail runs, len half its length.
  dolly: (u, s) => {
    const x = lerp(-s.len, s.len, u) * s.dir;
    return { orbit: s.at + Math.atan2(x, s.d), dist: Math.hypot(x, s.d), tilt: -0.14, dy: 0.25 };
  },
  // Straight in towards the car
  push: (u, s) => ({ orbit: s.at, dist: lerp(17, 7, inOut(u)), tilt: -0.08, dy: 0.35 * inOut(u) }),
  // the same, rushed: slow at first and then all at once
  crash: (u, s) => ({ orbit: s.at, dist: lerp(16, 6.5, into(u)), tilt: -0.1, dy: 0.45 * into(u) }),
  // and straight out again
  pull: (u, s) => ({ orbit: s.at, dist: lerp(6.5, 17, out(u)), dy: 0.4 * (1 - out(u)) }),
  // from near the floor, looking up the legs
  low: (u, s) => ({ orbit: lerp(s.from, s.to, u), tilt: -0.22, zoom: 1.25, dy: 0.2 }),
  // along the side of the car without turning, close enough for the wheels to slide past the body
  side: (u, s) => ({ orbit: s.at, tilt: -0.15, dist: 7, dx: lerp(-2.4, 2.4, u) * s.dir, dy: 0.2 }),
  // a crane coming down from above
  crane: (u, s) => ({ orbit: lerp(s.from, s.to, u), tilt: lerp(0.8, 0, inOut(u)), zoom: lerp(0.8, 1.2, inOut(u)) }),
  // and going up
  rise: (u, s) => ({ orbit: s.at + 0.6 * u, tilt: lerp(-0.22, 0.7, inOut(u)), zoom: lerp(1.35, 0.9, inOut(u)) }),
  // straight down, turning
  top: (u, s) => ({ orbit: lerp(s.from, s.to, u), tilt: 1.0, zoom: lerp(0.85, 1.1, u) }),
  // a tilted horizon, still tipping
  dutch: (u, s) => ({ orbit: s.at + 0.5 * u * Math.sign(s.roll), roll: s.roll * lerp(0.5, 1.2, u), zoom: 1.2, tilt: -0.1 }),
  // close on the body
  close: (u, s) => ({ orbit: s.at + 0.4 * u, zoom: 1.6, tilt: -0.12, dy: 0.5 }),
};

const SHOTS = [
  ['arc', 4, { from: 0, to: 1.6 }],
  ['crash', 2, { at: 1.8 }],
  ['whip', 2, { from: 3.4, to: 1.0 }],
  ['swing', 4, { at: -0.4 }],
  ['dolly', 4, { at: 0.55, d: 7.5, len: 9, dir: 1 }],
  ['side', 2, { at: 0.55, dir: 1 }],
  ['side', 2, { at: 3.69, dir: -1 }],
  ['crane', 4, { from: 3.6, to: 5.2 }],
  ['dutch', 2, { at: 1.2, roll: 0.2 }],
  ['dutch', 2, { at: -1.0, roll: -0.2 }],
  ['close', 2, { at: 0.2 }],
  ['close', 2, { at: 2.9 }],
  ['push', 4, { at: -0.3 }],
  ['top', 4, { from: 0, to: 3.1 }],
  ['whip', 2, { from: 0, to: -2.4 }],
  ['crash', 2, { at: 3.14 }],
  ['pull', 4, { at: 3.14 }],
  ['dolly', 4, { at: 3.69, d: 7, len: 9, dir: -1 }],
  ['low', 4, { from: 2.2, to: 3.4 }],
  ['close', 2, { at: 4.4 }],
  ['whip', 2, { from: 1.5, to: 4.2 }],
  ['rise', 4, { at: 0.9 }],
];
const TOTAL = SHOTS.reduce((sum, shot) => sum + shot[1], 0);
const FIRST_BAR = 4;      // the song's bars start four beats in

const REF_DIST = 12;      // the distance at which a zoom of 1 frames the stage; the same value as in draw.js
export const REST = { orbit: 0, tilt: 0, zoom: 1, roll: 0, dx: 0, dy: 0, dist: REF_DIST };

// calm: for when the player is reading notes. The shots and cuts stay, but
// the framing keeps the whole car in the space under the note board.
export function cameraAt(beat, calm) {
  let b = (((beat - FIRST_BAR) % TOTAL) + TOTAL) % TOTAL;
  let shot = SHOTS[0];
  for (const s of SHOTS) {
    shot = s;
    if (b < s[1]) break;
    b -= s[1];
  }
  const cam = { ...REST, ...KINDS[shot[0]](b / shot[1], shot[2], b) };
  if (calm) {
    cam.dist = Math.max(cam.dist, 8);
    cam.zoom = Math.min(cam.zoom, 1.12 * cam.dist / REF_DIST);
    cam.roll *= 0.5;
    cam.dx *= 0.5;
    cam.dy = 0;
    cam.tilt = Math.min(cam.tilt, 0.6);
  }
  return cam;
}
