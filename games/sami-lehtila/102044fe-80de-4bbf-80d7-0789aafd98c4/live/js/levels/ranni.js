// Level 4: a slanted chute whose pads throw straight out of their face.

export default {
  key: 'ranni',
  name: 'Ränni',
  legend: {
    j: { tile: 'pad', slope: 'br', speed: 0.6 },
    k: { tile: 'pad', slope: 'tl', speed: 0.6 },
    p: { tile: 'panel', slope: 'br', phase: 0 },
    q: { tile: 'panel', slope: 'br', phase: 0.5 },
    P: { tile: 'panel', slope: 'tl', phase: 0.25 },
    Q: { tile: 'panel', slope: 'tl', phase: 0.75 },
    a: { tile: 'pad', dir: [1, -1], speed: 1.3 },
  },
};
