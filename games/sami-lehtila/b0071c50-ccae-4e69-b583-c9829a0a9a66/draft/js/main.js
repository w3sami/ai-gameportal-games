// Tanssiauto: a faceless cartoon car whose four spring legs are its limbs.
// This file is the modes and the frame loop; the parts are in the other modules.
//   menu    the start screen, the car dancing by itself behind it
//   play    notes arrive on the board and the player presses them in time
//   watch   the machine plays the same chart without a fault
//   record  the player dances the song and the presses become a new chart
//   free    no chart: the player dances, or lets the car do it

import { car, tune, bindTune, step, STEP } from './car.js';
import { ctx, view, resize, setStage, setCamera, setPose, stepAntenna, drawBackground, drawCar } from './draw.js';
import { LANES, bindPad, held, onPress, onRelease, setLayout, pressLane, releaseLane } from './input.js';
import { Music } from './music.js';
import { loadChart, Run, Recorder } from './chart.js';
import * as boardNotes from './highway.js';
import * as ringNotes from './ring.js';
import { freestyleLanes } from './freestyle.js';
import { cameraAt, REST } from './camera.js';
import { gizmo, gizmoDown, gizmoMove, gizmoUp, gizmoWheel, gizmoReadout, drawGizmo } from './gizmo.js';
import { loadOwn, saveOwn } from './library.js';

// The charts that ship with the game. They share one song; the first is the default.
const CHART_URLS = ['charts/raspberry-jam.json', 'charts/raspberry-jam-dance.json'];
const DELAY_KEY = 'tanssiauto.delay';
const NOTES_KEY = 'tanssiauto.notes';
const DEFAULT_SPB = 60 / 112;     // the stage pulses at this pace before a chart has loaded

const $ = (id) => document.getElementById(id);
const menu = $('menu'), results = $('results'), tunePanel = $('tune');
const menuBtn = $('menuBtn'), muteBtn = $('muteBtn'), autoBtn = $('autoBtn');
const chartPick = $('chartPick'), ownTools = $('ownTools'), deleteBtn = $('deleteBtn'), jsonOut = $('jsonOut');
const touch = matchMedia('(pointer: coarse)').matches;

const music = new Music();
let builtins = [];        // the charts that ship with the game
let builtin = null;       // the first of them: the song's file and tempo are read from it
let own = loadOwn();      // charts recorded in this browser
let chart = null;         // the one chosen in the menu
let run = null;
let recorder = null;
let mode = 'menu';
let autoDance = true;
let muted = false;

bindTune();
const padButtons = bindPad($('pad'));
addEventListener('resize', resize);
resize();

const chartReady = Promise.all(CHART_URLS.map(loadChart)).then((list) => {
  builtins = list;
  builtin = chart = list[0];
  $('credit').textContent = `Musiikki: ${builtin.title}, ${builtin.author} (${builtin.license})`;
  fillPick('builtin-0');
});

// What the player hears lags what the browser reports by an amount only the
// player can judge, so it is theirs to set.
const delayEl = $('delay');
function setDelay(ms) {
  music.extraDelay = ms / 1000;
  delayEl.value = ms;
  $('delayVal').textContent = `${ms} ms`;
}
let savedDelay = 0;
try { savedDelay = +localStorage.getItem(DELAY_KEY) || 0; } catch (err) { /* no storage */ }
setDelay(savedDelay);
delayEl.addEventListener('input', () => {
  setDelay(+delayEl.value);
  try { localStorage.setItem(DELAY_KEY, delayEl.value); } catch (err) { /* no storage */ }
});

// The two ways to show a chart: 'ring' round the car or 'board' above it.
const NOTE_VIEWS = { ring: ringNotes, board: boardNotes };
let notesKind = 'ring';
try { notesKind = localStorage.getItem(NOTES_KEY) === 'board' ? 'board' : 'ring'; } catch (err) { /* no storage */ }
let notes = NOTE_VIEWS[notesKind];
$('notesPick').value = notesKind;
$('notesPick').addEventListener('change', () => {
  notesKind = $('notesPick').value;
  notes = NOTE_VIEWS[notesKind];
  try { localStorage.setItem(NOTES_KEY, notesKind); } catch (err) { /* no storage */ }
});

// Switches for the ring's look.
for (const btn of document.querySelectorAll('[data-look]')) {
  const name = btn.dataset.look;
  btn.classList.toggle('on', ringNotes.settings[name]);
  btn.addEventListener('click', () => {
    ringNotes.setLook(name, !ringNotes.settings[name]);
    btn.classList.toggle('on', ringNotes.settings[name]);
  });
}

