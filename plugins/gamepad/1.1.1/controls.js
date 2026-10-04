/**
 * controls — remappable inputs on top of the gamepad plugin.
 *
 *   import { createControls } from "https://plugins.game.bigbools.fi/gamepad/v1/index.js";
 *
 *   const controls = createControls({
 *     id: "space-taxi",
 *     inputs: [
 *       { id: "left",  label: { fi: "Vasen", en: "Left" }, type: "simulated",
 *         keys: ["ArrowLeft", "KeyA"], pad: ["LS-Left", "Left"] },
 *       { id: "gear",  label: { fi: "Teline", en: "Gear" }, type: "digital",
 *         keys: ["Space"], pad: ["A", "LT", "RT"] },
 *     ],
 *     presets: [
 *       { id: "arrows", device: "keys", label: "Nuolet", bind: { left: ["ArrowLeft"], gear: ["ShiftRight"] } },
 *     ],
 *   });
 *
 *   function frame(dt) {
 *     controls.poll(dt);
 *     if (controls.pressed("gear")) toggleGear();
 *     const v = controls.vector("left", "right", "up", "down");
 *   }
 *
 *   controls.open();   // the mapping window, fetched on first use
 *
 * A game names what it needs; the player decides what presses it. Each input
 * has a type:
 *
 *   digital    on or off. An analogue source counts once it is past half way.
 *   analog     0…1, straight from the source. A key or button gives 0 or 1.
 *   simulated  0…1, and a key or button ramps towards its value with inertia
 *              (`inertia: { rise, fall }`, seconds from 0 to 1 and back).
 *              An analogue source still passes straight through.
 *
 * Bindings live in profiles, one set for the keyboard and one for the
 * controller. The game's defaults and presets are read-only; the player's own
 * profiles are kept in localStorage, which is per game because every game has
 * its own origin. Nothing here throws, the same rule the rest of the plugin
 * follows: a blocked storage simply means the choices last until reload.
 */
import { createGamepad, BUTTONS } from "./index.js";

/** Stick halves are sources of their own, so a stick can drive any input. */
export const STICK_SOURCES = [
  "LS-Up", "LS-Down", "LS-Left", "LS-Right",
  "RS-Up", "RS-Down", "RS-Left", "RS-Right",
];

/**
 * Every controller source the mapping can offer. Guide is left out: browsers
 * and operating systems take it for themselves often enough that a binding on
 * it would be a trap.
 */
export function padSources() {
  return [...BUTTONS.filter((b) => b !== "Guide"), ...STICK_SOURCES];
}

const ANALOG_SOURCES = new Set(["LT", "RT", ...STICK_SOURCES]);
export const isAnalogSource = (src) => ANALOG_SOURCES.has(src);

let padSet = null;
/** "pad" for a controller source, "keys" for anything else (a key code). */
export function deviceOf(src) {
  padSet ??= new Set([...BUTTONS, ...STICK_SOURCES]);
  return padSet.has(src) ? "pad" : "keys";
}

export const DEVICES = ["keys", "pad"];
const TYPES = new Set(["digital", "analog", "simulated"]);
const INERTIA = { rise: 0.18, fall: 0.12 };
// Past this a source is "down". Half way, so a stick needs a deliberate push.
const ON = 0.5;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const uniq = (list) => [...new Set(list)];

/** Picks a language out of `"text"` or `{ fi, en }`. */
export function textOf(label, lang) {
  if (label == null) return "";
  if (typeof label === "string") return label;
  return label[lang] ?? label.en ?? label.fi ?? Object.values(label)[0] ?? "";
}

