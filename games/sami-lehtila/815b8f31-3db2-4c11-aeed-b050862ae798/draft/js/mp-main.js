"use strict";
/* ============================================================
   mp-main.js — näkymien vaihto ja DOM-kytkennät. Kaksi tilaa samalla
   käyttöliittymällä:
     verkossa  kirjautuminen → aula → pelihuone (palvelin, MpApi)
     offline   aloitusnäkymä → pelihuone (LocalRoom tässä selaimessa)
   Pelihuone on kummassakin sama; offline-huoneen tila kantaa
   `local: true`. Kokoaa MpApi + MpGame + MpUI + LocalRoom yhteen.
   ============================================================ */
(function () {
  const authView = document.getElementById('authView');
  const lobbyView = document.getElementById('lobbyView');
  const roomView = document.getElementById('roomView');
  const offlineView = document.getElementById('offlineView');
  const MODE_KEY = 'jatsi.mode';
  let mode = 'offline';   // 'online' | 'offline'
  let account = null;     // kirjautunut tili (verkossa)
  let me = null;          // nykyinen identiteetti: tili tai LocalRoom.LOCAL_USER
  let announcedFinishedRoomId = null;
  let lastRenderedState = null;
  let roomStatus = null; // viimeksi piirretyn huoneen tila (open/playing/finished)
  let amIPlayer = false; // false = katsotaan huonetta
  let lastState0 = null; // viimeisin huoneen tila missä tahansa vaiheessa (henkilölistalle)
  let shownLocalGame = null; // offline-peli jonka tulostaulu on jo lähetetty ja piirretty

  if (window.MpSettings) {
    window.MpSettings.load();
    window.MpSettings.wire(() => { if (lastRenderedState) renderRoom(lastRenderedState); });
  }

  function showView(v) {
    authView.style.display = v === 'auth' ? 'flex' : 'none';
    lobbyView.style.display = v === 'lobby' ? 'flex' : 'none';
    roomView.style.display = v === 'room' ? 'flex' : 'none';
    offlineView.style.display = v === 'offline' ? 'flex' : 'none';
  }

  function setAuthError(msg) { document.getElementById('authError').textContent = msg || ''; }
  function setLobbyError(msg) { document.getElementById('lobbyError').textContent = msg || ''; }

  /* Tila muistetaan; ensikäynnillä offline, koska se ei vaadi tiliä. */
  function boot() {
    let saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch (e) {}
    switchMode(saved === 'online' ? 'online' : 'offline');
  }

  function switchMode(m) {
    mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
    closePeople();
    document.getElementById('winnerOverlay').style.display = 'none';
    if (m === 'offline') enterOffline();
    else enterOnline();
  }
  document.querySelectorAll('.modeTab').forEach((b) => b.addEventListener('click', () => switchMode(b.dataset.mode)));

  async function enterOnline() {
    window.MpGame.disconnect();
    if (account) { me = account; enterLobby(); return; }
    showView('auth');
    try {
      const { user } = await window.MpApi.me();
      account = user;
      if (mode === 'online') { me = account; enterLobby(); }
    } catch (e) { /* ei kirjautunut — kirjautumisnäkymä jää */ }
  }

  /* ---------- Offline: aloitusnäkymä ----------
     Pelaajat ja säännöt muistetaan (SETUP_KEY). Kesken oleva peli jatkuu
     JATKA PELIÄ -napista; uusi peli sen päälle kysyy ensin. */
  const SETUP_KEY = 'jatsi.offline.setup';
  const PALETTE = () => window.RoomRules.PALETTE;
  let setup = null;
  function loadSetup() {
    try { setup = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null'); } catch (e) { setup = null; }
    if (!setup || !Array.isArray(setup.players) || !setup.players.length) {
      setup = { players: [{ name: '', color: PALETTE()[0] }, { name: '', color: PALETTE()[1] }], variant: {} };
    }
  }
  function saveSetup() { try { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch (e) {} }

  function enterOffline() {
    me = window.LocalRoom.LOCAL_USER;
    window.MpGame.connect(me, window.LocalRoom.socket());
    wireRoomEvents();
    if (!setup) loadSetup();
    renderOfflineSetup();
    showView('offline');
  }

  function renderOfflineSetup() {
    const list = document.getElementById('offPlayers');
    list.innerHTML = '';
    setup.players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'offPlayerRow';
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'offColor';
      dot.style.background = p.color;
      dot.title = 'Vaihda väriä';
      dot.addEventListener('click', () => {
        const pal = PALETTE();
        p.color = pal[(pal.indexOf(p.color) + 1) % pal.length];
        saveSetup(); renderOfflineSetup();
      });
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 20;
      input.placeholder = `Pelaaja ${i + 1}`;
      input.value = p.name;
      input.addEventListener('input', () => { p.name = input.value; saveSetup(); });
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') startOffline(); });
      row.append(dot, input);
      if (setup.players.length > 1) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'offRemove';
        del.textContent = '✕';
        del.title = 'Poista pelaaja';
        del.addEventListener('click', () => { setup.players.splice(i, 1); saveSetup(); renderOfflineSetup(); });
        row.appendChild(del);
      }
      list.appendChild(row);
    });
    document.getElementById('offAddPlayer').style.display = setup.players.length < window.RoomRules.MAX_PLAYERS ? '' : 'none';
    const v = setup.variant || {};
    document.getElementById('offTwoCol').checked = !!v.twoCol;
    document.getElementById('offSixDice').checked = !!v.sixDice;
    document.getElementById('offBank').checked = !!v.bank;
    document.getElementById('offRollMode').value = v.rollMode || 'charge';
    const saved = window.LocalRoom.savedGame();
    const resume = document.getElementById('offResumeBtn');
    resume.style.display = saved ? 'block' : 'none';
    if (saved) resume.textContent = 'JATKA PELIÄ · ' + saved.players.map((p) => p.username).join(', ');
  }

  function readOfflineVariant() {
    setup.variant = {
      twoCol: document.getElementById('offTwoCol').checked,
      sixDice: document.getElementById('offSixDice').checked,
      bank: document.getElementById('offBank').checked,
      rollMode: document.getElementById('offRollMode').value,
    };
    saveSetup();
  }
  ['offTwoCol', 'offSixDice', 'offBank', 'offRollMode'].forEach((id) =>
    document.getElementById(id).addEventListener('change', readOfflineVariant));
  document.getElementById('offAddPlayer').addEventListener('click', () => {
    const used = new Set(setup.players.map((p) => p.color));
    setup.players.push({ name: '', color: PALETTE().find((c) => !used.has(c)) || PALETTE()[0] });
    saveSetup(); renderOfflineSetup();
  });

  function startOffline() {
    readOfflineVariant();
    const names = setup.players.map((p, i) => p.name.trim() || `Pelaaja ${i + 1}`);
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) {
      window.MpUI.dialog({ title: 'Sama nimi kahdesti', text: 'Anna jokaiselle pelaajalle oma nimi.' });
      return;
    }
    const go = () => window.MpGame.localCreate(
      setup.players.map((p, i) => ({ name: names[i], color: p.color })), setup.variant,
      (res) => { if (!res.ok) window.MpUI.dialog({ title: 'Ei onnistunut', text: res.error }); });
    if (window.LocalRoom.savedGame()) {
      window.MpUI.dialog({
        title: 'Aloitetaanko uusi peli?', text: 'Kesken oleva peli häviää.',
        okText: 'Uusi peli', danger: true, onOk: go,
      });
    } else go();
  }
  document.getElementById('offStartBtn').addEventListener('click', startOffline);
  document.getElementById('offResumeBtn').addEventListener('click', () => window.MpGame.localResume());

  /* Offline: viimeisimmän merkinnän peruminen. Nopat palaavat merkintää
     edeltäneisiin silmälukuihin. */
  document.getElementById('undoBtn').addEventListener('click', () => {
    window.MpGame.undo((res) => {
      if (!res.ok) return;
      setTimeout(() => {
        const st = lastRenderedState;
        if (st && window.Dice3D) window.Dice3D.restoreDisplay(st.diceValues, st.held);
      }, 0);
    });
  });

  /* Pelaajan oma väri (avatar) — tilikohtainen, ks. server/auth.js:n
     PALETTE-validointi. Sama 8 värin lista kuin yksinpelin swatch-valitsin
     (js/ui.js UI.PALETTE), joten "avatar" näyttää samalta kummassakin. */
  function renderColorPicker() {
    const dot = document.getElementById('lobbyColorDot');
    if (dot) dot.style.background = me.color || '#ffffff';
    const wrap = document.getElementById('colorSwatches');
    if (!wrap) return;
    const palette = (window.UI && window.UI.PALETTE) || ['#ffffff','#ff6b5e','#ffab4d','#ffd94d','#7fd98f','#5fd6d0','#6ea8ff','#c58bff'];
    wrap.innerHTML = '';
    palette.forEach((col) => {
      const s = document.createElement('div');
      s.className = 'sw' + (me.color === col ? ' on' : '');
      s.style.background = col;
      s.title = col;
      s.addEventListener('click', async () => {
        if (me.color === col) return;
        try {
          const { user } = await window.MpApi.setColor(col);
          me.color = user.color;
          renderColorPicker();
        } catch (e) { setLobbyError(e.message); }
      });
      wrap.appendChild(s);
    });
  }

  function enterLobby() {
    showView('lobby');
    document.getElementById('lobbyUsername').textContent = me.username;
    renderColorPicker();
    window.MpGame.connect(me);
    window.MpGame.onLobby((rooms) => {
      window.MpUI.renderRoomList(document.getElementById('roomList'), rooms, me.id, joinRoom, deleteRoomFromLobby, forfeitRoom, watchRoom);
    });
    wireRoomEvents();
  }

  /* Huoneen tapahtumat; samat kummassakin tilassa. */
  function wireRoomEvents() {
    window.MpGame.onRoomState((state) => renderRoom(state));
    window.MpGame.onRoomError((msg) => setLobbyError(msg));
    /* Palvelin liittää automaattisesti takaisin kesken olevaan peliin jos
       ollaan jo sen pelaaja (esim. sivu päivitettiin) — vaihdetaan näkymä
       suoraan huoneeseen sen sijaan että jäätäisiin lobbyyn. */
    window.MpGame.onRejoin((state) => {
      showView('room');
      renderRoom(state);
      /* Dice3D.init() (kutsutaan room:rejoin-käsittelijän sisällä, ennen
         tätä) mittasi canvasWrapin koon SILLOIN kun #roomView oli vielä
         display:none — three.js-renderer jäi siis nollakokoiseksi eikä
         mikään pakota uutta mittausta ennen kuin ikkunaa oikeasti muutetaan
         (klassinen "kanvas tyhjä kunnes resize" -bugi). Nyt kun näkymä on
         juuri asetettu näkyväksi, pakotetaan uusi mittaus eksplisiittisesti
         sen sijaan että odotettaisiin oikeaa window-resize-tapahtumaa. */
      if (window.Dice3D) window.Dice3D.resize(true);
    });
    window.MpGame.onDeleted(() => { closePeople(); showView('lobby'); setLobbyError('Isäntä poisti huoneen.'); });
    window.MpGame.onBlocked(() => {
      announcedFinishedRoomId = null;
      closePeople();
      document.getElementById('winnerOverlay').style.display = 'none';
      showView('lobby');
      setLobbyError('Isäntä esti sinut huoneesta.');
    });
    window.MpGame.onNotice((message) => window.MpUI.dialog({ title: 'Huoneessa', text: message }));
  }

  function deleteRoomFromLobby(roomId) {
    setLobbyError('');
    window.MpGame.deleteRoom(roomId, (res) => { if (!res.ok) setLobbyError(res.error); });
  }

  function forfeitRoom(roomId) {
    setLobbyError('');
    window.MpGame.leaveRoom((res) => { if (res && !res.ok) setLobbyError(res.error); }, roomId);
  }

  function watchRoom(roomId) {
    setLobbyError('');
    window.MpGame.watchRoom(roomId, (res) => {
      if (!res.ok) { setLobbyError(res.error); return; }
      showView('room');
      /* Sama nollakokoisen kanvaksen korjaus kuin onRejoinissa: Dice3D
         alustettiin kun huonenäkymä oli vielä piilossa. */
      if (window.Dice3D) window.Dice3D.resize(true);
    });
  }

  /* ---------- Huoneen ihmiset ----------
     Lista on auki niin kauan kuin käyttäjä sen sulkee, ja piirtyy
     uudelleen jokaisesta huoneen tilasta. Pelistä poisto ja esto ovat
     muihin kohdistuvia, joten ne kysyvät ikkunassa. */
  const peopleOverlay = document.getElementById('peopleOverlay');
  function openPeople() {
    peopleOverlay.style.display = 'flex';
    if (lastState0) renderPeopleList(lastState0);
  }
  function closePeople() { peopleOverlay.style.display = 'none'; }
  function renderPeopleList(state) {
    if (peopleOverlay.style.display === 'none') return;
    window.MpUI.renderPeople(document.getElementById('peopleList'), state, me.id, peopleAction);
  }
  function peopleAction(action, person) {
    const done = (res) => { if (!res.ok) window.MpUI.dialog({ title: 'Ei onnistunut', text: res.error }); };
    const name = person.username;
    if (action === 'color') {
      window.MpGame.setSeatColor(person.seatId, person.color, (res) => {
        done(res);
        if (res.ok && !person.guest && account && person.userId === account.id) { account.color = person.color; }
      });
      return;
    }
    if (action === 'removeGuest' || action === 'admitGuest') {
      const run = () => (action === 'removeGuest'
        ? window.MpGame.guest({ action: 'remove', seatId: person.seatId }, done)
        : window.MpGame.admin(action, { seatId: person.seatId }, done));
      if (action === 'removeGuest' && roomStatus === 'playing') {
        window.MpUI.dialog({
          title: `Poista ${name}?`, text: `${name} lähtee pelistä ja pisteet menevät. Peli jatkuu muilla.`,
          okText: 'Poista', danger: true, onOk: run,
        });
      } else run();
      return;
    }
    const run = () => window.MpGame.admin(action, { userId: person.userId }, done);
    if (action === 'kick') {
      window.MpUI.dialog({
        title: `Poista ${name} pelistä?`,
        text: roomStatus === 'playing'
          ? `${name} menettää pisteensä ja jää katsomaan. Peli jatkuu muilla. Voit päästää hänet seuraavaan peliin.`
          : `${name} jää huoneeseen katsojaksi. Voit päästää hänet takaisin peliin.`,
        okText: 'Pois pelistä', danger: true, onOk: run,
      });
    } else if (action === 'block') {
      window.MpUI.dialog({
        title: `Estä ${name}?`,
        text: `${name} poistuu pelistä ja huoneesta eikä pääse takaisin pelaamaan eikä katsomaan, ennen kuin poistat eston.`,
        okText: 'Estä', danger: true, onOk: run,
      });
    } else {
      run();
    }
  }
  document.getElementById('peopleBtn').addEventListener('click', openPeople);
  document.getElementById('closePeople').addEventListener('click', closePeople);
  peopleOverlay.addEventListener('click', (ev) => { if (ev.target === peopleOverlay) closePeople(); });

  function joinRoom(roomId) {
    setLobbyError('');
    window.MpGame.joinRoom(roomId, (res) => {
      if (!res.ok) { setLobbyError(res.error); return; }
      showView('room');
    });
  }

  document.getElementById('createRoomBtn').addEventListener('click', () => {
    setLobbyError('');
    const name = document.getElementById('roomNameInput').value.trim() || (me.username + ' peli');
    const max = parseInt(document.getElementById('roomMaxInput').value, 10);
    const variant = {
      twoCol: document.getElementById('variantTwoCol').checked,
      sixDice: document.getElementById('variantSixDice').checked,
      bank: document.getElementById('variantBank').checked,
      rollMode: document.getElementById('variantRollMode').value,
    };
    window.MpGame.createRoom(name, max, variant, (res) => {
      if (!res.ok) { setLobbyError(res.error); return; }
      showView('room');
    });
  });

  function renderRoom(state) {
    roomStatus = state.status;
    lastState0 = state;
    renderPeopleList(state);
    amIPlayer = state.players.some((p) => p.userId === me.id);
    document.getElementById('leaveRoomBtn').title = state.local ? 'Takaisin aloitukseen — peli säilyy'
      : !amIPlayer ? 'Lopeta katsominen'
      : state.status === 'playing' ? 'Takaisin aulaan — paikka säilyy' : 'Poistu huoneesta';

    document.getElementById('undoBtn').classList.toggle('show', !!(state.local && state.status === 'playing' && state.canUndo));
    const amIHost = state.hostId === me.id;
    const preGame = state.status === 'open';
    document.getElementById('mpPreGame').style.display = preGame ? 'flex' : 'none';
    document.getElementById('controls').style.display = preGame ? 'none' : 'flex';
    document.getElementById('mpPlayers').style.display = preGame ? 'none' : 'flex';
    document.getElementById('board').style.display = preGame ? 'none' : 'block';

    if (preGame) {
      window.MpUI.renderPlayers(document.getElementById('mpPlayersPre'), state, me.id, openPeople);
      document.getElementById('mpStartBtn').style.display = amIHost && state.players.length >= 2 ? 'block' : 'none';
      document.getElementById('mpDeleteRoomBtn').style.display = amIHost ? 'block' : 'none';
      /* Katsoja pääsee itse pelaajaksi avoimeen huoneeseen jossa on tilaa,
         paitsi jos isäntä on poistanut hänet pelistä. */
      const mine = (state.spectators || []).find((s) => s.userId === me.id);
      const full = state.players.length >= state.maxPlayers;
      const room4me = !amIPlayer && !full && !state.played && !(mine && mine.benched);
      document.getElementById('mpJoinBtn').style.display = room4me ? 'block' : 'none';
      /* Vieraan tuonti omalle laitteelle: pelaajat, kun huoneessa on tilaa.
         Isännän hyväksyntää odottavat näkyvät henkilölistassa. */
      const seatsTaken = state.players.length + (state.pendingGuests || []).length;
      document.getElementById('mpGuestRow').style.display = amIPlayer && seatsTaken < state.maxPlayers ? 'flex' : 'none';
      const myPending = (state.pendingGuests || []).filter((g) => g.userId === me.id).map((g) => g.username);
      document.getElementById('mpGuestNote').textContent = myPending.length ? `Odottaa isännän hyväksyntää: ${myPending.join(', ')}` : '';
      const wait = document.getElementById('mpWaitMsg');
      wait.style.display = amIHost && state.players.length >= 2 ? 'none' : 'block';
      wait.textContent = !amIPlayer && full ? 'Huone on täynnä — katsot peliä.'
        : !amIPlayer && !room4me ? 'Katsot peliä — isäntä voi päästää sinut mukaan.'
        : state.players.length < 2 ? 'Odotetaan lisää pelaajia…' : 'Odotetaan isäntää aloittamaan peli…';
    } else {
      lastRenderedState = state;
      if (state.status === 'playing') {
        // peli on (taas) käynnissä — nollaa lippu niin seuraava loppuminen saa ilmoittaa uudelleen
        announcedFinishedRoomId = null;
        document.getElementById('winnerOverlay').style.display = 'none';
      }
      const devUpper = window.MpSettings ? window.MpSettings.settings.devUpper : true;
      const hideUsed = window.MpSettings ? window.MpSettings.settings.hideUsed : false;
      const ownCols = window.MpSettings ? window.MpSettings.settings.ownCols : false;
      const onPick = (categoryId, col, el) => {
        celebrateScore(state, categoryId, el);
        window.MpGame.scoreCategory(categoryId, col, (res) => { if (!res.ok) setLobbyError(res.error); });
      };
      const onToggleHideUsed = () => {
        window.MpSettings.settings.hideUsed = !window.MpSettings.settings.hideUsed;
        window.MpSettings.save();
        renderRoom(state);
      };
      const onToggleOwnCols = () => {
        window.MpSettings.settings.ownCols = !window.MpSettings.settings.ownCols;
        window.MpSettings.save();
        renderRoom(state);
      };
      window.MpUI.renderPlayers(document.getElementById('mpPlayers'), state, me.id, openPeople);
      window.MpUI.renderTable(state, me.id, state.diceValues, onPick, devUpper, hideUsed, onToggleHideUsed, ownCols, onToggleOwnCols);
      window.MpUI.renderQuickPicks(state, me.id, state.diceValues, devUpper, onPick);
      window.MpUI.updateControls(state, me.id);
      if (state.status === 'finished') {
        renderWinnerOverlay(state);
      }
    }
  }

  /* Välitön palaute merkinnästä:
     ponnahtava "+N"/"💰+N", pankkiäänet, banneri+konfetti isoille tuloksille.
     Lasketaan tässä paikallisesti (optimistisesti) klikkaushetken nopilla —
     palvelimen kaiku (room:state) päivittää taulukon joka tapauksessa
     auktoritatiivisesti heti perään. */
  function celebrateScore(state, categoryId, el) {
    const S = window.Scoring, UI = window.UI, D3 = window.Dice3D;
    if (!UI || !el) return;
    const pts = S.scoreCat(categoryId, state.diceValues);
    const bankAdded = state.variant.bank ? Math.max(0, 3 - state.rollsUsed) : 0;
    const r = el.getBoundingClientRect();
    if (bankAdded > 0) UI.popScore('💰+' + bankAdded, r.left + r.width / 2, r.top - 34);
    if (pts <= 0) return;
    UI.popScore('+' + pts, r.left + r.width / 2, r.top);
    const eff = pts + bankAdded * 10;
    if (categoryId === 'yatzy6' && pts === 100) { UI.showBanner('SUUR-YATZY! +100'); UI.sndYatzy(); UI.burst(Math.min(200 + eff, 320), true); D3.shakeCamera(18); }
    else if (categoryId === 'yatzy' && pts >= 50) { UI.showBanner('YATZY! +50'); UI.sndYatzy(); UI.burst(Math.min(140 + eff, 260), true); D3.shakeCamera(14); }
    else if (eff >= 20) { UI.sndBig(); UI.burst(Math.min(15 + eff, 110), false); }
    else UI.sndScore();
  }

  /* Voittajapaneeli: sijoituslista, tuplasarakkeessa myös paras sarake. */
  function renderWinnerOverlay(state) {
    const S = window.Scoring, esc = window.UI.esc;
    const six = state.variant.sixDice;
    const ranked = state.rankings || [];
    if (!ranked.length) return;
    document.getElementById('winnerName').textContent = ranked[0].username;
    document.getElementById('winnerScore').textContent = ranked[0].total + ' pistettä';
    let listHtml;
    if (state.variant.twoCol) {
      let best = { t: -1 };
      state.players.forEach((p) => p.scs.forEach((sc, ci) => {
        const t = S.totalOf(sc, six);
        if (t > best.t) best = { t, name: p.username, ci };
      }));
      listHtml = `🏅 Paras sarake: <b>${esc(best.name)} ${best.ci === 0 ? 'I' : 'II'}</b> — ${best.t} p<br><br>`;
      listHtml += ranked.map((p, i) => {
        const player = state.players.find((pp) => pp.seatId === p.seatId);
        return `${i + 1}. ${esc(p.username)} — <b>${p.total}</b> (${S.totalOf(player.scs[0], six)} + ${S.totalOf(player.scs[1], six)})`;
      }).join('<br>');
    } else {
      listHtml = ranked.map((p, i) => `${i + 1}. ${esc(p.username)} — <b>${p.total}</b>`).join('<br>');
    }
    document.getElementById('finalList').innerHTML = listHtml;
    /* Avataan vain ensimmäisellä kerralla: tulostaulun rivien id:t saapuvat
       hetken päästä uutena tilana, eikä se saa avata suljettua ikkunaa. */
    if (announcedFinishedRoomId !== state.id) document.getElementById('winnerOverlay').style.display = 'flex';
    /* Portaalin tulostaulu — palvelin kirjoitti kaikkien tulokset
       (server/leaderboard.js); täällä vain näytetään ja korostetaan oma. */
    if (state.local) {
      /* Offline: selain lähettää jokaisen pelaajan tuloksen kerran pelin
         lopussa (gameKey estää tuplalähetyksen päivityksen jälkeen). */
      if (shownLocalGame !== state.gameKey) {
        shownLocalGame = state.gameKey;
        window.JatsiPortal.submitLocalGame(document.getElementById('lbWrap'), {
          gameKey: state.gameKey, variant: state.variant,
          players: ranked.map((p) => ({ name: p.username, score: p.total })),
        });
      }
    } else {
      window.JatsiPortal.showBoard(document.getElementById('lbWrap'), {
        variant: state.variant,
        key: state.id + ':' + ranked.map((p) => p.total).join(','),
        highlightId: state.lbEntries && state.lbEntries['u' + me.id],
      });
    }

    /* Uusinnan säännöt voi vaihtaa vain isäntä; muille näytetään pelkkä
       odotusviesti. Esitäytetään nykyisellä variantilla. */
    const amIHost = state.hostId === me.id;
    document.getElementById('rematchVariantRow').style.display = amIHost ? 'block' : 'none';
    document.getElementById('rematchBtn').style.display = amIHost ? 'block' : 'none';
    document.getElementById('mpWaitRematchMsg').style.display = amIHost ? 'none' : 'block';
    if (amIHost) {
      document.getElementById('rematchTwoCol').checked = !!state.variant.twoCol;
      document.getElementById('rematchSixDice').checked = !!state.variant.sixDice;
      document.getElementById('rematchBank').checked = !!state.variant.bank;
      document.getElementById('rematchRollMode').value = state.variant.rollMode || 'charge';
    }

    if (announcedFinishedRoomId !== state.id) {
      announcedFinishedRoomId = state.id;
      window.UI.sndYatzy();
      window.UI.burst(160, true);
    }
  }

  function addGuest() {
    const input = document.getElementById('mpGuestName');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    window.MpGame.guest({ action: 'add', name }, (res) => {
      if (!res.ok) { window.MpUI.dialog({ title: 'Ei onnistunut', text: res.error }); return; }
      input.value = '';
    });
  }
  document.getElementById('mpGuestAdd').addEventListener('click', addGuest);
  document.getElementById('mpGuestName').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') addGuest(); });
  document.getElementById('mpJoinBtn').addEventListener('click', () => {
    const roomId = window.MpGame.getRoomId();
    if (roomId) joinRoom(roomId);
  });
  document.getElementById('mpStartBtn').addEventListener('click', () => {
    window.MpGame.startGame((res) => { if (!res.ok) setLobbyError(res.error); });
  });
  document.getElementById('mpDeleteRoomBtn').addEventListener('click', () => window.MpUI.dialog({
    title: 'Poista huone?', text: 'Huone poistuu kaikilta pelaajilta ja katsojilta.',
    okText: 'Poista', danger: true,
    onOk: () => window.MpGame.deleteRoom(null, (res) => { if (!res.ok) setLobbyError(res.error); }),
  }));
  document.getElementById('closeWin').addEventListener('click', () => {
    document.getElementById('winnerOverlay').style.display = 'none';
  });
  document.getElementById('rematchBtn').addEventListener('click', () => {
    const variant = {
      twoCol: document.getElementById('rematchTwoCol').checked,
      sixDice: document.getElementById('rematchSixDice').checked,
      bank: document.getElementById('rematchBank').checked,
      rollMode: document.getElementById('rematchRollMode').value,
    };
    window.MpGame.rematch(variant, (res) => { if (!res.ok) setLobbyError(res.error); });
  });
  /* Kesken pelin ✕ vie vain aulaan: paikka ja vuoro säilyvät, ja aulan
     "Jatka" palauttaa huoneeseen. Aiemmin se poisti pelistä pysyvästi yhdellä
     napautuksella — ja huoneeseen ei päässyt enää takaisin. Pysyvä poistuminen
     on aulan "Luovuta". Ennen peliä ja sen jälkeen ✕ poistuu huoneesta. */
  document.getElementById('leaveRoomBtn').addEventListener('click', () => {
    closePeople();
    if (mode === 'offline') {
      document.getElementById('winnerOverlay').style.display = 'none';
      announcedFinishedRoomId = null;
      renderOfflineSetup();
      showView('offline');
      return;
    }
    if (roomStatus === 'playing' && amIPlayer) {
      showView('lobby');
      return;
    }
    window.MpGame.leaveRoom(() => { announcedFinishedRoomId = null; showView('lobby'); });
  });

  async function doAuth(kind) {
    setAuthError('');
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    try {
      const { user } = await window.MpApi[kind](username, password);
      account = user; me = user;
      enterLobby();
    } catch (e) { setAuthError(e.message); }
  }
  document.getElementById('loginBtn').addEventListener('click', () => doAuth('login'));
  document.getElementById('registerBtn').addEventListener('click', () => doAuth('register'));
  document.getElementById('authPassword').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') doAuth('login');
  });
  window.JatsiPortal.wireFullscreen(document.getElementById('fsBtn'));

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await window.MpApi.logout(); } catch (e) {}
    window.MpGame.disconnect();
    me = null;
    account = null;
    showView('auth');
  });

  document.getElementById('historyBtn').addEventListener('click', async () => {
    setLobbyError('');
    document.getElementById('lobbyRoomsSection').style.display = 'none';
    document.getElementById('historyPanel').style.display = 'block';
    try {
      const { games } = await window.MpApi.history();
      window.MpUI.renderHistory(document.getElementById('historyList'), games);
    } catch (e) {
      document.getElementById('historyList').innerHTML = '';
      setLobbyError(e.message);
    }
  });
  document.getElementById('closeHistoryBtn').addEventListener('click', () => {
    document.getElementById('historyPanel').style.display = 'none';
    document.getElementById('lobbyRoomsSection').style.display = 'block';
  });

  boot();
})();
