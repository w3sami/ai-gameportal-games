import {
  OPS, parseLevel, initialState, step, insert, takeBack, canStep, tileAt, doorOpen, bridgeDown,
} from './logic.js';
import { LEVELS } from './levels.js';
import { generateLevel } from './gen.js';

const $ = (id) => document.getElementById(id);
const STORE = 'robotin-ohjelma-v1';
const STEP_MS = 380;

const ui = {
  board: $('board'),
  wrap: $('board-wrap'),
  prog: $('prog'),
  hand: $('hand'),
  status: $('status'),
  progMeta: $('prog-meta'),
  handMeta: $('hand-meta'),
  step: $('btn-step'),
  run: $('btn-run'),
  undo: $('btn-undo'),
  reset: $('btn-reset'),
  sound: $('btn-sound'),
};

let save = loadSave();
let levelIdx = 0;
let level = null;
let state = null;
let history = [];
let selected = null;
let running = null;
let robotEl = null;
let rot = 0;
let tiles = [];
let floorCards = [];
let randomSeed = 0;
let winTimer = null;

// ---------- persistence ----------

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && typeof s === 'object') return { best: {}, sound: true, last: 0, ...s };
  } catch {}
  return { best: {}, sound: true, last: 0 };
}

function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify(save));
  } catch {}
}

function unlocked(i) {
  return i === 0 || save.best[i - 1] !== undefined || save.best[i] !== undefined;
}

// ---------- sound ----------

let actx = null;
function tone(freq, dur = 0.08, type = 'square', vol = 0.04, to = null, delay = 0) {
  if (!save.sound) return;
  try {
    actx ??= new AudioContext();
    const t = actx.currentTime + delay;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch {}
}

const sfx = {
  move: () => tone(330, 0.06, 'triangle', 0.06),
  turn: () => tone(520, 0.05, 'triangle', 0.04, 600),
  bump: () => tone(110, 0.12, 'sawtooth', 0.05, 70),
  fall: () => tone(700, 0.6, 'sine', 0.07, 60),
  activate: () => { tone(880, 0.08, 'square', 0.03); tone(1320, 0.1, 'square', 0.03, null, 0.07); },
  fizzle: () => tone(180, 0.1, 'sawtooth', 0.025, 140),
  pickup: () => [660, 880, 1100].forEach((f, i) => tone(f, 0.07, 'triangle', 0.05, null, i * 0.05)),
  insert: () => tone(740, 0.06, 'triangle', 0.05, 980),
  undo: () => tone(420, 0.06, 'triangle', 0.04, 300),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.06, null, i * 0.11)),
};

// ---------- level setup ----------

function startLevel(idx, def = LEVELS[idx]) {
  stopRun();
  clearTimeout(winTimer);
  closeOverlays();
  levelIdx = idx;
  level = parseLevel(def);
  state = initialState(level);
  history = [];
  selected = null;
  if (idx >= 0) {
    save.last = idx;
    persist();
    $('lvl-no').textContent = `Taso ${idx + 1}/${LEVELS.length}`;
  } else {
    $('lvl-no').textContent = 'Satunnainen';
  }
  $('lvl-name').textContent = level.name;
  buildBoard();
  render(null, true);
  setStatus(level.hint ?? '');
}

function startRandom() {
  stopRun();
  closeOverlays();
  setStatus('Rakennetaan tasoa…');
  setTimeout(() => {
    let def = null;
    while (!def) {
      randomSeed = (Math.random() * 2 ** 31) | 0;
      def = generateLevel(randomSeed);
    }
    startLevel(-1, {
      ...def,
      name: `#${randomSeed.toString(36).toUpperCase()}`,
      hint: 'Satunnainen taso. Ratkaisu on varmasti olemassa.',
    });
  }, 30);
}

