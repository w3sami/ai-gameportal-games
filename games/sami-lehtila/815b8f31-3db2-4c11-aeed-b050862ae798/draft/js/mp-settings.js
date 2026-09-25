"use strict";
/* ============================================================
   mp-settings.js — pelaajakohtaiset NÄYTTÖ/käyttöasetukset moninpelissä.
   Nämä ovat puhtaasti paikallisia (localStorage, ei jaeta huoneen
   kanssa eikä palvelimelle) — sama periaate kuin yksinpelin
   settingsOverlay (ks. js/game-logic.js / js/ui.js), mutta ilman
   sääntövariantteja (tuplasarake/6 noppaa/pankki/heittotapa ovat
   huonekohtaisia, valitaan huoneen luonnissa — ks. mp-main.js).

   Portattu tarkasti yksinpelin vastineista:
   - nudge (tälli): Dice3D.configure({nudge}) + kanvas-napautus kesken
     OMAN heiton (ks. mp-game.js:n canvasWrap-pointerdown).
   - sound: UI.setSoundEnabled (clack/chime-äänet).
   - devUpper: yläkerran 0-pohjainen +/- -näyttö pistetaulukossa
     (ks. mp-ui.js:n renderTable).
   - parkHeld: Dice3D.configure({parkHeld}) — lukitut nopat liu'utetaan
     pöydän etureunaan heiton alkaessa.

   hideUsed ja ownCols EIVÄT ole tässä tiedostossa `wire()`:atun
   hammasratas-paneelin kytkimiä (kuten yllä) vaan pistetaulukon omia
   otsikkonappeja (🙈/👤, ks. js/mp-ui.js:n renderTable ja mp-main.js:n
   onToggleHideUsed/onToggleOwnCols) — säilytetään silti tässä jaetussa
   settings-oliossa niin että ne pysyvät samassa localStorage-avaimessa
   muiden pelaajakohtaisten asetusten kanssa.
   ============================================================ */
window.MpSettings = (function () {
  const KEY = 'yatzy-mp-settings';
  const settings = { nudge: false, sound: true, devUpper: true, parkHeld: true, hideUsed: false, ownCols: false };

  function load() {
    try {
      const v = localStorage.getItem(KEY);
      if (v) Object.assign(settings, JSON.parse(v));
    } catch (e) {}
    apply();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {}
  }
  function apply() {
    if (window.Dice3D) window.Dice3D.configure({ nudge: settings.nudge, parkHeld: settings.parkHeld, sound: settings.sound });
    if (window.UI) window.UI.setSoundEnabled(settings.sound);
    applyUI();
  }
  function applyUI() {
    const map = { swNudge: 'nudge', swSound: 'sound', swDev: 'devUpper', swPark: 'parkHeld' };
    Object.keys(map).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('on', !!settings[map[id]]);
    });
  }

  function wire(onDevChange) {
    const gearBtn = document.getElementById('gearBtn');
    const overlay = document.getElementById('settingsOverlay');
    if (!gearBtn || !overlay) return;
    gearBtn.addEventListener('click', () => { applyUI(); overlay.style.display = 'flex'; });
    document.getElementById('closeSettings').addEventListener('click', () => { overlay.style.display = 'none'; });
    const bind = (id, key, after) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', () => {
        settings[key] = !settings[key];
        applyUI(); save();
        if (key === 'nudge' || key === 'parkHeld' || key === 'sound') apply();
        if (after) after();
      });
    };
    bind('swNudge', 'nudge');
    bind('swSound', 'sound');
    bind('swDev', 'devUpper', onDevChange);
    bind('swPark', 'parkHeld');
  }

  return { settings, load, save, wire };
})();
