/* Kentät.
 *
 * Yksi kenttä on data plus valinnainen pala koodia. Data riittää tavallisiin
 * kenttiin; koukut ovat sitä varten että alkuperäisen tapaan mekaniikka voi
 * vaihtua kesken pelin — glitch-kenttä jossa suunnat sekoavat, kenttä jossa
 * suuttimet laukeavat itsestään, ja niin edelleen. Mikään koukku ei ole
 * pakollinen.
 *
 * Kentän kentät:
 *   name        näkyy HUDissa, aloituksessa ja välianimaatiossa
 *   glow        luukun hehkun ja kentän tunnusväri
 *   sky         taustan gradientti ylhäältä alas, 2–4 väriä; puuttuessa avaruus
 *   sun         valinnainen {x, y, r, color} — hehkuva kiekko taustalle
 *   gate        {x, w} aukko katossa; kehäseinät peli lisää itse
 *   walls       sisäseinät: {x, y, w, h, win?} — win piirtää ikkunarivit
 *   pads        {id, x, y, w, h, fuel?, move?}
 *               id 0 = tankkaus, muut numeroidut alustat
 *               move {x, y, secs, phase} heiluttaa alustaa; taksi, odottava
 *               asiakas ja hautakivet kulkevat mukana
 *   start       alusta jolle taksi palaa kolarin jälkeen
 *   firstFrom   alusta jolle ensimmäinen asiakas ilmestyy
 *
 * Kenttä alkaa aina ilmasta: taksi tulee sisään katon luukusta, jarruttaa
 * paikalleen, luukku sulkeutuu ja peli käynnistyy READY–GO:lla.
 *
 * Koukut (kaikki valinnaisia), api = {P, taxi, pads, walls, t, rand, say}:
 *   init(api)                 kentän alussa
 *   update(dt, api)           joka ruudulla ennen fysiikkaa
 *   input(vec, api) -> vec    ohjausvektorin muokkaus ennen suuttimia
 *   drawBack(ctx, api)        taustan päälle, seinien alle
 *   drawFront(ctx, api)       kaiken päälle, HUDin alle
 */

/* Kentän mitat samoina kuin game.js:ssä, joka ei vie niitä ulos. HATCH menee
   sekä kentän gate-kenttään että huvipuiston taustamaalaukseen, joka leikkaa
   markiisiin reiän samaan kohtaan — muuten luukusta näkyisi kangasta eikä
   taivasta. Nämä ovat ennen LEVELSiä, koska const ei nouse niin kuin function. */
const W = 720, H = 1040;
const CEIL = 16;                            // katon paksuus
const HATCH = { x: 300, w: 120 };           // luukku katossa

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

