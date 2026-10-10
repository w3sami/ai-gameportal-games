// Everything drawn: the room (cached, redrawn on resize), the drops and the
// slime. The room is scaled to fit the screen whole; whatever is left over
// at the edges is drawn as stone, so the walls reach the screen's edge.

const TAU = Math.PI * 2;

export function createRenderer(canvas, world) {
  const g = canvas.getContext('2d');
  const room = document.createElement('canvas');
  const rg = room.getContext('2d');
  let S = 1, ox = 0, oy = 0, dpr = 1;

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = room.width = Math.round(innerWidth * dpr);
    canvas.height = room.height = Math.round(innerHeight * dpr);
    S = Math.min(canvas.width / world.w, canvas.height / world.h);
    ox = (canvas.width - world.w * S) / 2;
    oy = (canvas.height - world.h * S) / 2;
    drawRoom();
  }

  // ---- the room ---------------------------------------------------------------

  // the same speckles for the same tile every time
  const rand = (x, y, i) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + i * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };

  const TILE = {
    stone(x, y) {
      fill(x, y, '#3b3649');
      rg.fillStyle = 'rgba(255,255,255,.06)'; rg.fillRect(0, 0, S, S * 0.12); rg.fillRect(0, 0, S * 0.12, S);
      rg.fillStyle = 'rgba(0,0,0,.22)'; rg.fillRect(0, S * 0.88, S, S * 0.12); rg.fillRect(S * 0.88, 0, S * 0.12, S);
      rg.fillStyle = 'rgba(255,255,255,.07)';
      for (let i = 0; i < 4; i++) rg.fillRect(rand(x, y, i) * S * 0.8, rand(x, y, i + 9) * S * 0.8, S * 0.08, S * 0.08);
    },
    wood(x, y) {
      fill(x, y, '#80532f');
      rg.fillStyle = 'rgba(0,0,0,.25)';
      for (const f of [0.33, 0.66]) rg.fillRect(0, S * f, S, Math.max(1, S * 0.04));
      rg.fillStyle = 'rgba(255,220,170,.12)';
      for (let i = 0; i < 3; i++) rg.fillRect(rand(x, y, i) * S * 0.6, S * (0.1 + i * 0.33), S * 0.35, Math.max(1, S * 0.03));
    },
    ice(x, y) {
      fill(x, y, '#9fdcf3');
      rg.strokeStyle = 'rgba(255,255,255,.65)'; rg.lineWidth = Math.max(1, S * 0.05);
      rg.beginPath(); rg.moveTo(S * 0.15, S * 0.6); rg.lineTo(S * 0.45, S * 0.2);
      rg.moveTo(S * 0.4, S * 0.85); rg.lineTo(S * 0.8, S * 0.35); rg.stroke();
      rg.fillStyle = 'rgba(30,90,140,.18)'; rg.fillRect(0, S * 0.9, S, S * 0.1);
    },
    metal(x, y) {
      fill(x, y, '#7a8593');
      rg.strokeStyle = 'rgba(0,0,0,.3)'; rg.lineWidth = Math.max(1, S * 0.05);
      rg.strokeRect(S * 0.05, S * 0.05, S * 0.9, S * 0.9);
      rg.fillStyle = '#b8c2cf';
      for (const [a, b] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
        rg.beginPath(); rg.arc(S * a, S * b, S * 0.06, 0, TAU); rg.fill();
      }
    },
  };

  function fill(x, y, col) { rg.fillStyle = col; rg.fillRect(0, 0, S + 0.5, S + 0.5); }

  function drawRoom() {
    const grad = rg.createLinearGradient(0, 0, 0, room.height);
    grad.addColorStop(0, '#15111f'); grad.addColorStop(1, '#251c33');
    rg.fillStyle = grad;
    rg.fillRect(0, 0, room.width, room.height);
    // faint grid on the empty room
    rg.strokeStyle = 'rgba(255,255,255,.025)'; rg.lineWidth = 1;
    rg.beginPath();
    for (let x = 0; x <= world.w; x++) { rg.moveTo(ox + x * S, oy); rg.lineTo(ox + x * S, oy + world.h * S); }
    for (let y = 0; y <= world.h; y++) { rg.moveTo(ox, oy + y * S); rg.lineTo(ox + world.w * S, oy + y * S); }
    rg.stroke();

    const x0 = Math.floor(-ox / S), x1 = Math.ceil((room.width - ox) / S);
    const y0 = Math.floor(-oy / S), y1 = Math.ceil((room.height - oy) / S);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const type = world.at(x, y);
        if (!type) continue;
        rg.save();
        rg.translate(Math.floor(ox + x * S), Math.floor(oy + y * S));
        TILE[type](x, y);
        rg.restore();
      }
    }
    // a dark rim where a tile faces the room
    rg.fillStyle = 'rgba(0,0,0,.35)';
    const t = Math.max(1, S * 0.06);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!world.at(x, y)) continue;
        const X = ox + x * S, Y = oy + y * S;
        if (!world.at(x, y - 1)) rg.fillRect(X, Y, S, t);
        if (!world.at(x, y + 1)) rg.fillRect(X, Y + S - t, S, t);
        if (!world.at(x - 1, y)) rg.fillRect(X, Y, t, S);
        if (!world.at(x + 1, y)) rg.fillRect(X + S - t, Y, t, S);
      }
    }
  }

  // ---- drops and slime ----------------------------------------------------------

  const sx = (x) => ox + x * S, sy = (y) => oy + y * S;

  function drawDrops(drops, T, col) {
    for (const d of drops) {
      if (!d.state) continue;
      const fade = Math.min(1, (T.trail.life - d.age) / (T.trail.life / 3));
      g.globalAlpha = 0.85 * fade;
      g.fillStyle = col.base;
      g.beginPath();
      if (d.state === 'stuck') {
        // flattened along the surface
        g.ellipse(sx(d.x), sy(d.y), d.r * 1.5 * S, d.r * 0.75 * S, Math.atan2(d.nx, -d.ny), 0, TAU);
      } else {
        g.arc(sx(d.x), sy(d.y), d.r * S, 0, TAU);
      }
      g.fill();
    }
    g.globalAlpha = 1;
  }

  function drawSlime(slime, T, col, look, blink) {
    const pts = slime.outline();
    const c = slime.centre();
    const N = pts.length, R = T.radius * S;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    g.beginPath();
    const m0 = mid(pts[N - 1], pts[0]);
    g.moveTo(sx(m0.x), sy(m0.y));
    for (let i = 0; i < N; i++) {
      const m = mid(pts[i], pts[(i + 1) % N]);
      g.quadraticCurveTo(sx(pts[i].x), sy(pts[i].y), sx(m.x), sy(m.y));
    }
    g.closePath();

    const cx = sx(c.x), cy = sy(c.y);
    const grad = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.3);
    grad.addColorStop(0, col.light); grad.addColorStop(0.55, col.base); grad.addColorStop(1, col.dark);
    g.fillStyle = grad;
    g.globalAlpha = 0.93;
    g.fill();
    g.globalAlpha = 1;
    g.lineWidth = Math.max(1.5, S * 0.06);
    g.strokeStyle = col.edge;
    g.stroke();

    // gloss
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.beginPath();
    g.ellipse(cx - R * 0.35, cy - R * 0.45, R * 0.26, R * 0.13, -0.5, 0, TAU);
    g.fill();

    // eyes, looking where the slime goes
    const ey = cy - R * 0.12;
    for (const side of [-1, 1]) {
      const ex = cx + side * R * 0.3;
      g.fillStyle = '#fff';
      g.beginPath(); g.ellipse(ex, ey, R * 0.17, R * 0.2 * (blink ? 0.12 : 1), 0, 0, TAU); g.fill();
      if (blink) continue;
      g.fillStyle = '#1b1426';
      g.beginPath(); g.arc(ex + look.x * R * 0.07, ey + look.y * R * 0.08, R * 0.085, 0, TAU); g.fill();
    }
  }

  function draw(slime, trail, T, look, blink) {
    g.drawImage(room, 0, 0);
    const col = palette(T.color);
    drawDrops(trail.drops, T, col);
    drawSlime(slime, T, col, look, blink);
  }

  addEventListener('resize', resize);
  resize();
  return { draw, resize };
}

// ---- colour ---------------------------------------------------------------------

let cached = null;
function palette(hex) {
  if (cached?.hex === hex) return cached;
  const n = parseInt(String(hex).replace('#', ''), 16) || 0x6fdc4b;
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mix = (t, to) => 'rgb(' + rgb.map((v) => Math.round(v + (to - v) * t)).join(',') + ')';
  cached = { hex, base: mix(0, 0), light: mix(0.45, 255), dark: mix(0.3, 0), edge: mix(0.5, 0) };
  return cached;
}
