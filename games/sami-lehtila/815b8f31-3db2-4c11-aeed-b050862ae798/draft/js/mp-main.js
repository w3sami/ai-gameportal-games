"use strict";
/* ============================================================
   mp-main.js — moninpelin näkymien vaihto (kirjautuminen → aula →
   pelihuone) ja DOM-kytkennät. Kokoaa MpApi + MpGame + MpUI yhteen.
   ============================================================ */
(function () {
  const authView = document.getElementById('authView');
  const lobbyView = document.getElementById('lobbyView');
  const roomView = document.getElementById('roomView');
  let me = null;
  let announcedFinishedRoomId = null;
  let lastRenderedState = null;

  if (window.MpSettings) {
    window.MpSettings.load();
    window.MpSettings.wire(() => { if (lastRenderedState) renderRoom(lastRenderedState); });
  }

  function showView(v) {
    authView.style.display = v === 'auth' ? 'flex' : 'none';
    lobbyView.style.display = v === 'lobby' ? 'flex' : 'none';
    roomView.style.display = v === 'room' ? 'flex' : 'none';
  }

  function setAuthError(msg) { document.getElementById('authError').textContent = msg || ''; }
  function setLobbyError(msg) { document.getElementById('lobbyError').textContent = msg || ''; }

  async function boot() {
    try {
      const { user } = await window.MpApi.me();
      me = user;
      enterLobby();
    } catch (e) {
      showView('auth');
    }
  }

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
      window.MpUI.renderRoomList(document.getElementById('roomList'), rooms, me.id, joinRoom, deleteRoomFromLobby);
    });
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
    window.MpGame.onDeleted(() => { showView('lobby'); setLobbyError('Isäntä poisti huoneen.'); });
  }

  function deleteRoomFromLobby(roomId) {
    setLobbyError('');
    window.MpGame.deleteRoom(roomId, (res) => { if (!res.ok) setLobbyError(res.error); });
  }

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
    const amIHost = state.hostId === me.id;
    const preGame = state.status === 'open';
    document.getElementById('mpPreGame').style.display = preGame ? 'flex' : 'none';
    document.getElementById('controls').style.display = preGame ? 'none' : 'flex';
    document.getElementById('mpPlayers').style.display = preGame ? 'none' : 'flex';
    document.getElementById('board').style.display = preGame ? 'none' : 'block';

    if (preGame) {
      window.MpUI.renderPlayers(document.getElementById('mpPlayersPre'), state, me.id);
      document.getElementById('mpStartBtn').style.display = amIHost && state.players.length >= 2 ? 'block' : 'none';
      document.getElementById('mpDeleteRoomBtn').style.display = amIHost ? 'block' : 'none';
      const wait = document.getElementById('mpWaitMsg');
      wait.style.display = amIHost && state.players.length >= 2 ? 'none' : 'block';
      wait.textContent = state.players.length < 2 ? 'Odotetaan lisää pelaajia…' : 'Odotetaan isäntää aloittamaan peli…';
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
      window.MpUI.renderPlayers(document.getElementById('mpPlayers'), state, me.id);
      window.MpUI.renderTable(state, me.id, state.diceValues, onPick, devUpper, hideUsed, onToggleHideUsed, ownCols, onToggleOwnCols);
      window.MpUI.renderQuickPicks(state, me.id, state.diceValues, devUpper, onPick);
      window.MpUI.updateControls(state, me.id);
      if (state.status === 'finished') {
        renderWinnerOverlay(state);
      }
    }
  }

  /* Sama välitön palaute kuin yksinpelin pickCategory (js/game-logic.js):
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

  /* Vastine yksinpelin endGame():lle (js/game-logic.js) — sama
     voittaja-paneeli + sijoituslista, "paras sarake" tuplasarakkeessa. */
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
        const player = state.players.find((pp) => pp.userId === p.userId);
        return `${i + 1}. ${esc(p.username)} — <b>${p.total}</b> (${S.totalOf(player.scs[0], six)} + ${S.totalOf(player.scs[1], six)})`;
      }).join('<br>');
    } else {
      listHtml = ranked.map((p, i) => `${i + 1}. ${esc(p.username)} — <b>${p.total}</b>`).join('<br>');
    }
    document.getElementById('finalList').innerHTML = listHtml;
    document.getElementById('winnerOverlay').style.display = 'flex';

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

  document.getElementById('mpStartBtn').addEventListener('click', () => {
    window.MpGame.startGame((res) => { if (!res.ok) setLobbyError(res.error); });
  });
  window.MpUI.confirmTap(document.getElementById('mpDeleteRoomBtn'), 'Poistetaanko kaikilta? Napauta uudelleen', () => {
    window.MpGame.deleteRoom(null, (res) => { if (!res.ok) setLobbyError(res.error); });
  });
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
  document.getElementById('leaveRoomBtn').addEventListener('click', () => {
    window.MpGame.leaveRoom(() => { announcedFinishedRoomId = null; showView('lobby'); });
  });

  async function doAuth(kind) {
    setAuthError('');
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    try {
      const { user } = await window.MpApi[kind](username, password);
      me = user;
      enterLobby();
    } catch (e) { setAuthError(e.message); }
  }
  document.getElementById('loginBtn').addEventListener('click', () => doAuth('login'));
  document.getElementById('registerBtn').addEventListener('click', () => doAuth('register'));
  document.getElementById('authPassword').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') doAuth('login');
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await window.MpApi.logout(); } catch (e) {}
    window.MpGame.disconnect();
    me = null;
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
