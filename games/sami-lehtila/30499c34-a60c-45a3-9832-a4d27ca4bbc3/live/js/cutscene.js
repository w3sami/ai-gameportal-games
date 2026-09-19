/* Kenttien välinen välianimaatio.
 *
 * Matka jatkuu siitä mihin kenttä jäi: taksi tulee alareunan alta ja menee
 * yläreunan yli, eli ruutu on ikkuna nousuun eikä pysähtynyt kuva. Nousu on
 * tasainen puolikaasu, ja sivusuuttimet läiskivät satunnaisia lyhyitä
 * purskeita. Tähdet valuvat hitaasti alas syvyyden vuoksi — ne eivät ole
 * vauhtiviivoja, koska vauhdin kertoo taksin oma liike.
 *
 * Ei seiniä, ei ohjausta, ei törmäyksiä. Peli antaa taksin rungon piirtävän
 * funktion (body), jotta sama muoto piirtyy tässäkin.
 */
export function createCut(cfg) {
  const { W, H, secs = 3, name, index, total, glow, body, rand } = cfg;
  const TRAVEL = H + 220;                       // alareunan alta yläreunan yli

  const stars = Array.from({ length: 90 }, () => ({
    x: rand(0, W), y: rand(0, H), r: rand(0.6, 2.2), a: rand(0.15, 0.7),
  }));

  let t = 0, x = W / 2, vx = 0, side = 1, sideT = 0, next = 0.35;

  return {
    get done() { return t >= secs; },

    update(dt) {
      t += dt;
      for (const s of stars) {
        s.y += (12 + s.r * 22) * dt;
        if (s.y > H + 4) { s.y = -4; s.x = rand(0, W); }
      }
      next -= dt;
      sideT -= dt;
      if (next <= 0) {                          // satunnainen sivupurske
        side = Math.random() < 0.5 ? -1 : 1;
        vx += side * rand(90, 190);
        sideT = 0.18;
        next = rand(0.3, 0.7);
      }
      vx *= Math.pow(0.12, dt);
      x = Math.min(W - 90, Math.max(90, x + vx * dt));
    },

    draw(ctx) {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#080d22');
      bg.addColorStop(1, '#03050c');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      for (const s of stars) {
        ctx.globalAlpha = s.a;
        ctx.fillStyle = '#9fc4ff';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.3); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // nimi ensin, taksi sen päälle
      const a = Math.max(0, Math.min(1, Math.min(t / 0.45, (secs - t) / 0.5)));
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(233,237,255,.55)';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(`KENTTÄ ${index + 1} / ${total}`, W / 2, H * 0.32);
      ctx.fillStyle = glow;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 24;
      ctx.font = '700 58px system-ui, sans-serif';
      ctx.fillText(name.toUpperCase(), W / 2, H * 0.39);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      const y = H + 80 - TRAVEL * (t / secs);
      ctx.save();
      ctx.translate(x, y);

      const flame = (dx, dy, rot, len) => {
        ctx.save();
        ctx.translate(dx, dy); ctx.rotate(rot);
        const fg = ctx.createLinearGradient(0, 0, 0, len);
        fg.addColorStop(0, 'rgba(255,240,180,.95)');
        fg.addColorStop(0.5, 'rgba(255,150,60,.7)');
        fg.addColorStop(1, 'rgba(255,60,60,0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(0, len);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      };

      const half = cfg.TH / 2, wide = cfg.TW / 2;
      const l = rand(18, 26);
      flame(-14, half, 0, l);
      flame(14, half, 0, l);
      if (sideT > 0) {                          // liekki työnnön vastapuolelle
        const s = side > 0 ? -1 : 1;
        flame(s * wide, 0, s * Math.PI / 2, rand(16, 24));
      }
      body(ctx);
      ctx.restore();
    },
  };
}
