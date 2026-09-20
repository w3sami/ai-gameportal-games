/* Space Taxin oma puoli kenttäluonnostelusta.
 *
 * Itse työkalu on portaalin sketchpad-plugin: törmäyskuva, raahaus, maalaus,
 * luonnoksen tallennus ja se että raahatut paikat eivät katoa sivun
 * latauksessa. Täällä on vain se minkä tietää vain tämä peli — mitkä laatikot
 * ovat törmäystä ja mikä sommittelussa on vikana.
 *
 * Plugin ei kirjoita geometriaa peliin eikä tämä tiedosto muuta sitä: kentän
 * luvut ovat kenttätiedostossa, ja luonnoksesta ne kirjoitetaan sinne käsin.
 * Syy on tools/check-grid.mjs — se lukee kenttämoduulin, joten erillinen
 * konffi tarkoittaisi että tarkistin tarkistaa eri kenttää kuin mitä pelataan.
 * Ks. README, "Kenttäeditori".
 *
 * Tarkistukset tässä ovat tahallaan samat kuin tarkistimessa ja samoilla
 * luvuilla. Kaksi työkalua jotka ovat kentästä eri mieltä on huonompi kuin
 * yksikään.
 */
import { createSketchpad } from 'https://plugins.game.bigbools.fi/sketchpad/v1/index.js';
import { W, H } from './levels/shared.js';

/* Taksin kokoinen laatikko telineineen ja sama askel kuin check-grid.mjs:ssä. */
const TWB = 58, THB = 46, STEP = 4;
const GAP = 92;                                // oviaukon vapaa mitta
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const box = p => ({ x: p.x, y: p.y, w: p.w, h: p.h });

/* Maalauksen sanasto suomeksi: luonnos on viesti avustajalle, ja se puhuu sitä
   kieltä jolla tästä pelistä puhutaan. Paneeli itse on kehittäjän työkalu ja
   pysyy suomeksi kuten säätöpaneelikin. */
const LABELS = [
  { key: 'seinä', color: '#ff5d7a' },
  { key: 'aukko', color: '#6fe3ff' },
  { key: 'alusta', color: '#7bf0a0' },
  { key: 'propsi', color: '#ffd479' },
  { key: 'pois', color: '#ff8a3d' },
  { key: 'reitti', color: '#c58cff' },
  { key: 'huomio', color: '#e9edff' },
];

/* Törmäyskuvan värit lajeittain. Seinä on haalea, koska niitä on eniten eikä
   niitä lueta yksitellen; alusta ja tankkaus erottuvat toisistaan, ja luukku
   omanaan, koska liikkuva este on eri asia kuin kiinteä. */
const KINDS = {
  wall: '#5b7aa8',
  door: '#ffd479',
  pad: '#7bf0a0',
  fuel: '#c58cff',
  prop: '#ffd479',
  ring: { color: '#7bf0a0', dash: [3, 3] },
  button: { color: '#8a97be', dash: [6, 5] },
};

/** Oviaukko: ainoa asia jonka tämä tietää ovesta on että luukku on seinässä
    oleva aukko ja että door.axis ja door.at kertovat missä. Jos kenttä ei kerro
    niitä, tarkistus jää väliin — varoitus on palvelus eikä vaatimus kentän
    muodolle. */
function gapOf(w) {
  const d = w.door;
  if (!d || !isFinite(d.at)) return null;
  if (d.axis === 'V') return { x: w.x, y: d.at, w: w.w, h: w.h };
  if (d.axis === 'H') return { x: d.at, y: w.y, w: w.w, h: w.h };
  return null;
}

/** Mihin taksin kokoinen laatikko pääsee luukun alta, ovet auki. Sama
    vuototäyttö kuin tarkistimessa: sillä löytyi kolme virhettä joita ei olisi
    huomannut ilman kenttää läpi lentämällä. */
function reach(walls, pads, gate, seeds) {
  const solids = walls.filter(w => !w.door).concat(pads.map(box));
  const free = (x, y) => {
    const b = { x: x - TWB / 2, y: y - THB / 2, w: TWB, h: THB };
    if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) return false;
    for (const s of solids) if (hit(b, s)) return false;
    return true;
  };
  const snap = v => Math.round(v / STEP) * STEP;
  const sx = snap(gate.x + gate.w / 2), sy = 60;
  if (!free(sx, sy)) return null;
  const seen = new Set([sx + ',' + sy]);
  const st = [[sx, sy]];
  /* Kenttä voi kertoa paikkoja joihin taksi ilmestyy lentämättä — Teleportin
     porttien ulostulot. Ilman niitä täyttö luulisi kolmea huonetta
     saavuttamattomiksi, ja jokainen niiden alusta olisi "ei pääse
     laskeutumaan". */
  for (const s of seeds || []) {
    const x = snap(s.x), y = snap(s.y);
    const k = x + ',' + y;
    if (seen.has(k) || !free(x, y)) continue;
    seen.add(k);
    st.push([x, y]);
  }
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

/**
 * host on pelin puoli: kangas, elävät taulukot ja ne kaksi asiaa joita tämä ei
 * voi itse tehdä — pelin pysäyttäminen ja tiedoston kirjoittaminen portaalin
 * kautta.
 */
