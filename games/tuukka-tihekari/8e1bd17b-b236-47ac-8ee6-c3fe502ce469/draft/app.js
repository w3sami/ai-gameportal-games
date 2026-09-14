/* Bigbools Pocket launcher. Emulator core: binjgb v0.1.11 (MIT).
 * Integration derived from binjgb's MIT-licensed simple browser example. */
"use strict";
window.POCKET_APP_STARTED = true;

const W = 160, H = 144, AUDIO_FRAMES = 4096, AUDIO_LATENCY = .1;
const CPU_HZ = 4194304, MAX_UPDATE = 5 / 60;
const EVENT_FRAME = 1, EVENT_AUDIO = 2, EVENT_TICKS = 4;
const DB_NAME = "bigbools-pocket-saves", DB_VERSION = 1;

const $ = (q) => document.querySelector(q);
const els = {
  pocket: $("#pocket"), bezel: $("#bezel"), canvas: $("#screen"), led: $("#power-led"), status: $("#status"),
  library: $("#library-view"), list: $("#game-list"), loading: $("#loading-view"), loadingTitle: $("#loading-title"),
  loadingLabel: $("#loading-label"), progress: $("#progress-bar"), menu: $("#menu-view"), menuGame: $("#menu-game"),
  menuList: $("#menu-list"), credits: $("#credits-view"), creditsList: $("#credits-list"), error: $("#error-view"),
  errorMessage: $("#error-message"), soundGate: $("#sound-gate"), mute: $("#mute")
};

let manifest = { games: [] }, selected = 0, menuSelected = 0, mode = "library";
let emulator = null, currentGame = null, modulePromise = null, volume = .65, muted = false;
let startedByPlayer = false, previousPad = {}, gamepadRaf = 0, saveTimer = 0;
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const menuItems = ["Resume", "Change Game", "Reset Game", "Export Save", "Import Save", "Reset Save", "Controls", "Credits"];

function setStatus(text, on = true) { els.status.textContent = text; els.led.classList.toggle("on", on); }
function showOnly(target) {
  for (const view of [els.library, els.loading, els.menu, els.credits, els.error]) view.hidden = view !== target;
  els.canvas.hidden = target !== null;
}
function setMode(next) { mode = next; }

