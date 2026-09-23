/* Space Taxi — vuoro, jossa on useampi kenttä.
 *
 * Säännöt ovat Muse Softwaren 1984 C64-pelistä: painovoima vetää koko ajan,
 * suuntasuuttimet kiihdyttävät, ja laskutelineen pitää olla alhaalla ennen
 * kosketusta. Teline alhaalla sivusuuttimet eivät toimi. Asiakas ilmestyy
 * alustan reunaan, huutaa taksin, kertoo minne haluaa ja maksaa perillä sitä
 * enemmän mitä nopeammin ja pehmeämmin keikka meni.
 *
 * Alusta on käyty kun siellä on pysähdytty: sekä nouto että jättö merkkaa
 * paikan. Nouto arvotaan vapaasti mille tahansa alustalle, mutta määränpää on
 * aina jokin käymätön alusta — ja jos käymättömiä ei ole, asiakas pyytää ylös.
 *
 * Kaksi varoitusääntä: matala piippaus vähistä bensoista ja korkea
 * lähestymisvaroitus kun teline on alhaalla ja vauhti lähestyy laskurajaa.
 * Alusta varoittaa myös itse: sen valolista vilkkuu punaisen ja sinisen väliä
 * siitä lähtien kun vauhti riittäisi pomppuun, ja tihenee laskurajaa kohti.
 * Seinästä ei varoiteta erikseen — siitä kertoo se että seinä on edessä.
 *
 * Katosta ulos lähtenyt asiakas jatkaa kyydissä seuraavaan kenttään, joten uusi
 * kenttä alkaa jättökeikalla ja hän maksaa vasta perillä. Taksi tulee kenttään
 * aina katon luukusta — myös kolarin jälkeen. Kentän lopussa on välianimaatio,
 * ja vuoron jälkeen loppuruutu (js/hyperspace.js), johon kortti häivähtää vasta
 * parin sekunnin päästä.
 *
 * Tekstit ja puhe tulevat js/i18n.js:stä. Kentät ovat js/levels.js:ssä, luukun
 * ulkoasu js/gate.js, pompun malli js/bounce.js, välianimaatio js/cutscene.js
 * ja tulostaulu js/leaderboard.js.
 *
 * ?debug=1 avaa säätöpaneelin, ?test=1 ajaa pompputestin, ?lang=fi|en pakottaa
 * kielen, gate-test.html on luukun oma säätösivu.
 */
import { createJoystick } from 'https://plugins.game.bigbools.fi/joystick/v1/index.js';
import { createGamepad } from 'https://plugins.game.bigbools.fi/gamepad/v1/index.js';
import { portal, onPortal, setPortal }
  from 'https://plugins.game.bigbools.fi/portal-events/v1/index.js';
/* Saako debug tällä sivulla olla auki lainkaan. Omassa osoitteessaan peli on
   omillaan; kehyksessä debug on portaalin myönnettävä, ja sen myöntää vain
   tekijän oma sivu — sama sivu joka sanoo canWrite. Kytkin jota ei myönnetä ei
   kuulu näkyä: nappi joka ei tee mitään on huonompi kuin nappi jota ei ole. */
const debugAllowed = () => !portal.embedded || portal.canWrite;
/* Sama moduuli nimiavaruutena. Tallennusfunktio tulee pluginiin vasta
   seuraavassa versiossa, ja nimetty tuonti puuttuvasta viennistä kaataisi
   koko moduulin latausvaiheessa — nimiavaruudesta puuttuva on vain
   undefined, jolloin peli toimii ja nappi kertoo ettei tallennus ole
   käytettävissä. */
import * as portalApi
  from 'https://plugins.game.bigbools.fi/portal-events/v1/index.js';
import { liftFor, bounceNorm } from './bounce.js';
import { drawGateGlow } from './gate.js';
import { createCut } from './cutscene.js';
import { createHyperspace } from './hyperspace.js';
import { LEVELS, LEVEL_FILES } from './levels.js';
import { createSketch } from './sketch.js';
import { mountBoard } from './leaderboard.js';
import { LANG, setLang, t, voiceFor, numWord } from './i18n.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const card = document.getElementById('card');
const panelEl = document.getElementById('panel');

/* ------------------------------------------------------------------ kenttä */
const W = 720, H = 1040;
const CEIL = 16;
const TW = 54, TH = 28, GEAR = 14;
const FUEL_MAX = 100;
const FUEL_LOW = 35;
const TAXI_PRICE = 500;
const FLEET_COUNT = 3, FLEET_PRICE = 1000;
const CLEAN_BONUS = 100;
const ENTER_Y = H * 0.15;
const HORN_R = 150;
/* Taksi on kyykyssä kun teline on sisällä ja pohja alustan pinnassa. Asiakas
   sekä nousee kyytiin että poistuu vain silloin: ovi on siellä missä jalat
   ovat, eikä jaloilleen nousseeseen taksiin kiivetä.

   Sama raja molemmille, ja se on nolla eikä "melkein": kyykky kestää
   neljäsosasekunnin, joten väljempi raja näkyisi asiakkaana joka lähtee
   kävelemään ennen kuin taksi on paikallaan. */
const KNEEL_DOWN = 0.02;
const kneeled = () => taxi.gear < KNEEL_DOWN;

/* Kyydistä poistuva kävelee lähimmälle alustan reunalle ja häipyy siinä.
   Kävelyvauhti on sama kuin kyytiin tullessa, jotta sama tyyppi liikkuu
   molempiin suuntiin samalla tavalla. */
const LEAVE_WALK = 95;                     // px/s
const LEAVE_FADE = 16;                     // näin läheltä reunaa häivytys alkaa
const SQ_FALL = 0.4, SQ_WAIT = 0.3, SQ_RISE = 0.7;
const SQ_DUR = SQ_FALL + SQ_WAIT + SQ_RISE;
const GRAVE_MAX = 10;
const END_CARD_DELAY = 2600;
const LAND_WARN_FROM = 0.75;               // varoitus jo ennen laskurajaa
const PAD_WARN_LEAD = 1.0;                 // sekuntia pudotusta ennen kuin alusta vilkkuu
const PAD_WARN_NEAR = 110;                 // ...tai ainakin näin läheltä
/* Nokan kääntyminen kulkusuuntaan. `turnV` (säädin) on se vauhti joka uuteen
   suuntaan pitää kertyä ennen kuin taksi kääntyy, ja se on olemassa juuri
   välkkymisen takia: ilman kynnystä nokka heilahtaisi joka kerta kun vauhti
   käy nollan kautta.

   **Itse käännös on välitön peilaus.** Animoitu käännös kokeiltiin 23.9.2026
   ja Sami hylkäsi sen saman tien: *"piti olla instant flip, nyt on liuku ja
   taksi menee ihan reikäiseksi mutkalla, ihan vaan flipx."* Litteän kautta
   kulkeva runko on juuri sitä: kapea kaistale jonka läpi näkyy. Kynnys jää,
   liuku ei. */
/* Telineen ulos- ja sisäänmenon vauhti, 1/s: neljäsosasekunti koko matkaan. */
const GEAR_RATE = 4;

/* Näin monta ruutua ylös on pidettävä pohjassa ennen kuin taksi ponnistaa
   alustalta. Sami 23.9.2026: *"nyt pomppii välillä vahingossa."* Ponnistus on
   nopea ja lähtee vauhdilla, joten hipaisu tikkuun riitti nostamaan taksin
   ilmaan kesken asiakkaan odottamisen. Ruutuja eikä sekunteja, koska niin se
   pyydettiin; 60 ruudun sekunnilla tämä on 50 ms. */
const LEAVE_HOLD = 3;
const PAD_LEAVE = 0.5;                     // näin kauan lähtöalusta vielä kannattelee
const PAD_LEAVE_GAP = 8;                   // ...ja tätä lähempänä niin kauan kuin siinä ollaan
const PAD_BLINK_SLOW = 3, PAD_BLINK_FAST = 14;   // vilkkumisen tahti Hz
const PAD_WARN_HOT = '#ff5d7a', PAD_WARN_COLD = '#6fe3ff';

let levelIndex = 0, level = LEVELS[0];
let GATE = level.gate, WALLS = [], WALLS0 = 0, PADS = [];

function frameWalls(gate) {
  return [
    { x: 0, y: 0, w: gate.x, h: CEIL },
    { x: gate.x + gate.w, y: 0, w: W - gate.x - gate.w, h: CEIL },
    { x: 0, y: H - 16, w: W, h: 16 },
    { x: 0, y: 0, w: 16, h: H },
    { x: W - 16, y: 0, w: 16, h: H },
  ];
}
const gateBar = () => ({ x: GATE.x, y: 0, w: GATE.w, h: CEIL });
const padById = id => PADS.find(p => p.id === id);
const numbered = () => PADS.filter(p => !p.fuel);

const DEFAULTS = {
  grav: 250, thrust: 920,
  landVY: 215, landVX: 200,
  bounceFrom: 0.5, bounceLift: 10, bounceKeep: 0.62, hopRate: 2,
  burn: 12, sideBurn: 0.5, refuel: 63, price: 0.9,
  fare: 100, tip: 105, tipTime: 44, exitBonus: 40,
  /* Tippiprofiilit: kerroin perustippiin ja kerroin siihen miten nopeasti
     mittari laskee. Nämä ovat säätimissä, koska oikea tuntuma löytyy vain
     ajamalla. Ks. TIPPERS. */
  /* Tyhjän tankin pätkivä syöttö. Ks. dryThrust. */
  dryOn: 0.3, dryOff: 0.7, dryJitter: 0.08, dryLife: 3,
  tipCalm: 1, fadeCalm: 1,
  tipRush: 1.85, fadeRush: 2.4,
  tipHold: 1.35, fadeHold: 1.4,
  stick: 2.05, turnV: 70,
  /* Tyhjenevän tankin savuvana. Ks. stepSmoke. */
  /* Savun määrä tankin täyteyden mukaan: 21 pistettä viiden prosentin välein,
     indeksi 0 = tyhjä tankki, 20 = täysi. Yksi käyrä kahden luvun sijasta
     (ennen: `smokeFrom` ja `smokeRate`), koska "mistä alkaa" ja "kuinka
     paljon" ovat saman asian kaksi puolta — ja käyrällä määrä saa myös
     kasvaa miten haluaa. Sami 23.9.2026. Oletus on täsmälleen entinen muoto:
     nollasta 25 prosenttiin, 15 savua sekunnissa tyhjänä. */
  smokeCurve: [15, 13.2, 11.4, 9.6, 7.8, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  smokeLife: 1.7, smokeSize: 5,
  smokeGrow: 15, smokeRise: 16,
  /* Savun liukuma: väri ja läpinäkyvyys kummassakin päässä. Väri on luku
     (0xRRGGBB) eikä merkkijono, jotta viritys pysyy kauttaaltaan numeroina —
     tallennus, lataus ja kentän kertoimet käsittelevät vain lukuja, eikä
     yhteen väriin kannata rakentaa poikkeusta koko ketjuun. */
  smokeC0: 0x969696, smokeA0: 0.55,        // kynnyksellä: vaalea harmaa
  smokeC1: 0x0c0c0c, smokeA1: 0.55,        // tyhjänä: melkein musta
};
const DEFAULT_SIDE = 'left';
/** Viritys on lukuja ja taulukoita lukuja. Taulukko kopioidaan aina, koska
    jaettu taulukko tarkoittaisi että säädin kirjoittaa myös oletukseen —
    ja silloin "oletukset"-nappi ei palauttaisi mitään. */
const cloneTune = o => {
  const r = {};
  for (const k of Object.keys(o)) r[k] = Array.isArray(o[k]) ? o[k].slice() : o[k];
  return r;
};
const P = cloneTune(DEFAULTS);
let gearSide = DEFAULT_SIDE;

/* Nappien puoli on pelaajan asia, ei tekijän. tune.json antaa oletuksen, mutta
   kerran tehty valinta voittaa sen eikä katoa kun tekijä julkaisee uuden
   virityksen. Omassa avaimessaan siksi, ettei pelaajan napinpainallus kulkisi
   saveTunen kautta: se leimaisi koko virityksen hänen selaimessaan julkaistua
   uudemmaksi, eivätkä peliin tallennetut arvot pääsisi enää koskaan perille. */
const SIDE_STORE = 'spacetaxi.side';
let sidePick = null;
try {
  const s = localStorage.getItem(SIDE_STORE);
  if (s === 'left' || s === 'right') sidePick = s;
} catch (e) {}

/* Kosketusnapit pois. Näppäimistöllä ja ohjaimella ne ovat pelkkää kuvaa
   ruudun alalaidassa, ja alanurkat vapautuvat kentälle. Puoli jää muistiin,
   joten takaisin kytkettynä ne ovat siellä missä ennenkin. */
const TOUCH_STORE = 'spacetaxi.touch';
let touchBtns = true;
try { touchBtns = localStorage.getItem(TOUCH_STORE) !== '0'; } catch (e) {}

function setTouch(on) {
  touchBtns = !!on;
  try { localStorage.setItem(TOUCH_STORE, touchBtns ? '1' : '0'); } catch (e) {}
}

function setSide(side) {
  if (side !== 'left' && side !== 'right' || side === gearSide) return;
  sidePick = side;
  gearSide = side;
  layout();
  try { localStorage.setItem(SIDE_STORE, side); } catch (e) {}
}

/* Vaikeustaso on pelaajan asetus: kaksi kerrointa, painovoimalle ja työnnölle.
 *
 * Ääripäät eivät ole keksittyjä. **Helppo on tasan kuun arvot** — samat 0,2 ja
 * 0,25 jotka Moonshotilla on — koska se on jo ajettu ja tiedetään pelattavaksi,
 * ja **pro on kerroin 1** eli peli ilman kevennystä, se jota viritetään ja
 * jollaisena peli oli ennen tätä säädintä. Normaali on suunnilleen niiden
 * keskeltä.
 *
 * Kertoimet ovat eri suuret tahallaan: kuussa työntöä jää suhteessa enemmän
 * kuin painovoimaa, eli kevyemmällä tasolla taksi myös tottelee paremmin eikä
 * vain putoa hitaammin. Sama suhde säilyy koko asteikon läpi.
 *
 * Oletus on normaali, koska säädin tehtiin nimenomaan helpottamaan peliä:
 * vihje vaikeudesta tuli pelaajilta. Tippiin ei kosketa, koska se on kiinni
 * ajasta — kevennetyllä tasolla tienaa itsestään vähemmän ja prolla parhaiten,
 * eikä palkkiota tarvitse erikseen porrastaa.
 *
 * Kertoimia on kolme päällekkäin: globaali viritys, kentän oma kerroin ja tämä.
 * Siksi tulolle on pohja MUL_MINissä, ja se on sama kuu: Moonshot on jo
 * valmiiksi pohjassa eikä vaikeustaso muuta sitä. */
const DIFFS = [
  { id: 'easy', mul: { grav: 0.2, thrust: 0.25 } },
  { id: 'normal', mul: { grav: 0.6, thrust: 0.65 } },
  { id: 'pro', mul: { grav: 1, thrust: 1 } },
];
const DIFF_DEF = 'normal';
const MUL_MIN = { grav: 0.2, thrust: 0.25 };
const DIFF_STORE = 'spacetaxi.diff';
let diff = DIFF_DEF;
try {
  const d = localStorage.getItem(DIFF_STORE);
  if (DIFFS.some(x => x.id === d)) diff = d;     // tuntematon jää oletukseksi
} catch (e) {}
const diffMuls = () =>
  (DIFFS.find(d => d.id === diff) || DIFFS.find(d => d.id === DIFF_DEF)).mul;

/* Viritys kahdessa kerroksessa.
 *
 * BASE on globaali viritys: säätimet kirjoittavat siihen ja tallennus lukee
 * sen. MUL on kentän kerroin samaan avaimeen, 1 kun kenttä ei ota kantaa.
 * P on näiden tulo eli se mitä fysiikka lukee — ja nimenomaan sama olio kuin
 * ennen, joten yksikään käyttökohta ei muutu eikä tiedä tästä mitään.
 *
 * Kerros on olemassa siksi, että painovoima ja työntö ovat eri asia eri
 * kentässä mutta niiden suhde globaaliin viritykseen ei saa kadota: kun
 * säätää painovoimaa, myrskykentän raskaampi painovoima seuraa mukana.
 * Kenttä voi julkaista lähtökertoimensa (level.mul), ja säätöpaneeli antaa
 * muuttaa niitä lennossa. */
const BASE = cloneTune(DEFAULTS);

/* Kertoimet säilyvät kentittäin koko istunnon: kentästä toiseen käyminen ei
   saa nollata sitä mitä juuri säädit. MUL osoittaa aina nykyisen kentän
   omaan olioon. */
const MULS = {};

/* **Kentän tunnus on sen tiedostonimi, ei näkyvä nimi.** Nimi on säädettävä
   teksti ja saa vaihtua lennossa; tiedostonimi ei vaihdu koskaan.
   Sami 23.9.2026: *"työ- ja tiedostonimi sitten erikseen."*

   Ero on pakko tehdä, koska kentälle tallennetut arvot avataan tunnuksella.
   Ennen tätä ne avattiin nimellä, ja kun Tulivuoresta tuli Hellcano, koko
   kentän viritys — vuoren mitat, purkauksen arvot, bensakerroin — jäi orvoksi
   vanhan nimen alle ja kenttä palasi koodin oletuksiin. Kerran se korjattiin
   käsin tiedostoa muokkaamalla; toista kertaa ei tarvita.

   `indexOf` eikä etukäteen rakennettu kartta: `reloadLevel` vaihtaa
   LEVELS-taulukkoon uuden moduulin, ja kartta osoittaisi vanhaan olioon. */
const lvId = lv => {
  const i = LEVELS.indexOf(lv);
  return (i >= 0 && LEVEL_FILES[i]) || lv.name;
};
const mulOf = lv => MULS[lvId(lv)] || (MULS[lvId(lv)] = Object.assign({}, lv.mul));
let MUL = {};

/* Sauva syntyy vasta paljon alempana, ja tätä kutsutaan jo tallennettua
   viritystä ladattaessa. `typeof stick` EI kelpaa vartijaksi: const-muuttujan
   kuolleessa vyöhykkeessä typeof heittää ReferenceErrorin sen sijaan että
   palauttaisi 'undefined', joten vartija kaataisi juuri sen kutsun jota se
   yrittää suojata. Tavallinen lippu on ainoa joka toimii. */
let stickReady = false;

function applyMul() {
  const d = diffMuls();
  for (const k of Object.keys(DEFAULTS)) {
    /* Taulukko menee sellaisenaan ja **samana oliona**: kerroin on luvun
       asia, ja säätimen piirtämä käyrä näkyy pelissä ilman välikopiota. */
    if (Array.isArray(BASE[k])) { P[k] = BASE[k]; continue; }
    const m = MUL[k];
    let mul = typeof m === 'number' && isFinite(m) ? m : 1;
    if (k in MUL_MIN) mul = Math.max(MUL_MIN[k], mul * d[k]);
    P[k] = BASE[k] * mul;
  }
  if (stickReady) stick.gain = P.stick;
}

function setDiff(id) {
  if (!DIFFS.some(x => x.id === id) || id === diff) return;
  diff = id;
  try { localStorage.setItem(DIFF_STORE, id); } catch (e) {}
  applyMul();
}

/* Koko viritys yhtenä oliona: globaali pohja ja jokaisen kentän omat arvot.
 *
 * Kenttien arvoja ei tarvitse luetella täällä, koska kenttä kertoo itse mitä
 * sillä on (level.tune). Peli ei siis tiedä yhdenkään kentän sisällöstä mitään
 * tälläkään puolella — uusi kenttä uusine säätimineen tallentuu ilman että
 * tätä koodia kosketaan.
 *
 * stamp on tallennushetki. Sitä tarvitaan siihen, kumpi voittaa kun sekä
 * peliin tallennettu tune.json että selaimen paikalliset kokeilut ovat
 * olemassa: uudempi voittaa. Muuten vanha localStorage jäisi jyräämään juuri
 * julkaistut oletukset, ja se vika näkyisi vasta pelaajilla. */
function tuneAll(stamp) {
  const levels = {};
  for (const lv of LEVELS) {
    const entry = {};
    const m = MULS[lvId(lv)];
    if (m && Object.keys(m).length) entry.mul = Object.assign({}, m);
    const own = {};
    for (const g of lv.tune || []) {
      if (!g.obj || !g.sliders) continue;
      const o = own[g.name] = {};
      for (const sl of g.sliders) o[sl.key] = g.obj[sl.key];
    }
    if (Object.keys(own).length) entry.own = own;
    /* Nimi tallentuu vain jos se on muutettu: muuttumaton nimi on koodissa,
       eikä sitä kannata kirjoittaa tiedostoon toiseen kertaan. */
    if (lv.name !== LEVEL_NAME0.get(lvId(lv))) entry.name = lv.name;
    if (Object.keys(entry).length) levels[lvId(lv)] = entry;
  }
  return { v: 1, stamp: stamp || Date.now(), gearSide, global: Object.assign({}, BASE), levels };
}

/** Lukee tuneAllin tuotoksen takaisin. Tuntemattomat avaimet ohitetaan, joten
    vanha tiedosto ei kaadu uuteen koodiin eikä toisin päin. */
function applyAll(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const g = raw.global || raw;                 // vanha muoto oli pelkkä pohja
  for (const k of Object.keys(DEFAULTS)) {
    /* Taulukko kelpaa vain oikean mittaisena ja pelkkinä lukuina: väärän
       mittainen käyrä olisi hiljainen vika, ja tiedosto voi olla vanha. */
    if (Array.isArray(DEFAULTS[k])) {
      const a = g[k];
      if (Array.isArray(a) && a.length === DEFAULTS[k].length
          && a.every(v => typeof v === 'number' && isFinite(v))) BASE[k] = a.slice();
      continue;
    }
    if (typeof g[k] === 'number' && isFinite(g[k])) BASE[k] = g[k];
  }
  if (raw.gearSide === 'left' || raw.gearSide === 'right') {
    gearSide = sidePick || raw.gearSide;     // pelaajan valinta voittaa tiedoston
    layout();
  }
  for (const lv of LEVELS) {
    /* Tunnus ensin, nimi varalta: ennen 23.9.2026 tallennetut tiedostot on
       avattu nimellä, eikä niitä tarvitse muuntaa erikseen. */
    const ls = raw.levels || {};
    const e = ls[lvId(lv)] || ls[lv.name];
    if (!e) continue;
    if (typeof e.name === 'string' && e.name.trim()) lv.name = e.name.trim().slice(0, 32);
    if (e.mul) {
      const m = mulOf(lv);
      for (const k of Object.keys(DEFAULTS)) {
        if (typeof e.mul[k] === 'number' && isFinite(e.mul[k])) m[k] = e.mul[k];
      }
    }
    for (const grp of lv.tune || []) {
      const o = e.own && e.own[grp.name];
      if (!o || !grp.obj) continue;
      for (const sl of grp.sliders || []) {
        if (typeof o[sl.key] === 'number' && isFinite(o[sl.key])) grp.obj[sl.key] = o[sl.key];
      }
    }
  }
  MUL = mulOf(level);
  applyMul();
  return true;
}

const STORE = 'spacetaxi.tune';
/* Peli saa kirjoittaa vain config-kansioon ja vain JSONia. Rajaus on
   palvelimella; tämä on vain se nimi jonka tämä peli on siellä valinnut. */
const TUNE_FILE = 'config/tune.json';
let localStamp = 0;                            // milloin selaimen kopio tallennettiin

/* Yksi askel kumottavaa: viritys sellaisena kuin se oli ennen viimeisintä
   muutosta. Kuva otetaan säätimeen tartuttaessa eikä jokaisesta input-
   tapahtumasta, joten kumoa peruu koko raahauksen eikä yhtä pikseliä siitä.

   savedBody on se mikä peliin on viimeksi viety. Näiden ero kertoo onko
   tallennettavaa, ja siitä tallenna-nappi tietää milloin se on päällä: nappi
   joka on aina päällä ei kerro mitään. Aikaleima jätetään pois, koska se
   muuttuu joka kerta eikä kerro muutoksesta mitään. */
let undoSnap = null;
let savedBody = '';
const tuneBody = () => JSON.stringify(tuneAll(1));
const tuneDirty = () => tuneBody() !== savedBody;
function snapUndo() { undoSnap = tuneBody(); }

/** Palauttaa virityksen tasan kuvan mukaiseksi. Kertoimet tyhjennetään ensin,
    koska applyAll kirjoittaa vain ne jotka kuvassa ovat — ilman tätä kumoaminen
    jättäisi juuri lisätyn kertoimen henkiin. */
function applyBody(body) {
  for (const k of Object.keys(MULS)) delete MULS[k];
  try { return applyAll(JSON.parse(body)); } catch (e) { return false; }
}
function loadTune() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (raw && applyAll(raw)) localStamp = +raw.stamp || 0;
  } catch (e) {}
}
function saveTune() {
  localStamp = Date.now();
  try { localStorage.setItem(STORE, JSON.stringify(tuneAll(localStamp))); } catch (e) {}
}

/* Peliin tallennetut arvot. Ne ovat oletukset kaikille pelaajille, ja selaimen
   paikalliset kokeilut voittavat vain jos ne ovat tiedostoa uudempia — muuten
   vanha localStorage jyräisi juuri julkaistut oletukset, ja se vika näkyisi
   vasta pelaajilla eikä koskaan tekijällä itsellään. */
