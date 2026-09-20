/* Space Taxin kenttäeditori — luonnoslehtiö, ei tallentava editori.
 *
 * Sommittelu on silmämääräistä työtä, ja siihen asti se on tehty niin että
 * Sami sanoo luvun, avustaja kirjoittaa sen kenttätiedostoon ja julkaisee
 * draftin. Tämä lyhentää silmukan: näe missä törmäys oikeasti on, raahaa
 * tavarat paikoilleen ja maalaa päälle mitä kohtaan oli tarkoitus tulla.
 *
 * **Editori ei kirjoita peliin geometriaa.** Kenttä on JS-moduuli eikä dataa:
 * seinät ja oviaukot ovat laskettuja (SOLIDS rakennetaan segments()illä
 * oviaukkojen ympärille), joten niitä ei saa siististi ulos siitä mitä
 * ruudulla raahattiin. Ja jos pelkät alustat eläisivät erillisessä konffissa,
 * kentän geometria olisi kahdessa paikassa kahdella eri säännöllä — ja
 * tools/check-grid.mjs, joka lukee kenttämoduulin, tarkistaisi eri kenttää
 * kuin mitä pelataan. Siksi työnjako on:
 *
 *     maalaus ja siirrot  ->  config/sketch.json, luonnos avustajalle
 *     kentän luvut        ->  js/levels/<kenttä>.js, ainoa totuus
 *
 * Raahatut paikat jäävät voimaan **vain tässä selaimessa** (localStorage),
 * jotta sivun lataus ei pyyhi kesken jäänyttä sommittelua. Ne eivät lähde
 * julkaisun mukaan eivätkä näy kenellekään muulle. Editori sanoo ääneen
 * montako siirtoa on vielä kirjoittamatta koodiin, koska hiljainen paikallinen
 * poikkeama koodista on juuri se ansa jota tässä väistetään.
 *
 * Mitä kentässä saa siirtää, kertoo kenttä itse (level.edit) — peli ei tiedä
 * yhdenkään kentän sisällöstä mitään. Sopimus on kapea tarkoituksella:
 *
 *     { id, kind: 'pad' | 'prop', obj, label }
 *
 * obj on olio jolla on x ja y ja jonka piirto lukee ne joka ruudulla.
 *
 * Editori pitää pelin tauolla niin kauan kuin se on auki. Ilman sitä taksi
 * ajelehtisi seinään kesken sommittelun — se oli se syy jonka takia tauko
 * ylipäätään tehtiin.
 *
 * Tämä on kehittäjän työkalu ja pysyy suomeksi, kuten säätöpaneelikin.
 */
import { W, H } from './levels/shared.js';

const SKETCH_FILE = 'config/sketch.json';
const SKETCH_STORE = 'spacetaxi.sketch';
const SNAP = 4;                                // ruudukko, shift vapauttaa
const GRAB = 15;                               // kuinka läheltä kahvaan tarttuu

/* Törmäyskuvan värit. Ohut viiva, oma väri lajille. Tämä on se mitä peli
   oikeasti pitää esteenä — ei se mikä ruudulla näyttää esteeltä, ja juuri se
   ero oli syy näyttää tämä lainkaan. Seinä on haalea, koska niitä on eniten
   eikä niitä lueta yksitellen. */
const C = {
  wall: '#5b7aa8',
  door: '#ffd479',
  pad: '#7bf0a0',
  fuel: '#c58cff',
  btn: '#8a97be',
  bad: '#ff3355',
  handle: '#9ad8ff',
  pick: '#ffd479',
};

/* Maalauskalun labelit. Väri kertoo lajin kaukaa ja label kirjoitetaan muodon
   viereen: pelkkä väri on arvailua, ja arvailu oli koko syy tähän työkaluun.
   Vapaa teksti on jokaisella muodolla lisäksi, ja se on se paikka johon
   perustelu kuuluu. */
const LABELS = [
  { key: 'seinä', col: '#ff5d7a' },
  { key: 'aukko', col: '#6fe3ff' },
  { key: 'alusta', col: '#7bf0a0' },
  { key: 'propsi', col: '#ffd479' },
  { key: 'pois', col: '#ff8a3d' },
  { key: 'reitti', col: '#c58cff' },
  { key: 'huomio', col: '#e9edff' },
];
const colOf = key => (LABELS.find(l => l.key === key) || LABELS[LABELS.length - 1]).col;

const TOOLS = [
  { key: 'move', name: 'siirrä' },
  { key: 'rect', name: 'laatikko' },
  { key: 'arrow', name: 'nuoli' },
  { key: 'free', name: 'veto' },
];

