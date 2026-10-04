/**
 * The mapping window for `createControls`. Fetched on the first `open()`, so a
 * game pays for none of this until the player asks for it.
 *
 * Mapping works both ways round:
 *   - click an action, then press the button or key that should do it;
 *   - click a button on the controller picture (or a key on the keyboard
 *     picture), then choose its action from a list.
 *
 * Everything happens on a working copy. Undo steps back one change, discard
 * drops them all, and the game sees nothing until Save. A preset is never
 * overwritten: saving one makes a profile of the player's own.
 *
 * The window drives itself from the controller too — d-pad or left stick
 * moves, A picks, B goes back — because the player who wants to remap a
 * controller is often holding one and nothing else.
 */
import { padSources, isAnalogSource, deviceOf, textOf } from "./controls.js";

const T = {
  fi: {
    title: "Ohjaimet",
    keys: "Näppäimistö",
    pad: "Ohjain",
    profile: "Profiili",
    preset: "esiasetus",
    newProfile: "+ Uusi",
    rename: "Nimeä",
    del: "Poista",
    sure: "Varmasti?",
    ok: "OK",
    undo: "Kumoa",
    discard: "Hylkää muutokset",
    save: "Tallenna",
    saveOwn: "Tallenna omaksi",
    saveNew: "Tallenna uutena",
    close: "Sulje",
    closeSure: "Hylkää ja sulje?",
    dirty: "Tallentamattomia muutoksia. Ne tulevat voimaan vasta kun tallennat.",
    clean: "Muutokset tulevat voimaan vasta kun tallennat.",
    locked: "Tallenna tai hylkää muutokset ennen kuin vaihdat profiilia.",
    listenPad: "Paina nappia…",
    listenKeys: "Paina näppäintä…",
    hintPad: "Klikkaa toimintoa ja paina ohjaimen nappia, tai klikkaa nappia kuvasta ja valitse sille toiminto.",
    hintKeys: "Klikkaa toimintoa ja paina näppäintä, tai klikkaa näppäintä ja valitse sille toiminto. Esc peruu.",
    moved: "{src} poistettiin toiminnosta {from}",
    bound: "{src} → {to}",
    savedAs: "Tallennettu profiiliksi {name}",
    saved: "Tallennettu",
    undone: "Kumottu",
    discarded: "Muutokset hylätty",
    pick: "{src}: valitse toiminto",
    clear: "Tyhjennä",
    cancel: "Peru",
    unbound: "ei nappia",
    noPad: "Ohjainta ei näy. Paina jotain sen nappia.",
    space: "Väli",
    removeSrc: "Poista {src}",
    "type.digital": "digitaalinen",
    "type.analog": "analoginen",
    "type.simulated": "simuloitu analogi",
  },
  en: {
    title: "Controls",
    keys: "Keyboard",
    pad: "Controller",
    profile: "Profile",
    preset: "preset",
    newProfile: "+ New",
    rename: "Rename",
    del: "Delete",
    sure: "Sure?",
    ok: "OK",
    undo: "Undo",
    discard: "Discard changes",
    save: "Save",
    saveOwn: "Save as own",
    saveNew: "Save as new",
    close: "Close",
    closeSure: "Discard and close?",
    dirty: "Unsaved changes. They apply once you save.",
    clean: "Changes apply once you save.",
    locked: "Save or discard your changes before switching profile.",
    listenPad: "Press a button…",
    listenKeys: "Press a key…",
    hintPad: "Click an action and press a controller button, or click a button in the picture and choose its action.",
    hintKeys: "Click an action and press a key, or click a key and choose its action. Esc cancels.",
    moved: "{src} was removed from {from}",
    bound: "{src} → {to}",
    savedAs: "Saved as profile {name}",
    saved: "Saved",
    undone: "Undone",
    discarded: "Changes discarded",
    pick: "{src}: choose an action",
    clear: "Clear",
    cancel: "Cancel",
    unbound: "unbound",
    noPad: "No controller visible. Press any of its buttons.",
    space: "Space",
    removeSrc: "Remove {src}",
    "type.digital": "digital",
    "type.analog": "analog",
    "type.simulated": "simulated analog",
  },
};

const COLORS = [
  "#6fe3ff", "#ffd479", "#ff8fa3", "#9dff8a", "#c9a2ff",
  "#ffb36b", "#7fb2ff", "#ff7ad9", "#5fe0b0", "#e0e070",
];

// Which side of the picture each label sits on, top to bottom in the order
// the buttons appear, so the leader lines cross as little as possible.
const LEFT = ["LT", "LB", "LS-Up", "LS-Left", "LS", "LS-Right", "LS-Down", "Back", "Up", "Left", "Right", "Down"];
const RIGHT = ["RT", "RB", "Y", "X", "B", "A", "Start", "RS-Up", "RS-Left", "RS", "RS-Right", "RS-Down"];

