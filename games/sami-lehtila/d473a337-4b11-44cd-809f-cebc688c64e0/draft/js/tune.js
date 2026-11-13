// Timings in seconds, and what config/tune.json changes of them. The file
// wins over these defaults; a key missing from it keeps its default.

export const DEFAULTS = {
  walk: 0.13,          // one cell on foot
  push: [0.16, 0.42, 0.9], // one cell pushing a row of 1, 2 or 3
  collect: 0.13,       // stepping onto a gem as it is picked up
  bump: 0.1,           // a step into something that does not move
  enemyStep: 0.3,      // an enemy's cell
  touch: 0.62,         // how close (in cells) an enemy may come before it catches the player
  deadPause: 1.1,      // from being caught to the level starting again
  winPause: 1.4,       // from the last gem to the next level
};

export async function loadTune() {
  const T = structuredClone(DEFAULTS);
  try {
    const r = await fetch('config/tune.json', { cache: 'no-store' });
    if (r.ok) Object.assign(T, await r.json());
  } catch { /* defaults */ }
  return T;
}