export const LEVELS = [
  {
    name: 'Intro',
    glow: '#6fe3ff',
    gate: { x: 300, w: 120 },
    start: 1,
    firstFrom: 2,
    walls: [
      { x: 16, y: 300, w: 214, h: 20 },      // hylly vasemmalla
      { x: 540, y: 640, w: 164, h: 20 },     // hylly oikealla
      { x: 16, y: 800, w: 184, h: 20 },      // hylly vasemmalla alhaalla
    ],
    pads: [
      { id: 1, x: 250, y: 950, w: 210, h: 18 },
      { id: 2, x: 490, y: 300, w: 214, h: 18 },
      { id: 0, x: 285, y: 640, w: 150, h: 18, fuel: true },
    ],
  },

  {
    /* Kaksi tornitaloa reunoissa, parvekkeet alustoina. Parvekkeet ovat 165 px
       leveitä — kakkoskenttä saa olla anteeksiantava — ja tornit on kavennettu
       80 pikseliin, jotta väliin jää silti 198 px lentotilaa. Vasemmalla kaksi
       parveketta ja tankkaus, oikealla kolme. Tausta on auringonlasku. */
    name: 'Highrise',
    glow: '#ffb45e',
    sky: ['#221a4a', '#6d3352', '#c85f34', '#f0a04a'],
    sun: { x: 360, y: 1000, r: 210, color: '#ffd089' },
    gate: { x: 300, w: 120 },
    start: 1,
    firstFrom: 3,
    walls: [
      { x: 16, y: 200, w: 80, h: 824, win: true },     // vasen torni
      { x: 624, y: 150, w: 80, h: 874, win: true },    // oikea torni
    ],
    pads: [
      { id: 1, x: 96, y: 880, w: 165, h: 16 },
      { id: 2, x: 96, y: 600, w: 165, h: 16 },
      { id: 0, x: 96, y: 340, w: 165, h: 16, fuel: true },
      { id: 3, x: 459, y: 790, w: 165, h: 16 },
      { id: 4, x: 459, y: 520, w: 165, h: 16 },
      { id: 5, x: 459, y: 250, w: 165, h: 16 },
    ],
  },

  {
    /* Huvipuisto. Kuusi alustaa kolmessa rivissä, kaksi rivissä; alusta on
       172 px ja lepoaukot 125/126/125.

       Ylä- ja alarivi liikkuvat blokkina: saman rivin molemmilla sama x, secs
       ja phase, joten ne eivät voi mennä päällekkäin. 100 pikselin amplitudi
       vie ne käytännössä seinään asti (9 px jää). Blokkirivin keskiaukko on
       aina 126 px, mutta se liukuu puolelta toiselle, eli reitti on koko ajan
       olemassa ja se pitää seurata.

       Keskirivi on saksi: alustat ovat toistensa peilikuvia (phase 0 ja 0.5),
       jolloin keskiaukko pysyy paikallaan x = 360:ssä mutta aukeaa ja sulkeutuu.
       Amplitudi 63 on sen tarkka maksimi — keskiaukko käy nollassa juuri ennen
       kuin alustat menisivät päällekkäin. Samalla reunat tekevät vastakkaista:
       keskiaukko 0 ↔ 252, reuna-aukot 172 ↔ 46. Taksi on 54 px leveä, joten
       46 px on umpi: joko keskeltä tai reunoilta, ei koskaan molemmista.

       Tankkaus on alarivin oikea — banaani, joka on jo valmiiksi tankkauksen
       keltainen. Taustaa ei anneta sky-kentällä: drawBack maalaa markiisin koko
       kentän yli, joten taivas jäisi kuitenkin piiloon. */
    name: 'Funfair',
    glow: '#ff5d7a',
    gate: HATCH,
    start: 2,
    firstFrom: 5,
    pads: [
      { id: 1, x: 125, y: 260, w: 172, h: 18, move: { x: 100, secs: 12, phase: 0 } },
      { id: 2, x: 423, y: 260, w: 172, h: 18, move: { x: 100, secs: 12, phase: 0 } },
      { id: 3, x: 125, y: 520, w: 172, h: 18, move: { x: 63, secs: 12, phase: 0 } },
      { id: 4, x: 423, y: 520, w: 172, h: 18, move: { x: 63, secs: 12, phase: 0.5 } },
      { id: 5, x: 125, y: 780, w: 172, h: 18, move: { x: 100, secs: 12, phase: 0 } },
      { id: 0, x: 423, y: 780, w: 172, h: 18, fuel: true, move: { x: 100, secs: 12, phase: 0 } },
    ],
    drawBack: funfairBack,
  },
  {
    /* Myrskysatama. Kenttä on porraskäytävä: viisi 170 px puomia vuorotellen
       vasemmassa ja oikeassa seinässä, ja keskelle jää 348 px leveä kuilu joka
       on auki katon luukulta bensalautalle asti. Alustat eivät liiku — tässä
       kentässä liikkuu taksi.

       Sivutuulen suunta kääntyy sinillä: 21,2 s kierros, jonka kummassakin
       puoliskossa on yksi puuska (nousu 2,2 s, tasainen 2,6 s, laantuminen
       1,8 s) ajoitettuna sinin ääriarvoon. Puuska puhaltaa siis aina siihen
       suuntaan johon tuuli on muutenkin menossa, ja puuskien väliin jää tyven
       jossa suunta vaihtuu nollan kautta. Tyven ei kuitenkaan ole kuollut:
       päällä käy henkäily (WIND:n breath), joka heiluttaa tuulipussia pari
       astetta mutta on taksille olematon. Tuulipussi lukee tuulta WIND.lead
       sekuntia etuajassa, eli se on ehtinyt nousta tiukalle ennen kuin taksiin
       osuu mitään; nostureiden koukut ja laiturin lepuuttaja kertovat saman
       siellä missä laskeudutaan. Puuskan alku välähtää lisäksi salamana.

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
  },
];

/* ---------------------------------------------------------- huvipuiston kulissit

   Kaikki tämä on pelkkää taustaa: drawBack piirtyy taivaan päälle mutta
   seinien, alustojen ja asiakkaiden alle, joten mikään täällä ei peitä sitä
   mitä pelaajan pitää nähdä — eikä myöskään törmää mihinkään.

   Markiisi on kaksi kerrosta: koko kentän mittaiset raidat ja niiden päällä
   tumma harso, jotta punaiset alustat ja niiden numerot erottuvat kankaasta.
   Kentän yläreunaan jää kirkas kaarrekaistale lamppuineen.

   Alustan alla roikkuu karusellihahmo, yksi kullekin alustalle. Hahmo alkaa
   alustan alareunasta, joten alusta näyttää hahmon selältä; kaikki piirretään
   pää vasemmalle, ja oikean sarakkeen alustat peilataan katsomaan ulospäin. */

const STRIPE_W = 72;                          // 10 raitaa kentän leveydelle
const AWNING_RED = '#c8324a', AWNING_PALE = '#f2e5d4';
const BULB_COLORS = ['#ffd479', '#ff8fb8', '#6fe3ff', '#7bf0a0'];

function funfairBack(ctx, api) {
  ctx.save();
  ctx.save();
  cutout(ctx, HATCH.x, 0, HATCH.w, CEIL);
  awning(ctx);
  ferrisWheel(ctx, api.t);
  ctx.restore();
  valance(ctx, api.t);
  lightChain(ctx, api.t, 944, 26);
  for (const p of api.pads) {
    const r = RIDES[p.id];
    if (!r) continue;
    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y + p.h);
    if (r.flip) ctx.scale(-1, 1);
    r.draw(ctx);
    ctx.restore();
  }
  ctx.restore();
}

/** Rajaa piirtämisen kaikkialle paitsi annettuun suorakulmioon. */
function cutout(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(x, y, w, h);
  ctx.clip('evenodd');
}

/** Telttakangas: raidat, laskosten varjot ja harso päälle. */
function awning(ctx) {
  for (let i = 0, x = 0; x < W; i++, x += STRIPE_W) {
    ctx.fillStyle = i % 2 ? AWNING_RED : AWNING_PALE;
    ctx.fillRect(x, 0, STRIPE_W + 1, H);
  }
  ctx.fillStyle = 'rgba(0,0,0,.20)';
  for (let x = 0; x <= W; x += STRIPE_W) ctx.fillRect(x - 3, 0, 6, H);

  ctx.fillStyle = 'rgba(12,8,26,.66)';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(2,3,12,.62)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Markiisin kaarreliepe katon alla, lamppu joka kaaren pohjalla.

    Luukun kohdalta jätetään kaaret pois kokonaan, ei puolikkaita: lovi lasketaan
    kaarijakoon pyöristäen, jolloin sen reunat osuvat kaarten väliin ja lovi
    näyttää tehdyltä eikä katkaistulta. Taksi tulee sisään lovesta. */
function valance(ctx, t) {
  const TOP = 30, DEPTH = 26, R = STRIPE_W / 2;
  const nx = Math.floor(HATCH.x / STRIPE_W) * STRIPE_W;
  const nw = Math.ceil((HATCH.x + HATCH.w) / STRIPE_W) * STRIPE_W - nx;
  ctx.save();
  cutout(ctx, nx, 0, nw, TOP + DEPTH * 2);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, TOP);
  for (let x = W; x > 0; x -= STRIPE_W) {
    ctx.quadraticCurveTo(x - R, TOP + DEPTH * 2, x - STRIPE_W, TOP);
  }
  ctx.closePath();
  ctx.clip();
  for (let i = 0, x = 0; x < W; i++, x += STRIPE_W) {
    ctx.fillStyle = i % 2 ? AWNING_RED : AWNING_PALE;
    ctx.fillRect(x, 0, STRIPE_W + 1, TOP + DEPTH * 2);
  }
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.fillRect(0, 0, W, 8);
  ctx.restore();

  for (let i = 0, x = R; x < W; i++, x += STRIPE_W) {
    if (x > nx && x < nx + nw) continue;    // loven kohdalla ei ole kaarta eikä lamppua
    bulb(ctx, x, TOP + DEPTH + 4, t, i);
  }
}

/** Valoketju alarivin alla, missä alustat eivät käy. */
function lightChain(ctx, t, y, sag) {
  const cx = W / 2, cy = y + sag * 2;
  ctx.strokeStyle = 'rgba(10,14,32,.8)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(16, y); ctx.quadraticCurveTo(cx, cy, W - 16, y);
  ctx.stroke();
  for (let i = 1; i < 12; i++) {
    const u = i / 12, v = 1 - u;
    bulb(ctx, v * v * 16 + 2 * v * u * cx + u * u * (W - 16),
         v * v * y + 2 * v * u * cy + u * u * y + 6, t, i);
  }
}

function bulb(ctx, x, y, t, i) {
  const c = BULB_COLORS[i % BULB_COLORS.length];
  ctx.globalAlpha = 0.55 + Math.sin(t * 2.1 + i * 1.3) * 0.35;
  ctx.fillStyle = c;
  ctx.shadowColor = c; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.3); ctx.fill();
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}

