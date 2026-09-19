/* Pompputesti. Ajetaan ?test=1 -lipulla, tulostaa taulukon konsoliin.
 *
 * Väite: jokainen ylitys 1x...bounceMax-välillä asettuu 1–3 pompun jälkeen, ja
 * sen yli mennään suoraan kolariin. Jos tämä menee rikki kun bounceRest- tai
 * landVY-arvoa säätää, se näkyy tässä ennen kuin se näkyy pelissä.
 */
import { bounceChain } from './bounce.js';

export function run(P) {
  const rows = [];
  let bad = 0;

  for (let r = 1.1; r <= P.bounceMax + 0.4; r = +(r + 0.2).toFixed(2)) {
    const vy = r * P.landVY;
    const res = bounceChain(vy, P);
    const expectCrash = r > P.bounceMax;
    const ok = expectCrash
      ? res.outcome === 'kolari'
      : res.outcome === 'lasku' && res.bounces >= 1 && res.bounces <= 3;
    if (!ok) bad++;
    rows.push({
      'ylitys': r.toFixed(1) + 'x',
      'vy': Math.round(vy),
      'pomppuja': res.bounces,
      'ketju': res.steps.join(' → '),
      'lopputulos': res.outcome,
      'ok': ok ? '✓' : '✗',
    });
  }

  console.group('Space Taxi · pompputesti');
  console.log('landVY', P.landVY, '· bounceRest', P.bounceRest, '· bounceMax', P.bounceMax);
  console.table(rows);
  console.log(bad === 0
    ? 'kaikki ylitykset asettuvat 1–3 pompussa, ja yli rajan tulee kolari'
    : `${bad} riviä haarukan ulkopuolella — säädä bounceRest tai landVY`);
  console.groupEnd();
  return bad;
}
