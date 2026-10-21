// Game state and loop. Wires generator, renderer, input and UI together.
import { loadConfig } from './config.js';
import { generate, slide, solve } from './levelgen.js';
import { Renderer } from './render.js';
import { bindInput } from './input.js';
import { loadProgress, saveProgress } from './storage.js';
import { t, LANG } from './i18n.js';

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const renderer = new Renderer(canvas);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  level: null, pos: [0, 0], face: 'right', moves: 0, history: [],
  anim: null, queued: null, won: false, hint: null, reduced,
};
let cfg, progress;

function starsFor(moves, par) {
  return moves <= par ? 3 : moves <= par + cfg.starSlack ? 2 : 1;
}

function loadLevel(n) {
  const lv = generate(n, cfg);
  state.level = lv;
  state.pos = [...lv.start];
  state.face = lv.start[0] < lv.size / 2 ? 'right' : 'left';
  state.moves = 0; state.history = []; state.anim = null; state.queued = null;
  state.won = false; state.hint = null;
  renderer.setLevel(lv);
  $('win').hidden = true;
  $('howto').hidden = n > 2;
  updateHud();
}

function updateHud() {
  const n = state.level.n;
  $('lvl').textContent = `${t.level} ${n}`;
  $('moves').textContent = state.moves;
  $('par').textContent = state.level.par;
  $('prev').disabled = n <= 1;
  $('nextLvl').disabled = n >= progress.unlocked;
  $('undo').disabled = state.history.length === 0 || state.won;
  const got = progress.stars[n] || 0;
  $('lvlStars').textContent = got ? '★'.repeat(got) + '☆'.repeat(3 - got) : '';
}

function move(dir) {
  if (state.won) return;
  if (state.anim) { state.queued = dir; return; }
  state.face = dir;
  const r = slide(state.level, state.pos[0], state.pos[1], dir);
  const now = performance.now();
  if (r.cells === 0) {
    state.anim = { kind: 'bump', dir, t0: now, dur: reduced ? 1 : 160 };
    return;
  }
  state.history.push([...state.pos]);
  state.moves++;
  state.hint = null;
  const dur = reduced ? 1 : Math.max(cfg.minSlideMs, Math.min(cfg.maxSlideMs, r.cells * cfg.msPerCell));
  state.anim = { kind: 'slide', from: [...state.pos], to: [r.x, r.y], t0: now, dur, won: r.won };
  state.pos = [r.x, r.y];
  updateHud();
}

function finishAnim(now) {
  const an = state.anim;
  state.anim = null;
  if (an.kind === 'slide' && an.won) {
    state.anim = { kind: 'sink', t0: now, dur: reduced ? 1 : 420 };
    return;
  }
  if (an.kind === 'sink') { win(); return; }
  if (state.queued) { const d = state.queued; state.queued = null; move(d); }
}

function win() {
  state.won = true;
  const n = state.level.n;
  const stars = starsFor(state.moves, state.level.par);
  progress.stars[n] = Math.max(progress.stars[n] || 0, stars);
  progress.unlocked = Math.max(progress.unlocked, n + 1);
  saveProgress(progress);
  $('winStars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  $('winStars').setAttribute('aria-label', `${stars} / 3`);
  $('winText').textContent = t.result(state.moves, state.level.par);
  $('win').hidden = false;
  $('next').focus();
  updateHud();
}

function undo() {
  if (state.won || state.anim || !state.history.length) return;
  state.pos = state.history.pop();
  state.moves--;
  state.hint = null;
  updateHud();
}

function restart() { loadLevel(state.level.n); }

function hint() {
  if (state.won || state.anim) return;
  const sol = solve(state.level, state.pos[0], state.pos[1]);
  if (sol) state.hint = { dir: sol.path[0], until: performance.now() + 2200 };
}

function next() {
  if (!state.won) return false;
  loadLevel(state.level.n + 1);
  return true;
}

function sealCenter() {
  if (!state.level) return null;
  const { cell, ox, oy } = renderer.layout(state.level.size);
  return { x: ox + (state.pos[0] + 0.5) * cell, y: oy + (state.pos[1] + 0.5) * cell, cell };
}

function frame(now) {
  if (state.anim && now - state.anim.t0 >= state.anim.dur) finishAnim(now);
  renderer.draw(state, now);
  requestAnimationFrame(frame);
}

function applyStrings() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t[el.dataset.t]; });
  document.querySelectorAll('[data-t-label]').forEach((el) => { el.setAttribute('aria-label', t[el.dataset.tLabel]); el.title = t[el.dataset.tLabel]; });
}

async function main() {
  applyStrings();
  cfg = await loadConfig();
  progress = loadProgress();
  const ro = new ResizeObserver(() => renderer.resize());
  ro.observe(canvas);
  renderer.resize();

  bindInput(canvas, { move, undo, restart, hint, next }, sealCenter);
  $('undo').onclick = undo;
  $('restart').onclick = restart;
  $('hint').onclick = hint;
  $('next').onclick = next;
  $('replay').onclick = restart;
  $('prev').onclick = () => state.level.n > 1 && loadLevel(state.level.n - 1);
  $('nextLvl').onclick = () => state.level.n < progress.unlocked && loadLevel(state.level.n + 1);

  loadLevel(Math.max(1, progress.unlocked));
  requestAnimationFrame(frame);
}

main();
