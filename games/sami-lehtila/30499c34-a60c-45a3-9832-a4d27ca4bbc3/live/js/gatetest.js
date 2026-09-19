/* Luukkutesti: pelkkä hehku ja sen säätimet, ei pelilogiikkaa.
 *
 * Piirtää saman katon ja saman aukon kuin peli, samalla drawGateGlow-kutsulla.
 * Taksin kokoinen haamu seuraa sormea, jotta mittasuhteen näkee. Paneelin JSON
 * on suoraan se olio joka menee js/gate.js:n GATE_LOOKiin.
 */
import { GATE_LOOK, drawGateGlow, apexY } from './gate.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const panelEl = document.getElementById('panel');

const W = 720, H = 620;
const CEIL = 16;
const GATE = { x: 300, w: 120 };
const GLOW = ['#6fe3ff', '#7bf0a0', '#ff9ae0', '#ffd479', '#c79bff'];
const TW = 54, TH = 28;

const L = Object.assign({}, GATE_LOOK);
let color = GLOW[0];
let ghost = { x: W / 2, y: 320 };

let scale = 1, dpr = 1, lastVW = -1, lastVH = -1;
function resize() {
  const de = document.documentElement;
  const vw = de.clientWidth || window.innerWidth || 1;
  const vh = de.clientHeight || window.innerHeight || 1;
  if (vw === lastVW && vh === lastVH) return;
  lastVW = vw; lastVH = vh;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  scale = Math.min(vw / W, vh / H);
  canvas.width = Math.round(W * scale * dpr);
  canvas.height = Math.round(H * scale * dpr);
  canvas.style.width = Math.round(W * scale) + 'px';
  canvas.style.height = Math.round(H * scale) + 'px';
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(document.documentElement);
resize();

if (!ctx.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

canvas.addEventListener('pointerdown', move);
canvas.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') move(e); });
function move(e) {
  const r = canvas.getBoundingClientRect();
  ghost.x = (e.clientX - r.left) / r.width * W;
  ghost.y = (e.clientY - r.top) / r.height * H;
}

function wall(r) {
  ctx.fillStyle = '#1b2440';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(120,160,255,.22)';
  ctx.fillRect(r.x, r.y, r.w, 2);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(r.x, r.y + r.h - 2, r.w, 2);
}

function draw(t) {
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b1230');
  bg.addColorStop(1, '#04070f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(120,160,255,.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  wall({ x: 0, y: 0, w: GATE.x, h: CEIL });
  wall({ x: GATE.x + GATE.w, y: 0, w: W - GATE.x - GATE.w, h: CEIL });
  wall({ x: 0, y: 0, w: 16, h: H });
  wall({ x: W - 16, y: 0, w: 16, h: H });

  drawGateGlow(ctx, GATE, CEIL, color, t, L);

  // taksin kokoinen haamu mittakaavaksi
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#ffd479';
  ctx.beginPath(); ctx.roundRect(ghost.x - TW / 2, ghost.y - TH / 2, TW, TH, 9); ctx.fill();
  ctx.restore();

  // apuviivat: kärjen korkeus ja aukon reunat
  const cy = apexY(GATE.w / 2, CEIL, L.spread);
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.setLineDash([5, 6]); ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(GATE.x, 0); ctx.lineTo(GATE.x, H);
  ctx.moveTo(GATE.x + GATE.w, 0); ctx.lineTo(GATE.x + GATE.w, H);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(233,237,255,.45)';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`kärki ${Math.round(cy)} px (katto ${CEIL})`, 24, H - 24);
}

/* ---------------------------------------------------------------- paneeli */
const SLIDERS = [
  { key: 'radius', label: 'kantama px', min: 5, max: 600, step: 5 },
  { key: 'spread', label: 'puolikulma °', min: 10, max: 80, step: 1 },
  { key: 'glow', label: 'hehku', min: 0, max: 2, step: 0.05 },
  { key: 'ripples', label: 'aaltoja', min: 0, max: 6, step: 1 },
  { key: 'rippleWidth', label: 'aallon paksuus px', min: 2, max: 200, step: 2 },
  { key: 'rippleAlpha', label: 'aallon kirkkaus', min: 0, max: 0.8, step: 0.02 },
  { key: 'rippleSpeed', label: 'aallon nopeus', min: 0, max: 1.5, step: 0.05 },
  { key: 'breathe', label: 'hengitys', min: 0, max: 6, step: 0.1 },
];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function pbutton(cls, text, fn) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}
const asJSON = () => JSON.stringify(L);

let note;
function build() {
  panelEl.replaceChildren(el('h2', null, 'luukku'));

  const colorRow = el('div', 'row');
  const seg = el('div', 'seg');
  GLOW.forEach((c, i) => {
    const b = pbutton(color === c ? 'on' : null, String(i + 1), () => { color = c; build(); });
    b.style.color = color === c ? '#08101f' : c;
    seg.append(b);
  });
  colorRow.append(el('label', null, 'kentän väri'), seg);
  panelEl.append(colorRow);

  for (const s of SLIDERS) {
    const row = el('div', 'row');
    const lab = el('label');
    const val = el('b', null, String(L[s.key]));
    lab.append(document.createTextNode(s.label), val);
    const input = el('input');
    input.type = 'range';
    input.min = s.min; input.max = s.max; input.step = s.step;
    input.value = L[s.key];
    input.addEventListener('input', () => {
      L[s.key] = +input.value;
      val.textContent = input.value;
      if (ta !== document.activeElement) ta.value = asJSON();
    });
    row.append(lab, input);
    panelEl.append(row);
  }

  const io = el('div', 'row io');
  io.append(el('label', null, 'GATE_LOOK JSONina'));
  const ta = el('textarea');
  ta.spellcheck = false;
  ta.value = asJSON();
  note = el('p', 'note', '');
  const foot = el('div', 'foot');
  foot.append(
    pbutton('btn sm ghost', 'oletukset', () => { Object.assign(L, GATE_LOOK); build(); }),
    pbutton('btn sm ghost', 'kopioi', () => {
      ta.value = asJSON();
      ta.focus(); ta.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value)
          .then(() => { note.textContent = 'kopioitu'; })
          .catch(() => { note.textContent = 'valittu — kopioi käsin'; });
      } else note.textContent = 'valittu — kopioi käsin';
    }),
    pbutton('btn sm', 'tuo', () => {
      try {
        const raw = JSON.parse(ta.value);
        for (const k of Object.keys(GATE_LOOK)) if (typeof raw[k] === 'number') L[k] = raw[k];
        build();
      } catch (e) { note.textContent = 'ei kelvollista JSONia'; }
    }),
  );
  io.append(ta, foot, note);
  panelEl.append(io);
}
build();

let t0 = performance.now();
function loop(now) {
  resize();
  draw((now - t0) / 1000);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
