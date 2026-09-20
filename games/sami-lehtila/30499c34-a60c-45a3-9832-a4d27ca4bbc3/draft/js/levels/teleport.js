/* Teleport — ruutu neljään huoneeseen, ja ainoa tie huoneesta toiseen on portti.
 *
 * Alkuperäisen Space Taxin teleporttikenttä, Samin suosikki. Idea on että
 * lentäminen ei riitä: huoneiden välillä ei ole aukkoa lainkaan, vaan reitti
 * kulkee porteista, ja portit ovat yksisuuntaisia. Kenttä on siis kartan
 * opettelua eikä käsien nopeutta — ja juuri siksi se on kuudes kenttä eikä
 * Moonshot, joka on vaikea eri syystä.
 *
 *     TL — 1, tankkaus        TR — 2        TL → BR        BR → BL
 *     BL — 4                  BR — 3        TR → BR        BR → TR
 *                                           BL → TL (×2)
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

   Kuusi porttia, ja verkko on Samin sommittelema 21.9.2026 — hän siirsi kahta
   ulostuloa ja piirsi kaksi uutta paria luonnoslehtiöön nuolina, mikä on
   nuolelle juuri oikea käyttö: kärki kertoo mihin päin.

   **BR on solmu.** TL:stä pääsee vain sinne, ja sieltä sekä TR:ään että
   BL:ään. BL:stä on kaksi tietä takaisin TL:ään, eri kohtiin. Verkko on yhä
   vahvasti yhtenäinen — jokaisesta huoneesta pääsee jokaiseen — mutta reitti
   ei ole enää kehä vaan valinta, ja se on parempi: kehässä ei ole mitään
   opittavaa.

   r  se etäisyys keskipisteestä jolla portti nappaa taksin */
const PORTALS = [
  { col: '#7bf0a0', a: { x: 300, y: 120, r: 26 }, b: { x: 416, y: 620, r: 26 } },  // TL → BR
  { col: '#6fe3ff', a: { x: 640, y: 440, r: 26 }, b: { x: 640, y: 620, r: 26 } },  // TR → BR
  { col: '#ffd479', a: { x: 420, y: 950, r: 26 }, b: { x: 300, y: 950, r: 26 } },  // BR → BL
  { col: '#c58cff', a: { x: 60, y: 600, r: 26 }, b: { x: 284, y: 416, r: 26 } },   // BL → TL
  { col: '#ff8a3d', a: { x: 524, y: 623, r: 26 }, b: { x: 428, y: 423, r: 26 } },  // BR → TR
  { col: '#ff5d7a', a: { x: 294, y: 791, r: 26 }, b: { x: 69, y: 140, r: 26 } },   // BL → TL
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

/* -------------------------------------------------------------- laboratorio

   Neljä suljettua huonetta joiden välillä liikutaan koneella on koelaitos, ja
   kenttä piirretään sen mukaan. Sami 21.9.2026: *"laboratorio kuulostaa
   hienolta teemalta."*

   Kaikki paikallaan pysyvä piirretään **kerran** omalle kankaalleen ja
   lyödään joka ruudulla yhtenä kuvana. Kahdessa kerroksessa, koska seinät
   piirtyvät näiden väliin: `BACK` menee seinien alle ja `FACE` niiden päälle.
   Elävää on vain se mikä vilkkuu tai kelluu.

   Valo tulee ylävasemmalta, kuten kaikessa muussakin talon grafiikassa. */
const STEEL = '#2a3446', STEEL_HI = '#39465c';
const LIT = 'rgba(214,224,240,.22)', DARK = 'rgba(0,0,0,.32)';

const ROOM_LIST = [ROOMS.TL, ROOMS.TR, ROOMS.BL, ROOMS.BR];

/* Näytelasit: lasisylinteri, jossa kelluu jotain. Yksi per huone, ja väri on
   sen huoneen väri — sekin auttaa tietämään missä ollaan. */
const TANKS = [
  { x: 332, y: 504, h: 96, col: '#6fe3ff' },
  { x: 388, y: 504, h: 110, col: '#7bf0a0' },
  { x: 336, y: 1008, h: 120, col: '#c58cff' },
  { x: 684, y: 1008, h: 130, col: '#ffd479' },
];

/* Laiteräkit. Paikat on valittu niin etteivät ne ole portin suulla eivätkä
   alustan päällä — sama sääntö kuin kuukentän tolpilla. */
const RACKS = [
  { x: 24, y: 32, w: 40, h: 76 },
  { x: 648, y: 40, w: 40, h: 90 },
  { x: 90, y: 536, w: 40, h: 84 },
  { x: 648, y: 700, w: 40, h: 100 },
];

function sheet(paint) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  paint(c.getContext('2d'));
  return c;
}

