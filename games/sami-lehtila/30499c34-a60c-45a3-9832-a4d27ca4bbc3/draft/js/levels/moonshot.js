/* Moonshot — kuu: pieni painovoima, yhdeksän lohkoa ja liukuovet.
 *
 * Yksi kenttä per tiedosto, jotta kaksi tekijää voi työstää eri kenttiä
 * yhtä aikaa kirjoittamatta toistensa yli. Kentän muoto on kuvattu
 * ../levels.js:ssä.
 *
 * Kentän idea kahdessa lauseessa. Ruutu on jaettu 3 × 3 lohkoon, ja lohkosta
 * toiseen pääsee vain liukuovista, jotka aukeavat ja sulkeutuvat omassa
 * tahdissaan. Painovoima on 30 % muusta pelistä, joten leijuminen oven edessä
 * on halpaa mutta **alas pääseminen vaatii työntöä alaspäin** — ovi joka on
 * auki nyt ei ole auki kun ehdit sinne, ja tippimittari juoksee.
 *
 * Ovia on kymmenen eikä kahtatoista: keskilohkosta lähtee neljä, mutta oikea
 * ylälohko ja vasen alalohko roikkuvat yhden oven varassa. Niihin on siis
 * kierrettävä, ja se kierto on kentän vaikeus.
 *
 *     TL — TM        1 tankkaus keskellä
 *     |    |         2 ylä keskimmäinen on pelkkä ulosmenoväylä
 *     ML — C — MR — TR
 *     |    |    |
 *     BL   BM — BR
 *
 * Kuun kaksi piirtosääntöä:
 *   1. Ilmakehää ei ole. Tähdet eivät tuiki, kaukainen ei sumene, varjot ovat
 *      teräviä. Etäisyys kerrotaan koolla ja kontrastilla, ei usvalla.
 *   2. Valo tulee ylävasemmalta. Kraatterien valoreunat, kupolien kiillot ja
 *      katosten yläsärmät ovat kaikki samalla puolella.
 */
import { W, H, CEIL, HATCH } from './shared.js';

/* ---------------------------------------------------------------- ruudukko

   Lohkojen rajat. Väliseinät ovat T paksuja, ja lohkon sisämitta on se mitä
   väliin jää: noin 220 × 325. Ne ovat tässä lukuina eivätkä laskettuina,
   koska kaikki muu kentässä paikannetaan näihin ja luvun siirtäminen on
   helpompaa kuin kaavan. */
const T = 16;
const COLS = [[16, 237], [253, 467], [483, 704]];
const ROWS = [[16, 344], [360, 680], [696, 1024]];
const VX = [237, 467];                        // pystyseinien vasemmat reunat
const HY = [344, 680];                        // vaakaseinien yläreunat

const cell = (c, r) => ({ x0: COLS[c][0], x1: COLS[c][1], y0: ROWS[r][0], y1: ROWS[r][1] });

/* --------------------------------------------------------------------- ovet

   Ovi on aukko väliseinässä ja aukon edessä luukku, joka liukuu seinän sisään.
   Luukku annetaan kentän walls-listassa, jolloin se on sama olio kuin pelin
   WALLS-taulukossa: update siirtää sitä ja törmäystarkistus lukee uuden paikan
   seuraavalla ruudulla. Sulkeutuva ovi siis murskaa taksin — siksi jokaisessa
   ovessa on lamppurivi, joka alkaa vilkkua ennen sulkeutumista.

   dir kertoo kumpaan suuntaan luukku vetäytyy auki. Suunta on valittu sen
   mukaan kummalla puolella aukkoa on umpinaista seinää vähintään luukun
   verran — muuten auki oleva luukku törröttäisi viereiseen lohkoon. */
const GAP = 92;                               // oviaukon vapaa mitta
const DOORS = [
  { id: 'TL-TM', axis: 'V', line: 0, at: 96, dir: 1, phase: 0.00 },
  { id: 'TL-ML', axis: 'H', line: 0, at: 60, dir: 1, phase: 0.55 },
  { id: 'TM-C', axis: 'H', line: 0, at: 290, dir: 1, phase: 0.28 },
  { id: 'TR-MR', axis: 'H', line: 0, at: 596, dir: -1, phase: 0.72 },
  { id: 'ML-C', axis: 'V', line: 0, at: 404, dir: -1, phase: 0.40 },
  { id: 'C-MR', axis: 'V', line: 1, at: 520, dir: -1, phase: 0.12 },
  { id: 'ML-BL', axis: 'H', line: 1, at: 140, dir: 1, phase: 0.66 },
  { id: 'C-BM', axis: 'H', line: 1, at: 352, dir: -1, phase: 0.85 },
  { id: 'MR-BR', axis: 'H', line: 1, at: 540, dir: -1, phase: 0.34 },
  { id: 'BM-BR', axis: 'V', line: 1, at: 780, dir: 1, phase: 0.58 },
];

