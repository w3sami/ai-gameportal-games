/* Tulivuori — viidakon yllä leijuva tulivuori.
 *
 * Yksi kenttä per tiedosto, jotta kaksi tekijää voi työstää eri kenttiä
 * yhtä aikaa kirjoittamatta toistensa yli. Kentän muoto on kuvattu
 * ../levels.js:ssä.
 *
 * Vuori on **tasasivuinen kolmio, kärki ylös**, ja se roikkuu ruudun keskellä
 * nojaamatta mihinkään. Sen alta pääsee lentämään läpi kummaltakin puolelta,
 * ja kenttä on siksi rengas: kaikki kiertää yhtä kappaletta kiveä.
 *
 *   kraatteri   kolmion katkaistulla laella. Purkaus syöksee 1–4 magmapalloa,
 *               suurin taksin kokoinen ja pienin 70 % siitä.
 *   alustat     kahdeksan, **kaikki ruudun laitoihin kiinni**, neljällä
 *               korkeudella ja neljä kummallakin puolella.
 *   tankkaus    lattialla suoraan vuoren alla. Kentän ainoa turvapaikka.
 *
 * Kulkuväylä on alustan ja vuoren välissä, ja se on 74 px kun taksi on 54.
 * Niukka mutta ei ahdas: vaikeus tulee ajoituksesta eikä ahtaudesta.
 *
 * Kolme sääntöä joilla tämä pysyy rehellisenä:
 *
 *   1. **Magmapallo on seinä.** Se työnnetään pelin WALLS-taulukkoon ja
 *      poistetaan sieltä kun se roiskahtaa, joten törmäys on pelin omaa eikä
 *      kentän. Peli ei piirrä sitä (`hide`), koska laatikko ei ole pallon
 *      näköinen — piirto on tässä tiedostossa, ja laatikko on tahallaan
 *      hieman piirrettyä pienempi.
 *   2. **Vuoren alla on turvassa fysiikan takia, ei säännön.** Pallo lähtee
 *      kraatterista aina *ulospäin* eikä sen vaakanopeus vaihda merkkiä
 *      koskaan. Vasemmalle lähtenyt on siis ikuisesti menossa vasemmalle, eikä
 *      se voi palata vuoren alle sen jälkeen kun se on ohittanut kyljen.
 *      Kolmio on lisäksi umpinaista kiveä koko leveydeltään. **Kumpikaan ehto
 *      yksin ei riitä**, ja jos tankkausta siirtää vuoren varjon ulkopuolelle,
 *      tämä on se mikä menee rikki. 20 000 lähdön simulaatio antaa
 *      tankkaukselle nollan; muut luvut ovat volcano.md:ssä.
 *   3. **Vain vuori tärisee.** Tärinä on piirron siirto eikä fysiikkaa, ja se
 *      on siksi pidetty pienenä (`quake`, enintään 5 px). Ruutu ja alustat
 *      eivät liiku lainkaan: varoituksen aikana laskeutumisen pitää olla yhtä
 *      tarkkaa kuin muulloin, muuten varoitus rankaisisi siitä että sen
 *      huomasi. Sami 23.9.2026: *"vain vuori tärisee."*
 *
 * **Piirto ja törmäys ovat eri muotoisia, ja se on tahallista.** Ensimmäinen
 * versio rakensi vuoren laatikoista ja piirsi ne laatikkoina; Sami sanoi mitä
 * se näytti: atsteekkitemppeliltä. Vika ei ollut moottorissa vaan siinä, että
 * konventiota noudatettiin väärään suuntaan. Oikea järjestys on tämä:
 *
 *   **siluetti piirretään yhtenä käyränä, ja törmäys ladotaan sen sisään.**
 *
 * Penkat ovat `ISLE.inset` verran kapeampia kuin piirretty reuna, ja rosoisuus
 * kuuluu kokonaan piirtoon. Silloin kaikki mikä tappaa on sen sisällä minkä
 * pelaaja näkee — kallion uloin roso ei tapa — mutta näkymätöntä seinää ei ole
 * missään. Sama anteeksiantava suunta kuin magmapallon törmäyslaatikossa, joka
 * on 0,68 × pallon halkaisija, ja sama kuin Shooting Starsin kuusessa.
 *
 * Muoto on siksi laskettu eikä kirjoitettu: sitä sommitellaan säätimistä
 * (`ISLE`), ja `shape()` lataa luvut samoihin laatikoihin joita törmäys jo
 * käyttää.
 */

