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
/* Koko kuusikompleksi laskettiin 22.9.2026 alaspäin kaksi taksinkorkeutta
   (2 × 28 = 56 px): maapala 780 → 836. **Kuusi itse laski 40 px eikä 56**, ja
   se 16 px:n ero on tahallinen — se on se rako jonka läpi alustalle lennetään
   oksan alta. */
const GRASS = { x: 110, y: 836, w: 500, h: 40 };
const SHAFT_L = { x0: 16, x1: 110 };
const SHAFT_R = { x0: 610, x1: 704 };
const CAVE_TOP = GRASS.y + GRASS.h;
const CAVE_BOT = H - 16;

/* Kuusi keskellä: latvus 300…700, runko siitä nurmikkoon.

   Kuusi on neljä helmaa, ja ne menevät limittäin: siluetti on yhtenäinen
   kartio, ei erillisiä oksia joiden välistä näkyy runko. **Jokaisen helman
   alareuna nuokkuu ulos ja alas kärjistä** — ne viikset — ja seuraava helma
   alkaa kapeampana sen alta, jolloin reunaan jää se lovi joka tekee kuusesta
   kuusen. Sami antoi mallikuvan 22.9.2026; lumet jätettiin pois.

   Yksi helma: ylhäällä `hw0` leveä, alhaalla `hw1`, ja kylki kaartuu näiden
   välillä. Alareuna on keskeltä `drop` verran ylempänä kuin kärjissä. */
const TREE = { cx: 360, top: 300, bot: 700, foot: GRASS.y };
/* SKIRTS on **laskettu** eikä kirjoitettu: siihen kirjoittaa `master()`, ja
   piirto ja törmäys lukevat sitä. Säätimissä on kaksi tasoa, ja kumpikaan ei
   ole näitä lukuja:

     SK     koko puun muoto yhtenä oliona — tästä helmat lasketaan
     NUDGE  helmakohtainen **poikkeama** masterin antamaan lukuun, oletus 0

   Poikkeama eikä yliajo, ja se on tämän kohdan koko pointti. Ensin helmoilla
   oli omat absoluuttiset lukunsa, ja silloin ne jäivät voimaan ikuisesti:
   tallennuksen jälkeen masterin luvut eivät enää tarkoittaneet mitään, koska
   helmat sanoivat aina viimeisen sanan. Sami 22.9.2026: *"no nyt yliajot
   määräävät aina :D"*. Poikkeamana masterin liike säilyttää hienosäädön ja
   tallennettu tila on yksikäsitteinen: muoto = master + poikkeama. */
const SKIRTS = [{}, {}, {}, {}];
const NUDGE = SKIRTS.map(() => ({ y0: 0, y1: 0, hw0: 0, hw1: 0, arc: 0 }));

/* Kuusen muoto on säätimissä, ja siksi nämä ovat oliossa: säädin kirjoittaa
   avaimeen, ja `master()` + `shape()` lataavat luvut uudestaan. */
const SK = {
  top: 340, bot: 740, width: 116, taper: 0.62, lap: 0.30, pinch: 0.60,
  arc: -16, pow: 1.35, trunk: 26,
};
const SK_STEPS = 22;                 // portaita helmaa kohti, kiinteä määrä

/* Helman reunat paikan x funktiona, mitattuna rungon keskeltä. Sama kaava
   sekä piirtoon että törmäykseen, ja portaat ladotaan käyrän sisään: törmäys
   on hitusen piirrettyä pienempi, eli uloin neulanen ei tapa. */
const skTop = (s, x) => {
  const span = Math.max(1, s.hw1 - s.hw0);
  const t = Math.abs(x) <= s.hw0 ? 0
    : Math.pow(Math.min(1, (Math.abs(x) - s.hw0) / span), 1 / Math.max(0.2, SK.pow));
  return s.y0 + (s.y1 - s.y0) * t;
};
const skBot = (s, x) => {
  const u = Math.min(1, Math.abs(x) / Math.max(1, s.hw1));
  return s.y1 - s.drop * (1 - u * u);
};

