// Boot, the levels one after another, the level menu, the loop, the top
// bar and the messages. ?level=2 in the address starts at level 2.
// window.rykelma in the console: load(i) starts level i (from 0), game is
// the level in play.

import { loadTune } from './tune.js';
import { createGame } from './game.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';

const T = await loadTune();
const LEVELS = (await (await fetch('config/levels.json', { cache: 'no-store' })).json()).levels;

const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const $ = (id) => document.getElementById(id);

// cleared levels and their fewest steps, in this browser only
const SAVE = 'rykelma.best';
let best = {};
try { best = JSON.parse(localStorage.getItem(SAVE)) || {}; } catch { /* none */ }
const remember = () => { try { localStorage.setItem(SAVE, JSON.stringify(best)); } catch { /* fine */ } };

let index = 0, game, view;

function load(i) {
  index = (i + LEVELS.length) % LEVELS.length;
  const L = LEVELS[index];
  game = createGame(T, L, onEvent);
  $('name').textContent = `${index + 1}. ${L.name}`;
  say(L.hint || '', L.hint ? 5 : 0);
  window.rykelma.game = game;
  const u = new URL(location.href);
  u.searchParams.set('level', index + 1);
  history.replaceState(null, '', u);
}

let msgUntil = 0;
function say(text, secs) {
  $('msg').textContent = text;
  $('msg').hidden = !text;
  msgUntil = now + secs;
}

function onEvent(type, e) {
  if (type === 'collect') {
    const c = renderer.colors;
    renderer.burst(e.at[0] + 0.5, e.at[1] + 0.5, e.kind === 'lock' ? c.lock : c.touch);
  }
  if (type === 'won') {
    const key = LEVELS[index].key, prev = best[key];
    if (!prev || e.steps < prev) best[key] = e.steps;
    remember();
    say('Kaikki kerätty!', T.winPause);
  }
  if (type === 'dead') say('Kiinni jäit!', T.deadPause);
}

// ---- level menu -------------------------------------------------------------

const menuEl = $('levels'), listEl = menuEl.querySelector('ol');
let menuPick = 0;
function openMenu(on) {
  menuEl.hidden = !on;
  if (!on) return;
  menuPick = index;
  listEl.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const li = document.createElement('li');
    const b = best[L.key];
    li.innerHTML = `<span>${i + 1}. ${L.name}</span><span class="best">${b ? '✓ ' + b + ' askelta' : ''}</span>`;
    li.addEventListener('click', () => { load(i); openMenu(false); });
    listEl.append(li);
  });
  markMenu();
}
function markMenu() {
  [...listEl.children].forEach((li, i) => li.classList.toggle('on', i === menuPick));
  listEl.children[menuPick]?.scrollIntoView({ block: 'nearest' });
}
menuEl.querySelector('.close').addEventListener('click', () => openMenu(false));
$('menu').addEventListener('click', (e) => { openMenu(menuEl.hidden); e.currentTarget.blur(); });
$('restart').addEventListener('click', (e) => { game.restart(); e.currentTarget.blur(); });

// ---- loop -------------------------------------------------------------------

window.rykelma = { T, LEVELS, load, game: null };
let now = 0, last = performance.now(), menuRepeat = 0;
load((parseInt(new URLSearchParams(location.search).get('level'), 10) || 1) - 1);

function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t; now += dt;
  input.poll(dt);

  if (input.pressed('controls')) input.open();
  if (input.pressed('menu')) openMenu(menuEl.hidden);

  if (!menuEl.hidden) {
    const d = input.dir();
    menuRepeat -= dt;
    if (!d) menuRepeat = 0;
    else if (menuRepeat <= 0 && (d === 'up' || d === 'down')) {
      menuPick = (menuPick + (d === 'down' ? 1 : -1) + LEVELS.length) % LEVELS.length;
      markMenu();
      menuRepeat = 0.22;
    }
    if (input.pressed('ok')) { load(menuPick); openMenu(false); }
  } else {
    if (input.pressed('reset')) game.restart();
    game.update(dt, input.isOpen() ? null : input.dir());
    if (game.state === 'won' && game.view().timer >= T.winPause) load(index + 1);
  }

  view = game.view();
  renderer.draw(view, now, dt);
  $('gems').textContent = view.gems;
  $('steps').textContent = view.steps;
  if (msgUntil && now > msgUntil) { $('msg').hidden = true; msgUntil = 0; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
