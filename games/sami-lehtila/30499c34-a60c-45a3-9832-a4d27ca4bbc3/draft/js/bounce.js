/* Pompun malli omana moduulinaan, jotta sen voi ajaa ilman peliä.
 *
 * Pomppu on teleportti, ei kimmoke. Kosketuksessa taksi siirretään 5–10 px
 * alustan yläpuolelle ja vauhdista jätetään osa jäljelle alaspäin — nostoa ei
 * käännetä ylöspäin lainkaan. Painovoima hoitaa loput: pieneltä korkeudelta
 * pudotessa osuma tulee pienemmällä vauhdilla kuin edellinen, ja ketju
 * sammuu itsestään.
 *
 * Rajat suhteessa laskurajaan (landVY / landVX):
 *   ratio <= bounceFrom   siisti lasku
 *   bounceFrom < r <= 1   pomppu, nosto sitä isompi mitä lähempänä rajaa
 *   ratio > 1             kolari
 *
 * Nosto on 5–10 px: puolet kiinteää, puolet ylityksen mukaan. Siitä seuraa
 * 1–3 pomppua ilman että niitä lasketaan missään — bouncetest.js todistaa sen.
 */

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

/** Kuinka monta pikseliä taksi nostetaan tällä osumalla. */
export function liftFor(ratio, P) {
  const norm = clamp01((ratio - P.bounceFrom) / Math.max(0.01, 1 - P.bounceFrom));
  return P.bounceLift * (0.5 + 0.5 * norm);
}

/** Seuraavan osuman nopeus: jäljelle jäänyt vauhti + pudotus nostosta. */
export function nextImpact(v, lift, P) {
  const kept = Math.max(0, v) * P.bounceKeep;
  return Math.sqrt(kept * kept + 2 * P.grav * lift);
}

/** Koko ketju kerralla: montako pomppua ennen kuin taksi asettuu tai hajoaa. */
export function bounceChain(vy, P, max = 12) {
  const steps = [];
  let v = vy;
  for (let n = 0; n < max; n++) {
    const ratio = v / P.landVY;
    if (ratio > 1) return { bounces: n, outcome: 'kolari', steps };
    if (ratio <= P.bounceFrom) return { bounces: n, outcome: 'lasku', steps };
    const lift = liftFor(ratio, P);
    v = nextImpact(v, lift, P);
    steps.push(`${lift.toFixed(1)}px → ${Math.round(v)}`);
  }
  return { bounces: max, outcome: 'ei asetu', steps };
}