async function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore("saves");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function dbAction(kind, key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("saves", kind === "get" ? "readonly" : "readwrite");
    const store = tx.objectStore("saves");
    const request = kind === "get" ? store.get(key) : kind === "delete" ? store.delete(key) : store.put(value, key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
async function readSave(game) {
  try { const value = await dbAction("get", game.saveKey); return value ? new Uint8Array(value) : null; }
  catch (error) { console.warn("Save read failed", error); return null; }
}
async function writeSave() {
  if (!emulator || !currentGame || !emulator.extRamUpdated) return;
  try {
    const bytes = emulator.getExtRam();
    if (bytes.byteLength) await dbAction("put", currentGame.saveKey, bytes.buffer.slice(0));
    emulator.extRamUpdated = false;
  } catch (error) { console.warn("Save write failed", error); }
}

function heapView(module, ptr, size) { return new Uint8Array(module.HEAP8.buffer, ptr, size); }

class Emulator {
  constructor(module, rom, extRam) {
    this.module = module;
    this.romPtr = module._malloc(rom.byteLength);
    heapView(module, this.romPtr, rom.byteLength).set(new Uint8Array(rom));
    this.e = module._emulator_new_simple(this.romPtr, rom.byteLength, audioContext.sampleRate, AUDIO_FRAMES);
    if (!this.e) throw new Error("The ROM was not recognized by the emulator.");
    this.audio = new GameAudio(module, this.e);
    this.video = new Video(module, this.e, els.canvas);
    this.joyPtr = module._joypad_new();
    module._emulator_set_default_joypad_callback(this.e, this.joyPtr);
    this.lastSec = 0; this.leftover = 0; this.raf = null; this.extRamUpdated = false;
    if (extRam) this.loadExtRam(extRam);
  }
  setButton(name, pressed) {
    const method = { up:"_set_joyp_up",down:"_set_joyp_down",left:"_set_joyp_left",right:"_set_joyp_right",a:"_set_joyp_A",b:"_set_joyp_B",start:"_set_joyp_start",select:"_set_joyp_select" }[name];
    if (method) this.module[method](this.e, pressed);
  }
  withFileData(callback) {
    const ptr = this.module._ext_ram_file_data_new(this.e);
    const view = heapView(this.module, this.module._get_file_data_ptr(ptr), this.module._get_file_data_size(ptr));
    const result = callback(ptr, view); this.module._file_data_delete(ptr); return result;
  }
  loadExtRam(bytes) { this.withFileData((ptr, view) => { if (view.byteLength === bytes.byteLength) { view.set(bytes); this.module._emulator_read_ext_ram(this.e, ptr); } }); }
  getExtRam() {
    const ptr = this.module._ext_ram_file_data_new(this.e);
    const view = heapView(this.module, this.module._get_file_data_ptr(ptr), this.module._get_file_data_size(ptr));
    this.module._emulator_write_ext_ram(this.e, ptr); const copy = new Uint8Array(view); this.module._file_data_delete(ptr); return copy;
  }
  run() { if (this.raf === null) this.raf = requestAnimationFrame((t) => this.frame(t)); }
  pause() { if (this.raf !== null) cancelAnimationFrame(this.raf); this.raf = null; this.audio.pause(); }
  resume() { if (this.raf !== null) return; this.lastSec = 0; this.leftover = 0; this.audio.reset(); this.audio.resume(); this.run(); }
  frame(ms) {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const sec = ms / 1000, delta = Math.max(sec - (this.lastSec || sec), 0);
    const start = this.module._emulator_get_ticks_f64(this.e), until = start + Math.min(delta, MAX_UPDATE) * CPU_HZ - this.leftover;
    while (true) {
      const event = this.module._emulator_run_until_f64(this.e, until);
      if (event & EVENT_FRAME) this.video.upload();
      if (event & EVENT_AUDIO) this.audio.push();
      if (event & EVENT_TICKS) break;
    }
    this.leftover = (this.module._emulator_get_ticks_f64(this.e) - until) | 0; this.lastSec = sec;
    if (this.module._emulator_was_ext_ram_updated(this.e)) this.extRamUpdated = true;
    this.video.render();
  }
  destroy() { this.pause(); this.module._joypad_delete(this.joyPtr); this.module._emulator_delete(this.e); this.module._free(this.romPtr); }
}

class GameAudio {
  constructor(module, e) { this.buffer = heapView(module, module._get_audio_buffer_ptr(e), module._get_audio_buffer_capacity(e)); this.start = 0; }
  reset() { this.start = 0; }
  pause() { audioContext.suspend(); }
  resume() { if (startedByPlayer) audioContext.resume(); }
  push() {
    if (muted || volume <= 0 || audioContext.state !== "running") return;
    const now = audioContext.currentTime, latency = now + AUDIO_LATENCY; this.start ||= latency; if (this.start < now) this.start = latency;
    const out = audioContext.createBuffer(2, AUDIO_FRAMES, audioContext.sampleRate), left = out.getChannelData(0), right = out.getChannelData(1);
    for (let i=0;i<AUDIO_FRAMES;i++){left[i]=this.buffer[i*2]*volume/255;right[i]=this.buffer[i*2+1]*volume/255;}
    const source = audioContext.createBufferSource(); source.buffer = out; source.connect(audioContext.destination); source.start(this.start); this.start += AUDIO_FRAMES/audioContext.sampleRate;
  }
}

class Video {
  constructor(module,e,canvas){this.buffer=heapView(module,module._get_frame_buffer_ptr(e),module._get_frame_buffer_size(e));try{this.renderer=new GLRenderer(canvas)}catch(error){console.warn("WebGL fallback",error);this.renderer=new CanvasRenderer(canvas)}}
  upload(){this.renderer.upload(this.buffer)} render(){this.renderer.render()}
}
class CanvasRenderer {
  constructor(canvas){this.ctx=canvas.getContext("2d");this.ctx.imageSmoothingEnabled=false;this.data=this.ctx.createImageData(W,H)}
  upload(bytes){this.data.data.set(bytes)} render(){this.ctx.putImageData(this.data,0,0)}
}
class GLRenderer {
  constructor(canvas){const gl=canvas.getContext("webgl",{antialias:false,preserveDrawingBuffer:true});if(!gl)throw Error("No WebGL");this.gl=gl;const verts=new Float32Array([-1,-1,0,H/256,1,-1,W/256,H/256,-1,1,0,0,1,1,W/256,0]);const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,verts,gl.STATIC_DRAW);this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,256,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s};const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,"attribute vec2 p;attribute vec2 t;varying highp vec2 v;void main(){gl_Position=vec4(p,0.,1.);v=t;}"));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,"varying highp vec2 v;uniform sampler2D s;void main(){gl_FragColor=texture2D(s,v);}"));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);const p=gl.getAttribLocation(program,"p"),t=gl.getAttribLocation(program,"t");gl.enableVertexAttribArray(p);gl.enableVertexAttribArray(t);gl.vertexAttribPointer(p,2,gl.FLOAT,false,16,0);gl.vertexAttribPointer(t,2,gl.FLOAT,false,16,8);gl.uniform1i(gl.getUniformLocation(program,"s"),0)}
  upload(bytes){this.gl.texSubImage2D(this.gl.TEXTURE_2D,0,0,0,W,H,this.gl.RGBA,this.gl.UNSIGNED_BYTE,bytes)} render(){this.gl.drawArrays(this.gl.TRIANGLE_STRIP,0,4)}
}

