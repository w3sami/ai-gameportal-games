// The developer's tuning panel: every number in tune.js as a slider, applied
// live, saved back to config/tune.json through the portal.
//
// It shows while the portal's debug switch is on (the game's own page,
// /omat/<id>) or with ?debug in the address. Backquote (§ on a Finnish
// keyboard, left of 1) toggles it where debugging is allowed. Saving needs
// the game's own page, where portal.canWrite is true; elsewhere "Kopioi"
// puts the JSON on the clipboard.
//
// Each row is [path in T, label, min, max, step, scale?]. The range is what
// the slider allows, not what the value may be: tune.json can hold anything.
// Angles are stored in radians and shown in degrees: scale DEG converts, and
// min, max and step are then in degrees.

import { portal, onPortal, savePortalFile } from 'https://plugins.game.bigbools.fi/portal-events/v1/index.js';
import { DEFAULTS } from './tune.js';

const DEG = 180 / Math.PI;

const GEAR_ROWS = [
  ['maxSpeed', 'Huippunopeus (m/s)', 10, 50, 0.5],
  ['drag', 'Ilmanvastus', 0, 0.015, 0.0002],
  ['friction', 'Lumen kitka', 0, 0.15, 0.005],
  ['turnRate', 'Kääntyminen (°/s)', 30, 300, 1, DEG],
  ['grip', 'Pito (sivuluiston vaimennus)', 1, 20, 0.5],
  ['jump', 'Hypyn voima (m/s)', 1, 12, 0.1],
  ['spinRate', 'Pyörähdysnopeus (°/s)', 100, 1500, 10, DEG],
  ['flipRate', 'Volttinopeus (°/s)', 100, 1200, 10, DEG],
  ['hover', 'Leijunta pyöriessä (0–1)', 0, 1, 0.05],
];

