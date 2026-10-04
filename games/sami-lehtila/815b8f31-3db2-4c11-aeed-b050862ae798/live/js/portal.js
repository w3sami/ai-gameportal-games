"use strict";
/* ============================================================
   portal.js — AI-peliportaalin (games.bigbools.fi) integraatio,
   yhteinen yksinpelille ja moninpelille: koko näyttö ja tulostaulu.

   Koko näyttö toimii missä tahansa selaimessa joka sen tuntee (portaalin
   kehys antaa allow="fullscreen"); nappi piilotetaan jos API:a ei ole
   (iPhone), koska popup-varaväylää ei hiekkalaatikossa ole.

   Tulostaulu on olemassa vain portaalissa: plugin päättelee pelin
   osoitteesta, joten jatsi.bigbools.fi:ssä sitä ei ladata lainkaan.
   Yksi taulu `pisteet`, kentät noppamäärästä ja sarakkeista (levelFor).
   Muut variantit (pankki, ravistus) ja koko pelin tulos kulkevat rivin
   datassa ja näkyvät rivillä, ja niillä voi suodattaa. Oma lista top():n
   päälle eikä valmis <leaderboard-panel>, koska paneeli ei näytä dataa.
   ============================================================ */
window.JatsiPortal = (function () {
  const ON_PORTAL = /\.game\.bigbools\.fi$/.test(location.hostname);
  const LB_URL = 'https://plugins.game.bigbools.fi/leaderboard/v1/index.js';
  const BOARD = 'pisteet';
  const SENT_KEY = 'jatsi.lb.sent';

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
  /* Kosketusnäytöllä pelin aloitus vie koko näyttöön: portaalin kehys
     tekstiensä kanssa vie pieneltä ruudulta liikaa tilaa. Pyyntö tehdään
     napautuksen käsittelijässä, koska selain sallii sen vain käyttäjän
     eleestä. */
  const TOUCH = matchMedia('(pointer: coarse)').matches;
  function fullscreenOnStart(ev) {
    if (!TOUCH || fsElement() || !fsRequest()) return;
    const t = ev.target.closest && ev.target.closest('.bigBtn, .mpRoomRow button:not(.dangerBtn)');
    if (!t || t.disabled) return;
    toggleFullscreen();
  }
  if (TOUCH) document.addEventListener('click', fullscreenOnStart, true);

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

  /* Kenttä säännöistä: noppamäärä ja sarakkeet muuttavat pistetason niin
     paljon, ettei niitä voi järjestää samaan listaan. Tunnukset `5`,
     `5-tupla`, `6`, `6-tupla` ovat pysyviä (rivit viittaavat niihin) ja
     SAMAT kuin server/leaderboard.js:ssä. */
  function levelFor({ sixDice, twoCol }) {
    return (sixDice ? '6' : '5') + (twoCol ? '-tupla' : '');
  }

  /* Rivin data, sama muoto yksin- ja moninpelissä (moninpelin kirjoittaa
     palvelin, ks. server/leaderboard.js):
       { v: { six, tupla, pankki, ravistus }, mode: 'offline'|'verkossa',
         place, of, game: [{ n, s }] }   — game on koko pelin tulos. */
  function rowData({ variant, mode, players, me }) {
    const game = players.map((p) => ({ n: p.name, s: p.score })).sort((a, b) => b.s - a.s);
    return {
      v: { six: !!variant.sixDice, tupla: !!variant.twoCol, pankki: !!variant.bank, ravistus: variant.rollMode === 'shake' },
      mode, place: game.findIndex((g) => g.n === me.name && g.s === me.score) + 1, of: game.length, game,
    };
  }

  /* Tagit joka rivillä. Kenttää määräävät (noppamäärä, tuplasarake) ovat
     kaikilla kentän riveillä samat, joten niillä ei suodateta. */
  /* Varhaiset rivit kantavat nimet yksin/moninpeli; samat tagit kuin nyt. */
  const MODE_TAG = { yksin: 'offline', moninpeli: 'verkossa' };
  function variantTags(d) {
    const v = (d && d.v) || {};
    const tags = [v.six ? '6 noppaa' : '5 noppaa'];
    if (v.tupla) tags.push('tuplasarake');
    if (v.pankki) tags.push('heittopankki');
    if (v.ravistus) tags.push('ravistus');
    if (d && d.mode) tags.push(MODE_TAG[d.mode] || d.mode);
    return tags;
  }
  function gameLine(entry) {
    const d = entry.data || {};
    if (!Array.isArray(d.game) || d.game.length < 2) return '';
    const others = d.game.filter((g, i) => i !== d.place - 1).map((g) => `${g.n} ${g.s}`);
    return `${d.place}./${d.of} · ${d.place === 1 ? 'voitti' : 'vastassa'} ${others.join(', ')}`;
  }

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  /* Tag-suodatin: yksi tagirivi, jossa jokainen tagi on aina valittavissa,
     kuinka monta tahansa kerralla. Tagit ovat ryhmissä: saman ryhmän valitut
     tarkoittavat "mikä tahansa näistä" ja eri ryhmät rajaavat yhdessä;
     ryhmä ilman valintoja ei rajaa. Noppamäärä ja sarakkeet ovat taulun
     kenttiä, joten niiden valinnat ratkaisevat mitkä kentät haetaan
     (enintään 4); muut suodattavat haettuja rivejä selaimessa, koska
     palvelimen top() ei suodata datalla — siksi kentästä haetaan kaikki
     rivit (enintään 100 × 2 kt). Sija lasketaan näytetyn listan sisällä.
     Rivin tagin napautus valitsee sen. */
  const TAGS = ['5 noppaa', '6 noppaa', 'yksi sarake', 'tuplasarake', 'heittopankki', 'ravistus', 'offline', 'verkossa'];
  const TAG_GROUP = {
    '5 noppaa': 'dice', '6 noppaa': 'dice', 'yksi sarake': 'cols', tuplasarake: 'cols',
    offline: 'mode', verkossa: 'mode',
  };
  const sel = new Set();
  const cache = new Map(); // kenttä -> { entries, reason }

  /* Rivin tagit suodatusta varten: myös "yksi sarake", jota rivillä ei näytetä. */
  function matchTags(d) {
    const t = variantTags(d);
    if (!(d && d.v && d.v.tupla)) t.push('yksi sarake');
    return t;
  }
  function matches(entry) {
    const t = matchTags(entry.data);
    const groups = {};
    sel.forEach((f) => { const g = TAG_GROUP[f] || f; (groups[g] = groups[g] || []).push(f); });
    return Object.values(groups).every((any) => any.some((f) => t.includes(f)));
  }
  function levelsToFetch() {
    const six = ['5 noppaa', '6 noppaa'].filter((t) => sel.has(t));
    const cols = ['yksi sarake', 'tuplasarake'].filter((t) => sel.has(t));
    const out = [];
    (six.length ? six : ['5 noppaa', '6 noppaa']).forEach((d) =>
      (cols.length ? cols : ['yksi sarake', 'tuplasarake']).forEach((c) =>
        out.push(levelFor({ sixDice: d === '6 noppaa', twoCol: c === 'tuplasarake' }))));
    return out;
  }

  /* Piirtää taulun wrap-elementtiin: tagirivi ja lista, joka rivillä
     variantit ja pelin tulos. Nimet textContentilla — ne ovat pelaajien
     kirjoittamia. Haku vain kun kenttä vaihtuu tai fetch=true. */
  async function render(wrap, highlightId, fetch = true) {
    const m = await lb();
    if (!m) { wrap.style.display = 'none'; return; }
    const levels = levelsToFetch();
    await Promise.all(levels.map(async (level) => {
      if (!fetch && cache.has(level)) return;
      const { entries, reason } = await m.top({ board: BOARD, level, limit: 100 });
      cache.set(level, { entries, reason });
    }));
    const got = levels.map((l) => cache.get(l));
    const entries = got.flatMap((g) => g.entries).sort((x, y) => y.score - x.score);
    const reason = got.some((g) => g.reason) && !entries.length ? 'error' : null;
    const redraw = () => render(wrap, highlightId, false);
    const pick = (tag) => { if (sel.has(tag)) sel.delete(tag); else sel.add(tag); redraw(); };
    wrap.style.display = '';
    wrap.innerHTML = '';
    wrap.appendChild(el('div', 'lbHead', 'Tulostaulu'));
    const bar = el('div', 'lbTabs');
    TAGS.forEach((t) => {
      const b = el('button', 'lbTab' + (sel.has(t) ? ' on' : ''), t);
      b.type = 'button';
      b.addEventListener('click', () => pick(t));
      bar.appendChild(b);
    });
    wrap.appendChild(bar);
    const list = el('ol', 'lbList');
    wrap.appendChild(list);
    if (!entries.length) {
      list.appendChild(el('li', 'lbEmpty', reason ? 'Tulostaulua ei saatu haettua.' : 'Ei vielä tuloksia näillä säännöillä.'));
      return;
    }
    const shown = entries.filter(matches);
    if (!shown.length) {
      list.appendChild(el('li', 'lbEmpty', 'Ei tuloksia näillä valinnoilla.'));
      return;
    }
    shown.forEach((e, i) => {
      const li = el('li', 'lbRow' + (e.id === highlightId ? ' you' : ''));
      const top = el('div', 'lbTop');
      top.appendChild(el('span', 'lbRank', (i + 1) + '.'));
      top.appendChild(el('span', 'lbName', e.name));
      top.appendChild(el('span', 'lbScore', String(e.score)));
      li.appendChild(top);
      const meta = el('div', 'lbMeta');
      const tags = el('span', 'lbTags');
      variantTags(e.data).forEach((t) => {
        const b = el('button', 'lbTag lbFilter' + (sel.has(t) ? ' on' : ''), t);
        b.type = 'button';
        b.addEventListener('click', () => pick(t));
        tags.appendChild(b);
      });
      meta.appendChild(tags);
      const line = gameLine(e);
      if (line) meta.appendChild(el('span', 'lbGame', line));
      li.appendChild(meta);
      list.appendChild(li);
    });
  }

  /* Pelin lopussa taulu avautuu pelin omilla säännöillä: noppamäärä ja
     sarakkeet valitaan pelin mukaan, muut valinnat säilyvät. */
  function openOn(wrap, variant, highlightId) {
    ['5 noppaa', '6 noppaa', 'yksi sarake', 'tuplasarake'].forEach((t) => sel.delete(t));
    sel.add(variant.sixDice ? '6 noppaa' : '5 noppaa');
    sel.add(variant.twoCol ? 'tuplasarake' : 'yksi sarake');
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
     sivun päivitys voittoruudussa). */
  async function submitLocalGame(wrap, { gameKey, variant, players }) {
    if (!wrap) return;
    const level = levelFor(variant);
    const m = await lb();
    if (!m) { wrap.style.display = 'none'; return; }
    let firstKept = null;
    if (!sentSet().has(gameKey)) {
      markSent(gameKey);
      for (const p of players) {
        const res = await m.submit({ board: BOARD, level, score: p.score, name: p.name,
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
