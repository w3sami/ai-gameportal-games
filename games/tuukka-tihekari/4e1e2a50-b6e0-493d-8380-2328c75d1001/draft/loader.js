import Play from './Play.js';

const RELEASE = 'https://raw.githubusercontent.com/tuuchen/tyracraft-web-assets/42c1b715a13f3d971ed9e486e6d13e139466d144/release-assets';
const ISO_URL = `${RELEASE}/TYRACRAFT-v0.86.140-portal.iso`;
const WASM_URL = `${RELEASE}/Play.wasm`;
const SAVE_ROOT = '/vfs/mc0';
const SAVE_DB = 'tyracraft-native-saves-v1';

const canvas = document.querySelector('#outputCanvas');
const gate = document.querySelector('#gate');
const startButton = document.querySelector('#start');
const status = document.querySelector('#status');
const progress = document.querySelector('#progress');
const saveStatus = document.querySelector('#saveStatus');
let playModule;
let running = false;
let saveTimer;
const syntheticHeld = new Set();

async function prepareIsolation() {
  if (!('serviceWorker' in navigator)) return;
  await navigator.serviceWorker.register('./coi-serviceworker.js');
  await navigator.serviceWorker.ready;
  if (top === self && !crossOriginIsolated && !sessionStorage.getItem('coi-reload')) {
    sessionStorage.setItem('coi-reload', '1');
    location.reload();
  }
}
prepareIsolation().catch(error => console.error('Isolation worker failed', error));

class DiscImageDevice {
  constructor(module, file) { this.module = module; this.file = file; this.done = false; }
  getFileSize() { return this.file.size; }
  isDone() { return this.done; }
  read(destination, offset, size) {
    this.done = false;
    this.file.slice(offset, offset + size).arrayBuffer().then(buffer => {
      this.module.HEAPU8.set(new Uint8Array(buffer), destination);
      this.done = true;
    }).catch(error => {
      console.error('Disc read failed', error);
      this.done = true;
    });
  }
}

function openSaveDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SAVE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function walkFiles(path, files = []) {
  for (const name of playModule.FS.readdir(path)) {
    if (name === '.' || name === '..') continue;
    const child = `${path}/${name}`;
    const info = playModule.FS.stat(child);
    if (playModule.FS.isDir(info.mode)) walkFiles(child, files);
    else files.push({ path: child, data: playModule.FS.readFile(child).slice().buffer });
  }
  return files;
}

