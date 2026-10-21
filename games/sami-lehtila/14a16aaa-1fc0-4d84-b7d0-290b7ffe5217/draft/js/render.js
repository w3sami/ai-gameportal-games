// Canvas drawing. Pure view: reads state, draws one frame.
import { TILE, mulberry32 } from './levelgen.js';

const C = {
  ice: '#CFE4EE', iceHi: '#EAF5FA', crack: 'rgba(255,255,255,0.55)', grid: 'rgba(22,50,74,0.07)',
  shore: '#F4F8FA', shoreShadow: '#A8C3D1',
  rock: '#56636D', rockHi: '#7A8792', rockLo: '#3E4850',
  snow: '#FFFFFF', snowShadow: 'rgba(80,120,150,0.28)',
  hole: '#0B2235', holeRim: '#5D8FAD',
  seal: '#6F7F8B', sealBack: '#5A6975', ring: '#A7B5BE', eye: '#111A21',
  hint: '#C2334D',
};
const ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.decor = null;
  }

  setLevel(level) {
    // Per-level decoration (cracks, rock shapes), seeded so it never flickers.
    const rng = mulberry32(level.n * 7919 + 3);
    const cracks = [];
    for (let i = 0; i < level.size * 1.5; i++) {
      let x = rng() * level.size, y = rng() * level.size;
      const pts = [[x, y]];
      let a = rng() * Math.PI * 2;
      for (let k = 0; k < 4; k++) { a += (rng() - 0.5) * 1.2; x += Math.cos(a) * 0.5; y += Math.sin(a) * 0.5; pts.push([x, y]); }
      cracks.push(pts);
    }
    const rocks = {};
    level.grid.forEach((tl, i) => {
      if (tl !== TILE.ROCK) return;
      const pts = [];
      const n = 7, rot = rng() * 6;
      for (let k = 0; k < n; k++) {
        const a = rot + (k / n) * Math.PI * 2;
        const r = 0.36 + rng() * 0.1;
        pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.9]);
      }
      rocks[i] = pts;
    });
    this.decor = { cracks, rocks };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.dpr = dpr;
  }

  // Board geometry in CSS pixels; shared with input for tap-to-move.
  layout(size) {
    const r = this.canvas.getBoundingClientRect();
    const pad = Math.min(r.width, r.height) * 0.04;
    const cell = Math.floor((Math.min(r.width, r.height) - pad * 2) / size);
    const ox = (r.width - cell * size) / 2, oy = (r.height - cell * size) / 2;
    return { cell, ox, oy };
  }

  draw(state, now) {
    const { ctx, dpr } = this;
    const lv = state.level;
    if (!lv) return;
    const { cell: s, ox, oy } = this.layout(lv.size);
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Shore rim
    const rim = s * 0.28;
    ctx.fillStyle = C.shoreShadow;
    roundRect(ctx, ox - rim, oy - rim + 3, s * lv.size + rim * 2, s * lv.size + rim * 2, rim * 1.4); ctx.fill();
    ctx.fillStyle = C.shore;
    roundRect(ctx, ox - rim, oy - rim, s * lv.size + rim * 2, s * lv.size + rim * 2, rim * 1.4); ctx.fill();

    // Ice
    const g = ctx.createLinearGradient(ox, oy, ox + s * lv.size, oy + s * lv.size);
    g.addColorStop(0, C.iceHi); g.addColorStop(1, C.ice);
    ctx.fillStyle = g;
    roundRect(ctx, ox, oy, s * lv.size, s * lv.size, s * 0.25); ctx.fill();

    ctx.save();
    roundRect(ctx, ox, oy, s * lv.size, s * lv.size, s * 0.25); ctx.clip();
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < lv.size; i++) {
      ctx.moveTo(ox + i * s, oy); ctx.lineTo(ox + i * s, oy + lv.size * s);
      ctx.moveTo(ox, oy + i * s); ctx.lineTo(ox + lv.size * s, oy + i * s);
    }
    ctx.stroke();
    ctx.strokeStyle = C.crack; ctx.lineWidth = 1.2;
    for (const pts of this.decor.cracks) {
      ctx.beginPath(); ctx.moveTo(ox + pts[0][0] * s, oy + pts[0][1] * s);
      for (const p of pts.slice(1)) ctx.lineTo(ox + p[0] * s, oy + p[1] * s);
      ctx.stroke();
    }
    ctx.restore();

    // Tiles
    for (let y = 0; y < lv.size; y++) for (let x = 0; x < lv.size; x++) {
      const i = y * lv.size + x, tl = lv.grid[i];
      const cx = ox + (x + 0.5) * s, cy = oy + (y + 0.5) * s;
      if (tl === TILE.ROCK) drawRock(ctx, cx, cy, s, this.decor.rocks[i]);
      else if (tl === TILE.SNOW) drawSnow(ctx, cx, cy, s);
      else if (tl === TILE.HOLE) drawHole(ctx, cx, cy, s, now, state.reduced);
    }

    // Hint arrow
    if (state.hint && now < state.hint.until) {
      const a = ANGLE[state.hint.dir];
      const hx = ox + (state.pos[0] + 0.5) * s, hy = oy + (state.pos[1] + 0.5) * s;
      const pulse = state.reduced ? 0 : Math.sin(now / 120) * s * 0.06;
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(a);
      ctx.fillStyle = C.hint; ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(s * 0.62 + pulse, -s * 0.16); ctx.lineTo(s * 0.92 + pulse, 0); ctx.lineTo(s * 0.62 + pulse, s * 0.16);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // Seal
    let px = state.pos[0], py = state.pos[1], stretch = 1, scale = 1;
    const an = state.anim;
    if (an) {
      const k = Math.min(1, (now - an.t0) / an.dur);
      if (an.kind === 'slide') {
        const e = 1 - (1 - k) * (1 - k);
        px = an.from[0] + (an.to[0] - an.from[0]) * e;
        py = an.from[1] + (an.to[1] - an.from[1]) * e;
        stretch = 1 + 0.14 * Math.sin(Math.PI * Math.min(1, k * 1.2));
      } else if (an.kind === 'sink') {
        scale = 1 - k;
      } else if (an.kind === 'bump') {
        const b = Math.sin(Math.PI * k) * 0.08;
        const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[an.dir];
        px += dx * b; py += dy * b;
      }
    }
    if (!state.won && scale > 0.02) drawSeal(ctx, ox + (px + 0.5) * s, oy + (py + 0.5) * s, s, ANGLE[state.face], stretch, scale);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function poly(ctx, cx, cy, s, pts, dx = 0, dy = 0, k = 1) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const X = cx + (x * k + dx) * s, Y = cy + (y * k + dy) * s;
    i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
  });
  ctx.closePath();
}

