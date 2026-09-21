// Controller support. The portal's gamepad plugin is an ES module and Thruster is classic scripts, so this file is
// the bridge — and it is only a bridge: it wraps three globals the way lbhooks.js does and nothing in game.js moves
// for it. Removing the two tags in index.html takes all of it out again. If the plugin fails to load, this module
// never runs and the game is exactly what it was.
//
// Polling happens exactly once per rendered frame, as early in the frame as it can. readInput() polls lazily on the
// first tick of a frame, so in flight the pad is read immediately before the physics that uses it; the loop below
// covers the frames where readInput never runs (menus, paused, a frame that carried no tick) and then opens the
// window for the next one. Polling twice in one frame would swallow the pressed()/released() edges — hence the stamp.
import { createGamepad } from "https://plugins.game.bigbools.fi/gamepad/v1/index.js";

// Pad sources only. The game has its own keydown handling, so letting the plugin read the keyboard as well would
// count every key twice. `A` is thrust in flight and confirm in a menu; the two modes never overlap.
const pad = createGamepad({
  keys: false,
  actions: {
    thrust:  ['A', 'RT', 'LT', 'RB', 'LB'],
    pause:   ['Start'],
    restart: ['Back', 'Y'],
    confirm: ['A', 'Start'],
    back:    ['B'],
    up: ['Up'], down: ['Down'], navL: ['Left'], navR: ['Right'],
  },
});
window.PAD = pad;

let stamp = 0, polled = -1, live = false, lock = false, sel = null, seenState = '';
function poll(){ if (polled === stamp) return; polled = stamp; pad.poll(); }
// The plugin has already taken its own dead zone out and rescaled what is left. The curve on top is S.expo, the same
// shaping the touch stick gets, so the first millimetre of a real stick is a nudge exactly as it is under a thumb.
// A d-pad reads as a full tilt and comes through the curve unchanged, which is what an arrow key is.
function steer(){
  if (!pad.connected) return 0;
  const x = Math.max(-1, Math.min(1, pad.x));
  return x ? Math.sign(x)*Math.pow(Math.abs(x), S.expo) : 0;
}
// The button that dismissed a menu must not also light the engine: thrust stays off until it is let go once.
function thrust(){ const h = pad.held('thrust'); if (lock){ if (h) return false; lock = false; } return h; }

// ---- Flight ----
// Wrapping readInput() rather than watching events puts the pad in the one place a key, a thumb or a stick already
// becomes a steer and a thrust — including lbhooks' record of which device flew the run, which reads the tick this
// call is for, so the pad has to claim it before the inner call and not after.
const _readInput = readInput;
window.readInput = function(){
  poll();
  const px = steer(), pt = pad.connected && thrust();
  if ((px || pt) && window.Thruster) window.Thruster.noteDevice();
  const inp = _readInput();
  if (pt) inp.thrust = 1;
  if (px && !inp.steer) inp.steer = Math.round(px * 15) / 15;   // a hand on the keys or the touch stick still wins
  return inp;
};

// ---- Menus ----
const buttons = () => Array.from(box.querySelectorAll('button:not([disabled])'));
function focus(el){
  if (sel) sel.classList.remove('padsel');
  sel = el || null;
  if (sel){ sel.classList.add('padsel'); sel.scrollIntoView({block:'nearest'}); }
}
function focusFirst(){ focus(box.querySelector('.btn.pri') || box.querySelector('.tile.sel') || buttons()[0]); }
// Nearest button the way the stick was pushed: how far it lies in that direction, plus a penalty for sitting off to
// the side. DOM order would do for a column of buttons, but the level grid is five wide with rows above and below it.
function nav(dx, dy){
  const all = buttons(); if (!all.length) return;
  if (!sel || !all.includes(sel)) return focus(all[0]);
  const a = sel.getBoundingClientRect(), ax = a.left + a.width/2, ay = a.top + a.height/2;
  let best = null, score = Infinity;
  for (const el of all){
    if (el === sel) continue;
    const r = el.getBoundingClientRect(), ex = r.left + r.width/2 - ax, ey = r.top + r.height/2 - ay;
    const fwd = ex*dx + ey*dy, off = Math.abs(ex*dy - ey*dx);
    if (fwd < 6 || off > fwd*2 + 60) continue;
    const s = fwd + off*2.2;
    if (s < score){ score = s; best = el; }
  }
  if (best) focus(best);
}
// A controller is invisible to the browser until one of its buttons is pressed, so an unpressed pad and no pad at
// all look the same from here. The menu says press a button rather than claiming nothing is plugged in.
function help(){
  const cols = box.querySelector('.cols');
  if (!cols || cols.querySelector('.padcol')) return;
  const d = document.createElement('div');
  d.className = 'padcol';
  d.innerHTML = '<b>Controller</b><br>Left stick or D-pad steer<br><kbd>A</kbd> <kbd>RT</kbd> thrust<br>' +
    '<kbd>Start</kbd> pause, <kbd>Back</kbd> restart<br>' +
    (live ? '<span class="ok">Controller ready</span>' : 'Press a button on it to wake it');
  cols.append(d);
}
const _openModal = openModal, _showMenu = showMenu;
window.openModal = function(html){ _openModal(html); sel = null; if (live) focusFirst(); };
window.showMenu = function(){ _showMenu(); help(); };

function act(){
  if (mode === 'play'){
    if (pad.pressed('pause')) showPause();
    else if (pad.pressed('restart')) reset();
    return;
  }
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;   // a name being typed on the board owns A too
  if (pad.pressed('up')) nav(0, -1);
  if (pad.pressed('down')) nav(0, 1);
  if (pad.pressed('navL')) nav(-1, 0);
  if (pad.pressed('navR')) nav(1, 0);
  if (pad.pressed('confirm')){
    const el = sel && box.contains(sel) ? sel : box.querySelector('.btn.pri');
    lock = true;
    if (el) el.click();
  } else if (pad.pressed('back') && mode === 'paused') play();
}

// Rumble reads the rocket rather than being called from the crash: same two moments, no hook in game.js. Most pads
// and most browsers have no motors and the call quietly does nothing, so it is something on top of what the game
// already shows, never the only telling.
function feel(){
  const st = ship ? ship.state : '';
  if (st === seenState) return;
  seenState = st;
  if (st === 'dead') pad.rumble({duration:260, strong:1, weak:0.7});
  else if (st === 'finished') pad.rumble({duration:180, strong:0.25, weak:0.5});
}

function loop(){
  poll();
  if (pad.connected){
    if (!live){ live = true; if (mode === 'menu') showMenu(); else if (mode !== 'play') focusFirst(); }
    act();
    feel();
  }
  stamp++;
  requestAnimationFrame(loop);
}
help();                                   // game.js opened the first menu before this module ran
requestAnimationFrame(loop);
