// Boot, the game loop, camera, HUD and the menu cards.

import * as THREE from 'three';
import { loadTune } from './tune.js';
import { buildTerrain, heightAt, groundAt } from './terrain.js';
import { textures } from './art.js';
import { buildWorld } from './world.js';
import { buildRider } from './rider.js';
import { createPhysics } from './physics.js';
import { buildFx, popup } from './fx.js';
import { createInput } from './input.js';

const T = await loadTune();
buildTerrain();

// ---- renderer and scene ---------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const tex = textures();
scene.background = tex.sky;
scene.fog = new THREE.Fog('#dfeaf7', 70, 190);
scene.add(new THREE.HemisphereLight('#eaf3ff', '#8aa0c0', 1.15));
const sun = new THREE.DirectionalLight('#fff4e0', 1.3);
sun.position.set(-30, 40, 35);
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

const W = buildWorld(scene, tex);
const rider = buildRider(scene, tex);
const fx = buildFx(scene, tex);
const pops = document.getElementById('pops');

// ---- game state -----------------------------------------------------------------

let state = 'menu';            // menu | run | done
let gear = localStorage.getItem('downhill.gear') || 'skis';
let score = 0, stars = 0, time = 0, crashes = 0;
let doneT = 0;

const physics = createPhysics(T, W, onEvent);

function onEvent(type, d) {
  switch (type) {
    case 'spray': fx.spray(d.x, d.y, d.z, d.amount); break;
    case 'sparks': fx.sparks(d.x, d.y, d.z); break;
    case 'land': if (d.impact > 6) fx.burst(d.x, d.y, d.z, Math.min(40, d.impact * 3)); break;
    case 'score':
      score += d.pts;
      popup(pops, d.parts.join(' + '), 'big');
      popup(pops, '+' + d.pts + (d.mult > 1 ? '  ×' + String(d.mult).replace('.', ',') : ''));
      break;
    case 'crash':
      crashes++;
      popup(pops, d.why, 'bad');
      fx.burst(d.x, d.y, d.z, 40);
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
  <kbd>1</kbd>/<kbd>2</kbd> sukset/lauta · <kbd>Enter</kbd> aloita
</div>`;

function showMenu() {
  state = 'menu';
  card.innerHTML = `<h1>Downhill</h1>
    <p>Vuorta alas. Hyppää, grindaa harjoja, pomppaa latvoista ja kerää tähdet.</p>
    ${gearButtons()}
    <button class="go">Laske!</button>
    ${KEYS_HELP}`;
  card.hidden = false;
  wireCard();
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
    <button class="go">Uudestaan</button>`;
  card.hidden = false;
  wireCard();
}

const input = createInput((code) => {
  if (state !== 'run') {
    if (code === 'Digit1') setGear('skis');
    if (code === 'Digit2') setGear('board');
    if (code === 'Enter') start();
  } else if (code === 'KeyR') start();
  else if (code === 'Escape') showMenu();
});

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
function placeCamera(k) {
  const { s, C } = cameraTarget();
  const bx = Math.sin(camYaw), bz = Math.cos(camYaw);
  const ground = Math.max(groundAt(s.x, s.z), s.mode === 'crash' ? s.y : Math.min(s.y, groundAt(s.x, s.z) + 6));
  const tx = s.x + bx * C.dist, tz = s.z + bz * C.dist;
  const ty = Math.max(ground + C.height, heightAt(tx, tz) + 2.5);
  camera.position.lerp(new THREE.Vector3(tx, ty, tz), k);
  const look = new THREE.Vector3(s.x - bx * C.lookAhead, ground + 0.5, s.z - bz * C.lookAhead);
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

  if (state === 'run' || state === 'done') {
    acc += dt;
    const inp = state === 'run' ? (window.downhill.drive?.(physics.s) ?? input.read()) : idle;
    while (acc >= DT) { physics.step(DT, inp); acc -= DT; }
    if (state === 'run') time += dt;
    if (state === 'done') {
      doneT += dt;
      if (doneT > 1.6 && card.hidden) showResults();
    }
  }

  const s = physics.s;
  W.update(dt, clock, s);
  fx.update(dt);
  rider.update(s, dt, W.placeOnGround, heightAt(s.x, s.z));
  const { want, C } = cameraTarget();
  camYaw += (want - camYaw) * Math.min(1, dt * 1.5);
  placeCamera(Math.min(1, dt * 8));
  W.faceCamera(camera);
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
const el = { score: $('score'), run: $('run'), stars: $('stars'), time: $('time'), speed: $('speed') };
function hud() {
  const s = physics.s;
  el.score.textContent = score;
  el.run.textContent = s.run.parts.length ? s.run.parts.join(' + ') + '  ' + s.run.pts : '';
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
