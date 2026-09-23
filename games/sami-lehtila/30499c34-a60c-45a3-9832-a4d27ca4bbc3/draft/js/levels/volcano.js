/* Tulivuori — viidakon keskellä kartio joka purkautuu.
 *
 * Yksi kenttä per tiedosto, jotta kaksi tekijää voi työstää eri kenttiä
 * yhtä aikaa kirjoittamatta toistensa yli. Kentän muoto on kuvattu
 * ../levels.js:ssä.
 *
 * Kenttä on yksi vuori ruudun keskellä ja kaksi kuilua sen kylkien vieressä:
 *
 *   kartio        kymmenen kivipenkkaa kraatterista tyveen. Neljä numeroitua
 *                 alustaa on kiilakkeilla kylkiin, kaksi kummallakin puolella
 *                 eri korkeuksilla. Ne ovat avoimen taivaan alla, ja juuri
 *                 niille kivet putoavat.
 *   kraatteri     ruudun keskellä, y 430. Purkaus syöksee 1–4 magmapalloa,
 *                 suurin taksin kokoinen ja pienin 70 % siitä.
 *   luola         vuoren tyven alla, vasemmalta auki. Siellä on bensa, ja se
 *                 on kentän ainoa turvapaikka.
 *
 * Kolme sääntöä joilla tämä pysyy rehellisenä:
 *
 *   1. **Magmapallo on seinä.** Se työnnetään pelin WALLS-taulukkoon ja
 *      poistetaan sieltä kun se roiskahtaa, joten törmäys on pelin omaa eikä
 *      kentän. Peli ei piirrä sitä (`hide`), koska laatikko ei ole pallon
 *      näköinen — piirto on tässä tiedostossa, ja laatikko on tahallaan
 *      hieman piirrettyä pienempi.
 *   2. **Luola on turvassa fysiikan takia, ei säännön.** Pallo lähtee
 *      kraatterista aina *ulospäin*, eli vasemmalla puolella sen vaakanopeus
 *      on vasemmalle. Luolan suu aukeaa vasemmalle, joten sinne pitäisi lentää
 *      oikealle — eikä yksikään pallo tee niin. Katto on lisäksi umpinaista
 *      kiveä koko luolan matkalta. Jos luolaa siirtää, tämä on se mikä pitää
 *      tarkistaa: kumpikaan ehto yksin ei riitä.
 *   3. **Vain vuori tärisee.** Tärinä on piirron siirto eikä fysiikkaa, ja se
 *      on siksi pidetty pienenä (`quake`, enintään 5 px). Ruutu ja alustat
 *      eivät liiku lainkaan: varoituksen aikana laskeutumisen pitää olla yhtä
 *      tarkkaa kuin muulloin, muuten varoitus rankaisisi siitä että sen
 *      huomasi. Sami 23.9.2026: *"vain vuori tärisee."*
 */

import { W, H, CEIL } from './shared.js';

/* ------------------------------------------------------------------ mitat

   Luvut ovat tässä lukuina eivätkä laskettuina: kenttää sommitellaan
   siirtämällä yhtä lukua kerrallaan, ja kaava tekee siitä arvuuttelua.

   Kartio on kymmenen 47 px:n penkkaa y 430…900. Porras on tahallaan näkyvä:
   vuori jonka siluetti on pehmeämpi kuin sen törmäys olisi juuri se
   epäselvyys jota README kieltää. Penkat piirretään täsmälleen niinä
   laatikkoina jotka ovat myös törmäys. */

const CRATER_Y = 430;                 // kraatterin suun taso
const PIT = { x0: 322, x1: 398 };     // kraatterin aukko — taksi ei mahdu
const BASE_Y = 900;                   // tyvi, tästä alaspäin luola ja jalka
const FLOOR = H - 16;                 // kehäseinän lattia

/* Penkat: y on yläreuna, h korkeus, x0…x1 leveys. Alaspäin levenevä kartio
   jonka tyvi on 130…590 — kuilut jäävät silloin 114 px leveiksi vielä
   alimmillaan, ja taksi on 54 px. Ahtaus ei ole tämän kentän vaikeus. */
