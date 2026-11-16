// Loose effects in screen space: sparks, and the things that rain down when a
// streak reaches a new ten. Whoever wants some calls spark() or shower();
// main.js moves them once a frame and draws them in layers.
//
// The rain is in two layers. Stars and glints belong to the room the car is
// in: they are drawn straight after the floor, under the note ring. Out under
// the sectors they are dim, as things seen through the ring's glass floor, and
// inside the ring, in the open round the car, they are bright and larger.
// Gunk lands on the ring itself and is drawn over it, with the sparks.

const MAX_SPARKS = 800;
const MAX_DROPS = 260;
const UNDER = { star: true, glint: true };       // the kinds that fall under the ring
const sparks = [];      // { x, y, vx, vy, age, life, color, size }
const drops = [];       // { kind, x, y, vy, spin, turn, sway, phase, size, color, floor, age, landed }
let movedAt = 0;        // when everything was last moved, seconds

// A spark: a short streak of added light that slows down and fades.
export function spark(x, y, vx, vy, life, color, size) {
  if (sparks.length >= MAX_SPARKS) return;
  sparks.push({ x, y, vx, vy, age: 0, life, color, size });
}

// A shower from the top of the screen, of the kinds named:
//   star   drifts down slowly, swaying and turning like a leaf
//   gunk   a blob that drops fast and splats where it lands
//   glint  a small twinkling dot, slowest of all
// landing(kind) gives the spot on the floor, in screen pixels, where one of
// them comes down: each falls straight to its own spot, so the shower lands
// all over the floor and not in a line along the bottom of the screen. Things
// that land lower on the screen are nearer and drawn larger.
export function shower(view, count, palette, kinds, landing) {
  if (!kinds.length) return;
  for (let i = 0; i < count && drops.length < MAX_DROPS; i++) {
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const [x, floor] = landing(kind);
    const near = 0.6 + 0.8 * floor / view.h;
    drops.push({
      kind, x, floor,
      y: -20 - Math.random() * view.h * 0.5,
      vy: kind === 'gunk' ? 260 + Math.random() * 240 : kind === 'star' ? 70 + Math.random() * 90 : 40 + Math.random() * 50,
      turn: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * (kind === 'star' ? 4 : 1),
      sway: kind === 'gunk' ? 6 : 30 + Math.random() * 50,
      phase: Math.random() * Math.PI * 2,
      size: near * (kind === 'star' ? 9 + Math.random() * 13 : kind === 'gunk' ? 8 + Math.random() * 12 : 3 + Math.random() * 4),
      color: palette[Math.floor(Math.random() * palette.length)],
      age: 0, landed: 0,
    });
  }
}

// Moves everything on to now. Once a frame, before any of it is drawn.
export function stepFx(now) {
  const dt = Math.min(0.05, Math.max(0, now - movedAt));
  movedAt = now;
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.age += dt;
    if (d.landed) {
      // Gunk that has landed lies as a splat for a while; the rest is gone quickly.
      d.landed += dt;
      if (d.landed > (d.kind === 'gunk' ? 1.6 : 0.5)) drops.splice(i, 1);
      continue;
    }
    if (d.kind === 'gunk') d.vy += 500 * dt;
    d.y += d.vy * dt;
    // The sway dies away near the floor, so that a thing lands on its own spot.
    d.x += Math.cos(d.age * 2.2 + d.phase) * d.sway * Math.min(1, (d.floor - d.y) / 120) * dt;
    d.turn += d.spin * dt;
    if (d.y >= d.floor) { d.y = d.floor; d.landed = 0.0001; }
  }
  const drag = Math.exp(-2.6 * dt);
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.age += dt;
    if (s.age >= s.life) { sparks.splice(i, 1); continue; }
    s.x += s.vx * dt; s.y += s.vy * dt;
    s.vx *= drag; s.vy *= drag;
  }
}

function star(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.45 : r;
    if (i) ctx.lineTo(Math.cos(a) * q, Math.sin(a) * q); else ctx.moveTo(Math.cos(a) * q, Math.sin(a) * q);
  }
  ctx.closePath();
}

// One drop. grow scales it; glow adds a halo of its own colour round a star.
function drawDrop(ctx, d, alpha, grow, glow) {
  const size = d.size * grow;
  if (d.landed) {
    const left = 1 - d.landed / (d.kind === 'gunk' ? 1.6 : 0.5);
    ctx.globalAlpha = alpha * Math.max(0, left);
    ctx.fillStyle = d.color;
    ctx.beginPath();
    if (d.kind === 'gunk') ctx.ellipse(d.x, d.y, size * (1.4 + 0.8 * Math.min(1, d.landed * 6)), size * 0.35, 0, 0, Math.PI * 2);
    else ctx.arc(d.x, d.y, size * 0.4, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = d.color;
  ctx.strokeStyle = '#1d1b26';
  ctx.lineWidth = 2;
  if (d.kind === 'star') {
    ctx.rotate(d.turn);
    // Seen edge on as it turns over: a leaf does not fall flat.
    ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.cos(d.age * 3 + d.phase)));
    if (glow) {
      star(ctx, size * 1.7);
      ctx.globalAlpha = alpha * 0.22;
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
    star(ctx, size);
    ctx.fill(); ctx.stroke();
  } else if (d.kind === 'gunk') {
    // A drop: round below, drawn out above the faster it falls.
    const stretch = 1 + Math.min(1.2, d.vy / 500);
    ctx.beginPath();
    ctx.moveTo(0, -size * stretch * 1.3);
    ctx.quadraticCurveTo(size, 0, 0, size);
    ctx.quadraticCurveTo(-size, 0, 0, -size * stretch * 1.3);
    ctx.fill(); ctx.stroke();
  } else {
    ctx.globalAlpha = alpha * (0.5 + 0.5 * Math.sin(d.age * 14 + d.phase));
    ctx.beginPath(); ctx.arc(0, 0, size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// The stars and glints, under the note ring. ring: { cx, cy, rx, ry } of the
// ring's ellipse on screen, or null when there is no ring and all of them are
// in the open.
export function drawUnderRing(ctx, view, ring) {
  const mine = drops.filter((d) => UNDER[d.kind]);
  if (!mine.length) return;
  ctx.save();
  ctx.lineJoin = 'round';
  if (!ring) {
    for (const d of mine) drawDrop(ctx, d, 1, 1, true);
    ctx.restore();
    return;
  }
  // Outside the ring: dim.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, view.w, view.h);
  ctx.ellipse(ring.cx, ring.cy, ring.rx, ring.ry, 0, 0, Math.PI * 2);
  ctx.clip('evenodd');
  for (const d of mine) drawDrop(ctx, d, 0.3, 0.85, false);
  ctx.restore();
  // Inside it: bright, larger, with a halo.
  ctx.beginPath();
  ctx.ellipse(ring.cx, ring.cy, ring.rx, ring.ry, 0, 0, Math.PI * 2);
  ctx.clip();
  for (const d of mine) drawDrop(ctx, d, 1, 1.35, true);
  ctx.restore();
}

// The gunk and the sparks, on top of everything.
export function drawOnTop(ctx) {
  ctx.save();
  ctx.lineJoin = 'round';
  for (const d of drops) if (!UNDER[d.kind]) drawDrop(ctx, d, 1, 1, false);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const s of sparks) {
    const fade = 1 - s.age / s.life;
    ctx.globalAlpha = fade;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size * (0.5 + 0.5 * fade);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x - s.vx * 0.035, s.y - s.vy * 0.035);
    ctx.stroke();
  }
  ctx.restore();
}
