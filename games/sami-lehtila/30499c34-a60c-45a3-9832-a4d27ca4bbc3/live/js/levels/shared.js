/* Kentän mitat samoina kuin game.js:ssä, joka ei vie niitä ulos.
   HATCH menee sekä kentän gate-kenttään että huvipuiston taustamaalaukseen,
   joka leikkaa markiisiin reiän samaan kohtaan — muuten luukusta näkyisi
   kangasta eikä taivasta. */
export const W = 720, H = 1040;
export const CEIL = 16;                     // katon paksuus
export const HATCH = { x: 300, w: 120 };    // luukku katossa