import { W, H, CEIL } from './shared.js';

/* ------------------------------------------------------------------ mitat */

const FLOOR = H - 16;                 // kehäseinän lattia
const PAD_H = 18;                     // pelin oletus, ks. game.js loadLevel

/* Vuori on **tasasivuinen kolmio, kärki ylös**. Sami 23.9.2026, kahden
   hylätyn version jälkeen: pystysuora laatikkopino oli atsteekkitemppeli ja
   kaareva profiili ampiaispesä. Kolmio on se muoto jonka kaikki lukee vuoreksi
   ilman selitystä, eikä siinä ole mitään säädettävää kaarevuutta.

   Kärki on katkaistu kraatterin kohdalta: `rim` on puolileveys katkaisutasolla
   ja `chw` kraatterin puoliaukko, joten laelle jää kaksi `rim − chw` levyistä
   huulta. **`bot` lasketaan tasasivuisuudesta eikä kirjoiteta**: sivun kulma on
   60°, eli korkeus on (hw − rim) / tan 30°. Jos leveyttä muuttaa, kolmio pysyy
   tasasivuisena itsestään.

     rough   reunan rosoisuus **piirrossa**. Törmäys ei tiedä siitä mitään.
     inset   kuinka paljon törmäys on piirrettyä kapeampi. Tämän on katettava
             sekä rosoisuus että penkkaportaan leveys, tai kolmion viistoon
             reunaan jäisi näkymätöntä seinää. */
/* Nämä ovat **Samin säätöpaneelista hakemat luvut** 23.9.2026, ja koodin
   oletukset on synkattu niihin. `config/tune.json` voittaa koodin oletukset
   kaikilla pelaajilla, joten jos nämä kaksi eroavat, tiedosto on se joka
   pelataan ja koodi valehtelee lukijalle.

   Vuori seisoo tässä virityksessä lattialla eikä leiju: tyvi on y 1021 ja
   lattia 1024. Leijuminen oli välivaihe, ja sen jäljiltä koodissa ei ole
   mitään joka vaatisi ilmaa alapuolelle — `top` on ainoa luku joka nostaa
   sen takaisin. */
const ISLE = {
  cx: 370, top: 754, hw: 212, rim: 58, chw: 60, rough: 4, inset: 11,
};
const TAN30 = Math.tan(Math.PI / 6);
const isleBot = () => ISLE.top + (ISLE.hw - ISLE.rim) / TAN30;

const BAND_N = 16;                    // penkkoja, kiinteä määrä
const RIM_BANDS = 5;                  // ylimmät halkaistaan kraatteriksi

/* ------------------------------------------------------------------ seinät

   add palauttaa saman olion jonka se työntää listaan eikä kopiota: peli
   kopioi `level.walls`in taulukkona mutta jakaa oliot kentän kanssa, joten
   muodon saa vaihtaa vain kirjoittamalla vanhan olion sisään. Uusi olio ei
   päädy törmäykseen koskaan. */

const SOLID = [];
const add = r => { r.hide = true; SOLID.push(r); return r; };

/* Penkat varataan kerran. Halkaistuilla on kaksi laatikkoa, muilla yksi ja
   toinen jää nollan levyiseksi — nollan levyinen ei osu mihinkään, ja se on
   siistimpi tapa jättää laatikko pois kuin poistaa se listalta, joka rikkoisi
   jaetut viittaukset. */