function loadGameTune() {
  fetch(TUNE_FILE, { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      if (!j) return;
      if ((+j.stamp || 0) < localStamp) {
        /* Paikalliset kokeilut ovat uudempia ja jäävät voimaan. Se mitä pelissä
           on pitää silti tietää, jotta tallenna-nappi osaa olla päällä: käydään
           tiedosto läpi kerran ja palataan omiin arvoihin. */
        const mine = tuneBody();
        applyBody(JSON.stringify(j));
        savedBody = tuneBody();
        applyBody(mine);
        return;
      }
      applyBody(JSON.stringify(j));
      localStamp = +j.stamp || 0;
      savedBody = tuneBody();
      undoSnap = null;
      if (!panelEl.classList.contains('hidden')) buildPanel();
    })
    .catch(() => {});
}

/* Nurkassa on ratas ja sen vieressä kehittäjän liuku, joka näkyy vain
   debug-tilassa. Ääni, koko ruutu, nappien puoli, kieli ja vaikeustaso ovat
   rattaan takana samassa valikossa; säätöpaneeli on eri asia eikä sen kuulu
   olla pelaajan asetusten sisällä. Aiemmin kuvakkeita oli kolme — ääni,
   säädöt, koko ruutu — ja kaksi niistä oli arvattava. */
let GEAR_BOX, COG_BOX, TUNE_BOX, HORN_BOX;
function layout() {
  const right = gearSide === 'right';
  GEAR_BOX = { x: right ? W - 158 : 30, y: H - 172, w: 128, h: 96 };
  HORN_BOX = { x: right ? W - 158 : 30, y: H - 262, w: 128, h: 78 };
  const col = i => right ? 24 + i * 54 : W - 70 - i * 54;
  COG_BOX = { x: col(0), y: H - 74, w: 46, h: 46 };
  TUNE_BOX = { x: col(1), y: H - 74, w: 46, h: 46 };
}
/* Kenttien omat lähtöarvot talteen ennen kuin tallennettu viritys kirjoittaa
   niiden päälle. Kentän olio on ainoa paikka jossa ne elävät, joten ilman tätä
   "oletukset" ei voisi palauttaa niitä millään. */
const LEVEL_DEF = new Map();
/* Sama koodin nimille: se on se mihin "oletukset" palauttaa, ja se mistä
   tiedetään onko nimeä ylipäätään muutettu. */
const LEVEL_NAME0 = new Map();
for (const lv of LEVELS) {
  LEVEL_NAME0.set(lvId(lv), lv.name);
  for (const g of lv.tune || []) {
    if (!g.obj || !g.sliders) continue;
    const d = {};
    for (const sl of g.sliders) d[sl.key] = g.obj[sl.key];
    LEVEL_DEF.set(lvId(lv) + '\u0000' + g.name, d);
  }
}

function resetLevelTune() {
  for (const k of Object.keys(MULS)) delete MULS[k];
  for (const lv of LEVELS) {
    const n0 = LEVEL_NAME0.get(lvId(lv));
    if (n0) lv.name = n0;                      // myös nimi on oletusarvo
    for (const g of lv.tune || []) {
      const d = LEVEL_DEF.get(lvId(lv) + '\u0000' + g.name);
      if (d && g.obj) Object.assign(g.obj, d);
    }
  }
  MUL = mulOf(level);
}

/* -------------------------------------------------------------- sommittelu
 *
 * Kenttäluonnostelu on portaalin sketchpad-plugin, ja Space Taxin oma puoli
 * siitä — mikä on törmäystä ja mikä sommittelussa on vikana — on js/sketch.js.
 * Peliin jää kolme asiaa: kutsu kentän alussa, piirto silmukan lopussa ja se
 * ettei pelin oma syöte tartu kankaaseen kun työkalu on auki.
 *
 * Plugin ei kirjoita geometriaa peliin. Kentän luvut ovat kenttätiedostossa,
 * ja luonnoksesta ne kirjoitetaan sinne käsin — muuten tools/check-grid.mjs,
 * joka lukee kenttämoduulin, tarkistaisi eri kenttää kuin mitä pelataan.
 * Raahatut paikat jäävät voimaan vain tässä selaimessa. */

/* Elävät alustat ovat kopioita kentän omista — loadLevel kopioi ne ja ottaa
   bx/by talteen liikkuvia alustoja varten — joten siirto pitää viedä myös
   niihin. Muuten raahaus näkyisi vasta kenttää vaihdettaessa. */
function syncPads() {
  for (const p of PADS) {
    const src = (level.pads || []).find(q => q.id === p.id);
    if (!src) continue;
    p.x = p.bx = src.x;
    p.y = p.by = src.y;
    /* Myös leveys: alusta on törmäyslaatikko, joten sen koko säädetään sillä
       luvulla jota fysiikka lukee eikä piirron skaalalla. */
    if (typeof src.w === 'number') p.w = src.w;
  }
}

let sketchPaused = false;
const refreshPanel = () => { if (panelOpen()) buildPanel(); };

const sketch = createSketch({
  canvas,
  toLocal: toLogical,
  level: () => level,
  pads: () => PADS,
  walls: () => WALLS,
  gate: () => GATE,
  buttons: () => [HORN_BOX, GEAR_BOX],
  /* Peli ei kirjoita omia tiedostojaan — se pyytää emosivulta, joka on
     kirjautunut ja jonka palvelinpuoli tarkistaa omistajuuden. Siksi tallennus
     onnistuu vain tekijän omalla sivulla, ja plugin kertoo syyn itse. */
  save: (file, body) => Promise.resolve(portalApi.savePortalFile(file, body)),
  canSave: () => typeof portalApi.savePortalFile === 'function' && !!portal.canWrite,
  onMove: syncPads,
  /* Tauko editorin ajaksi: liikkuvaa kenttää ei voi lukea liikkeestä, eikä
     taksin tarvitse ajelehtia seinään sillä aikaa kun mittoja katsotaan.
     Sulkeminen palauttaa sen mikä oli. */
  /* saveDev vasta täällä eikä kytkimessä: lehtiö ladataan vasta avattaessa,
     joten kytkin kirjaisi tilan ennen kuin se on totta. */
  onOpen: () => { sketchPaused = paused; setPaused(true); dev.sketch = true; saveDev(); refreshPanel(); },
  onClose: () => { setPaused(sketchPaused); dev.sketch = false; saveDev(); refreshPanel(); },
});

/* ---------------------------------------------------------- kehittäjän tila

   Kenttää rakentaessa sivu ladataan kymmeniä kertoja, ja joka kerta piti etsiä
   kolme kytkintä uudestaan: säätöpaneeli auki, luonnoslehtiö auki, oikea
   kenttä. Se on pieni työ kerrallaan ja iso silmukassa, joten se muistetaan.

   Vain tässä selaimessa ja vain kun säätöjä on käytetty; pelaajan kone ei
   kirjoita tähän koskaan mitään. */
const DEV_STORE = 'spacetaxi.dev';
const dev = { panel: false, sketch: false, level: -1, watch: true, folds: {}, scroll: 0 };
try { Object.assign(dev, JSON.parse(localStorage.getItem(DEV_STORE) || 'null') || {}); } catch (e) {}
let devReady = false;                          // vasta palautuksen jälkeen
/* dev.sketch asetetaan käsin eikä lueta sketch.activesta: onOpen ajetaan ennen
   kuin paneeli on pystyssä — juuri siksi että peli ehtii mennä tauolle ensin —
   joten siinä hetkessä active on vielä false. */
function saveDev() {
  if (!devReady) return;
  dev.panel = panelOpen();
  dev.level = levelIndex;
  dev.watch = watching;
  if (panelOpen()) dev.scroll = panelEl.scrollTop;
  try { localStorage.setItem(DEV_STORE, JSON.stringify(dev)); } catch (e) {}
}

/* Paneelin vieritys talteen. Oma kuuntelija eikä saveDev jokaisesta ruudusta:
   vieritystapahtumia tulee kymmeniä sekunnissa, ja localStorage on synkroninen.
   Viive on lyhyt, koska paneelin voi sulkea heti vierityksen jälkeen. */
let scrollT = 0;
panelEl.addEventListener('scroll', () => {
  clearTimeout(scrollT);
  scrollT = setTimeout(saveDev, 180);
}, { passive: true });

/* Kenttä uusiksi ilman sivun latausta.
 *
 * Sivun lataus pudottaa kokoruututilan — kokoruutu on selaimen dokumentin
 * ominaisuus ja lataus vaihtaa dokumentin — ja se on juuri se mitä kentän
 * kanssa työskennellessä ei haluta. Kenttä on kuitenkin oma moduulinsa, joten
 * sen voi tuoda uudestaan: kyselyparametri tekee siitä eri osoitteen, ja eri
 * osoite on selaimelle eri moduuli.
 *
 * Kolme asiaa pitää siirtää vanhasta uuteen, ja kaikki kolme siksi että uusi
 * moduuli on pelille tuntematon: kentän omat säätöarvot (jotka ovat kentän
 * omassa oliossa eivätkä missään muualla), niiden oletukset, ja se mitä
 * luonnoslehtiö piti kentän lähtöpaikkoina. Ilman viimeistä jokainen muuttunut
 * luku näyttäisi siltä että joku raahasi sen. */
async function reloadLevel() {
  const file = LEVEL_FILES[levelIndex];
  if (!file) return false;
  const keep = tuneBody();                     // kentän omat arvot vanhasta oliosta
  let lv;
  try {
    const m = await import(`./levels/${file}.js?v=${Date.now()}`);
    lv = m[file];
  } catch (e) { return false; }
  if (!lv || !lv.name) return false;
  LEVELS[levelIndex] = lv;
  LEVEL_NAME0.set(lvId(lv), lv.name);          // uuden moduulin oma nimi on oletus
  for (const g of lv.tune || []) {             // uudet oletukset uusista olioista
    if (!g.obj || !g.sliders) continue;
    const d = {};
    for (const sl of g.sliders) d[sl.key] = g.obj[sl.key];
    LEVEL_DEF.set(lvId(lv) + '\u0000' + g.name, d);
  }
  applyBody(keep);                             // ja säädetyt arvot takaisin
  sketch.forget(lv.name);
  beginLevel(levelIndex, false);               // vasta tässä level on uusi
  /* Luonnos uusiksi vasta beginLevelin jälkeen. Synkkaus lukee kentän
     lähtöpaikat, ja ennen beginLeveliä `level` on vielä vanha moduuli — silloin
     oletukset otettaisiin vanhoista luvuista ja jokainen juuri kirjoitettu luku
     näyttäisi siirrolta.

     Itse synkkaus on tässä siksi, että jos kentän muutos oli juuri se että
     luonnos kirjoitettiin lähteeseen ja tyhjennettiin, tässä selaimessa olevat
     siirrot ja lisäykset piirtyisivät muuten toiseen kertaan jo kirjoitettujen
     päälle. */
  try { await sketch.sync(); } catch (e) {}
  return true;
}

/* Kenttä uusiksi itsestään kun tiedosto vaihtuu palvelimella.
 *
 * Silmukka on nyt: avustaja kirjoittaa kentän ja vie sen draftiin, ja tekijä
 * näkee muutoksen ilman että koskee mihinkään. Vartija kysyy tiedoston
 * tunnisteen (ETag, Last-Modified tai koko) muutaman sekunnin välein ja
 * lataa kentän kun se on eri kuin viimeksi.
 *
 * Koko tiedosto haetaan ja siitä lasketaan tiiviste. HEAD olisi halvempi,
 * mutta palvelin ei anna ETagia eikä Last-Modifiedia — pelkkä pituus jäisi
 * ainoaksi tunnisteeksi, ja samanmittainen muutos menisi huomaamatta. 38 kt
 * kolmen sekunnin välein on kehittäjän koneella se mitä se on.
 *
 * no-store ohittaa välimuistin, jota draftilla on viisi minuuttia — ilman sitä
 * vartija katsoisi vanhaa kopiota eikä huomaisi mitään.
 *
 * Käy vain kun säätöpaneeli on auki. debugAllowed yksin ei riitä ehdoksi:
 * pelin omassa osoitteessa se on tosi kenelle tahansa, ja silloin vartija
 * hakisi 38 kt kolmen sekunnin välein pelaajalle joka ei ole avannut mitään.
 * Paneeli auki on se hetki jolloin kenttää rakennetaan, ja se on myös hetki
 * jonka pelaaja ei vahingossa saa aikaan. */
const WATCH_MS = 3000;
let watchT = 0, watchTag = null, watching = false;

function levelUrl() {
  const file = LEVEL_FILES[levelIndex];
  return file ? new URL(`./levels/${file}.js`, import.meta.url).href : null;
}

async function levelTag() {
  const url = levelUrl();
  if (!url) return null;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    const text = await r.text();
    let h = 2166136261;                        // FNV-1a, riittää vertailuun
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return text.length + ':' + (h >>> 0).toString(36);
  } catch (e) { return null; }
}

async function watchTick() {
  if (!watching) return;
  const tag = await levelTag();
  if (watching && tag && watchTag && tag !== watchTag) {
    watchTag = tag;
    const ok = await reloadLevel();
    panelNote = ok ? 'kenttä päivittyi itsestään' : 'kentän lataus ei onnistunut';
    if (panelOpen()) buildPanel();
  } else if (tag) {
    watchTag = tag;
  }
  if (watching) watchT = setTimeout(watchTick, WATCH_MS);
}

/** Onko vartijan syytä käydä: sallittu, päälle kytketty ja paneeli auki. */
const wantWatch = () => debugAllowed() && dev.watch !== false && panelOpen();

function setWatch(on) {
  on = !!on;
  if (on === watching) return;
  watching = on;
  clearTimeout(watchT);
  if (!on) { watchTag = null; return; }
  watchTag = null;                             // ensimmäinen kysely on lähtötaso
  watchTick();
}

layout();
loadTune();
savedBody = tuneBody();                        // kunnes tiedosto kertoo paremmin
loadGameTune();

/* ------------------------------------------------------------------ kangas */
let scale = 1, dpr = 1, lastVW = -1, lastVH = -1;
function resize() {
  const de = document.documentElement;
  const vw = de.clientWidth || window.innerWidth || 1;
  const vh = de.clientHeight || window.innerHeight || 1;
  if (vw === lastVW && vh === lastVH) return;
  lastVW = vw; lastVH = vh;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  scale = Math.min(vw / W, vh / H);
  canvas.width = Math.round(W * scale * dpr);
  canvas.height = Math.round(H * scale * dpr);
  canvas.style.width = Math.round(W * scale) + 'px';
  canvas.style.height = Math.round(H * scale) + 'px';
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(document.documentElement);
resize();

/* ------------------------------------------------------------- koko ruutu */
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function popOut() { try { window.open(location.href, '_blank', 'noopener'); } catch (e) {} }

function toggleFullscreen() {
  if (fsElement()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
    return;
  }
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return popOut();
  try {
    const r = req.call(el, { navigationUI: 'hide' });
    if (r && typeof r.catch === 'function') r.catch(popOut);
  } catch (e) { popOut(); }
}
document.addEventListener('fullscreenchange', () => { lastVW = -1; resize(); });
document.addEventListener('webkitfullscreenchange', () => { lastVW = -1; resize(); });

if (!ctx.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];

/* ------------------------------------------------------------------- äänet */
let actx = null, muted = false;
try { muted = localStorage.getItem('spacetaxi.muted') === '1'; } catch (e) {}

function audio() {
  if (muted) return null;
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { actx = new AC(); } catch (e) { return null; }
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function tone(freq, dur, opts) {
  const a = audio(); if (!a) return;
  opts = opts || {};
  const o = a.createOscillator(), g = a.createGain();
  o.type = opts.type || 'sine';
  const t0 = a.currentTime + (opts.delay || 0);
  o.frequency.setValueAtTime(freq, t0);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain || 0.18, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(dur, gain, from, to, delay) {
  const a = audio(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'lowpass';
  const t0 = a.currentTime + (delay || 0);
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = a.createGain(); g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}

let jet = null;
function jetLevel(v) {
  if (v <= 0 && !jet) return;
  const a = audio();
  if (!a) { if (jet) jet.g.gain.value = 0; return; }
  if (!jet) {
    const n = Math.floor(a.sampleRate * 2);
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = a.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
    jet = { src, f, g };
  }
  jet.g.gain.setTargetAtTime(v * 0.085, a.currentTime, 0.04);
  jet.f.frequency.setTargetAtTime(420 + v * 950, a.currentTime, 0.05);
}

/* -------------------------------------------------------------------- puhe
   Suomea puhutaan vain jos laitteelta löytyy suomenkielinen ääni. */
const SPEAKS = 'speechSynthesis' in window;

/* Loppukaneetti on osa hahmoa: sama ääni pyytää aina samalla tavalla,
   kohteliaasta kiireiseen. Kaneetteja on kuusi ja hahmoja viisi, joten yksi jää
   odottamaan seuraavaa hahmoa.

   Ylöspyynnössä kaneettia ei ole: se keikka maksetaan vasta seuraavan kentän
   alussa, eikä kellään ole vielä kiire mihinkään. */
const TAILS = ['please', 'kind', 'quick', 'hurry', 'go', 'rush'];
const tailFor = kind => 'say.tail.' + TAILS[kind % TAILS.length];

function speakLine(key, kind, params) {
  if (muted || !SPEAKS) return;
  const v = LANG === 'fi' ? voiceFor('fi') : null;
  const lang = v ? 'fi' : 'en';
  /* Kaneetti ratkaistaan samalla kielellä kuin lause, ettei suomalainen
     "vähän äkkiä" päädy englanninkielisen lauseen perään. */
  let p = params;
  if (p && p.tail) p = Object.assign({}, p, { tail: t(p.tail, null, lang) });
  /* Alustan numero sanana: numeromerkin syntetisaattori taivuttaisi itse. */
  if (p && p.n !== undefined) p = Object.assign({}, p, { n: numWord(p.n, lang) });
  const text = t('say.' + key, p, lang);
  try {
    const u = new SpeechSynthesisUtterance(text);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    u.pitch = clamp(0.6 + (kind % 5) * 0.34, 0.1, 2);
    u.rate = 1.06 - (kind % 3) * 0.08;
    u.volume = 0.95;
    speechSynthesis.speak(u);
  } catch (e) {}
}
function warmSpeech() {
  if (!SPEAKS) return;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
}

const sfx = {
  gear() { tone(180, 0.12, { type: 'square', gain: 0.06, to: 120 }); },
  land() { tone(220, 0.14, { type: 'triangle', gain: 0.12, to: 320 }); },
  bounce(n) { tone(300 + n * 110, 0.09, { type: 'triangle', gain: 0.10, to: 200 + n * 80 }); },
  pickup() {
    tone(520, 0.09, { type: 'triangle', gain: 0.14 });
    tone(780, 0.12, { type: 'triangle', gain: 0.12, delay: 0.07 });
  },
  hey() { tone(400, 0.16, { type: 'sawtooth', gain: 0.10, to: 250 }); },
  horn() {
    tone(392, 0.26, { type: 'square', gain: 0.10 });
    tone(494, 0.26, { type: 'square', gain: 0.08 });
    tone(330, 0.20, { type: 'square', gain: 0.07, delay: 0.24 });
  },
  squish() {
    tone(150, 0.20, { type: 'sine', gain: 0.16, to: 55 });
    noise(0.18, 0.18, 900, 120);
    tone(95, 0.14, { type: 'square', gain: 0.09, to: 42, delay: 0.16 });
    noise(0.12, 0.12, 400, 90, 0.16);
  },
  stone() {
    noise(0.55, 0.09, 260, 80);
    tone(62, 0.6, { type: 'sine', gain: 0.09, to: 120 });
  },
  pay() {
    tone(660, 0.10, { type: 'triangle', gain: 0.16 });
    tone(990, 0.12, { type: 'triangle', gain: 0.14, delay: 0.08 });
    tone(1320, 0.18, { type: 'triangle', gain: 0.10, delay: 0.16 });
  },
  gate() { tone(160, 0.5, { type: 'sawtooth', gain: 0.10, to: 640 }); },
  crash() {
    noise(0.4, 0.3, 1800, 120);
    tone(260, 0.45, { type: 'square', gain: 0.13, to: 70 });
  },
  pump() { tone(90, 0.06, { type: 'square', gain: 0.04 }); },
  /** Bensavaroitus: matala ja rauhallinen, tiivistyy tankin tyhjetessä. */
  warn() { tone(196, 0.10, { type: 'square', gain: 0.06, to: 165 }); },
  /** Lähestymisvaroitus: nousee ja tihenee sitä mukaa kun laskuraja lähenee. */
  fast(r) { tone(850 + clamp(r, 0, 1.5) * 450, 0.05, { type: 'square', gain: 0.05 }); },
  buy() {
    tone(330, 0.10, { type: 'square', gain: 0.12 });
    tone(494, 0.12, { type: 'triangle', gain: 0.14, delay: 0.09 });
    tone(659, 0.20, { type: 'triangle', gain: 0.14, delay: 0.19 });
  },
  levelStart() {
    tone(392, 0.11, { type: 'triangle', gain: 0.13 });
    tone(523, 0.11, { type: 'triangle', gain: 0.13, delay: 0.10 });
    tone(784, 0.22, { type: 'triangle', gain: 0.13, delay: 0.20 });
  },
  go() {
    tone(660, 0.09, { type: 'square', gain: 0.13 });
    tone(990, 0.16, { type: 'triangle', gain: 0.14, delay: 0.07 });
  },
  cutscene() {
    const seq = [262, 330, 392, 523, 659, 784, 1047];
    seq.forEach((f, i) => tone(f, 0.28, { type: 'triangle', gain: 0.11, delay: i * 0.33 }));
    tone(131, 2.4, { type: 'sine', gain: 0.07, to: 262 });
    tone(196, 1.6, { type: 'sine', gain: 0.06, to: 392, delay: 2.6 });
  },
  bonus() {
    tone(784, 0.10, { type: 'triangle', gain: 0.12, delay: 0.5 });
    tone(1047, 0.10, { type: 'triangle', gain: 0.12, delay: 0.6 });
    tone(1319, 0.22, { type: 'triangle', gain: 0.12, delay: 0.7 });
  },
  win() {
    tone(523, 0.12, { type: 'triangle', gain: 0.15 });
    tone(659, 0.12, { type: 'triangle', gain: 0.15, delay: 0.11 });
    tone(784, 0.14, { type: 'triangle', gain: 0.15, delay: 0.22 });
    tone(1047, 0.30, { type: 'triangle', gain: 0.14, delay: 0.34 });
    tone(1319, 0.5, { type: 'triangle', gain: 0.12, delay: 0.5 });
  },
  /** Hyppy hyperavaruuteen: vuoro suoritettu. */
  warp() {
    noise(1.6, 0.10, 180, 3000);
    tone(70, 1.4, { type: 'sawtooth', gain: 0.07, to: 520 });
  },
  /** Taksit loppu: moottorit sammuvat ja jäljelle jää hiljaisuus. */
  fade() {
    tone(220, 1.8, { type: 'sine', gain: 0.08, to: 55 });
    tone(165, 2.2, { type: 'sine', gain: 0.06, to: 41, delay: 0.3 });
    noise(1.2, 0.05, 400, 60);
  },
};

/* ------------------------------------------------------------------- tila */
const MENU = 0, PLAY = 1, OVER = 2, BUY = 3, CUT = 4, ENTER = 5;
let state = MENU;

let thrustNow = 0;
let dryT = 0, dryPhase = 0, dryFiring = false;
let taxi, money, fuel, lives, job, served, gateOpen, runT, dead, deadT,
    msg, msgT, bits, lowWarn, fastWarn, padWarn, padBlink,
    graves, squishes, leavers,
    wreck, bounces, titleT, cut, enterT, goT, levelMoney0, hornFx, levelDeaths,
    runDeaths = 0, runRuns = 0, carried = null, hyper = null, endTimer = 0;

const stars = [];
for (let i = 0; i < 70; i++) {
  stars.push({ x: rand(20, W - 20), y: rand(20, H - 20), r: rand(0.6, 1.8), a: rand(0.1, 0.5), p: rand(0, 6.3) });
}

let bag = [], lastKind = -1;
function nextAlien() {
  if (!bag.length) {
    do {
      bag = ALIENS.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    } while (bag.length > 1 && bag[0] === lastKind);
  }
  lastKind = bag.shift();
  return lastKind;
}

/* dead on mukana, jotta kenttä osaa sammuttaa oman suojansa romun päältä:
   crash ei nollaa taxi.landedia, joten ilman tätä Shooting Starsin kupoli jäi
   hohtamaan tyhjän alustan päälle koko kuolinanimaation ajan. */
const api = () => ({ P, taxi, pads: PADS, walls: WALLS, t: runT, rand, say, level: levelIndex, dead });

/** Kentän tilanne nollataan vain tässä — ei koskaan kolarissa. */
function loadLevel(i) {
  levelIndex = clamp(i, 0, LEVELS.length - 1);
  level = LEVELS[levelIndex];
  MUL = mulOf(level);                        // kentän kertoimet, säätimet muuttavat näitä
  applyMul();
  GATE = level.gate;
  sketch.restore();                          // ennen kuin PADS kopioidaan
  WALLS = frameWalls(GATE).concat(level.walls || []);
  /* Tästä indeksistä eteenpäin WALLSissa on vain sitä mitä kenttä työntää
     sinne kesken kentän: putoava tähti, magmapallo, liikkuva kone. Ne ovat
     vaaroja eivätkä kulissia, ja `hazardHit` tarvitsee rajan erottaakseen
     ne. Kenttä lisää ja poistaa omansa hännästä, joten raja pitää. */
  WALLS0 = WALLS.length;
  PADS = (level.pads || []).map(p => Object.assign({ h: 18 }, p, { bx: p.x, by: p.y }));
  served = {};
  for (const p of numbered()) served[p.id] = false;
  gateOpen = false;
  graves = []; squishes = []; leavers = []; bits = []; wreck = null; bounces = 0; hornFx = 0;
  msg = ''; msgT = 0; titleT = 0; goT = 0;
  clearWarnings();
  job = null;
  levelMoney0 = money;
  levelDeaths = 0;
  resetTaxi();
  if (level.init) level.init(api());
  sketch.refresh();                          // muodot ja varoitukset ovat kenttäkohtaisia

  if (carried) {
    /* Edellisestä kentästä mukaan tullut asiakas: kenttä alkaa jättökeikalla
       ja mittari alkaa nollasta, koska välimatka ei ole hänen syytään. */
    const open = numbered().filter(p => !served[p.id]);
    job = {
      from: null, to: pick(open.length ? open : numbered()).id,
      phase: 'aboard', wait: 0, kind: carried.kind, announce: true,
      tipper: (Math.random() * TIPPERS.length) | 0,
      x: 0, t: 0, walk: 0, moving: false, shown: true, flee: null,
    };
    carried = null;
  } else {
    spawnJob(null, 1.2, level.firstFrom);
  }
}

function beginEntry(showTitle) {
  taxi = {
    x: GATE.x + GATE.w / 2, y: -60,
    vx: 0, vy: 300, gear: 0, gearWant: false, landed: null,
    face: -1, spring: 0, upHold: 0, launch: 0,   // nokka vasemmalle, ks. stepTurn
  };
  fuel = FUEL_MAX;
  dead = false; deadT = 0; wreck = null; bounces = 0;
  gateOpen = true;
  enterT = 0; goT = 0;
  clearWarnings();
  titleT = showTitle ? 2.0 : 0;
  state = ENTER;
  sfx.levelStart();
}

function beginLevel(i, showTitle) {
  loadLevel(i);
  beginEntry(showTitle);
  hideCard();
}

function newRun() {
  money = 40; lives = 3; runT = 0;
  bag = []; lastKind = -1;
  cut = null; carried = null; hyper = null;
  runDeaths = 0; runRuns = 0;
  loadLevel(0);
}

/** Taksi aloitusalustalle. Käytetään vain kentän latauksessa — pelaajan taksi
    saapuu aina luukusta. */
function resetTaxi() {
  const p = padById(level.start) || numbered()[0];
  taxi = {
    x: p.x + p.w / 2, y: p.y - (TH / 2 + GEAR),
    vx: 0, vy: 0, gear: 1, gearWant: true, landed: p,
    face: -1, spring: 0, upHold: 0, launch: 0,
  };
  fuel = FUEL_MAX;
  dead = false; deadT = 0; wreck = null; bounces = 0;
}

/* Uusi keikka. Nouto arvotaan vapaasti mille tahansa alustalle paitsi sille
   jolla juuri seistään; määränpää on aina jokin käymätön alusta, ja jos
   sellaista ei ole, asiakas pyytää ylös. */
function spawnJob(avoidId, delay, forceFrom) {
  const pool = numbered().filter(p => p.id !== avoidId);
  const from = forceFrom !== undefined && padById(forceFrom)
    ? forceFrom
    : pick(pool.length ? pool : numbered()).id;
  const open = numbered().filter(p => !served[p.id] && p.id !== from);
  newJob(from, open.length ? pick(open).id : 'up', delay);
}

function newJob(from, to, delay) {
  const p = padById(from);
  const left = p.x + 20, right = p.x + p.w - 20;
  const taken = e =>
    graves.some(g => g.pad === from && Math.abs(g.x - e) < 26) ||
    squishes.some(s => s.pad === from && Math.abs(s.x - e) < 26);
  let x;
  if (taken(left) && !taken(right)) x = right;
  else if (taken(right) && !taken(left)) x = left;
  else x = Math.random() < 0.5 ? left : right;
  job = {
    from, to, phase: 'wait', wait: delay || 0,
    kind: nextAlien(),
    tipper: (Math.random() * TIPPERS.length) | 0,
    x, t: 0, walk: 0, moving: false, shown: false, flee: null,
  };
}

function say(text, secs) { msg = text; msgT = secs || 2.4; }

function burst(x, y, color, n, speed, gravity) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(speed * 0.25, speed);
    bits.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 1, color, r: rand(1.5, 4.5), g: gravity,
    });
  }
}