const KEY_ROWS = [
  [["Backquote", 1], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => [`Digit${d}`, 1]), ["Minus", 1], ["Equal", 1], ["Backspace", 2]],
  [["Tab", 1.5], ..."QWERTYUIOP".split("").map((c) => [`Key${c}`, 1]), ["BracketLeft", 1], ["BracketRight", 1], ["Backslash", 1.5]],
  [["CapsLock", 1.75], ..."ASDFGHJKL".split("").map((c) => [`Key${c}`, 1]), ["Semicolon", 1], ["Quote", 1], ["Enter", 2.25]],
  [["ShiftLeft", 2.25], ..."ZXCVBNM".split("").map((c) => [`Key${c}`, 1]), ["Comma", 1], ["Period", 1], ["Slash", 1], ["ShiftRight", 2.75]],
  [["ControlLeft", 1.5], ["AltLeft", 1.5], ["Space", 9], ["AltRight", 1.5], ["ControlRight", 1.5]],
];
const ARROWS = [[null, "ArrowUp", null], ["ArrowLeft", "ArrowDown", "ArrowRight"]];

const KEY_NAMES = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  ShiftLeft: "⇧ L", ShiftRight: "⇧ R", ControlLeft: "Ctrl L", ControlRight: "Ctrl R",
  AltLeft: "Alt", AltRight: "AltGr", MetaLeft: "Meta", MetaRight: "Meta R",
  Backspace: "⌫", Enter: "Enter", Tab: "Tab", CapsLock: "Caps", Escape: "Esc",
  Backquote: "§", Minus: "+", Equal: "´", BracketLeft: "Å", BracketRight: "¨",
  Backslash: "'", Semicolon: "Ö", Quote: "Ä", Comma: ",", Period: ".", Slash: "-",
};

const PAD_NAMES = {
  "LS-Up": "LS ↑", "LS-Down": "LS ↓", "LS-Left": "LS ←", "LS-Right": "LS →",
  "RS-Up": "RS ↑", "RS-Down": "RS ↓", "RS-Left": "RS ←", "RS-Right": "RS →",
  Up: "↑", Down: "↓", Left: "←", Right: "→",
};