/** Maailmanpyörä pyörii kankaan edessä niin himmeänä ettei se häiritse. */
function ferrisWheel(ctx, t) {
  const cx = W / 2, cy = 640, R = 232;
  ctx.save();
  ctx.globalAlpha = 0.17;
  ctx.strokeStyle = '#ffd9c2'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 118, cy + 300); ctx.lineTo(cx, cy); ctx.lineTo(cx + 118, cy + 300);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.3); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, R - 24, 0, 6.3); ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = t * 0.09 + i / 12 * 6.283;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    /* Gondoli riippuu kehästä: ripustin ja ääriviiva, ei umpinaista laatikkoa,
       jottei se irtoa pyörästä omaksi harmaaksi palikakseen. */
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 9); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(x - 11, y + 9, 22, 14, 4); ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------ karusellihahmot */

const blob = (ctx, x, y, rx, ry, col, rot = 0) => {
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, 6.3); ctx.fill();
};

/** Raaja tai häntä: pyöreäpäinen viiva, kahdella tai kolmella pisteellä. */
const limb = (ctx, col, w, x0, y0, x1, y1, x2, y2) => {
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0);
  if (x2 === undefined) ctx.lineTo(x1, y1);
  else ctx.quadraticCurveTo(x1, y1, x2, y2);
  ctx.stroke();
};

