// Every picture in the game, drawn on canvases at load.
//
// Each draw function paints one look into a canvas; textures() turns them into
// three.js textures by name. Replacing one look with an image file means
// replacing its entry here — nothing else reads the drawings.

import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function texture(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blob(g, x, y, rx, ry, fill) {
  g.fillStyle = fill;
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
}

function roundRect(g, x, y, w, h, r, fill) {
  g.fillStyle = fill;
  g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
}

// ---- spruce -------------------------------------------------------------

function spruce(seed) {
  const W = 256, H = 512;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  roundRect(g, W * 0.44, H * 0.8, W * 0.12, H * 0.2, 4, '#5b3a24');
  const tiers = 6, top = H * 0.02, bottom = H * 0.86;
  for (let i = 0; i < tiers; i++) {
    const apex = top + (bottom - top) * (i / tiers) * 0.82;
    const base = top + (bottom - top) * ((i + 1) / tiers);
    const half = W * (0.12 + 0.37 * (i + 1) / tiers) * (0.94 + r() * 0.1);
    const grad = g.createLinearGradient(W / 2 - half, 0, W / 2 + half, 0);
    grad.addColorStop(0, '#2f6b3f'); grad.addColorStop(0.55, '#1f4f2e'); grad.addColorStop(1, '#173d24');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(W / 2, apex);
    g.lineTo(W / 2 + half, base);
    const teeth = 4 + i;
    for (let k = teeth; k >= 0; k--) {
      const x = W / 2 - half + (2 * half * k) / teeth;
      g.lineTo(x, base - (k % 2 ? H * 0.025 : 0));
    }
    g.closePath(); g.fill();
    // snow on the tier: a cap along the upper edges and lumps on the hem
    g.fillStyle = '#f4f8ff';
    g.beginPath(); g.moveTo(W / 2, apex - 2);
    g.lineTo(W / 2 + half * 0.55, apex + (base - apex) * 0.55);
    g.quadraticCurveTo(W / 2, apex + (base - apex) * 0.35, W / 2 - half * 0.6, apex + (base - apex) * 0.6);
    g.closePath(); g.fill();
    for (let k = 0; k < 3 + i; k++) {
      const x = W / 2 - half * 0.85 + r() * half * 1.7;
      blob(g, x, base - H * 0.012, 10 + r() * 12, 6 + r() * 3, '#c9d8ee');
      blob(g, x, base - H * 0.018, 9 + r() * 10, 5 + r() * 3, '#f6f9ff');
    }
  }
  return c;
}

// ---- people and dogs -----------------------------------------------------

const JACKETS = ['#d6453d', '#3b7dd8', '#f2a541', '#53a35b', '#8e5cc4', '#e46aa6', '#2a9d8f'];
const PANTS = ['#2b2d42', '#3d405b', '#5c4033', '#1d3557'];

function person(seed) {
  const W = 128, H = 256;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  const jacket = JACKETS[Math.floor(r() * JACKETS.length)];
  const hat = JACKETS[Math.floor(r() * JACKETS.length)];
  const pants = PANTS[Math.floor(r() * PANTS.length)];
  const cx = W / 2;
  // legs and boots
  roundRect(g, cx - 22, 160, 18, 80, 6, pants);
  roundRect(g, cx + 4, 160, 18, 80, 6, pants);
  roundRect(g, cx - 26, 232, 26, 18, 6, '#2a1d14');
  roundRect(g, cx + 2, 232, 26, 18, 6, '#2a1d14');
  // arms (one waving if the seed says so)
  const wave = r() < 0.4;
  g.save(); g.translate(cx - 30, 92); g.rotate(0.25);
  roundRect(g, -10, 0, 18, 62, 8, jacket); blob(g, -1, 64, 9, 9, '#333'); g.restore();
  g.save(); g.translate(cx + 30, 92); g.rotate(wave ? -2.6 : -0.25);
  roundRect(g, -8, 0, 18, 62, 8, jacket); blob(g, 1, 64, 9, 9, '#333'); g.restore();
  // body
  roundRect(g, cx - 32, 84, 64, 90, 18, jacket);
  g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(cx - 1, 92, 2, 76);
  roundRect(g, cx - 34, 84, 68, 16, 8, 'rgba(255,255,255,0.25)');
  // scarf
  roundRect(g, cx - 22, 76, 44, 14, 6, hat);
  roundRect(g, cx + 6, 82, 12, 30, 4, hat);
  // head
  blob(g, cx, 56, 24, 26, '#f1c7a1');
  blob(g, cx - 13, 64, 6, 4, '#f0a0a0'); blob(g, cx + 13, 64, 6, 4, '#f0a0a0');
  blob(g, cx - 8, 55, 3, 4, '#222'); blob(g, cx + 8, 55, 3, 4, '#222');
  g.strokeStyle = '#7a3b2e'; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, 66, 7, 0.2, Math.PI - 0.2); g.stroke();
  // beanie
  g.fillStyle = hat;
  g.beginPath(); g.ellipse(cx, 44, 26, 24, 0, Math.PI, 0); g.fill();
  roundRect(g, cx - 27, 38, 54, 12, 5, '#f5f5f5');
  blob(g, cx, 16, 10, 10, '#f5f5f5');
  return c;
}

