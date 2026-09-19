/* Trouble Factory — tehdashalli jossa koneet syövät ohjauksen.
 *
 * Yksi kenttä per tiedosto, jotta kaksi tekijää voi työstää eri kenttiä
 * yhtä aikaa kirjoittamatta toistensa yli. Kentän muoto on kuvattu
 * ../levels.js:ssä.
 */
import { W, H, CEIL, HATCH } from './shared.js';

/* ------------------------------------------------------------- rakenteet

   Kiinteät koneet annetaan kentän walls-listassa, jolloin peli piirtää ne
   omalla seinätyylillään ja törmäys hoituu itsestään. Koneiden elävät osat
   — navat, hehku ja kaari — piirretään drawFrontissa seinän päälle, koska
   drawBack jää seinien alle. Tässä ylhäällä siksi, että const ei nouse ja
   LEVELS tarvitsee nämä jo rakentuessaan. */
const COIL_L = { x: 120, y: 470, w: 60, h: 130 };   // vasen kelatorni
const COIL_R = { x: 540, y: 470, w: 60, h: 130 };   // oikea kelatorni
const TRAFO = { x: 624, y: 150, w: 80, h: 62 };     // muuntaja oikeassa seinässä
const DYNAMO = { x: 16, y: 556, w: 110, h: 62 };    // generaattori vasemmassa seinässä

/* ------------------------------------------------------------ kipinävälit

   Kentän mekaniikka on yhdessä lauseessa: kolmen kipinävälin ympärillä on
   kenttä, ja kentässä ohjausvektori pätkii ja kääntyy välillä väärinpäin.
   Kaikki muu täällä on sitä, että pelaaja näkee sen tulevan.

   Väli on jana kahden navan välillä, ei piste: häiriö on voimakkain kaaren
   kohdalla ja laimenee reunoja kohti. Koneet käyvät vuorotellen (at on osuus
   kierroksesta), joten hallissa on rytmi jonka voi oppia — sama periaate kuin
   Stormportin tuulessa. Satunnaista on vain se kumpaan suuntaan suutin
   laukeaa, ei se milloin.

   Jokainen väli vartioi yhtä reittiä:
     A  kelatornien välissä, suoraan alustan 3 yllä — kentän iso portti
     B  muuntajalta riippuvalle nokalle, alustan 2 laskeutumislinjalla
     C  generaattorilta pilariin, alustan 4 laskeutumislinjalla
   Alustat 1 ja 5 ja tankkaus ovat rauhallisia: kentässä pitää olla paikka
   jossa pelaaja saa hengähtää ja katsoa rytmiä. */
const GAPS = [
  { ax: 182, ay: 462, bx: 538, by: 462, at: 0.00, seed: 3 },
  { ax: 622, ay: 214, bx: 470, by: 232, at: 0.37, seed: 11 },
  { ax: 128, ay: 620, bx: 268, by: 636, at: 0.71, seed: 23 },
];

/* Häiriön muoto. Nämä ovat säätöpaneelissa kentän omassa laatikossa, joten
   olio muuttuu lennossa — mitään näistä johdettua ei saa laskea etukäteen.

   on      kuinka kauan suutin palaa kerrallaan
   off     kuinka pitkä katko niiden välissä on
   jitter  kummankin päälle arvotaan tämän verran suuntaan tai toiseen, jottei
           pätkintä ole metronomi vaan sekoava ohjaus
   flip    kuinka usein katko onkin vastavoima: suutin laukeaa vastakkaiseen
           suuntaan sen sijaan että olisi hiljaa

   Sama kaava kuin tyhjän tankin pätkinnässä (P.dryOn / P.dryOff / P.dryJitter),
   jotta kaksi eri syytä samalle tuntumalle säätyy samannäköisillä nupeilla. */
const GLITCH = { on: 0.18, off: 0.14, jitter: 0.06, flip: 0.3 };

/* Koneiden rytmi ja kentän ulottuvuus.

   cycle  yhden koneen kierros
   arc    kuinka kauan kaari palaa
   warn   latautuminen ennen kaarta: navat hehkuvat ja sirisevät, mutta ohjaus
          on vielä ehjä — tämä on se hetki jossa ehtii päättää mitä tekee
   reach  kuinka kauas kaaresta häiriö yltää; reunalla se on nyppäisy ja
          kaaren kohdalla täysi */