/* ------------------------------------------------------------------ syöte */
const KEY = Object.create(null);

function toLogical(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left) / r.width * W, y: (clientY - r.top) / r.height * H };
}
const inBox = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
const onButtons = p =>
  (touchBtns && (inBox(p, GEAR_BOX) || inBox(p, HORN_BOX))) || inBox(p, COG_BOX) ||
  (debugAllowed() && inBox(p, TUNE_BOX));

function toggleGear() {
  if (state !== PLAY || dead) return;
  taxi.gearWant = !taxi.gearWant;
  sfx.gear();
}

/* Töötti kuuluu 150 pikselin päähän. Jos odottava asiakas kuulee sen, hän
   säikähtää ja kipittää alustan toiseen laitaan. */
function honk() {
  if (state !== PLAY || dead) return;
  sfx.horn();
  hornFx = 0.55;
  if (!job || job.phase !== 'wait' || !job.shown) return;
  const p = padById(job.from);
  if (!p) return;
  if (Math.hypot(taxi.x - job.x, taxi.y - p.y) > HORN_R) return;
  const mid = p.x + p.w / 2;
  job.flee = job.x < mid ? p.x + p.w - 20 : p.x + 20;
  say(t('msg.coming'), 1.6);
}

function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('spacetaxi.muted', muted ? '1' : '0'); } catch (e) {}
  if (muted && jet) jet.g.gain.value = 0;
  if (muted && SPEAKS) { try { speechSynthesis.cancel(); } catch (e) {} }
  if (!muted) sfx.gear();
}

canvas.addEventListener('pointerdown', e => {
  const p = toLogical(e.clientX, e.clientY);
  /* Luonnoslehtiö omistaa kankaan niin kauan kuin se on auki: sen kahvat ovat
     nappien päällä eikä teline saa napsahtaa siitä että alustaa siirretään.
     Ratas jää auki, koska säätöpaneeli ja editori ovat eri työkalut. */
  /* Luonnostyökalun päältä kuunnellaan vain nurkan kahta kuvaketta: kangas on
     silloin työkalun, mutta asetuksiin ja säätöpaneeliin on päästävä. */
  if (sketch.active && !inBox(p, TUNE_BOX) && !inBox(p, COG_BOX)) return;
  if (touchBtns && inBox(p, GEAR_BOX)) { toggleGear(); return; }
  if (touchBtns && inBox(p, HORN_BOX)) { honk(); return; }
  if (inBox(p, COG_BOX)) { openMenu(); return; }
  /* Kehittäjän liuku on oma kuvakkeensa. Se on myös luonnostyökalun ulospääsy
     säätöpaneeliin, joten se on ainoa jota työkalun päältä kuunnellaan. */
  if (debugAllowed() && inBox(p, TUNE_BOX)) togglePanel();
});

/* Näppäimistöllä pärjää ilman hiirtä: kortin napit ovat omilla näppäimillään,
   töötti molemmissa shifteissä (vasen käsi sauvalla, oikea telineellä). */
addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;
  if (e.repeat) return;
  /* Valikko on päällimmäisenä myös näppäimistölle: peli ei saa ottaa vastaan
     ohjausta sen takaa, ja enter tai esc sulkee. */
  if (menuOpen()) {
    if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      closeMenu();
    }
    return;
  }
  KEY[e.code] = true;

  if (!card.classList.contains('hidden')) {
    const click = sel => {
      const b = card.querySelector(sel);
      if (!b) return false;
      b.click();
      return true;
    };
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      e.preventDefault();
      if (click('#go') || click('#buy')) return;
    }
    if (e.code === 'Digit1' || e.code === 'Numpad1') { if (click('#buy')) return; }
    if (e.code === 'Digit3' || e.code === 'Numpad3') { if (click('#fleet')) return; }
    if (e.code === 'Escape' || e.code === 'KeyL') { if (click('#end')) return; }
  }

  if (e.code === 'KeyM') { toggleMute(); return; }
  if (e.code === 'KeyF') { toggleFullscreen(); return; }
  if (e.code === 'KeyP') { togglePanel(); return; }
  if (e.code === 'KeyK' || e.code === 'Pause') { togglePause(); return; }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyH') { honk(); return; }
  if (e.code === 'Space' || e.code === 'KeyG') { e.preventDefault(); toggleGear(); }
});
addEventListener('keyup', e => { KEY[e.code] = false; });

const stick = createJoystick({
  target: canvas,
  toLocal: toLogical,
  radius: 96,
  /* Editorin auki ollessa sauva ei tartu lainkaan: peli on tauolla, ja veto
     kankaalla tarkoittaa siirtoa tai maalausta. */
  ignore: p => onButtons(p) || sketch.active,
});
stickReady = true;
stick.gain = P.stick;

/* Ohjain. keys: false, koska peli lukee näppäimistön jo itse — plugin lukisi
   sen toiseen kertaan ja teline kääntyisi kahdesti yhdestä välilyönnistä.
   Sauvalle ei anneta gainia: kosketussauvan herkkyyskerroin on siellä siksi
   että peukalon matka on lyhyt, eikä oikea sauva tarvitse sitä.

   Napit ovat eri asioita sen mukaan näkyykö kortti. Kortti ja peli eivät ole
   koskaan yhtä aikaa esillä, joten sama nappi saa olla kummassakin eri asia. */
const gamepad = createGamepad({
  keys: false,
  actions: {
    /* Teline on A ja **kumpi tahansa liipasin**. Molemmat liipasimet yhtä
       aikaa on koko ruutu, ei teline — ks. `padFullscreen`, joka peruu
       telineen jos ele alkoi siitä. Sami 23.9.2026: *"kumpi tahansa
       liipasin voi olla, tai siis molemmat, kunhan eri aikaa."* */
    gear:  ['A', 'LT', 'RT'],
    /* Olkapäät ovat kentänvaihto: vasen aloittaa nykyisen kentän alusta
       kolmella elämällä, oikea siirtyy seuraavaan ja viimeisestä ensimmäiseen.
       Molemmat tekevät saman kuin säätöpaneelin kenttänappi hiirellä. Sami
       23.9.2026. Teline menetti tässä molemmat olkapäänsä — sama painallus ei
       voi olla kaksi asiaa — ja sille jäi A, joka on aina ollut sen oma. */
    restart: ['LB'],
    next:  ['RB'],
    horn:  ['B', 'X'],
    menu:  ['Start'],
    select: ['Back'],
    start: ['Start'],
    fleet: ['Y'],
    quit:  ['B'],
    /* Valikon liikkuminen. Ristiohjain eikä sauva: sauva on jatkuva arvo eikä
       siitä saa reunaa, ja valikossa yksi painallus on yksi askel. */
    pick:  ['A'],
    back:  ['B'],
    up:    ['Up'],
    down:  ['Down'],
    left:  ['Left'],
    right: ['Right'],
  },
});

/* Kerran per ruutu, ennen kuin mitään kysytään: pressed on tämän ja edellisen
   kutsun erotus. Kutsutaan myös korttiruuduissa, jotta vuoron saa käyntiin
   ohjaimella — ja jotta ohjain ylipäätään tulee näkyviin, sillä selain
   paljastaa sen vasta kun jotain on painettu. */
/* Koko ruutu molemmista liipasimista yhtä aikaa: kumpaakaan ei käytetä
   lentämiseen, joten vahingossa sitä ei paina.
 *
 * Selain vaatii kokoruudulle oikean käyttäjän eleen, eikä ohjaimen nappi ole
 * sellainen — ei suoraan eikä silattuna näppäimeksi, koska synteettinen
 * tapahtuma on isTrusted: false. **Ele on kuitenkin voimassa hetken sen
 * jälkeen kun pelaaja on klikannut tai painanut näppäintä**, ja siinä
 * ikkunassa tämä menee läpi. Siksi tämä on tässä: se on pelaajalle ilmainen
 * silloin kun se toimii, eikä tee mitään silloin kun ei.
 *
 * Ulos pääsee aina, koska poistuminen ei vaadi elettä. */
let fullArmed = false;
let trigGearAt = -1e9;                       // milloin teline viimeksi kääntyi liipasimesta
let fullFired = false;                       // koko ruudun ele laukesi tällä ruudulla

function padFullscreen() {
  const both = gamepad.held('LT') && gamepad.held('RT');
  fullFired = both && !fullArmed;
  if (fullFired) {
    toggleFullscreen();
    /* Koko ruudun ele alkaa toisesta liipasimesta, ja se ehti jo kääntää
       telineen — kahden napin eleessä ensimmäistä painallusta ei voi tietää
       eleen aluksi ennen kuin toinen tulee. Perutaan se siis jälkikäteen, jos
       se tapahtui juuri äsken. Äänettä, koska eleen ei kuulu kuulua
       telineeltä. */
    if (state === PLAY && !dead && taxi && performance.now() - trigGearAt < 400) {
      taxi.gearWant = !taxi.gearWant;
    }
  }
  fullArmed = both;
}

function padInput() {
  gamepad.poll();
  padFullscreen();

  if (menuOpen()) { padMenu(); return; }

  if (!card.classList.contains('hidden')) {
    /* Selain ei paljasta ohjainta ennen kuin sen nappia on painettu, joten
       "ei ohjainta" ja "ohjain jota ei ole koskettu" näyttävät täältä samalta
       — siksi teksti on kehotus eikä vikailmoitus. textContent eikä
       innerHTML: id tulee laitteelta, ei meiltä. */
    const el = card.querySelector('#padstate');
    if (el) {
      const want = gamepad.connected ? t('pad.on', { id: gamepad.id }) : t('pad.none');
      if (el.textContent !== want) el.textContent = want;
    }

    const click = sel => {
      const b = card.querySelector(sel);
      if (!b) return false;
      b.click();
      return true;
    };
    padHints();
    if (gamepad.pressed('start') && (click('#go') || click('#buy'))) return;
    if (gamepad.pressed('fleet') && click('#fleet')) return;
    if (gamepad.pressed('quit') && click('#end')) return;
    if (!cardPad && gamepad.pressed('pick') && (click('#go') || click('#buy'))) return;
    padCard();
    return;
  }

  /* Start on yksi toiminto: se pysäyttää ja avaa asetukset, koska valikko
     pysäyttää joka tapauksessa. Poikkeus on **säätöpaneeli auki** — silloin
     ollaan mittaamassa, ja tarve on nopea pysäytys ilman että mitään menee
     valikon alle. Ehto on paneelin tila eikä debug-oikeus: pelin omassa
     osoitteessa debug on tosi kenelle tahansa, jolloin asetukset eivät olisi
     auenneet Startista koskaan. Sami 22.9.2026. */
  if (gamepad.pressed('menu')) {
    if (panelOpen()) togglePause(); else openMenu(true);
    return;
  }
  /* Select avaa säätöpaneelin. Pelaajalla sitä ei ole, joten hänelle sama
     nappi on yhä äänen katkaisu niin kuin ennenkin. */
  if (gamepad.pressed('select')) {
    if (debugAllowed()) togglePanel(); else toggleMute();
    return;
  }
  /* Uusi yritys valitusta kentästä, kolmella elämällä — sama kuin
     säätöpaneelin kenttänappi. Tekijän oikeuksien takana samasta syystä kuin
     se nappikin: pelaajalle kenttä ei ole valittava asia, eikä vuoroa voi
     aloittaa keskeltä uudestaan niin monta kertaa kuin haluaa. */
  if (gamepad.pressed('restart') && debugAllowed()) { startLevel(levelIndex); return; }
  if (gamepad.pressed('next') && debugAllowed()) {
    startLevel((levelIndex + 1) % LEVELS.length);   // viimeisestä ensimmäiseen
    return;
  }
  if (gamepad.pressed('horn')) { honk(); return; }
  /* `fullFired` on tämän ruudun koko ruudun ele: sen laukaissut toinen
     liipasin ei saa kääntää telinettä, ja ensimmäisen kääntö on jo peruttu. */
  if (gamepad.pressed('gear') && !fullFired) {
    /* Liipasimesta tullut painallus merkitään muistiin: siitä voi vielä tulla
       koko ruudun ele, jos toinen liipasin painuu heti perään. */
    if (state === PLAY && !dead && (gamepad.held('LT') || gamepad.held('RT'))) {
      trigGearAt = performance.now();
    }
    toggleGear();
  }
}

/* Kortin napit ohjaimella: sama ele kuin valikossa, suunta liikuttaa ja A
   valitsee. Ennen ensimmäistä liikettä A on yhä "aja" — se on se nappi jota
   kortilla melkein aina halutaan, eikä sitä pidä joutua etsimään. Start, Y ja
   B ovat suoria oikoteitä aina, ja ne lukevat napin sisällä.

   Lista haetaan joka kerta uudestaan, koska kortin napit vaihtuvat ruudusta
   toiseen ja tulostaulun oma nappi ilmestyy vasta kun taulu on latautunut. */
let cardPad = false, cardAt = 0;

const cardButtons = () =>
  [...card.querySelectorAll('button')].filter(b => !b.disabled && b.offsetParent !== null);

function cardMark(btns) {
  for (const b of btns) { b.style.outline = ''; b.style.outlineOffset = ''; }
  const b = btns[cardAt];
  if (!b) return;
  b.style.outline = '2px solid #ffd479';
  b.style.outlineOffset = '2px';
  try { b.focus({ preventScroll: false }); } catch (e) {}
}

function padCard() {
  const btns = cardButtons();
  if (!btns.length) return;
  let moved = false;
  if (gamepad.pressed('up') || gamepad.pressed('left')) { cardAt--; moved = true; }
  if (gamepad.pressed('down') || gamepad.pressed('right')) { cardAt++; moved = true; }
  if (moved) {
    cardPad = true;
    cardAt = (cardAt + btns.length) % btns.length;
    cardMark(btns);
  }
  if (cardPad && gamepad.pressed('pick')) {
    const b = btns[clamp(cardAt, 0, btns.length - 1)];
    if (!b) return;
    b.click();
    /* Asetukset voi aueta kortilta, ja silloin kohdistus jatkuu siellä. */
    if (menuOpen()) { menuPad = true; menuAt.r = 0; menuAt.c = 0; menuFocus(); }
  }
}

/* Napin sisään se ohjaimen nappi jolla sen saa — vain kun ohjain näkyy, koska
   ilman ohjainta kirjain olisi arvoitus. */
const PAD_TAGS = { '#go': 'A', '#buy': 'A', '#fleet': 'Y', '#end': 'B' };

function padHints() {
  if (!gamepad.connected) return;
  for (const sel of Object.keys(PAD_TAGS)) {
    const b = card.querySelector(sel);
    if (!b || b.dataset.padTag) continue;
    b.dataset.padTag = PAD_TAGS[sel];
    b.append(css(el('span', null, PAD_TAGS[sel]), {
      marginLeft: '8px', padding: '1px 7px', borderRadius: '6px',
      border: '1px solid currentColor', opacity: '.6', fontSize: '.78em',
    }));
  }
}

/* Valikko ohjaimella: ristiohjain liikuttaa, A valitsee, B tai Start sulkee.
 *
 * Kohdistus on oikea DOM-fokus eikä oma piirto, jolloin näppäimistö saa saman
 * navigoinnin ilmaiseksi ja selain hoitaa vierityksen. Kehys piirretään vain
 * kun valikkoa on kosketettu ohjaimella: hiirellä avattuna kehys ensimmäisen
 * napin ympärillä näyttäisi siltä että jotain on jo valittu.
 *
 * Koko ruutu on ainoa jota ohjaimesta ei voi tehdä. Selain vaatii siihen
 * oikean käyttäjän eleen, eikä ohjaimen nappi ole sellainen missään
 * selaimessa — mutta valikon nappi kyllä kelpaa, jos sen painaa enterillä,
 * koska näppäimistö on ele. */
function padMenu() {
  if (gamepad.pressed('menu') || gamepad.pressed('back')) { closeMenu(); return; }
  let moved = false;
  const rows = menuGrid.length;
  if (!rows) return;
  if (gamepad.pressed('up')) { menuAt.r = (menuAt.r - 1 + rows) % rows; menuAt.c = 0; moved = true; }
  if (gamepad.pressed('down')) { menuAt.r = (menuAt.r + 1) % rows; menuAt.c = 0; moved = true; }
  if (gamepad.pressed('left')) { menuAt.c--; moved = true; }
  if (gamepad.pressed('right')) { menuAt.c++; moved = true; }
  if (moved) { menuPad = true; menuFocus(); }
  if (gamepad.pressed('pick')) {
    menuPad = true;
    const b = menuGrid[menuAt.r] && menuGrid[menuAt.r][menuAt.c];
    if (b) b.click();
  }
}

function inputVector() {
  const kx = (KEY.ArrowRight || KEY.KeyD ? 1 : 0) - (KEY.ArrowLeft || KEY.KeyA ? 1 : 0);
  const ky = (KEY.ArrowDown || KEY.KeyS ? 1 : 0) - (KEY.ArrowUp || KEY.KeyW ? 1 : 0);
  let v;
  if (kx || ky) {
    const l = Math.hypot(kx, ky) || 1;
    v = { x: kx / l, y: ky / l };
  } else if (gamepad.x || gamepad.y) {
    v = { x: gamepad.x, y: gamepad.y };       // plugin lupaa jo vektorin <= 1
  } else if (stick.active) {
    let x = stick.x * stick.gain, y = stick.y * stick.gain;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    v = { x, y };
  } else v = { x: 0, y: 0 };
  return level.input ? level.input(v, api()) : v;
}

/* Tyhjä tankki ei sammuta suuttimia vaan antaa pätkivää syöttöä: tyhjän tankin
   pelastus, jolla pääsee vielä bensa-asemalle. Niin kauan kuin tankissa on
   jotain, suutin palaa tasaisesti eikä katko mitään — pätkintä alkaa vasta
   mittarin nollasta.

   Neljä säädintä:
     dryOn      kuinka kauan bensaa tulee kerrallaan
     dryOff     kuinka pitkä tauko niiden välissä on
     dryJitter  kummankin päälle arvotaan tämän verran suuntaan tai toiseen,
                joten sykäykset eivät ole metronomi vaan yskähtelevä moottori
     dryLife    kuinka kauan tyhjästä tankista ylipäätään irtoaa mitään; sen
                jälkeen suuttimet ovat kuolleet eikä sivuillekaan jää tehoa

   Se mistä jarruttaminen on kiinni: keskiteho on dryOn/(dryOn+dryOff) kertaa
   täysi työntö, ja paikallaan pysyminen vaatii P.grav. Oletuksilla
   0.3/1.0 * 920 = 276 vastaan 250, eli vauhtia lähtee pois ja laskun voi
   pelastaa. Jos suhde lasketaan alle grav/thrust = 0.27:n, jarruttaminen
   muuttuu mahdottomaksi ja jäljelle jää vain hitaampi putoaminen.

   Alustalta ei pääse lähtöön tälläkään, koska lähtö vaatii bensaa erikseen.
   Pelastus on nimenomaan matka tankkaukselle. */
const DRY_SIDE = 0.5;

/** Yhden vaiheen kesto arvottuna: pohja-arvo ja hajonta sen ympärillä. */
const dryLen = firing =>
  Math.max(0.02, (firing ? P.dryOn : P.dryOff) + rand(-P.dryJitter, P.dryJitter));

/* Vaihetta kuljetetaan kerran ruudussa, koska activeThrust kutsutaan kahdesti
   — piirtoa ja fysiikkaa varten — ja kaksi kertaa etenevä vaihe pätkisi
   tuplasti. */
function stepDry(dt) {
  if (fuel > 0) { dryT = 0; dryPhase = 0; dryFiring = false; return; }
  dryT += dt;
  dryPhase -= dt;
  while (dryPhase <= 0) {
    dryFiring = !dryFiring;
    dryPhase += dryLen(dryFiring);
  }
}

function dryThrust(v) {
  if (dryT > P.dryLife) { v.x = 0; v.y = 0; return; }
  v.x *= DRY_SIDE;
  if (!dryFiring) v.y = 0;
}

function activeThrust() {
  if (state !== PLAY || dead) return { x: 0, y: 0 };
  const v = inputVector();
  /* Teline ulkona sammuttaa sivusuuttimet — paitsi lähtöpompussa. Siinä
     teline on ulkona nimenomaan siksi että se juuri ponnisti, ja ohjaus on
     se mitä lähdössä tarvitaan. Sami 23.9.2026: *"ohjattavuus piti säilyä
     lähtöpompussa vaikka teline on puoliksi ulkona."*

     Lupa raukeaa itsestään kun teline on vetäytynyt rajan alle — siitä
     eteenpäin tavallinen sääntö sanoo saman — eikä sille siksi tarvita
     kelloa. Laskeutumispomppuun tämä ei ulotu: siellä teline on ulkona
     siksi että sillä ollaan laskeutumassa. */
  if (taxi.gear > 0.35 && !taxi.launch) v.x = 0;
  if (taxi.landed) { v.x = 0; if (v.y > 0) v.y = 0; }
  if (fuel <= 0) dryThrust(v);
  return v;
}

