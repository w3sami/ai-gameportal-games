// Keyboard and touch into one input state:
//   x     -1 left … 1 right       up / down  0 … 1       jump  held
// Edge-triggered menu keys go to onKey(code).

const KEYS = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  jump: ['Space'],
};

export function createInput(onKey) {
  const held = new Set();
  const touch = { left: false, right: false, up: false, down: false, jump: false };

  addEventListener('keydown', (e) => {
    if (Object.values(KEYS).flat().includes(e.code)) e.preventDefault();
    if (!e.repeat) onKey(e.code);
    held.add(e.code);
  });
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => held.clear());

  const on = (name) => touch[name] || KEYS[name].some((k) => held.has(k));

  // touch buttons: each one sets its flag while a finger is on it
  const pad = document.getElementById('touch');
  if (matchMedia('(pointer: coarse)').matches) pad.hidden = false;
  for (const b of pad.querySelectorAll('[data-in]')) {
    const name = b.dataset.in;
    const set = (v) => (e) => { e.preventDefault(); touch[name] = v; b.classList.toggle('on', v); };
    b.addEventListener('pointerdown', set(true));
    b.addEventListener('pointerup', set(false));
    b.addEventListener('pointercancel', set(false));
    b.addEventListener('pointerleave', set(false));
  }

  return {
    read() {
      return {
        x: (on('right') ? 1 : 0) - (on('left') ? 1 : 0),
        up: on('up') ? 1 : 0,
        down: on('down') ? 1 : 0,
        jump: on('jump'),
      };
    },
  };
}
