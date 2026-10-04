"use strict";
/* ============================================================
   room-rules.js — pelihuoneen säännöt: paikat, vuoro, heitot, pankki,
   pisteytys ja pelin päättyminen.
   Puhdas moduuli kuten scoring.js: ei DOM:ia, ei verkkoa, ei tallennusta.
   Sama tiedosto ajaa verkkopelin palvelimella (server/rooms.js, joka
   lisää tallennuksen, historian ja tulostaulun) ja offline-pelin
   selaimessa (js/local-room.js), joten säännöt eivät voi eriytyä.

   Funktiot muuttavat huone-oliota paikallaan ja heittävät Errorin, kun
   toiminto ei ole sallittu. Kenellä on oikeus mihinkin (isäntä, pelaaja)
   ratkaisee kutsuja; tämä tarkistaa vain vuoron.

   PAIKAT: pelaaja on paikka (seat), ei tili. Tilin oma paikka on
   `u<userId>`; sama laite voi tuoda vieraita (`g…`, guest: true), joilla on
   omistajan userId. Siksi vuorotarkistus päästää laitteen pelaamaan kaikki
   omat paikkansa.

   VARIANTIT: säännöt valitaan huoneen luonnissa (room.variant), ja jokainen
   Scoring-kutsu saa `sixDice`-lipun parametrina eikä luota Scoring-moduulin
   jaettuun tilaan — palvelin ajaa useita eri sääntöjen huoneita yhtä aikaa.
   ============================================================ */
