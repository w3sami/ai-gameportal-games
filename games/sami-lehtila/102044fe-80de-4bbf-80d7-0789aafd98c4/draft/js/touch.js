// Touch controls: the portal's floating stick wherever a finger lands on the
// game, and a ball button in the corner (a tap jumps, holding charges, the
// same as A or space). They are switched on and off from the level menu; the
// choice is kept in this browser (lima.touch), and a phone or tablet starts
// with them on.
//
// The stick is drawn on a canvas of its own over the game (#pad), in CSS
// pixels, by a loop of its own, so the renderer knows nothing about it.

import { createJoystick } from 'https://plugins.game.bigbools.fi/joystick/v1/index.js';

const KEY = 'lima.touch';
const coarse = () => matchMedia('(pointer: coarse)').matches;

function readEnabled() {
  try {
    const s = localStorage.getItem(KEY);
    return s == null ? coarse() : s === '1';
  } catch { return coarse(); }
}

// target: the element a finger lands on; blocked(): true while something
// else owns the touches (the editor, the menu, the controls dialog)
export function createTouch({ target, blocked = () => false }) {
  let enabled = readEnabled();

  const pad = document.getElementById('pad');
  const ctx = pad.getContext('2d');
  const button = document.getElementById('ballbtn');
  const toggle = document.querySelector('#levels .touch');

  const stick = createJoystick({ target, radius: 64, ignore: () => !enabled || blocked() });

  // the ball button: held while a finger is on it; a tap shorter than a frame
  // still counts as one frame held
  let down = false, tapped = false, pressedNow = false, btnId = -1;
  function let_go() { down = false; btnId = -1; button.classList.remove('down'); }
  button.addEventListener('pointerdown', (e) => {
    if (!enabled) return;
    e.preventDefault();
    btnId = e.pointerId;
    try { button.setPointerCapture(e.pointerId); } catch { /* fine without */ }
    down = true; tapped = true;
    button.classList.add('down');
  });
  const up = (e) => { if (e.pointerId === btnId) let_go(); };
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  button.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('blur', let_go);

  function apply() {
    button.hidden = !enabled;
    if (!enabled) { stick.release(); let_go(); }
    if (toggle) toggle.textContent = 'Kosketusohjaimet: ' + (enabled ? 'päällä' : 'pois');
  }
  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch { /* kept for this visit only */ }
    apply();
  }
  toggle?.addEventListener('click', () => { setEnabled(!enabled); toggle.blur(); });
  apply();

  // the stick over the game, sized to the window
  let w = 0, h = 0, dpr = 1;
  function draw() {
    const nw = innerWidth, nh = innerHeight, nd = Math.min(devicePixelRatio || 1, 2);
    if (nw !== w || nh !== h || nd !== dpr) {
      w = nw; h = nh; dpr = nd;
      pad.width = Math.round(w * dpr); pad.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (enabled) stick.draw(ctx, { color: '#b6f37a' });
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  return {
    // once a frame, before the game reads the controls
    poll() {
      pressedNow = tapped; tapped = false;
      if (blocked() && stick.active) stick.release();
    },
    // the stick's { x, y } while a finger is on it, else null
    stick: () => (enabled && stick.active ? { x: stick.x, y: stick.y } : null),
    held: () => enabled && (down || pressedNow),
    pressed: () => enabled && pressedNow,
    get enabled() { return enabled; },
    set enabled(on) { setEnabled(on); },
  };
}
