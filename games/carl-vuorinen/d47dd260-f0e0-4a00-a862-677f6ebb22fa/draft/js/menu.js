'use strict';
/* Start menu: pick a theme first (each has its own aircraft; all are open), then one of that theme's levels.
   Level 1 of every theme is open; each later level opens once the one before it has been finished (has a best time).
   Levels: shared helpers, also used by js/boot.js to pick the first course. createMenu(ctx) runs inside startGame()
   (js/game.js), which passes in what the menu needs; game.js keeps the course texts and the Start button. */
const Levels = {
  // courses/index.json -> themes whose levels know their theme, position and vehicle.
  // The older flat { courses: [...] } format still reads, as one single-level theme per course.
  themes(index) {
    const src = index.themes || (index.courses || []).map((c) => ({ id: c.id, name: c.name, vehicle: c.vehicle, levels: [c] }));
    return src.map((t) => {
      const theme = Object.assign({}, t, { vehicle: t.vehicle || 'prop' });
      theme.levels = (t.levels || []).map((l, i) => Object.assign({ vehicle: theme.vehicle }, l, { theme, n: i }));
      return theme;
    }).filter((t) => t.levels.length);
  },
  all: (themes) => themes.flatMap((t) => t.levels),
  done: (level, best) => best[level.id] != null,
  open: (level, best) => level.n === 0 || best[level.theme.levels[level.n - 1].id] != null,
};

function createMenu(ctx) {
  const $ = (id) => document.getElementById(id);
  const panel = $('start'), themeEl = $('theme-pick'), levelEl = $('course-pick');
  const levels = Levels.all(ctx.themes);
  const current = () => levels.find((l) => l.id === ctx.courseId()) || levels[0];
  let view = 'themes', theme = null, pending = null;          // pending: a picked level that's still loading
  const LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';

  const focus = (el) => { if (el) setTimeout(() => el.focus({ preventScroll: true }), 30); };
  function card(title, meta, pressed) {
    const b = document.createElement('button'), t = document.createElement('b'), m = document.createElement('span');
    b.type = 'button'; b.className = 'pick'; b.setAttribute('aria-pressed', String(pressed));
    t.textContent = title; m.textContent = meta;
    b.append(t, m);
    return b;
  }
  // the level a theme opens on: the one being flown if it's in this theme, else the first open unfinished one
  function entryLevel(t) {
    const cur = current(), best = ctx.best();
    if (cur.theme === t) return cur;
    return t.levels.find((l) => Levels.open(l, best) && !Levels.done(l, best)) || t.levels[t.levels.length - 1];
  }
  function load(level) {
    if (level.id === ctx.courseId()) { pending = null; render(); return; }
    pending = level; render();
    Promise.resolve(ctx.load(level)).finally(() => { if (pending === level) pending = null; render(); });
  }

  function render() {
    const best = ctx.best(), cur = current(), t = theme || cur.theme, selId = (pending || cur).id;
    panel.dataset.view = view;
    themeEl.replaceChildren(...ctx.themes.map((th) => {
      const done = th.levels.filter((l) => Levels.done(l, best)).length;
      const b = card(th.name, ctx.vehicleName(th.vehicle), th === cur.theme), n = document.createElement('i');
      n.className = 'pick-count' + (done === th.levels.length ? ' is-full' : '');
      n.textContent = `${done}/${th.levels.length}`;
      n.title = `${done} of ${th.levels.length} level${th.levels.length > 1 ? 's' : ''} finished`;
      b.append(n); b.dataset.theme = th.id;
      b.addEventListener('click', () => pickTheme(th));
      return b;
    }));
    $('level-theme').textContent = t.name;
    $('level-vehicle').textContent = ctx.vehicleName(t.vehicle);
    levelEl.replaceChildren(...t.levels.map((l) => {
      const open = Levels.open(l, best), b = best[l.id];
      const btn = card(l.name, !open ? 'Locked' : b != null ? `Best ${ctx.fmtTime(b)}` : 'Not flown yet', l.id === selId);
      const n = document.createElement('i'); n.className = 'pick-n'; n.textContent = l.n + 1;
      btn.prepend(n); btn.classList.add('level');
      if (!open) { btn.disabled = true; btn.classList.add('is-locked'); btn.lastChild.insertAdjacentHTML('afterbegin', LOCK); }
      btn.addEventListener('click', () => pickLevel(l));
      return btn;
    }));
    const start = $('btn-start');
    if (start) start.disabled = cur.theme !== t;             // a failed load left another theme's course in place
  }
  function show(v) {
    view = v;
    if (v === 'levels' && !theme) theme = current().theme;
    render();
    focus(v === 'levels' ? $('btn-start') : themeEl.querySelector('[aria-pressed="true"]'));
  }
  function pickTheme(t) {
    if (!ctx.isMenu()) return;
    theme = t;
    const l = entryLevel(t);
    show('levels');
    load(l);
  }
  function pickLevel(l) {
    if (!ctx.isMenu() || !Levels.open(l, ctx.best())) return;
    load(l);
    focus($('btn-start'));
  }
  // finish screen: offer the theme's next level. Returns a note for the results text and which button to focus.
  function onFinish(firstClear) {
    const cur = current(), nx = cur.theme.levels[cur.n + 1] || null;
    const next = $('btn-next'), again = $('btn-again');
    if (next) { next.hidden = !nx; next.classList.toggle('primary', !!nx); }
    again.classList.toggle('primary', !nx || !next);
    return { note: nx && firstClear ? `Level ${nx.n + 1}, ${nx.name}, is now open.` : '', focus: nx && next ? 'btn-next' : 'btn-again' };
  }
  const nextBtn = $('btn-next');
  if (nextBtn) nextBtn.addEventListener('click', () => {
    const cur = current(), nx = cur.theme.levels[cur.n + 1];
    if (!nx) return;
    ctx.toMenu();
    theme = nx.theme; show('levels');
    pickLevel(nx);
  });
  $('btn-themes').addEventListener('click', () => show('themes'));
  window.addEventListener('keydown', (e) => {
    if (view !== 'levels' || !ctx.isMenu() || (e.code !== 'Escape' && e.code !== 'Backspace')) return;
    e.preventDefault(); show('themes');
  });

  return {
    render, show, onFinish,
    get view() { return view; },
    canStart: () => view === 'levels' && current().theme === (theme || current().theme),
  };
}