const GROUPS = [
  ['Alastulo ja kaatuminen', [
    ['landPitch', 'Sallittu kallistus alastulossa (±°)', 10, 125, 1, DEG],
    ['headFirst', 'Pää edellä -raja (±°)', 70, 180, 1, DEG],
    ['landYaw', 'Sivuttain-raja (±°)', 5, 90, 1, DEG],
    ['sidewaysKeep', 'Sivuttain alastulo: vauhtia jää', 0.1, 1, 0.05],
    ['hardLoss', 'Kova alastulo: jarru per m/s', 0, 0.06, 0.002],
    ['buryTime', 'Lumessa pää edellä (s)', 0.5, 5, 0.1],
    ['ragdollTime', 'Ragdollin kesto (s)', 0.5, 5, 0.1],
    ['snowballSpeed', 'Lumipallo kun vauhti yli (m/s)', 3, 40, 0.5],
    ['snowballMax', 'Lumipallon maksimikoko (m)', 0.6, 6, 0.1],
    ['snowballGrow', 'Lumipallon kasvuvauhti (m/s)', 0.2, 8, 0.1],
    ['snowballTime', 'Lumipallon kesto (s)', 1, 6, 0.1],
  ]],
  ['Ilma ja temput', [
    ['gravity', 'Painovoima (m/s²)', 4, 30, 0.5],
    ['spinResponse', 'Pyörimisen reagointi (1/s)', 1, 30, 0.5],
    ['levelPitch', 'Volttiapu: ikkuna (±°)', 0, 115, 1, DEG],
    ['levelYaw', 'Pyörähdysapu: ikkuna (±°)', 0, 90, 1, DEG],
    ['levelRate', 'Avun nopeus (°/s)', 0, 600, 5, DEG],
  ]],
  ['Sukset', GEAR_ROWS.map(([k, ...r]) => ['skis.' + k, ...r])],
  ['Lauta', GEAR_ROWS.map(([k, ...r]) => ['board.' + k, ...r])],
  ['Maa', [
    ['tuckDrag', 'Kyykky: ilmanvastus ×', 0, 1, 0.05],
    ['tuckFriction', 'Kyykky: kitka ×', 0, 1, 0.05],
    ['tuckPush', 'Kyykky: lisävauhti (m/s²)', 0, 4, 0.1],
    ['brake', 'Jarru (m/s²)', 0, 25, 0.5],
    ['carveKeep', 'Kaarre: sivuvauhdista eteen', 0, 1, 0.05],
    ['chargeTime', 'Täyden hypyn kyykky (s)', 0.05, 1, 0.05],
    ['step', 'Seinäksi luettava porras (m)', 0.2, 1.5, 0.05],
  ]],
  ['Lähtö ja sauvat', [
    ['pushSpeed', 'Lähtötyöntö: vauhti (m/s)', 2, 20, 0.5],
    ['pushHop', 'Lähtötyöntö: hyppy (m/s)', 0, 6, 0.1],
    ['pushBelow', 'Hyppy työntää alle (m/s)', 0, 12, 0.5],
    ['poleBelow', 'Kyykky sauvoo alle (m/s)', 0, 15, 0.5],
    ['polePush', 'Sauvatyöntö (m/s)', 0, 5, 0.1],
    ['poleEvery', 'Sauvatyöntöjen väli (s)', 0.15, 1.5, 0.05],
    ['checkpointSlope', 'Checkpoint: minimikulma (°), loivempaan ramppi', 0, 30, 0.5],
    ['checkpointRun', 'Checkpoint: rampin pituus (m)', 4, 25, 0.5],
  ]],
  ['Tähdet ja efektit', [
    ['starSize', 'Tähden koko (m)', 0.5, 5, 0.1],
    ['starReach', 'Tähden keräysetäisyys (m)', 0.5, 6, 0.1],
    ['snowSpray', 'Lumipöly ×', 0, 8, 0.1],
    ['trailFrom', 'Vana alkaa (m/s)', 0, 40, 0.5],
    ['trailFull', 'Vana täysillä (m/s)', 1, 50, 0.5],
  ]],
  ['Pompput ja kaiteet', [
    ['bouncePower', 'Latvapomppu (m/s)', 2, 25, 0.5],
    ['balloonPower', 'Pallopomppu (m/s)', 2, 25, 0.5],
    ['awningPower', 'Markiisi (m/s)', 2, 25, 0.5],
    ['awningKeep', 'Markiisi: alamäkivauhtia jää', 0, 1, 0.05],
    ['railFriction', 'Kaiteen kitka (m/s²)', 0, 6, 0.1],
  ]],
  ['Kamera', [
    ['camera.dist', 'Etäisyys (m)', 3, 30, 0.5],
    ['camera.height', 'Korkeus (m)', 1, 25, 0.5],
    ['camera.lookAhead', 'Katse edelle (m)', 0, 25, 0.5],
    ['camera.fov', 'Näkökenttä (°)', 30, 100, 1],
    ['camera.turn', 'Kääntyy mukana (±°)', 0, 70, 1, DEG],
    ['camera.pullBack', 'Vetäytyy per m korkeutta', 0, 2, 0.05],
    ['camera.rise', 'Nousee per m korkeutta', 0, 2, 0.05],
  ]],
];

const get = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
function set(o, path, v) {
  const ks = path.split('.');
  const last = ks.pop();
  ks.reduce((a, k) => a[k], o)[last] = v;
}

const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const COL = { ok: '#3ecf6e', ragdoll: '#f0a030', bury: '#e5484d', skid: '#f0a030', ring: 'rgba(255,255,255,.15)' };
const RESULT = { ok: 'pystyssä', skid: 'liuku', ragdoll: 'ragdoll', bury: 'pää edellä' };