/* ------------------------------------------------------------- törmäykset */
function taxiBox(t2) {
  const gl = GEAR * t2.gear;
  return { x: t2.x - TW / 2, y: t2.y - TH / 2, w: TW, h: TH + gl };
}
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function solids() {
  const list = WALLS.slice();
  if (!gateOpen) list.push(gateBar());
  for (const p of PADS) list.push(p);
  return list;
}

/** Kuinka lähellä laskurajaa ollaan: yli 1 hajottaa taksin.

    Alusta annetaan silloin kun kysytään nimenomaan siihen laskeutumisesta.
    Nouseva alusta tulee taksia vastaan, joten törmäysnopeus on taksin vauhti
    plus alustan vauhti — nouseva alusta syö laskeutumisbudjetista. Laskeutuva
    alusta pakenee alaspäin, mutta sitä ei lasketa hyväksi: pakeneva alusta ei
    tee laskusta kovempaa, ja pehmennys olisi ilmainen. Ilman alustaa tämä on
    taksin oma vauhti, niin kuin ennenkin. */
const landRatio = (p) => Math.max(
  (taxi.vy - Math.min(0, (p && p.vy) || 0)) / P.landVY,
  Math.abs(taxi.vx) / P.landVX);

/* Kolari vie taksin ja kyydissä olleen asiakkaan — syytä ei selitetä, romu
   kertoo sen itse. Kaikki muu kentän tilanne jää koskematta. */
function crash() {
  if (dead) return;
  dead = true; deadT = 0;
  lives--;
  levelDeaths++;
  if (job && job.phase === 'aboard') {
    if (job.to === 'up') gateOpen = false;
    if (padById(job.from)) newJob(job.from, job.to, 1.2);
    else spawnJob(null, 1.2);
  }
  msg = ''; msgT = 0;
  wreck = {
    x: taxi.x, y: taxi.y,
    vx: taxi.vx * 0.5 + rand(-60, 60),
    vy: Math.min(taxi.vy * 0.3, 40) - rand(90, 170),
    rot: 0, spin: rand(-5, 5), puff: 0,
  };
  burst(taxi.x, taxi.y, '#ffd479', 8, 220);
  jetLevel(0);
  if (SPEAKS) { try { speechSynthesis.cancel(); } catch (e) {} }
  sfx.crash();
  gamepad.rumble({ duration: 260, strong: 0.85, weak: 0.45 });
}

/* Osuuko kentän liikkuva vaara taksiin juuri nyt?
 *
 * Alustalla istuva taksi ei tarkista törmäyksiä lainkaan — `update` palaa
 * keikka-askeleeseen eikä `move` aja — ja niin kauan kuin alustalla oli
 * turvallista, se oli koko totuus. Tulivuoren magmapallot tekivät siitä
 * kuolemattomuuden: pallo tuli alas, taksi istui alustalla, eikä mitään
 * tapahtunut. Sami 23.9.2026: *"taxi ei saa damagea tulipalloista, sen
 * haluan vain iisille."*
 *
 * Nyt liikkuva vaara osuu myös alustalla istuvaan, paitsi helpolla — siellä
 * alusta on yhä turvapaikka, ja se on helpon oma ero. Kulissiin ja kentän
 * kiinteisiin seiniin tätä ei uloteta: alusta saa olla seinässä kiinni, ja
 * pysyvän seinän sisällä istuva taksi on ollut turvassa aina. Raja on
 * `WALLS0`, eli juuri se mitä kenttä itse työntää WALLSiin. */
function hazardHit() {
  if (dead || diff === 'easy' || !taxi) return false;
  const b = taxiBox(taxi);
  for (let i = WALLS0; i < WALLS.length; i++) if (hit(b, WALLS[i])) return true;
  return false;
}

function touchdown(pad, b) {
  const t2 = taxi;
  const ratio = landRatio(pad);

  /* Kesken ulostulon oleva teline ei ole vatsalasku: alas tuleva teline osuu
     pintaan ensin, ja loppumatkan alusta työntää taksia ylös (`taxi.landed`in
     y lasketaan joka ruutu telineen pituudesta). Kolari on siis vain siitä
     ettei telinettä ole eikä sitä olla laskemassa — nopeusrajat pätevät
     erikseen alla, niin kuin ennenkin.

     **Tämä on sama kaikilla vaikeustasoilla.** Kokeiltiin 23.9.2026 hetken
     ajan helpon omaksi ja palautettiin saman tien: laskeutuminen ei ole se
     paikka josta vaikeus haetaan. Vaikeustasolla eroaa se mitä alustalla
     istuvalle saa tapahtua, ks. `hazardHit`. */
  if (t2.gear < 0.85 && !t2.gearWant) return crash();
  if (b.x < pad.x - 2 || b.x + b.w > pad.x + pad.w + 2) return crash();
  if (ratio > 1) return crash();

  if (ratio > P.bounceFrom) {
    const gl = GEAR * t2.gear;
    const lift = liftFor(ratio, P);
    t2.y = pad.y - (TH / 2 + gl) - lift;
    t2.vy = Math.max(0, t2.vy) * P.bounceKeep;
    t2.vx *= P.bounceKeep;
    bounces = Math.min(bounces + 1, 3);
    sfx.bounce(bounces);
    /* Tärinä on lisä sen päälle mitä peli jo kertoo äänellä ja valolistalla,
       ei ainoa tapa kertoa se: useimmissa ohjaimissa ei ole moottoreita. */
    gamepad.rumble({ duration: 90, strong: 0.18 + bounces * 0.14, weak: 0.1 });
    return;
  }

  t2.y = pad.y - (TH / 2 + GEAR * t2.gear);
  t2.vx = 0; t2.vy = 0; t2.landed = pad; t2.gearWant = true;
  t2.upHold = 0;                            // laskuun asti pidetty ylös ei ole lähtö
  t2.launch = 0;
  t2.offPad = null;
  bounces = 0;
  sfx.land();
  onLanded(pad);
}

/* --------------------------------------------------------- keikkalogiikka */

/* Asiakas kertoo minne haluaa. Sama repliikki noudossa ja kentän alussa, kun
   edellisestä kentästä mukaan tullut asiakas on jo valmiiksi kyydissä. */
function askForPad() {
  if (!job) return;
  job.announce = false;
  const tail = tailFor(job.kind);               // sama kaneetti ruudulle ja ääneen
  say(t('msg.toPad', { n: job.to, tail: t(tail) }), 2.4);
  speakLine('toPad', job.kind, { n: job.to, tail });
  sfx.pickup();
}

/* Keikan maksu: se hetki jona asiakas poistuu taksista.

   Tippi on kiinni vain ajasta. Laskun pehmeys ei kerro sitä alas: kova lasku
   rankaisee jo itsessään, koska pomppu vie sekunteja ja sekunnit tippiä, eikä
   kaksi rangaistusta samasta asiasta houkuta ajamaan lujaa — mitä peli
   nimenomaan hakee. Vajoamisen neljäsosasekunti ei sitä vastoin vie tippiä
   lainkaan: mittari pysähtyy kosketukseen (`jobStep`). */
function payRide(pad) {
  const tip = tipNow();
  const fare = P.fare + tip;
  const kind = job.kind;
  money += fare;
  served[pad.id] = true;                  // jättö merkkaa alustan käydyksi
  say(t('msg.thanks', { fare, tip }), 2.6);
  burst(taxi.x, taxi.y - 20, '#6fe3ff', 16, 160);
  sfx.pay();
  speakLine('thanks', kind);
  leave(pad, kind);
  job = null;
  spawnJob(pad.id, 1.6);
}

/* Asiakas nousee ulos siltä kyljeltä jolla on lyhyempi matka reunalle, ja
   kävelee pois. Se on sama kävely kuin kyytiin tullessa, toisin päin: ilman
   sitä keikka päättyi siihen että asiakas katosi taksin sisään. Lähtöpaikka
   pidetään alustalla, koska kävelijä piirretään alustan pintaan — reunan yli
   mennyt seisoisi tyhjän päällä. */
function leave(pad, kind) {
  /* Kyljistä se jolla on enemmän tilaa: alustan reunaan pysäköity taksi
     jättäisi toiselle puolelle kävelymatkaksi muutaman pikselin, eikä
     poistumista ehtisi nähdä. */
  const room = d => d < 0 ? (taxi.x - TW / 2 - 8) - pad.x : (pad.x + pad.w) - (taxi.x + TW / 2 + 8);
  const dir = room(-1) > room(1) ? -1 : 1;
  const x = clamp(taxi.x + dir * (TW / 2 + 8), pad.x + 6, pad.x + pad.w - 6);
  leavers.push({ pad: pad.id, x, kind, walk: 0, dir, fade: 0 });
}

/* Häivytys lasketaan matkasta reunaan eikä kellosta, jotta kävely ja
   katoaminen ovat sama liike: perillä oleva on jo läpinäkyvä. */
function stepLeavers(dt) {
  for (let i = leavers.length - 1; i >= 0; i--) {
    const lv = leavers[i];
    const p = padById(lv.pad);
    if (!p) { leavers.splice(i, 1); continue; }
    lv.x += lv.dir * LEAVE_WALK * dt;
    lv.walk += dt * 9;
    const gap = lv.dir < 0 ? lv.x - p.x : p.x + p.w - lv.x;
    lv.fade = clamp(1 - gap / LEAVE_FADE, 0, 1);
    if (gap <= 0) leavers.splice(i, 1);
  }
}

function onLanded(pad) {
  if (!job) return;

  if (job.phase === 'aboard' && pad.id === job.to) {
    /* Perillä taksi kyykistyy ensin ja asiakas poistuu vasta pohjalla — Sami
       23.9.2026: *"ensin laskeudutaan alas, sitten asiakas poistuu."* Teline
       vedetään sisään tässä, ja `jobStep` maksaa keikan kun se on sisällä.
       Alhaalla sivusuuttimet ovat heti käytössä (`activeThrust` sammuttaa ne
       vain telineen ollessa ulkona), joten lähtö on helpompi kuin jalkojen
       päältä.

       Odotus on lippu eikä oma vaihe, koska `crash`, `finish` ja tippimittari
       lukevat `phase === 'aboard'` suoraan: vaihe olisi pitänyt muistaa
       kolmessa paikassa, lippu ei missään. */
    job.drop = pad;
    if (diff !== 'pro') taxi.gearWant = false;
    return;
  }

  if (job.phase === 'wait' && pad.id === job.from && job.shown) {
    const b = taxiBox(taxi);
    if (job.x > b.x - 6 && job.x < b.x + b.w + 6) {
      if (graves.length + squishes.length < GRAVE_MAX) {
        squishes.push({ pad: pad.id, x: job.x, kind: job.kind, walk: job.walk, t: 0, rang: false });
      }
      say(t('msg.oops'), 1.8);
      sfx.squish();
      newJob(job.from, job.to, SQ_DUR + 0.4);
    }
  }
}

function jobStep(dt) {
  if (!job) return;
  if (job.phase === 'aboard') {
    /* Perillä oltaessa mittari seisoo ja odotetaan että taksi on pohjassa:
       asiakas poistuu vasta silloin. Teline voi olla matkalla ylös vain jos
       pelaaja itse laski sen takaisin, ja silloin asiakas odottaa — kyykky on
       poistumisen ehto eikä kello. */
    if (job.drop) {
      if (taxi.landed === job.drop && kneeled()) payRide(job.drop);
      return;
    }
    /* Kaasuprofiililla mittari seisoo niin kauan kuin suuttimet ovat päällä. */
    const pr = tipper();
    if (!(pr.onlyIdle && thrustNow > 0.05)) job.t += dt * P[pr.fade];
    return;
  }

  if (job.wait > 0) { job.wait -= dt; return; }
  if (!job.shown) {
    job.shown = true;
    say(t('msg.hey'), 2.2);
    sfx.hey();
    speakLine('hey', job.kind);
  }

  // töötti pani liikkeelle: juoksee laidasta toiseen ennen kyytiin nousua
  if (job.flee !== null) {
    const d = job.flee - job.x;
    job.moving = true;
    job.x += Math.sign(d) * Math.min(Math.abs(d), 150 * dt);
    job.walk += dt * 13;
    if (Math.abs(d) < 2) job.flee = null;
    return;
  }

  job.moving = false;
  const here = !dead && taxi.landed && taxi.landed.id === job.from;

  /* Asiakas on tulossa kyytiin: taksi kyykistyy hänelle kerran. Sen jälkeen
     teline on pelaajan oma asia — pakotus joka ruudulla estäisi nostamasta
     sitä takaisin. Kyykyssä lähtö on helppo, koska sivusuuttimet ovat heti
     käytössä.

     Prolla kyykky jää pelaajalle: se on nimenomaan se mitä helpompi taso
     opettaa tekemällä sen puolesta. Sami 23.9.2026: *"pro tasolla ei ole
     automaattista laskua, vaan pitää itse tehdä, näin voidaan tehdä koska
     normaali taso opettaa miten peli toimii."* */
  if (here && !job.knelt) { job.knelt = true; if (diff !== 'pro') taxi.gearWant = false; }

  /* Kävely ja kyytiin nousu vaativat kyykyn: jaloilleen noussut taksi
     pysäyttää asiakkaan siihen missä hän on, ja matka jatkuu kun taksi
     laskeutuu takaisin. */
  if (here && kneeled()) {
    const b = taxiBox(taxi);
    const target = job.x < taxi.x ? b.x - 10 : b.x + b.w + 10;
    const d = target - job.x;
    if (Math.abs(d) < 3) {
      job.phase = 'aboard'; job.t = 0;
      served[job.from] = true;              // nouto merkkaa alustan käydyksi
      if (job.to === 'up') {
        gateOpen = true;
        say(t('msg.up'), 3);
        speakLine('up', job.kind);
        sfx.gate();
      } else askForPad();
      return;
    }
    job.moving = true;
    job.x += Math.sign(d) * Math.min(Math.abs(d), 95 * dt);
  }
  job.walk += dt * (job.moving ? 9 : 3);
}

/* Yliajo: tyyppi litistyy jalkoihinsa kuin kaatuva pahvikuva, häipyy, ja
   sitten hautakivi nousee maasta. Kivi kirjataan vasta lopuksi. */
function stepSquish(dt) {
  for (let i = squishes.length - 1; i >= 0; i--) {
    const s = squishes[i];
    s.t += dt;
    if (!s.rang && s.t >= SQ_FALL + SQ_WAIT) { s.rang = true; sfx.stone(); }
    if (s.t >= SQ_DUR) {
      graves.push({ pad: s.pad, x: s.x, kind: s.kind });
      squishes.splice(i, 1);
    }
  }
}

/* Asiakkaat eroavat siinä mistä tippi on kiinni. Kolme profiilia:

     tyyni     perustippi, mittari laskee tasaisesti
     kiireinen maksaa lähes kaksinkertaisen tipin mutta mittari laskee yli
               kaksi kertaa nopeammin — pitkä keikka ei kannata
     kaasu     mittari seisoo niin kauan kuin suuttimet ovat päällä, ja lähtee
               laskemaan vasta kun ajaja lopettaa painamisen

   Kertoimet ovat säätimissä (P), koska oikea tuntuma löytyy vain ajamalla. */
const TIPPERS = [
  { mul: 'tipCalm', fade: 'fadeCalm', onlyIdle: false },
  { mul: 'tipRush', fade: 'fadeRush', onlyIdle: false },
  { mul: 'tipHold', fade: 'fadeHold', onlyIdle: true },
];
const tipper = () => TIPPERS[job ? job.tipper : 0] || TIPPERS[0];
const tipMul = () => P[tipper().mul];

/* Kaasuasiakas maksaa bensan. Hänen kyydissään suuttimet eivät kuluta tankkia,
   mikä on se syy pitää kaasu pohjassa: mittari ei laske eikä tankki tyhjene.
   Mittari hehkuu sen merkiksi oman värinsä ja syaanin väliä, jotta tilan
   tunnistaa vilkaisulla. */
const holdRide = () => !!job && job.phase === 'aboard' && tipper().onlyIdle;
const FUEL_HOLD = '#6fe3ff';

/** Kahden hex-värin sekoitus: u = 0 antaa a:n, u = 1 antaa b:n. */
function mixHex(a, b, u) {
  const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
  const ch = sh => Math.round(((na >> sh) & 255) * (1 - u) + ((nb >> sh) & 255) * u);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** Jäljellä oleva tippi, 0…1. */
const tipLeft = () => Math.max(0, 1 - job.t / P.tipTime);

/** Tippi juuri nyt. Yksi kaava, jota sekä kassanäyttö että maksu lukevat:
    mittari lupaa tasan sen mitä perillä maksetaan. */
const tipNow = () => Math.round(P.tip * tipMul() * tipLeft());

const fareNow = () => job && job.phase === 'aboard' ? P.fare + tipNow() : 0;

const targetId = () => {
  if (!job) return null;
  if (job.phase === 'aboard') return job.to;
  return job.shown ? job.from : null;
};

/* dt on tässä siksi, että pystysuunnassa liikkuva alusta ei ole taksille vain
   paikka vaan myös nopeus. Molemmat jäävät alustaan talteen:

     p.dy   paljonko alusta liikkui tällä ruudulla, ylöspäin negatiivinen
     p.vy   sama px/s, samaan suuntaan kuin taksin oma vy

   Näitä tarvitaan kahteen asiaan, ja molemmat olivat väärin niin kauan kuin
   yksikään kenttä ei liikuttanut alustoja pystysuunnassa (ks. move() ja
   landRatio). Vaakaliikkeelle nämä ovat nollia, joten mikään vanha kenttä ei
   muutu. */
function movePads(dt) {
  for (const p of PADS) {
    if (!p.move) continue;
    const m = p.move;
    const a = Math.sin((runT / (m.secs || 4) + (m.phase || 0)) * Math.PI * 2);
    const nx = p.bx + (m.x || 0) * a, ny = p.by + (m.y || 0) * a;
    const dx = nx - p.x, dy = ny - p.y;
    p.x = nx; p.y = ny;
    p.dy = dy; p.vy = dt > 0 ? dy / dt : 0;
    if (taxi.landed === p) { taxi.x += dx; taxi.y += dy; }
    if (job && job.from === p.id && job.phase === 'wait') job.x += dx;
    for (const g of graves) if (g.pad === p.id) g.x += dx;
    for (const s of squishes) if (s.pad === p.id) s.x += dx;
    for (const lv of leavers) if (lv.pad === p.id) lv.x += dx;
  }
}

/* ------------------------------------------------------------ varoitukset
   Kaksi hätää, kaksi eri ääntä ja tahtia:
     bensa   — matala piippaus, tihenee tankin tyhjetessä
     lasku   — korkea, alkaa jo 75 %:ssa laskurajasta ja nousee ja tihenee
               sitä mukaa kun raja lähenee; yli mentäessä tiheintä
   Katseelle saman kertoo alustan valolista, joka vilkkuu punaisen ja sinisen
   väliä pompun rajalta lähtien. */
function clearWarnings() {
  lowWarn = 0; fastWarn = 0;
  padWarn = null; padBlink = 0;
  dryT = 0; dryPhase = 0; dryFiring = false;
}

/* Mille alustalle ollaan tulossa ja liiankos kovaa? Raja on sama mistä pomppu
   alkaa — landRatio yli P.bounceFrom — eli valo syttyy täsmälleen silloin kun
   lasku ei enää menisi siististi. Alusta otetaan mukaan vasta kun se on
   sekunnin pudotuksen päässä, jottei koko kenttä vilku sen takia että jonkin
   alustan yläpuolella sattuu kiitämään. */
function warnPad() {
  if (dead || state !== PLAY || !taxi || taxi.landed || taxi.vy <= 0) return null;
  const b = taxiBox(taxi);
  const reach = Math.max(PAD_WARN_NEAR, taxi.vy * PAD_WARN_LEAD);
  let best = null, bestGap = Infinity;
  for (const p of PADS) {
    if (b.x + b.w <= p.x || b.x >= p.x + p.w) continue;
    const gap = p.y - (b.y + b.h);
    if (gap < 0 || gap > reach || gap >= bestGap) continue;
    /* Raja kysytään alustalta eikä taksilta: nousevaan alustaan lasketaan
       alustan vauhti mukaan, joten hitaastikin tuleva taksi saa valon. */
    if (landRatio(p) <= P.bounceFrom) continue;
    best = p; bestGap = gap;
  }
  return best;
}

/* Tyhjenevä tankki näkyy ulos: viimeisellä neljänneksellä taksi jättää
   savuvanan, harmaana ensin ja mustana lopuksi. Sami 23.9.2026:
   *"ruvetaan jättämään harmaata savuvanaa ku bensa tippuu sinne viimeselle
   20-25% ja ihan mustaa sit lopuks."*

   Mittari kertoo saman luvun tarkemmin, mutta se on ruudun laidassa ja katse
   on taksissa. Savu on siis toinen tapa sanoa sama asia siellä missä pelaaja
   katsoo — ja se näkyy myös siitä miten pitkä vana jää, eli kuinka lujaa on
   menty.

   Kaikki kuusi lukua ovat säätöpaneelissa (`savu`), koska tiheys ja koko ovat
   makuasioita joita ei löydä muuten kuin ajamalla. Savun väri ei ole säädin:
   se on tankin tila, ja juuri se on koko pointti.

   Hiukkanen on tavallinen `bits`-hiutale kolmella lisäkentällä: oma
   haipumisnopeus (`fade`), kasvu (`grow`) ja läpikuultavuus (`a`). Ilman niitä
   savu olisi räjähdyksen sirpale — lyhyt, kutistumaton ja täysin peittävä. */
/** 0xRRGGBB → '#rrggbb', säädintä varten. */
const hexOf = n => '#' + (n & 0xffffff).toString(16).padStart(6, '0');

/** Käyrän arvo kohdassa x = 0…1 (tyhjä…täysi), pisteiden välistä suoraan. */
function curveAt(a, x) {
  const n = a.length - 1;
  const t = clamp(x, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(t));
  return a[i] + (a[i + 1] - a[i]) * (t - i);
}

/** Mistä käyrä alkaa: suurin täyteys jossa arvo on vielä nollaa suurempi.
    Väriliukuma lasketaan siitä, jottei alkupistettä tarvitse kertoa kahdesti
    — käyrä on nyt ainoa paikka joka sanoo missä savu alkaa. */
function curveTop(a) {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] > 0) return i / (a.length - 1);
  return 0;
}

let smokeT = 0;
function stepSmoke(dt, throttle) {
  const full = fuel / FUEL_MAX;
  const rate = curveAt(P.smokeCurve, full);
  if (dead || rate <= 0) { smokeT = 0; return; }

  const top = curveTop(P.smokeCurve);
  const k = top > 0 ? clamp(1 - full / top, 0, 1) : 1;   // 0 alkupisteessä, 1 tyhjänä
  /* Kaasu kertoo määrän, käyrä muodon: sammutetuin suuttimin taksi liitää,
     eikä sammunut moottori savuta täysillä. */
  smokeT += dt * rate * (0.3 + 0.7 * throttle);
  while (smokeT >= 1) {
    smokeT -= 1;
    bits.push({
      x: taxi.x + rand(-9, 9), y: taxi.y + TH / 2 - 3,
      vx: taxi.vx * 0.12 + rand(-9, 9), vy: -P.smokeRise + rand(-7, 7),
      g: 0, life: 1, fade: 1 / Math.max(0.1, P.smokeLife),
      /* Sama `mixHex` kuin bensapalkilla: se puhuu heksaa, joten luvut
         käännetään sille. Toinen sekoitin olisi ollut sama funktio uudestaan. */
      color: mixHex(hexOf(P.smokeC0), hexOf(P.smokeC1), k),
      a: P.smokeA0 + (P.smokeA1 - P.smokeA0) * k,
      r: P.smokeSize * rand(0.7, 1.3), grow: P.smokeGrow,
    });
  }
}

/* Taksi kääntyy sinne minne se menee: `face` on nokan suunta, +1 oikealle.
   Vaihto vaatii vauhtia uuteen suuntaan, ks. turnV. */
function stepTurn() {
  if (taxi.vx > P.turnV) taxi.face = 1;
  else if (taxi.vx < -P.turnV) taxi.face = -1;
}

function warnings(dt) {
  if (fuel < FUEL_LOW && fuel > 0 && !dead) {
    lowWarn -= dt;
    if (lowWarn <= 0) { sfx.warn(); lowWarn = 0.25 + fuel / 45; }
  } else lowWarn = 0;

  /* Alusta ensin, koska sekä piippaus että vilkku kysyvät sen rajaa: lasku
     luetaan siitä alustasta johon ollaan tulossa, joten varoituskin. */
  padWarn = warnPad();
  const r = !dead && taxi && !taxi.landed ? landRatio(padWarn) : 0;
  if (!dead && taxi && !taxi.landed && taxi.gear > 0.5 && r > LAND_WARN_FROM) {
    fastWarn -= dt;
    if (fastWarn <= 0) {
      sfx.fast(r);
      fastWarn = clamp(0.30 - (r - LAND_WARN_FROM) * 0.5, 0.08, 0.30);
    }
  } else fastWarn = 0;

  /* Vilkun tahti kertyy vaiheeseen eikä kellonaikaan, jotta se voi kiihtyä
     kesken pudotuksen ilman että väri hyppää. */
  if (padWarn) {
    const n = bounceNorm(r, P);
    padBlink += (PAD_BLINK_SLOW + (PAD_BLINK_FAST - PAD_BLINK_SLOW) * n) * dt;
  } else padBlink = 0;
}

