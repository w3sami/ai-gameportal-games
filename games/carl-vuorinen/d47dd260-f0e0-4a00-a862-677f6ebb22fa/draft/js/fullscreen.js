'use strict';
/* Full screen buttons (start and pause panels) and the F key. The buttons stay hidden where the browser or the
   embedding page doesn't allow full screen, e.g. iPhone Safari or a frame without allow="fullscreen".
   On phones, entering full screen also asks to hold landscape (Android Chrome allows it; others refuse quietly). */
(function fullscreen() {
  const root = document.documentElement;
  if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) return;   // buttons keep `hidden`
  const current = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const toggle = () => {
    const d = document;
    const call = current() ? (d.exitFullscreen || d.webkitExitFullscreen) : (root.requestFullscreen || root.webkitRequestFullscreen);
    if (!call) return;
    try { Promise.resolve(call.call(current() ? d : root)).catch(() => {}); } catch (e) { /* refused: nothing to undo */ }
  };
  const sync = () => {
    const on = !!current();
    document.body.classList.toggle('is-fullscreen', on);
    if (on && document.body.classList.contains('is-touch') && screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  };
  document.querySelectorAll('.fs-btn').forEach((b) => { b.hidden = false; b.addEventListener('click', toggle); });
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.tagName === 'INPUT') return;
    toggle();
  });
  sync();
})();
