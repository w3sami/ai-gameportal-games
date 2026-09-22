/* Shooting Stars — kuusimetsä, tähtitaivas ja luola sen alla.
 *
 * Yksi kenttä per tiedosto, jotta kaksi tekijää voi työstää eri kenttiä
 * yhtä aikaa kirjoittamatta toistensa yli. Kentän muoto on kuvattu
 * ../levels.js:ssä.
 *
 * Kenttä on kolme neljännestä ja kaikki kolme tekevät eri asian:
 *
 *   ylin neljännes   tähtitaivas. Se on melkein täynnä tähtiä, ja **putoava
 *                    tähti on yksi juuri niistä**: se rupeaa pyörimään
 *                    paikallaan, lähtee alas, ja tuhouduttuaan palaa takaisin
 *                    omalle paikalleen taivaalle. Pyörähdys ennen lähtöä on
 *                    kentän varoitus, ja taivaalle jäävä aukko kertoo mistä
 *                    tähti lähti.
 *   keskiosa         yksi iso kuusi keskellä ja nurmikko sen juurella. Kaksi
 *                    alustaa on nurmikolla kuusen molemmin puolin, avoimen
 *                    taivaan alla — sinne sataa. Laskeutunutta suojaa kupoli
 *                    joka nousee laskun hetkellä ja katoaa kun taksi irtoaa.
 *   alin neljännes   luola. Sinne ei sada, koska kuilujen suulla on
 *                    kalliohuuli kattona, mutta katto on matalla ja
 *                    tippukivet riippuvat siitä: hengähdyspaikka, ei lepo.
 *
 * Kolme sääntöä joilla tämä pysyy rehellisenä:
 *
 *   1. **Putoava tähti on seinä.** Se työnnetään pelin WALLS-taulukkoon ja
 *      poistetaan sieltä kun se sammuu, joten törmäys on pelin omaa eikä
 *      kentän. Peli ei piirrä sitä (`hide`), koska laatikko ei ole tähden
 *      näköinen — piirto on tässä tiedostossa, ja laatikko on tahallaan
 *      hieman piirrettyä pienempi. **Taivaalla lepäävä tähti ei ole seinä**:
 *      se on kulissi kunnes se lähtee liikkeelle, ja sen erottaa liikkeestä,
 *      kirkkaudesta ja vanasta.
 *   2. **Katto on umpinainen siellä missä ei saa sataa alas.** Nurmikko ja
 *      kaksi kalliohuulta peittävät yhdessä koko leveyden, ja kuilut ovat
 *      huulten alla. Yksikään tähti ei siis pääse luolaan — ei siksi että
 *      koodi kieltäisi, vaan siksi että siellä on katto. Jos näitä siirtää,
 *      tämä on se mikä pitää tarkistaa.
 *   3. **Taustan pitää näyttää taustalta.** Luolan tippukivistä isot ovat
 *      samaa kiveä kuin katto ja niissä on törmäys; taustan tippukivet ovat
 *      selvästi himmeämpiä eikä niissä ole. Sama koskee lepakoita.
 *      Ks. README, "Pysyviä sääntöjä".
 */

import { W, H, CEIL } from './shared.js';

/* ------------------------------------------------------------------ mitat

   Luvut ovat tässä lukuina eivätkä laskettuina: kenttää sommitellaan
   siirtämällä yhtä lukua kerrallaan, ja kaava tekee siitä arvuuttelua. */

const SKY_LOW = 260;               // tähtitaivaan alaraja
const GRASS = { x: 110, y: 780, w: 500, h: 40 };
const SHAFT_L = { x0: 16, x1: 110 };
const SHAFT_R = { x0: 610, x1: 704 };
const CAVE_TOP = GRASS.y + GRASS.h;
const CAVE_BOT = H - 16;

/* Kuusi keskellä: latvus 300…700, runko siitä nurmikkoon.

   Kuusi on kahdeksan oksakerrosta, ja **jokainen oksakerros nuokkuu ulospäin
   alas ja nousee kärjestä takaisin ylös** — ne viikset. Kerrosten väliin jää
   runkoa näkyviin, mikä on koko koristeellisuus: yhtenäinen kartio näyttää
   pensaalta, erilliset kerrokset kuuselta. Sami 22.9.2026. */
