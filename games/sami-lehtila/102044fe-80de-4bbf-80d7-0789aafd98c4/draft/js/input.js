// Keyboard and controller into one stick, { x, y } in screen directions
// (y down), length at most 1. Both go through the gamepad plugin's
// createControls, so the player can remap them (open()). A is the ball;
// B, X, the shoulders and the triggers are still free.

import { createControls } from 'https://plugins.game.bigbools.fi/gamepad/v1/index.js';

const L = (fi, en) => ({ fi, en });

export function createInput() {
  const controls = createControls({
    id: 'lima',
    lang: 'fi',
    inputs: [
      { id: 'left', label: L('Vasen', 'Left'), type: 'analog', keys: ['ArrowLeft', 'KeyA'], pad: ['LS-Left', 'Left'] },
      { id: 'right', label: L('Oikea', 'Right'), type: 'analog', keys: ['ArrowRight', 'KeyD'], pad: ['LS-Right', 'Right'] },
      { id: 'up', label: L('Ylös', 'Up'), type: 'analog', keys: ['ArrowUp', 'KeyW'], pad: ['LS-Up', 'Up'] },
      { id: 'down', label: L('Alas', 'Down'), type: 'analog', keys: ['ArrowDown', 'KeyS'], pad: ['LS-Down', 'Down'] },
      { id: 'ball', label: L('Pallo / hyppy', 'Ball / jump'), type: 'digital', keys: ['Space'], pad: ['A'] },
      { id: 'reset', label: L('Alkuun', 'Reset'), type: 'digital', keys: ['KeyR'], pad: ['Back'] },
      { id: 'controls', label: L('Ohjainasetukset', 'Controls'), type: 'digital', keys: ['KeyC'], pad: ['Y'] },
      { id: 'fullscreen', label: L('Koko ruutu', 'Fullscreen'), type: 'digital', keys: ['KeyF'], pad: ['RS'] },
    ],
  });

  // keep arrows and space from scrolling the page around the game
  addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  });

  const v = (id) => (controls.isOpen() ? 0 : controls.value(id));

  return {
    poll(dt) { controls.poll(dt); },
    stick() {
      let x = v('right') - v('left'), y = v('down') - v('up');
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      return { x, y };
    },
    pressed(id) { return !controls.isOpen() && controls.pressed(id); },
    held(id) { return !controls.isOpen() && controls.held(id); },
    isOpen: () => controls.isOpen(),
    open(onClose) { return controls.open({ onClose }); },
  };
}
