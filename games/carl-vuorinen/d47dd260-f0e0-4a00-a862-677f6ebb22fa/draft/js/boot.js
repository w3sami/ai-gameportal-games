'use strict';
/* Loads the tuning and a course, then starts the game; the start menu (js/menu.js) loads other levels on demand.
   courses/index.json lists themes and their levels. A level's vehicle (its theme's, unless it sets its own) picks
   the tuning: config/flight.json is the base (the stunt plane) and config/<vehicle>.json goes over it for anything else.
   The last picked level is remembered in the game's settings.
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
  let base = null;
  const vehicles = {};
  // the level view's loading line, shown in place of the course texts while body.is-loading (css/menu.css)
  const courseLine = document.getElementById('start-course');
  if (courseLine) courseLine.insertAdjacentHTML('beforebegin', '<p id="level-loading">Loading\u2026</p>');
  // building a course blocks the main thread, so wait for a frame first or the loading state never gets drawn
  const painted = () => new Promise((done) => { if (document.hidden) done(); else requestAnimationFrame(() => setTimeout(done, 0)); });
  // fetch everything first, then swap tuning and rebuild in one go, so a failed load leaves the current course intact
  async function loadCourse(entry) {
    await painted();
    const v = entry.vehicle || 'prop';
    if (!base) base = own(await getJSON('config/flight.json').catch(() => ({})));   // missing file: defaults stay
    if (!(v in vehicles)) vehicles[v] = v === 'prop' ? {} : own(await getJSON(`config/${v}.json`));
    const course = await getJSON(entry.file);
    for (const k of Object.keys(TUNE)) delete TUNE[k];
    Object.assign(TUNE, TUNE_DEFAULTS, base, vehicles[v], { VEHICLE: v });
    buildWorld(Object.assign(course, { id: entry.id, name: entry.name || course.name }));   // the index's id and name win: a copied course file can't clash
  }
  try {
    const themes = Levels.themes(await getJSON('courses/index.json')), levels = Levels.all(themes);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('skyrace.v1') || '{}') || {}; } catch (e) { /* no storage */ }
    const best = saved.best && typeof saved.best === 'object' ? saved.best : {};
    const pick = levels.find((l) => l.id === saved.course && Levels.open(l, best));   // a level locked since isn't reopened
    if (pick) await loadCourse(pick).catch(() => loadCourse(levels[0]));
    else await loadCourse(levels[0]);
    startGame({ themes, loadCourse });
  } catch (err) {
    console.error(err);
    fatal('The course didn\u2019t load. Reload the page to try again.');
  }
})();
