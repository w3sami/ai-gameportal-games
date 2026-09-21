/* Sky Lanterns — alustat roikkuvat lyhdyissä.
 *
 * Yksi kenttä per tiedosto, jotta kaksi tekijää voi työstää eri kenttiä
 * yhtä aikaa kirjoittamatta toistensa yli. Kentän muoto on kuvattu
 * ../levels.js:ssä.
 */
import { W, H, CEIL, HATCH } from './shared.js';

/* ------------------------------------------------------------------- mitat

   Kentässä ei ole ainuttakaan paikallaan pysyvää alustaa: jokainen roikkuu
   lyhdystä ja heiluu pystysuunnassa, tankkaus mukaan lukien. Liike on pelin
   omaa (pads[].move), joten täällä ei ole riviäkään mekaniikkaa — vain
   mitoitus ja ulkoasu.

   ROPE   alustan yläpinnan ja lyhdyn pohjan väli. Reiäksi luvattiin 1,5
          taksia eli 63 px (taksi teline alhaalla on 28 + 14). Naru on sitä
          pidempi, koska lyhty johtaa liikettä (LEAD) ja kiristää välin
          hetkeksi: 74 px kutistuu pahimmillaan 64,7:ään eikä lupauksen alle.
   LANT   lyhty on kapeampi kuin alusta, jotta laskeutumispinta jää vapaaksi,
          ja narut lähtevät sen sivuista — alustan yläpuolelle ei jää mitään
          mihin taksi osuisi silmällä.
   LEAD   lyhdyn etumatka sekunteina. Lyhty nousee ensin ja alusta seuraa
          narujen varassa; se lukeutuu fysiikaksi ja antaa hitusen lisää
          varoitusaikaa.

   Lyhty on kulissia eikä estettä. Se on tietoinen valinta, ja talon sääntö
   "umpinaiselta näyttävä ei saa olla läpilennettävää" ratkaistaan sillä
   toisella puoliskolla jonka README sanoo: valo saa hohtaa, koska valo ei ole
   este. Lyhty piirretään läpikuultavana paperina jonka läpi taivas näkyy, ei
   umpinaisena laatikkona — se luetaan lampuksi, ja lampun läpi lennetään
   arkailematta. Umpinainen lyhty tekisi jokaisesta laskusta 63 pikselin
   raon, ja tässä talossa vaikeus tulee ajoituksesta eikä ahtaudesta. */
const PAD_W = 150;
const ROPE = 74;
const LANT = { w: 88, h: 58, cap: 8 };        // runko + savuaukko = 66 px
const LEAD = 0.12;

/* Alustat yhtenä taulukkona: paikka, lepokorkeus ja liike. Luvut ovat tässä
   kerran — move-oliot rakennetaan tästä ja säätöpaneelin kertoimet kirjoittavat
   ne takaisin samasta taulukosta, joten kahta totuutta ei pääse syntymään.
   `amp` on poikkeama eikä matka: alusta heiluu ±amp lepokorkeutensa ympäri.

   Sommittelu on kolme saraketta (vasen 40, keski 285, oikea 528) ja kaksi
   alustaa kussakin. Pystyliike syö korkeutta rajusti: saman sarakkeen
   alustojen väliin on jäätävä 2×amp + naru + lyhty + numerotunnus, eli noin
   330 px. Siitä seuraa suoraan kolme asiaa, jotka näyttävät sattumalta mutta
   eivät ole:

     – keskisarakkeen ylempi alusta on vasta 545:ssä, koska sitä ylemmäs ei
       mahdu mitään: taksi jarruttaa sisääntulossa y 156:een luukun alle;
     – vasemman sarakkeen alempi on 650 eikä alempana, jotta senkin
       numerotunnus jää tööttinapin yläpuolelle (nappi alkaa y 778:sta);
     – alarivi on keskellä ja oikealla, koska vasen alanurkka on nappien.

   Vaiheet ovat epätasaiset ja kierrosajat keskenään eripituiset, jottei
   kenttä tunnu metronomilta: kuvio ei toistu samanlaisena käytännössä
   koskaan. Huippunopeus 2π·amp/secs on 14…36 % laskurajasta (215 px/s), eli
   nouseva alusta vie kolmanneksen budjetista mutta ei enempää. */
