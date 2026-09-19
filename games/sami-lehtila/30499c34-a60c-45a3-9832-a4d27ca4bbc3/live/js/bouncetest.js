/* Pompputesti. Ajetaan ?test=1 -lipulla tai paneelin napista.
 *
 * Väitteet:
 *   - alle bounceFrom-rajan ei pompita lainkaan
 *   - bounceFrom...1 välillä asettuu 1–3 pompun jälkeen
 *   - yli laskurajan tulee kolari
 *
 * Jos tämä menee rikki kun bounceKeep-, bounceLift- tai landVY-arvoa säätää,
 * se näkyy tässä ennen kuin se näkyy pelissä.
 */
import { bounceChain } from './bounce.js';

export function run(P) {
  const rows = [];
  let bad = 0;

  for (let r = 0.3; r <= 1.25; r = +(r + 0.05).toFixed(2)) {
    const vy = r * P.landVY;
    const res = bounceChain(vy, P);
    let ok;
    if (r > 1) ok = res.outcome === 'kolari';
    else if (r <= P.bounceFrom) ok = res.outcome === 'lasku' && res.bounces === 0;
    else ok = res.outcome === 'lasku' && res.bounces >= 1 && res.bounces <= 3;
    if (!ok) bad++;
    rows.push({
      'ylitys': r.toFixed(2) + 'x',
      'vy': Math.round(vy),
      'pomppuja': res.bounces,
      'ketju': res.steps.join('  ·  '),
      'lopputulos': res.outcome,
      'ok': ok ? '✓' : '✗',
    });
  }

  console.group('Space Taxi · pompputesti');
  console.log(
    'landVY', P.landVY,
    '· bounceFrom', P.bounceFrom,
    '· bounceLift', P.bounceLift,
    '· bounceKeep', P.bounceKeep,
    '· grav', P.grav,
  );
  console.table(rows);
  console.log(bad === 0
    ? 'rajan alla ei pomppuja, rajalle asti 1–3 pomppua, yli rajan kolari'
    : `${bad} riviä ulkona — säädä bounceKeep tai bounceLift`);
  console.groupEnd();
  return bad;
}