/* Oven rytmi. Nämä ovat säätöpaneelissa kentän omassa laatikossa, joten olio
   muuttuu lennossa eikä mitään näistä johdettua saa laskea etukäteen.

   cycle  yhden oven koko kierros sekunteina
   open   kuinka suuri osa kierroksesta ovi on auki
   move   kuinka kauan liuku kestää
   warn   kuinka kauan lamput vilkkuvat ennen sulkeutumista */
const DOOR = { cycle: 7.4, open: 0.42, move: 0.6, warn: 1.1 };

/** Oviaukko px-koordinaatteina: pystyovi on seinässä VX[line], vaakaovi HY:ssä. */
function gapBox(d) {
  return d.axis === 'V'
    ? { x: VX[d.line], y: d.at, w: T, h: GAP }
    : { x: d.at, y: HY[d.line], w: GAP, h: T };
}

/* Luukut. Laatikko on se mikä sulkee aukon; update siirtää sitä auki päin.
   Lähtöpaikka on kiinni, koska kenttä alkaa siitä että kaikki on kiinni ja
   ovet aukeavat vuorollaan. */
const PANELS = DOORS.map(d => Object.assign({ door: d }, gapBox(d)));

/* Väliseinät: yhtenäinen seinä miinus oviaukot. Aukon kohdalle jää tyhjää ja
   loput ovat umpinaisia paloja. */
function segments(axis, line) {
  const gaps = DOORS.filter(d => d.axis === axis && d.line === line)
    .map(d => [d.at, d.at + GAP]).sort((a, b) => a[0] - b[0]);
  const out = [];
  let from = axis === 'V' ? CEIL : T;
  const end = axis === 'V' ? H - T : W - T;
  for (const [a, b] of gaps) {
    if (a > from) out.push([from, a]);
    from = b;
  }
  if (end > from) out.push([from, end]);
  return out.map(([a, b]) => axis === 'V'
    ? { x: VX[line], y: a, w: T, h: b - a }
    : { x: a, y: HY[line], w: b - a, h: T });
}

const GRID = [];
for (const line of [0, 1]) GRID.push(...segments('V', line), ...segments('H', line));

/* ------------------------------------------------------------------ kupolit

   Kupolit ovat **kulissia, eivät esteitä** — sama ratkaisu kuin huvipuiston
   laitteilla. Ensimmäisessä versiossa ne olivat seiniä, ja katoslaatta tukki
   kaksi oviaukkoa; Sami 20.9.2026: "ei collisioneita näihin ollenkaan".
   Siksi täällä ei ole törmäyslaatikoita eikä drawFrontin uudelleenmaalausta:
   kupoli piirtyy taustaan, ruudukon seinien alle.

   Kolme kupolia tasangolla, ei muuta. Katos (se vaakapalkki kupolin poikki)
   on poistettu: se oli oveneste ja näytti oudolta.

   base  se pinta jolla kupoli seisoo */
const DOMES = [
  { x: 122, base: 1004, r: 62 },
  { x: 352, base: 1004, r: 60 },
  { x: 600, base: 1004, r: 58 },
];

const spanAt = (d, h) => Math.sqrt(Math.max(0, d.r * d.r - h * h));

/* Propsit: tolpat ja raketti. Nämäkään eivät ole esteitä.

   Tolppa on ohut ja suora, ja sen päässä on neliönmuotoinen valo joka vilkkuu
   vihreänä tai punaisena omalla jaksollaan. Ne seisovat tasangolla ja kansien
   päällä, ja niiden tehtävä on tehdä tyhjästä kohdasta rakennettu. */
