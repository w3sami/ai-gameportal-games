/* Shooting Stars — kuusimetsä kahdessa tasossa, ja taivaalta sataa tähtiä.
 *
 * Yksi kenttä per tiedosto, jotta kaksi tekijää voi työstää eri kenttiä
 * yhtä aikaa kirjoittamatta toistensa yli. Kentän muoto on kuvattu
 * ../levels.js:ssä.
 *
 * Kentän idea kahdessa lauseessa. Yläkerta on avoin yötaivas, jonne putoaa
 * pyöriviä tähtiä koko kentän leveydeltä; kolme alustaa on rakennettu isojen
 * kuusien kylkeen, ja laskeutunutta taksia suojaa kupoli joka nousee laskun
 * hetkellä ja katoaa heti kun taksi irtoaa alustasta. Alakerta on luola,
 * jonne pääsee molemmista reunoista kuilua pitkin ja jossa on kolme alustaa
 * keskimmäisenä tankkaus — luolaan ei sada, koska kummankin kuilun suulla on
 * kalliohylly kattona.
 *
 *        tähtiä koko leveydeltä
 *     ↓   ↓   ↓   ↓   ↓   ↓   ↓
 *     ▓hylly▓  🌲   🌲    🌲  ▓hylly▓      3 alustaa kuusien kyljessä
 *     ║ kuilu ═══ metsänpohja ═══ kuilu ║  latvusto = katto, kaksi aukkoa
 *     ║            l u o l a            ║  3 alustaa, keskellä tankkaus
 *
 * Kolme sääntöä joilla tämä pysyy rehellisenä:
 *
 *   1. **Tähti on seinä.** Se työnnetään pelin WALLS-taulukkoon ja poistetaan
 *      sieltä kun se sammuu, joten törmäys on pelin omaa eikä kentän. Peli ei
 *      piirrä sitä (`hide`), koska laatikko ei ole tähden näköinen — piirto on
 *      tässä tiedostossa, ja laatikko on tahallaan hieman piirrettyä pienempi.
 *   2. **Katto on umpinainen siellä missä ei saa sataa alas.** Latvustot ja
 *      kaksi kalliohyllyä peittävät yhdessä koko leveyden paitsi kahta
 *      aukkoa, ja niiden alla on metsänpohja. Kuilut ovat hyllyjen alla, eli
 *      yksikään tähti ei pääse luolaan — ei siksi että koodi kieltäisi, vaan
 *      siksi että siellä on katto. Jos puita siirtää, tämä on se mikä pitää
 *      tarkistaa.
 *   3. **Taustan pitää näyttää taustalta.** Luolan tippukivet ja lepakot ovat
 *      matalalla kontrastilla perällä eikä niissä ole törmäystä; kaikki mihin
 *      voi osua on kirkkaampaa ja terävämpää. Ks. README, "Pysyviä sääntöjä".
 */

import { W, H, CEIL } from './shared.js';

/* ------------------------------------------------------------------ mitat

   Luvut ovat tässä lukuina eivätkä laskettuina: kenttää sommitellaan
   siirtämällä yhtä lukua kerrallaan, ja kaava tekee siitä arvuuttelua. */

const ROOF = 420;                  // latvustojen ja hyllyjen alareuna
const GROUND = { y: 520, h: 48 };  // metsänpohja = luolan katto
const TRUNK = 26;                  // rungon paksuus
const TIERS = 7;                   // latvuksen portaat
const W_TOP = 34;                  // latvuksen leveys ylhäällä; alaleveys on puukohtainen
const PAD_W = 110, PAD_H = 18;

/* Kuilut ovat reunoissa, ja metsänpohja on yksi lohkare niiden välissä. */
const SHAFT_L = { x0: 16, x1: 120 };
const SHAFT_R = { x0: 600, x1: 704 };

