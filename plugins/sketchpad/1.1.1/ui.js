/**
 * sketchpad's panel and overlay — the half that only loads when it is opened.
 *
 * `index.js` is the small half a game imports at the top of its main file: the
 * storage, the drag memory and `restore()`. Everything here — the collision
 * picture, the dragging, the painting and the box of controls — is fetched the
 * first time `open()` is called, so a published game ships no editor to a
 * player who will never see one.
 *
 * The panel carries its own stylesheet rather than asking the game for one. A
 * plugin that needed a CSS file copied into every game that used it would be a
 * plugin nobody could adopt in one line.
 */

const TEXT = {
  en: {
    title: "sketchpad",
    tool: "tool",
    move: "move",
    rect: "box",
    arrow: "arrow",
    free: "stroke",
    label: "label",
    selected: "selected",
    shapeText: "text for selection",
    askText: "what was meant to be here",
    pickShape: "draw or pick a shape",
    noItems: "this scene declares nothing movable",
    noShapes: "nothing painted yet",
    moveHint: "drag a handle or a body · arrows 1 px, shift {snap} px · shift frees the grid",
    tfHint: "round handle turns, diamond scales · shift frees their steps too",
    flipX: "mirror x",
    flipY: "mirror y",
    paintHint: "drag on the canvas · the label says what, the text says why",
    unwritten: "{n} move is only in this browser — save the sketch and ask for it to be written into the source",
    unwrittenN: "{n} moves are only in this browser — save the sketch and ask for them to be written into the source",
    resetAll: "reset all",
    confirm: "confirm",
    resetWarn: "puts everything back and wipes this scene's painting",
    didReset: "reset — undo puts it back",
    undo: "undo",
    didUndo: "last change undone",
    del: "delete shape",
    didDel: "shape deleted",
    save: "save sketch",
    saving: "saving…",
    saved: "saved into the game",
    close: "close",
    fail: {
      "not-author": "saving works only on your own game page",
      "not-owner": "only the game's author can save",
      unframed: "the game is not on a portal page",
      "bad-path": "the file name is not allowed",
      "bad-json": "the contents are not valid JSON",
      "too-big": "the sketch is too large to save",
      "config-full": "the config folder is full",
      quota: "the game is out of space",
      timeout: "the portal did not answer",
      refused: "the portal refused",
      failed: "it did not save",
    },
  },
  fi: {
    title: "luonnoslehtiö",
    tool: "kalu",
    move: "siirrä",
    rect: "laatikko",
    arrow: "nuoli",
    free: "veto",
    label: "label",
    selected: "valittu",
    shapeText: "valitun teksti",
    askText: "mitä tähän oli tarkoitus",
    pickShape: "piirrä tai valitse muoto",
    noItems: "tämä kenttä ei kerro siirrettäviä",
    noShapes: "ei vielä maalauksia",
    moveHint: "raahaa kahvasta tai rungosta · nuolet 1 px, shift {snap} px · shift vapauttaa ruudukosta",
    tfHint: "pyöreä kahva kääntää, vinoneliö skaalaa · shift vapauttaa myös niiden askeleen",
    flipX: "peilaa x",
    flipY: "peilaa y",
    paintHint: "vedä kankaalle · label kertoo mitä, teksti miksi",
    unwritten: "{n} siirto on voimassa vain tässä selaimessa — tallenna luonnos ja pyydä kirjoittamaan se lähdekoodiin",
    unwrittenN: "{n} siirtoa on voimassa vain tässä selaimessa — tallenna luonnos ja pyydä kirjoittamaan ne lähdekoodiin",
    resetAll: "palauta kaikki",
    confirm: "varmista",
    resetWarn: "palauttaa paikat ja pyyhkii tämän kentän maalaukset",
    didReset: "palautettu — kumoa palauttaa entisen",
    undo: "kumoa",
    didUndo: "viimeisin muutos kumottu",
    del: "poista muoto",
    didDel: "muoto poistettu",
    save: "tallenna luonnos",
    saving: "tallennetaan…",
    saved: "tallennettu peliin",
    close: "sulje",
    fail: {
      "not-author": "tallennus onnistuu vain omalta pelisivulta",
      "not-owner": "vain pelin tekijä voi tallentaa",
      unframed: "peli ei ole portaalin sivulla",
      "bad-path": "tiedostonimi ei kelpaa",
      "bad-json": "sisältö ei ole kelvollista JSONia",
      "too-big": "luonnos on liian iso tallennettavaksi",
      "config-full": "asetuskansio on täynnä",
      quota: "pelin tila on täynnä",
      timeout: "portaali ei vastannut",
      refused: "portaali kieltäytyi",
      failed: "tallennus ei onnistunut",
    },
  },
};

