(() => {
  'use strict';
  const shell = document.querySelector('#playerShell');
  const launchCard = document.querySelector('#launchCard');
  const loading = document.querySelector('#loading');
  const launchButton = document.querySelector('#launchButton');
  const restartButton = document.querySelector('#restartButton');
  const fullscreenButton = document.querySelector('#fullscreenButton');
  const gamepadStatus = document.querySelector('#gamepadStatus');
  const toggleControls = document.querySelector('#toggleControls');
  const controlList = document.querySelector('#controlList');
  const loadingHint = document.querySelector('#loadingHint');
  const driveWarmup = document.querySelector('#driveWarmup');
  const warmupBar = document.querySelector('#warmupBar');
  const warmupCountdown = document.querySelector('#warmupCountdown');
  let started = false;
  let bootGeneration = 0;
  let bootTimer = 0;
  let readyTimer = 0;
  let wasmInstantiateQueue = Promise.resolve();
  let gameStartedAt = 0;
  let warmupShown = false;
  let warmupTimer = 0;
  let warmupTicker = 0;
  let launchPadDown = false;
  const assetBase = 'https://raw.githubusercontent.com/tuuchen/drift-los-angeles-web-assets/241d02c756060922d691b8613e3e4ae6bf1524d3/';
  const embeddedRuntime = Boolean(window.chrome?.webview) || /Electron|Codex|OpenAI/i.test(navigator.userAgent);
  const edgeRuntime = /Edg\//.test(navigator.userAgent) && !embeddedRuntime;
  const gameFile = edgeRuntime ? 'drift-los-angeles-browser.elf' : 'drift-los-angeles.elf';
  const gameSize = edgeRuntime ? 10262556 : 10260300;
  document.documentElement.dataset.gameRuntime = edgeRuntime ? 'edge-compat' : 'upstream';

  const options = {
    reicast_boot_to_bios: 'disabled',
    reicast_hle_bios: 'enabled',
    reicast_threaded_rendering: 'disabled',
    reicast_synchronous_rendering: 'disabled',
    reicast_internal_resolution: '640x480',
    reicast_enable_dsp: 'disabled',
    reicast_mipmapping: 'disabled',
    reicast_anisotropic_filtering: 'off',
    reicast_enable_rttb: 'disabled',
    reicast_enable_purupuru: 'disabled',
    reicast_alpha_sorting: 'per-strip (fast, least accurate)',
    reicast_delay_frame_swapping: 'disabled',
    reicast_frame_skipping: 'disabled',
    reicast_framerate: 'normal'
  };

  function setLoading(title, detail) {
    loading.querySelector('strong').textContent = title;
    loading.querySelector('span').textContent = detail;
  }

  function stopBootTicker() {
    if (bootTimer) window.clearInterval(bootTimer);
    bootTimer = 0;
  }

  function showDriveWarmup() {
    if (!gameStartedAt || warmupShown || Date.now() - gameStartedAt < 8000) return;
    warmupShown = true;
    driveWarmup.hidden = false;
    if (warmupTimer) window.clearTimeout(warmupTimer);
    if (warmupTicker) window.clearInterval(warmupTicker);
    const duration = 32000;
    const startedAt = Date.now();
    const update = () => {
      const elapsed = Math.min(duration, Date.now() - startedAt);
      const remaining = Math.max(0, Math.ceil((duration - elapsed) / 1000));
      warmupBar.style.width = `${Math.round(elapsed / duration * 100)}%`;
      warmupCountdown.textContent = remaining
        ? `Valmistellaan ajoa · noin ${remaining} s`
        : 'Ajo on valmis';
    };
    update();
    warmupTicker = window.setInterval(update, 1000);
    warmupTimer = window.setTimeout(() => {
      window.clearInterval(warmupTicker);
      warmupTicker = 0;
      update();
      driveWarmup.hidden = true;
    }, duration);
  }

  function showReadyTransition(generation) {
    stopBootTicker();
    if (readyTimer) window.clearTimeout(readyTimer);
    setLoading('Emulaattori on melkein valmis', 'Flycast viimeistelee pelinäkymää. Oranssi “Käynnistä Drift Los Angeles” -painike ilmestyy seuraavaksi.');
    loadingHint.textContent = 'Älä sulje sivua — tämä musta välivaihe kuuluu Dreamcastin käynnistykseen.';
    readyTimer = window.setTimeout(() => {
      if (generation === bootGeneration) loading.hidden = true;
    }, 10000);
  }

  function startBootTicker(generation) {
    stopBootTicker();
    const startedAt = Date.now();
    const update = () => {
      if (generation !== bootGeneration) return stopBootTicker();
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      let stage = 'Ladataan Flycast-emulaattorin ydintä selaimeen.';
      if (seconds >= 12) stage = 'Puretaan emulaattoriydintä ja valmistellaan Dreamcastia.';
      if (seconds >= 28) stage = 'Käynnistetään Dreamcastia — musta ruutu tässä vaiheessa on normaali.';
      if (seconds >= 50) stage = 'Moottori lämpenee yhä. Ensimmäinen käynnistys voi kestää tavallista pidempään.';
      setLoading(`Valmistellaan peliä · ${seconds} s`, stage);
      loadingHint.textContent = 'Pidä tämä välilehti auki. Käynnistyspainike ilmestyy automaattisesti, kun peli on valmis.';
    };
    update();
    bootTimer = window.setInterval(update, 1000);
  }

  async function fetchElf(generation) {
    const response = await fetch(`${assetBase}${gameFile}`, { cache:'force-cache', mode:'cors' });
    if (!response.ok) throw new Error(`ELF download failed (${response.status})`);
    const total = Number(response.headers.get('content-length')) || gameSize;
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array(await response.arrayBuffer());
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (generation !== bootGeneration) throw new Error('Restarted');
      chunks.push(value);
      received += value.byteLength;
      const percent = Math.min(100, Math.round(received / total * 100));
      setLoading(`Ladataan peliä · ${percent} %`, `${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} Mt`);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }

  function patchWebGL() {
    if (window.__flycastWebGLPatched) return;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const context = original.apply(this, args);
      const isGL = (typeof WebGLRenderingContext !== 'undefined' && context instanceof WebGLRenderingContext) ||
        (typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext);
      if (isGL && !context.__flycastGetParameterPatched) {
        const getParameter = context.getParameter.bind(context);
        context.getParameter = parameter => parameter === 7939
          ? (context.getSupportedExtensions?.() || []).join(' ')
          : getParameter(parameter);
        context.__flycastGetParameterPatched = true;
      }
      return context;
    };
    window.__flycastWebGLPatched = true;
  }

  function patchWasmInstantiation() {
    if (window.__flycastWasmInstantiationPatched) return;
    const original = WebAssembly.instantiate;
    WebAssembly.instantiate = (source, imports) => {
      const size = source instanceof ArrayBuffer || ArrayBuffer.isView(source)
        ? source.byteLength
        : 0;
      if (!size || size > 1048576) return original.call(WebAssembly, source, imports);
      const instantiate = () => original.call(WebAssembly, source, imports);
      const result = wasmInstantiateQueue.then(instantiate, instantiate);
      wasmInstantiateQueue = result.then(() => undefined, () => undefined);
      return result;
    };
    window.__flycastWasmInstantiationPatched = true;
  }

  async function mountEmulator(elfBytes, generation) {
    if (generation !== bootGeneration) return;
    if (!window.fflate?.unzipSync) throw new Error('ZIP-purkurin lataus epäonnistui');
    window.__dreamcastUnzipSync = window.fflate.unzipSync;
    patchWasmInstantiation();
    patchWebGL();
    shell.classList.add('ejs-mode');
    loading.hidden = false;
    startBootTicker(generation);
    window.EJS_player = '#dreamcast-game';
    window.EJS_core = 'flycast';
    // EmulatorJS expects a fetchable URL (and uses its extension for core loading).
    // The preceding streamed request warms the browser cache and provides real progress.
    window.EJS_gameUrl = `${assetBase}${gameFile}`;
    window.EJS_gameName = 'Drift Los Angeles';
    // Version this key when compatibility-critical core defaults change so an
    // old, non-working resolution cannot override the launcher configuration.
    window.EJS_gameID = edgeRuntime ? 0x44a4f747 : 0x44a4f746;
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/4.2.3/data/';
    window.EJS_paths = {
      'flycast.json': 'flycast.json?v=1',
      'flycast-wasm.data': `${assetBase}flycast-wasm.data`,
      'flycast-legacy-wasm.data': `${assetBase}flycast-wasm.data`
    };
    window.EJS_defaultOptions = options;
    window.EJS_backgroundColor = '#03050a';
    window.EJS_color = '#ff6b35';
    window.EJS_volume = 0.7;
    window.EJS_threads = false;
    window.EJS_disableCue = true;
    window.EJS_startOnLoaded = false;
    window.EJS_startButtonName = 'Käynnistä Drift Los Angeles';
    window.EJS_language = 'fi-FI';
    window.EJS_disableAutoLang = false;
    window.EJS_CacheLimit = 0;
    window.EJS_ready = () => showReadyTransition(generation);
    window.EJS_onGameStart = () => {
      stopBootTicker();
      if (readyTimer) window.clearTimeout(readyTimer);
      loading.hidden = true;
      driveWarmup.hidden = true;
      gameStartedAt = Date.now();
      warmupShown = false;
    };
    const script = document.createElement('script');
    script.src = 'https://cdn.emulatorjs.org/4.2.3/data/loader.js';
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      stopBootTicker();
      if (readyTimer) window.clearTimeout(readyTimer);
      shell.classList.remove('ejs-mode');
      loading.hidden = false;
      setLoading('Emulaattorin lataus epäonnistui', 'Tarkista verkkoyhteys ja valitse Käynnistä uudelleen.');
    };
    document.body.appendChild(script);
  }

  async function launch() {
    started = true;
    const generation = ++bootGeneration;
    launchCard.hidden = true;
    loading.hidden = false;
    setLoading('Ladataan peliä · 0 %', '0.0 / 9.8 Mt');
    loadingHint.textContent = 'Pelitiedosto ladataan turvallisesti suoraan selaimeesi.';
    try {
      const elfBytes = await fetchElf(generation);
      await mountEmulator(elfBytes, generation);
    } catch (error) {
      stopBootTicker();
      if (readyTimer) window.clearTimeout(readyTimer);
      if (generation !== bootGeneration) return;
      loading.hidden = false;
      setLoading('Lataus epäonnistui', error.message || 'Tarkista verkkoyhteys ja yritä uudelleen.');
    }
  }

  launchButton.addEventListener('click', launch);

  restartButton.addEventListener('click', () => {
    if (!started) return launch();
    window.location.reload();
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

  function watchLaunchButton() {
    const down = Array.from(navigator.getGamepads?.() || []).some(pad =>
      Boolean(pad?.buttons?.some(button => button.pressed)));
    if (down && !launchPadDown) showDriveWarmup();
    launchPadDown = down;
    window.requestAnimationFrame(watchLaunchButton);
  }
  watchLaunchButton();

  toggleControls.addEventListener('click', () => {
    const expanded = toggleControls.getAttribute('aria-expanded') === 'true';
    toggleControls.setAttribute('aria-expanded', String(!expanded));
    toggleControls.textContent = expanded ? '+' : '−';
    controlList.hidden = expanded;
  });

  document.addEventListener('keydown', (event) => {
    if (['enter','x','z','a'].includes(event.key.toLowerCase())) showDriveWarmup();
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
  }, { passive:false, capture:true });
})();