/* Kuuset. `side` on se puoli jolla alusta on, `padY` sen korkeus, `foot`
   se mihin runko päättyy ja `bot` latvuksen alareuna.

   **Reunimmaiset kuuset kasvavat kalliohyllyillä.** Se ei ole koriste vaan
   koko kentän kulkukelpoisuus: runko joka ulottuu latvuksesta metsänpohjaan
   asti on seinä, joka katkaisee latvuston alaisen käytävän kahtia. Hyllyllä
   kasvavan kuusen alla ei ole käytävää lainkaan — siellä on kuilu ja sen
   katto — joten se ei katkaise mitään. Keskimmäinen kuusi seisoo pohjalla ja
   jakaa käytävän kahteen soppeen, ja **molempiin sopiin pääsee omasta
   aukostaan**: vasempaan 130…320, oikeaan 440…590. Jos puita siirtää, tämä
   on toinen asia joka pitää tarkistaa (ks. tools ja kentän tarkistin). */
const TREES = [
  { cx: 74,  top: 196, id: 1, side: +1, padY: 330, foot: 400, bot: 400, wBot: 110 },
  { cx: 380, top: 200, id: 2, side: +1, padY: 300, foot: 520, bot: ROOF, wBot: 120 },
  { cx: 647, top: 210, id: 3, side: -1, padY: 360, foot: 400, bot: 400, wBot: 110 },
];

/* Alustan paikka seuraa puuta: se lähtee rungon kyljestä ulospäin. */
const padX = t => (t.side < 0 ? t.cx - TRUNK / 2 - PAD_W : t.cx + TRUNK / 2);

/* Lovi latvuksessa: alustan ja sille laskeutuvan taksin tila. Taksi on 54 × 28
   ja teline 14, joten alustan yläpuolelle tarvitaan reilut 50 px vapaata. */
const NOTCH_UP = 58, NOTCH_DOWN = 26;

/* ------------------------------------------------------------------ seinät */

const SOLID = [];
const add = r => { SOLID.push(r); return r; };

const SLAB = add({
  x: SHAFT_L.x1, y: GROUND.y, w: SHAFT_R.x0 - SHAFT_L.x1, h: GROUND.h,
  hide: true, rock: true,
});

/* Kalliohyllyt kuilujen suulla. Nämä ovat kentän tärkein este, vaikka ne eivät
   ole tiellä: ne ovat se katto jonka takia luolaan ei sada. Hylly ulottuu
   kuilun yli molemmin puolin, jotta reunaa hipova tähti osuu hyllyyn. */
const LEDGES = [
  add({ x: SHAFT_L.x0, y: 400, w: SHAFT_L.x1 - SHAFT_L.x0 + 10, h: 20, hide: true, rock: true }),
  add({ x: SHAFT_R.x0 - 10, y: 400, w: SHAFT_R.x1 - SHAFT_R.x0 + 10, h: 20, hide: true, rock: true }),
];

/* Latvus on pino laatikoita, ja se on myös se muoto joka piirretään. Porras on
   tahallaan näkyvä: kuusi jonka siluetti on pehmeämpi kuin sen törmäys olisi
   juuri se epäselvyys jota README kieltää. */
for (const t of TREES) {
  const step = (t.bot - t.top) / TIERS;
  const y0 = t.padY - NOTCH_UP, y1 = t.padY + NOTCH_DOWN;
  t.tiers = [];
  for (let i = 0; i < TIERS; i++) {
    const y = t.top + i * step;
    const w = W_TOP + (t.wBot - W_TOP) * ((i + 1) / TIERS);
    let x = t.cx - w / 2, x2 = t.cx + w / 2;
    if (y + step > y0 && y < y1) {           // alustan kohdalta oksat pois
      if (t.side > 0) x2 = t.cx + TRUNK / 2;
      else x = t.cx - TRUNK / 2;
    }
    t.tiers.push(add({ x, y, w: x2 - x, h: step + 0.5, hide: true, tree: t }));
  }
  t.stem = add({
    x: t.cx - TRUNK / 2, y: t.top + step * 0.8, w: TRUNK,
    h: t.foot - (t.top + step * 0.8), hide: true, stem: true,
  });
  /* Oksa alustan alla. Alusta on muutenkin kiinteä, joten tämä ei sulje
     mitään — se on se mihin alusta on pultattu, ja ilman sitä alusta
     roikkuisi tyhjässä. */
  t.arm = add({ x: padX(t), y: t.padY + PAD_H, w: PAD_W, h: 10, hide: true, arm: true });
}