const SPOTS = [
  { id: 1, x: 528, y: 285, amp: 72, secs: 7.0, phase: 0 },
  { id: 2, x: 40, y: 300, amp: 78, secs: 6.4, phase: 0.36 },
  { id: 3, x: 285, y: 545, amp: 84, secs: 6.8, phase: 0.72 },
  { id: 4, x: 40, y: 650, amp: 60, secs: 8.2, phase: 0.14 },
  { id: 5, x: 528, y: 880, amp: 58, secs: 7.4, phase: 0.88 },
  { id: 0, x: 285, y: 885, amp: 42, secs: 9.0, phase: 0.55, fuel: true },
];

/* Nämä oliot menevät sellaisenaan alustoille. loadLevel kopioi alustan mutta
   ei sen move-oliota, joten tähän kirjoittaminen liikuttaa sitä alustaa jota
   pelataan — se on koko syy sille että säätimet toimivat lennossa. */
const MOVES = SPOTS.map(s => ({ y: s.amp, secs: s.secs, phase: s.phase }));

/* Säätöpaneelin nupit. Kerroin eikä uusi arvo, jotta sommittelun keskinäiset
   suhteet säilyvät kun koko kenttää hidastetaan tai rauhoitetaan.

   `amp` kasvattaa sekä matkaa että nopeutta, `pace` hidastaa nopeutta matkaa
   muuttamatta. Jos rata tuntuu lyhyeltä mutta laskeutuminen rajulta, `pace`
   on se nuppi. Kolmas, `warn`, ei muuta liikettä lainkaan vaan sitä kuinka
   kauan ennen nousua liekki syttyy.

   Naru, lyhdyn koko ja alustojen paikat eivät ole täällä: ne ovat geometriaa,
   ja geometria ei saa elää tune.jsonissa kentän rinnalla. */
const KNOB = { amp: 1, pace: 1, warn: 1.15 };

const TAU = Math.PI * 2;

/* Missä kohtaa kierrosta alusta on t sekunnin kuluttua, poikkeamana
   lepokorkeudesta. Sama kaava kuin pelin movePads()issa — sitä ei saa
   arvata, koska narun pituus ja liekin ajoitus lasketaan tästä. */
const swingAt = (m, t) => m.y * Math.sin((t / m.secs + m.phase) * TAU);

/* Poltin: 0 kun lyhty vajoaa, 1 keskellä nousua. Kierrosta katsotaan
   KNOB.warn sekuntia eteenpäin, joten liekki syttyy sen verran ennen kuin
   alusta lähtee ylös — se on kentän ainoa ennakkomerkki ja sama kieli kuin
   Moonshotin ovilamput. Neliöjuuri nostaa alun nopeasti: sekunti sytytyksen
   jälkeen liekki on jo kirkas eikä vasta puolivälissä nousua. */
function burnAt(m, t) {
  const a = ((t + KNOB.warn) / m.secs + m.phase) * TAU;
  return Math.sqrt(Math.max(0, -Math.cos(a)));
}

