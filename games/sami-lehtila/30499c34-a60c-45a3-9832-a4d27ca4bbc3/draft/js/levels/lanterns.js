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

   Aurinkoa ei ole, vaikka ensin oli: lämmin kiekko haloineen ylälaidassa.
   Sami tyrmäsi sen ajamalla — "se on hämäävä, samanvärinen kuin alustat" —
   ja se on juuri niin. Kenttä on täynnä vaakasuoria lämpimänkeltaisia
   laikkuja joihin pitää laskeutua, ja taustalle maalattu yhdeksäs oli yksi
   liikaa. Taivas lämpenee alaspäin niin kuin ennenkin, joten iltapäivä on
   tallella ilman kiekkoa. Jos aurinko joskus palaa, se kuuluu tänne eikä
   level.sun-kenttään: peli piirtää sen ennen drawBackia ja tähtiä peittävä
   maali hautaisi sen alleen.

   HUDin rahasumma on vaaleaa tekstiä ja kosketusnappien kehykset on viritetty
   tummaa vastaan. Molempien korjaus on kentän puolella eikä pelin väreissä:
   ylälaitaan tulee vaimea vinjetti ja alalaitaan iltahämärä, joka tummentaa
   sen kaistan jolla napit ovat. Vaalealla hiekalla nappien ääriviivat
   katosivat kokonaan, ja sen näki vasta ajamalla.

   Iltapäivä eikä keskipäivä: liekki on yökuva ja hohtaisi kirkkaassa
   päivänvalossa turhaan. Sininen syvenee ylöspäin ja lämpenee alaspäin. */
const SKY = ['#14345f', '#2e6398', '#8aa8bf', '#c2926a'];

