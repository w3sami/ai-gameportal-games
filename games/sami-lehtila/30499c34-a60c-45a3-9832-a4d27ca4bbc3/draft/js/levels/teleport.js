/* Teleport — ruutu neljään huoneeseen, ja ainoa tie huoneesta toiseen on portti.
 *
 * Alkuperäisen Space Taxin teleporttikenttä, Samin suosikki. Idea on että
 * lentäminen ei riitä: huoneiden välillä ei ole aukkoa lainkaan, vaan reitti
 * kulkee porteista, ja portit ovat yksisuuntaisia. Kenttä on siis kartan
 * opettelua eikä käsien nopeutta — ja juuri siksi se on kuudes kenttä eikä
 * Moonshot, joka on vaikea eri syystä.
 *
 *     TL — 1, tankkaus        TR — 2        Portit kiertävät kehää:
 *     BL — 4                  BR — 3        TL → TR → BR → BL → TL
 *
 * Kolme päätöstä Samilta 21.9.2026:
 *
 *   **Neljä huonetta, ei yhdeksää.** Moonshotin 3 × 3 oli liikaa; huone on
 *   tässä 336 × 488, eli siinä on tilaa lentää.
 *
 *   **Vauhti ei säily portin läpi.** Taksi tulee ulos paikallaan. Se on
 *   helpompi, ja se on myös luettavampi: ulostulo on aina sama riippumatta
 *   siitä miten kovaa sinne meni.
 *
 *   **Ulostulo ei näy pelissä.** Vain sisäänmeno on ruudulla. Ulostuloportti
 *   skaalautuu näkyviin vasta siinä hetkessä kun siitä tullaan — ja hieman
 *   ennen taksia ja nopeammin, jotta portti ehtii auki ennen kuin taksi
 *   ilmestyy. Editorissa molemmat päät näkyvät ja ovat raahattavia.
 *
 * Kenttä käyttää kahta koukkua jotka peli tarjoaa mutta joita mikään kenttä ei
 * ole aiemmin käyttänyt: `taxiScale` kutistaa taksin piirron portin suuhun, ja
 * `seeds` kertoo työkaluille ne paikat joihin taksi voi ilmestyä lentämättä —
 * ilman sitä vuototäyttö luulisi kolmea huonetta saavuttamattomiksi.
 */
import { W, H, CEIL } from './shared.js';

const T = 16;

/* ------------------------------------------------------------------ huoneet

   Jakoseinät ovat umpinaisia päästä päähän: aukkoja ei ole, eikä kenttää voi
   läpäistä lentämällä. Luukku on vasemmassa yläneljänneksessä, joten vuoro
   alkaa aina TL:stä. */
const VX = 352;                               // pystyseinän vasen reuna
const HY = 504;                               // vaakaseinän yläreuna
const GATE = { x: 140, w: 120 };              // luukku TL:n katossa

const ROOMS = {
  TL: { x0: T, x1: VX, y0: CEIL, y1: HY },
  TR: { x0: VX + T, x1: W - T, y0: CEIL, y1: HY },
  BL: { x0: T, x1: VX, y0: HY + T, y1: H - T },
  BR: { x0: VX + T, x1: W - T, y0: HY + T, y1: H - T },
};

const WALLS = [
  { x: VX, y: CEIL, w: T, h: H - T - CEIL },
  { x: T, y: HY, w: W - T * 2, h: T },
];

/* ------------------------------------------------------------------- portit

   Pari on yksisuuntainen: `a` on sisäänmeno ja `b` ulostulo. Yksisuuntaisuus
   on se mikä tekee kartasta kartan — kaksisuuntaisista tulisi pelkkiä ovia.

   Neljä porttia kiertävät kehää, joten mistä tahansa pääsee kaikkialle
   kiertämällä. Se on tahallaan anteeksiantava: eksyminen maksaa aikaa eikä
   keikkaa.

   r  se etäisyys keskipisteestä jolla portti nappaa taksin */
const PORTALS = [
  { col: '#7bf0a0', a: { x: 300, y: 120, r: 26 }, b: { x: 640, y: 150, r: 26 } },
  { col: '#6fe3ff', a: { x: 640, y: 440, r: 26 }, b: { x: 640, y: 620, r: 26 } },
  { col: '#ffd479', a: { x: 420, y: 950, r: 26 }, b: { x: 300, y: 950, r: 26 } },
  { col: '#c58cff', a: { x: 60, y: 600, r: 26 }, b: { x: 60, y: 120, r: 26 } },
];