const TREE = { cx: 360, top: 300, bot: 700, foot: GRASS.y, wTop: 40, wBot: 108 };
const TIERS = 8;
const TRUNK = 30;

/* Oksan muoto yhtenä käyränä, yksikkönä kerroksen korkeus. `mid` on oksan
   keskilinja etäisyydellä u (0 = runko, 1 = kärki), `th` sen paksuus. Sama
   käyrä sekä piirtoon että törmäykseen: portaat ladotaan käyrän sisään, eli
   **törmäys on aina hitusen piirrettyä pienempi** — oksan uloin neulanen ei
   tapa, ja se on tarkoituksellisesti anteeksiantava suunta. */
const BR = { drop: 0.20, curve: 1.5, reach: 0.62, flickAt: 0.80, flick: 0.26, th0: 0.34, th1: 0.15 };
const brMid = u => BR.drop + BR.reach * Math.pow(u, BR.curve)
  - (u > BR.flickAt ? BR.flick * Math.pow((u - BR.flickAt) / (1 - BR.flickAt), 2) : 0);
const brTh = u => BR.th0 + (BR.th1 - BR.th0) * u;
const brTop = u => brMid(u) - brTh(u) / 2;
const brBot = u => brMid(u) + brTh(u) / 2;
const BR_STEPS = 7;

const PAD_H = 18;

/* ------------------------------------------------------------------ seinät */

const SOLID = [];
const add = r => { SOLID.push(Object.assign({ hide: true }, r)); return r; };

const TURF = add({ x: GRASS.x, y: GRASS.y, w: GRASS.w, h: GRASS.h, rock: true, turf: true });

/* Kuilujen suulla oli 22.9. kalliohuulet kattona, jottei luolaan sada.
   Sami poisti ne samana päivänä: **ne vaikeuttivat luolaan pääsyä liikaa**,
   eikä luolan tarvitse olla tähdiltä umpisuojassa. Kuiluun eksyvä tähti on
   nyt osa kenttää, ei vika. */

/* Latvus on pino laatikoita, ja se on myös se muoto joka piirretään. Porras on
   tahallaan näkyvä: kuusi jonka siluetti on pehmeämpi kuin sen törmäys olisi
   juuri se epäselvyys jota README kieltää. */
TREE.layers = [];
{
  const step = (TREE.bot - TREE.top) / TIERS;
  for (let i = 0; i < TIERS; i++) {
    const y0 = TREE.top + i * step;
    const hw = (TREE.wTop + (TREE.wBot - TREE.wTop) * ((i + 1) / TIERS));
    const layer = { y0, h: step, hw, parts: [] };
    for (const sgn of [-1, 1]) {
      for (let k = 0; k < BR_STEPS; k++) {
        const u0 = k / BR_STEPS, u1 = (k + 1) / BR_STEPS;
        const top = Math.max(brTop(u0), brTop(u1)) * step + y0 + 1;
        const bot = Math.min(brBot(u0), brBot(u1)) * step + y0 - 1;
        if (bot - top < 4) continue;            // porras jäisi käyrän ulkopuolelle
        const xa = TREE.cx + sgn * u0 * hw, xb = TREE.cx + sgn * u1 * hw;
        layer.parts.push(add({
          x: Math.min(xa, xb), y: top, w: Math.abs(xb - xa), h: bot - top, tree: true,
        }));
      }
    }
    TREE.layers.push(layer);
  }
  /* Latva: pieni piikki ylimmän kerroksen yllä, ja sillä on oma laatikkonsa —
     näkyvä kärki jonka läpi lentäisi olisi juuri se epäselvyys jota README
     kieltää. */
  TREE.tip = add({ x: TREE.cx - 9, y: TREE.top - 30, w: 18, h: 34, tree: true });
  TREE.stem = add({
    x: TREE.cx - TRUNK / 2, y: TREE.top, w: TRUNK, h: TREE.foot - TREE.top, stem: true,
  });
}

/* Luolan tippukivet. Isot ovat samaa kiveä kuin katto ja niissä on törmäys:
   ne tekevät luolasta ahtaan. Porrastus on sama ratkaisu kuin kuusessa —
   piirto on täsmälleen se laatikko joka on myös törmäys. */
