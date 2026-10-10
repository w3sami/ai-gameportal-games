// Keyboard, controller and touch into one input state:
//   x     -1 left … 1 right       up / down  0 … 1       jump  held
//
// Keyboard and controller go through the gamepad plugin's createControls, so
// the player can remap both from the menu (open()). Touch buttons are added
// on top. poll() once per frame; read() as often as the physics steps.

import { createControls } from 'https://plugins.game.bigbools.fi/gamepad/v1/index.js';

const L = (fi, en) => ({ fi, en });

export function createInput() {
  const controls = createControls({
    id: 'downhill',
    lang: 'fi',
    inputs: [
      { id: 'left', label: L('Vasen / pyörähdys', 'Left / spin'), type: 'analog',
        keys: ['ArrowLeft', 'KeyA'], pad: ['LS-Left', 'Left'] },
      { id: 'right', label: L('Oikea / pyörähdys', 'Right / spin'), type: 'analog',
        keys: ['ArrowRight', 'KeyD'], pad: ['LS-Right', 'Right'] },
      { id: 'up', label: L('Kyykky / etuvoltti', 'Tuck / front flip'), type: 'analog',
        keys: ['ArrowUp', 'KeyW'], pad: ['LS-Up', 'Up'] },
      { id: 'down', label: L('Jarru / takavoltti', 'Brake / back flip'), type: 'analog',
        keys: ['ArrowDown', 'KeyS'], pad: ['LS-Down', 'Down'] },
      { id: 'jump', label: L('Hyppy', 'Jump'), type: 'digital',
        keys: ['Space'], pad: ['A', 'RT'] },
      { id: 'restart', label: L('Alusta', 'Restart'), type: 'digital',
        keys: ['KeyR'], pad: ['Back'] },
      { id: 'menu', label: L('Tauko / valikko', 'Pause / menu'), type: 'digital',
        keys: ['Escape'], pad: ['Start'] },
      { id: 'controls', label: L('Ohjainasetukset', 'Controls'), type: 'digital',
        keys: ['KeyC'], pad: ['Y'] },
      { id: 'fullscreen', label: L('Koko ruutu', 'Fullscreen'), type: 'digital',
        keys: ['KeyF'], pad: ['RS'] },
    ],
  });

  const touch = { left: false, right: false, up: false, down: false, jump: false };
  const pad = document.getElementById('touch');
  if (matchMedia('(pointer: coarse)').matches) { pad.hidden = false; document.body.classList.add('touch'); }
  for (const b of pad.querySelectorAll('[data-in]')) {
    const name = b.dataset.in;
    const set = (v) => (e) => { e.preventDefault(); touch[name] = v; b.classList.toggle('on', v); };
    b.addEventListener('pointerdown', set(true));
    b.addEventListener('pointerup', set(false));
    b.addEventListener('pointercancel', set(false));
    b.addEventListener('pointerleave', set(false));
  }

  // keep arrows and space from scrolling the page around the game
  addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  });

  const v = (id) => (controls.isOpen() ? 0 : controls.value(id));
  const t = (name) => (touch[name] ? 1 : 0);

  return {
    poll(dt) { controls.poll(dt); },
    read() {
      return {
        x: Math.max(-1, Math.min(1, v('right') + t('right') - v('left') - t('left'))),
        up: Math.min(1, v('up') + t('up')),
        down: Math.min(1, v('down') + t('down')),
        // with the developer's triggers on, RT moves checkpoints instead of jumping
        jump: (!controls.isOpen() && controls.held('jump') && !(this.devTriggers && controls.pad.held('RT') && !controls.pad.held('A'))) || touch.jump,
      };
    },
    /** Set while the tuning panel is open: LT/RT step through checkpoints. */
    devTriggers: false,
    /** Edge of a raw controller button this frame. */
    padPressed(name) { return !controls.isOpen() && controls.pad.pressed(name); },
    /** Edge of a named input this frame, for menus. */
    pressed(id) { return !controls.isOpen() && controls.pressed(id); },
    isOpen: () => controls.isOpen(),
    open(onClose) { return controls.open({ onClose }); },
    get connected() { return controls.pad.connected; },
  };
}
