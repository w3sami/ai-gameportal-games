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

   PERUMINEN JA SEURAAVAN HEITTO: merkinnän voi perua vain, kunnes
   seuraava pelaaja alkaa heittää. Heittäjän striimin ensimmäinen pala
   lähtee heti latauksen alussa, ja sen nähnyt laite piilottaa Peru-napin
   (undoBlocked). Jos peruminen ja heiton aloitus osuvat silti päällekkäin
   (peruminen ehti palvelimelle ensin), heittäjän kesken oleva heitto
   KESKEYTETÄÄN (pausedRoll) ja se jatkuu samasta kohdasta, kun edellinen
   vuoro on merkitty uudelleen ja vuoro palaa samalle paikalle.
   ============================================================ */
window.MpGame = (function () {
  let socket = null, me = null, currentRoomId = null, diceReady = false;
  let lastState = null;
  let myRollInFlight = false; // true kun OMA paikallinen heitto on käynnissä/lähetetty, kunnes kaiku saapuu
  let remote = false; // yhteys palvelimelle (offline-huoneelle ei striimata)
  /* Oman heiton striimi: tunniste ja montako kehystä on jo lähetetty. */
  let streamId = null, streamSent = 0, streamOpen = false;
  const STREAM_CHUNK = 3; // kehystä palassa: 10 Hz:llä pala 0,3 s välein
  /* Viimeisin muun heitto, joka on toistettu lopputulokseen asti. Palvelin
     lähettää huoneeseen palaavalle vuoron viimeisen heiton (server/
     roll-memory.js); jo nähtyä ei toisteta uudestaan. */
  let playedRollId = null;
  let armed = false; // ravistustila viritetty
  let motionEnabled = false, shakeSamples = [], shakePeakAcc = 0;
  /* Oman heiton lähtötilanne latauksen alusta siihen asti kun nopat asettuvat:
     { seatId, rollsUsedBefore, filled, diceCount }. Jos huoneen tila ei enää
     vastaa tätä (vuoro vietiin alta: edellinen merkintä peruttiin, paikka
     poistettiin), heitto keskeytetään (suspendMyRoll). */
  let rollCtx = null;
  let lastTick = null; // viimeisin nauhoitustikki: { snap, charging }
  /* Keskeytetty oma heitto, joka odottaa vuoron palaamista:
     { kind: 'physics', ctx, snap: { dice, frames }, streamId }  kesken lentoa
     { kind: 'result', ctx, diceValues, trajectory, lock, streamId }  ehti jo asettua */
  let pausedRoll = null;
  let sentAt = 0; // milloin oma heitto lähetettiin palvelimelle (kaikua odotetaan)
  /* Perumisen esto: turnSeq kasvaa aina kun vuoro, heittojen määrä tai
     viimeisin merkintä muuttuu; rollStartedSeq on se vuoro, jolla toisen
     laitteen heiton striimi on nähty alkavan. */
  let turnSig = '', turnSeq = 0, rollStartedSeq = -1;
  const SNAP_V = 2; // localStorage-tallenteen muoto; vanhat hylätään
  const listeners = { lobby: null, roomState: null, roomError: null, rejoin: null, deleted: null, blocked: null, notice: null };

  function onLobby(cb) { listeners.lobby = cb; }
  function onRoomState(cb) { listeners.roomState = cb; }
  function onRoomError(cb) { listeners.roomError = cb; }
  /* Kutsutaan kun palvelin liittää tämän asiakkaan automaattisesti takaisin
     huoneeseen jossa se on jo pelaajana (yhteys avattiin/uudelleen —
     esim. sivun päivitys kesken pelin). Näkymä pitää vaihtaa huoneeseen. */
  function onRejoin(cb) { listeners.rejoin = cb; }
  /* Kutsutaan kun isäntä poistaa huoneen jossa ollaan parhaillaan mukana. */
  function onDeleted(cb) { listeners.deleted = cb; }
  /* Kutsutaan kun isäntä estää tämän käyttäjän huoneesta. */
  function onBlocked(cb) { listeners.blocked = cb; }
  /* Palvelimen ilmoitus tälle käyttäjälle (esim. isäntä poisti pelistä). */
  function onNotice(cb) { listeners.notice = cb; }
  function err(msg) { if (listeners.roomError) listeners.roomError(msg); }

  /* transport: valinnainen socketin kaltainen olio (offline-pelissä
     LocalRoom.socket()); ilman sitä yhteys palvelimelle. */
  function connect(user, transport) {
    if (socket) disconnect();
    me = user;
    /* Portaalissa palvelin on toisella nimellä ja tunnistus kulkee tokenina
       (ks. mp-api.js); omalla palvelimella sama origin ja istuntoeväste. */
    const api = window.MpApi;
    socket = transport || (api.base ? io(api.base, { auth: { token: api.token() } }) : io());
    remote = !transport;
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
        /* Kesken oleva striimattu toisto jatkuu: palvelin lähettää perään
           heiton kehykset tai lopputuloksen (roll-memory.js). */
        if (!resumed && !window.Dice3D.isStreaming()) window.Dice3D.restoreDisplay(state.diceValues, state.held);
        if (resumed || pausedRoll) { updateHint(); refreshControls(); }
      }
      if (listeners.rejoin) listeners.rejoin(state);
      syncUndo();
    });
    socket.on('room:deleted', () => {
      resetMyRoll();
      clearInFlightRoll();
      currentRoomId = null; lastState = null;
      if (listeners.deleted) listeners.deleted();
    });
    socket.on('room:blocked', () => {
      resetMyRoll();
      clearInFlightRoll();
      disarmShake();
      currentRoomId = null; lastState = null;
      if (listeners.blocked) listeners.blocked();
    });
    socket.on('room:notice', ({ message } = {}) => {
      resetMyRoll();
      clearInFlightRoll();
      disarmShake();
      if (listeners.notice) listeners.notice(message);
    });
    socket.on('game:rollPlayback', (payload) => handleRollPlayback(payload));
    /* Merkintä peruttiin: nopat takaisin merkintää edeltäneisiin. Jos oma
       heitto oli jo alkanut (peruminen ja heitto osuivat päällekkäin), se
       keskeytetään ensin talteen — muuten nopat pysähtyisivät tähän eikä
       heitto koskaan asettuisi (heittonappi jäi jumiin). */
    socket.on('game:undone', ({ diceValues, held } = {}) => {
      if (!diceReady || !Array.isArray(diceValues)) return;
      if (rollCtx) suspendMyRoll(true, diceValues, held);
      window.Dice3D.restoreDisplay(diceValues, held);
      refreshControls();
    });
    socket.on('game:rollStream', ({ rollerId, id, from, frames } = {}) => {
      if (rollerId === me.id) return;
      /* Toinen laite on alkanut heittää: viimeisintä merkintää ei enää peruta. */
      if (rollStartedSeq !== turnSeq) { rollStartedSeq = turnSeq; syncUndo(); }
      if (!diceReady || id === playedRollId) return;
      const wasRolling = window.Dice3D.isRolling();
      window.Dice3D.streamFrames(id, from, frames);
      if (!wasRolling && window.Dice3D.isRolling()) rerender();
    });
    socket.on('connect_error', (e) => {
      if (e.message === 'AUTH_REQUIRED') {
        window.MpApi.clearToken();
        err('Istunto vanhentunut — kirjaudu uudelleen.');
      }
    });
  }

  function disconnect() {
    resetMyRoll();
    if (socket) { socket.disconnect(); socket = null; }
    currentRoomId = null; lastState = null;
    disarmShake();
  }

  function isMyTurn(state) {
    return !!(state && state.status === 'playing' && state.players[state.current] && state.players[state.current].userId === me.id);
  }
  /* Heittoja vuorolla ennen pankkia. Vanha palvelin ei lähetä maxRolls-
     kenttää, joten varalla johdetaan säännöistä (pikajatsi 1, muuten 3). */
  function maxRolls(state) {
    return state.maxRolls || (state.variant && state.variant.quick ? 1 : 3);
  }
  const isFiveK = (state) => !!(state && state.variant && state.variant.fiveK);
  /* Onko vuorossa heitettävää: heittoja jäljellä tai pankissa; 5000:ssa
     ensimmäinen heitto tai kelvollinen sivuun siirto (state.fiveK.canRoll). */
  function rollAllowed(state) {
    if (isFiveK(state)) return state.rollsUsed === 0 || !!(state.fiveK && state.fiveK.canRoll);
    return state.rollsUsed < maxRolls(state) || state.bankAvailable;
  }
  function canRollNow() {
    if (!lastState || !isMyTurn(lastState) || pausedRoll) return false;
    /* Itsekorjaus: "heitto kesken" -lippu ilman liikkuvia noppia ja ilman
       tuoretta lähetystä on jäänne, ei oikea heitto. */
    if (myRollInFlight && !window.Dice3D.isRolling() && !window.Dice3D.isCharging() &&
        (!sentAt || Date.now() - sentAt > 6000)) {
      myRollInFlight = false; rollCtx = null; sentAt = 0;
    }
    if (myRollInFlight || window.Dice3D.isRolling() || window.Dice3D.isCharging()) return false;
    return rollAllowed(lastState);
  }
  /* 5000: kun sivuun siirto käyttää kaikki nopat, seuraava heitto heittää
     ne kaikki. Nopat vapautetaan ennen latausta, koska moottori heittää
     vain vapaat nopat; palvelin vapauttaa samat heiton saapuessa. */
  function prepareThrow() {
    if (!isFiveK(lastState) || !lastState.fiveK || !lastState.fiveK.hot || lastState.rollsUsed === 0) return;
    for (let i = 0; i < lastState.diceCount; i++) window.Dice3D.setHeld(i, false);
  }

  /* ---------- Heiton lähtötilanne ja sen vertailu huoneen tilaan ---------- */
  function seatOf(state) { return state && state.players ? state.players[state.current] : null; }
  function filledOf(p) { return p.scs.reduce((n, sc) => n + Object.keys(sc).length, 0); }
  function ctxOf(state) {
    const p = seatOf(state);
    return p ? { seatId: p.seatId, rollsUsedBefore: state.rollsUsed, filled: filledOf(p), diceCount: state.diceCount } : null;
  }
  /* Onko huone yhä täsmälleen siinä tilassa, josta heitto lähti: sama paikka
     vuorossa tällä laitteella, sama määrä heittoja ja merkittyjä rivejä. */
  function ctxMatches(ctx, state) {
    const p = seatOf(state);
    return !!(ctx && p && state.status === 'playing' && p.userId === me.id && p.seatId === ctx.seatId &&
      state.rollsUsed === ctx.rollsUsedBefore && state.diceCount === ctx.diceCount && filledOf(p) === ctx.filled);
  }

  /* ---------- Perumisen esto ---------- */
  function undoBlocked() {
    return myRollInFlight || !!rollCtx || (diceReady && window.Dice3D.isCharging()) || rollStartedSeq === turnSeq;
  }
  /* Peru-nappi: palvelimen mukaan tämä laite saa perua (undoBy), eikä
     kukaan ole vielä alkanut heittää seuraavaa heittoa. */
  function canUndo(state) {
    state = state || lastState;
    return !!(state && me && state.status === 'playing' && state.undoBy === me.id && !undoBlocked());
  }
  function syncUndo() {
    const el = document.getElementById('undoBtn');
    if (el && lastState) el.classList.toggle('show', canUndo(lastState));
  }

  /* Käynnistää OMAN paikallisen fysiikkaheiton NAUHOITTAEN sen (ei
     pakotettuja arvoja — fysiikka saa päättää vapaasti), ja lähettää
     tuloksen + nauhoituksen palvelimelle heti kun heitto asettuu
     (ks. Dice3D.onSettle-rekisteröinti ensureDice:ssä). */
  /* Oman heiton striimi alkaa latauksesta (nopat nousevat käteen ja
     pyörivät), ravistusheitossa heitosta, ja sulkeutuu kun heitto asettuu. */
  function openStream() {
    streamId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    streamSent = 0;
    streamOpen = true;
    lastTick = null;
  }

  function startMyRoll(launch) {
    if (!currentRoomId || myRollInFlight) return;
    myRollInFlight = true;
    if (!rollCtx) rollCtx = ctxOf(lastState);
    if (!streamOpen) openStream();
    prepareThrow();
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
  /* Huoneen näkymä uudestaan samalla tilalla: muiden heiton toisto alkoi tai
     päättyi, ja pikavalinnat piiloutuvat tai tulevat näkyviin. */
  function rerender() {
    if (lastState && listeners.roomState) listeners.roomState(lastState, me);
    syncUndo();
  }

  function refreshControls() {
    if (lastState && window.MpUI) window.MpUI.updateControls(lastState, me.id);
    syncUndo();
  }

  /* Vihjeteksti (#hint) — sama logiikka kuin yksinpelin setHint():
     tälli-vihje näkyy vain OMAN käynnissä olevan heiton aikana, jos
     asetus on päällä ja tälli on vielä käyttämättä tällä heitolla. */
  function updateHint() {
    const hintEl = document.getElementById('hint');
    if (!hintEl) return;
    const nudgeSetting = window.MpSettings ? window.MpSettings.settings.nudge : false;
    if (pausedRoll) {
      hintEl.textContent = 'Edellinen merkintä peruttiin • heittosi jatkuu, kun rivi on merkitty uudelleen';
      hintEl.classList.remove('nudge');
    } else if (myRollInFlight && window.Dice3D.isRolling() && window.Dice3D.isNudgeAvailable() && nudgeSetting) {
      hintEl.textContent = 'Napauta pöytää — tälli käytettävissä!';
      hintEl.classList.add('nudge');
    } else if (lastState && !lastState.players.some((p) => p.userId === me.id)) {
      const mine = (lastState.spectators || []).find((s) => s.userId === me.id);
      hintEl.textContent = mine && mine.admitted ? 'Katsot peliä • pääset mukaan seuraavaan peliin'
        : 'Katsot peliä • isäntä voi päästää sinut seuraavaan peliin';
      hintEl.classList.remove('nudge');
    } else if (isFiveK(lastState)) {
      hintEl.textContent = 'Napauta pisteitä tuottavat nopat sivuun • heitä loput tai vie potti pankkiin';
      hintEl.classList.remove('nudge');
    } else if (lastState && lastState.variant && lastState.variant.quick) {
      const pick = window.Scoring ? window.Scoring.pickCount(lastState.variant.sixDice) : 5;
      hintEl.textContent = `Pikajatsi: yksi heitto • rivi lasketaan ${pick} parhaasta nopasta`;
      hintEl.classList.remove('nudge');
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
  /* Oman heiton kehykset muille heiton aikana, STREAM_CHUNK kehystä kerrallaan
     (ks. dice3d.js:n streamFrames). Ensimmäinen pala lähtee heti ensimmäisestä
     kehyksestä, jotta muut laitteet tietävät heiton alkaneen (Peru-nappi
     piiloon) ilman 0,3 s viivettä. Viimeinen vajaa pala jää lähettämättä:
     lopullinen nauhoitus game:rollissa kattaa sen. */
  function streamRoll(frames) {
    if (!remote || !socket || !streamOpen || !streamId || !Array.isArray(frames)) return;
    if (frames.length <= streamSent) return;
    if (streamSent > 0 && frames.length - streamSent < STREAM_CHUNK) return;
    socket.emit('game:rollStream', { roomId: currentRoomId, id: streamId, from: streamSent, frames: frames.slice(streamSent) });
    streamSent = frames.length;
  }
  function inFlightKey(roomId) { return 'yatzy-mp-inflight:' + roomId; }
  function saveInFlight(rec) {
    if (!currentRoomId) return;
    try {
      localStorage.setItem(inFlightKey(currentRoomId), JSON.stringify(Object.assign({ v: SNAP_V, userId: me.id, ts: Date.now() }, rec)));
    } catch (e) { /* localStorage voi olla poissa käytöstä (yksityinen selaus tms.) — ei kriittistä */ }
  }
  function persistInFlightRoll(snap) {
    if (!myRollInFlight || !currentRoomId || !rollCtx) return;
    saveInFlight({ ctx: rollCtx, dice: snap.dice, frames: snap.frames, streamId });
  }
  function clearInFlightRoll() {
    if (!currentRoomId) return;
    try { localStorage.removeItem(inFlightKey(currentRoomId)); } catch (e) {}
  }
  /* Kutsutaan room:rejoin-käsittelijästä ENNEN restoreDisplay-varapolkua.
     Palauttaa true jos löytyi ja jatkettiin kesken ollutta OMAA heittoa.
     Keskeytetty heitto (paused), jonka vuoro ei ole vielä palannut, otetaan
     muistiin odottamaan. Vanhan muodon tallenteet (ilman v/ctx) hylätään. */
  function tryResumeInFlightRoll(state) {
    if (!currentRoomId) return false;
    let raw;
    try { raw = localStorage.getItem(inFlightKey(currentRoomId)); } catch (e) { return false; }
    if (!raw) return false;
    let snap;
    try { snap = JSON.parse(raw); } catch (e) { clearInFlightRoll(); return false; }
    const sane = snap && snap.v === SNAP_V && snap.userId === me.id && snap.ctx &&
      Array.isArray(snap.dice) && snap.dice.length === state.diceCount;
    if (!sane) { clearInFlightRoll(); return false; }
    if (ctxMatches(snap.ctx, state)) {
      pausedRoll = null;
      resumePhysics(snap.ctx, snap, snap.streamId);
      return true;
    }
    const seat = state.players.find((p) => p.seatId === snap.ctx.seatId);
    const cur = seatOf(state);
    if (snap.paused && seat && cur && cur.seatId !== snap.ctx.seatId && filledOf(seat) === snap.ctx.filled) {
      pausedRoll = { kind: 'physics', ctx: snap.ctx, snap: { dice: snap.dice, frames: snap.frames || [] }, streamId: snap.streamId };
      return false;
    }
    clearInFlightRoll();
    return false;
  }
  /* Fysiikka jatkuu tallennetusta tilasta. Striimi jatkuu samalla
     tunnisteella kaikki kehykset alusta: katsojat ohittavat jo saamansa,
     ja tyhjästä aloittava saa koko heiton. */
  function resumePhysics(ctx, snap, id) {
    rollCtx = ctx;
    myRollInFlight = true;
    sentAt = 0;
    streamId = id || Date.now().toString(36);
    streamSent = 0;
    streamOpen = true;
    lastTick = null;
    window.Dice3D.resumeFrom(snap);
  }

  /* ---------- Oman heiton keskeytys ja jatko ---------- */
  /* Pysäyttää paikallisen heiton tai latauksen (nauhoitus loppuu eikä
     onSettle laukea) ja asettaa nopat annettuun tilaan. */
  function stopLocalRoll(values, held) {
    window.Dice3D.stopRoll();
    window.Dice3D.restoreDisplay(values, held);
  }
  /* Vuoro vietiin kesken oman heiton. keep: heitto otetaan talteen
     odottamaan vuoron palaamista (peruminen); muuten se hylätään. Pelkkä
     lataus (nopat vielä kädessä) ei ole heitto, joten sitä ei säilytetä. */
  function suspendMyRoll(keep, values, held) {
    const ctx = rollCtx, tick = lastTick, id = streamId;
    rollCtx = null; lastTick = null; myRollInFlight = false; streamOpen = false; sentAt = 0;
    disarmShake();
    const flying = tick && !tick.charging && !window.Dice3D.isCharging() && Array.isArray(tick.snap.dice);
    const kept = keep && ctx && flying ? { dice: tick.snap.dice, frames: (tick.snap.frames || []).slice() } : null;
    stopLocalRoll(values, held);
    if (kept) {
      pausedRoll = { kind: 'physics', ctx, snap: kept, streamId: id };
      saveInFlight({ ctx, dice: pausedRoll.snap.dice, frames: pausedRoll.snap.frames, streamId: id, paused: true });
    } else {
      clearInFlightRoll();
    }
    updateHint();
    refreshControls();
  }
  function dropPaused() {
    pausedRoll = null;
    clearInFlightRoll();
    updateHint();
  }
  /* Vuoro palasi: keskeytetty heitto jatkuu, jos tilanne on sama kuin
     heiton alkaessa. Muuten (paikka poistui, peli päättyi, tilanne muuttui)
     se hylätään ja pelaaja heittää uudestaan. */
  function maybeResumePaused(state) {
    if (!pausedRoll) return;
    if (state.status !== 'playing' || !state.players.some((p) => p.seatId === pausedRoll.ctx.seatId)) { dropPaused(); return; }
    const cur = seatOf(state);
    if (!cur || cur.seatId !== pausedRoll.ctx.seatId) return; // odotetaan vuoron palaamista
    if (!ctxMatches(pausedRoll.ctx, state)) { dropPaused(); return; }
    const pr = pausedRoll;
    pausedRoll = null;
    window.Dice3D.setPhysicsActive(true);
    if (pr.kind === 'result') {
      /* Heitto ehti asettua ennen kuin palvelin hylkäsi sen: sama tulos uudestaan. */
      myRollInFlight = true;
      streamId = pr.streamId;
      window.Dice3D.restoreDisplay(pr.diceValues, pr.lock);
      sendRoll(pr);
    } else {
      resumePhysics(pr.ctx, pr.snap, pr.streamId);
    }
    updateHint();
  }
  /* Kaikki oman heiton tila pois (huone poistui, estettiin, peli ei käynnissä). */
  function resetMyRoll() {
    if (diceReady && rollCtx && lastState) stopLocalRoll(lastState.diceValues, lastState.held);
    rollCtx = null; lastTick = null; pausedRoll = null;
    myRollInFlight = false; streamOpen = false; sentAt = 0;
  }

  /* Oman heiton tulos palvelimelle. r: { ctx, diceValues, trajectory, lock, streamId }. */
  function sendRoll(r) {
    streamOpen = false;
    sentAt = Date.now();
    socket.emit('game:roll', { roomId: currentRoomId, diceValues: r.diceValues, trajectory: r.trajectory || [], streamId: r.streamId, lock: r.lock }, (res) => {
      /* Palvelin on nyt joko hyväksynyt TAI hylännyt tämän heiton — kummassa
         tapauksessa tahansa paikallinen "kesken oleva heitto" -tallenne
         (localStorage) on käynyt tarpeettomaksi: onnistuessa palvelin
         tietää tuloksen jo, epäonnistuessa uusi yritys aloittaa oman
         nauhoituksensa alusta. Jätettynä talteen se voisi myöhemmin yrittää
         jatkaa jo käsiteltyä heittoa uudelleen turhaan. */
      clearInFlightRoll();
      // onnistuessa myRollInFlight puretaan vasta kun oman heiton kaiku (game:rollPlayback) saapuu
      if (res && res.ok) return;
      myRollInFlight = false; sentAt = 0;
      /* Hylkäys siksi, että edellinen merkintä peruttiin juuri ennen kuin
         tulos ehti perille: tulos jää odottamaan vuoron palaamista. */
      const st = lastState;
      if (st && st.status === 'playing' && !ctxMatches(r.ctx, st) && st.players.some((p) => p.seatId === r.ctx.seatId)) {
        pausedRoll = { kind: 'result', ctx: r.ctx, diceValues: r.diceValues, trajectory: r.trajectory, lock: r.lock, streamId: r.streamId };
        window.Dice3D.restoreDisplay(st.diceValues, st.held);
        updateHint();
        refreshControls();
        return;
      }
      err(res && res.error);
      refreshControls();
    });
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
         enää päivitä ohjaimia sen jälkeen kun toisto itsestään loppuu.
         Uudelleenpiirto tuo katsojan pikavalinnat näkyviin. */
      refreshControls();
      rerender();
      return;
    }
    const ctx = rollCtx || ctxOf(lastState);
    rollCtx = null; lastTick = null;
    sendRoll({ ctx, diceValues, trajectory: trajectory || [], streamId, lock: window.Dice3D.heldMask() });
  }

  /* Palvelimelta tuleva heiton tulos + koko nauhoitettu liikerata.
     Jos heitto oli OMA, fysiikka pyöri jo livenä eikä sitä toisteta —
     muille asiakkaille tämä on ainoa paikka joka koskaan liikuttaa
     noppia tälle heitolle (ei omaa simulaatiota, ks. tiedoston alkukommentti). */
  function handleRollPlayback({ diceValues, trajectory, rollerId, streamId: id }) {
    if (!diceReady) return;
    if (rollerId === me.id) {
      myRollInFlight = false;
      sentAt = 0;
      /* 5000: heiton aikana saapunut tila jätti sivussa olevat nopat
         moottorin tilaan (ks. handleRoomState); nyt ne palvelimen tilaan. */
      if (isFiveK(lastState)) lastState.held.forEach((h, i) => window.Dice3D.setHeld(i, h));
      refreshControls();
    } else {
      if (id && id === playedRollId) return;
      playedRollId = id || null;
      const wasRolling = window.Dice3D.isRolling();
      window.Dice3D.playTrajectory(trajectory, diceValues, id);
      if (!wasRolling && window.Dice3D.isRolling()) rerender();
    }
    if (lastState) maybeCelebrate(lastState, diceValues);
  }

  /* ---------- Heittopainike: paina&pidä (oletus) ---------- */
  function wireRollButton() {
    const rollBtn = document.getElementById('rollBtn');
    rollBtn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (lastState && lastState.variant.rollMode === 'shake' && !armed) return; // ravistustilassa ensin viritettävä
      if (!canRollNow()) return;
      /* Nappi kaappaa osoittimen, joten nosto tulee perille vaikka sormi
         olisi liukunut napin tai koko pelikehyksen ulkopuolelle. */
      try { rollBtn.setPointerCapture(ev.pointerId); } catch (e) { /* vanha selain */ }
      rollCtx = ctxOf(lastState);
      openStream();
      prepareThrow();
      window.Dice3D.startCharge(true); // nauhoitus ja striimi alkavat jo latauksesta
      syncUndo();
    });
    /* Sormen nosto heittää aina, missä tahansa. pointercancel (selain otti
       eleen) ja kaappauksen menetys heittävät myös, jottei lataus jää
       nopat ilmaan. */
    const release = () => {
      if (!window.Dice3D.isCharging()) return;
      disarmShake();
      startMyRoll(() => window.Dice3D.releaseCharge(true)); // voima lasketaan Dice3D:n sisällä pitoajasta
    };
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
    rollBtn.addEventListener('lostpointercapture', release);
    addEventListener('blur', release);
    rollBtn.addEventListener('contextmenu', (ev) => ev.preventDefault());
    rollBtn.addEventListener('click', () => {
      if (window.Dice3D.isRolling() || window.Dice3D.isCharging()) return;
      if (!lastState || !isMyTurn(lastState) || pausedRoll) return;
      if (!rollAllowed(lastState)) return;
      if (lastState.variant.rollMode === 'shake' && !armed) { armShake(); return; }
    });
    const shakePrompt = document.getElementById('shakePrompt');
    if (shakePrompt) shakePrompt.addEventListener('click', () => {
      disarmShake();
      if (!canRollNow()) return;
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
        if (!canRollNow()) return;
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
    /* Tikit kuuluvat vain omaan käynnissä olevaan heittoon (rollCtx). */
    window.Dice3D.onRecordTick((snap) => {
      if (!rollCtx) return;
      lastTick = { snap, charging: window.Dice3D.isCharging() };
      streamRoll(snap.frames);
      persistInFlightRoll(snap);
    });
    /* Muun heiton striimi katkesi eikä lopputulosta tullut: nopat palvelimen
       tilaan (heitto ei ole palvelimella, joten tila on heittoa edeltävä). */
    window.Dice3D.onStreamStall(() => {
      if (lastState) window.Dice3D.restoreDisplay(lastState.diceValues, lastState.held);
      refreshControls();
    });
    diceReady = true;
    wireRollButton();
    document.getElementById('canvasWrap').addEventListener('pointerdown', (ev) => {
      if (!currentRoomId || window.Dice3D.isCharging()) return;
      if (window.Dice3D.isRolling()) {
        /* Oman heiton aikana pysähtyneen nopan napautus lukitsee sen heti
           (ei kaadu muiden tönäisyistä); lukitus lähtee heiton mukana. */
        if (myRollInFlight && !isFiveK(lastState) && window.Dice3D.lockResting(ev.clientX, ev.clientY) >= 0) {
          if (window.UI) window.UI.sndHold();
          return;
        }
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
         sääntöjen hold():ssa (js/room-rules.js). Pikajatsissa ei lukita. */
      if (!isMyTurn(state) || state.variant.quick || state.rollsUsed === 0 ||
          (!isFiveK(state) && state.rollsUsed >= maxRolls(state) && !state.bankAvailable)) return;
      const i = window.Dice3D.hitTestDie(ev.clientX, ev.clientY);
      if (i < 0) return;
      /* 5000: aiemmalla heitolla sivuun siirretty noppa pysyy sivussa. */
      if (isFiveK(state) && state.fiveK && state.fiveK.locked[i]) return;
      socket.emit('game:hold', { roomId: currentRoomId, index: i }, (res) => { if (!res.ok) err(res.error); });
      if (window.UI) window.UI.sndHold();
    });
  }

  let lastDiceCount = null;
  function handleRoomState(state) {
    currentRoomId = state.id;
    /* Vuoron, heittojen tai viimeisimmän merkinnän muutos aloittaa uuden
       "perumisikkunan" (ks. undoBlocked). */
    const m = state.lastMark;
    const sig = [state.id, state.status, state.current, state.rollsUsed, m ? m.seatId + '/' + m.col + '/' + m.categoryId : ''].join('|');
    if (sig !== turnSig) { turnSig = sig; turnSeq++; }
    if (state.status === 'playing') {
      ensureDice();
      /* Oma heitto on kesken, mutta huone ei ole enää heiton lähtötilanteessa:
         vuoro vietiin alta. Heitto talteen (jos paikka on yhä pelissä) ja
         nopat palvelimen tilaan. */
      const lost = !!rollCtx && !ctxMatches(rollCtx, state);
      const keep = lost && state.players.some((p) => p.seatId === rollCtx.seatId);
      if (state.diceCount !== lastDiceCount) {
        window.Dice3D.setActiveDiceCount(state.diceCount);
        lastDiceCount = state.diceCount;
      }
      const cur = state.players[state.current];
      if (cur) window.Dice3D.applyColor(cur.color);
      if (lost) suspendMyRoll(keep, state.diceValues, state.held);
      /* 5000: oman latauksen ja heiton aikana nopat ovat moottorin tilassa
         (prepareThrow vapautti ne), ei palvelimen edellisessä. */
      const midThrow = isFiveK(state) && !lost && (myRollInFlight || window.Dice3D.isCharging());
      if (!midThrow) state.held.forEach((h, i) => window.Dice3D.setHeld(i, h));
      /* Fysiikka (world.step) ajetaan VAIN vuorossa olevalla pelaajalla —
         muut ovat aina puhtaassa toistotilassa (ks. dice3d.js:n
         setPhysicsActive-kommentti). Pitää simuloinnin ja toiston
         täysin erillään niin etteivät ne voi häiritä toisiaan. */
      window.Dice3D.setPhysicsActive(isMyTurn(state));
    } else {
      lastDiceCount = null;
      disarmShake();
      resetMyRoll();
      /* Huone ei ole (enää) käynnissä (odottaa/päättyi/uusinta) — mahdollinen
         jäljelle jäänyt "kesken oleva heitto" -tallennus tälle huoneelle on
         nyt joka tapauksessa vanhentunut (uusi peli/uusinta nollaa
         heittolaskurin, jolloin vanha tallennus voisi muuten näyttää
         virheellisesti yhä validilta samojen rollsUsed/diceCount-arvojen
         sattuessa kohdalleen). */
      clearInFlightRoll();
    }
    lastState = state;
    if (state.status === 'playing') maybeResumePaused(state);
    updateHint();
    if (listeners.roomState) listeners.roomState(state, me);
    syncUndo();
  }

  /* Heiton juhlinta: vain kun heittäjällä (vuorossa oleva paikka) on
     vastaava rivi vielä auki jossain sarakkeessa. Merkitty Yatzy ei juhli
     uudestaan; merkinnän oma juhlinta on mp-main.js:n scoreCategoryssa. */
  function maybeCelebrate(state, diceValues) {
    const S = window.Scoring, UI = window.UI, D3 = window.Dice3D;
    const roller = state.players && state.players[state.current];
    if (!roller || isFiveK(state)) return;
    const open = (id) => roller.scs.some((sc) => sc[id] === undefined);
    const six = state.variant.sixDice;
    const big = six && open('yatzy6') ? S.scoreCat('yatzy6', diceValues, six) : 0;
    const pts = open('yatzy') ? S.scoreCat('yatzy', diceValues, six) : 0;
    if (big >= 100) { UI.showBanner('SUUR-YATZY!'); UI.sndYatzy(); UI.burst(260, true); D3.shakeCamera(18); }
    else if (pts >= 50) { UI.showBanner('YATZY!'); UI.sndYatzy(); UI.burst(200, true); D3.shakeCamera(14); }
  }

  function createRoom(name, maxPlayers, variant, cb) {
    socket.emit('room:create', { name, maxPlayers, variant }, (res) => cb && cb(res));
  }
  function joinRoom(roomId, cb) {
    socket.emit('room:join', { roomId }, (res) => cb && cb(res));
  }
  /* Katsojana sisään: ack tuo tilan heti, jotta nopat voi asettaa
     palvelimen silmäluvuille (samoin kuin uudelleenliittyessä) eikä
     katsoja näe oletusnoppia seuraavaan heittoon asti. */
  function watchRoom(roomId, cb) {
    socket.emit('room:watch', { roomId }, (res) => {
      if (res.ok) {
        handleRoomState(res.state);
        if (res.state.status === 'playing' && window.Dice3D) window.Dice3D.restoreDisplay(res.state.diceValues, res.state.held);
      }
      cb && cb(res);
    });
  }
  /* Isännän toiminto huoneen ihmiselle: kick | block | unblock | admit | unadmit. */
  function admin(action, target, cb) {
    socket.emit('room:admin', Object.assign({ roomId: currentRoomId, action }, target), (res) => cb && cb(res));
  }
  function reorder(seatIds, cb) {
    socket.emit('room:order', { roomId: currentRoomId, seatIds }, (res) => cb && cb(res));
  }
  function setSeatColor(seatId, color, cb) {
    socket.emit('room:color', { roomId: currentRoomId, seatId, color }, (res) => cb && cb(res));
  }
  /* Oma vieras: { action: 'add', name } tai { action: 'remove', seatId }. */
  function guest(payload, cb) {
    socket.emit('room:guest', Object.assign({ roomId: currentRoomId }, payload), (res) => cb && cb(res));
  }
  /* Poistuu huoneesta pysyvästi (kesken pelin = luovutus). roomId on
     valinnainen: aulan "Luovuta"-nappi voi osoittaa huonetta suoraan. */
  function leaveRoom(cb, roomId) {
    const id = roomId || currentRoomId;
    if (!id) return cb && cb({ ok: true });
    const wasCurrent = id === currentRoomId;
    if (wasCurrent) { disarmShake(); resetMyRoll(); clearInFlightRoll(); }
    socket.emit('room:leave', { roomId: id }, (res) => {
      if (wasCurrent) { currentRoomId = null; lastState = null; }
      cb && cb(res);
    });
  }
  /* ---------- Offline (LocalRoom) ---------- */
  function localCreate(players, variant, cb) {
    socket.emit('local:create', { players, variant }, (res) => cb && cb(res));
  }
  function localResume(cb) {
    socket.emit('local:resume', {}, (res) => cb && cb(res));
  }
  /* Peruminen vain, kun seuraava heitto ei ole vielä alkanut (undoBlocked).
     Palvelin tarkistaa lisäksi omansa: heiton saavuttua ei ole peruttavaa. */
  function undo(cb) {
    if (!canUndo(lastState)) {
      syncUndo();
      return cb && cb({ ok: false, error: 'Seuraava pelaaja ehti jo heittää — merkintää ei voi enää perua.' });
    }
    socket.emit('game:undo', { roomId: currentRoomId }, (res) => cb && cb(res));
  }
  function startGame(cb) {
    socket.emit('room:start', { roomId: currentRoomId }, (res) => cb && cb(res));
  }
  /* start: peli alkaa heti samoilla pelaajilla; muuten odotushuoneeseen. */
  function rematch(variant, start, cb) {
    socket.emit('room:rematch', { roomId: currentRoomId, variant, start }, (res) => cb && cb(res));
  }
  function deleteRoom(roomId, cb) {
    socket.emit('room:delete', { roomId: roomId || currentRoomId }, (res) => cb && cb(res));
  }
  /* 5000: vuoron potti omaan summaan. */
  function bank(cb) {
    socket.emit('game:bank', { roomId: currentRoomId }, (res) => cb && cb(res));
  }
  function scoreCategory(categoryId, col, cb) {
    socket.emit('game:score', { roomId: currentRoomId, categoryId, col }, (res) => cb && cb(res));
  }

  return {
    connect, disconnect, onLobby, onRoomState, onRoomError, onRejoin, onDeleted, onBlocked, onNotice,
    createRoom, joinRoom, watchRoom, admin, guest, setSeatColor, reorder, leaveRoom, localCreate, localResume, undo, startGame, rematch, deleteRoom, scoreCategory, bank,
    canUndo,
    getMe: () => me, getRoomId: () => currentRoomId, maxRolls,
  };
})();