const MACH = { cycle: 6.5, arc: 1.7, warn: 0.9, reach: 130 };

const RAMP = 0.12;                            // kaaren syttymisen pehmennys
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = x => x * x * (3 - 2 * x);

/* Kaaren vaihe: 0 ennen syttymistä, 1 täysillä. Latautuminen palautetaan
   erikseen, koska se on varoitus eikä häiriö. */
function phaseOf(gap, t) {
  const cycle = Math.max(0.5, MACH.cycle);
  const arc = Math.min(MACH.arc, cycle * 0.9);
  const u = ((t / cycle + gap.at) % 1 + 1) % 1;
  const s = u * cycle;
  if (s < arc) {
    const ramp = Math.min(RAMP, arc / 2);
    const env = s < ramp ? smooth(s / ramp)
      : s > arc - ramp ? 1 - smooth((s - (arc - ramp)) / ramp) : 1;
    return { on: env, charge: 0 };
  }
  const left = cycle - s;
  return { on: 0, charge: MACH.warn > 0 ? clamp01(1 - left / MACH.warn) : 0 };
}

/** Etäisyys pisteestä janaan: kenttä on kaaren ympärillä eikä napojen. */
function distToGap(gap, x, y) {
  const dx = gap.bx - gap.ax, dy = gap.by - gap.ay;
  const len = dx * dx + dy * dy;
  const u = len ? clamp01(((x - gap.ax) * dx + (y - gap.ay) * dy) / len) : 0;
  const px = gap.ax + dx * u, py = gap.ay + dy * u;
  return Math.hypot(x - px, y - py);
}

/** Häiriön voimakkuus taksin kohdalla, 0…1. Voimakkain kaari voittaa. */
function fieldAt(x, y, t) {
  let g = 0, near = null;
  for (const gap of GAPS) {
    const ph = phaseOf(gap, t);
    if (ph.on <= 0) continue;
    const d = distToGap(gap, x, y);
    const f = clamp01(1 - d / Math.max(10, MACH.reach));
    const v = ph.on * smooth(f);
    if (v > g) { g = v; near = gap; }
  }
  return { g, near };
}

/* ------------------------------------------------------------------ tila */
const fac = {
  t: 0, taxi: null,
  g: 0, near: null,                           // häiriö tällä ruudulla
  phase: 0, firing: true, flipNow: false,     // pätkinnän vaihe
  sparks: [],
  bolts: GAPS.map(() => null), boltT: 0,
};

/** Yhden vaiheen kesto arvottuna, sama kaava kuin tyhjän tankin pätkinnässä. */
const glitchLen = (firing, rand) =>
  Math.max(0.02, (firing ? GLITCH.on : GLITCH.off) + rand(-GLITCH.jitter, GLITCH.jitter));

function factoryInit(api) {
  /* Uusi taksi saa aina kaaren verran rauhaa: kierros alkaa siitä mihin iso
     kaari juuri sammui, joten kolarin jälkeen ei lennetä suoraan kipinään. */
  fac.t = Math.min(MACH.arc, MACH.cycle * 0.9) + 0.8;
  fac.taxi = api.taxi;
  fac.g = 0; fac.near = null;
  fac.phase = 0; fac.firing = true; fac.flipNow = false;
  fac.sparks.length = 0;
  fac.bolts = GAPS.map(() => null);
  fac.boltT = 0;
}