/* --------------------------------------------------------------- putoavat

   Tähti syntyy ruudun yläpuolelle, putoaa suoraan alas ja sammuu siihen mihin
   osuu. Suoraan alas siksi, että koko kentän suoja perustuu siihen mikä on
   minkäkin yläpuolella: viistoon lentävä tähti kiertäisi katon, ja silloin
   pelaaja ei voisi lukea suojaa katsomalla. */

const STAR = { freq: 1.5, vmin: 260, vmax: 520, size: 1, spin: 1.1 };
const TRAIL = { rate: 44, life: 0.4, size: 3.4, spread: 10 };

/* Taksi on 54 px leveä: suurin tähti on sen kokoinen, pienin puolet siitä. */
const R_BIG = 27, R_SMALL = 13.5;
const BOX = 0.62;                  // törmäyslaatikko tähden piirrosta

const S = {
  stars: [], bits: [], spawn: 0, seeded: false, walls: null,
  domes: TREES.map(t => ({ id: t.id, a: 0 })),
};

let seed = 20260922;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const between = (a, b) => a + rnd() * (b - a);

function starMake(y) {
  const r = between(R_SMALL, R_BIG) * STAR.size;
  const s = {
    cx: between(24, W - 24), cy: y,
    v: between(STAR.vmin, STAR.vmax), r,
    rot: between(0, 6.3), spin: between(-STAR.spin, STAR.spin) * 6.3,
    puff: 0, hue: between(0, 1),
    box: { x: 0, y: 0, w: r * 2 * BOX, h: r * 2 * BOX, hide: true, star: true },
  };
  boxTo(s);
  S.stars.push(s);
  return s;
}

function boxTo(s) {
  s.box.x = s.cx - s.box.w / 2;
  s.box.y = s.cy - s.box.h / 2;
}

const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* Tähti sammuu siihen mihin osuu: katto, metsänpohja, alusta tai kupoli.
   Sammuminen on kipinäpöly — sama kaava kuin vana, mutta nopeampi ja
   joka suuntaan. */
function burst(s, n) {
  for (let i = 0; i < n; i++) {
    const a = between(0, 6.3), sp = between(40, 260);
    S.bits.push({
      x: s.cx, y: s.cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      life: between(0.18, 0.5), max: 0.5, r: between(1.4, 3.2), hue: s.hue,
    });
  }
}

function drop(s) {
  const i = S.stars.indexOf(s);
  if (i >= 0) S.stars.splice(i, 1);
  if (S.walls) {
    const j = S.walls.indexOf(s.box);
    if (j >= 0) S.walls.splice(j, 1);
  }
}

/* Kupoli syttyy laskun hetkellä ja sammuu heti kun taksi on irti. Se on tämän
   kentän ainoa suoja: alustalla saa seistä rauhassa, muualla ei. */
const domeOf = id => S.domes.find(d => d.id === id);
const domeR = (pad, d) => pad.w * 0.62 * d.a;

