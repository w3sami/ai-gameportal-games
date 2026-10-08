// Boot, the game loop, camera, HUD and the menu cards.

import * as THREE from 'three';
import { loadTune } from './tune.js';
import { buildTerrain, heightAt, groundAt } from './terrain.js';
import { textures } from './art.js';
import { buildWorld } from './world.js';
import { buildRider } from './rider.js';
import { createPhysics } from './physics.js';
import { buildFx, popup } from './fx.js';
import { buildTrails } from './trail.js';
import { createInput } from './input.js';
import { createTuning } from './tuning.js';

const T = await loadTune();
buildTerrain(T);

// ---- renderer and scene ---------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const tex = textures();
scene.background = tex.sky;
scene.fog = new THREE.Fog('#dfeaf7', 70, 190);
scene.add(new THREE.HemisphereLight('#ffffff', '#b4c6e2', 1.7));
const sun = new THREE.DirectionalLight('#fff6e8', 1.2);
sun.position.set(-20, 60, 30);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(T.camera.fov, 1, 0.5, 260);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// far mountains ride along with the camera, past the fog
const mountains = new THREE.Mesh(new THREE.PlaneGeometry(600, 150),
  new THREE.MeshBasicMaterial({ map: tex.mountains, alphaTest: 0.5, fog: false, depthWrite: false, depthTest: false }));
mountains.renderOrder = -1;   // drawn first, so the slope always covers it
scene.add(mountains);

const W = buildWorld(scene, tex, T);
const rider = buildRider(scene, tex);
const fx = buildFx(scene, tex);
const trails = buildTrails(scene);
const pops = document.getElementById('pops');

// ---- game state -----------------------------------------------------------------

let state = 'menu';            // menu | run | done
let gear = localStorage.getItem('downhill.gear') || 'skis';
let score = 0, stars = 0, time = 0, crashes = 0;
let doneT = 0;

const physics = createPhysics(T, W, onEvent);

function onEvent(type, d) {
  switch (type) {
    case 'spray': fx.spray(d.x, d.y, d.z, d.amount * T.snowSpray); break;
    case 'sparks': fx.sparks(d.x, d.y, d.z); break;
    case 'land': if (d.impact > 3) fx.burst(d.x, d.y, d.z, Math.min(160, d.impact * 4 * T.snowSpray), [1, 1, 1], 2 + d.impact * 0.3); break;
    case 'score':
      score += d.pts;
      popup(pops, d.parts.join(' + '), 'big');
      popup(pops, '+' + d.pts + (d.mult > 1 ? '  ×' + String(d.mult).replace('.', ',') : ''));
      break;
    case 'crash':
      crashes++;
      fx.burst(d.x, d.y, d.z, d.kind === 'bury' ? 30 + d.sp * 3 : 40, [1, 1, 1], d.kind === 'bury' ? 3 + d.sp * 0.25 : 4);
      break;
    case 'star':
      stars++; score += T.points.star;
      popup(pops, '★ +' + T.points.star, 'star');
      fx.burst(d.x, d.y, d.z, 30, [1, 0.9, 0.3], 5);
      break;
    case 'break': {
      score += T.points.break;
      popup(pops, (d.o.what === 'table' ? 'Pöytä' : 'Lumiukko') + ' +' + T.points.break);
      const cols = d.o.what === 'table' ? [[1, 1, 1], [0.85, 0.2, 0.2], [0.35, 0.6, 0.85]] : [[1, 1, 1], [0.95, 0.55, 0.15], [0.1, 0.1, 0.1]];
      fx.shards(d.o.x, groundAt(d.o.x, d.o.z), d.o.z, cols);
      break;
    }
    case 'push': fx.burst(d.x, d.y, d.z, 14, [1, 1, 1], 2.5); break;
    case 'bounce': popup(pops, d.name + '!'); fx.burst(d.x, d.y, d.z, 16); break;
    case 'grindStart': popup(pops, 'Grindi!'); break;
    case 'finish': state = 'done'; doneT = 0; break;
  }
}

function start() {
  W.reset();
  physics.setGear(gear);
  rider.setGear(gear);
  physics.reset();
  score = 0; stars = 0; time = 0; crashes = 0;
  state = 'run';
  card.hidden = true;
  jumpLock = true;
  snapCamera();
}

// ---- cards ----------------------------------------------------------------------

const card = document.getElementById('card');

const GEAR_TEXT = {
  skis: ['Sukset', 'Kovempi vauhti, joten hypyistä enemmän korkeutta'],
  board: ['Lauta', 'Pyöri villisti, niin leijut pidempään'],
};

function gearButtons() {
  return '<div class="gear">' + Object.entries(GEAR_TEXT).map(([k, [name, desc]]) =>
    `<button data-gear="${k}" class="${k === gear ? 'sel' : ''}"><b>${name}</b><small>${desc}</small></button>`).join('') + '</div>';
}

