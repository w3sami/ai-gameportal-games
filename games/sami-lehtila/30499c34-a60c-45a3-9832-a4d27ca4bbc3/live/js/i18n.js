/* Kielet ja puheäänet.
 *
 * Portaali ei (ainakaan vielä) kerro pelille valittua kieltä: peli ajetaan
 * iframessa eri aliverkkotunnuksessa, joten parent-ikkunaa ei voi lukea. Siksi
 * kieli päätellään tässä järjestyksessä:
 *
 *   1. ?lang=fi / ?lang=en osoitteessa — tämän portaali voi lisätä iframen
 *      URLiin ilman muutoksia peliin
 *   2. aiemmin valittu kieli localStoragessa
 *   3. selaimen kieli (navigator.languages)
 *   4. englanti
 *
 * Jos portaali haluaa myöhemmin kertoa kielen postMessagella, se on yhden
 * kuuntelijan lisäys: setLang(msg.lang).
 *
 * Puhe menee suomeksi vain jos laitteelta löytyy suomenkielinen ääni.
 * Muuten puhutaan englanniksi, koska englantilainen ääni suomenkielisellä
 * tekstillä kuulostaa hölmöltä. say.*-rivit ovat ilman pilkkuja, koska
 * puhesyntetisaattori pitää pilkussa tauon eikä asiakkaalla ole aikaa
 * dramaattisiin taukoihin.
 */

const LS = 'spacetaxi.lang';

function resolve() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q) return q.toLowerCase().startsWith('fi') ? 'fi' : 'en';
  } catch (e) {}
  try {
    const s = localStorage.getItem(LS);
    if (s === 'fi' || s === 'en') return s;
  } catch (e) {}
  const n = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  return String(n).toLowerCase().startsWith('fi') ? 'fi' : 'en';
}

export let LANG = resolve();

export function setLang(l) {
  LANG = String(l).toLowerCase().startsWith('fi') ? 'fi' : 'en';
  try { localStorage.setItem(LS, LANG); } catch (e) {}
  return LANG;
}

/* --------------------------------------------------------------- äänet */
let voices = [];
function refreshVoices() {
  try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
}
if ('speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
}

/** Palauttaa kielen mukaisen äänen tai null jos sellaista ei ole. */
export function voiceFor(lang) {
  if (!voices.length) refreshVoices();
  return voices.find(v => String(v.lang).toLowerCase().startsWith(lang)) || null;
}

