/* Intro — ensimmäinen kenttä.
 *
 * Yksi kenttä per tiedosto, jotta kaksi tekijää voi työstää eri kenttiä
 * yhtä aikaa kirjoittamatta toistensa yli. Kentän muoto on kuvattu
 * ../levels.js:ssä.
 */

export const intro = {
  name: 'Intro',
  glow: '#6fe3ff',
  gate: { x: 300, w: 120 },
  start: 1,
  firstFrom: 2,
  walls: [
    { x: 16, y: 300, w: 214, h: 20 },      // hylly vasemmalla
    { x: 540, y: 640, w: 164, h: 20 },     // hylly oikealla
    { x: 16, y: 800, w: 184, h: 20 },      // hylly vasemmalla alhaalla
  ],
  pads: [
    { id: 1, x: 250, y: 950, w: 210, h: 18 },
    { id: 2, x: 490, y: 300, w: 214, h: 18 },
    { id: 0, x: 285, y: 640, w: 150, h: 18, fuel: true },
  ],
};