const SPIKES = [];
function spike(cx, len, top) {
  const steps = 4, out = [];
  for (let i = 0; i < steps; i++) {
    const w = top * (1 - i / steps) + 14 * (i / steps);
    out.push(add({
      x: cx - w / 2, y: CAVE_TOP + (len / steps) * i, w, h: len / steps + 0.5, spike: true,
    }));
  }
  SPIKES.push({ cx, len, top, parts: out });
}
spike(232, 86, 96);
spike(488, 86, 96);
spike(360, 52, 70);

/* ------------------------------------------------------------------ alustat

   Nurmikon alustat ovat pinnan tasossa: alapuoli saa olla kiinni maassa,
   merkitystä on vain laskupinnalla. Luolan alustat ovat kaikki samassa
   tasossa, koska luola on hengähdyspaikka eikä sommitelma. */
const PADS = [
  { id: 1, x: 130, y: GRASS.y - PAD_H + 6, w: 130 },
  { id: 2, x: 460, y: GRASS.y - PAD_H + 6, w: 130 },
  { id: 3, x: 56, y: 986, w: 124 },
  { id: 0, x: 298, y: 986, w: 124, fuel: true },
  { id: 4, x: 540, y: 986, w: 124 },
];
const GRASS_PADS = [1, 2];

/* --------------------------------------------------------------- tähtitaivas

   Taivas on melkein täynnä tähtiä, ja putoava tähti on yksi niistä. Tähdellä
   on koti (hx, hy) johon se palaa tuhouduttuaan: aukko taivaalla on osa
   kentän luettavuutta, ja täyttyvä aukko kertoo että vaara on ohi.

   Tähti putoaa suoraan alas. Se on koko suojan ehto: kaikki mitä kentässä
   suojaa, suojaa siksi että se on jonkin yläpuolella. Viistoon lentävä tähti
   kiertäisi katon, eikä pelaaja voisi lukea suojaa katsomalla. */

const SKY = {
  count: 24, freq: 1.4, warn: 3, grace: 7, tilt: 20,
  vmin: 260, vmax: 520, size: 1, spin: 1.2,
};
const TRAIL = { rate: 44, life: 0.4, size: 3.4, spread: 10 };

/* Tähden nopeus on verrannollinen painovoimaan. Sami 22.9.2026: helpolla
   vaikeustasolla taksi liikkuu hitaammin, ja silloin samalla vauhdilla putoava
   tähti on suhteessa nopeampi — helppo taso vaikeutti peliä. 250 on pelin oma
   painovoiman oletus (DEFAULTS.grav), ja kerroin luetaan elävästä P:stä, joten
   sekä vaikeustaso että kentän oma kerroin menevät perille itsestään. */
const GRAV_REF = 250;

/* Taksi on 54 px leveä: suurin tähti on sen kokoinen, pienin puolet siitä. */
const R_BIG = 27, R_SMALL = 13.5;
const BOX = 0.62;                  // törmäyslaatikko tähden piirrosta

let seed = 20260922;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const between = (a, b) => a + rnd() * (b - a);

const S = {
  stars: [], bits: [], spawn: 0, walls: null, count: 0, gscale: 1, wasDead: false,
  domes: GRASS_PADS.map(id => ({ id, a: 0 })),
};

function field() {
  if (S.walls) {                                // vanha putoava tähti on myös seinä
    for (const s of S.stars) {
      const i = S.walls.indexOf(s.box);
      if (i >= 0) S.walls.splice(i, 1);
    }
  }
  S.stars.length = 0;
  S.count = SKY.count;
  const cols = Math.ceil(Math.sqrt(SKY.count * (W / SKY_LOW)));
  const rows = Math.ceil(SKY.count / cols);
  let n = 0;
  for (let r = 0; r < rows && n < SKY.count; r++) {
    for (let c = 0; c < cols && n < SKY.count; c++, n++) {
      const hx = 34 + (W - 68) * ((c + 0.5) / cols) + between(-16, 16);
      const hy = 44 + (SKY_LOW - 76) * ((r + 0.5) / rows) + between(-12, 12);
      const rr = between(R_SMALL, R_BIG) * SKY.size;
      S.stars.push({
        hx, hy, cx: hx, cy: hy, r: rr,
        rot: between(0, 6.3), spin: 0, dir: rnd() < 0.5 ? -1 : 1,
        v: 0, vx: 0, vy: 0, state: 'sky', t: 0, puff: 0,
        tw: between(0, 6.3), hue: between(0, 1),
        box: { x: 0, y: 0, w: rr * 2 * BOX, h: rr * 2 * BOX, hide: true, star: true },
      });
    }
  }
}
field();

