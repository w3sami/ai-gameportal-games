/**
 * sketchpad — a level sketching overlay for portal games.
 *
 *   import { createSketchpad }
 *     from "https://plugins.game.bigbools.fi/sketchpad/v1/index.js";
 *
 *   const pad = createSketchpad({
 *     canvas, toLocal, size: { w: 720, h: 1040 },
 *     scene:  () => level.name,
 *     items:  () => level.movable,     // [{ id, label, obj: { x, y } }]
 *     solids: () => level.boxes,       // [{ kind, x, y, w, h }]
 *     save, canSave: () => portal.canWrite,
 *   });
 *
 *   pad.restore();          // when a scene starts, before anything copies it
 *   pad.draw(ctx);          // last thing in the frame
 *   pad.toggle();           // from a debug button
 *
 * Laying a level out is work done by eye, and the loop it usually runs in is
 * slow: the author says a number, an assistant writes it into the level file
 * and publishes. This shortens that loop to three things — **see where the
 * collision actually is**, **drag the pieces into place**, and **paint over
 * the level to say what was meant to be there.**
 *
 * **It never writes geometry back into the game.** A level is usually code and
 * not data: walls get built from a grid, doorways are computed, and none of
 * that comes back out of a drag. And a level whose numbers live half in code
 * and half in a config file is a level that two tools read differently — the
 * checker that reads the module would be checking a different level than the
 * one being played. So the division is:
 *
 *     painting and drags  ->  config/sketch.json, a note for the assistant
 *     the level's numbers ->  the level's own source, the only truth
 *
 * Drags do stay put, but **only in the browser they were made in**, so that
 * reloading the page does not wipe a half-finished layout. They never travel
 * with a publish and no player ever sees them; the panel says how many are
 * still unwritten, because a silent local deviation from the source is exactly
 * the trap this design is avoiding.
 *
 * **Nothing here ever throws**, the same rule the other portal plugins follow.
 * No storage, no canvas, a game callback that fails, a save the portal refuses
 * — each one is reported and none of them is a branch a game has to write.
 *
 * The panel itself loads only when it is opened: this module is the small half,
 * and `open()` fetches the rest. A game can therefore import it at the top of
 * its main file without shipping an editor to every player.
 */

const FILE = "config/sketch.json";
const STORE = "sketchpad";

/**
 * The labels a painted shape can carry. A colour tells the kind apart at a
 * glance, but colour alone is guesswork — and guesswork is the whole reason
 * this tool exists — so the label is written next to the shape as well, and it
 * is what lands in the file. Every shape also carries free text, which is where
 * the reason goes.
 *
 * A game with its own vocabulary passes its own list; these are the words a
 * platform game turned out to need.
 */
export const LABELS = [
  { key: "wall", color: "#ff5d7a" },
  { key: "gap", color: "#6fe3ff" },
  { key: "platform", color: "#7bf0a0" },
  { key: "prop", color: "#ffd479" },
  { key: "remove", color: "#ff8a3d" },
  { key: "route", color: "#c58cff" },
  { key: "note", color: "#e9edff" },
];

/**
 * Default colours for the collision picture, by the `kind` a game puts on each
 * shape. An unknown kind still gets drawn, in the fallback colour — a shape a
 * game bothered to hand over is never silently dropped.
 */
export const KINDS = {
  wall: "#5b7aa8",
  door: "#ffd479",
  platform: "#7bf0a0",
  fuel: "#c58cff",
  button: { color: "#8a97be", dash: [6, 5] },
  hint: { color: "#8a97be", dash: [3, 3] },
};
export const FALLBACK_KIND = "#9ad8ff";

const isNum = (v) => typeof v === "number" && isFinite(v);
/** A game's callback is the game's business; a throw in one is not ours. */
const call = (fn, ...args) => {
  if (typeof fn !== "function") return undefined;
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
};
const list = (v) => (Array.isArray(v) ? v : []);