// ---------------------------------------------------------------- charts
function fillPick(selected) {
  chartPick.textContent = '';
  const add = (value, label) => {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = label;
    chartPick.append(opt);
  };
  builtins.forEach((c, i) => add(`builtin-${i}`, `${c.title} · ${c.name}`));
  for (const c of own) add(c.id, `${c.title} · ${c.notes.length} nuottia`);
  chartPick.value = selected;
  pickChart();
}
function pickChart() {
  const mine = own.find((c) => c.id === chartPick.value);
  chart = mine || builtins[+chartPick.value.split('-')[1]] || builtin;
  ownTools.hidden = !mine;
  jsonOut.hidden = true;
  deleteBtn.textContent = 'Poista';
  deleteBtn.dataset.armed = '';
}
chartPick.addEventListener('change', pickChart);

$('copyBtn').addEventListener('click', async () => {
  const text = JSON.stringify(chart);
  try {
    await navigator.clipboard.writeText(text);
    $('status').textContent = 'Kopioitu leikepöydälle.';
  } catch (err) {
    // A framed game may not reach the clipboard: show the text to copy by hand.
    jsonOut.hidden = false;
    jsonOut.value = text;
    jsonOut.select();
  }
});
// Deleting asks once more in the button itself.
deleteBtn.addEventListener('click', () => {
  if (!deleteBtn.dataset.armed) {
    deleteBtn.dataset.armed = '1';
    deleteBtn.textContent = 'Poista varmasti?';
    return;
  }
  own = own.filter((c) => c.id !== chart.id);
  saveOwn(own);
  fillPick('builtin-0');
  $('status').textContent = 'Poistettu.';
});

// ---------------------------------------------------------------- modes
function spb() { return builtin ? builtin.spb : DEFAULT_SPB; }
// Whether the song hits hard on this beat: the snare, read from the module by the chart scripts.
function onAccent(beat) {
  return (builtin.accents || []).some((b) => Math.abs(b - beat) < 0.13);
}
function songTime() { return music.time(); }
function charted() { return mode === 'play' || mode === 'watch' || mode === 'record'; }
function beatNow(t) {
  if (t !== null) return t / spb();
  if (charted()) return -1;                                   // song about to start
  return performance.now() / 1000 / spb();
}

// Following or making a chart swaps the pad for the note board and the grid keys for the row.
function setMode(next) {
  mode = next;
  setLayout(charted() ? 'row' : 'grid');
  setStage(charted() ? notesKind : 'stage');
  $('pad').hidden = charted();
  $('help').hidden = charted();
  menuBtn.textContent = next === 'record' ? 'Valmis' : 'Valikko';
  $('gizmoBtn').hidden = !(charted() && notesKind === 'ring');
  if (!charted()) setGizmo(false);
}

async function start(next) {
  $('status').textContent = 'Ladataan…';
  try {
    await chartReady;
    await music.init(builtin.file);
  } catch (err) {
    $('status').textContent = `Lataus ei onnistunut: ${err.message}`;
    return;
  }
  $('status').textContent = '';
  run = next === 'play' || next === 'watch' ? new Run(chart) : null;
  if (run) run.onHit = (item, grade) => notes.hitEffect(item.lane, grade, onAccent(grade === 'held' ? item.beat + item.hold : item.beat));
  recorder = next === 'record' ? new Recorder(builtin.spb) : null;
  setMode(next);
  music.play(next === 'free');
  music.setVolume(muted ? 0 : 1);
  menu.hidden = true;
  results.hidden = true;
  menuBtn.hidden = false;
  autoBtn.hidden = next !== 'free';
  tunePanel.open = next === 'free';
}

function toMenu() {
  music.stop();
  run = null;
  recorder = null;
  setMode('menu');
  menu.hidden = false;
  results.hidden = true;
  menuBtn.hidden = true;
  autoBtn.hidden = true;
}

function showResults() {
  const c = run.counts;
  $('resScore').textContent = run.score;
  $('resAccuracy').textContent = `${Math.round(run.accuracy * 100)} %`;
  $('resCombo').textContent = run.maxCombo;
  $('resCounts').textContent =
    `Täydellinen ${c.perfect} · Hyvä ${c.good} · Ok ${c.ok} · Ohi ${c.miss} · Huti ${c.stray}` +
    ` · Pidot ${c.held}/${c.held + c.dropped}`;
  const mean = Math.round(run.meanOffset * 1000);
  $('resTiming').textContent = mean === 0 ? 'Painoit keskimäärin kohdalleen.'
    : `Painoit keskimäärin ${Math.abs(mean)} ms ${mean < 0 ? 'etuajassa' : 'myöhässä'}.`;
  setMode('menu');
  results.hidden = false;
  menuBtn.hidden = true;
}

