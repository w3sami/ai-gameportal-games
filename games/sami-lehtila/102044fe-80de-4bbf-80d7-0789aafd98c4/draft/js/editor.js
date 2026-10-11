// The level editor: the portal's sketchpad over the game, with its tile
// tool on the level's map. Painting tiles changes the level itself: the
// rows are the map (level.js), and saving writes them to
// config/level-<key>.json. The sketchpad's own shapes (boxes, arrows,
// strokes with a label and a note) are a sketch for the assistant, saved to
// config/sketch.json, for what painting cannot say.
//
// Opened from the tuning panel. While it is open the game is paused and the
// camera is the editor's: the wheel pans (shift: sideways), ctrl + wheel
// zooms, and the right or middle button drags the view.
//
// The sketchpad works in units of its own, U to a tile, so that its lines
// and labels (drawn in those units) keep a readable size.

import { createSketchpad } from 'https://plugins.game.bigbools.fi/sketchpad/v1/index.js';

const U = 32;

// the sketch's vocabulary, the same as Space Taxi's
const LABELS = [
  { key: 'seinä', color: '#ff5d7a' },
  { key: 'aukko', color: '#6fe3ff' },
  { key: 'alusta', color: '#7bf0a0' },
  { key: 'propsi', color: '#ffd479' },
  { key: 'pois', color: '#ff8a3d' },
  { key: 'reitti', color: '#c58cff' },
  { key: 'huomio', color: '#e9edff' },
];

const TILE_NAME = { stone: 'kivi', wood: 'puu', ice: 'jää', metal: 'metalli', pad: 'alusta', panel: 'paneeli' };
const TILE_COLOR = { stone: '#5a536b', wood: '#80532f', ice: '#9fdcf3', metal: '#7a8593', pad: '#ffd43b', panel: '#ff5a3a' };
const KIND_NAME = { start: 'alku', checkpoint: 'tarkistuspiste', exit: 'maali', button: 'nappi', card: 'kortti', door: 'ovi', platform: 'liikkuva taso' };
const KIND_COLOR = { start: '#7fd4ff', checkpoint: '#c9c2d6', exit: '#c58cff', platform: '#56657a' };
const SLOPE = { br: '◢', bl: '◣', tr: '◥', tl: '◤' };
const ORDER = ['stone', 'wood', 'ice', 'metal', 'pad', 'panel'];
const KIND_ORDER = ['start', 'checkpoint', 'exit', 'button', 'card', 'door', 'platform'];

// what a legend entry is, in a few words
function describe(e, legend) {
  if (e.tile) {
    let s = TILE_NAME[e.tile] || e.tile;
    if (e.slope) s += ' ' + SLOPE[e.slope];
    if (e.dir) s += ' nuoli';
    if (e.phase !== undefined) s += ` vaihe ${e.phase}`;
    if (e.speed !== undefined && e.speed !== 1) s += ` ×${e.speed}`;
    return s;
  }
  let s = KIND_NAME[e.kind] || e.kind;
  if (e.key) s += ` (${e.key}: ${legend[e.key]?.kind === 'card' ? 'kortti' : 'nappi'})`;
  if (e.kind === 'button' && e.time) s += ` ${e.time} s`;
  return s;
}

function colorOf(e, legend) {
  if (e.tile) return TILE_COLOR[e.tile] || '#999';
  if (e.color) return e.color;
  if (e.key) return legend[e.key]?.color || '#ccc';
  return KIND_COLOR[e.kind] || '#ccc';
}

