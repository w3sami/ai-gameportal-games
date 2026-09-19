/* Stormport — myrskysatama.
 *
 * Yksi kenttä per tiedosto, jotta kaksi tekijää voi työstää eri kenttiä
 * yhtä aikaa kirjoittamatta toistensa yli. Kentän muoto on kuvattu
 * ../levels.js:ssä.
 */
import { W, H, HATCH } from './shared.js';

/* Myrskysataman nosturinkoukut ovat oikeita esteitä. Kenttä antaa ne
   walls-listassa: peli kopioi listan omaan WALLS-taulukkoonsa, mutta oliot
   ovat samat, joten kentän update voi liikuttaa niitä ja törmäystarkistus
   lukee uuden paikan seuraavalla ruudulla. Lähtöpaikka on ruudun ulkopuolella,
   koska init asettaa ne vasta kun alustat tunnetaan. Tässä ylhäällä siksi,
   että const ei nouse ja LEVELS tarvitsee nämä jo rakentuessaan. */
const HOOK_BOX = [1, 2, 3, 4, 5].map(pad => ({ pad, x: -60, y: -60, w: 20, h: 32 }));

/* Alalaiturin betonimuuri alustan 5 alla. Tämä on kiinteä, koska se näyttää
   kiinteältä: peli piirtää sen omalla seinätyylillään, ja myrsky lisää päälle
   vain saumat. Mitat ovat käsin alustan 5 mukaan (x 534, alapinta 918) —
   const ei nouse, joten LEVELS ei voi lukea niitä itseltään. */
const QUAY = { x: 534, y: 918, w: 170, h: 84 };

/* ------------------------------------------------------------- myrskysatama

   Kentän mekaniikka on yhdessä rivissä: airborne-taksiin lisätään joka ruudulla
   sivukiihtyvyyttä. Kaikki muu täällä on sitä, että pelaaja näkee sen tulevan.

   Tuuli on jaksollinen, ei satunnainen — sen voi oppia. Yksi kierros on tyven,
   nouseva puuska, tasainen huippu ja laantuminen, ja suunta kääntyy sinin
   mukana. Kaikki mikä näyttää tuulta — tuulipussit, koukut, lepuuttaja, sade,
   aallokko — lukee saman windAt-kutsun samalla ruudulla kuin taksin fysiikka,
   joten kuva ja tuntuma eivät voi erota toisistaan. */

/* Tuulen arvot. Nämä ovat säätöpaneelissa kentän omassa laatikossa, joten tämä
   olio muuttuu lennossa — mikään ei saa laskea niistä johdettuja vakioita
   etukäteen, vaan kaikki lasketaan kutsuhetkellä.

   peak   puuskan huippu px/s². 13 % suuttimen työnnöstä on huomaamaton,
          25 % tuntuu kädessä; vaarallinen se on vasta laskuteline alhaalla,
          jolloin sivusuuttimet eivät toimi lainkaan.
   swing  kuinka kauan kestää kääntyä oikealta vasemmalle ja takaisin
   gusts  montako puuskaa kierrokselle mahtuu
   hold   puuskan tasainen osa
   ramp   nousu ja lasku; pitkä nousu on varoitus, lyhyt on isku
   lag    kuinka paljon myöhässä taksi tuntee sen minkä mittarit jo näyttävät
   rand   puuskan huipun ja ajankohdan heitto, 0 = tasan sama joka kerta */
const WIND = {
  peak: 220,
  swing: 21.2,
  gusts: 2,
  hold: 2.6,
  ramp: 1.2,
  lag: 0.9,
  rand: 0.35,
};
const GUST = 0.83;                            // puuskan osuus huippuvoimasta
const TAU = Math.PI * 2;
const smooth = x => x * x * (3 - 2 * x);

/* Puuskan mitat mahtumaan omaan aikaikkunaansa. Jos nousu ja kesto eivät mahdu
   väliin, ne kutistetaan samassa suhteessa — säädintä voi siis vetää mihin
   tahansa ilman että kuvio menee solmuun. */
function shape() {
  const slot = WIND.swing / Math.max(1, Math.round(WIND.gusts));
  const want = WIND.ramp * 2 + WIND.hold;
  const fit = Math.min(1, slot * 0.92 / Math.max(0.01, want));
  const ramp = WIND.ramp * fit, hold = WIND.hold * fit;
  const span = ramp * 2 + hold;
  return { slot, ramp, hold, span, pad: (slot - span) / 2 };
}
/* Mistä kohtaa kierrosta uusi taksi aloittaa: puuska juuri laantunut, ja
   viive päälle jotta myös taksin tuntema tuuli alkaa tyvenestä — muuten
   kolarin jälkeen kasvoille osuisi edellisen puuskan häntä. */
const calmAt = () => { const f = shape(); return f.pad + f.span + WIND.lag; };

