'use strict';
/* Loads the tuning and a course, then starts the game; the start screen's picker loads other courses on demand.
   A course's vehicle (courses/index.json) picks the tuning: config/flight.json is the base (the stunt plane) and
   config/<vehicle>.json goes over it for anything else. The last picked course is remembered in the game's settings.
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
  // fetch everything first, then swap tuning and rebuild in one go, so a failed load leaves the current course intact
  async function loadCourse(entry) {
    const v = entry.vehicle || 'prop';
    if (!base) base = own(await getJSON('config/flight.json').catch(() => ({})));   // missing file: defaults stay
    if (!(v in vehicles)) vehicles[v] = v === 'prop' ? {} : own(await getJSON(`config/${v}.json`));
    const course = await getJSON(entry.file);
    for (const k of Object.keys(TUNE)) delete TUNE[k];
    Object.assign(TUNE, TUNE_DEFAULTS, base, vehicles[v], { VEHICLE: v });
    buildWorld(course);
  }
  try {
    const index = await getJSON('courses/index.json');
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('skyrace.v1') || '{}').course; } catch (e) { /* no storage */ }
    const pick = index.courses.find((c) => c.id === saved);
    if (pick) await loadCourse(pick).catch(() => loadCourse(index.courses[0]));
    else await loadCourse(index.courses[0]);
    startGame({ courses: index.courses, loadCourse });
  } catch (err) {
    console.error(err);
    fatal('The course didn\u2019t load. Reload the page to try again.');
  }
})();
