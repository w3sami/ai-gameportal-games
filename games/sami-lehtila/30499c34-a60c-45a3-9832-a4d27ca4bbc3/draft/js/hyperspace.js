/* Hyperavaruus: vuoron loppukortin tausta.
 *
 * Tähdet lähtevät ruudun keskeltä ja kiihtyvät ulospäin — mitä kauempana, sitä
 * pidempi viiru ja kirkkaampi väri, kuten valo venyisi ohi. Kiihtyvyys on
 * eksponentiaalinen (r += r * k), koska lineaarinen liike näyttää sateelta eikä
 * ylivalonnopeudelta, ja koko kuva kiihtyy vielä erikseen pariin sekuntiin,
 * jotta kortin ilmestyminen tuntuu lähdöltä eikä pysähtymiseltä.
 *
 * Tämä ei tiedä pelistä mitään: sille annetaan ruudun mitat ja se piirtää.
 */
export function createHyperspace(cfg) {
  const { W, H, rand } = cfg;
  const cx = W / 2, cy = H / 2;
  const maxR = Math.hypot(cx, cy) + 80;
  const COUNT = 260;

  const spawn = (near) => ({
    a: rand(0, Math.PI * 2),
    r: near ? rand(2, 24) : rand(6, maxR * 0.95),
    v: rand(0.8, 2.3),
    hue: rand(190, 265),
    len: 0,
  });

  const stars = Array.from({ length: COUNT }, () => spawn(false));
  let t = 0;

  return {
    update(dt) {
      t += dt;
      const warp = 0.3 + Math.min(1, t / 1.8) * 1.7;      // kiihtyy lähdössä
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const prev = s.r;
        s.r += (s.r * 1.5 + 26) * s.v * warp * dt;
        s.len = s.r - prev;
        if (s.r > maxR) stars[i] = spawn(true);
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
        const tail = Math.min(s.r - 2, s.len * 3.2 + f * 26);
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