// Two dials for the landing limits. Angles are measured from straight up
// (pitch, seen from the side, forward to the right) or straight ahead (yaw,
// seen from above), clockwise on screen. The needle is the rider now; the
// dashed one is the last landing and what it led to.
function drawDials(g, T, s) {
  const W = g.canvas.width, H = g.canvas.height, R = H * 0.36;
  g.clearRect(0, 0, W, H);
  const sector = (cx, cy, a0, a1, col) => {
    g.beginPath(); g.moveTo(cx, cy);
    g.arc(cx, cy, R, -Math.PI / 2 + a0, -Math.PI / 2 + a1);
    g.closePath(); g.fillStyle = col; g.fill();
  };
  const needle = (cx, cy, a, len, col, dash, both) => {
    const x = Math.sin(a), y = -Math.cos(a);
    g.save(); g.setLineDash(dash ? [4, 4] : []); g.strokeStyle = col; g.lineWidth = dash ? 2 : 3;
    g.beginPath(); g.moveTo(cx - (both ? x * len : 0), cy - (both ? y * len : 0)); g.lineTo(cx + x * len, cy + y * len); g.stroke();
    g.restore();
    g.fillStyle = col; g.beginPath(); g.arc(cx + x * len, cy + y * len, dash ? 3 : 5, 0, TAU); g.fill();
  };
  const label = (x, y, text, col = '#d6e4ff', align = 'center') => {
    g.fillStyle = col; g.font = '11px ui-monospace, monospace'; g.textAlign = align; g.fillText(text, x, y);
  };
  const deg = (a) => Math.round((a * 180) / Math.PI) + '°';
  const air = s && s.mode === 'air';

  // pitch
  const lp = Math.min(T.landPitch, Math.PI), hf = Math.max(lp, Math.min(T.headFirst, Math.PI));
  let cx = W * 0.25, cy = H * 0.5;
  g.fillStyle = COL.ring; g.beginPath(); g.arc(cx, cy, R + 3, 0, TAU); g.fill();
  sector(cx, cy, -Math.PI, -hf, COL.bury); sector(cx, cy, hf, Math.PI, COL.bury);
  sector(cx, cy, -hf, -lp, COL.ragdoll); sector(cx, cy, lp, hf, COL.ragdoll);
  sector(cx, cy, -lp, lp, COL.ok);
  if (s?.lastLand) needle(cx, cy, -s.lastLand.pitch, R * 0.95, '#fff', true);
  const pitch = s ? wrap(s.trickPitch) : 0;
  needle(cx, cy, -pitch, R * 0.8, air ? '#fff' : 'rgba(255,255,255,.4)', false);
  label(cx, 12, 'kallistus (sivulta)');
  label(cx + R + 4, cy + 4, 'eteen', '#9fb4d8', 'left');
  label(cx, H - 4, air ? deg(-pitch) : '–');

  // yaw
  const ly = Math.min(T.landYaw, Math.PI / 2);
  cx = W * 0.75;
  g.fillStyle = COL.ring; g.beginPath(); g.arc(cx, cy, R + 3, 0, TAU); g.fill();
  sector(cx, cy, -Math.PI, Math.PI, COL.skid);
  sector(cx, cy, -ly, ly, COL.ok);
  sector(cx, cy, Math.PI - ly, Math.PI + ly, COL.ok);
  if (s?.lastLand) needle(cx, cy, -s.lastLand.yaw, R * 0.95, '#fff', true, true);
  const yaw = s ? wrap(s.trickYaw) : 0;
  needle(cx, cy, -yaw, R * 0.8, air ? '#fff' : 'rgba(255,255,255,.4)', false, true);
  label(cx, 12, 'kierto (ylhäältä)');
  label(cx, H - 4, air ? deg(-yaw) : '–');

  if (s?.lastLand) label(W / 2, H - 18, 'viimeisin: ' + RESULT[s.lastLand.result], COL[s.lastLand.result]);
}

