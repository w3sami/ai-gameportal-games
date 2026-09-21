'use strict';
// Streak: levels cleared in order from the first, each on a single clean attempt. Kept out of game.js the way the
// leaderboard hooks are, and for the same reason — nothing in the flight model, the level data or the renderer moves
// for it. It reads the game's state, wraps four of its functions, and adds a line to two menus.
//
// The whole thing is one number. A streak can only begin at level 1 and only ever grows by one, so `store.streak` is
// both how many levels are in it and which level continues it: the level at index `store.streak`. Fly any other
// level, crash, or walk away from an attempt part-flown, and it is zero again and the next one starts at level 1.
(() => {
  if (typeof store.streak !== 'number') store.streak = 0;           // saves from before this existed
  if (typeof store.streakBest !== 'number') store.streakBest = 0;

  const CROWN = '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 7l4.6 3.6L12 4l5.4 6.6L22 7l-1.7 11H3.7z"/></svg>';
  const _reset = reset, _finish = finish, _showMenu = showMenu, _showComplete = showComplete, _readInput = readInput;
  let armed = false;                                                // this attempt is flying for the streak

  // The HUD line is its own element. The best-time line under it belongs to game.js, and to lbhooks while a rival is
  // being raced, so writing into it would mean the two taking turns clobbering each other.
  const skEl = document.createElement('div');
  skEl.id = 'streakline';
  $('hud').append(skEl);
  function hudLine(){
    const n = store.streak;
    skEl.textContent = !n ? '' : li === n ? `Streak ${n} on the line` : `Streak ${n} · level ${n+1} continues it`;
  }

  function lose(){
    const n = store.streak;
    armed = false;
    if (!n) return 0;
    store.streak = 0; saveSoon(); hudLine();
    return n;
  }

  // Both ends of a streak are read off the tick rather than from the place they happen: readInput() is the first
  // thing tick() calls, so a crash is simply `ship.state === 'dead'` on the following tick, and a run beginning is
  // the same condition game.js itself is about to test. Nothing in the flight code has to announce anything.
  window.readInput = function(){
    const inp = _readInput();
    if (mode === 'play'){
      if (armed && ship.state === 'dead'){
        const n = lose();
        if (n) msgSub.textContent = (msgSub.textContent ? msgSub.textContent + ' · ' : '') + `Streak of ${n} lost`;
      } else if (!running && ship.state === 'idle' && inp.thrust){
        if (li !== store.streak) lose();                            // a level out of turn ends it before the rocket moves
        armed = li === store.streak;                                // which, after that, can only mean level 1
        hudLine();
      }
    }
    return inp;
  };

  window.reset = function(){
    if (armed && running && ship.state !== 'finished') lose();      // an attempt given up part-flown is not a clean run
    _reset();
    hudLine();
  };

  window.finish = function(){
    _finish();
    const kept = armed;
    if (kept){
      armed = false;
      store.streak = li+1;
      if (store.streak > store.streakBest) store.streakBest = store.streak;
      saveSoon();
    }
    hudLine();
    if (lastResult){ lastResult.streaked = kept; lastResult.streak = store.streak; }
  };

  // ---- Menus ----
  function crowns(){
    for (const t of box.querySelectorAll('.tile[data-l]')){
      if (+t.dataset.l >= store.streak) continue;
      t.classList.add('crowned');
      t.insertAdjacentHTML('beforeend', CROWN);
    }
  }
  const span = (cls, text) => { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = text; return s; };
  function bar(){
    const n = store.streak, all = n >= LEVELS.length, d = document.createElement('div');
    d.className = 'streakbar';
    const head = span(n ? 'sk-on' : 'sk-off', '');
    if (n){ head.innerHTML = CROWN; head.append(`Streak ${n}`); } else head.textContent = 'No streak';
    d.append(head, span('sk-next', all ? 'Every level, clean.'
      : n ? `Level ${n+1} keeps it going; any other level starts you over.`
          : 'Clear level 1 without crashing to start one.'));
    if (store.streakBest) d.append(span('sk-best', `Best ${store.streakBest}`));
    return d;
  }
  // The board's placeholder, filled by leaderboard.js if it is there. Same shape as the one lbhooks leaves behind,
  // and inserted at the same point, which puts it after that one.
  function slot(){
    const d = document.createElement('div');
    d.dataset.lbStreak = store.streakBest;
    const settings = box.querySelector('.settings');
    if (settings) box.insertBefore(d, settings); else box.append(d);
    if (window.LB) window.LB.mount(box);
  }
  function dressMenu(){
    crowns();
    const grid = box.querySelector('.grid');
    if (grid) grid.after(bar());
    slot();
  }

  window.showMenu = function(){ _showMenu(); dressMenu(); };
  window.showComplete = function(){
    _showComplete();
    const r = lastResult;
    if (!r || !r.streaked) return;                                  // a level flown outside a streak says nothing about one
    const p = document.createElement('p');
    p.className = 'sk-note';
    p.innerHTML = CROWN;
    p.append(r.streak >= LEVELS.length ? `Streak ${r.streak}: every level, clean.` : `Streak ${r.streak}. Level ${r.streak+1} keeps it going.`);
    const sub = box.querySelector('.sub');
    if (sub) sub.after(p); else box.prepend(p);
    slot();
  };

  hudLine();
  if (mode === 'menu') dressMenu();                                 // game.js opened the first menu before this file ran
})();