/* Suuntasinin vaihe. Puuska osuu aina oman aikaikkunansa keskelle, ja uusi
   taksi aloittaa ensimmäisen ikkunan jälkeen — sini käännetään niin että juuri
   se puuska osuu kierroksen pohjalle. Ensimmäinen puuska puhaltaa siis aina
   täysillä vasemmalle, ja koska vasemmalla on avovettä, bensalautta lähtee heti
   liikkeelle sinne missä sille on tilaa. Oletusarvoilla (kaksi puuskaa
   kierrokselle) vaihe on nolla eikä kuvio muutu lainkaan; vasta puuskien
   lukumäärän säätäminen kääntäisi ilman tätä ensimmäisen puuskan oikealle. */
const phaseOf = f => WIND.swing * 0.75 - f.slot * 1.5;

/* Puuskien väliin jäävä henkäily. Kaksi eri mittaista siniä, jotta kuvio ei
   toistu puuskan tahdissa: yhteensä ±0,17. Taksi ei sitä juuri tunne, mutta
   tuulipussi ja koukut heiluvat, joten kenttä ei näytä kuolleelta silloinkaan
   kun se on rauhallinen. */
const breath = t => 0.10 * Math.sin(t / 3.1 * TAU) + 0.07 * Math.sin(t / 5.3 * TAU + 2);

/** Tuuli hetkellä time: suunta ±1 ja voimakkuus 0…1.

    Suunta tulee sinistä, ei laskurista: tuuli kääntyy nollan kautta ja nousee
    toisella puolella. Puuska kerrotaan sinin sen hetkisellä arvolla, joten
    kierroksen ääripäihin osuvat puuskat ovat täysiä ja suunnanvaihdon kohdalle
    osuvat vaimeita — juuri niin kuin kääntyvä tuuli tekee.

    Satunnaisuus on siementä myöten toistettavaa: sama puuskanumero antaa aina
    saman heiton, joten kuvio ei muutu sen välissä että käppyrä piirretään ja
    taksi tuntee. */
function windAt(time) {
  const f = shape();
  const n = Math.floor(time / f.slot);
  const amp = 1 - WIND.rand * 0.7 * hash(n * 1.7 + 11);
  const shift = (hash(n * 3.3 + 5) - 0.5) * WIND.rand * f.pad * 1.6;
  const q = time - n * f.slot - f.pad - shift;
  let env = 0;
  if (q > 0) {
    if (q < f.ramp) env = smooth(q / f.ramp);
    else if (q < f.ramp + f.hold) env = 1;
    else if (q < f.span) env = 1 - smooth((q - f.ramp - f.hold) / f.ramp);
  }
  const v = Math.sin((time + phaseOf(f)) / WIND.swing * TAU) * GUST * env * amp + breath(time);
  return { dir: v < 0 ? -1 : 1, s: Math.min(1, Math.abs(v)) };
}

/* Mittarit näyttävät tuulen sellaisena kuin se on, taksi tuntee sen WIND.lag
   sekuntia myöhemmin. Tuulipussi ja koukut ovat siis rehellisiä — ne eivät
   ennusta mitään — mutta kääntyvän pussin ja kädessä tuntuvan puuskan väliin
   jää se hetki jossa ehtii päättää mitä tekee. */
const windSeen = () => windAt(storm.t);
const windFelt = () => windAt(storm.t - WIND.lag);

/* Heilurit. Koukku kääntyy suoraan tuulen mukana ilman omaa hitautta: se on
   kentän mittari, ja mittari joka laahaa jäljessä näyttää väärää lukemaa juuri
   silloin kun sitä eniten tarvitaan. Painava ulkonäkö tulee siitä että kulma
   on rajattu — täysi puuska kallistaa koukun 24 asteeseen eikä koskaan vaakaan.

   Idle on pieni oma huojunta, jottei rivi koukkuja ole täysin kuollut
   tyvenellä; eri vaihe kullekin, jotta ne eivät heilu tahdissa. */
const HOOK = { lean: 0.42, idle: 0.025 };

/* Törmäyslaatikko on tarkoituksella vain koukun rautaosa, ei sen alle jäävä
   kärki: kuva saa olla laatikkoa isompi, koska anteeksiantavaan suuntaan
   erehtyminen ei koskaan tunnu epäreilulta. */
const PEND = HOOK_BOX.map((box, i) => {
  const fender = i === HOOK_BOX.length - 1;
  box.w = fender ? 26 : 20;
  box.h = fender ? 26 : 18;
  return { box, pad: box.pad, len: [86, 74, 92, 80, 46][i], a: 0 };
});

