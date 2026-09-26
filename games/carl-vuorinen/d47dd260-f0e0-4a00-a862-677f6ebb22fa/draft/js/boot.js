'use strict';
/* Loads the tuning and the first course, then starts the game. Courses are fetched only when flown.
   Single-file builds (the private preview) can't fetch neighbouring files, so they set window.SKYRACE_DATA
   with the same files inlined, keyed by path. */
(async function boot() {
  const fatal = (msg) => { document.body.classList.add('is-fatal'); document.getElementById('fatal-msg').textContent = msg; };
  if (typeof THREE === 'undefined' || typeof buildWorld !== 'function') { fatal('The 3D library didn\u2019t load. Check your connection and reload the page.'); return; }
  const inline = window.SKYRACE_DATA || null;
  const getJSON = async (path) => {
    if (inline) { if (!inline[path]) throw new Error(`${path}: not bundled`); return inline[path]; }
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  };
  const own = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !k.startsWith('_')));   // skip _doc notes
  try {
    Object.assign(TUNE, own(await getJSON('config/flight.json').catch(() => ({}))));   // missing file: defaults stay
    const index = await getJSON('courses/index.json');
    buildWorld(await getJSON(index.courses[0].file));
    startGame();
  } catch (err) {
    console.error(err);
    fatal('The course didn\u2019t load. Reload the page to try again.');
  }
})();