function renderLibrary(){els.list.replaceChildren(...manifest.games.map((game,i)=>{const b=document.createElement("button");b.className=`game-item${i===selected?" selected":""}`;b.type="button";b.role="option";b.ariaSelected=String(i===selected);b.innerHTML=`<span>${game.title}</span><small>${game.system.toUpperCase()}</small>`;b.onclick=()=>{selected=i;renderLibrary();launchSelected()};return b}))}
function renderMenu(){els.menuGame.textContent=currentGame?.title||"";els.menuList.replaceChildren(...menuItems.map((label,i)=>{const b=document.createElement("button");b.className=`menu-item${i===menuSelected?" selected":""}`;b.type="button";b.textContent=label;b.onclick=()=>{menuSelected=i;chooseMenu()};return b}))}
function move(delta){const length=mode==="menu"?menuItems.length:manifest.games.length;if(!length)return;if(mode==="library"){selected=(selected+delta+length)%length;renderLibrary()}else if(mode==="menu"){menuSelected=(menuSelected+delta+length)%length;renderMenu()}}

function loadScript(src){return new Promise((resolve,reject)=>{const old=document.querySelector(`script[data-rom="${src}"]`);if(old)return resolve();const script=document.createElement("script");script.src=src;script.dataset.rom=src;script.onload=resolve;script.onerror=()=>reject(Error("ROM download failed"));document.head.append(script)})}
function decodeBase64(value){const binary=atob(value),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes}
async function checksum(bytes){const hash=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,"0")).join("")}