const PAD_H = 18;

/* ------------------------------------------------------------------ seinät */

const SOLID = [];
/* add palauttaa saman olion jonka se työntää listaan eikä kopiota: kuusen
   laatikoita kirjoitetaan jälkikäteen (shape), ja kopio olisi jäänyt
   ikuisesti nollan kokoiseksi. */
const add = r => { r.hide = true; SOLID.push(r); return r; };

const TURF = add({ x: GRASS.x, y: GRASS.y, w: GRASS.w, h: GRASS.h, rock: true, turf: true });

/* Kuilujen suulla oli 22.9. kalliohuulet kattona, jottei luolaan sada.
   Sami poisti ne samana päivänä: **ne vaikeuttivat luolaan pääsyä liikaa**,
   eikä luolan tarvitse olla tähdiltä umpisuojassa. Kuiluun eksyvä tähti on
   nyt osa kenttää, ei vika. */

/* Latvus on pino laatikoita, ja se on myös se muoto joka piirretään. Porras on
   tahallaan näkyvä: kuusi jonka siluetti on pehmeämpi kuin sen törmäys olisi
   juuri se epäselvyys jota README kieltää. */
/* Laatikot varataan kerran ja ne pysyvät samoina olioina koko pelin ajan.
   Se on tässä pakko eikä tyylikysymys: peli kopioi `level.walls`in omaan
   WALLS-taulukkoonsa kentän latauksessa, joten uudet oliot eivät koskaan
   päätyisi törmäykseen. Kun säädin muuttaa muotoa, `shape()` kirjoittaa
   vanhojen laatikoiden sisään — ja leveydeltään nolla laatikko ei osu
   mihinkään, mikä on se tapa jolla liian ohut porras jää pois. */
for (const s of SKIRTS) {
  s.parts = [];
  for (let i = 0; i < SK_STEPS; i++) s.parts.push(add({ x: 0, y: 0, w: 0, h: 0, tree: true }));
}
TREE.stem = add({ x: 0, y: 0, w: 0, h: 0, stem: true });

/* Koko puu yhdestä oliosta: helmojen ylä- ja alareunat, leveydet ja kaari.
   `taper` on se miten nopeasti helmat levenevät alaspäin, `lap` niiden
   lomitus ja `pinch` se kuinka kapeana helma alkaa edellisen kärjestä. */
function master() {
  const n = SKIRTS.length;
  const h = Math.max(40, SK.bot - SK.top), step = h / n;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const s = SKIRTS[i], d = NUDGE[i];
    const hw1 = Math.max(6, SK.width * Math.pow((i + 1) / n, SK.taper));
    const y1 = SK.top + step * (i + 1);
    s.y1 = y1 + d.y1;
    s.y0 = y1 - step * (1 + SK.lap) + d.y0;
    s.hw1 = Math.max(6, hw1 + d.hw1);
    /* Yläleveys ei saa ohittaa kärkileveyttä: silloin kylki kääntyisi
       nurin ja helma luhistuisi yhdeksi viivaksi. */
    s.hw0 = Math.min(s.hw1 - 6, Math.max(0, (i === 0 ? 4 : prev * SK.pinch) + d.hw0));
    s.drop = SK.arc + d.arc;
    prev = hw1;                                 // seuraava helma seuraa masteria
  }
}

function shape() {
  for (const s of SKIRTS) {
    for (let i = 0; i < SK_STEPS; i++) {
      const xa = -s.hw1 + (2 * s.hw1) * (i / SK_STEPS);
      const xb = -s.hw1 + (2 * s.hw1) * ((i + 1) / SK_STEPS);
      const top = Math.max(skTop(s, xa), skTop(s, xb)) + 1;   // portaan sisin kohta
      const bot = Math.min(skBot(s, xa), skBot(s, xb)) - 1;
      const r = s.parts[i];
      r.x = TREE.cx + xa; r.y = top;
      r.h = Math.max(0, bot - top);
      r.w = r.h >= 4 ? xb - xa : 0;
    }
  }
  const last = SKIRTS[SKIRTS.length - 1];
  TREE.top = SKIRTS[0].y0;
  TREE.bot = last.y1;
  TREE.stem.x = TREE.cx - SK.trunk / 2;
  TREE.stem.y = last.y1 - 8;
  TREE.stem.w = SK.trunk;
  TREE.stem.h = Math.max(0, TREE.foot - last.y1 + 8);
}
master();
shape();

