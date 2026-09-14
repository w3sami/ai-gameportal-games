/* Tobu Tobu Girl Deluxe browser player
 * Emulator core: binjgb v0.1.11, Copyright (c) 2016-2020 Ben Smith, MIT.
 * Integration derived from binjgb's MIT-licensed simple browser example.
 */
"use strict";

const SCREEN_WIDTH = 160;
const SCREEN_HEIGHT = 144;
const AUDIO_FRAMES = 4096;
const AUDIO_LATENCY_SEC = 0.1;
const MAX_UPDATE_SEC = 5 / 60;
const CPU_TICKS_PER_SECOND = 4194304;
const EVENT_NEW_FRAME = 1;
const EVENT_AUDIO_BUFFER_FULL = 2;
const EVENT_UNTIL_TICKS = 4;
const SAVE_KEY = "tobudx.binjgb.extRam.v1";

const elements = {
  canvas: document.querySelector("#screen"),
  bezel: document.querySelector("#screen-bezel"),
  overlay: document.querySelector("#play-overlay"),
  loading: document.querySelector("#loading-panel"),
  error: document.querySelector("#error-panel"),
  errorMessage: document.querySelector("#error-message"),
  statusLight: document.querySelector("#status-light"),
  statusText: document.querySelector("#status-text"),
  power: document.querySelector("#power-light"),
  pause: document.querySelector("#pause-button"),
  restart: document.querySelector("#restart-button"),
  mute: document.querySelector("#mute-button"),
  muteIcon: document.querySelector("#mute-icon"),
  muteLabel: document.querySelector("#mute-label"),
  fullscreen: document.querySelector("#fullscreen-button"),
  volume: document.querySelector("#volume"),
  volumeOutput: document.querySelector("#volume-output"),
  controller: document.querySelector("#controller-status"),
  gamepadLabel: document.querySelector("#gamepad-label"),
};

let emulator = null;
let modulePromise = null;
let romBuffer = null;
let saveTimer = null;
let gamepadRaf = null;
let previousGamepadState = {};
let volume = 0.6;
let lastAudibleVolume = volume;
let startedByPlayer = false;

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function setStatus(text, type = "") {
  elements.statusText.textContent = text;
  elements.statusLight.className = `status-light ${type}`.trim();
}

function showError(error) {
  console.error(error);
  elements.loading.hidden = true;
  elements.overlay.hidden = true;
  elements.error.hidden = false;
  elements.errorMessage.textContent = error?.message || "Try reloading this page.";
  setStatus("Unable to start", "error");
}

function makeWasmBuffer(module, ptr, size) {
  return new Uint8Array(module.HEAP8.buffer, ptr, size);
}

function readSave() {
  try {
    const value = localStorage.getItem(SAVE_KEY);
    return value ? Uint8Array.from(JSON.parse(value)) : null;
  } catch (error) {
    console.warn("Could not read local save", error);
    return null;
  }
}

function writeSave() {
  if (!emulator || !emulator.extRamUpdated) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(Array.from(emulator.getExtRam())));
    emulator.extRamUpdated = false;
  } catch (error) {
    console.warn("Could not store local save", error);
  }
}

class Emulator {
  constructor(module, rom, extRam) {
    this.module = module;
    this.romDataPtr = module._malloc(rom.byteLength);
    makeWasmBuffer(module, this.romDataPtr, rom.byteLength).set(new Uint8Array(rom));
    this.e = module._emulator_new_simple(this.romDataPtr, rom.byteLength, audioContext.sampleRate, AUDIO_FRAMES);
    if (!this.e) throw new Error("The bundled ROM was not recognized by the emulator.");

    this.audio = new GameAudio(module, this.e);
    this.video = new Video(module, this.e, elements.canvas);
    this.joypadBufferPtr = module._joypad_new();
    module._emulator_set_default_joypad_callback(this.e, this.joypadBufferPtr);
    this.lastRafSec = 0;
    this.leftoverTicks = 0;
    this.rafToken = null;
    this.extRamUpdated = false;
    this.keyHandlers = this.createKeyHandlers();
    this.onKeyDown = (event) => this.handleKey(event, true);
    this.onKeyUp = (event) => this.handleKey(event, false);
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp, { passive: false });

