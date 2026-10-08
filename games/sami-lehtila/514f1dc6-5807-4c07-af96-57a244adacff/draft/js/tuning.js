// The developer's tuning panel: every number in tune.js as a slider, applied
// live, saved back to config/tune.json through the portal.
//
// It shows while the portal's debug switch is on (the game's own page,
// /omat/<id>) or with ?debug in the address. Backquote (§ on a Finnish
// keyboard, left of 1) toggles it where debugging is allowed. Saving needs
// the game's own page, where portal.canWrite is true; elsewhere "Kopioi"
// puts the JSON on the clipboard.
//
// Each row is [path in T, label, min, max, step]. The range is what the
// slider allows, not what the value may be: tune.json can hold anything.

import { portal, onPortal, savePortalFile } from 'https://plugins.game.bigbools.fi/portal-events/v1/index.js';
import { DEFAULTS } from './tune.js';

const GEAR_ROWS = [
  ['maxSpeed', 'Huippunopeus (m/s)', 10, 50, 0.5],
  ['drag', 'Ilmanvastus', 0, 0.015, 0.0002],
  ['friction', 'Lumen kitka', 0, 0.15, 0.005],
  ['turnRate', 'Kääntyminen (rad/s)', 0.5, 5, 0.05],
  ['grip', 'Pito (sivuluiston vaimennus)', 1, 20, 0.5],
  ['jump', 'Hypyn voima (m/s)', 1, 12, 0.1],
  ['spinRate', 'Pyörähdysnopeus (rad/s)', 2, 25, 0.5],
  ['flipRate', 'Volttinopeus (rad/s)', 2, 20, 0.5],
  ['hover', 'Leijunta pyöriessä (0–1)', 0, 1, 0.05],
];

const GROUPS = [
  ['Alastulo ja kaatuminen', [
    ['landPitch', 'Sallittu kallistus alastulossa (rad)', 0.2, 2.2, 0.05],
    ['headFirst', 'Pää edellä -raja (rad)', 1.2, 3.14, 0.05],
    ['landYaw', 'Sivuttain-raja (rad)', 0.1, 1.57, 0.05],
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
    ['levelPitch', 'Volttiapu: ikkuna (rad)', 0, 2, 0.05],
    ['levelYaw', 'Pyörähdysapu: ikkuna (rad)', 0, 1.57, 0.05],
    ['levelRate', 'Avun nopeus (rad/s)', 0, 10, 0.1],
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
    ['camera.turn', 'Kääntyy mukana (rad)', 0, 1.2, 0.05],
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

export function createTuning(T, { onPause } = {}) {
  const allowed = () => !portal.embedded || portal.canWrite;
  let el = null, dirty = false, open = false;

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
      for (const [path, label, min, max, step] of rows) {
        const row = document.createElement('label');
        row.className = 'tn-row';
        row.innerHTML = `<span class="tn-l">${label}</span>
          <input type="range" min="${min}" max="${max}" step="${step}">
          <input type="number" step="${step}">
          <button class="tn-def" title="Oletus">↺</button>`;
        const [range, num] = row.querySelectorAll('input');
        const show = () => { const v = get(T, path); range.value = v; num.value = +(+v).toFixed(5); };
        const put = (v) => { if (!Number.isFinite(v)) return; set(T, path, v); show(); markDirty(); };
        range.addEventListener('input', () => put(+range.value));
        num.addEventListener('change', () => put(+num.value));
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