/* ------------------------------------------------------------ sisääntulo */
function updateEnter(dt) {
  runT += dt;
  enterT += dt;
  if (titleT > 0) titleT -= dt;
  if (hornFx > 0) hornFx -= dt;
  stepBits(dt);
  stepSquish(dt);
  stepLeavers(dt);
  movePads(dt);

  const d = ENTER_Y - taxi.y;
  taxi.vy = clamp(d * 2.6, 0, 300);
  taxi.y += taxi.vy * dt;
  jetLevel(clamp(1 - taxi.vy / 300, 0.15, 1) * 0.5);
  if (taxi.y > 90) gateOpen = false;

  if (d < 3 || enterT > 4) {
    taxi.y = ENTER_Y;
    taxi.vy = 0;
    goT = 0.8;
    state = PLAY;
    sfx.go();
    if (job && job.announce) askForPad();
  }
}

/* ---------------------------------------------------------------- päivitys */
function update(dt) {
  runT += dt;
  if (msgT > 0) msgT -= dt;
  if (titleT > 0) titleT -= dt;
  if (goT > 0) goT -= dt;
  if (hornFx > 0) hornFx -= dt;
  stepBits(dt);
  stepSquish(dt);
  stepLeavers(dt);
  movePads(dt);
  if (level.update) level.update(dt, api());

  if (dead) {
    deadT += dt;
    jetLevel(0);
    clearWarnings();
    if (wreck) {
      wreck.vy += 640 * dt;
      wreck.x += wreck.vx * dt;
      wreck.y += wreck.vy * dt;
      wreck.rot += wreck.spin * dt;
      wreck.puff -= dt;
      if (wreck.puff <= 0) {
        wreck.puff = 0.06;
        bits.push({
          x: wreck.x + rand(-10, 10), y: wreck.y + rand(-8, 8),
          vx: rand(-20, 20), vy: rand(-30, -10),
          life: 1, color: '#5a6480', r: rand(3, 6), g: -20,
        });
      }
    }
    const gone = wreck && wreck.y > H + 160;
    if (gone || deadT > 3.2) {
      if (lives <= 0) return taxiLost();
      beginEntry(false);                     // korvaava taksi tulee luukusta
    }
    return;
  }

  stepTurn();
  const gearWas = taxi.gear;
  /* Ponnistuksessa jalat aukeavat nopeammin kuin tavallisesti; kun ne ovat
     auki, ponnistus on ohi ja sama liike jatkuu sisäänpäin tavallisella
     vauhdilla. */
  const gearRate = GEAR_RATE * (taxi.spring ? P.hopRate : 1);
  taxi.gear += clamp((taxi.gearWant ? 1 : 0) - taxi.gear, -dt * gearRate, dt * gearRate);
  if (taxi.spring && taxi.gear >= 1) { taxi.spring = 0; taxi.gearWant = false; }
  /* Lähdön ohjauslupa raukeaa kun jalat ovat **matkalla sisään** ja rajan
     alla — siitä eteenpäin tavallinen sääntö sanoo saman. Ponnistuksen aikana
     (`spring`) se ei saa raueta, koska silloin jalat ovat vasta menossa ulos
     ja kulkevat rajan läpi väärään suuntaan. */
  if (taxi.launch && !taxi.spring && taxi.gear <= 0.35) taxi.launch = 0;
  if (taxi.landed) taxi.y = taxi.landed.y - (TH / 2 + GEAR * taxi.gear);
  else { if (taxi.gear > gearWas) gearPush(gearWas); carryOff(dt); }

  warnings(dt);                              // piippaukset myös alustalla

  stepDry(dt);
  const v = activeThrust();
  thrustNow = Math.min(1, Math.hypot(v.x, v.y));   // kaasuprofiili kysyy tätä
  const raw = inputVector();

  if (taxi.landed) {
    jetLevel(0);
    if (hazardHit()) { crash(); return; }
    if (taxi.landed.fuel) refuel(dt);
    /* Tankilla kuolee myös: tyhjä tankki ja tyhjä kassa ei ratkea istumalla,
       joten peli päättää sen itse niin kuin millä tahansa muulla alustalla. */
    if (fuel <= 0.5 && (!taxi.landed.fuel || !canBuyFuel())) { crash(); return; }
    const wantsUp = raw.y < -0.2 && fuel > 0;
    if (wantsUp && ++taxi.upHold >= LEAVE_HOLD) leavePad();
    else {
      if (!wantsUp) taxi.upHold = 0;
      /* Tikku alas laskee taksin maahan, ylös nostaa ilmaan: sama liike
         molempiin suuntiin, eikä telinenappia tarvitse muistaa. Sami
         23.9.2026: *"sekin on intuitiivinen liike."* Ylös nostaminen on yhä
         telinenapin takana, koska ylös on jo varattu lähdölle. */
      if (raw.y > 0.35) taxi.gearWant = false;
      jobStep(dt);
      return;
    }
  }

  const throttle = Math.min(1, Math.hypot(v.x, v.y));

  /* Kulutus suuttimen mukaan: **alasuuttimista menee kaksinkertaisesti**
     sivuihin ja kattoon nähden. Sami 23.9.2026. Ne ovat ne isot, ja ne
     kannattelevat koko taksia; sivusuuttimet ovat nokare sen rinnalla.

     Suhde tehdään halventamalla sivuja eikä kallistamalla nostoa
     (`sideBurn` 0,5), koska `burn` on se luku josta kenttien bensabudjetti
     on laskettu: leijunta maksaa grav/thrust × burn, ja jos nosto
     kaksinkertaistuisi, jokaisen kentän tankki puolittuisi kerralla. Nyt
     leijunta maksaa täsmälleen saman kuin ennen ja sivuttainen on halvempaa.
     Ks. README, "Bensabudjetti". */
  const lift = Math.max(0, -v.y);                        // alasuuttimet
  const side = Math.min(1, Math.hypot(v.x, Math.max(0, v.y)));
  const burnRate = Math.min(1, lift + side * P.sideBurn);
  if (burnRate > 0 && !holdRide()) {
    const had = fuel;
    fuel = Math.max(0, fuel - P.burn * burnRate * dt);
    if (had > 0 && fuel <= 0) say(t('msg.dry'), 3);
  }
  jetLevel(throttle);
  stepSmoke(dt, throttle);

  taxi.vx += v.x * P.thrust * dt;
  taxi.vy += v.y * P.thrust * dt + P.grav * dt;

  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(taxi.vx), Math.abs(taxi.vy)) * dt / 4));
  const sd = dt / steps;
  for (let i = 0; i < steps && !dead && state === PLAY; i++) move(sd);

  if (!dead && state === PLAY) jobStep(dt);
}

function move(dt) {
  const before = taxiBox(taxi);
  const prevBottom = before.y + before.h;
  taxi.x += taxi.vx * dt;
  taxi.y += taxi.vy * dt;
  const b = taxiBox(taxi);

  if (gateOpen && b.y + b.h < 0) return finish();

  if (taxi.vy >= 0) {
    for (const p of PADS) {
      /* Alustan yläreuna ruudun alussa, ei sen jälkeen kun movePads on jo
         nostanut sitä: nouseva alusta ehtii muuten yhden ruudun aikana nousta
         taksin alareunan ohi, jolloin lasku jää lukematta ja alusta lasketaan
         seinäksi. Se näkyisi satunnaisena kolarina alustaan joka oli tulossa
         vastaan. Paikallaan olevalla ja vaakaan liikkuvalla dy on nolla, eli
         ehto on sama kuin ennen. */
      const top = p.y - (p.dy || 0);
      if (b.x + b.w > p.x && b.x < p.x + p.w && b.y + b.h > p.y && prevBottom <= top + 1) {
        return touchdown(p, b);
      }
    }
  }
  for (const r of solids()) if (r !== taxi.offPad && hit(b, r)) return crash();
}

/* Irtoaminen alustasta: sama nykäisy kuin pompussa.
 *
 * Taksi nostetaan P.bounceLift verran irti pinnasta samalla hetkellä kun se
 * lähtee. Pompussa se on ollut alusta asti, ja siellä syy on sama: kosketuksen
 * jälkeen ei saa jäädä pintaan kiinni. Lähtö oli ainoa paikka jossa sitä ei
 * tehty, ja se näkyi kuolemina kaikissa kentissä — alustan reunalta nouseva
 * taksi raapaisi alustaa, ja alusta on kiinteä. Sama nuppi säätää molemmat,
 * koska kyse on samasta asiasta.
 *
 * Liikkuvalla alustalla tämä ei yksin riitä: 10 px on nousevalta alustalta
 * reilu kymmenesosa sekuntia. Siksi carryOff sen lisäksi. */
function leavePad() {
  const p = taxi.landed;
  /* Kesken vajoamisen lähtevä vie asiakkaan mukanaan: keikka jää kyytiin ja
     maksetaan seuraavalla laskulla samalle alustalle. Ilman tätä odotuslippu
     jäisi päälle ilmaan, jossa `taxi.landed` ei ole enää mikään. */
  if (job && job.drop) job.drop = null;
  taxi.landed = null;
  taxi.offPad = p;
  taxi.offT = PAD_LEAVE;
  /* Nosto vain jos se mahtuu. Alusta voi olla matalan katon alla — Moonshotin
     lohkoissa ja Highrisen ylärivissä on sellaisia — ja tarkistamaton nosto
     työntäisi taksin seinän sisään juuri silloin kun pelaaja teki kaiken
     oikein. Jätetty alusta ei ole este, se on se josta juuri noustiin. */
  /* Ponnistus: teline suoristuu ja työntää taksin irti pinnasta, ja vetäytyy
     heti perään sisään. Sami 23.9.2026: *"ylös lähtiessä telineet pompauttaa
     meidät ylös ja sitten vetäytyy heti takasin ja ohjattavuus on jo heti
     käytössä."*

     **Ponnistus on animaatio eikä hyppäys.** Ensimmäinen versio suoristi jalat
     yhdessä ruudussa, ja Sami: *"liian nopea, pitää mennä useampi frame kun
     jalat aukeaa, ihan se perusanimaatio vauhti riittää tai ... mx 2x."*
     Nyt jalat suoristuvat telineen omalla vauhdilla kerrottuna `hopRate`llä,
     ja koska suoja juuri jätettyyn alustaan on vielä voimassa (`carryOff`),
     ne työntävät taksia edellään samalla kun ne aukeavat.

     **Lähtövauhti on jalkojen suoristumisvauhti**, ei oma lukunsa: 14 px
     jaettuna suoristumisajalla. Kaksi erillistä säädintä olisi kaksi lukua
     jotka pitää muistaa pitää samassa mielessä, ja väärässä suhteessa taksi
     joko karkaa jaloiltaan tai jää roikkumaan niiden varaan. Yksi säädin, ja
     0 ottaa ponnistuksen kokonaan pois.

     Nosto ja vauhti tarkistetaan törmäyksiltä: alusta voi olla matalan katon
     alla (Moonshotin lohkot, Highrisen ylärivi), eikä peli saa heittää taksia
     kattoon omasta aloitteestaan. Siellä nousu jää pelaajan oman kaasun
     varaan. Jätetty alusta ei ole este, se on se josta juuri noustiin. */
  const y0 = taxi.y, gear0 = taxi.gear;
  const fits = () => {
    const b = taxiBox(taxi);
    for (const r of solids()) if (r !== p && hit(b, r)) return false;
    return true;
  };

  taxi.y = y0 - P.bounceLift;
  if (!fits()) taxi.y = y0;

  if (P.hopRate > 0) {
    /* Jalat suoristuvat vaikka tilaa olisi vain sen verran: se palauttaa
       taksin seisomakorkeuteen, joka on varmasti mahtunut — sieltä on
       laskeuduttu — ja jättää telineen ulos siltä varalta että taksi vajoaa
       takaisin. */
    taxi.spring = 1;
    taxi.gearWant = true;                    // jalat auki, ja sen jälkeen heti kiinni
    taxi.launch = 1;                         // ja ohjaus auki koko sen ajan

    /* Vauhti sen sijaan vain jos koko ponnistus mahtuu: nosto ja se matka
       jonka jalat vielä suoristuvat. Se on se osa joka veisi kattoon, eikä
       peli saa heittää taksia sinne omasta aloitteestaan. Mitataan siltä
       paikalta jossa taksi ponnistuksen päätteeksi olisi. */
    const yNow = taxi.y;
    taxi.y = y0 - P.bounceLift - GEAR * (1 - gear0);
    taxi.gear = 1;
    const hopRoom = fits();
    taxi.y = yNow; taxi.gear = gear0;

    const v = GEAR * GEAR_RATE * P.hopRate;  // px/s, eli juuri jalkojen vauhti
    if (hopRoom && taxi.vy > -v) taxi.vy = -v;
  }
}

/* Alas tuleva teline työntää taksia, ei taksia pintaan.
 *
 * Teline kasvaa neljäsosasekunnissa neljätoista pikseliä alaspäin, ja se on
 * osa taksin törmäyslaatikkoa. Pinnan lähellä laskettu teline kasvoi siis
 * suoraan alustan tai lattian sisään, ja koska kosketus tuli laatikon
 * kasvamisesta eikä taksin liikkeestä, `move` ei lukenut sitä laskuksi vaan
 * seinäksi: teline tappoi pelaajan juuri silloin kun hän valmistautui laskuun.
 *
 * Oikein päin ajateltuna teline osuu maahan ensin ja maa työntää sen takaisin
 * — eli taksia ylös. Siksi tämä siirtää taksin sen verran ylös kuin teline
 * upposi, jolloin jalat jäävät pinnalle ja `move` lukee seuraavan ruudun
 * laskuna tavallisine nopeusrajoineen. Nopeus ei muutu tässä: liian kovaa
 * tuleva kuolee yhä, teline ei vain ole enää syy.
 *
 * Kaksi rajausta:
 *   - Vain ylhäältä tullut kosketus. Jos taksi oli jo pinnan tasalla ennen
 *     telineen kasvua, kyse on törmäyksestä jonka `move` hoitaa, eikä sitä
 *     saa peruuttaa hyppäämällä taksi seinän päälle.
 *   - Nosto vain jos se mahtuu, samasta syystä kuin `leavePad`issa. Jos ylhäällä
 *     on katto, teline jää sen sijaan siihen mihin se ehti: ahtaassa paikassa
 *     maa pitää telineen sisällä, eikä mitään työnnetä seinään. */
function gearPush(gearWas) {
  const b = taxiBox(taxi);
  const foot = b.y + b.h;
  const prevFoot = foot - GEAR * (taxi.gear - gearWas);
  let lift = 0;
  for (const r of solids()) {
    if (r === taxi.offPad) continue;
    if (b.x + b.w <= r.x || b.x >= r.x + r.w) continue;
    /* Alustan yläreuna ruudun alussa, samasta syystä kuin `move`ssa: nousevan
       alustan pitää kelvata vaikka se ehti jo taksin jalkojen ohi. */
    if (prevFoot > (r.y - (r.dy || 0)) + 1) continue;
    if (foot <= r.y) continue;
    lift = Math.max(lift, foot - r.y);
  }
  if (lift <= 0) return;

  const y0 = taxi.y;
  taxi.y -= lift;
  const nb = taxiBox(taxi);
  for (const r of solids()) {
    if (r !== taxi.offPad && hit(nb, r)) { taxi.y = y0; taxi.gear = gearWas; return; }
  }
}

/* Juuri jätetty alusta kannattelee taksia, se ei tapa sitä.
 *
 * Nouseva alusta on lähtöhetkellä nopeampi kuin vasta kiihtyvä taksi, ja
 * alustat ovat kiinteitä: ilman tätä lähtö ylöspäin menevältä alustalta oli
 * varma kuolema, koska ylöspäin liikkuva taksi ei voi "laskeutua" mihinkään
 * eikä kosketus ole silloin mitään muuta kuin seinä. Nyt alusta työntää taksia
 * edellään, niin kuin lattia työntää: taksi pysyy pinnalla kunnes se kiihtyy
 * alustaa nopeammaksi, ja sen jälkeen suoja raukeaa itsestään.
 *
 * Suoja koskee vain sitä yhtä alustaa jolta juuri lähdettiin, joten muu kenttä
 * tappaa niin kuin ennenkin. PAD_LEAVE on vähimmäisaika; kosketuksen ajan suoja
 * on voimassa senkin jälkeen, eli pinnalla leijuminen on sama asia kuin sillä
 * seisominen. Alustan alle jäänyt taksi menettää suojan heti: sinne pääsee vain
 * lentämällä, ja ylhäältä tuleva alusta on oikeasti este. */
function carryOff(dt) {
  const p = taxi.offPad;
  if (!p) return;
  taxi.offT -= dt;
  const b = taxiBox(taxi), foot = b.y + b.h;
  const under = foot > p.y + p.h + 4;                  // taksi on jo alustan alla
  const over = !under && b.x + b.w > p.x && b.x < p.x + p.w;
  /* Lähellä pintaa suoja ei raukea vaikka aika loppuisi: muuten se voisi
     loppua juuri sillä ruudulla jolla alusta koskettaa, ja seuraava ruutu
     olisi kolari. Aika ratkaisee vasta kun taksi on irronnut pinnasta. */
  const near = over && foot > p.y - PAD_LEAVE_GAP;
  if (near && foot > p.y) {
    taxi.y = p.y - (TH / 2 + GEAR * taxi.gear);
    if (taxi.vy > (p.vy || 0)) taxi.vy = p.vy || 0;
  }
  if (under || (taxi.offT <= 0 && !near)) taxi.offPad = null;
}

/** Saako tankista vielä bensaa? Ilmainen bensa ei koskaan lopu kassan takia. */
const canBuyFuel = () => P.price <= 0 || money > 0.01;

function refuel(dt) {
  if (fuel >= FUEL_MAX || money <= 0) return;
  const want = Math.min(P.refuel * dt, FUEL_MAX - fuel, money / P.price);
  if (want <= 0) return;
  fuel += want;
  money -= want * P.price;
  if (Math.random() < dt * 12) sfx.pump();
}

/* Ulos luukusta. Jos kenttiä on vielä jäljellä, kyydissä oleva asiakas jatkaa
   matkaa seuraavaan kenttään ja maksaa vasta siellä perillä. */
function finish() {
  const nextIndex = levelIndex < LEVELS.length - 1 ? levelIndex + 1 : null;
  let paid = P.exitBonus;
  if (job && job.phase === 'aboard') {
    if (nextIndex === null) {
      paid += P.fare + tipNow();
      speakLine('thanks', job.kind);
    } else {
      carried = { kind: job.kind };
    }
    job = null;
  }
  money += paid;
  jetLevel(0);
  startCut(nextIndex);
}

function taxiLost() {
  jetLevel(0);
  if (money >= TAXI_PRICE) {
    state = BUY;
    showCard(buyCard(), 0, null);
  } else gameOver(false);
}

/* Ostetut taksit jatkavat samaa kenttää: käydyt alustat, hautakivet ja
   odottava asiakas säilyvät, uusi auto vain tulee sisään katon luukusta. */
function buyTaxis(count, price) {
  money -= price;
  lives = count;
  sfx.buy();
  beginEntry(false);
  hideCard();
}

/* Vuoro päättyy. Ensin pelkkä tausta — suoritetusta vuorosta hyperavaruus,
   loppuneista takseista valuvat tähdet — ja vasta parin sekunnin päästä kortti
   häivähtää päälle. */
function gameOver(won) {
  state = OVER;
  jetLevel(0);
  money = Math.round(money);
  hyper = createHyperspace({ W, H, rand, mode: won ? 'warp' : 'drift' });
  if (won) sfx.warp(); else sfx.fade();
  hideCard();

  const html = won ? overWon() : overLost();
  const pending = money;
  const meta = { cleared: won, seconds: runT, level: levelIndex + 1 };
  clearTimeout(endTimer);
  endTimer = setTimeout(() => {
    if (state === OVER) showCard(html, pending, meta, true);
  }, END_CARD_DELAY);
}

function stepBits(dt) {
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.vy += (b.g === undefined ? 200 : b.g) * dt;
    b.vx *= Math.pow(0.15, dt);
    if (b.grow) b.r += b.grow * dt;
    b.life -= dt * (b.fade === undefined ? 1.3 : b.fade);
    if (b.life <= 0) bits.splice(i, 1);
  }
}

/* Kentän tilinpäätös ja välianimaatio. nextIndex === null tarkoittaa vuoron
   viimeistä ruutua: pelkkä nousu, koko vuoron luvut, ja sen jälkeen kortti. */
function startCut(nextIndex) {
  const earned = Math.round(money - levelMoney0);
  const runs = graves.length + squishes.length;
  const cleanDrive = levelDeaths === 0, cleanPads = runs === 0;
  const bonus = (cleanDrive ? CLEAN_BONUS : 0) + (cleanPads ? CLEAN_BONUS : 0);
  money += bonus;
  runDeaths += levelDeaths;
  runRuns += runs;

  const last = nextIndex === null;
  const nxt = last ? level : LEVELS[nextIndex];

  const stats = last ? [
    { text: t('cut.shift'), head: true },
    { text: t('cut.levels', { n: LEVELS.length }) },
    { text: t('cut.time', { n: Math.round(runT) }) },
    {
      icon: 'wreck', good: runDeaths === 0,
      text: t(runDeaths === 0 ? 'cut.crashesClean' : 'cut.crashes', { n: runDeaths, b: CLEAN_BONUS }),
    },
    {
      icon: 'grave', good: runRuns === 0,
      text: t(runRuns === 0 ? 'cut.runsClean' : 'cut.runs', { n: runRuns, b: CLEAN_BONUS }),
    },
    { text: t('cut.cash', { n: Math.round(money) }) },
  ] : [
    { text: t('cut.clear', { name: level.name.toUpperCase() }), head: true },
    { text: t('cut.pads', { n: numbered().length }) },
    { text: t('cut.earned', { n: earned }) },
    {
      icon: 'wreck', good: cleanDrive,
      text: t(cleanDrive ? 'cut.crashesClean' : 'cut.crashes', { n: levelDeaths, b: CLEAN_BONUS }),
    },
    {
      icon: 'grave', good: cleanPads,
      text: t(cleanPads ? 'cut.runsClean' : 'cut.runs', { n: runs, b: CLEAN_BONUS }),
    },
    { text: t('cut.cash', { n: Math.round(money) }) },
  ];

  cut = createCut({
    W, H, TW, TH, rand,
    upSecs: last ? 3.6 : 3,
    downSecs: last ? 0 : 2.4,
    fromGlow: level.glow || '#6fe3ff',
    toGlow: nxt.glow || '#6fe3ff',
    name: nxt.name,
    label: t('cut.level', { i: (nextIndex || 0) + 1, t: LEVELS.length }),
    stats,
    body: () => taxiShape(TW, TH, false),
  });
  cut.idx = nextIndex;
  state = CUT;
  if (last) sfx.win();
  else {
    sfx.cutscene();
    if (bonus) sfx.bonus();
  }
}

/* ------------------------------------------------------------------ piirto */
function drawWall(r) {
  /* Kenttä saa piirtää seinänsä itse (hide). Sitä tarvitsee kenttä jonka
     seinä ei ole laatikon näköinen — Shooting Starsissa kuusen latvus ja
     putoava tähti ovat molemmat seiniä, ja kumpikin piirretään kentässä
     täsmälleen sen laatikon muotoisena joka on myös törmäys. Sääntö on yhä
     se, että umpinaiselta näyttävä on umpinaista: hide siirtää piirron, ei
     poista sitä. */
  if (r.hide) return;
  ctx.fillStyle = '#1b2440';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(120,160,255,.22)';
  ctx.fillRect(r.x, r.y, r.w, 2);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(r.x, r.y + r.h - 2, r.w, 2);

  if (!r.win) return;
  for (let y = r.y + 22, row = 0; y < r.y + r.h - 18; y += 38, row++) {
    for (let x = r.x + 14, colN = 0; x < r.x + r.w - 20; x += 34, colN++) {
      const lit = ((row * 7 + colN * 13 + r.x) % 5) < 2;
      ctx.fillStyle = lit ? 'rgba(255,212,121,.30)' : 'rgba(120,160,255,.09)';
      ctx.fillRect(x, y, 18, 22);
    }
  }
}

/* Käyty alusta on aina vihreä pallo väkäsineen — sama merkki riippumatta
   siitä onko alusta juuri nyt kohde vai ei. */
