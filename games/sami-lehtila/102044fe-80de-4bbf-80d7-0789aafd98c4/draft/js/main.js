// Boot, the fixed-step loop, the hint line and fullscreen.

import { loadTune } from './tune.js';
import { ROOM } from './level.js';
import { buildWorld } from './world.js';
import { createSlime } from './slime.js';
import { createBall } from './ball.js';
import { createTrail } from './trail.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { createTuning } from './tuning.js';

const T = await loadTune();
const world = buildWorld(ROOM);
const trail = createTrail(T, world);
const slime = createSlime(T, world, trail.on);
const ball = createBall(T);
const renderer = createRenderer(document.getElementById('view'), world);
const input = createInput();

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
let last = performance.now(), acc = 0, clock = 0;
let stick = { x: 0, y: 0 };
const look = { x: 0, y: 0 };
let blinkAt = 3, blinkUntil = 0;

// window.lima in the console: drive = () => ({ x, y, ball }) steers past the controls
window.lima = { T, world, slime, ball, trail, drive: null };

// the developer's energy bar and, under it, the jump's charge, while the
// tuning panel is open
const bar = document.getElementById('energy');
function drawBar() {
  bar.hidden = !tuning.open;
  if (bar.hidden) return;
  bar.firstElementChild.style.width = (100 * ball.energy) / T.energyMax + '%';
  bar.lastElementChild.style.width = 100 * ball.charge + '%';
  bar.classList.toggle('ball', ball.on);
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;
  input.poll(dt);

  if (!input.isOpen()) {
    if (input.pressed('fullscreen')) toggleFullscreen();
    if (input.pressed('controls')) input.open(() => { last = performance.now(); });
    if (input.pressed('reset')) { slime.reset(); ball.reset(); trail.clear(); }
  }

  if (!frozen) {
    const driven = window.lima.drive?.();
    stick = driven ?? input.stick();
    const held = driven ? !!driven.ball : input.held('ball');
    acc += dt;
    while (acc >= DT) {
      ball.update(DT, held, slime.touching);
      // a pop harder than popMax is no pop at all, and a pop is paid for
      // by how hard it throws: no energy for it, no pop
      if (ball.started) {
        const pop = slime.popSpeed(stick, DT);
        if (pop > T.popMax || !ball.pay(pop * T.jumpCost)) ball.cancel();
      }
      slime.step(DT, stick, ball.on, ball, ball.charge);
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

  renderer.draw(slime, trail, T, look, clock < blinkUntil);
  drawBar();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