    if (extRam) this.loadExtRam(extRam);
  }

  createKeyHandlers() {
    return {
      ArrowUp: (pressed) => this.setButton("up", pressed),
      ArrowDown: (pressed) => this.setButton("down", pressed),
      ArrowLeft: (pressed) => this.setButton("left", pressed),
      ArrowRight: (pressed) => this.setButton("right", pressed),
      KeyZ: (pressed) => this.setButton("a", pressed),
      KeyX: (pressed) => this.setButton("b", pressed),
      Enter: (pressed) => this.setButton("start", pressed),
      ShiftLeft: (pressed) => this.setButton("select", pressed),
      ShiftRight: (pressed) => this.setButton("select", pressed),
    };
  }

  handleKey(event, pressed) {
    const action = this.keyHandlers[event.code];
    if (!action) return;
    action(pressed);
    event.preventDefault();
  }

  setButton(button, pressed) {
    const method = {
      up: "_set_joyp_up",
      down: "_set_joyp_down",
      left: "_set_joyp_left",
      right: "_set_joyp_right",
      a: "_set_joyp_A",
      b: "_set_joyp_B",
      start: "_set_joyp_start",
      select: "_set_joyp_select",
    }[button];
    this.module[method](this.e, pressed);
  }

  withFileData(callback) {
    const ptr = this.module._ext_ram_file_data_new(this.e);
    const buffer = makeWasmBuffer(this.module, this.module._get_file_data_ptr(ptr), this.module._get_file_data_size(ptr));
    const result = callback(ptr, buffer);
    this.module._file_data_delete(ptr);
    return result;
  }

  loadExtRam(extRam) {
    this.withFileData((ptr, buffer) => {
      if (buffer.byteLength === extRam.byteLength) {
        buffer.set(extRam);
        this.module._emulator_read_ext_ram(this.e, ptr);
      }
    });
  }

  getExtRam() {
    return this.withFileData((ptr, buffer) => {
      this.module._emulator_write_ext_ram(this.e, ptr);
      return new Uint8Array(buffer);
    });
  }

  get isPaused() { return this.rafToken === null; }

  run() {
    if (this.rafToken === null) this.rafToken = requestAnimationFrame((time) => this.frame(time));
  }

  pause() {
    if (this.rafToken !== null) cancelAnimationFrame(this.rafToken);
    this.rafToken = null;
    this.audio.pause();
    writeSave();
  }

  resume() {
    if (!this.isPaused) return;
    this.lastRafSec = 0;
    this.leftoverTicks = 0;
    this.audio.reset();
    this.audio.resume();
    this.run();
  }

  frame(startMs) {
    this.rafToken = requestAnimationFrame((time) => this.frame(time));
    const startSec = startMs / 1000;
    const deltaSec = Math.max(startSec - (this.lastRafSec || startSec), 0);
    const startTicks = this.module._emulator_get_ticks_f64(this.e);
    const deltaTicks = Math.min(deltaSec, MAX_UPDATE_SEC) * CPU_TICKS_PER_SECOND;
    const runUntilTicks = startTicks + deltaTicks - this.leftoverTicks;

    while (true) {
      const event = this.module._emulator_run_until_f64(this.e, runUntilTicks);
      if (event & EVENT_NEW_FRAME) this.video.uploadTexture();
      if (event & EVENT_AUDIO_BUFFER_FULL) this.audio.pushBuffer();
      if (event & EVENT_UNTIL_TICKS) break;
    }

    this.leftoverTicks = (this.module._emulator_get_ticks_f64(this.e) - runUntilTicks) | 0;
    this.lastRafSec = startSec;
    if (this.module._emulator_was_ext_ram_updated(this.e)) this.extRamUpdated = true;
    this.video.renderTexture();
  }

  destroy() {
    this.pause();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.module._joypad_delete(this.joypadBufferPtr);
    this.module._emulator_delete(this.e);
    this.module._free(this.romDataPtr);
  }
}

class GameAudio {
  constructor(module, e) {
    this.buffer = makeWasmBuffer(module, module._get_audio_buffer_ptr(e), module._get_audio_buffer_capacity(e));
    this.startSec = 0;
  }

