'use strict';
/* Control extras that live outside game.js (so it doesn't have to be re-sent for small changes):
   - Invert pitch is on by default. A first-time viewer (no saved settings) gets { invertPitch: true } seeded into
     the settings store before startGame() reads it; game.js's own default still says false. Returning players
     keep whatever they have saved.
   - The left mouse button boosts once the mouse is flying (pointer locked, or steering by cursor); the click that
     takes the mouse doesn't. mousedown rather than pointerdown: a second button pressed while another is held
     only fires pointermove. Released by mouseup only; game.js's pause/blur boostEnd() clears it like any other boost.
   - body.pitch-inv follows the option so control texts swap their up/down wording (css/courses.css). */
(function controls() {
  const STORE_KEY = 'skyrace.v1', OLD_STORE_KEY = 'magenta-line.v1';   // same keys as game.js
  const body = document.body;
  let inv = true;
  try {
    const saved = localStorage.getItem(STORE_KEY) || localStorage.getItem(OLD_STORE_KEY);
    if (saved) inv = !!JSON.parse(saved).invertPitch;
    else localStorage.setItem(STORE_KEY, JSON.stringify({ invertPitch: true }));
  } catch (e) { inv = false; /* no storage: game.js defaults apply */ }
  body.classList.toggle('pitch-inv', inv);                  // right from the loading screen, before startGame()

  const link = (ml) => {
    const { input, G, settings } = ml, canvas = document.getElementById('scene'), invertEl = document.getElementById('opt-invert');
    body.classList.toggle('pitch-inv', !!settings.invertPitch);
    if (invertEl) invertEl.addEventListener('change', () => body.classList.toggle('pitch-inv', invertEl.checked));
    const end = () => { if (input.boost.id === 'mouse') { input.boost.active = false; input.boost.id = -1; } };
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || G.state !== 'playing' || input.device !== 'mouse' || input.boost.active) return;
      if (!input.mouse.locked && !input.mouse.lockFailed) return;
      input.boost.active = true; input.boost.id = 'mouse';
    });
    // Release comes from mouseup alone. Under pointer lock every mouse event goes to the canvas and bubbles here, and
    // unlocked the press started on the page, so its mouseup arrives even off the window. Movement is no evidence of a
    // release: some browsers report buttons as 0 on moves under pointer lock, which cut the boost on every steer.
    // Losing the window or the lock clears it anyway (blur, and pause() via boostEnd()).
    window.addEventListener('mouseup', (e) => { if (e.button === 0) end(); });
  };
  const wait = setInterval(() => {
    if (window.__ml) { clearInterval(wait); link(window.__ml); }
    else if (body.classList.contains('is-fatal')) clearInterval(wait);
  }, 50);
})();