/* Matkan kesto ja se miten osat menevät limittäin. Portti aukeaa ennen taksia
   ja nopeammin, jotta taksi ei ilmesty tyhjään kohtaan. */
const WARP = {
  suck: 0.34,                                 // taksi 1 → 0 sisäänmenossa
  hold: 0.10,                                 // pimeä hetki välissä
  door: 0.22,                                 // ulostuloportti 0 → 1
  lead: 0.08,                                 // ...ja näin paljon taksia ennen
  grow: 0.34,                                 // taksi 0 → 1 ulostulossa
  cool: 0.5,                                  // ennen kuin portti nappaa taas
};

/* --------------------------------------------------------------------- tila

   Yksi matka kerrallaan. `phase` on 'in' tai 'out', `t` sekunteja siitä kun
   vaihe alkoi, ja `open` per portti se kuinka auki sen ulostulopää on — vain
   se joka on juuri käytössä on nollaa suurempi. */
let trip = null;
let cool = 0;
let clock = 0;                                // koristekello spiraalille

const lerp = (a, b, u) => a + (b - a) * u;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (u) => 1 - (1 - u) * (1 - u);    // loppua kohti hidastuva

function reset() {
  trip = null;
  cool = 0;
  for (const p of PORTALS) p.b.open = 0;
}

function update(dt, api) {
  const taxi = api.taxi;
  if (cool > 0) cool -= dt;

  if (!trip) {
    if (cool > 0) return;
    for (const p of PORTALS) {
      const d = Math.hypot(taxi.x - p.a.x, taxi.y - p.a.y);
      if (d > p.a.r) continue;
      trip = { p, phase: 'in', t: 0 };
      break;
    }
    return;
  }

  /* Matkan ajan taksi ei liiku eikä putoa. Nopeus nollataan joka ruudulla
     ennen fysiikkaa, joten painovoima ei ehdi kerryttää sitä — ja paikka
     pidetään kädestä, koska se on tässä koriste eikä fysiikkaa. */
  const p = trip.p;
  trip.t += dt;
  taxi.vx = 0;
  taxi.vy = 0;
  taxi.landed = null;

  if (trip.phase === 'in') {
    taxi.x = p.a.x;
    taxi.y = p.a.y;
    if (trip.t >= WARP.suck + WARP.hold) {
      trip.phase = 'out';
      trip.t = 0;
      taxi.x = p.b.x;
      taxi.y = p.b.y;
    }
    return;
  }

  taxi.x = p.b.x;
  taxi.y = p.b.y;
  p.b.open = clamp01(trip.t / WARP.door);
  if (trip.t >= WARP.lead + WARP.grow) {
    p.b.open = 0;
    trip = null;
    cool = WARP.cool;
  }
}

/** Taksin piirtokoko. Peli kertoo sen `taxiScale`illa, eikä fysiikka tiedä. */
function taxiScale() {
  if (!trip) return 1;
  if (trip.phase === 'in') return 1 - ease(clamp01(trip.t / WARP.suck));
  return ease(clamp01((trip.t - WARP.lead) / WARP.grow));
}

/** Ohjaus ei toimi matkan aikana — taksi on portin sisällä. */
function input(vec) {
  return trip ? { x: 0, y: 0 } : vec;
}

/* ------------------------------------------------------------------- piirto

   Portti on pyörivä spiraali hehkun sisällä. Spiraali kääntyy koristekellolla
   eikä pelin kellolla: pelin kello pysähtyy luukusta tullessa, ja pysähtynyt
   portti näyttäisi rikkinäiseltä. */
function spiral(ctx, x, y, r, col, spin, glow) {
  if (r < 0.5) return;
  ctx.save();
  ctx.translate(x, y);

  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.1);
  halo.addColorStop(0, col + '55');
  halo.addColorStop(0.45, col + '22');
  halo.addColorStop(1, col + '00');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(0, 0, r * 2.1, 0, 6.3); ctx.fill();

  ctx.fillStyle = 'rgba(6,8,20,.85)';         // suppilon suu
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.3); ctx.fill();

  ctx.rotate(spin);
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  for (let arm = 0; arm < 3; arm++) {
    ctx.globalAlpha = glow;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i <= 26; i++) {
      const u = i / 26;
      const ang = arm * 2.094 + u * 3.5;
      const rr = r * (0.12 + u * 0.86);
      const px = Math.cos(ang) * rr;
      const py = Math.sin(ang) * rr;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = col;                        // ydin
  ctx.shadowColor = col;
  ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, 6.3); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.globalAlpha = 0.5;                      // kehä
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.3); ctx.stroke();
  ctx.restore();
}

