/* Kentät.
 *
 * Yksi kenttä on data plus valinnainen pala koodia. Data riittää tavallisiin
 * kenttiin; koukut ovat sitä varten että alkuperäisen tapaan mekaniikka voi
 * vaihtua kesken pelin — glitch-kenttä jossa suunnat sekoavat, kenttä jossa
 * suuttimet laukeavat itsestään, ja niin edelleen. Mikään koukku ei ole
 * pakollinen.
 *
 * Kentän kentät:
 *   name        näkyy HUDissa, aloituksessa ja välianimaatiossa
 *   glow        luukun hehkun ja kentän tunnusväri
 *   sky         taustan gradientti ylhäältä alas, 2–4 väriä; puuttuessa avaruus
 *   sun         valinnainen {x, y, r, color} — hehkuva kiekko taustalle
 *   gate        {x, w} aukko katossa; kehäseinät peli lisää itse
 *   walls       sisäseinät: {x, y, w, h, win?} — win piirtää ikkunarivit
 *   pads        {id, x, y, w, h, fuel?, move?}
 *               id 0 = tankkaus, muut numeroidut alustat
 *               move {x, y, secs, phase} heiluttaa alustaa; taksi, odottava
 *               asiakas ja hautakivet kulkevat mukana
 *   start       alusta jolle taksi palaa kolarin jälkeen
 *   firstFrom   alusta jolle ensimmäinen asiakas ilmestyy
 *
 * Kenttä alkaa aina ilmasta: taksi tulee sisään katon luukusta, jarruttaa
 * paikalleen, luukku sulkeutuu ja peli käynnistyy READY–GO:lla.
 *
 * Koukut (kaikki valinnaisia), api = {P, taxi, pads, walls, t, rand, say}:
 *   init(api)                 kentän alussa
 *   update(dt, api)           joka ruudulla ennen fysiikkaa
 *   input(vec, api) -> vec    ohjausvektorin muokkaus ennen suuttimia
 *   drawBack(ctx, api)        taustan päälle, seinien alle
 *   drawFront(ctx, api)       kaiken päälle, HUDin alle
 */

export const LEVELS = [
  {
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
  },

  {
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
  },
];
