// Keyboard, controller and touch into one direction. Keyboard and
// controller go through the gamepad plugin's createControls, so the player
// can remap them (open()). The most recently pressed direction that is
// still held wins, so turning a corner does not need letting go first.
// On a touch screen, dragging a finger away from where it went down holds
// that direction until the finger lifts.

import { createControls } from 'https://plugins.game.bigbools.fi/gamepad/v1/index.js';

const L = (fi, en) => ({ fi, en });
const DIRS = ['left', 'right', 'up', 'down'];

export function createInput(canvas) {
  const controls = createControls({
    id: 'rykelma',
    lang: 'fi',
    inputs: [
      { id: 'left', label: L('Vasen', 'Left'), type: 'digital', keys: ['ArrowLeft', 'KeyA'], pad: ['LS-Left', 'Left'] },
      { id: 'right', label: L('Oikea', 'Right'), type: 'digital', keys: ['ArrowRight', 'KeyD'], pad: ['LS-Right', 'Right'] },
      { id: 'up', label: L('Ylös', 'Up'), type: 'digital', keys: ['ArrowUp', 'KeyW'], pad: ['LS-Up', 'Up'] },
      { id: 'down', label: L('Alas', 'Down'), type: 'digital', keys: ['ArrowDown', 'KeyS'], pad: ['LS-Down', 'Down'] },
      { id: 'ok', label: L('Valitse', 'Select'), type: 'digital', keys: ['Space', 'Enter'], pad: ['A'] },
      { id: 'reset', label: L('Alusta', 'Restart'), type: 'digital', keys: ['KeyR'], pad: ['Back', 'X'] },
      { id: 'controls', label: L('Ohjainasetukset', 'Controls'), type: 'digital', keys: ['KeyC'], pad: ['Y'] },
      { id: 'menu', label: L('Kentät', 'Levels'), type: 'digital', keys: ['KeyM', 'Escape'], pad: ['Start'] },
    ],
  });

  addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA)$/.test(e.target?.tagName)) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  });

  // press order of the held directions, newest last
  let order = [];
  let touchDir = null, touchStart = null;
  canvas.addEventListener('pointerdown', (e) => { touchStart = [e.clientX, e.clientY]; touchDir = null; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!touchStart) return;
    const dx = e.clientX - touchStart[0], dy = e.clientY - touchStart[1];
    if (Math.hypot(dx, dy) < 18) return;
    touchDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  });
  const lift = () => { touchStart = null; touchDir = null; };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  const open = () => controls.isOpen();

  return {
    poll(dt) {
      controls.poll(dt);
      for (const d of DIRS) {
        const held = !open() && controls.held(d);
        if (held && !order.includes(d)) order.push(d);
        if (!held) order = order.filter((o) => o !== d);
      }
    },
    dir() { return order[order.length - 1] || touchDir; },
    pressed(id) { return !open() && controls.pressed(id); },
    isOpen: open,
    open(onClose) { return controls.open({ onClose }); },
  };
}