function buildBoard() {
  ui.board.innerHTML = '';
  ui.board.style.setProperty('--w', level.w);
  ui.board.style.setProperty('--h', level.h);
  tiles = [];
  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const t = tileAt(level, x, y);
      const el = document.createElement('div');
      el.className = 'tile ' + ({
        '#': 't-wall', '_': 't-pit', 'G': 't-goal', 'L': 't-lever',
        'D': 't-door', 'd': 't-door', '~': 't-bridge', '=': 't-bridge',
      }[t] ?? 't-floor');
      ui.board.append(el);
      tiles.push(el);
    }
  }
  floorCards = level.cards.map((c) => {
    const el = document.createElement('div');
    el.className = `floor-card op-${c.op}`;
    el.textContent = OPS[c.op].icon;
    el.title = OPS[c.op].name;
    tiles[c.y * level.w + c.x].append(el);
    return el;
  });
  robotEl = document.createElement('div');
  robotEl.className = 'robot instant';
  robotEl.innerHTML = `<div class="body"><div class="inner">${ROBOT_SVG}</div></div>`;
  ui.board.append(robotEl);
  rot = level.start.dir * 90;
  fitBoard();
}

const ROBOT_SVG = `
<svg viewBox="0 0 100 100" aria-hidden="true">
  <rect x="14" y="20" width="14" height="62" rx="5" fill="#2b3245" stroke="#11151f" stroke-width="3"/>
  <rect x="72" y="20" width="14" height="62" rx="5" fill="#2b3245" stroke="#11151f" stroke-width="3"/>
  <g stroke="#566082" stroke-width="3">
    <line x1="16" y1="32" x2="26" y2="32"/><line x1="16" y1="46" x2="26" y2="46"/>
    <line x1="16" y1="60" x2="26" y2="60"/><line x1="16" y1="74" x2="26" y2="74"/>
    <line x1="74" y1="32" x2="84" y2="32"/><line x1="74" y1="46" x2="84" y2="46"/>
    <line x1="74" y1="60" x2="84" y2="60"/><line x1="74" y1="74" x2="84" y2="74"/>
  </g>
  <rect x="24" y="24" width="52" height="56" rx="14" fill="#dfe7f7" stroke="#11151f" stroke-width="3"/>
  <rect x="31" y="27" width="38" height="20" rx="8" fill="#0f1420"/>
  <circle cx="42" cy="37" r="4.5" fill="#4cc9f0"/>
  <circle cx="58" cy="37" r="4.5" fill="#4cc9f0"/>
  <rect x="38" y="56" width="24" height="14" rx="4" fill="#b9c4dc"/>
  <circle cx="50" cy="63" r="3" fill="#ff8f3d"/>
  <path class="spark" d="M50 2 L44 14 L51 14 L46 24 L58 10 L51 10 L55 2 Z" fill="#ffe066" stroke="#e0a800" stroke-width="1.5"/>
</svg>`;

function fitBoard() {
  if (!level) return;
  const r = ui.wrap.getBoundingClientRect();
  const cell = Math.max(18, Math.floor(Math.min(r.width / level.w, r.height / level.h, 76)));
  ui.board.style.setProperty('--cell', `${cell}px`);
}

// ---------- rendering ----------

function render(event, instant = false) {
  renderBoard(event, instant);
  renderProgram();
  renderHand(event);
  renderControls();
}

function renderBoard(event, instant) {
  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const t = tileAt(level, x, y);
      const el = tiles[y * level.w + x];
      if (t === 'D' || t === 'd') el.classList.toggle('open', doorOpen(level, state, x, y));
      else if (t === '~' || t === '=') el.classList.toggle('up', !bridgeDown(level, state, x, y));
      else if (t === 'L') el.classList.toggle('on', state.flip);
    }
  }
  floorCards.forEach((el, i) => el.classList.toggle('taken', state.taken[i]));

  const target = state.dir * 90;
  rot += ((((target - rot) % 360) + 540) % 360) - 180;
  robotEl.classList.toggle('instant', instant);
  robotEl.style.setProperty('--x', state.x);
  robotEl.style.setProperty('--y', state.y);
  robotEl.style.setProperty('--rot', `${rot}deg`);
  robotEl.classList.remove('bump-f', 'bump-b', 'activate', 'fizzle', 'won');
  robotEl.classList.toggle('dead', state.dead);
  if (event) {
    void robotEl.offsetWidth;
    if (event.type === 'bump') robotEl.classList.add(event.op === 'F' ? 'bump-f' : 'bump-b');
    if (event.type === 'activate' || event.type === 'fizzle') robotEl.classList.add(event.type);
    if (event.type === 'activate') {
      const lx = state.x + [0, 1, 0, -1][state.dir];
      const ly = state.y + [-1, 0, 1, 0][state.dir];
      const lever = tiles[ly * level.w + lx];
      lever.classList.remove('flash');
      void lever.offsetWidth;
      lever.classList.add('flash');
    }
  }
  if (state.won) robotEl.classList.add('won');
  if (instant) requestAnimationFrame(() => robotEl.classList.remove('instant'));
}