function update(dt, api) {
  S.walls = api.walls;

  if (!S.seeded) {                           // taivas ei ala tyhjänä
    S.seeded = true;
    for (let i = 0; i < 4; i++) starMake(between(-60, ROOF));
  }

  for (const d of S.domes) {
    const pad = api.pads.find(p => p.id === d.id);
    const on = pad && api.taxi.landed === pad;
    d.a += ((on ? 1 : 0) - d.a) * Math.min(1, dt * 9);
    if (d.a < 0.002) d.a = 0;
  }

  S.spawn -= dt;
  while (S.spawn <= 0) {
    S.spawn += 1 / Math.max(0.05, STAR.freq);
    starMake(-60);
  }

  for (const s of S.stars.slice()) {
    s.cy += s.v * dt;
    s.rot += s.spin * dt;
    boxTo(s);

    s.puff -= dt;
    while (s.puff <= 0) {
      s.puff += 1 / Math.max(1, TRAIL.rate);
      S.bits.push({
        x: s.cx + between(-TRAIL.spread, TRAIL.spread) * 0.4,
        y: s.cy - s.r * 0.4,
        vx: between(-TRAIL.spread, TRAIL.spread), vy: between(-90, -20),
        life: TRAIL.life * between(0.6, 1.1), max: TRAIL.life,
        r: TRAIL.size * between(0.6, 1.2), hue: s.hue,
      });
    }

    if (s.cy - s.r > H) { drop(s); continue; }

    let done = false;
    for (const d of S.domes) {                // kupoli ensin: se on suoja
      if (d.a < 0.25) continue;
      const pad = api.pads.find(p => p.id === d.id);
      if (!pad) continue;
      const r = domeR(pad, d), cx = pad.x + pad.w / 2, cy = pad.y;
      if (s.cy > cy) continue;
      const dx = s.cx - cx, dy = s.cy - cy;
      if (dx * dx + dy * dy < (r + s.r * 0.5) * (r + s.r * 0.5)) {
        burst(s, 14); drop(s); done = true; break;
      }
    }
    if (done) continue;

    for (const r of SOLID) {
      if (!hit(s.box, r)) continue;
      burst(s, 10); drop(s); done = true; break;
    }
    if (done) continue;

    for (const p of api.pads) {
      if (!hit(s.box, p)) continue;
      burst(s, 10); drop(s); done = true; break;
    }
    if (done) continue;

    if (S.walls.indexOf(s.box) < 0) S.walls.push(s.box);
  }

  for (let i = S.bits.length - 1; i >= 0; i--) {
    const b = S.bits[i];
    b.life -= dt;
    if (b.life <= 0) { S.bits.splice(i, 1); continue; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.vy += 120 * dt; b.vx *= 1 - Math.min(1, dt * 2.2);
  }
}

/* Kentän lataus alkaa puhtaalta pöydältä: vanhat tähdet olisivat myös vanhoja
   seiniä, ja peli rakentaa WALLSin uudestaan joka latauksessa. */
function init(api) {
  if (api.walls) {
    for (let i = api.walls.length - 1; i >= 0; i--) if (api.walls[i].star) api.walls.splice(i, 1);
  }
  S.stars.length = 0;
  S.bits.length = 0;
  S.spawn = 0;
  S.seeded = false;
  S.walls = api.walls;
  for (const d of S.domes) d.a = 0;
}

/* ------------------------------------------------------------------ piirto */

const fade = (c, a) => c + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

/* Kallio on samaa ainetta kuin pelin omat kehäseinät, jottei kentän oma
   piirto erotu niistä saumana. */
function rock(ctx, r) {
  ctx.fillStyle = '#1b2440';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(120,160,255,.22)';
  ctx.fillRect(r.x, r.y, r.w, 2);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(r.x, r.y + r.h - 2, r.w, 2);

  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,.035)';
  for (let x = r.x + 12; x < r.x + r.w; x += 46) {
    const h = 5 + ((x * 13) % 9);
    ctx.fillRect(x, r.y + 4 + ((x * 7) % 11), 26, h);
  }
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  for (let x = r.x + 28; x < r.x + r.w; x += 62) {
    ctx.fillRect(x, r.y + r.h * 0.45, 34, 6);
  }
  ctx.restore();
}