const BANDS = [];
for (let i = 0; i < BAND_N; i++) {
  BANDS.push({
    l: add({ x: 0, y: 0, w: 0, h: 0, rock: true }),
    r: add({ x: 0, y: 0, w: 0, h: 0, rock: true }),
  });
}

/* Puolileveys korkeudella y: suora viiva kärjestä tyveen. */
function halfWidth(y) {
  const bot = isleBot();
  const u = Math.max(0, Math.min(1, (y - ISLE.top) / Math.max(1, bot - ISLE.top)));
  return ISLE.rim + (ISLE.hw - ISLE.rim) * u;
}

function shape() {
  const bot = isleBot();
  const step = (bot - ISLE.top) / BAND_N;
  for (let i = 0; i < BAND_N; i++) {
    const y = ISLE.top + step * i;
    /* Leveys luetaan penkan **yläreunasta**, koska kolmio levenee alaspäin:
       silloin laatikko on kapeampi kuin viiste koko matkaltaan, ja yhdessä
       `inset`in kanssa se pysyy varmasti piirretyn reunan sisällä. */
    const half = Math.max(3, halfWidth(y) - ISLE.inset);
    const x0 = ISLE.cx - half, x1 = ISLE.cx + half;
    const b = BANDS[i];
    if (i < RIM_BANDS) {
      /* Kraatterin aukko on törmäyksessä leveämpi kuin piirretty: sama sääntö
         toisin päin, koska tässä kiveä on aukon *ulkopuolella*. */
      const g0 = ISLE.cx - ISLE.chw - ISLE.inset, g1 = ISLE.cx + ISLE.chw + ISLE.inset;
      b.l.x = x0; b.l.y = y; b.l.w = Math.max(0, g0 - x0); b.l.h = step;
      b.r.x = g1; b.r.y = y; b.r.w = Math.max(0, x1 - g1); b.r.h = step;
    } else {
      b.l.x = x0; b.l.y = y; b.l.w = x1 - x0; b.l.h = step;
      b.r.x = 0; b.r.y = 0; b.r.w = 0; b.r.h = 0;
    }
  }
}
shape();

let shapeSig = '';
/* Säätimet luetaan piirrossa eikä päivityksessä: peli ajaa kentän `update`in
   vain PLAY-tilassa, ja vuorta sommitellaan nimenomaan tauolla. */
function panelCheck() {
  const sig = `${ISLE.top},${ISLE.hw},${ISLE.rim},${ISLE.chw},${ISLE.inset},${ISLE.cx}`;
  if (sig === shapeSig) return;
  shapeSig = sig;
  shape();
}

/* ---------------------------------------------------------------- alustat

   Kahdeksan numeroitua: kaksi kiinni saaressa ja kuusi ruudun laidoilla,
   kolme kummallakin. Leveys 150 px eli 1,25 × entinen — Sami 23.9.2026.

   Tankkaus on lattialla suoraan saaren alla. Se on koko kentän lupaus:
   ulkona ei ole turvaa, sisällä ei ole keikkoja. */
const PADS = [
  /* **Kahdeksan alustaa tasaisin välein laitoihin kiinni**, neljä kummallakin
     puolella. Sami 23.9.2026. Kulkuväylä on alustan ja vuoren välissä. */
  { id: 1, x: 16,  y: 190, w: 150 },
  { id: 2, x: 295, y: 300, w: 150 },    // keskellä, suoraan kraatterin yllä
  { id: 3, x: 16,  y: 443, w: 150 },
  { id: 4, x: 554, y: 443, w: 150 },
  { id: 5, x: 16,  y: 697, w: 150 },
  { id: 6, x: 554, y: 697, w: 150 },
  { id: 7, x: 16,  y: 950, w: 150 },
  { id: 8, x: 554, y: 950, w: 150 },
  /* Tankkaus ylös laitaan, **pois keskilinjalta**. Se oli ensin keskellä
     kraatterin yläpuolella, ja Samin nostettua `vmax`in 620:een se oli
     mittauksessa koko kentän pommitetuin alusta (15,8 %) — juuri se paikka
     jossa pitää istua paikallaan pisimpään. Laidalla osuma on 7 %. Sami
     ehdotti tätä itse: *"voisin kokeilla vaihtaa bensan toisen yläalustan
     paikalle."* Vaihto on kahden rivin mittainen kumpaankin suuntaan. */
  { id: 0, x: 554, y: 190, w: 150, fuel: true },
];

