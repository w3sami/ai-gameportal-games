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

  /* Varmistusikkuna pelin omana näkymänä: confirm() ei toimi portaalin
     hiekkalaatikossa. Ilman onOk-kutsua pelkkä ilmoitus OK-napilla. */
  function dialog({ title, text, okText, danger, onOk }) {
    const ov = document.getElementById('dialogOverlay');
    document.getElementById('dialogTitle').textContent = title || '';
    document.getElementById('dialogText').textContent = text || '';
    const ok = document.getElementById('dialogOk');
    const cancel = document.getElementById('dialogCancel');
    ok.textContent = okText || 'OK';
    ok.classList.toggle('danger', !!danger);
    cancel.style.display = onOk ? '' : 'none';
    const close = () => { ov.style.display = 'none'; ok.onclick = null; cancel.onclick = null; };
    ok.onclick = () => { close(); if (onOk) onOk(); };
    cancel.onclick = close;
    ov.onclick = (ev) => { if (ev.target === ov) close(); };
    ov.style.display = 'flex';
    (onOk ? cancel : ok).focus();
  }

  function variantBadges(variant) {
    const tags = [];
    if (variant.twoCol) tags.push('Tuplasarake');
    if (variant.sixDice) tags.push('6 noppaa');
    if (variant.bank) tags.push('Pankki');
    if (variant.rollMode === 'shake') tags.push('Ravistus');
    return tags;
  }

  /* Paikan tarkenne nimen perään: oma tili, oma vieras tai toisen vieras. */
  function seatNote(p, myUserId) {
    if (p.guest) return p.userId === myUserId ? ' (tällä laitteella)' : ' (vieras)';
    return p.userId === myUserId ? ' (sinä)' : '';
  }

  /* Pelaajat ja katsojat (👁) siruina; napautus avaa henkilölistan (onOpen). */
  function renderPlayers(el, state, myUserId, onOpen) {
    el.innerHTML = '';
    const bankOn = state.variant && state.variant.bank;
    const chip = (cls, html) => {
      const c = document.createElement('div');
      c.className = 'mpPlayerChip' + cls;
      c.innerHTML = html;
      if (onOpen) { c.classList.add('clickable'); c.addEventListener('click', onOpen); }
      el.appendChild(c);
    };
    state.players.forEach((p, i) => {
      const bankTag = bankOn && (p.bank || 0) > 0 ? ' 💰' + p.bank : '';
      chip((i === state.current && state.status === 'playing' ? ' cur' : '') + (p.connected === false ? ' disconnected' : ''),
        `<span class="pdot" style="background:${p.color}"></span>${esc(p.username)}${bankTag}` +
        (state.local ? '' : (p.userId === state.hostId && !p.guest ? ' 👑' : '') + seatNote(p, myUserId)));
    });
    (state.spectators || []).forEach((s) => {
      chip(' spectator', `👁 ${esc(s.username)}` + (s.userId === myUserId ? ' (sinä)' : ''));
    });
  }

  /* Odotushuoneen vuorojärjestys: numeroitu lista; isännälle ↑↓ ja arvonta.
     onOrder(seatIds) lähettää uuden järjestyksen. */
  function renderOrder(el, state, myUserId, onOrder, onOpen) {
    el.innerHTML = '';
    const amIHost = state.hostId === myUserId;
    const ids = state.players.map((p) => p.seatId);
    const move = (i, d) => { const n = ids.slice(); [n[i], n[i + d]] = [n[i + d], n[i]]; onOrder(n); };
    state.players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'mpOrderRow';
      const who = document.createElement('div');
      who.className = 'mpOrderWho';
      who.innerHTML = `<span class="mpOrderNo">${i + 1}.</span><span class="pdot" style="background:${p.color}"></span>${esc(p.username)}` +
        (p.userId === state.hostId && !p.guest ? ' 👑' : '') + seatNote(p, myUserId);
      if (onOpen) who.addEventListener('click', onOpen);
      row.appendChild(who);
      if (amIHost && state.players.length > 1) {
        [['↑', -1, i === 0], ['↓', 1, i === ids.length - 1]].forEach(([t, d, off]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'mpOrderBtn';
          b.textContent = t;
          b.disabled = off;
          b.title = d < 0 ? 'Aiemmaksi' : 'Myöhemmäksi';
          b.addEventListener('click', () => move(i, d));
          row.appendChild(b);
        });
      }
      el.appendChild(row);
    });
    (state.spectators || []).forEach((s) => {
      const row = document.createElement('div');
      row.className = 'mpOrderRow spectator';
      row.innerHTML = `<div class="mpOrderWho">👁 ${esc(s.username)}${s.userId === myUserId ? ' (sinä)' : ''}</div>`;
      if (onOpen) row.addEventListener('click', onOpen);
      el.appendChild(row);
    });
    if (amIHost && state.players.length > 2) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mpShuffleBtn';
      b.textContent = '🎲 Arvo järjestys';
      b.addEventListener('click', () => onOrder(shuffled(ids)));
      el.appendChild(b);
    } else if (amIHost && state.players.length === 2) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mpShuffleBtn';
      b.textContent = '🎲 Arvo aloittaja';
      b.addEventListener('click', () => onOrder(shuffled(ids)));
      el.appendChild(b);
    }
  }

  /* Satunnainen järjestys (Fisher–Yates). */
  function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* Henkilölista: pelaajat, katsojat ja (isännälle) estetyt. Isäntä näkee
     joka rivillä toiminnot; muut pelkän listan. onAction(action, person). */
  function renderPeople(el, state, myUserId, onAction) {
    el.innerHTML = '';
    const amIHost = state.hostId === myUserId;
    const playing = state.status !== 'open';
    const section = (title, people, rowFor) => {
      if (!people.length) return;
      const h = document.createElement('div');
      h.className = 'peopleHead';
      h.textContent = title;
      el.appendChild(h);
      people.forEach((p) => {
        const { label, note, actions, colors } = rowFor(p);
        const row = document.createElement('div');
        row.className = 'peopleRow';
        const who = document.createElement('div');
        who.className = 'peopleWho';
        who.innerHTML = label;
        if (note) { const n = document.createElement('div'); n.className = 'peopleNote'; n.textContent = note; who.appendChild(n); }
        if (colors) who.appendChild(colorPicker(p));
        row.appendChild(who);
        const acts = document.createElement('div');
        acts.className = 'peopleActs';
        {
          actions.forEach(([action, text, danger]) => {
            const b = document.createElement('button');
            b.textContent = text;
            if (danger) b.className = 'danger';
            b.addEventListener('click', () => onAction(action, p));
            acts.appendChild(b);
          });
        }
        row.appendChild(acts);
        el.appendChild(row);
      });
    };
    /* Toiminnot: isäntä kaikille muille tileille; vieraan voi poistaa sen
       tuoja tai isäntä. */
    const hostOn = (p) => amIHost && p.userId !== myUserId;
    const ownerName = (p) => (state.players.find((pp) => pp.userId === p.userId && !pp.guest) || {}).username;
    const me = (p) => (p.userId === myUserId ? ' (sinä)' : '');
    /* Oman paikan värivalitsin: toisten käyttämät värit eivät ole valittavissa. */
    const colorPicker = (p) => {
      const wrap = document.createElement('div');
      wrap.className = 'peopleSwatches';
      const taken = new Set(state.players.filter((o) => o.seatId !== p.seatId).map((o) => o.color));
      (window.RoomRules ? window.RoomRules.PALETTE : []).forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'peopleSw' + (c === p.color ? ' on' : '');
        b.style.background = c;
        b.disabled = taken.has(c);
        b.title = taken.has(c) ? 'Toisella pelaajalla' : 'Nopan väri';
        if (c !== p.color && !taken.has(c)) b.addEventListener('click', () => onAction('color', Object.assign({}, p, { color: c })));
        wrap.appendChild(b);
      });
      return wrap;
    };
    if (state.local) {
      section('Pelaajat', state.players, (p) => ({
        label: `<span class="pdot" style="background:${p.color}"></span>${esc(p.username)}`,
        note: '', actions: [], colors: true,
      }));
      return;
    }
    section('Pelaajat', state.players, (p) => ({
      colors: p.userId === myUserId,
      label: `<span class="pdot" style="background:${p.color}"></span>${esc(p.username)}${p.userId === state.hostId && !p.guest ? ' 👑' : ''}${p.guest ? '' : me(p)}`,
      note: [p.guest ? (p.userId === myUserId ? 'tällä laitteella' : `vieras · laite: ${ownerName(p) || "?"}`) : '',
        p.connected === false ? 'poissa' : ''].filter(Boolean).join(' · '),
      actions: p.guest
        ? (amIHost || p.userId === myUserId ? [['removeGuest', 'Poista', true]] : [])
        : (hostOn(p) ? [['kick', 'Pois pelistä', true], ['block', 'Estä', true]] : []),
    }));
    section('Odottaa pääsyä', state.pendingGuests || [], (g) => ({
      label: `<span class="pdot" style="background:${g.color}"></span>${esc(g.username)}`,
      note: g.userId === myUserId ? 'tällä laitteella · isäntä päättää' : `laite: ${ownerName(g) || "?"}`,
      actions: [
        ...(amIHost ? [['admitGuest', 'Päästä peliin']] : []),
        ...(amIHost || g.userId === myUserId ? [['removeGuest', amIHost && g.userId !== myUserId ? 'Hylkää' : 'Peru', true]] : []),
      ],
    }));
    section('Katsojat', state.spectators || [], (s) => ({
      label: `👁 ${esc(s.username)}${me(s)}`,
      note: s.admitted ? 'pääsee seuraavaan peliin' : s.benched ? 'poistettu pelistä' : '',
      actions: hostOn(s) ? [
        s.admitted ? ['unadmit', 'Peru pääsy'] : ['admit', playing ? 'Seuraavaan peliin' : 'Päästä peliin'],
        ['block', 'Estä', true],
      ] : [],
    }));
    if (amIHost) {
      section('Estetyt', state.blocked || [], (b) => ({
        label: `⛔ ${esc(b.username)}`, note: '', actions: [['unblock', 'Poista esto']],
      }));
    }
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
    /* "Piilota käytetyt" (🙈) ja "vain omat sarakkeet" (👤) ovat tämän
       laitteen paikallisia asetuksia, ja ne koskevat laitteen omaa paikkaa:
       vuorossa olevaa, jos se on tämän laitteen (offline aina, verkossa
       myös vieras), muuten tilin omaa. Laitteella pelaava näkee siis aina
       sen pelaajan rivit, jonka vuoro on. */
    const curSeat = state.players[state.current];
    const myPlayer = (curSeat && curSeat.userId === myUserId && state.status === 'playing')
      ? curSeat : state.players.find((p) => p.userId === myUserId && !p.guest);
    const hideUsedNow = hideUsed && !!myPlayer;
    const ownMode = ownCols && !!myPlayer;
    const rowHidden = (cat) => hideUsedNow && myPlayer.scs.every((sc) => sc[cat.id] !== undefined);

    /* litistetty lista: yksi entry per pelaaja (tai kaksi jos tuplasarake) —
       ownMode-tilassa vain oman paikan sarake(et). */
    const entries = [];
    state.players.forEach((p, pi) => {
      if (ownMode && p.seatId !== myPlayer.seatId) return;
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
        const fade = hideUsedNow && e.p.seatId === myPlayer.seatId ? ' fadeUsed' : '';
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
    h += `<tr class="bonusRow"><td>Bonus (+${S_.bonusValue(six)})</td>${entries.map((e) => `<td>${S_.bonusOf(e.sc, six) || '–'}</td>`).join('')}</tr>`;
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
        h += `<tr class="allTot"><td><span class="pdot" style="background:${p.color}"></span>${esc(p.username)}</td><td colspan="${entries.length}"><b>${S_.playerTotal(p, six)}</b>${p.seatId === state.players[state.current]?.seatId && state.status === 'playing' ? ' · vuorossa' : ''}</td></tr>`;
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
    const watching = !state.players.some((p) => p.userId === myUserId);
    /* Sama tarkistus kuin yksinpelin updateControls (js/ui.js): nappi ei saa
       näyttää "valmiilta" kesken paikallisen heiton/latauksen animaation,
       vaikka palvelimen tila (vuoro, heittojen määrä) jo sallisi seuraavan
       heiton — muuten klikkaus ei tekisi mitään ja ulkoasu valehtelisi. */
    const busy = window.Dice3D && (window.Dice3D.isRolling() || window.Dice3D.isCharging());
    rollBtn.disabled = !isMyTurn || busy || (state.rollsUsed >= 3 && !bank);
    rollBtn.textContent = watching ? 'KATSOT' : busy ? '…' :
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
      const cur = state.players[state.current];
      badge.textContent = state.local ? cur.username + ' vuorossa'
        : isMyTurn && !cur.guest ? 'Sinun vuorosi'
        : isMyTurn ? cur.username + ' vuorossa · tällä laitteella'
        : cur.username + ' vuorossa';
    } else {
      badge.textContent = '–';
    }
  }

  function renderRoomList(el, rooms, myUserId, onJoin, onDelete, onForfeit, onWatch) {
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
      const blocked = Array.isArray(r.blockedIds) && r.blockedIds.includes(myUserId);
      const benched = Array.isArray(r.benched) && r.benched.includes(myUserId);
      const statusText = r.status === 'open' ? 'odottaa' : r.status === 'playing' ? 'käynnissä' : 'päättynyt';
      const badges = variantBadges(r.variant || {});
      const badgeHtml = badges.length ? `<div class="meta">${badges.join(' · ')}</div>` : '';
      row.innerHTML = `
        <div>
          <div class="name">${esc(r.name)}</div>
          <div class="meta">${esc(r.hostUsername)} · ${r.playerCount}/${r.maxPlayers} pelaajaa${r.spectatorCount ? ' · 👁 ' + r.spectatorCount : ''} · ${statusText}</div>
          ${badgeHtml}
        </div>
      `;
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '6px';
      const btn = document.createElement('button');
      /* Huoneeseen pääsee aina. Pelaajaksi itse vain ennen ensimmäistä peliä
         ja jos tilaa on; muuten "katsojana" on päällä ja lukittu, ja isäntä
         päästää peliin henkilölistasta. */
      const canPlay = r.status === 'open' && !r.played && !full && !benched;
      let watchBox = null;
      if (amIIn) {
        // Olen jo mukana tässä huoneessa (esim. toisella laitteella/välilehdellä) —
        // liity aina suoraan takaisin riippumatta huoneen tilasta.
        btn.textContent = 'Jatka';
        btn.addEventListener('click', () => onJoin(r.id));
      } else if (blocked) {
        btn.textContent = 'Estetty'; btn.disabled = true;
      } else {
        btn.textContent = 'Liity';
        const lab = document.createElement('label');
        lab.className = 'mpWatchBox';
        lab.title = canPlay ? 'Liity katsomaan, ei pelaamaan' : 'Isäntä päästää pelaajat peliin';
        watchBox = document.createElement('input');
        watchBox.type = 'checkbox';
        watchBox.checked = !canPlay;
        watchBox.disabled = !canPlay;
        lab.append(watchBox, ' katsojana');
        actions.appendChild(lab);
        btn.addEventListener('click', () => (watchBox.checked ? onWatch : onJoin)(r.id));
      }
      actions.appendChild(btn);
      /* Kesken olevasta omasta pelistä poistutaan vain tästä, erikseen
         varmistettuna — huoneen ✕ vie aulaan mutta pitää paikan. */
      if (amIIn && r.status === 'playing' && onForfeit) {
        const quitBtn = document.createElement('button');
        quitBtn.textContent = 'Luovuta';
        quitBtn.title = 'Poistu pelistä pysyvästi';
        quitBtn.className = 'dangerBtn';
        quitBtn.addEventListener('click', () => dialog({
          title: 'Luovuta peli?', text: 'Poistut pelistä pysyvästi, ja pisteesi lähtevät. Peli jatkuu muilla.',
          okText: 'Luovuta', danger: true, onOk: () => onForfeit(r.id),
        }));
        actions.appendChild(quitBtn);
      }
      if (amIHost && onDelete) {
        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑';
        delBtn.title = 'Poista huone';
        delBtn.className = 'dangerBtn';
        delBtn.addEventListener('click', () => dialog({
          title: 'Poista huone?', text: `”${r.name}” poistuu kaikilta, myös kesken olevan pelin pelaajilta.`,
          okText: 'Poista', danger: true, onOk: () => onDelete(r.id),
        }));
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

  return { renderPlayers, renderTable, renderQuickPicks, updateControls, renderRoomList, renderHistory, renderPeople, renderOrder, shuffled, dialog };
})();
