"use strict";
/* ============================================================
   mp-game.js — Socket.io-yhteys ja pelihuoneen orkestrointi.

   Nopan ARVOJEN totuuden lähde on ROOLAAJAN oma fysiikka: pelaaja jonka
   vuoro on, heittää paikallisesti (cannon.js), lukee tuloksen kun se
   asettuu, ja LÄHETTÄÄ ne palvelimelle (ei toisin päin — peli ei ole
   kilpapeli vaan rentoa yhdessä pelaamista, joten huijaus ei ole tässä
   huolenaihe). Palvelin validoi silti kaiken MUUN (huone, vuoro,
   heittojen määrä, pelitilan koneisto).

   TOISTO (ei erillinen simulaatio): heittävä asiakas myös NAUHOITTAA
   oman fysiikkansa (ks. js/dice3d.js: throwDice/releaseCharge(record))
   ja lähettää koko nauhoituksen palvelimen kautta muille. Muut asiakkaat
   eivät aja OMAA fysiikkaansa tälle heitolle lainkaan — fysiikkasimulaatiot
   ovat kaoottisen herkkiä alkuarvoille, joten kaksi eri simulaatiota
   näyttäisivät eri näköiseltä pyörimiseltä vaikka päätyisivät samaan
   lopputulokseen. Sen sijaan ne TOISTAVAT (Dice3D.playTrajectory) täsmälleen
   saman nauhoitetun liikeradan, joten kaikki huoneessa näkevät kirjaimellisesti
   saman heiton, eivät vain saman lopputuloksen.

   Heiton KÄYNNISTYSTAPA (huoneen variant.rollMode) on puhtaasti
   kosmeettinen asiakaspuolen valinta — palvelin ei välitä MITEN
   pelaaja pyysi heittoa, vain että game:roll saapui silloin kun on
   hänen vuoronsa. 'charge' = paina & pidä pohjassa (voima = pitoaika,
   kuten yksinpelissä), 'shake' = viritä napauttamalla ja ravista
   puhelinta (tai napauta kehotusta).
   ============================================================ */