function wireCard() {
  for (const b of card.querySelectorAll('[data-gear]')) {
    b.onclick = () => { setGear(b.dataset.gear); };
  }
  card.querySelector('.go').onclick = start;
  const r = card.querySelector('.remap');
  if (r) r.onclick = remap;
}

function setGear(g) {
  gear = g;
  try { localStorage.setItem('downhill.gear', g); } catch {}
  physics.setGear(g);
  rider.setGear(g);
  for (const b of card.querySelectorAll('[data-gear]')) b.classList.toggle('sel', b.dataset.gear === g);
}

const KEYS_HELP = `<div class="keys">
  <kbd>◀</kbd> <kbd>▶</kbd> kääntyy maassa, pyörii ilmassa ·
  <kbd>▲</kbd> kyykky vauhtiin, ilmassa etuvoltti ·
  <kbd>▼</kbd> jarru, ilmassa takavoltti ·
  <kbd>välilyönti</kbd> pohjassa kyykkyyn, irti hyppyyn ·
  <kbd>1</kbd>/<kbd>2</kbd> sukset/lauta · <kbd>Enter</kbd> aloita · <kbd>Esc</kbd> tauko · <kbd>F</kbd> koko ruutu
  <br>Ohjaimella: sauva tai ristiohjain, <kbd>A</kbd> hyppy, <kbd>Start</kbd> tauko,
  <kbd>Back</kbd> alusta, <kbd>Y</kbd> ohjainasetukset, <kbd>RS</kbd> koko ruutu
</div>`;

function showMenu() {
  state = 'menu';
  card.innerHTML = `<h1>Downhill</h1>
    <p>Vuorta alas. Hyppää, grindaa harjoja, pomppaa latvoista ja kerää tähdet.</p>
    ${gearButtons()}
    <button class="go">Laske!</button>
    <button class="remap">Ohjaimet</button>
    ${KEYS_HELP}`;
  card.hidden = false;
  wireCard();
}

function showPause() {
  state = 'paused';
  card.innerHTML = `<h2>Tauko</h2>
    <button class="go">Jatka</button>
    <button class="restart">Alusta</button>
    <button class="remap">Ohjaimet</button>
    <button class="tomenu">Valikkoon</button>`;
  card.hidden = false;
  card.querySelector('.go').onclick = resume;
  card.querySelector('.restart').onclick = start;
  card.querySelector('.remap').onclick = remap;
  card.querySelector('.tomenu').onclick = showMenu;
}

function resume() {
  jumpLock = true;
  state = 'run';
  card.hidden = true;
  last = performance.now();
}

function remap() {
  input.open(() => {});
}

function showResults() {
  const t = fmtTime(time);
  card.innerHTML = `<h2>Maalissa!</h2>
    <div class="results">
      Pisteet <b>${score}</b><br>
      Tähdet <b>${stars}/${W.starCount}</b><br>
      Aika <b>${t}</b> · kaatumisia <b>${crashes}</b>
    </div>
    ${gearButtons()}
    <button class="go">Uudestaan</button>
    <button class="remap">Ohjaimet</button>`;
  card.hidden = false;
  wireCard();
}

const input = createInput();

// developer's tuning panel; its pause (and the portal's) freezes the run in place
let frozen = false;
const tuning = createTuning(T, { onPause: (on) => { frozen = on ?? !frozen; last = performance.now(); }, rider: () => physics.s });

// The press that starts or resumes a run must not also be its first jump.
let jumpLock = false;
function readInput() {
  const inp = input.read();
  if (jumpLock) { if (!inp.jump) jumpLock = false; inp.jump = false; }
  return inp;
}

addEventListener('keydown', (e) => {
  if (input.isOpen() || e.repeat) return;
  if (state === 'menu' || state === 'results') {
    if (e.code === 'Digit1') setGear('skis');
    if (e.code === 'Digit2') setGear('board');
    if (e.code === 'Enter') start();
  } else if (state === 'paused' && e.code === 'Enter') resume();
});

// Fullscreen needs a user gesture: the button, F, or a real controller press.
// Safari on iPhone has no fullscreen for pages, so the button hides there.
const fsButton = document.getElementById('fs');
fsButton.hidden = !document.fullscreenEnabled;
// corner brackets pointing out (enter) or in (leave); drawn, since no font has them all
const FS_ICON = {
  enter: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  leave: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>',
};
fsButton.innerHTML = FS_ICON.enter;
function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
fsButton.addEventListener('click', () => { toggleFullscreen(); fsButton.blur(); });
document.addEventListener('fullscreenchange', () => {
  fsButton.innerHTML = document.fullscreenElement ? FS_ICON.leave : FS_ICON.enter;
});

// Menu keys from the mapped inputs, so a controller can drive the cards.
function menuInput() {
  if (input.isOpen()) return;
  if (input.pressed('fullscreen')) toggleFullscreen();
  if (input.pressed('controls') && state !== 'run') return remap();
  if (state === 'run') {
    if (input.pressed('menu')) showPause();
    else if (input.pressed('restart')) start();
  } else if (state === 'paused') {
    if (input.pressed('menu') || input.pressed('jump')) resume();
    else if (input.pressed('restart')) start();
  } else if (state === 'menu' || state === 'results') {
    if (input.pressed('left')) setGear('skis');
    if (input.pressed('right')) setGear('board');
    if (input.pressed('jump') || input.pressed('menu')) start();
  }
}