function dog(seed) {
  const W = 192, H = 128;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  const fur = ['#9c6b3c', '#2d2a26', '#d9b07c', '#6b4b33'][Math.floor(r() * 4)];
  const dark = 'rgba(0,0,0,0.25)';
  // tail
  g.strokeStyle = fur; g.lineWidth = 10; g.lineCap = 'round';
  g.beginPath(); g.moveTo(40, 62); g.quadraticCurveTo(14, 40, 22, 18); g.stroke();
  // legs
  for (const x of [52, 66, 118, 132]) roundRect(g, x, 72, 12, 46, 5, fur);
  for (const x of [66, 132]) roundRect(g, x, 72, 12, 46, 5, dark);
  // body
  blob(g, 92, 66, 56, 24, fur);
  // collar, head, ear, snout
  roundRect(g, 128, 44, 12, 26, 4, '#d33');
  blob(g, 152, 40, 24, 22, fur);
  blob(g, 174, 48, 14, 10, fur);
  blob(g, 186, 46, 5, 5, '#111');
  blob(g, 158, 34, 4, 4, '#111');
  g.fillStyle = dark;
  g.beginPath(); g.ellipse(142, 34, 9, 20, 0.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e66'; roundRect(g, 170, 56, 10, 14, 4, '#e66');
  return c;
}

// ---- breakables -----------------------------------------------------------

function table() {
  const W = 160, H = 160;
  const [c, g] = canvas(W, H);
  roundRect(g, 74, 70, 12, 80, 3, '#444');
  blob(g, 80, 150, 34, 7, '#444');
  // checked cloth
  g.save();
  g.beginPath(); g.ellipse(80, 64, 70, 16, 0, 0, Math.PI * 2);
  g.moveTo(10, 64); g.lineTo(18, 100); g.lineTo(142, 100); g.lineTo(150, 64); g.closePath();
  g.clip();
  g.fillStyle = '#fff'; g.fillRect(0, 40, W, 70);
  g.fillStyle = '#d83a3a';
  for (let y = 40; y < 110; y += 12) for (let x = ((y / 12) % 2) * 12; x < W; x += 24) g.fillRect(x, y, 12, 12);
  g.restore();
  // cups and a pot
  roundRect(g, 40, 44, 16, 16, 3, '#fff'); roundRect(g, 104, 46, 16, 14, 3, '#7ec4e8');
  roundRect(g, 66, 30, 26, 28, 8, '#5aa0d8');
  blob(g, 79, 28, 6, 4, '#3a7ab8');
  return c;
}

function snowman() {
  const W = 128, H = 192;
  const [c, g] = canvas(W, H);
  g.strokeStyle = '#5b3a24'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(40, 98); g.lineTo(8, 76); g.moveTo(88, 98); g.lineTo(122, 72); g.stroke();
  blob(g, 64, 150, 40, 36, '#eef3fb');
  blob(g, 64, 98, 30, 28, '#f6f9ff');
  blob(g, 64, 54, 22, 21, '#ffffff');
  for (const y of [86, 100, 114]) blob(g, 64, y, 3, 3, '#222');
  blob(g, 56, 50, 3, 3, '#222'); blob(g, 72, 50, 3, 3, '#222');
  g.fillStyle = '#f08a24';
  g.beginPath(); g.moveTo(64, 56); g.lineTo(88, 61); g.lineTo(64, 62); g.fill();
  roundRect(g, 42, 70, 44, 9, 4, '#c0392b');
  roundRect(g, 46, 24, 36, 12, 2, '#222');
  roundRect(g, 52, 2, 24, 26, 2, '#222');
  return c;
}

// ---- vehicles and balloons -------------------------------------------------

function car(seed) {
  const W = 256, H = 128;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  const paint = ['#c0392b', '#2e86de', '#f1c40f', '#27ae60', '#ecf0f1', '#8e44ad'][Math.floor(r() * 6)];
  roundRect(g, 14, 56, 228, 46, 16, paint);
  g.fillStyle = paint;
  g.beginPath(); g.moveTo(58, 60); g.lineTo(86, 22); g.lineTo(176, 22); g.lineTo(206, 60); g.fill();
  g.fillStyle = '#bfe3f5';
  g.beginPath(); g.moveTo(72, 58); g.lineTo(92, 30); g.lineTo(128, 30); g.lineTo(128, 58); g.fill();
  g.beginPath(); g.moveTo(136, 58); g.lineTo(136, 30); g.lineTo(170, 30); g.lineTo(192, 58); g.fill();
  roundRect(g, 84, 14, 96, 12, 6, '#f6f9ff');
  roundRect(g, 226, 66, 14, 10, 3, '#fff6a0');
  roundRect(g, 14, 66, 10, 10, 3, '#e74c3c');
  g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(14, 86, 228, 6);
  for (const x of [60, 196]) { blob(g, x, 102, 22, 22, '#1b1b1b'); blob(g, x, 102, 10, 10, '#aaa'); }
  return c;
}

function balloon(seed) {
  const W = 256, H = 384;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  const pairs = [['#e74c3c', '#f1c40f'], ['#2e86de', '#ffffff'], ['#8e44ad', '#f39c12'], ['#27ae60', '#ecf0f1']];
  const [a, b] = pairs[Math.floor(r() * pairs.length)];
  // ropes
  g.strokeStyle = '#6b5030'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(96, 250); g.lineTo(108, 320); g.moveTo(160, 250); g.lineTo(148, 320); g.stroke();
  // envelope with stripes
  g.save();
  g.beginPath();
  g.moveTo(128, 8);
  g.bezierCurveTo(250, 8, 250, 170, 160, 250);
  g.lineTo(96, 250);
  g.bezierCurveTo(6, 170, 6, 8, 128, 8);
  g.clip();
  g.fillStyle = a; g.fillRect(0, 0, W, 260);
  g.fillStyle = b;
  for (let k = 1; k <= 5; k += 2) {
    g.beginPath();
    g.ellipse(128, 130, k * 22 + 11, 150, 0, 0, Math.PI * 2);
    g.ellipse(128, 130, k * 22 - 11, 150, 0, 0, Math.PI * 2);
    g.fill('evenodd');
  }
  const sh = g.createLinearGradient(0, 0, W, 0);
  sh.addColorStop(0, 'rgba(255,255,255,0.25)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = sh; g.fillRect(0, 0, W, 260);
  g.restore();
  // basket
  roundRect(g, 100, 318, 56, 44, 6, '#a0703c');
  g.strokeStyle = '#7a5228'; g.lineWidth = 3;
  for (let y = 326; y < 362; y += 10) { g.beginPath(); g.moveTo(102, y); g.lineTo(154, y); g.stroke(); }
  roundRect(g, 96, 314, 64, 8, 4, '#6b4520');
  return c;
}

// ---- pickups and signs -----------------------------------------------------

function star() {
  const W = 128, H = 128;
  const [c, g] = canvas(W, H);
  const glow = g.createRadialGradient(64, 64, 10, 64, 64, 62);
  glow.addColorStop(0, 'rgba(255,240,150,0.9)'); glow.addColorStop(1, 'rgba(255,240,150,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? 20 : 46, a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(64 + Math.cos(a) * rr, 66 + Math.sin(a) * rr);
  }
  g.closePath();
  const f = g.createLinearGradient(0, 20, 0, 110);
  f.addColorStop(0, '#fff3a0'); f.addColorStop(1, '#f5b700');
  g.fillStyle = f; g.fill();
  g.lineWidth = 5; g.strokeStyle = '#c98a00'; g.stroke();
  blob(g, 54, 46, 7, 4, 'rgba(255,255,255,0.8)');
  return c;
}

function finish() {
  const W = 1024, H = 256;
  const [c, g] = canvas(W, H);
  roundRect(g, 20, 20, 24, 236, 4, '#555');
  roundRect(g, W - 44, 20, 24, 236, 4, '#555');
  const s = 24;
  for (let y = 30; y < 110; y += s) for (let x = 44; x < W - 44; x += s) {
    g.fillStyle = ((x - 44) / s + (y - 30) / s) % 2 ? '#111' : '#fff';
    g.fillRect(x, y, s, s);
  }
  roundRect(g, W / 2 - 150, 36, 300, 68, 10, '#d83a3a');
  g.fillStyle = '#fff'; g.font = 'bold 56px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('MAALI', W / 2, 72);
  return c;
}

function sign(text) {
  const W = 512, H = 128;
  const [c, g] = canvas(W, H);
  roundRect(g, 4, 4, W - 8, H - 8, 18, '#5b3a24');
  roundRect(g, 14, 14, W - 28, H - 28, 12, '#f5ead6');
  g.fillStyle = '#5b3a24'; g.font = 'bold 64px Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, W / 2, H / 2 + 4);
  return c;
}

// ---- surfaces ----------------------------------------------------------------

function wall(color) {
  const W = 256, H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = color; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < H; y += 16) g.fillRect(0, y, W, 2);
  for (const x of [48, 160]) {
    roundRect(g, x - 4, 60, 56, 72, 4, '#f7f2e8');
    const lit = g.createLinearGradient(0, 66, 0, 126);
    lit.addColorStop(0, '#ffe6a3'); lit.addColorStop(1, '#f7b955');
    g.fillStyle = lit; g.fillRect(x + 2, 66, 44, 60);
    g.fillStyle = '#f7f2e8'; g.fillRect(x + 22, 66, 4, 60); g.fillRect(x + 2, 94, 44, 4);
    roundRect(g, x - 8, 130, 64, 10, 3, '#f6f9ff');
  }
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, H - 10, W, 10);
  return c;
}