const STYLE = `
.gpm{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
  padding:12px;box-sizing:border-box;background:rgba(3,6,14,.72);pointer-events:auto;
  font:500 14px/1.4 system-ui,sans-serif;color:#e9edff}
.gpm *{box-sizing:border-box}
.gpm-box{position:relative;width:min(980px,100%);max-height:100%;overflow:auto;padding:16px 18px 14px;
  border-radius:16px;background:#0b1226;border:1px solid rgba(120,160,255,.25);box-shadow:0 18px 60px rgba(0,0,0,.55)}
.gpm-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px}
.gpm-head h2{margin:0 auto 0 0;font:700 18px system-ui,sans-serif;letter-spacing:.05em}
.gpm button{font:inherit;color:inherit;cursor:pointer;border-radius:9px;padding:6px 12px;
  border:1px solid rgba(159,176,216,.35);background:rgba(255,255,255,.04)}
.gpm button:disabled{opacity:.35;cursor:default}
.gpm button.on{border-color:#6fe3ff;background:rgba(111,227,255,.16);color:#6fe3ff}
.gpm button.warn{border-color:#ff6b6b;background:rgba(255,107,107,.2);color:#ff9b9b}
.gpm button.primary{border-color:rgba(111,227,255,.6);background:rgba(111,227,255,.18);color:#6fe3ff}
.gpm .gpm-focus{outline:2px solid #ffd479;outline-offset:2px}
.gpm-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 10px}
.gpm-row>.gpm-lbl{color:#9fb0d8;margin-right:4px}
.gpm-tag{font-size:11px;color:rgba(233,237,255,.45);margin-left:4px}
.gpm input{font:inherit;color:inherit;background:#050a18;border:1px solid #6fe3ff;border-radius:8px;padding:5px 8px;width:11em}
.gpm-note{margin:0 0 10px;font-size:12px;color:rgba(233,237,255,.5)}
.gpm-note.dirty{color:#ffd479}
.gpm-pad{position:relative;display:grid;grid-template-columns:1fr minmax(260px,1.3fr) 1fr;gap:0 26px;align-items:center;margin:4px 0 12px}
.gpm-col{display:flex;flex-direction:column;gap:3px}
.gpm-col.l{align-items:flex-end}
.gpm-col.r{align-items:flex-start}
.gpm-src{display:flex;gap:6px;align-items:center;padding:2px 8px !important;border-radius:7px !important;font-size:12px !important;
  max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gpm-src b{font-weight:700;color:#9fb0d8;min-width:3.2em;text-align:center}
.gpm-src i{font-style:normal;overflow:hidden;text-overflow:ellipsis}
.gpm-src.free i{color:rgba(233,237,255,.3)}
.gpm-src.live,.gpm-m.live{filter:brightness(1.7)}
.gpm-pic{width:100%;height:auto;display:block}
.gpm-pic .body{fill:#18213d;stroke:rgba(159,176,216,.4);stroke-width:1.2}
.gpm-pic .base{fill:#0e1630;stroke:rgba(159,176,216,.3)}
.gpm-m{cursor:pointer;fill:#2a3558;stroke:rgba(159,176,216,.55);stroke-width:1}
.gpm-m.live{fill:#ffffff !important}
.gpm-pic text{pointer-events:none;font:700 8px system-ui,sans-serif;fill:#0b1226;text-anchor:middle;dominant-baseline:central}
.gpm-pic text.dim{fill:#9fb0d8}
.gpm-lines{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.gpm-narrow .gpm-pad{grid-template-columns:1fr 1fr;gap:6px 8px}
.gpm-narrow .gpm-pic{grid-column:1 / -1;grid-row:1;max-width:420px;margin:0 auto 6px}
.gpm-narrow .gpm-col.l{align-items:stretch}
.gpm-narrow .gpm-lines{display:none}
.gpm-narrow .gpm-col.r{align-items:stretch}
.gpm-narrow .gpm-acts{grid-template-columns:auto 1fr;gap:4px 8px}
.gpm-narrow .gpm-chips{grid-column:2;margin-bottom:6px}
.gpm-narrow .gpm-bar{display:none}
.gpm-narrow .gpm-kb{flex-direction:column;align-items:stretch}
.gpm-narrow .gpm-kb-arrows{align-self:flex-end;width:40%}
.gpm-kb{display:flex;gap:10px;margin:4px 0 12px;align-items:flex-end}
.gpm-kb-main{flex:15 1 0;display:flex;flex-direction:column;gap:3px;min-width:0}
.gpm-kb-arrows{flex:3.3 1 0;display:flex;flex-direction:column;gap:3px;min-width:0}
.gpm-kr{display:flex;gap:3px}
.gpm-key{flex:1 1 0;min-width:0;height:38px;padding:2px !important;border-radius:6px !important;font-size:11px !important;
  display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;line-height:1.1}
.gpm-key span{font-size:9px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gpm-key.gap{visibility:hidden}
.gpm-key.live{filter:brightness(1.8)}
.gpm-acts{display:grid;grid-template-columns:auto auto 1fr 70px;gap:5px 10px;align-items:center;margin:0 0 12px}
.gpm-dot{width:10px;height:10px;border-radius:50%}
.gpm-act{text-align:left;font-weight:600 !important}
.gpm-act.listen{border-color:#ffd479 !important;color:#ffd479;animation:gpm-pulse 1s infinite}
@keyframes gpm-pulse{50%{opacity:.55}}
.gpm-chips{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.gpm-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 4px 1px 8px;border-radius:6px;font-size:12px;
  background:rgba(255,255,255,.06);border:1px solid rgba(159,176,216,.3)}
.gpm-chip button{padding:0 5px !important;border:0 !important;background:none !important;font-size:13px;line-height:1.2;color:rgba(233,237,255,.6)}
.gpm-none{font-size:12px;color:#ff9b9b}
.gpm-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden}
.gpm-bar i{display:block;height:100%;width:0}
.gpm-foot{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.gpm-foot .sp{flex:1}
.gpm-toast{position:sticky;bottom:0;margin:10px auto 0;width:fit-content;max-width:100%;padding:7px 14px;border-radius:9px;
  background:#1d2a50;border:1px solid #ffd479;color:#ffd479;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none}
.gpm-toast.show{opacity:1}
.gpm-pick{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(3,6,14,.6);border-radius:16px;z-index:2}
.gpm-pick>div{width:min(320px,92%);max-height:90%;overflow:auto;padding:14px;border-radius:12px;background:#111b38;border:1px solid rgba(120,160,255,.35);
  display:flex;flex-direction:column;gap:5px}
.gpm-pick h3{margin:0 0 6px;font:700 15px system-ui,sans-serif}
.gpm-pick button{text-align:left;display:flex;gap:8px;align-items:center}
.gpm-pad-state{font-size:12px;color:#ffd479;margin:0 0 8px}
`;

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function sv(tag, attrs = {}, text) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

function keyName(code, t) {
  if (code === "Space") return t.space;
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return code;
}