function factoryUpdate(dt, api) {
  if (api.taxi !== fac.taxi) { fac.taxi = api.taxi; fac.t = Math.min(MACH.arc, MACH.cycle * 0.9) + 0.8; }
  fac.t += dt;

  const f = fieldAt(api.taxi.x, api.taxi.y, fac.t);
  fac.g = f.g; fac.near = f.near;

  /* Pätkinnän vaihetta kuljetetaan vain täällä. input-koukku kutsutaan kahdesti
     ruudussa — piirtoa ja fysiikkaa varten — joten vaiheen eteneminen siellä
     pätkisi tuplasti ja kuva erkanisi tuntumasta. */
  if (fac.g <= 0) { fac.phase = 0; fac.firing = true; fac.flipNow = false; }
  else {
    fac.phase -= dt;
    while (fac.phase <= 0) {
      fac.firing = !fac.firing;
      /* Vastavoima arvotaan vain katkon alkaessa, joten yksi katko on joko
         hiljaisuutta tai väärään suuntaan — ei kumpaakin peräkkäin. */
      fac.flipNow = !fac.firing && api.rand(0, 1) < GLITCH.flip;
      fac.phase += glitchLen(fac.firing, api.rand);
    }
  }

  /* Kaaret piirretään uudelleen muutaman kerran sekunnissa. Sama kuva pysyy
     ruutujen yli, muuten salama olisi valkoista puuroa. */
  fac.boltT -= dt;
  if (fac.boltT <= 0) {
    fac.boltT = 0.05;
    GAPS.forEach((gap, i) => {
      const ph = phaseOf(gap, fac.t);
      fac.bolts[i] = ph.on > 0 ? makeBolt(gap, api.rand) : null;
    });
  }

  stepSparks(dt, api);
}

/* Kipinät ovat kentän omat hiukkaset: pelin bits-taulukko on pelin, eikä
   kenttä kirjoita toisen tilaan. Ne syntyvät taksin rungosta kun häiriö
   puree, joten pelaaja näkee kentässä olon myös silloin kun suutin on
   sattumalta hiljaa. */
function stepSparks(dt, api) {
  if (fac.g > 0.12 && api.rand(0, 1) < fac.g * dt * 40) {
    const a = api.rand(0, 6.283);
    fac.sparks.push({
      x: api.taxi.x + Math.cos(a) * 18, y: api.taxi.y + Math.sin(a) * 12,
      vx: Math.cos(a) * api.rand(40, 140), vy: Math.sin(a) * api.rand(40, 140) - 20,
      life: api.rand(0.15, 0.4), max: 0.4,
    });
  }
  for (let i = fac.sparks.length - 1; i >= 0; i--) {
    const s = fac.sparks[i];
    s.life -= dt;
    if (s.life <= 0) { fac.sparks.splice(i, 1); continue; }
    s.x += s.vx * dt; s.y += s.vy * dt;
    s.vy += 420 * dt;
  }
}

/* Ohjaus kentän läpi. Katko ei ole veitsellä leikattu vaan häiriön
   voimakkuuden mittainen: kentän reunalla suutin nykii, kaaren kohdalla se
   sammuu kokonaan tai laukeaa vastakkaiseen suuntaan. Siksi reuna on
   varoitus eikä ansa — pelaaja tuntee kentän ennen kuin se vie auton. */
function factoryInput(v, api) {
  if (fac.g <= 0 || fac.firing) return v;
  const k = fac.flipNow ? -fac.g : 1 - fac.g;
  return { x: v.x * k, y: v.y * k };
}

/* ------------------------------------------------------------------ salama */
function makeBolt(gap, rand) {
  const pts = [[gap.ax, gap.ay]];
  const dx = gap.bx - gap.ax, dy = gap.by - gap.ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const steps = Math.max(4, Math.round(len / 34));
  for (let i = 1; i < steps; i++) {
    const u = i / steps;
    const swing = Math.sin(u * Math.PI) * Math.min(26, len * 0.12);
    const j = rand(-swing, swing);
    pts.push([gap.ax + dx * u + nx * j, gap.ay + dy * u + ny * j]);
  }
  pts.push([gap.bx, gap.by]);
  return pts;
}

