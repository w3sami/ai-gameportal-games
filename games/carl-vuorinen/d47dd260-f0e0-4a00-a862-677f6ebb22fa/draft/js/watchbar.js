'use strict';
// The bar shown while a replay is watched (index.html #watch: the time, Show hoops, Back to menu) folds away to its
// chevron, to watch with nothing over the picture; the chevron stays where it is and points the other way. It stays
// folded or open for the next replay.
(() => {
  const bar = document.getElementById('watch'), btn = document.getElementById('btn-watch-fold');
  if (!bar || !btn) return;
  btn.addEventListener('click', () => {
    const folded = bar.classList.toggle('is-folded');
    btn.setAttribute('aria-expanded', String(!folded));
    btn.setAttribute('aria-label', folded ? 'Show the replay controls' : 'Hide the replay controls');
    btn.title = folded ? 'Show' : 'Hide';
  });
})();
