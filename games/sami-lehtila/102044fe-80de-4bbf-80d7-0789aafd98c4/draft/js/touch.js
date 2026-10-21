// Touch controls, split by hand: one half of the screen is the stick, the
// other half is the ball button (a tap jumps, holding charges, the same as A
// or space). Which half is which comes from the level menu, as does
// switching the whole thing on and off; both are kept in this browser
// (lima.touch, lima.hand), and a phone or tablet starts with them on, the
// stick on the left.
//
// A finger on the stick's half starts the portal's floating stick under it;
// while that finger is down, no other finger can take the stick over. Any
// number of fingers on the other half hold the button. The round button
// drawn in that half's corner only shows it; the whole half is the button.
//
// The stick is all but digital, like the keys the game was tuned on: past
// a small deflection it gives a full push in one of eight directions. Its
// centre trails the finger, so turning back takes the same short move
// whatever way the thumb has wandered.
//
// The stick is drawn on a canvas of its own over the game (#pad), in CSS
// pixels, by a loop of its own, so the renderer knows nothing about it.

import { createJoystick } from 'https://plugins.game.bigbools.fi/joystick/v1/index.js';

const KEY = 'lima.touch', HAND = 'lima.hand';
const RADIUS = 36;      // px from the centre to the ring the centre is dragged by
const ON_AT = 0.3;      // share of RADIUS past which the stick pushes at full
const coarse = () => matchMedia('(pointer: coarse)').matches;

function read(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* kept for this visit only */ }
}

// target: the element a finger lands on; blocked(): true while something
// else owns the touches (the editor, the menu, the controls dialog)
export function createTouch({ target, blocked = () => false }) {
  let enabled = read(KEY, coarse() ? '1' : '0') === '1';
  let hand = read(HAND, 'left') === 'right' ? 'right' : 'left';   // the stick's half

  const pad = document.getElementById('pad');
  const ctx = pad.getContext('2d');
  const button = document.getElementById('ballbtn');
  const touchToggle = document.querySelector('#levels .touch');
  const handToggle = document.querySelector('#levels .hand');

  const local = (e) => { const r = target.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onStickSide = (p) => (p.x < target.clientWidth / 2) === (hand === 'left');

  const stick = createJoystick({
    target, radius: RADIUS, deadzone: 0,
    ignore: (p) => !enabled || blocked() || stick.active || !onStickSide(p),
  });

  // the finger holding the stick, and the fingers holding the button
  let fingerId = -1, tapped = false, pressedNow = false;
  const buttonIds = new Set();
  target.addEventListener('pointerdown', (e) => {
    if (!enabled || blocked()) return;
    const p = local(e);
    if (onStickSide(p)) {
      // the plugin's own listener, added first, has put the centre here
      if (stick.active && Math.abs(p.x - stick.origin.x) < 0.5 && Math.abs(p.y - stick.origin.y) < 0.5) fingerId = e.pointerId;
      return;
    }
    e.preventDefault();
    buttonIds.add(e.pointerId);
    tapped = true;
    button.classList.add('down');
  });
  // past the ring, the stick's centre is dragged along behind the finger
  addEventListener('pointermove', (e) => {
    if (e.pointerId !== fingerId || !stick.active) return;
    const p = local(e), dx = p.x - stick.origin.x, dy = p.y - stick.origin.y, d = Math.hypot(dx, dy);
    if (d <= RADIUS) return;
    stick.origin.x = p.x - (dx / d) * RADIUS;
    stick.origin.y = p.y - (dy / d) * RADIUS;
  });
  const lift = (e) => {
    if (e.pointerId === fingerId) fingerId = -1;
    if (buttonIds.delete(e.pointerId) && !buttonIds.size) button.classList.remove('down');
  };
  addEventListener('pointerup', lift);
  addEventListener('pointercancel', lift);
  function letGo() { stick.release(); fingerId = -1; buttonIds.clear(); button.classList.remove('down'); }
  addEventListener('blur', letGo);

  // the stick's push: nothing, or a full one along one of eight directions
  function digital() {
    const kx = stick.knob.x, ky = stick.knob.y;
    if (Math.hypot(kx, ky) < ON_AT * RADIUS) return { x: 0, y: 0 };
    const a = Math.round(Math.atan2(ky, kx) / (Math.PI / 4)) * (Math.PI / 4);
    const x = Math.cos(a), y = Math.sin(a);
    return { x: Math.abs(x) < 1e-9 ? 0 : x, y: Math.abs(y) < 1e-9 ? 0 : y };
  }

  function apply() {
    button.hidden = !enabled;
    button.classList.toggle('left', hand === 'right');   // the button's half is the other one
    if (!enabled) letGo();
    if (touchToggle) touchToggle.textContent = 'Kosketusohjaimet: ' + (enabled ? 'päällä' : 'pois');
    if (handToggle) {
      handToggle.hidden = !enabled;
      handToggle.textContent = 'Sauva: ' + (hand === 'left' ? 'vasemmalla' : 'oikealla') + ' · nappi: ' + (hand === 'left' ? 'oikealla' : 'vasemmalla');
    }
  }
  touchToggle?.addEventListener('click', () => { enabled = !enabled; write(KEY, enabled ? '1' : '0'); apply(); touchToggle.blur(); });
  handToggle?.addEventListener('click', () => { hand = hand === 'left' ? 'right' : 'left'; write(HAND, hand); letGo(); apply(); handToggle.blur(); });
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
      if (blocked() && (stick.active || buttonIds.size)) letGo();
    },
    // the stick's { x, y } while a finger is on it, else null
    stick: () => (enabled && stick.active ? digital() : null),
    // a tap shorter than a frame still counts as one frame held
    held: () => enabled && (buttonIds.size > 0 || pressedNow),
    pressed: () => enabled && pressedNow,
    get enabled() { return enabled; },
  };
}