/* Sammal hyllyn ja pohjan päällä: metsä jatkuu kallion päällä, ja se erottaa
   tämän kentän kiven Moonshotin kivestä. */
function moss(ctx, r) {
  ctx.fillStyle = 'rgba(58,110,74,.55)';
  ctx.fillRect(r.x, r.y, r.w, 3);
  ctx.fillStyle = 'rgba(78,140,92,.35)';
  for (let x = r.x + 3; x < r.x + r.w - 3; x += 9) {
    const h = 3 + ((x * 17) % 5);
    ctx.fillRect(x, r.y - h, 3, h);
  }
}

/* Kuusi: rungon päällä pino portaita, ja jokainen porras on täsmälleen se
   laatikko joka on myös törmäys. Neulaset piirretään laatikon sisään. */
function spruce(ctx, t) {
  ctx.fillStyle = '#2b2119';
  ctx.fillRect(t.stem.x, t.stem.y, t.stem.w, t.stem.h);
  ctx.fillStyle = 'rgba(150,190,255,.10)';
  ctx.fillRect(t.stem.x, t.stem.y, 3, t.stem.h);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(t.stem.x + t.stem.w - 4, t.stem.y, 4, t.stem.h);

  for (let i = t.tiers.length - 1; i >= 0; i--) {
    const r = t.tiers[i];
    const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
    g.addColorStop(0, '#1d4029');
    g.addColorStop(1, '#10271a');
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    ctx.fillStyle = 'rgba(150,200,255,.11)';   // kuunvalo ylhäältä vasemmalta
    ctx.fillRect(r.x, r.y, r.w, 2);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(r.x, r.y + r.h - 3, r.w, 3);

    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.strokeStyle = 'rgba(122,178,132,.16)';
    ctx.lineWidth = 1;
    for (let x = r.x + 4; x < r.x + r.w; x += 7) {
      ctx.beginPath();
      ctx.moveTo(x, r.y + 3);
      ctx.lineTo(x - 3, r.y + r.h - 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* Alustan lovi näkyy: katkaistut oksantyngät rungossa. */
  const s = t.side;
  ctx.fillStyle = 'rgba(43,33,25,.9)';
  for (let y = t.padY - NOTCH_UP + 8; y < t.padY + 14; y += 16) {
    ctx.fillRect(t.cx + (s > 0 ? TRUNK / 2 : -TRUNK / 2 - 9), y, 9, 3);
  }
}

/* Kaukametsä kuilujen ja runkojen takana. Tämä on taustaa: matala kontrasti,
   ei reunaviivaa eikä törmäystä. */
const FAR = [];
for (let x = -20; x < W + 40; x += 34) {
  FAR.push({ x, h: 60 + ((x * 29) % 46), w: 30 + ((x * 11) % 14) });
}
function farForest(ctx) {
  ctx.fillStyle = '#12202a';
  for (const f of FAR) {
    ctx.beginPath();
    ctx.moveTo(f.x, GROUND.y);
    ctx.lineTo(f.x + f.w / 2, GROUND.y - f.h);
    ctx.lineTo(f.x + f.w, GROUND.y);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(20,38,58,.45)';        // usva kaukametsän päälle
  ctx.fillRect(0, GROUND.y - 70, W, 70);
}

/* ------------------------------------------------------------------- luola */

const DRIP = [];
for (let i = 0; i < 26; i++) {
  const up = i % 2 === 0;
  DRIP.push({
    x: 26 + ((i * 97) % (W - 60)),
    h: 34 + ((i * 53) % 96),
    w: 12 + ((i * 31) % 16),
    up,
  });
}
const BATS = [];
for (let i = 0; i < 6; i++) {
  BATS.push({
    x0: 90 + ((i * 137) % (W - 220)), y0: 660 + ((i * 71) % 260),
    rx: 60 + ((i * 41) % 90), ry: 22 + ((i * 17) % 34),
    secs: 6 + ((i * 13) % 9), phase: (i * 0.37) % 1, s: 0.7 + ((i * 7) % 5) / 10,
  });
}

let clock = 0;                                 // koristeiden oma kello
let clockLast = 0;
function tick() {
  const now = performance.now() / 1000;
  if (clockLast) clock += Math.min(0.1, now - clockLast);
  clockLast = now;
  return clock;
}

function cave(ctx) {
  const top = GROUND.y + GROUND.h, bot = H - 16;
  const g = ctx.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, '#0c1322');
  g.addColorStop(0.6, '#0a101c');
  g.addColorStop(1, '#070b14');
  ctx.fillStyle = g;
  ctx.fillRect(0, top, W, bot - top);

  /* Tippukivet ovat perällä: yksi vaimea sävy, ei reunaa, ei kiiltoa. Jos
     nämä alkavat näyttää esteiltä, ne ovat liian kirkkaita — ei niin että
     niihin pitäisi lisätä törmäys. */
  ctx.fillStyle = 'rgba(96,126,168,.10)';
  for (const d of DRIP) {
    ctx.beginPath();
    if (d.up) {
      ctx.moveTo(d.x, top); ctx.lineTo(d.x + d.w / 2, top + d.h); ctx.lineTo(d.x + d.w, top);
    } else {
      ctx.moveTo(d.x, bot); ctx.lineTo(d.x + d.w / 2, bot - d.h); ctx.lineTo(d.x + d.w, bot);
    }
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(10,16,28,.35)';        // pölyusva perän päälle
  ctx.fillRect(0, top, W, bot - top);

  const t = tick();
  for (const b of BATS) {
    const a = ((t / b.secs) + b.phase) * Math.PI * 2;
    const x = b.x0 + Math.cos(a) * b.rx, y = b.y0 + Math.sin(a * 2) * b.ry;
    const flap = Math.sin(t * 9 + b.phase * 6) * 0.5 + 0.5;
    bat(ctx, x, y, b.s, flap, Math.cos(a) < 0 ? -1 : 1);
  }
}

function bat(ctx, x, y, s, flap, dir) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * s, s);
  ctx.fillStyle = 'rgba(10,14,24,.75)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-9, -6 - flap * 7, -18, -1 + flap * 3);
  ctx.quadraticCurveTo(-10, 2, 0, 4);
  ctx.quadraticCurveTo(10, 2, 18, -1 + flap * 3);
  ctx.quadraticCurveTo(9, -6 - flap * 7, 0, 0);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* --------------------------------------------------------- tähdet ja kupoli */

function starShape(ctx, s) {
  ctx.save();
  ctx.translate(s.cx, s.cy);
  ctx.rotate(s.rot);

  const warm = s.hue < 0.5 ? '#ffe6a8' : '#ffd0e0';
  ctx.shadowColor = warm;
  ctx.shadowBlur = s.r * 1.4;

  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? s.r : s.r * 0.42;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = warm;
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath(); ctx.arc(0, 0, s.r * 0.3, 0, 6.3); ctx.fill();
  ctx.restore();
}

function bits(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of S.bits) {
    const a = Math.max(0, b.life / b.max);
    ctx.fillStyle = fade(b.hue < 0.5 ? '#ffb765' : '#ff87b0', a * 0.75);
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.4 + a * 0.6), 0, 6.3); ctx.fill();
  }
  ctx.restore();
}