/* Bensalautta on kelluva ja painava: jousi vetää sitä kohti tuulen osoittamaa
   paikkaa, mutta vaimennus pitää liikkeen hitaana, joten se on aina pari
   sekuntia jäljessä.

   Matka on eri mittainen eri suuntiin, koska kuilukin on: oikealla laituri
   (QUAY alkaa 534) pysäyttää lautan, vasemmalla on avovettä ruudun reunaan
   asti — ja se käytetään. Alanurkan napit eivät ole este: ne ovat läpikuultavia,
   ja niiden alle ajautuva lautta on tilapäinen eikä sinne tarvitse laskeutua
   juuri silloin.

   Raja tulee siis ruudun reunasta: kovalla rajalla 250 px lautan keula
   pysähtyy 17:ään, eli vettä jää vielä näkyviin eikä alus leikkaudu reunaan.
   Jousi jää noin 83 % tavoitteesta, joten normaaliarvoilla raja ei tule
   vastaan — se on varmistus sen varalle että tuulen säätimet vedetään
   ääriasentoihin. Pitkä matka lyhyessä puuskassa tarkoittaa myös vauhtia:
   huippu on noin 165 px/s vasemmalle. Lasku onnistuu silti, koska laskun
   vx-raja koskee taksin omaa vauhtia eikä alustan — mutta kyytiin pääsee
   mukavimmin tyvenellä, mikä on koko kentän ajatus. */
const BARGE = { left: 290, right: 52, min: -250, max: 80, stiff: 3.0, damp: 2.6, bob: 3.5 };

const storm = {
  t: 0, seen: 0, flash: 0, bolt: null, taxi: null,
  barge: { x: 0, v: 0, home: 0, homeY: 0 },
};

const padOf = (pads, id) => pads.find(p => p.id === id);

function stormInit(api) {
  storm.t = calmAt(); storm.flash = 0; storm.bolt = null; storm.taxi = null;
  storm.seen = 0;
  storm.barge.x = 0; storm.barge.v = 0;
  const fuel = api.pads.find(p => p.fuel);
  storm.barge.home = fuel ? fuel.x : 275;
  storm.barge.homeY = fuel ? fuel.y : 960;
  for (const q of PEND) q.a = 0;
  placeHooks(api);
}

/** Heilurin ripustuspiste: puomeilla kuilun puoleisen kärjen sisäpuolella,
    laiturilla sen reunassa. */
function pivotOf(p) {
  const left = p.x < W / 2;
  if (p.y >= 880) return { x: (left ? p.x + p.w : p.x) + (left ? -6 : 6), y: p.y + p.h + 18 };
  const tip = left ? p.x + p.w : p.x;
  return { x: tip + (left ? -26 : 26), y: p.y + p.h + 13 };
}

function placeHooks(api) {
  for (const q of PEND) {
    const p = padOf(api.pads, q.pad);
    if (!p) continue;
    const piv = pivotOf(p);
    q.box.x = piv.x + Math.sin(q.a) * q.len - q.box.w / 2;
    q.box.y = piv.y + Math.cos(q.a) * q.len - 4;
  }
}

function stepHooks(api, v) {
  PEND.forEach((q, i) => {
    q.a = HOOK.lean * v + Math.sin(storm.t * 1.6 + i * 2.1) * HOOK.idle;
  });
  placeHooks(api);
}

/* Kierros alkaa kohdasta jossa puuska on juuri laantunut aina kun taksi on
   vaihtunut: beginEntry tekee uuden olion, joten pelkkä identiteetin vertailu
   riittää kertomaan että luukusta tuli uusi auto. Kolarin jälkeen saa siis aina
   neljä sekuntia rauhaa ennen seuraavaa puuskaa. */
function stormUpdate(dt, api) {
  if (api.taxi !== storm.taxi) { storm.taxi = api.taxi; storm.t = calmAt(); }
  storm.t += dt;

  /* Salama välähtää kun puuska lähtee nousuun. Kynnys luetaan voimakkuudesta
     eikä kellosta, joten se osuu oikeaan hetkeen silloinkin kun säätimet
     muuttavat kierroksen mittoja kesken kentän. Henkäily ei yllä 0,3:een,
     joten se ei laukaise salamaa. */
  const seen = windSeen();
  if (storm.seen < 0.3 && seen.s >= 0.3) {
    storm.flash = FLASH;
    storm.bolt = makeBolt(api.rand);
  }
  storm.seen = seen.s;
  storm.flash = Math.max(0, storm.flash - dt);

  const felt = windFelt();
  const v = felt.dir * felt.s;
  if (!api.taxi.landed) api.taxi.vx += v * WIND.peak * dt;

  /* Koukut, lautta ja kulissit näyttävät sen mitä silmä näkee, taksi tuntee
     viiveellä. Lautta on painava ja jää muutenkin jälkeen, joten se saa
     seurata näkyvää tuulta — muuten se laahaisi kahdesti. */
  const vSeen = seen.dir * seen.s;
  stepHooks(api, vSeen);

  /* Lautan lepopaikka. Peli laskee alustan paikan kaavalla bx + amplitudi, ja
     amplitudi on nolla, joten bx menee sellaisenaan perille — ja koska alustalla
     on move-kenttä, movePads siirtää taksin ja asiakkaan mukana. */
  const b = storm.barge;
  const reach = vSeen < 0 ? BARGE.left : BARGE.right;
  b.v += ((vSeen * reach - b.x) * BARGE.stiff - b.v * BARGE.damp) * dt;
  b.x += b.v * dt;
  if (b.x < BARGE.min) { b.x = BARGE.min; if (b.v < 0) b.v = 0; }
  else if (b.x > BARGE.max) { b.x = BARGE.max; if (b.v > 0) b.v = 0; }
  const fuel = api.pads.find(p => p.fuel);
  if (fuel) {
    fuel.bx = b.home + b.x;
    fuel.by = b.homeY + Math.sin(storm.t * 1.5) * BARGE.bob;
  }
}