function cardHtml(op, extra = '') {
  return `<span class="ico">${OPS[op].icon}</span><span class="lbl">${OPS[op].name}</span>${extra}`;
}

function renderProgram() {
  const frag = document.createDocumentFragment();
  const sel = selected !== null ? state.hand[selected] : null;
  if (sel) ui.prog.style.setProperty('--sel', `var(--op-${sel.op})`);
  const slot = (pos) => {
    const b = document.createElement('button');
    b.className = 'slot';
    b.textContent = '+';
    b.title = 'Lisää tähän';
    b.onclick = () => doInsert(pos);
    frag.append(b);
  };
  state.program.forEach((cmd, i) => {
    if (sel && i >= state.pc) slot(i);
    const el = document.createElement('div');
    const phase = i < state.pc ? 'done' : i === state.pc ? 'current pending' : 'pending';
    el.className = `card op-${cmd.op} ${phase}${cmd.ins ? ' ins' : ''}`;
    if (cmd.id === lastInsertedId) el.classList.add('new');
    el.innerHTML = cardHtml(cmd.op, `<span class="num">${i + 1}</span>`);
    if (cmd.ins && i >= state.pc && !state.dead && !state.won) {
      el.title = 'Palauta käteen';
      el.onclick = () => doTakeBack(i);
    }
    frag.append(el);
  });
  if (sel) slot(state.program.length);
  const end = document.createElement('div');
  end.className = 'prog-end' + (state.pc >= state.program.length ? ' current' : '');
  end.textContent = 'loppu';
  frag.append(end);

  const keep = [ui.prog.scrollLeft, ui.prog.scrollTop];
  ui.prog.replaceChildren(frag);
  [ui.prog.scrollLeft, ui.prog.scrollTop] = keep;
  ui.progMeta.textContent = `${state.pc}/${state.program.length}`;
  lastInsertedId = null;
  requestAnimationFrame(scrollProgram);
}

let lastInsertedId = null;
let scrollAnim = null;

// Executed commands stay in view as long as everything fits; once the list overflows, the
// view glides forward just enough to keep the upcoming commands visible.
function scrollProgram() {
  const list = ui.prog;
  const horizontal = getComputedStyle(list).flexDirection === 'row';
  const cur = list.querySelector('.current') ?? list.lastElementChild;
  if (!cur) return;
  const pos = horizontal ? cur.offsetLeft : cur.offsetTop;
  const curSize = horizontal ? cur.offsetWidth : cur.offsetHeight;
  const viewSize = horizontal ? list.clientWidth : list.clientHeight;
  const max = Math.max(0, (horizontal ? list.scrollWidth : list.scrollHeight) - viewSize);
  const lead = curSize * (horizontal ? 1.1 : 1.6);
  let target = Math.min(max, Math.max(0, pos - lead));
  if (pos + curSize > target + viewSize) target = Math.min(max, pos + curSize - viewSize);
  const prop = horizontal ? 'scrollLeft' : 'scrollTop';
  const from = list[prop];
  if (Math.abs(target - from) < 1) return;
  cancelAnimationFrame(scrollAnim);
  const t0 = performance.now();
  const dur = 900;
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    list[prop] = from + (target - from) * e;
    if (k < 1) scrollAnim = requestAnimationFrame(tick);
  };
  scrollAnim = requestAnimationFrame(tick);
}

function renderHand(event) {
  const fresh = new Set(event?.pickups?.length ? state.hand.slice(-event.pickups.length).map((c) => c.id) : []);
  ui.hand.replaceChildren();
  if (!state.hand.length) {
    const p = document.createElement('div');
    p.className = 'empty';
    p.textContent = 'Kortit kerätään kentältä ajamalla niiden yli.';
    ui.hand.append(p);
  }
  state.hand.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = `card op-${c.op}${i === selected ? ' selected' : ''}${fresh.has(c.id) ? ' new' : ''}`;
    b.innerHTML = cardHtml(c.op);
    b.disabled = state.dead || state.won;
    b.onclick = () => selectCard(i);
    ui.hand.append(b);
  });
  ui.handMeta.textContent = state.inserted ? `lisätty ${state.inserted}` : '';
}