const POLES = [
  { x: 46, base: 1004, h: 92, hz: 0.7, col: '#7bf0a0' },
  { x: 214, base: 1004, h: 116, hz: 0.45, col: '#ff5d7a' },
  { x: 300, base: 1004, h: 78, hz: 1.1, col: '#7bf0a0' },
  { x: 446, base: 1004, h: 104, hz: 0.6, col: '#7bf0a0' },
  { x: 528, base: 1004, h: 86, hz: 0.35, col: '#ff5d7a' },
  { x: 686, base: 1004, h: 98, hz: 0.85, col: '#7bf0a0' },
  { x: 330, base: HY[0], h: 40, hz: 0.5, col: '#7bf0a0' },
  { x: 700, base: HY[0], h: 36, hz: 0.9, col: '#ff5d7a' },
  { x: 120, base: HY[1], h: 44, hz: 0.75, col: '#7bf0a0' },
  { x: 640, base: HY[1], h: 38, hz: 0.55, col: '#7bf0a0' },
];

/* Raketti telineessään tasangolla. Nousee horisontin yli, jotta siluetti
   näkyy mustaa taivasta vasten. */
const ROCKET = { x: 196, base: 1002, h: 132 };

const SOLIDS = [...GRID, ...PANELS];

/* ---------------------------------------------------------------- arvonnat

   Tähdet, kraatterit ja kivet arvotaan kerran latauksessa omalla siemenellä,
   jotta kenttä näyttää joka kerta samalta eikä mikään väristä ruudusta
   toiseen. Math.random ei kelpaa piirtoon. */
let seed = 20260920;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const between = (a, b) => a + rnd() * (b - a);

const HORIZON = 884;                          // pölytasangon takareuna
const DUST_FAR = '#262a33', DUST_NEAR = '#59606e';
const FRAME = '#414b5c', WARM = '#ffd479';

const STARS = [];
for (let i = 0; i < 150; i++) {
  const big = rnd() < 0.08;
  STARS.push({
    x: between(4, W - 4), y: between(4, HORIZON - 30),
    r: big ? between(1.3, 1.9) : between(0.5, 1.1),
    a: big ? between(0.75, 1) : between(0.25, 0.7),
    c: rnd() < 0.12 ? '#ffe9c4' : rnd() < 0.2 ? '#cfe0ff' : '#ffffff',
  });
}

/* Kraatterit tasangolla. Kauempi eli ylempi on pienempi ja litteämpi —
   perspektiivi tulee koosta, ei sumusta. */
const CRATERS = [];
for (let i = 0; i < 26; i++) {
  const y = between(HORIZON + 8, H - 10);
  const t = (y - HORIZON) / (H - HORIZON);
  const rx = between(16, 70) * (0.42 + t * 0.95);
  CRATERS.push({ x: between(-20, W + 20), y, rx, ry: rx * (0.15 + t * 0.24), t });
}
CRATERS.sort((a, b) => a.y - b.y);

const ROCKS = [];
for (let i = 0; i < 22; i++) {
  const y = between(HORIZON + 12, H - 14);
  const t = (y - HORIZON) / (H - HORIZON);
  ROCKS.push({ x: between(8, W - 8), y, r: between(2, 8) * (0.5 + t), t });
}

/* Kaukaiset kraatterivallit horisontissa: kolme kerrosta, ylempi kauempana ja
   tummempi. Kummun korkeus arvotaan kerran. */
const RIDGES = [
  { y: HORIZON - 4, h: 40, fill: '#191d25', humps: [] },
  { y: HORIZON + 10, h: 54, fill: '#20252f', humps: [] },
  { y: HORIZON + 26, h: 70, fill: '#292f3a', humps: [] },
];
for (const r of RIDGES) {
  for (let x = -60; x < W + 120; x += between(70, 150)) {
    r.humps.push({ x, w: between(120, 230), h: between(0.35, 1) * r.h });
  }
}

const FAR_DOMES = [
  { x: 676, r: 34, y: HORIZON + 6, a: 0.5 },
  { x: 40, r: 26, y: HORIZON + 10, a: 0.45 },
];

/* ------------------------------------------------------------------ ovilogiikka

   Yksi kierros: liuku auki, pito auki, liuku kiinni, pito kiinni. Vaihe on
   oven oma, joten ovet eivät ole metronomi vaan kentän läpi kulkee aalto.
   Kaikki lasketaan kutsuhetkellä, koska DOOR muuttuu säätimistä. */