  reset() { this.startSec = 0; }
  pause() { audioContext.suspend(); }
  resume() { if (startedByPlayer) audioContext.resume(); }

  pushBuffer() {
    if (volume <= 0 || audioContext.state !== "running") return;
    const now = audioContext.currentTime;
    const latencyStart = now + AUDIO_LATENCY_SEC;
    this.startSec = this.startSec || latencyStart;
    if (this.startSec < now) this.startSec = latencyStart;

    const audioBuffer = audioContext.createBuffer(2, AUDIO_FRAMES, audioContext.sampleRate);
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    for (let i = 0; i < AUDIO_FRAMES; i += 1) {
      left[i] = this.buffer[i * 2] * volume / 255;
      right[i] = this.buffer[i * 2 + 1] * volume / 255;
    }
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start(this.startSec);
    this.startSec += AUDIO_FRAMES / audioContext.sampleRate;
  }
}

class Video {
  constructor(module, e, canvas) {
    this.module = module;
    this.buffer = makeWasmBuffer(module, module._get_frame_buffer_ptr(e), module._get_frame_buffer_size(e));
    try {
      this.renderer = new WebGLRenderer(canvas);
    } catch (error) {
      console.warn("WebGL unavailable; using Canvas 2D", error);
      this.renderer = new Canvas2DRenderer(canvas);
    }
  }
  uploadTexture() { this.renderer.uploadTexture(this.buffer); }
  renderTexture() { this.renderer.renderTexture(); }
}

class Canvas2DRenderer {
  constructor(canvas) {
    this.context = canvas.getContext("2d");
    this.context.imageSmoothingEnabled = false;
    this.imageData = this.context.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  }
  uploadTexture(buffer) { this.imageData.data.set(buffer); }
  renderTexture() { this.context.putImageData(this.imageData, 0, 0); }
}

class WebGLRenderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;
    const w = SCREEN_WIDTH / 256;
    const h = SCREEN_HEIGHT / 256;
    const vertices = new Float32Array([-1,-1,0,h, 1,-1,w,h, -1,1,0,0, 1,1,w,0]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, "attribute vec2 aPos; attribute vec2 aTexCoord; varying highp vec2 vTexCoord; void main(){ gl_Position=vec4(aPos,0.,1.); vTexCoord=aTexCoord; }");
    const fragment = compile(gl.FRAGMENT_SHADER, "varying highp vec2 vTexCoord; uniform sampler2D uSampler; void main(){ gl_FragColor=texture2D(uSampler,vTexCoord); }");
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, "aPos");
    const textureCoord = gl.getAttribLocation(program, "aTexCoord");
    gl.enableVertexAttribArray(position);
    gl.enableVertexAttribArray(textureCoord);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(textureCoord, 2, gl.FLOAT, false, 16, 8);
    gl.uniform1i(gl.getUniformLocation(program, "uSampler"), 0);
  }
  uploadTexture(buffer) {
    this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, this.gl.RGBA, this.gl.UNSIGNED_BYTE, buffer);
  }
  renderTexture() {
    this.gl.clearColor(0.02, 0.02, 0.05, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }
}

