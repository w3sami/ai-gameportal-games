// Boot, the levels one after another, the fixed-step loop, the run's clock
// and messages, the hint line and fullscreen.
//
// Each level gets a world, a slime, a ball, a trail and its rules of its
// own (load()). ?level=2 in the address starts at level 2.

import { loadTune } from './tune.js';
import { LEVELS } from './level.js';
import { buildWorld } from './world.js';
import { createSlime } from './slime.js';
import { createBall } from './ball.js';
import { createTrail } from './trail.js';
import { createGame } from './game.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { createTuning } from './tuning.js';

const T = await loadTune();
const renderer = createRenderer(document.getElementById('view'), T);
const input = createInput();

let level = 0, world, trail, slime, ball, game;
function load(i) {
  level = Math.max(0, Math.min(LEVELS.length - 1, i));
  world = buildWorld(LEVELS[level], T);
  trail = createTrail(T, world);
  // the slime's events go to the trail, and a pad's throw also to the game
  slime = createSlime(T, world, (type, e) => { trail.on(type, e); if (type === 'pad') game.pad(e); });
  ball = createBall(T);
  game = createGame(T, world, slime, ball, trail);
  renderer.setWorld(world);
  game.say(`${level + 1}. ${LEVELS[level].name}`, 2.5);
  if (window.lima) Object.assign(window.lima, { world, slime, ball, trail, game, level });
}
load((parseInt(new URLSearchParams(location.search).get('level'), 10) || 1) - 1);

let frozen = false;
const tuning = createTuning(T, { onPause: (on) => { frozen = on ?? !frozen; last = performance.now(); } });

// ---- fullscreen -----------------------------------------------------------------

// Safari on iPhone has no fullscreen for pages, so the button hides there.
const fsButton = document.getElementById('fs');
fsButton.hidden = !document.fullscreenEnabled;
// corner brackets pointing out (enter) or in (leave); drawn, since no font has them all
const FS_ICON = {
  enter: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  leave: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>',
};
fsButton.innerHTML = FS_ICON.enter;
function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
fsButton.addEventListener('click', () => { toggleFullscreen(); fsButton.blur(); });
document.addEventListener('fullscreenchange', () => {
  fsButton.innerHTML = document.fullscreenElement ? FS_ICON.leave : FS_ICON.enter;
});

// ---- loop -----------------------------------------------------------------------

const DT = 1 / 60;
const CHARGE_MARGIN = 0.9;    // a charge stops building this far short of the most a jump may be
const RESTART_HOLD = 1;       // s of holding reset that starts the whole level again
let last = performance.now(), acc = 0, clock = 0;
let stick = { x: 0, y: 0 };
const look = { x: 0, y: 0 };
let blinkAt = 3, blinkUntil = 0, resetHeld = 0;

// window.lima in the console: drive = () => ({ x, y, ball }) steers past
// the controls, load(i) starts level i (from 0)
window.lima = { T, world, slime, ball, trail, game, level, load, drive: null };

// the developer's bar while the tuning panel is open: health (yellow while
// a ball), and the jump's charge along its bottom
const bar = document.getElementById('devbar');
function drawBar() {
  bar.hidden = !tuning.open;
  if (bar.hidden) return;
  bar.firstElementChild.style.width = 100 * game.health + '%';
  bar.lastElementChild.style.width = 100 * ball.charge + '%';
  bar.classList.toggle('ball', ball.on);
}

// the run's clock, and what the level has to say
const timeEl = document.getElementById('time'), msgEl = document.getElementById('msg');
const clockText = (t) => Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0');
function drawHud() {
  timeEl.textContent = clockText(game.time);
  timeEl.classList.toggle('done', game.finished);
  const next = level + 1 < LEVELS.length ? ' · A: seuraava kenttä' : '';
  const text = game.finished ? 'Maali! ' + clockText(game.time) + next + ' · R: uudestaan' : game.message;
  if (msgEl.textContent !== text) msgEl.textContent = text;
  msgEl.hidden = !text;
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;
  input.poll(dt);

  if (!input.isOpen()) {
    if (input.pressed('fullscreen')) toggleFullscreen();
    if (input.pressed('controls')) input.open(() => { last = performance.now(); });
    // at the exit, the ball button goes on to the next level
    if (game.finished && input.pressed('ball') && level + 1 < LEVELS.length) load(level + 1);
    // reset: a press goes back to the last checkpoint, a long hold (or any
    // press once at the exit) starts the level over
    if (input.pressed('reset')) {
      if (game.finished) game.restart(); else game.toCheckpoint();
      resetHeld = 0;
    } else if (input.held('reset')) {
      resetHeld += dt;
      if (resetHeld >= RESTART_HOLD && resetHeld - dt < RESTART_HOLD) game.restart();
    }
  }

  if (!frozen) {
    const driven = window.lima.drive?.();
    stick = driven ?? input.stick();
    const held = driven ? !!driven.ball : input.held('ball');
    acc += dt;
    while (acc >= DT) {
      // a dying slime sags where it is, with nothing steering it
      if (game.dead) {
        slime.step(DT, { x: 0, y: 0 });
        game.update(DT);
        trail.update(DT);
        acc -= DT;
        continue;
      }
      ball.update(DT, held, slime.touching);
      // a charge stops building short of a jump popMax would not allow
      if (ball.charging && ball.charge > 0 && slime.popSpeed(stick, DT) > CHARGE_MARGIN * T.popMax) ball.stall(DT);
      // A charged release always jumps: a pop harder than popMax is capped
      // to it. An uncharged press that would pop harder than popMax (a slime
      // squeezed into a corner) does not jump at all.
      if (ball.started) {
        const pop = slime.popSpeed(stick, DT);
        if (pop > T.popMax) { if (ball.charged) slime.capPop(T.popMax); else ball.cancel(); }
      }
      slime.step(DT, stick, ball.on, ball.charge);
      game.update(DT);
      trail.update(DT);
      acc -= DT;
    }
  }

  // eyes follow the stick, or the motion when the stick is let go
  const v = slime.velocity(), sp = Math.hypot(v.x, v.y);
  const want = Math.hypot(stick.x, stick.y) > 0.2 ? stick : sp > 1 ? { x: v.x / sp, y: v.y / sp } : { x: 0, y: 0 };
  const k = 1 - Math.exp(-10 * dt);
  look.x += (want.x - look.x) * k; look.y += (want.y - look.y) * k;
  if (clock > blinkAt) { blinkUntil = clock + 0.12; blinkAt = clock + 2.5 + Math.random() * 3; }

  renderer.draw(slime, trail, game, look, clock < blinkUntil, clock, dt);
  drawBar();
  drawHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
