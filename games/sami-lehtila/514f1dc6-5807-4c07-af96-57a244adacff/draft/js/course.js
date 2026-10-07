// The course: what lies on the slope and where.
//
// Units are metres. z runs downhill toward negative values, the start is at
// z = 0. x is across the slope, 0 in the middle; the rideable width is
// ±halfWidth, beyond which the snow banks up. Every item's y is metres above
// the ground under it, never an absolute height.
//
//   profile   [[length, grade], ...]  the base slope from the top; grade is drop
//                                     per metre, smoothed where segments meet
//   finishZ   crossing it ends the run
//
// items, by type:
//   kicker   { x, z, w, len, h }       ramp whose lip is at z, rising over len
//                                     metres uphill of it to height h
//   house    { x, z, w, d, wallH, roofH, ridge: 'z'|'x', color,
//              awning?, sign? }        z is the centre; w across, d downhill.
//                                     A ridge along 'z' is a grind rail.
//   tree     { x, z, h }               spruce; its top is a bouncer
//   star     { x, z, y }               collectible
//   rail     { x, z, len, h }          straight rail running downhill from z
//   table | snowman { x, z }           breakables
//   crowd    { x, z, n, spread }       standing people
//   dog      { x, z, range }           wanders within range of its spot
//   road     { z, width, lanes: [{ offset, dir, speed }] }   z is the centre
//   balloon  { x, z, y, r }            y is the centre of the envelope
//   forest   { from, to, every }       random spruces along both banks
//   finish   { z }                     the banner

export const COURSE = {
  halfWidth: 24,
  finishZ: -625,
  profile: [
    [40, 0.22], [130, 0.26], [150, 0.12], [30, 0.06],
    [45, 0.02], [130, 0.28], [80, 0.32], [80, 0.04],
  ],
  items: [
    { type: 'forest', from: -20, to: -700, every: 5 },

    // Warm-up: one kicker, a low rail, things to knock over.
    { type: 'kicker', x: 0, z: -32, w: 6, len: 6, h: 1.0 },
    { type: 'star', x: 0, z: -42, y: 4 },
    { type: 'snowman', x: 8, z: -24 },
    { type: 'snowman', x: -9, z: -40 },
    { type: 'table', x: 12, z: -46 },
    { type: 'rail', x: -8, z: -52, len: 14, h: 0.8 },
    { type: 'star', x: -8, z: -70, y: 2.5 },

    // Tree garden: spruces in the run, two with a kicker aimed at the top.
    { type: 'tree', x: -14, z: -82, h: 8 },
    { type: 'tree', x: 15, z: -90, h: 9 },
    { type: 'kicker', x: 6, z: -84, w: 5, len: 7, h: 1.6 },
    { type: 'tree', x: 6, z: -97, h: 6.8 },
    { type: 'star', x: 6, z: -97, y: 9 },
    { type: 'tree', x: -4, z: -118, h: 9 },
    { type: 'tree', x: 18, z: -124, h: 7 },
    { type: 'kicker', x: -10, z: -140, w: 5, len: 8, h: 2.0 },
    { type: 'tree', x: -10, z: -153, h: 6.5 },
    { type: 'star', x: -10, z: -153, y: 9 },
    { type: 'tree', x: 6, z: -160, h: 10 },
    { type: 'tree', x: 16, z: -150, h: 8 },
    { type: 'snowman', x: 0, z: -170 },

    // Village: café with an awning onto its roof, a second roof to grind.
    { type: 'kicker', x: 4, z: -190, w: 4, len: 4, h: 0.7 },
    { type: 'house', x: 4, z: -206, w: 8, d: 10, wallH: 3.2, roofH: 2.2, ridge: 'z',
      color: '#e8b53c', awning: true, sign: 'KAHVILA' },
    { type: 'table', x: -2, z: -196 },
    { type: 'table', x: 11, z: -195 },
    { type: 'table', x: -3, z: -199 },
    { type: 'table', x: 12, z: -199 },
    { type: 'crowd', x: 15, z: -205, n: 4, spread: 3 },
    { type: 'star', x: 4, z: -212, y: 7 },

    { type: 'kicker', x: -10, z: -230, w: 5, len: 8, h: 2.0 },
    { type: 'house', x: -10, z: -246, w: 7, d: 12, wallH: 3, roofH: 2, ridge: 'z', color: '#b8402e' },
    { type: 'star', x: -10, z: -254, y: 6.5 },
    { type: 'dog', x: 2, z: -248, range: 7 },
    { type: 'house', x: 14, z: -262, w: 9, d: 7, wallH: 3, roofH: 2.4, ridge: 'x', color: '#4f7fb8' },
    { type: 'crowd', x: -1, z: -292, n: 6, spread: 4 },
    { type: 'rail', x: 10, z: -296, len: 18, h: 0.9 },
    { type: 'dog', x: -12, z: -305, range: 6 },
    { type: 'snowman', x: -16, z: -280 },

    // Road: cars both ways; jump it or time it.
    { type: 'kicker', x: 0, z: -352, w: 20, len: 6, h: 1.4 },
    { type: 'road', z: -368, width: 12, lanes: [
      { offset: 3, dir: 1, speed: 12 }, { offset: -3, dir: -1, speed: 10 },
    ] },
    { type: 'star', x: 0, z: -368, y: 4.5 },
    { type: 'dog', x: 10, z: -385, range: 5 },

    // Balloons: kick up onto one, bounce on to the next.
    { type: 'kicker', x: -6, z: -404, w: 5, len: 7, h: 2.0 },
    { type: 'balloon', x: -6, z: -424, y: 7, r: 3 },
    { type: 'star', x: -6, z: -424, y: 12 },
    { type: 'kicker', x: 8, z: -436, w: 5, len: 8, h: 2.4 },
    { type: 'balloon', x: 8, z: -456, y: 9, r: 3.5 },
    { type: 'balloon', x: -2, z: -488, y: 10, r: 3 },
    { type: 'star', x: -2, z: -488, y: 15 },
    { type: 'table', x: 13, z: -470 },
    { type: 'table', x: -14, z: -442 },
    { type: 'tree', x: 16, z: -500, h: 9 },
    { type: 'tree', x: -15, z: -510, h: 8 },

    // Final drop: big kickers, a crowd at the finish.
    { type: 'kicker', x: 0, z: -538, w: 8, len: 9, h: 2.5 },
    { type: 'star', x: 0, z: -552, y: 9 },
    { type: 'kicker', x: -9, z: -572, w: 6, len: 7, h: 2.0 },
    { type: 'tree', x: -9, z: -590, h: 7 },
    { type: 'star', x: -9, z: -590, y: 9.5 },
    { type: 'rail', x: 9, z: -580, len: 16, h: 0.8 },
    { type: 'crowd', x: -16, z: -615, n: 7, spread: 4 },
    { type: 'crowd', x: 16, z: -615, n: 7, spread: 4 },
    { type: 'table', x: -5, z: -608 },
    { type: 'table', x: 5, z: -608 },
    { type: 'finish', z: -625 },
  ],
};