function dome(ctx, pad, d) {
  const r = domeR(pad, d);
  if (r < 4) return;
  const cx = pad.x + pad.w / 2, cy = pad.y;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.closePath();

  const g = ctx.createLinearGradient(cx - r * 0.6, cy - r, cx + r * 0.7, cy);
  g.addColorStop(0, fade('#9ad8ff', 0.20 * d.a));
  g.addColorStop(0.5, fade('#6fe3ff', 0.09 * d.a));
  g.addColorStop(1, fade('#274a6a', 0.22 * d.a));
  ctx.fillStyle = g;
  ctx.fill();

  ctx.strokeStyle = fade('#9ad8ff', 0.55 * d.a);
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = fade('#d8f2ff', 0.5 * d.a);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r - 5, Math.PI * 1.08, Math.PI * 1.34); ctx.stroke();
  ctx.restore();
}

function back(ctx) {
  farForest(ctx);
  cave(ctx);
  for (const t of TREES) spruce(ctx, t);
  rock(ctx, SLAB);
  moss(ctx, SLAB);
  for (const l of LEDGES) { rock(ctx, l); moss(ctx, l); }
  for (const t of TREES) {                     // oksa alustan alla
    ctx.fillStyle = '#2b2119';
    ctx.fillRect(t.arm.x, t.arm.y, t.arm.w, t.arm.h);
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.fillRect(t.arm.x, t.arm.y + t.arm.h - 2, t.arm.w, 2);
  }
}