const CONE = [
  { y: 430, h: 47, x0: 281, x1: 439, rim: true },   // kraatterin reunat
  { y: 477, h: 47, x0: 264, x1: 456 },
  { y: 524, h: 47, x0: 248, x1: 472 },
  { y: 571, h: 47, x0: 231, x1: 489 },
  { y: 618, h: 47, x0: 214, x1: 506 },
  { y: 665, h: 47, x0: 197, x1: 523 },
  { y: 712, h: 47, x0: 180, x1: 540 },
  { y: 759, h: 47, x0: 164, x1: 556 },
  { y: 806, h: 47, x0: 147, x1: 573 },
  { y: 853, h: 47, x0: 130, x1: 590 },
];

/* Luola on koverrettu tyven vasempaan puoliskoon: kivi jää umpinaiseksi vain
   440…590, ja sen vasemmalla puolella y 900…1024 on onkalo jonka kattona on
   ylin penkka. Suu aukeaa vasemmalle kuiluun. */
const CAVE = { x0: 130, x1: 440, y0: BASE_Y, y1: FLOOR };
const FOOT = { x: 440, y: BASE_Y, w: 150, h: FLOOR - BASE_Y };

/* Kiilakkeet: alusta seisoo kivihyllyllä joka sulautuu kylkeen. Hylly alkaa
   alustan alareunasta, joten alustan laskupinta ei ole koskaan seinän sisällä
   — se on se ainoa asia jonka tarkistin katsoo. */
const PAD_H = 18;
const LEDGES = [
  { x: 155, y: 488, w: 145, h: 36 },    // alustan 1 alla
  { x: 420, y: 488, w: 145, h: 36 },    // alustan 2 alla
  { x: 88,  y: 678, w: 152, h: 36 },    // alustan 3 alla
  { x: 480, y: 658, w: 152, h: 36 },    // alustan 4 alla
];

/* ------------------------------------------------------------------ seinät

   add palauttaa saman olion jonka se työntää listaan eikä kopiota: peli
   kopioi `level.walls`in taulukkona mutta jakaa oliot kentän kanssa. */

const SOLID = [];
const add = r => { r.hide = true; SOLID.push(r); return r; };

/* Kraatterin reunat ovat kaksi laatikkoa eikä yksi: keskelle jäävä 76 px:n
   aukko on kraatteri. Se on oikea kolo eikä maalattu — umpinaiselta näyttävä
   on umpinaista, ja aukolta näyttävä on aukko. Taksi (54 px) mahtuisi siihen
   teoriassa, mutta siellä ei ole alustaa eikä mitään haettavaa, ja purkaus
   tulee sieltä. */
const BANDS = [];
for (const b of CONE) {
  if (b.rim) {
    BANDS.push(add({ x: b.x0, y: b.y, w: PIT.x0 - b.x0, h: b.h, rock: true }));
    BANDS.push(add({ x: PIT.x1, y: b.y, w: b.x1 - PIT.x1, h: b.h, rock: true }));
  } else {
    BANDS.push(add({ x: b.x0, y: b.y, w: b.x1 - b.x0, h: b.h, rock: true }));
  }
}

const SHELVES = LEDGES.map(l => add({ ...l, rock: true, shelf: true }));
const BASE = add({ ...FOOT, rock: true });

/* ---------------------------------------------------------------- alustat

   Numeroidut alustat ovat kylkien kiilakkeilla, kaksi kummallakin puolella.
   Jokaisen ulkopuolelle jää vähintään 70 px kuilua, jotta alustan ohi pääsee
   laskeutumaan alemmas — muuten alin alusta olisi tulppa eikä alusta.

   Tankkaus on luolassa. Se on koko kentän lupaus: ulkona ei ole turvaa,
   sisällä ei ole keikkoja. */
const PADS = [
  { id: 1, x: 155, y: 470, w: 120 },
  { id: 2, x: 445, y: 470, w: 120 },
  { id: 3, x: 88,  y: 660, w: 120 },
  { id: 4, x: 512, y: 640, w: 120 },
  { id: 0, x: 260, y: 986, w: 120, fuel: true },
];

/* ---------------------------------------------------------------- purkaus

   Purkaus on kaksi vaihetta: varoitus ja syöksy. Varoitus on se mistä kenttä
   pelataan — savu tihenee, kipinät lentävät ja vuori tärisee kiihtyvästi,
   ja pelaaja päättää sen aikana laskeutuuko vai odottaako. Ilman varoitusta
   alustalle laskeutuminen olisi arpapeliä, ja se on eri peli.

   Vuori tupruttaa savua myös silloin kun mitään ei ole tulossa. Se on tahallaan:
   varoitus on savun *muutos*, ja muutosta ei näe ellei ole mitä vertailla. */