/* --------------------------------------------------------------- tekstit */
const STR = {
  fi: {
    'ui.fuel': 'POLTTOAINE',
    'ui.exit': 'ulos ylhäältä',
    'ui.pads': 'alustat {d}/{t}',
    'ui.meterUp': 'MITTARI  →  ULOS',
    'ui.meterPad': 'MITTARI  →  ALUSTA {n}',
    'ui.ready': 'READY',
    'ui.go': 'GO!',
    'ui.gearDown': 'TELINE ALHAALLA',
    'ui.gearUp': 'TELINE YLHÄÄLLÄ',
    'ui.tooFast': 'LIIAN KOVAA',
    'ui.horn': 'TÖÖT',

    'msg.hey': 'Hei, taksi!',
    'msg.toPad': 'Alusta {n}, {tail}',
    'msg.up': 'Ylös, kiitos!',
    'msg.thanks': 'Kiitos! {fare} € (tippi {tip} €)',
    'msg.oops': 'Hups.',
    'msg.dry': 'Tankki kuiva!',
    'msg.coming': 'Hei! Tulossa ollaan.',

    'say.hey': 'Hei taksi',
    'say.toPad': 'Alusta {n} {tail}',
    'say.up': 'Ylös kiitos',
    'say.tail.please': 'kiitos',
    'say.tail.kind': 'ole hyvä',
    'say.tail.quick': 'vähän äkkiä',
    'say.tail.hurry': 'nopeasti jo',
    'say.tail.go': 'mene mene mene',
    'say.tail.rush': 'kiireellä',
    'say.thanks': 'Kiitos',

    'cut.level': 'KENTTÄ {i} / {t}',
    'cut.clear': '{name} SELVÄ',
    'cut.pads': 'alustat {n}',
    'cut.earned': 'kentästä {n} €',
    'cut.crashes': 'kolarit {n}',
    'cut.crashesClean': 'kolarit 0  +{b} €',
    'cut.runs': 'yliajot {n}',
    'cut.runsClean': 'yliajot 0  +{b} €',
    'cut.cash': 'kassa {n} €',
    'cut.shift': 'VUORO SUORITETTU',
    'cut.levels': 'kentät {n}',
    'cut.time': 'aika {n} s',
    'cut.taxis': 'taksit ehjänä {n}',

    'card.play': 'Aja vuoro',
    'card.again': 'Uusi vuoro',
    'card.full': 'Koko ruutu',
    'card.tune': 'Säädöt',
    'menu.t1': 'Space', 'menu.t2': 'Taxi',
    'menu.p1': 'Nosta alien kyytiin ja vie hänet pyydetylle alustalle. Syaani alusta on kohde, punaiset eivät, ja vihreä pallo kertoo että siellä on jo käyty — sekä nouto että jättö merkkaa alustan. Mitä nopeammin ja pehmeämmin, sitä isompi tippi, ja laskeudu viereen, älä päälle.',
    'menu.p2': '<b>Laskuteline pitää laskea ennen kosketusta</b> — ja alhaalla se sammuttaa sivusuuttimet, joten nosta se heti lähdössä. Matala piippaus varoittaa bensasta, korkea ja tiheä siitä että teline on alhaalla mutta vauhti hajottaisi taksin.',
    'menu.p3': 'Töötti kuuluu lähelle: jos asiakas kuulee sen, hän siirtyy alustan toiseen laitaan. Keltainen alusta on tankkaus, ja bensa maksaa omasta kassasta. Kentästä ilman kolareita tai ilman yliajoja maksetaan {bonus} euron bonus kummastakin. {levels} kenttää, ja varikolta saa uuden taksin {price} eurolla tai kolme {fleet} eurolla.',
    'menu.hint': '<b>Kosketus:</b> vedä mistä tahansa ruudulta — ohjainsauva on käytössä sormen alla. Isot napit ovat teline ja töötti, ratas avaa säädöt ja nuoli koko ruudun.<br><b>Näppäimet:</b> <kbd>WASD</kbd>/nuolet &middot; teline <kbd>väli</kbd> &middot; töötti <kbd>shift</kbd> &middot; säädöt <kbd>P</kbd> &middot; koko ruutu <kbd>F</kbd> &middot; äänet <kbd>M</kbd><br><b>Ohjain:</b> vasen sauva ohjaa &middot; teline <kbd>A</kbd> &middot; töötti <kbd>B</kbd> &middot; aja <kbd>Start</kbd> &middot; äänet <kbd>Back</kbd>',

    'buy.t1': 'Taksi', 'buy.t2': 'hajosi',
    'buy.p': 'Kenttä jatkuu siitä mihin jäit: käydyt alustat ja odottava asiakas säilyvät. Kolmen erä tulee halvemmaksi per auto, mutta sitoo rahaa joka olisi voinut jäädä tulokseen.',
    'buy.one': 'Yksi taksi ({p} €)',
    'buy.fleet': '{c} taksia ({p} €)',
    'buy.end': 'Lopeta vuoro',
    'buy.keys': 'Näppäimet: <kbd>1</kbd> yksi &middot; <kbd>3</kbd> kolme &middot; <kbd>esc</kbd> lopeta',

    'won.t1': 'Vuoro', 'won.t2': 'suoritettu',
    'won.p': 'Kaikki {levels} kenttää ajettu — {secs} sekuntia, {taxis} taksia ehjänä.',
    'lost.t1': 'Taksit', 'lost.t2': 'loppu',
    'lost.p': 'Vuoro katkesi kentällä {i}/{t} ({name}), {secs} sekunnin kohdalla.',
    'lost.hint': 'Pehmeä lasku maksaa itsensä takaisin tippinä.',
    'card.keys': 'Näppäimet: <kbd>enter</kbd> aja &middot; <kbd>F</kbd> koko ruutu &middot; <kbd>P</kbd> säädöt',
    'pad.none': 'Ohjainta ei näy. Paina ohjaimen nappia — selain piilottaa ohjaimen siihen asti, ja aina kun ikkuna ei ole päällimmäisenä.',
    'pad.on': 'Ohjain: {id}',
  },

  en: {
    'ui.fuel': 'FUEL',
    'ui.exit': 'exit above',
    'ui.pads': 'pads {d}/{t}',
    'ui.meterUp': 'METER  →  EXIT',
    'ui.meterPad': 'METER  →  PAD {n}',
    'ui.ready': 'READY',
    'ui.go': 'GO!',
    'ui.gearDown': 'GEAR DOWN',
    'ui.gearUp': 'GEAR UP',
    'ui.tooFast': 'TOO FAST',
    'ui.horn': 'HONK',

    'msg.hey': 'Hey, taxi!',
    'msg.toPad': 'Pad {n}, {tail}',
    'msg.up': 'Up, please!',
    'msg.thanks': 'Thanks! {fare} € (tip {tip} €)',
    'msg.oops': 'Oops.',
    'msg.dry': 'Tank is dry!',
    'msg.coming': 'Hey! On my way.',

    'say.hey': 'Hey taxi',
    'say.toPad': 'Pad {n} {tail}',
    'say.up': 'Up please',
    'say.tail.please': 'please',
    'say.tail.kind': 'if you would',
    'say.tail.quick': 'and quickly',
    'say.tail.hurry': 'hurry now',
    'say.tail.go': 'go go go',
    'say.tail.rush': 'in a hurry',
    'say.thanks': 'Thanks',

    'cut.level': 'LEVEL {i} / {t}',
    'cut.clear': '{name} CLEAR',
    'cut.pads': 'pads {n}',
    'cut.earned': 'level pay {n} €',
    'cut.crashes': 'crashes {n}',
    'cut.crashesClean': 'crashes 0  +{b} €',
    'cut.runs': 'run-overs {n}',
    'cut.runsClean': 'run-overs 0  +{b} €',
    'cut.cash': 'cash {n} €',
    'cut.shift': 'SHIFT COMPLETE',
    'cut.levels': 'levels {n}',
    'cut.time': 'time {n} s',
    'cut.taxis': 'taxis intact {n}',

    'card.play': 'Drive a shift',
    'card.again': 'New shift',
    'card.full': 'Fullscreen',
    'card.tune': 'Tuning',
    'menu.t1': 'Space', 'menu.t2': 'Taxi',
    'menu.p1': 'Pick up an alien and fly them to the pad they ask for. Cyan is the target, red pads are not, and a green dot means that pad is already done — both a pickup and a drop-off count. The faster and softer the ride, the bigger the tip, and land beside your passenger, not on them.',
    'menu.p2': '<b>The landing gear has to be down before you touch a pad</b> — and while it is down the side thrusters are dead, so raise it as you leave. A low beep warns about fuel, a high fast one means the gear is down but your speed would wreck the taxi.',
    'menu.p3': 'The horn only carries a short way: if the passenger hears it, they scoot to the other end of the pad. The yellow pad is fuel, and it is paid from your own till. A level with no crashes or no run-overs pays a {bonus} € bonus for each. {levels} levels, and the depot sells one taxi for {price} € or three for {fleet} €.',
    'menu.hint': '<b>Touch:</b> drag anywhere — the stick appears under your thumb. The big buttons are gear and horn, the cog opens tuning and the arrows fullscreen.<br><b>Keys:</b> <kbd>WASD</kbd>/arrows &middot; gear <kbd>space</kbd> &middot; horn <kbd>shift</kbd> &middot; tuning <kbd>P</kbd> &middot; fullscreen <kbd>F</kbd> &middot; sound <kbd>M</kbd><br><b>Controller:</b> left stick steers &middot; gear <kbd>A</kbd> &middot; horn <kbd>B</kbd> &middot; drive <kbd>Start</kbd> &middot; sound <kbd>Back</kbd>',

    'buy.t1': 'Taxi', 'buy.t2': 'wrecked',
    'buy.p': 'The level carries on where you left it: finished pads and the waiting passenger stay put. Three taxis cost less per car, but that money is out of your final score.',
    'buy.one': 'One taxi ({p} €)',
    'buy.fleet': '{c} taxis ({p} €)',
    'buy.end': 'End the shift',
    'buy.keys': 'Keys: <kbd>1</kbd> one &middot; <kbd>3</kbd> three &middot; <kbd>esc</kbd> end',

    'won.t1': 'Shift', 'won.t2': 'complete',
    'won.p': 'All {levels} levels driven — {secs} seconds, {taxis} taxis intact.',
    'lost.t1': 'Out of', 'lost.t2': 'taxis',
    'lost.p': 'The shift ended on level {i}/{t} ({name}) at {secs} seconds.',
    'lost.hint': 'A soft landing pays for itself in tips.',
    'card.keys': 'Keys: <kbd>enter</kbd> drive &middot; <kbd>F</kbd> fullscreen &middot; <kbd>P</kbd> tuning',
    'pad.none': 'No controller visible. Press a button on it — the browser hides one until then, and whenever this window is not the focused one.',
    'pad.on': 'Controller: {id}',
  },
};

/* Puhesyntetisaattori taivuttaa numeromerkin itse ja arvaa suomessa väärin:
   "Alusta 1" luetaan "alusta yhden". Puheeseen menevä alustan numero
   kirjoitetaan siksi sanana. Alustoja on kentässä viisi, mutta lista yltää
   kymmeneen siltä varalta että niitä joskus on enemmän. */
const NUM = {
  fi: ['nolla', 'yksi', 'kaksi', 'kolme', 'neljä', 'viisi', 'kuusi', 'seitsemän', 'kahdeksan', 'yhdeksän', 'kymmenen'],
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
};

/** Luku sanana puhetta varten; listan ulkopuolinen jää numeroksi. */
export function numWord(n, lang) {
  const words = NUM[lang || LANG] || NUM.en;
  return words[n] !== undefined ? words[n] : String(n);
}

/** t('ui.pads', {d: 2, t: 5}) — kolmas parametri pakottaa kielen. */
export function t(key, params, lang) {
  const dict = STR[lang || LANG] || STR.en;
  let s = dict[key];
  if (s === undefined) s = STR.en[key];
  if (s === undefined) return key;
  if (params) {
    for (const k of Object.keys(params)) s = s.split('{' + k + '}').join(params[k]);
  }
  return s;
}
