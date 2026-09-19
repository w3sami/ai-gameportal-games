/* Highrise — kaksi tornitaloa.
 *
 * Yksi kenttä per tiedosto, jotta kaksi tekijää voi työstää eri kenttiä
 * yhtä aikaa kirjoittamatta toistensa yli. Kentän muoto on kuvattu
 * ../levels.js:ssä.
 */

export const highrise = {
  /* Kaksi tornitaloa reunoissa, parvekkeet alustoina. Parvekkeet ovat 165 px
     leveitä — kakkoskenttä saa olla anteeksiantava — ja tornit on kavennettu
     80 pikseliin, jotta väliin jää silti 198 px lentotilaa. Vasemmalla kaksi
     parveketta ja tankkaus, oikealla kolme. Tausta on auringonlasku. */
  name: 'Highrise',
  glow: '#ffb45e',
  sky: ['#221a4a', '#6d3352', '#c85f34', '#f0a04a'],
  sun: { x: 360, y: 1000, r: 210, color: '#ffd089' },
  gate: { x: 300, w: 120 },
  start: 1,
  firstFrom: 3,
  walls: [
    { x: 16, y: 200, w: 80, h: 824, win: true },     // vasen torni
    { x: 624, y: 150, w: 80, h: 874, win: true },    // oikea torni
  ],
  pads: [
    { id: 1, x: 96, y: 880, w: 165, h: 16 },
    { id: 2, x: 96, y: 600, w: 165, h: 16 },
    { id: 0, x: 96, y: 340, w: 165, h: 16, fuel: true },
    { id: 3, x: 459, y: 790, w: 165, h: 16 },
    { id: 4, x: 459, y: 520, w: 165, h: 16 },
    { id: 5, x: 459, y: 250, w: 165, h: 16 },
  ],
};
