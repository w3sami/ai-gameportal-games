(() => {
  'use strict';
  // ios-compat serializes small WASM instantiations. It is harmless on desktop
  // browsers and fixes first-run startup in WebKit and embedded Chromium views.
  const PLAYER_URL = 'https://appsbyrich.com/dreamcast?rom=continuous%2Fdrift-los-angeles.elf&name=Drift%20Los%20Angeles&ios-compat=1';
  const player = document.querySelector('#player');
  const shell = document.querySelector('#playerShell');
  const launchCard = document.querySelector('#launchCard');
  const loading = document.querySelector('#loading');
  const launchButton = document.querySelector('#launchButton');
  const restartButton = document.querySelector('#restartButton');
  const fullscreenButton = document.querySelector('#fullscreenButton');
  const gamepadStatus = document.querySelector('#gamepadStatus');
  const toggleControls = document.querySelector('#toggleControls');
  const controlList = document.querySelector('#controlList');
  let started = false;

  function launch() {
    started = true;
    launchCard.hidden = true;
    loading.hidden = false;
    player.classList.remove('ready');
    player.src = PLAYER_URL;
  }

  launchButton.addEventListener('click', launch);
  player.addEventListener('load', () => {
    if (!started) return;
    loading.hidden = true;
    player.classList.add('ready');
    player.focus();
  });

  restartButton.addEventListener('click', () => {
    if (!started) return launch();
    loading.hidden = false;
    player.classList.remove('ready');
    player.src = 'about:blank';
    window.setTimeout(() => { player.src = PLAYER_URL; }, 50);
  });

  fullscreenButton.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.requestFullscreen();
    } catch (_) { /* Browser UI remains available if fullscreen is denied. */ }
  });

  function updateGamepad() {
    const connected = Array.from(navigator.getGamepads?.() || []).some(Boolean);
    gamepadStatus.classList.toggle('online', connected);
    gamepadStatus.lastChild.textContent = connected ? ' Ohjain: yhdistetty' : ' Ohjain: ei yhdistetty';
  }
  window.addEventListener('gamepadconnected', updateGamepad);
  window.addEventListener('gamepaddisconnected', updateGamepad);
  updateGamepad();

  toggleControls.addEventListener('click', () => {
    const expanded = toggleControls.getAttribute('aria-expanded') === 'true';
    toggleControls.setAttribute('aria-expanded', String(!expanded));
    toggleControls.textContent = expanded ? '+' : '−';
    controlList.hidden = expanded;
  });

  document.addEventListener('keydown', (event) => {
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
  }, { passive:false });
})();