(function (root) {
  const Scoring = (typeof module !== 'undefined' && module.exports)
    ? require('./scoring.js') : root.Scoring;

  /* Sama 8 värin paletti kuin tilin värivalinnassa (server/auth.js). */
  const PALETTE = ['#ffffff', '#ff6b5e', '#ffab4d', '#ffd94d', '#7fd98f', '#5fd6d0', '#6ea8ff', '#c58bff'];
  const MAX_PLAYERS = 6;
  const ROLL_MODES = ['charge', 'shake'];

  /** Siivoa/rajaa pyydetty variantti turvalliseksi, tunnetuksi muodoksi. */
  function sanitizeVariant(v) {
    v = v || {};
    return {
      twoCol: !!v.twoCol,
      sixDice: !!v.sixDice,
      bank: !!v.bank,
      rollMode: ROLL_MODES.includes(v.rollMode) ? v.rollMode : 'charge',
    };
  }

  function diceCountFor(variant) { return variant.sixDice ? 6 : 5; }
  function colsFor(variant) { return variant.twoCol ? 2 : 1; }
  function emptyScs(variant) { return Array.from({ length: colsFor(variant) }, () => ({})); }

  /* ---------- Paikat ---------- */
  function accountSeatId(userId) { return 'u' + userId; }
  function accountSeat(room, userId) { return room.players.find(p => p.userId === userId && !p.guest); }
  function seatsOf(room, userId) { return room.players.filter(p => p.userId === userId); }
  function nameTaken(room, name) {
    const n = name.toLowerCase();
    return room.players.some(p => p.username.toLowerCase() === n) ||
      (room.pendingGuests || []).some(g => g.username.toLowerCase() === n);
  }
  function freeColor(room) {
    const used = new Set(room.players.map(p => p.color));
    return PALETTE.find(c => !used.has(c)) || PALETTE[room.players.length % PALETTE.length];
  }

  /** Uusi paikka; seatId annetaan vieraalle, tilin paikka johdetaan userId:stä. */
  function newSeat(room, { userId, username, color, guest, seatId }) {
    return {
      seatId: guest ? seatId : accountSeatId(userId),
      guest: !!guest,
      userId,
      username,
      color: PALETTE.includes(color) ? color : freeColor(room),
      socketId: null,
      connected: true,
      disconnectedAt: null,
      scs: emptyScs(room.variant),
      bank: 0,
    };
  }

  /* Paikan väri (nopat piirretään vuorossa olevan paikan värillä). Laite
     vaihtaa vain omien paikkojensa värin, milloin tahansa, ja väri on
     huoneessa yksilöllinen. */
  function setSeatColor(room, userId, seatId, color) {
    const seat = room.players.find(p => p.seatId === seatId);
    if (!seat || seat.userId !== userId) throw new Error('Voit vaihtaa vain omien pelaajiesi värin.');
    if (!PALETTE.includes(color)) throw new Error('Tuntematon väri.');
    if (room.players.some(p => p !== seat && p.color === color)) throw new Error('Väri on jo toisella pelaajalla.');
    seat.color = color;
    return seat;
  }

  /* Vuorojärjestys ennen peliä: seatIds on huoneen paikat uudessa
     järjestyksessä. Kesken pelin järjestystä ei muuteta, koska vuoro
     (room.current) on indeksi tähän listaan. */
  function reorderSeats(room, seatIds) {
    if (room.status !== 'open') throw new Error('Järjestystä voi muuttaa vain ennen peliä.');
    const byId = new Map(room.players.map(p => [p.seatId, p]));
    if (!Array.isArray(seatIds) || seatIds.length !== byId.size || new Set(seatIds).size !== byId.size ||
        !seatIds.every(id => byId.has(id))) {
      throw new Error('Järjestys ei vastaa huoneen pelaajia.');
    }
    room.players = seatIds.map(id => byId.get(id));
  }

  /* Poistaa ehdon täyttävät paikat ja korjaa vuoron. Isäntyys siirtyy, jos
     isännän tilille ei jää paikkaa. Tyhjäksi jäänyt huone jää kutsujan
     hoidettavaksi (room.players.length === 0). */
  function dropSeats(room, match) {
    if (!room.players.some(match)) return;
    const playing = room.status === 'playing';
    const cur = room.players[room.current];
    const curRemoved = !!cur && match(cur);
    /* Ennen vuorossa olevaa istuneiden poisto siirtää tätä listassa alemmas;
       jos vuorossa oleva itse poistuu, vuoro siirtyy seuraavalle puhtaalta
       pöydältä. */
    const before = room.players.slice(0, room.current).filter(match).length;
    room.players = room.players.filter(p => !match(p));
    if (room.players.length === 0) return;
    if (!accountSeat(room, room.hostId)) room.hostId = (room.players.find(p => !p.guest) || room.players[0]).userId;
    if (!playing) return;
    room.current -= before;
    if (curRemoved) {
      room.current = room.current % room.players.length;
      resetTurn(room);
    }
    advanceIfCurrentFinished(room);
    checkTurnOrder(room, 'leave');
  }

  /* ---------- Pelin kulku ---------- */
  function clearBoard(room) {
    const diceCount = diceCountFor(room.variant);
    room.current = 0;
    room.rollsUsed = 0;
    room.diceValues = new Array(diceCount).fill(0);
    room.held = new Array(diceCount).fill(false);
    room.players.forEach(p => { p.scs = emptyScs(room.variant); p.bank = 0; });
  }

  function startGame(room, minPlayers) {
    if (room.status !== 'open') throw new Error('Peli on jo aloitettu.');
    if (room.players.length < minPlayers) throw new Error(`Vähintään ${minPlayers} pelaajaa tarvitaan.`);
    room.status = 'playing';
    /* Ensimmäisen pelin jälkeen pelaajaksi pääsee vain isännän päästämänä. */
    room.played = true;
    clearBoard(room);
  }

  /* Päättynyt huone takaisin odottamaan samoilla pelaajilla. Säännöt voi
     vaihtaa samalla; ilman variant-arvoa ne säilyvät. */
  function resetForRematch(room, variant) {
    if (room.status !== 'finished') throw new Error('Peli ei ole vielä päättynyt.');
    if (variant !== undefined) room.variant = sanitizeVariant(variant);
    room.status = 'open';
    room.historySaved = false;
    room.lbEntries = null;
    clearBoard(room);
  }

  function currentPlayer(room) { return room.players[room.current]; }

  function requireTurn(room, userId) {
    const cur = currentPlayer(room);
    if (!cur || cur.userId !== userId) throw new Error('Ei ole vuorosi.');
  }

  function bankAvailable(room) {
    const cur = currentPlayer(room);
    return room.variant.bank && !!cur && (cur.bank || 0) > 0;
  }

  /* Nopan ARVOT tulevat heittävän laitteen omalta fysiikalta — huijaus ei
     ole tämän rennon kaveripelin huolenaihe. Kaikki muu tarkistetaan: vuoro,
     heittoja jäljellä (tai pankki), ja että arvot ovat muodollisesti
     järkeviä, ettei rikkinäinen data kaada pisteytystä myöhemmin. */
  function roll(room, userId, diceValues) {
    if (room.status !== 'playing') throw new Error('Peli ei ole käynnissä.');
    requireTurn(room, userId);
    const diceCount = diceCountFor(room.variant);
    const useBank = room.rollsUsed >= 3;
    if (useBank && !bankAvailable(room)) throw new Error('Heitot käytetty — valitse rivi.');
    if (
      !Array.isArray(diceValues) ||
      diceValues.length !== diceCount ||
      !diceValues.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)
    ) {
      throw new Error('Virheelliset noppien arvot.');
    }
    room.diceValues = diceValues.slice();
    if (useBank) currentPlayer(room).bank--;
    else room.rollsUsed++;
    return room.diceValues;
  }

  function hold(room, userId, index) {
    if (room.status !== 'playing') throw new Error('Peli ei ole käynnissä.');
    requireTurn(room, userId);
    const diceCount = diceCountFor(room.variant);
    if (!Number.isInteger(index) || index < 0 || index >= diceCount) throw new Error('Virheellinen noppa.');
    if (room.rollsUsed === 0) throw new Error('Heitä ensin.');
    if (room.rollsUsed >= 3 && !bankAvailable(room)) throw new Error('Ei enää heittoja tällä vuorolla.');
    room.held[index] = !room.held[index];
  }

  function resetTurn(room) {
    const diceCount = diceCountFor(room.variant);
    room.rollsUsed = 0;
    room.held = new Array(diceCount).fill(false);
    room.diceValues = new Array(diceCount).fill(0);
  }

  function filledCount(p) {
    return p.scs.reduce((n, sc) => n + Object.keys(sc).length, 0);
  }

  /* Vuorojärjestyksen tarkistus. Jokainen vuoro merkitsee tasan yhden rivin,
     joten kierroksen aikana pelaajilla on merkittyjä rivejä [k+1, …, k+1, k, …, k]
     ja vuorossa on ensimmäinen jolla on k. Toisin sanoen: kaikki ennen vuorossa
     olevaa ovat heittäneet ja merkinneet tuloksensa tällä kierroksella. Jos tila
     on jostain syystä muuta, vuoro korjataan sille jonka kuuluu pelata — ja
     kesken jäänyt vuoro alkaa alusta, koska sen heitot eivät ole hänen. */
  function expectedCurrent(room) {
    const six = room.variant.sixDice;
    let best = -1, min = Infinity;
    room.players.forEach((p, i) => {
      if (p.scs.every(sc => Scoring.scFull(sc, six))) return;
      const n = filledCount(p);
      if (n < min) { min = n; best = i; }
    });
    return best;
  }

  function checkTurnOrder(room, where) {
    if (room.status !== 'playing') return;
    const want = expectedCurrent(room);
    if (want === -1 || want === room.current) return;
    console.warn(`[vuoro] ${where}: huone ${room.id} vuorossa ${room.current}, kuuluisi ${want} — korjataan`);
    room.current = want;
    resetTurn(room);
  }

  /* Peli päättyy kun jokaisen kaikki sarakkeet ovat täynnä; muuten vuoro
     ohittaa ne jotka ovat jo valmiita. */
  function advanceIfCurrentFinished(room) {
    if (room.players.length === 0) return;
    const six = room.variant.sixDice;
    if (room.players.every(p => p.scs.every(sc => Scoring.scFull(sc, six)))) {
      room.status = 'finished';
      return;
    }
    let guard = 0;
    while (room.players[room.current].scs.every(sc => Scoring.scFull(sc, six)) && guard++ < room.players.length + 1) {
      room.current = (room.current + 1) % room.players.length;
    }
  }

  function score(room, userId, categoryId, col) {
    if (room.status !== 'playing') throw new Error('Peli ei ole käynnissä.');
    requireTurn(room, userId);
    if (room.rollsUsed === 0) throw new Error('Heitä ensin.');
    const six = room.variant.sixDice;
    const validId = Scoring.allCats(six).some(c => c.id === categoryId);
    if (!validId) throw new Error('Tuntematon kategoria.');
    const p = currentPlayer(room);
    const colIdx = room.variant.twoCol ? (col === 1 ? 1 : 0) : 0;
    if (!p.scs[colIdx]) throw new Error('Virheellinen sarake.');
    if (p.scs[colIdx][categoryId] !== undefined) throw new Error('Rivi on jo merkitty.');
    const pts = Scoring.scoreCat(categoryId, room.diceValues);
    p.scs[colIdx][categoryId] = pts;
    if (room.variant.bank) p.bank = (p.bank || 0) + Math.max(0, 3 - room.rollsUsed);
    resetTurn(room);
    room.current = (room.current + 1) % room.players.length;
    advanceIfCurrentFinished(room);
    checkTurnOrder(room, 'score');
    return pts;
  }

  function rankings(room) {
    const six = room.variant.sixDice;
    return [...room.players]
      .map(p => ({ seatId: p.seatId, userId: p.userId, username: p.username, guest: !!p.guest, total: Scoring.playerTotal(p, six) }))
      .sort((a, b) => b.total - a.total);
  }

  /** Huoneen tila asiakkaalle; palvelin lisää katsojat ja estetyt. */
  function publicState(room) {
    return {
      id: room.id,
      name: room.name,
      status: room.status,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      variant: room.variant,
      diceCount: diceCountFor(room.variant),
      current: room.current,
      rollsUsed: room.rollsUsed,
      diceValues: room.diceValues,
      held: room.held,
      bankAvailable: bankAvailable(room),
      players: room.players.map(p => ({
        seatId: p.seatId, guest: !!p.guest,
        userId: p.userId, username: p.username, color: p.color,
        scs: p.scs, bank: p.bank || 0, connected: p.connected !== false,
      })),
      pendingGuests: (room.pendingGuests || []).map(g => ({ seatId: g.seatId, userId: g.userId, username: g.username, color: g.color })),
      played: !!room.played || room.status !== 'open',
      rankings: room.status === 'finished' ? rankings(room) : null,
      lbEntries: room.status === 'finished' ? (room.lbEntries || null) : null,
    };
  }

  const api = {
    PALETTE, MAX_PLAYERS, ROLL_MODES,
    sanitizeVariant, diceCountFor, colsFor, emptyScs,
    accountSeatId, accountSeat, seatsOf, nameTaken, freeColor, newSeat, dropSeats, setSeatColor, reorderSeats,
    startGame, resetForRematch, currentPlayer, requireTurn, bankAvailable,
    roll, hold, resetTurn, score, rankings, publicState,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api; /* Node (palvelin) */
  } else {
    root.RoomRules = api;  /* selain (globaali) */
  }

})(typeof window !== 'undefined' ? window : globalThis);
