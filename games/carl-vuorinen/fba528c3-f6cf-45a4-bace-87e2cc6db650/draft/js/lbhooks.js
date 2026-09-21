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

  // What flew the run. Watched here rather than in game.js because the events are the same ones the game listens
  // for, one layer further out: a control key pressed, or a finger or a mouse on the control surface. A future
  // gamepad reader has nothing to observe from outside, so it calls Thruster.noteDevice('pad') itself.
  const DEVKEY = 'thruster-dev-v1';
  const CTRL_KEYS = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyS','Space']);
  let devs = {}; try { devs = JSON.parse(localStorage.getItem(DEVKEY)) || {}; } catch (e) {}
  const runDev = new Set();
  const bestSeen = {};                                        // level -> best ticks as of the last finish, so a new best is visible
  for (const k in store.bests) if (store.bests[k]) bestSeen[k] = store.bests[k].ticks;

  function note(kind){ if (mode === 'play') runDev.add(kind); }
  const devTag = () => runDev.size === 0 ? null : runDev.size === 1 ? [...runDev][0] : 'mixed';

  window.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (CTRL_KEYS.has(e.code)) note('keys');
  }, true);
  window.addEventListener('pointerdown', e => note(e.pointerType === 'mouse' ? 'mouse' : 'touch'), true);

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

  window.reset = function(){ runDev.clear(); _reset(); applyRival(); };   // every restart and every death keeps the rival
  window.loadLevel = function(i){ rival = null; _loadLevel(i); };
  window.showMenu = function(){ rival = null; _showMenu(); attach(0); };
  window.showComplete = function(){
    _showComplete();
    const b = store.bests[li];
    if (b && bestSeen[li] !== b.ticks){                       // this run is the one now stored, so it is the one that flew it
      bestSeen[li] = b.ticks;
      const d = devTag();
      if (d) devs[li] = d; else delete devs[li];
      try { localStorage.setItem(DEVKEY, JSON.stringify(devs)); } catch (e) {}
    }
    attach(b ? b.ticks : 0);
  };

  // game.js listens for keys on the window, so stopping the event at the modal is what keeps `f`, `r` and Space
  // out of the flight controls while a name is being typed.
  box.addEventListener('keydown', e => { if (e.target && e.target.tagName === 'INPUT') e.stopPropagation(); });

  // What the board may ask of the game. The replay is opaque on the board's side; this is the whole contract.
  window.Thruster = {
    replay(lv){ const b = store.bests[lv]; return b && b.path ? GP.fit(b.path) : null; },
    device(lv){ return devs[lv] || null; },
    noteDevice(kind){ note(kind); },                          // for a reader the window cannot see, gamepad being the one coming
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
