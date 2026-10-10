// The room, as text. One character per tile, every row the same length:
//
//   .  empty           #  stone   (grips, magnetic)
//   W  wood (grips, not magnetic: the slime slides off its walls)
//   I  ice  (slippery, weakly magnetic)
//   M  metal (strongly magnetic)
//   S  where the slime starts (empty)
//
// What a tile type does is in tune.tiles (grip, magnet), not here. Outside the
// map counts as stone, so the edge of the screen is a wall too.

export const TILE_TYPES = { '#': 'stone', W: 'wood', I: 'ice', M: 'metal' };

export const ROOM = [
  '################################',
  '#..............................#',
  '#..............................#',
  '#....MMMMMMMM..................#',
  '#..............................#',
  '#..............................#',
  '#......................IIIIII..#',
  '#..............................#',
  '#.............####.............#',
  '#.............####.............#',
  '#..............................#',
  '#..............................#',
  '#...WW.........................#',
  '#...WW.................MM......#',
  '#...WW.................MM......#',
  '#...WW.........S.......MM......#',
  '#...WW.................MM......#',
  '################################',
];