const eye = (ctx, x, y, r) => {
  ctx.fillStyle = '#f7f3ea';
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
  ctx.fillStyle = '#12101e';
  ctx.beginPath(); ctx.arc(x - r * 0.3, y, r * 0.45, 0, 6.3); ctx.fill();
};

function drawDragon(ctx) {
  const dark = '#2f7f55', body = '#4fbf7a', lit = '#79dd9c';
  limb(ctx, dark, 16, 50, 24, 96, 26, 90, 62);
  blob(ctx, -24, 50, 15, 12, dark); blob(ctx, 26, 50, 15, 12, dark);
  blob(ctx, 0, 26, 70, 27, body);
  ctx.fillStyle = lit;
  ctx.beginPath();
  ctx.moveTo(-8, 6); ctx.quadraticCurveTo(48, 0, 40, 40);
  ctx.quadraticCurveTo(18, 26, -8, 6); ctx.fill();
  blob(ctx, -66, 14, 28, 22, body);
  blob(ctx, -90, 20, 16, 12, body);
  eye(ctx, -74, 8, 6);
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(-100, 17, 2.5, 0, 6.3); ctx.fill();

  /* Höyryä eikä liekkiä: oranssi liekki veisi katseen väärälle alustalle nyt
     kun tankkaus on banaanilla. */
  ctx.fillStyle = 'rgba(226,232,244,.30)';
  for (const [x, y, r] of [[-107, 20, 9], [-119, 25, 6.5], [-129, 21, 4.5]]) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
  }
}