async function launchSelected(reset=false){
  const game=manifest.games[selected]; if(!game)return;
  startedByPlayer=true; try{await audioContext.resume()}catch(error){console.warn(error)}
  setMode("loading");showOnly(els.loading);setStatus("LOADING");els.loadingTitle.textContent=game.title.toUpperCase();els.loadingLabel.textContent="ROM · 0%";els.progress.style.width="0";
  try{
    await writeSave(); if(emulator){emulator.destroy();emulator=null}
    await loadScript(game.rom);els.progress.style.width="70%";els.loadingLabel.textContent="ROM · 70%";
    const encoded=window[game.romGlobal];if(!encoded)throw Error("ROM payload is missing");const bytes=decodeBase64(encoded);
    const actual=await checksum(bytes);if(`sha256:${actual}`!==game.checksum)throw Error("ROM integrity check failed");
    els.progress.style.width="100%";els.loadingLabel.textContent="INITIALIZING…";
    modulePromise ||= window.Binjgb({locateFile:(file)=>`emulator/${file}`});const module=await modulePromise;
    currentGame=game;const save=reset?null:await readSave(game);emulator=new Emulator(module,bytes.buffer,save);emulator.run();
    showOnly(null);setMode("game");setStatus(game.title.toUpperCase());els.canvas.focus({preventScroll:true});
  }catch(error){console.error(error);els.errorMessage.textContent=error.message||"The game could not start.";showOnly(els.error);setMode("error");setStatus("ERROR",false)}
}

async function returnLibrary(){await writeSave();if(emulator){emulator.destroy();emulator=null}currentGame=null;showOnly(els.library);setMode("library");setStatus("LIBRARY");renderLibrary()}
function openMenu(){if(!emulator)return;emulator.pause();writeSave();menuSelected=0;renderMenu();showOnly(els.menu);setMode("menu");setStatus("PAUSED")}
function resumeGame(){showOnly(null);setMode("game");emulator?.resume();setStatus(currentGame.title.toUpperCase());els.canvas.focus({preventScroll:true})}
function showCredits(type="credits"){
  const controls=`<div class="credit"><b>KEYBOARD</b>Arrows · move<br>Z · A &nbsp; X · B<br>Enter · Start &nbsp; Shift · Select<br>Escape · Pocket menu</div><div class="credit"><b>GAMEPAD / TOUCH</b>D-pad or left stick · move<br>Primary/secondary face buttons · A/B<br>Start and Back · Start/Select<br>All shell controls are tappable.</div>`;
  const games=manifest.games.map(g=>`<div class="credit"><b>${g.title}</b>${g.creator}<br>${g.license}<br><a href="${g.source}" target="_blank" rel="noopener">Official source</a></div>`).join("");
  els.creditsList.innerHTML=type==="controls"?controls:`${games}<div class="credit"><b>EMULATOR</b>binjgb v0.1.11 by Ben Smith · MIT<br><a href="https://github.com/binji/binjgb/tree/v0.1.11" target="_blank" rel="noopener">Official source</a><br><a href="licenses/index.html" target="_blank">Full license record</a></div>`;
  els.credits.querySelector("b").textContent=type==="controls"?"CONTROLS":"CREDITS / LICENSES";showOnly(els.credits);setMode("credits")
}
async function chooseMenu(){
  const action=menuItems[menuSelected];
  if(action==="Resume")resumeGame();else if(action==="Change Game")await returnLibrary();else if(action==="Reset Game")await launchSelected(true);else if(action==="Credits")showCredits();else if(action==="Controls")showCredits("controls");
  else if(action==="Export Save"){const bytes=await readSave(currentGame);if(!bytes?.byteLength){alert("No cartridge save exists for this game yet.");return}const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([bytes],{type:"application/octet-stream"}));a.download=`${currentGame.id}.sav`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  else if(action==="Import Save"){const input=document.createElement("input");input.type="file";input.accept=".sav,application/octet-stream";input.onchange=async()=>{if(!input.files[0])return;await dbAction("put",currentGame.saveKey,await input.files[0].arrayBuffer());await launchSelected()};input.click()}
  else if(action==="Reset Save"){if(confirm(`Delete the local save for ${currentGame.title}?`)){await dbAction("delete",currentGame.saveKey);await launchSelected(true)}}
}