/* ---------------------------------------------------------------- purkaus

   Purkaus on kaksi vaihetta: varoitus ja syöksy. Varoitus on se mistä kenttä
   pelataan — savu tihenee, kipinät lentävät ja vuori tärisee kiihtyvästi,
   ja pelaaja päättää sen aikana laskeutuuko vai odottaako. Ilman varoitusta
   alustalle laskeutuminen olisi arpapeliä, ja se on eri peli.

   Vuori tupruttaa savua myös silloin kun mitään ei ole tulossa. Se on tahallaan:
   varoitus on savun *muutos*, ja muutosta ei näe ellei ole mitä vertailla. */

const ERUPT = {
  freq: 0.6,          // purkauksia sekunnissa
  warn: 2.6,          // varoituksen kesto s
  grace: 3,           // tauko kentän alussa ja kuoleman jälkeen s
  nmin: 3, nmax: 8,   // palloja purkauksessa
  vmin: 290, vmax: 430,
  amin: 6, amax: 26,  // lähtökulma pystystä, astetta
  spit: 0.3,          // purkauksen sisäinen sylkyväli s
  size: 1,
  quake: 3,           // vuoren tärinä px — vain piirto, ks. sääntö 3
};

const TRAIL = { rate: 56, life: 0.3, size: 3.6, spread: 12 };
const SMOKE = { rate: 9, life: 3.2, size: 19, rise: 40, drift: 12, boost: 6 };
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
  balls: [], bits: [], smoke: [], pending: [],
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
    x: ISLE.cx + between(-6, 6) * dir, y: ISLE.top + 8,
    vx: Math.sin(a) * v * dir, vy: -Math.cos(a) * v,
    r, t: 0, puff: 0, hot: between(0, 1), spin: between(-2, 2),
    box: { x: 0, y: 0, w: side, h: side, hide: true, magma: true },
  });
}

/* Pallot eivät lähde samalla ruudulla. Ensimmäisessä ajossa ne lähtivät, ja
   silloin purkaus oli yksi köntti joka hajosi vasta ilmassa — vuori sylkee,
   se ei ammu haulikolla. Jokainen saa oman pienen viiveensä. */
function blow() {
  const n = Math.round(between(ERUPT.nmin, ERUPT.nmax + 0.49));
  for (let i = 0; i < n; i++) S.pending.push(i === 0 ? 0 : between(0.04, ERUPT.spit) * i);
  S.jolt = 1;
}

