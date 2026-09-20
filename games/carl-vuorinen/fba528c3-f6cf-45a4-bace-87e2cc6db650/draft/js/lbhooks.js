'use strict';
// Leaderboard hooks, kept out of game.js on purpose: a placeholder div in two menus, a rival ghost, and a guard so
// a pilot typing a name is not also flying the rocket. Nothing in the flight code moves for it, and deleting two
// script tags takes it all out again.
//
// A rival is somebody else's path flown in place of your own best. It is the same object the local ghost already
// is, so nothing in tick() or render() has to know the difference: reset() builds the ghost, and this puts a
// different path into it afterwards.
(() => {
  const msOf = t => Math.round(t*1000/120);                   // a board holds whole numbers; for a time attack that is milliseconds

  const _showMenu = showMenu, _showComplete = showComplete, _reset = reset, _loadLevel = loadLevel;
  let rival = null;                                           // {name, path} taken from the board

  function attach(ticks){
    const d = document.createElement('div');
    d.dataset.lbLevel = li;
    d.dataset.lbTitle = `${li+1}. ${L.name}`;
    if (ticks) d.dataset.lbPost = msOf(ticks);
    const settings = box.querySelector('.settings');
    if (settings) box.insertBefore(d, settings); else box.append(d);
    if (window.LB) window.LB.mount(box);                      // before the module lands there simply is no board
  }

  function applyRival(){
    if (!rival) return;
    try {
      gPath = GP.decode(GP.unb64(rival.path));
      ghost = GP.pose(gPath, 0, {});
      bestEl.textContent = `Racing ${rival.name}, ${fmt(gPath.total)}`;
    } catch (e) { rival = null; }
  }

  window.reset = function(){ _reset(); applyRival(); };       // every restart and every death keeps the rival
  window.loadLevel = function(i){ rival = null; _loadLevel(i); };
  window.showMenu = function(){ rival = null; _showMenu(); attach(0); };
  window.showComplete = function(){ _showComplete(); const b = store.bests[li]; attach(b ? b.ticks : 0); };

  // game.js listens for keys on the window, so stopping the event at the modal is what keeps `f`, `r` and Space
  // out of the flight controls while a name is being typed.
  box.addEventListener('keydown', e => { if (e.target && e.target.tagName === 'INPUT') e.stopPropagation(); });

  // What the board may ask of the game. The replay is opaque on the board's side; this is the whole contract.
  window.Thruster = {
    replay(lv){ const b = store.bests[lv]; return b && b.path ? GP.fit(b.path) : null; },
    ticksOf(path){ return GP.ticks(path); },
    race(lv, name, path){
      if (!path || GP.ticks(path) < 1) return false;          // nothing is flown rather than something wrong
      if (lv !== li) _loadLevel(lv);
      rival = {name: String(name), path};
      reset();
      if (!gPath) return false;
      play();
      return true;
    },
  };

  if (mode === 'menu') attach(0);                             // game.js opened the first menu before this file ran
})();