const ERUPT = {
  freq: 0.2,          // purkauksia sekunnissa
  warn: 2.6,          // varoituksen kesto s
  grace: 6,           // tauko kentän alussa ja kuoleman jälkeen s
  nmin: 1, nmax: 4,   // palloja purkauksessa
  vmin: 290, vmax: 430,
  amin: 4, amax: 18,  // lähtökulma pystystä, astetta
  size: 1,
  quake: 3,           // vuoren tärinä px — vain piirto, ks. sääntö 3
};

const TRAIL = { rate: 56, life: 0.3, size: 3.6, spread: 12 };
const SMOKE = { rate: 6, life: 2.8, size: 15, rise: 38, drift: 12, boost: 6 };
const SPARK = { rate: 30, life: 0.8, size: 2.6, up: 200, spread: 90 };

/* Taksi on 54 px leveä: suurin pallo on sen kokoinen, pienin 70 % siitä.
   Sami 22.9.2026. */
const R_BIG = 27, R_SMALL = 18.9;
const BOX = 0.68;                     // törmäyslaatikko pallon piirrosta

/* Pallon painovoima on pelin oma (`P.grav`), ja lähtönopeus skaalataan
   **neliöjuurella** siitä. Se on koko ero Shooting Starsiin, jossa tähti
   putosi suoraan alas ja pelkkä nopeus riitti: heittokaaren kantama on
   v²/g, joten kun g kerrotaan k:lla ja v juuri-k:lla, kaari pysyy
   täsmälleen samana ja vain kello hidastuu. Helpolla vaikeustasolla
   pallot lentävät siis samoille alustoille kuin prolla — hitaammin.
   250 on pelin painovoiman oletus (DEFAULTS.grav). */
const GRAV_REF = 250;

let seed = 20260923;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const between = (a, b) => a + rnd() * (b - a);

const S = {
  balls: [], bits: [], smoke: [],
  walls: null, gscale: 1, grav: GRAV_REF,
  phase: 'idle', t: 0, wait: 0, quake: 0, jolt: 0, wasDead: false,
  smokeT: 0, sparkT: 0,
};

const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const unwall = b => {
  if (!S.walls) return;
  const i = S.walls.indexOf(b.box);
  if (i >= 0) S.walls.splice(i, 1);
};

/* Roiskahdus on kipinäpöly: sama kaava kuin vana, mutta joka suuntaan ja
   nopeampi. Pallo katoaa samalla ruudulla. */
function splash(b, n) {
  for (let i = 0; i < n; i++) {
    const a = between(0, 6.3), sp = between(50, 300);
    S.bits.push({
      x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 50,
      life: between(0.2, 0.62), max: 0.62, r: between(1.6, 3.6), hot: b.hot,
    });
  }
}

function kill(b, n) {
  unwall(b);
  if (n) splash(b, n);
  const i = S.balls.indexOf(b);
  if (i >= 0) S.balls.splice(i, 1);
}

/* Pallo lähtee kraatterin pohjalta ja nousee näkyvästi ulos kolosta: lähtö
   on osa varoitusta sekin. Kulma on pystystä ulospäin, ja **merkki ratkaisee
   puolen**: vasemmalle lähtevän vaakanopeus on vasemmalle koko lennon ajan.
   Sääntö 2 nojaa tähän. */
function launch() {
  const dir = rnd() < 0.5 ? -1 : 1;
  const a = between(ERUPT.amin, ERUPT.amax) * Math.PI / 180;
  const v = between(ERUPT.vmin, ERUPT.vmax) * Math.sqrt(S.gscale);
  const r = between(R_SMALL, R_BIG) * ERUPT.size;
  const side = BOX * 2 * r;
  S.balls.push({
    x: 360 + between(-6, 6) * dir, y: CRATER_Y + 10,
    vx: Math.sin(a) * v * dir, vy: -Math.cos(a) * v,
    r, t: 0, puff: 0, hot: between(0, 1), spin: between(-2, 2),
    box: { x: 0, y: 0, w: side, h: side, hide: true, magma: true },
  });
}

