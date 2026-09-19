/* Luukun ulkoasu omana moduulinaan.
 *
 * Peli (js/game.js) ja luukkutesti (gate-test.html) piirtävät täsmälleen tällä
 * samalla koodilla, joten testissä haettu arvo on se mikä pelissä näkyy.
 *
 * Idea: katon takana on valopallo, josta näkyy alaspäin aukeava siivu. Kärki
 * nostetaan niin ylös, että siivun reunat osuvat tasan aukon reunoihin — eli
 * näkyvä osa alkaa aukosta, ei sen alapuolelta. Kulmasta seuraa korkeus:
 * tan(spread) = (aukon puolikas) / (kärjen etäisyys katosta).
 *
 * Aallot ovat radiaaligradienttikaistoja, ei viivoja: paksuus on pikseleinä ja
 * reunat haipuvat nollaan, joten ne ovat pehmeitä eivätkä näytä renkailta
 * joihin voisi osua.
 */

const D2R = Math.PI / 180;
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampSpread = s => Math.min(80, Math.max(5, s));

export const GATE_LOOK = {
  radius: 300,        // kuinka kauas valo kantaa aukosta alaspäin
  spread: 45,         // puolikulma asteina — 45 on neljännes pallosta
  glow: 1,            // hehkun voimakkuuden kerroin
  ripples: 3,         // montako aaltoa kerrallaan
  rippleWidth: 54,    // aallon paksuus pikseleinä
  rippleAlpha: 0.26,  // aallon kirkkain kohta
  rippleSpeed: 0.4,   // kierrosta sekunnissa
  breathe: 2.2,       // hehkun hengityksen taajuus
};

export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Valopallon kärki: katon yläpuolella sen verran että siivu alkaa aukosta. */
export function apexY(halfWidth, ceilY, spread) {
  return ceilY - halfWidth / Math.tan(clampSpread(spread) * D2R);
}

export function drawGateGlow(ctx, gate, ceilY, color, t, look) {
  const L = Object.assign({}, GATE_LOOK, look);
  const spread = clampSpread(L.spread);
  const halfW = gate.w / 2;
  const cx = gate.x + halfW;
  const cy = apexY(halfW, ceilY, spread);
  const rMin = ceilY - cy;                       // kärjestä aukon tasolle
  const R = rMin + L.radius;
  const a0 = Math.PI / 2 - spread * D2R;
  const a1 = Math.PI / 2 + spread * D2R;
  const breathe = 0.6 + Math.sin(t * L.breathe) * 0.4;
  const bx = cx - R, by = ceilY, bw = R * 2, bh = R;

  ctx.save();
  ctx.beginPath();                               // siivu
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, a0, a1);
  ctx.closePath();
  ctx.clip();
  ctx.beginPath();                               // ja vain katon alapuoli
  ctx.rect(bx, by, bw, bh);
  ctx.clip();

  const edge = clamp01(rMin / R);
  const ball = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  ball.addColorStop(0, rgba(color, clamp01((0.46 + breathe * 0.30) * L.glow)));
  ball.addColorStop(edge, rgba(color, clamp01((0.34 + breathe * 0.22) * L.glow)));
  ball.addColorStop(clamp01(edge + 0.30), rgba(color, clamp01(0.11 * L.glow)));
  ball.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = ball;
  ctx.fillRect(bx, by, bw, bh);

  // aallot ulkoa sisään, kirkkaimmillaan puolimatkassa
  for (let i = 0; i < L.ripples; i++) {
    const p = (t * L.rippleSpeed + i / L.ripples) % 1;
    const r = rMin + (R - rMin) * (1 - p);
    const a = Math.sin(p * Math.PI) * L.rippleAlpha;
    const c = clamp01(r / R), half = clamp01(L.rippleWidth / 2 / R);
    const band = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    band.addColorStop(clamp01(c - half), rgba(color, 0));
    band.addColorStop(c, rgba(color, a));
    band.addColorStop(clamp01(c + half), rgba(color, 0));
    ctx.fillStyle = band;
    ctx.fillRect(bx, by, bw, bh);
  }
  ctx.restore();
}