function drawElephant(ctx) {
  const dark = '#6b7489', body = '#98a2b8', lit = '#b4bdd0';
  limb(ctx, dark, 6, 62, 26, 82, 30, 78, 48);
  blob(ctx, -22, 50, 16, 13, dark); blob(ctx, 30, 50, 16, 13, dark);
  blob(ctx, 6, 26, 66, 27, body);
  blob(ctx, -58, 22, 34, 29, body);
  /* Kärsä ja korva tummempana ja vaaleampana kuin pää, muuten koko elefantti
     on yhtä harmaata möykkyä. */
  limb(ctx, dark, 16, -82, 24, -100, 44, -82, 60);
  ctx.strokeStyle = 'rgba(30,36,50,.35)'; ctx.lineWidth = 2;
  for (const [x0, y0, x1, y1] of [[-92, 32, -80, 34], [-95, 42, -84, 45], [-91, 52, -80, 54]]) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.fillStyle = '#f2ece0';
  ctx.beginPath();
  ctx.moveTo(-76, 34); ctx.quadraticCurveTo(-88, 44, -92, 54);
  ctx.quadraticCurveTo(-82, 45, -71, 39); ctx.fill();
  blob(ctx, -40, 24, 19, 23, lit);
  ctx.fillStyle = 'rgba(60,68,88,.5)';
  ctx.beginPath(); ctx.ellipse(-40, 24, 11, 14, 0, 0, 6.3); ctx.fill();
  eye(ctx, -70, 12, 5.5);
}

function drawDriftwood(ctx) {
  const dark = '#5d4530', wood = '#8a6a4a', lit = '#a8855f';
  limb(ctx, wood, 13, -34, 40, -54, 52, -64, 44);
  limb(ctx, wood, 11, 26, 42, 46, 56, 60, 50);
  ctx.fillStyle = wood;
  ctx.beginPath(); ctx.roundRect(-80, 2, 160, 44, 18); ctx.fill();
  ctx.strokeStyle = dark; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (const [x0, y0, x1, y1] of [[-52, 14, 30, 12], [-44, 30, 44, 32], [-8, 40, 58, 37]]) {
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2, y0 + 6, x1, y1); ctx.stroke();
  }
  blob(ctx, 34, 20, 8, 7, dark);
  blob(ctx, -78, 24, 11, 22, lit);
  ctx.strokeStyle = dark; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(-78, 24, 6, 13, 0, 0, 6.3); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(-78, 24, 2.5, 6, 0, 0, 6.3); ctx.stroke();
}

function drawCrocodile(ctx) {
  const dark = '#3f6b2c', body = '#6ea84f';
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(46, 8); ctx.lineTo(102, 34); ctx.lineTo(44, 44); ctx.fill();
  blob(ctx, -28, 48, 15, 11, dark); blob(ctx, 26, 48, 15, 11, dark);
  blob(ctx, -2, 26, 66, 24, body);
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.roundRect(-100, 17, 54, 18, 7); ctx.fill();
  ctx.fillStyle = '#f7f3ea';
  for (let x = -94; x < -52; x += 11) {
    ctx.beginPath();
    ctx.moveTo(x, 34); ctx.lineTo(x + 6, 34); ctx.lineTo(x + 3, 42); ctx.fill();
  }
  ctx.fillStyle = dark;
  for (let x = -18; x < 42; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 5); ctx.lineTo(x + 9, 5); ctx.lineTo(x + 4.5, 17); ctx.fill();
  }
  blob(ctx, -46, 12, 14, 12, body);
  eye(ctx, -46, 10, 6);
}

