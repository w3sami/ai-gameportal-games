// Touch controls: the portal's floating stick wherever a finger lands on the
// game, and a ball button in the corner (a tap jumps, holding charges, the
// same as A or space). They are switched on and off from the level menu; the
// choice is kept in this browser (lima.touch), and a phone or tablet starts
// with them on.
//
// The stick is all but digital, like the keys the game was tuned on: past
// a small deflection it gives a full push in one of eight directions. Its
// centre trails the finger, so turning back takes the same short move
// whatever way the thumb has wandered.
//
// The stick is drawn on a canvas of its own over the game (#pad), in CSS
// pixels, by a loop of its own, so the renderer knows nothing about it.

import { createJoystick } from 'https://plugins.game.bigbools.fi/joystick/v1/index.js';

const KEY = 'lima.touch';
const RADIUS = 36;      // px from the centre to the ring the centre is dragged by
const ON_AT = 0.3;      // share of RADIUS past which the stick pushes at full
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

  const stick = createJoystick({ target, radius: RADIUS, deadzone: 0, ignore: () => !enabled || blocked() });

  // the finger holding the stick, found by its landing on the stick's centre
  // (the plugin's own listener, added first, has already put the centre there)
  let fingerId = -1;
  const local = (e) => { const r = target.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  target.addEventListener('pointerdown', (e) => {
    if (!stick.active) return;
    const p = local(e);
    if (Math.abs(p.x - stick.origin.x) < 0.5 && Math.abs(p.y - stick.origin.y) < 0.5) fingerId = e.pointerId;
  });
  // past the ring, the centre is dragged along behind the finger
  addEventListener('pointermove', (e) => {
    if (e.pointerId !== fingerId || !stick.active) return;
    const p = local(e), dx = p.x - stick.origin.x, dy = p.y - stick.origin.y, d = Math.hypot(dx, dy);
    if (d <= RADIUS) return;
    stick.origin.x = p.x - (dx / d) * RADIUS;
    stick.origin.y = p.y - (dy / d) * RADIUS;
  });
  const lost = (e) => { if (e.pointerId === fingerId) fingerId = -1; };
  addEventListener('pointerup', lost);
  addEventListener('pointercancel', lost);

  // the stick's push: nothing, or a full one along one of eight directions
  function digital() {
    const kx = stick.knob.x, ky = stick.knob.y;
    if (Math.hypot(kx, ky) < ON_AT * RADIUS) return { x: 0, y: 0 };
    const a = Math.round(Math.atan2(ky, kx) / (Math.PI / 4)) * (Math.PI / 4);
    const x = Math.cos(a), y = Math.sin(a);
    return { x: Math.abs(x) < 1e-9 ? 0 : x, y: Math.abs(y) < 1e-9 ? 0 : y };
  }

  // the ball button: held while a finger is on it; a tap shorter than a frame
  // still counts as one frame held
  let down = false, tapped = false, pressedNow = false, btnId = -1;
  function letGo() { down = false; btnId = -1; button.classList.remove('down'); }
  button.addEventListener('pointerdown', (e) => {
    if (!enabled) return;
    e.preventDefault();
    btnId = e.pointerId;
    try { button.setPointerCapture(e.pointerId); } catch { /* fine without */ }
    down = true; tapped = true;
    button.classList.add('down');
  });
  const up = (e) => { if (e.pointerId === btnId) letGo(); };
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  button.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('blur', letGo);

  function apply() {
    button.hidden = !enabled;
    if (!enabled) { stick.release(); fingerId = -1; letGo(); }
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
      if (blocked() && stick.active) { stick.release(); fingerId = -1; }
    },
    // the stick's { x, y } while a finger is on it, else null
    stick: () => (enabled && stick.active ? digital() : null),
    held: () => enabled && (down || pressedNow),
    pressed: () => enabled && pressedNow,
    get enabled() { return enabled; },
    set enabled(on) { setEnabled(on); },
  };
}
