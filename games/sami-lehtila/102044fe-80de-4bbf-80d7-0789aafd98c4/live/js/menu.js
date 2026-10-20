// The level menu: every level with the player's best time on it. It opens
// over a paused game (M, the controller's Start, or the button in the
// corner); the stick or the arrows move the choice, the ball button or a
// click starts that level, and M or Start closes it again.
//
// Best times live in this browser only (localStorage), a convenience that
// may be missing.

const KEY = 'lima.best';

function readBest() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function createMenu(levels, clockText, onPick) {
  const el = document.getElementById('levels'), list = el.querySelector('ol');
  let open = false, choice = 0, lastY = 0;
  let best = readBest();

  function render() {
    list.innerHTML = '';
    levels.forEach((lv, i) => {
      const li = document.createElement('li');
      const t = best[lv.name];
      li.innerHTML = `<span>${i + 1}. ${lv.name}</span><span class="best">${t != null ? clockText(t) : '–'}</span>`;
      li.classList.toggle('on', i === choice);
      li.addEventListener('click', () => pick(i));
      list.appendChild(li);
    });
  }

  function pick(i) {
    close();
    onPick(i);
  }

  function show(current) {
    open = true; choice = current; lastY = 0;
    best = readBest();
    render();
    el.hidden = false;
  }

  function close() {
    open = false;
    el.hidden = true;
  }

  // a run through level i in t seconds; true when it beats the best
  function record(i, t) {
    const name = levels[i].name;
    if (best[name] != null && best[name] <= t) return false;
    best[name] = t;
    try { localStorage.setItem(KEY, JSON.stringify(best)); } catch { /* kept for this visit only */ }
    return true;
  }

  // once a frame while open: the stick moves the choice a step per push
  function update(stick, select) {
    const y = Math.abs(stick.y) > 0.5 ? Math.sign(stick.y) : 0;
    if (y && y !== lastY) {
      choice = (choice + y + levels.length) % levels.length;
      render();
    }
    lastY = y;
    if (select) pick(choice);
  }

  el.querySelector('.close').addEventListener('click', close);

  return {
    show, close, update, record,
    get open() { return open; },
  };
}