/* ------------------------------------------------------------------ taivas

   Ensimmäinen vaalea kenttä. Kolme asiaa on siksi toisin kuin muualla:

   drawSky piirtää tähdet 30 %:n kirkkaudella myös kentän omalle taivaalle ja
   ruudukon niiden päälle. Ne peitetään maalaamalla sama liuku uudestaan tässä
   — drawBack ajetaan drawSkyn jälkeen — eikä koskemalla game.js:ään: yksi
   kenttä ei ole syy muuttaa kaikkien kenttien taivasta. Sama liuku kahdesta
   paikasta olisi kaksi totuutta, joten se on yksi taulukko jota molemmat
   lukevat.

   Samasta syystä aurinko piirretään täällä eikä level.sun-kentässä: peli
   piirtää sen ennen drawBackia, ja tähtiä peittävä maali hautaisi sen alleen.

   HUDin rahasumma on vaaleaa tekstiä ja kosketusnappien kehykset on viritetty
   tummaa vastaan. Molempien korjaus on kentän puolella eikä pelin väreissä:
   ylälaitaan tulee vaimea vinjetti ja alalaitaan iltahämärä, joka tummentaa
   sen kaistan jolla napit ovat. Vaalealla hiekalla nappien ääriviivat
   katosivat kokonaan, ja sen näki vasta ajamalla.

   Iltapäivä eikä keskipäivä: liekki on yökuva ja hohtaisi kirkkaassa
   päivänvalossa turhaan. Sininen syvenee ylöspäin ja lämpenee alaspäin. */
const SKY = ['#14345f', '#2e6398', '#8aa8bf', '#c2926a'];
const SUN = { x: 246, y: 200, r: 50, col: '255,207,143' };