/* Säätimen liikahdus näkyy vasta kun luvut lasketaan uudestaan. Allekirjoitus
   on halvempi kuin muodon rakentaminen joka ruudulla.

   Yksi allekirjoitus riittää, koska helmat ovat poikkeamia: master ja
   poikkeama lasketaan aina samalla kaavalla, joten laskenta on toistettavissa
   eikä tallennettuja lukuja voi pyyhkiä vahingossa. */
let shapeSig = '';
function shapeCheck() {
  const sig = `${SK.top},${SK.bot},${SK.width},${SK.taper},${SK.lap},${SK.pinch},`
    + `${SK.arc},${SK.pow},${SK.trunk}|`
    + NUDGE.map(d => `${d.y0},${d.y1},${d.hw0},${d.hw1},${d.arc}`).join('|');
  if (sig === shapeSig) return;
  shapeSig = sig;
  master();
  shape();
}

/* Luolassa oli 22.9.2026 kolme isoa, törmäävää tippukiveä tekemässä siitä
   ahtaan. **Sami poisti ne luonnoksella samana päivänä** ("pois"), eli luola
   on nyt auki: hengähdyspaikka ilman esteitä. Taustan tippukivet jäivät, ks.
   DRIP — ne ovat perällä eikä niissä ole törmäystä. */

/* ------------------------------------------------------------------ alustat

   Nurmikon alustat ovat pinnan tasossa: alapuoli saa olla kiinni maassa,
   merkitystä on vain laskupinnalla. Luolan alustat ovat kaikki samassa
   tasossa, koska luola on hengähdyspaikka eikä sommitelma. */
/* Yläalustat ovat rungon vieressä **alimman helman alla**: oksa on niiden
   katto, ja siksi kupoleita ei enää ole. Uloin pää jää helman reunan ulkopuolelle,
   ja se on se kohta josta alustalle tullaan — joko suoraan ylhäältä siitä
   raosta tai oksan alta vaakalentona. Sami 22.9.2026: *"siirretään yläalusta
   lähemmäs runkoa, niin kupoleitakaan ei varmaan tarvi, oksat suojaa."* */
const PADS = [
  { id: 1, x: 234, y: GRASS.y - PAD_H + 6, w: 110 },
  { id: 2, x: 376, y: GRASS.y - PAD_H + 6, w: 110 },
  { id: 3, x: 56, y: 986, w: 124 },
  { id: 0, x: 298, y: 986, w: 124, fuel: true },
  { id: 4, x: 540, y: 986, w: 124 },
];

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

/* Alustalla suojaa oksa eikä kupoli. Kupoli oli 22.9.2026 nurmikon alustojen
   suoja, ja se poistui samana päivänä kun alustat siirtyivät oksien alle:
   kaksi suojaa samaan paikkaan on yksi liikaa, ja oksa on niistä se jonka
   pelaaja näkee ilman selitystä. */

/* Tähti rauhoittuu eikä nykäise: jarrutus paikallaan, sitten häivytys ja
   paluu kotiin. Sitä käytetään kun taksi kuolee — silloin koko taivas
   hiljenee, ja uusi tauko alkaa vasta kun taksi on taas ehjä. */
function calm(s) {
  if (s.state !== 'wind' && s.state !== 'fall') return;
  if (S.walls) {
    const i = S.walls.indexOf(s.box);
    if (i >= 0) S.walls.splice(i, 1);           // jarruttava tähti ei enää tapa
  }
  s.state = 'calm'; s.t = 0;
}