function strokeBolt(ctx, pts, width, color, glow) {
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = glow; ctx.shadowBlur = 16;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------- tehdashalli

   Kaikki tämä on drawBackissa eli taustan päällä mutta seinien, alustojen ja
   taksin alla: mikään ei peitä sitä mitä pelaajan pitää nähdä. Koristeilla on
   oma kello (performance.now()), koska pelin runT pysähtyy luukusta tullessa —
   pysähtynyt hihnakuljetin näyttäisi rikkinäiseltä. */
const own = () => performance.now() / 1000;
const PANEL = '#161a2b', PANEL_DARK = '#10131f', RIB = 'rgba(140,170,255,.05)';
const HOT = '#d9b3ff', LIVE = '#b78bff';

/** Rajaa piirtämisen kaikkialle paitsi annettuun suorakulmioon. */
function cutout(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(x, y, w, h);
  ctx.clip('evenodd');
}

function factoryBack(ctx, api) {
  const t = own();
  ctx.save();
  cutout(ctx, HATCH.x, 0, HATCH.w, CEIL);      // luukusta pitää näkyä taivas

  hallWall(ctx);
  for (const [x, y, r] of GEARS) gear(ctx, x, y, r, t * (r > 60 ? 0.35 : -0.6));
  pipes(ctx);
  conveyor(ctx, t);
  for (const p of api.pads) hazard(ctx, p);

  ctx.restore();
}

/** Peltiseinä: paneelit, saumat ja niitit. Halli on umpinainen, joten kentän
    oma taivas jää näkymättömiin — sky on silti olemassa luukun aukkoa varten. */
function hallWall(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PANEL_DARK);
  g.addColorStop(0.45, PANEL);
  g.addColorStop(1, '#0d1018');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = RIB;
  for (let x = 40; x < W; x += 80) ctx.fillRect(x, 0, 26, H);

  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2;
  for (let y = 130; y < H; y += 190) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = 'rgba(160,190,255,.10)';
    for (let x = 28; x < W; x += 56) ctx.fillRect(x, y - 5, 5, 5);
  }
}

/* Hammaspyörät taustalla. Isot pyörivät hitaasti myötäpäivään, pienet
   nopeammin vastapäivään — halli näyttää käyvän vaikka mikään niistä ei ole
   este eikä vaikuta mihinkään. */
const GEARS = [[232, 196, 74], [318, 250, 40], [452, 838, 86], [560, 776, 44], [96, 900, 56]];

function gear(ctx, x, y, r, a) {
  const teeth = Math.max(8, Math.round(r / 6));
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(120,150,220,.07)';
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const t0 = (i / teeth) * Math.PI * 2, t1 = ((i + 0.5) / teeth) * Math.PI * 2;
    ctx.lineTo(Math.cos(t0) * r * 1.14, Math.sin(t0) * r * 1.14);
    ctx.lineTo(Math.cos(t1) * r, Math.sin(t1) * r);
  }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(150,180,255,.10)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.52, 0, 6.283); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, 6.283); ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const a2 = (i / 4) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a2) * r * 0.18, Math.sin(a2) * r * 0.18);
    ctx.lineTo(Math.cos(a2) * r * 0.5, Math.sin(a2) * r * 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

/** Putkisto seiniä pitkin. Pelkkää kulissia, ei estettä. */
function pipes(ctx) {
  const runs = [
    [26, 60, 26, 1000], [46, 60, 46, 440], [694, 96, 694, 1000], [676, 260, 676, 900],
    [26, 1000, 694, 1000], [46, 440, 300, 440],
  ];
  ctx.save();
  ctx.lineCap = 'round';
  for (const [x0, y0, x1, y1] of runs) {
    ctx.strokeStyle = 'rgba(90,120,180,.20)'; ctx.lineWidth = 11;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = 'rgba(180,210,255,.10)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0 - 2, y0); ctx.lineTo(x1 - 2, y1); ctx.stroke();
  }
  /* Venttiilipyörät: kolme pistettä joista näkee että putkissa on suunta. */
  for (const [x, y] of [[26, 330], [694, 520], [26, 760]]) {
    ctx.strokeStyle = 'rgba(200,160,120,.25)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, 6.283); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 13, y); ctx.lineTo(x + 13, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 13); ctx.lineTo(x, y + 13); ctx.stroke();
  }
  ctx.restore();
}

/** Hihnakuljetin lattialla: laatikot kulkevat vasemmalta oikealle. */
function conveyor(ctx, t) {
  const y = 1002, span = W - 40;
  ctx.save();
  ctx.fillStyle = 'rgba(20,26,42,.9)';
  ctx.fillRect(20, y, span, 14);
  ctx.strokeStyle = 'rgba(150,180,255,.12)'; ctx.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const x = 20 + ((i * 30 + t * 34) % span);
    ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y + 12); ctx.stroke();
  }
  for (let i = 0; i < 4; i++) {
    const x = 20 + ((i * 210 + t * 34) % span);
    ctx.fillStyle = 'rgba(120,96,64,.55)';
    ctx.fillRect(x, y - 22, 40, 22);
    ctx.fillStyle = 'rgba(200,170,120,.25)';
    ctx.fillRect(x + 6, y - 14, 28, 3);
  }
  ctx.restore();
}

