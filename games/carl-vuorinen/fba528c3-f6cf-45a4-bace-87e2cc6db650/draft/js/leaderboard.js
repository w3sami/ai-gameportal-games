// Leaderboard: two boards. `fastest-pilots` ranks a time, with the level a dimension inside it. `longest-streak`
// ranks one number for the whole game — how many levels in a row, from the first, the pilot has cleared clean — and
// has no level dimension at all. A time is posted when it beats the one this browser has already put up, a streak
// when it is longer, and both are read back into whatever placeholders a menu leaves behind.
//
// The rows are drawn here rather than with <leaderboard-panel> because a board stores whole numbers and this game
// counts in milliseconds: a time belongs on screen as a clock, not as "12,431".
import { submit, top, getName, setName }
  from 'https://plugins.game.bigbools.fi/leaderboard/v1/index.js';

const BOARD = 'fastest-pilots', SBOARD = 'longest-streak';
const LBKEY = 'thruster-lb-v1', SKKEY = 'thruster-lbstreak-v1';
const MINSTREAK = 3;                                          // one or two levels is not a streak worth a row

// A board sorts on `score` and on nothing else, so the tie-break has to live inside that one integer: the streak in
// the high part, the total time subtracted from the low part so that quicker is larger. SCAP is the time ceiling in
// milliseconds — a streak slower than this shares the floor of its own tier, which at nearly three hours is not a
// case anybody will meet. Changing SCAP renumbers every row, so it does not change; the readable values travel in
// `data` beside it, and the decode below is only there for a row posted before that was true.
const SCAP = 10000000;
const packStreak = (n, ms) => n*SCAP - Math.min(Math.max(ms|0, 0), SCAP-1);
const unpackStreak = score => { const n = Math.ceil(score/SCAP); return {n, ms: n*SCAP - score}; };

let mine = {};                                                // level -> {ms, id}: the row this browser owns
try { mine = JSON.parse(localStorage.getItem(LBKEY)) || {}; } catch (e) {}
const remember = () => { try { localStorage.setItem(LBKEY, JSON.stringify(mine)); } catch (e) {} };

let mineSk = null;                                            // {n, ms, id}: the streak row this browser owns
try { mineSk = JSON.parse(localStorage.getItem(SKKEY)) || null; } catch (e) {}
const rememberSk = () => { try { localStorage.setItem(SKKEY, JSON.stringify(mineSk)); } catch (e) {} };

