"use strict";
/* ============================================================
   main.js — yksinpelin (offline) käynnistys.
   Kokoaa Dice3D + Scoring + GameLogic + UI yhteen.
   ============================================================ */
(function () {
  window.Dice3D.init(document.getElementById('canvasWrap'));
  window.GameLogic.wireDom();
  window.GameLogic.loadSettings();
  window.GameLogic.loadSavedGame();
  window.UI.updateControls();
})();