async function loadSaveRecords() {
  const db = await openSaveDb();
  const records = await new Promise((resolve, reject) => {
    const request = db.transaction('files').objectStore('files').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return records;
}

async function restoreSaves() {
  for (const { path, data } of await loadSaveRecords()) {
    const parts = path.split('/').filter(Boolean);
    let directory = '';
    for (const part of parts.slice(0, -1)) {
      directory += `/${part}`;
      try { playModule.FS.mkdir(directory); } catch {}
    }
    playModule.FS.writeFile(path, new Uint8Array(data));
  }
}

async function persistSaves() {
  if (!playModule) return;
  saveStatus.textContent = 'Saving…';
  const files = walkFiles(SAVE_ROOT);
  const db = await openSaveDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    const store = transaction.objectStore('files');
    store.clear();
    for (const file of files) store.put(file, file.path);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  saveStatus.textContent = files.length ? 'Saved locally' : 'Local saves ready';
}

function dispatch(code, down) {
  canvas.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
}

const keyboardMap = new Map([
  ['KeyW', 'KeyT'], ['KeyS', 'KeyG'], ['KeyA', 'KeyF'], ['KeyD', 'KeyH'],
  ['ShiftLeft', 'Backspace'], ['ShiftRight', 'Backspace'],
]);
for (const type of ['keydown', 'keyup']) {
  document.addEventListener(type, event => {
    const mapped = keyboardMap.get(event.code);
    if (!mapped || !running) return;
    event.preventDefault();
    dispatch(mapped, type === 'keydown');
  });
}

const gamepadButtons = ['KeyZ', 'KeyX', 'KeyA', 'KeyS', 'Key1', 'Key8', 'Key2', 'Key9', 'Backspace', 'Enter', 'Key3', 'Key0', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
function pollGamepad() {
  const pad = Array.from(navigator.getGamepads?.() || []).find(Boolean);
  const next = new Set();
  if (running && pad) {
    pad.buttons.forEach((button, index) => { if (button.pressed && gamepadButtons[index]) next.add(gamepadButtons[index]); });
    const a = pad.axes;
    if (a[0] < -.25) next.add('KeyF'); if (a[0] > .25) next.add('KeyH');
    if (a[1] < -.25) next.add('KeyT'); if (a[1] > .25) next.add('KeyG');
    if (a[2] < -.25) next.add('KeyJ'); if (a[2] > .25) next.add('KeyL');
    if (a[3] < -.25) next.add('KeyI'); if (a[3] > .25) next.add('KeyK');
  }
  for (const code of next) if (!syntheticHeld.has(code)) dispatch(code, true);
  for (const code of syntheticHeld) if (!next.has(code)) dispatch(code, false);
  syntheticHeld.clear(); next.forEach(code => syntheticHeld.add(code));
  requestAnimationFrame(pollGamepad);
}
requestAnimationFrame(pollGamepad);

const mouseReleases = new Map();
document.addEventListener('mousemove', event => {
  if (!running || document.pointerLockElement !== canvas) return;
  const horizontal = event.movementX < -2 ? 'KeyJ' : event.movementX > 2 ? 'KeyL' : null;
  const vertical = event.movementY < -2 ? 'KeyI' : event.movementY > 2 ? 'KeyK' : null;
  for (const code of [horizontal, vertical].filter(Boolean)) {
    dispatch(code, true);
    clearTimeout(mouseReleases.get(code));
    mouseReleases.set(code, setTimeout(() => dispatch(code, false), 45));
  }
});
canvas.addEventListener('click', () => { if (running) canvas.requestPointerLock?.(); });

async function fetchWithProgress(url) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Game image download failed (HTTP ${response.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !total) return response.blob();
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); received += value.length;
    progress.value = received / total;
    status.textContent = `Downloading PS2 disc… ${Math.round(received / 1048576)} / ${Math.round(total / 1048576)} MiB`;
  }
  return new Blob(chunks, { type: 'application/x-iso9660-image' });
}

async function boot() {
  if (top !== self && !crossOriginIsolated) {
    const player = open(location.href, '_blank', 'noopener');
    if (player) {
      status.textContent = 'The PS2 player opened in a new tab.';
    } else {
      const field = document.createElement('textarea');
      field.value = location.href;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed'; field.style.opacity = '0';
      document.body.append(field); field.select();
      const copied = document.execCommand('copy');
      field.remove();
      status.textContent = copied
        ? 'Bigbools blocks popups here. Direct player link copied — press Ctrl+L, Ctrl+V, Enter.'
        : `Bigbools blocks popups here. Open the direct player URL: ${location.href}`;
      startButton.textContent = 'Copy direct player link';
    }
    return;
  }
  startButton.disabled = true;
  try {
    if (!crossOriginIsolated) throw new Error('WebAssembly thread isolation is not active. Reload this player once.');
    if (!self.WebAssembly || !self.WebGL2RenderingContext || !indexedDB) throw new Error('This browser lacks WebAssembly, WebGL 2, or IndexedDB support.');
    status.textContent = 'Loading Play! emulator…'; progress.removeAttribute('value');
    playModule = await Play({
      canvas,
      mainScriptUrlOrBlob: new URL('./Play.js', location.href).href,
      locateFile: path => path.endsWith('.wasm') ? WASM_URL : new URL(path, location.href).href,
      print: message => console.info('[Play!]', message),
      printErr: message => console.error('[Play!]', message),
    });
    playModule.FS.mkdir('/work'); playModule.FS.mkdir('/vfs'); playModule.FS.mkdir(SAVE_ROOT); playModule.FS.mkdir(`${SAVE_ROOT}/TYRACRAFT`);
    await restoreSaves();
    playModule.ccall('initVm', '', [], []);
    progress.value = 0;
    const discBlob = await fetchWithProgress(ISO_URL);
    if (discBlob.size < 49_000_000) throw new Error(`Game image is truncated (${discBlob.size} bytes).`);
    const disc = new File([discBlob], 'TYRACRAFT.ISO', { type: discBlob.type });
    playModule.discImageDevice = new DiscImageDevice(playModule, disc);
    playModule.bootDiscImage(disc.name);
    running = true; gate.classList.add('hidden'); canvas.focus();
    saveTimer = setInterval(() => persistSaves().catch(error => { console.error(error); saveStatus.textContent = 'Save sync failed'; }), 15000);
  } catch (error) {
    console.error(error); status.textContent = error.message || String(error);
    progress.value = 0; startButton.disabled = false;
  }
}
startButton.addEventListener('click', boot);

document.querySelector('#fullscreen').addEventListener('click', () => document.querySelector('#stage').requestFullscreen?.());
document.querySelector('#export').addEventListener('click', async () => {
  try {
    if (playModule) await persistSaves();
    const files = (await loadSaveRecords()).map(file => ({ path: file.path, data: Array.from(new Uint8Array(file.data)) }));
    const blob = new Blob([JSON.stringify({ format: 'tyracraft-native-saves-v1', files })], { type: 'application/json' });
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'tyracraft-saves.json' });
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (error) { console.error(error); saveStatus.textContent = 'Export failed'; }
});
document.querySelector('#import').addEventListener('change', async event => {
  try {
    const bundle = JSON.parse(await event.target.files[0].text());
    if (bundle.format !== 'tyracraft-native-saves-v1' || !Array.isArray(bundle.files)) throw new Error('Unsupported save bundle.');
    const db = await openSaveDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite'); const store = transaction.objectStore('files'); store.clear();
      for (const file of bundle.files) store.put({ path: file.path, data: new Uint8Array(file.data).buffer }, file.path);
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    });
    db.close(); saveStatus.textContent = 'Imported — restart game';
  } catch (error) { console.error(error); saveStatus.textContent = 'Import failed'; }
});

addEventListener('pagehide', () => { clearInterval(saveTimer); persistSaves().catch(() => {}); });