/* ---------------------------------------------------------- sataman kulissit

   Kaikki tämä on drawBackissa eli taivaan päällä mutta seinien, alustojen ja
   taksin alla: mikään ei peitä sitä mitä pelaajan pitää nähdä, eikä mikään ole
   kiinteää. Nosturit, laituri ja lautta piirretään alustan alapuolelle samalla
   säännöllä kuin huvipuiston hahmot — alusta on niiden yläpinta. */

const SEA = 996;                               // vedenpinta
const FLASH = 0.45;                            // salaman kesto sekunteina
const RAIN_N = 80;
const STEEL = '#39465c', STEEL_DARK = '#212b3c', CABLE = '#8b98ad';

/* Kaukainen ranta: leveys, korkeus ja paikka käsin, jotta silhuetti on rytmikäs
   eikä tasavälinen. */
const SHORE = [
  [0, 118, 52], [104, 84, 76], [180, 72, 38], [246, 128, 62],
  [366, 58, 90], [418, 98, 46], [506, 76, 68], [570, 156, 54],
];

const frac = x => x - Math.floor(x);
const hash = i => frac(Math.sin(i * 12.9898 + 4.1) * 43758.5453);

/* Koristeilla on oma kello: pelin runT pysähtyy luukusta tullessa ja kolarin
   jälkeen, ja pysähtynyt sade näyttäisi rikkinäiseltä. */
let animT = 0, animLast = 0;
function animStep() {
  const now = performance.now() / 1000;
  animT += animLast ? Math.min(0.05, now - animLast) : 0;
  animLast = now;
  return animT;
}