// ---- camera ---------------------------------------------------------------------

const camLook = new THREE.Vector3();
let camYaw = 0;
function cameraTarget() {
  const s = physics.s;
  const C = T.camera;
  const vh = Math.atan2(-s.vx, -s.vz);
  const want = Math.hypot(s.vx, s.vz) > 2 ? Math.max(-C.turn, Math.min(C.turn, vh)) : 0;
  return { want, s, C };
}
function snapCamera() {
  const { want } = cameraTarget();
  camYaw = want;
  placeCamera(1);
}
let camFocus = 0;
function placeCamera(k) {
  const { s, C } = cameraTarget();
  const bx = Math.sin(camYaw), bz = Math.cos(camYaw);
  // follow the rider's height all the way up, and back off the higher they are
  const above = Math.max(0, s.y - groundAt(s.x, s.z));
  camFocus = k >= 1 ? s.y : camFocus + (s.y - camFocus) * Math.min(1, k * 1.5);
  const dist = C.dist + above * C.pullBack, height = C.height + above * C.rise;
  const tx = s.x + bx * dist, tz = s.z + bz * dist;
  const ty = Math.max(camFocus + height, heightAt(tx, tz) + 2.5);
  camera.position.lerp(new THREE.Vector3(tx, ty, tz), k);
  const look = new THREE.Vector3(s.x - bx * C.lookAhead, camFocus + 0.5, s.z - bz * C.lookAhead);
  camLook.lerp(look, k);
  camera.lookAt(camLook);
  mountains.position.set(camera.position.x - bx * 200, camera.position.y - 10, camera.position.z - bz * 200);
  mountains.rotation.y = camYaw;
}

// ---- loop -----------------------------------------------------------------------

const DT = 1 / 120;
let acc = 0, last = performance.now(), clock = 0;
const idle = { x: 0, up: 0, down: 0, jump: false };

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;
  input.poll(dt);
  menuInput();

  if ((state === 'run' || state === 'done') && !frozen) {
    acc += dt;
    const inp = state === 'run' ? (window.downhill.drive?.(physics.s) ?? readInput()) : idle;
    while (acc >= DT) { physics.step(DT, inp); acc -= DT; }
    if (state === 'run' && physics.s.started) time += dt;
    if (state === 'done') {
      doneT += dt;
      if (doneT > 1.6 && card.hidden) { showResults(); state = 'results'; }
    }
  }

  const s = physics.s;
  W.update(dt, clock, s);
  fx.update(dt);
  rider.update(s, dt, W.placeOnGround, heightAt(s.x, s.z));
  {
    const sp = Math.hypot(s.vx, s.vz);
    const a = s.mode === 'crash' || s.mode === 'ready' ? 0 : Math.max(0, Math.min(1, (sp - T.trailFrom) / Math.max(0.1, T.trailFull - T.trailFrom)));
    trails.update(rider.tails(), a, gear === 'board' ? 0.3 : 0.11);
  }
  if (camera.fov !== T.camera.fov) { camera.fov = T.camera.fov; camera.updateProjectionMatrix(); }
  const { want, C } = cameraTarget();
  camYaw += (want - camYaw) * Math.min(1, dt * 1.5);
  placeCamera(Math.min(1, dt * 8));
  W.faceCamera(camera);
  W.showCheckpoints(tuning.open);
  void C;

  hud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function fmtTime(t) {
  const m = Math.floor(t / 60), sec = t - m * 60;
  return m + ':' + sec.toFixed(1).padStart(4, '0').replace('.', ',');
}

const $ = (id) => document.getElementById(id);
const el = { score: $('score'), run: $('run'), stars: $('stars'), time: $('time'), speed: $('speed'), fade: $('fade'), hint: $('hint') };
function hud() {
  const s = physics.s;
  el.score.textContent = score;
  el.run.textContent = s.run.parts.length ? s.run.parts.join(' + ') + '  ' + s.run.pts : '';
  el.fade.style.opacity = s.fade;
  el.hint.hidden = !(state === 'run' && s.mode === 'ready');
  el.hint.textContent = gear === 'board' ? 'Hyppy: potkaise vauhtia!' : 'Hyppy: sauvavauhtia!';
  el.stars.textContent = '★ ' + stars + '/' + W.starCount;
  el.time.textContent = fmtTime(time);
  el.speed.textContent = Math.round(physics.speed() * 3.6) + ' km/h';
}

physics.setGear(gear);
rider.setGear(gear);
snapCamera();
showMenu();
requestAnimationFrame(frame);

// for the developer console; drive(s) may return an input to steer by script
window.downhill = { physics, W, T, scene, camera, start, drive: null, ground: groundAt };
