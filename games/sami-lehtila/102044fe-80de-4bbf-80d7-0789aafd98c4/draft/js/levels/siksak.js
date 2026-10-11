// Level 2: a shaft climbed by bouncing a ball from wall to wall. The pads
// throw at a slant, so it is the stick that times each throw to the next pad.

export default {
  key: 'siksak',
  name: 'Siksak',
  legend: {
    ')': { tile: 'pad', dir: [1, -1.2], speed: 0.8 },
    '(': { tile: 'pad', dir: [-1, -1.2], speed: 0.8 },
  },
};
