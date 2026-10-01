// Leaderboards, through the portal's leaderboard plugin: fastest times per course, each carrying its run (js/ghost.js's
// compact form fits one in an entry's 2 kB), so anyone's time on the board can be raced as a ghost or watched as a replay.
// An ES module like js/pad.js: where the plugin can't load (a copy of the game served somewhere else) this never runs,
// the Leaderboard button stays hidden, and the rest of the game is unchanged.
//   Board BOARD, level '<theme>-<level>-<course id>' ('1-1-valley', '6-3-fairgrounds': the portal lists levels in that
//   order, and the id names the level; a level name takes only lowercase letters, numbers and dashes), score = the
//   finish time in ms (lower is better: the board is set to sort asc, with these levels' titles, by configure_leaderboard).
//   The numbers are the menu's order, so moving a level moves its scores to another key: give it the old one then.
//   data = { v, k, g }: v the format, k the course's fingerprint (Ghost.key; a run on gates since moved can't be flown
//   against), g the run (Ghost.packLite), left out if it wouldn't fit.
// A finish is posted when it beats the time this browser last posted for the course (so the board isn't filled with one
// player's every run); one that couldn't be sent waits in storage and goes with the next finish or board visit.
import { submit, top, getName, setName } from 'https://plugins.game.bigbools.fi/leaderboard/v1/index.js';

const BOARD = 'fastest-pilots', FORMAT = 1, DATA_MAX = 2000, SHOW = 50;
const levelOf = (course) => { const [t, l] = course.place; return `${t}-${l}-${course.id}`; };
const POSTED_KEY = 'skyrace.posted', PENDING_KEY = 'skyrace.pending';
const $ = (id) => document.getElementById(id);
const body = document.body;

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* best effort */ } },
};
// this browser's best posted time per course: { [id]: { k, ms, entry } }
const posted = () => store.get(POSTED_KEY) || {};
function markPosted(id, k, ms, entry) { const p = posted(); p[id] = { k, ms, entry }; store.set(POSTED_KEY, p); }
function beatsPosted(id, k, ms) { const p = posted()[id]; return !p || p.k !== k || ms < p.ms; }

async function entryData(key, track) {
  const g = track ? await Ghost.packLite(track, DATA_MAX - 60) : null;
  const d = { v: FORMAT, k: key };
  if (g) d.g = g;
  return JSON.stringify(d).length <= DATA_MAX ? d : { v: FORMAT, k: key };
}