export function createSketch(host) {
  /* Siirrettävien lista rakennetaan kerran kenttää kohti eikä joka kutsulla:
     plugin tunnistaa valitun samuudella, ja joka kerta uusi olio tarkoittaisi
     ettei mikään pysy valittuna. Alustalle annetaan runko erikseen, koska
     kentän oma alusta-olio ja se jota ruudulla piirretään ovat eri oliot —
     loadLevel kopioi ne. */
  let items = [], itemsFor = null;
  function movable() {
    const lv = host.level();
    if (itemsFor !== lv) {
      itemsFor = lv;
      items = (lv.edit || []).map(it => (it.kind === 'pad'
        ? Object.assign({}, it, { box: () => host.pads().find(p => p.id === it.obj.id) })
        : it));
    }
    return items;
  }

  /* Mikä pelissä on este. Alustan alle piirtyvä tunnuspallo on mukana siksi,
     että se on niitä asioita jotka jäävät napin taakse huomaamatta. */
  function solids() {
    const out = [];
    for (const w of host.walls()) {
      out.push({ kind: w.door ? 'door' : 'wall', x: w.x, y: w.y, w: w.w, h: w.h });
    }
    for (const p of host.pads()) {
      out.push({ kind: p.fuel ? 'fuel' : 'pad', x: p.x, y: p.y, w: p.w, h: p.h });
      out.push({ kind: 'ring', x: p.x + p.w / 2, y: p.y + p.h + 22, r: 13 });
    }
    for (const b of host.buttons()) out.push({ kind: 'button', x: b.x, y: b.y, w: b.w, h: b.h });
    return out;
  }

  /* Mikä sommittelussa on vikana. Samat tarkistukset kuin check-grid.mjs:ssä
     ja samoilla luvuilla — kaksi työkalua jotka ovat kentästä eri mieltä on
     huonompi kuin yksikään. Varoitus on teksti ja punainen kehys, ei esto.

     Kaksi sääntöä on tahallaan poissa, molemmat Samin päätöksiä 20.9.2026:

       Kosketusnapit. Ne ovat läpikuultavia ja sormen vierestä näkee, joten
       alusta saa mennä niiden viereen ja vähän päällekin. Ne piirtyvät yhä
       törmäyskuvaan, koska paikka on hyvä tietää — se ei vain ole virhe.

       Alusta seinässä. Merkitystä on vain sillä, voiko alustalle laskeutua:
       yläpinta seinän päällä riittää, ja alapuoli saa olla seinän sisässä,
       koska alusta piirtyy joka tapauksessa seinän päälle. */
  function check() {
    const out = [];
    const seen = new Set();
    const add = (text, b) => { if (!seen.has(text)) { seen.add(text); out.push({ text, box: b }); } };
    const pads = host.pads();
    const walls = host.walls();
    const who = p => (p.fuel ? 'tankkaus' : 'alusta ' + p.id);

    for (const p of pads) {
      const top = { x: p.x, y: p.y - 1, w: p.w, h: 2 };
      for (const w of walls) {
        if (!w.door && hit(top, w)) { add(`${who(p)}: laskupinta on seinän sisällä`, top); break; }
      }
      if (p.x < 0 || p.y < 0 || p.x + p.w > W || p.y + p.h > H) {
        add(`${who(p)} on kentän ulkopuolella`, box(p));
      }
    }

    const vis = reach(walls, pads, host.gate(), host.level().seeds);
    if (!vis) { add('luukun alla ei ole tilaa tulla sisään', null); return out; }

    for (const p of pads) {
      const x = Math.round((p.x + p.w / 2) / STEP) * STEP;
      const y = Math.round((p.y - THB / 2 - 6) / STEP) * STEP;
      let ok = false;
      for (let dx = -24; dx <= 24 && !ok; dx += STEP) {
        for (let dy = 0; dy <= 24 && !ok; dy += STEP) if (vis.has((x + dx) + ',' + (y - dy))) ok = true;
      }
      if (!ok) add(`${who(p)}: ei pääse laskeutumaan`, box(p));
    }

    /* Auki vetäytynyt luukku on umpinainen koko matkansa, joten merkitystä on
       vain sillä onko se siellä missä taksi voi olla. Kentän reunalla se saa
       mennä kehäseinän sisään ja ruudun yli: sinne ei pääse eikä siellä näy
       mitään. */
    for (const w of walls) {
      const g = gapOf(w);
      if (!g) continue;
      const slid = w.door.axis === 'V'
        ? { x: g.x, y: w.door.at + GAP * w.door.dir, w: g.w, h: GAP }
        : { x: w.door.at + GAP * w.door.dir, y: g.y, w: GAP, h: g.h };
      for (const k of vis) {
        const [x, y] = k.split(',').map(Number);
        if (!hit({ x: x - TWB / 2, y: y - THB / 2, w: TWB, h: THB }, slid)) continue;
        add(`ovi ${w.door.id || ''}: auki luukku on lennettävässä tilassa`.trim(), slid);
        break;
      }
    }
    return out;
  }

  return createSketchpad({
    canvas: host.canvas,
    toLocal: host.toLocal,
    size: { w: W, h: H },
    scene: () => host.level().name,
    items: movable,
    spawn: () => host.level().spawn || [],
    solids,
    check,
    kinds: KINDS,
    labels: LABELS,
    lang: 'fi',
    side: 'left',                              // säätöpaneeli on oikeassa
    snap: 4,
    save: host.save,
    canSave: host.canSave,
    onMove: host.onMove,
    onOpen: host.onOpen,
    onClose: host.onClose,
  });
}