const boxTo = s => {
  s.box.x = s.cx - s.box.w / 2;
  s.box.y = s.cy - s.box.h / 2;
};

const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* Sammuminen on kipinäpöly — sama kaava kuin vana, mutta nopeampi ja joka
   suuntaan. Sen jälkeen tähti on matkalla kotiin. */
function burst(s, n) {
  for (let i = 0; i < n; i++) {
    const a = between(0, 6.3), sp = between(40, 260);
    S.bits.push({
      x: s.cx, y: s.cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      life: between(0.18, 0.5), max: 0.5, r: between(1.4, 3.2), hue: s.hue,
    });
  }
}

function home(s) {
  if (S.walls) {
    const i = S.walls.indexOf(s.box);
    if (i >= 0) S.walls.splice(i, 1);
  }
  s.state = 'back'; s.t = 0;
  s.cx = s.hx; s.cy = s.hy; s.v = 0; s.vx = 0; s.vy = 0; s.spin = 0;
}

const launchable = () => S.stars.filter(s => s.state === 'sky');

function launch() {
  const pool = launchable();
  if (!pool.length) return;
  const s = pool[Math.floor(rnd() * pool.length)];
  s.state = 'wind'; s.t = 0;
  s.v = between(SKY.vmin, SKY.vmax) * S.gscale;
  /* Kulma arvotaan lähtöhetkellä ja se pysyy: tähti on suora viiva, ei kaari.
     Pystysuora oli ensimmäinen versio, ja Sami halusi siihen ±20°. */
  const a = between(-SKY.tilt, SKY.tilt) * Math.PI / 180;
  s.vx = Math.sin(a) * s.v;
  s.vy = Math.cos(a) * s.v;
}

/* Kupoli syttyy laskun hetkellä ja sammuu heti kun taksi on irti. Se on
   nurmikon ainoa suoja: alustalla saa seistä rauhassa, muualla ei. */
const domeR = (pad, d) => pad.w * 0.62 * d.a;

/* Tähti rauhoittuu eikä nykäise: jarrutus paikallaan, sitten häivytys ja
   paluu kotiin. Sitä käytetään kun taksi kuolee — silloin koko taivas
   hiljenee, ja uusi 7 s alkaa vasta kun taksi on taas ehjä. */
function calm(s) {
  if (s.state !== 'wind' && s.state !== 'fall') return;
  if (S.walls) {
    const i = S.walls.indexOf(s.box);
    if (i >= 0) S.walls.splice(i, 1);           // jarruttava tähti ei enää tapa
  }
  s.state = 'calm'; s.t = 0;
}