function safeStorage(given) {
  if (given !== undefined) return given;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Deep enough copy of a binding map: { inputId: [sources] }. */
const cloneBind = (bind) => Object.fromEntries(
  Object.entries(bind ?? {}).map(([k, v]) => [k, [...v]]),
);

export function createControls(options = {}) {
  const opt = {
    id: "default",
    inputs: [],
    presets: [],
    lang: "fi",
    pad: null,
    gamepad: null,
    storage: undefined,
    keys: true,
    onChange: null,
    ...options,
  };

  const inputs = [];
  for (const raw of opt.inputs ?? []) {
    if (!raw || typeof raw.id !== "string") continue;
    inputs.push({
      id: raw.id,
      label: raw.label ?? raw.id,
      type: TYPES.has(raw.type) ? raw.type : "digital",
      inertia: { ...INERTIA, ...(raw.inertia ?? {}) },
      keys: uniq((raw.keys ?? []).filter((s) => deviceOf(s) === "keys")),
      pad: uniq((raw.pad ?? []).filter((s) => deviceOf(s) === "pad")),
    });
  }
  const byId = new Map(inputs.map((i) => [i.id, i]));

  const owned = !opt.pad;
  const pad = opt.pad ?? createGamepad({ keys: false, ...(opt.gamepad ?? {}) });
  const storage = safeStorage(opt.storage);
  const storeKey = `gamepad-controls:${opt.id}`;
  let lang = opt.lang;

  // --- profiles -------------------------------------------------------------

  /**
   * Strips a binding map down to what this device and this game can use, and
   * enforces the one rule the mapping window keeps: a source belongs to one
   * input. The first input listed keeps a source that two of them claim.
   */
  function normalise(bind, device) {
    const out = {};
    const used = new Set();
    for (const input of inputs) {
      const list = [];
      for (const src of bind?.[input.id] ?? []) {
        if (typeof src !== "string" || deviceOf(src) !== device || used.has(src)) continue;
        used.add(src);
        list.push(src);
      }
      out[input.id] = list;
    }
    return out;
  }

  const defaults = {};
  for (const device of DEVICES) {
    defaults[device] = {
      id: `default-${device}`,
      device,
      label: { fi: "Oletus", en: "Default" },
      preset: true,
      bind: normalise(Object.fromEntries(inputs.map((i) => [i.id, i[device]])), device),
    };
  }

  const presets = [defaults.keys, defaults.pad];
  for (const p of opt.presets ?? []) {
    if (!p || !DEVICES.includes(p.device) || typeof p.id !== "string") continue;
    presets.push({
      id: p.id,
      device: p.device,
      label: p.label ?? p.id,
      preset: true,
      bind: normalise(fillMissing(p.bind, p.device), p.device),
    });
  }

  /**
   * An input the profile does not mention gets its default sources, as long as
   * nothing in the profile already uses them. This is what keeps a player's
   * saved profile working after the game adds an input.
   */
  function fillMissing(bind, device) {
    const out = cloneBind(bind);
    const used = new Set(Object.values(out).flat());
    for (const input of inputs) {
      if (Array.isArray(out[input.id])) continue;
      out[input.id] = defaults[device].bind[input.id].filter((s) => !used.has(s));
      for (const s of out[input.id]) used.add(s);
    }
    return out;
  }

  let custom = [];
  const active = { keys: defaults.keys.id, pad: defaults.pad.id };

  function load() {
    if (!storage) return;
    let data = null;
    try {
      data = JSON.parse(storage.getItem(storeKey) ?? "null");
    } catch {
      data = null;
    }
    if (!data || typeof data !== "object") return;
    custom = [];
    for (const c of Array.isArray(data.custom) ? data.custom : []) {
      if (!c || !DEVICES.includes(c.device) || typeof c.id !== "string") continue;
      custom.push({
        id: c.id,
        device: c.device,
        label: typeof c.label === "string" ? c.label : c.id,
        preset: false,
        bind: normalise(fillMissing(c.bind, c.device), c.device),
      });
    }
    for (const device of DEVICES) {
      const want = data.active?.[device];
      if (profiles(device).some((p) => p.id === want)) active[device] = want;
    }
  }

  function persist() {
    if (!storage) return false;
    try {
      storage.setItem(storeKey, JSON.stringify({
        v: 1,
        active,
        custom: custom.map(({ id, device, label, bind }) => ({ id, device, label, bind })),
      }));
      return true;
    } catch {
      return false;
    }
  }

  const profiles = (device) => [...presets, ...custom].filter((p) => p.device === device);
  const profile = (id) => [...presets, ...custom].find((p) => p.id === id) ?? null;
  const activeProfile = (device) => profile(active[device]) ?? defaults[device];

  function changed() {
    try {
      opt.onChange?.(api);
    } catch {
      /* The game's callback is not ours to break on. */
    }
  }

  function select(id) {
    const p = profile(id);
    if (!p) return false;
    active[p.device] = p.id;
    persist();
    changed();
    return true;
  }

  /** "Oma 1", "Oma 2"… the first number not yet taken on this device. */
  function nextName(device) {
    const base = lang === "fi" ? "Oma" : "Custom";
    const taken = new Set(profiles(device).map((p) => textOf(p.label, lang)));
    for (let n = 1; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }

  function addCustom(device, bind, label) {
    let n = custom.length + 1;
    while (profile(`c${n}`)) n++;
    const p = {
      id: `c${n}`,
      device,
      label: (label ?? "").trim() || nextName(device),
      preset: false,
      bind: normalise(bind, device),
    };
    custom.push(p);
    active[device] = p.id;
    persist();
    changed();
    return p;
  }

  function rename(id, label) {
    const p = custom.find((c) => c.id === id);
    const text = String(label ?? "").trim();
    if (!p || !text) return false;
    p.label = text;
    persist();
    changed();
    return true;
  }

  function remove(id) {
    const at = custom.findIndex((c) => c.id === id);
    if (at < 0) return false;
    const [gone] = custom.splice(at, 1);
    if (active[gone.device] === gone.id) active[gone.device] = defaults[gone.device].id;
    persist();
    changed();
    return true;
  }

  // --- the editor -----------------------------------------------------------

  /**
   * A working copy of one device's active profile. Nothing it does reaches the
   * game until `save()`: the player can try a binding, undo it, or throw the
   * whole lot away. A preset cannot be overwritten, so saving one makes a new
   * profile of the player's own.
   */
  function edit(device) {
    const base = activeProfile(device);
    let bind = cloneBind(base.bind);
    const undoStack = [];

    const owner = (src) => inputs.find((i) => bind[i.id]?.includes(src))?.id ?? null;

    const ed = {
      device,
      get profile() { return base; },
      get bind() { return bind; },
      get canUndo() { return undoStack.length > 0; },
      get dirty() { return JSON.stringify(bind) !== JSON.stringify(base.bind); },
      sourcesOf: (id) => [...(bind[id] ?? [])],
      owner,
      /**
       * Binds `src` to `id`. A source belongs to one input, so wherever it was
       * before it is taken away from — and the answer says where, so the
       * window can tell the player. `{ added: false }` when there was nothing
       * to do.
       */
      add(id, src) {
        if (!byId.has(id) || deviceOf(src) !== device) return { added: false, from: null };
        const from = owner(src);
        if (from === id) return { added: false, from: null };
        undoStack.push(cloneBind(bind));
        if (from) bind[from] = bind[from].filter((s) => s !== src);
        bind[id] = [...(bind[id] ?? []), src];
        return { added: true, from };
      },
      remove(id, src) {
        if (!bind[id]?.includes(src)) return false;
        undoStack.push(cloneBind(bind));
        bind[id] = bind[id].filter((s) => s !== src);
        return true;
      },
      /** Empties a source wherever it is bound. */
      clear(src) {
        const from = owner(src);
        return from ? ed.remove(from, src) : false;
      },
      undo() {
        if (!undoStack.length) return false;
        bind = undoStack.pop();
        return true;
      },
      discard() {
        if (!ed.dirty && !undoStack.length) return false;
        undoStack.length = 0;
        bind = cloneBind(base.bind);
        return true;
      },
      /**
       * Saves into the profile being edited, or into a new one when that is a
       * preset or `asNew` is set. Returns the profile written.
       */
      save({ asNew = false, label } = {}) {
        let target;
        if (base.preset || asNew) {
          target = addCustom(device, bind, label);
        } else {
          base.bind = normalise(bind, device);
          active[device] = base.id;
          persist();
          changed();
          target = base;
        }
        undoStack.length = 0;
        return target;
      },
    };
    return ed;
  }

  // --- reading --------------------------------------------------------------

  const keysDown = new Set();
  let lastPoll = 0;
  let lastTime = -1;
  const state = new Map(inputs.map((i) => [i.id, { value: 0, sim: 0, on: false, was: false }]));
  // While the mapping window is open, and after it closes until each input is
  // let go: the press that picked a binding must not also fire the game.
  let muted = false;
  const latched = new Set();

  /** Live reading of one source, 0…1, whatever any binding says. */
  function sourceValue(src) {
    if (deviceOf(src) === "keys") return keysDown.has(src) ? 1 : 0;
    switch (src) {
      case "LS-Left": return Math.max(0, -pad.lx);
      case "LS-Right": return Math.max(0, pad.lx);
      case "LS-Up": return Math.max(0, -pad.ly);
      case "LS-Down": return Math.max(0, pad.ly);
      case "RS-Left": return Math.max(0, -pad.rx);
      case "RS-Right": return Math.max(0, pad.rx);
      case "RS-Up": return Math.max(0, -pad.ry);
      case "RS-Down": return Math.max(0, pad.ry);
      default: return clamp(pad.value(src), 0, 1);
    }
  }

  /** What `input` reads from `sources` this instant, before any inertia. */
  function readRaw(sources) {
    let analog = 0;
    let digital = 0;
    for (const src of sources) {
      const v = sourceValue(src);
      if (isAnalogSource(src)) analog = Math.max(analog, v);
      else digital = Math.max(digital, v >= ON ? 1 : 0);
    }
    return { analog, digital };
  }

  const boundTo = (id) => [
    ...(activeProfile("keys").bind[id] ?? []),
    ...(activeProfile("pad").bind[id] ?? []),
  ];

  /**
   * Reads every input and advances the frame. Once per frame, before anything
   * asks, for the same reason as `pad.poll()`. A pad handed in through `pad`
   * belongs to the game and is polled by it; this only reads it.
   */
  function poll(dt) {
    const now = typeof performance !== "undefined" ? performance.now() / 1000 : 0;
    if (dt === undefined) dt = lastTime < 0 ? 0 : now - lastTime;
    lastTime = now;
    dt = clamp(Number(dt) || 0, 0, 0.1);
    if (owned) pad.poll();
    lastPoll = now;

    for (const input of inputs) {
      const s = state.get(input.id);
      s.was = s.on;
      const { analog, digital } = readRaw(boundTo(input.id));
      if (muted || latched.has(input.id)) {
        if (!muted && analog < 0.1 && digital === 0) latched.delete(input.id);
        s.value = 0;
        s.sim = 0;
        s.on = false;
        continue;
      }
      if (input.type === "digital") {
        s.value = analog >= ON || digital ? 1 : 0;
      } else if (input.type === "analog") {
        s.value = Math.max(analog, digital);
      } else {
        const rate = digital > s.sim ? 1 / Math.max(input.inertia.rise, 1e-3)
          : 1 / Math.max(input.inertia.fall, 1e-3);
        s.sim += clamp(digital - s.sim, -dt * rate, dt * rate);
        s.value = Math.max(analog, s.sim);
      }
      s.on = s.value >= ON;
    }
    return api;
  }

  const held = (id) => state.get(id)?.on ?? false;
  const pressed = (id) => { const s = state.get(id); return !!s && s.on && !s.was; };
  const released = (id) => { const s = state.get(id); return !!s && !s.on && s.was; };
  const value = (id) => state.get(id)?.value ?? 0;

  /** Four inputs as one vector, never longer than 1 — the joystick promise. */
  function vector(left, right, up, down) {
    let x = value(right) - value(left);
    let y = value(down) - value(up);
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  /** Stops the inputs reading anything. The window does this while it is up. */
  function mute(on) {
    if (on) {
      muted = true;
      return;
    }
    muted = false;
    for (const input of inputs) latched.add(input.id);
  }

  /**
   * The window keeps its own frame, and a paused game may stop polling. When
   * nobody has polled lately and the pad is ours, poll it here so the window
   * still sees the controller.
   */
  function sample() {
    const now = typeof performance !== "undefined" ? performance.now() / 1000 : 0;
    if (owned && now - lastPoll > 0.05) {
      pad.poll();
      lastPoll = now;
    }
  }

  // --- keyboard -------------------------------------------------------------

  const typing = (e) => {
    const t = e.target;
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  };
  function onKeyDown(e) {
    if (!typing(e)) keysDown.add(e.code);
  }
  function onKeyUp(e) {
    keysDown.delete(e.code);
  }
  function onBlur() {
    keysDown.clear();
  }

  if (typeof window !== "undefined") {
    if (opt.keys) {
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
    }
    window.addEventListener("blur", onBlur);
  }

  // --- the window -----------------------------------------------------------

  let ui = null;
  let loading = null;

  function open(openOpts = {}) {
    if (ui) return Promise.resolve(true);
    if (loading) return loading;
    loading = import("./ui.js")
      .then((m) => {
        loading = null;
        if (ui) return true;
        mute(true);
        ui = m.createMapper(api, {
          ...openOpts,
          onClose: () => {
            ui = null;
            mute(false);
            try {
              openOpts.onClose?.();
            } catch {
              /* not ours */
            }
          },
        });
        return true;
      })
      .catch(() => {
        loading = null;
        mute(false);
        return false;
      });
    return loading;
  }

  function close() {
    ui?.close();
  }

  function destroy() {
    close();
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    }
    if (owned) pad.destroy();
  }

  const api = {
    pad,
    inputs,
    poll,
    held,
    pressed,
    released,
    value,
    vector,
    open,
    close,
    isOpen: () => !!ui || !!loading,
    destroy,
    get lang() { return lang; },
    setLang(l) { lang = l; ui?.render(); },
    label: (id) => textOf(byId.get(id)?.label ?? id, lang),
    profiles,
    activeProfile,
    select,
    rename,
    remove,
    edit,
    sourceValue,
    sample,
    mute,
    /** Sources bound to `id` right now, both devices. */
    sourcesOf: boundTo,
  };

  load();
  return api;
}