function sky(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  SKY.forEach((c, i) => g.addColorStop(i / (SKY.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const halo = ctx.createRadialGradient(SUN.x, SUN.y, 0, SUN.x, SUN.y, SUN.r * 3.6);
  halo.addColorStop(0, `rgba(${SUN.col},.55)`);
  halo.addColorStop(0.3, `rgba(${SUN.col},.18)`);
  halo.addColorStop(1, `rgba(${SUN.col},0)`);
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(SUN.x, SUN.y, SUN.r * 3.6, 0, 6.3); ctx.fill();
  ctx.fillStyle = `rgba(${SUN.col},.82)`;
  ctx.beginPath(); ctx.arc(SUN.x, SUN.y, SUN.r, 0, 6.3); ctx.fill();
}

/** Vinjetti ylälaitaan HUDin alle ja iltahämärä alalaitaan nappien taakse. */
function vignette(ctx) {
  const top = ctx.createLinearGradient(0, 0, 0, 190);
  top.addColorStop(0, 'rgba(6,14,32,.42)');
  top.addColorStop(1, 'rgba(6,14,32,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 190);

  const low = ctx.createLinearGradient(0, 620, 0, H);
  low.addColorStop(0, 'rgba(26,18,44,0)');
  low.addColorStop(0.55, 'rgba(24,16,40,.26)');
  low.addColorStop(1, 'rgba(20,14,34,.48)');
  ctx.fillStyle = low;
  ctx.fillRect(0, 620, W, H - 620);
}

/* ------------------------------------------------------------------- pilvet

   Talon sääntö sanoo että taustan pitää näyttää selvästi taustalta. Pilvessä
   se on terävämpi kuin missään muualla: **tasapohjainen kumpupilvi näyttää
   hyllyltä**, ja tässä pelissä jokainen hylly on laskeutumisalusta. Siksi
   pilvet ovat pelkkiä ympyröitä — alareuna kaareutuu joka kohdasta — matalalla
   kontrastilla ja hitaasti ajelehtien. Liike erottaa taustan kiinteästä:
   mikään mihin voi osua ei tässä kentässä kulje sivusuunnassa.

   Muoto on [dx, dy, r] omassa origossaan. */
const PUFFS = [
  [[-62, 8, 24], [-26, -2, 32], [8, -12, 28], [40, -2, 30], [72, 10, 22], [10, 12, 30]],
  [[-48, 6, 22], [-16, -8, 30], [18, -4, 26], [46, 6, 20], [0, 10, 26]],
  [[-70, 4, 20], [-34, -8, 28], [0, -16, 32], [34, -6, 30], [66, 6, 24], [-6, 10, 28], [40, 12, 22]],
];

/* Rivi kerrallaan ylhäältä alas: muoto, korkeus, koko, nopeus px/s, peitto ja
   lähtökohta. Ylimmät ovat himmeimpiä, koska taivas on siellä tummin ja
   kontrasti kasvaisi muuten liikaa. */
const CLOUDS = [
  { i: 2, y: 108, s: 1.20, sp: 3.2, a: 0.11, x0: 120 },
  { i: 0, y: 196, s: 0.85, sp: 5.0, a: 0.10, x0: 470 },
  { i: 1, y: 330, s: 1.05, sp: 4.0, a: 0.14, x0: 250 },
  { i: 2, y: 452, s: 0.80, sp: 6.5, a: 0.13, x0: 620 },
  { i: 0, y: 596, s: 1.25, sp: 3.6, a: 0.16, x0: 60 },
  { i: 1, y: 742, s: 0.95, sp: 5.4, a: 0.15, x0: 430 },
  { i: 2, y: 886, s: 1.10, sp: 2.8, a: 0.17, x0: 180 },
  { i: 0, y: 968, s: 0.75, sp: 7.2, a: 0.14, x0: 660 },
];

function clouds(ctx, time) {
  for (const c of CLOUDS) {
    const span = W + 320;
    const x = ((c.x0 + time * c.sp) % span + span) % span - 160;
    for (const rep of [x, x - span]) {         // sama pilvi kahdesti, jotta kierto ei näy
      if (rep > W + 170 || rep < -170) continue;
      ctx.save();
      ctx.translate(rep, c.y);
      ctx.scale(c.s, c.s);
      ctx.globalAlpha = c.a;
      ctx.beginPath();
      for (const [dx, dy, r] of PUFFS[c.i]) { ctx.moveTo(dx + r, dy); ctx.arc(dx, dy, r, 0, 6.3); }
      const g = ctx.createLinearGradient(0, -46, 0, 34);
      g.addColorStop(0, 'rgba(255,246,228,.95)');
      g.addColorStop(0.55, 'rgba(226,236,246,.8)');
      g.addColorStop(1, 'rgba(146,174,204,.5)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

/* Koristeilla on oma kello: pelin runT pysähtyy luukusta tullessa ja kolarin
   jälkeen, ja pysähtynyt pilvi näyttäisi rikkinäiseltä. Lyhdyt sen sijaan
   lukevat runT:n, koska ne kertovat missä alusta on — mittari ei saa käydä
   silloin kun se mitä se näyttää seisoo. */
let animT = 0, animLast = 0;
function animStep() {
  const now = performance.now() / 1000;
  animT += animLast ? Math.min(0.05, now - animLast) : 0;
  animLast = now;
  return animT;
}

/* -------------------------------------------------------------------- lyhty

   Lyhty on se mikä kertoo mitä alusta aikoo. Pystysuunnassa liikkuvaan
   alustaan ei voi laskeutua ellei tiedä missä se on hetken päästä, ja lyhty on
   ylhäällä ja iso — se nähdään ennen alustaa ja kauempaa. Narut kertovat että
   alusta roikkuu siitä, eli liike on selitetty eikä satunnainen, ja liekki
   kertoo että se on juuri lähdössä ylös.

   Kiinalainen paperilyhty eikä pallo: laatikkomaiseen jää enemmän tilaa
   laskeutua alle, suora muoto on helpompi lukea, ja narut lähtevät sivuista
   eivätkä keskeltä. */
function lantern(ctx, p, t, time) {
  const m = p.move;
  if (!m) return;
  const cx = p.x + p.w / 2;
  const bot = p.by + swingAt(m, t + LEAD) - ROPE;   // lyhty johtaa hieman
  const f = burnAt(m, t);
  const flick = 0.9 + Math.sin(time * 11 + p.id * 2.1) * 0.06 + Math.sin(time * 27 + p.id) * 0.04;

  ropes(ctx, p, cx, bot, f);
  smoke(ctx, cx, bot - LANT.h - LANT.cap, f, time, p.id);

  ctx.save();
  /* Paperi on läpikuultavaa: taivas näkyy lävitse, ja liekki lämpimänä
     läiskänä sen takaa. Hohto kasvaa polttimen mukana, joten kirkastuva lyhty
     on sama viesti kuin liekki itse — se näkyy myös ruudun laidalta. */
  ctx.shadowColor = `rgba(255,178,86,${0.5 + f * 0.4})`;
  ctx.shadowBlur = 16 + f * 30;
  paper(ctx, cx, bot, LANT.w, LANT.h);
  const g = ctx.createLinearGradient(0, bot - LANT.h, 0, bot);
  g.addColorStop(0, `rgba(255,214,150,${0.34 + f * 0.18})`);
  g.addColorStop(0.55, `rgba(255,196,110,${0.42 + f * 0.24})`);
  g.addColorStop(1, `rgba(255,158,70,${0.40 + f * 0.26})`);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;

  /* Liekin hohde paperin takana: kirkkain alhaalla, missä poltin on. */
  ctx.save();
  paper(ctx, cx, bot, LANT.w, LANT.h);
  ctx.clip();
  const fy = bot - LANT.h * 0.3;
  const glow = ctx.createRadialGradient(cx, fy, 0, cx, fy, LANT.w * 0.72);
  glow.addColorStop(0, `rgba(255,244,196,${(0.34 + f * 0.46) * flick})`);
  glow.addColorStop(1, 'rgba(255,196,110,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - LANT.w, bot - LANT.h * 2, LANT.w * 2, LANT.h * 2.4);
  ribs(ctx, cx, bot);
  ctx.restore();

  ctx.strokeStyle = `rgba(255,214,164,${0.42 + f * 0.24})`;
  ctx.lineWidth = 1.6;
  paper(ctx, cx, bot, LANT.w, LANT.h);
  ctx.stroke();

  cap(ctx, cx, bot - LANT.h);
  flame(ctx, cx, bot - 9, f * flick);
  ctx.restore();
}

/** Paperin ääriviiva: laatikko jonka kyljet pullottavat hitusen. */
function paper(ctx, cx, bot, w, h) {
  const l = cx - w / 2, r = cx + w / 2, top = bot - h, b = 5;
  ctx.beginPath();
  ctx.moveTo(l + 5, top);
  ctx.lineTo(r - 5, top);
  ctx.quadraticCurveTo(r + b, bot - h / 2, r - 5, bot);
  ctx.lineTo(l + 5, bot);
  ctx.quadraticCurveTo(l - b, bot - h / 2, l + 5, top);
  ctx.closePath();
}

/** Bambukehikko: kolme pystyrimaa ja rimat ylä- ja alareunaan. */
function ribs(ctx, cx, bot) {
  const h = LANT.h, w = LANT.w;
  ctx.strokeStyle = 'rgba(158,96,44,.26)';
  ctx.lineWidth = 2;
  for (const dx of [-w / 4, 0, w / 4]) {
    ctx.beginPath(); ctx.moveTo(cx + dx, bot - h + 3); ctx.lineTo(cx + dx, bot - 3); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(150,88,40,.42)';
  ctx.fillRect(cx - w / 2, bot - h, w, 3);
  ctx.fillRect(cx - w / 2, bot - 3, w, 3);
}

/** Savuaukko: kapea kaulus katolla, sisältä kuuma. */
function cap(ctx, cx, top) {
  const w = LANT.w * 0.34, c = LANT.cap;
  ctx.fillStyle = 'rgba(92,58,34,.62)';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, top);
  ctx.lineTo(cx - w / 2 + 3, top - c);
  ctx.lineTo(cx + w / 2 - 3, top - c);
  ctx.lineTo(cx + w / 2, top);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,206,132,.5)';
  ctx.fillRect(cx - w / 2 + 3, top - c, w - 6, 2);
}

/** Liekki: pisara ja sen sisällä vaaleampi ydin. */
function flame(ctx, x, y, f) {
  const h = 11 + f * 13, w = 5.5 + f * 3;
  const tear = (hh, ww) => {
    ctx.beginPath();
    ctx.moveTo(x, y - hh);
    ctx.quadraticCurveTo(x + ww, y - hh * 0.36, x, y);
    ctx.quadraticCurveTo(x - ww, y - hh * 0.36, x, y - hh);
    ctx.fill();
  };
  ctx.shadowColor = 'rgba(255,186,96,.9)';
  ctx.shadowBlur = 10 + f * 22;
  ctx.fillStyle = `rgba(255,172,72,${0.5 + f * 0.45})`;
  tear(h, w);
  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(255,248,214,${0.45 + f * 0.5})`;
  tear(h * 0.58, w * 0.5);
}

/** Kolme savukiehkuraa aukosta. Poltin savuttaa, joten se näkyy vain liekillä. */
function smoke(ctx, cx, top, f, time, seed) {
  if (f < 0.06) return;
  ctx.save();
  ctx.fillStyle = '#e8eef6';
  for (let i = 0; i < 3; i++) {
    const u = ((time * 0.34 + i / 3 + seed * 0.21) % 1);
    const y = top - 6 - u * 46;
    ctx.globalAlpha = (1 - u) * 0.16 * f;
    ctx.beginPath();
    ctx.arc(cx + Math.sin(u * 5 + i + seed) * (5 + u * 12), y, 4 + u * 11, 0, 6.3);
    ctx.fill();
  }
  ctx.restore();
}

/** Narut sivuista alustan päihin: alhaalla kireät, ylhäällä hieman kaartuvat.

    Löysä lasketaan geometriasta eikä arvata: lyhty johtaa liikettä, joten
    nousussa väli venyy narun mittaiseksi ja vajotessa kutistuu. Kireä naru on
    siis se sama merkki kuin liekki, vain hiljaisempi. */
function ropes(ctx, p, cx, bot, f) {
  const slack = Math.max(0, ROPE - (p.y - bot));
  ctx.strokeStyle = `rgba(112,80,52,${0.45 + f * 0.18})`;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    const x0 = cx + s * (LANT.w / 2 - 6), y0 = bot;
    const x1 = p.x + (s < 0 ? 14 : p.w - 14), y1 = p.y;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2 + s * (2 + slack * 1.1), (y0 + y1) / 2, x1, y1);
    ctx.stroke();
  }
}

/* --------------------------------------------------------------- koukut */

/* Kertoimet kirjoitetaan alustojen move-olioihin joka ruudulla. Yksi ruutu
   myöhässä — level.update ajetaan movePads()in jälkeen — mikä ei näy missään,
   ja vastineeksi säätimen liike näkyy kentässä heti. */
function sync() {
  SPOTS.forEach((s, i) => {
    MOVES[i].y = s.amp * KNOB.amp;
    MOVES[i].secs = s.secs * KNOB.pace;
  });
}

const S = { t: 0 };

function lanternsInit(api) { S.t = api.t; sync(); }
function lanternsUpdate(dt, api) { S.t = api.t; sync(); }

function lanternsBack(ctx, api) {
  const time = animStep();
  ctx.save();
  sky(ctx);
  clouds(ctx, time);
  vignette(ctx);
  for (const p of api.pads) lantern(ctx, p, api.t, time);
  ctx.restore();
}

/* Käyrä säätölaatikon alimmaksi: yksi kierros keskimmäisen alustan liikettä.
 *
 * Käyrä on alustan korkeus ajan yli niin päin kuin ruudulla — ylhäällä on
 * ylhäällä. Amberilla merkitty kaista on se aika jonka poltin palaa, ja sen
 * vasen reuna on koko kentän lupaus: siitä hetkestä on KNOB.warn sekuntia
 * siihen että alusta lähtee ylös.
 *
 * Kaksi pistettä ovat kierroksen ääriasennot, ja ne ovat kentän taito: siellä
 * alusta on hetken paikallaan, keskimatkalla nopeimmillaan. Pystyviiva on
 * nyt-hetki, joten säätimen vaikutuksen näkee samalla ruudulla. */
function liftGraph(g, w, h) {
  const m = MOVES[2];
  const mid = h / 2, amp = h * 0.33;
  const at = u => mid + amp * Math.sin(u * Math.PI * 2);
  const burn = u => -Math.cos((u + KNOB.warn / m.secs) * Math.PI * 2) > 0;

  g.strokeStyle = 'rgba(120,160,255,.18)';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();

  g.fillStyle = 'rgba(255,178,86,.16)';
  for (let i = 0; i < w; i++) if (burn(i / w)) g.fillRect(i, 0, 1, h);

  g.strokeStyle = '#ffd089';
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= w; i++) {
    const y = at(i / w);
    i ? g.lineTo(i, y) : g.moveTo(i, y);
  }
  g.stroke();

  g.fillStyle = '#6fe3ff';
  for (const u of [0.25, 0.75]) {
    g.beginPath(); g.arc(u * w, at(u), 4, 0, 6.3); g.fill();
  }

  const now = ((S.t / m.secs + m.phase) % 1 + 1) % 1;
  g.strokeStyle = 'rgba(233,237,255,.45)';
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(now * w, 0); g.lineTo(now * w, h); g.stroke();
}

export const lanterns = {
  /* Kiinalaiset taivaslyhdyt. Kuudesta alustasta yksikään ei pysy paikallaan:
     jokainen roikkuu lyhdystä ja heiluu pystysuunnassa omalla vaiheellaan,
     tankkaus hitaimpana mutta sekin liikkuen — koko koelaitos on ilmassa.

     Sini viipyy ääriasennoissa itsestään: nopeus on nolla radan päissä ja
     suurimmillaan keskimatkalla. Siitä tulee kentän koko taito, laskeudu
     radan ylä- tai alapäähän äläkä keskelle, eikä sitä tarvitse sanoa
     pelaajalle — sen oppii yrittämällä.

     Nouseva alusta syö laskeutumisbudjetista: törmäysnopeus on taksin vauhti
     plus alustan vauhti. Laskeutuvaan on päinvastoin anteeksiantavampaa, se
     pakenee alaspäin. Siksi liekki, joka syttyy sekunti ennen nousua, on
     kentän tärkein yksityiskohta eikä koriste.

     Kenttä on väljä tarkoituksella: keskelle jää luukulta alas asti kaista,
     ja sarakkeiden väliin 95 px. Vaikeus tulee ajoituksesta, ei ahtaudesta.

     Ei seiniä, ei kiinteitä esteitä — lyhdyt ovat valoa eivätkä rakennetta.

     Kenttäeditorin raahausta (level.edit) ei ole tahallaan: se siirtäisi
     alustan hetkellisen paikan, ei sen lepokorkeutta, ja liikkuvalla alustalla
     ne ovat eri luku. Raahattu paikka näyttäisi oikealta ja luonnokseen
     kirjattuna olisi väärä. Lepokorkeudet ovat SPOTS-taulukossa. */
  name: 'Sky Lanterns',
  glow: '#ffbe6a',
  sky: SKY,
  gate: HATCH,
  start: 4,
  firstFrom: 1,
  pads: SPOTS.map((s, i) => {
    const p = { id: s.id, x: s.x, y: s.y, w: PAD_W, h: 18, move: MOVES[i] };
    if (s.fuel) p.fuel = true;
    return p;
  }),
  init: lanternsInit,
  update: lanternsUpdate,
  drawBack: lanternsBack,

  tune: [
    {
      name: 'liike', obj: KNOB, graph: liftGraph,
      sliders: [
        { key: 'amp', label: 'matka × (myös nopeus)', min: 0.2, max: 2, step: 0.05 },
        { key: 'pace', label: 'kierroksen kesto ×', min: 0.4, max: 2.5, step: 0.05 },
        { key: 'warn', label: 'liekki syttyy s ennen nousua', min: 0.2, max: 3, step: 0.05 },
      ],
    },
    { name: 'kentän kertoimet', open: false, mul: ['grav', 'thrust', 'burn', 'landVY'] },
  ],
};