const BAD = "#ff3355";
const HANDLE = "#9ad8ff";
const PICK = "#ffd479";
const GRAB = 15;
/* Kierto- ja skaalauskahva istuvat ankkurin ympärillä, eivät olion päällä:
   olio voi olla minkä kokoinen tahansa, ja kahva joka on sen sisällä on kahva
   jota ei löydä. Skaalauskahvan etäisyys ON skaala, joten se liikkuu mukana. */
const RING = 52;
const ROT_STEP = 15;                           // astetta, shift vapauttaa
const SCALE_STEP = 0.05;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const D2R = Math.PI / 180;

const isNum = (v) => typeof v === "number" && isFinite(v);
const round = (v) => Math.round(v);
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const call = (fn, ...args) => {
  if (typeof fn !== "function") return undefined;
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
};
const listOf = (v) => (Array.isArray(v) ? v : []);

const CSS = `
.sketchpad {
  pointer-events: auto;
  position: fixed; top: 10px;
  width: min(304px, calc(100vw - 20px));
  max-height: calc(100vh - 20px);
  overflow-y: auto;
  touch-action: pan-y;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 14px 16px 16px;
  border-radius: 14px;
  background: rgba(8, 13, 30, .94);
  border: 1px solid rgba(120, 160, 255, .28);
  box-shadow: 0 18px 44px rgba(0, 0, 0, .55);
  color: #e9edff;
  font: 12px system-ui, -apple-system, "Segoe UI", sans-serif;
  z-index: 2147483000;
}
.sketchpad.left { left: 10px; }
.sketchpad.right { right: 10px; }
.sketchpad * { box-sizing: border-box; }
.sketchpad h2 {
  margin: 0 0 10px; font-size: 12px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase; color: #8a97be;
}
.sketchpad h2 em { font-style: normal; color: #ffd479; }
.sketchpad .row { margin-bottom: 11px; }
.sketchpad .row > label {
  display: flex; justify-content: space-between; gap: 8px;
  color: #a9b6dd; margin-bottom: 4px;
}
.sketchpad .row > label b { color: #ffd479; font-variant-numeric: tabular-nums; }
.sketchpad .seg { display: flex; flex-wrap: wrap; gap: 6px; }
.sketchpad .seg button {
  flex: 1 1 auto; min-width: max-content; max-width: 160px; white-space: nowrap;
  font: inherit; padding: 7px 9px;
  color: #a9b6dd; background: rgba(255,255,255,.06);
  border: 1px solid rgba(120,160,255,.26); border-radius: 9px; cursor: pointer;
}
.sketchpad .seg button.on { color: #08101f; background: #6fe3ff; border-color: #6fe3ff; font-weight: 600; }
.sketchpad .seg button:disabled { opacity: .4; cursor: default; }
.sketchpad .dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 2px;
  margin-right: 5px; vertical-align: -1px; flex: 0 0 auto;
}
.sketchpad input[type=text] {
  width: 100%; font: inherit; padding: 7px 9px; border-radius: 9px;
  color: #e9edff; background: rgba(255,255,255,.06);
  border: 1px solid rgba(120,160,255,.28);
  touch-action: auto; -webkit-user-select: text; user-select: text;
}
.sketchpad input[type=text]:focus { outline: none; border-color: rgba(111,227,255,.6); }
.sketchpad input[type=range] { width: 100%; accent-color: #ffd479; margin: 0; touch-action: none; }
.sketchpad ul { list-style: none; margin: 0; padding: 0; }
.sketchpad .list { position: relative; display: grid; gap: 4px; max-height: 196px; overflow: auto; }
.sketchpad .list li {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 8px; border-radius: 8px; cursor: pointer;
  background: rgba(255,255,255,.045); border: 1px solid transparent;
  color: #a9b6dd;
}
.sketchpad .list li.on { border-color: rgba(111,227,255,.55); color: #e9edff; }
.sketchpad .list li.empty { cursor: default; color: #6c789e; }
.sketchpad .list li .dot { width: 9px; height: 9px; margin: 0; }
.sketchpad .list li .n { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sketchpad .list li .v { color: #7f8cb5; font-variant-numeric: tabular-nums; font-size: 11px; }
.sketchpad .foot { display: flex; gap: 6px; margin-top: 12px; }
.sketchpad .foot button {
  flex: 1; font: inherit; font-weight: 600; padding: 8px 10px;
  color: #08101f; background: #ffd479; border: 0; border-radius: 11px; cursor: pointer;
}
.sketchpad .foot button.ghost {
  color: #e9edff; background: rgba(255,255,255,.07);
  border: 1px solid rgba(120,160,255,.3);
}
.sketchpad .foot button:disabled { opacity: .5; cursor: default; }
.sketchpad .note { min-height: 14px; margin: 8px 0 0; font-size: 11px; line-height: 1.5; color: #6fe3ff; }
.sketchpad .warn { margin: 8px 0 0; font-size: 11px; line-height: 1.55; color: #ff8fa3; }
.sketchpad .hint { margin: 6px 0 0; font-size: 11px; line-height: 1.5; color: #7f8cb5; }
canvas.sketchpad-on { cursor: crosshair; }
`;

function injectStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById("sketchpad-css")) return;
  const st = document.createElement("style");
  st.id = "sketchpad-css";
  st.textContent = CSS;
  (document.head || document.documentElement).append(st);
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
function button(cls, text, fn) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
}

/** `core` is what index.js keeps: storage, the scene and the game's callbacks. */
export function createPanel(core) {
  injectStyle();

  const o = core.opts;
  const T = TEXT[o.lang === "fi" ? "fi" : "en"];
  const SNAP = isNum(o.snap) && o.snap > 0 ? o.snap : 4;
  const canvas = core.canvas;
  const labels = core.labels;
  const colOf = (key) => (labels.find((l) => l.key === key) || labels[labels.length - 1] || {}).color || PICK;

  const box = el("div", `sketchpad ${o.side === "right" ? "right" : "left"}`);
  (document.body || document.documentElement).append(box);
  if (canvas && canvas.classList) canvas.classList.add("sketchpad-on");

  const TOOLS = [
    { key: "move", name: T.move },
    { key: "rect", name: T.rect },
    { key: "arrow", name: T.arrow },
    { key: "free", name: T.free },
  ];

  let tool = "move";
  let label = labels[0] ? labels[0].key : "note";
  let shapes = listOf(core.paint[core.sceneOf()]).slice();
  let sel = null;
  /* The label buttons do two things: pick the kind for the next shape, and fix
     one that came out wrong. The second only when the shape was picked from the
     list — a shape that was just drawn stays selected so its text can be typed,
     and choosing the next shape's kind must not relabel it. */
  let relabel = false;
  let drag = null;
  let warns = [];
  let note = "";
  let undoSnap = null;
  let savedBody = JSON.stringify({ v: 1, stamp: 1, scenes: {} });
  let checkT = 0;

  const isShape = (s) => shapes.includes(s);
  const sketchBody = () => JSON.stringify(core.sketchAll(1));
  const dirty = () => sketchBody() !== savedBody;

  function keep() {
    core.paint[core.sceneOf()] = shapes;
    core.keepLocal();
  }

  /* One step back, covering both the painting and the positions — otherwise
     undo would depend on which tool happened to be used last. The snapshot is
     taken when a drag starts, so undo takes back the whole drag and not one
     pixel of it. */
  function snapshot() {
    undoSnap = JSON.stringify({ shapes, pos: core.movesOf(core.sceneOf()) });
  }
  function undo() {
    if (!undoSnap) return;
    let back;
    try {
      back = JSON.parse(undoSnap);
    } catch {
      return;
    }
    undoSnap = null;
    shapes = back.shapes;
    sel = null;
    for (const it of core.itemsOf()) {
      const d = core.defOf(it.id);
      if (!d) continue;
      const m = back.pos.find((p) => p.id === it.id);
      it.obj.x = m ? m.to.x : d.x;
      it.obj.y = m ? m.to.y : d.y;
    }
    core.remember();
    keep();
    recheck();
    note = T.didUndo;
    build();
  }

  /* The game's own rules, run after every change. A warning is text and a red
     frame, never a block: the author decides what counts as a mistake. */
  function recheck() {
    warns = listOf(call(o.check)).filter((w) => w && w.text);
  }
  /* A game's check may be expensive — a flood fill over the whole level is not
     unusual — so a held arrow key does not run it on every repeat. A drag ends
     once and checks straight away; a key waits for a moment of quiet. */
  function queueCheck() {
    clearTimeout(checkT);
    checkT = setTimeout(() => {
      recheck();
      build();
    }, 180);
  }

  /* ------------------------------------------------------------------ paint */

  const boxOf = (it) => {
    const b = typeof it.box === "function" ? call(it.box) : it.box;
    if (b && isNum(b.x) && isNum(b.y) && isNum(b.w) && isNum(b.h)) return b;
    if (isNum(it.obj.w) && isNum(it.obj.h)) {
      return { x: it.obj.x, y: it.obj.y, w: it.obj.w, h: it.obj.h };
    }
    return null;
  };

  function styleFor(kind) {
    const k = core.kinds[kind];
    if (typeof k === "string") return { color: k, dash: null };
    if (k && typeof k === "object") return { color: k.color || "#9ad8ff", dash: k.dash || null };
    return { color: "#9ad8ff", dash: null };
  }

  function draw(ctx) {
    const size = core.size;
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    for (const s of listOf(call(o.solids))) {
      if (!s || !isNum(s.x) || !isNum(s.y)) continue;
      const st = styleFor(s.kind);
      ctx.strokeStyle = st.color;
      ctx.setLineDash(st.dash || []);
      if (isNum(s.r)) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.3);
        ctx.stroke();
      } else if (isNum(s.w) && isNum(s.h)) {
        /* Outlined a hair outside the box, not inside it: a line drawn inside
           a thing the game already draws disappears into it. */
        ctx.strokeRect(s.x - 1.2, s.y - 1.2, s.w + 2.4, s.h + 2.4);
      }
      ctx.setLineDash([]);
    }

    for (const s of shapes) painted(ctx, s, s === sel, size);
    if (drag && drag.shape) painted(ctx, drag.shape, true, size);

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = BAD;
    for (const w of warns) {
      const b = w.box;
      if (b && isNum(b.x) && isNum(b.w)) ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
    }
    ctx.lineWidth = 1.4;

    /* Dimmed while painting: then the handles are information rather than the
       tool in hand. */
    ctx.globalAlpha = tool === "move" ? 1 : 0.35;
    for (const it of core.itemsOf()) handle(ctx, it, size);
    ctx.restore();
  }

  function painted(ctx, s, on, size) {
    const col = colOf(s.label);
    ctx.save();
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = on ? 3.5 : 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let tx = s.x;
    let ty = s.y;
    if (s.kind === "rect") {
      ctx.globalAlpha = 0.14;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.globalAlpha = 1;
      ctx.strokeRect(s.x, s.y, s.w, s.h);
    } else if (s.kind === "arrow") {
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      const a = Math.atan2(s.y2 - s.y, s.x2 - s.x);
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - Math.cos(a - 0.4) * 14, s.y2 - Math.sin(a - 0.4) * 14);
      ctx.lineTo(s.x2 - Math.cos(a + 0.4) * 14, s.y2 - Math.sin(a + 0.4) * 14);
      ctx.closePath();
      ctx.fill();
      tx = s.x2;
      ty = s.y2;
    } else {
      const pts = listOf(s.pts);
      if (!pts.length) {
        ctx.restore();
        return;
      }
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      tx = pts[0][0];
      ty = pts[0][1];
    }
    tag(ctx, tx, ty - 7, s.text ? `${s.label}: ${s.text}` : s.label, col, on, size);
    ctx.restore();
  }

  /* Text on a plate of its own. A game's background is whatever it is, and
     coloured text on an unknown background is not text anyone can rely on. */
  function tag(ctx, x, y, text, col, on, size) {
    ctx.save();
    ctx.font = `${on ? "700 " : ""}11px system-ui, sans-serif`;
    const w = ctx.measureText(text).width;
    const px = Math.min(Math.max(x, 4), Math.max(4, size.w - w - 10));
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = "#080d1e";
    ctx.fillRect(px - 3, y - 11, w + 6, 14);
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.fillText(text, px, y);
    ctx.restore();
  }

  function handle(ctx, it, size) {
    const on = sel === it;
    const x = it.obj.x;
    const y = it.obj.y;
    if (!isNum(x) || !isNum(y)) return;
    const r = on ? 7 : 5;
    ctx.save();
    ctx.fillStyle = "#080d1e";
    ctx.strokeStyle = on ? PICK : HANDLE;
    ctx.lineWidth = on ? 2.4 : 1.6;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    if (on) {
      ctx.globalAlpha = 0.45; // crosshair, for reading the number off the scene
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.w, y);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      const t = core.tfOf(it);
      if (t.rot) {
        const [rx, ry] = rotAt(it);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(x, y, RING, 0, 6.3);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(rx, ry, 6, 0, 6.3);
        ctx.fill();
        ctx.stroke();
      }
      if (t.scale) {
        const [sx2, sy2] = scaleAt(it);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(sx2, sy2 - 7);
        ctx.lineTo(sx2 + 7, sy2);
        ctx.lineTo(sx2, sy2 + 7);
        ctx.lineTo(sx2 - 7, sy2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      tag(ctx, x + 11, y - 9, `${it.label || it.id}  ${reading(it)}`, PICK, true, size);
    }
    ctx.restore();
  }

  /* Kierto on asteina, koska luonnos on luettavaksi. Kahva istuu olion omassa
     kulmassa, jolloin se kertoo kulman ilman että sitä tarvitsee lukea. */
  const rotOf = (it) => (isNum(it.obj.rot) ? it.obj.rot : 0);
  const scaleOf = (it) => Math.abs(isNum(it.obj.sx) ? it.obj.sx : 1) || 1;
  function rotAt(it) {
    const a = rotOf(it) * D2R;
    return [it.obj.x + Math.cos(a) * RING, it.obj.y + Math.sin(a) * RING];
  }
  function scaleAt(it) {
    const a = (rotOf(it) + 90) * D2R;
    const r = RING * clamp(scaleOf(it), 0.25, 4);
    return [it.obj.x + Math.cos(a) * r, it.obj.y + Math.sin(a) * r];
  }

  /** Olion luvut yhtenä rivinä, siinä järjestyksessä kuin niitä luetaan. */
  function reading(it) {
    const o = it.obj;
    const t = core.tfOf(it);
    const k = core.knobOf(it);
    let out = `${round(o.x)}, ${round(o.y)}`;
    if (t.scale || t.flip) {
      const sx = isNum(o.sx) ? o.sx : 1;
      const sy = isNum(o.sy) ? o.sy : 1;
      if (sx !== 1 || sy !== 1) {
        out += ` · ${Math.abs(sx) === Math.abs(sy) ? Math.abs(sx) : `${sx}, ${sy}`}×`;
        if (sx < 0) out += ' ⇔';
        if (sy < 0) out += ' ⇕';
      }
    }
    if (t.rot && rotOf(it)) out += ` · ${core.tidy('rot', rotOf(it))}°`;
    if (k && isNum(o[k.key])) out += ` · ${k.key} ${core.tidy(k.key, o[k.key])}`;
    return out;
  }

  /* ------------------------------------------------------------------ input

     The canvas belongs to the game, so the game steps aside: `pad.active` is
     there for it to guard its own pointer handling and its own stick with. */
  const at = (e) => ({ ...core.local(e.clientX, e.clientY), free: !!e.shiftKey });
  const grid = (v, free) => (free ? round(v) : Math.round(v / SNAP) * SNAP);

  const near = (p, x, y, r) => (p.x - x) ** 2 + (p.y - y) ** 2 <= r * r;

  /* Valinta kulkee molempiin suuntiin, ja kankaalta päin se tarkoittaa että
     rivi pitää myös rullata näkyviin. Pelkkä korostus ei auta jos rivi on
     kahdenkymmenen muun alla — korostus jota ei näe on sama kuin ei mitään.
     Lasketaan käsin eikä scrollIntoView'lla, joka rullaisi myös koko sivua. */
  function reveal(ul, li) {
    if (!ul || !li) return;
    const top = li.offsetTop;
    const bottom = top + li.offsetHeight;
    if (top < ul.scrollTop) ul.scrollTop = top;
    else if (bottom > ul.scrollTop + ul.clientHeight) ul.scrollTop = bottom - ul.clientHeight;
  }

  /** Etäisyys pisteestä janalle, nuolten ja vetojen osumaa varten. */
  function distSeg(p, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / len)) : 0;
    return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy));
  }

  /** Päällimmäinen muoto pisteen alla, uusimmasta vanhimpaan. */
  function shapeAt(p) {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (s.kind === "rect") {
        if (hit({ x: p.x, y: p.y, w: 1, h: 1 }, { x: s.x, y: s.y, w: s.w, h: s.h })) return s;
      } else if (s.kind === "arrow") {
        if (distSeg(p, s.x, s.y, s.x2, s.y2) <= 10) return s;
      } else {
        const pts = listOf(s.pts);
        for (let j = 1; j < pts.length; j++) {
          if (distSeg(p, pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1]) <= 10) return s;
        }
      }
    }
    return null;
  }

  function pick(p) {
    /* Valitun omat muunnoskahvat ensin: ne ovat olion ulkopuolella, joten ne
       eivät voi jäädä minkään alle, mutta ne voivat jäädä toisen olion kahvan
       päälle jos ei katsota ensin. */
    if (sel && sel.obj && core.itemsOf().includes(sel)) {
      const t = core.tfOf(sel);
      if (t.rot && near(p, ...rotAt(sel), 11)) return { it: sel, mode: 'rot' };
      if (t.scale && near(p, ...scaleAt(sel), 11)) return { it: sel, mode: 'scale' };
    }
    let best = null;
    let bd = GRAB * GRAB;
    for (const it of core.itemsOf()) {
      const d = (it.obj.x - p.x) ** 2 + (it.obj.y - p.y) ** 2;
      if (d <= bd) {
        bd = d;
        best = it;
      }
    }
    if (best) return { it: best, mode: 'move' };
    /* A thing with a body can be taken by the body too: the handle sits at its
       anchor, and the anchor is not where you look while moving it. */
    for (const it of core.itemsOf()) {
      const b = boxOf(it);
      if (b && hit({ x: p.x, y: p.y, w: 1, h: 1 }, b)) return { it, mode: 'move' };
    }
    return null;
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const size = core.size;
    const p = at(e);
    if (p.x < 0 || p.y < 0 || p.x > size.w || p.y > size.h) return;
    e.preventDefault();
    if (tool === "move") {
      const got = pick(p);
      sel = got ? got.it : null;
      relabel = false;
      if (got) {
        snapshot();
        drag = { it: got.it, mode: got.mode, ox: got.it.obj.x - p.x, oy: got.it.obj.y - p.y };
      }
      build();
      return;
    }
    /* A painting's snapshot waits for the release: a click without a drag is
       not a shape, and it must not throw away what was undoable before it. */
    const x = round(p.x);
    const y = round(p.y);
    const s =
      tool === "rect"
        ? { kind: "rect", label, text: "", x, y, w: 0, h: 0 }
        : tool === "arrow"
          ? { kind: "arrow", label, text: "", x, y, x2: x, y2: y }
          : { kind: "free", label, text: "", pts: [[x, y]] };
    drag = { shape: s, x0: p.x, y0: p.y };
  }

  function onMove(e) {
    if (!drag) return;
    const p = at(e);
    if (drag.it) {
      const it = drag.it;
      if (drag.mode === "rot") {
        const deg = (Math.atan2(p.y - it.obj.y, p.x - it.obj.x) / D2R + 360) % 360;
        it.obj.rot = core.tidy("rot", p.free ? deg : Math.round(deg / ROT_STEP) * ROT_STEP);
      } else if (drag.mode === "scale") {
        const d = Math.hypot(p.x - it.obj.x, p.y - it.obj.y) / RING;
        const v = p.free ? d : Math.round(d / SCALE_STEP) * SCALE_STEP;
        const k = clamp(v, 0.1, 4);
        /* Merkki on peilaus eikä koko, joten se säilyy venytettäessä. */
        it.obj.sx = core.tidy("sx", Math.sign(isNum(it.obj.sx) ? it.obj.sx : 1) * k);
        it.obj.sy = core.tidy("sy", Math.sign(isNum(it.obj.sy) ? it.obj.sy : 1) * k);
      } else {
        it.obj.x = grid(p.x + drag.ox, p.free);
        it.obj.y = grid(p.y + drag.oy, p.free);
      }
      call(o.onMove);
      coords();
      return;
    }
    const s = drag.shape;
    if (s.kind === "rect") {
      s.x = round(Math.min(drag.x0, p.x));
      s.y = round(Math.min(drag.y0, p.y));
      s.w = round(Math.abs(p.x - drag.x0));
      s.h = round(Math.abs(p.y - drag.y0));
    } else if (s.kind === "arrow") {
      s.x2 = round(p.x);
      s.y2 = round(p.y);
    } else {
      const last = s.pts[s.pts.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) > 7 && s.pts.length < 160) {
        s.pts.push([round(p.x), round(p.y)]);
      }
    }
  }

  function onUp(e) {
    if (!drag) return;
    /* The last point is where the finger came up. Without this a box's corner
       would stay at the last move event, and a drag would end a little away
       from where it looked like it ended. */
    if (e && e.clientX !== undefined) onMove(e);
    const d = drag;
    drag = null;
    if (d.it) {
      core.remember();
      keep();
      recheck();
      build();
      return;
    }
    const s = d.shape;
    const tiny =
      s.kind === "rect"
        ? s.w < 6 && s.h < 6
        : s.kind === "arrow"
          ? Math.hypot(s.x2 - s.x, s.y2 - s.y) < 10
          : s.pts.length < 2;
    if (tiny) {
      /* Napsautus ilman vetoa ei ole uusi muoto — se on valinta. Ennen tätä
         maalaustilassa pystyi valitsemaan vain listasta, mikä on sama vika
         toisin päin: ruudulla näkyvää asiaa pitää voida osoittaa. */
      const under = shapeAt({ x: d.x0, y: d.y0 });
      if (under) {
        sel = under;
        label = under.label;
        relabel = true;
        build();
      }
      return;
    }
    snapshot();
    shapes.push(s);
    sel = s;
    relabel = false;
    keep();
    build();
    const inp = box.querySelector(".sketchpad-text");
    if (inp) inp.focus();
  }

  function onKey(e) {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.code === "Escape") {
      e.preventDefault();
      core.close();
      return;
    }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || !sel || !sel.obj) return;
    /* The arrow keys are free here because the game is expected to be paused
       while this is open; stopPropagation keeps it from reading them as input
       anyway. */
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) snapshot();
    const step = e.shiftKey ? SNAP : 1;
    sel.obj.x += d[0] * step;
    sel.obj.y += d[1] * step;
    core.remember();
    keep();
    queueCheck();
    coords();
  }

  /* -------------------------------------------------------------------- box */

  let coordEl = null;
  function coords() {
    if (!coordEl) return;
    coordEl.textContent = sel && sel.obj && core.itemsOf().includes(sel) ? reading(sel) : "—";
  }

  function segRow(name, items, isOn, choose, disabled) {
    const row = el("div", "row");
    const seg = el("div", "seg");
    for (const it of items) {
      const b = button(isOn(it) ? "on" : null, "", () => choose(it));
      if (it.color) {
        const dot = el("span", "dot");
        dot.style.background = it.color;
        b.append(dot);
      }
      b.append(document.createTextNode(it.name || it.key));
      if (disabled && disabled(it)) b.disabled = true;
      seg.append(b);
    }
    row.append(el("label", null, name), seg);
    box.append(row);
  }

  function moveSection() {
    let selRow = null;
    const row = el("div", "row");
    const lab = el("label");
    coordEl = el("b");
    lab.append(document.createTextNode(T.selected), coordEl);
    row.append(lab);
    const ul = el("ul", "list");
    const items = core.itemsOf();
    for (const it of items) {
      const li = el("li", sel === it ? "on" : null);
      const d = core.defOf(it.id);
      const off = d && (round(it.obj.x) !== d.x || round(it.obj.y) !== d.y);
      const dot = el("span", "dot");
      dot.style.background = core.kinds[it.kind] ? styleFor(it.kind).color : HANDLE;
      li.append(
        dot,
        el("span", "n", (off ? "• " : "") + (it.label || it.id)),
        el("span", "v", `${round(it.obj.x)}, ${round(it.obj.y)}`),
      );
      li.addEventListener("click", () => {
        sel = it;
        relabel = false;
        build();
      });
      if (it === sel) selRow = li;
      ul.append(li);
    }
    if (!items.length) ul.append(el("li", "empty", T.noItems));
    row.append(ul);
    box.append(row);
    reveal(ul, selRow);
    coords();

    const on = sel && sel.obj && items.includes(sel) ? sel : null;
    const t = on ? core.tfOf(on) : null;
    const knob = on ? core.knobOf(on) : null;

    /* Peilaus on etumerkki skaalassa, ei oma kenttänsä — samoin kuin canvasilla
       ja CSS:llä. Nappi kääntää sen, ja luku kertoo kumpi puoli on kumpi. */
    if (t && t.flip) {
      const seg = el("div", "seg");
      const mk = (text, key) =>
        button(on.obj[key] < 0 ? "on" : null, text, () => {
          snapshot();
          on.obj[key] = core.tidy(key, -(isNum(on.obj[key]) ? on.obj[key] : 1));
          core.remember();
          keep();
          queueCheck();
          build();
        });
      seg.append(mk(T.flipX, "sx"), mk(T.flipY, "sy"));
      const r = el("div", "row");
      r.append(seg);
      box.append(r);
    }

    if (knob) {
      const r = el("div", "row");
      const lab = el("label");
      const val = el("b", null, String(core.tidy(knob.key, on.obj[knob.key])));
      lab.append(document.createTextNode(knob.label || knob.key), val);
      const inp = el("input");
      inp.type = "range";
      inp.min = isNum(knob.min) ? knob.min : 0;
      inp.max = isNum(knob.max) ? knob.max : 200;
      inp.step = isNum(knob.step) ? knob.step : 1;
      inp.value = on.obj[knob.key];
      /* Kumottava kuva otetaan ennen kuin arvo ehtii muuttua: molemmat
         tapahtumat tulevat inputia aiemmin, hiirellä ja näppäimistöllä. */
      inp.addEventListener("pointerdown", snapshot);
      inp.addEventListener("keydown", snapshot);
      inp.addEventListener("input", () => {
        on.obj[knob.key] = core.tidy(knob.key, +inp.value);
        val.textContent = inp.value;
        call(o.onMove);
        core.remember();
        keep();
        queueCheck();
        coords();
      });
      r.append(lab, inp);
      box.append(r);
    }

    box.append(el("p", "hint", T.moveHint.replace("{snap}", String(SNAP))));
    if (t && (t.rot || t.scale)) box.append(el("p", "hint", T.tfHint));
  }

  function paintSection() {
    const row = el("div", "row");
    row.append(el("label", null, T.shapeText));
    const inp = el("input", "sketchpad-text");
    inp.type = "text";
    inp.placeholder = isShape(sel) ? T.askText : T.pickShape;
    inp.value = (isShape(sel) && sel.text) || "";
    inp.disabled = !isShape(sel);
    row.append(inp);
    box.append(row);

    const ul = el("ul", "list");
    let selName = null;
    let selRow = null;
    for (const s of shapes) {
      const li = el("li", sel === s ? "on" : null);
      if (s === sel) selRow = li;
      const dot = el("span", "dot");
      dot.style.background = colOf(s.label);
      const name = el("span", "n", s.text ? `${s.label}: ${s.text}` : s.label);
      if (s === sel) selName = name;
      li.append(dot, name, el("span", "v", s.kind === "rect" ? `${s.w}×${s.h}` : s.kind));
      li.addEventListener("click", () => {
        sel = s;
        label = s.label;
        relabel = true;
        build();
      });
      ul.append(li);
    }
    if (!shapes.length) ul.append(el("li", "empty", T.noShapes));
    box.append(ul);
    reveal(ul, selRow);
    /* The row follows the typing directly rather than rebuilding the box, which
       would take the caret away mid-word. The canvas reads the text every
       frame, so it keeps up on its own. */
    inp.addEventListener("input", () => {
      sel.text = inp.value;
      if (selName) selName.textContent = sel.text ? `${sel.label}: ${sel.text}` : sel.label;
      keep();
    });
    box.append(el("p", "hint", T.paintHint));
  }

  function build() {
    /* The panel holds the scene's shapes and the store holds every scene's, so
       they are lined up here rather than at each of the places that change one
       — a save that went out of the panel with a stale array is not a bug worth
       being able to write twice. */
    core.paint[core.sceneOf()] = shapes;
    box.replaceChildren();
    coordEl = null;
    const h = el("h2", null, `${T.title} — `);
    h.append(el("em", null, core.sceneOf()));
    box.append(h);

    segRow(
      T.tool,
      TOOLS,
      (t) => t.key === tool,
      (t) => {
        tool = t.key;
        if (tool === "move" && isShape(sel)) sel = null;
        if (tool !== "move" && !isShape(sel)) sel = null;
        build();
      },
    );
    segRow(
      T.label,
      labels,
      (l) => l.key === label,
      (l) => {
        label = l.key;
        if (relabel && isShape(sel)) {
          snapshot();
          sel.label = label;
          keep();
        }
        build();
      },
      () => tool === "move",
    );

    if (tool === "move") moveSection();
    else paintSection();

    if (warns.length) {
      const ul = el("ul", "warn");
      for (const w of warns.slice(0, 8)) ul.append(el("li", null, `⚠ ${w.text}`));
      if (warns.length > 8) ul.append(el("li", null, `…+${warns.length - 8}`));
      box.append(ul);
    }

    const mv = core.movesOf(core.sceneOf());
    if (mv.length) {
      const s = mv.length === 1 ? T.unwritten : T.unwrittenN;
      box.append(el("p", "hint", s.replace("{n}", String(mv.length))));
    }

    const noteEl = el("p", "note", note);
    note = "";

    /* Resetting wipes work, so it asks first. The question is in the button
       rather than a browser confirm: a game runs in a frame where its own
       windows are not a sure thing. The arming lapses by itself, so a button
       pressed by accident is not left waiting. */
    let armed = null;
    const disarm = () => {
      clearTimeout(armed);
      armed = null;
      resetBtn.textContent = T.resetAll;
      resetBtn.classList.add("ghost");
    };
    const resetBtn = button("ghost", T.resetAll, () => {
      if (!armed) {
        resetBtn.textContent = T.confirm;
        resetBtn.classList.remove("ghost");
        noteEl.textContent = T.resetWarn;
        armed = setTimeout(disarm, 5000);
        return;
      }
      disarm();
      snapshot();
      core.reset();
      shapes = [];
      sel = null;
      keep();
      recheck();
      note = T.didReset;
      build();
    });

    const undoBtn = button("ghost", T.undo, undo);
    undoBtn.disabled = !undoSnap;

    const delBtn = button("ghost", T.del, () => {
      const i = shapes.indexOf(sel);
      if (i < 0) return;
      snapshot();
      shapes.splice(i, 1);
      sel = null;
      keep();
      note = T.didDel;
      build();
    });
    delBtn.disabled = !isShape(sel);

    const saveBtn = button(null, T.save, () => {
      noteEl.textContent = T.saving;
      core.saveToGame().then((res) => {
        if (res.saved) {
          savedBody = sketchBody();
          build();
          noteEl.textContent = T.saved;
        } else {
          noteEl.textContent = T.fail[res.reason] || T.fail.failed;
        }
      });
    });
    saveBtn.disabled = !dirty();

    const acts = el("div", "foot");
    acts.append(resetBtn, undoBtn, delBtn);
    const ends = el("div", "foot");
    ends.append(saveBtn, button(null, T.close, () => core.close()));
    box.append(acts, ends, noteEl);
  }

  function destroy() {
    clearTimeout(checkT);
    if (canvas && canvas.removeEventListener) canvas.removeEventListener("pointerdown", onDown);
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerup", onUp);
    removeEventListener("pointercancel", onUp);
    removeEventListener("keydown", onKey, true);
    if (canvas && canvas.classList) canvas.classList.remove("sketchpad-on");
    box.remove();
  }

  /** The scene changed underneath: shapes, selection and warnings are per scene. */
  function refresh() {
    shapes = listOf(core.paint[core.sceneOf()]).slice();
    sel = null;
    drag = null;
    recheck();
    build();
  }

  if (canvas && canvas.addEventListener) canvas.addEventListener("pointerdown", onDown);
  addEventListener("pointermove", onMove);
  addEventListener("pointerup", onUp);
  addEventListener("pointercancel", onUp);
  addEventListener("keydown", onKey, true);

  recheck();
  build();
  core.syncFromGame().then((held) => {
    if (held === null) return;
    savedBody = held;
    shapes = listOf(core.paint[core.sceneOf()]).slice();
    sel = null;
    build();
  });

  return { draw, destroy, refresh };
}