function drawPad(p) {
  const isTarget = !p.fuel && p.id === targetId();
  const done = !p.fuel && served[p.id];
  const col = p.fuel ? '#ffd479' : (isTarget ? '#6fe3ff' : '#ff5d7a');
  /* Liian kovaa tulossa: valolista vilkkuu, tunnus alla pysyy omanvärisenä. */
  const warn = state === PLAY && p === padWarn;
  const lamp = warn ? (padBlink % 1 < 0.5 ? PAD_WARN_HOT : PAD_WARN_COLD) : col;

  ctx.fillStyle = p.fuel ? '#3a3320' : (isTarget ? '#20394a' : '#3a2230');
  ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, 4); ctx.fill();

  ctx.fillStyle = lamp;
  ctx.shadowColor = lamp; ctx.shadowBlur = warn ? 26 : (isTarget ? 22 : 12);
  ctx.fillRect(p.x + 6, p.y, p.w - 12, 3);
  ctx.shadowBlur = 0;

  /* Kaksi jalkaa alustan alla, oletuksena pois. Kenttä pyytää ne erikseen
     (padLegs: true), koska ne näyttävät hyvältä vain silloin kun niiden alla
     on jotain mihin alusta on pultattu — huvipuistossa laitteet, jolloin
     alusta on niiden katolla. Muualla ne roikkuvat tyhjässä, ja kahdessa
     kentässä ne jäävät muutenkin kulissien peittoon. */
  if (level.padLegs) {
    ctx.fillStyle = 'rgba(30,40,70,.85)';
    ctx.fillRect(p.x + 12, p.y + p.h, 8, 14);
    ctx.fillRect(p.x + p.w - 20, p.y + p.h, 8, 14);
  }

  const bx = p.x + p.w / 2, by = p.y + p.h + 22;
  ctx.textAlign = 'center';

  if (done) {
    ctx.fillStyle = '#7bf0a0';
    ctx.shadowColor = '#7bf0a0'; ctx.shadowBlur = isTarget ? 18 : 10;
    ctx.beginPath(); ctx.arc(bx, by, 12, 0, 6.3); ctx.fill();
    ctx.shadowBlur = 0;
    if (isTarget) {
      ctx.strokeStyle = '#6fe3ff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(bx, by, 15, 0, 6.3); ctx.stroke();
    }
    ctx.strokeStyle = '#08111e'; ctx.lineWidth = 3;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx - 5.5, by);
    ctx.lineTo(bx - 1.5, by + 4.5);
    ctx.lineTo(bx + 5.5, by - 4.5);
    ctx.stroke();
    return;
  }

  ctx.beginPath(); ctx.arc(bx, by, 13, 0, 6.3);
  ctx.fillStyle = 'rgba(8,13,30,.75)'; ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = isTarget ? 2.5 : 1.6; ctx.stroke();
  ctx.fillStyle = col;
  if (p.fuel) {
    ctx.beginPath();
    ctx.moveTo(bx, by - 7);
    ctx.quadraticCurveTo(bx + 6, by + 1, bx, by + 6);
    ctx.quadraticCurveTo(bx - 6, by + 1, bx, by - 7);
    ctx.fill();
  } else {
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(String(p.id), bx, by + 5);
  }
}

function drawGate() {
  if (!gateOpen) {
    drawWall(gateBar());
    ctx.fillStyle = 'rgba(255,93,122,.5)';
    for (let x = GATE.x + 6; x < GATE.x + GATE.w - 6; x += 18) ctx.fillRect(x, 3, 8, 10);
    return;
  }
  drawGateGlow(ctx, GATE, CEIL, level.glow || '#6fe3ff', runT);
}

/* ------------------------------------------------------------------ alienit */
const ALIENS = [
  { c: '#7bf0a0', shape: 'blob', eyes: 1, arms: 2, legs: 2, ant: 0 },
  { c: '#c79bff', shape: 'tall', eyes: 3, arms: 2, legs: 2, ant: 2 },
  { c: '#ff9ae0', shape: 'dome', eyes: 2, arms: 2, legs: 4, ant: 0 },
  { c: '#6fe3ff', shape: 'squat', eyes: 2, arms: 4, legs: 2, ant: 1 },
  { c: '#ffb020', shape: 'bug', eyes: 4, arms: 2, legs: 2, ant: 2 },
];

function drawAlien(kind, x, groundY, phase, walking, waving, alpha) {
  const A = ALIENS[kind % ALIENS.length];
  const bob = (walking ? Math.abs(Math.sin(phase)) * 2 : Math.sin(phase * 0.8) * 1);
  ctx.save();
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  ctx.translate(x, groundY - bob);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = A.c; ctx.fillStyle = A.c;

  const hip = -12;
  const h = A.shape === 'tall' ? 24 : A.shape === 'squat' ? 13 : 17;
  const w = A.shape === 'tall' ? 11 : A.shape === 'squat' ? 20 : 15;
  const cy = hip - h / 2;
  const top = cy - h / 2;

  ctx.lineWidth = 2.6;
  for (let i = 0; i < A.legs; i++) {
    const base = A.legs === 2 ? (i ? 5 : -5) : (i - (A.legs - 1) / 2) * 4.5;
    const sw = walking ? Math.sin(phase + i * Math.PI) * 5 : 0;
    ctx.beginPath();
    ctx.moveTo(base * 0.5, hip);
    ctx.lineTo(base + sw, bob);
    ctx.stroke();
  }

  ctx.beginPath();
  if (A.shape === 'dome') {
    ctx.moveTo(-w / 2, hip);
    ctx.lineTo(-w / 2, cy);
    ctx.arc(0, cy, w / 2, Math.PI, 0);
    ctx.lineTo(w / 2, hip);
    ctx.closePath();
  } else if (A.shape === 'bug' || A.shape === 'blob') {
    ctx.ellipse(0, cy, w / 2, h / 2, 0, 0, 6.3);
  } else {
    ctx.roundRect(-w / 2, top, w, h, w / 2.6);
  }
  ctx.fill();

  ctx.lineWidth = 2.3;
  for (let i = 0; i < A.arms; i++) {
    const side = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    const sx = side * w / 2 * 0.85, sy = top + 5 + row * 6;
    let ex = sx + side * 9, ey = sy + 7;
    if (waving && side === 1 && row === 0) {
      const a = -1.15 + Math.sin(phase * 2.6) * 0.45;
      ex = sx + Math.cos(a) * 11; ey = sy + Math.sin(a) * 11;
    } else if (walking) {
      ey = sy + 7 + Math.sin(phase + (side > 0 ? Math.PI : 0)) * 3.5;
    }
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  }

  ctx.lineWidth = 1.8;
  for (let i = 0; i < A.ant; i++) {
    const side = A.ant === 1 ? 0 : (i ? 1 : -1);
    const tipx = side * 6 + Math.sin(phase * 1.5 + i) * 1.5, tipy = top - 10;
    ctx.beginPath();
    ctx.moveTo(side * 3, top + 1);
    ctx.quadraticCurveTo(side * 6, top - 6, tipx, tipy);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(tipx, tipy, 2, 0, 6.3); ctx.fill();
  }

  const n = A.eyes, r = n === 1 ? 5.5 : n < 4 ? 2.8 : 2.2;
  const gap = n === 1 ? 0 : (n === 3 ? 5.5 : n === 4 ? 4.6 : 6);
  const ey0 = A.shape === 'tall' ? top + 7 : cy - 1;
  for (let i = 0; i < n; i++) {
    const ex = (i - (n - 1) / 2) * gap;
    ctx.fillStyle = '#0b1020';
    ctx.beginPath(); ctx.arc(ex, ey0, r, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(ex + r * 0.25, ey0 - r * 0.25, r * 0.4, 0, 6.3); ctx.fill();
  }

  ctx.restore();
}

function drawGraveAt(x, y, kind) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#6b7488';
  ctx.beginPath();
  ctx.moveTo(-9, 0);
  ctx.lineTo(-9, -11);
  ctx.arc(0, -11, 9, Math.PI, 0);
  ctx.lineTo(9, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(57,64,81,.85)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -17); ctx.lineTo(0, -6);
  ctx.moveTo(-4.5, -13); ctx.lineTo(4.5, -13);
  ctx.stroke();
  ctx.fillStyle = ALIENS[kind % ALIENS.length].c;
  ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.arc(11, -3, 2.6, 0, 6.3); ctx.fill();
  ctx.restore();
}

function drawGrave(g) {
  const p = padById(g.pad);
  if (p) drawGraveAt(g.x, p.y, g.kind);
}

function drawSquish(s) {
  const p = padById(s.pad);
  if (!p) return;

  if (s.t < SQ_FALL + SQ_WAIT) {
    const f = clamp(s.t / SQ_FALL, 0, 1);
    const e = 1 - Math.pow(1 - f, 3);
    const alpha = s.t > SQ_FALL ? clamp(1 - (s.t - SQ_FALL) / SQ_WAIT, 0, 1) : 1;
    ctx.save();
    ctx.translate(s.x, p.y);
    ctx.scale(1 + e * 0.55, 1 - e * 0.94);
    drawAlien(s.kind, 0, 0, s.walk, false, false, alpha);
    ctx.restore();
    if (s.t < SQ_FALL) return;
    ctx.save();
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = ALIENS[s.kind % ALIENS.length].c;
    ctx.beginPath(); ctx.ellipse(s.x, p.y - 2, 16, 3, 0, 0, 6.3); ctx.fill();
    ctx.restore();
    return;
  }

  const r = clamp((s.t - SQ_FALL - SQ_WAIT) / SQ_RISE, 0, 1);
  const e = 1 - Math.pow(1 - r, 2);
  ctx.save();
  ctx.beginPath(); ctx.rect(s.x - 20, p.y - 46, 40, 46); ctx.clip();
  drawGraveAt(s.x, p.y + (1 - e) * 26, s.kind);
  ctx.restore();
}

function drawLeaver(lv) {
  const p = padById(lv.pad);
  if (p) drawAlien(lv.kind, lv.x, p.y, lv.walk, true, false, 1 - lv.fade);
}

function drawPassenger() {
  if (!job || job.phase !== 'wait' || !job.shown) return;
  const p = padById(job.from);
  if (!p) return;
  drawAlien(job.kind, job.x, p.y, job.walk, job.moving, !job.moving);
}

function taxiShape(w, h, broken) {
  ctx.fillStyle = broken ? '#c9a253' : '#ffd479';
  if (!broken) { ctx.shadowColor = 'rgba(255,212,121,.5)'; ctx.shadowBlur = 16; }
  ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 9); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 9); ctx.clip();
  ctx.fillStyle = '#22293f';
  for (let i = 0; i < 9; i++) ctx.fillRect(-w / 2 + i * 6, -h / 2 + (i % 2 ? 5 : 0) + 8, 6, 5);
  if (broken) {
    ctx.fillStyle = '#1a1207';
    ctx.beginPath();
    ctx.moveTo(-4, -h / 2); ctx.lineTo(4, -2); ctx.lineTo(-2, 4); ctx.lineTo(6, h / 2);
    ctx.lineTo(14, h / 2); ctx.lineTo(14, -h / 2);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = broken ? '#3d6470' : '#7fe6ff';
  ctx.beginPath(); ctx.ellipse(-w * 0.22, -3, w * 0.2, h * 0.28, 0, 0, 6.3); ctx.fill();
  if (!broken) {
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.beginPath(); ctx.ellipse(-w * 0.28, -6, 4, 2.6, -0.4, 0, 6.3); ctx.fill();
  }
}

function drawTaxi(v) {
  if (dead || !taxi) return;
  /* Kenttä saa kutistaa taksin piirron: Teleportissa se katoaa portin suuhun
     ja kasvaa ulos toisesta päästä. Pelkkää piirtoa — fysiikka, törmäys ja
     laskuteline eivät tiedä tästä mitään, eikä niiden kuulukaan. */
  const ts = typeof level.taxiScale === 'number' ? level.taxiScale : 1;
  if (ts <= 0.01) return;
  const t2 = taxi, gl = GEAR * t2.gear;
  const NOZ = 7;                             // suuttimen pituus kyljestä ulos
  ctx.save();
  ctx.translate(t2.x, t2.y);
  if (ts !== 1) ctx.scale(ts, ts);

  const flame = (dx, dy, rot, len) => {
    ctx.save();
    ctx.translate(dx, dy); ctx.rotate(rot);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(255,240,180,.95)');
    g.addColorStop(0.5, 'rgba(255,150,60,.7)');
    g.addColorStop(1, 'rgba(255,60,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(0, len);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  const j = () => rand(0.8, 1.2);
  if (v.y < -0.05) { const l = 26 * -v.y * j(); flame(-14, TH / 2, 0, l); flame(14, TH / 2, 0, l); }
  if (v.y > 0.05) flame(0, -TH / 2, Math.PI, 18 * v.y * j());
  /* Sivuliekki on hieman pidempi kuin pystyliekki: se tulee kapeammasta
     suuttimesta, ja lyhyenä se hukkui rungon viereen. Sami 23.9.2026. */
  if (v.x > 0.05) flame(-(TW / 2 + NOZ), 0, -Math.PI / 2, 26 * v.x * j());
  if (v.x < -0.05) flame(TW / 2 + NOZ, 0, Math.PI / 2, 26 * -v.x * j());

  /* Sivusuuttimet. Ne ovat olleet aina liekissä muttei rungossa — Sami
     23.9.2026: *"sivuthrustereiden puuttuminen on häirinnyt aina, molemmissa
     sivuissa pitäis olla."* Suuttimet ovat kiinteä osa runkoa eivätkä käänny
     nokan mukana: kumpikin kylki työntää omaan suuntaansa, ja liekki tulee
     siitä suuttimesta joka työntää. */
  const nozzle = (sx, hot) => {
    ctx.save();
    ctx.scale(sx, 1);
    ctx.fillStyle = '#9fb0d8';
    ctx.beginPath();
    /* Puolet matalampi kuin ensimmäisessä versiossa: neljännes pois sekä
       ylä- että alareunasta. Sami 23.9.2026. */
    ctx.moveTo(TW / 2 - 4, -3);
    ctx.lineTo(TW / 2 + NOZ, -4);
    ctx.lineTo(TW / 2 + NOZ, 4);
    ctx.lineTo(TW / 2 - 4, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = hot ? '#ffe3a6' : '#3b4460';
    if (hot) { ctx.shadowColor = '#ffb355'; ctx.shadowBlur = 10; }
    ctx.fillRect(TW / 2 + NOZ - 2.4, -3.25, 2.4, 6.5);
    ctx.shadowBlur = 0;
    ctx.restore();
  };
  nozzle(1, v.x < -0.05);
  nozzle(-1, v.x > 0.05);

  if (gl > 0.5) {
    ctx.strokeStyle = '#9fb0d8'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-16, TH / 2 - 2); ctx.lineTo(-20, TH / 2 + gl);
    ctx.moveTo(16, TH / 2 - 2); ctx.lineTo(20, TH / 2 + gl);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-27, TH / 2 + gl); ctx.lineTo(-13, TH / 2 + gl);
    ctx.moveTo(13, TH / 2 + gl); ctx.lineTo(27, TH / 2 + gl);
    ctx.stroke();
  }

  /* Runko peilataan, suuttimet ja teline eivät: ne ovat samat kummallakin
     kyljellä, ja jalat ovat siellä missä maa on. */
  ctx.save();
  ctx.scale(t2.face === 1 ? -1 : 1, 1);
  taxiShape(TW, TH, false);
  ctx.restore();

  const busy = job && job.phase === 'aboard';
  ctx.fillStyle = busy ? '#ff5d7a' : '#9fb0d8';
  if (busy) { ctx.shadowColor = '#ff5d7a'; ctx.shadowBlur = 12; }
  ctx.fillRect(-8, -TH / 2 - 6, 16, 6);
  ctx.shadowBlur = 0;

  ctx.restore();
}

function drawHorn() {
  if (hornFx <= 0 || !taxi) return;
  const p = 1 - hornFx / 0.55;
  ctx.save();
  ctx.globalAlpha = (1 - p) * 0.5;
  ctx.strokeStyle = '#ffd479';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(taxi.x, taxi.y, HORN_R * p, 0, 6.3); ctx.stroke();
  ctx.restore();
}

function drawWreck() {
  if (!wreck) return;
  ctx.save();
  ctx.translate(wreck.x, wreck.y);
  ctx.rotate(wreck.rot);
  taxiShape(TW, TH, true);
  ctx.strokeStyle = '#7b87a8'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, TH / 2 - 2); ctx.lineTo(-24, TH / 2 + 12);
  ctx.moveTo(16, TH / 2 - 2); ctx.lineTo(19, TH / 2 + 6);
  ctx.stroke();
  ctx.restore();
}

function bar(x, y, w, h, f, color, label) {
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
  if (f > 0) {
    ctx.fillStyle = color;
    ctx.shadowColor = color; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.roundRect(x, y, Math.max(h, w * f), h, h / 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = 'rgba(233,237,255,.5)';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y - 6);
}

function drawLives() {
  const n = Math.max(0, lives);
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.translate(W - 40 - i * 34, 40);
    ctx.scale(0.5, 0.5);
    ctx.globalAlpha = 0.9;
    taxiShape(TW, TH, false);
    ctx.strokeStyle = '#9fb0d8'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-16, TH / 2 - 2); ctx.lineTo(-20, TH / 2 + 8);
    ctx.moveTo(16, TH / 2 - 2); ctx.lineTo(20, TH / 2 + 8);
    ctx.stroke();
    ctx.restore();
  }
}

