'use strict';
// Leaderboard hooks, kept out of game.js on purpose. Phase one adds no state to the game: a placeholder div in two
// menus, and a guard so a pilot typing a name is not also flying the rocket. Nothing in the flight code moves for
// it, and deleting two script tags takes it all out again. Fold these into game.js when watch-and-race lands and
// the menus have to change anyway.
(() => {
  const msOf = t => Math.round(t*1000/120);                   // a board holds whole numbers; for a time attack that is milliseconds

  const _showMenu = showMenu, _showComplete = showComplete;

  function attach(ticks){
    const d = document.createElement('div');
    d.dataset.lbLevel = li;
    d.dataset.lbTitle = `${li+1}. ${L.name}`;
    if (ticks) d.dataset.lbPost = msOf(ticks);
    const settings = box.querySelector('.settings');
    if (settings) box.insertBefore(d, settings); else box.append(d);
    if (window.LB) window.LB.mount(box);                      // before the module lands there simply is no board
  }

  window.showMenu = function(){ _showMenu(); attach(0); };
  window.showComplete = function(){ _showComplete(); const b = store.bests[li]; attach(b ? b.ticks : 0); };

  // game.js listens for keys on the window, so stopping the event at the modal is what keeps `f`, `r` and Space
  // out of the flight controls while a name is being typed.
  box.addEventListener('keydown', e => { if (e.target && e.target.tagName === 'INPUT') e.stopPropagation(); });

  if (mode === 'menu') attach(0);                             // game.js opened the first menu before this file ran
})();
