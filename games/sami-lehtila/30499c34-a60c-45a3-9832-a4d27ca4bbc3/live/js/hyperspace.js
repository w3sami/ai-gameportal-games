/* Loppukortin taustat.
 *
 * Kaksi tunnelmaa samasta tähtitaivaasta:
 *
 *   warp  — vuoro suoritettu. Kaikki tähdet lähtevät yhdestä pisteestä ruudun
 *           keskeltä ja kiihtyvät ulospäin eksponentiaalisesti (r += r * k),
 *           koska lineaarinen liike näyttää sateelta eikä ylivalonnopeudelta.
 *           Peli antaa katsoa hetken pelkkää lentoa ennen kuin kortti tulee.
 *   drift — taksit loppu. Ei lähtöä minnekään: tähdet valuvat hitaasti alas,
 *           värit ovat sammuneet ja alareunassa hehkuu tumma punerrus.
 *
 * Kumpikaan ei tiedä pelistä mitään: sille annetaan ruudun mitat ja se piirtää.
 */
export function createHyperspace(cfg) {
  const { W, H, rand, mode = 'warp' } = cfg;
  return mode === 'drift' ? drift(W, H, rand) : warp(W, H, rand);
}

/* ------------------------------------------------------------------- warp */
function warp(W, H, rand) {
  const cx = W / 2, cy = H / 2;
  const maxR = Math.hypot(cx, cy) + 80;
  const COUNT = 260;

  const spawn = () => ({
    a: rand(0, Math.PI * 2),
    r: rand(1, 14),                 // kaikki lähtevät samasta pisteestä
    v: rand(0.8, 2.3),
    hue: rand(190, 265),
    len: 0,
  });

  const stars = Array.from({ length: COUNT }, spawn);
  let t = 0;

  return {
    update(dt) {
      t += dt;
      const w = 0.35 + Math.min(1, t / 1.6) * 1.65;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const prev = s.r;
        s.r += (s.r * 1.5 + 26) * s.v * w * dt;
        s.len = s.r - prev;
        if (s.r > maxR) stars[i] = spawn();
      }
    },

    draw(ctx) {
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      bg.addColorStop(0, '#16224e');
      bg.addColorStop(0.45, '#080d22');
      bg.addColorStop(1, '#02030a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      ctx.lineCap = 'round';
      for (const s of stars) {
        const f = Math.min(1, s.r / maxR);
        const tail = Math.min(s.r - 1, s.len * 3.2 + f * 26);
        const ca = Math.cos(s.a), sa = Math.sin(s.a);
        ctx.globalAlpha = Math.min(1, 0.15 + f * 1.2);
        ctx.strokeStyle = `hsl(${s.hue}, 95%, ${62 + f * 30}%)`;
        ctx.lineWidth = 0.6 + f * 2.6;
        ctx.beginPath();
        ctx.moveTo(cx + ca * (s.r - tail), cy + sa * (s.r - tail));
        ctx.lineTo(cx + ca * s.r, cy + sa * s.r);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 120);
      core.addColorStop(0, 'rgba(210,235,255,.55)');
      core.addColorStop(0.5, 'rgba(120,180,255,.12)');
      core.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(cx, cy, 120, 0, 6.3); ctx.fill();
    },
  };
}

/* ------------------------------------------------------------------ drift */
function drift(W, H, rand) {
  const stars = Array.from({ length: 130 }, () => ({
    x: rand(0, W), y: rand(0, H),
    r: rand(0.5, 2.1), v: rand(5, 26),
    a: rand(0.06, 0.34), p: rand(0, 6.3),
  }));
  let t = 0;

  return {
    update(dt) {
      t += dt;
      for (const s of stars) {
        s.y += s.v * dt;
        if (s.y > H + 3) { s.y = -3; s.x = rand(0, W); }
      }
    },

    draw(ctx) {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a0c16');
      bg.addColorStop(0.6, '#07080f');
      bg.addColorStop(1, '#040409');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      for (const s of stars) {
        ctx.globalAlpha = s.a * (0.7 + Math.sin(t * 0.7 + s.p) * 0.3);
        ctx.fillStyle = '#6b7ba0';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.3); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // sammuneen vuoron hehku alareunassa
      const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
      g.addColorStop(0, 'rgba(70,22,38,0)');
      g.addColorStop(1, 'rgba(70,22,38,.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, H * 0.55, W, H * 0.45);
    },
  };
}