function roof() {
  const W = 256, H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#7a2e22'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f2f6fd'; g.fillRect(0, 0, W, H - 26);
  const r = rng(7);
  for (let i = 0; i < 18; i++) blob(g, r() * W, H - 30 + r() * 8, 14 + r() * 14, 8 + r() * 6, '#f2f6fd');
  for (let i = 0; i < 40; i++) blob(g, r() * W, r() * (H - 40), 18 + r() * 20, 6, 'rgba(160,185,220,0.18)');
  return c;
}

function awning() {
  const W = 256, H = 128;
  const [c, g] = canvas(W, H);
  for (let x = 0; x < W; x += 32) {
    g.fillStyle = (x / 32) % 2 ? '#ffffff' : '#d83a3a';
    g.fillRect(x, 0, 32, H);
  }
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, W, 10);
  return c;
}

function asphalt() {
  const W = 256, H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#4a4d55'; g.fillRect(0, 0, W, H);
  const r = rng(3);
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
    g.fillRect(r() * W, r() * H, 2, 2);
  }
  g.fillStyle = '#f2f2f2';
  for (let x = 0; x < W; x += 64) g.fillRect(x, H / 2 - 3, 36, 6);
  g.fillStyle = 'rgba(240,246,255,0.85)'; g.fillRect(0, 0, W, 12); g.fillRect(0, H - 12, W, 12);
  return c;
}