function run(api) {
  const fmt = (ms) => api.fmtTime(ms / 1000);
  const note = $('finish-board'), nameRow = $('finish-name'), nameIn = $('finish-name-input');
  let waiting = null;                                       // a finish held back for a name: { id, k, ms, data }
  let lastState = api.state;

  function say(el, text) { el.textContent = text; el.hidden = !text; }
  // keys typed into a name box are the box's: not R for restart, Esc for the menu or Backspace for back
  for (const el of [nameIn, $('board-name-input')]) el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); (el === nameIn ? postWaiting : saveBoardName)(); }
  });

  async function post(p) {
    const r = await submit({ board: BOARD, level: p.level, score: p.ms, data: p.data });
    if (r.kept) { markPosted(p.id, p.k, p.ms, r.entry && r.entry.id); store.set(PENDING_KEY, null); }
    else if (r.reason === 'full') { markPosted(p.id, p.k, p.ms, null); store.set(PENDING_KEY, null); }
    else if (r.reason === 'busy' || r.reason === 'offline' || r.reason === 'server') store.set(PENDING_KEY, p);   // try again later
    else store.set(PENDING_KEY, null);                      // the game's own bug: already on the console
    return r;
  }
  function result(r) {
    if (r.kept) return `On the leaderboard: ${r.rank} of ${r.total}.`;
    if (r.reason === 'full') return `Not in the top ${r.total || 100} this time.`;
    if (r.reason === 'busy' || r.reason === 'offline' || r.reason === 'server') return 'Couldn\u2019t reach the leaderboard. Your time goes up next time.';
    return 'Couldn\u2019t post this time.';
  }

  // ---- a finish ----
  api.onFinish(async ({ id, key, time, track }) => {
    const ms = Math.round(time * 1000);
    say(note, ''); nameRow.hidden = true; waiting = null;
    if (!beatsPosted(id, key, ms)) return;
    const p = { id, level: levelOf(api.course), k: key, ms, data: await entryData(key, track) };
    if (!getName()) {                                       // first post: ask for a name, beside the results
      waiting = p;
      say(note, 'Put your time on the leaderboard:');
      nameRow.hidden = false;
      return;
    }
    say(note, 'Posting your time\u2026');
    const r = await post(p);
    if (api.state === 'finished') say(note, result(r));
  });
  async function postWaiting() {
    const name = setName(nameIn.value);
    if (!name || !waiting) return;
    const p = waiting; waiting = null;
    nameRow.hidden = true; say(note, 'Posting your time\u2026');
    const r = await post(p);
    if (api.state === 'finished') say(note, result(r));
  }
  $('btn-finish-post').addEventListener('click', postWaiting);

  // ---- the board ----
  const list = $('board-list'), status = $('board-status');
  let shownFor = null;
  function open() {
    if (api.state !== 'attract') return;
    body.classList.add('show-board');
    refresh();
  }
  function close() {
    body.classList.remove('show-board');
    const b = $('btn-board'); if (b) b.focus({ preventScroll: true });
  }
  async function refresh() {
    const id = api.course.id, key = api.course.key;
    shownFor = id;
    $('board-course').textContent = api.course.name;
    renderMe();
    say(status, 'Loading\u2026'); list.replaceChildren();
    const pend = store.get(PENDING_KEY);
    if (pend && getName()) await post(pend);
    const { entries, reason } = await top({ board: BOARD, level: levelOf(api.course), limit: 100 });
    if (shownFor !== id || !body.classList.contains('show-board')) return;
    if (reason) { say(status, 'Couldn\u2019t load the leaderboard.'); return; }
    // one row per name (its best), so one player's many runs don't push everyone else off the page
    const seen = new Set(), rows = [];
    for (const e of entries) { const n = (e.name || '').toLowerCase(); if (seen.has(n)) continue; seen.add(n); rows.push(e); if (rows.length >= SHOW) break; }
    say(status, rows.length ? '' : 'No times yet. Fly it and be the first.');
    const mine = (posted()[id] || {}).entry;
    list.replaceChildren(...rows.map((e, i) => row(e, i + 1, key, e.id === mine)));
    const first = list.querySelector('button') || $('btn-board-back');
    first.focus({ preventScroll: true });
  }
  function row(e, rank, key, mine) {
    const li = document.createElement('li'), d = e.data || {};
    li.className = 'board-row' + (mine ? ' is-mine' : '') + (rank <= 3 ? ' is-top' : '');
    const r = document.createElement('span'), n = document.createElement('span'), t = document.createElement('span');
    r.className = 'board-rank'; r.textContent = rank;
    n.className = 'board-name'; n.textContent = e.name;       // (typed by players: textContent only)
    t.className = 'board-time'; t.textContent = fmt(e.score);
    li.append(r, n, t);
    const who = `${e.name}, ${fmt(e.score)}`;
    if (d.g && d.k === key) {                               // flown on these gates: race it, watch it
      const acts = document.createElement('span'); acts.className = 'board-acts';
      acts.append(action('Race', `Race ${who}`, (tr) => api.race(tr, `${e.name}\u2019s ${fmt(e.score)}`), d.g),
                  action('Watch', `Watch ${who}`, (tr) => api.watch(tr, `${e.name} ${fmt(e.score)}`), d.g));
      li.append(acts);
    }
    return li;
  }
  function action(label, title, go, g) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn small'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title);
    b.addEventListener('click', async () => {
      b.disabled = true;
      const tr = await Ghost.unpackLite(g);
      b.disabled = false;
      if (tr) go(tr); else say(status, 'That run couldn\u2019t be read in this browser.');
    });
    return b;
  }
  function renderMe() {
    const n = getName();
    $('board-me-text').textContent = n ? `Posting as ${n}` : 'Your times go up under a name you choose.';
    $('btn-board-name').textContent = n ? 'Change name' : 'Set name';
    $('board-name-form').hidden = true;
  }
  function saveBoardName() {
    const n = setName($('board-name-input').value);
    if (n) renderMe();
  }
  $('btn-board-name').addEventListener('click', () => {
    const f = $('board-name-form'), inp = $('board-name-input');
    f.hidden = false; inp.value = getName(); inp.focus();
  });
  $('btn-board-name-save').addEventListener('click', saveBoardName);
  $('btn-board').addEventListener('click', open);
  $('btn-board-back').addEventListener('click', close);
  // Esc or Backspace closes the board, before the menu's own Esc (which would go back to the courses) sees it
  window.addEventListener('keydown', (e) => {
    if (!body.classList.contains('show-board') || api.state !== 'attract') return;
    if (e.code !== 'Escape' && e.code !== 'Backspace') return;
    if (e.target && e.target.tagName === 'INPUT') return;
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation(); close();
  }, true);

  api.onFrame(() => {                                       // back from a race or a replay: the board again, as it was
    const s = api.state;
    if (s !== lastState) {
      if (s === 'playing') { say(note, ''); nameRow.hidden = true; waiting = null; }
      if (s === 'attract' && body.classList.contains('show-board')) refresh();
      lastState = s;
    }
  });
  $('btn-board').hidden = false;
  const pend = store.get(PENDING_KEY);
  if (pend && getName()) post(pend);
}

// game.js starts once the first course has loaded, which may be after this module has arrived
(function wait() { if (window.Skyrace && typeof Ghost !== 'undefined') run(window.Skyrace); else setTimeout(wait, 50); })();