function drawFlowerBed(ctx) {
  const basket = '#b3833f', dark = '#7d5a29', leaf = '#4f9a54';
  ctx.fillStyle = basket;
  ctx.beginPath();
  ctx.moveTo(-78, 2); ctx.lineTo(78, 2);
  ctx.quadraticCurveTo(64, 50, 0, 56);
  ctx.quadraticCurveTo(-64, 50, -78, 2);
  ctx.fill();
  ctx.strokeStyle = dark; ctx.lineWidth = 2.5;
  for (const y of [14, 26, 38]) {
    ctx.beginPath();
    ctx.moveTo(-77 + y * 0.28, y);
    ctx.quadraticCurveTo(0, y + 7, 77 - y * 0.28, y);
    ctx.stroke();
  }
  for (const [x, y, r] of [[-64, 18, 13], [-24, 50, 12], [16, 58, 11], [54, 44, 13]]) {
    blob(ctx, x - r, y + 4, r * 0.9, r * 0.45, leaf, -0.5);
    blob(ctx, x + r, y + 4, r * 0.9, r * 0.45, leaf, 0.5);
  }
  const cols = ['#ff8fb8', '#ffd479', '#f3e7d8', '#c79bff'];
  [[-64, 16], [-24, 48], [16, 56], [54, 42]].forEach(([x, y], i) => flower(ctx, x, y, 8, cols[i]));
}

function flower(ctx, x, y, r, col) {
  ctx.fillStyle = col;
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * 6.283;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.72, 0, 6.3); ctx.fill();
  }
  ctx.fillStyle = '#ffd479';
  ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, 6.3); ctx.fill();
}

function drawBanana(ctx) {
  const skin = '#ffd23f', dark = '#d99f1e', tip = '#6b4f36';
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.moveTo(-84, 4); ctx.quadraticCurveTo(0, 124, 84, 4);
  ctx.quadraticCurveTo(0, 76, -84, 4); ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(-84, 4); ctx.quadraticCurveTo(0, 124, 84, 4);
  ctx.quadraticCurveTo(0, 104, -84, 4); ctx.fill();
  ctx.fillStyle = tip;
  blob(ctx, -82, 6, 9, 7, tip, -0.6);
  blob(ctx, 82, 6, 9, 7, tip, 0.6);
  ctx.fillStyle = 'rgba(0,0,0,.16)';
  ctx.beginPath(); ctx.ellipse(0, 36, 30, 9, 0, 0, 6.3); ctx.fill();
}

/* Rivit vasemmalta oikealle: lohikäärme ja elefantti, ajopuu ja krokotiili,
   kukkalava ja banaani. Oikean sarakkeen hahmot peilataan katsomaan ulospäin.
   Banaani on alustana 0 eli tankkaus, joten numerot juoksevat 1–5 ylhäältä. */
const RIDES = {
  1: { draw: drawDragon,     flip: false },
  2: { draw: drawElephant,   flip: true },
  3: { draw: drawDriftwood,  flip: false },
  4: { draw: drawCrocodile,  flip: true },
  5: { draw: drawFlowerBed,  flip: false },
  0: { draw: drawBanana,     flip: true },
};

/* ------------------------------------------------------------- myrskysatama

   Kentän mekaniikka on yhdessä rivissä: airborne-taksiin lisätään joka ruudulla
   sivukiihtyvyyttä. Kaikki muu täällä on sitä, että pelaaja näkee sen tulevan.

   Tuuli on jaksollinen, ei satunnainen — sen voi oppia. Yksi kierros on
   tyven, nouseva puhuri, tasainen puuska ja laantuminen, ja suunta vaihtuu
   joka kierroksella. Tuulipussi piirretään tuulella joka on WIND.lead
   sekuntia edellä, joten se roikkuu tyvenellä suorana alas, nousee vaakaan
   ennen puuskaa ja laskee ennen sen loppumista. */

