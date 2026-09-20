/* Kentän mitat samoina kuin game.js:ssä, joka ei vie niitä ulos.
   HATCH menee sekä kentän gate-kenttään että huvipuiston taustamaalaukseen,
   joka leikkaa markiisiin reiän samaan kohtaan — muuten luukusta näkyisi
   kangasta eikä taivasta. */
export const W = 720, H = 1040;
export const CEIL = 16;                     // katon paksuus
export const HATCH = { x: 300, w: 120 };    // luukku katossa

/* Kulissin oma muunnos: siirto, kierto ja skaalaus siinä järjestyksessä.
 *
 * Sama kolmikko samassa järjestyksessä kuin kenttäeditorin (sketchpad-plugin)
 * transformissa ja CSS:n transform-ominaisuudessa, ja **kierto on asteina**
 * kuten niissäkin — luonnostiedosto on luettavaksi, eikä 0,2618 ole luku jonka
 * kukaan lukee. Peilaus ei ole oma kenttänsä vaan negatiivinen skaala.
 *
 * Tämä on tässä eikä tuotuna pluginista siksi, että kenttätiedostot ajetaan
 * myös nodessa: tools/check-grid.mjs tuo kentän moduulina, eikä node hae
 * https-tuonteja. Kenttä ei saa riippua verkosta.
 *
 * Hinta on se, että olio piirretään oman origonsa ympärille — ei
 * ctx.fillRect(o.x - 5, o.y - 4, …) vaan ctx.fillRect(-5, -4, …) tämän
 * sisällä. Se on koko hinta.
 */
export function applyTransform(ctx, o) {
  if (!ctx || !o) return;
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  ctx.translate(num(o.x) ?? 0, num(o.y) ?? 0);
  const rot = num(o.rot);
  if (rot) ctx.rotate(rot * Math.PI / 180);
  const sx = num(o.sx) ?? 1, sy = num(o.sy) ?? 1;
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
}