/* Säätimet luetaan piirrossa eikä päivityksessä. Syy on se, että **peli ajaa
   kentän `update`-koukun vain PLAY-tilassa**: tauolla, korttiruudussa ja
   sisääntulossa piirto jatkuu mutta päivitys ei. Kun muoto laskettiin vain
   päivityksessä, kuusen yhdeksästä säätimestä toimi tauolla kaksi — ne kaksi
   jotka sattuivat olemaan piirron omia lukuja. Sami 22.9.2026: *"mikäköhän
   tässä on koko ajan vain 2 alimmaista säädintä vaikuttaa"*. Kentän muotoa
   sommitellaan nimenomaan tauolla, joten tarkistus kuuluu tänne. */
function panelCheck() {
  shapeCheck();
  if (S.count !== SKY.count) field();
}

function update(dt, api) {
  S.walls = api.walls;
  panelCheck();
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
  for (const s of S.stars) {
    s.state = 'sky'; s.t = 0; s.v = 0; s.vx = 0; s.vy = 0; s.spin = 0;
    s.cx = s.hx; s.cy = s.hy;
  }
}

/* ------------------------------------------------------------------ piirto */

const fade = (c, a) => c + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

/* Kuusen alusta on **kokonaan vihreä**, ei kalliota jonka päällä on nurmea.
   Sami 22.9.2026: sivureiät näyttivät sitä huonommilta mitä enemmän niiden
   taustaa sävytti, ja ratkaisu oli tehdä maapalasta yksi selvä esine. Nyt
   raja on materiaali eikä varjo: vihreä on maata, tumma on reikä. */
function ground(ctx, r) {
  const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  g.addColorStop(0, '#3f7a44');
  g.addColorStop(0.35, '#2c5c33');
  g.addColorStop(1, '#17361f');
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  ctx.fillStyle = 'rgba(150,215,150,.35)';      // valoreuna ylhäällä
  ctx.fillRect(r.x, r.y, r.w, 3);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(r.x, r.y + r.h - 3, r.w, 3);

  ctx.fillStyle = 'rgba(86,150,100,.5)';        // ruohotupsut pinnalle
  for (let x = r.x + 3; x < r.x + r.w - 3; x += 8) {
    const h = 4 + ((x * 17) % 6);
    ctx.fillRect(x, r.y - h, 3, h);
  }
}

/* Helma piirretään samasta käyrästä josta törmäysportaat ladottiin: kylki
   ylhäältä ulos kärkeen, kärjestä alareunaa pitkin toiselle puolelle. */
function skirtPath(ctx, s, cx) {
  const N = 26;
  ctx.beginPath();
  ctx.moveTo(cx - s.hw1, skBot(s, -s.hw1));
  for (let i = 0; i <= N; i++) {
    const x = -s.hw1 + (2 * s.hw1) * (i / N);
    ctx.lineTo(cx + x, skTop(s, x));
  }
  for (let i = N; i >= 0; i--) {
    const x = -s.hw1 + (2 * s.hw1) * (i / N);
    ctx.lineTo(cx + x, skBot(s, x));
  }
  ctx.closePath();
}

