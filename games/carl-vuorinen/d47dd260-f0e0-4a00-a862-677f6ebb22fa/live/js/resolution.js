'use strict';
/* =========================================================================
   RESOLUTION — adaptive render resolution. Pixel shading is most of the cost on phones, and a DPR-2 phone draws
   4x the pixels of DPR 1, so when frames run slow the pixel ratio steps down (x0.85 a step, never below 1 on
   high-DPR screens, 0.75 on DPR-1 ones) and steps back up when there's room.
   Measures the real frame interval (requestAnimationFrame timestamps), not JavaScript time: GPU work doesn't show
   in performance.now() around render(). Decides on 1.5 s windows after a 1.5 s settle: two slow windows in a row
   to step down, three fast ones to step up, so a hitch doesn't count.
   Frames only come at whole vsync steps (16.7, 33.3 ms...), so one step down may not show; it keeps stepping, up to
   three steps (about 60% fewer pixels), until frames get faster. If they never do (a browser capped at 30 fps) it
   goes back to where it started and waits before trying again, longer each time. When the JavaScript alone takes
   most of the frame, the CPU is the limit and fewer pixels won't help, so it doesn't try. A step up that makes
   frames slow again is undone at once and not retried for a while (longer each time).
   createResolution(renderer) -> { ratio(), frame(now, cpuMs), lock(on), state }; js/game.js calls frame() every
   frame (cpuMs: the last frame's update + render JavaScript time) and uses ratio() when it sizes the canvas.
   ========================================================================= */
function createResolution(renderer) {
  const SLOW = 1000 / 48, FAST = 1000 / 57;                 // ms: step down above SLOW, up below FAST
  const STEP = 0.85, CHAIN = 3, WINDOW = 90, SETTLE = 90, IMPROVE = 0.92;
  const base = () => Math.min(window.devicePixelRatio || 1, 2);   // what js/game.js always used
  const st = { scale: 1, phase: 'settle', n: 0, sum: 0, cpu: 0, slowRuns: 0, fastRuns: 0, chain: null, raised: false,
               holdUntil: 0, holdLen: 60000, noRaiseUntil: 0, raiseHold: 60000, locked: false, last: 0, mean: 0 };
  const minScale = () => (base() > 1 ? 1 : 0.75) / base();
  const ratio = () => base() * st.scale;
  function set(scale, phase) {
    st.scale = clamp(scale, minScale(), 1);
    renderer.setPixelRatio(ratio());
    st.phase = phase; st.n = 0; st.sum = 0; st.cpu = 0; st.slowRuns = 0; st.fastRuns = 0;
  }
  function frame(now, cpuMs = 0) {
    const dt = st.last ? now - st.last : 0;
    st.last = now;
    if (st.locked || !(dt > 0) || dt > 100) return;          // first frame, tab switches, load hitches
    st.n++; st.sum += dt; st.cpu += cpuMs;
    if (st.phase === 'settle') { if (st.n >= SETTLE) { st.phase = 'measure'; st.n = 0; st.sum = 0; st.cpu = 0; } return; }
    if (st.n < WINDOW) return;
    const mean = st.mean = st.sum / st.n, cpu = st.cpuMean = st.cpu / st.n;
    st.n = 0; st.sum = 0; st.cpu = 0;
    if (st.raised) {                                         // just stepped up: still fast enough?
      st.raised = false;
      if (mean > SLOW) { st.noRaiseUntil = now + st.raiseHold; st.raiseHold = Math.min(st.raiseHold * 2, 300000); set(st.scale * STEP, 'settle'); return; }
      st.raiseHold = 60000;
    }
    const c = st.chain;
    if (c) {                                                 // stepping down: faster yet?
      if (mean <= c.before * IMPROVE) { st.chain = null; st.holdLen = 60000; st.noRaiseUntil = now + 30000; return; }
      if (c.steps < CHAIN && st.scale > minScale() + 1e-6) { c.steps++; set(st.scale * STEP, 'settle'); return; }
      st.chain = null;                                       // never helped: not a pixel problem; undo and wait
      st.holdUntil = now + st.holdLen; st.holdLen = Math.min(st.holdLen * 2, 300000);
      set(c.from, 'settle');
      return;
    }
    if (now < st.holdUntil) return;
    if (mean > SLOW && st.scale > minScale() + 1e-6 && cpu < mean * 0.6) {
      if (++st.slowRuns >= 2) { st.chain = { before: mean, from: st.scale, steps: 1 }; set(st.scale * STEP, 'settle'); }
    } else if (mean < FAST && st.scale < 1 && now >= st.noRaiseUntil) {
      st.slowRuns = 0;
      if (++st.fastRuns >= 3) { set(st.scale / STEP, 'settle'); st.raised = true; }
    } else { st.slowRuns = 0; st.fastRuns = 0; }
  }
  function lock(on) {                                         // on: back to full resolution and stop adapting
    st.locked = !!on; st.chain = null;
    if (on && st.scale !== 1) set(1, 'settle');
  }
  return { ratio, frame, lock, state: st };
}
