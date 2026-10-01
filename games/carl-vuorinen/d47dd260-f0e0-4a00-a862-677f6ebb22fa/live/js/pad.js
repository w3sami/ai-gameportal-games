// Controller support, through the portal's gamepad plugin. The plugin is an ES module and the game is classic scripts,
// so this module is the bridge. game.js only knows input.pad (a second touch stick, already shaped) and runs the hook
// this registers at the top of every frame, so the pad is read immediately before the physics that uses it and exactly
// once per frame (pressed() is the difference between two polls). Menus are driven by clicking the game's own buttons,
// so the pause screen's "are you sure" and the menu's locked levels behave exactly as they do under a mouse.
// If the plugin fails to load this never runs, and the game plays as before with touch, mouse and keys.
import { createGamepad } from 'https://plugins.game.bigbools.fi/gamepad/v1/index.js';

// Pad sources only: the game has its own keydown handling, so letting the plugin read keys too would count them twice.
// A is boost in flight and confirm in a menu; the two never overlap.
const pad = createGamepad({
  keys: false,
  actions: {
    boost: ['A', 'RT'],
    pause: ['Start'],
    restart: ['Back', 'Y'],
    confirm: ['A'],
    back: ['B'],
  },
});

// Same curve as the touch stick (game.js shapeAxis, expo 1.7). The plugin has already scaled its radial dead zone out;
// vertical gets a little extra of its own, as on touch, so a sideways push for a turn doesn't also climb.
const EXPO = 1.7, DZ_Y = 0.1;
const expo = (v) => Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), EXPO);
const shapeY = (v) => { const a = Math.abs(v); return a < DZ_Y ? 0 : expo(Math.sign(v) * (a - DZ_Y) / (1 - DZ_Y)); };

const $ = (id) => document.getElementById(id);
const shown = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
const click = (id) => { const el = $(id); if (shown(el) && !el.disabled) { el.click(); return true; } return false; };

function panel() { return ['board', 'start', 'pause', 'finish', 'watch'].map($).find(shown) || null; }   // watch: the replay's bar
function targets(p) { return Array.from(p.querySelectorAll('button:not([disabled]), input[type="checkbox"]')).filter(shown); }
function focus(el) { if (el) el.focus({ preventScroll: true }); }
function current(p) { const a = document.activeElement; return a && p.contains(a) && targets(p).includes(a) ? a : null; }
function fallback(p) { const t = targets(p); return t.find((el) => el.classList.contains('primary')) || t.find((el) => el.getAttribute('aria-pressed') === 'true') || t[0]; }

// Nearest control the way the stick was pushed: distance in that direction plus a penalty for sitting off to the side.
// DOM order would do for a column of buttons, but the theme and level cards sit in rows with buttons below them.
function nav(dx, dy) {
  const p = panel(); if (!p) return;
  const all = targets(p), sel = current(p);
  if (!sel) { focus(fallback(p)); return; }
  const a = sel.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, score = Infinity;
  for (const el of all) {
    if (el === sel) continue;
    const r = el.getBoundingClientRect(), ex = r.left + r.width / 2 - ax, ey = r.top + r.height / 2 - ay;
    const fwd = ex * dx + ey * dy, off = Math.abs(ex * dy - ey * dx);
    if (fwd < 6 || off > fwd * 2 + 60) continue;
    const s = fwd + off * 2.2;
    if (s < score) { score = s; best = el; }
  }
  if (best) focus(best);
}

function confirm() {
  const p = panel(); if (!p) return;
  const el = current(p) || fallback(p);
  if (el) { focus(el); el.click(); }
}
function back(state) {
  if (state === 'attract') { if (shown($('board'))) click('btn-board-back'); else if ($('start').dataset.view === 'levels') click('btn-themes'); }
  else if (state === 'paused') { if (!click('btn-confirm-no')) click('btn-resume'); }
  else if (state === 'finished') click('btn-menu');
  else if (state === 'replay') click('btn-watch-exit');
}
function start(state) {
  if (state === 'playing') click('btn-pause');
  else if (state === 'paused') { if (!shown($('pause-confirm'))) click('btn-resume'); }
  else if (state === 'attract' && $('start').dataset.view === 'levels') { if (!click('btn-start')) confirm(); }
  else confirm();
}