function drawRock(ctx, cx, cy, s, pts) {
  ctx.fillStyle = 'rgba(22,50,74,0.22)'; poly(ctx, cx, cy, s, pts, 0.03, 0.07); ctx.fill();
  ctx.fillStyle = C.rockLo; poly(ctx, cx, cy, s, pts); ctx.fill();
  ctx.fillStyle = C.rock; poly(ctx, cx, cy, s, pts, -0.02, -0.04, 0.88); ctx.fill();
  ctx.fillStyle = C.rockHi; poly(ctx, cx, cy, s, pts, -0.09, -0.11, 0.42); ctx.fill();
  // a little snow cap
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.ellipse(cx - s * 0.06, cy - s * 0.2, s * 0.15, s * 0.06, -0.2, 0, Math.PI * 2); ctx.fill();
}

function drawSnow(ctx, cx, cy, s) {
  ctx.fillStyle = C.snowShadow;
  ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.12, s * 0.44, s * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.snow;
  for (const [dx, dy, r] of [[-0.18, 0.04, 0.22], [0.14, 0.02, 0.24], [0, -0.1, 0.24]]) {
    ctx.beginPath(); ctx.arc(cx + dx * s, cy + dy * s, r * s, 0, Math.PI * 2); ctx.fill();
  }
}

function drawHole(ctx, cx, cy, s, now, reduced) {
  ctx.fillStyle = C.holeRim;
  ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.4, s * 0.34, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.hole;
  ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.02, s * 0.34, s * 0.28, 0, 0, Math.PI * 2); ctx.fill();
  const k = reduced ? 0.5 : (now / 1800) % 1;
  ctx.strokeStyle = `rgba(160,200,225,${0.5 * (1 - k)})`; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.02, s * 0.3 * k + 2, s * 0.24 * k + 2, 0, 0, Math.PI * 2); ctx.stroke();
}

function drawSeal(ctx, x, y, s, angle, stretch, scale) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale * stretch, scale / Math.sqrt(stretch));
  // shadow
  ctx.fillStyle = 'rgba(22,50,74,0.2)';
  ctx.beginPath(); ctx.ellipse(s * 0.02, s * 0.06, s * 0.42, s * 0.26, 0, 0, Math.PI * 2); ctx.fill();
  // rear flippers
  ctx.fillStyle = C.sealBack;
  ctx.beginPath(); ctx.moveTo(-s * 0.32, 0); ctx.lineTo(-s * 0.48, -s * 0.14); ctx.lineTo(-s * 0.44, 0); ctx.lineTo(-s * 0.48, s * 0.14); ctx.closePath(); ctx.fill();
  // front flippers
  ctx.beginPath(); ctx.ellipse(s * 0.08, -s * 0.24, s * 0.1, s * 0.045, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(s * 0.08, s * 0.24, s * 0.1, s * 0.045, 0.5, 0, Math.PI * 2); ctx.fill();
  // body
  ctx.fillStyle = C.seal;
  ctx.beginPath(); ctx.ellipse(-s * 0.04, 0, s * 0.34, s * 0.23, 0, 0, Math.PI * 2); ctx.fill();
  // ring markings, the norppa's namesake
  ctx.strokeStyle = C.ring; ctx.lineWidth = Math.max(1, s * 0.022);
  for (const [rx, ry, r] of [[-0.18, -0.08, 0.05], [-0.05, 0.08, 0.045], [0.06, -0.06, 0.04], [-0.24, 0.07, 0.035], [0.12, 0.07, 0.03]]) {
    ctx.beginPath(); ctx.arc(rx * s, ry * s, r * s, 0, Math.PI * 2); ctx.stroke();
  }
  // head
  ctx.fillStyle = C.seal;
  ctx.beginPath(); ctx.arc(s * 0.26, 0, s * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.eye;
  ctx.beginPath(); ctx.arc(s * 0.33, -s * 0.07, s * 0.038, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(s * 0.33, s * 0.07, s * 0.038, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(s * 0.345, -s * 0.08, s * 0.012, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(s * 0.345, s * 0.06, s * 0.012, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2B353D';
  ctx.beginPath(); ctx.ellipse(s * 0.42, 0, s * 0.025, s * 0.035, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
