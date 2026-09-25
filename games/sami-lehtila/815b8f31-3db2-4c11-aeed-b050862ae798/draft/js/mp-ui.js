"use strict";
/* ============================================================
   mp-ui.js — moninpelin pistetaulukko, pelaajalista ja ohjaimet.
   Lukee suoraan palvelimen auktoritatiivisen tilan, mukaan lukien
   huoneen variantti (state.variant: twoCol/sixDice/bank/rollMode) —
   sama Scoring-moduuli kuin yksinpelissä, `six`-parametri välitettynä
   eksplisiittisesti (ks. js/scoring.js).
   ============================================================ */
window.MpUI = (function () {
  const S = () => window.Scoring;
  const esc = window.UI ? window.UI.esc : (s => s);

  /* Peruuttamaton toiminto vaatii toisen napautuksen samaan nappiin:
     ensimmäinen vaihtaa tekstin varmistukseksi, toinen 3 s sisällä tekee
     sen. confirm()-ikkunaa ei voi käyttää, koska portaalin hiekkalaatikko
     estää sen (eikä se näytä pelin omalta muutenkaan). */
  function confirmTap(btn, armedText, action) {
    let timer = null;
    const idle = btn.textContent;
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (timer) {
        clearTimeout(timer); timer = null;
        btn.textContent = idle; btn.classList.remove('armed');
        action();
        return;
      }
      btn.textContent = armedText; btn.classList.add('armed');
      timer = setTimeout(() => { timer = null; btn.textContent = idle; btn.classList.remove('armed'); }, 3000);
    });
  }

  function variantBadges(variant) {
    const tags = [];
    if (variant.twoCol) tags.push('Tuplasarake');
    if (variant.sixDice) tags.push('6 noppaa');
    if (variant.bank) tags.push('Pankki');
    if (variant.rollMode === 'shake') tags.push('Ravistus');
    return tags;
  }

  function renderPlayers(el, state, myUserId) {
    el.innerHTML = '';
    const bankOn = state.variant && state.variant.bank;
    state.players.forEach((p, i) => {
      const chip = document.createElement('div');
      chip.className = 'mpPlayerChip' + (i === state.current && state.status === 'playing' ? ' cur' : '') +
        (p.connected === false ? ' disconnected' : '');
      const bankTag = bankOn && (p.bank || 0) > 0 ? ' 💰' + p.bank : '';
      chip.innerHTML = `<span class="pdot" style="background:${p.color}"></span>${esc(p.username)}${bankTag}` +
        (p.userId === state.hostId ? ' 👑' : '') +
        (p.userId === myUserId ? ' (sinä)' : '');
      el.appendChild(chip);
    });
  }

  function renderTable(state, myUserId, diceValues, onPick, devUpper, hideUsed, onToggleHideUsed, ownCols, onToggleOwnCols) {
    const S_ = S();
    const tableEl = document.getElementById('mpScoreTable');
    const six = state.variant.sixDice;
    const twoCol = state.variant.twoCol;
    const isMyTurn = state.status === 'playing' && state.players[state.current] && state.players[state.current].userId === myUserId;
    const hasRolled = state.rollsUsed > 0;
    const B = S_.upperBase(six);
    const sgn = (x) => (x > 0 ? '+' : '') + x;
    /* Yksinpelissä "piilota käytetyt" piilottaa VUOROSSA olevan pelaajan
       täyteen merkityt rivit (se on tallennettu kyseisen pelaajan omaan
       kenttään, koska laite kiertää pelaajalta toiselle). Moninpelissä tämä
       on jokaisen OMA paikallinen asetus (ei sidottu vuoroon), joten
       järkevin vastine on piilottaa rivit jotka MINÄ (katsoja) olen jo
       täyttänyt kokonaan — sama siisti lopputulos, sovellettuna siihen
       kuka asetuksen oikeasti näkee. Sama periaate "vain omat sarakkeet"
       (👤/ownCols) -tilassa: yksinpelissä se näyttää vain VUOROSSA olevan
       pelaajan sarakkeet, moninpelissä vain KATSOJAN omat. */
    const myPlayer = state.players.find((p) => p.userId === myUserId);
    const hideUsedNow = hideUsed && !!myPlayer;
    const ownMode = ownCols && !!myPlayer;
    const rowHidden = (cat) => hideUsedNow && myPlayer.scs.every((sc) => sc[cat.id] !== undefined);

    /* litistetty lista: yksi entry per pelaaja (tai kaksi jos tuplasarake) —
       ownMode-tilassa vain katsojan oma(t) sarake(et). */
    const entries = [];
    state.players.forEach((p, pi) => {
      if (ownMode && p.userId !== myUserId) return;
      p.scs.forEach((sc, ci) => entries.push({ p, pi, sc, ci }));
    });
    const bankTagFor = (p) => state.variant.bank && (p.bank || 0) > 0 ? ` <span class="devTag pos">💰${p.bank}</span>` : '';
    const hdrBtns = `<div class="hdrBtns">
        <button class="hdrBtn ${hideUsed ? 'on' : ''}" id="mpBtnHideUsed" title="Piilota jo täyttämäni rivit (paikallinen)">🙈</button>
        <button class="hdrBtn ${ownCols ? 'on' : ''}" id="mpBtnOwnCols" title="Näytä vain omat sarakkeeni (paikallinen)">👤</button>
      </div>`;

    let h = '<thead>';
    if (!twoCol) {
      h += `<tr><th>${hdrBtns}</th>`;
      entries.forEach((e) => {
        h += `<th class="${e.pi === state.current && state.status === 'playing' ? 'cur' : ''}"><span class="pdot" style="background:${e.p.color}"></span>${esc(e.p.username)}${bankTagFor(e.p)}</th>`;
      });
      h += '</tr>';
    } else {
      const seen = new Set();
      h += `<tr><th rowspan="2">${hdrBtns}</th>`;
      entries.forEach((e) => {
        if (seen.has(e.pi)) return; seen.add(e.pi);
        h += `<th colspan="2" class="${e.pi === state.current && state.status === 'playing' ? 'cur' : ''}"><span class="pdot" style="background:${e.p.color}"></span>${esc(e.p.username)}${bankTagFor(e.p)}</th>`;
      });
      h += '</tr><tr>';
      entries.forEach((e) => {
        h += `<th class="colHead ${e.pi === state.current && state.status === 'playing' ? 'cur' : ''}">${e.ci === 0 ? 'I' : 'II'}</th>`;
      });
      h += '</tr>';
    }
    h += '</thead><tbody>';

    const cell = (e, cat, devMode) => {
      const v = e.sc[cat.id];
      if (v !== undefined) {
        const disp = devMode ? sgn(v - B * cat.n) : (v === 0 ? '—' : v);
        const fade = hideUsedNow && e.p.userId === myUserId ? ' fadeUsed' : '';
        return `<td class="filled ${v === 0 && !devMode ? 'zero' : ''}${fade}">${disp}</td>`;
      } else if (e.pi === state.current && state.status === 'playing' && isMyTurn && hasRolled) {
        const pot = S_.scoreCat(cat.id, diceValues);
        const disp = devMode ? sgn(pot - B * cat.n) : (pot > 0 ? pot : '');
        const cls = cat.n
          ? (pot - B * cat.n >= 0 ? 'avail' : 'availzero')
          : (pot >= 15 ? 'avail hot' : pot > 0 ? 'avail' : 'availzero');
        return `<td class="${cls}" data-cat="${cat.id}" data-col="${e.ci}">${disp}</td>`;
      }
      return '<td></td>';
    };
    const row = (cat) => {
      if (rowHidden(cat)) return '';
      const devMode = devUpper && !!cat.n;
      return `<tr><td>${cat.name}</td>${entries.map((e) => cell(e, cat, devMode)).join('')}</tr>`;
    };

    h += `<tr class="section"><th>Yläkerta</th>${entries.map(() => '<td></td>').join('')}</tr>`;
    if (ownMode) {
      /* Kompakti ruudukko per sarake (sama asettelu kuin yksinpelin
         ucGrid/ug-luokat, ks. js/ui.js renderTable) sen sijaan että
         yläkerran 6 riviä veisivät tilaa kun näytössä on vain 1-2 saraketta. */
      const grids = entries.map((e) => {
        const done = S_.UPPER.every((u) => e.sc[u.id] !== undefined);
        if (hideUsedNow && done) return '';
        const tag = twoCol ? `<div class="ucColTag">${e.ci === 0 ? 'I' : 'II'}</div>` : '';
        const cells = S_.UPPER.map((u) => {
          const v = e.sc[u.id];
          if (v !== undefined) {
            const t = devUpper ? sgn(v - B * u.n) : (v === 0 ? '—' : v);
            return `<div class="ug filled${hideUsedNow ? ' fadeUsed' : ''}"><span class="n">${u.n}:</span><span>${t}</span></div>`;
          } else if (e.pi === state.current && state.status === 'playing' && isMyTurn && hasRolled) {
            const pot = S_.scoreCat(u.id, diceValues);
            const t = devUpper ? sgn(pot - B * u.n) : (pot > 0 ? pot : '');
            const cls = pot - B * u.n >= 0 ? 'avail' : 'availzero';
            return `<div class="ug ${cls}" data-cat="${u.id}" data-col="${e.ci}"><span class="n">${u.n}:</span><span>${t}</span></div>`;
          }
          return `<div class="ug dim"><span class="n">${u.n}:</span></div>`;
        }).join('');
        return tag + `<div class="ucGrid">${cells}</div>`;
      }).join('');
      if (grids) h += `<tr><td class="ucWrap" colspan="${entries.length + 1}">${grids}</td></tr>`;
    } else {
      S_.UPPER.forEach((c) => h += row(c));
    }
    h += `<tr class="sumRow"><td>Summa</td>${entries.map((e) => `<td>${S_.upperSum(e.sc)} / ${S_.bonusLimit(six)}</td>`).join('')}</tr>`;
    h += `<tr class="bonusRow"><td>Bonus (+50)</td>${entries.map((e) => `<td>${S_.bonusOf(e.sc, six) || '–'}</td>`).join('')}</tr>`;
    h += `<tr class="section"><th>Alakerta</th>${entries.map(() => '<td></td>').join('')}</tr>`;
    S_.lowerCats(six).forEach((c) => h += row(c));
    h += `<tr class="totalRow"><td>YHTEENSÄ</td>${entries.map((e) => `<td>${S_.totalOf(e.sc, six)}</td>`).join('')}</tr>`;
    if (twoCol && !ownMode) {
      h += `<tr class="totalRow"><td>YHT. I+II</td>${state.players.map((p) => `<td colspan="2">${S_.playerTotal(p, six)}</td>`).join('')}</tr>`;
    }
    if (twoCol && ownMode && myPlayer) {
      h += `<tr class="totalRow"><td>YHT. I+II</td><td colspan="2">${S_.playerTotal(myPlayer, six)}</td></tr>`;
    }
    if (ownMode && state.players.length > 1) {
      /* Vaikka vain omat sarakkeet näkyvät yksityiskohtaisesti, näytetään
         silti kaikkien pelaajien kokonaispisteet yhdellä rivillä kullekin
         — muuten "kuinka paljon johdan/hävitän" -tieto katoaisi kokonaan. */
      h += `<tr class="section"><th>Kaikki pelaajat</th>${entries.map(() => '<td></td>').join('')}</tr>`;
      state.players.forEach((p) => {
        h += `<tr class="allTot"><td><span class="pdot" style="background:${p.color}"></span>${esc(p.username)}</td><td colspan="${entries.length}"><b>${S_.playerTotal(p, six)}</b>${p.userId === state.players[state.current]?.userId && state.status === 'playing' ? ' · vuorossa' : ''}</td></tr>`;
      });
    }
    h += '</tbody>';
    tableEl.innerHTML = h;
    tableEl.querySelectorAll('[data-cat]').forEach((el) => {
      el.addEventListener('click', () => onPick(el.dataset.cat, parseInt(el.dataset.col || '0', 10), el));
    });
    const hideBtn = document.getElementById('mpBtnHideUsed');
    if (hideBtn && onToggleHideUsed) hideBtn.addEventListener('click', onToggleHideUsed);
    const ownBtn = document.getElementById('mpBtnOwnCols');
    if (ownBtn && onToggleOwnCols) ownBtn.addEventListener('click', onToggleOwnCols);
  }

  /* ---------- Pikavalinnat (ks. yksinpelin js/ui.js:n renderQuickPicks — sama logiikka) ---------- */
  function renderQuickPicks(state, myUserId, diceValues, devUpper, onPick) {
    const S_ = S();
    const qpEl = document.getElementById('quickPicks');
    const hintEl = document.getElementById('hint');
    if (!qpEl) return;
    qpEl.innerHTML = '';
    qpEl.classList.remove('show');
    const isMyTurn = state.status === 'playing' && state.players[state.current] && state.players[state.current].userId === myUserId;
    if (!isMyTurn || state.rollsUsed === 0) { if (hintEl) hintEl.style.display = ''; return; }
    const six = state.variant.sixDice;
    const p = state.players[state.current];
    const B = S_.upperBase(six);
    const cands = [];
    const lowerOrder = {};
    S_.lowerCats(six).forEach((c, i) => lowerOrder[c.id] = 100 + i);
    const ord = (id) => id === 'yatzy6' ? 0 : id === 'yatzy' ? 1 : lowerOrder[id];
    S_.lowerCats(six).forEach((c) => {
      if (c.id === 'chance') return;
      const pts = S_.scoreCat(c.id, diceValues);
      if (pts <= 0) return;
      p.scs.forEach((sc, ci) => {
        if (sc[c.id] !== undefined) return;
        cands.push({ id: c.id, label: c.name + ' ' + pts, pts, ci, ord: ord(c.id), blinkExtra: false });
      });
    });
    S_.UPPER.forEach((u) => {
      const pts = S_.scoreCat(u.id, diceValues);
      const d = pts - B * u.n;
      if (pts <= 0 || d < 0) return;
      const val = devUpper ? (d > 0 ? '+' : '') + d : pts;
      p.scs.forEach((sc, ci) => {
        if (sc[u.id] !== undefined) return;
        cands.push({ id: u.id, label: u.n + ': ' + val, pts, ci, ord: 10 + u.n, blinkExtra: d > 0 });
      });
    });
    cands.sort((a, b) => a.ord - b.ord || a.ci - b.ci);
    if (!cands.length) { if (hintEl) hintEl.style.display = ''; return; }
    const FULLUSE = new Set(['small', 'large', 'straight6', 'full', 'bighouse', 'twotriples', 'threepairs', 'yatzy', 'yatzy6']);
    cands.forEach((c) => {
      const el = document.createElement('button');
      const blink = FULLUSE.has(c.id) || c.pts >= 20 || c.blinkExtra;
      el.className = 'qp' + (blink ? ' blink' : '');
      el.textContent = c.label;
      if (state.variant.twoCol) {
        const sup = document.createElement('span');
        sup.className = 'colSup';
        sup.textContent = c.ci === 0 ? 'I' : 'II';
        el.appendChild(sup);
      }
      el.addEventListener('click', () => onPick(c.id, c.ci, el));
      qpEl.appendChild(el);
    });
    qpEl.classList.add('show');
    if (hintEl) hintEl.style.display = 'none';
  }

  function updateControls(state, myUserId) {
    const rollBtn = document.getElementById('rollBtn');
    const rollsEl = document.getElementById('rollsLeft');
    const badge = document.getElementById('turnBadge');
    const isMyTurn = state.status === 'playing' && state.players[state.current] && state.players[state.current].userId === myUserId;
    const bank = isMyTurn && state.bankAvailable;
    /* Sama tarkistus kuin yksinpelin updateControls (js/ui.js): nappi ei saa
       näyttää "valmiilta" kesken paikallisen heiton/latauksen animaation,
       vaikka palvelimen tila (vuoro, heittojen määrä) jo sallisi seuraavan
       heiton — muuten klikkaus ei tekisi mitään ja ulkoasu valehtelisi. */
    const busy = window.Dice3D && (window.Dice3D.isRolling() || window.Dice3D.isCharging());
    rollBtn.disabled = !isMyTurn || busy || (state.rollsUsed >= 3 && !bank);
    rollBtn.textContent = busy ? '…' :
      state.rollsUsed === 0 ? 'HEITÄ NOPAT' :
      state.rollsUsed >= 3 ? (bank ? `PANKKIHEITTO 💰${state.players[state.current].bank}` : 'VALITSE RIVI') :
      'HEITÄ UUDELLEEN';
    rollsEl.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'rollDot' + (i < state.rollsUsed ? ' used' : '');
      rollsEl.appendChild(dot);
    }
    if (state.status === 'finished') {
      badge.textContent = 'Peli päättyi';
    } else if (state.players[state.current]) {
      badge.textContent = isMyTurn ? 'Sinun vuorosi' : esc(state.players[state.current].username) + ' vuorossa';
    } else {
      badge.textContent = '–';
    }
  }

  function renderRoomList(el, rooms, myUserId, onJoin, onDelete) {
    el.innerHTML = '';
    if (!rooms.length) {
      el.innerHTML = '<div class="mpEmpty">Ei avoimia pelejä juuri nyt — luo oma huone yllä.</div>';
      return;
    }
    rooms.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'mpRoomRow';
      const full = r.playerCount >= r.maxPlayers;
      const amIIn = Array.isArray(r.playerIds) && r.playerIds.includes(myUserId);
      const amIHost = r.hostId === myUserId;
      const statusText = r.status === 'open' ? 'odottaa' : r.status === 'playing' ? 'käynnissä' : 'päättynyt';
      const badges = variantBadges(r.variant || {});
      const badgeHtml = badges.length ? `<div class="meta">${badges.join(' · ')}</div>` : '';
      row.innerHTML = `
        <div>
          <div class="name">${esc(r.name)}</div>
          <div class="meta">${esc(r.hostUsername)} · ${r.playerCount}/${r.maxPlayers} pelaajaa · ${statusText}</div>
          ${badgeHtml}
        </div>
      `;
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '6px';
      const btn = document.createElement('button');
      if (amIIn) {
        // Olen jo mukana tässä huoneessa (esim. toisella laitteella/välilehdellä) —
        // liity aina suoraan takaisin riippumatta huoneen tilasta.
        btn.textContent = 'Jatka';
      } else if (r.status !== 'open') {
        btn.textContent = 'Kesken'; btn.disabled = true;
      } else if (full) {
        btn.textContent = 'Täynnä'; btn.disabled = true;
      } else {
        btn.textContent = 'Liity';
      }
      if (!btn.disabled) btn.addEventListener('click', () => onJoin(r.id));
      actions.appendChild(btn);
      if (amIHost && onDelete) {
        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑';
        delBtn.title = 'Poista huone';
        delBtn.style.background = '#3a2015';
        confirmTap(delBtn, 'Poista?', () => onDelete(r.id));
        actions.appendChild(delBtn);
      }
      row.appendChild(actions);
      el.appendChild(row);
    });
  }

  function renderHistory(el, games) {
    el.innerHTML = '';
    if (!games.length) {
      el.innerHTML = '<div class="mpEmpty">Ei vielä pelattuja pelejä.</div>';
      return;
    }
    games.forEach((g) => {
      const row = document.createElement('div');
      row.className = 'mpHistoryRow';
      const opponents = g.opponents.map((o) => esc(o.username) + ' (' + o.score + ')').join(', ') || '—';
      let date = g.finishedAt;
      try { date = new Date(g.finishedAt.replace(' ', 'T') + 'Z').toLocaleString('fi-FI'); } catch (e) {}
      row.innerHTML = `
        <div class="mpHistoryTop">
          <span class="result ${g.won ? 'win' : 'loss'}">${g.won ? 'VOITTO' : 'HÄVIÖ'}</span>
          <span class="meta">${date}</span>
        </div>
        <div class="name">${esc(g.roomName)} — sinä: <b>${g.myScore}</b></div>
        <div class="meta">Vastustajat: ${opponents}</div>
      `;
      el.appendChild(row);
    });
  }

  return { renderPlayers, renderTable, renderQuickPicks, updateControls, renderRoomList, renderHistory, confirmTap };
})();