function spruce(ctx, t) {
  const tw = SK.trunk / 2;                      // runko: kapeneva tyvi
  ctx.fillStyle = '#3b2a1b';
  ctx.beginPath();
  ctx.moveTo(t.cx - tw * 0.78, t.stem.y);
  ctx.lineTo(t.cx + tw * 0.78, t.stem.y);
  ctx.lineTo(t.cx + tw, t.foot);
  ctx.lineTo(t.cx - tw, t.foot);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(150,190,255,.10)';
  ctx.fillRect(t.cx - tw * 0.78, t.stem.y, 3, t.foot - t.stem.y);

  for (let i = SKIRTS.length - 1; i >= 0; i--) {  // alin ensin, ylimmät päälle
    const s = SKIRTS[i];
    skirtPath(ctx, s, t.cx);
    const g = ctx.createLinearGradient(t.cx - s.hw1, s.y0, t.cx + s.hw1, s.y1);
    g.addColorStop(0, '#2b5c33');                // valo ylävasemmalta
    g.addColorStop(1, '#16351d');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#0d2312';                 // sama tumma ääriviiva kuin mallissa
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();                                  // vaaleat mutkat helman sisään
    ctx.clip();
    ctx.strokeStyle = 'rgba(126,196,136,.28)';
    ctx.lineWidth = 3.4;
    for (let k = 1; k <= 3; k++) {
      const yy = s.y0 + (s.y1 - s.y0) * (0.34 + k * 0.17);
      ctx.beginPath();
      for (let x = -s.hw1 + 8; x <= s.hw1 - 8; x += 7) {
        const y = yy + Math.sin((x + k * 31) / 9) * 2.6;
        if (x === -s.hw1 + 8) ctx.moveTo(t.cx + x, y); else ctx.lineTo(t.cx + x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* Kaukametsä nurmikon takana. **Sama muoto kuin isolla kuusella**, koska se
   saadaan halvalla: helmojen luvut lasketaan samalla kaavalla yksikkökokoiseen
   puuhun, siitä tehdään yksi Path2D kerran, ja jokainen puu on sen siirto ja
   skaalaus. Sami luonnoksella 22.9.2026: koko oli hyvä mutta muoto väärä, ja
   korkeutta 2,5-kertaisesti.

   Path2D rakennetaan vasta piirrossa eikä moduulin latauksessa, koska
   kenttätiedostot ajetaan myös nodessa eikä siellä ole Path2D:tä. */
const FAR = [];
for (let x = -30; x < W + 50; x += 31) {
  const h = (52 + ((x * 29) % 44)) * 2.5;
  FAR.push({ x, h, w: h * 0.46 });
}

/* Helmojen luvut mille tahansa kuuselle samalla kaavalla kuin masterissa. */
function skirtsFor(top, bot, width, n) {
  const out = [], step = (bot - top) / n;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const hw1 = Math.max(0.001, width * Math.pow((i + 1) / n, SK.taper));
    const y1 = top + step * (i + 1);
    out.push({
      y1, y0: y1 - step * (1 + SK.lap),
      hw1, hw0: Math.min(hw1 * 0.9, i === 0 ? width * 0.04 : prev * SK.pinch),
      drop: SK.arc * (bot - top) / 400,
    });
    prev = hw1;
  }
  return out;
}

let farPath = null;
function farTreePath() {
  if (farPath) return farPath;
  const p = new Path2D();
  for (const s of skirtsFor(0, 1, 0.5, 3)) {     // yksikköpuu: leveys 1, korkeus 1
    const N = 18;
    p.moveTo(-s.hw1, skBot(s, -s.hw1));
    for (let i = 0; i <= N; i++) { const x = -s.hw1 + 2 * s.hw1 * (i / N); p.lineTo(x, skTop(s, x)); }
    for (let i = N; i >= 0; i--) { const x = -s.hw1 + 2 * s.hw1 * (i / N); p.lineTo(x, skBot(s, x)); }
    p.closePath();
  }
  p.moveTo(-0.03, 0.86); p.lineTo(0.03, 0.86); p.lineTo(0.03, 1); p.lineTo(-0.03, 1);
  farPath = p;
  return p;
}

function farForest(ctx) {
  const p = farTreePath();
  ctx.fillStyle = '#12202a';
  for (const f of FAR) {
    ctx.save();
    ctx.translate(f.x, GRASS.y - f.h);
    ctx.scale(f.w, f.h);
    ctx.fill(p);
    ctx.restore();
  }
  const g = ctx.createLinearGradient(0, GRASS.y - 150, 0, GRASS.y);
  g.addColorStop(0, 'rgba(20,38,58,0)');
  g.addColorStop(1, 'rgba(20,38,58,.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, GRASS.y - 150, W, 150);
}

/* **Yksi tumma tausta kaukametsästä alaspäin**, ei erillistä väriä luolalle
   eikä kuilun suulle. Kuilu on reikä vihreässä maassa, ja reiästä näkyy sama
   tumma kuin kaiken muunkin takana — silloin siihen ei tarvita sävytystä
   eikä varjoa, ja se lakkaa näyttämästä omalta esineeltään. Tie tähän kulki
   kahden huonomman kautta: ensin koko leveyden liuku (sotki maapalan reunat),
   sitten kuilun suu omalla värillään (harmaa palkki maapalan alla). Sami
   22.9.2026. */
function backdrop(ctx) {
  const y0 = GRASS.y - 200;
  const g = ctx.createLinearGradient(0, y0, 0, GRASS.y - 30);
  g.addColorStop(0, 'rgba(8,14,26,0)');
  g.addColorStop(1, '#080e1a');
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, W, GRASS.y - 30 - y0);
  ctx.fillStyle = '#080e1a';
  ctx.fillRect(0, GRASS.y - 30, W, H - (GRASS.y - 30));
}

/* ------------------------------------------------------------------- luola */

/* Taustan tippukivet, ei törmäystä. **Vain vihreän maapalan alta ja siitäkin
   keskemmältä**: kuilujen suulla ne näyttivät siltä kuin reikä olisi täynnä
   piikkejä. Sami 22.9.2026. */
const DRIP = [];
for (let i = 0; i < 13; i++) {
  DRIP.push({
    x: GRASS.x + 44 + ((i * 137) % (GRASS.w - 120)),
    h: 20 + ((i * 53) % 34), w: 10 + ((i * 31) % 14),
  });
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

function back(ctx) {
  panelCheck();                                 // säädin voi liikkua myös tauolla
  sky(ctx);                                     // lepäävät tähdet ovat taustaa
  farForest(ctx);
  cave(ctx);
  spruce(ctx, TREE);
  ground(ctx, TURF);
}

function front(ctx, api) {
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
    /* Kuusen muoto säätimiin, Samin pyynnöstä 22.9.2026. Helma kerrallaan,
       koska juuri niitä lukuja kentässä siirretään: y0 ja y1 ovat helman ylä-
       ja alareuna, hw0 ja hw1 sen puolileveys näissä, ja drop se kuinka
       paljon alareunan keskikohta on kärkiä ylempänä — eli viiksien nuokku. */
    { name: 'kuusi', obj: SK, open: false, sliders: [
      { key: 'top', label: 'latva y', min: 120, max: 700, step: 2 },
      { key: 'bot', label: 'tyvi y', min: 300, max: 780, step: 2 },
      { key: 'width', label: 'leveys tyvessä', min: 20, max: 220, step: 2 },
      { key: 'taper', label: 'kapeneminen ylöspäin', min: 0.2, max: 1.6, step: 0.02 },
      { key: 'lap', label: 'helmojen lomitus', min: 0, max: 1.2, step: 0.02 },
      { key: 'pinch', label: 'helman kavennus', min: 0, max: 1, step: 0.02 },
      { key: 'arc', label: 'alareunan kaari −hymy +nuokku', min: -70, max: 70, step: 1 },
      { key: 'pow', label: 'kyljen kaarevuus', min: 0.6, max: 3, step: 0.05 },
      { key: 'trunk', label: 'rungon paksuus', min: 8, max: 60, step: 1 },
    ] },
    /* Helmakohtaiset säätimet ovat pois 22.9.2026: ne eivät toimineet
       odotetusti, ja Sami pyysi ottamaan ne hetkeksi pois. Koneisto on
       tallella (NUDGE, poikkeama masterin päälle), eli takaisin ne saa
       lisäämällä ryhmät tähän. */
    { name: 'kentän kertoimet', open: false, mul: ['grav', 'thrust', 'landVX'] },
  ],
  init,
  update,
  drawBack: back,
  drawFront: front,
};