function doorPhase(d, t) {
  const cyc = Math.max(1.2, DOOR.cycle);
  const mv = Math.min(DOOR.move, cyc * 0.2);
  const hold = Math.max(0.2, cyc * DOOR.open);
  const u = (((t / cyc + d.phase) % 1) + 1) % 1 * cyc;
  if (u < mv) return { o: u / mv, warn: 0 };
  if (u < mv + hold) {
    const left = mv + hold - u;
    return { o: 1, warn: left < DOOR.warn ? 1 - left / DOOR.warn : 0 };
  }
  if (u < mv * 2 + hold) return { o: 1 - (u - mv - hold) / mv, warn: 1 };
  return { o: 0, warn: 0 };
}

/* Luukun paikka: kiinni aukon päällä, auki dir-suuntaan aukon mitan verran
   seinän sisään. */
function moveDoors(t) {
  for (const p of PANELS) {
    const d = p.door;
    const st = doorPhase(d, t);
    p.open = st.o;
    p.warn = st.warn;
    const slide = st.o * GAP * d.dir;
    if (d.axis === 'V') { p.y = d.at + slide; p.x = VX[d.line]; }
    else { p.x = d.at + slide; p.y = HY[d.line]; }
  }
}

let clock = 0;                                // oma kello: pelin runT pysähtyy luukusta tullessa

/* ------------------------------------------------------------------ piirto */

function stars(ctx) {
  for (const s of STARS) {
    ctx.globalAlpha = s.a;
    ctx.fillStyle = s.c;
    ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
  }
  ctx.globalAlpha = 1;
}

const EARTH = { x: 120, y: 150, r: 46 };
function earth(ctx) {
  const e = EARTH;
  const halo = ctx.createRadialGradient(e.x, e.y, e.r * 0.9, e.x, e.y, e.r * 2.2);
  halo.addColorStop(0, 'rgba(120,180,255,.22)');
  halo.addColorStop(1, 'rgba(120,180,255,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 2.2, 0, 6.3); ctx.fill();

  ctx.save();
  ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 6.3); ctx.clip();
  ctx.fillStyle = '#2f6ec9';
  ctx.fillRect(e.x - e.r, e.y - e.r, e.r * 2, e.r * 2);
  ctx.fillStyle = '#5c9a5f';
  for (const [dx, dy, rx, ry] of [
    [-0.42, -0.30, 0.34, 0.26], [-0.10, 0.28, 0.30, 0.34],
    [0.34, -0.14, 0.26, 0.30], [0.18, 0.62, 0.34, 0.18],
  ]) {
    ctx.beginPath();
    ctx.ellipse(e.x + dx * e.r, e.y + dy * e.r, rx * e.r, ry * e.r, dx, 0, 6.3);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,.26)';
  for (const [dy, ry] of [[-0.55, 0.13], [0.02, 0.10], [0.48, 0.12]]) {
    ctx.beginPath();
    ctx.ellipse(e.x - e.r * 0.1, e.y + dy * e.r, e.r * 0.95, ry * e.r, 0.2, 0, 6.3);
    ctx.fill();
  }
  const term = ctx.createLinearGradient(e.x - e.r, e.y - e.r, e.x + e.r, e.y + e.r);
  term.addColorStop(0.18, 'rgba(2,4,10,0)');
  term.addColorStop(0.62, 'rgba(2,4,10,.55)');
  term.addColorStop(1, 'rgba(2,4,10,.92)');
  ctx.fillStyle = term;
  ctx.fillRect(e.x - e.r, e.y - e.r, e.r * 2, e.r * 2);
  ctx.restore();

  ctx.strokeStyle = 'rgba(190,225,255,.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(e.x, e.y, e.r - 0.6, Math.PI * 0.72, Math.PI * 1.62); ctx.stroke();
}

function ridges(ctx) {
  for (const r of RIDGES) {
    ctx.fillStyle = r.fill;
    ctx.beginPath();
    ctx.moveTo(-80, r.y + 90);
    ctx.lineTo(-80, r.y);
    for (const h of r.humps) ctx.quadraticCurveTo(h.x + h.w * 0.5, r.y - h.h, h.x + h.w, r.y);
    ctx.lineTo(W + 140, r.y + 90);
    ctx.closePath();
    ctx.fill();
  }
}

