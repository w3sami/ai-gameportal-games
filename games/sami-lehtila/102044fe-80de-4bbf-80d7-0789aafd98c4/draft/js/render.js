// Everything drawn. The camera follows the slime and shows T.view tiles top
// to bottom (fewer across a narrow screen), and stops at the level's edges.
// The tiles that never change are drawn once into chunks of CHUNK × CHUNK
// tiles, kept until the screen's size changes; platforms, doors, the
// panels' glow, the things, the drops and the slime are drawn every frame.

const TAU = Math.PI * 2;
const CHUNK = 16;

export function createRenderer(canvas, world, T) {
  const g = canvas.getContext('2d');
  let S = 1, dpr = 1, offX = 0, offY = 0;
  const cam = { x: world.start.x, y: world.start.y, set: false };
  let chunks = new Map();

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    chunks = new Map();
  }

  function scale() {
    const s = Math.min(canvas.height / T.view, canvas.width / (T.view * 1.2));
    if (s !== S) { S = s; chunks = new Map(); }
  }

  // ---- tile art -----------------------------------------------------------------

  // the same speckles for the same tile every time
  const rand = (x, y, i) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + i * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };

  // Each draws one tile of size s at the context's origin. `face` is the
  // outward normal of a side open to the room, if any.
  const TILE = {
    stone(c, s, x, y) {
      fill(c, s, '#3b3649');
      c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(0, 0, s, s * 0.12); c.fillRect(0, 0, s * 0.12, s);
      c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(0, s * 0.88, s, s * 0.12); c.fillRect(s * 0.88, 0, s * 0.12, s);
      c.fillStyle = 'rgba(255,255,255,.07)';
      for (let i = 0; i < 4; i++) c.fillRect(rand(x, y, i) * s * 0.8, rand(x, y, i + 9) * s * 0.8, s * 0.08, s * 0.08);
    },
    wood(c, s, x, y) {
      fill(c, s, '#80532f');
      c.fillStyle = 'rgba(0,0,0,.25)';
      for (const f of [0.33, 0.66]) c.fillRect(0, s * f, s, Math.max(1, s * 0.04));
      c.fillStyle = 'rgba(255,220,170,.12)';
      for (let i = 0; i < 3; i++) c.fillRect(rand(x, y, i) * s * 0.6, s * (0.1 + i * 0.33), s * 0.35, Math.max(1, s * 0.03));
    },
    ice(c, s) {
      fill(c, s, '#9fdcf3');
      c.strokeStyle = 'rgba(255,255,255,.65)'; c.lineWidth = Math.max(1, s * 0.05);
      c.beginPath(); c.moveTo(s * 0.15, s * 0.6); c.lineTo(s * 0.45, s * 0.2);
      c.moveTo(s * 0.4, s * 0.85); c.lineTo(s * 0.8, s * 0.35); c.stroke();
      c.fillStyle = 'rgba(30,90,140,.18)'; c.fillRect(0, s * 0.9, s, s * 0.1);
    },
    metal(c, s) {
      fill(c, s, '#7a8593');
      c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = Math.max(1, s * 0.05);
      c.strokeRect(s * 0.05, s * 0.05, s * 0.9, s * 0.9);
      c.fillStyle = '#b8c2cf';
      for (const [a, b] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
        c.beginPath(); c.arc(s * a, s * b, s * 0.06, 0, TAU); c.fill();
      }
    },
    // dark, with yellow chevrons pointing the way it throws
    pad(c, s, x, y, meta, face) {
      fill(c, s, '#2c2838');
      const dir = meta?.dir || (face && [face.nx, face.ny]) || [0, -1];
      const l = Math.hypot(dir[0], dir[1]) || 1, a = Math.atan2(dir[1] / l, dir[0] / l);
      c.save();
      c.translate(s / 2, s / 2); c.rotate(a);
      c.strokeStyle = '#ffd43b'; c.lineWidth = Math.max(1.5, s * 0.1); c.lineCap = 'round'; c.lineJoin = 'round';
      for (const k of [-0.18, 0.12]) {
        c.beginPath(); c.moveTo(s * (k - 0.12), -s * 0.22); c.lineTo(s * (k + 0.1), 0); c.lineTo(s * (k - 0.12), s * 0.22); c.stroke();
      }
      c.restore();
      if (face) {
        // the springy face itself
        c.fillStyle = '#ffd43b';
        const t = s * 0.14;
        if (face.ny < 0) c.fillRect(0, 0, s, t);
        else if (face.ny > 0) c.fillRect(0, s - t, s, t);
        else if (face.nx < 0) c.fillRect(0, 0, t, s);
        else c.fillRect(s - t, 0, t, s);
      }
    },
    // a frame around a plate; the plate's glow is drawn every frame
    panel(c, s) {
      fill(c, s, '#262030');
      c.fillStyle = '#120d1a';
      c.fillRect(s * 0.12, s * 0.12, s * 0.76, s * 0.76);
    },
    platform(c, s, x) {
      fill(c, s, '#56657a');
      c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(0, 0, s, s * 0.16);
      c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(0, s * 0.84, s, s * 0.16);
      c.fillStyle = (x & 1) ? '#ffd43b' : '#2b2b2b';
      c.fillRect(0, s * 0.36, s, s * 0.22);
    },
  };

  function fill(c, s, col) { c.fillStyle = col; c.fillRect(0, 0, s + 0.5, s + 0.5); }

  const open = (x, y) => [[0, -1], [-1, 0], [1, 0], [0, 1]].map(([dx, dy]) => (!world.at(x + dx, y + dy) ? { nx: dx, ny: dy } : null)).find(Boolean);

  function chunk(cx, cy) {
    const key = cx + ',' + cy;
    let ch = chunks.get(key);
    if (ch) return ch;
    const px0 = Math.round(cx * CHUNK * S), py0 = Math.round(cy * CHUNK * S);
    ch = document.createElement('canvas');
    ch.width = Math.round((cx + 1) * CHUNK * S) - px0;
    ch.height = Math.round((cy + 1) * CHUNK * S) - py0;
    const c = ch.getContext('2d');
    const grad = c.createLinearGradient(0, -py0, 0, world.h * S - py0);
    grad.addColorStop(0, '#15111f'); grad.addColorStop(1, '#251c33');
    c.fillStyle = grad;
    c.fillRect(0, 0, ch.width, ch.height);
    // faint grid on the empty room
    c.strokeStyle = 'rgba(255,255,255,.025)'; c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i <= CHUNK; i++) {
      const X = Math.round((cx * CHUNK + i) * S) - px0 + 0.5, Y = Math.round((cy * CHUNK + i) * S) - py0 + 0.5;
      c.moveTo(X, 0); c.lineTo(X, ch.height); c.moveTo(0, Y); c.lineTo(ch.width, Y);
    }
    c.stroke();
    const rim = Math.max(1, S * 0.06);
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const x = cx * CHUNK + i, y = cy * CHUNK + j, type = world.at(x, y);
        if (!type) continue;
        const X = Math.round(x * S) - px0, Y = Math.round(y * S) - py0, s = Math.round((x + 1) * S) - px0 - X;
        c.save(); c.translate(X, Y);
        (TILE[type] || TILE.stone)(c, s, x, y, world.metaAt(x, y), open(x, y));
        c.restore();
        // a dark rim where the tile faces the room
        c.fillStyle = 'rgba(0,0,0,.35)';
        if (!world.at(x, y - 1)) c.fillRect(X, Y, s, rim);
        if (!world.at(x, y + 1)) c.fillRect(X, Y + s - rim, s, rim);
        if (!world.at(x - 1, y)) c.fillRect(X, Y, rim, s);
        if (!world.at(x + 1, y)) c.fillRect(X + s - rim, Y, rim, s);
      }
    }
    chunks.set(key, ch);
    return ch;
  }

  // ---- camera -------------------------------------------------------------------

  const sx = (x) => offX + x * S, sy = (y) => offY + y * S;

  function follow(slime, dt) {
    const c = slime.centre(), v = slime.velocity();
    const tx = c.x + Math.max(-3, Math.min(3, v.x * 0.15)), ty = c.y + Math.max(-2, Math.min(2, v.y * 0.1));
    if (!cam.set) { cam.x = tx; cam.y = ty; cam.set = true; }
    const k = 1 - Math.exp(-5 * dt);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    const vw = canvas.width / S / 2, vh = canvas.height / S / 2;
    cam.x = world.w <= 2 * vw ? world.w / 2 : Math.max(vw, Math.min(world.w - vw, cam.x));
    cam.y = world.h <= 2 * vh ? world.h / 2 : Math.max(vh, Math.min(world.h - vh, cam.y));
    offX = Math.round(canvas.width / 2 - cam.x * S);
    offY = Math.round(canvas.height / 2 - cam.y * S);
  }

  function drawTiles() {
    const x0 = Math.floor(-offX / S / CHUNK), x1 = Math.floor((canvas.width - offX) / S / CHUNK);
    const y0 = Math.floor(-offY / S / CHUNK), y1 = Math.floor((canvas.height - offY) / S / CHUNK);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        g.drawImage(chunk(cx, cy), offX + Math.round(cx * CHUNK * S), offY + Math.round(cy * CHUNK * S));
      }
    }
  }

  const visible = (x, y, m = 2) => sx(x) > -m * S && sx(x) < canvas.width + m * S && sy(y) > -m * S && sy(y) < canvas.height + m * S;

  // ---- moving and glowing parts -----------------------------------------------------

  function drawPanels(clock) {
    for (const p of world.panels) {
      if (!visible(p.x, p.y)) continue;
      const state = world.panel(p.e);
      const X = sx(p.x + 0.12), Y = sy(p.y + 0.12), s = S * 0.76;
      if (state === 'on' || (state === 'warn' && Math.floor(clock * 8) % 2 === 0)) {
        g.save();
        g.shadowColor = '#ff2a1f'; g.shadowBlur = S * (state === 'on' ? 0.9 : 0.4);
        g.fillStyle = state === 'on' ? '#ff3b30' : '#b8322a';
        g.fillRect(X, Y, s, s);
        g.restore();
        g.fillStyle = 'rgba(255,220,200,.45)';
        g.fillRect(X + s * 0.15, Y + s * 0.15, s * 0.7, s * 0.12);
      } else {
        g.fillStyle = 'rgba(90,200,255,.22)';
        g.fillRect(X, Y, s, s);
      }
    }
  }

  function drawMovers() {
    for (const m of world.movers) {
      if (m.w < 1e-3 || m.h < 1e-3 || !visible(m.x + m.w / 2, m.y + m.h / 2, m.w + m.h)) continue;
      if (m.kind === 'platform') {
        for (let j = 0; j < m.h0; j++) {
          for (let i = 0; i < m.w0; i++) {
            g.save(); g.translate(sx(m.x + i), sy(m.y + j));
            (TILE[m.type] || TILE.platform)(g, S, i, j, m.e);
            g.restore();
          }
        }
        g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = Math.max(1, S * 0.05);
        g.strokeRect(sx(m.x), sy(m.y), m.w * S, m.h * S);
      } else drawDoor(m);
    }
  }

  // bars in the key's colour, sliding into the door's top (or left)
  function drawDoor(d) {
    const vertical = d.h0 >= d.w0;
    g.save();
    g.beginPath(); g.rect(sx(d.x), sy(d.y), d.w * S, d.h * S); g.clip();
    // the pattern moves with the door's free end
    const shiftX = vertical ? 0 : d.w - d.w0, shiftY = vertical ? d.h - d.h0 : 0;
    const X = sx(d.x + shiftX), Y = sy(d.y + shiftY), Wd = d.w0 * S, Hd = d.h0 * S;
    g.fillStyle = '#1d1726'; g.fillRect(X, Y, Wd, Hd);
    g.fillStyle = d.color;
    const bars = vertical ? Math.max(2, Math.round(d.w0 * 2)) : Math.max(2, Math.round(d.h0 * 2));
    for (let i = 0; i < bars; i++) {
      if (vertical) g.fillRect(X + (i + 0.2) * (Wd / bars), Y, (Wd / bars) * 0.6, Hd);
      else g.fillRect(X, Y + (i + 0.2) * (Hd / bars), Wd, (Hd / bars) * 0.6);
    }
    g.fillStyle = 'rgba(0,0,0,.35)';
    for (let k = 0.5; k < (vertical ? d.h0 : d.w0); k += 1.5) {
      if (vertical) g.fillRect(X, Y + k * S, Wd, S * 0.12); else g.fillRect(X + k * S, Y, S * 0.12, Hd);
    }
    // what opens it: a card slot, or a round button mark
    const cx = X + Wd / 2, cy = Y + Hd - Math.min(Hd, 1.5 * S);
    g.fillStyle = '#1d1726';
    g.beginPath(); g.arc(cx, cy, S * 0.42, 0, TAU); g.fill();
    g.fillStyle = d.color;
    const card = world.cards.some((k) => k.char === d.e.key);
    if (card) g.fillRect(cx - S * 0.22, cy - S * 0.15, S * 0.44, S * 0.3);
    else { g.beginPath(); g.arc(cx, cy, S * 0.2, 0, TAU); g.fill(); }
    g.restore();
  }

  function drawButtons(game) {
    for (const b of world.buttons) {
      if (!visible(b.x, b.y)) continue;
      const down = game.isPressed(b);
      g.save();
      g.translate(sx(b.x), sy(b.y)); g.rotate(Math.atan2(b.nx, -b.ny));
      g.fillStyle = '#2a2433';
      g.fillRect(-S * 0.5, -S * 0.08, S, S * 0.08);
      if (down) { g.shadowColor = b.e.color; g.shadowBlur = S * 0.5; }
      g.fillStyle = b.e.color;
      const t = down ? 0.08 : 0.26;
      g.fillRect(-S * 0.4, -S * (0.08 + t), S * 0.8, S * t);
      g.fillStyle = 'rgba(255,255,255,.4)';
      g.fillRect(-S * 0.34, -S * (0.08 + t), S * 0.68, S * 0.05);
      g.restore();
    }
  }

  function card(x, y, size, color) {
    g.fillStyle = color;
    g.beginPath(); g.roundRect(x - size * 0.5, y - size * 0.35, size, size * 0.7, size * 0.1); g.fill();
    g.fillStyle = 'rgba(255,255,255,.8)';
    g.fillRect(x - size * 0.35, y - size * 0.12, size * 0.7, size * 0.1);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(x - size * 0.35, y + size * 0.08, size * 0.3, size * 0.12);
  }

  function drawCards(game, clock) {
    for (const k of world.cards) {
      if (game.carried.includes(k) || game.isTaken(k) || !visible(k.x, k.y)) continue;
      const y = k.y + Math.sin(clock * 2.4 + k.x) * 0.15;
      g.save(); g.shadowColor = k.e.color; g.shadowBlur = S * 0.6;
      card(sx(k.x), sy(y), S * 0.8, k.e.color);
      g.restore();
    }
  }

  function drawFlags(game, col, clock) {
    for (const p of world.checkpoints) {
      if (!visible(p.x, p.y)) continue;
      const on = game.isReached(p), X = sx(p.x - 0.3), top = sy(p.y - 2);
      g.fillStyle = '#c9c2d6'; g.fillRect(X - S * 0.04, top, S * 0.08, sy(p.y) - top);
      const wave = on ? Math.sin(clock * 6) * S * 0.08 : 0;
      g.fillStyle = on ? col.base : '#6b6478';
      g.beginPath(); g.moveTo(X, top); g.lineTo(X + S * 0.9, top + S * 0.25 + wave); g.lineTo(X, top + S * 0.55); g.fill();
    }
    for (const p of world.exits) {
      if (!visible(p.x, p.y)) continue;
      const X = sx(p.x), Y = sy(p.y - 1.4);
      g.save();
      g.shadowColor = '#fff3b0'; g.shadowBlur = S * 0.8;
      g.strokeStyle = '#ffe680'; g.lineWidth = S * 0.12;
      g.setLineDash([S * 0.35, S * 0.2]); g.lineDashOffset = -clock * S * 2;
      g.beginPath(); g.arc(X, Y, S * 1.1, 0, TAU); g.stroke();
      g.restore();
      g.fillStyle = 'rgba(255,240,170,.18)';
      g.beginPath(); g.arc(X, Y, S * 1.0, 0, TAU); g.fill();
    }
  }

  // ---- drops and slime ----------------------------------------------------------

  function drawDrops(drops, col) {
    for (const d of drops) {
      if (!d.state || !visible(d.x, d.y)) continue;
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

  function drawSlime(slime, col, look, blink, carried) {
    const pts = slime.outline();
    const c = slime.centre();
    const N = pts.length, R = T.radius * S;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const cx = sx(c.x), cy = sy(c.y);

    // carried cards float inside the jelly
    carried.forEach((k, i) => card(cx + (i - (carried.length - 1) / 2) * R * 0.5, cy + R * 0.4, R * 0.45, k.e.color));

    g.beginPath();
    const m0 = mid(pts[N - 1], pts[0]);
    g.moveTo(sx(m0.x), sy(m0.y));
    for (let i = 0; i < N; i++) {
      const m = mid(pts[i], pts[(i + 1) % N]);
      g.quadraticCurveTo(sx(pts[i].x), sy(pts[i].y), sx(m.x), sy(m.y));
    }
    g.closePath();

    const grad = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.3);
    grad.addColorStop(0, col.light); grad.addColorStop(0.55, col.base); grad.addColorStop(1, col.dark);
    g.fillStyle = grad;
    g.globalAlpha = carried.length ? 0.8 : 0.93;
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

  function draw(slime, trail, game, look, blink, clock, dt) {
    scale();
    if (!game.dead) follow(slime, dt);
    const col = palette(T.color);
    drawTiles();
    drawPanels(clock);
    drawFlags(game, col, clock);
    drawButtons(game);
    drawCards(game, clock);
    drawMovers();
    drawDrops(trail.drops, col);
    if (!game.dead) drawSlime(slime, col, look, blink, game.carried);
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