function front(ctx, api) {
  for (const d of S.domes) {
    const pad = api.pads.find(p => p.id === d.id);
    if (pad && d.a > 0.01) dome(ctx, pad, d);
  }
  bits(ctx);
  for (const s of S.stars) starShape(ctx, s);
}

/* ------------------------------------------------------------------ kenttä */

export const shootingstars = {
  name: 'Shooting Stars',
  glow: '#ffe6a8',
  sky: ['#060a18', '#0d1630', '#16233f', '#1b2b33'],
  sun: { x: 636, y: 104, r: 34, color: '#cfe0ff' },   // kuu
  /* Luukku on siirretty vasemmalle: keskimmäisen kuusen latva olisi muuten
     ollut suoraan sisääntulon alla. Kenttä saa oman gaten, peli lukee sen. */
  gate: { x: 150, w: 120 },
  start: 2,
  firstFrom: 1,
  walls: SOLID,
  pads: [
    ...TREES.map(t => ({ id: t.id, x: padX(t), y: t.padY, w: PAD_W, h: PAD_H })),
    { id: 4, x: 70, y: 890, w: 130 },
    { id: 0, x: 295, y: 980, w: 130, fuel: true },
    { id: 5, x: 500, y: 890, w: 130 },
  ],
  /* Kuiluista pääsee luolaan lentämättä katon läpi: kerrotaan työkaluille,
     että luola on tavoitettava paikka myös vuototäytön mielessä. */
  seeds: [{ x: 68, y: 700 }, { x: 652, y: 700 }],
  tune: [
    {
      name: 'tähdet', obj: STAR,
      sliders: [
        { key: 'freq', label: 'tähteä sekunnissa', min: 0.2, max: 6, step: 0.1 },
        { key: 'vmin', label: 'nopeus min', min: 80, max: 900, step: 10 },
        { key: 'vmax', label: 'nopeus max', min: 120, max: 1400, step: 10 },
        { key: 'size', label: 'koko', min: 0.5, max: 1.6, step: 0.05 },
        { key: 'spin', label: 'pyöritys kierr/s', min: 0, max: 3, step: 0.1 },
      ],
    },
    {
      name: 'vana', obj: TRAIL, open: false,
      sliders: [
        { key: 'rate', label: 'hiukkasta/s', min: 6, max: 140, step: 2 },
        { key: 'life', label: 'kesto s', min: 0.08, max: 1.2, step: 0.02 },
        { key: 'size', label: 'koko', min: 1, max: 8, step: 0.2 },
        { key: 'spread', label: 'leviämä', min: 0, max: 60, step: 1 },
      ],
    },
    { name: 'kentän kertoimet', open: false, mul: ['grav', 'thrust', 'landVX'] },
  ],
  init,
  update,
  drawBack: back,
  drawFront: front,
};
