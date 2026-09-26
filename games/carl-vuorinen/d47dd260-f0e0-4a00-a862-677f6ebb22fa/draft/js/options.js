'use strict';
/* Start-screen copies of the pause-screen toggles. game.js owns the settings and binds #opt-invert / #opt-sound
   inside startGame(); each copy (data-mirror="<id>") forwards its change to that twin and mirrors it back, so
   both screens always agree. The row stays hidden until startGame() has run (window.__ml is set), so it never
   shows stale defaults while the course loads. */
(function startOptions() {
  const row = document.getElementById('start-opts');
  if (!row) return;
  const link = () => {
    row.querySelectorAll('input[data-mirror]').forEach((el) => {
      const src = document.getElementById(el.dataset.mirror);
      if (!src) { el.closest('label').hidden = true; return; }
      const pull = () => { el.checked = src.checked; };
      el.addEventListener('change', () => { src.checked = el.checked; src.dispatchEvent(new Event('change')); });
      src.addEventListener('change', pull);
      pull();
    });
    row.hidden = false;
  };
  const wait = setInterval(() => {
    if (window.__ml) { clearInterval(wait); link(); }
    else if (document.body.classList.contains('is-fatal')) clearInterval(wait);
  }, 50);
})();
