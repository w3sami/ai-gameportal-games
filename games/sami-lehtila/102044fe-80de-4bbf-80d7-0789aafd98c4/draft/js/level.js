// The levels, in the order they are played (LEVELS), each in its own file
// under levels/ as { key, name, legend }. A level's map is text, one
// character per tile and every row the same length, in
// config/level-<key>.json as { rows }; loadLevels() reads them in. The level
// editor (editor.js) paints those rows and saves them back there, so that
// file is the map. LEGEND says what each character is; a level's own legend
// adds the characters only it uses (doors and what opens them, moving
// platforms, pads of its own).//
// A legend entry is either a tile, { tile: type, … }, solid, with what the
// type does in tune.tiles (grip, magnet), or a thing, { kind, … }:
//
//   start, checkpoint   the cell right above the floor the slime sits on
//   exit                reaching it ends the level
//   button              a plate on the surface below it (else beside, else
//                       above); touching it opens the doors keyed to it, for
//                       `time` seconds while not touched (0: for good)
//   card                picked up by touching it, carried until a door keyed
//                       to it is touched
//   door                every cell of its character is one door, opened by
//                       `key`, the character of its button or card; it
//                       slides into its top (or, wider than tall, its left)
//   platform            every cell of its character is one platform, moving
//                       (dx, dy) and back every `period` seconds, starting
//                       `phase` (0–1) of the way into its round
//
// A tile with a `slope` fills half its cell (world.js). Pads throw the
// slime, while the jump button is held: along the face it touches, or along
// `dir` when the entry has one, at tune.padSpeed × `speed`. Panels glow in
// turns (tune.panel) and kill while red; `phase` (0–1) shifts a panel's turn.
// Outside the map counts as stone, so the edge of the map is a wall too.

import luola from './levels/luola.js';
import siksak from './levels/siksak.js';
import vino from './levels/vino.js';
import ranni from './levels/ranni.js';
import hiekka from './levels/hiekka.js';

export const LEGEND = {
  '#': { tile: 'stone' },
  W: { tile: 'wood' },
  '◢': { tile: 'wood', slope: 'br' },
  '◣': { tile: 'wood', slope: 'bl' },
  '◤': { tile: 'wood', slope: 'tl' },
  '◥': { tile: 'wood', slope: 'tr' },
  I: { tile: 'ice' },
  M: { tile: 'metal' },
  J: { tile: 'pad' },
  '>': { tile: 'pad', dir: [2, -1], speed: 1.2 },
  '<': { tile: 'pad', dir: [-2, -1], speed: 1.2 },
  1: { tile: 'panel', phase: 0 },
  2: { tile: 'panel', phase: 0.25 },
  3: { tile: 'panel', phase: 0.5 },
  4: { tile: 'panel', phase: 0.75 },
  S: { kind: 'start' },
  L: { kind: 'checkpoint' },
  E: { kind: 'exit' },
};

export const LEVELS = [luola, siksak, vino, ranni, hiekka];

// Each level's rows from config/level-<key>.json. A level whose file cannot
// be read gets a closed room with a start and an exit, and says so.
export async function loadLevels() {
  await Promise.all(LEVELS.map(async (lv) => {
    try {
      const r = await fetch(`config/level-${lv.key}.json`, { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      if (j && Array.isArray(j.rows) && j.rows.length && j.rows.every((row) => row.length === j.rows[0].length)) { lv.rows = j.rows; return; }
    } catch { /* falls through to the stand-in room */ }
    console.warn(`[lima] config/level-${lv.key}.json missing or broken: a stand-in room`);
    lv.rows = ['##########', '#........#', '#........#', '#S......E#', '##########'];
  }));
}