function farDomes(ctx) {
  for (const f of FAR_DOMES) {
    ctx.globalAlpha = f.a;
    ctx.fillStyle = '#2d3542';
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = 'rgba(176,206,236,.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, Math.PI * 1.05, Math.PI * 1.75); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function crater(ctx, c) {
  const lit = 0.3 + c.t * 0.45;
  const g = ctx.createLinearGradient(c.x - c.rx, c.y - c.ry, c.x + c.rx, c.y + c.ry);
  g.addColorStop(0, `rgba(182,189,201,${lit})`);
  g.addColorStop(0.5, `rgba(120,128,142,${lit * 0.5})`);
  g.addColorStop(1, `rgba(20,23,29,${0.25 + c.t * 0.3})`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, 6.3); ctx.fill();

  ctx.fillStyle = `rgba(16,19,24,${0.42 + c.t * 0.3})`;
  ctx.beginPath();
  ctx.ellipse(c.x + c.rx * 0.10, c.y + c.ry * 0.16, c.rx * 0.74, c.ry * 0.68, 0, 0, 6.3);
  ctx.fill();

  ctx.strokeStyle = `rgba(206,214,228,${lit * 0.8})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, Math.PI * 0.75, Math.PI * 1.75); ctx.stroke();
}

function plain(ctx) {
  const g = ctx.createLinearGradient(0, HORIZON, 0, H);
  g.addColorStop(0, DUST_FAR);
  g.addColorStop(0.45, '#3d434f');
  g.addColorStop(1, DUST_NEAR);
  ctx.fillStyle = g;
  ctx.fillRect(0, HORIZON, W, H - HORIZON);

  for (const c of CRATERS) crater(ctx, c);
  for (const r of ROCKS) {
    ctx.fillStyle = `rgba(20,23,29,${0.5 + r.t * 0.35})`;
    ctx.beginPath(); ctx.ellipse(r.x + r.r * 0.4, r.y + r.r * 0.3, r.r, r.r * 0.6, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = `rgba(150,158,172,${0.35 + r.t * 0.45})`;
    ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r * 0.9, r.r * 0.62, -0.3, 0, 6.3); ctx.fill();
  }
}

/* Kupoli: lasikellon kaari, pituus- ja leveyspiirit, kiilto ylävasemmalla ja
   sisällä valaistu pikkukaupunki. Jalustassa on vain ohut lista ja sulkuovi —
   ei mitään kupolin poikki menevää palkkia. */
function dome(ctx, d) {
  ctx.save();
  ctx.translate(d.x, d.base);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-d.r, 0);
  ctx.arc(0, 0, d.r, Math.PI, 0);
  ctx.closePath();
  ctx.clip();

  const g = ctx.createLinearGradient(-d.r * 0.6, -d.r, d.r * 0.7, 0);
  g.addColorStop(0, 'rgba(154,216,255,.26)');
  g.addColorStop(0.45, 'rgba(90,140,190,.13)');
  g.addColorStop(1, 'rgba(12,18,28,.5)');
  ctx.fillStyle = g;
  ctx.fillRect(-d.r, -d.r, d.r * 2, d.r);

  interior(ctx, d);

  ctx.strokeStyle = 'rgba(190,230,255,.16)';
  ctx.lineWidth = 1.1;
  for (let i = 1; i < 4; i++) {
    const rx = Math.abs(d.r * (i / 4) * 2 - d.r);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, d.r, 0, Math.PI, 0); ctx.stroke();
  }
  for (let i = 1; i < 3; i++) {
    const rr = d.r * (i / 3);
    ctx.beginPath(); ctx.ellipse(0, 0, spanAt(d, rr), rr, 0, Math.PI, 0); ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(235,250,255,.5)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, d.r - 5, Math.PI * 1.08, Math.PI * 1.38); ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgba(180,206,235,.5)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, d.r, Math.PI, 0); ctx.stroke();

  ctx.fillStyle = '#39414f';                  // ohut jalkalista
  ctx.fillRect(-d.r, -4, d.r * 2, 4);
  ctx.fillStyle = 'rgba(214,224,240,.35)';
  ctx.fillRect(-d.r, -4, d.r * 2, 1.5);

  ctx.fillStyle = 'rgba(8,12,20,.9)';         // sulkuovi: syvennys, ei laatikko
  ctx.beginPath();
  ctx.moveTo(-8, -2); ctx.lineTo(-8, -13);
  ctx.quadraticCurveTo(0, -20, 8, -13);
  ctx.lineTo(8, -2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,212,121,.55)';
  ctx.fillRect(-8, -3.5, 16, 1.5);
  ctx.restore();
}

/* Kupolin sisus: pimeä pohja, matalia rakennuksia ja puita, ikkunoissa valoa.
   Piirretään kupolin omassa koordinaatistossa, jossa 0 on jalusta. */
function interior(ctx, d) {
  const unit = d.r / 100;
  ctx.fillStyle = 'rgba(8,12,20,.5)';
  ctx.fillRect(-d.r, -d.r * 0.42, d.r * 2, d.r * 0.42);

  for (const [rel, hh, ww] of [[-0.58, 34, 26], [-0.24, 52, 22], [0.12, 30, 30], [0.48, 44, 24]]) {
    const bw = ww * unit, bh = hh * unit, bx = rel * d.r - bw / 2;
    ctx.fillStyle = '#1d2530';
    ctx.fillRect(bx, -bh, bw, bh);
    ctx.fillStyle = 'rgba(255,212,121,.75)';
    for (let wy = -bh + 4 * unit; wy < -6 * unit; wy += 9 * unit) {
      for (let wx = bx + 3 * unit; wx < bx + bw - 4 * unit; wx += 8 * unit) {
        if (((wx * 7 + wy * 13) | 0) % 5 < 3) ctx.fillRect(wx, wy, 3 * unit, 4 * unit);
      }
    }
  }
  ctx.fillStyle = '#2f6b45';
  for (const rel of [-0.80, 0.72]) {
    const tx = rel * d.r, th = 20 * unit;
    ctx.fillRect(tx - 1.5 * unit, -th * 0.45, 3 * unit, th * 0.45);
    ctx.beginPath(); ctx.arc(tx, -th * 0.55, th * 0.42, 0, 6.3); ctx.fill();
  }
}

/* Tolppa: ohut suora masto, päässä neliövalo joka vilkkuu omalla jaksollaan.
   Kello on performance.now(), koska pelin runT pysähtyy luukusta tullessa. */
function pole(ctx, p) {
  const top = p.base - p.h;
  ctx.fillStyle = 'rgba(146,160,182,.75)';
  ctx.fillRect(p.x - 1.5, top, 3, p.h);
  ctx.fillStyle = 'rgba(120,134,156,.8)';     // jalka
  ctx.fillRect(p.x - 5, p.base - 4, 10, 4);

  const on = (clock / 1000 / Math.max(0.15, p.hz)) % 2 < 1;
  ctx.fillStyle = on ? p.col : 'rgba(40,48,62,.85)';
  if (on) { ctx.shadowColor = p.col; ctx.shadowBlur = 10; }
  ctx.fillRect(p.x - 4, top - 8, 8, 8);
  ctx.shadowBlur = 0;
}

/* Raketti telineessä: runko, kärki, evät ja ristikkotorni kylkeen. Kulissia. */
function rocket(ctx, k) {
  const top = k.base - k.h, wRoc = 17;
  ctx.fillStyle = '#7d8798';                  // ristikkotorni
  ctx.fillRect(k.x + 22, top + 12, 4, k.h - 12);
  ctx.fillRect(k.x + 44, top + 12, 4, k.h - 12);
  ctx.strokeStyle = 'rgba(125,135,152,.85)';
  ctx.lineWidth = 2;
  for (let y = top + 20; y < k.base; y += 22) {
    ctx.beginPath(); ctx.moveTo(k.x + 26, y); ctx.lineTo(k.x + 44, y + 11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(k.x + 26, y + 11); ctx.lineTo(k.x + 44, y); ctx.stroke();
  }

  ctx.fillStyle = '#2a3140';                  // evät
  ctx.beginPath();
  ctx.moveTo(k.x - wRoc, k.base); ctx.lineTo(k.x - wRoc - 11, k.base);
  ctx.lineTo(k.x - wRoc, k.base - 34); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(k.x + wRoc, k.base); ctx.lineTo(k.x + wRoc + 11, k.base);
  ctx.lineTo(k.x + wRoc, k.base - 34); ctx.closePath(); ctx.fill();

  const g = ctx.createLinearGradient(k.x - wRoc, 0, k.x + wRoc, 0);
  g.addColorStop(0, '#cfd6e4');
  g.addColorStop(0.45, '#f2f5fa');
  g.addColorStop(1, '#79839a');
  ctx.fillStyle = g;
  ctx.fillRect(k.x - wRoc, top + 26, wRoc * 2, k.h - 26);

  ctx.beginPath();                            // kärki
  ctx.moveTo(k.x - wRoc, top + 28);
  ctx.quadraticCurveTo(k.x, top - 12, k.x + wRoc, top + 28);
  ctx.closePath();
  ctx.fillStyle = '#e9edf5'; ctx.fill();
  ctx.fillStyle = '#c8324a';
  ctx.fillRect(k.x - wRoc, top + 44, wRoc * 2, 7);
  ctx.fillStyle = 'rgba(12,18,28,.55)';       // ikkuna
  ctx.beginPath(); ctx.arc(k.x, top + 66, 5, 0, 6.3); ctx.fill();

  ctx.fillStyle = 'rgba(20,26,36,.7)';        // suutin
  ctx.fillRect(k.x - 9, k.base - 6, 18, 6);
}

/* Oviaukon karmi ja lamppurivi. Lamput ovat aukon molemmin puolin seinässä,
   eli ne näkyvät kummastakin lohkosta — ovi on se asia jota pelaaja lukee
   koko ajan. Vilkku on sama kieli kuin alustan valolistassa: punainen kun
   sulkeutuminen on tulossa. */
function doorLamps(ctx) {
  for (const p of PANELS) {
    const g = gapBox(p.door);
    const blink = p.warn > 0 && (clock / 120 | 0) % 2 === 0;
    const col = p.warn > 0 ? (blink ? '#ff5d7a' : '#5b2634') : (p.open > 0.02 ? '#7bf0a0' : '#2c3a4e');
    ctx.fillStyle = col;
    if (p.warn > 0 && blink) { ctx.shadowColor = col; ctx.shadowBlur = 12; }
    if (p.door.axis === 'V') {
      ctx.fillRect(g.x + 2, g.y - 7, T - 4, 4);
      ctx.fillRect(g.x + 2, g.y + g.h + 3, T - 4, 4);
    } else {
      ctx.fillRect(g.x - 7, g.y + 2, 4, T - 4);
      ctx.fillRect(g.x + g.w + 3, g.y + 2, 4, T - 4);
    }
    ctx.shadowBlur = 0;
  }
}

/* Luukun pinta maalataan pelin seinälaatikon päälle: vinoraidat ja etureunan
   valojuova. Rajataan tasan luukun laatikkoon, jonka sisällä ei voi olla
   taksia. */
function panelFace(ctx, p) {
  const g = gapBox(p.door);                   // näkyviin vain se osa joka on aukossa
  const x0 = Math.max(p.x, g.x), y0 = Math.max(p.y, g.y);
  const x1 = Math.min(p.x + p.w, g.x + g.w), y1 = Math.min(p.y + p.h, g.y + g.h);
  if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return; // kokonaan seinän sisällä
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
  ctx.fillStyle = '#39414f';
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.strokeStyle = 'rgba(255,212,121,.35)';
  ctx.lineWidth = 6;
  for (let i = -p.h; i < p.w + p.h; i += 18) {
    ctx.beginPath();
    ctx.moveTo(p.x + i, p.y + p.h);
    ctx.lineTo(p.x + i + p.h, p.y);
    ctx.stroke();
  }
  const lead = p.warn > 0 ? '#ff5d7a' : '#9ad8ff';
  ctx.fillStyle = lead;
  if (p.door.axis === 'V') ctx.fillRect(p.x, p.door.dir > 0 ? p.y : p.y + p.h - 3, p.w, 3);
  else ctx.fillRect(p.door.dir > 0 ? p.x : p.x + p.w - 3, p.y, 3, p.h);
  ctx.restore();
}

function moonBack(ctx, api) {
  clock = performance.now();
  stars(ctx);
  earth(ctx);
  ridges(ctx);
  farDomes(ctx);
  plain(ctx);
  for (const d of DOMES) {
    ctx.fillStyle = 'rgba(10,12,18,.4)';
    ctx.beginPath(); ctx.ellipse(d.x + 14, d.base + 5, d.r * 1.05, 10, 0, 0, 6.3); ctx.fill();
  }
  for (const d of DOMES) dome(ctx, d);
  rocket(ctx, ROCKET);
  for (const p of POLES) pole(ctx, p);
  for (const p of api.pads) mount(ctx, p);
  doorLamps(ctx);
}

/* Alustan kiinnike: alusta on pultattu seinään eikä leiju. Levy seinää vasten
   ja kaksi vinotukea alustan alle; puoli tulee MOUNTS-taulusta. Piirretään
   drawBackissa, koska peli piirtää alustat vasta sen jälkeen. */
const MOUNTS = { 1: 'left', 2: 'left', 3: 'left', 4: 'left', 5: 'right', 6: 'left', 7: 'left', 0: 'left' };
function mount(ctx, p) {
  const right = MOUNTS[p.id] === 'right';
  const wx = right ? p.x + p.w : p.x;         // seinäpinta
  const sgn = right ? 1 : -1;
  ctx.fillStyle = '#39414f';
  ctx.fillRect(right ? wx - 6 : wx, p.y - 4, 6, p.h + 22);
  ctx.fillStyle = 'rgba(214,224,240,.32)';
  ctx.fillRect(right ? wx - 6 : wx, p.y - 4, 6, 1.5);

  ctx.strokeStyle = 'rgba(146,160,182,.8)';   // vinotuet
  ctx.lineWidth = 3;
  for (const reach of [0.42, 0.78]) {
    ctx.beginPath();
    ctx.moveTo(wx - sgn * 1, p.y + p.h + 16);
    ctx.lineTo(wx - sgn * (p.w * reach), p.y + p.h + 1);
    ctx.stroke();
  }
  ctx.fillStyle = WARM;                       // pultit
  for (const dy of [2, p.h + 12]) ctx.fillRect(right ? wx - 5 : wx + 1, p.y + dy, 3, 3);
}

function moonFront(ctx, api) {
  for (const p of PANELS) panelFace(ctx, p);
  doorLamps(ctx);
}

/* ------------------------------------------------------------------ kenttä */

export const moonshot = {
  /* Kuu. Painovoima on kentän kerroin (mul) eikä oma laskutoimitus, joten
     säätöpaneelin globaali painovoima jää voimaan ja kuu on murto-osa siitä —
     kuten myrskykentässä. 0.3 tarkoittaa oletuksilla 75 px/s².

     Alustat ovat lohkoittain: jokaisessa lohkossa yksi, paitsi keskellä
     tankkaus ja ylhäällä keskellä ei mitään — se lohko on pelkkä ulosmenoväylä
     luukulle. Alustat ovat kupolien vieressä ja kapeampia (104 px) kuin muissa
     kentissä, koska lohkon sisämitta on 220 px ja oviaukko vie siitä 92.

     Nappien nurkat (x 30…158, y 778…964) kierretään: vasemman alalohkon
     alusta on lohkon yläreunassa. */
  name: 'Moonshot',
  glow: '#cfd6e4',
  sky: ['#03040a', '#06080f', '#0b0f17'],
  gate: HATCH,
  start: 1,
  firstFrom: 2,
  walls: SOLIDS,
  pads: [
    { id: 1, x: 16, y: 238, w: 104, h: 18 },    // TL, vasen kehäseinä
    { id: 2, x: 483, y: 250, w: 104, h: 18 },   // TR, keskiseinä
    { id: 3, x: 16, y: 600, w: 104, h: 18 },    // ML, vasen kehäseinä
    { id: 4, x: 483, y: 430, w: 104, h: 18 },   // MR, keskiseinä
    { id: 5, x: 133, y: 748, w: 104, h: 18 },   // BL, oikea seinä (napit vievät nurkan)
    { id: 6, x: 253, y: 812, w: 104, h: 18 },   // BM, vasen seinä
    { id: 7, x: 483, y: 900, w: 104, h: 18 },   // BR, keskiseinä
    { id: 0, x: 253, y: 560, w: 104, h: 18, fuel: true },  // keskilohko, vasen seinä
  ],
  mul: { grav: 0.3 },
  tune: [
    {
      name: 'ovet', obj: DOOR,
      sliders: [
        { key: 'cycle', label: 'oven kierros s', min: 2, max: 20, step: 0.2 },
        { key: 'open', label: 'auki osuus kierroksesta', min: 0.1, max: 0.9, step: 0.02 },
        { key: 'move', label: 'liu\'un kesto s', min: 0.1, max: 2, step: 0.05 },
        { key: 'warn', label: 'varoitus ennen sulkua s', min: 0, max: 3, step: 0.1 },
      ],
    },
    { name: 'kentän kertoimet', open: false, mul: ['grav', 'thrust', 'burn', 'landVX'] },
  ],
  update: (dt, api) => moveDoors(api.t),
  drawBack: moonBack,
  drawFront: moonFront,
};