let BACK = null, FACE = null;

/** Seinien alle: laattaruudukko, kansilevyt, kanavat, räkit ja lasit. */
function paintBack(g) {
  g.strokeStyle = 'rgba(150,180,255,.035)';   // laattaruudukko koko kentälle
  g.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y <= H; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

  for (const r of ROOM_LIST) {
    const w = r.x1 - r.x0;

    g.fillStyle = STEEL;                      // kansilevy lattiaan
    g.fillRect(r.x0, r.y1 - 14, w, 14);
    g.fillStyle = LIT;
    g.fillRect(r.x0, r.y1 - 14, w, 1.5);
    g.strokeStyle = DARK;                     // levysaumat
    g.lineWidth = 1.5;
    for (let x = r.x0 + 56; x < r.x1; x += 56) {
      g.beginPath(); g.moveTo(x, r.y1 - 14); g.lineTo(x, r.y1); g.stroke();
    }

    g.fillStyle = STEEL_HI;                   // ilmakanava kattoon
    g.fillRect(r.x0, r.y0, w, 12);
    g.fillStyle = LIT;
    g.fillRect(r.x0, r.y0, w, 1.5);
    g.fillStyle = DARK;
    g.fillRect(r.x0, r.y0 + 10.5, w, 1.5);
    g.fillStyle = STEEL;                      // kannattimet
    for (let x = r.x0 + 34; x < r.x1 - 20; x += 68) g.fillRect(x, r.y0 + 12, 6, 7);
  }

  for (const k of RACKS) {
    g.fillStyle = STEEL;
    g.fillRect(k.x, k.y, k.w, k.h);
    g.fillStyle = LIT;
    g.fillRect(k.x, k.y, k.w, 1.5);
    g.fillRect(k.x, k.y, 1.5, k.h);
    g.fillStyle = DARK;
    g.fillRect(k.x, k.y + k.h - 1.5, k.w, 1.5);
    g.fillStyle = 'rgba(10,14,24,.55)';       // korttipaikat
    for (let y = k.y + 8; y < k.y + k.h - 8; y += 12) g.fillRect(k.x + 5, y, k.w - 10, 7);
  }

  for (const t of TANKS) {
    const w = 26, top = t.y - t.h;
    g.fillStyle = 'rgba(120,180,230,.09)';    // lasi
    g.fillRect(t.x - w / 2, top, w, t.h);
    g.fillStyle = 'rgba(214,232,255,.14)';    // kiilto vasemmalle
    g.fillRect(t.x - w / 2 + 2, top + 6, 3, t.h - 12);
    g.fillStyle = STEEL_HI;                   // kannet
    g.fillRect(t.x - w / 2 - 4, top - 9, w + 8, 9);
    g.fillRect(t.x - w / 2 - 4, t.y - 7, w + 8, 7);
    g.fillStyle = LIT;
    g.fillRect(t.x - w / 2 - 4, top - 9, w + 8, 1.5);
    g.fillStyle = STEEL;                      // putki katosta
    g.fillRect(t.x - 3, top - 26, 6, 17);
  }
}

/** Seinien päälle: väliseinien pinta, saumat ja pultit. */
function paintFace(g) {
  for (const w of WALLS) {
    const across = w.w > w.h;
    g.fillStyle = LIT;                        // valoreuna ylös
    g.fillRect(w.x, w.y, w.w, 1.5);
    g.fillStyle = DARK;
    g.fillRect(w.x, w.y + w.h - 1.5, w.w, 1.5);

    g.fillStyle = 'rgba(120,160,255,.10)';    // keskisauma
    if (across) g.fillRect(w.x, w.y + w.h / 2 - 0.75, w.w, 1.5);
    else g.fillRect(w.x + w.w / 2 - 0.75, w.y, 1.5, w.h);

    g.fillStyle = 'rgba(255,212,121,.30)';    // pultit
    const len = across ? w.w : w.h;
    for (let i = 28; i < len - 20; i += 56) {
      const x = across ? w.x + i : w.x + w.w / 2 - 1.5;
      const y = across ? w.y + w.h / 2 - 1.5 : w.y + i;
      g.fillRect(x, y, 3, 3);
    }
  }
}