const WIND = {
  swing: 21.2,                                // tuulen suunnan koko kierros
  build: 2.2, hold: 2.6, ease: 1.8,           // yhden puuskan muoto
  gust: 0.83,                                 // puuskan osuus huippuvoimasta
  peak: 120,                                  // px/s² kun voimakkuus on 1
  lead: 1.4,                                  // sekuntia jotka tuulipussi on edellä
};
const TAU = Math.PI * 2;
const HALF = WIND.swing / 2;                  // yksi puuska per sinin puolikas
const GUST_PAD = (HALF - (WIND.build + WIND.hold + WIND.ease)) / 2;
const CALM_AT = GUST_PAD + WIND.build + WIND.hold + WIND.ease;   // puuska juuri laantunut
const smooth = x => x * x * (3 - 2 * x);

/* Puuskien väliin jäävä henkäily. Kaksi eri mittaista siniä, jotta kuvio ei
   toistu puuskan tahdissa: yhteensä ±0,17 eli enintään 20 px/s². Taksi ei sitä
   käytännössä tunne, mutta tuulipussi ja koukut heiluvat, joten kenttä ei
   näytä kuolleelta silloinkaan kun se on rauhallinen. */
const breath = t => 0.10 * Math.sin(t / 3.1 * TAU) + 0.07 * Math.sin(t / 5.3 * TAU + 2);

/* Heilurit. Koukku on raskas: se ei seuraa tuulta vaan laahaa perässä, ohittaa
   tasapainoasennon ja asettuu vasta parin heilahduksen jälkeen. Vaimennettu
   heiluri antaa tämän ilmaiseksi — kiihtyvyys on painovoiman ja tuulen summa
   kaaren suunnassa, ja kulma jää sinne minne se jää.

   HOOK.wind on koukun oma tuulikerroin eikä sama kuin taksin: köyden päässä
   roikkuva rautakimpale kerää tuulta eri tavalla kuin lentävä auto, ja tämä
   luku on vain sitä varten että liike näyttää oikealta. Ääriasento on
   atan(wind/g) ≈ 23°, eli koukku ei koskaan lennä vaakaan.

   Pituudet ovat tarkoituksella eri mittaisia, jotta koukut eivät heilu
   tahdissa — sama tuuli, eri jaksonaika. Viimeinen on laiturin lepuuttaja,
   lyhyt ja siksi vikkelämpi. */
const HOOK = { g: 700, wind: 300, damp: 1.15 };

/* Törmäyslaatikko on tarkoituksella vain koukun rautaosa, ei sen alle jäävä
   kärki: kuva saa olla laatikkoa isompi, koska anteeksiantavaan suuntaan
   erehtyminen ei koskaan tunnu epäreilulta. */
const PEND = HOOK_BOX.map((box, i) => {
  const fender = i === HOOK_BOX.length - 1;
  box.w = fender ? 26 : 20;
  box.h = fender ? 26 : 18;
  return { box, pad: box.pad, len: [86, 74, 92, 80, 46][i], a: 0, v: 0 };
});

/* Bensalautta on kelluva ja painava: jousi vetää sitä kohti tuulen osoittamaa
   paikkaa, mutta vaimennus pitää liikkeen hitaana, joten se on aina pari
   sekuntia jäljessä. Poikkeama ±52 px mahtuu kuiluun (186…534) reilusti. */
const BARGE = { amp: 52, stiff: 1.6, damp: 1.9, bob: 3.5 };

const storm = {
  t: 0, flash: 0, bolt: null, taxi: null,
  barge: { x: 0, v: 0, home: 0, homeY: 0 },
};

const padOf = (pads, id) => pads.find(p => p.id === id);