function drawHud() {
  ctx.fillStyle = '#e9edff';
  ctx.font = '700 30px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(Math.floor(money) + ' €', 26, 56);

  const f = clamp(fuel / FUEL_MAX, 0, 1);
  const blink = fuel < FUEL_LOW ? 0.55 + Math.sin(runT * 9) * 0.45 : 1;
  const own = f > 0.45 ? '#7bf0a0' : f > 0.2 ? '#ffd479' : '#ff5d7a';
  const col = holdRide() ? mixHex(own, FUEL_HOLD, 0.5 + Math.sin(runT * 4) * 0.5) : own;
  ctx.globalAlpha = blink;
  bar(26, 74, 200, 11, f, col, t('ui.fuel'));
  ctx.globalAlpha = 1;

  drawLives();

  const total = numbered().length;
  const done = numbered().filter(p => served[p.id]).length;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8a97be';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText(gateOpen && state === PLAY ? t('ui.exit') : t('ui.pads', { d: done, t: total }), W - 26, 74);
  ctx.fillStyle = 'rgba(233,237,255,.35)';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText(`${levelIndex + 1}/${LEVELS.length} · ${level.name.toUpperCase()}`, W - 26, 92);

  const fare = fareNow();
  if (fare) {
    ctx.fillStyle = '#ffd479';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(fare + ' €', W - 26, 124);
    ctx.fillStyle = 'rgba(233,237,255,.45)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(job.to === 'up' ? t('ui.meterUp') : t('ui.meterPad', { n: job.to }), W - 26, 140);
  }

  if (msgT > 0) {
    ctx.globalAlpha = Math.min(1, msgT * 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e9edff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(msg, W / 2, 230);
    ctx.globalAlpha = 1;
  }

  if (titleT > 0) {
    ctx.globalAlpha = clamp(titleT / 0.8, 0, 1) * 0.85;
    ctx.textAlign = 'center';
    ctx.fillStyle = level.glow || '#6fe3ff';
    ctx.shadowColor = level.glow || '#6fe3ff';
    ctx.shadowBlur = 20;
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.fillText(level.name.toUpperCase(), W / 2, H * 0.34);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  if (state === ENTER || goT > 0) {
    const ready = state === ENTER;
    ctx.textAlign = 'center';
    ctx.globalAlpha = ready ? 0.55 + Math.sin(runT * 9) * 0.35 : clamp(goT / 0.45, 0, 1);
    ctx.fillStyle = ready ? '#e9edff' : '#7bf0a0';
    ctx.shadowColor = ready ? 'rgba(233,237,255,.6)' : '#7bf0a0';
    ctx.shadowBlur = 18;
    ctx.font = ready ? '700 46px system-ui, sans-serif' : '700 58px system-ui, sans-serif';
    ctx.fillText(ready ? t('ui.ready') : t('ui.go'), W / 2, H * 0.5);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

function smallBox(b, draw) {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#9fb0d8'; ctx.fillStyle = '#9fb0d8';
  ctx.lineWidth = 2; ctx.lineCap = 'round';
  draw(b.x + b.w / 2, b.y + b.h / 2);
  ctx.restore();
}

function drawButtons() {
  if (touchBtns) drawTouchPads();
  drawCorner();
}

/* Teline ja töötti sormelle. Pelaaja voi ottaa ne pois asetuksista: ilman
   kosketusnäyttöä ne ovat pelkkää kuvaa, ja pois otettuina alanurkat ovat
   kentän käytössä. */
function drawTouchPads() {
  const b = GEAR_BOX, down = taxi && taxi.gear > 0.5;
  // punainen vasta kun vauhti oikeasti hajottaisi taksin, ei jo varoitusalueella
  const hot = taxi && !taxi.landed && taxi.gear > 0.5 && !dead && landRatio() > 1;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = hot ? 'rgba(255,93,122,.2)' : down ? 'rgba(111,227,255,.18)' : 'rgba(255,255,255,.07)';
  ctx.strokeStyle = hot ? 'rgba(255,93,122,.9)' : down ? 'rgba(111,227,255,.8)' : 'rgba(233,237,255,.3)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 16); ctx.fill(); ctx.stroke();

  const cx = b.x + b.w / 2, cy = b.y + 38;
  ctx.strokeStyle = hot ? '#ff5d7a' : down ? '#6fe3ff' : '#9fb0d8';
  ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 18, cy - 12); ctx.lineTo(cx + 18, cy - 12);
  if (down) {
    ctx.moveTo(cx - 12, cy - 12); ctx.lineTo(cx - 16, cy + 10);
    ctx.moveTo(cx + 12, cy - 12); ctx.lineTo(cx + 16, cy + 10);
    ctx.moveTo(cx - 22, cy + 10); ctx.lineTo(cx - 10, cy + 10);
    ctx.moveTo(cx + 10, cy + 10); ctx.lineTo(cx + 22, cy + 10);
  } else {
    ctx.moveTo(cx - 12, cy - 12); ctx.lineTo(cx - 10, cy - 2);
    ctx.moveTo(cx + 12, cy - 12); ctx.lineTo(cx + 10, cy - 2);
  }
  ctx.stroke();

  ctx.fillStyle = hot ? '#ff5d7a' : down ? '#6fe3ff' : '#9fb0d8';
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(hot ? t('ui.tooFast') : down ? t('ui.gearDown') : t('ui.gearUp'), cx, b.y + b.h - 14);
  ctx.restore();

  const hb = HORN_BOX, honking = hornFx > 0;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = honking ? 'rgba(255,212,121,.22)' : 'rgba(255,255,255,.07)';
  ctx.strokeStyle = honking ? 'rgba(255,212,121,.9)' : 'rgba(233,237,255,.3)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(hb.x, hb.y, hb.w, hb.h, 16); ctx.fill(); ctx.stroke();

  const hx = hb.x + hb.w / 2, hy = hb.y + 30;
  ctx.strokeStyle = honking ? '#ffd479' : '#9fb0d8';
  ctx.fillStyle = honking ? '#ffd479' : '#9fb0d8';
  ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx - 12, hy - 5); ctx.lineTo(hx - 4, hy - 5);
  ctx.lineTo(hx + 8, hy - 13); ctx.lineTo(hx + 8, hy + 13);
  ctx.lineTo(hx - 4, hy + 5); ctx.lineTo(hx - 12, hy + 5);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(hx + 10, hy, 9, -0.9, 0.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(hx + 10, hy, 15, -0.8, 0.8); ctx.stroke();
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(t('ui.horn'), hx, hb.y + hb.h - 12);
  ctx.restore();

}

/* Nurkan kuvakkeet piirtyvät aina, myös kosketusnapit pois otettuina. */
function drawCorner() {
  /* Ratas: sen takaa löytyvät ääni, koko ruutu, nappien puoli, kieli ja
     vaikeustaso. */
  smallBox(COG_BOX, (mx, my) => {
    ctx.beginPath(); ctx.arc(mx, my, 6, 0, 6.3); ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(a) * 8, my + Math.sin(a) * 8);
      ctx.lineTo(mx + Math.cos(a) * 12, my + Math.sin(a) * 12);
      ctx.stroke();
    }
  });

  /* Kehittäjän säätöpaneeli on eri asia kuin pelaajan asetukset, joten se on
     eri kuvake eikä rivi valikon pohjalla: liu'ut, koska sitä se on. Näkyy
     vain kun debug on sallittu, eli pelaajalle nurkassa on vain ratas. */
  if (debugAllowed()) smallBox(TUNE_BOX, (mx, my) => {
    for (const [dy, kx] of [[-7, -3], [0, 5], [7, -1]]) {
      ctx.beginPath();
      ctx.moveTo(mx - 11, my + dy); ctx.lineTo(mx + 11, my + dy);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(mx + kx, my + dy, 2.6, 0, 6.3); ctx.fill();
    }
  });
}

/** Tausta: kentän oma taivas tai avaruus, ja valinnainen aurinko. */
function drawSky() {
  const sky = level.sky || ['#0b1230', '#04070f'];
  const g = ctx.createLinearGradient(0, 0, 0, H);
  sky.forEach((c, i) => g.addColorStop(sky.length === 1 ? 0 : i / (sky.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (level.sun) {
    const s = level.sun;
    const halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 2.4);
    halo.addColorStop(0, (s.color || '#ffd089') + 'cc');
    halo.addColorStop(0.35, (s.color || '#ffd089') + '44');
    halo.addColorStop(1, (s.color || '#ffd089') + '00');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 2.4, 0, 6.3); ctx.fill();
    ctx.fillStyle = s.color || '#ffd089';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.3); ctx.fill();
  }

  const dim = level.sky ? 0.3 : 1;
  for (const s of stars) {
    ctx.globalAlpha = s.a * (0.6 + Math.sin(runT * 1.6 + s.p) * 0.4) * dim;
    ctx.fillStyle = '#9fc4ff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.3); ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(120,160,255,.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
}

/* Taukomerkki: kaksi palkkia, ei tekstiä. Kieletön merkki ei tarvitse
   käännöstä eikä sitä että i18n.js muistetaan päivittää. */
function pauseBadge() {
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  const x = W / 2, y = 132;
  ctx.fillStyle = 'rgba(8,13,30,.74)';
  ctx.beginPath(); ctx.roundRect(x - 33, y - 23, 66, 46, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(120,160,255,.35)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x - 33, y - 23, 66, 46, 12); ctx.stroke();
  ctx.fillStyle = '#6fe3ff';
  ctx.fillRect(x - 12, y - 12, 8, 24);
  ctx.fillRect(x + 4, y - 12, 8, 24);
}

function draw(v) {
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  drawSky();

  if (level.drawBack) level.drawBack(ctx, api());

  for (const r of WALLS) drawWall(r);
  drawGate();
  for (const p of PADS) drawPad(p);
  for (const gr of graves) drawGrave(gr);
  for (const s of squishes) drawSquish(s);
  for (const lv of leavers) drawLeaver(lv);
  drawPassenger();
  drawTaxi(v);
  drawHorn();
  drawWreck();

  for (const b of bits) {
    ctx.globalAlpha = clamp(b.life, 0, 1) * (b.a === undefined ? 1 : b.a);
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.3); ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (level.drawFront) level.drawFront(ctx, api());

  if (state !== MENU) drawHud();
  stick.draw(ctx);
  drawButtons();
  sketch.draw(ctx);                          // työkalu kaiken päälle
}

/* ------------------------------------------------------------ säätöpaneeli
   Paneeli on kehittäjän työkalu ja pysyy suomeksi. */

/* Miksi tallennus ei onnistunut, ihmisen kielellä. Tuntematon syy näytetään
   sellaisenaan, jottei uusi syy katoa tyhjään ruutuun. */
const SAVE_FAIL = {
  unframed: 'peli ei ole portaalin sivulla',
  'not-owner': 'vain pelin tekijä voi tallentaa',
  'bad-path': 'tiedostonimi ei kelpaa',
  'bad-json': 'arvot eivät ole kelvollista JSONia',
  'too-big': 'tiedosto on liian iso',
  'config-full': 'asetuskansio on täynnä',
  quota: 'pelin tila on täynnä',
  timeout: 'portaali ei vastannut',
  refused: 'portaali kieltäytyi',
  failed: 'tuntematon virhe',
};

/* Käppyrä ryhmän alimmaksi. Piirtofunktio saa tyhjän ctx:n ja mitat eikä tiedä
   mistä sitä kutsutaan, joten kenttä voi julkaista omansa tietämättä mitään
   paneelista. Kuva päivittyy joka ruudulla niin kauan kuin paneeli on auki —
   siihen voi siis piirtää myös sen missä kohtaa kierrosta juuri nyt ollaan,
   ja säätimen liikuttaminen näkyy käyrässä samalla hetkellä. */
let graphDraws = [];

function graphCanvas(draw) {
  const c = document.createElement('canvas');
  c.width = 560; c.height = 150;
  Object.assign(c.style, {
    width: '100%', height: 'auto', display: 'block',
    margin: '2px 0 10px', borderRadius: '6px', background: 'rgba(8,16,31,.55)',
  });
  const g = c.getContext('2d');
  const paint = () => {
    g.clearRect(0, 0, c.width, c.height);
    try { draw(g, c.width, c.height); } catch (e) {}
  };
  graphDraws.push(paint);
  paint();
  return c;
}

function paintGraphs() {
  if (!graphDraws.length || panelEl.classList.contains('hidden')) return;
  for (const d of graphDraws) d();
}

/* Tippikäyrä: kolme profiilia, kukin laskeva suora omalta korkeudeltaan omaan
   nollakohtaansa. Kaasuprofiili on katkoviivalla, koska sen mittari seisoo niin
   kauan kuin suuttimet ovat päällä — suora on sen pahin tapaus eikä toteuma,
   ja yhtenäisenä viivana käyrä valehtelisi juuri siitä profiilista joka on
   tehty palkitsemaan kaasun pitämisestä. */
const TIP_COL = ['#6fe3ff', '#ff5d7a', '#ffd479'];
const TIP_NAME = ['tyyni', 'kiireinen', 'kaasu'];

function tipGraph(ctx, w, h) {
  const L = 48, B = h - 38, T = 14, R = w - 12;
  const zero = p => P.tipTime / Math.max(0.05, P[p.fade]);
  const high = p => P.tip * P[p.mul];
  const secs = Math.max(1, ...TIPPERS.map(zero)) * 1.08;
  const top = Math.max(1, ...TIPPERS.map(high));

  ctx.strokeStyle = 'rgba(120,160,255,.22)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L, T); ctx.lineTo(L, B); ctx.lineTo(R, B);
  ctx.stroke();
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(190,210,255,.55)';
  ctx.textAlign = 'right';
  ctx.fillText(Math.round(top) + ' €', L - 5, T + 11);
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(secs) + ' s', R - 10, B + 16);

  TIPPERS.forEach((p, i) => {
    ctx.strokeStyle = TIP_COL[i] || '#fff';
    ctx.lineWidth = 2.5;
    ctx.setLineDash(p.onlyIdle ? [7, 5] : []);
    ctx.beginPath();
    ctx.moveTo(L, B - high(p) / top * (B - T));
    ctx.lineTo(L + Math.min(1, zero(p) / secs) * (R - L), B);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = TIP_COL[i] || '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(TIP_NAME[i] + (p.onlyIdle ? ' (paras tapaus)' : ''), L + i * 150, h - 8);
  });
}
/* Säätimet laatikoissa, koska niitä on yli kaksikymmentä eikä kukaan selaa
   sellaista listaa. Ryhmään kuulumaton säädin päätyy "muut"-laatikkoon, joten
   uusi säädin ei katoa näkyvistä vaikka lisääjä ei kävisi tätä listaa läpi. */
const SLIDER_GROUPS = [
  { name: 'lento', open: true, keys: ['grav', 'thrust', 'stick', 'turnV'] },
  { name: 'laskeutuminen', open: false,
    keys: ['landVY', 'landVX', 'bounceFrom', 'bounceLift', 'bounceKeep', 'hopRate'] },
  { name: 'bensa', open: true,
    keys: ['burn', 'sideBurn', 'refuel', 'price',
           'dryOn', 'dryOff', 'dryJitter', 'dryLife'] },
  { name: 'savu', open: false,
    curve: 'smokeCurve',
    keys: ['smokeLife', 'smokeSize', 'smokeGrow',
           'smokeRise', 'smokeC0', 'smokeA0', 'smokeC1', 'smokeA1'] },
  { name: 'raha ja tipit', open: false, graph: tipGraph,
    keys: ['fare', 'tip', 'tipTime',
           'tipCalm', 'fadeCalm', 'tipRush', 'fadeRush', 'tipHold', 'fadeHold'] },
];

const SLIDERS = [
  { key: 'grav', label: 'painovoima', min: 80, max: 500, step: 10 },
  { key: 'thrust', label: 'työntö', min: 300, max: 1200, step: 20 },
  { key: 'landVY', label: 'lasku vy max', min: 40, max: 300, step: 5 },
  { key: 'landVX', label: 'lasku vx max', min: 10, max: 200, step: 5 },
  { key: 'bounceFrom', label: 'pomppu alkaa x', min: 0.2, max: 0.95, step: 0.05 },
  { key: 'bounceLift', label: 'pompun nosto px', min: 2, max: 30, step: 1 },
  { key: 'hopRate', label: 'ponnistus × telineen vauhti', min: 0, max: 3, step: 0.25 },
  { key: 'bounceKeep', label: 'pompun jäävä vauhti', min: 0.2, max: 0.9, step: 0.02 },
  { key: 'burn', label: 'kulutus / s', min: 0, max: 40, step: 1 },
  { key: 'sideBurn', label: 'sivusuuttimet × kulutus', min: 0, max: 1, step: 0.05 },
  { key: 'refuel', label: 'tankkaus / s', min: 5, max: 80, step: 1 },
  { key: 'price', label: 'bensan hinta', min: 0, max: 3, step: 0.1 },
  { key: 'fare', label: 'perusmaksu', min: 0, max: 200, step: 5 },
  { key: 'tip', label: 'tippi max', min: 0, max: 200, step: 5 },
  { key: 'tipTime', label: 'tipin kesto s', min: 5, max: 60, step: 1 },
  { key: 'dryOn', label: 'pätkintä: bensaa s', min: 0, max: 1, step: 0.01 },
  { key: 'dryOff', label: 'pätkintä: tauko s', min: 0.02, max: 2, step: 0.01 },
  { key: 'dryJitter', label: 'pätkintä: satunnaisuus ±s', min: 0, max: 0.5, step: 0.01 },
  { key: 'dryLife', label: 'pätkintä: kesto s', min: 0, max: 20, step: 0.5 },
  { key: 'tipCalm', label: 'tyyni: tippi ×', min: 0.5, max: 3, step: 0.05 },
  { key: 'fadeCalm', label: 'tyyni: lasku ×', min: 0.2, max: 4, step: 0.1 },
  { key: 'tipRush', label: 'kiireinen: tippi ×', min: 0.5, max: 3, step: 0.05 },
  { key: 'fadeRush', label: 'kiireinen: lasku ×', min: 0.2, max: 4, step: 0.1 },
  { key: 'tipHold', label: 'kaasu: tippi ×', min: 0.5, max: 3, step: 0.05 },
  { key: 'fadeHold', label: 'kaasu: lasku ×', min: 0.2, max: 4, step: 0.1 },
  { key: 'stick', label: 'sauvan herkkyys', min: 0.2, max: 2.5, step: 0.05 },
  { key: 'turnV', label: 'nokan kääntymisraja px/s', min: 0, max: 300, step: 5 },
  { key: 'smokeLife', label: 'savun kesto s', min: 0.2, max: 5, step: 0.1 },
  { key: 'smokeSize', label: 'savun koko px', min: 1, max: 16, step: 0.5 },
  { key: 'smokeGrow', label: 'savun kasvu px/s', min: 0, max: 50, step: 1 },
  { key: 'smokeRise', label: 'savun nousu px/s', min: -20, max: 80, step: 2 },
  { key: 'smokeC0', label: 'savun väri täydessä', color: true },
  { key: 'smokeA0', label: 'savun peitto täydessä', min: 0, max: 1, step: 0.05 },
  { key: 'smokeC1', label: 'savun väri tyhjänä', color: true },
  { key: 'smokeA1', label: 'savun peitto tyhjänä', min: 0, max: 1, step: 0.05 },
];

let panelNote = '';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function pbutton(cls, text, fn) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}

function buildPanel() {
  panelEl.replaceChildren(el('h2', null, 'säädöt'));
  graphDraws = [];                             // vanhat kankaat irtosivat DOMista

  const lvlRow = el('div', 'row');
  const lvlSeg = el('div', 'seg');
  LEVELS.forEach((lv, i) => {
    lvlSeg.append(pbutton(levelIndex === i && (state === PLAY || state === ENTER) ? 'on' : null, lv.name, () => {
      startLevel(i);
      buildPanel();
    }));
  });
  lvlRow.append(el('label', null, 'kenttä'), lvlSeg);
  panelEl.append(lvlRow);

  const pauseRow = el('div', 'row');
  const pauseSeg = el('div', 'seg');
  pauseSeg.append(pbutton(paused ? 'on' : null, paused ? 'jatka' : 'tauko', togglePause));
  pauseSeg.append(pbutton(sketch.active ? 'on' : null, 'luonnos', () => {
    Promise.resolve(sketch.toggle()).then(ok => {
      if (ok === false && !sketch.active) panelNote = 'luonnoslehtiötä ei saatu ladattua';
      refreshPanel();
    });
  }));
  pauseRow.append(el('label', null, 'peli'), pauseSeg);
  panelEl.append(pauseRow);

  /* Kaksi latausta, koska ne maksavat eri verran. Kenttä tulee uusiksi ilman
     että kokoruutu, paneelit tai kenttävalinta katoavat; sivu on sitä varten
     kun muukin kuin kenttä on muuttunut. */
  const loadRow = el('div', 'row');
  const loadSeg = el('div', 'seg');
  loadSeg.append(pbutton(null, 'lataa kenttä', () => {
    panelNote = 'ladataan kenttää…';
    buildPanel();
    reloadLevel().then(ok => {
      panelNote = ok ? 'kenttä ladattu uudestaan' : 'kentän lataus ei onnistunut';
      buildPanel();
    });
  }));
  loadSeg.append(pbutton(null, 'lataa sivu', () => location.reload()));
  loadSeg.append(pbutton(watching ? 'on' : null, 'seuraa', () => {
    dev.watch = !watching;
    setWatch(wantWatch());
    saveDev();
    buildPanel();
  }));
  loadRow.append(el('label', null, 'lataus'), loadSeg);
  panelEl.append(loadRow);

  const langRow = el('div', 'row');
  const langSeg = el('div', 'seg');
  const lang = (code, text) => pbutton(LANG === code ? 'on' : null, text, () => {
    applyLang(code);
    /* Ja portaalille, jotta liput ylhäällä eivät jää eri mielelle. */
    setPortal('lang', code);
  });
  langSeg.append(lang('fi', 'suomi'), lang('en', 'english'));
  langRow.append(el('label', null, 'kieli'), langSeg);
  panelEl.append(langRow);

  /* Vaikeustaso on pelaajan asetus eikä viritystä, mutta se kertoo painovoiman
     ja työnnön — eli ilman tätä riviä säätimen luku ja pelin tuntuma voivat olla
     eri mieltä, eikä paneelista näkisi miksi. */
  const diffRow = el('div', 'row');
  const diffSeg = el('div', 'seg');
  for (const d of DIFFS) {
    diffSeg.append(pbutton(diff === d.id ? 'on' : null, t('set.diff.' + d.id, null, 'fi'), () => {
      setDiff(d.id); buildPanel();
    }));
  }
  diffRow.append(el('label', null, 'vaikeustaso'), diffSeg);
  panelEl.append(diffRow);

  const sideRow = el('div', 'row');
  const seg = el('div', 'seg');
  const mk = (side, text) => pbutton(gearSide === side ? 'on' : null, text, () => {
    if (gearSide === side) return;
    snapUndo();
    setSide(side); saveTune(); buildPanel();
  });
  seg.append(mk('left', 'vasen'), mk('right', 'oikea'));
  sideRow.append(el('label', null, 'napit'), seg);
  panelEl.append(sideRow);

  /* Yksi säädinrivi. Arvo luetaan ja kirjoitetaan callbackeilla, joten sama
     rivi kelpaa globaaliin viritykseen, kentän kertoimiin ja kentän omiin
     arvoihin — paneelin ei tarvitse tietää kumpaa se milloinkin säätää. */
  const sliderRow = (s, get, set) => {
    const row = el('div', 'row');
    const lab = el('label');
    const val = el('b', null, String(get()));
    lab.append(document.createTextNode(s.label), val);
    const input = el('input');
    input.type = 'range';
    input.min = s.min; input.max = s.max; input.step = s.step;
    input.value = get();
    /* Kumottava kuva otetaan ennen kuin arvo ehtii muuttua: molemmat tapahtumat
       tulevat inputia aiemmin, hiirellä ja näppäimistöllä. */
    input.addEventListener('pointerdown', snapUndo);
    input.addEventListener('keydown', snapUndo);
    input.addEventListener('input', () => {
      set(+input.value);
      val.textContent = input.value;
    });
    row.append(lab, input);
    return row;
  };

  /* Väririvi on sama rivi kuin säädin, mutta liu'un tilalla on selaimen oma
     värivalitsin. Arvo on luku (0xRRGGBB) niin kuin kaikki muukin viritys;
     vain syöte puhuu heksaa. */
  const colorRow = (s, get, set) => {
    const row = el('div', 'row');
    const lab = el('label');
    const val = el('b', null, hexOf(get()));
    lab.append(document.createTextNode(s.label), val);
    const input = el('input');
    input.type = 'color';
    input.value = hexOf(get());
    input.addEventListener('pointerdown', snapUndo);
    input.addEventListener('input', () => {
      set(parseInt(input.value.slice(1), 16));
      val.textContent = input.value;
    });
    row.append(lab, input);
    return row;
  };

  /* Käyräeditori: sama laatikko kuin muillakin kuvaajilla, mutta siihen saa
     piirtää. Pystypylväs kutakin pistettä kohti, ja veto asettaa arvon siellä
     missä sormi kulkee — myös pisteiden väliin jääneet, jotta nopea veto ei
     jätä aukkoja. Piirtämisen jälkeen ei tarvitse painaa mitään: arvo on
     pelissä heti, ja tallennus tapahtuu vedon päättyessä niin kuin liu'uillakin.

     x on tankin täyteys 0…100 % vasemmalta oikealle ja y savua sekunnissa. */
  const curveRow = (key, label, maxY) => {
    const arr = () => BASE[key];
    const wrap = el('div', 'row');
    const lab = el('label');
    const val = el('b', null, '');
    lab.append(document.createTextNode(label), val);
    wrap.append(lab);

    const c = graphCanvas((g, w, h) => {
      const a = arr(), n = a.length - 1;
      const L = 44, R = w - 10, T = 12, B = h - 26;
      const xOf = i => L + (R - L) * (i / n);
      const yOf = v => B - (B - T) * clamp(v / maxY, 0, 1);

      g.strokeStyle = 'rgba(120,160,255,.22)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(L, T); g.lineTo(L, B); g.lineTo(R, B); g.stroke();
      g.font = '13px system-ui, sans-serif';
      g.fillStyle = 'rgba(190,210,255,.55)';
      g.textAlign = 'right'; g.fillText(String(maxY), L - 5, T + 11);
      g.textAlign = 'left'; g.fillText('tyhjä', L, B + 16);
      g.textAlign = 'right'; g.fillText('täysi', R, B + 16);

      /* Missä tankki on juuri nyt: säätäminen on helpompaa kun näkee mitä
         kohtaa käyrästä ollaan ajamassa. */
      if (taxi && state === PLAY) {
        g.strokeStyle = 'rgba(255,212,121,.45)';
        g.beginPath();
        const x = L + (R - L) * clamp(fuel / FUEL_MAX, 0, 1);
        g.moveTo(x, T); g.lineTo(x, B); g.stroke();
      }

      const bw = Math.max(3, (R - L) / n - 3);
      for (let i = 0; i <= n; i++) {
        if (a[i] <= 0) continue;
        g.fillStyle = 'rgba(111,227,255,.55)';
        g.fillRect(xOf(i) - bw / 2, yOf(a[i]), bw, B - yOf(a[i]));
      }
      g.strokeStyle = '#6fe3ff'; g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const x = xOf(i), y = yOf(a[i]);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    });
    c.style.touchAction = 'none';
    c.style.cursor = 'crosshair';

    let last = -1;
    const at = ev => {
      const r = c.getBoundingClientRect();
      const a = arr(), n = a.length - 1;
      const w = c.width, h = c.height;
      const L = 44, R = w - 10, T = 12, B = h - 26;
      const x = (ev.clientX - r.left) / r.width * w;
      const y = (ev.clientY - r.top) / r.height * h;
      const i = Math.round(clamp((x - L) / (R - L), 0, 1) * n);
      const v = Math.round(clamp((B - y) / (B - T), 0, 1) * maxY * 10) / 10;
      /* Väliin jääneet pisteet täytetään, jotta nopea veto ei jätä aukkoja. */
      const from = last < 0 ? i : last;
      const step = i >= from ? 1 : -1;
      for (let j = from; j !== i + step; j += step) a[j] = v;
      last = i;
      val.textContent = Math.round(a[i]) + ' / s';
      applyMul();
      syncFoot();
    };
    c.addEventListener('pointerdown', ev => {
      snapUndo(); last = -1; c.setPointerCapture(ev.pointerId); at(ev);
    });
    c.addEventListener('pointermove', ev => { if (last >= 0 || ev.buttons) at(ev); });
    c.addEventListener('pointerup', () => { last = -1; saveTune(); syncFoot(); });
    c.addEventListener('pointercancel', () => { last = -1; });
    wrap.append(c);
    return wrap;
  };

  const globalSet = key => v => {
    BASE[key] = v;
    applyMul();
    saveTune();
    syncFoot();
  };
  const globalRow = s =>
    (s.color ? colorRow : sliderRow)(s, () => BASE[s.key], globalSet(s.key));

  /* Kentän arvot tallentuvat samalla tavalla kuin globaalit. Tämä puuttui
     ensin, ja vika näkyi vasta sivun latauksessa: säädöt toimivat, mutta
     katosivat. */
  const levelChanged = () => {
    saveTune();
    syncFoot();
  };

  /* Kumoa ja tallenna kertovat samaa asiaa: onko virityksessä jotain jota ei
     ole viety peliin. Molemmat ovat harmaana kun ei ole. Funktiona eikä
     nuolena, jotta säädinrivit saavat kutsua tätä ennen kuin napit on tehty. */
  function syncFoot() {
    undoBtn.disabled = !undoSnap;
    saveBtn.disabled = !tuneDirty();
  }

  /* <details> hoitaa auki ja kiinni itse, mutta **ei muista sitä**: paneeli
     rakennetaan uudestaan joka kenttänapista ja joka sivun latauksesta, ja
     silloin jokainen laatikko palasi koodin oletukseen. Kenttää rakentaessa
     sivu ladataan kymmeniä kertoja, joten se tarkoitti samojen kolmen laatikon
     avaamista uudestaan joka kerta. Sami 23.9.2026.

     Tila talletetaan otsikon mukaan (`dev.folds`), eli kentän omat laatikot
     muistetaan kenttäkohtaisesti — otsikko on "Tulivuori: purkaus" eikä
     "purkaus". Koodin `open` jää oletukseksi sille mitä ei ole vielä avattu
     kertaakaan. */
  const group = (name, open, rows, graph) => {
    const box = el('details', 'grp');
    box.open = typeof dev.folds[name] === 'boolean' ? dev.folds[name] : open;
    box.append(el('summary', null, name));
    box.addEventListener('toggle', () => { dev.folds[name] = box.open; saveDev(); });
    const body = el('div', 'body');
    for (const r of rows) body.append(r);
    if (graph) body.append(graphCanvas(graph));
    box.append(body);
    return box;
  };

  const byKey = new Map(SLIDERS.map(s => [s.key, s]));

  /* Kentän oma säätötaulu kenttänappien ja globaalien säädinten väliin. Kenttä
     julkaisee sen itse (level.tune), joten peli ei tiedä minkään kentän
     sisällöstä mitään — täällä on vain se miten taulu piirretään. Kahta lajia:

       mul       kertoimet globaaleihin arvoihin, 1 = kenttä ei ota kantaa
       sliders   kentän omat arvot, kirjoitetaan suoraan kentän omaan olioon

     Taulu vaihtuu kenttää vaihdettaessa, koska buildPanel ajetaan uudestaan. */
  /* Kentän näkyvä nimi tekstikenttänä. **Nimi on pelkkää näyttöä** — kentän
     tunnus on sen tiedostonimi — joten sen saa vaihtaa lennossa ilman että
     mikään tallennettu katoaa, ja se tallentuu peliin muun virityksen mukana.
     Sami 23.9.2026: *"paras olisi jos propseissa on nimi kenttä, jotta voin
     vaihtaa sitä lennossa."*

     Tyhjä kenttä palauttaa koodin nimen sen sijaan että jättäisi kentän
     nimettömäksi: nimetön kenttä näkyisi tyhjänä nappina ja tyhjänä otsikkona
     HUDissa, eikä sitä saisi enää valittua. */
  const nameRow = el('div', 'row');
  const nameIn = document.createElement('input');
  nameIn.type = 'text';
  nameIn.maxLength = 32;
  nameIn.value = level.name;
  nameIn.style.cssText = 'width:100%;box-sizing:border-box;background:#141a2c;'
    + 'border:1px solid #2b3550;border-radius:6px;color:#ffd479;font:inherit;padding:5px 7px;';
  nameIn.addEventListener('input', () => {
    level.name = nameIn.value.trim() || LEVEL_NAME0.get(lvId(level)) || level.name;
    levelChanged();
  });
  /* Nappirivi ja laatikko-otsikot näyttävät nimen, joten ne ladotaan uusiksi
     vasta kun kirjoittaminen loppuu — kesken kirjoittamisen se veisi fokuksen
     kentästä joka näppäimen painalluksella. */
  nameIn.addEventListener('change', () => buildPanel());
  nameRow.append(el('label', null, 'kentän nimi'), nameIn);
  panelEl.append(nameRow);

  for (const g of level.tune || []) {
    const rows = [];
    for (const key of g.mul || []) {
      const base = byKey.get(key);
      if (!base) continue;
      rows.push(sliderRow(
        { label: base.label + ' ×', min: 0.2, max: 3, step: 0.05 },
        () => { const m = MUL[key]; return typeof m === 'number' ? m : 1; },
        v => { MUL[key] = v; applyMul(); levelChanged(); },
      ));
    }
    for (const sl of g.sliders || []) {
      if (!g.obj) continue;
      rows.push(sliderRow(sl, () => g.obj[sl.key], v => { g.obj[sl.key] = v; levelChanged(); }));
    }
    if (rows.length || g.graph) {
      panelEl.append(group(level.name + ': ' + g.name, g.open !== false, rows, g.graph));
    }
  }

  const used = new Set();
  for (const g of SLIDER_GROUPS) {
    const rows = g.keys.map(k => byKey.get(k)).filter(Boolean);
    for (const s of rows) used.add(s.key);
    const built = rows.map(globalRow);
    if (g.curve) built.unshift(curveRow(g.curve, 'savua / s', 200));
    if (built.length) panelEl.append(group(g.name, g.open, built, g.graph));
  }
  const rest = SLIDERS.filter(s => !used.has(s.key));
  if (rest.length) panelEl.append(group('muut', false, rest.map(globalRow)));

  const note = el('p', 'note', panelNote);
  panelNote = '';

  /* Oletukset pyyhkii koko virityksen kerralla, joten se kysyy ensin. Kysymys
     on napissa itsessään eikä selaimen confirm-ikkunassa: peli ajetaan
     iframessa jossa omat ikkunat eivät ole varma asia. Varmistus raukeaa
     itsestään, joten vahingossa painettu nappi ei jää odottamaan. */
  let armed = null;
  const disarm = () => {
    clearTimeout(armed); armed = null;
    resetBtn.textContent = 'oletukset';
    resetBtn.classList.add('ghost');
  };
  const resetBtn = pbutton('btn sm ghost', 'oletukset', () => {
    if (!armed) {
      resetBtn.textContent = 'varmista';
      resetBtn.classList.remove('ghost');
      note.textContent = 'palauttaa kaikki arvot — paina uudestaan';
      armed = setTimeout(disarm, 5000);
      return;
    }
    disarm();
    snapUndo();
    Object.assign(BASE, cloneTune(DEFAULTS));
    resetLevelTune();                          // myös kenttien omat arvot
    sidePick = null; gearSide = DEFAULT_SIDE; layout();
    applyMul();
    saveTune();
    panelNote = 'oletukset palautettu — kumoa palauttaa entiset';
    buildPanel();
  });

  /* Yksi askel taaksepäin, ei enempää: kuva on otettu viimeisimmän muutoksen
     alusta. Kumoamisen jälkeen ei ole enää mitään kumottavaa, joten nappi
     harmenee itsestään. */
  const undoBtn = pbutton('btn sm ghost', 'kumoa', () => {
    if (!undoSnap) return;
    const back = undoSnap;
    undoSnap = null;
    if (!applyBody(back)) { note.textContent = 'kumoaminen ei onnistunut'; return; }
    saveTune();
    panelNote = 'viimeisin muutos kumottu';
    buildPanel();
  });

  /* Tallennus peliin kirjoittaa arvot pelin omaan tiedostoon draftissa,
     jolloin julkaisu vie ne mukanaan oletuksiksi kaikille. Peli ei kirjoita
     itse — se pyytää emosivulta, joka on kirjautunut ja jonka palvelinpuoli
     tarkistaa omistajuuden. Siksi tämä toimii vain tekijän omalla sivulla,
     ja siksi nappi kertoo sen ääneen kun se ei ole käytettävissä. */
  const saveBtn = pbutton('btn sm', 'tallenna peliin', () => {
    const save = portalApi.savePortalFile;
    if (typeof save !== 'function' || !portal.canWrite) {
      note.textContent = 'tallennus peliin onnistuu vain omalta pelisivulta';
      return;
    }
    note.textContent = 'tallennetaan…';
    const body = JSON.stringify(tuneAll(Date.now()), null, 1);
    /* Plugin ratkaisee lupauksen aina ja kertoo syyn tuloksessa — se ei heitä
       eikä hylkää, joten tässä ei ole catchia eikä sellaista tarvita. */
    Promise.resolve(save(TUNE_FILE, body)).then(res => {
      if (res && res.saved) {
        localStamp = JSON.parse(body).stamp;
        try { localStorage.setItem(STORE, body); } catch (e) {}
        savedBody = tuneBody();                // nyt pelissä on tämä
        undoSnap = null;
        syncFoot();
        note.textContent = 'tallennettu peliin — julkaise niin arvot lähtevät mukaan';
      } else {
        const why = (res && res.reason) || 'failed';
        note.textContent = 'tallennus ei onnistunut: ' + (SAVE_FAIL[why] || why);
      }
    });
  });

  /* Alimmalle riville ne kaksi jotka lopettavat työn, sulje viimeisenä. */
  const acts = el('div', 'foot');
  acts.append(resetBtn, undoBtn);
  const ends = el('div', 'foot');
  ends.append(saveBtn, pbutton('btn sm', 'sulje', togglePanel));
  panelEl.append(acts, ends, note);
  syncFoot();

  /* Vieritys takaisin siihen mihin se jäi. Tämä on vasta lopussa, koska
     scrollTop leikkautuu sisällön korkeuteen: ennen viimeistä riviä paneeli on
     matalampi kuin se kohta johon ollaan menossa, ja arvo katoaisi. */
  if (dev.scroll > 0) panelEl.scrollTop = dev.scroll;
}