window.MpGame = (function () {
  let socket = null, me = null, currentRoomId = null, diceReady = false;
  let lastState = null;
  let myRollInFlight = false; // true kun OMA paikallinen heitto on käynnissä/lähetetty, kunnes kaiku saapuu
  let armed = false; // ravistustila viritetty
  let motionEnabled = false, shakeSamples = [], shakePeakAcc = 0;
  const listeners = { lobby: null, roomState: null, roomError: null, rejoin: null, deleted: null };

  function onLobby(cb) { listeners.lobby = cb; }
  function onRoomState(cb) { listeners.roomState = cb; }
  function onRoomError(cb) { listeners.roomError = cb; }
  /* Kutsutaan kun palvelin liittää tämän asiakkaan automaattisesti takaisin
     huoneeseen jossa se on jo pelaajana (yhteys avattiin/uudelleen —
     esim. sivun päivitys kesken pelin). Näkymä pitää vaihtaa huoneeseen. */
  function onRejoin(cb) { listeners.rejoin = cb; }
  /* Kutsutaan kun isäntä poistaa huoneen jossa ollaan parhaillaan mukana. */
  function onDeleted(cb) { listeners.deleted = cb; }
  function err(msg) { if (listeners.roomError) listeners.roomError(msg); }

  function connect(user) {
    me = user;
    /* Portaalissa palvelin on toisella nimellä ja tunnistus kulkee tokenina
       (ks. mp-api.js); omalla palvelimella sama origin ja istuntoeväste. */
    const api = window.MpApi;
    socket = api.base ? io(api.base, { auth: { token: api.token() } }) : io();
    socket.on('lobby:update', (rooms) => listeners.lobby && listeners.lobby(rooms));
    socket.on('room:state', (state) => handleRoomState(state));
    socket.on('room:rejoin', (state) => {
      handleRoomState(state);
      /* Kaksi eri uudelleenliittymistapausta:
         1) OMA heitto oli KESKEN sivun päivittyessä (ks. persistInFlightRoll/
            tryResumeInFlightRoll alla) — jatketaan fysiikkaa täsmälleen
            siitä missä se jäi (reiluuden vuoksi, ei anneta arpoa uudelleen).
         2) Ei kesken olevaa omaa heittoa (tavallisin tapaus: liityttiin
            takaisin kahden heiton välissä, tai ollaan toisen vuorossa) —
            silloin ei ole mitään fysiikkaa josta jatkaa, joten näytetään
            palvelimen auktoritatiivinen silmäluku+pito-tila suoraan
            (muuten nopat jäisivät oletusasentoonsa, kaikki 0/ei pidettynä,
            vaikka peli on jo kesken). */
      if (state.status === 'playing' && window.Dice3D) {
        const resumed = tryResumeInFlightRoll(state);
        if (!resumed) window.Dice3D.restoreDisplay(state.diceValues, state.held);
      }
      if (listeners.rejoin) listeners.rejoin(state);
    });
    socket.on('room:deleted', () => {
      clearInFlightRoll();
      currentRoomId = null; lastState = null; myRollInFlight = false;
      if (listeners.deleted) listeners.deleted();
    });
    socket.on('game:rollPlayback', (payload) => handleRollPlayback(payload));
    socket.on('connect_error', (e) => {
      if (e.message === 'AUTH_REQUIRED') {
        window.MpApi.clearToken();
        err('Istunto vanhentunut — kirjaudu uudelleen.');
      }
    });
  }

  function disconnect() {
    if (socket) { socket.disconnect(); socket = null; }
    currentRoomId = null; lastState = null; myRollInFlight = false;
    disarmShake();
  }

  function isMyTurn(state) {
    return !!(state && state.status === 'playing' && state.players[state.current] && state.players[state.current].userId === me.id);
  }
  function canRollNow() {
    if (!lastState || !isMyTurn(lastState)) return false;
    if (myRollInFlight || window.Dice3D.isRolling() || window.Dice3D.isCharging()) return false;
    return lastState.rollsUsed < 3 || lastState.bankAvailable;
  }

  /* Käynnistää OMAN paikallisen fysiikkaheiton NAUHOITTAEN sen (ei
     pakotettuja arvoja — fysiikka saa päättää vapaasti), ja lähettää
     tuloksen + nauhoituksen palvelimelle heti kun heitto asettuu
     (ks. Dice3D.onSettle-rekisteröinti ensureDice:ssä). */
  function startMyRoll(launch) {
    if (!currentRoomId || myRollInFlight) return;
    myRollInFlight = true;
    launch();
    updateHint();
    refreshControls();
  }

  /* Heittopainikkeen tila (disabled/teksti) riippuu paitsi palvelimen
     tilasta myös PAIKALLISESTA Dice3D-fysiikan tilasta (rullaako juuri
     nyt) — mutta room:state-lähetyksiä ei tule palvelimelta koko heiton
     ajan (oma heitto lähetetään palvelimelle vasta asettumisen jälkeen),
     joten pelkkä renderRoom() palvelimen tilan mukaan jättäisi painikkeen
     näyttämään "valmiina" koko animaation ajan vaikka klikkaus ei tekisi
     mitään. Kutsutaan tätä eksplisiittisesti heti kun heitto TODELLA
     alkaa, jotta ulkoasu vastaa heti sitä mitä klikkaus oikeasti sallii. */
  function refreshControls() {
    if (lastState && window.MpUI) window.MpUI.updateControls(lastState, me.id);
  }

  /* Vihjeteksti (#hint) — sama logiikka kuin yksinpelin setHint():
     tälli-vihje näkyy vain OMAN käynnissä olevan heiton aikana, jos
     asetus on päällä ja tälli on vielä käyttämättä tällä heitolla. */
  function updateHint() {
    const hintEl = document.getElementById('hint');
    if (!hintEl) return;
    const nudgeSetting = window.MpSettings ? window.MpSettings.settings.nudge : false;
    if (myRollInFlight && window.Dice3D.isRolling() && window.Dice3D.isNudgeAvailable() && nudgeSetting) {
      hintEl.textContent = 'Napauta pöytää — tälli käytettävissä!';
      hintEl.classList.add('nudge');
    } else {
      hintEl.textContent = 'Heitä nopat • napauta noppaa lukitaksesi sen';
      hintEl.classList.remove('nudge');
    }
  }
  /* ---------- Reiluuskorjaus: "päivitä sivu juuri ennen huonoa tulosta"
     -kikan estäminen ----------
     Ongelma: jos pelaaja päivittää sivun kesken oman heittonsa (esim. juuri
     ennen kuin nopat asettuvat, koska tulos ei näytä hyvältä), koko
     Dice3D-moduuli/fysiikka nollautuu ja pelaaja saisi käytännössä ilmaisen
     uusintaheiton — peli EI ole kilpapeli mutta tämä silti mitätöisi koko
     heiton tarkoituksen kavereidenkin kesken.
     Ratkaisu: nauhoitustahdilla (sama ~10Hz kutsu jolla trajectory jo
     rakennetaan toistoa varten, ks. dice3d.js:n onRecordTick) tallennetaan
     jatkuvasti KESKENERÄISEN oman heiton täsmällinen tila (sijainti+kierto+
     nopeudet, PLUS koko tähänastinen nauhoitus) selaimen localStorageen.
     Sivun uudelleenlatauksessa/uudelleenliittymisessä (room:rejoin) tämä
     tila luetaan takaisin ja fysiikka JATKUU täsmälleen samasta kohdasta
     (deterministinen jatkumo → sama lopputulos kuin ilman päivitystä),
     sen sijaan että aloitettaisiin tyhjästä tai näytettäisiin rikkinäinen
     tila. Talteenotto koskee VAIN omaa aktiivista heittoa (muiden pelaajien
     toisto ei koskaan nauhoita, ks. dice3d.js:n throwDice/releaseCharge
     record-parametri), joten tälle ei tarvita erillistä "kenen heitto"
     -tarkistusta täällä — jos recording on käynnissä, se on omamme. */
  function inFlightKey(roomId) { return 'yatzy-mp-inflight:' + roomId; }
  function persistInFlightRoll(snap) {
    if (!myRollInFlight || !currentRoomId || !lastState) return;
    try {
      localStorage.setItem(inFlightKey(currentRoomId), JSON.stringify({
        userId: me.id,
        rollsUsedBefore: lastState.rollsUsed,
        diceCount: lastState.diceCount,
        dice: snap.dice,
        frames: snap.frames,
        ts: Date.now(),
      }));
    } catch (e) { /* localStorage voi olla poissa käytöstä (yksityinen selaus tms.) — ei kriittistä */ }
  }
  function clearInFlightRoll() {
    if (!currentRoomId) return;
    try { localStorage.removeItem(inFlightKey(currentRoomId)); } catch (e) {}
  }
  /* Kutsutaan room:rejoin-käsittelijästä ENNEN restoreDisplay-varapolkua.
     Palauttaa true jos löytyi ja jatkettiin kesken ollutta OMAA heittoa. */
  function tryResumeInFlightRoll(state) {
    if (!currentRoomId) return false;
    let raw;
    try { raw = localStorage.getItem(inFlightKey(currentRoomId)); } catch (e) { return false; }
    if (!raw) return false;
    let snap;
    try { snap = JSON.parse(raw); } catch (e) { clearInFlightRoll(); return false; }
    const valid = snap && snap.userId === me.id && isMyTurn(state) &&
      snap.rollsUsedBefore === state.rollsUsed && snap.diceCount === state.diceCount &&
      Array.isArray(snap.dice) && snap.dice.length === state.diceCount;
    if (!valid) { clearInFlightRoll(); return false; }
    myRollInFlight = true;
    window.Dice3D.resumeFrom(snap);
    return true;
  }

  function onMySettle(diceValues, trajectory) {
    if (!myRollInFlight) {
      /* Tämä settle-kutsu kuuluu TOISEN pelaajan heiton TOISTOON (ks.
         dice3d.js:n playTrajectory/updatePlayback — sama settleCb laukeaa
         sekä omasta fysiikasta että muiden toistosta). Heittopainikkeen
         disabled/teksti riippuu (ks. mp-ui.js:n updateControls) paikallisesta
         Dice3D.isRolling()/isCharging()-tilasta, joka juuri MUUTTUI false:ksi
         tässä — ilman tätä päivitystä painike voi jäädä jumiin "ei valmis"
         -näköiseksi jos vuoro vaihtuu KESKEN toisen pelaajan viimeisen
         heiton toiston (room:state "sinun vuorosi nyt" saattaa saapua ennen
         kuin toisto ehtii täällä valmistua), koska mikään muu tapahtuma ei
         enää päivitä ohjaimia sen jälkeen kun toisto itsestään loppuu. */
      refreshControls();
      return;
    }
    socket.emit('game:roll', { roomId: currentRoomId, diceValues, trajectory: trajectory || [] }, (res) => {
      /* Palvelin on nyt joko hyväksynyt TAI hylännyt tämän heiton — kummassa
         tapauksessa tahansa paikallinen "kesken oleva heitto" -tallenne
         (localStorage) on käynyt tarpeettomaksi: onnistuessa palvelin
         tietää tuloksen jo, epäonnistuessa uusi yritys aloittaa oman
         nauhoituksensa alusta. Jätettynä talteen se voisi myöhemmin yrittää
         jatkaa jo käsiteltyä heittoa uudelleen turhaan. */
      clearInFlightRoll();
      if (!res.ok) { myRollInFlight = false; err(res.error); }
      // onnistuessa myRollInFlight puretaan vasta kun oman heiton kaiku (game:rollPlayback) saapuu
    });
  }

  /* Palvelimelta tuleva heiton tulos + koko nauhoitettu liikerata.
     Jos heitto oli OMA, fysiikka pyöri jo livenä eikä sitä toisteta —
     muille asiakkaille tämä on ainoa paikka joka koskaan liikuttaa
     noppia tälle heitolle (ei omaa simulaatiota, ks. tiedoston alkukommentti). */
  function handleRollPlayback({ diceValues, trajectory, rollerId }) {
    if (!diceReady) return;
    if (rollerId === me.id) {
      myRollInFlight = false;
    } else {
      window.Dice3D.playTrajectory(trajectory, diceValues);
    }
    if (lastState) maybeCelebrate({ variant: lastState.variant, diceValues });
  }

  /* ---------- Heittopainike: paina&pidä (oletus) ---------- */
  function wireRollButton() {
    const rollBtn = document.getElementById('rollBtn');
    rollBtn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (lastState && lastState.variant.rollMode === 'shake' && !armed) return; // ravistustilassa ensin viritettävä
      if (!canRollNow()) return;
      window.Dice3D.startCharge();
    });
    addEventListener('pointerup', () => {
      if (!window.Dice3D.isCharging()) return;
      disarmShake();
      startMyRoll(() => window.Dice3D.releaseCharge(true)); // record=true: voima lasketaan Dice3D:n sisällä pitoajasta
    });
    addEventListener('pointercancel', () => window.Dice3D.cancelCharge());
    rollBtn.addEventListener('contextmenu', (ev) => ev.preventDefault());
    rollBtn.addEventListener('click', () => {
      if (window.Dice3D.isRolling() || window.Dice3D.isCharging()) return;
      if (!lastState || !isMyTurn(lastState)) return;
      if (lastState.rollsUsed >= 3 && !lastState.bankAvailable) return;
      if (lastState.variant.rollMode === 'shake' && !armed) { armShake(); return; }
    });
    const shakePrompt = document.getElementById('shakePrompt');
    if (shakePrompt) shakePrompt.addEventListener('click', () => {
      disarmShake();
      startMyRoll(() => window.Dice3D.throwDice(1, true));
    });
  }

  function armShake() {
    armed = true;
    shakeSamples = []; shakePeakAcc = 0;
    const p = document.getElementById('shakePrompt');
    if (p) p.classList.add('show');
    if (!motionEnabled) enableMotion(true);
  }
  function disarmShake() {
    if (!armed) return;
    armed = false;
    const p = document.getElementById('shakePrompt');
    if (p) p.classList.remove('show');
  }
  function onMotion(e) {
    if (!armed) return;
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null) return;
    const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    const excess = Math.abs(mag - 9.81);
    if (excess > 8) {
      const now = Date.now();
      shakeSamples.push(now);
      shakePeakAcc = Math.max(shakePeakAcc, excess);
      shakeSamples = shakeSamples.filter((t) => now - t < 900);
      if (window.UI) window.UI.clack(excess / 3);
      if (shakeSamples.length >= 2) {
        const power = 1 + Math.min(shakePeakAcc / 25, 1.2);
        shakeSamples = []; shakePeakAcc = 0;
        disarmShake();
        startMyRoll(() => window.Dice3D.throwDice(power, true));
      }
    }
  }
  function enableMotion(fromGesture) {
    if (motionEnabled) return;
    if (typeof DeviceMotionEvent === 'undefined') return;
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      if (!fromGesture) return;
      DeviceMotionEvent.requestPermission().then((state) => {
        if (state === 'granted') { addEventListener('devicemotion', onMotion); motionEnabled = true; }
      }).catch(() => {});
    } else {
      addEventListener('devicemotion', onMotion);
      motionEnabled = true;
    }
  }

  function ensureDice() {
    if (diceReady) return;
    window.Dice3D.init(document.getElementById('canvasWrap'));
    if (window.MpSettings) window.MpSettings.load(); // lataa+soveltaa pelaajan omat asetukset (nudge/sound/parkHeld)
    window.Dice3D.onSettle(onMySettle);
    window.Dice3D.onRecordTick(persistInFlightRoll);
    diceReady = true;
    wireRollButton();
    document.getElementById('canvasWrap').addEventListener('pointerdown', (ev) => {
      if (!currentRoomId || window.Dice3D.isCharging()) return;
      if (window.Dice3D.isRolling()) {
        /* Tälli: vain OMAN käynnissä olevan heiton fysiikkaan voi koskea —
           toisen pelaajan toistoa (playTrajectory) ei voi nudata, koska se
           toistaa jo tallennettua, valmista liikerataa. */
        const nudgeSetting = window.MpSettings ? window.MpSettings.settings.nudge : false;
        if (!myRollInFlight || !nudgeSetting || !window.Dice3D.isNudgeAvailable()) return;
        if (window.Dice3D.nudgeAt(ev.clientX, ev.clientY)) {
          if (window.UI) { window.UI.popScore('TÄLLI!', ev.clientX, ev.clientY); window.UI.clack(6); }
          window.Dice3D.shakeCamera(5);
          updateHint();
        }
        return;
      }
      if (!window.Dice3D.isSettled()) return;
      const state = lastState;
      /* Kolmannen heiton jälkeen lukita saa vain jos pankissa on heittoja —
         muuten pankkiheitto heittäisi aina kaikki nopat. Sama ehto kuin
         yksinpelissä (game-logic.js) ja palvelimen hold():ssa. */
      if (!isMyTurn(state) || state.rollsUsed === 0 || (state.rollsUsed >= 3 && !state.bankAvailable)) return;
      const i = window.Dice3D.hitTestDie(ev.clientX, ev.clientY);
      if (i < 0) return;
      socket.emit('game:hold', { roomId: currentRoomId, index: i }, (res) => { if (!res.ok) err(res.error); });
      if (window.UI) window.UI.sndHold();
    });
  }

  let lastDiceCount = null;
  function handleRoomState(state) {
    currentRoomId = state.id;
    if (state.status === 'playing') {
      ensureDice();
      if (state.diceCount !== lastDiceCount) {
        window.Dice3D.setActiveDiceCount(state.diceCount);
        lastDiceCount = state.diceCount;
      }
      const cur = state.players[state.current];
      if (cur) window.Dice3D.applyColor(cur.color);
      state.held.forEach((h, i) => window.Dice3D.setHeld(i, h));
      /* Fysiikka (world.step) ajetaan VAIN vuorossa olevalla pelaajalla —
         muut ovat aina puhtaassa toistotilassa (ks. dice3d.js:n
         setPhysicsActive-kommentti). Pitää simuloinnin ja toiston
         täysin erillään niin etteivät ne voi häiritä toisiaan. */
      window.Dice3D.setPhysicsActive(isMyTurn(state));
    } else {
      lastDiceCount = null;
      disarmShake();
      myRollInFlight = false;
      /* Huone ei ole (enää) käynnissä (odottaa/päättyi/uusinta) — mahdollinen
         jäljelle jäänyt "kesken oleva heitto" -tallennus tälle huoneelle on
         nyt joka tapauksessa vanhentunut (uusi peli/uusinta nollaa
         heittolaskurin, jolloin vanha tallennus voisi muuten näyttää
         virheellisesti yhä validilta samojen rollsUsed/diceCount-arvojen
         sattuessa kohdalleen). */
      clearInFlightRoll();
    }
    lastState = state;
    updateHint();
    if (listeners.roomState) listeners.roomState(state, me);
  }

  function maybeCelebrate(state) {
    const S = window.Scoring, UI = window.UI, D3 = window.Dice3D;
    const six = state.variant.sixDice;
    const big = six ? S.scoreCat('yatzy6', state.diceValues) : 0;
    const pts = S.scoreCat('yatzy', state.diceValues);
    if (big >= 100) { UI.showBanner('SUUR-YATZY!'); UI.sndYatzy(); UI.burst(260, true); D3.shakeCamera(18); }
    else if (pts >= 50) { UI.showBanner('YATZY!'); UI.sndYatzy(); UI.burst(200, true); D3.shakeCamera(14); }
  }

  function createRoom(name, maxPlayers, variant, cb) {
    socket.emit('room:create', { name, maxPlayers, variant }, (res) => cb && cb(res));
  }
  function joinRoom(roomId, cb) {
    socket.emit('room:join', { roomId }, (res) => cb && cb(res));
  }
  /* Poistuu huoneesta pysyvästi (kesken pelin = luovutus). roomId on
     valinnainen: aulan "Luovuta"-nappi voi osoittaa huonetta suoraan. */
  function leaveRoom(cb, roomId) {
    const id = roomId || currentRoomId;
    if (!id) return cb && cb({ ok: true });
    const wasCurrent = id === currentRoomId;
    if (wasCurrent) { disarmShake(); myRollInFlight = false; clearInFlightRoll(); }
    socket.emit('room:leave', { roomId: id }, (res) => {
      if (wasCurrent) { currentRoomId = null; lastState = null; }
      cb && cb(res);
    });
  }
  function startGame(cb) {
    socket.emit('room:start', { roomId: currentRoomId }, (res) => cb && cb(res));
  }
  function rematch(variant, cb) {
    socket.emit('room:rematch', { roomId: currentRoomId, variant }, (res) => cb && cb(res));
  }
  function deleteRoom(roomId, cb) {
    socket.emit('room:delete', { roomId: roomId || currentRoomId }, (res) => cb && cb(res));
  }
  function scoreCategory(categoryId, col, cb) {
    socket.emit('game:score', { roomId: currentRoomId, categoryId, col }, (res) => cb && cb(res));
  }

  return {
    connect, disconnect, onLobby, onRoomState, onRoomError, onRejoin, onDeleted,
    createRoom, joinRoom, leaveRoom, startGame, rematch, deleteRoom, scoreCategory,
    getMe: () => me, getRoomId: () => currentRoomId,
  };
})();