function snow() {
  const W = 256, H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  // groomed corduroy across the slope
  for (let y = 0; y < H; y += 8) {
    g.fillStyle = 'rgba(140,165,210,0.13)'; g.fillRect(0, y, W, 3);
  }
  const r = rng(5);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = r() < 0.6 ? 'rgba(140,165,210,0.14)' : 'rgba(255,255,255,0.9)';
    const s = 1 + r() * 2.5;
    g.fillRect(r() * W, r() * H, s, s);
  }
  for (let i = 0; i < 14; i++) blob(g, r() * W, r() * H, 20 + r() * 30, 8 + r() * 10, 'rgba(150,175,220,0.08)');
  return c;
}

function shadow() {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(20,40,80,0.45)'); gr.addColorStop(1, 'rgba(20,40,80,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}

function flake() {
  const [c, g] = canvas(32, 32);
  const gr = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return c;
}

function sky() {
  const [c, g] = canvas(4, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#5d9be0'); gr.addColorStop(0.6, '#a9cdf2'); gr.addColorStop(1, '#e4effa');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  return c;
}

function mountains() {
  const W = 2048, H = 512;
  const [c, g] = canvas(W, H);
  const r = rng(11);
  const layers = [['#9db6d6', 0.25, 0.75], ['#7e9cc4', 0.45, 0.9], ['#6a88b3', 0.65, 1]];
  for (const [col, base, amp] of layers) {
    g.fillStyle = col;
    g.beginPath(); g.moveTo(0, H);
    let x = 0;
    while (x <= W) {
      const peak = H * (base + (1 - base) * 0.6 * (1 - amp * r()));
      g.lineTo(x, peak);
      x += 60 + r() * 120;
    }
    g.lineTo(W, H); g.closePath(); g.fill();
  }
  // snow caps on the back layer
  g.globalCompositeOperation = 'source-atop';
  const cap = g.createLinearGradient(0, H * 0.2, 0, H * 0.5);
  cap.addColorStop(0, 'rgba(255,255,255,0.9)'); cap.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = cap; g.fillRect(0, 0, W, H * 0.5);
  return c;
}

export function textures() {
  const T = {};
  T.spruce = [1, 2, 3].map((s) => texture(spruce(s)));
  T.person = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => texture(person(s * 13)));
  T.dog = [1, 2, 3].map((s) => texture(dog(s * 7)));
  T.car = [1, 2, 3, 4, 5].map((s) => texture(car(s * 5)));
  T.balloon = [1, 2, 3].map((s) => texture(balloon(s * 3)));
  T.table = texture(table());
  T.snowman = texture(snowman());
  T.star = texture(star());
  T.finish = texture(finish());
  T.sign = (text) => texture(sign(text));
  T.wall = (color) => texture(wall(color));
  T.roof = texture(roof());
  T.awning = texture(awning());
  T.asphalt = texture(asphalt(), true);
  T.snow = texture(snow(), true);
  T.shadow = texture(shadow());
  T.flake = texture(flake());
  T.sky = texture(sky());
  T.mountains = texture(mountains());
  return T;
}
