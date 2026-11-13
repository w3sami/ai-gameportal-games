// Drawing a level onto the canvas: the board scaled to fit the screen,
// floor, walls, rocks, boxes, gems, enemies and the player, and the bits
// that fly off a picked-up gem. Everything is drawn from shapes, no images.

const C = {
  bg: '#1d1a26',
  floorA: '#3a3447', floorB: '#36303f',
  wall: '#5b5170', wallTop: '#776a90', wallEdge: '#2a2433',
  rock: '#8a8f99', rockDark: '#5d616b', rockLight: '#b3b8c2',
  box: '#c98a4b', boxDark: '#8f5a2c', boxLight: '#e7b27a',
  lock: '#ff7a45', lockDark: '#b53d1a', lockLight: '#ffd0a8',
  touch: '#5ce08a', touchDark: '#1f8a4a', touchLight: '#d6ffe4',
  player: '#ffd84a', playerDark: '#c99a10',
  enemy: '#b35cff', enemyDark: '#6b23b0',
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const sparks = [];

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  addEventListener('resize', resize);
  resize();

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function burst(x, y, color) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3, v = 2 + Math.random() * 3;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.3, t: 0, color });
    }
  }

  function draw(v, time, dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    const top = 52, bottom = 40, side = 16;
    const S = Math.max(8, Math.floor(Math.min((W - 2 * side) / v.w, (H - top - bottom) / v.h)));
    const ox = Math.round((W - S * v.w) / 2), oy = Math.round(top + (H - top - bottom - S * v.h) / 2);
    ctx.save();
    ctx.translate(ox, oy);
    let shake = 0;
    const pa = v.player.act;
    if (pa && pa.kind === 'push' && pa.len === 3) shake = S * 0.015;
    if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    // floor and walls
    for (let y = 0; y < v.h; y++) for (let x = 0; x < v.w; x++) {
      const i = y * v.w + x, k = v.wall[i];
      if (k === 1) continue;
      ctx.fillStyle = (x + y) % 2 ? C.floorA : C.floorB;
      ctx.fillRect(x * S, y * S, S, S);
    }
    for (let y = 0; y < v.h; y++) for (let x = 0; x < v.w; x++) {
      const i = y * v.w + x, k = v.wall[i];
      if (k === 1) drawWall(x, y, S, v);
      if (k === 2) drawRock(x * S, y * S, S, (x * 7 + y * 13) % 5);
    }

    // objects, lowest first so taller things overlap the row above
    const things = [
      ...v.objs.map((o) => ({ y: o.pos[1], f: () => drawObj(o, S, time) })),
      ...v.enemies.map((e) => ({ y: e.pos[1], f: () => drawEnemy(e, S, time) })),
    ];
    if (v.state !== 'dead' || v.timer < 0.15) things.push({ y: v.player.pos[1], f: () => drawPlayer(v.player, S, time, v.state) });
    things.sort((a, b) => a.y - b.y).forEach((t) => t.f());

    // sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.t += dt;
      if (p.t >= p.life) { sparks.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x * S, p.y * S, S * 0.07, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    return { S, ox, oy };
  }

  function drawWall(x, y, S, v) {
    const solid = (xx, yy) => xx < 0 || yy < 0 || xx >= v.w || yy >= v.h || v.wall[yy * v.w + xx] === 1;
    // only the walls next to a playable cell are drawn as blocks; the rest is background
    let edge = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!solid(x + dx, y + dy)) edge = true;
    if (!edge) return;
    const px = x * S, py = y * S;
    ctx.fillStyle = C.wallEdge;
    ctx.fillRect(px, py, S, S);
    ctx.fillStyle = C.wall;
    ctx.fillRect(px + 1, py + 1, S - 2, S - 2);
    ctx.fillStyle = C.wallTop;
    if (!solid(x, y + 1)) ctx.fillRect(px + 1, py + 1, S - 2, S * 0.62);
    else ctx.fillRect(px + 1, py + 1, S - 2, S - 2);
  }

  function drawRock(px, py, S, seed) {
    const cx = px + S / 2, cy = py + S * 0.55, r = S * 0.42;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(cx, py + S * 0.86, r, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, rr2 = r * (0.86 + 0.14 * Math.sin(k * 2.3 + seed));
      const xx = cx + Math.cos(a) * rr2, yy = cy + Math.sin(a) * rr2 * 0.85;
      k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
    }
    ctx.closePath();
    ctx.fillStyle = C.rock; ctx.fill();
    ctx.lineWidth = Math.max(1, S * 0.04); ctx.strokeStyle = C.rockDark; ctx.stroke();
    ctx.fillStyle = C.rockLight;
    ctx.beginPath(); ctx.ellipse(cx - r * 0.3, cy - r * 0.35, r * 0.28, r * 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
  }

  function drawObj(o, S, time) {
    const px = o.pos[0] * S, py = o.pos[1] * S, m = S * 0.08;
    if (o.kind === 'box') {
      rr(px + m, py + m, S - 2 * m, S - 2 * m, S * 0.08);
      ctx.fillStyle = C.box; ctx.fill();
      ctx.lineWidth = Math.max(1, S * 0.06); ctx.strokeStyle = C.boxDark; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px + m * 2.2, py + m * 2.2); ctx.lineTo(px + S - m * 2.2, py + S - m * 2.2);
      ctx.moveTo(px + S - m * 2.2, py + m * 2.2); ctx.lineTo(px + m * 2.2, py + S - m * 2.2);
      ctx.lineWidth = Math.max(1, S * 0.05); ctx.stroke();
      ctx.fillStyle = C.boxLight;
      ctx.fillRect(px + m * 1.5, py + m * 1.3, S - m * 3, Math.max(1, S * 0.04));
      return;
    }
    if (o.kind === 'lock') {
      // a heavy faceted crystal on a dark base
      const cx = px + S / 2, cy = py + S / 2, r = S * 0.4;
      rr(px + m, py + S * 0.62, S - 2 * m, S * 0.3, S * 0.06);
      ctx.fillStyle = C.lockDark; ctx.fill();
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const xx = cx + Math.cos(a) * r, yy = cy - S * 0.04 + Math.sin(a) * r;
        k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.closePath();
      ctx.fillStyle = C.lock; ctx.fill();
      ctx.lineWidth = Math.max(1, S * 0.05); ctx.strokeStyle = C.lockDark; ctx.stroke();
      ctx.fillStyle = C.lockLight;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.8); ctx.lineTo(cx + r * 0.45, cy - r * 0.2); ctx.lineTo(cx, cy + r * 0.1); ctx.lineTo(cx - r * 0.45, cy - r * 0.2);
      ctx.closePath(); ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      return;
    }
    if (o.kind === 'touch') {
      // a light orb that floats a little
      const bob = Math.sin(time * 3 + o.pos[0] * 1.7 + o.pos[1]) * S * 0.04;
      const cx = px + S / 2, cy = py + S / 2 + bob, r = S * 0.3;
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath(); ctx.ellipse(cx, py + S * 0.85, r * 0.8, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.7);
      g.addColorStop(0, 'rgba(92,224,138,.45)'); g.addColorStop(1, 'rgba(92,224,138,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 1.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.touch; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(1, S * 0.04); ctx.strokeStyle = C.touchDark; ctx.stroke();
      ctx.fillStyle = C.touchLight;
      ctx.beginPath(); ctx.arc(cx - r * 0.35, cy - r * 0.35, r * 0.28, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawEnemy(e, S, time) {
    const cx = (e.pos[0] + 0.5) * S, cy = (e.pos[1] + 0.5) * S, r = S * 0.36;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(cx, cy + S * 0.36, r * 0.9, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    const n = 10, spin = time * 2;
    for (let k = 0; k < n * 2; k++) {
      const a = (k / (n * 2)) * Math.PI * 2 + spin, rr2 = k % 2 ? r : r * 1.22;
      const xx = cx + Math.cos(a) * rr2, yy = cy + Math.sin(a) * rr2;
      k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
    }
    ctx.closePath();
    ctx.fillStyle = C.enemy; ctx.fill();
    ctx.lineWidth = Math.max(1, S * 0.04); ctx.strokeStyle = C.enemyDark; ctx.stroke();
    // eyes toward where it is going
    const lx = e.axis === 'x' ? e.dir * r * 0.25 : 0, ly = e.axis === 'y' ? e.dir * r * 0.25 : 0;
    for (const sx of [-1, 1]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx + sx * r * 0.35 + lx, cy - r * 0.1 + ly, r * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a0a26';
      ctx.beginPath(); ctx.arc(cx + sx * r * 0.35 + lx * 1.5, cy - r * 0.1 + ly * 1.5, r * 0.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#1a0a26'; ctx.lineWidth = Math.max(1, S * 0.035);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.6 + lx, cy - r * 0.45 + ly); ctx.lineTo(cx - r * 0.15 + lx, cy - r * 0.3 + ly);
    ctx.moveTo(cx + r * 0.6 + lx, cy - r * 0.45 + ly); ctx.lineTo(cx + r * 0.15 + lx, cy - r * 0.3 + ly);
    ctx.stroke();
  }

  function drawPlayer(p, S, time, state) {
    const DIR = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
    const [fx, fy] = DIR[p.facing];
    let cx = (p.pos[0] + 0.5) * S, cy = (p.pos[1] + 0.5) * S;
    let sx = 1, sy = 1;
    const a = p.act;
    if (a && a.kind === 'push') {
      // lean into the row: the heavier, the more
      const lean = [0.06, 0.1, 0.14][a.len - 1];
      cx += fx * S * lean; cy += fy * S * lean;
      const sq = 1 - lean;
      if (fx) { sx = sq; sy = 1 / sq; } else { sy = sq; sx = 1 / sq; }
    } else if (a && a.kind === 'bump') {
      const k = Math.sin(Math.min(1, a.k) * Math.PI) * 0.08;
      cx += fx * S * k; cy += fy * S * k;
    } else if (a) {
      const hop = Math.sin(Math.min(1, a.k) * Math.PI) * S * 0.05;
      cy -= hop;
    }
    if (state === 'won') cy -= Math.abs(Math.sin(time * 8)) * S * 0.1;
    const r = S * 0.36;
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse((p.pos[0] + 0.5) * S, (p.pos[1] + 0.5) * S + S * 0.36, r * 0.9, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(sx, sy);
    ctx.fillStyle = C.player;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(1, S * 0.045); ctx.strokeStyle = C.playerDark; ctx.stroke();
    // eyes look where it faces
    const ex = fx * r * 0.3, ey = fy * r * 0.25 - r * 0.12;
    const strain = a && a.kind === 'push' && a.len >= 2;
    for (const s of [-1, 1]) {
      const x = ex + (fy ? s * r * 0.33 : s * r * 0.22 + fx * r * 0.08), y = ey;
      if (strain) {
        ctx.strokeStyle = '#2a1e00'; ctx.lineWidth = Math.max(1, S * 0.04);
        ctx.beginPath(); ctx.moveTo(x - r * 0.14, y - r * 0.08 * s * (fx || 1)); ctx.lineTo(x + r * 0.14, y + r * 0.08 * s * (fx || 1)); ctx.stroke();
      } else {
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r * 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2a1e00'; ctx.beginPath(); ctx.arc(x + fx * r * 0.07, y + fy * r * 0.07, r * 0.1, 0, Math.PI * 2); ctx.fill();
      }
    }
    // sweat for a row of three
    if (a && a.kind === 'push' && a.len === 3) {
      const t = (time * 2.5) % 1;
      ctx.fillStyle = '#9fd8ff'; ctx.globalAlpha = 1 - t;
      ctx.beginPath(); ctx.arc(-fx * r * 0.6 - (fy ? r * 0.7 : 0), -r * 0.8 + t * r * 0.6, r * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  return { draw, burst, colors: C };
}