function renderControls() {
  ui.step.disabled = !canStep(state);
  ui.run.disabled = !canStep(state) && !running;
  ui.undo.disabled = !history.length;
  ui.reset.disabled = !history.length;
  ui.run.classList.toggle('running', !!running);
  ui.run.innerHTML = running ? '<span>⏸</span>Pysäytä' : '<span>⏩</span>Aja';
  ui.sound.textContent = save.sound ? '🔊' : '🔇';
}

function setStatus(text, kind = '') {
  ui.status.textContent = text;
  ui.status.className = `status ${kind}`;
}

// ---------- actions ----------

function commit(next) {
  history.push(state);
  state = next;
}

function doStep() {
  if (!canStep(state)) {
    stopRun();
    return false;
  }
  selected = null;
  const { state: next, event } = step(level, state);
  commit(next);
  render(event);
  sfx[event.type === 'move' ? 'move' : event.type === 'turn' ? 'turn' : event.type]?.();
  if (event.fell) sfx.fall();
  if (event.pickups.length) {
    setTimeout(sfx.pickup, 90);
    const names = event.pickups.map((i) => OPS[level.cards[i].op].name).join(', ');
    setStatus(`Sait kortin: ${names}`, 'good');
  } else if (event.type === 'bump') {
    setStatus('Kolahdus! Tie oli tukossa.');
  } else if (event.type === 'fizzle') {
    setStatus('Aktivoi ei osunut mihinkään – edessä ei ole vipua.');
  } else if (event.type === 'activate') {
    setStatus('Vipu kääntyi.');
  }

  if (state.dead) {
    stopRun();
    setStatus('Robotti putosi! Kumoa askelia ja korjaa ohjelma.', 'bad');
  } else if (state.won) {
    stopRun();
    win();
  } else if (state.pc >= state.program.length) {
    stopRun();
    setStatus(state.hand.length
      ? 'Ohjelma loppui ennen maalia. Lisää kortteja tai kumoa.'
      : 'Ohjelma loppui ennen maalia. Kumoa ja kokeile toisin.', 'bad');
  }
  return canStep(state);
}

function selectCard(i) {
  stopRun();
  selected = selected === i ? null : i;
  render(null);
  if (selected !== null) setStatus('Valitse ohjelmasta +-kohta, johon kortti lisätään.');
}

function doInsert(pos) {
  if (selected === null) return;
  const next = insert(state, selected, pos);
  if (next === state) return;
  lastInsertedId = state.hand[selected].id;
  commit(next);
  selected = null;
  sfx.insert();
  render(null);
  setStatus('Kortti lisätty ohjelmaan.');
}

function doTakeBack(pos) {
  stopRun();
  const next = takeBack(state, pos);
  if (next === state) return;
  commit(next);
  selected = null;
  sfx.undo();
  render(null);
  setStatus('Kortti palautettu käteen.');
}

function undo() {
  stopRun();
  clearTimeout(winTimer);
  if (!history.length) return;
  state = history.pop();
  selected = null;
  sfx.undo();
  render(null);
  setStatus(history.length ? '' : (level.hint ?? ''));
}

function resetLevel() {
  stopRun();
  clearTimeout(winTimer);
  if (!history.length) return;
  state = history[0];
  history = [];
  selected = null;
  sfx.undo();
  render(null);
  setStatus(level.hint ?? '');
}

function toggleRun() {
  if (running) {
    stopRun();
    return;
  }
  if (!canStep(state)) return;
  selected = null;
  running = setInterval(doStep, STEP_MS);
  doStep();
  renderControls();
}

function stopRun() {
  if (!running) return;
  clearInterval(running);
  running = null;
  renderControls();
}

