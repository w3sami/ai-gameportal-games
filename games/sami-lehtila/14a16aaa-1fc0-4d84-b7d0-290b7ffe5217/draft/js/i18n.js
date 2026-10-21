// UI strings. Finnish for fi* browsers, English otherwise.
const STR = {
  en: {
    level: 'Level', moves: 'Moves', best: 'Shortest',
    undo: 'Undo', restart: 'Restart', hint: 'Hint', next: 'Next level', replay: 'Play again',
    solved: 'Into the hole!',
    result: (m, p) => m === p ? `${m} moves. That’s the shortest route.` : `${m} moves. Shortest is ${p}.`,
    howto: 'Slide the seal to its breathing hole. On ice it stops only at a rock, the shore or deep snow.',
    keys: 'Arrows or WASD · Z undo · R restart · H hint',
    prev: 'Previous level', nextLvl: 'Next level',
  },
  fi: {
    level: 'Taso', moves: 'Siirrot', best: 'Lyhin',
    undo: 'Peru', restart: 'Alusta', hint: 'Vihje', next: 'Seuraava taso', replay: 'Pelaa uudestaan',
    solved: 'Avannossa!',
    result: (m, p) => m === p ? `${m} siirtoa. Lyhin mahdollinen reitti.` : `${m} siirtoa. Lyhin on ${p}.`,
    howto: 'Liu’uta norppa hengitysreiälle. Jäällä se pysähtyy vain kiveen, rantaan tai hankeen.',
    keys: 'Nuolet tai WASD · Z peru · R alusta · H vihje',
    prev: 'Edellinen taso', nextLvl: 'Seuraava taso',
  },
};
const lang = (navigator.language || 'en').toLowerCase().startsWith('fi') ? 'fi' : 'en';
export const t = STR[lang];
export const LANG = lang;
