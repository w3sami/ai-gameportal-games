// The portal: a soft whirl of seven arms, no lines and no rim, only
// gradients (the same portal as Space Taxi's Lab Experiment). It is painted
// once per colour onto a canvas of its own and turned with drawImage every
// frame: the arms are some two hundred blurred dots, which would be too
// many to draw every frame but cost nothing once.
//
// The whirl is drawn with 'lighter', so it adds its glow to what is behind.
// Its glow reaches about three times `r` out; the bright core is r × 0.6.

// Coming into a level: the portal opens a slime's height (arriveLift) above
// the start, the slime grows out of it a moment later and faster, drops to
// its place, and the portal closes after it (s). The slime hangs in the
// portal and takes no input until it has grown (ARRIVE.lead + ARRIVE.grow).
export const ARRIVE = { open: 0.22, lead: 0.08, grow: 0.34, hold: 0.5, close: 0.3 };
export const arriveLift = (T) => 2 * (T.radius + T.nodeRadius);
export const ARRIVE_COLOR = '#7fd4ff';
export const EXIT_COLOR = '#c58cff';

const SPR = 96;      // the painted sprite's radius in pixels
const SPR_R = 32;    // the portal radius that radius stands for
const ARMS = 7;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// a six-digit hex colour with an alpha
const fade = (c, a) => c + Math.round(clamp01(a) * 255).toString(16).padStart(2, '0');

const sprites = new Map();
function sprite(col) {
  const had = sprites.get(col);
  if (had) return had;
  const c = document.createElement('canvas');
  c.width = c.height = SPR * 2;
  const g = c.getContext('2d');
  g.translate(SPR, SPR);

  const halo = g.createRadialGradient(0, 0, 0, 0, 0, SPR);
  halo.addColorStop(0, fade(col, 0.30));
  halo.addColorStop(0.35, fade(col, 0.13));
  halo.addColorStop(1, fade(col, 0));
  g.fillStyle = halo;
  g.beginPath(); g.arc(0, 0, SPR, 0, Math.PI * 2); g.fill();

  // the arms add up where they overlap, so the whirl's dense parts brighten
  // by themselves and nothing has an edge
  g.globalCompositeOperation = 'lighter';
  for (let arm = 0; arm < ARMS; arm++) {
    for (let i = 0; i < 30; i++) {
      const u = i / 29;
      const ang = (arm * Math.PI * 2) / ARMS + u * 3.1;
      const rr = SPR_R * (0.16 + u * 2.05);
      const x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
      const size = SPR_R * (0.36 - u * 0.21);
      const dot = g.createRadialGradient(x, y, 0, x, y, size);
      dot.addColorStop(0, fade(col, 0.15 * (1 - u) ** 1.3));
      dot.addColorStop(1, fade(col, 0));
      g.fillStyle = dot;
      g.beginPath(); g.arc(x, y, size, 0, Math.PI * 2); g.fill();
    }
  }

  const core = g.createRadialGradient(0, 0, 0, 0, 0, SPR_R * 0.6);
  core.addColorStop(0, fade(col, 0.9));
  core.addColorStop(0.3, fade(col, 0.4));
  core.addColorStop(1, fade(col, 0));
  g.fillStyle = core;
  g.beginPath(); g.arc(0, 0, SPR_R * 0.6, 0, Math.PI * 2); g.fill();

  sprites.set(col, c);
  return c;
}

// a portal of radius r (pixels) at (x, y) on the canvas, turned `spin`
// radians, at `glow` (0–1) of its brightness
export function drawPortal(g, x, y, r, col, spin, glow = 1) {
  if (r < 0.5 || glow <= 0.01) return;
  g.save();
  g.globalAlpha = glow;
  g.globalCompositeOperation = 'lighter';
  g.translate(x, y);
  g.rotate(spin);
  const s = r / SPR_R;
  g.scale(s, s);
  g.drawImage(sprite(col), -SPR, -SPR);
  g.restore();
}