/* Huoneiden oma sävy: neljä samannäköistä ruutua on helppo sekoittaa
   keskenään, ja kenttä on kartan opettelua. Sävy on niin vaimea ettei se
   kilpaile minkään kanssa — se vain kertoo missä ollaan. */
const TINT = [
  { r: ROOMS.TL, c: 'rgba(90,120,255,.05)' },
  { r: ROOMS.TR, c: 'rgba(120,255,190,.05)' },
  { r: ROOMS.BL, c: 'rgba(200,120,255,.05)' },
  { r: ROOMS.BR, c: 'rgba(255,190,110,.05)' },
];

function drawBack(ctx) {
  clock = performance.now();
  for (const t of TINT) {
    ctx.fillStyle = t.c;
    ctx.fillRect(t.r.x0, t.r.y0, t.r.x1 - t.r.x0, t.r.y1 - t.r.y0);
  }
}

function drawFront(ctx) {
  const spin = clock / 1000;
  for (const p of PORTALS) {
    /* Sisäänmeno on aina ruudulla. Se sykkii hieman, ja imiessään enemmän. */
    const busy = trip && trip.p === p && trip.phase === 'in';
    const pull = busy ? 1 - clamp01(trip.t / WARP.suck) : 1;
    const pulse = 1 + Math.sin(spin * 2.2 + p.a.x) * 0.04;
    spiral(ctx, p.a.x, p.a.y, p.a.r * pulse * lerp(1, 1.35, 1 - pull), p.col,
           spin * (busy ? 5 : 1.4), busy ? 1 : 0.75);

    /* Ulostulo vain silloin kun siitä tullaan. */
    if (p.b.open > 0) {
      spiral(ctx, p.b.x, p.b.y, p.b.r * ease(p.b.open), p.col, -spin * 4, 1);
    }
  }
}

/* ------------------------------------------------------------------ kenttä */

const PADS = [
  { id: 1, x: 190, y: 250, w: 140, h: 18 },   // TL
  { id: 2, x: 420, y: 180, w: 140, h: 18 },   // TR
  { id: 3, x: 500, y: 820, w: 140, h: 18 },   // BR
  { id: 4, x: 180, y: 640, w: 140, h: 18 },   // BL
  { id: 0, x: 40, y: 430, w: 140, h: 18, fuel: true },   // TL
];

/* Mitä kentässä saa raahata. Portin molemmat päät ovat omia merkintöjään,
   koska editorin sopimus on olio jolla on x ja y — pari on siis kaksi oliota
   eikä yksi. Väri kertoo mitkä kuuluvat yhteen. */
const EDIT = [
  ...PADS.map((p) => ({
    id: 'pad:' + p.id, kind: 'pad', obj: p,
    label: p.fuel ? 'tankkaus' : 'alusta ' + p.id,
    knob: { key: 'w', label: 'leveys', min: 60, max: 260, step: 2 },
  })),
  ...PORTALS.flatMap((p, i) => [
    { id: `portal:${i + 1}:in`, kind: 'prop', obj: p.a, label: `portti ${i + 1} sisään`,
      knob: { key: 'r', label: 'säde', min: 12, max: 60, step: 1 } },
    { id: `portal:${i + 1}:out`, kind: 'prop', obj: p.b, label: `portti ${i + 1} ulos`,
      knob: { key: 'r', label: 'säde', min: 12, max: 60, step: 1 } },
  ]),
];

export const teleport = {
  name: 'Teleport',
  glow: '#c58cff',
  sky: ['#0a0616', '#100a24', '#080614'],
  gate: GATE,
  start: 1,
  firstFrom: 2,                               // ensimmäinen keikka toisessa huoneessa
  walls: WALLS,
  pads: PADS,
  edit: EDIT,
  /* Paikat joihin taksi voi ilmestyä lentämättä. Ilman tätä työkalujen
     vuototäyttö luulisi kolmea huonetta saavuttamattomiksi — ne ovatkin,
     lentäen. */
  seeds: PORTALS.map((p) => ({ x: p.b.x, y: p.b.y })),
  get taxiScale() { return taxiScale(); },
  init: reset,
  update,
  input,
  drawBack,
  drawFront,
};
