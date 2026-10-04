"use strict";
/* ============================================================
   local-room.js — offline-peli: huone joka elää tässä selaimessa.

   Tarjoaa saman socket-rajapinnan (on/emit/disconnect) kuin Socket.io-yhteys,
   joten MpGame ja koko verkkopelin käyttöliittymä toimivat sellaisinaan.
   Säännöt ovat samat kuin palvelimella (js/room-rules.js). Kaikki paikat
   ovat tämän laitteen: ensimmäinen pelaaja on "tilin" paikka, muut vieraita,
   ja käyttäjä on pseudo-tili LOCAL_USER — siksi jokainen vuoro on tämän
   laitteen vuoro.

   Huone tallennetaan localStorageen jokaisen muutoksen jälkeen, joten
   sivun päivitys palaa samaan peliin (local:resume → room:rejoin).
   Offline-pelissä viimeisimmän merkinnän voi perua (local:undo).
   ============================================================ */
window.LocalRoom = (function () {
  const R = () => window.RoomRules;
  const KEY = 'jatsi.offline.room';
  const LOCAL_USER = { id: 'offline', username: 'Tämä laite' };
  const ROOM_ID = 'offline';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* yksityinen selaus tms. */ }
  }

  /** Tallennettu peli, jota voi jatkaa (ei päättynyt). */
  function savedGame() {
    const d = load();
    return d && d.room && d.room.status === 'playing' ? d.room : null;
  }

  function stateOf(data) {
    return Object.assign(R().publicState(data.room), {
      local: true, gameKey: data.room.gameKey, canUndo: !!data.undo, spectators: [], blocked: [],
    });
  }

  /* Uusi huone pelaajalistasta [{ name, color }]. */
  function buildRoom(players, variant) {
    const room = {
      id: ROOM_ID, name: 'Offline', hostId: LOCAL_USER.id, maxPlayers: R().MAX_PLAYERS,
      variant: R().sanitizeVariant(variant), status: 'open', players: [],
      current: 0, rollsUsed: 0, diceValues: [], held: [], createdAt: Date.now(),
    };
    players.slice(0, R().MAX_PLAYERS).forEach((p, i) => {
      const name = String(p.name || '').trim().slice(0, 20) || `Pelaaja ${i + 1}`;
      room.players.push(R().newSeat(room, {
        userId: LOCAL_USER.id, username: name, color: p.color, guest: i > 0, seatId: 'g' + i,
      }));
    });
    return room;
  }

  function start(room) {
    R().startGame(room, 1);
    room.gameKey = 'offline:' + Date.now();
  }

  function socket() {
    const handlers = {};
    let data = load() || {};
    const fire = (ev, payload) => (handlers[ev] || []).forEach((fn) => fn(payload));
    /* Vastaukset ja tapahtumat ajetaan seuraavalla kierroksella kuten
       verkosta tulleet, jotta kutsujan järjestysoletukset pitävät. */
    const later = (fn) => setTimeout(fn, 0);
    const commit = () => save(data);
    const broadcast = () => later(() => fire('room:state', stateOf(data)));

    const actions = {
      'local:create'({ players, variant }) {
        data = { room: buildRoom(players || [], variant), undo: null };
        start(data.room);
        commit();
        later(() => fire('room:rejoin', stateOf(data)));
      },
      'local:resume'() {
        if (!data.room) throw new Error('Ei tallennettua peliä.');
        later(() => fire('room:rejoin', stateOf(data)));
      },
      'room:rematch'({ variant }) {
        R().resetForRematch(data.room, variant);
        start(data.room);
        data.undo = null;
        commit(); broadcast();
      },
      'game:roll'({ diceValues }) {
        R().roll(data.room, LOCAL_USER.id, diceValues);
        commit(); broadcast();
        const dv = data.room.diceValues.slice();
        later(() => fire('game:rollPlayback', { diceValues: dv, trajectory: [], rollerId: LOCAL_USER.id }));
      },
      'game:hold'({ index }) {
        R().hold(data.room, LOCAL_USER.id, index);
        commit(); broadcast();
      },
      'game:score'({ categoryId, col }) {
        const before = JSON.stringify(data.room);
        R().score(data.room, LOCAL_USER.id, categoryId, col);
        data.undo = before;
        commit(); broadcast();
      },
      /* Peruu viimeisimmän merkinnän: huone palaa merkintää edeltäneeseen
         tilaan, eli samoille nopille ja heitoille. */
      'local:undo'() {
        if (!data.undo) throw new Error('Ei peruttavaa.');
        data.room = JSON.parse(data.undo);
        data.undo = null;
        commit(); broadcast();
      },
      'room:color'({ seatId, color }) {
        R().setSeatColor(data.room, LOCAL_USER.id, seatId, color);
        commit(); broadcast();
      },
      /* ✕ vie takaisin aloitusnäkymään; peli jää talteen jatkettavaksi. */
      'room:leave'() {},
    };

    return {
      connected: true,
      on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
      emit(ev, payload, ack) {
        const fn = actions[ev];
        let res;
        try {
          if (!fn) throw new Error('Ei käytössä offline-pelissä.');
          fn(payload || {});
          res = { ok: true, roomId: ROOM_ID };
        } catch (e) { res = { ok: false, error: e.message }; }
        if (ack) later(() => ack(res));
      },
      disconnect() { this.connected = false; Object.keys(handlers).forEach((k) => delete handlers[k]); },
    };
  }

  return { socket, savedGame, LOCAL_USER };
})();
