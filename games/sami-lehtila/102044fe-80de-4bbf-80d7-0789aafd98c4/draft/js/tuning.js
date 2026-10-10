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
// A row whose min is 'color' is a colour picker instead.

import { portal, onPortal, savePortalFile } from 'https://plugins.game.bigbools.fi/portal-events/v1/index.js';
import { DEFAULTS } from './tune.js';

const TILE_ROWS = (type, name) => [
  [`tiles.${type}.grip`, `${name}: pito ×`, 0, 2, 0.01],
  [`tiles.${type}.magnet`, `${name}: magneetti ×`, 0, 4, 0.05],
];

const GROUPS = [
  ['Lima', [
    ['color', 'Väri', 'color'],
    ['nodes', 'Pisteitä kehällä', 3, 32, 1],
    ['radius', 'Säde: pisteen etäisyys keskeltä (ruutua)', 0.3, 3, 0.05],
    ['nodeRadius', 'Pisteen törmäyssäde = kuoren paksuus (ruutua)', 0.05, 0.6, 0.01],
    ['radialStiff', 'Jousi keskipisteeseen (1/s²)', 0, 1000, 1],
    ['edgeStiff', 'Jousi naapuripisteisiin (1/s²)', 0, 3000, 5],
    ['areaStiff', 'Pinta-alan jousi (1/s²)', 0, 1000, 1],
    ['pressure', 'Paine: tavoiteala × ympyrä', 0.2, 1.5, 0.01],
    ['spinLock', 'Kehä ei pyöri (0 = pyörii vapaasti, 1 = ei lainkaan)', 0, 1, 0.05],
    ['damping', 'Vaimennus: hytkyntä (1/s), ei hidasta lentoa', 0, 20, 0.1],
  ]],
  ['Liike', [
    ['gravity', 'Painovoima (ruutua/s²)', 0, 80, 1],
    ['crawlSpeed', 'Ryömintänopeus (ruutua/s)', 0, 20, 0.1],
    ['airControl', 'Ohjaus ilmassa (ruutua/s²)', 0, 60, 1],
    ['wallClimb', 'Seinään päin työntö kiipeää (0–1)', 0, 1, 0.05],
    ['letGo', 'Tikku poispäin irrottaa magneetin (0–1)', 0, 1, 0.05],
    ['slide', 'Valuu seinää alas (ruutua/s)', 0, 5, 0.05],
  ]],
  ['Pallo ja voima', [
    ['ballStiff', 'Jouset pallona ×', 1, 30, 0.5],
    ['ballPressure', 'Paine pallona: tavoiteala × ympyrä', 0.5, 1.5, 0.01],
    ['ballMagnet', 'Magneetti pallona ×', 0, 1, 0.05],
    ['ballBounce', 'Pomppu täydellä voimalla: iskusta takaisin (0–1)', 0, 1.2, 0.05],
    ['bounceEnergy', 'Voima kertoo pompun (0 = ei, 1 = suoraan)', 0, 1, 0.05],
    ['chargeTime', 'Hypyn lataus täyteen (s), 0 = ei latausta', 0, 2, 0.05],
    ['chargeMagnet', 'Magneetti täydellä latauksella ×', 1, 10, 0.1],
    ['popTime', 'Napautus on pallo vähintään (s)', 0, 1, 0.01],
    ['popMax', 'Ponnahdus max (ruutua/s): ladattu leikataan, lataamaton kovempi ei hyppää', 1, 80, 0.5],
    ['energyMax', 'Voima max', 1, 500, 1],
    ['energyRegen', 'Voiman palautuminen (/s)', 0, 200, 1],
    ['jumpCost', 'Hyppy maksaa per ponnahduksen ruutua/s', 0, 10, 0.05],
    ['bounceCost', 'Pomppu maksaa per lisätty ruutua/s', 0, 10, 0.05],
    ['ballDrain', 'Pallona oleminen kuluttaa (/s)', 0, 100, 1],
  ]],
  ['Imu', [
    ['tireAfter', 'Paikallaan täysi imu (s)', 0, 10, 0.1],
    ['tireTime', 'Sitten imu hiipuu nollaan (s), 0 = ei väsy', 0, 10, 0.1],
    ['suctionRecover', 'Liike palauttaa imun (s)', 0.01, 3, 0.01],
  ]],
  ['Seinät', [
    ['magnet', 'Magneetti per piste (ruutua/s² kosketuksessa)', 0, 300, 1],
    ['cling', 'Koko kehon veto pintaan (ruutua/s², painovoima on lattialla sama)', 0, 120, 1],
    ['magnetRange', 'Magneetin ulottuma kuoresta (ruutua)', 0, 2, 0.05],
    ['friction', 'Kitka × kuorma = pito', 0, 10, 0.1],
    ...TILE_ROWS('stone', 'Kivi'),
    ...TILE_ROWS('wood', 'Puu'),
    ...TILE_ROWS('ice', 'Jää'),
    ...TILE_ROWS('metal', 'Metalli'),
    ...TILE_ROWS('pad', 'Pomppualusta'),
    ...TILE_ROWS('panel', 'Hehkupaneeli'),
    ...TILE_ROWS('platform', 'Liikkuva taso'),
    ...TILE_ROWS('door', 'Ovi'),
  ]],
  ['Kenttä', [
    ['padSpeed', 'Pomppualusta heittää palloa (ruutua/s)', 0, 80, 0.5],
    ['padBounce', 'Pallo alustalta: iskusta takaisin, jos yli heiton (0–1,5)', 0, 1.5, 0.05],
    ['padSlime', 'Lima alustalta: osuus heitosta', 0, 1, 0.05],
    ['panel.off', 'Paneeli pimeänä (s)', 0, 10, 0.1],
    ['panel.warn', 'Paneeli vilkkuu ennen punaista (s)', 0, 5, 0.1],
    ['panel.on', 'Paneeli punaisena, tappaa (s)', 0, 10, 0.1],
    ['burnTime', 'Punainen paneeli tappaa yhdellä pisteellä (s); n pistettä n× nopeammin', 0.05, 10, 0.05],
    ['healTime', 'Kestävyys palautuu tyhjästä täyteen (s)', 0.1, 20, 0.1],
    ['healDelay', 'Palautuminen alkaa viime palamisesta (s)', 0, 5, 0.1],
    ['respawnTime', 'Kuolemasta takaisin (s)', 0, 5, 0.1],
    ['view', 'Näkymän korkeus (ruutua)', 8, 40, 1],
  ]],
  ['Vana', [
    ['trail.pool', 'Pisaroita poolissa', 10, 1000, 10],
    ['trail.spacing', 'Pisara per ryömitty matka (ruutua)', 0.05, 3, 0.05],
    ['trail.size', 'Pisaran koko (ruutua)', 0.02, 0.5, 0.01],
    ['trail.life', 'Pisaran elinaika (s)', 1, 120, 1],
    ['trail.splatSpeed', 'Roiske kun isku yli (ruutua/s)', 1, 40, 0.5],
    ['trail.splatCount', 'Roiskepisaroita', 0, 20, 1],
    ['trail.drip', 'Tippuminen katosta (/s per piste)', 0, 3, 0.05],
  ]],
  ['Simulaatio', [
    ['substeps', 'Alivaiheita per ruutu', 1, 30, 1],
    ['iterations', 'Rajoitekierroksia per alivaihe', 1, 20, 1],
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
        if (min === 'color') { d.appendChild(colorRow(path, label)); continue; }
        const row = document.createElement('label');
        row.className = 'tn-row';
        row.innerHTML = `<span class="tn-l">${label}</span>
          <input type="range" min="${min}" max="${max}" step="${step}">
          <input type="number" step="${step}">
          <button class="tn-def" title="Oletus">↺</button>`;
        const [range, num] = row.querySelectorAll('input');
        const show = () => { const v = get(T, path); range.value = v; num.value = +v.toFixed(5); };
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
    // keys typed into the panel are not the slime's
    for (const t of ['keydown', 'keyup']) el.addEventListener(t, (e) => { if (e.code !== 'Backquote') e.stopPropagation(); });
    el.querySelector('.tn-head').addEventListener('click', onHead);
    document.body.appendChild(el);
    refreshHead();
  }

  function colorRow(path, label) {
    const row = document.createElement('label');
    row.className = 'tn-row';
    row.innerHTML = `<span class="tn-l">${label}</span><input type="color"><span></span>
      <button class="tn-def" title="Oletus">↺</button>`;
    const input = row.querySelector('input');
    const show = () => { input.value = get(T, path); };
    const put = (v) => { set(T, path, v); show(); markDirty(); };
    input.addEventListener('input', () => put(input.value));
    row.querySelector('.tn-def').addEventListener('click', (e) => { e.preventDefault(); put(get(DEFAULTS, path)); });
    show();
    return row;
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
  // without the right to write, say why there is no save button and what to do instead
  const noSave = 'tallennus vain pelin omalla sivulla (/omat/…); täällä Kopioi';
  function markDirty() { dirty = true; state(portal.canWrite ? '• tallentamatta' : '• tallentamatta · ' + noSave); }
  function refreshHead() {
    if (!el) return;
    el.querySelector('[data-a="save"]').hidden = !portal.canWrite;
    if (dirty) markDirty();
    else state(portal.canWrite ? '' : noSave);
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