function blow() {
  const n = Math.round(between(ERUPT.nmin, ERUPT.nmax + 0.49));
  for (let i = 0; i < n; i++) launch();
  S.jolt = 1;
}

function puffSmoke(dt, heat) {
  const rate = SMOKE.rate * (1 + heat * (SMOKE.boost - 1));
  S.smokeT -= dt;
  while (S.smokeT <= 0) {
    S.smokeT += 1 / Math.max(0.5, rate);
    S.smoke.push({
      x: 360 + between(-28, 28), y: CRATER_Y + between(-4, 10),
      vx: between(-SMOKE.drift, SMOKE.drift),
      vy: -SMOKE.rise * between(0.6, 1.3) * (0.7 + heat * 0.6),
      life: SMOKE.life * between(0.7, 1.2), max: SMOKE.life,
      r: SMOKE.size * between(0.6, 1.4), heat,
      rot: between(0, 6.3),
    });
  }
}

function sparkle(dt, heat) {
  if (heat <= 0.02) return;
  S.sparkT -= dt;
  while (S.sparkT <= 0) {
    S.sparkT += 1 / Math.max(1, SPARK.rate * heat);
    S.bits.push({
      x: 360 + between(-30, 30), y: CRATER_Y + between(0, 14),
      vx: between(-SPARK.spread, SPARK.spread) * heat,
      vy: -SPARK.up * between(0.5, 1.2) * heat,
      life: SPARK.life * between(0.5, 1.1), max: SPARK.life,
      r: SPARK.size * between(0.5, 1.1), hot: between(0.6, 1),
    });
  }
}

/* Kuoleman hetkellä vuori rauhoittuu ja lennossa olevat pallot sammuvat.
   Muuten seitsemästä armonsekunnista olisi kulunut kolme kuolinanimaatioon
   ennen kuin pelaaja on edes ruudulla. */
function calm() {
  for (let i = S.balls.length - 1; i >= 0; i--) kill(S.balls[i], 8);
  S.phase = 'idle';
  S.wait = ERUPT.grace;
  S.t = 0;
}

