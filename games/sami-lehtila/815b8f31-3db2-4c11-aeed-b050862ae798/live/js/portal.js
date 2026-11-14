"use strict";
/* ============================================================
   portal.js — AI-peliportaalin (games.bigbools.fi) integraatio,
   yhteinen yksinpelille ja moninpelille: koko näyttö ja tulostaulu.

   Koko näyttö toimii missä tahansa selaimessa joka sen tuntee (portaalin
   kehys antaa allow="fullscreen"); nappi piilotetaan jos API:a ei ole
   (iPhone), koska popup-varaväylää ei hiekkalaatikossa ole.

   Tulostaulu on olemassa vain portaalissa: plugin päättelee pelin
   osoitteesta, joten jatsi.bigbools.fi:ssä sitä ei ladata lainkaan.
   Taulut `pisteet` ja 5000-pelin `vuorot`, kentät pelityypistä,
   noppamäärästä ja sarakkeista (levelFor). Muut variantit (pankki, ravistus) ja koko pelin tulos
   kulkevat rivin datassa ja näkyvät rivillä, ja niillä voi suodattaa. Oma
   lista top():n päälle eikä valmis <leaderboard-panel>, koska paneeli ei
   näytä dataa.
   ============================================================ */
window.JatsiPortal = (function () {
  const ON_PORTAL = /\.game\.bigbools\.fi$/.test(location.hostname);
  const LB_URL = 'https://plugins.game.bigbools.fi/leaderboard/v1/index.js';
  const BOARD = 'pisteet';
  const SENT_KEY = 'jatsi.lb.sent';
  /* Pikajatsin heitettävien noppien määrä (scoring.js:n QUICK_DICE). Se on
     kentän nimessä, koska määrää voidaan vielä säätää: eri noppamäärällä
     pelatut tulokset eivät ole vertailukelpoisia eivätkä sekoitu. */
  const quickDice = () => (window.Scoring && window.Scoring.QUICK_DICE) || 10;

  /* ---------- koko näyttö ---------- */
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const fsRequest = () => {
    const el = document.documentElement;
    return el.requestFullscreen || el.webkitRequestFullscreen || null;
  };
  function toggleFullscreen() {
    if (fsElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
      return;
    }
    const req = fsRequest();
    if (!req) return;
    try {
      const r = req.call(document.documentElement, { navigationUI: 'hide' });
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (e) { /* selain kieltäytyi — nappi vain ei tee mitään */ }
  }
  function wireFullscreen(btn) {
    if (!btn) return;
    if (!fsRequest() || document.fullscreenEnabled === false) { btn.style.display = 'none'; return; }
    /* Tila piirretään selaimen vastauksesta eikä toiveesta: koko näyttö voi
       päättyä Esc:llä tai eleellä ilman nappia. */
    const sync = () => {
      const on = !!fsElement();
      btn.textContent = on ? '🗗' : '⛶';
      btn.title = on ? 'Poistu koko näytöstä' : 'Koko näyttö';
    };
    btn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();
  }

  /* ---------- tulostaulu ---------- */
  let lbModule = null;
  function lb() {
    if (!ON_PORTAL) return Promise.resolve(null);
    if (!lbModule) lbModule = import(LB_URL).catch((e) => { console.warn('[tulostaulu] plugin ei latautunut', e); return null; });
    return lbModule;
  }

  /* Taulu ja kenttä säännöistä. Taulu on tulostaulun laji: `pisteet`
     (suurempi on parempi) ja 5000-pelin `vuorot` (voittoon tarvitut vuorot,
     pienempi on parempi). Kenttä erottaa säännöt, joiden tulokset eivät ole
     vertailukelpoisia: `5`, `5-tupla`, `6`, `6-tupla`, pikajatsin
     `pika<N>-…` (N = heitettävät nopat) ja 5000:n `5000-5`, `5000-6`.
     Tunnukset ovat pysyviä (rivit viittaavat niihin) ja SAMAT kuin
     server/leaderboard.js:ssä. */
  const BOARD_TURNS = 'vuorot';
  const boardFor = (variant) => (variant.fiveK ? BOARD_TURNS : BOARD);
  function levelFor({ sixDice, twoCol, quick, fiveK }) {
    if (fiveK) return '5000-' + (sixDice ? '6' : '5');
    return (quick ? `pika${quickDice()}-` : '') + (sixDice ? '6' : '5') + (twoCol ? '-tupla' : '');
  }

  /* Rivin data, sama muoto yksin- ja moninpelissä (moninpelin kirjoittaa
     palvelin, ks. server/leaderboard.js):
       { v: { six, tupla, pankki, ravistus, pika }, mode: 'offline'|'verkossa',
         place, of, game: [{ n, s }] }   — game on koko pelin tulos.
     pika on pikajatsissa heitettyjen noppien määrä, muuten false.
     5000: v on { six, k5000: true, ravistus } ja game: [{ n, s, t }], jossa
     s on summa ja t pelatut vuorot; rivin tulos (score) on vuorot. */
  function rowData({ variant, mode, players, me }) {
    const game = players.map((p) => (variant.fiveK ? { n: p.name, s: p.score, t: p.turns } : { n: p.name, s: p.score }))
      .sort((a, b) => b.s - a.s);
    const v = variant.fiveK
      ? { six: !!variant.sixDice, k5000: true, ravistus: variant.rollMode === 'shake' }
      : {
        six: !!variant.sixDice, tupla: !!variant.twoCol, pankki: !!variant.bank, ravistus: variant.rollMode === 'shake',
        pika: variant.quick ? quickDice() : false,
      };
    return { v, mode, place: game.findIndex((g) => g.n === me.name && g.s === me.score) + 1, of: game.length, game };
  }

  /* Rivillä näytettävät tagit. Pikajatsin rivillä noppatagi kertoo
     pöytäkirjan ("paras 5"), koska heitettyjä noppia on enemmän. */
  /* Varhaiset rivit kantavat nimet yksin/moninpeli; samat tagit kuin nyt. */
  const MODE_TAG = { yksin: 'offline', moninpeli: 'verkossa' };
  const modeOf = (d) => (d && d.mode ? MODE_TAG[d.mode] || d.mode : null);
  function variantTags(d) {
    const v = (d && d.v) || {};
    const tags = [];
    if (v.k5000) {
      tags.push('5000', v.six ? '6 noppaa' : '5 noppaa');
    } else if (v.pika) {
      tags.push(typeof v.pika === 'number' ? `pikajatsi ${v.pika} noppaa` : 'pikajatsi');
      tags.push(v.six ? 'paras 6' : 'paras 5');
    } else {
      tags.push(v.six ? '6 noppaa' : '5 noppaa');
    }
    if (v.tupla) tags.push('tuplasarake');
    if (v.pankki) tags.push('heittopankki');
    if (v.ravistus) tags.push('ravistus');
    if (modeOf(d)) tags.push(modeOf(d));
    return tags;
  }
  function gameLine(entry) {
    const d = entry.data || {};
    if (!Array.isArray(d.game) || d.game.length < 2) return '';
    const others = d.game.filter((g, i) => i !== d.place - 1).map((g) => `${g.n} ${g.s}`);
    return `${d.place}./${d.of} · ${d.place === 1 ? 'voitti' : 'vastassa'} ${others.join(', ')}`;
  }

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  /* Tag-suodatin: yksi tagirivi. Tagit ovat ryhmissä, ja ryhmästä on
     valittuna enintään yksi: valinta poistaa ryhmän toisen valinnan, ja
     valitun napautus poistaa sen, jolloin ryhmä ei rajaa. Eri ryhmien
     valinnat rajaavat yhdessä. Valinta poistaa myös tagit, joiden kanssa se
     ei voi esiintyä samalla rivillä (CLASH).
     Pelityyppi, noppamäärä ja sarakkeet ovat taulun kenttiä, joten ne
     ratkaisevat mitkä kentät haetaan, ja rivi suodatetaan niiden osalta
     kentästä josta se haettiin, ei rivin datasta. Muut tagit suodattavat
     haettuja rivejä selaimessa, koska palvelimen top() ei suodata datalla —
     siksi kentästä haetaan kaikki rivit (enintään 100 × 2 kt). Sija lasketaan
     näytetyn listan sisällä. Pikajatsista haetaan vain nykyisen noppamäärän
     kentät.
     5000:n tulos on vuoroja eikä pisteitä, joten sen rivit näkyvät vain kun
     5000 on valittuna, pienin ensin.
     Rivin tagit ovat pelkkää tietoa; valinnat tehdään tagiriviltä. */
  const GROUPS = {
    kind: ['tavallinen', 'pikajatsi', '5000'],
    dice: ['5 noppaa', '6 noppaa'],
    cols: ['yksi sarake', 'tuplasarake'],
    bank: ['heittopankki'],
    shake: ['ravistus'],
    mode: ['offline', 'verkossa'],
  };
  const TAGS = Object.values(GROUPS).flat();
  const groupOf = (tag) => Object.values(GROUPS).find((g) => g.includes(tag)) || [tag];
  /* Tagit, jotka eivät esiinny samalla rivillä: pikajatsissa ja 5000:ssa ei
     ole heittopankkia, eikä 5000:ssa sarakkeita. */
  const CLASH = [
    ['pikajatsi', 'heittopankki'],
    ['5000', 'heittopankki'], ['5000', 'yksi sarake'], ['5000', 'tuplasarake'],
  ];
  const sel = new Set();
  const cache = new Map(); // taulu/kenttä -> { entries, reason }

  function pickTag(tag) {
    if (sel.has(tag)) { sel.delete(tag); return; }
    groupOf(tag).forEach((t) => sel.delete(t));
    CLASH.forEach(([a, b]) => { if (a === tag) sel.delete(b); if (b === tag) sel.delete(a); });
    sel.add(tag);
  }

  /* Haettavat kentät valinnoista: { board, level, tags }, jossa tags ovat
     kentän määräämät tagit (pelityyppi, noppamäärä, sarakkeet). */
  function sources() {
    const chosen = (group) => GROUPS[group].filter((t) => sel.has(t));
    const kinds = chosen('kind').length ? chosen('kind') : ['tavallinen', 'pikajatsi'];
    const dice = chosen('dice').length ? chosen('dice') : GROUPS.dice;
    const cols = chosen('cols').length ? chosen('cols') : GROUPS.cols;
    const out = [];
    kinds.forEach((k) => dice.forEach((d) => (k === '5000' ? [null] : cols).forEach((c) => {
      const variant = { fiveK: k === '5000', quick: k === 'pikajatsi', sixDice: d === '6 noppaa', twoCol: c === 'tuplasarake' };
      out.push({ board: boardFor(variant), level: levelFor(variant), tags: [k, d].concat(c ? [c] : []) });
    })));
    return out;
  }
  /* Rivin tagit suodatusta varten: kentän tagit ja rivin omat vivut. */
  function matches(row) {
    const v = (row.entry.data && row.entry.data.v) || {};
    const t = row.src.tags.concat(v.pankki ? ['heittopankki'] : [], v.ravistus ? ['ravistus'] : [], modeOf(row.entry.data) || []);
    return [...sel].every((f) => t.includes(f));
  }

  /* Piirtää taulun wrap-elementtiin: tagirivi ja lista, joka rivillä
     variantit ja pelin tulos. Nimet textContentilla — ne ovat pelaajien
     kirjoittamia. Haku vain kun kenttä vaihtuu tai fetch=true. */
  async function render(wrap, highlightId, fetch = true) {
    const m = await lb();
    if (!m) { wrap.style.display = 'none'; return; }
    const srcs = sources();
    const key = (s) => s.board + '/' + s.level;
    await Promise.all(srcs.map(async (s) => {
      if (!fetch && cache.has(key(s))) return;
      const { entries, reason } = await m.top({ board: s.board, level: s.level, limit: 100 });
      cache.set(key(s), { entries, reason });
    }));
    const turns = sel.has('5000');
    const rows = srcs.flatMap((s) => cache.get(key(s)).entries.map((entry) => ({ entry, src: s })))
      .sort((x, y) => (turns ? x.entry.score - y.entry.score : y.entry.score - x.entry.score));
    const reason = srcs.some((s) => cache.get(key(s)).reason) && !rows.length ? 'error' : null;
    wrap.style.display = '';
    wrap.innerHTML = '';
    wrap.appendChild(el('div', 'lbHead', 'Tulostaulu'));
    const bar = el('div', 'lbTabs');
    TAGS.forEach((t) => {
      const b = el('button', 'lbTab' + (sel.has(t) ? ' on' : ''), t);
      b.type = 'button';
      b.addEventListener('click', () => { pickTag(t); render(wrap, highlightId, false); });
      bar.appendChild(b);
    });
    wrap.appendChild(bar);
    const list = el('ol', 'lbList');
    wrap.appendChild(list);
    if (!rows.length) {
      list.appendChild(el('li', 'lbEmpty', reason ? 'Tulostaulua ei saatu haettua.' : 'Ei vielä tuloksia näillä säännöillä.'));
      return;
    }
    const shown = rows.filter(matches);
    if (!shown.length) {
      list.appendChild(el('li', 'lbEmpty', 'Ei tuloksia näillä valinnoilla.'));
      return;
    }
    shown.forEach(({ entry: e }, i) => {
      const li = el('li', 'lbRow' + (e.id === highlightId ? ' you' : ''));
      const top = el('div', 'lbTop');
      top.appendChild(el('span', 'lbRank', (i + 1) + '.'));
      top.appendChild(el('span', 'lbName', e.name));
      top.appendChild(el('span', 'lbScore', turns ? `${e.score} vuoroa` : String(e.score)));
      li.appendChild(top);
      const meta = el('div', 'lbMeta');
      const tags = el('span', 'lbTags');
      variantTags(e.data).forEach((t) => tags.appendChild(el('span', 'lbTag', t)));
      meta.appendChild(tags);
      const line = gameLine(e);
      if (line) meta.appendChild(el('span', 'lbGame', line));
      li.appendChild(meta);
      list.appendChild(li);
    });
  }

  /* Pelin lopussa taulu avautuu pelin omilla säännöillä: pelityyppi,
     noppamäärä ja sarakkeet valitaan pelin mukaan, muut valinnat säilyvät
     siltä osin kuin ne sopivat pelityyppiin. */
  function openOn(wrap, variant, highlightId) {
    ['kind', 'dice', 'cols'].forEach((g) => GROUPS[g].forEach((t) => sel.delete(t)));
    pickTag(variant.fiveK ? '5000' : variant.quick ? 'pikajatsi' : 'tavallinen');
    pickTag(variant.sixDice ? '6 noppaa' : '5 noppaa');
    if (!variant.fiveK) pickTag(variant.twoCol ? 'tuplasarake' : 'yksi sarake');
    return render(wrap, highlightId);
  }

  function sentSet() {
    try { return new Set(JSON.parse(localStorage.getItem(SENT_KEY) || '[]')); } catch (e) { return new Set(); }
  }
  function markSent(key) {
    try { localStorage.setItem(SENT_KEY, JSON.stringify([...sentSet(), key].slice(-50))); } catch (e) {}
  }

  /* Yksinpeli: lähettää JOKAISEN pelaajan tuloksen kerran pelin lopussa
     ja piirtää taulun. gameKey estää tuplalähetyksen (peru + uusi lopetus,
     sivun päivitys voittoruudussa). 5000:ssa rivin saa tavoitteen
     saavuttanut, ja tulos on pelatut vuorot. */
  async function submitLocalGame(wrap, { gameKey, variant, players }) {
    if (!wrap) return;
    const level = levelFor(variant);
    const m = await lb();
    if (!m) { wrap.style.display = 'none'; return; }
    const target = variant.fiveK && window.Scoring ? window.Scoring.FIVEK.TARGET : 0;
    let firstKept = null;
    if (!sentSet().has(gameKey)) {
      markSent(gameKey);
      for (const p of players) {
        if (variant.fiveK && p.score < target) continue;
        const res = await m.submit({ board: boardFor(variant), level, score: variant.fiveK ? p.turns : p.score, name: p.name,
          data: rowData({ variant, mode: 'offline', players, me: p }) });
        if (res && res.kept && !firstKept) firstKept = res.entry;
      }
    }
    openOn(wrap, variant, firstKept && firstKept.id);
  }

  /* Moninpeli: palvelin lähettää (kaikkien puolesta, kerran). Tämä vain
     näyttää, ja korostaa oman rivin kun palvelin kertoo sen id:n. */
  let shown = '';
  function showBoard(wrap, { variant, highlightId, key }) {
    if (!wrap) return;
    const sig = key + '|' + (highlightId || '');
    if (sig === shown) return;
    shown = sig;
    openOn(wrap, variant, highlightId);
  }

  /* Alkuruudun tulostaulu: kaikki kentät ja aiemmat valinnat. */
  function openBoard(wrap) { return render(wrap, null); }

  return { onPortal: ON_PORTAL, openBoard, wireFullscreen, toggleFullscreen, submitLocalGame, showBoard, levelFor };
})();