function uiPress(name){
  if(mode==="library"){if(name==="up")move(-1);else if(name==="down")move(1);else if(name==="a"||name==="start")launchSelected()}
  else if(mode==="menu"){if(name==="up")move(-1);else if(name==="down")move(1);else if(name==="a"||name==="start")chooseMenu();else if(name==="b")resumeGame()}
  else if(mode==="credits"&&(name==="b"||name==="a")){renderMenu();showOnly(els.menu);setMode("menu")}
}
function control(name,pressed){if(mode==="game")emulator?.setButton(name,pressed);else if(pressed)uiPress(name)}

document.addEventListener("keydown",(event)=>{
  if(event.repeat)return;const map={ArrowUp:"up",ArrowDown:"down",ArrowLeft:"left",ArrowRight:"right",KeyZ:"a",KeyX:"b",Enter:"start",ShiftLeft:"select",ShiftRight:"select"};
  if(event.code==="Escape"){event.preventDefault();if(mode==="game")openMenu();else if(mode==="menu")resumeGame();else if(mode==="credits"){renderMenu();showOnly(els.menu);setMode("menu")}else if(mode==="error")returnLibrary();return}
  if(map[event.code]){event.preventDefault();control(map[event.code],true)}
},{passive:false});
document.addEventListener("keyup",(event)=>{const map={ArrowUp:"up",ArrowDown:"down",ArrowLeft:"left",ArrowRight:"right",KeyZ:"a",KeyX:"b",Enter:"start",ShiftLeft:"select",ShiftRight:"select"};if(map[event.code]){event.preventDefault();control(map[event.code],false)}},{passive:false});
for(const button of document.querySelectorAll("[data-control]")){const name=button.dataset.control;const update=(pressed,event)=>{event.preventDefault();button.classList.toggle("active",pressed);control(name,pressed)};button.addEventListener("pointerdown",e=>{button.setPointerCapture?.(e.pointerId);update(true,e)});button.addEventListener("pointerup",e=>update(false,e));button.addEventListener("pointercancel",e=>update(false,e));button.addEventListener("contextmenu",e=>e.preventDefault())}

function startGamepad(){
  const poll=()=>{const pad=[...(navigator.getGamepads?.()||[])].find(Boolean);if(pad){const pressed=i=>Boolean(pad.buttons[i]?.pressed),state={up:pressed(12)||pad.axes[1]<-.45,down:pressed(13)||pad.axes[1]>.45,left:pressed(14)||pad.axes[0]<-.45,right:pressed(15)||pad.axes[0]>.45,a:pressed(0),b:pressed(1),select:pressed(8),start:pressed(9)};for(const [name,value] of Object.entries(state))if(previousPad[name]!==value)control(name,value);previousPad=state}gamepadRaf=requestAnimationFrame(poll)};gamepadRaf=requestAnimationFrame(poll)
}

$("#pocket-menu").onclick=()=>mode==="game"?openMenu():mode==="menu"?resumeGame():null;
els.mute.onclick=()=>{muted=!muted;els.mute.textContent=muted?"×)) MUTED":"◖)) SOUND";if(!muted)audioContext.resume()};
$("#shell-fullscreen").onclick=async()=>{try{document.fullscreenElement?await document.exitFullscreen():await els.pocket.requestFullscreen()}catch(error){console.warn(error)}};
$("#screen-fullscreen").onclick=async()=>{try{document.fullscreenElement?await document.exitFullscreen():await els.bezel.requestFullscreen()}catch(error){console.warn(error)}};
$("#error-back").onclick=returnLibrary;els.soundGate.onclick=()=>{startedByPlayer=true;audioContext.resume();els.soundGate.hidden=true;emulator?.resume()};
window.addEventListener("beforeunload",()=>{writeSave()});document.addEventListener("visibilitychange",()=>{if(document.hidden)writeSave()});saveTimer=setInterval(writeSave,1000);

(async()=>{try{const response=await fetch("games.json",{cache:"no-cache"});if(!response.ok)throw Error("Game library could not be loaded");manifest=await response.json();renderLibrary();showOnly(els.library);setStatus("LIBRARY");startGamepad()}catch(error){els.errorMessage.textContent=error.message;showOnly(els.error);setMode("error");setStatus("ERROR",false)}})();