// Menu direction from the stick and d-pad together (the plugin folds the d-pad into x/y): a step on the push, then a
// repeat while it's held, the way a held arrow key moves through a list.
const REPEAT_WAIT = 0.4, REPEAT_EVERY = 0.14;
const menuDir = { dx: 0, dy: 0, t: 0 };
function menuNav(dt) {
  const dx = Math.abs(pad.x) > 0.5 && Math.abs(pad.x) >= Math.abs(pad.y) ? Math.sign(pad.x) : 0;
  const dy = !dx && Math.abs(pad.y) > 0.5 ? Math.sign(pad.y) : 0;
  if (dx !== menuDir.dx || dy !== menuDir.dy) {
    Object.assign(menuDir, { dx, dy, t: REPEAT_WAIT });
    if (dx || dy) nav(dx, dy);
  } else if (dx || dy) {
    menuDir.t -= dt;
    if (menuDir.t <= 0) { menuDir.t = REPEAT_EVERY; nav(dx, dy); }
  }
}

function run(api) {
  const inp = api.input.pad;
  let boostLock = false, wasCrashing = false, lastHoop = 0, lastState = api.state;
  api.onFrame((dt) => {
    pad.poll();
    const state = api.state;
    if (!pad.connected) { inp.x = inp.y = 0; inp.boost = false; lastState = state; return; }
    const any = pad.pressedAny(), moved = Math.abs(pad.x) > 0.25 || Math.abs(pad.y) > 0.25;
    if (any || moved) api.setDevice('pad');

    if (state === 'playing') {
      inp.x = expo(pad.x); inp.y = shapeY(-pad.y);
      // the A that pressed Start flight (or Resume) mustn't also burn boost: it waits until A has been let go once
      const b = pad.held('boost');
      if (boostLock && !b) boostLock = false;
      inp.boost = b && !boostLock;
      if (pad.pressed('pause')) { inp.x = inp.y = 0; inp.boost = false; start(state); }
      else if (pad.pressed('restart')) api.restart();
    } else {
      inp.x = inp.y = 0; inp.boost = false;
      const p = panel();
      if (p && (any || moved) && !current(p)) focus(fallback(p));      // first touch of the pad shows where it is
      else if (p) menuNav(dt);
      if (pad.pressed('confirm')) { boostLock = true; confirm(); }
      else if (pad.pressed('pause')) { boostLock = true; start(state); }
      else if (pad.pressed('back')) back(state);
      else if (pad.pressed('restart') && state !== 'attract') { boostLock = true; api.restart(); }
    }
    feel(api, state);
    lastState = state;
  });

  // Rumble reads the run rather than being called from it: most pads and browsers have no motors and the call quietly
  // does nothing, so it's only ever on top of what the screen and the sound already say.
  function feel(api, state) {
    const crashing = api.crashing, hoop = api.hoop;
    if (state === 'playing' && api.input.device === 'pad') {
      if (crashing && !wasCrashing) pad.rumble({ duration: 260, strong: 1, weak: 0.7 });
      else if (hoop > lastHoop) pad.rumble({ duration: 60, strong: 0, weak: 0.35 });
    }
    if (state === 'finished' && lastState === 'playing' && api.input.device === 'pad') pad.rumble({ duration: 180, strong: 0.25, weak: 0.5 });
    wasCrashing = crashing; lastHoop = hoop;
  }
}

// game.js starts once the first course has loaded, which may be after this module has arrived
(function wait() { if (window.Skyrace) run(window.Skyrace); else setTimeout(wait, 50); })();