function stormBack(ctx, api) {
  const time = animStep();
  const w = windSeen();
  ctx.save();
  lighthouse(ctx, time);
  shore(ctx);
  if (storm.bolt && storm.flash > 0) drawBolt(ctx, storm.bolt, storm.flash);
  rain(ctx, time, w, 0.5, 620, 16);            // kaukainen sade rakenteiden taakse
  sea(ctx, time, w);
  for (const p of api.pads) {
    if (p.fuel) barge(ctx, p, time);
    else if (p.y < 880) boom(ctx, p);          // laiturimuuri on seinä, peli piirtää sen
  }
  rain(ctx, time, w, 1, 980, 30);              // lähempi sade rakenteiden eteen
  for (const m of MASTS) windsock(ctx, w, time, m);
  if (storm.flash > 0) {
    ctx.fillStyle = `rgba(190,215,255,${Math.pow(storm.flash / FLASH, 1.6) * 0.3})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/** Majakka kuilun takana: matala kontrasti, hidas keila. */
function lighthouse(ctx, time) {
  const x = 228, top = 706, lampY = top - 13;
  ctx.save();
  const beam = ctx.createRadialGradient(x, lampY, 0, x, lampY, 820);
  beam.addColorStop(0, 'rgba(255,230,176,.13)');
  beam.addColorStop(0.35, 'rgba(255,230,176,.04)');
  beam.addColorStop(0.75, 'rgba(255,230,176,0)');
  ctx.fillStyle = beam;
  for (const k of [0, Math.PI]) {
    const a = time * 0.5 + k, s = 0.13;
    ctx.beginPath();
    ctx.moveTo(x, lampY);
    ctx.lineTo(x + Math.cos(a - s) * 820, lampY + Math.sin(a - s) * 820);
    ctx.lineTo(x + Math.cos(a + s) * 820, lampY + Math.sin(a + s) * 820);
    ctx.fill();
  }
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#0c1424';
  ctx.beginPath();
  ctx.moveTo(x - 19, top); ctx.lineTo(x + 19, top);
  ctx.lineTo(x + 33, SEA); ctx.lineTo(x - 33, SEA);
  ctx.fill();
  ctx.fillRect(x - 25, top - 26, 50, 26);
  ctx.fillRect(x - 31, top - 32, 62, 8);
  ctx.globalAlpha = 0.5 + Math.sin(time * 3) * 0.12;
  ctx.fillStyle = '#ffe6b0';
  ctx.beginPath(); ctx.arc(x, lampY, 7, 0, 6.3); ctx.fill();
  ctx.restore();
}

/** Ranta ja satamanosturit vedenpinnan takana. */
function shore(ctx) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#0a1120'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
  for (const cx of [150, 470]) {                // kaksi A-nosturia
    ctx.beginPath();
    ctx.moveTo(cx - 54, SEA); ctx.lineTo(cx, SEA - 172); ctx.lineTo(cx + 54, SEA);
    ctx.moveTo(cx - 90, SEA - 150); ctx.lineTo(cx + 104, SEA - 186);
    ctx.stroke();
  }
  ctx.fillStyle = '#0a1120';
  for (const [x, w0, h0] of SHORE) ctx.fillRect(x, SEA - h0, w0, h0);
  ctx.restore();

  ctx.fillStyle = 'rgba(255,214,140,.13)';
  for (const [x, w0, h0] of SHORE) {
    for (let yy = SEA - h0 + 12; yy < SEA - 14; yy += 18) {
      for (let xx = x + 10; xx < x + w0 - 12; xx += 16) {
        if (hash(xx * 0.7 + yy) > 0.45) ctx.fillRect(xx, yy, 6, 7);
      }
    }
  }
}

/** Sade. Kalteva kulma on suoraan tuulesta, joten sen näkee koko ruudulta. */
function rain(ctx, time, w, a, speed, len) {
  const sx = 0.12 + w.dir * w.s * 0.9;
  ctx.strokeStyle = `rgba(174,206,236,${0.3 * a})`;
  ctx.lineWidth = a > 0.8 ? 1.6 : 1.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < RAIN_N; i++) {
    const r = hash(i), x = hash(i + 97) * W;
    const v = speed * (0.8 + r * 0.5);
    const y = frac((time * v + r * 2000) / (H + 200)) * (H + 200) - 100;
    ctx.moveTo(x, y);
    ctx.lineTo(x - sx * len, y - len);
  }
  ctx.stroke();
}

/** Vesi. Aallokko kasvaa tuulen mukana. */
function sea(ctx, time, w) {
  const g = ctx.createLinearGradient(0, SEA - 8, 0, H);
  g.addColorStop(0, '#173b52');
  g.addColorStop(1, '#08131f');
  ctx.fillStyle = g;
  ctx.fillRect(0, SEA - 8, W, H - SEA + 8);
  ctx.strokeStyle = 'rgba(150,200,230,.2)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const y = SEA + 1 + i * 9, amp = 2 + w.s * 3.5;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 12) {
      const yy = y + Math.sin(x / 44 + time * (1.2 + i * 0.4) + i * 2) * amp;
      x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
    }
    ctx.stroke();
  }
}

/** Nosturin puomi alustan alla: kotelo, ristikko ja seinään nojaava tuki.
    Vaijeri ja koukku piirretään stormFrontissa, koska ne ovat kiinteitä. */
function boom(ctx, p) {
  const y = p.y + p.h;
  const left = p.x < W / 2;
  const d = left ? 1 : -1;                     // seinästä kuilua kohti
  const wall = left ? p.x : p.x + p.w;
  const tip = left ? p.x + p.w : p.x;

  ctx.fillStyle = STEEL;
  ctx.fillRect(p.x, y, p.w, 13);
  ctx.strokeStyle = STEEL_DARK; ctx.lineWidth = 2; ctx.lineCap = 'butt';
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const x0 = wall + d * (8 + i * 24);
    ctx.moveTo(x0, y + 1); ctx.lineTo(x0 + d * 22, y + 12);
    ctx.moveTo(x0 + d * 22, y + 1); ctx.lineTo(x0, y + 12);
  }
  ctx.stroke();

  /* Tuki on avoin ristikko eikä umpilevy: sen läpi näkee, joten kukaan ei
     oleta sitä esteeksi — kiinteitä ovat vain alusta ja koukku. */
  ctx.strokeStyle = STEEL_DARK; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(wall + d * 3, y + 13);
  ctx.lineTo(wall + d * 3, y + 98);
  ctx.lineTo(wall + d * p.w * 0.62, y + 15);
  ctx.moveTo(wall + d * 3, y + 56);
  ctx.lineTo(wall + d * p.w * 0.3, y + 15);
  ctx.stroke();
}

/** Bensalautta kuilun pohjalla. Ruostunut runko on tarkoituksella lämmin —
    tankkausalustan pitää erottua kentän kylmästä teräksestä. */
function barge(ctx, p, time) {
  const y = p.y + p.h, x0 = p.x, x1 = p.x + p.w;
  ctx.fillStyle = '#b5652f';
  ctx.beginPath();
  ctx.moveTo(x0 - 8, y); ctx.lineTo(x1 + 8, y);
  ctx.lineTo(x1 - 14, SEA + 2); ctx.lineTo(x0 + 14, SEA + 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(28,18,10,.35)';
  ctx.beginPath();
  ctx.moveTo(x0 - 4, y + 11); ctx.lineTo(x1 + 4, y + 11);
  ctx.lineTo(x1 - 14, SEA + 2); ctx.lineTo(x0 + 14, SEA + 2);
  ctx.fill();
  ctx.fillStyle = '#e5a33f';
  for (let i = 0; i < 3; i++) ctx.fillRect(x0 + 24 + i * 46, y + 3, 22, 6);

  ctx.strokeStyle = 'rgba(210,235,250,.35)'; ctx.lineWidth = 3;
  ctx.beginPath();                              // vaahtoa vesirajassa
  for (let x = x0 - 6; x <= x1 + 6; x += 10) {
    const yy = SEA + Math.sin(x / 18 + time * 2.4) * 2.5;
    x === x0 - 6 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
  }
  ctx.stroke();
}

/* Kolme tuulipussia perspektiivissä. Lähin on isoin ja kirkkain, kaukaisin
   pienin, ylimpänä ja himmeimpänä — sama tuuli, eri etäisyys. Sarja kertoo
   yhdellä silmäyksellä kahta asiaa: mihin suuntaan tuuli menee, ja että nämä
   ovat taustaa eivätkä mitään mihin voisi törmätä. */
const MASTS = [
  { x: 128, y: 140, k: 0.95, a: 0.90, mast: 150 },
  { x: 306, y: 102, k: 0.58, a: 0.60, mast: 96 },
  { x: 452, y: 76, k: 0.40, a: 0.42, mast: 68 },
];

/** Tuulipussi. Se näyttää täsmälleen sen tuulen joka taksiin juuri nyt osuu:
    tyvenellä pussi roikkuu suorana alas, puuskassa se nousee vaakaan ja
    osoittaa siihen suuntaan johon taksia viedään. */
function windsock(ctx, w, time, m) {
  const k = m.k, mx = m.x, my = m.y, L = (54 + w.s * 58) * k;
  ctx.save();
  ctx.globalAlpha = m.a;
  ctx.strokeStyle = '#46546c'; ctx.lineWidth = 5 * k; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(mx, my - 12 * k); ctx.lineTo(mx, my + m.mast); ctx.stroke();
  ctx.strokeStyle = '#7387a3'; ctx.lineWidth = 3 * k;
  ctx.beginPath(); ctx.arc(mx, my, 13 * k, 0, 6.3); ctx.stroke();

  /* Pussi on quadratic-käyrä renkaalta kärkeen: ohjauspiste vedetään alaspäin
     sitä enemmän mitä heikompi tuuli, jolloin lerppa roikkuu ja tiukka suoristuu. */
  const phi = (1 - w.s) * Math.PI / 2;
  const ex = mx + w.dir * L * Math.cos(phi), ey = my + L * Math.sin(phi);
  const cx = (mx + ex) / 2, cy = (my + ey) / 2 + (1 - w.s) * 30 * k;
  const N = 10, pts = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, v = 1 - u;
    pts.push([
      v * v * mx + 2 * v * u * cx + u * u * ex,
      v * v * my + 2 * v * u * cy + u * u * ey + Math.sin(time * 6 - u * 7) * 3.2 * w.s * k,
    ]);
  }
  for (let i = 0; i < N; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    const r0 = (17 - i / N * 10) * k, r1 = (17 - (i + 1) / N * 10) * k;
    ctx.fillStyle = i % 2 ? '#f2e5d4' : '#ff8a3d';
    ctx.beginPath();
    ctx.moveTo(x0 + nx * r0, y0 + ny * r0);
    ctx.lineTo(x1 + nx * r1, y1 + ny * r1);
    ctx.lineTo(x1 - nx * r1, y1 - ny * r1);
    ctx.lineTo(x0 - nx * r0, y0 - ny * r0);
    ctx.fill();
  }
  ctx.restore();
}

/* --------------------------------------------------------------- heilurit

   Nämä piirretään kaiken päälle, koska ne ovat kiinteitä: peli on jo ehtinyt
   maalata törmäyslaatikon paikalle oman tasaisen seinäsuorakulmionsa, ja tämä
   peittää sen. Kuvan ja laatikon pitää siis pysyä kohdakkain — laatikko on
   20 × 32 koukun yläreunasta, ja kaikki alla oleva on vain koristetta. */
function stormFront(ctx, api) {
  quaySeams(ctx);
  for (const q of PEND) {
    const p = padOf(api.pads, q.pad);
    if (!p) continue;
    const piv = pivotOf(p);
    const ex = piv.x + Math.sin(q.a) * q.len, ey = piv.y + Math.cos(q.a) * q.len;
    if (q.len < 60) fender(ctx, piv, ex, ey);
    else hook(ctx, piv, ex, ey);
  }
}

/** Betonisaumat pelin piirtämän laiturimuurin päälle. */
function quaySeams(ctx) {
  ctx.strokeStyle = 'rgba(10,16,28,.5)'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let y = QUAY.y + 18; y < QUAY.y + QUAY.h; y += 18) {
    ctx.moveTo(QUAY.x, y); ctx.lineTo(QUAY.x + QUAY.w, y);
  }
  for (let x = QUAY.x + 34; x < QUAY.x + QUAY.w; x += 34) {
    ctx.moveTo(x, QUAY.y); ctx.lineTo(x, QUAY.y + QUAY.h);
  }
  ctx.stroke();
}

function hook(ctx, piv, ex, ey) {
  ctx.strokeStyle = CABLE; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(piv.x, piv.y); ctx.lineTo(ex, ey - 4); ctx.stroke();
  ctx.fillStyle = '#b9c4d4';                   // rautaosa = törmäyslaatikko
  ctx.beginPath(); ctx.roundRect(ex - 10, ey - 4, 20, 18, 4); ctx.fill();
  ctx.fillStyle = 'rgba(30,40,60,.35)';
  ctx.fillRect(ex - 10, ey + 7, 20, 4);
  ctx.strokeStyle = '#b9c4d4'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(ex, ey + 20, 8, 0.4, 5.3); ctx.stroke();
}

function fender(ctx, piv, ex, ey) {
  ctx.strokeStyle = '#6b5a3f'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(piv.x, piv.y); ctx.lineTo(ex, ey - 2); ctx.stroke();
  ctx.strokeStyle = '#242a35'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(ex, ey + 9, 9, 0, 6.3); ctx.stroke();
  ctx.strokeStyle = 'rgba(150,165,190,.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(ex, ey + 9, 9, 3.6, 5.6); ctx.stroke();
}

/** Salaman polyviiva ylhäältä alas, uusi joka välähdykseen. */
function makeBolt(rand) {
  const pts = [[rand(140, 580), 0]];
  for (let y = 0; y < 560;) {
    y += rand(48, 96);
    pts.push([pts[pts.length - 1][0] + rand(-52, 52), y]);
  }
  return pts;
}

function drawBolt(ctx, pts, flash) {
  ctx.save();
  ctx.globalAlpha = Math.min(1, flash / (FLASH * 0.45));
  ctx.strokeStyle = '#dce9ff'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.shadowColor = '#9db4ff'; ctx.shadowBlur = 18;
  ctx.beginPath();
  pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.stroke();
  ctx.restore();
}

export const stormport = {
  /* Myrskysatama. Kenttä on porraskäytävä: viisi 170 px puomia vuorotellen
     vasemmassa ja oikeassa seinässä, ja keskelle jää 348 px leveä kuilu joka
     on auki katon luukulta bensalautalle asti. Alustat eivät liiku — tässä
     kentässä liikkuu taksi.

     Sivutuulen suunta kääntyy sinillä: 21,2 s kierros, jonka kummassakin
     puoliskossa on yksi puuska ajoitettuna sinin ääriarvoon. Puuska puhaltaa
     siis aina siihen suuntaan johon tuuli on muutenkin menossa, ja puuskien
     väliin jää tyven jossa suunta vaihtuu nollan kautta. Tyven ei kuitenkaan
     ole kuollut: päällä käy henkäily (breath), joka heiluttaa tuulipussia
     pari astetta mutta on taksille olematon.

     Puuskan nousuaika on säätöpaneelin `tuulen nousuaika s` (P.wind), oletus
     0,3 s. Tuulipussit, nostureiden koukut ja laiturin lepuuttaja lukevat
     tasan saman tuulen tasan samalla hetkellä kuin taksi, eli mikään mittari
     ei ole edellä eikä jäljessä. Puuskan alku välähtää lisäksi salamana.

     Huippuvoima 120 px/s² on 13 % suuttimen työnnöstä, ja vähän pitääkin
     olla: lentäessä sen korjaa huomaamatta. Oikeasti vaarallinen se on vain
     laskuteline alhaalla, jolloin sivusuuttimet eivät toimi lainkaan — siksi
     puuska on lyhyt ja tyven vie kierroksesta suuremman osan. Puomit ovat kiinni
     seinässä, joten alustan ulkopää on umpiseinää: ulospäin puhaltavassa
     puuskassa lähestyminen kannattaa jättää väliin ja odottaa tyventä.

     Kolari nollaa kierroksen (ks. stormUpdate), joten uusi taksi saa aina
     neljä sekuntia tyventä ennen ensimmäistä puuskaa.

     Tikkaat alkavat oikealta, koska vasemman alanurkan peittävät tööttiä ja
     laskutelinettä ohjaavat napit (x 30…158, y 778…964): vasemmalle jää vain
     kaksi puomia, ja alempi niistä on y = 710 jotta senkin numerotunnus
     (alustan alla + 22 px) jää nappien yläpuolelle.

     Kaksi asiaa liikkuu tuulen mukana. Bensalautta on kelluva alus: se saa
     tyhjän move-kentän, jolloin peli suostuu siirtämään sen mukana myös
     taksin ja odottavan asiakkaan, ja myrskyn update kirjoittaa sen lepopaikan
     (bx) jousen läpi. Nosturinkoukut ja laiturin lepuuttaja ovat vaimennettuja
     heilureita — raskaita, jäljessä ja hitaasti asettuvia — ja ne ovat myös
     kiinteitä esteitä (HOOK_BOX). */
  name: 'Stormport',
  glow: '#9db4ff',
  sky: ['#070c17', '#141f33', '#22374e', '#31536a'],
  gate: HATCH,
  start: 3,
  firstFrom: 2,
  pads: [
    { id: 1, x: 534, y: 300, w: 170, h: 18 },
    { id: 2, x: 16, y: 440, w: 170, h: 18 },
    { id: 3, x: 534, y: 590, w: 170, h: 18 },
    { id: 4, x: 16, y: 710, w: 170, h: 18 },
    { id: 5, x: 534, y: 900, w: 170, h: 18 },
    { id: 0, x: 275, y: 960, w: 170, h: 18, fuel: true, move: { x: 0, secs: 4 } },
  ],
  walls: [QUAY, ...HOOK_BOX],
  init: stormInit,
  update: stormUpdate,
  drawBack: stormBack,
  drawFront: stormFront,

  /* Kentän oma säätötaulu. Peli piirtää sen kenttänappien alle eikä tiedä
     sisällöstä mitään: tuulen arvot kirjoitetaan suoraan WINDiin, ja mul
     kertoo mitkä globaalit arvot ovat tässä kentässä eri suuruisia kuin
     muualla. Kerroin on kerroin eikä uusi arvo, joten globaalin virityksen
     säätäminen kuljettaa myrskykentän mukanaan. */
  tune: [
    {
      name: 'tuuli', obj: WIND, graph: windGraph,
      sliders: [
        { key: 'peak', label: 'max puuska px/s²', min: 0, max: 600, step: 10 },
        { key: 'swing', label: 'suunnan kesto s', min: 4, max: 60, step: 0.5 },
        { key: 'gusts', label: 'puuskia / kierros', min: 1, max: 8, step: 1 },
        { key: 'hold', label: 'puuskan kesto s', min: 0.2, max: 8, step: 0.1 },
        { key: 'ramp', label: 'nousu ja lasku s', min: 0.05, max: 5, step: 0.05 },
        { key: 'lag', label: 'vaikutuksen viive s', min: 0, max: 3, step: 0.05 },
        { key: 'rand', label: 'satunnaisuus', min: 0, max: 1, step: 0.05 },
      ],
    },
    { name: 'kentän kertoimet', open: false, mul: ['grav', 'thrust', 'burn', 'landVX'] },
  ],
};

/* Tuulikäyrä säätölaatikon alimmaksi.
 *
 * Yksi kokonainen kierros vasemmalta oikealle, nolla keskellä: ylös oikealle
 * puhaltava, alas vasemmalle. Kaksi viivaa, koska niiden ero on koko idea —
 * kirkas on se minkä tuulipussi ja koukut näyttävät, himmeä se minkä taksi
 * tuntee WIND.lag sekuntia myöhemmin. Mitä leveämpi rako, sitä enemmän aikaa
 * pelaajalla on reagoida.
 *
 * Pystyviiva on nyt-hetki. Se juoksee käyrän yli samaa tahtia kuin kenttä
 * etenee, joten säätimen vaikutuksen näkee heti eikä vasta seuraavassa
 * puuskassa. */
function windGraph(ctx, w, h) {
  const L = 8, R = w - 8, T = 24, B = h - 22;
  const mid = (T + B) / 2, half = (B - T) / 2;
  const span = WIND.swing;
  const at = (x, v) => [L + x * (R - L), mid - v * half];

  ctx.strokeStyle = 'rgba(120,160,255,.22)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L, mid); ctx.lineTo(R, mid); ctx.stroke();

  const line = (shift, col, width) => {
    ctx.strokeStyle = col; ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i <= 240; i++) {
      const u = i / 240;
      const wd = windAt(storm.t - storm.t % span + u * span - shift);
      const [x, y] = at(u, wd.dir * wd.s);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  };
  line(WIND.lag, 'rgba(159,180,255,.38)', 2);   // mitä taksi tuntee
  line(0, '#9db4ff', 2.5);                      // mitä mittarit näyttävät

  const now = (storm.t % span) / span;
  ctx.strokeStyle = 'rgba(255,212,121,.8)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(L + now * (R - L), T); ctx.lineTo(L + now * (R - L), B);
  ctx.stroke();

  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(190,210,255,.55)';
  ctx.textAlign = 'left';
  ctx.fillText('± ' + Math.round(WIND.peak) + ' px/s²', L + 2, 14);
  ctx.textAlign = 'right';
  ctx.fillText(Math.round(span) + ' s', R - 2, B + 15);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9db4ff';
  ctx.fillText('mittarit', L + 2, B + 15);
  ctx.fillStyle = 'rgba(159,180,255,.5)';
  ctx.fillText('taksi', L + 74, B + 15);
}