export function createTuning(T, { onPause, rider } = {}) {
  const allowed = () => !portal.embedded || portal.canWrite;
  let el = null, dirty = false, open = false, dials = null;

  (function tick() {
    if (open && dials?.group.open) drawDials(dials.g, T, rider?.());
    requestAnimationFrame(tick);
  })();

  function build() {
    el = document.createElement('div');
    el.id = 'tuning';
    el.innerHTML = `<div class="tn-head"><b>Säädöt</b><span class="tn-state"></span>
      <button data-a="save">Tallenna</button><button data-a="copy">Kopioi</button>
      <button data-a="pause">Tauko</button><button data-a="close">×</button></div>`;
    GROUPS.forEach(([title, rows], gi) => {
      const d = document.createElement('details');
      d.open = gi === 0;
      d.innerHTML = `<summary>${title}</summary>`;
      if (gi === 0) {
        const c = document.createElement('canvas');
        c.className = 'tn-dials';
        c.width = 320; c.height = 150;
        d.appendChild(c);
        dials = { c, g: c.getContext('2d'), group: d };
      }
      for (const [path, label, min, max, step, scale = 1] of rows) {
        const row = document.createElement('label');
        row.className = 'tn-row';
        row.innerHTML = `<span class="tn-l">${label}</span>
          <input type="range" min="${min}" max="${max}" step="${step}">
          <input type="number" step="${step}">
          <button class="tn-def" title="Oletus">↺</button>`;
        const [range, num] = row.querySelectorAll('input');
        const show = () => { const v = get(T, path) * scale; range.value = v; num.value = +v.toFixed(scale === 1 ? 5 : 1); };
        const put = (v) => { if (!Number.isFinite(v)) return; set(T, path, v); show(); markDirty(); };
        range.addEventListener('input', () => put(+range.value / scale));
        num.addEventListener('change', () => put(+num.value / scale));
        row.querySelector('.tn-def').addEventListener('click', (e) => { e.preventDefault(); put(get(DEFAULTS, path)); });
        row.show = show;
        show();
        d.appendChild(row);
      }
      el.appendChild(d);
    });
    // keys typed into the panel are not the rider's
    for (const t of ['keydown', 'keyup']) el.addEventListener(t, (e) => { if (e.code !== 'Backquote') e.stopPropagation(); });
    el.querySelector('.tn-head').addEventListener('click', onHead);
    document.body.appendChild(el);
    refreshHead();
  }

  async function onHead(e) {
    const a = e.target.dataset?.a;
    if (a === 'close') toggle(false);
    if (a === 'pause') onPause?.();   // no argument: toggle
    if (a === 'copy') {
      try { await navigator.clipboard.writeText(JSON.stringify(T, null, 2)); state('kopioitu'); }
      catch { state('kopiointi estetty'); }
    }
    if (a === 'save') {
      state('tallennetaan…');
      const { saved, reason } = await savePortalFile('config/tune.json', JSON.stringify(T, null, 2) + '\n');
      if (saved) { dirty = false; state('tallennettu'); } else state('ei tallentunut: ' + reason);
    }
  }

  function state(text) { const s = el?.querySelector('.tn-state'); if (s) s.textContent = text; }
  function markDirty() { dirty = true; state('• tallentamatta'); }
  function refreshHead() {
    if (!el) return;
    el.querySelector('[data-a="save"]').hidden = !portal.canWrite;
    if (!dirty) state(portal.canWrite ? '' : 'tallennus vain pelin omalla sivulla');
  }

  function toggle(on = !open) {
    open = on && allowed();
    if (open && !el) build();
    if (el) el.hidden = !open;
  }

  onPortal('debug', (on) => toggle(on));
  // canWrite arrives after debug when framed, and decides whether debug may open
  onPortal('canWrite', () => { refreshHead(); if (portal.debug) toggle(true); });
  onPortal('pause', (on) => onPause?.(on));
  addEventListener('keydown', (e) => { if (e.code === 'Backquote' && allowed()) toggle(); });

  return { toggle, get open() { return open; } };
}