function update(dt, api) {
  S.walls = api.walls;
  if (api.P && isFinite(api.P.grav)) S.gscale = api.P.grav / GRAV_REF;

  /* Kuoleman hetkellä taivas hiljenee, ja tauko alkaa vasta kun taksi on taas
     ehjä: muuten seitsemästä sekunnista olisi kulunut kolme kuolinanimaatioon
     ennen kuin pelaaja on edes alustalla. */
  if (api.dead && !S.wasDead) for (const s of S.stars) calm(s);
  if (!api.dead && S.wasDead) S.spawn = SKY.grace;
  S.wasDead = !!api.dead;
  /* Kentän alussa tähdet ovat hiljaa, jotta luukusta ehtii pois tähdistön
     seasta. Sisääntulon aikana tätä koukkua ei ajeta lainkaan, joten tauko
     alkaa vasta GO:sta — se on juuri se hetki josta se lasketaan. */
  if (S.count !== SKY.count) field();           // säädin muutti tähtien määrää

  for (const d of S.domes) {
    const pad = api.pads.find(p => p.id === d.id);
    const on = pad && api.taxi.landed === pad && !api.dead;
    d.a += ((on ? 1 : 0) - d.a) * Math.min(1, dt * 9);
    if (d.a < 0.002) d.a = 0;
  }

  if (!api.dead) {
    S.spawn -= dt;
    while (S.spawn <= 0) {
      S.spawn += 1 / Math.max(0.05, SKY.freq);
      launch();
    }
  }

  for (const s of S.stars) {
    s.tw += dt * 1.7;

    if (s.state === 'sky') continue;

    if (s.state === 'back') {
      s.t += dt;
      s.rot += s.dir * dt * 0.6;
      if (s.t > 0.7) { s.state = 'sky'; s.t = 0; }
      continue;
    }

    if (s.state === 'calm') {                   // jarruttaa siihen mihin jäi
      s.t += dt;
      const k = Math.exp(-dt / 0.42);
      s.vx *= k; s.vy *= k; s.v *= k;
      s.spin *= Math.exp(-dt / 0.55);
      s.cx += s.vx * dt; s.cy += s.vy * dt;
      s.rot += s.spin * dt;
      if (s.v < 26 && Math.abs(s.spin) < 0.6) { s.state = 'gone'; s.t = 0; }
      continue;
    }

    if (s.state === 'gone') {                   // häipyy paikalleen ja palaa kotiin
      s.t += dt;
      s.rot += s.spin * dt;
      s.spin *= Math.exp(-dt / 0.55);
      if (s.t > 0.38) home(s);
      continue;
    }

    if (s.state === 'wind') {                   // pyörähdys paikallaan = varoitus
      s.t += dt;
      const k = Math.min(1, s.t / Math.max(0.05, SKY.warn));
      /* Kiihtyvä pyörähdys: k² eikä k. Tasainen pyöriminen näytti siltä että
         tähti vain pyörii; kiihtyvä kertoo että jotain on tapahtumassa, ja
         viimeinen sekunti on selvästi nopeampi kuin ensimmäinen. */
      s.spin = s.dir * SKY.spin * 6.3 * k * k;
      s.rot += s.spin * dt;
      if (s.t >= SKY.warn) { s.state = 'fall'; s.t = 0; s.puff = 0; }
      continue;
    }

    /* putoaa */
    s.cx += s.vx * dt;
    s.cy += s.vy * dt;
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

    if (s.cy - s.r > H || s.cx + s.r < 0 || s.cx - s.r > W) { home(s); continue; }

    let done = false;
    for (const d of S.domes) {                  // kupoli ensin: se on suoja
      if (d.a < 0.25) continue;
      const pad = api.pads.find(p => p.id === d.id);
      if (!pad) continue;
      const r = domeR(pad, d), cx = pad.x + pad.w / 2, cy = pad.y;
      if (s.cy > cy) continue;
      const dx = s.cx - cx, dy = s.cy - cy;
      if (dx * dx + dy * dy < (r + s.r * 0.5) * (r + s.r * 0.5)) {
        burst(s, 14); home(s); done = true; break;
      }
    }
    if (done) continue;

    for (const r of SOLID) {
      if (!hit(s.box, r)) continue;
      burst(s, 10); home(s); done = true; break;
    }
    if (done) continue;

    for (const p of api.pads) {
      if (!hit(s.box, p)) continue;
      burst(s, 10); home(s); done = true; break;
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

/* Kentän lataus alkaa puhtaalta taivaalta: putoava tähti on myös seinä, ja
   peli rakentaa WALLSin uudestaan joka latauksessa. */
function init(api) {
  if (api.walls) {
    for (let i = api.walls.length - 1; i >= 0; i--) if (api.walls[i].star) api.walls.splice(i, 1);
  }
  S.walls = api.walls;
  S.bits.length = 0;
  S.spawn = SKY.grace;
  for (const d of S.domes) d.a = 0;
  for (const s of S.stars) {
    s.state = 'sky'; s.t = 0; s.v = 0; s.vx = 0; s.vy = 0; s.spin = 0;
    s.cx = s.hx; s.cy = s.hy;
  }
}

/* ------------------------------------------------------------------ piirto */

const fade = (c, a) => c + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

/* Kallio on samaa ainetta kuin pelin omat kehäseinät, jottei kentän oma piirto
   erotu niistä saumana. */
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
    ctx.fillRect(x, r.y + 4 + ((x * 7) % 11), 26, 5 + ((x * 13) % 9));
  }
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  for (let x = r.x + 28; x < r.x + r.w; x += 62) ctx.fillRect(x, r.y + r.h * 0.45, 34, 6);
  ctx.restore();
}

/* Nurmi kiven päällä: metsä jatkuu kallion päällä, ja tästä tietää mille
   pinnalle ollaan laskeutumassa. */
function turf(ctx, r) {
  ctx.fillStyle = 'rgba(58,110,74,.7)';
  ctx.fillRect(r.x, r.y, r.w, 4);
  ctx.fillStyle = 'rgba(86,150,100,.45)';
  for (let x = r.x + 3; x < r.x + r.w - 3; x += 8) {
    const h = 4 + ((x * 17) % 6);
    ctx.fillRect(x, r.y - h, 3, h);
  }
}

/* Oksakerros piirretään samasta käyrästä josta törmäysportaat ladottiin:
   yläreuna ulos kärkeen, kärki pyöreänä, alareuna takaisin runkoon. */
function branch(ctx, cx, y0, h, hw, sgn) {
  ctx.beginPath();
  ctx.moveTo(cx, y0 + brTop(0) * h);
  for (let k = 0; k <= 24; k++) {
    const u = k / 24;
    ctx.lineTo(cx + sgn * u * hw, y0 + brTop(u) * h);
  }
  for (let k = 24; k >= 0; k--) {
    const u = k / 24;
    ctx.lineTo(cx + sgn * u * hw, y0 + brBot(u) * h);
  }
  ctx.closePath();
}

function spruce(ctx, t) {
  ctx.fillStyle = '#2b2119';                    // runko ensin, oksat sen päälle
  ctx.fillRect(t.stem.x, t.stem.y, t.stem.w, t.stem.h);
  ctx.fillStyle = 'rgba(150,190,255,.10)';
  ctx.fillRect(t.stem.x, t.stem.y, 3, t.stem.h);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(t.stem.x + t.stem.w - 4, t.stem.y, 4, t.stem.h);

  ctx.fillStyle = '#16321f';                    // latva
  ctx.beginPath();
  ctx.moveTo(t.cx, t.tip.y);
  ctx.lineTo(t.cx + 9, t.tip.y + t.tip.h);
  ctx.lineTo(t.cx - 9, t.tip.y + t.tip.h);
  ctx.closePath(); ctx.fill();

  for (let i = t.layers.length - 1; i >= 0; i--) {
    const L = t.layers[i];
    const shade = i / Math.max(1, t.layers.length - 1);
    for (const sgn of [-1, 1]) {
      branch(ctx, t.cx, L.y0, L.h, L.hw, sgn);
      const g = ctx.createLinearGradient(t.cx, L.y0, t.cx + sgn * L.hw, L.y0 + L.h);
      g.addColorStop(0, sgn < 0 ? '#20472d' : '#1a3b26');   // valo ylävasemmalta
      g.addColorStop(1, '#0e2417');
      ctx.fillStyle = g;
      ctx.fill();

      ctx.save();                               // neulaset oksan sisään
      ctx.clip();
      ctx.strokeStyle = `rgba(132,190,142,${0.2 - shade * 0.07})`;
      ctx.lineWidth = 1;
      for (let k = 1; k < 26; k++) {
        const u = k / 26, x = t.cx + sgn * u * L.hw;
        ctx.beginPath();
        ctx.moveTo(x, L.y0 + brTop(u) * L.h);
        ctx.lineTo(x - sgn * 5, L.y0 + brBot(u) * L.h + 2);
        ctx.stroke();
      }
      ctx.restore();

      branch(ctx, t.cx, L.y0, L.h, L.hw, sgn);  // kuunvalo yläsärmälle
      ctx.strokeStyle = 'rgba(160,205,255,.09)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
}

/* Kaukametsä nurmikon takana: matala kontrasti, ei reunaviivaa, ei törmäystä. */
const FAR = [];
for (let x = -20; x < W + 40; x += 34) {
  FAR.push({ x, h: 52 + ((x * 29) % 44), w: 28 + ((x * 11) % 14) });
}
function farForest(ctx) {
  ctx.fillStyle = '#12202a';
  for (const f of FAR) {
    ctx.beginPath();
    ctx.moveTo(f.x, GRASS.y);
    ctx.lineTo(f.x + f.w / 2, GRASS.y - f.h);
    ctx.lineTo(f.x + f.w, GRASS.y);
    ctx.closePath(); ctx.fill();
  }
  const g = ctx.createLinearGradient(0, GRASS.y - 90, 0, GRASS.y);
  g.addColorStop(0, 'rgba(20,38,58,0)');
  g.addColorStop(1, 'rgba(20,38,58,.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, GRASS.y - 90, W, 90);
}

/* ------------------------------------------------------------------- luola */

const DRIP = [];                                // taustan tippukivet, ei törmäystä
for (let i = 0; i < 16; i++) {
  DRIP.push({ x: 24 + ((i * 137) % (W - 60)), h: 26 + ((i * 53) % 54), w: 10 + ((i * 31) % 14) });
}
const BATS = [];
for (let i = 0; i < 5; i++) {
  BATS.push({
    x0: 110 + ((i * 137) % (W - 260)), y0: CAVE_TOP + 46 + ((i * 71) % 80),
    rx: 54 + ((i * 41) % 80), ry: 14 + ((i * 17) % 22),
    secs: 6 + ((i * 13) % 9), phase: (i * 0.37) % 1, s: 0.55 + ((i * 7) % 4) / 10,
  });
}

let clock = 0, clockLast = 0;                   // koristeiden oma kello
function tick() {
  const now = performance.now() / 1000;
  if (clockLast) clock += Math.min(0.1, now - clockLast);
  clockLast = now;
  return clock;
}

function cave(ctx) {
  const g = ctx.createLinearGradient(0, CAVE_TOP, 0, CAVE_BOT);
  g.addColorStop(0, '#111a2c');
  g.addColorStop(1, '#080d18');
  ctx.fillStyle = g;
  ctx.fillRect(0, CAVE_TOP, W, CAVE_BOT - CAVE_TOP);

  /* Taustan tippukivet ovat perällä: yksi vaimea sävy, ei reunaa, ei kiiltoa.
     Jos nämä alkavat näyttää esteiltä, ne ovat liian kirkkaita — ei niin että
     niihin pitäisi lisätä törmäys. */
  ctx.fillStyle = 'rgba(120,150,200,.09)';
  for (const d of DRIP) {
    ctx.beginPath();
    ctx.moveTo(d.x, CAVE_TOP);
    ctx.lineTo(d.x + d.w / 2, CAVE_TOP + d.h);
    ctx.lineTo(d.x + d.w, CAVE_TOP);
    ctx.closePath(); ctx.fill();
  }

  const t = tick();
  for (const b of BATS) {
    const a = ((t / b.secs) + b.phase) * Math.PI * 2;
    bat(ctx, b.x0 + Math.cos(a) * b.rx, b.y0 + Math.sin(a * 2) * b.ry, b.s,
        Math.sin(t * 9 + b.phase * 6) * 0.5 + 0.5, Math.cos(a) < 0 ? -1 : 1);
  }

  /* Lampi luolan pohjalla: se antaa alustoille pinnan johon ne heijastuvat,
     ja se on ainoa kirkas asia perällä — siksi se on matalalla ja himmeä. */
  const p = ctx.createLinearGradient(0, CAVE_BOT - 26, 0, CAVE_BOT);
  p.addColorStop(0, 'rgba(70,120,170,.05)');
  p.addColorStop(1, 'rgba(90,150,210,.16)');
  ctx.fillStyle = p;
  ctx.fillRect(16, CAVE_BOT - 26, W - 32, 26);
}

function bat(ctx, x, y, s, flap, dir) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * s, s);
  ctx.fillStyle = 'rgba(150,175,215,.30)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-9, -6 - flap * 7, -18, -1 + flap * 3);
  ctx.quadraticCurveTo(-10, 2, 0, 4);
  ctx.quadraticCurveTo(10, 2, 18, -1 + flap * 3);
  ctx.quadraticCurveTo(9, -6 - flap * 7, 0, 0);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* Isot tippukivet: samaa kiveä kuin katto, eli niihin osuu. */
function spikes(ctx) {
  for (const sp of SPIKES) {
    for (const r of sp.parts) {
      ctx.fillStyle = '#1b2440';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = 'rgba(120,160,255,.16)';
      ctx.fillRect(r.x, r.y, r.w, 2);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(r.x + r.w - 3, r.y, 3, r.h);
    }
    const last = sp.parts[sp.parts.length - 1];
    ctx.fillStyle = 'rgba(150,190,255,.14)';   // kostea kärki
    ctx.fillRect(last.x + last.w / 2 - 2, last.y + last.h - 3, 4, 3);
  }
}

/* --------------------------------------------------------- tähdet ja kupoli */

function starShape(ctx, s, alpha, glow) {
  ctx.save();
  ctx.translate(s.cx, s.cy);
  ctx.rotate(s.rot);
  ctx.globalAlpha = alpha;

  const warm = s.hue < 0.5 ? '#ffe6a8' : '#ffd0e0';
  if (glow) { ctx.shadowColor = warm; ctx.shadowBlur = s.r * 1.4; }

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
  if (glow) {
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath(); ctx.arc(0, 0, s.r * 0.3, 0, 6.3); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* Lepäävä tähti on tavallinen tähti eikä himmeä kulissi: Sami 22.9.2026,
   ensimmäisessä versiossa ne olivat liian taustaa. Putoavan erottaa siis
   liikkeestä, vanasta ja pyörimisestä — ei kirkkaudesta. Se on tietoinen
   valinta ja siksi tässä kirjoitettuna. */
function sky(ctx) {
  for (const s of S.stars) {
    if (s.state === 'fall' || s.state === 'calm' || s.state === 'gone') continue;
    const twinkle = 0.82 + Math.sin(s.tw) * 0.1;
    if (s.state === 'sky') starShape(ctx, s, twinkle, true);
    else if (s.state === 'back') starShape(ctx, s, twinkle * Math.min(1, s.t / 0.7), true);
    else starShape(ctx, s, 1, true);           // pyörähtää: täysi kirkkaus
  }
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
  /* Math.max, koska kutistuva kupoli kävi säteessä alle viiden ja negatiivinen
     säde ei ole canvasilla virhearvo vaan poikkeus: se pysäytti koko
     piirtosilmukan juuri alustalta lähtiessä. */
  ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, r - 5), Math.PI * 1.08, Math.PI * 1.34); ctx.stroke();
  ctx.restore();
}

function back(ctx) {
  sky(ctx);                                     // lepäävät tähdet ovat taustaa
  farForest(ctx);
  cave(ctx);
  spruce(ctx, TREE);
  rock(ctx, TURF);
  turf(ctx, TURF);
  spikes(ctx);
}

function front(ctx, api) {
  for (const d of S.domes) {
    const pad = api.pads.find(p => p.id === d.id);
    if (pad && d.a > 0.01) dome(ctx, pad, d);
  }
  bits(ctx);
  for (const s of S.stars) {
    if (s.state === 'fall' || s.state === 'calm') starShape(ctx, s, 1, true);
    else if (s.state === 'gone') starShape(ctx, s, Math.max(0, 1 - s.t / 0.38), true);
  }
}

/* ------------------------------------------------------------------ kenttä */

export const shootingstars = {
  name: 'Shooting Stars',
  glow: '#ffe6a8',
  sky: ['#060a18', '#0d1630', '#16233f', '#1b2b33'],
  /* Kuu on tähtikentän alapuolella eikä sen seassa: ylhäällä se olisi yksi
     kirkas kiekko tähtien joukossa, ja tähtien pitää erottua. */
  sun: { x: 622, y: 356, r: 34, color: '#cfe0ff' },
  /* Luukku on siirretty vasemmalle: keskimmäisen kuusen latva olisi muuten
     ollut suoraan sisääntulon alla. Kenttä saa oman gaten, peli lukee sen. */
  gate: { x: 150, w: 120 },
  start: 1,
  firstFrom: 2,
  walls: SOLID,
  pads: PADS,
  seeds: [{ x: 63, y: 900 }, { x: 657, y: 900 }],
  tune: [
    {
      name: 'tähdet', obj: SKY,
      sliders: [
        { key: 'count', label: 'tähtiä taivaalla', min: 6, max: 70, step: 1 },
        { key: 'freq', label: 'lähtöä sekunnissa', min: 0.2, max: 6, step: 0.1 },
        { key: 'warn', label: 'pyörähdys ennen lähtöä s', min: 0.1, max: 6, step: 0.1 },
        { key: 'grace', label: 'tauko kentän alussa s', min: 0, max: 20, step: 0.5 },
        { key: 'tilt', label: 'kulma astetta', min: 0, max: 45, step: 1 },
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