/* Taksin kokoinen laatikko telineineen ja sama askel kuin
   tools/check-grid.mjs:ssä, jotta editorin varoitus ja tarkistin ovat samaa
   mieltä eikä kumpikaan päästä läpi sitä mistä toinen huomauttaa. */
const TWB = 58, THB = 46, STEP = 4;

const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const padBox = p => ({ x: p.x, y: p.y, w: p.w, h: p.h });
const grow = (b, d) => ({ x: b.x - d, y: b.y - d, w: b.w + d * 2, h: b.h + d * 2 });
const round = v => Math.round(v);

/* --------------------------------------------------------------------- tyyli

   Editori kantaa oman tyylinsä eikä kirjoita css/style.css:ään. Syy on
   käytännöllinen: samaan peliin kirjoittaa useampi sessio, ja jaettuun
   tyylitiedostoon lisätty lohko on juuri sellainen muutos joka katoaa toisen
   session kirjoituksen alle. Koko editori on tässä yhdessä tiedostossa.

   Laatikko on vasemmassa ylänurkassa, koska säätöpaneeli on oikeassa: ne ovat
   eri työkalut ja saavat olla auki yhtä aikaa. */
const CSS = `
#editor {
  pointer-events: auto;
  position: fixed; top: 10px; left: 10px;
  width: min(304px, calc(100vw - 20px));
  max-height: calc(100vh - 20px);
  overflow-y: auto;
  touch-action: pan-y;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 14px 16px 16px;
  border-radius: 14px;
  background: rgba(8, 13, 30, .94);
  border: 1px solid rgba(120, 160, 255, .28);
  box-shadow: 0 18px 44px rgba(0, 0, 0, .55);
  font-size: 12px;
}
#editor h2 {
  margin: 0 0 10px; font-size: 12px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase; color: #8a97be;
}
#editor h2 em { font-style: normal; color: #ffd479; }
#editor .row { margin-bottom: 11px; }
#editor .row > label {
  display: flex; justify-content: space-between; gap: 8px;
  color: #a9b6dd; margin-bottom: 4px;
}
#editor .row > label b { color: #ffd479; font-variant-numeric: tabular-nums; }
#editor .seg { display: flex; flex-wrap: wrap; gap: 6px; }
#editor .seg button {
  flex: 1 1 auto; min-width: max-content; max-width: 160px; white-space: nowrap;
  font: inherit; font-size: 12px; padding: 7px 9px;
  color: #a9b6dd; background: rgba(255,255,255,.06);
  border: 1px solid rgba(120,160,255,.26); border-radius: 9px; cursor: pointer;
}
#editor .seg button.on { color: #08101f; background: #6fe3ff; border-color: #6fe3ff; font-weight: 600; }
#editor .seg button .dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 2px;
  margin-right: 5px; vertical-align: -1px;
}
#editor .seg button:disabled { opacity: .4; cursor: default; }
#editor input[type=text] {
  width: 100%; font: inherit; font-size: 12px;
  padding: 7px 9px; border-radius: 9px;
  color: #e9edff; background: rgba(255,255,255,.06);
  border: 1px solid rgba(120,160,255,.28);
  touch-action: auto; -webkit-user-select: text; user-select: text;
}
#editor input[type=text]:focus { outline: none; border-color: rgba(111,227,255,.6); }
#editor .list {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: 4px; max-height: 196px; overflow: auto;
}
#editor .list li {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 8px; border-radius: 8px; cursor: pointer;
  background: rgba(255,255,255,.045); border: 1px solid transparent;
  color: #a9b6dd;
}
#editor .list li.on { border-color: rgba(111,227,255,.55); color: #e9edff; }
#editor .list li.empty { cursor: default; color: #6c789e; }
#editor .list li .dot { width: 9px; height: 9px; border-radius: 2px; flex: 0 0 auto; }
#editor .list li .n { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#editor .list li .v { color: #7f8cb5; font-variant-numeric: tabular-nums; font-size: 11px; }
#editor .foot { display: flex; gap: 6px; margin-top: 12px; }
#editor .foot button { flex: 1; margin: 0; }
#editor .note { min-height: 14px; margin: 8px 0 0; font-size: 11px; line-height: 1.5; color: #6fe3ff; }
#editor .warn { margin: 8px 0 0; padding: 0; list-style: none; font-size: 11px; line-height: 1.55; color: #ff8fa3; }
#editor .hint { margin: 6px 0 0; font-size: 11px; line-height: 1.5; color: #7f8cb5; }
canvas.editing { cursor: crosshair; }
`;