async function startGame() {
  try {
    elements.loading.hidden = false;
    elements.error.hidden = true;
    setStatus("Loading game…");
    modulePromise ||= window.Binjgb({ locateFile: (file) => `emulator/${file}` });
    const [module] = await Promise.all([modulePromise]);
    if (!romBuffer) {
      if (!window.TOBUDX_ROM_BASE64) throw new Error("The bundled ROM payload is missing.");
      const binary = atob(window.TOBUDX_ROM_BASE64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      romBuffer = bytes.buffer;
    }
    if (emulator) emulator.destroy();
    emulator = new Emulator(module, romBuffer, readSave());
    emulator.run();
    elements.loading.hidden = true;
    elements.power.classList.add("on");
    for (const control of [elements.pause, elements.restart, elements.mute, elements.volume]) control.disabled = false;
    elements.pause.querySelector("em").textContent = "Pause";
    elements.pause.querySelector("span").textContent = "Ⅱ";
    setStatus("Ready", "ready");
    startGamepadLoop();
  } catch (error) {
    showError(error);
  }
}

async function beginPlay() {
  startedByPlayer = true;
  try { await audioContext.resume(); } catch (error) { console.warn("Audio could not resume", error); }
  elements.overlay.hidden = true;
  if (!emulator) await startGame();
  else if (emulator.isPaused) emulator.resume();
  elements.canvas.focus({ preventScroll: true });
}

function setVolume(next) {
  volume = Math.max(0, Math.min(1, next));
  if (volume > 0) lastAudibleVolume = volume;
  elements.volume.value = String(Math.round(volume * 100));
  elements.volumeOutput.value = `${Math.round(volume * 100)}%`;
  elements.muteIcon.textContent = volume === 0 ? "×))" : "◖))";
  elements.muteLabel.textContent = volume === 0 ? "Unmute" : "Mute";
}

function bindTouchControls() {
  for (const button of document.querySelectorAll("[data-button]")) {
    const name = button.dataset.button;
    const update = (pressed, event) => {
      event.preventDefault();
      if (!startedByPlayer) beginPlay();
      emulator?.setButton(name, pressed);
      button.classList.toggle("active", pressed);
    };
    button.addEventListener("pointerdown", (event) => { button.setPointerCapture?.(event.pointerId); update(true, event); });
    button.addEventListener("pointerup", (event) => update(false, event));
    button.addEventListener("pointercancel", (event) => update(false, event));
    button.addEventListener("pointerleave", (event) => { if (event.buttons) update(false, event); });
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  }
}

function gamepadPressed(gamepad, index) { return Boolean(gamepad.buttons[index]?.pressed); }

function startGamepadLoop() {
  if (gamepadRaf) return;
  const poll = () => {
    const gamepad = [...(navigator.getGamepads?.() || [])].find(Boolean);
    elements.controller.classList.toggle("connected", Boolean(gamepad));
    elements.gamepadLabel.textContent = gamepad ? gamepad.id.replace(/\s*\([^)]*\)\s*$/, "") : "Connect a controller";
    if (gamepad && emulator) {
      const state = {
        up: gamepadPressed(gamepad, 12) || gamepad.axes[1] < -0.45,
        down: gamepadPressed(gamepad, 13) || gamepad.axes[1] > 0.45,
        left: gamepadPressed(gamepad, 14) || gamepad.axes[0] < -0.45,
        right: gamepadPressed(gamepad, 15) || gamepad.axes[0] > 0.45,
        a: gamepadPressed(gamepad, 0),
        b: gamepadPressed(gamepad, 1),
        select: gamepadPressed(gamepad, 8),
        start: gamepadPressed(gamepad, 9),
      };
      for (const [name, pressed] of Object.entries(state)) {
        if (previousGamepadState[name] !== pressed) emulator.setButton(name, pressed);
      }
      previousGamepadState = state;
    }
    gamepadRaf = requestAnimationFrame(poll);
  };
  gamepadRaf = requestAnimationFrame(poll);
}

elements.overlay.addEventListener("click", beginPlay);
elements.pause.addEventListener("click", () => {
  if (!emulator) return;
  if (emulator.isPaused) {
    emulator.resume();
    elements.pause.querySelector("em").textContent = "Pause";
    elements.pause.querySelector("span").textContent = "Ⅱ";
    setStatus("Ready", "ready");
  } else {
    emulator.pause();
    elements.pause.querySelector("em").textContent = "Resume";
    elements.pause.querySelector("span").textContent = "▶";
    setStatus("Paused");
  }
});
elements.restart.addEventListener("click", startGame);
elements.mute.addEventListener("click", () => setVolume(volume === 0 ? lastAudibleVolume || 0.6 : 0));
elements.volume.addEventListener("input", (event) => setVolume(Number(event.target.value) / 100));
elements.fullscreen.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await elements.bezel.requestFullscreen();
  } catch (error) { console.warn("Fullscreen unavailable", error); }
});
document.addEventListener("fullscreenchange", () => document.body.classList.toggle("is-fullscreen", Boolean(document.fullscreenElement)));
window.addEventListener("beforeunload", writeSave);
document.addEventListener("visibilitychange", () => { if (document.hidden) writeSave(); });
saveTimer = window.setInterval(writeSave, 1000);

bindTouchControls();
setVolume(volume);
startGame();
