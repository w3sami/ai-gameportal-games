// Level 1: crawling, climbing, jumping, doors, platforms, panels, and a
// pinball hall of pads at the end.

export default {
  key: 'luola',
  name: 'Luola',
  legend: {
    a: { kind: 'button', color: '#ffa94d', time: 0 },
    A: { kind: 'door', key: 'a' },
    k: { kind: 'card', color: '#4dabf7' },
    K: { kind: 'door', key: 'k' },
    b: { kind: 'button', color: '#ff6b9a', time: 5 },
    B: { kind: 'door', key: 'b' },
    p: { kind: 'platform', dx: 0, dy: -16, period: 8, phase: 0 },
    q: { kind: 'platform', dx: 12, dy: 0, period: 6, phase: 0 },
    '/': { tile: 'pad', dir: [1, -2], speed: 0.95 },
    o: { tile: 'pad', speed: 0.75 },
    g: { kind: 'button', color: '#69db7c', time: 6 },
    G: { kind: 'door', key: 'g' },
  },
};
