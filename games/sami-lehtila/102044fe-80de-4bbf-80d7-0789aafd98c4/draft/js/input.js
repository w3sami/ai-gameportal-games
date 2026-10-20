// Keyboard and controller into one stick, { x, y } in screen directions
// (y down), length at most 1. Both go through the gamepad plugin's
// createControls, so the player can remap them (open()). A is the ball,
// Start the level menu; B, X, the shoulders and the triggers are still free.
//
// The touch stick and ball button (touch.js) come in on top: the touch stick
// steers while the keys and the controller's stick are let go, and the ball
// button is the same as A. setBlocked(fn) tells the touch controls when
// something else owns the screen.

import { createControls } from 'https://plugins.game.bigbools.fi/gamepad/v1/index.js';
import { createTouch } from './touch.js';

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
      { id: 'menu', label: L('Kentät', 'Levels'), type: 'digital', keys: ['KeyM'], pad: ['Start'] },
      { id: 'fullscreen', label: L('Koko ruutu', 'Fullscreen'), type: 'digital', keys: ['KeyF'], pad: ['RS'] },
    ],
  });

  let blocker = () => false;
  const touch = createTouch({
    target: document.getElementById('view'),
    blocked: () => controls.isOpen() || blocker(),
  });

  // keep arrows and space from scrolling the page around the game
  // (but not from a text field, such as the editor's)
  addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA)$/.test(e.target?.tagName)) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  });

  const v = (id) => (controls.isOpen() ? 0 : controls.value(id));
  const ballTouch = (id, f) => id === 'ball' && !controls.isOpen() && f();

  return {
    poll(dt) { controls.poll(dt); touch.poll(); },
    stick() {
      let x = v('right') - v('left'), y = v('down') - v('up');
      const t = touch.stick();
      if (t && Math.hypot(x, y) < 0.05) { x = t.x; y = t.y; }
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      return { x, y };
    },
    pressed(id) { return (!controls.isOpen() && controls.pressed(id)) || ballTouch(id, touch.pressed); },
    held(id) { return (!controls.isOpen() && controls.held(id)) || ballTouch(id, touch.held); },
    isOpen: () => controls.isOpen(),
    open(onClose) { return controls.open({ onClose }); },
    setBlocked(fn) { blocker = fn; },
    touch,
  };
}
