// Leaderboard, phase 1: one board for the whole game, the level a dimension inside it. A time is posted when it
// beats the one this browser has already put up, and the board is read back into every placeholder a menu leaves.
// No ghost travels with a time yet; the board's `data` is untouched, which is where a replay will go.
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
  const r = await submit({ score: ms, board: BOARD, level: levelOf(lv) });
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
    row.append(el('span', 'r', e.rank), el('span', 'n', e.name), el('span', 't', clock(e.score)));
    list.append(row);
  }
  body.replaceChildren(list);
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