export function createMapper(core, opts = {}) {
  const t = () => T[core.lang] ?? T.en;
  const colorOf = (id) => COLORS[Math.max(0, core.inputs.findIndex((i) => i.id === id)) % COLORS.length];
  const srcName = (src) => (deviceOf(src) === "keys" ? keyName(src, t()) : PAD_NAMES[src] ?? src);

  let device = opts.device === "keys" || opts.device === "pad"
    ? opts.device
    : core.pad.connected ? "pad" : "keys";
  const editors = { keys: core.edit("keys"), pad: core.edit("pad") };
  let listening = null;       // { id, device, armed }
  let picking = null;         // source being given an action
  let renaming = false;
  let armed = null;           // "delete" | "close", a button waiting for its second press
  let armTimer = 0;
  let toastTimer = 0;
  let narrow = false;
  let raf = 0;
  let prevPad = new Map();
  const keysHeld = new Set();
  let closed = false;

  const style = el("style", {}, STYLE);
  const root = el("div", { class: "gpm", role: "dialog", "aria-modal": "true" });
  const box = el("div", { class: "gpm-box" });
  const toast = el("div", { class: "gpm-toast", role: "status" });
  root.append(style, box);
  root.addEventListener("pointerdown", (e) => { if (e.target === root) back(); });
  (opts.parent ?? document.body).append(root);

  const ro = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
      const n = box.clientWidth < 640;
      if (n !== narrow) {
        narrow = n;
        root.classList.toggle("gpm-narrow", n);
      }
      drawLines();
    })
    : null;
  ro?.observe(box);

  function notify(text) {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function arm(what) {
    armed = what;
    clearTimeout(armTimer);
    armTimer = setTimeout(() => { armed = null; render(); }, 3000);
  }
  function disarm() {
    armed = null;
    clearTimeout(armTimer);
  }

  const ed = () => editors[device];

  function bindSource(id, src) {
    const r = ed().add(id, src);
    if (!r.added) return;
    if (r.from) notify(fill(t().moved, { src: srcName(src), from: core.label(r.from) }));
    else notify(fill(t().bound, { src: srcName(src), to: core.label(id) }));
  }

  // --- actions --------------------------------------------------------------

  function setDevice(d) {
    if (d === device) return;
    device = d;
    listening = null;
    picking = null;
    renaming = false;
    disarm();
    render();
  }

  function listen(id) {
    listening = listening?.id === id ? null : { id, device, armed: false };
    picking = null;
    render();
  }

  function pick(src) {
    picking = src;
    listening = null;
    render();
    focusFirst(box.querySelector(".gpm-pick"));
  }

  function choose(id) {
    if (picking) bindSource(id, picking);
    picking = null;
    render();
  }

  function clearPicked() {
    if (picking) ed().clear(picking);
    picking = null;
    render();
  }

  function selectProfile(id) {
    if (ed().dirty) return;
    core.select(id);
    editors[device] = core.edit(device);
    renaming = false;
    disarm();
    render();
  }

  function newProfile() {
    const e = core.edit(device);
    const p = e.save({ asNew: true });
    editors[device] = core.edit(device);
    notify(fill(t().savedAs, { name: textOf(p.label, core.lang) }));
    render();
  }

  function startRename() {
    renaming = true;
    render();
    const input = box.querySelector("input");
    input?.focus();
    input?.select();
  }

  function finishRename(text) {
    const p = core.activeProfile(device);
    core.rename(p.id, text);
    editors[device] = core.edit(device);
    renaming = false;
    render();
  }

  function deleteProfile() {
    if (armed !== "delete") { arm("delete"); render(); return; }
    disarm();
    core.remove(core.activeProfile(device).id);
    editors[device] = core.edit(device);
    render();
  }

  function undo() {
    if (ed().undo()) notify(t().undone);
    render();
  }

  function discard() {
    if (ed().discard()) notify(t().discarded);
    listening = null;
    render();
  }

  function save(asNew) {
    const wasPreset = ed().profile.preset;
    const p = ed().save({ asNew });
    editors[device] = core.edit(device);
    notify(wasPreset || asNew ? fill(t().savedAs, { name: textOf(p.label, core.lang) }) : t().saved);
    render();
  }

  function tryClose() {
    const dirty = editors.keys.dirty || editors.pad.dirty;
    if (dirty && armed !== "close") { arm("close"); render(); return; }
    close();
  }

  /** B, Esc and a click outside: one step back, whatever is open. */
  function back() {
    if (picking) { picking = null; render(); return; }
    if (listening) { listening = null; render(); return; }
    if (renaming) { renaming = false; render(); return; }
    tryClose();
  }

  // --- rendering ------------------------------------------------------------

  function render() {
    if (closed) return;
    const tt = t();
    const keep = document.activeElement?.dataset?.k;
    const e = ed();
    box.replaceChildren();

    // Header: title, device tabs, close.
    const closeBtn = el("button", {
      "data-nav": "", "data-k": "close", class: armed === "close" ? "warn" : null, onclick: tryClose,
    }, armed === "close" ? tt.closeSure : tt.close);
    box.append(el("div", { class: "gpm-head" },
      el("h2", {}, tt.title),
      ["keys", "pad"].map((d) => el("button", {
        "data-nav": "", "data-k": `tab-${d}`, class: device === d ? "on" : null, onclick: () => setDevice(d),
      }, tt[d])),
      closeBtn));

    // Profiles.
    const active = core.activeProfile(device);
    const row = el("div", { class: "gpm-row" }, el("span", { class: "gpm-lbl" }, tt.profile));
    for (const p of core.profiles(device)) {
      const on = p.id === active.id;
      if (on && renaming) {
        const input = el("input", {
          value: textOf(p.label, core.lang), "data-nav": "", "data-k": "rename-input", maxlength: "32",
          onkeydown: (ev) => {
            if (ev.key === "Enter") { ev.preventDefault(); finishRename(ev.target.value); }
          },
        });
        row.append(input, el("button", {
          "data-nav": "", "data-k": "rename-ok", onclick: () => finishRename(input.value),
        }, tt.ok));
        continue;
      }
      row.append(el("button", {
        "data-nav": "", "data-k": `p-${p.id}`, class: on ? "on" : null,
        disabled: !on && e.dirty, title: !on && e.dirty ? tt.locked : (p.preset ? tt.preset : null),
        onclick: () => selectProfile(p.id),
      }, textOf(p.label, core.lang), p.preset ? el("span", { class: "gpm-tag" }, tt.preset) : null));
    }
    row.append(el("button", {
      "data-nav": "", "data-k": "new", disabled: e.dirty, title: e.dirty ? tt.locked : null, onclick: newProfile,
    }, tt.newProfile));
    if (!active.preset && !renaming) {
      row.append(
        el("button", { "data-nav": "", "data-k": "rename", onclick: startRename }, tt.rename),
        el("button", {
          "data-nav": "", "data-k": "delete", class: armed === "delete" ? "warn" : null, onclick: deleteProfile,
        }, armed === "delete" ? tt.sure : tt.del),
      );
    }
    box.append(row);

    box.append(el("p", { class: `gpm-note${e.dirty ? " dirty" : ""}` },
      e.dirty ? tt.dirty : (device === "pad" ? tt.hintPad : tt.hintKeys)));
    if (device === "pad" && !core.pad.connected) box.append(el("p", { class: "gpm-pad-state" }, tt.noPad));

    box.append(device === "pad" ? renderPad() : renderKeyboard());
    box.append(renderActions());

    box.append(el("div", { class: "gpm-foot" },
      el("button", { "data-nav": "", "data-k": "undo", disabled: !e.canUndo, onclick: undo }, tt.undo),
      el("button", { "data-nav": "", "data-k": "discard", disabled: !e.dirty && !e.canUndo, onclick: discard }, tt.discard),
      el("span", { class: "sp" }),
      !active.preset ? el("button", {
        "data-nav": "", "data-k": "save-new", disabled: !e.dirty, onclick: () => save(true),
      }, tt.saveNew) : null,
      el("button", {
        "data-nav": "", "data-k": "save", class: "primary", disabled: !e.dirty, onclick: () => save(false),
      }, active.preset ? tt.saveOwn : tt.save)));

    if (picking) box.append(renderPicker());
    box.append(toast);

    if (keep) {
      const again = box.querySelector(`[data-k="${CSS_ESCAPE(keep)}"]`);
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
    markFocus();
    requestAnimationFrame(drawLines);
  }

  const CSS_ESCAPE = (s) => (globalThis.CSS?.escape ? globalThis.CSS.escape(s) : s);

  function srcButton(src, side) {
    const owner = ed().owner(src);
    const color = owner ? colorOf(owner) : null;
    return el("button", {
      class: `gpm-src${owner ? "" : " free"}`, "data-src": src, "data-side": side,
      "data-nav": "", "data-k": `src-${src}`,
      style: color ? `border-color:${color}` : null,
      onclick: () => pick(src),
    }, el("b", {}, srcName(src)), el("i", { style: color ? `color:${color}` : null },
      owner ? core.label(owner) : "—"));
  }

  function renderPad() {
    const wrap = el("div", { class: "gpm-pad" });
    wrap.append(
      el("div", { class: "gpm-col l" }, LEFT.map((s) => srcButton(s, "l"))),
      padPicture(),
      el("div", { class: "gpm-col r" }, RIGHT.map((s) => srcButton(s, "r"))),
    );
    wrap.append(sv("svg", { class: "gpm-lines" }));
    return wrap;
  }

  function padPicture() {
    const svg = sv("svg", { class: "gpm-pic", viewBox: "0 0 300 200", role: "img" });
    svg.append(sv("path", {
      class: "body",
      d: "M62,40 C92,28 208,28 238,40 C274,52 292,118 290,158 C288,190 262,198 244,180 "
        + "C229,165 214,146 194,141 L106,141 C86,146 71,165 56,180 C38,198 12,190 10,158 C8,118 26,52 62,40 Z",
    }));
    const m = (src, shape, attrs, text) => {
      const owner = ed().owner(src);
      const node = sv(shape, {
        ...attrs, class: "gpm-m", "data-src": src,
        style: owner ? `fill:${colorOf(owner)}` : null,
      });
      const title = sv("title", {}, `${srcName(src)}${owner ? ` — ${core.label(owner)}` : ""}`);
      node.append(title);
      node.addEventListener("click", () => pick(src));
      svg.append(node);
      if (text) {
        const cx = attrs.cx ?? attrs.x + attrs.width / 2;
        const cy = attrs.cy ?? attrs.y + attrs.height / 2;
        svg.append(sv("text", { x: cx, y: cy, class: owner ? null : "dim" }, text));
      }
    };
    const tri = (cx, cy, dir) => {
      const s = 5.5;
      const pts = {
        up: [[cx, cy - s], [cx - s, cy + s * 0.6], [cx + s, cy + s * 0.6]],
        down: [[cx, cy + s], [cx - s, cy - s * 0.6], [cx + s, cy - s * 0.6]],
        left: [[cx - s, cy], [cx + s * 0.6, cy - s], [cx + s * 0.6, cy + s]],
        right: [[cx + s, cy], [cx - s * 0.6, cy - s], [cx - s * 0.6, cy + s]],
      }[dir];
      return { points: pts.map((p) => p.join(",")).join(" "), _c: [cx, cy] };
    };
    const stick = (name, cx, cy) => {
      svg.append(sv("circle", { class: "base", cx, cy, r: 18 }));
      m(name, "circle", { cx, cy, r: 9 }, name);
      for (const [dir, dx, dy] of [["Up", 0, -24], ["Down", 0, 24], ["Left", -24, 0], ["Right", 24, 0]]) {
        const p = tri(cx + dx, cy + dy, dir.toLowerCase());
        m(`${name}-${dir}`, "polygon", { points: p.points, "data-cx": p._c[0], "data-cy": p._c[1] });
      }
    };

    m("LT", "rect", { x: 64, y: 6, width: 40, height: 15, rx: 6 }, "LT");
    m("RT", "rect", { x: 196, y: 6, width: 40, height: 15, rx: 6 }, "RT");
    m("LB", "rect", { x: 58, y: 25, width: 54, height: 10, rx: 5 }, "LB");
    m("RB", "rect", { x: 188, y: 25, width: 54, height: 10, rx: 5 }, "RB");
    stick("LS", 92, 80);
    stick("RS", 182, 124);
    svg.append(sv("rect", { class: "base", x: 106, y: 108, width: 34, height: 34, rx: 6 }));
    m("Up", "rect", { x: 117, y: 109, width: 12, height: 11, rx: 2 });
    m("Down", "rect", { x: 117, y: 130, width: 12, height: 11, rx: 2 });
    m("Left", "rect", { x: 107, y: 119, width: 11, height: 12, rx: 2 });
    m("Right", "rect", { x: 128, y: 119, width: 11, height: 12, rx: 2 });
    m("Back", "rect", { x: 128, y: 72, width: 14, height: 9, rx: 4.5 });
    m("Start", "rect", { x: 158, y: 72, width: 14, height: 9, rx: 4.5 });
    m("Y", "circle", { cx: 214, cy: 62, r: 9 }, "Y");
    m("X", "circle", { cx: 197, cy: 79, r: 9 }, "X");
    m("B", "circle", { cx: 231, cy: 79, r: 9 }, "B");
    m("A", "circle", { cx: 214, cy: 96, r: 9 }, "A");
    return svg;
  }

  /** Leader lines from each label to its button, drawn once the layout exists. */
  function drawLines() {
    const lines = box.querySelector(".gpm-lines");
    const wrap = box.querySelector(".gpm-pad");
    if (!lines || !wrap) return;
    lines.replaceChildren();
    if (narrow) return;
    const base = wrap.getBoundingClientRect();
    for (const label of wrap.querySelectorAll(".gpm-src")) {
      const src = label.dataset.src;
      const mark = wrap.querySelector(`.gpm-m[data-src="${src}"]`);
      if (!mark) continue;
      const a = label.getBoundingClientRect();
      const b = mark.getBoundingClientRect();
      const left = label.dataset.side === "l";
      const x1 = (left ? a.right : a.left) - base.left;
      const y1 = a.top + a.height / 2 - base.top;
      const x2 = b.left + b.width / 2 - base.left;
      const y2 = b.top + b.height / 2 - base.top;
      const elbow = x1 + (left ? 10 : -10);
      const owner = ed().owner(src);
      lines.append(sv("polyline", {
        points: `${x1},${y1} ${elbow},${y1} ${x2},${y2}`,
        fill: "none",
        stroke: owner ? colorOf(owner) : "rgba(159,176,216,.22)",
        "stroke-width": owner ? 1.3 : 1,
        "stroke-dasharray": owner ? null : "2 3",
      }));
    }
  }

  function keyButton(code, w) {
    if (!code) return el("div", { class: "gpm-key gap", style: `flex:${w} 1 0` });
    const owner = ed().owner(code);
    const color = owner ? colorOf(owner) : null;
    return el("button", {
      class: "gpm-key", "data-src": code, "data-nav": "", "data-k": `src-${code}`,
      style: `flex:${w} 1 0;${color ? `border-color:${color};background:${color}22;color:${color}` : ""}`,
      title: owner ? core.label(owner) : null,
      onclick: () => pick(code),
    }, keyName(code, t()), owner ? el("span", {}, core.label(owner)) : null);
  }

  function renderKeyboard() {
    return el("div", { class: "gpm-kb" },
      el("div", { class: "gpm-kb-main" },
        KEY_ROWS.map((r) => el("div", { class: "gpm-kr" }, r.map(([code, w]) => keyButton(code, w))))),
      el("div", { class: "gpm-kb-arrows" },
        ARROWS.map((r) => el("div", { class: "gpm-kr" }, r.map((code) => keyButton(code, 1))))));
  }

  function renderActions() {
    const tt = t();
    const grid = el("div", { class: "gpm-acts" });
    for (const input of core.inputs) {
      const color = colorOf(input.id);
      const isListening = listening?.id === input.id && listening.device === device;
      const sources = ed().sourcesOf(input.id);
      grid.append(
        el("span", { class: "gpm-dot", style: `background:${color}` }),
        el("button", {
          class: `gpm-act${isListening ? " listen" : ""}`, "data-nav": "", "data-k": `act-${input.id}`,
          onclick: () => listen(input.id),
        }, isListening ? (device === "pad" ? tt.listenPad : tt.listenKeys) : core.label(input.id),
        el("span", { class: "gpm-tag" }, tt[`type.${input.type}`])),
        el("div", { class: "gpm-chips" },
          sources.length
            ? sources.map((src) => el("span", { class: "gpm-chip", style: `border-color:${color}66` },
              srcName(src),
              el("button", {
                "data-nav": "", "data-k": `rm-${input.id}-${src}`,
                "aria-label": fill(tt.removeSrc, { src: srcName(src) }),
                onclick: () => { ed().remove(input.id, src); render(); },
              }, "×")))
            : el("span", { class: "gpm-none" }, tt.unbound)),
        el("div", { class: "gpm-bar" }, el("i", { "data-bar": input.id, style: `background:${color}` })),
      );
    }
    return grid;
  }

  function renderPicker() {
    const tt = t();
    const owner = ed().owner(picking);
    const list = el("div", {},
      el("h3", {}, fill(tt.pick, { src: srcName(picking) })),
      core.inputs.map((input) => el("button", {
        "data-nav": "", "data-k": `pick-${input.id}`, class: owner === input.id ? "on" : null,
        onclick: () => choose(input.id),
      }, el("span", { class: "gpm-dot", style: `background:${colorOf(input.id)}` }), core.label(input.id))),
      owner ? el("button", { "data-nav": "", "data-k": "pick-clear", onclick: clearPicked }, tt.clear) : null,
      el("button", { "data-nav": "", "data-k": "pick-cancel", onclick: () => { picking = null; render(); } }, tt.cancel));
    const layer = el("div", { class: "gpm-pick" }, list);
    layer.addEventListener("pointerdown", (ev) => { if (ev.target === layer) { picking = null; render(); } });
    return layer;
  }

  // --- focus and the controller ---------------------------------------------

  function markFocus() {
    for (const n of box.querySelectorAll(".gpm-focus")) n.classList.remove("gpm-focus");
    const a = document.activeElement;
    if (a && box.contains(a) && padDriven) a.classList.add("gpm-focus");
  }
  let padDriven = false;

  function navScope() {
    return box.querySelector(".gpm-pick") ?? box;
  }

  function focusFirst(scope) {
    const first = (scope ?? navScope()).querySelector("[data-nav]:not([disabled])");
    first?.focus({ preventScroll: false });
    markFocus();
  }

  function move(dir) {
    padDriven = true;
    const scope = navScope();
    const all = [...scope.querySelectorAll("[data-nav]:not([disabled])")]
      .filter((n) => n.getClientRects().length);
    const cur = document.activeElement;
    if (!cur || !scope.contains(cur)) { focusFirst(scope); return; }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const n of all) {
      if (n === cur) continue;
      const b = n.getBoundingClientRect();
      const dx = b.left + b.width / 2 - ax;
      const dy = b.top + b.height / 2 - ay;
      const along = { up: -dy, down: dy, left: -dx, right: dx }[dir];
      const across = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
      if (along <= 2) continue;
      const score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (best) {
      best.focus({ preventScroll: true });
      best.scrollIntoView?.({ block: "nearest" });
      markFocus();
    }
  }

  const PAD = padSources();

  function frame() {
    if (closed) return;
    core.sample();
    const now = new Map(PAD.map((s) => [s, core.sourceValue(s)]));
    const went = (s, at = 0.6) => (now.get(s) ?? 0) >= at && (prevPad.get(s) ?? 0) < at;

    if (listening && listening.device === "pad" && device === "pad") {
      // The press that started listening is still down. Wait until the
      // controller is quiet, so it is the next press that binds.
      if (!listening.armed) {
        if ([...now.values()].every((v) => v < 0.3)) listening.armed = true;
      } else {
        const src = PAD.find((s) => went(s));
        if (src) {
          bindSource(listening.id, src);
          listening = null;
          render();
        }
      }
    } else if (core.pad.connected) {
      if (went("Up") || went("LS-Up")) move("up");
      else if (went("Down") || went("LS-Down")) move("down");
      else if (went("Left") || went("LS-Left")) move("left");
      else if (went("Right") || went("LS-Right")) move("right");
      else if (went("A")) {
        padDriven = true;
        const a = document.activeElement;
        if (a && box.contains(a)) a.click();
        else focusFirst();
      } else if (went("B")) back();
      else if (went("LB")) setDevice("keys");
      else if (went("RB")) setDevice("pad");
    }

    live(now);
    prevPad = now;
    raf = requestAnimationFrame(frame);
  }

  /** What is down right now, lit on the pictures and the bars. */
  function live(padNow) {
    const valueOf = (src) => (padNow.has(src) ? padNow.get(src) : keysHeld.has(src) ? 1 : 0);
    for (const n of box.querySelectorAll("[data-src]")) {
      n.classList.toggle("live", valueOf(n.dataset.src) >= 0.5);
    }
    const e = ed();
    for (const bar of box.querySelectorAll("[data-bar]")) {
      let v = 0;
      for (const src of e.sourcesOf(bar.dataset.bar)) {
        const x = valueOf(src);
        v = Math.max(v, isAnalogSource(src) ? x : x >= 0.5 ? 1 : 0);
      }
      bar.style.width = `${Math.round(v * 100)}%`;
    }
  }

  // --- keyboard -------------------------------------------------------------

  // Capture, so the game underneath never hears a key meant for this window.
  function onKeyDown(ev) {
    keysHeld.add(ev.code);
    ev.stopPropagation();
    const inField = ev.target?.tagName === "INPUT";
    if (listening && listening.device === "keys" && device === "keys") {
      ev.preventDefault();
      if (ev.code === "Escape") listening = null;
      else bindSource(listening.id, ev.code);
      listening = null;
      render();
      return;
    }
    if (ev.code === "Escape") {
      ev.preventDefault();
      back();
      return;
    }
    if (!inField && (ev.code === "Tab" || ev.code.startsWith("Arrow"))) padDriven = true;
    if (!inField && ev.code.startsWith("Arrow")) {
      ev.preventDefault();
      move(ev.code.slice(5).toLowerCase());
    }
    requestAnimationFrame(markFocus);
  }
  function onKeyUp(ev) {
    keysHeld.delete(ev.code);
  }
  function onPointer() {
    padDriven = false;
    markFocus();
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  root.addEventListener("pointerdown", onPointer, true);

  function close() {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    clearTimeout(armTimer);
    clearTimeout(toastTimer);
    ro?.disconnect();
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    root.remove();
    try {
      opts.onClose?.();
    } catch {
      /* not ours */
    }
  }

  render();
  if (core.pad.connected) { padDriven = true; focusFirst(); }
  raf = requestAnimationFrame(frame);

  return { render, close };
}