function injectStyle() {
  if (document.getElementById('editor-css')) return;
  const st = document.createElement('style');
  st.id = 'editor-css';
  st.textContent = CSS;
  document.head.append(st);
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
function button(cls, text, fn) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}

/** host on pelin puoli: kangas, kentän elävät taulukot ja ne kolme asiaa joita
    editori ei voi tehdä itse — koodin oletuspaikat, paikkojen muistaminen
    selaimessa ja tiedoston kirjoittaminen portaalin kautta. */
export function createEditor(host) {
  injectStyle();

  const canvas = host.canvas;
  const box = el('div');
  box.id = 'editor';
  document.getElementById('hud').append(box);
  canvas.classList.add('editing');

  const wasPaused = host.paused();
  host.setPaused(true);

  /* Muiden kenttien luonnokset kulkevat läpi koskematta: editori on auki
     yhteen kenttään kerrallaan, eikä tallennus saa pyyhkiä sitä mitä toisesta
     kentästä on aiemmin sanottu. */
  const store = { paint: {}, moves: {} };

  let tool = 'move';
  let label = 'seinä';
  let shapes = [];                 // tämän kentän maalaukset
  let sel = null;                  // valittu muoto tai siirrettävä olio
  let drag = null;                 // käynnissä oleva veto
  let warns = [];                  // { text, box }
  let note = '';
  let undoSnap = null;             // yksi askel taaksepäin
  let savedBody = '';              // mitä peliin on viimeksi viety
  let sketchStamp = 0;

  const items = () => host.level().edit || [];
  const levelName = () => host.level().name;
  const isShape = s => shapes.includes(s);

  /* ------------------------------------------------------------- siirrot

     Siirto on ero koodin oletukseen: olio joka on omalla paikallaan ei tarvitse
     riviä. Takaisin oletukselle raahattu katoaa listasta itsestään, eikä
     luonnokseen jää siirtoja joita ei ole. */
  function moves() {
    const out = [];
    for (const it of items()) {
      const d = host.def(it.id);
      if (!d || !it.obj) continue;
      if (it.obj.x === d.x && it.obj.y === d.y) continue;
      out.push({
        id: it.id, label: it.label || it.id,
        from: { x: d.x, y: d.y },
        to: { x: round(it.obj.x), y: round(it.obj.y) },
      });
    }
    return out;
  }

  /* ------------------------------------------------------------- luonnos

     Yksi tiedosto kattaa sekä maalauksen että siirrot: ne ovat sama viesti
     samasta hetkestä, ja erilleen tallennettuina ne ehtisivät eri mieltä.
     Muoto on sellainen että sen voi lukea suoraan luvuiksi kenttätiedostoon —
     kaikki koordinaatit ovat kentän omia (720 × 1040). */
  function sketchAll(stamp) {
    const levels = {};
    const names = new Set([...Object.keys(store.paint), ...Object.keys(store.moves), levelName()]);
    for (const name of names) {
      const here = name === levelName();
      const paint = here ? shapes : (store.paint[name] || []);
      const mv = here ? moves() : (store.moves[name] || []);
      if (paint.length || mv.length) levels[name] = { paint, moves: mv };
    }
    return { v: 1, stamp: stamp || Date.now(), levels };
  }
  const sketchBody = () => JSON.stringify(sketchAll(1));
  const dirty = () => sketchBody() !== savedBody;

  function readSketch(raw) {
    if (!raw || !raw.levels) return;
    store.paint = {};
    store.moves = {};
    for (const [name, e] of Object.entries(raw.levels)) {
      store.paint[name] = Array.isArray(e.paint) ? e.paint : [];
      store.moves[name] = Array.isArray(e.moves) ? e.moves : [];
    }
    shapes = (store.paint[levelName()] || []).slice();
  }

  function loadLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(SKETCH_STORE) || 'null');
      if (raw) { readSketch(raw); sketchStamp = +raw.stamp || 0; }
    } catch (e) {}
  }
  function saveLocal() {
    store.paint[levelName()] = shapes;
    sketchStamp = Date.now();
    try { localStorage.setItem(SKETCH_STORE, JSON.stringify(sketchAll(sketchStamp))); } catch (e) {}
  }

  /* Peliin tallennettu luonnos. Sama sääntö kuin virityksellä: uudempi voittaa,
     jotta juuri tallennettu ei jää vanhan localStoragen alle eikä toisin päin. */
  function loadFromGame() {
    fetch(SKETCH_FILE, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!j || !j.levels) return;
        const mine = sketchBody();
        readSketch(j);
        savedBody = sketchBody();
        if ((+j.stamp || 0) < sketchStamp) readSketch(JSON.parse(mine));
        else sketchStamp = +j.stamp || 0;
        sel = null;
        build();
      })
      .catch(() => {});
  }

  /* ------------------------------------------------------------- kumoaminen

     Yksi askel, ja se kattaa sekä maalaukset että paikat — muuten kumoaminen
     riippuisi siitä kummalla kalulla viimeksi sattui vetämään. Kuva otetaan
     vedon alussa eikä jokaisesta liikkeestä, joten kumoa peruu koko raahauksen
     eikä yhtä pikseliä siitä. */
  function snapshot() {
    undoSnap = JSON.stringify({ shapes, pos: moves() });
  }
  function undo() {
    if (!undoSnap) return;
    const back = JSON.parse(undoSnap);
    undoSnap = null;
    shapes = back.shapes;
    sel = null;
    for (const it of items()) {
      const d = host.def(it.id);
      if (!d || !it.obj) continue;
      const m = back.pos.find(p => p.id === it.id);
      it.obj.x = m ? m.to.x : d.x;
      it.obj.y = m ? m.to.y : d.y;
    }
    host.moved();
    host.persist();
    saveLocal();
    recheck();
    note = 'viimeisin muutos kumottu';
    build();
  }

  /* ---------------------------------------------------------- varoitukset

     Samat tarkistukset jotka tools/check-grid.mjs tekee jälkikäteen, mutta
     heti. Varoitus on teksti ja punainen kehys eikä esto: Sami päättää itse
     mikä on virhe, ja tarkistin sanoo saman uudestaan ennen julkaisua.

     Ajetaan vedon päätteeksi eikä joka ruudulla — vuototäyttö on satojatuhansia
     törmäystestejä eikä kuulu piirtosilmukkaan. */
  function recheck() {
    warns = [];
    const add = (text, b) => { if (!warns.some(x => x.text === text)) warns.push({ text, box: b }); };
    const pads = host.pads();
    const walls = host.walls();
    const btns = host.buttons();
    const who = p => (p.fuel ? 'tankkaus' : 'alusta ' + p.id);

    for (const p of pads) {
      const b = padBox(p);
      const num = { x: p.x + p.w / 2 - 13, y: p.y + p.h + 9, w: 26, h: 26 };
      for (const w of walls) if (!w.door && hit(b, w)) { add(`${who(p)} on seinässä`, b); break; }
      for (const t of btns) if (hit(b, t)) { add(`${who(p)} on nappien alla`, b); break; }
      for (const t of btns) if (hit(num, t)) { add(`${who(p)}: tunnus jää napin taakse`, num); break; }
      if (p.x < 0 || p.y < 0 || p.x + p.w > W || p.y + p.h > H) add(`${who(p)} on kentän ulkopuolella`, b);
    }

    /* Oviaukon eteen jäävä este. Ainoa mitä editori tietää ovesta: luukku on
       seinässä oleva aukko, ja door.axis ja door.at kertovat missä se on. Jos
       kenttä ei kerro niitä, tarkistus jätetään väliin — varoitus on palvelus
       eikä vaatimus kentän muodolle. */
    for (const w of walls) {
      const g = gapOf(w);
      if (!g) continue;
      const near = grow(g, 24);
      for (const p of pads) {
        if (!hit(near, padBox(p))) continue;
        add(`${who(p)} tukkii oven ${w.door.id || ''}`.trim(), padBox(p));
      }
    }

    const seen = reach();
    if (!seen) { add('luukun alla ei ole tilaa tulla sisään', null); return; }
    for (const p of pads) {
      const x = Math.round((p.x + p.w / 2) / STEP) * STEP;
      const y = Math.round((p.y - THB / 2 - 6) / STEP) * STEP;
      let ok = false;
      for (let dx = -24; dx <= 24 && !ok; dx += STEP)
        for (let dy = 0; dy <= 24 && !ok; dy += STEP)
          if (seen.has((x + dx) + ',' + (y - dy))) ok = true;
      if (!ok) add(`${who(p)}: ei pääse laskeutumaan`, padBox(p));
    }
  }

  /* Vuototäyttö maksaa noin 15 ms, joten pohjassa oleva nuolinäppäin ei saa
     ajaa sitä joka toistolla. Veto päättyy kerran ja tarkistaa heti; näppäin
     odottaa hetken hiljaisuutta. */
  let checkT = 0;
  function queueCheck() {
    clearTimeout(checkT);
    checkT = setTimeout(() => { recheck(); build(); }, 180);
  }

  function gapOf(w) {
    const d = w.door;
    if (!d || !isFinite(d.at)) return null;
    if (d.axis === 'V') return { x: w.x, y: d.at, w: w.w, h: w.h };
    if (d.axis === 'H') return { x: d.at, y: w.y, w: w.w, h: w.h };
    return null;
  }

  /** Mihin taksin kokoinen laatikko pääsee luukun alta, ovet auki. Sama
      vuototäyttö kuin tarkistimessa ja samoilla luvuilla. */
  function reach() {
    const solids = host.walls().filter(w => !w.door).concat(host.pads().map(padBox));
    const free = (x, y) => {
      const b = { x: x - TWB / 2, y: y - THB / 2, w: TWB, h: THB };
      if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) return false;
      for (const s of solids) if (hit(b, s)) return false;
      return true;
    };
    const g = host.gate();
    const sx = Math.round((g.x + g.w / 2) / STEP) * STEP, sy = 60;
    if (!free(sx, sy)) return null;
    const seen = new Set([sx + ',' + sy]);
    const st = [[sx, sy]];
    while (st.length) {
      const [x, y] = st.pop();
      for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (seen.has(k) || !free(nx, ny)) continue;
        seen.add(k);
        st.push([nx, ny]);
      }
    }
    return seen;
  }

  /* ------------------------------------------------------------------ piirto

     Kutsutaan pelin omasta draw():stä kaiken päälle, myös tauolla. Kangas on jo
     kentän koordinaateissa, joten tässä ei muunneta mitään. */
  function draw(ctx) {
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    for (const w of host.walls()) {
      ctx.strokeStyle = w.door ? C.door : C.wall;
      ctx.strokeRect(w.x + 0.7, w.y + 0.7, w.w - 1.4, w.h - 1.4);
    }
    for (const p of host.pads()) {
      ctx.strokeStyle = p.fuel ? C.fuel : C.pad;
      ctx.strokeRect(p.x + 0.7, p.y + 0.7, p.w - 1.4, p.h - 1.4);
      ctx.setLineDash([3, 3]);                 // tunnuspallo alustan alla
      ctx.beginPath();
      ctx.arc(p.x + p.w / 2, p.y + p.h + 22, 13, 0, 6.3);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = C.btn;
    ctx.setLineDash([6, 5]);
    for (const b of host.buttons()) ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);

    for (const s of shapes) paint(ctx, s, s === sel);
    if (drag && drag.shape) paint(ctx, drag.shape, true);

    /* Varoituskehykset päällimmäisenä: ne ovat se mitä pitää huomata. */
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = C.bad;
    for (const w of warns) if (w.box) ctx.strokeRect(w.box.x - 3, w.box.y - 3, w.box.w + 6, w.box.h + 6);
    ctx.lineWidth = 1.4;

    for (const it of items()) handle(ctx, it);
    ctx.restore();
  }

  function paint(ctx, s, on) {
    const col = colOf(s.label);
    ctx.save();
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = on ? 3.5 : 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    let tx = s.x, ty = s.y;
    if (s.kind === 'rect') {
      ctx.globalAlpha = 0.14;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.globalAlpha = 1;
      ctx.strokeRect(s.x, s.y, s.w, s.h);
    } else if (s.kind === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      const a = Math.atan2(s.y2 - s.y, s.x2 - s.x);
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - Math.cos(a - 0.4) * 14, s.y2 - Math.sin(a - 0.4) * 14);
      ctx.lineTo(s.x2 - Math.cos(a + 0.4) * 14, s.y2 - Math.sin(a + 0.4) * 14);
      ctx.closePath();
      ctx.fill();
      tx = s.x2; ty = s.y2;
    } else {
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      tx = s.pts[0][0]; ty = s.pts[0][1];
    }
    tag(ctx, tx, ty - 7, s.text ? s.label + ': ' + s.text : s.label, col, on);
    ctx.restore();
  }

  /* Teksti omalla tummalla pohjallaan: kuu on harmaa ja avaruus musta, eikä
     kumpikaan kanna pelkkää väritekstiä luettavasti. */
  function tag(ctx, x, y, text, col, on) {
    ctx.save();
    ctx.font = (on ? '700 ' : '') + '11px system-ui, sans-serif';
    const wdt = ctx.measureText(text).width;
    const px = Math.min(Math.max(x, 4), W - wdt - 10);
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = '#080d1e';
    ctx.fillRect(px - 3, y - 11, wdt + 6, 14);
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.fillText(text, px, y);
    ctx.restore();
  }

  function handle(ctx, it) {
    if (!it.obj) return;
    const on = sel === it;
    const x = it.obj.x, y = it.obj.y;
    const r = on ? 7 : 5;
    ctx.save();
    ctx.fillStyle = '#080d1e';
    ctx.strokeStyle = on ? C.pick : C.handle;
    ctx.lineWidth = on ? 2.4 : 1.6;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    if (on) {
      ctx.globalAlpha = 0.45;                  // ristikko luvun lukemista varten
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y); ctx.lineTo(W, y);
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      tag(ctx, x + 11, y - 9, `${it.label || it.id}  ${round(x)}, ${round(y)}`, C.pick, true);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ syöte

     Kangas on pelin, joten peli väistää: sen oma pointerdown ja ohjaussauva
     jättävät kosketuksen rauhaan niin kauan kuin editori on auki. */
  function at(e) {
    const p = host.toLogical(e.clientX, e.clientY);
    return { x: p.x, y: p.y, free: e.shiftKey };
  }
  const grid = (v, free) => (free ? round(v) : Math.round(v / SNAP) * SNAP);

  function pick(p) {
    let best = null, bd = GRAB * GRAB;
    for (const it of items()) {
      if (!it.obj) continue;
      const d = (it.obj.x - p.x) ** 2 + (it.obj.y - p.y) ** 2;
      if (d <= bd) { bd = d; best = it; }
    }
    if (best) return best;
    /* Alustaan saa tarttua myös rungosta: kahva on nurkassa, mutta nurkka ei
       ole se kohta jota katsoo kun alustaa siirtää. */
    for (const it of items()) {
      if (it.kind !== 'pad' || !it.obj) continue;
      const live = host.pads().find(q => q.id === it.obj.id) || it.obj;
      if (hit({ x: p.x, y: p.y, w: 1, h: 1 }, padBox(live))) return it;
    }
    return null;
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const p = at(e);
    if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return;
    e.preventDefault();
    if (tool === 'move') {
      const it = pick(p);
      sel = it;
      if (it) { snapshot(); drag = { it, ox: it.obj.x - p.x, oy: it.obj.y - p.y }; }
      build();
      return;
    }
    /* Maalauksen kuva otetaan vasta vedon päätteeksi: napsautus ilman vetoa ei
       ole muoto, eikä se saa hävittää edellistä kumottavaa. */
    const s = tool === 'rect'
      ? { kind: 'rect', label, text: '', x: round(p.x), y: round(p.y), w: 0, h: 0 }
      : tool === 'arrow'
        ? { kind: 'arrow', label, text: '', x: round(p.x), y: round(p.y), x2: round(p.x), y2: round(p.y) }
        : { kind: 'free', label, text: '', pts: [[round(p.x), round(p.y)]] };
    drag = { shape: s, x0: p.x, y0: p.y };
  }

  function onMove(e) {
    if (!drag) return;
    const p = at(e);
    if (drag.it) {
      drag.it.obj.x = grid(p.x + drag.ox, p.free);
      drag.it.obj.y = grid(p.y + drag.oy, p.free);
      host.moved();                            // elävät alustat perässä
      coords();
      return;
    }
    const s = drag.shape;
    if (s.kind === 'rect') {
      s.x = round(Math.min(drag.x0, p.x)); s.y = round(Math.min(drag.y0, p.y));
      s.w = round(Math.abs(p.x - drag.x0)); s.h = round(Math.abs(p.y - drag.y0));
    } else if (s.kind === 'arrow') {
      s.x2 = round(p.x); s.y2 = round(p.y);
    } else {
      const last = s.pts[s.pts.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) > 6 && s.pts.length < 220) {
        s.pts.push([round(p.x), round(p.y)]);
      }
    }
  }

  function onUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.it) {
      host.persist();
      saveLocal();
      recheck();
      build();
      return;
    }
    const s = d.shape;
    const tiny = s.kind === 'rect' ? s.w < 6 && s.h < 6
      : s.kind === 'arrow' ? Math.hypot(s.x2 - s.x, s.y2 - s.y) < 10
        : s.pts.length < 2;
    if (tiny) return;
    snapshot();
    shapes.push(s);
    sel = s;
    saveLocal();
    build();
    const inp = box.querySelector('#etext');
    if (inp) inp.focus();
  }

  function onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.code === 'Escape') { e.preventDefault(); close(); return; }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || !sel || !sel.obj) return;
    /* Nuolet ovat editorissa vapaana, koska editori pitää pelin tauolla.
       stopPropagation estää sen että peli merkitsisi ne suuttimiksi. */
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) snapshot();
    const step = e.shiftKey ? SNAP : 1;
    sel.obj.x += d[0] * step;
    sel.obj.y += d[1] * step;
    host.moved();
    host.persist();
    saveLocal();
    queueCheck();
    coords();
  }

  /* ---------------------------------------------------------------- laatikko */

  let coordEl = null;
  function coords() {
    if (!coordEl) return;
    coordEl.textContent = sel && sel.obj ? `${round(sel.obj.x)}, ${round(sel.obj.y)}` : '—';
  }

  function segRow(name, list, isOn, choose, disabled) {
    const row = el('div', 'row');
    const seg = el('div', 'seg');
    for (const o of list) {
      const b = button(isOn(o) ? 'on' : null, '', () => choose(o));
      if (o.col) {
        const dot = el('span', 'dot');
        dot.style.background = o.col;
        b.append(dot);
      }
      b.append(document.createTextNode(o.name || o.key));
      if (disabled && disabled(o)) b.disabled = true;
      seg.append(b);
    }
    row.append(el('label', null, name), seg);
    box.append(row);
  }

  function moveSection() {
    const row = el('div', 'row');
    const lab = el('label');
    coordEl = el('b');
    lab.append(document.createTextNode('valittu'), coordEl);
    row.append(lab);
    const list = el('ul', 'list');
    for (const it of items()) {
      const li = el('li', sel === it ? 'on' : null);
      const d = host.def(it.id);
      const off = d && it.obj && (it.obj.x !== d.x || it.obj.y !== d.y);
      const dot = el('span', 'dot');
      dot.style.background = it.kind === 'pad' ? (it.obj && it.obj.fuel ? C.fuel : C.pad) : C.door;
      li.append(dot, el('span', 'n', (off ? '• ' : '') + (it.label || it.id)),
        el('span', 'v', it.obj ? `${round(it.obj.x)}, ${round(it.obj.y)}` : ''));
      li.addEventListener('click', () => { sel = it; build(); });
      list.append(li);
    }
    if (!items().length) list.append(el('li', 'empty', 'kenttä ei kerro siirrettäviä (ei edit-taulua)'));
    row.append(list);
    box.append(row);
    coords();
    box.append(el('p', 'hint',
      'raahaa kahvasta tai alustan rungosta · nuolet 1 px, shift 4 px · ' +
      'shift raahatessa vapauttaa ruudukosta'));
  }

  function paintSection() {
    const row = el('div', 'row');
    row.append(el('label', null, 'valitun teksti'));
    const inp = el('input');
    inp.type = 'text';
    inp.id = 'etext';
    inp.placeholder = isShape(sel) ? 'mitä tähän oli tarkoitus' : 'piirrä tai valitse muoto';
    inp.value = (isShape(sel) && sel.text) || '';
    inp.disabled = !isShape(sel);
    inp.addEventListener('input', () => { sel.text = inp.value; saveLocal(); });
    row.append(inp);
    box.append(row);

    const list = el('ul', 'list');
    for (const s of shapes) {
      const li = el('li', sel === s ? 'on' : null);
      const dot = el('span', 'dot');
      dot.style.background = colOf(s.label);
      li.append(dot, el('span', 'n', s.text ? s.label + ': ' + s.text : s.label),
        el('span', 'v', s.kind === 'rect' ? `${s.w}×${s.h}` : s.kind));
      li.addEventListener('click', () => { sel = s; label = s.label; build(); });
      list.append(li);
    }
    if (!shapes.length) list.append(el('li', 'empty', 'ei vielä maalauksia'));
    box.append(list);
    box.append(el('p', 'hint', 'vedä kankaalle · label kertoo mitä tarkoitit, teksti miksi'));
  }

  function build() {
    box.replaceChildren();
    coordEl = null;
    const h = el('h2', null, 'kenttäeditori — ');
    h.append(el('em', null, levelName()));
    box.append(h);

    segRow('kalu', TOOLS, o => o.key === tool, o => {
      tool = o.key;
      if (tool !== 'move' && !isShape(sel)) sel = null;
      if (tool === 'move' && isShape(sel)) sel = null;
      build();
    });
    segRow('label', LABELS, o => o.key === label, o => {
      label = o.key;
      if (isShape(sel)) { snapshot(); sel.label = label; saveLocal(); }
      build();
    }, () => tool === 'move');

    if (tool === 'move') moveSection();
    else paintSection();

    if (warns.length) {
      const ul = el('ul', 'warn');
      for (const w of warns.slice(0, 8)) ul.append(el('li', null, '⚠ ' + w.text));
      if (warns.length > 8) ul.append(el('li', null, `…ja ${warns.length - 8} muuta`));
      box.append(ul);
    }

    const mv = moves();
    if (mv.length) {
      box.append(el('p', 'hint',
        `${mv.length} siirtoa on voimassa vain tässä selaimessa — tallenna luonnos ` +
        'ja pyydä kirjoittamaan ne kenttätiedostoon'));
    }

    const noteEl = el('p', 'note', note);
    note = '';

    /* Palautus pyyhkii työtä, joten se kysyy ensin. Varmistus on napissa eikä
       selaimen confirm-ikkunassa: peli ajetaan iframessa jossa omat ikkunat
       eivät ole varma asia. Varmistus raukeaa itsestään, joten vahingossa
       painettu nappi ei jää odottamaan. */
    let armed = null;
    const disarm = () => {
      clearTimeout(armed); armed = null;
      resetBtn.textContent = 'palauta kaikki';
      resetBtn.classList.add('ghost');
    };
    const resetBtn = button('btn sm ghost', 'palauta kaikki', () => {
      if (!armed) {
        resetBtn.textContent = 'varmista';
        resetBtn.classList.remove('ghost');
        noteEl.textContent = 'palauttaa paikat ja pyyhkii tämän kentän maalaukset';
        armed = setTimeout(disarm, 5000);
        return;
      }
      disarm();
      snapshot();
      for (const it of items()) {
        const d = host.def(it.id);
        if (d && it.obj) { it.obj.x = d.x; it.obj.y = d.y; }
      }
      shapes = [];
      sel = null;
      host.moved();
      host.persist();
      saveLocal();
      recheck();
      note = 'palautettu — kumoa palauttaa entisen';
      build();
    });

    const undoBtn = button('btn sm ghost', 'kumoa', undo);
    undoBtn.disabled = !undoSnap;

    const delBtn = button('btn sm ghost', 'poista muoto', () => {
      const i = shapes.indexOf(sel);
      if (i < 0) return;
      snapshot();
      shapes.splice(i, 1);
      sel = null;
      saveLocal();
      note = 'muoto poistettu';
      build();
    });
    delBtn.disabled = !isShape(sel);

    const saveBtn = button('btn sm', 'tallenna luonnos', () => {
      if (!host.canSave()) {
        noteEl.textContent = 'tallennus onnistuu vain omalta pelisivulta';
        return;
      }
      noteEl.textContent = 'tallennetaan…';
      const body = JSON.stringify(sketchAll(Date.now()), null, 1);
      host.save(SKETCH_FILE, body).then(res => {
        if (res.ok) {
          sketchStamp = JSON.parse(body).stamp;
          try { localStorage.setItem(SKETCH_STORE, body); } catch (e) {}
          savedBody = sketchBody();
          build();
        }
        noteEl.textContent = res.note;
      });
    });
    saveBtn.disabled = !dirty();

    const acts = el('div', 'foot');
    acts.append(resetBtn, undoBtn, delBtn);
    const ends = el('div', 'foot');
    ends.append(saveBtn, button('btn sm', 'sulje', close));
    box.append(acts, ends, noteEl);
  }

  function close() { host.close(); }

  function destroy() {
    clearTimeout(checkT);
    canvas.removeEventListener('pointerdown', onDown);
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onUp);
    removeEventListener('keydown', onKey, true);
    canvas.classList.remove('editing');
    box.remove();
    host.setPaused(wasPaused);
  }

  /** Kenttä vaihtui pelin puolella: muodot, valinta ja varoitukset ovat
      kenttäkohtaisia. */
  function refresh() {
    shapes = (store.paint[levelName()] || []).slice();
    sel = null;
    drag = null;
    recheck();
    build();
  }

  canvas.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  addEventListener('keydown', onKey, true);

  loadLocal();
  /* Lähtöoletus on että peliin ei ole tallennettu mitään: silloin selaimessa
     oleva kesken jäänyt luonnos näkyy tallennettavana heti eikä vasta haun
     jälkeen. Haku korjaa tämän jos tiedosto on olemassa. */
  savedBody = JSON.stringify({ v: 1, stamp: 1, levels: {} });
  recheck();
  build();
  loadFromGame();

  return { draw, destroy, refresh };
}
