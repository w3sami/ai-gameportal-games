// Leaderboard: one board for the whole game, the level a dimension inside it. A time is posted when it beats the
// one this browser has already put up, and the board is read back into every placeholder a menu leaves. The run
// that flew the time rides along in the entry's data, so any row carrying one can be raced as a ghost.
//
// The rows are drawn here rather than with <leaderboard-panel> because a board stores whole numbers and this game
// counts in milliseconds: a time belongs on screen as a clock, not as "12,431".
import { submit, top, getName, setName }
  from 'https://plugins.game.bigbools.fi/leaderboard/v1/index.js';

const BOARD = 'fastest-pilots';
const LBKEY = 'thruster-lb-v1';

let mine = {};                                                // level -> {ms, id}: the row this browser owns
try { mine = JSON.parse(localStorage.getItem(LBKEY)) || {}; } catch (e) {}
const remember = () => { try { localStorage.setItem(LBKEY, JSON.stringify(mine)); } catch (e) {} };

const levelOf = lv => String(lv + 1);
const clock = ms => { const s = ms / 1000, m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; };
function el(tag, cls, text){ const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }

// Every message about a time that did not land on the board. The middle three lost nothing: the time simply did
// not arrive, and the run is still the player's best locally.
const NOTE = {
  full:           'The hundred fastest are all quicker than this. Fly it again.',
  busy:           'The board is busy right now, so this time did not post.',
  offline:        'No connection, so this time stayed on your machine.',
  server:         'The board is having a moment, so this time did not post.',
  invalid:        'This time could not be posted.',
  'unknown-game': 'This time could not be posted.',
};

// What flew the run, shown beside the time as one small icon per device: a run flown with a thumb and a keyboard
// gets both. Unknown tags are skipped rather than drawn, and a row from before the game recorded any of this
// simply has none. Like the time itself, this is what the pilot's browser says happened.
const DEV = {
  keys:  ['keyboard', '<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M7.5 14.5h9M6 10h.01M10 10h.01M14 10h.01M18 10h.01"/>'],
  touch: ['touch',    '<path d="M9 11.5V5.4a1.5 1.5 0 0 1 3 0v5M12 10.4V9a1.5 1.5 0 0 1 3 0v2M15 11v-.4a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.7a5 5 0 0 1-4.2-2.3l-2.2-3.4a1.5 1.5 0 0 1 2.4-1.8L9 15.2"/>'],
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

/** Fills every leaderboard placeholder in a freshly built menu. */
export function mount(root){
  for (const host of root.querySelectorAll('[data-lb-level]')){
    if (host.dataset.lbDone) continue;                        // a menu redrawn around a live panel keeps it
    host.dataset.lbDone = '1';
    panel(host);
  }
}

async function panel(host){
  const lv = +host.dataset.lbLevel;
  const run = +(host.dataset.lbPost || 0);                    // ms of the best run here, set by the finish screen
  const pending = run && (!mine[lv] || run < mine[lv].ms) ? run : 0;
  const title = host.dataset.lbTitle || `Level ${lv + 1}`;

  host.className = 'lb';
  const sub = el('span', 'lb-sub', title);
  const head = el('div', 'lb-h'); head.append(el('b', null, 'Fastest pilots'), sub);
  const body = el('div', 'lb-body'); body.append(el('p', 'lb-note', 'Reading the board…'));
  const status = el('p', 'lb-note'), ctl = el('div', 'lb-ctl');
  const foot = el('div', 'lb-foot'); foot.append(status, ctl);
  host.replaceChildren(head, body, foot);

  if (pending && getName()) await send(lv, pending, status);
  await draw(lv, body, sub, title);
  controls(lv, getName() ? 0 : pending, status, ctl, body, sub, title);
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

// The name line, and the only place a name is ever asked for: a player who never lands is never asked at all.
function controls(lv, pending, status, ctl, body, sub, title){
  const again = p => controls(lv, p, status, ctl, body, sub, title);
  const name = getName();

  if (!pending && name){
    const change = el('button', 'lnk', 'change');
    change.type = 'button';
    change.addEventListener('click', () => form());
    const line = el('span', null, `Posting as ${name} · `);
    line.append(change);
    ctl.replaceChildren(line);
    return;
  }
  if (!pending && !name){ ctl.replaceChildren(el('span', null, 'Land on the green pad to put a time up here.')); return; }
  form();

  // Not a <form>: a game is served sandboxed without allow-forms, so a submit event never fires. The button and
  // the Enter key do the work instead.
  function form(){
    const wrap = el('div', 'lb-form');
    const input = el('input');
    input.name = 'pilot'; input.maxLength = 24; input.placeholder = 'Your name';
    input.value = getName(); input.autocomplete = 'off'; input.spellcheck = false;
    const go = el('button', 'btn sm', pending ? 'Post my time' : 'Save');
    go.type = 'button';

    async function commit(){
      const who = setName(input.value);
      if (!who){ input.focus(); return; }
      go.disabled = true;
      ctl.replaceChildren(el('span', null, `Posting as ${who}`));
      if (pending){ await send(lv, pending, status); await draw(lv, body, sub, title); }
      again(0);
    }
    go.addEventListener('click', commit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); commit(); } });

    wrap.append(input, go);
    ctl.replaceChildren(wrap);
    input.focus();
  }
}

window.LB = {mount, clock};
const lbBox = document.getElementById('box');
if (lbBox) mount(lbBox);                                      // the menu is already open by the time this module lands
