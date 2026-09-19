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
    gate: { x: 300, w: 120 },
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

const W = 720, H = 1040;                      // sama kuin game.js:n kenttä
const STRIPE_W = 72;                          // 10 raitaa kentän leveydelle
const AWNING_RED = '#c8324a', AWNING_PALE = '#f2e5d4';
const BULB_COLORS = ['#ffd479', '#ff8fb8', '#6fe3ff', '#7bf0a0'];

function funfairBack(ctx, api) {
  ctx.save();
  awning(ctx);
  ferrisWheel(ctx, api.t);
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

/** Markiisin kaarreliepe katon alla, lamppu joka kaaren pohjalla. */
function valance(ctx, t) {
  const TOP = 30, DEPTH = 26, R = STRIPE_W / 2;
  ctx.save();
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

  for (let i = 0, x = R; x < W; i++, x += STRIPE_W) bulb(ctx, x, TOP + DEPTH + 4, t, i);
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
