// Level 3: the zigzag shaft turned 45°. The walls are slopes, the arrows
// turned with them: the lower wall's throw nearly straight up, the upper
// wall's nearly straight right.

export default {
  key: 'vino',
  name: 'Vino',
  legend: {
    u: { tile: 'pad', slope: 'br', dir: [0.2, -2.2], speed: 1 },
    r: { tile: 'pad', slope: 'tl', dir: [2.2, -0.2], speed: 1 },
    n: { tile: 'pad', dir: [0.2, -2.2], speed: 1 },
    p: { tile: 'panel', slope: 'br', phase: 0 },
    q: { tile: 'panel', slope: 'br', phase: 0.5 },
    P: { tile: 'panel', slope: 'tl', phase: 0.25 },
    Q: { tile: 'panel', slope: 'tl', phase: 0.75 },
  },
};
