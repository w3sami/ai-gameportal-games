/* Kenttien välinen välianimaatio, kaksi vaihetta.
 *
 * 1) Ylös. Taksi jatkaa matkaa alareunan alta yläreunan yli, ja edellisen
 *    kentän tilinpäätös seisoo paikallaan ruudun keskellä isolla tekstillä.
 *    Alareunassa hehkuu sen kentän väri josta juuri tullaan.
 * 2) Alas. Taksi tulee ylhäältä, jarruttaa ylöspäin osoittavalla suuttimella
 *    ja hakeutuu tasan keskelle, jotta seuraava kenttä voi jatkaa samasta
 *    liikkeestä: siellä taksi tulee sisään katon luukusta.
 *
 * stats on rivilista: { text, icon?: 'wreck' | 'grave', good?, head? }.
 * good-rivi on puhdas suoritus ja piirretään vihreänä hehkuen.
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
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

  /** Rivin kuvake: hajonnut taksi tai hautakivi. */
  function icon(ctx, kind, x, y, col) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = col;
    if (kind === 'wreck') {
      ctx.beginPath(); ctx.roundRect(-12, -8, 24, 14, 5); ctx.fill();
      ctx.strokeStyle = '#0b1020'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-3, -8); ctx.lineTo(2, -2); ctx.lineTo(-3, 1); ctx.lineTo(2, 6);
      ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-7, 6); ctx.lineTo(-10, 12);
      ctx.moveTo(7, 6); ctx.lineTo(10, 12);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(-9, 9); ctx.lineTo(-9, -2);
      ctx.arc(0, -2, 9, Math.PI, 0);
      ctx.lineTo(9, 9);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#0b1020'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(0, 3);
      ctx.moveTo(-4.5, -4.5); ctx.lineTo(4.5, -4.5);
      ctx.stroke();
    }
    ctx.restore();
  }

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
        /* Tilinpäätös seisoo paikallaan ja haipuu päistä. */
        ctx.globalAlpha = clamp01(Math.min(t / 0.4, (upSecs - t) / 0.4));
        let y = H * 0.50;
        for (const s of stats) {
          const c = s.head ? fromGlow : (s.good ? '#7bf0a0' : '#e9edff');
          ctx.font = s.head
            ? '700 34px system-ui, sans-serif'
            : '600 28px system-ui, sans-serif';
          ctx.fillStyle = c;
          if (s.good) { ctx.shadowColor = c; ctx.shadowBlur = 16; }
          const shift = s.icon ? 15 : 0;
          ctx.fillText(s.text, W / 2 + shift, y);
          ctx.shadowBlur = 0;
          if (s.icon) {
            const w = ctx.measureText(s.text).width;
            icon(ctx, s.icon, W / 2 + shift - w / 2 - 24, y - 9, c);
          }
          y += s.head ? 58 : 46;
        }
        ctx.globalAlpha = 1;
      } else {
        const u = (t - upSecs) / downSecs;
        ctx.globalAlpha = clamp01(Math.min(u / 0.25, (1 - u) / 0.3));
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
