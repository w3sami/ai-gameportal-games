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

   PIKAJATSI (variant.quick): vuorolla yksi heitto 10 nopalla, ei lukitusta
   eikä pankkia. Pöytäkirja on tavallinen 5 tai 6 nopan pöytäkirja, ja rivi
   lasketaan heiton parhaalla 5 (6) nopan valinnalla (ks. scoring.js).

   5000 (variant.fiveK): oma pelityyppinsä 5 tai 6 nopalla, ilman
   pöytäkirjaa. Paikalla on summa (seat.total) ja pelatut vuorot
   (seat.turns), vuorolla potti (room.pot). Heiton jälkeen pelaaja siirtää
   sivuun pisteitä tuottavia noppia (hold) ja joko heittää loput (roll) tai
   vie potin summaansa (bank). room.held = sivussa olevat nopat, room.locked
   = niistä aiemmilla heitoilla siirretyt, joita ei voi enää palauttaa.
   Heitto ilman pisteitä tuottavaa noppaa nollaa potin ja päättää vuoron.
   Kun kaikki nopat ovat sivussa, ne heitetään kaikki uudestaan samaan
   pottiin. Ensimmäinen pankitus vaatii FIVEK.OPEN pistettä yhdellä
   vuorolla. Kun joku on saavuttanut FIVEK.TARGET:n, kierros pelataan
   loppuun ja suurin summa voittaa.
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
    const fiveK = !!v.fiveK;
    const quick = !!v.quick && !fiveK;
    return {
      /* 5000:ssa ei ole pöytäkirjaa eikä heittomäärää, joten pikajatsi,
         sarakkeet ja heittopankki eivät koske sitä. */
      fiveK,
      twoCol: !!v.twoCol && !fiveK,
      sixDice: !!v.sixDice,
      /* Pikajatsissa on vuorolla yksi heitto, joten pankkiin ei kertyisi mitään. */
      bank: !!v.bank && !quick && !fiveK,
      quick,
      rollMode: ROLL_MODES.includes(v.rollMode) ? v.rollMode : 'charge',
    };
  }

  function diceCountFor(variant) { return variant.quick ? Scoring.QUICK_DICE : variant.sixDice ? 6 : 5; }
  /* Heittoja vuorolla ennen pankkia. Vanhat tallennetut huoneet ilman
     quick-kenttää ovat tavallisia (3). */
  function maxRollsFor(variant) { return variant.quick ? 1 : 3; }
  /* Paikan pisteet: 5000:ssa summa, muuten pöytäkirjan loppusumma. */
  function seatTotal(variant, p) {
    return variant.fiveK ? (p.total || 0) : Scoring.playerTotal(p, variant.sixDice);
  }
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
      total: 0,
      turns: 0,
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
    room.lastScore = null;
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
    room.lastScore = null;
    room.lastMark = null;
    room.pot = 0;
    room.locked = new Array(diceCount).fill(false);
    room.rollSeq = 0;
    room.players.forEach(p => { p.scs = emptyScs(room.variant); p.bank = 0; p.total = 0; p.turns = 0; });
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
  /* lock: heittäjän kesken heiton lukitsemat nopat (pysähtyneet, ks.
     dice3d.js:n lockResting). Ne vain lisäävät lukittuja, eivät vapauta,
     ja vain kun vuorossa on vielä heitettävää; pikajatsissa ei lukita. */
  function roll(room, userId, diceValues, lock) {
    if (room.status !== 'playing') throw new Error('Peli ei ole käynnissä.');
    requireTurn(room, userId);
    if (room.variant.fiveK) return rollFiveK(room, diceValues);
    const diceCount = diceCountFor(room.variant);
    const useBank = room.rollsUsed >= maxRollsFor(room.variant);
    if (useBank && !bankAvailable(room)) throw new Error('Heitot käytetty — valitse rivi.');
    if (
      !Array.isArray(diceValues) ||
      diceValues.length !== diceCount ||
      !diceValues.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)
    ) {
      throw new Error('Virheelliset noppien arvot.');
    }
    room.diceValues = diceValues.slice();
    room.lastScore = null;
    if (useBank) currentPlayer(room).bank--;
    else room.rollsUsed++;
    if (Array.isArray(lock) && !room.variant.quick &&
        (room.rollsUsed < maxRollsFor(room.variant) || bankAvailable(room))) {
      lock.slice(0, diceCount).forEach((h, i) => { if (h === true) room.held[i] = true; });
    }
    return room.diceValues;
  }

  function hold(room, userId, index) {
    if (room.status !== 'playing') throw new Error('Peli ei ole käynnissä.');
    requireTurn(room, userId);
    if (room.variant.fiveK) return holdFiveK(room, index);
    if (room.variant.quick) throw new Error('Pikajatsissa nopat heitetään kerran — lukitusta ei ole.');
    const diceCount = diceCountFor(room.variant);
    if (!Number.isInteger(index) || index < 0 || index >= diceCount) throw new Error('Virheellinen noppa.');
    if (room.rollsUsed === 0) throw new Error('Heitä ensin.');
    if (room.rollsUsed >= maxRollsFor(room.variant) && !bankAvailable(room)) throw new Error('Ei enää heittoja tällä vuorolla.');
    room.held[index] = !room.held[index];
  }

  function resetTurn(room) {
    const diceCount = diceCountFor(room.variant);
    room.rollsUsed = 0;
    room.held = new Array(diceCount).fill(false);
    room.diceValues = new Array(diceCount).fill(0);
    room.pot = 0;
    room.locked = new Array(diceCount).fill(false);
  }

  function filledCount(p) {
    return p.scs.reduce((n, sc) => n + Object.keys(sc).length, 0);
  }

  /* ---------- 5000 ---------- */
  const FK = Scoring.FIVEK;
  const isValues = (dv, n) => Array.isArray(dv) && dv.length === n && dv.every(v => Number.isInteger(v) && v >= 1 && v <= 6);
  /* Viimeisimmän heiton nopat (ei aiemmin sivuun siirretyt) ja niistä nyt
     sivuun valitut. */
  function fkThrown(room) { return room.diceValues.filter((v, i) => !room.locked[i]); }
  function fkSelected(room) { return room.diceValues.filter((v, i) => room.held[i] && !room.locked[i]); }

  /* Vuoron tilanne: mitä valinta tuottaa ja mitä pelaaja saa tehdä. Ilman
     valintaa koko heitto siirtyy sivuun, jos sen jokainen noppa tuottaa
     pisteitä (auto). hot = seuraava heitto heittää kaikki nopat. */
  function fkTurn(room) {
    const n = diceCountFor(room.variant);
    const p = currentPlayer(room);
    const out = { pot: room.pot || 0, sel: 0, auto: false, hot: false, canRoll: true, bankValue: 0, canBank: false };
    if (room.status !== 'playing' || !p || room.rollsUsed === 0) return out;
    const sel = fkSelected(room);
    const thrown = fkThrown(room);
    out.sel = Scoring.fkScoreSet(sel, n);
    if (!sel.length) { out.sel = Scoring.fkScoreSet(thrown, n); out.auto = out.sel > 0; }
    out.canRoll = out.sel > 0;
    out.hot = out.auto || (out.sel > 0 && room.held.every(Boolean));
    out.bankValue = out.pot + Scoring.fkBest(thrown, n).pts;
    out.canBank = (p.total || 0) > 0 || out.bankValue >= FK.OPEN;
    return out;
  }

  function fkGameOver(room) {
    const t = room.players[0].turns || 0;
    return room.players.some(p => (p.total || 0) >= FK.TARGET) && room.players.every(p => (p.turns || 0) === t);
  }

  /* Vuoro päättyy pankitukseen tai tyhjään heittoon. Silmäluvut jäävät
     näkyviin seuraavaan heittoon asti. */
  function fkEndTurn(room, mark) {
    const n = diceCountFor(room.variant);
    const p = currentPlayer(room);
    p.turns = (p.turns || 0) + 1;
    room.lastMark = Object.assign({ seatId: p.seatId, n: room.rollSeq }, mark);
    room.pot = 0;
    room.rollsUsed = 0;
    room.held = new Array(n).fill(false);
    room.locked = new Array(n).fill(false);
    room.current = (room.current + 1) % room.players.length;
    advanceIfCurrentFinished(room);
    checkTurnOrder(room, '5000');
  }

  function rollFiveK(room, diceValues) {
    const n = diceCountFor(room.variant);
    if (!isValues(diceValues, n)) throw new Error('Virheelliset noppien arvot.');
    if (room.rollsUsed > 0) {
      const t = fkTurn(room);
      if (!t.canRoll) throw new Error('Siirrä ensin sivuun pisteitä tuottavia noppia.');
      room.pot = t.pot + t.sel;
      if (t.hot) { room.held.fill(false); room.locked.fill(false); }
      else room.locked = room.held.slice();
    }
    room.diceValues = diceValues.map((v, i) => (room.locked[i] ? room.diceValues[i] : v));
    room.rollsUsed++;
    room.rollSeq = (room.rollSeq || 0) + 1;
    room.lastScore = null;
    if (Scoring.fkBest(fkThrown(room), n).pts === 0) fkEndTurn(room, { bust: true, pts: 0, lost: room.pot });
    return room.diceValues;
  }

  /* Nopan siirto sivuun tai takaisin. Ykkönen ja vitonen siirtyvät yksin;
     muu silmäluku siirtyy koko ryhmänä (kolme tai useampi samaa), ja noppa
     joka tuottaa pisteitä vain koko heiton yhdistelmässä (suora, kolme
     paria) vie mukanaan koko heiton. */
  function holdFiveK(room, index) {
    const n = diceCountFor(room.variant);
    if (!Number.isInteger(index) || index < 0 || index >= n) throw new Error('Virheellinen noppa.');
    if (room.rollsUsed === 0) throw new Error('Heitä ensin.');
    if (room.locked[index]) throw new Error('Noppa on siirretty sivuun jo aiemmalla heitolla.');
    const on = !room.held[index];
    const v = room.diceValues[index];
    const free = room.diceValues.map((x, i) => !room.locked[i]);
    const same = room.diceValues.filter((x, i) => free[i] && x === v).length;
    const thrownIdx = room.diceValues.map((x, i) => i).filter(i => free[i]);
    const best = Scoring.fkBest(thrownIdx.map(i => room.diceValues[i]), n);
    if (on && !best.mask[thrownIdx.indexOf(index)]) throw new Error('Tämä noppa ei tuota pisteitä.');
    const group = (v === 1 || v === 5) && same < 3 ? (i) => i === index
      : same >= 3 ? (i) => room.diceValues[i] === v
      : () => true;
    for (let i = 0; i < n; i++) if (free[i] && group(i)) room.held[i] = on;
  }

  function bank(room, userId) {
    if (room.status !== 'playing') throw new Error('Peli ei ole käynnissä.');
    requireTurn(room, userId);
    if (!room.variant.fiveK) throw new Error('Pankitus kuuluu vain 5000-peliin.');
    if (room.rollsUsed === 0) throw new Error('Heitä ensin.');
    const t = fkTurn(room);
    if (!t.canBank) throw new Error(`Avaukseen tarvitaan vähintään ${FK.OPEN} pistettä yhdellä vuorolla.`);
    const p = currentPlayer(room);
    p.total = (p.total || 0) + t.bankValue;
    fkEndTurn(room, { bank: true, pts: t.bankValue });
    return t.bankValue;
  }

  /* Vuorojärjestyksen tarkistus. Jokainen vuoro merkitsee tasan yhden rivin,
     joten kierroksen aikana pelaajilla on merkittyjä rivejä [k+1, …, k+1, k, …, k]
     ja vuorossa on ensimmäinen jolla on k. Toisin sanoen: kaikki ennen vuorossa
     olevaa ovat heittäneet ja merkinneet tuloksensa tällä kierroksella. Jos tila
     on jostain syystä muuta, vuoro korjataan sille jonka kuuluu pelata — ja
     kesken jäänyt vuoro alkaa alusta, koska sen heitot eivät ole hänen. */
  function expectedCurrent(room) {
    const six = room.variant.sixDice;
    const fiveK = room.variant.fiveK;
    let best = -1, min = Infinity;
    room.players.forEach((p, i) => {
      if (!fiveK && p.scs.every(sc => Scoring.scFull(sc, six))) return;
      const n = fiveK ? (p.turns || 0) : filledCount(p);
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
    if (room.variant.fiveK) {
      if (fkGameOver(room)) room.status = 'finished';
      return;
    }
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
    if (room.variant.fiveK) throw new Error('5000-pelissä ei merkitä rivejä.');
    if (room.rollsUsed === 0) throw new Error('Heitä ensin.');
    const six = room.variant.sixDice;
    const validId = Scoring.allCats(six).some(c => c.id === categoryId);
    if (!validId) throw new Error('Tuntematon kategoria.');
    const p = currentPlayer(room);
    const colIdx = room.variant.twoCol ? (col === 1 ? 1 : 0) : 0;
    if (!p.scs[colIdx]) throw new Error('Virheellinen sarake.');
    if (p.scs[colIdx][categoryId] !== undefined) throw new Error('Rivi on jo merkitty.');
    const pts = Scoring.scoreCat(categoryId, room.diceValues, six);
    const undo = {
      userId: p.userId, seatId: p.seatId, col: colIdx, categoryId, bank: p.bank || 0,
      current: room.current, rollsUsed: room.rollsUsed,
      diceValues: room.diceValues.slice(), held: room.held.slice(),
      seats: room.players.map(x => x.seatId).join(','),
      prevMark: room.lastMark || null,
    };
    p.scs[colIdx][categoryId] = pts;
    /* Viimeisin merkintä kaikille näkyviin seuraavaan merkintään asti. */
    room.lastMark = { seatId: p.seatId, col: colIdx, categoryId, pts };
    if (room.variant.bank) p.bank = (p.bank || 0) + Math.max(0, maxRollsFor(room.variant) - room.rollsUsed);
    resetTurn(room);
    room.current = (room.current + 1) % room.players.length;
    advanceIfCurrentFinished(room);
    checkTurnOrder(room, 'score');
    /* Pelin päättänyttä merkintää ei voi perua: tulos on jo historiassa ja
       tulostaulussa. */
    room.lastScore = room.status === 'playing' ? undo : null;
    return pts;
  }

  /* PERUMINEN: merkinnän tehnyt laite (userId; laitteen kaikki paikat) voi
     perua viimeisimmän merkinnän, kunnes seuraava heitto tehdään. Vuoro
     palaa samoihin noppiin, heittoihin ja pankkiin, joten vuoroa voi jatkaa
     heittämällä (myös pankista) tai merkitä toisen rivin. Pelaajien
     muuttuminen välissä (poistuminen, poisto) estää perumisen, koska vuoro
     on indeksi pelaajalistaan. */
  function undoScore(room, userId) {
    const u = room.lastScore;
    if (room.status !== 'playing' || !u) throw new Error('Ei peruttavaa.');
    if (u.userId !== userId) throw new Error('Vain merkinnän tehnyt voi perua sen.');
    const p = room.players.find(x => x.seatId === u.seatId);
    if (!p || room.players.map(x => x.seatId).join(',') !== u.seats) {
      room.lastScore = null;
      throw new Error('Pelaajat ovat vaihtuneet, joten merkintää ei voi enää perua.');
    }
    delete p.scs[u.col][u.categoryId];
    p.bank = u.bank;
    room.current = u.current;
    room.rollsUsed = u.rollsUsed;
    room.diceValues = u.diceValues.slice();
    room.held = u.held.slice();
    room.lastMark = u.prevMark || null;
    room.lastScore = null;
  }

  function rankings(room) {
    return [...room.players]
      .map(p => ({
        seatId: p.seatId, userId: p.userId, username: p.username, guest: !!p.guest,
        total: seatTotal(room.variant, p), turns: p.turns || 0,
      }))
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
      /* 5000:ssa heittoja ei ole rajattu (0); vuoron tilanne on fiveK-kentässä. */
      maxRolls: room.variant.fiveK ? 0 : maxRollsFor(room.variant),
      fiveK: room.variant.fiveK ? Object.assign(fkTurn(room), {
        locked: room.locked || [], target: FK.TARGET, open: FK.OPEN, rollSeq: room.rollSeq || 0,
      }) : null,
      current: room.current,
      rollsUsed: room.rollsUsed,
      diceValues: room.diceValues,
      held: room.held,
      bankAvailable: bankAvailable(room),
      /* Laite (userId), joka voi perua viimeisimmän merkinnän. */
      undoBy: room.status === 'playing' && room.lastScore ? room.lastScore.userId : null,
      /* Viimeisin merkintä: { seatId, col, categoryId, pts } tai null.
         5000:ssa vuoron loppu: { seatId, n, pts, bank } tai { seatId, n, bust, lost }. */
      lastMark: room.lastMark || null,
      players: room.players.map(p => ({
        seatId: p.seatId, guest: !!p.guest,
        userId: p.userId, username: p.username, color: p.color,
        scs: p.scs, bank: p.bank || 0, total: p.total || 0, turns: p.turns || 0, connected: p.connected !== false,
      })),
      pendingGuests: (room.pendingGuests || []).map(g => ({ seatId: g.seatId, userId: g.userId, username: g.username, color: g.color })),
      played: !!room.played || room.status !== 'open',
      rankings: room.status === 'finished' ? rankings(room) : null,
      lbEntries: room.status === 'finished' ? (room.lbEntries || null) : null,
    };
  }

  const api = {
    PALETTE, MAX_PLAYERS, ROLL_MODES,
    sanitizeVariant, diceCountFor, maxRollsFor, seatTotal, colsFor, emptyScs,
    accountSeatId, accountSeat, seatsOf, nameTaken, freeColor, newSeat, dropSeats, setSeatColor, reorderSeats,
    startGame, resetForRematch, currentPlayer, requireTurn, bankAvailable,
    roll, hold, bank, resetTurn, score, undoScore, rankings, publicState,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api; /* Node (palvelin) */
  } else {
    root.RoomRules = api;  /* selain (globaali) */
  }

})(typeof window !== 'undefined' ? window : globalThis);