const levelOf = lv => String(lv + 1);
const clock = ms => { const s = ms / 1000, m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; };
function el(tag, cls, text){ const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
const CROWN = '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 7l4.6 3.6L12 4l5.4 6.6L22 7l-1.7 11H3.7z"/></svg>';

// Every message about a result that did not land on the board. The middle three lost nothing: it simply did not
// arrive, and the run is still the player's best locally.
const NOTE = {
  full:           'The hundred fastest are all quicker than this. Fly it again.',
  busy:           'The board is busy right now, so this time did not post.',
  offline:        'No connection, so this time stayed on your machine.',
  server:         'The board is having a moment, so this time did not post.',
  invalid:        'This time could not be posted.',
  'unknown-game': 'This time could not be posted.',
};
const SNOTE = {
  full:           'The hundred longest are all longer than this. Keep flying.',
  busy:           'The board is busy right now, so this streak did not post.',
  offline:        'No connection, so this streak stayed on your machine.',
  server:         'The board is having a moment, so this streak did not post.',
  invalid:        'This streak could not be posted.',
  'unknown-game': 'This streak could not be posted.',
};

// What flew the run, shown beside the time as one small icon per device: a run flown with a thumb and a keyboard
// gets both. Unknown tags are skipped rather than drawn, and a row from before the game recorded any of this
// simply has none. Like the time itself, this is what the pilot's browser says happened.
const DEV = {
  keys:  ['keyboard', '<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M7.5 14.5h9M6 10h.01M10 10h.01M14 10h.01M18 10h.01"/>'],
  touch: ['touch',    '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10.2 18.8h3.6"/>'],
  mouse: ['mouse',    '<rect x="6" y="2.5" width="12" height="19" rx="6"/><path d="M12 6.5v3.5"/>'],
  pad:   ['gamepad',  '<rect x="2" y="7" width="20" height="11" rx="5.5"/><path d="M6.5 10.5v4M4.5 12.5h4"/><path d="M16 11.4h.01M18.4 13.6h.01"/>'],
};
const ICON = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${DEV[k][1]}</svg>`;

// One badge for however many devices the entry names, in the order the game listed them.
function devBadge(entry){
  if (!entry.data || entry.data.v !== 1 || !entry.data.d) return null;
  const kinds = String(entry.data.d).split(',').filter(k => DEV[k]);
  if (!kinds.length) return null;
  const n = el('span', 'd');
  n.innerHTML = kinds.map(ICON).join('');
  const names = kinds.map(k => DEV[k][0]);
  n.title = names.length > 1 ? `${names.slice(0,-1).join(', ')} and ${names[names.length-1]}` : names[0];
  return n;
}

// Live panels. A menu can hold two of them, and a pilot who has never given a name is asked by whichever one has
// something to post — so the answer has to reach the other as well, rather than leaving a stale form behind it.
const PANELS = new Set();

/** Fills every leaderboard placeholder in a freshly built menu. */
export function mount(root){
  for (const p of PANELS) if (!p.host.isConnected) PANELS.delete(p);
  for (const host of root.querySelectorAll('[data-lb-level],[data-lb-streak]')){
    if (host.dataset.lbDone) continue;                        // a menu redrawn around a live panel keeps it
    host.dataset.lbDone = '1';
    (host.dataset.lbStreak === undefined ? timePanel : streakPanel)(host);
  }
}

function shell(host, name, sub0){
  host.className = 'lb';
  const sub = el('span', 'lb-sub', sub0);
  const head = el('div', 'lb-h'); head.append(el('b', null, name), sub);
  const body = el('div', 'lb-body'); body.append(el('p', 'lb-note', 'Reading the board…'));
  const status = el('p', 'lb-note'), ctl = el('div', 'lb-ctl');
  const foot = el('div', 'lb-foot'); foot.append(status, ctl);
  host.replaceChildren(head, body, foot);
  return {host, sub, body, status, ctl};
}

// ---- Fastest pilots, one level at a time ----
async function timePanel(host){
  const lv = +host.dataset.lbLevel;
  const run = +(host.dataset.lbPost || 0);                    // ms of the best run here, set by the finish screen
  const title = host.dataset.lbTitle || `Level ${lv + 1}`;
  const p = shell(host, 'Fastest pilots', title);
  p.pending = run && (!mine[lv] || run < mine[lv].ms) ? run : 0;
  p.label = 'Post my time';
  p.idle = 'Land on the green pad to put a time up here.';
  p.post = (v, status) => send(lv, v, status);
  p.redraw = () => draw(lv, p.body, p.sub, title);
  PANELS.add(p);
  if (p.pending && getName()){ const n = p.pending; p.pending = 0; await send(lv, n, p.status); }
  await p.redraw();
  controls(p);
}

// submit() never throws and never rejects, so `kept` is the whole story.
async function send(lv, ms, status){
  status.className = 'lb-note';
  status.textContent = 'Posting your time…';
  const post = { score: ms, board: BOARD, level: levelOf(lv) };
  // The ghost and what flew it ride along with the time. The game packs them and the board never looks inside. If
  // the ghost will not fit the tag still goes up on its own: it is a handful of bytes and always fits.
  const T = window.Thruster, data = {v:1};
  const path = T && T.replay(lv), dev = T && T.device(lv);
  if (path) data.r = path;
  if (dev) data.d = dev;
  if (data.r && JSON.stringify(data).length > 1980) delete data.r;
  if (data.r || data.d) post.data = data;
  const r = await submit(post);
  if (r.kept){
    mine[lv] = {ms, id: r.entry.id}; remember();
    status.className = 'lb-note good';
    status.textContent = r.rank === 1 ? `Fastest in the world, ${clock(ms)}.` : `Posted, #${r.rank} on this level.`;
  } else {
    status.textContent = NOTE[r.reason] || NOTE.server;
  }
}

async function draw(lv, body, sub, title){
  const highlight = mine[lv] ? mine[lv].id : undefined;
  const page = await top({board: BOARD, level: levelOf(lv), limit: 8, around: highlight});
  if (!page || page.reason){ body.replaceChildren(el('p', 'lb-note', 'The board could not be reached.')); return; }
  if (!page.entries.length){ body.replaceChildren(el('p', 'lb-note', 'No times here yet. First landing takes the top spot.')); return; }

  sub.textContent = `${title} · ${page.total} ${page.total === 1 ? 'time' : 'times'}`;
  const list = el('ol', 'lbrows');
  for (const e of page.entries){
    const row = el('li', `lbrow${e.rank <= 3 ? ' top' : ''}${e.id === highlight ? ' me' : ''}`);
    row.append(el('span', 'r', e.rank), el('span', 'n', e.name));
    const d = devBadge(e); if (d) row.append(d);
    row.append(el('span', 't', clock(e.score)));
    const go = raceButton(lv, e); if (go) row.append(go);
    list.append(row);
  }
  body.replaceChildren(list);
}

// A row whose entry carries a ghost can be raced. A row without one is just a time, and says nothing about it.
// The path knows its own tick length, so a time that disagrees with the run supposed to have flown it is not
// offered: it stops the lazy forgery, and nothing more than that.
function raceButton(lv, entry){
  const path = entry.data && entry.data.v === 1 ? entry.data.r : null;
  if (!path || !window.Thruster) return null;
  const ticks = window.Thruster.ticksOf(path);
  if (!ticks || Math.abs(Math.round(ticks*1000/120) - entry.score) > 500) return null;
  const b = el('button', 'lbgo', 'VS');
  b.type = 'button';
  b.title = `Race ${entry.name}'s ghost`;
  b.setAttribute('aria-label', `Race ${entry.name}'s ghost`);
  b.addEventListener('click', () => window.Thruster.race(lv, entry.name, path));
  return b;
}