// The take becomes a chart of its own, chosen in the menu right away.
function finishRecording() {
  const t = songTime();
  if (t !== null) recorder.finish(t);
  const notes = recorder.notes();
  toMenu();
  if (!notes.length) {
    $('status').textContent = 'Nauhoitus oli tyhjä, mitään ei tallennettu.';
    return;
  }
  const now = new Date();
  const stamp = `${now.getDate()}.${now.getMonth() + 1}. ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const made = {
    id: `own-${now.getTime()}`,
    title: `Oma ${stamp}`,
    file: builtin.file, bpm: builtin.bpm, spb: builtin.spb,
    notes,
  };
  own.push(made);
  const stored = saveOwn(own);
  fillPick(made.id);
  $('status').textContent = stored
    ? `Tallennettu: ${made.title}, ${notes.length} nuottia. Se on nyt valittuna.`
    : 'Selain ei anna tallentaa. Koreografia on käytössä kunnes sivu suljetaan: kopioi se talteen.';
}

function leave() {
  if (mode === 'record') finishRecording();
  else toMenu();
}

music.onEnded = () => {
  if (mode === 'play') showResults();
  else leave();
};

for (const btn of document.querySelectorAll('[data-start]')) {
  btn.addEventListener('click', () => start(btn.dataset.start));
}
menuBtn.addEventListener('click', leave);
$('resMenu').addEventListener('click', toMenu);
autoBtn.addEventListener('click', () => {
  autoDance = !autoDance;
  autoBtn.classList.toggle('on', autoDance);
});
function toggleMute() {
  muted = !muted;
  muteBtn.classList.toggle('on', !muted);
  music.setVolume(muted ? 0 : 1);
}
muteBtn.addEventListener('click', toggleMute);
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Escape' && mode !== 'menu') leave();
});

onPress((lane) => {
  const t = songTime();
  if (t === null) return;
  if (mode === 'play') run.press(lane, t);
  if (mode === 'record') recorder.press(lane, t);
});
onRelease((lane) => {
  const t = songTime();
  if (t === null) return;
  if (mode === 'play') run.release(lane, t);
  if (mode === 'record') recorder.release(lane, t);
});

// The letter gizmo: a panel and a way of handling the pointer, both on while it is active.
function setGizmo(on) {
  gizmo.active = on;
  if (!on) gizmo.selected = null;
  $('gizmoPanel').hidden = !on;
  $('gizmoBtn').classList.toggle('on', on);
  $('gizmoOut').hidden = true;
  $('gizmoReset').textContent = 'Palauta asettelu';
  $('gizmoReset').dataset.armed = '';
}
for (const [value, label] of ringNotes.LETTER_PRESETS) {
  const opt = document.createElement('option');
  opt.value = value; opt.textContent = label;
  $('gizmoPreset').append(opt);
}
$('gizmoPreset').value = ringNotes.letterPreset();
$('gizmoPreset').addEventListener('change', () => {
  ringNotes.setLetterPreset($('gizmoPreset').value);
  gizmo.selected = null;
});
$('gizmoBtn').addEventListener('click', () => setGizmo(!gizmo.active));
$('gizmoDone').addEventListener('click', () => setGizmo(false));
$('gizmoMirror').addEventListener('click', () => {
  gizmo.mirror = !gizmo.mirror;
  $('gizmoMirror').classList.toggle('on', gizmo.mirror);
});
$('gizmoCopy').addEventListener('click', async () => {
  const text = JSON.stringify(ringNotes.letterSettings());
  try {
    await navigator.clipboard.writeText(text);
    $('gizmoCopy').textContent = 'Kopioitu';
    setTimeout(() => { $('gizmoCopy').textContent = 'Kopioi asetukset'; }, 1500);
  } catch (err) {
    $('gizmoOut').hidden = false;
    $('gizmoOut').value = text;
    $('gizmoOut').select();
  }
});
// Resetting asks once more in the button itself.
$('gizmoReset').addEventListener('click', () => {
  const btn = $('gizmoReset');
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Palauta varmasti?'; return; }
  ringNotes.resetLetters();
  gizmo.selected = null;
  btn.dataset.armed = ''; btn.textContent = 'Palauta asettelu';
});

// While following or making a chart, a touch anywhere in a lane's column presses that lane.
const touches = new Map();
const stageEl = $('stage');
// Keeps a drag coming to the canvas after it leaves it. A pointer the browser
// does not know, such as a scripted one, cannot be captured; the drag still works.
function capture(e) {
  try { stageEl.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
}
stageEl.addEventListener('pointermove', (e) => { if (gizmo.active) gizmoMove(view, e.clientX, e.clientY); });
stageEl.addEventListener('wheel', (e) => {
  if (!gizmo.active) return;
  e.preventDefault();
  gizmoWheel(view, e.deltaY, e.shiftKey);
}, { passive: false });
stageEl.addEventListener('pointerdown', (e) => {
  if (gizmo.active) {
    e.preventDefault();
    gizmoDown(view, e.clientX, e.clientY);
    capture(e);
    return;
  }
  if (mode !== 'play' && mode !== 'record') return;
  const lane = notes.laneAt(view, e.clientX, e.clientY);
  if (!lane) return;
  e.preventDefault();
  capture(e);
  touches.set(e.pointerId, lane);
  pressLane(lane);
});
function endTouch(e) {
  gizmoUp();
  const lane = touches.get(e.pointerId);
  if (!lane) return;
  touches.delete(e.pointerId);
  releaseLane(lane);
}
stageEl.addEventListener('pointerup', endTouch);
stageEl.addEventListener('pointercancel', endTouch);

// ---------------------------------------------------------------- loop
let last = performance.now();
let pending = 0;

// The shots play whenever the keys are a row. In free dance the grid keys sit
// where the wheels are on screen, so there the camera stays at rest.
let airborne = false;
let fallSpeed = 0;                // fastest fall of the current flight, m/s
let shake = 0;                    // 0..1, set by a landing and dying away

function moveCamera(dt, now, beat) {
  // A landing knocks the camera in proportion to how fast the car came down.
  const flying = car.wheels.every((w) => w.h > 0.03);
  if (flying) fallSpeed = Math.max(fallSpeed, -car.vy);
  if (airborne && !flying) { shake = Math.min(1, fallSpeed / 7); fallSpeed = 0; }
  airborne = flying;
  shake *= Math.exp(-7 * dt);

  if (mode === 'free') { setCamera(REST); return; }
  const calm = mode === 'play' || mode === 'record';
  const cam = cameraAt(beat, calm);
  const frac = beat - Math.floor(beat);
  cam.zoom *= 1 + (calm ? 0.015 : 0.04) * (1 - frac) * (1 - frac);     // a punch on every beat
  cam.dy += shake * 0.1 * Math.sin(now * 0.07);
  cam.roll += shake * 0.025 * Math.sin(now * 0.053);
  setCamera(cam);
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = songTime();
  const beat = beatNow(t);

  const lanes = held();
  const add = (more) => { for (const id in more) lanes[id] = true; };
  if (mode === 'menu' || (mode === 'free' && autoDance)) add(freestyleLanes(beat));
  if (mode === 'watch' && t !== null) add(run.autoLanes(beat));
  if (mode === 'play' && t !== null) run.update(t);
  if (mode === 'record' && t !== null) recorder.update(t);

  const due = mode === 'play' && t !== null ? run.due(t) : {};
  for (const lane of LANES) {
    padButtons[lane.id].classList.toggle('on', !!lanes[lane.id]);
    padButtons[lane.id].classList.toggle('due', !!due[lane.id]);
  }

  pending += dt;
  while (pending >= STEP) { step(STEP, lanes); pending -= STEP; }
  moveCamera(dt, now, beat);
  setPose();
  stepAntenna(dt);
  drawBackground(beat);
  if (run) notes.drawHighway(ctx, view, run.items, beat, lanes, touch, run.combo);
  if (recorder) {
    notes.drawRecording(ctx, view, recorder.items, beat, lanes, touch);
    notes.drawCaption(ctx, view, `● Nauhoittaa · ${recorder.items.length} painallusta`, '#ff7a6a');
  }
  drawCar();
  if (run || recorder) notes.drawOverlay(ctx, view, lanes, touch);
  if (gizmo.active) {
    drawGizmo(ctx, view);
    $('gizmoRead').textContent = gizmoReadout(view);
  }
  if (run && mode === 'play') notes.drawHud(ctx, view, run, t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.tanssiauto = {
  car, tune, music,
  get run() { return run; }, get recorder() { return recorder; }, get mode() { return mode; },
  get chart() { return chart; },
};