function update(dt, api) {
  S.walls = api.walls;
  if (api.P && isFinite(api.P.grav)) {
    S.grav = api.P.grav;
    S.gscale = api.P.grav / GRAV_REF;
  }

  if (api.dead && !S.wasDead) calm();
  if (!api.dead && S.wasDead) { S.wait = ERUPT.grace; S.phase = 'idle'; }
  S.wasDead = !!api.dead;

  /* Vaihekone. `heat` on 0…1 ja se on sekä savun, kipinöiden että tärinän
     yhteinen voimakkuus — yksi luku, jotta kolme merkkiä kertovat varmasti
     saman asian. Kiihtyvä k² eikä k: tasainen ramppi näyttäisi siltä että
     vuori vain savuaa, ja viimeisen sekunnin pitää olla selvästi kiivaampi
     kuin ensimmäisen. */
  let heat = 0;
  if (!api.dead) {
    if (S.phase === 'idle') {
      S.wait -= dt;
      if (S.wait <= 0) { S.phase = 'warn'; S.t = 0; }
    } else {
      S.t += dt;
      const k = Math.min(1, S.t / Math.max(0.05, ERUPT.warn));
      heat = k * k;
      if (S.t >= ERUPT.warn) {
        blow();
        S.phase = 'idle';
        S.t = 0;
        S.wait = Math.max(ERUPT.warn + 0.4, 1 / Math.max(0.02, ERUPT.freq)) - ERUPT.warn;
      }
    }
  }

  S.jolt = Math.max(0, S.jolt - dt / 0.38);
  S.quake = ERUPT.quake * Math.max(heat, S.jolt * 1.5);

  puffSmoke(dt, heat);
  sparkle(dt, heat);

  /* ---- pallot */
  for (let i = S.balls.length - 1; i >= 0; i--) {
    const b = S.balls[i];
    b.t += dt;
    b.vy += S.grav * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.box.x = b.x - b.box.w / 2;
    b.box.y = b.y - b.box.h / 2;

    b.puff -= dt;
    while (b.puff <= 0) {
      b.puff += 1 / Math.max(1, TRAIL.rate);
      S.bits.push({
        x: b.x + between(-TRAIL.spread, TRAIL.spread) * 0.4,
        y: b.y + between(-TRAIL.spread, TRAIL.spread) * 0.4,
        vx: between(-TRAIL.spread, TRAIL.spread) - b.vx * 0.08,
        vy: between(-40, 10) - b.vy * 0.08,
        life: TRAIL.life * between(0.6, 1.1), max: TRAIL.life,
        r: TRAIL.size * between(0.6, 1.2), hot: b.hot,
      });
    }

    /* Ulos lentänyt katoaa ilman roiskahdusta — siitä ei ole mitään
       kerrottavaa. Kattoon osunut roiskahtaa, koska se näkyy. */
    if (b.y - b.r > H || b.x + b.r < 0 || b.x - b.r > W) { kill(b, 0); continue; }
    if (b.box.y < CEIL) { b.y = CEIL + b.box.h / 2; kill(b, 12); continue; }
    if (b.box.x < 16 || b.box.x + b.box.w > W - 16) { kill(b, 10); continue; }
    if (b.box.y + b.box.h > FLOOR) { kill(b, 12); continue; }

    let done = false;
    for (const r of SOLID) {
      if (!hit(b.box, r)) continue;
      kill(b, 10); done = true; break;
    }
    if (done) continue;
    for (const p of api.pads) {
      if (!hit(b.box, p)) continue;
      kill(b, 10); done = true; break;
    }
    if (done) continue;

    if (S.walls.indexOf(b.box) < 0) S.walls.push(b.box);
  }

  /* ---- hiukkaset */
  for (let i = S.bits.length - 1; i >= 0; i--) {
    const p = S.bits[i];
    p.life -= dt;
    if (p.life <= 0) { S.bits.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 140 * dt; p.vx *= 1 - Math.min(1, dt * 2.2);
  }
  for (let i = S.smoke.length - 1; i >= 0; i--) {
    const p = S.smoke[i];
    p.life -= dt;
    if (p.life <= 0) { S.smoke.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy *= 1 - Math.min(1, dt * 0.5);
    p.vx += (p.x < 360 ? -6 : 6) * dt;
  }
}

/* Kentän lataus alkaa tyhjältä taivaalta: magmapallo on myös seinä, ja peli
   rakentaa WALLSin uudestaan joka latauksessa. */
function init(api) {
  if (api.walls) {
    for (let i = api.walls.length - 1; i >= 0; i--) if (api.walls[i].magma) api.walls.splice(i, 1);
  }
  S.walls = api.walls;
  S.balls.length = 0;
  S.bits.length = 0;
  S.smoke.length = 0;
  S.phase = 'idle';
  S.t = 0;
  S.wait = ERUPT.grace;
  S.quake = 0;
  S.jolt = 0;
  S.wasDead = false;
}

/* ------------------------------------------------------------------ piirto */

const fade = (c, a) => c + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

/* Koristeilla on oma kello, koska pelin `runT` pysähtyy luukusta tullessa ja
   tauolla. Pysähtynyt viidakko näyttäisi rikkinäiseltä. */
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

/* Tärinän kohina on sinien tuloa eikä `rnd()`: piirto ei saa kuluttaa samaa
   siemenvirtaa kuin purkauksen arvonnat, koska silloin pelin kulku riippuisi
   ruudunpäivitysnopeudesta. */
const nz = (t, k) => Math.sin(t * k) * Math.sin(t * k * 1.73 + 1.3);

/* ---- viidakko

   Kaikki tämä on taustaa, ja taustan pitää näyttää taustalta: lehvästö on
   vaimeampaa ja matalakontrastisempaa kuin yksikään kivi. Pelaajan ei kuulu
   varoa sitä. Ks. README, "Pysyviä sääntöjä". */

let fseed = 7717;
const frnd = () => ((fseed = (fseed * 1103515245 + 12345) >>> 0) / 4294967296);
const fbet = (a, b) => a + frnd() * (b - a);

const RIDGE = [];
for (let i = 0; i < 3; i++) {
  const pts = [];
  for (let x = -40; x <= W + 40; x += 60) {
    pts.push({ x, y: 300 + i * 90 + fbet(-46, 46) });
  }
  RIDGE.push(pts);
}

/* Lehtiviuhkat reunoilla ja pohjalla. Jokainen on paikka, koko, kallistus ja
   lehtien määrä; piirto on yksi kaari lehteä kohti. */
const FRONDS = [];
for (let i = 0; i < 26; i++) {
  const left = i % 2 === 0;
  const x = left ? fbet(-30, 120) : fbet(W - 120, W + 30);
  FRONDS.push({
    x, y: fbet(560, 1040), r: fbet(46, 120),
    rot: (left ? fbet(-0.5, 0.7) : fbet(-0.7, 0.5)) + (left ? -0.5 : 0.5),
    n: Math.round(fbet(5, 9)), tone: fbet(0, 1), sway: fbet(0.5, 1.4),
  });
}
for (let i = 0; i < 14; i++) {
  FRONDS.push({
    x: fbet(-20, W + 20), y: fbet(1010, 1075), r: fbet(60, 140),
    rot: fbet(-0.8, 0.8), n: Math.round(fbet(6, 10)),
    tone: fbet(0, 1), sway: fbet(0.4, 1.2),
  });
}

function frond(ctx, f, t) {
  const sway = Math.sin(t * 0.5 * f.sway + f.x * 0.02) * 0.05;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.rot + sway);
  ctx.fillStyle = f.tone < 0.5 ? '#13251a' : '#193020';
  for (let i = 0; i < f.n; i++) {
    const a = -1.35 + (i / Math.max(1, f.n - 1)) * 2.7;
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(f.r * 0.55, -f.r * 0.16, f.r, 0);
    ctx.quadraticCurveTo(f.r * 0.55, f.r * 0.16, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function jungle(ctx) {
  const t = clock();

  // kaukaiset harjanteet — mitä kauempana, sitä lähempänä taivaan väriä
  const tone = ['#22362f', '#1d3029', '#182821'];
  for (let i = 0; i < RIDGE.length; i++) {
    ctx.fillStyle = tone[i];
    ctx.beginPath();
    ctx.moveTo(-40, H);
    for (const p of RIDGE[i]) ctx.lineTo(p.x, p.y);
    ctx.lineTo(W + 40, H);
    ctx.fill();
  }

  // utu harjanteiden päälle, jotta kivi erottuu niistä ilman epäilystä
  const haze = ctx.createLinearGradient(0, 280, 0, 720);
  haze.addColorStop(0, '#5c6f5a33');
  haze.addColorStop(1, '#5c6f5a00');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 280, W, 440);

  for (const f of FRONDS) frond(ctx, f, t);
}

/* ---- vuori */

function rockBand(ctx, r, lit, glow) {
  ctx.fillStyle = '#272320';
  ctx.fillRect(r.x, r.y, r.w, r.h);

  // yläpinta valoon: valo tulee ylävasemmalta, joten hyllyt hohtavat
  ctx.fillStyle = lit;
  ctx.fillRect(r.x, r.y, r.w, 5);
  ctx.fillStyle = '#00000038';
  ctx.fillRect(r.x, r.y + r.h - 4, r.w, 4);

  // pystyjuovia kiveen — ne pysyvät laatikon sisällä, eivät levitä siluettia
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.fillStyle = '#00000026';
  for (let x = r.x + 9; x < r.x + r.w; x += 23) ctx.fillRect(x, r.y + 4, 3, r.h - 6);
  if (glow > 0.01) {
    ctx.fillStyle = fade('#ff6a22', 0.1 + glow * 0.22);
    for (let x = r.x + 16; x < r.x + r.w; x += 47) ctx.fillRect(x, r.y + 5, 2, r.h - 8);
  }
  ctx.restore();
}

function mountain(ctx, heat) {
  const t = clock();
  const q = S.quake;
  ctx.save();
  if (q > 0.01) ctx.translate(nz(t, 41) * q, nz(t, 57) * q * 0.55);

  // luolan pimeys ennen kiveä, jotta suu ei näytä aukolta viidakkoon
  const dark = ctx.createLinearGradient(CAVE.x0, 0, CAVE.x1, 0);
  dark.addColorStop(0, '#0d0b0a');
  dark.addColorStop(1, '#050404');
  ctx.fillStyle = dark;
  ctx.fillRect(CAVE.x0, CAVE.y0, CAVE.x1 - CAVE.x0, CAVE.y1 - CAVE.y0);

  for (let i = BANDS.length - 1; i >= 0; i--) {
    const b = BANDS[i];
    const up = 1 - (b.y - CRATER_Y) / (BASE_Y - CRATER_Y);   // 1 = kraatterilla
    rockBand(ctx, b, i < 2 ? '#4a4038' : '#3a332c', heat * up * up);
  }
  rockBand(ctx, BASE, '#3a332c', 0);
  for (const s of SHELVES) rockBand(ctx, s, '#43392f', 0);

  // kraatterin hehku: kuumuus näkyy kolossa ennen kuin mitään lentää
  const g = 0.25 + heat * 0.75;
  const gl = ctx.createRadialGradient(360, CRATER_Y + 18, 4, 360, CRATER_Y + 18, 84 + heat * 46);
  gl.addColorStop(0, fade('#ffd27a', 0.55 * g));
  gl.addColorStop(0.45, fade('#ff6a22', 0.4 * g));
  gl.addColorStop(1, '#ff6a2200');
  ctx.fillStyle = gl;
  ctx.fillRect(PIT.x0 - 80, CRATER_Y - 60, (PIT.x1 - PIT.x0) + 160, 130);
  ctx.fillStyle = fade('#ff7a2c', 0.45 + heat * 0.45);
  ctx.fillRect(PIT.x0 + 3, CRATER_Y + 30, PIT.x1 - PIT.x0 - 6, 17);

  ctx.restore();
}

/* ---- hiukkaset ja pallot */

function smokeDraw(ctx) {
  ctx.save();
  for (const p of S.smoke) {
    const k = Math.max(0, p.life / p.max);
    const r = Math.max(1, p.r * (1.8 - k));
    const warm = p.heat;
    ctx.fillStyle = fade(warm > 0.4 ? '#6a5346' : '#4c4a48', 0.32 * k * k);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 6.3);
    ctx.fill();
  }
  ctx.restore();
}

function bitsDraw(ctx) {
  for (const p of S.bits) {
    const k = Math.max(0, p.life / p.max);
    ctx.fillStyle = fade(p.hot > 0.55 ? '#ffd98a' : '#ff7a2c', k);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, p.r * k), 0, 6.3);
    ctx.fill();
  }
}