// ---- Longest streaks, one number for the whole game ----
// Two pilots who both got eleven levels deep are not level, so the total time of the runs that built the streak
// breaks the tie — packed into the score, since that is the only thing the board will sort on.
//
// There is no ghost to carry and nothing to check any of it against: a streak is a claim about a sequence of runs,
// and the board is taking the browser's word for it. Moderation is the backstop, as it is for everything else here.
async function streakPanel(host){
  const n = +(host.dataset.lbStreak || 0), ms = +(host.dataset.lbStreakMs || 0);
  const p = shell(host, 'Longest streaks', 'Levels in a row, clean');
  p.pending = n >= MINSTREAK && (!mineSk || n > mineSk.n || (n === mineSk.n && ms < mineSk.ms)) ? {n, ms} : 0;
  p.label = 'Post my streak';
  p.idle = `Clear the first ${MINSTREAK} levels in a row, without crashing, to put a streak up here.`;
  p.post = (v, status) => sendStreak(v.n, v.ms, status);
  p.redraw = () => drawStreak(p.body, p.sub);
  PANELS.add(p);
  if (p.pending && getName()){ const v = p.pending; p.pending = 0; await sendStreak(v.n, v.ms, p.status); }
  await p.redraw();
  controls(p);
}

async function sendStreak(n, ms, status){
  status.className = 'lb-note';
  status.textContent = 'Posting your streak…';
  const r = await submit({score: packStreak(n, ms), board: SBOARD, data: {v:1, n, ms}});
  if (r.kept){
    mineSk = {n, ms, id: r.entry.id}; rememberSk();
    status.className = 'lb-note good';
    status.textContent = r.rank === 1 ? `Longest streak in the world, ${n} levels in ${clock(ms)}.` : `Posted, #${r.rank}.`;
  } else {
    status.textContent = SNOTE[r.reason] || SNOTE.server;
  }
}

async function drawStreak(body, sub){
  const highlight = mineSk ? mineSk.id : undefined;
  const page = await top({board: SBOARD, limit: 8, around: highlight});
  if (!page || page.reason){ body.replaceChildren(el('p', 'lb-note', 'The board could not be reached.')); return; }
  if (!page.entries.length){ body.replaceChildren(el('p', 'lb-note', 'No streaks here yet. Start at level 1.')); return; }

  sub.textContent = `${page.total} ${page.total === 1 ? 'streak' : 'streaks'}`;
  const list = el('ol', 'lbrows');
  for (const e of page.entries){
    const v = e.data && e.data.v === 1 && typeof e.data.n === 'number' ? e.data : unpackStreak(e.score);
    const row = el('li', `lbrow${e.rank <= 3 ? ' top' : ''}${e.id === highlight ? ' me' : ''}`);
    row.append(el('span', 'r', e.rank), el('span', 'n', e.name), el('span', 'tm', clock(v.ms)));
    const t = el('span', 't st');
    t.innerHTML = CROWN; t.append(String(v.n));
    t.title = `${v.n} levels in a row, ${clock(v.ms)} in total`;
    row.append(t);
    list.append(row);
  }
  body.replaceChildren(list);
}

// ---- The name line, and the only place a name is ever asked for ----
// A player who never lands and never streaks is never asked at all.
function controls(p){
  const name = getName();
  if (!p.pending){
    if (name){
      const change = el('button', 'lnk', 'change');
      change.type = 'button';
      change.addEventListener('click', () => form(p));
      const line = el('span', null, `Posting as ${name} · `);
      line.append(change);
      p.ctl.replaceChildren(line);
    } else p.ctl.replaceChildren(el('span', null, p.idle));
    return;
  }
  form(p);
}

// Not a <form>: a game is served sandboxed without allow-forms, so a submit event never fires. The button and the
// Enter key do the work instead.
function form(p){
  const wrap = el('div', 'lb-form');
  const input = el('input');
  input.name = 'pilot'; input.maxLength = 24; input.placeholder = 'Your name';
  input.value = getName(); input.autocomplete = 'off'; input.spellcheck = false;
  const go = el('button', 'btn sm', p.pending ? p.label : 'Save');
  go.type = 'button';

  async function commit(){
    const who = setName(input.value);
    if (!who){ input.focus(); return; }
    go.disabled = true;
    p.ctl.replaceChildren(el('span', null, `Posting as ${who}`));
    await apply(p);                                           // this one first: it is the one being looked at
    for (const q of PANELS) if (q !== p && q.host.isConnected) apply(q);
  }
  go.addEventListener('click', commit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); commit(); } });

  wrap.append(input, go);
  p.ctl.replaceChildren(wrap);
  input.focus();
}

// There is a name now, so whatever this panel was holding can go up.
async function apply(p){
  const v = p.pending; p.pending = 0;
  if (v){ await p.post(v, p.status); await p.redraw(); }
  controls(p);
}

window.LB = {mount, clock};
const lbBox = document.getElementById('box');
if (lbBox) mount(lbBox);                                      // the menu is already open by the time this module lands