function puffSmoke(dt, heat) {
  const rate = SMOKE.rate * (1 + heat * (SMOKE.boost - 1));
  S.smokeT -= dt;
  while (S.smokeT <= 0) {
    S.smokeT += 1 / Math.max(0.5, rate);
    S.smoke.push({
      x: ISLE.cx + between(-26, 26), y: ISLE.top + between(-4, 10),
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
      x: ISLE.cx + between(-28, 28), y: ISLE.top + between(0, 14),
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
  S.pending.length = 0;
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

  for (let i = S.pending.length - 1; i >= 0; i--) {
    S.pending[i] -= dt;
    if (S.pending[i] <= 0) { S.pending.splice(i, 1); launch(); }
  }

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
    /* Patsas huojuu, se ei leviä. Ensimmäisessä ajossa savu työnnettiin
       keskeltä ulospäin, ja silloin se ei näyttänyt patsaalta vaan kahdelta
       harmaalta pisterivilta jotka valuivat ruudun laitoja kohti. */
    p.vx += Math.sin(p.y * 0.013 + p.max) * 9 * dt;
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
  S.pending.length = 0;
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

/* Neljä harjannekerrosta, ylin melkein kattoon asti. Sami 23.9.2026:
   *"taustan himmeät vuoret voisivat jatkua 1 kerroksella lisää eli ylös
   asti."*

   **Yhdelläkään ei ole terävää ylärajaa.** Kerros piirretään pystyliu'ulla
   joka on läpinäkyvä harjanteen korkeimman huipun *yläpuolella* ja täysi
   vasta sen alimman notkon *alapuolella* — muuten harjanne piirtyisi
   paikoin täydellä värillä heti reunastaan, ja juuri siitä syntyi se viiva
   jonka Sami näki ruudun yläneljänneksessä. Ks. myös `haze` alempana. */
const RIDGE_BASE = [120, 240, 360, 480];
const RIDGE_JIT = 46;
const RIDGE = RIDGE_BASE.map(base => {
  const pts = [];
  for (let x = -40; x <= W + 40; x += 60) pts.push({ x, y: base + fbet(-RIDGE_JIT, RIDGE_JIT) });
  return pts;
});

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

/* Rungot ja liaanit reunoilla. Ne ovat pelkkää pystyviivaa, mutta ne antavat
   lehvästölle jotain mistä kasvaa — ilman niitä viuhkat leijuivat tyhjässä. */
const TRUNKS = [];
for (let i = 0; i < 7; i++) {
  const left = i % 2 === 0;
  TRUNKS.push({
    x: left ? fbet(-10, 92) : fbet(W - 92, W + 10),
    top: fbet(300, 560), w: fbet(9, 22), lean: fbet(-18, 18),
  });
}

function jungle(ctx) {
  const t = clock();

  /* Kaukaiset harjanteet — mitä kauempana, sitä lähempänä taivaan väriä. */
  /* Sävyt ovat lähellä toisiaan mutta eivät samoja: ilman eroa kerrokset
     katosivat yhdeksi tasaiseksi vihreäksi, ja syvyys on se mitä niillä
     haetaan. Ero saa olla pieni juuri siksi, että liukuma hoitaa reunan. */
  const tone = ['#141f1a', '#1a2921', '#21342a', '#293f31'];
  for (let i = 0; i < RIDGE.length; i++) {
    const base = RIDGE_BASE[i];
    const gr = ctx.createLinearGradient(0, base - RIDGE_JIT - 40, 0, base + RIDGE_JIT + 90);
    gr.addColorStop(0, tone[i] + '00');
    gr.addColorStop(1, tone[i]);
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(-40, H);
    for (const p of RIDGE[i]) ctx.lineTo(p.x, p.y);
    ctx.lineTo(W + 40, H);
    ctx.fill();
  }

  /* Utu harjanteiden päälle, jotta kivi erottuu niistä ilman epäilystä.
     Läpinäkyvä molemmista päistä: terävä alku oli toinen puoli samaa viivaa. */
  const haze = ctx.createLinearGradient(0, 0, 0, 860);
  haze.addColorStop(0, '#6a7f6600');
  haze.addColorStop(0.32, '#6a7f6626');
  haze.addColorStop(1, '#6a7f6600');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, W, 860);

  ctx.strokeStyle = '#142218';
  for (const tr of TRUNKS) {
    ctx.lineWidth = tr.w;
    ctx.beginPath();
    ctx.moveTo(tr.x, tr.top);
    ctx.quadraticCurveTo(tr.x + tr.lean, (tr.top + H) / 2, tr.x + tr.lean * 1.6, H);
    ctx.stroke();
  }

  for (const f of FRONDS) frond(ctx, f, t);
}

/* ---- vuori */

/* ---- saari

   Siluetti on **yksi käyrä** ja rosoisuus kuuluu siihen. Törmäys on käyrän
   sisällä (`ISLE.inset`), joten kallion uloin roso ei tapa eikä näkymätöntä
   seinää ole missään. Ks. tiedoston alku.

   Roso on sinien summa eikä arvottu taulukko: se seuraa muotoa itsestään kun
   säädintä liikutetaan, eikä sitä tarvitse ladata uudestaan. */

const PIT_D = () => (isleBot() - ISLE.top) / BAND_N * RIM_BANDS;

const jag = (y, k) => Math.sin(y * 0.37 + k) * 0.55 + Math.sin(y * 0.94 + k * 2.3) * 0.45;
const edge = (y, side) => ISLE.cx + side * (halfWidth(y) + jag(y, side > 0 ? 3.1 : 0.4) * ISLE.rough);

function islePath(ctx) {
  const N = 64, span = isleBot() - ISLE.top, d = PIT_D(), g = ISLE.chw;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const y = ISLE.top + span * (i / N), x = edge(y, -1);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  for (let i = N; i >= 0; i--) {
    const y = ISLE.top + span * (i / N);
    ctx.lineTo(edge(y, 1), y);
  }
  /* Kraatterin kolo laen keskelle. Se on oikea kolo: törmäyksessä sen aukko on
     vielä piirrettyäkin leveämpi, joten reunalle ei voi jäädä kiinni siihen
     mitä ei näe. */
  ctx.lineTo(ISLE.cx + g, ISLE.top);
  ctx.lineTo(ISLE.cx + g * 0.74, ISLE.top + d);
  ctx.lineTo(ISLE.cx - g * 0.74, ISLE.top + d);
  ctx.lineTo(ISLE.cx - g, ISLE.top);
  ctx.closePath();
}

/* Laavajuonteet. Ne olivat ensimmäisen version paras osa — Sami 23.9.2026:
   *"vuorta pitkin valuva laava on erinomainen"* — ja sileällä kyljellä ne
   pääsevät vasta oikeuksiinsa: juonne seuraa muotoa eikä katkea penkan
   saumaan. Jokainen lähtee kraatterin reunalta ja haarautuu alas kölille. */
const VEINS = [];
for (let i = 0; i < 9; i++) {
  VEINS.push({
    side: i % 2 ? 1 : -1,
    f0: 0.12 + (i % 5) * 0.16,          // etäisyys keskilinjasta lähdössä
    f1: 0.52 + ((i * 7) % 5) * 0.09,    // ja alhaalla
    wig: 0.9 + ((i * 3) % 4) * 0.5,
    w: 1.6 + ((i * 5) % 3) * 0.9,
    end: 0.72 + ((i * 11) % 4) * 0.07,  // kuinka alas asti juonne yltää
  });
}

function veins(ctx, heat, t) {
  const span = isleBot() - ISLE.top, d = PIT_D();
  for (const v of VEINS) {
    const steps = 16;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const y = ISLE.top + d + (span - d) * u * v.end;
      const f = v.f0 + (v.f1 - v.f0) * u;
      const wig = Math.sin(u * 5.4 * v.wig + v.f0 * 9) * 0.07;
      const x = ISLE.cx + v.side * halfWidth(y) * Math.min(0.93, f + wig);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    /* Kirkkaus hengittää omalla kellollaan ja kasvaa varoituksen mukana.
       Levossakin juonne hohtaa hiukan: vuori on kuuma koko ajan, ja varoitus
       on sen *muutos*. */
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.1 + v.f0 * 11);
    ctx.strokeStyle = fade('#ff5a14', 0.18 + heat * 0.5 + pulse * 0.1);
    ctx.lineWidth = v.w + heat * 1.6;
    ctx.stroke();
    ctx.strokeStyle = fade('#ffd07a', 0.1 + heat * 0.45);
    ctx.lineWidth = Math.max(0.6, v.w * 0.4);
    ctx.stroke();
  }
}

function isle(ctx, heat, t) {
  const bot = isleBot(), span = bot - ISLE.top, d = PIT_D();

  /* Alapuolen hohde: köli on kuuma, ja se on myös se merkki joka kertoo ettei
     saari nojaa mihinkään. Pelkkä hohde eikä pisaroita — putoava laavapisara
     näyttäisi magmapallolta, ja silloin kenttä valehtelisi. */
  const glow = ctx.createRadialGradient(ISLE.cx, bot - 6, 4, ISLE.cx, bot - 6, 150 + heat * 60);
  glow.addColorStop(0, fade('#ff7a2c', 0.24 + heat * 0.22));
  glow.addColorStop(1, '#ff7a2c00');
  ctx.fillStyle = glow;
  ctx.fillRect(ISLE.cx - 240, bot - 150, 480, 300);

  ctx.save();
  islePath(ctx);
  const body = ctx.createLinearGradient(0, ISLE.top, 0, bot);
  body.addColorStop(0, '#4a4038');
  body.addColorStop(0.45, '#332c26');
  body.addColorStop(1, '#221c18');
  ctx.fillStyle = body;
  ctx.fill();

  ctx.clip();

  /* Kerrostumat. Väli ja kirkkaus vaihtelevat: tasavälinen juovitus näytti
     korilta eikä kivikerrostumalta. */
  let y = ISLE.top + 10;
  for (let i = 0; y < bot; i++) {
    const gap = 9 + ((i * 29) % 17);
    ctx.fillStyle = (i % 3) ? `#0000001${(i % 6) + 2}` : '#ffffff09';
    ctx.fillRect(ISLE.cx - 220, y, 440, 2 + ((i * 7) % 4));
    y += gap;
  }

  // valo ylävasemmalta: kirkas kaistale vasenta kylkeä pitkin
  ctx.strokeStyle = '#6d5c4d55';
  ctx.lineWidth = 7;
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const y = ISLE.top + span * (i / 60), x = edge(y, -1);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // halkeamia, kiinteä kuvio jotta ne eivät vilku
  ctx.strokeStyle = '#00000040';
  ctx.lineWidth = 2;
  for (let i = 0; i < 16; i++) {
    const y = ISLE.top + d + ((i * 37) % 100) / 100 * (span - d);
    const f = ((i * 53) % 100) / 100 * 1.6 - 0.8;
    const x = ISLE.cx + halfWidth(y) * f;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (((i * 17) % 9) - 4), y + 9 + ((i * 29) % 14));
    ctx.stroke();
  }

  /* Kraatterin huulet valoon — **kaksi palaa, ei yhtä yli kolon**. Yhtenä
     palkkina piirrettynä valo jatkui aukon yli ja lakeen tuli kirkas viiva
     joka näytti pöydältä. Kolon sisus on täysin musta: sen pohjalla oleva
     lampi on ainoa asia joka sieltä näkyy. */
  const lipW = halfWidth(ISLE.top) - ISLE.chw + 8;
  ctx.fillStyle = '#0d0a08';
  ctx.fillRect(ISLE.cx - ISLE.chw, ISLE.top, ISLE.chw * 2, d);
  ctx.fillStyle = '#6a5a4a';
  ctx.fillRect(ISLE.cx - ISLE.chw - lipW, ISLE.top, lipW, 5);
  ctx.fillRect(ISLE.cx + ISLE.chw, ISLE.top, lipW, 5);

  veins(ctx, heat, t);

  /* Kraatterin lampi kolon pohjalla. Pinta elää omalla kellollaan. */
  const py = ISLE.top + d - 7;
  const pool = ctx.createLinearGradient(0, py - 4, 0, py + 9);
  pool.addColorStop(0, fade('#ffdc96', 0.6 + heat * 0.4));
  pool.addColorStop(1, fade('#e0500f', 0.65 + heat * 0.35));
  ctx.fillStyle = pool;
  ctx.fillRect(ISLE.cx - ISLE.chw * 0.72, py + Math.sin(t * 1.3) * 1.4, ISLE.chw * 1.44, 12);
  ctx.restore();

  /* Hehku kolon päälle, klippauksen ulkopuolella: se saa vuotaa taivaalle. */
  const g = 0.3 + heat * 0.7;
  const gl = ctx.createRadialGradient(ISLE.cx, ISLE.top + d - 4, 4, ISLE.cx, ISLE.top + d - 4, 70 + heat * 60);
  gl.addColorStop(0, fade('#ffcf7a', 0.5 * g));
  gl.addColorStop(0.45, fade('#ff6a22', 0.32 * g));
  gl.addColorStop(1, '#ff6a2200');
  ctx.fillStyle = gl;
  ctx.fillRect(ISLE.cx - 150, ISLE.top - 90, 300, 190);
}

function mountain(ctx, heat) {
  const t = clock();
  const q = S.quake;
  ctx.save();
  if (q > 0.01) ctx.translate(nz(t, 41) * q, nz(t, 57) * q * 0.55);
  isle(ctx, heat, t);
  ctx.restore();
}

/* ---- hiukkaset ja pallot */

function smokeDraw(ctx) {
  ctx.save();
  for (const p of S.smoke) {
    const k = Math.max(0, p.life / p.max);
    const r = Math.max(1, p.r * (2.2 - k * 1.2));
    /* Varoituksen savu on lämpimämpää ja tummempaa kuin levon savu: sama
       patsas, eri väri, ja se ero on toinen puoli varoitusta. */
    ctx.fillStyle = fade(p.heat > 0.35 ? '#6d5344' : '#57565a', 0.5 * k * (1.2 - k * 0.4));
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
  ctx.fillStyle = '#41231a55';
  for (let i = 0; i < 7; i++) {
    const a = b.spin * t + i * 0.92;
    const d = 0.18 + ((i * 37) % 11) / 18;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * b.r * d, Math.sin(a * 1.3) * b.r * d,
      Math.max(0.8, b.r * (0.08 + (i % 3) * 0.04)), Math.max(0.6, b.r * 0.07), a, 0, 6.3);
    ctx.fill();
  }
  ctx.restore();
}

function back(ctx) {
  panelCheck();                   // muodon säädin voi liikkua myös tauolla
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
  /* Aurinko pois 23.9.2026: Sami ei vakuuttunut siitä, ja tuhkan läpi
     hohtava kiekko kilpaili magman kanssa siitä mikä ruudulla on kuumaa.
     Rivi jää tähän kommentiksi, koska takaisin se on yksi rivi.
     sun: { x: 612, y: 236, r: 44, color: '#d8a271' }, */
  /* Luukku keskelle, Sami 23.9.2026. Se on suoraan kraatterin yläpuolella,
     mutta se ei haittaa: sisääntulon aikana kentän `update` ei aja lainkaan,
     ja `grace` pitää vuoren hiljaa vielä kolme sekuntia GO:n jälkeen. */
  gate: { x: 300, w: 120 },
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
    /* Saaren muoto säätimiin: sitä sommitellaan kokonaisuutena eikä penkka
       kerrallaan, ja juuri siksi penkkoja ei ole kirjoitettu lukuina.
       `inset` on se luku joka pitää piirron ja törmäyksen erillään — jos sen
       laskee nollaan, kallion roso alkaa olla näkymätöntä seinää. */
    {
      name: 'vuori', obj: ISLE, open: false,
      sliders: [
        { key: 'top', label: 'lakitaso y', min: 120, max: 800, step: 2 },
        { key: 'hw', label: 'puolileveys tyvessä', min: 50, max: 260, step: 2 },
        { key: 'rim', label: 'puolileveys laella', min: 20, max: 140, step: 2 },
        { key: 'chw', label: 'kraatterin puoliaukko', min: 10, max: 90, step: 1 },
        { key: 'rough', label: 'reunan roso px (vain piirto)', min: 0, max: 16, step: 0.5 },
        { key: 'inset', label: 'törmäys piirtoa kapeampi px', min: 2, max: 26, step: 1 },
        { key: 'cx', label: 'keskikohta x', min: 200, max: 520, step: 2 },
      ],
    },
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
        { key: 'spit', label: 'sylkyväli purkauksessa s', min: 0, max: 1.2, step: 0.02 },
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
