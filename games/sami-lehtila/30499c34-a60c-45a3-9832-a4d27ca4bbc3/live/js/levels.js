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


/* Kentät ovat omissa tiedostoissaan js/levels/ alla, yksi per kenttä.
   Tämä tiedosto on pelkkä luettelo: sen ainoa tehtävä on kertoa mitkä
   kentät ovat pelissä ja missä järjestyksessä. Kentän muuttaminen ei siis
   koske tätä tiedostoa lainkaan, ja kaksi tekijää voi työstää eri kenttiä
   yhtä aikaa kirjoittamatta toistensa yli.

   Yhteiset mitat ovat levels/shared.js:ssä. Kaikki muu — kulissit,
   koukut, vakiot — kuuluu sille kentälle joka niitä käyttää. */

import { intro } from './levels/intro.js';
import { highrise } from './levels/highrise.js';
import { funfair } from './levels/funfair.js';
import { stormport } from './levels/stormport.js';

export const LEVELS = [intro, highrise, funfair, stormport];
