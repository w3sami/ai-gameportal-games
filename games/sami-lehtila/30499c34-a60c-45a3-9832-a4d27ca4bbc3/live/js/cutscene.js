/* Kenttien välinen välianimaatio, kaksi vaihetta.
 *
 * 1) Ylös. Taksi jatkaa matkaa alareunan alta yläreunan yli, ja edellisen
 *    kentän tilinpäätös rullaa ruudun poikki. Alareunassa hehkuu sen kentän
 *    väri josta juuri tullaan.
 * 2) Alas. Taksi tulee ylhäältä, jarruttaa ylöspäin osoittavalla suuttimella
 *    ja hakeutuu tasan keskelle, jotta seuraava kenttä voi jatkaa samasta
 *    liikkeestä: siellä taksi tulee sisään katon luukusta. Alareunassa hehkuu
 *    seuraavan kentän väri ja keskellä on sen nimi.
 *
 * Ei seiniä, ei ohjausta, ei törmäyksiä. Peli antaa taksin rungon piirtävän
 * funktion (body), jotta sama muoto piirtyy tässäkin.
 */
export function createCut(cfg) {
  const {
    W, H, TW, TH, rand, body,
    upSecs = 3, downSecs = 2.4,
    fromGlow = '#6fe3ff', toGlow = '#6fe3ff',
    name = '', index = 0, total = 1, stats = [],
  } = cfg;

  const TRAVEL = H + 220;
  const stars = Array.from({ length: 90 }, () => ({
    x: rand(0, W), y: rand(0, H), r: rand(0.6, 2.2), a: rand(0.15, 0.7),
  }));

  let t = 0, x = W / 2, vx = 0, side = 1, sideT = 0, next = 0.35;

  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const up = () => t < upSecs;

  return {
    get done() { return t >= upSecs + downSecs; },

    update(dt) {
      t += dt;
      for (const s of stars) {
        s.y += (12 + s.r * 22) * dt;
        if (s.y > H + 4) { s.y = -4; s.x = rand(0, W); }
      }
      if (up()) {                                   // satunnaisia sivupurskeita
        next -= dt; sideT -= dt;
        if (next <= 0) {
          side = Math.random() < 0.5 ? -1 : 1;
          vx += side * rand(90, 190);
          sideT = 0.18;
          next = rand(0.3, 0.7);
        }
        vx *= Math.pow(0.12, dt);
        x = Math.min(W - 90, Math.max(90, x + vx * dt));
      } else {                                      // laskussa haetaan keskiviiva
        sideT -= dt;
        x += (W / 2 - x) * Math.min(1, dt * 2.6);
      }
    },

    draw(ctx) {
      const col = up() ? fromGlow : toGlow;

      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#080d22');
      bg.addColorStop(1, '#03050c');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // alareunan hehku sen kentän värissä josta tullaan tai jonne mennään
      const glow = ctx.createLinearGradient(0, H * 0.45, 0, H);
      glow.addColorStop(0, rgba(col, 0));
      glow.addColorStop(1, rgba(col, 0.38));
      ctx.fillStyle = glow;
      ctx.fillRect(0, H * 0.45, W, H * 0.55);

      for (const s of stars) {
        ctx.globalAlpha = s.a;
        ctx.fillStyle = '#9fc4ff';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.3); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';

      if (up()) {
        /* Tilinpäätös rullaa ylöspäin: rivit nousevat ja haipuvat päistä. */
        const p = t / upSecs;
        const top = H * 0.78 - p * (H * 0.42);
        stats.forEach((line, i) => {
          const y = top + i * 42;
          const a = Math.max(0, Math.min(1, Math.min((H * 0.85 - y) / 90, (y - H * 0.16) / 90)));
          if (a <= 0) return;
          ctx.globalAlpha = a;
          ctx.fillStyle = i === 0 ? fromGlow : '#e9edff';
          ctx.font = i === 0
            ? '700 26px system-ui, sans-serif'
            : '600 20px system-ui, sans-serif';
          ctx.fillText(line, W / 2, y);
        });
        ctx.globalAlpha = 1;
      } else {
        const u = (t - upSecs) / downSecs;
        const a = Math.max(0, Math.min(1, Math.min(u / 0.25, (1 - u) / 0.3)));
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(233,237,255,.55)';
        ctx.font = '600 14px system-ui, sans-serif';
        ctx.fillText(`KENTTÄ ${index + 1} / ${total}`, W / 2, H * 0.3);
        ctx.fillStyle = toGlow;
        ctx.shadowColor = toGlow;
        ctx.shadowBlur = 24;
        ctx.font = '700 58px system-ui, sans-serif';
        ctx.fillText(name.toUpperCase(), W / 2, H * 0.37);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      const y = up()
        ? H + 80 - TRAVEL * (t / upSecs)
        : -90 + TRAVEL * ((t - upSecs) / downSecs);

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

      const half = TH / 2, wide = TW / 2;
      if (up()) {
        const l = rand(18, 26);
        flame(-14, half, 0, l);
        flame(14, half, 0, l);
        if (sideT > 0) {
          const s = side > 0 ? -1 : 1;
          flame(s * wide, 0, s * Math.PI / 2, rand(16, 24));
        }
      } else {
        flame(0, -half, Math.PI, rand(14, 20));     // jarrutus ylöspäin
      }
      body(ctx);
      ctx.restore();
    },
  };
}