function win() {
  sfx.win();
  setStatus('Perillä!', 'good');
  const par = level.par ?? state.inserted;
  const stars = state.inserted <= par ? 3 : state.inserted <= par + 1 ? 2 : 1;
  if (levelIdx >= 0) {
    const prev = save.best[levelIdx];
    if (prev === undefined || state.inserted < prev) save.best[levelIdx] = state.inserted;
    persist();
  }
  $('win-stars').innerHTML = [1, 2, 3].map((n) => `<span class="${n <= stars ? '' : 'off'}">⭐</span>`).join('');
  $('win-text').textContent = state.inserted === 1
    ? `Lisäsit ohjelmaan 1 kortin. ${stars === 3 ? 'Parempaan ei pysty!' : `Pärjää ${par} kortilla.`}`
    : `Lisäsit ohjelmaan ${state.inserted} korttia. ${stars === 3 ? 'Parempaan ei pysty!' : `Pärjää ${par} kortilla.`}`;
  const last = levelIdx === LEVELS.length - 1;
  $('win-next').textContent = levelIdx < 0 || last ? 'Uusi satunnainen' : 'Seuraava taso';
  winTimer = setTimeout(() => openOverlay('ov-win'), 900);
}

// ---------- overlays ----------

function openOverlay(id) {
  stopRun();
  closeOverlays();
  if (id === 'ov-levels') renderLevelGrid();
  $(id).hidden = false;
}

function closeOverlays() {
  document.querySelectorAll('.overlay').forEach((o) => { o.hidden = true; });
}

function renderLevelGrid() {
  const grid = $('level-grid');
  grid.replaceChildren();
  const par = (i) => LEVELS[i].par;
  LEVELS.forEach((def, i) => {
    const b = document.createElement('button');
    const best = save.best[i];
    const stars = best === undefined ? 0 : best <= par(i) ? 3 : best <= par(i) + 1 ? 2 : 1;
    b.className = i === levelIdx ? 'current' : '';
    b.disabled = !unlocked(i);
    b.innerHTML = `<span class="n">Taso ${i + 1}</span><span class="nm">${def.name}</span>`
      + `<span class="st">${unlocked(i) ? '⭐'.repeat(stars) + '☆'.repeat(3 - stars) : '🔒'}</span>`;
    b.onclick = () => startLevel(i);
    grid.append(b);
  });
}

// ---------- wiring ----------

ui.step.onclick = () => { stopRun(); doStep(); };
ui.run.onclick = toggleRun;
ui.undo.onclick = undo;
ui.reset.onclick = resetLevel;
ui.sound.onclick = () => {
  save.sound = !save.sound;
  persist();
  renderControls();
};
$('btn-levels').onclick = () => openOverlay('ov-levels');
$('btn-help').onclick = () => openOverlay('ov-help');
$('btn-random').onclick = startRandom;
$('win-retry').onclick = () => (levelIdx >= 0 ? startLevel(levelIdx) : (closeOverlays(), resetLevel()));
$('win-next').onclick = () => {
  if (levelIdx < 0 || levelIdx === LEVELS.length - 1) startRandom();
  else startLevel(levelIdx + 1);
};
document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = closeOverlays; });
document.querySelectorAll('.overlay').forEach((o) => {
  o.addEventListener('click', (e) => { if (e.target === o) closeOverlays(); });
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const open = [...document.querySelectorAll('.overlay')].some((o) => !o.hidden);
  if (open) {
    if (e.key === 'Escape') closeOverlays();
    return;
  }
  const k = e.key;
  if (k === ' ' || k === 'ArrowRight') { stopRun(); doStep(); }
  else if (k === 'Enter') toggleRun();
  else if (k === 'Backspace' || k === 'ArrowLeft' || k === 'z' || k === 'Z') undo();
  else if (k === 'Home') resetLevel();
  else if (k === 'Escape') { selected = null; render(null); }
  else if (/^[1-9]$/.test(k) && state.hand[Number(k) - 1]) selectCard(Number(k) - 1);
  else return;
  e.preventDefault();
});

new ResizeObserver(() => { fitBoard(); scrollProgram(); }).observe(ui.wrap);

import('https://plugins.game.bigbools.fi/portal-events/v1/index.js')
  .then(({ onPortal }) => onPortal('pause', (on) => { if (on) stopRun(); }))
  .catch(() => {});

startLevel(Math.min(save.last ?? 0, LEVELS.length - 1));
if (!save.seenHelp) {
  save.seenHelp = true;
  persist();
  openOverlay('ov-help');
}