function ballDraw(ctx, b) {
  const t = clock();
  ctx.save();
  ctx.translate(b.x, b.y);

  const halo = ctx.createRadialGradient(0, 0, Math.max(1, b.r * 0.4), 0, 0, Math.max(2, b.r * 2.4));
  halo.addColorStop(0, '#ff8a3c66');
  halo.addColorStop(1, '#ff8a3c00');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2, b.r * 2.4), 0, 6.3);
  ctx.fill();

  const body = ctx.createRadialGradient(-b.r * 0.3, -b.r * 0.35, Math.max(1, b.r * 0.15), 0, 0, Math.max(2, b.r));
  body.addColorStop(0, '#fff0c0');
  body.addColorStop(0.4, '#ffb03c');
  body.addColorStop(0.82, '#e1471a');
  body.addColorStop(1, '#6a2410');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(1, b.r), 0, 6.3);
  ctx.fill();

  /* Jäähtynyttä kuorta laikkuina. Math.max jokaiseen säteeseen: kutistuva
     kaari on piirtosilmukan tappaja, koska negatiivinen säde on canvasilla
     poikkeus eikä nolla. Ks. README. */
  ctx.fillStyle = '#3a211966';
  for (let i = 0; i < 3; i++) {
    const a = b.spin * t + i * 2.1;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * b.r * 0.42, Math.sin(a) * b.r * 0.42, Math.max(1, b.r * 0.24), 0, 6.3);
    ctx.fill();
  }
  ctx.restore();
}