/** Portin koneisto: kelakaaret ja päätykappaleet. Vain sisäänmenoilla aina —
    ulostulon koneisto ilmestyy portin mukana, koska muuten se paljastaisi
    paikan jonka on määrä olla piilossa. */
function housing(ctx, x, y, r, col, a) {
  if (a <= 0.01) return;
  const R = r * 1.5;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  ctx.strokeStyle = STEEL_HI;
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(0, 0, R, -2.5, -0.65); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, R, 0.65, 2.5); ctx.stroke();
  ctx.strokeStyle = LIT;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(0, 0, R - 1.8, -2.5, -0.65); ctx.stroke();
  ctx.fillStyle = STEEL;
  for (const sgn of [-1, 1]) ctx.fillRect(sgn * R - 6, -8, 12, 16);
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 8;
  for (const sgn of [-1, 1]) ctx.fillRect(sgn * R - 2, -2, 4, 4);
  ctx.restore();
}

/** Elävä osa: räkkien merkkivalot ja lasien sisällöt. */
function labLive(ctx) {
  for (let i = 0; i < RACKS.length; i++) {
    const k = RACKS[i];
    for (let j = 0, y = k.y + 11; y < k.y + k.h - 8; y += 12, j++) {
      const on = (clock / (260 + i * 90 + j * 47) | 0) % 2 === 0;
      ctx.fillStyle = on ? '#7bf0a0' : 'rgba(40,60,52,.9)';
      ctx.fillRect(k.x + k.w - 11, y, 4, 3);
    }
  }
  for (let i = 0; i < TANKS.length; i++) {
    const t = TANKS[i];
    const top = t.y - t.h;
    const u = (Math.sin(clock / 1400 + i * 2) + 1) / 2;
    const cy = lerp(top + 26, t.y - 26, u);
    const pulse = 0.55 + Math.sin(clock / 500 + i) * 0.12;
    const g = ctx.createRadialGradient(t.x, cy, 0, t.x, cy, 22);
    g.addColorStop(0, fade(t.col, pulse));
    g.addColorStop(0.45, fade(t.col, pulse * 0.3));
    g.addColorStop(1, fade(t.col, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(t.x, cy, 22, 0, 6.3); ctx.fill();
    ctx.fillStyle = fade(t.col, 0.85);
    ctx.beginPath(); ctx.ellipse(t.x, cy, 7, 5.5, u * 3, 0, 6.3); ctx.fill();
  }
}

/* ------------------------------------------------------------------- piirto

   Portti on pehmeä pyörre: ei yhtään terävää viivaa eikä reunusta, vaan
   pelkkiä gradientteja. Sami 21.9.2026: *"ei teräviä viivoja vaan pehmeitä
   gradientteja, enemmän sakaroita, ei reunusta."*

   Se piirretään **kerran** omalle kankaalleen ja käännetään joka ruudulla
   `drawImage`lla. Pehmeä pyörre on seitsemän sakaraa, joista jokainen on
   kolmisenkymmentä sumeaa täplää kierteen varrella — sellaista ei piirretä
   joka ruudulla neljälle portille, mutta kerran se on ilmaista. Samalla
   sakaroita saa olla niin monta kuin haluaa.

   Piirtyy **drawBackissa eikä drawFrontissa**, jotta taksi jää portin päälle:
   sisäänmenon ja ulostulon skaalausanimaatio on koko homman pointti, eikä sitä
   näe jos portti piirtyy sen yli. */
const SPR = 96;                               // sprite-säde pikseleinä
const SPR_R = 32;                             // ...vastaa tätä portin sädettä
const ARMS = 7;

/** Heksaväri läpinäkyvyydellä. Kentän värit ovat kuusinumeroisia. */
const fade = (c, a) => c + Math.round(clamp01(a) * 255).toString(16).padStart(2, '0');

const sprites = new Map();
function sprite(col) {
  const had = sprites.get(col);
  if (had) return had;
  const c = document.createElement('canvas');
  c.width = c.height = SPR * 2;
  const g = c.getContext('2d');
  g.translate(SPR, SPR);

  const halo = g.createRadialGradient(0, 0, 0, 0, 0, SPR);
  halo.addColorStop(0, fade(col, 0.30));
  halo.addColorStop(0.35, fade(col, 0.13));
  halo.addColorStop(1, fade(col, 0));
  g.fillStyle = halo;
  g.beginPath(); g.arc(0, 0, SPR, 0, 6.3); g.fill();

  /* Sakarat summautuvat päällekkäin, jolloin kierteen tiheät kohdat kirkastuvat
     itsestään eikä mihinkään jää rajaa. */
  g.globalCompositeOperation = 'lighter';
  for (let arm = 0; arm < ARMS; arm++) {
    for (let i = 0; i < 30; i++) {
      const u = i / 29;
      const ang = (arm * 6.2832) / ARMS + u * 3.1;
      const rr = SPR_R * (0.16 + u * 2.05);
      const x = Math.cos(ang) * rr;
      const y = Math.sin(ang) * rr;
      const size = SPR_R * (0.36 - u * 0.21);
      const dot = g.createRadialGradient(x, y, 0, x, y, size);
      dot.addColorStop(0, fade(col, 0.15 * (1 - u) ** 1.3));
      dot.addColorStop(1, fade(col, 0));
      g.fillStyle = dot;
      g.beginPath(); g.arc(x, y, size, 0, 6.3); g.fill();
    }
  }

  const core = g.createRadialGradient(0, 0, 0, 0, 0, SPR_R * 0.6);
  core.addColorStop(0, fade(col, 0.9));
  core.addColorStop(0.3, fade(col, 0.4));
  core.addColorStop(1, fade(col, 0));
  g.fillStyle = core;
  g.beginPath(); g.arc(0, 0, SPR_R * 0.6, 0, 6.3); g.fill();

  sprites.set(col, c);
  return c;
}

function portal(ctx, x, y, r, col, spin, glow) {
  if (r < 0.5 || glow <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = glow;
  ctx.globalCompositeOperation = 'lighter';   // hehku summautuu taustaan
  ctx.translate(x, y);
  ctx.rotate(spin);
  const s = r / SPR_R;
  ctx.scale(s, s);
  ctx.drawImage(sprite(col), -SPR, -SPR);
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
  if (!BACK) { BACK = sheet(paintBack); FACE = sheet(paintFace); }

  for (const t of TINT) {
    ctx.fillStyle = t.c;
    ctx.fillRect(t.r.x0, t.r.y0, t.r.x1 - t.r.x0, t.r.y1 - t.r.y0);
  }
  ctx.drawImage(BACK, 0, 0);
  labLive(ctx);

  const spin = clock / 1000;
  for (const p of PORTALS) {
    /* Sisäänmeno on aina ruudulla. Se sykkii hieman, ja imiessään se kiihtyy
       ja kasvaa. */
    const busy = trip && trip.p === p && trip.phase === 'in';
    const pull = busy ? 1 - clamp01(trip.t / WARP.suck) : 1;
    const pulse = 1 + Math.sin(spin * 2.2 + p.a.x) * 0.05;
    housing(ctx, p.a.x, p.a.y, p.a.r, p.col, 1);
    portal(ctx, p.a.x, p.a.y, p.a.r * pulse * lerp(1, 1.4, 1 - pull), p.col,
           spin * (busy ? 5 : 1.4), busy ? 1 : 0.8);

    /* Ulostulo vain silloin kun siitä tullaan — koneistoineen, koska pelkkä
       koneisto paljastaisi paikan jonka on määrä olla piilossa. */
    if (p.b.open > 0) {
      const u = ease(p.b.open);
      housing(ctx, p.b.x, p.b.y, p.b.r * u, p.col, u);
      portal(ctx, p.b.x, p.b.y, p.b.r * u, p.col, -spin * 4, 1);
    }
  }
}

/** Väliseinien pinta piirtyy seinien päälle, joten se kuuluu drawFrontiin.
    Taksi ei voi olla seinän sisällä, joten sen yli ei piirry mitään. */
function drawFront(ctx) {
  if (FACE) ctx.drawImage(FACE, 0, 0);
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
