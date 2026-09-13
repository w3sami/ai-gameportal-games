/**
 * Debug-paneeli: sivussa oleva säädinlista, joka näkyy vain debug-tilassa.
 *
 *   import { createDebugPanel } from './debug.js';
 *
 *   const panel = createDebugPanel();
 *   panel.slider({ label: 'Herkkyys', min: 0.2, max: 2, step: 0.05,
 *                  value: stick.gain, onInput: v => stick.gain = v });
 *   panel.readout('Nopeus', () => Math.round(speed));
 *
 * Debug-tila on päällä jos osoitteessa on ?debug, tai jos selaimeen on
 * tallennettu lippu. Peli ajetaan kehyksessä, jossa osoitetta ei pääse
 * muokkaamaan, joten lippu on se tapa jolla tilan saa päälle kesken pelin:
 *
 *   localStorage.setItem('debug', '1')
 *
 * Kun debug ei ole päällä, jokainen metodi on tyhjä kutsu eikä DOMiin kosketa
 * lainkaan — paneelin voi siis jättää peliin pysyvästi.
 */

export function isDebug() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('debug') && q.get('debug') !== '0') return true;
  } catch (e) { /* osoite voi olla lukukelvoton */ }
  try {
    return localStorage.getItem('debug') === '1';
  } catch (e) {
    return false;
  }
}

const NOOP_PANEL = {
  enabled: false,
  slider: () => NOOP_PANEL,
  readout: () => NOOP_PANEL,
  button: () => NOOP_PANEL,
  destroy: () => {},
};

export function createDebugPanel(options = {}) {
  const enabled = options.enabled ?? isDebug();
  if (!enabled) return NOOP_PANEL;

  const root = document.createElement('div');
  root.style.cssText = [
    'position:fixed', 'z-index:2147483000',
    (options.corner === 'right' ? 'right:8px' : 'left:8px'),
    'top:8px', 'min-width:190px', 'max-width:min(280px,45vw)',
    'padding:8px 10px 10px',
    'background:rgba(8,12,24,.86)', 'backdrop-filter:blur(6px)',
    'border:1px solid rgba(140,180,255,.25)', 'border-radius:10px',
    'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#cfe0ff', 'user-select:none', '-webkit-user-select:none',
  ].join(';');

  // Paneeli on DOMissa canvasin päällä, joten sen omat painallukset eivät saa
  // valua peliin asti — muuten säätimen vetäminen ohjaisi myös pelaajaa.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart']) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }

  const head = document.createElement('div');
  head.textContent = options.title || 'debug';
  head.style.cssText = 'display:flex;justify-content:space-between;opacity:.55;margin-bottom:6px;letter-spacing:.08em;text-transform:uppercase';
  const close = document.createElement('span');
  close.textContent = '×';
  close.style.cssText = 'cursor:pointer;padding:0 2px';
  close.addEventListener('click', () => root.remove());
  head.appendChild(close);
  root.appendChild(head);

  const readouts = [];
  let raf = 0;

  function tick() {
    for (const r of readouts) {
      const v = String(r.get());
      if (v !== r.last) { r.last = v; r.el.textContent = v; }
    }
    raf = requestAnimationFrame(tick);
  }

  const panel = {
    enabled: true,

    /** Liukusäädin. onInput saa arvon numerona jokaisella muutoksella. */
    slider({ label, min = 0, max = 1, step = 0.01, value = 0, onInput }) {
      const row = document.createElement('label');
      row.style.cssText = 'display:block;margin:7px 0 0';

      const top = document.createElement('div');
      top.style.cssText = 'display:flex;justify-content:space-between;gap:8px';
      const name = document.createElement('span');
      name.textContent = label;
      const shown = document.createElement('span');
      shown.style.cssText = 'color:#7fe3ff';
      shown.textContent = String(value);
      top.append(name, shown);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      input.style.cssText = 'width:100%;margin:2px 0 0;accent-color:#6fe3ff';
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        shown.textContent = input.value;
        if (onInput) onInput(v);
      });

      row.append(top, input);
      root.appendChild(row);
      return panel;
    },

    /** Nimetty lukema, joka päivittyy itsestään joka ruudulla. */
    readout(label, get) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;margin-top:5px';
      const name = document.createElement('span');
      name.textContent = label;
      const val = document.createElement('span');
      val.style.cssText = 'color:#7fe3ff';
      row.append(name, val);
      root.appendChild(row);
      readouts.push({ el: val, get, last: null });
      if (!raf) raf = requestAnimationFrame(tick);
      return panel;
    },

    button(label, onClick) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'margin-top:7px;width:100%;padding:4px;border:1px solid rgba(140,180,255,.3);border-radius:6px;background:none;color:inherit;font:inherit;cursor:pointer';
      b.addEventListener('click', onClick);
      root.appendChild(b);
      return panel;
    },

    destroy() {
      if (raf) cancelAnimationFrame(raf);
      root.remove();
    },
  };

  document.body.appendChild(root);
  return panel;
}
