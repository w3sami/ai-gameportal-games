/* Pompun malli omana moduulinaan, jotta sen voi ajaa ilman peliä.
 *
 * Idea: kovaa tullut lasku ei tapa heti. Ylitys lasketaan suhteessa sallittuun
 * lasku­nopeuteen, ja siitä nostetaan taksi takaisin ylös — vauhti hidastuu
 * itsestään painovoimassa, joten pomppujen määrää ei tarvitse laskea erikseen.
 * Se putoaa ulos kertoimesta: palautuva osuus (bounceRest) ratkaisee montako
 * kertaa pomppu ylittää vielä laskurajan. Yli bounceMax-kertaisesta ylityksestä
 * ei pompita vaan kolaroidaan.
 *
 * Koska nousu ja lasku ovat symmetrisiä samassa painovoimassa, seuraavan
 * osuman nopeus on täsmälleen se jolla lähdettiin ylös. Siksi ketjun voi
 * laskea ilman integrointia — ja siksi tämä on testattavissa suoraan.
 */

/** Nopeus jolla taksi lähtee ylös osumasta, joka tuli nopeudella vy. */
export function bounceVelocity(vy, P) {
  const floor = Math.min(140, P.landVY * 0.8);   // pomppu näkyy aina edes vähän
  return Math.max(vy * P.bounceRest, floor);
}

/** Koko ketju kerralla: montako pomppua ennen kuin taksi asettuu tai hajoaa. */
export function bounceChain(vy, P, max = 12) {
  const steps = [];
  let v = vy;
  for (let n = 0; n < max; n++) {
    const ratio = v / P.landVY;
    if (ratio <= 1) return { bounces: n, outcome: 'lasku', steps };
    if (ratio > P.bounceMax) return { bounces: n, outcome: 'kolari', steps };
    v = bounceVelocity(v, P);
    steps.push(Math.round(v));
  }
  return { bounces: max, outcome: 'ei asetu', steps };
}