// host: { canvas, renderer, level() (the LEVELS entry), world(), slime(),
// rebuild() (build the world again from level().rows), pause(on), save(path,
// body), canSave() }
export function createEditor(host) {
  const level = () => host.level();
  const savedRows = new Map();   // level key → its rows as last loaded or saved
  const rowsOf = () => level().rows;
  const dirty = () => (savedRows.get(level().key) ?? '') !== JSON.stringify(rowsOf());
  const remember = () => savedRows.set(level().key, JSON.stringify(rowsOf()));

  const tiles = {
    cell: U,
    // empty first, then the tiles by type, then the things
    palette() {
      const legend = host.world().legend;
      const rank = (e) => (e.tile ? ORDER.indexOf(e.tile) : ORDER.length + KIND_ORDER.indexOf(e.kind));
      const entries = Object.entries(legend).sort((a, b) => rank(a[1]) - rank(b[1]));
      return [{ key: '.', name: 'tyhjä', color: '#1d1726' }]
        .concat(entries.map(([key, e]) => ({ key, name: describe(e, legend), color: colorOf(e, legend) })));
    },
    get(cx, cy) {
      const rows = rowsOf();
      if (cy < 0 || cy >= rows.length || cx < 0 || cx >= rows[0].length) return null;
      return rows[cy][cx];
    },
    set(cx, cy, key) {
      const rows = rowsOf(), row = rows[cy];
      if (row === undefined || cx < 0 || cx >= row.length) return;
      rows[cy] = row.slice(0, cx) + key + row.slice(cx + 1);
      host.world().setCell(cx, cy, key);
      host.renderer.dirtyCell(cx, cy);
    },
    // a stroke ended: things, doors, platforms and panels come from the rows
    end: () => host.rebuild(),
    dirty,
    async save() {
      const body = JSON.stringify({ rows: rowsOf() }, null, 1) + '\n';
      const res = await host.save(`config/level-${level().key}.json`, body);
      if (res?.saved) remember();
      return res;
    },
  };

  // the things the game rules need, as warnings (they never block anything)
  function check() {
    const w = host.world(), out = [], box = (p) => ({ x: (p.x - 1) * U, y: (p.y - 2) * U, w: 2 * U, h: 2 * U });
    const starts = Object.entries(w.legend).filter(([, e]) => e.kind === 'start').map(([k]) => k);
    const n = [...rowsOf().join('')].filter((c) => starts.includes(c)).length;
    if (n !== 1) out.push({ text: `kentässä pitää olla tasan yksi alku (nyt ${n})` });
    if (!w.exits.length) out.push({ text: 'kentässä ei ole maalia' });
    for (const d of w.doors) {
      if (!w.buttons.some((b) => b.char === d.e.key) && !w.cards.some((k) => k.char === d.e.key)) {
        out.push({ text: `ovella ${d.char} ei ole nappia eikä korttia (${d.e.key})`, box: { x: d.x0 * U, y: d.y0 * U, w: d.w0 * U, h: d.h0 * U } });
      }
    }
    for (const k of w.cards) {
      if (!w.doors.some((d) => d.e.key === k.char)) out.push({ text: `kortille ${k.char} ei ole ovea`, box: box({ x: k.x, y: k.y + 1 }) });
    }
    return out;
  }

  const pad = createSketchpad({
    canvas: host.canvas,
    toLocal: (x, y) => { const p = host.renderer.toWorld(x, y); return { x: p.x * U, y: p.y * U }; },
    size: { get w() { return host.world().w * U; }, get h() { return host.world().h * U; } },
    scene: () => level().name,
    items: () => [],
    solids: () => host.world().movers.map((m) => ({ kind: m.kind === 'door' ? 'door' : 'platform', x: m.x * U, y: m.y * U, w: m.w * U, h: m.h * U })),
    check,
    labels: LABELS,
    lang: 'fi',
    side: 'left',
    snap: U / 4,
    tiles,
    save: host.save,
    canSave: host.canSave,
    onOpen: () => {
      if (!savedRows.has(level().key)) remember();
      const c = host.renderer.camera;
      host.renderer.free = { x: c.x, y: c.y, view: host.view() };
      host.pause(true);
    },
    onClose: () => {
      host.renderer.free = null;
      host.pause(false);
    },
  });

  // ---- the view while editing -------------------------------------------------

  const canvas = host.canvas;
  canvas.addEventListener('wheel', (e) => {
    const f = host.renderer.free;
    if (!pad.active || !f) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      f.view = Math.max(6, Math.min(120, f.view * Math.exp(e.deltaY * 0.002)));
      return;
    }
    const k = f.view / 600;
    f.x += (e.shiftKey ? e.deltaY : e.deltaX) * k;
    f.y += (e.shiftKey ? 0 : e.deltaY) * k;
  }, { passive: false });
  let panning = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!pad.active || (e.button !== 1 && e.button !== 2)) return;
    e.preventDefault();
    panning = { x: e.clientX, y: e.clientY };
  });
  addEventListener('pointermove', (e) => {
    const f = host.renderer.free;
    if (!panning || !f) return;
    const a = host.renderer.toWorld(panning.x, panning.y), b = host.renderer.toWorld(e.clientX, e.clientY);
    f.x -= b.x - a.x; f.y -= b.y - a.y;
    panning = { x: e.clientX, y: e.clientY };
  });
  addEventListener('pointerup', () => { panning = null; });
  canvas.addEventListener('contextmenu', (e) => { if (pad.active) e.preventDefault(); });

  // the sketchpad's picture over the game, in its own units
  function draw(g) {
    if (!pad.active) return;
    const { S, offX, offY } = host.renderer.view;
    g.save();
    g.setTransform(S / U, 0, 0, S / U, offX, offY);
    pad.draw(g);
    g.restore();
  }

  return {
    draw,
    toggle: () => pad.toggle(),
    get active() { return pad.active; },
    // a level was loaded: the sketch's shapes and warnings are per level
    refresh() { if (!savedRows.has(level().key)) remember(); pad.refresh?.(); },
  };
}