function back(ctx) {
  jungle(ctx);
  const heat = S.phase === 'warn' ? Math.min(1, S.t / Math.max(0.05, ERUPT.warn)) ** 2 : 0;
  mountain(ctx, heat);
  smokeDraw(ctx);                 // savu jää taksin taakse, jottei se peitä sitä
}

function front(ctx) {
  bitsDraw(ctx);
  for (const b of S.balls) ballDraw(ctx, b);
}

/* ------------------------------------------------------------------ kenttä */

export const volcano = {
  name: 'Tulivuori',
  glow: '#ff8a3c',
  /* Trooppinen iltahämärä tuhkan läpi. Taivas on viileä, jotta magma on
     ruudun ainoa lämmin asia — sitä pitää nähdä kauas. */
  sky: ['#0e1a22', '#1b3038', '#2f4a42', '#46583c'],
  sun: { x: 612, y: 236, r: 44, color: '#d8a271' },
  /* Luukku on vasemmalla: keskellä se olisi suoraan kraatterin yläpuolella,
     ja sisääntulo menisi purkauksen läpi. Vasen laita on myös se kuilu jota
     pitkin luolaan mennään, joten sisääntulo opettaa reitin. */
  gate: { x: 96, w: 120 },
  start: 0,
  firstFrom: 1,
  walls: SOLID,
  pads: PADS,
  edit: [
    ...PADS.map(p => ({
      id: 'pad:' + p.id,
      kind: 'pad',
      obj: p,
      label: p.fuel ? 'tankkaus' : 'alusta ' + p.id,
      knob: { key: 'w', label: 'leveys', min: 60, max: 200, step: 2 },
    })),
  ],
  tune: [
    {
      name: 'purkaus', obj: ERUPT,
      sliders: [
        { key: 'freq', label: 'purkausta sekunnissa', min: 0.05, max: 1.5, step: 0.05 },
        { key: 'warn', label: 'varoitus ennen purkausta s', min: 0.4, max: 8, step: 0.1 },
        { key: 'grace', label: 'tauko kentän alussa s', min: 0, max: 20, step: 0.5 },
        { key: 'nmin', label: 'palloja vähintään', min: 1, max: 6, step: 1 },
        { key: 'nmax', label: 'palloja enintään', min: 1, max: 8, step: 1 },
        { key: 'vmin', label: 'nopeus min', min: 120, max: 600, step: 10 },
        { key: 'vmax', label: 'nopeus max', min: 160, max: 700, step: 10 },
        { key: 'amin', label: 'kulma min astetta', min: 0, max: 45, step: 1 },
        { key: 'amax', label: 'kulma max astetta', min: 2, max: 60, step: 1 },
        { key: 'size', label: 'pallon koko', min: 0.5, max: 1.6, step: 0.05 },
        /* Tärinä on piirron siirto eikä fysiikkaa, ja siksi sen katto on
           matala: 5 px on jo se raja jossa piirretty kivi ja sen törmäys
           ovat eri mieltä sen verran että sitä alkaa huomata. */
        { key: 'quake', label: 'vuoren tärinä px', min: 0, max: 5, step: 0.5 },
      ],
    },
    {
      name: 'savu', obj: SMOKE, open: false,
      sliders: [
        { key: 'rate', label: 'tupruja/s levossa', min: 0, max: 40, step: 1 },
        { key: 'boost', label: 'kerroin varoituksessa', min: 1, max: 14, step: 0.5 },
        { key: 'life', label: 'kesto s', min: 0.5, max: 8, step: 0.1 },
        { key: 'size', label: 'koko', min: 4, max: 44, step: 1 },
        { key: 'rise', label: 'nousu px/s', min: 6, max: 140, step: 2 },
        { key: 'drift', label: 'ajelehdinta', min: 0, max: 60, step: 1 },
      ],
    },
    {
      name: 'kipinät', obj: SPARK, open: false,
      sliders: [
        { key: 'rate', label: 'kipinää/s täydellä', min: 0, max: 120, step: 2 },
        { key: 'life', label: 'kesto s', min: 0.1, max: 3, step: 0.05 },
        { key: 'size', label: 'koko', min: 0.5, max: 8, step: 0.2 },
        { key: 'up', label: 'lähtönopeus ylös', min: 20, max: 500, step: 10 },
        { key: 'spread', label: 'leviämä', min: 0, max: 220, step: 5 },
      ],
    },
    {
      name: 'magman vana', obj: TRAIL, open: false,
      sliders: [
        { key: 'rate', label: 'hiukkasta/s', min: 6, max: 160, step: 2 },
        { key: 'life', label: 'kesto s', min: 0.06, max: 1.2, step: 0.02 },
        { key: 'size', label: 'koko', min: 1, max: 9, step: 0.2 },
        { key: 'spread', label: 'leviämä', min: 0, max: 60, step: 1 },
      ],
    },
    { name: 'kentän kertoimet', open: false, mul: ['grav', 'thrust', 'burn', 'landVX'] },
  ],
  init,
  update,
  drawBack: back,
  drawFront: front,
};