function sky(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  SKY.forEach((c, i) => g.addColorStop(i / (SKY.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
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

/* Pilvet arvotaan, koska käsin kirjoitettu lista vastaa väärään kysymykseen.
   Sami katsoi kahdeksaa ja sanoi että se kohta jossa niitä sattui olemaan
   neljä näytti paljon paremmalta: kysymys on määrästä eikä siitä missä kukin
   yksittäinen on. Siksi määrä on säädin ja taivas arpa — mutta kiinteällä
   siemenellä, jotta sama kenttä näyttää joka ajolla samalta ja tune.jsoniin
   tallennettu luku tarkoittaa huomenna samaa.

   Lista arvotaan kerran säätimen ylärajalle asti ja sekoitetaan, ja piirto
   ottaa siitä n ensimmäistä. Sekoitus on se mikä tekee tästä toimivan:
   järjestämättömästä listasta alkupää olisi ruudun ylälaita. Näin tiheyden
   nostaminen lisää pilviä liikuttamatta niitä jotka jo ovat.

   `dens` oletus on 2 eli kaksinkertainen entiseen, `vis` ja `wind` ovat
   kertoimia joilla oletus on 1 — ne ovat säätimiä siksi että kumpikin on
   maku, ja maku katsotaan ruudulta eikä lasketa täällä. */
const AIR = { dens: 2, vis: 1, wind: 1, birds: 1 };
const CLOUD_N = 8;                             // dens 1 = entinen määrä
const POOL = CLOUD_N * 3;                      // dens 3 = säätimen yläraja

const lcg = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

const SKY_CLOUDS = (() => {
  const rnd = lcg(20260922);
  const band = H / POOL;
  const all = [];
  for (let i = 0; i < POOL; i++) {
    const y = (i + 0.5) * band + (rnd() - 0.5) * band * 1.6;
    all.push({
      puff: (rnd() * PUFFS.length) | 0,
      flip: rnd() < 0.5 ? -1 : 1,              // sama muoto peilattuna on eri pilvi
      y,
      s: 0.75 + rnd() * 0.60,
      /* Ylimmät ovat himmeimpiä, koska taivas on siellä tummin ja kontrasti
         kasvaisi muuten liikaa. Koko asteikko nousi kerran: Sami pyysi
         näkyvyyttä hieman lisää, ja hieman on tässä 0,10…0,17 → 0,13…0,22. */
      a: 0.13 + (y / H) * 0.09,
      x0: rnd() * (W + 320),
    });
  }
  for (let i = all.length - 1; i > 0; i--) {   // Fisher–Yates samalla arvalla
    const j = (rnd() * (i + 1)) | 0;
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
})();

/* Tuuli puhaltaa yhteen suuntaan, mutta iso pilvi kulkee hitaammin kuin pieni.
   Se on Samin pyyntö ja se on myös se mikä tekee syvyyden: nopeuseron näkee
   vaikka kaikki muu on samanväristä, ja kahdeksan eri vauhtia on kahdeksan
   etäisyyttä. Nopeus on WIND/s², eli kolmanneksen isompi pilvi kulkee noin
   puolta hitaammin. WIND on viritetty niin että nopeinkin (pienin, s 0.75)
   jää entisiin rajoihin — 7,1 px/s vastaan entinen 7,2 — eli oletus liikkuu
   vain hitaampaan suuntaan. Säädin saa nostaa siitä; oletus ei nosta. */
const WIND = 4.0;
const baseSpeed = c => WIND / (c.s * c.s);

function clouds(ctx) {
  const n = Math.min(SKY_CLOUDS.length, Math.round(CLOUD_N * AIR.dens));
  const span = W + 320;
  /* Yksi liuku kaikille pilville. Se on pilven omissa koordinaateissa, mikä
     toimii siksi että liu'un koordinaatit luetaan vasta maalattaessa eli
     kulloisenkin muunnoksen läpi. */
  const g = ctx.createLinearGradient(0, -46, 0, 34);
  g.addColorStop(0, 'rgba(255,246,228,.95)');
  g.addColorStop(0.55, 'rgba(226,236,246,.8)');
  g.addColorStop(1, 'rgba(146,174,204,.5)');
  ctx.fillStyle = g;

  for (let k = 0; k < n; k++) {
    const c = SKY_CLOUDS[k];
    const x = ((c.x0 + drift * baseSpeed(c)) % span + span) % span - 160;
    for (const rep of [x, x - span]) {         // sama pilvi kahdesti, jotta kierto ei näy
      if (rep > W + 170 || rep < -170) continue;
      ctx.save();
      ctx.translate(rep, c.y);
      ctx.scale(c.s * c.flip, c.s);
      ctx.globalAlpha = Math.min(0.45, c.a * AIR.vis);
      ctx.beginPath();
      for (const [dx, dy, r] of PUFFS[c.puff]) { ctx.moveTo(dx + r, dy); ctx.arc(dx, dy, r, 0, 6.3); }
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
let animT = 0, animLast = 0, animDt = 0, drift = 0;
function animStep() {
  const now = performance.now() / 1000;
  animDt = animLast ? Math.min(0.05, now - animLast) : 0;
  animLast = now;
  animT += animDt;
  /* Tuuli on oma matkalukunsa eikä kello kertaa kerrointa: jälkimmäinen
     siirtäisi koko taivaan sillä hetkellä kun säädintä liikutetaan. */
  drift += animDt * AIR.wind;
  return animT;
}

/* ------------------------------------------------------------------ linnut

   Yksi parvi kerrallaan ja pitkät välit: albatrossi yksin liitäen, kurkia
   kolmesta kuuteen kiilassa. Lintu on tässä sama asia kuin pilven vauhtiero,
   eli syvyyttä — mutta se on myös ainoa asia taivaalla joka elää omaa
   elämäänsä, ja siksi niitä on harvoin. Aina näkyvä lintu olisi koriste;
   välillä ohi lipuva on tapahtuma.

   Linnut piirretään pilvien alle. Pilven läpi näkyvä lintu on kauempana kuin
   pilvi, ja se on koko juju: kentässä ei ole yhtään muuta merkkiä siitä että
   taivaalla olisi etäisyyksiä.

   Siluetti on viiva eikä täyttö — kaukana oleva lintu on ohut — ja väri on
   sitä tummempi mitä alempana lintu on, koska taivas vaalenee alaspäin.
   Siksi myös kaistat: ylimmässä kolmanneksessa taivas on niin tumma ettei
   siluetti erottuisi siitä lainkaan.

   Lintu ei ole este eikä osu mihinkään. Sama sääntö kuin lyhdyssä, ja tässä
   se on helppo: lintu on pieni, liikkuu vaakaan ja räpyttelee. Mikään
   kentässä johon voi osua ei tee yhtäkään noista. */
const FLOCK = {
  /* span  kärkiväli, kink  siiven kaari, hz  räpytystä sekunnissa,
     sweep kärjen nousu, sp  px/s, band  korkeuskaista, n  parven koko.

     Albatrossin kaari oli ensin 2,5 px, mikä on liitävän linnun anatomiaa ja
     ruudulla väärin: siitä tuli vaakasuora viiva, ja vaakasuora viiva on
     tässä pelissä alustan muoto. 7 px riittää tekemään siitä linnun eikä
     tikun, ja liito säilyy silti, koska räpytys on viidesosa kurjen
     tahdista. */
  albatross: { span: 66, kink: 7, hz: 0.20, sweep: 0.50, sp: 34, band: [250, 520], n: [1, 1] },
  crane: { span: 34, kink: 9, hz: 1.70, sweep: 1.00, sp: 52, band: [300, 660], n: [3, 6] },
};

const birdRnd = lcg(20260921);
let flight = null, nextFlight = 5;

/** Yksi ylilento: laji, suunta, korkeus, koko ja parven koko kerralla. */
function flightMake() {
  const kind = birdRnd() < 0.45 ? 'albatross' : 'crane';
  const k = FLOCK[kind];
  const s = 0.72 + birdRnd() * 0.50;
  const dir = birdRnd() < 0.5 ? 1 : -1;
  return {
    kind, k, dir, s,
    n: k.n[0] + ((birdRnd() * (k.n[1] - k.n[0] + 1)) | 0),
    y: k.band[0] + birdRnd() * (k.band[1] - k.band[0]),
    x: dir > 0 ? -120 * s : W + 120 * s,
    sp: k.sp * s,
    t: birdRnd() * 10,
    bob: 5 + birdRnd() * 9,                      // hidas nousu ja lasku matkalla
    bobHz: 0.10 + birdRnd() * 0.08,
  };
}

function birds(ctx) {
  if (AIR.birds <= 0) { flight = null; nextFlight = animT + 6; return; }
  if (!flight && animT >= nextFlight) flight = flightMake();
  if (!flight) return;

  const f = flight;
  f.t += animDt;
  f.x += f.dir * f.sp * animDt;
  if (f.dir > 0 ? f.x > W + 160 * f.s : f.x < -160 * f.s) {
    flight = null;
    /* Väli on satunnainen ja pitkä, ja säädin jakaa sen: lintuja × 2 on
       puolet lyhyempi väli eikä kaksi lintua rinnakkain. */
    nextFlight = animT + (24 + birdRnd() * 36) / AIR.birds;
    return;
  }

  const y = f.y + Math.sin(f.t * f.bobHz * TAU) * f.bob;
  ctx.save();
  ctx.strokeStyle = `rgba(22,34,58,${0.24 + (y / H) * 0.30})`;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < f.n; i++) {
    /* Kiila: joka toinen ylös ja joka toinen alas, kumpikin rivi askeleen
       verran jäljessä. Räpytys laahaa perässä saman askeleen, jolloin parven
       läpi kulkee aalto — se on se mikä tekee kiilasta parven eikä kuvion. */
    const rank = (i + 1) >> 1, side = i % 2 ? 1 : -1;
    bird(ctx, f, f.x - f.dir * rank * 26 * f.s, y + side * rank * 13 * f.s, f.t - rank * 0.16);
  }
  ctx.restore();
}

/** Yksi lintu: kaksi siipeä kaarena ja runko viivana nokasta jalkoihin. */
function bird(ctx, f, x, y, t) {
  const k = f.k, s = f.s, span = k.span * s;
  const lift = Math.sin(t * k.hz * TAU) * span * 0.20 * k.sweep;
  ctx.lineWidth = Math.max(1.1, 2.1 * s);

  ctx.beginPath();
  for (const w of [-1, 1]) {
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + w * span * 0.28, y - k.kink * s - lift * 0.6,
      x + w * span * 0.5, y - lift,
    );
  }
  ctx.stroke();

  /* Kurjella kaula suorana edessä ja jalat perässä — juuri se erottaa kurjen
     haikarasta ja lokista — ja niiden välissä vartalo omana paksumpana
     vetonaan. Sami ajoi ja pyysi kurjelle bodyä, ja syy näkyy heti: yhtenä
     ohuena viivana lintu on risti eikä lintu. Kaari ja räpytys kertovat
     lajin, massan kertoo vartalo. Albatrossilla runko on yhä lyhyt tönkkö —
     se on liitäjä, ja pitkät siivet ovat sen koko silhuetti. */
  if (f.kind === 'crane') {
    ctx.lineWidth = 4.8 * s;                   // vartalo: pyöreät päät = kapseli
    ctx.beginPath();
    ctx.moveTo(x - f.dir * 5 * s, y + 1 * s);
    ctx.lineTo(x + f.dir * 4 * s, y - 0.4 * s);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, 1.7 * s);      // kaula eteen, jalat taakse
    ctx.beginPath();
    ctx.moveTo(x - f.dir * 13 * s, y + 2 * s);
    ctx.lineTo(x + f.dir * 15 * s, y - 1.4 * s);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x - f.dir * 7 * s, y + 1.5 * s);
    ctx.lineTo(x + f.dir * 8 * s, y - 1 * s);
    ctx.stroke();
  }
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
  birds(ctx);
  clouds(ctx);
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
    {
      /* Taivas on makuasia eikä mitoitusta, joten se on säätimissä eikä
         luvuissa: määrä ja näkyvyys ovat kumpikin sellaisia joista Sami sanoi
         "hieman lisää", ja hieman katsotaan ruudulta. Tuulen kerroin on
         mukana samasta syystä — oletus on entistä hitaampi, ja jos se on
         liian hidas, sen näkee nopeammin säätimestä kuin täältä. */
      name: 'pilvet ja linnut', obj: AIR, open: false,
      sliders: [
        { key: 'dens', label: 'määrä ×', min: 0.5, max: 3, step: 0.25 },
        { key: 'vis', label: 'näkyvyys ×', min: 0.3, max: 2.5, step: 0.05 },
        { key: 'wind', label: 'tuuli ×', min: 0.2, max: 2.5, step: 0.05 },
        { key: 'birds', label: 'lintuja × (0 = ei yhtään)', min: 0, max: 3, step: 0.25 },
      ],
    },
    { name: 'kentän kertoimet', open: false, mul: ['grav', 'thrust', 'burn', 'landVY'] },
  ],
};
