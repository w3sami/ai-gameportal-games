/* Tulostaulu. Yksi taulu, "kassa", ja mitta on koko vuoron loppusaldo: kentät
   eivät saa omia taulujaan, vaan taululle menee vain lopputulos.
   Rivit piirretään tässä eikä <leaderboard-panel>-elementillä, koska rivillä
   halutaan näyttää euromerkki ja merkki siitä pääsikö vuoro loppuun asti. */
import { submit, top, getName, setName }
  from 'https://plugins.game.bigbools.fi/leaderboard/v1/index.js';

const BOARD = 'kassa';
const KEY = 'spacetaxi-lb-v1';

let mine = null;                                  // {money, id}: tämän selaimen oma rivi
try { mine = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
const remember = () => { try { localStorage.setItem(KEY, JSON.stringify(mine)); } catch (e) {} };

/* Jokainen viesti tuloksesta joka ei päätynyt taululle. Kolme keskimmäistä
   eivät menettäneet mitään — tulos ei vain mennyt perille. */
const NOTE = {
  full:           'Sadan parhaan joukkoon tarvitaan enemmän. Aja uusi vuoro.',
  busy:           'Taulu on juuri nyt varattu — tulos ei mennyt perille.',
  offline:        'Ei yhteyttä, tulos jäi tähän koneeseen.',
  server:         'Taulu nikottelee — tulos ei mennyt perille.',
  invalid:        'Tulosta ei voitu lähettää.',
  'unknown-game': 'Tulosta ei voitu lähettää.',
};

const euro = n => n + ' €';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/**
 * Rakentaa taulun annettuun elementtiin.
 * @param host    tyhjä div kortin sisällä
 * @param pending vuoron saldo joka odottaa lähetystä, 0 valikossa
 * @param meta    {cleared, seconds, level} — kulkee rivin mukana taululle
 */
export async function mountBoard(host, pending, meta) {
  pending = Math.max(0, Math.round(pending || 0));
  if (mine && pending <= mine.money) pending = 0;  // oma parempi tulos on jo taululla

  host.className = 'lb';
  const sub = el('span', 'lb-sub', 'Koko vuoro');
  const head = el('div', 'lb-h');
  head.append(el('b', null, 'Parhaat kuskit'), sub);
  const body = el('div', 'lb-body');
  body.append(el('p', 'lb-note', 'Luetaan taulua…'));
  const status = el('p', 'lb-note'), ctl = el('div');
  const foot = el('div', 'lb-foot');
  foot.append(status, ctl);
  host.replaceChildren(head, body, foot);

  if (pending && getName()) await send(pending, meta, status);
  await draw(body, sub);
  controls(getName() ? 0 : pending, meta, status, ctl, body, sub);
}

// submit() ei heitä eikä hylkää, joten kept on koko totuus.
async function send(money, meta, status) {
  status.className = 'lb-note';
  status.textContent = 'Lähetetään tulosta…';
  const data = {
    v: 1,
    cleared: !!(meta && meta.cleared),
    s: Math.round((meta && meta.seconds) || 0),
    lvl: (meta && meta.level) || 1,
  };
  const r = await submit({ score: money, board: BOARD, data });
  if (r.kept) {
    mine = { money, id: r.entry.id }; remember();
    status.className = 'lb-note good';
    status.textContent = r.rank === 1
      ? `Vuoron paras tulos maailmassa, ${euro(money)}.`
      : `Taululla — sija #${r.rank}.`;
  } else {
    status.textContent = NOTE[r.reason] || NOTE.server;
  }
}

async function draw(body, sub) {
  const highlight = mine ? mine.id : undefined;
  const page = await top({ board: BOARD, limit: 8, around: highlight });
  if (page.reason) { body.replaceChildren(el('p', 'lb-note', 'Taulua ei saatu näkyviin.')); return; }
  if (!page.entries.length) {
    body.replaceChildren(el('p', 'lb-note', 'Yhtään vuoroa ei ole vielä ajettu. Ensimmäinen ottaa kärkipaikan.'));
    return;
  }

  sub.textContent = `Koko vuoro · ${page.total} ${page.total === 1 ? 'tulos' : 'tulosta'}`;
  const list = el('ol', 'lbrows');
  for (const e of page.entries) {
    const row = el('li', `lbrow${e.rank <= 3 ? ' top' : ''}${e.id === highlight ? ' me' : ''}`);
    const t = el('span', 't', euro(e.score));
    if (e.data && e.data.cleared) {
      const mark = el('span', 'cl', '✓');
      mark.title = 'Kaikki kentät ajettu';
      t.append(mark);
    }
    row.append(el('span', 'r', e.rank), el('span', 'n', e.name), t);
    list.append(row);
  }
  body.replaceChildren(list);
}

/* Nimirivi, ja samalla ainoa paikka jossa nimeä koskaan kysytään: pelaajaa
   joka ei ole vielä ansainnut euroakaan ei kysytä mitään. */
function controls(pending, meta, status, ctl, body, sub) {
  const name = getName();

  if (!pending && name) {
    const change = el('button', 'lnk', 'vaihda');
    change.type = 'button';
    change.addEventListener('click', form);
    const line = el('span', null, `Nimellä ${name} · `);
    line.append(change);
    ctl.replaceChildren(line);
    return;
  }
  if (!pending && !name) {
    ctl.replaceChildren(el('span', null, 'Aja vuoro loppuun, niin saldo nousee tänne.'));
    return;
  }
  form();

  /* Ei <form>: peli tarjoillaan hiekkalaatikossa ilman allow-forms-lippua,
     joten submit-tapahtumaa ei koskaan tule. Nappi ja Enter hoitavat sen. */
  function form() {
    const wrap = el('div', 'lb-form');
    const input = el('input');
    input.name = 'kuski'; input.maxLength = 24; input.placeholder = 'Nimesi';
    input.value = getName(); input.autocomplete = 'off'; input.spellcheck = false;
    const go = el('button', 'btn sm', pending ? 'Lähetä tulos' : 'Tallenna');
    go.type = 'button';

    async function commit() {
      const who = setName(input.value);
      if (!who) { input.focus(); return; }
      go.disabled = true;
      ctl.replaceChildren(el('span', null, `Nimellä ${who}`));
      if (pending) { await send(pending, meta, status); await draw(body, sub); }
      controls(0, meta, status, ctl, body, sub);
    }
    go.addEventListener('click', commit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });

    wrap.append(input, go);
    ctl.replaceChildren(wrap);
    input.focus();
  }
}