/** Varoitusraidat alustan alla: keltamusta viiste kertoo että tämä on
    huoltotaso eikä parveke. */
function hazard(ctx, p) {
  ctx.save();
  const y0 = p.y + p.h + 2, y1 = y0 + 9;
  ctx.beginPath(); ctx.rect(p.x, y0, p.w, 9); ctx.clip();
  for (let x = p.x - 18; x < p.x + p.w; x += 18) {
    ctx.fillStyle = 'rgba(230,190,70,.22)';
    ctx.beginPath();
    ctx.moveTo(x, y1); ctx.lineTo(x + 9, y0);
    ctx.lineTo(x + 18, y0); ctx.lineTo(x + 9, y1);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/* ----------------------------------------------------------- koneiden elo

   drawFront on kaiken päällä: koneiden navat ja kaaret piirretään tänne,
   koska seinä peittäisi ne muuten. Kaari saa kulkea myös taksin yli — se on
   sähköä ilmassa, ei kulissi taksin takana. */
function factoryFront(ctx, api) {
  machineBodies(ctx);
  GAPS.forEach((gap, i) => {
    const ph = phaseOf(gap, fac.t);
    terminal(ctx, gap.ax, gap.ay, ph);
    terminal(ctx, gap.bx, gap.by, ph);
    const pts = fac.bolts[i];
    if (!pts || ph.on <= 0) return;
    ctx.save();
    ctx.globalAlpha = 0.35 + ph.on * 0.65;
    strokeBolt(ctx, pts, 6, 'rgba(150,110,255,.35)', LIVE);
    strokeBolt(ctx, pts, 2.2, '#f1e6ff', HOT);
    ctx.restore();
  });

  /* Kentässä oleva taksi saa oman haaran: se kertoo mistä koneesta häiriö
     tulee, eikä pelaajan tarvitse arvata kumpi kaari sen vei. */
  if (fac.g > 0.3 && fac.near && !api.taxi.landed) {
    const gap = fac.near;
    const mx = (gap.ax + gap.bx) / 2, my = (gap.ay + gap.by) / 2;
    const arm = makeBolt({ ax: mx, ay: my, bx: api.taxi.x, by: api.taxi.y }, api.rand);
    ctx.save();
    ctx.globalAlpha = (fac.g - 0.3) * 1.1;
    strokeBolt(ctx, arm, 1.6, '#e6d6ff', HOT);
    ctx.restore();
  }

  for (const s of fac.sparks) {
    ctx.save();
    ctx.globalAlpha = clamp01(s.life / s.max);
    ctx.fillStyle = '#ffe9b8';
    ctx.shadowColor = '#ffd479'; ctx.shadowBlur = 8;
    ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    ctx.restore();
  }

  /* Ruudun oma nykäys kun suutin on juuri katkolla. Violetti raidoitus on
     lyhyt eikä peitä mitään: se on kuittaus siitä että ohjaus on poikki,
     jotta pelaaja ei luule pelin jumittaneen. */
  if (fac.g > 0.45 && !fac.firing) {
    ctx.save();
    ctx.globalAlpha = 0.05 + fac.g * 0.07;
    ctx.fillStyle = fac.flipNow ? '#ff6ad5' : LIVE;
    for (let y = (fac.t * 900) % 6; y < H; y += 6) ctx.fillRect(0, y, W, 2);
    ctx.restore();
  }
}

/** Koneiden rungot seinien päälle: kelatornit, muuntaja ja generaattori. */
function machineBodies(ctx) {
  coilTower(ctx, COIL_L);
  coilTower(ctx, COIL_R);

  ctx.save();
  ctx.fillStyle = '#242a44';
  ctx.fillRect(TRAFO.x, TRAFO.y, TRAFO.w, TRAFO.h);
  ctx.strokeStyle = 'rgba(180,200,255,.18)'; ctx.lineWidth = 2;
  for (let x = TRAFO.x + 8; x < TRAFO.x + TRAFO.w - 4; x += 10) {
    ctx.beginPath(); ctx.moveTo(x, TRAFO.y + 6); ctx.lineTo(x, TRAFO.y + TRAFO.h - 6); ctx.stroke();
  }
  ctx.fillStyle = '#242a44';
  ctx.fillRect(DYNAMO.x, DYNAMO.y, DYNAMO.w, DYNAMO.h);
  ctx.strokeStyle = 'rgba(180,200,255,.18)';
  ctx.beginPath(); ctx.arc(DYNAMO.x + 62, DYNAMO.y + 31, 20, 0, 6.283); ctx.stroke();
  ctx.beginPath(); ctx.arc(DYNAMO.x + 62, DYNAMO.y + 31, 8, 0, 6.283); ctx.stroke();

  /* Riippuvat nokat: kipinäväli tarvitsee toisen navan, ja ilmaan piirretty
     nasta näyttäisi irralliselta. Muuntajan pari roikkuu katosta, generaattorin
     pari alustan 3 alapinnasta — kumpikaan ei ole este, koska este joka näyttää
     johdolta olisi epäreilu. */
  ctx.strokeStyle = 'rgba(150,180,255,.25)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(470, CEIL); ctx.lineTo(470, 226); ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(268, 578); ctx.lineTo(268, 630); ctx.stroke();
  ctx.restore();
}

/** Kelatorni: seinän päälle kierukka ja huipulle napa. */
function coilTower(ctx, box) {
  ctx.save();
  ctx.fillStyle = '#242a44';
  ctx.fillRect(box.x + 6, box.y + 10, box.w - 12, box.h - 10);
  ctx.strokeStyle = 'rgba(190,210,255,.22)'; ctx.lineWidth = 3;
  for (let y = box.y + 22; y < box.y + box.h - 8; y += 12) {
    ctx.beginPath();
    ctx.moveTo(box.x + 8, y);
    ctx.bezierCurveTo(box.x + box.w * 0.35, y - 7, box.x + box.w * 0.65, y + 7, box.x + box.w - 8, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#2e3558';
  ctx.fillRect(box.x + 18, box.y - 6, box.w - 36, 16);
  ctx.restore();
}

/** Napa: himmeä levossa, hehkuu latautuessa, valkoinen kaaren palaessa. */
function terminal(ctx, x, y, ph) {
  const heat = Math.max(ph.on, ph.charge * 0.7);
  ctx.save();
  ctx.fillStyle = '#39406b';
  ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.283); ctx.fill();
  if (heat > 0.01) {
    ctx.fillStyle = ph.on > 0 ? '#f3ebff' : HOT;
    ctx.shadowColor = LIVE; ctx.shadowBlur = 10 + heat * 26;
    ctx.beginPath(); ctx.arc(x, y, 4 + heat * 4, 0, 6.283); ctx.fill();
  }
  ctx.restore();
}

export const troublefactory = {
  /* Tehdashalli. Kolme kipinäväliä vartioi kolmea reittiä, ja ne käyvät
     vuorotellen: kelatornien iso kaari alustan 3 yllä, muuntajan kaari
     alustan 2 laskeutumislinjalla ja generaattorin kaari alustan 4 edessä.
     Kaaren ympärillä ohjaus pätkii, ja joka katko voi olla vastavoima —
     suutin laukeaakin vastakkaiseen suuntaan. Reunalla se nykäisee, kaaren
     kohdalla vie auton.

     Rytmi on opittava eikä satunnainen: kone latautuu näkyvästi ennen kaarta
     (MACH.warn), ja kolarin jälkeen kierros alkaa aina siitä mihin iso kaari
     juuri sammui. Satunnaista on vain suunta johon suutin laukeaa.

     Alustat 1 ja 5 ja tankkaus ovat kaarien ulkopuolella: kentässä pitää olla
     paikka jossa ehtii katsoa rytmiä. Alanurkkiin ei sijoiteta mitään, koska
     tööttiä ja laskutelinettä ohjaavat napit peittävät ne (x 30…158 tai
     562…690, y 778…964). */
  name: 'Trouble Factory',
  glow: '#b78bff',
  sky: ['#0a0a12', '#161228', '#241a33', '#2d2038'],
  gate: HATCH,
  start: 1,
  firstFrom: 5,
  walls: [COIL_L, COIL_R, TRAFO, DYNAMO],
  pads: [
    { id: 1, x: 16, y: 320, w: 170, h: 18 },
    { id: 2, x: 534, y: 320, w: 170, h: 18 },
    { id: 3, x: 275, y: 560, w: 170, h: 18 },
    { id: 4, x: 16, y: 730, w: 170, h: 18 },
    { id: 5, x: 534, y: 730, w: 170, h: 18 },
    { id: 0, x: 275, y: 940, w: 170, h: 18, fuel: true },
  ],
  init: factoryInit,
  update: factoryUpdate,
  input: factoryInput,
  drawBack: factoryBack,
  drawFront: factoryFront,

  /* Kentän oma säätötaulu. Peli piirtää sen kenttänappien alle eikä tiedä
     sisällöstä mitään. Häiriön nupit ovat tarkoituksella samat kuin tyhjän
     tankin pätkinnässä, ja niiden perässä on tämän kentän oma: kuinka usein
     katko onkin vastavoima. */
  tune: [
    {
      name: 'häiriö', obj: GLITCH, graph: glitchGraph,
      sliders: [
        { key: 'on', label: 'pätkintä: syöttö s', min: 0.02, max: 1, step: 0.01 },
        { key: 'off', label: 'pätkintä: katko s', min: 0.02, max: 2, step: 0.01 },
        { key: 'jitter', label: 'pätkintä: satunnaisuus ±s', min: 0, max: 0.5, step: 0.01 },
        { key: 'flip', label: 'vastavoiman todennäköisyys', min: 0, max: 1, step: 0.05 },
      ],
    },
    {
      name: 'koneet', obj: MACH, open: false,
      sliders: [
        { key: 'cycle', label: 'koneen kierros s', min: 2, max: 20, step: 0.5 },
        { key: 'arc', label: 'kaaren kesto s', min: 0.2, max: 8, step: 0.1 },
        { key: 'warn', label: 'latautuminen s', min: 0, max: 3, step: 0.1 },
        { key: 'reach', label: 'häiriön ulottuvuus px', min: 20, max: 300, step: 5 },
      ],
    },
    { name: 'kentän kertoimet', open: false, mul: ['grav', 'thrust', 'burn', 'landVX'] },
  ],
};

/* Häiriökäyrä säätölaatikon alimmaksi.
 *
 * Yksi kierros vasemmalta oikealle: kolme konetta omina kaistoinaan, jotta
 * näkee vuorottelevatko ne vai osuvatko päällekkäin. Pystyviiva on nyt-hetki,
 * ja se juoksee samaa tahtia kuin kenttä, joten säätimen vaikutuksen näkee
 * heti eikä vasta seuraavassa kaaressa. */
function glitchGraph(ctx, w, h) {
  const cycle = Math.max(0.5, MACH.cycle);
  const lane = h / GAPS.length;
  ctx.save();
  ctx.fillStyle = 'rgba(10,12,22,.6)';
  ctx.fillRect(0, 0, w, h);
  GAPS.forEach((gap, i) => {
    const y0 = i * lane + 2, hh = lane - 4;
    for (let px = 0; px < w; px++) {
      const ph = phaseOf(gap, (px / w) * cycle);
      if (ph.on <= 0 && ph.charge <= 0) continue;
      ctx.fillStyle = ph.on > 0 ? LIVE : 'rgba(183,139,255,.25)';
      const v = ph.on > 0 ? ph.on : ph.charge * 0.5;
      ctx.fillRect(px, y0 + hh * (1 - v), 1, hh * v);
    }
    ctx.strokeStyle = 'rgba(150,180,255,.15)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y0 + hh); ctx.lineTo(w, y0 + hh); ctx.stroke();
  });
  const nowX = ((fac.t / cycle) % 1) * w;
  ctx.strokeStyle = '#f3ebff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(nowX, 0); ctx.lineTo(nowX, h); ctx.stroke();
  ctx.restore();
}
