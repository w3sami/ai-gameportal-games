// The dance the car does on its own when nobody is following a chart.
// A phrase is eight beats; each entry names the lanes held on that beat
// ('' rests). Phrases play in order and loop.

const PHRASES = [
  ['e d', 'q a', 'e d', 'q a', 'w', 's', 'q e', 'a d'],
  ['d', 'd', 'q e d', '', 'a', 'squat d', 'stretch', 'w a'],
  ['squat', 'stretch', 'w s', 'squat', 'stretch', 'w s', 'q d', 'e a'],
  ['e', 'squat e', 'q a d', 's d', 'q', 'squat q', 'e a d', 'w'],
  ['d', 'a', 'q', 'e', 'w', 's', 'w s', 'stretch'],
  ['q d', 'e a', 'w s', 'stretch', 'a d', 'q e', 'squat', 'stretch'],
  ['a d', 'd', 'w d', '', 'q e', 'q', 's q', 'stretch'],
  ['q e', 'w', 'a d', 's', 'e d', 'squat', 'stretch', 'w s'],
  ['w', 's', 'w', 's', 'w s', 'stretch', 'q d', 'e a'],
];
const HOLD = 0.55;   // part of the beat a move is held; the rest is the swing back

export function freestyleLanes(beat) {
  const out = {};
  const index = Math.floor(beat);
  if (beat - index > HOLD) return out;
  const n = PHRASES.length;
  const phrase = PHRASES[((Math.floor(index / 8) % n) + n) % n];
  const move = phrase[((index % 8) + 8) % 8];
  for (const lane of move.split(' ')) if (lane) out[lane] = true;
  return out;
}