/** localStorage is absent in a private window and throws behind some settings. */
function readStore(key) {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function writeStore(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Free-hand points go into the file as one string rather than nested arrays.
 * Indented JSON would spread a single stroke over a thousand lines, and the
 * config folder a game may write has a 64 kB ceiling per file — a handful of
 * strokes would fill it. The string is also the form a person reads at a
 * glance, which matters when the file exists to be read.
 */
const packPts = (pts) => list(pts).map(([x, y]) => `${x},${y}`).join(" ");
const unpackPts = (v) =>
  typeof v !== "string"
    ? list(v)
    : v.trim().split(/\s+/).filter(Boolean).map((t) => t.split(",").map(Number));
export const packShape = (s) => (s && s.kind === "free" ? { ...s, pts: packPts(s.pts) } : s);
export const unpackShape = (s) => (s && s.kind === "free" ? { ...s, pts: unpackPts(s.pts) } : s);

/**
 * One sketchpad over one canvas. Opening and closing it many times reuses the
 * same one; a game calls this once.
 *
 * Options, all but `canvas` optional:
 *
 *   canvas    the game's canvas. Pointer events are taken from it while open.
 *   toLocal   (clientX, clientY) -> { x, y } in the game's own coordinates.
 *             Without one the canvas rect is used, which is right whenever the
 *             canvas is drawn without letterboxing.
 *   size      { w, h } of those coordinates. Default: the canvas attribute size.
 *   scene     () -> a name the sketch is filed under, e.g. the level's name.
 *   items     () -> [{ id, label, obj }] — what may be dragged. `obj` is an
 *             object with `x` and `y` that the game's drawing reads every
 *             frame. Anything else about it is the game's business.
 *   solids    () -> [{ kind, x, y, w, h }] or [{ kind, x, y, r }] — the
 *             collision picture, outlined on top of the game.
 *   check     () -> [{ text, box? }] — the game's own warnings. Run after every
 *             change, listed in the panel, and `box` is framed in red.
 *   kinds     colours for `solids`, by kind. Merged over KINDS.
 *   labels    the painting vocabulary. Default: LABELS.
 *   save      (file, contents) -> Promise<{ saved, reason }>, i.e.
 *             portal-events' savePortalFile.
 *   canSave   () -> boolean, i.e. portal.canWrite.
 *   file      where the sketch is saved. Default: config/sketch.json.
 *   storeKey  localStorage prefix. Default: sketchpad.
 *   lang      "fi" or "en" for the panel's own words. Default: "en".
 *   side      "left" or "right" — which corner the panel sits in. Default left,
 *             because a game's own debug panel is usually on the right.
 *   snap      grid step for dragging, in game units. Default 4. Shift frees it.
 *   onMove    called after anything moved, so a game that copies positions into
 *             its own arrays can follow along.
 *   onOpen    called before the panel appears. Pause the game here.
 *   onClose   called after it is gone. Put the game back as it was.
 */
export function createSketchpad(opts = {}) {
  const o = opts || {};
  const canvas = o.canvas || null;
  const file = typeof o.file === "string" ? o.file : FILE;
  const prefix = typeof o.storeKey === "string" ? o.storeKey : STORE;
  const MOVE_KEY = `${prefix}.moves`;
  const SKETCH_KEY = `${prefix}.sketch`;

  const sceneOf = () => String(call(o.scene) ?? "scene");
  const itemsOf = () => list(call(o.items)).filter((it) => it && it.obj && it.id !== undefined);

  /**
   * Where each item sits in the game's own source, captured the first time the
   * scene is restored — before any stored move is written over it. The item's
   * object is the only place those numbers live, so without this "back to
   * defaults" could not put them back at all.
   */
  const defaults = new Map();
  const defKey = (scene, id) => `${scene}\u0000${id}`;

  /** scene -> { id: { x, y } }, the drags this browser remembers. */
  let moves = {};
  const stored = readStore(MOVE_KEY);
  if (stored && typeof stored === "object") moves = stored;

  /**
   * Put a scene's movable things where this browser left them, and record the
   * source's own numbers the first time we see them.
   *
   * Call this when a scene starts and **before** the game copies positions into
   * anything of its own, so the copy already has them.
   */
  function restore() {
    const scene = sceneOf();
    const mine = moves[scene] || {};
    for (const it of itemsOf()) {
      const key = defKey(scene, it.id);
      if (!defaults.has(key)) defaults.set(key, { x: +it.obj.x, y: +it.obj.y });
      const d = defaults.get(key);
      const m = mine[it.id];
      it.obj.x = m && isNum(+m.x) ? +m.x : d.x;
      it.obj.y = m && isNum(+m.y) ? +m.y : d.y;
    }
    return itemsOf().length;
  }

  const defOf = (id) => defaults.get(defKey(sceneOf(), id)) || null;

  /**
   * What has been dragged, as the difference from the source. A thing sitting
   * where its code puts it needs no entry, so dragging something back to where
   * it started removes it from the list by itself — the sketch never claims a
   * move that is not one.
   */
  function movesOf(scene) {
    const out = [];
    for (const it of itemsOf()) {
      const d = defaults.get(defKey(scene, it.id));
      if (!d) continue;
      const x = Math.round(it.obj.x);
      const y = Math.round(it.obj.y);
      if (x === d.x && y === d.y) continue;
      out.push({ id: it.id, label: it.label || String(it.id), from: { ...d }, to: { x, y } });
    }
    return out;
  }

  /** Write the current positions into this browser's memory. */
  function remember() {
    const scene = sceneOf();
    const e = {};
    for (const m of movesOf(scene)) e[m.id] = { ...m.to };
    if (Object.keys(e).length) moves[scene] = e;
    else delete moves[scene];
    writeStore(MOVE_KEY, moves);
    call(o.onMove);
  }

  /** Everything back to the numbers the game's own source has. */
  function reset() {
    const scene = sceneOf();
    for (const it of itemsOf()) {
      const d = defaults.get(defKey(scene, it.id));
      if (d) {
        it.obj.x = d.x;
        it.obj.y = d.y;
      }
    }
    remember();
  }

  /**
   * Scenes other than the open one pass through untouched. The panel is open to
   * one scene at a time, and saving must not wipe what was said about another.
   */
  const paint = {};
  const otherMoves = {};

  function readSketch(raw) {
    if (!raw || typeof raw !== "object" || !raw.scenes) return false;
    for (const k of Object.keys(paint)) delete paint[k];
    for (const k of Object.keys(otherMoves)) delete otherMoves[k];
    for (const [name, e] of Object.entries(raw.scenes)) {
      paint[name] = list(e && e.paint).map(unpackShape);
      otherMoves[name] = list(e && e.moves);
    }
    return true;
  }

  /** The whole sketch, in the shape it is saved and read in. */
  function sketchAll(stamp) {
    const here = sceneOf();
    const scenes = {};
    const names = new Set([...Object.keys(paint), ...Object.keys(otherMoves), here]);
    for (const name of names) {
      const shapes = list(paint[name]).map(packShape);
      const mv = name === here ? movesOf(here) : list(otherMoves[name]);
      if (shapes.length || mv.length) scenes[name] = { paint: shapes, moves: mv };
    }
    return { v: 1, stamp: stamp || Date.now(), scenes };
  }

  let stamp = 0;
  const local = readStore(SKETCH_KEY);
  if (readSketch(local)) stamp = +local.stamp || 0;

  function keepLocal() {
    stamp = Date.now();
    writeStore(SKETCH_KEY, sketchAll(stamp));
  }

  /**
   * Save the sketch into the game's own config folder, from where an assistant
   * reads it. The game does not write its own files: it asks the page around
   * it, which is signed in and whose server checks ownership — so this works on
   * the author's own game page and nowhere else.
   */
  function saveToGame() {
    if (typeof o.save !== "function" || call(o.canSave) === false) {
      return Promise.resolve({ saved: false, reason: "not-author" });
    }
    const body = JSON.stringify(sketchAll(Date.now()), null, 1);
    let out;
    try {
      out = o.save(file, body);
    } catch {
      return Promise.resolve({ saved: false, reason: "failed" });
    }
    return Promise.resolve(out).then(
      (res) => {
        if (!res || !res.saved) return { saved: false, reason: (res && res.reason) || "failed" };
        try {
          stamp = JSON.parse(body).stamp;
        } catch {
          /* the body is ours, so this cannot happen — and if it did, the stamp
             is the only thing lost and the save itself still happened. */
        }
        writeStore(SKETCH_KEY, JSON.parse(body));
        return { saved: true, body };
      },
      () => ({ saved: false, reason: "failed" }),
    );
  }

  /**
   * What the game already has, if anything, merged in — and the body of it, so
   * the panel knows when there is something left to save.
   *
   * Newer wins, the same rule the portal's other saved settings follow: a
   * sketch just made in this browser is not buried by an older file, and an
   * older browser copy does not bury a file someone just saved. Until this
   * answers, the panel assumes the game holds nothing, so a half-finished
   * sketch shows as unsaved straight away instead of after the fetch.
   */
  function syncFromGame() {
    if (typeof fetch !== "function") return Promise.resolve(null);
    return fetch(file, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !j.scenes) return null;
        const mine = sketchAll(1);
        const theirs = +j.stamp || 0;
        readSketch(j);
        const held = JSON.stringify(sketchAll(1));
        if (theirs < stamp) readSketch(mine);
        else stamp = theirs;
        return held;
      })
      .catch(() => null);
  }

  /** The half of this shared with the panel, which loads separately. */
  const core = {
    opts: o,
    canvas,
    file,
    sceneOf,
    itemsOf,
    defOf,
    restore,
    movesOf,
    remember,
    reset,
    paint,
    otherMoves,
    readSketch,
    sketchAll,
    keepLocal,
    saveToGame,
    syncFromGame,
    labels: list(o.labels).length ? list(o.labels) : LABELS,
    kinds: { ...KINDS, ...(o.kinds || {}) },
    close: () => api.close(),
    get size() {
      const s = o.size;
      if (s && isNum(s.w) && isNum(s.h)) return { w: s.w, h: s.h };
      return { w: (canvas && canvas.width) || 0, h: (canvas && canvas.height) || 0 };
    },
    local(clientX, clientY) {
      const p = call(o.toLocal, clientX, clientY);
      if (p && isNum(p.x) && isNum(p.y)) return p;
      if (!canvas || typeof canvas.getBoundingClientRect !== "function") return { x: 0, y: 0 };
      const r = canvas.getBoundingClientRect();
      const s = core.size;
      if (!r.width || !r.height) return { x: 0, y: 0 };
      return { x: ((clientX - r.left) / r.width) * s.w, y: ((clientY - r.top) / r.height) * s.h };
    },
  };

  let ui = null;
  let loading = false;

  const api = {
    /** Put this scene's things where the browser left them. Returns how many. */
    restore,
    /** Draw the overlay. Call it last in the frame; a no-op while closed. */
    draw(ctx) {
      if (ui && ctx) {
        try {
          ui.draw(ctx);
        } catch {
          /* A broken frame must not stop the game's own loop. */
        }
      }
    },
    /**
     * Open the panel, fetching it first. Resolves true once it is up, false if
     * it could not be fetched — the one case a game might want to report.
     */
    open() {
      if (ui) return Promise.resolve(true);
      if (loading) return Promise.resolve(false);
      loading = true;
      return import("./ui.js")
        .then((m) => {
          loading = false;
          if (ui) return true;
          call(o.onOpen);
          ui = m.createPanel(core);
          return true;
        })
        .catch(() => {
          loading = false;
          return false;
        });
    },
    close() {
      if (!ui) return;
      const u = ui;
      ui = null;
      try {
        u.destroy();
      } catch {
        /* nothing */
      }
      call(o.onClose);
    },
    toggle() {
      return ui ? (api.close(), Promise.resolve(false)) : api.open();
    },
    /** Whether the panel is up. A game guards its own input with this. */
    get active() {
      return !!ui;
    },
    /** What has been dragged and not yet written into the source. */
    moves: () => movesOf(sceneOf()),
    /**
     * Remember the current positions in this browser. The panel does this after
     * every drag; a game that moves something by its own means says so here.
     */
    remember,
    /** Everything in this scene back to the numbers its source has. */
    reset,
    /**
     * Save the sketch into the game's config folder. This is the panel's own
     * button, and it is here as well so a game can put one wherever it likes.
     * Resolves `{ saved: true }` or `{ saved: false, reason }` — never rejects.
     */
    saveSketch: saveToGame,
    /** The scene changed under the panel: its shapes and warnings are per scene. */
    refresh() {
      if (ui) {
        try {
          ui.refresh();
        } catch {
          /* nothing */
        }
      }
    },
    destroy() {
      api.close();
    },
  };
  return api;
}