function stormInit(api) {
  storm.t = CALM_AT; storm.flash = 0; storm.bolt = null; storm.taxi = null;
  storm.barge.x = 0; storm.barge.v = 0;
  const fuel = api.pads.find(p => p.fuel);
  storm.barge.home = fuel ? fuel.x : 275;
  storm.barge.homeY = fuel ? fuel.y : 960;
  for (const q of PEND) { q.a = 0; q.v = 0; }
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

/** Vaimennettu heiluri, kaksi puoliaskelta jotta isokin dt pysyy kasassa. */
function stepHooks(dt, api, v) {
  const h = dt / 2;
  for (const q of PEND) {
    for (let i = 0; i < 2; i++) {
      const acc = (-HOOK.g * Math.sin(q.a) + v * HOOK.wind * Math.cos(q.a)) / q.len
        - HOOK.damp * q.v;
      q.v += acc * h;
      q.a += q.v * h;
    }
  }
  placeHooks(api);
}

/** Tuuli hetkellä time: suunta ±1 ja voimakkuus 0…1.

    Suunta tulee sinistä, ei laskurista: tuuli kääntyy nollan kautta ja nousee
    toisella puolella, ja puuska on ajoitettu sinin ääriarvoon. Puuska puhaltaa
    siis aina siihen suuntaan johon tuuli on muutenkin menossa, ja kahden
    puuskan väliin jää aito tyven jossa suunta vaihtuu. */
function windAt(time) {
  const u = time - Math.floor(time / HALF) * HALF;
  const q = u - GUST_PAD;
  let env = 0;
  if (q > 0) {
    if (q < WIND.build) env = smooth(q / WIND.build);
    else if (q < WIND.build + WIND.hold) env = 1;
    else if (q < WIND.build + WIND.hold + WIND.ease) {
      env = 1 - smooth((q - WIND.build - WIND.hold) / WIND.ease);
    }
  }
  const v = Math.sin(time / WIND.swing * TAU) * WIND.gust * env + breath(time);
  return { dir: v < 0 ? -1 : 1, s: Math.min(1, Math.abs(v)) };
}

/* Kierros alkaa kohdasta jossa puuska on juuri laantunut aina kun taksi on
   vaihtunut: beginEntry tekee uuden olion, joten pelkkä identiteetin vertailu
   riittää kertomaan että luukusta tuli uusi auto. Kolarin jälkeen saa siis aina
   neljä sekuntia rauhaa ennen seuraavaa puuskaa. */
function stormUpdate(dt, api) {
  if (api.taxi !== storm.taxi) { storm.taxi = api.taxi; storm.t = CALM_AT; }
  const was = storm.t;
  storm.t += dt;

  const rise = Math.floor(was / HALF) * HALF + GUST_PAD;
  if (was < rise && storm.t >= rise) {         // salama kun puhuri lähtee nousuun
    storm.flash = FLASH;
    storm.bolt = makeBolt(api.rand);
  }
  storm.flash = Math.max(0, storm.flash - dt);

  const w = windAt(storm.t);
  const v = w.dir * w.s;
  if (!api.taxi.landed) api.taxi.vx += v * WIND.peak * dt;

  stepHooks(dt, api, v);

  /* Lautan lepopaikka. Peli laskee alustan paikan kaavalla bx + amplitudi, ja
     amplitudi on nolla, joten bx menee sellaisenaan perille — ja koska alustalla
     on move-kenttä, movePads siirtää taksin ja asiakkaan mukana. */
  const b = storm.barge;
  b.v += ((v * BARGE.amp - b.x) * BARGE.stiff - b.v * BARGE.damp) * dt;
  b.x += b.v * dt;
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
  const w = windAt(storm.t);
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
  const sock = windAt(storm.t + WIND.lead);
  for (const m of MASTS) windsock(ctx, sock, time, m);
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

/** Tuulipussi. Tämä on kentän varoitusvalo: se saa tuulen WIND.lead sekuntia
    etuajassa, joten se on tiukalla ennen kuin ensimmäinenkään pikseli työntää.
    Tyvenellä pussi roikkuu suorana alas, puuskassa se nousee vaakaan ja
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