function panelOpen() {
  return !panelEl.classList.contains('hidden');
}

/* Asetettuun tilaan, ei vastakkaiseen. Portaalin kytkin tietää mihin asentoon
   se on menossa, ja pelkkä toggle menisi sen kanssa ristiin heti kun paneeli on
   avattu täältä rattaasta. */
function setPanel(on) {
  if (on === panelOpen()) return;
  /* Näkyviin **ennen** rakentamista. Piilotettuna paneelilla ei ole asettelua,
     eikä piilotetun elementin `scrollTop` ota vastaan mitään — buildPanelin
     lopussa palautettu vieritys katosi siis joka avauksella. Vaihto ei vilauta
     mitään, koska molemmat tapahtuvat samassa tehtävässä eikä välissä
     piirretä. */
  if (on) { panelEl.classList.remove('hidden'); buildPanel(); }
  else panelEl.classList.add('hidden');
  saveDev();
  setWatch(wantWatch());                       // vartija seuraa paneelia
  /* Ja portaalille, jotta sen kytkin näyttää sen mikä on auki. */
  setPortal('debug', on);
}

/* Tauko. Peli piirtyy mutta ei etene: liikkuvan kentän — ovet, alustat,
   koneet — saa katsoa paikallaan, eikä testatessa tarvitse katsella sitä että
   taksi ajelehtii seinään sillä välin kun lukee mittoja. Tauko on kytkin
   säätöpaneelissa, K näppäimistöllä ja arvo portaalin kytkimessä, ja kaikki
   kolme näyttävät saman tilan.

   runT ei kulje tauolla, koska update jää väliin — siis tippimittari, ovet ja
   koristeet pysähtyvät samaan hetkeen eikä mikään hyppää jatkettaessa. */
let paused = false;

function setPaused(on) {
  on = !!on;
  if (on === paused) return;                 // myös silmukan katkaisu: portaali
  paused = on;                               // vastaa omaan pyyntöömme samalla arvolla
  if (on) jetLevel(0);                       // suuttimen ääni ei jää soimaan
  if (!panelEl.classList.contains('hidden')) buildPanel();
  setPortal('pause', on);
}

function togglePause() { setPaused(!paused); }

function togglePanel() {
  const want = !panelOpen();
  /* Kehyksessä debug on portaalin myönnettävä eikä pelin otettava: pyydä ja
     piirrä vastauksesta, niin kuin kielessäkin. Tekijän sivulla portaali vastaa
     ja paneeli avautuu; julkaistulla sivulla pyyntö kuolee hiljaa, eikä P
     avaa säätimiä joiden arvoja kukaan ei siellä saa tallentaa. Pelin omassa
     osoitteessa ei ole portaalia kysyttäväksi, joten siellä P tekee työn itse. */
  if (portal.embedded) { setPortal('debug', want); return; }
  setPanel(want);
}

/* ------------------------------------------------------------------ valikko
 *
 * Pelaajan asetukset. Alanurkan ratas avaa tämän, ja kaikki mitä pelaaja saa
 * säätää on täällä. Ennen nurkassa oli kolme kuvaketta — ääni, säädöt, koko
 * ruutu — ja kaikki muu oli vain kehittäjän paneelissa, jonne pelaaja ei pääse
 * lainkaan.
 *
 * DOMia eikä kangasta, koska tämä on lomake eikä peliä: kosketusalueet,
 * rivitys ja vieritys tulevat selaimelta ilmaiseksi. Tyylit ovat tässä eivätkä
 * style.css:ssä, jotta valikko on yksi pala jonka voi lukea ja siirtää
 * koskematta toiseen tiedostoon.
 *
 * Peli menee tauolle valikon ajaksi, samasta syystä kuin luonnostyökalussa:
 * taksi ajelehtii seinään sillä välin kun asetuksia luetaan. Tauko puretaan
 * vain jos valikko sen asetti — jos peli oli jo tauolla, se jää tauolle. */
let menuEl = null, menuPaused = false;
/* Napit riveittäin ohjainta varten, ja mihin kohtaan se osoittaa. menuPad
   kertoo onko valikkoa ylipäätään koskettu ohjaimella: hiirellä avattuna
   kehys ensimmäisen napin ympärillä näyttäisi siltä että jotain on valittu. */
let menuGrid = [], menuAt = { r: 0, c: 0 }, menuPad = false;

const menuOpen = () => !!menuEl && menuEl.style.display !== 'none';
const css = (node, style) => { Object.assign(node.style, style); return node; };
const MENU_FONT = '500 15px/1.5 system-ui, -apple-system, sans-serif';

function menuNode() {
  if (menuEl) return menuEl;
  menuEl = css(el('div'), {
    position: 'fixed', inset: '0', zIndex: '40', display: 'none',
    alignItems: 'center', justifyContent: 'center',
    padding: '16px', boxSizing: 'border-box',
    background: 'rgba(5,9,22,.72)', backdropFilter: 'blur(3px)',
    font: MENU_FONT, color: '#e9edff',
    /* Valikko asuu #hudissa kortin vieressä, ja #hud on pointer-events: none
       jotta ohjaussauva saa kosketukset kortin ulkopuolelta. Ilman tätä riviä
       valikko näkyy mutta ei ota osumia: napit ovat kuvia ja painallukset
       menevät läpi kankaalle. Kortti tekee saman asian style.css:ssä. */
    pointerEvents: 'auto',
  });
  menuEl.id = 'menu';
  /* Taustan painallus sulkee. Kohde on tarkistettava, koska nappien painallukset
     kuplivat tänne asti. */
  menuEl.addEventListener('pointerdown', e => { if (e.target === menuEl) closeMenu(); });
  /* Koko ruutu vaihtuu vasta selaimen ehdoilla, joten napin tila piirretään
     vastauksesta eikä toiveesta. */
  const sync = () => { if (menuOpen()) buildMenu(); };
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  (card.parentElement || document.body).append(menuEl);
  return menuEl;
}

function mpick(on, text, fn) {
  return css(pbutton(null, text, fn), {
    font: MENU_FONT, padding: '7px 13px', borderRadius: '9px', cursor: 'pointer',
    border: on ? '1px solid #6fe3ff' : '1px solid rgba(159,176,216,.35)',
    background: on ? 'rgba(111,227,255,.16)' : 'rgba(255,255,255,.04)',
    color: on ? '#6fe3ff' : '#e9edff',
  });
}

function mrow(label, ...picks) {
  menuGrid.push(picks);
  const row = css(el('div'), {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '10px', flexWrap: 'wrap', margin: '0 0 14px',
  });
  const seg = css(el('div'), { display: 'flex', gap: '6px', flexWrap: 'wrap' });
  seg.append(...picks);
  row.append(css(el('span', null, label), { color: '#9fb0d8' }), seg);
  return row;
}

/* Kehys kohdistetun napin ympärille. Fokus on oikea DOM-fokus, jolloin sama
   navigointi toimii myös näppäimistöltä ja selain hoitaa vierityksen. */
function menuFocus() {
  for (const row of menuGrid) for (const b of row) { b.style.outline = ''; b.style.outlineOffset = ''; }
  if (!menuPad || !menuGrid.length) return;
  menuAt.r = clamp(menuAt.r, 0, menuGrid.length - 1);
  menuAt.c = clamp(menuAt.c, 0, menuGrid[menuAt.r].length - 1);
  const b = menuGrid[menuAt.r][menuAt.c];
  if (!b) return;
  b.style.outline = '2px solid #ffd479';
  b.style.outlineOffset = '2px';
  try { b.focus({ preventScroll: false }); } catch (e) {}
}

function buildMenu() {
  menuGrid = [];
  const box = css(el('div'), {
    width: 'min(380px, 100%)', maxHeight: '100%', overflowY: 'auto',
    boxSizing: 'border-box', padding: '20px 22px 16px', borderRadius: '16px',
    background: '#0b1226', border: '1px solid rgba(120,160,255,.25)',
    boxShadow: '0 18px 60px rgba(0,0,0,.55)',
  });
  box.append(css(el('h2', null, t('set.title')), {
    margin: '0 0 18px', font: '700 20px system-ui, sans-serif', letterSpacing: '.05em',
  }));

  box.append(mrow(t('set.diff'), ...DIFFS.map(d =>
    mpick(diff === d.id, t('set.diff.' + d.id), () => { setDiff(d.id); buildMenu(); }))));
  box.append(css(el('p', null, t('set.diffHint')), {
    margin: '-8px 0 16px', font: '500 12px/1.5 system-ui, sans-serif',
    color: 'rgba(233,237,255,.45)',
  }));

  box.append(mrow(t('set.sound'),
    mpick(!muted, t('set.on'), () => { if (muted) toggleMute(); buildMenu(); }),
    mpick(muted, t('set.off'), () => { if (!muted) toggleMute(); buildMenu(); })));

  box.append(mrow(t('set.side'),
    mpick(touchBtns && gearSide === 'left', t('set.left'),
      () => { setTouch(true); setSide('left'); buildMenu(); }),
    mpick(touchBtns && gearSide === 'right', t('set.right'),
      () => { setTouch(true); setSide('right'); buildMenu(); }),
    mpick(!touchBtns, t('set.off'), () => { setTouch(false); buildMenu(); })));

  box.append(mrow(t('set.lang'),
    mpick(LANG === 'fi', 'suomi', () => { applyLang('fi'); setPortal('lang', 'fi'); buildMenu(); }),
    mpick(LANG === 'en', 'english', () => { applyLang('en'); setPortal('lang', 'en'); buildMenu(); })));

  box.append(mrow(t('set.screen'),
    mpick(!fsElement(), t('set.window'), () => { if (fsElement()) toggleFullscreen(); }),
    mpick(!!fsElement(), t('set.full'), () => { if (!fsElement()) toggleFullscreen(); })));

  const foot = css(el('div'), { display: 'flex', justifyContent: 'flex-end', marginTop: '6px' });
  const close = css(pbutton(null, t('set.close'), closeMenu), {
    font: '600 15px system-ui, sans-serif', padding: '9px 20px', borderRadius: '10px',
    cursor: 'pointer', border: '1px solid rgba(111,227,255,.5)',
    background: 'rgba(111,227,255,.14)', color: '#6fe3ff',
  });
  menuGrid.push([close]);
  foot.append(close);
  box.append(foot);

  menuNode().replaceChildren(box);
  menuFocus();
}

function openMenu(byPad) {
  if (menuOpen()) return;
  menuPad = !!byPad;
  menuAt.r = 0; menuAt.c = 0;
  buildMenu();
  menuNode().style.display = 'flex';
  for (const k of Object.keys(KEY)) KEY[k] = false;   // pohjaan jäänyt näppäin ei jää päälle
  menuPaused = (state === PLAY || state === ENTER) && !paused;
  if (menuPaused) setPaused(true);
}

function closeMenu() {
  if (!menuOpen()) return;
  menuPad = false;
  menuEl.style.display = 'none';
  if (menuPaused) setPaused(false);
  menuPaused = false;
}

/* ------------------------------------------------------------------ kortti */
function hideCard() {
  clearTimeout(endTimer);
  card.classList.add('hidden');
  card.style.transition = '';
  card.style.opacity = '';
}

function showCard(html, pending, meta, fade) {
  card.classList.remove('hidden');
  card.innerHTML = html;
  cardPad = false; cardAt = 0;                 // uusi ruutu, uusi kohdistus
  if (fade) {                                // häivytys tähtien päälle
    card.style.transition = 'none';
    card.style.opacity = '0';
    requestAnimationFrame(() => {
      card.style.transition = 'opacity .9s ease';
      card.style.opacity = '1';
    });
  } else {
    card.style.transition = '';
    card.style.opacity = '';
  }
  const lb = card.querySelector('#lb');
  if (lb) mountBoard(lb, pending || 0, meta);
  const go = card.querySelector('#go');
  if (go) go.addEventListener('click', start);
  const buy = card.querySelector('#buy');
  if (buy) buy.addEventListener('click', () => buyTaxis(1, TAXI_PRICE));
  const fleet = card.querySelector('#fleet');
  if (fleet) fleet.addEventListener('click', () => buyTaxis(FLEET_COUNT, FLEET_PRICE));
  const end = card.querySelector('#end');
  if (end) end.addEventListener('click', () => gameOver(false));
  const set = card.querySelector('#set');
  if (set) set.addEventListener('click', togglePanel);
  const fs = card.querySelector('#fs');
  if (fs) fs.addEventListener('click', toggleFullscreen);
  const opt = card.querySelector('#opt');
  if (opt) opt.addEventListener('click', openMenu);
}

const buttons = label => `
  <button id="go" class="btn">${label}</button>
  <button id="opt" class="btn ghost">${t('card.opt')}</button>
  ${debugAllowed() ? `<button id="set" class="btn ghost">${t('card.tune')}</button>` : ''}
  <p class="hint">${t('card.keys')}</p>
  <p class="hint" id="padstate"></p>`;

const menuCard = () => `
  <h1>${t('menu.t1')} <span>${t('menu.t2')}</span></h1>
  <p>${t('menu.p1')}</p>
  <p>${t('menu.p2')}</p>
  <p>${t('menu.p3', { bonus: CLEAN_BONUS, levels: LEVELS.length, price: TAXI_PRICE, fleet: FLEET_PRICE })}</p>
  <p class="hint">${t('menu.hint')}</p>
  <div id="lb"></div>
  ${buttons(t('card.play'))}`;

const buyCard = () => `
  <h1>${t('buy.t1')} <span>${t('buy.t2')}</span></h1>
  <div class="big">${Math.floor(money)} €</div>
  <p>${t('buy.p')}</p>
  <button id="buy" class="btn">${t('buy.one', { p: TAXI_PRICE })}</button>
  ${money >= FLEET_PRICE
    ? `<button id="fleet" class="btn">${t('buy.fleet', { c: FLEET_COUNT, p: FLEET_PRICE })}</button>`
    : ''}
  <button id="end" class="btn ghost">${t('buy.end')}</button>
  <p class="hint">${t('buy.keys')}</p>
  <p class="hint" id="padstate"></p>`;

const overWon = () => `
  <h1>${t('won.t1')} <span>${t('won.t2')}</span></h1>
  <div class="big">${Math.round(money)} €</div>
  <p>${t('won.p', { levels: LEVELS.length, secs: Math.round(runT), taxis: Math.max(0, lives) })}</p>
  <div id="lb"></div>
  ${buttons(t('card.again'))}`;

const overLost = () => `
  <h1>${t('lost.t1')} <span>${t('lost.t2')}</span></h1>
  <div class="big">${Math.round(money)} €</div>
  <p>${t('lost.p', { i: levelIndex + 1, t: LEVELS.length, name: level.name, secs: Math.round(runT) })}</p>
  <p class="hint">${t('lost.hint')}</p>
  <div id="lb"></div>
  ${buttons(t('card.again'))}`;

function start() {
  warmSpeech();
  money = 40; lives = 3; runT = 0;
  bag = []; lastKind = -1;
  cut = null; carried = null; hyper = null;
  runDeaths = 0; runRuns = 0;
  beginLevel(0, true);
}

function startLevel(i) {
  warmSpeech();
  dev.level = i;
  saveDev();
  watchTag = null;                           // eri kenttä, eri tiedosto
  money = 40; lives = 3; runT = 0;
  bag = []; lastKind = -1;
  cut = null; carried = null; hyper = null;
  runDeaths = 0; runRuns = 0;
  beginLevel(i, true);
}

newRun();                                  // valikon takana näkyy oikea kenttä
showCard(menuCard(), 0, null);

/* Takaisin siihen mistä edellinen lataus jäi. Vain tekijälle: debugAllowed on
   kehyksessä portaalin myöntämä, ja julkaistulla sivulla tätä ei tapahdu
   vaikka avaimet sattuisivat olemaan selaimessa. */
function restoreDev() {
  devReady = true;
  if (!debugAllowed()) return;
  /* Vartija ensin: kaikki muu täällä kutsuu saveDeviä, ja saveDev lukee
     vartijan tilan — käynnistämätön vartija tallentuisi pois päältä. */
  if (dev.level >= 0 && dev.level < LEVELS.length) startLevel(dev.level);
  if (dev.panel) { if (portal.embedded) setPortal('debug', true); else setPanel(true); }
  if (dev.sketch) Promise.resolve(sketch.open()).then(refreshPanel);
  setWatch(wantWatch());
}

/* Kieli, kummasta päästä tahansa.
 *
 * Portaali on sivu pelin ympärillä ja sillä on omat lippunsa. Ilman tätä ne ja
 * säätöpaneelin kielivalinta ovat kaksi kytkintä samalle asialle, ja kaksi
 * kytkintä on kaksi paikkaa jotka ennen pitkää ovat eri mieltä.
 *
 * Kehyksettömänä ei kuunnella lainkaan: silloin portal.lang on selaimen kielestä
 * tehty arvaus, ja i18n.js:n oma päättely tietää enemmän — se muistaa mitä
 * pelaaja on aiemmin valinnut. Kehyksessä portaali tietää enemmän kuin kumpikaan,
 * koska se on se kieli jolla ihminen juuri katsoo sivua. Se on sama paikka jonka
 * i18n.js:n kommentti varasi ?lang-parametrille. */
function applyLang(code) {
  if (code === LANG) return;
  setLang(code);
  if (state === MENU) showCard(menuCard(), 0, null);
  if (!panelEl.classList.contains('hidden')) buildPanel();
}

if (portal.embedded) {
  /* Vasta vastauksen jälkeen: ennen sitä portal.lang on arvaus, ja arvaus ei saa
     jyrätä pelaajan aiempaa valintaa. onPortal ajaa käsittelijän heti nykyisellä
     arvolla, joten tilaaminen tässä riittää eikä erillistä lukua tarvita. */
  portal.ready.then(() => {
    onPortal('lang', applyLang);
    /* Säädöt ovat tämän pelin dev-näkymä — kenttähyppy, viritys, kieli — ja
       portaalin kytkin avaa sen samoin kuin P. Kehyksessä P vaatii että fokus on
       pelissä, kytkin ei vaadi mitään. */
    onPortal('debug', setPanel);
    /* canWrite ratkaisee näkyykö ratas ja kortin nappi, ja se saapuu vasta
       tässä — kortti on jo ruudulla, joten se piirretään uusiksi. */
    /* Tauko myös portaalista: kehyksessä pelin oma näppäin vaatii fokuksen,
       sivun kytkin ei vaadi mitään. Kumpikin kirjoittaa samaan arvoon, ja
       setPaused palaa heti jos arvo on jo se — silmukkaa ei synny. */
    onPortal('pause', setPaused);
    onPortal('canWrite', () => { if (state === MENU) showCard(menuCard(), 0, null); });
    restoreDev();                            // vasta kun canWrite on tiedossa
  });
} else {
  restoreDev();
}

/* Liput osoitteesta: ?debug=1 säätöpaneeli, ?test=1 pompputesti, ?lang=fi|en. */
try {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of q) {
    const key = k.toLowerCase();
    const on = v !== '0' && v !== 'false';
    if (key === 'debug' && on && !panelOpen()) togglePanel();
    if (key === 'test' && on) import('./bouncetest.js').then(m => m.run(P)).catch(() => {});
  }
} catch (e) {}

/* -------------------------------------------------------------------- loop */
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  resize();
  padInput();
  paintGraphs();                               // vain auki olevaan paneeliin

  /* Tauolla piirretään sama ruutu uudestaan ilman päivitystä. Vain lennon
     aikana: valikossa ja välianimaatiossa taukoa ei ole mitä pitää. */
  if (paused && (state === PLAY || state === ENTER)) {
    draw({ x: 0, y: 0 });
    pauseBadge();
    requestAnimationFrame(loop);
    return;
  }

  if (state === CUT) {
    cut.update(dt);
    jetLevel(0.45);
    if (cut.done) {
      jetLevel(0);
      const nextIndex = cut.idx;
      cut = null;
      if (nextIndex === null) gameOver(true);   // vuoron viimeinen ruutu ohi
      else beginLevel(nextIndex, false);
    } else {
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      cut.draw(ctx);
      requestAnimationFrame(loop);
      return;
    }
  }

  if (state === ENTER) {
    updateEnter(dt);
    /* Miinus, koska luukusta tuleva taksi **jarruttaa**: se hidastaa
       putoamistaan, ja jarrutus on alasuuttimien työtä. Plussalla liekki
       piirtyi katolle, mikä näytti siltä että taksi kiihdyttää alaspäin
       samalla kun se hidastuu. Sami 23.9.2026: *"yksi asia on häirinnyt
       pitkään."* */
    draw({ x: 0, y: -clamp(1 - taxi.vy / 300, 0.25, 1) });
    requestAnimationFrame(loop);
    return;
  }

  if (state === OVER && hyper) {               // loppuruudun tausta
    hyper.update(dt);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    hyper.draw(ctx);
    requestAnimationFrame(loop);
    return;
  }

  const v = activeThrust();
  if (state === PLAY) update(dt);
  else stepBits(dt);

  draw(v);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
