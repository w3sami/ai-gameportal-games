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

  const _showMenu = showMenu, _showComplete = showComplete, _reset = reset, _loadLevel = loadLevel, _readInput = readInput;
  let rival = null;                                           // {name, path} taken from the board

  // ---- What flew the run ----
  // Read off readInput(), the one place where a key, a thumb or a pad becomes a steer and a thrust. Watching events
  // instead would count a key that did nothing: a pause, a stray arrow in a menu, a tap on the wrong half. Here a
  // device is only credited on a tick where it was actually driving the rocket.
  const DEVKEY = 'thruster-dev-v1';
  const ORDER = ['keys','touch','mouse','pad'];
  let devs = {}; try { devs = JSON.parse(localStorage.getItem(DEVKEY)) || {}; } catch (e) {}
  const runDev = new Set();
  let ptrKind = 'touch';                                      // a pointer is a finger until one says otherwise
  let padTick = -1;
  const bestSeen = {};                                        // level -> best ticks at the last finish, so a new best is visible
  for (const k in store.bests) if (store.bests[k]) bestSeen[k] = store.bests[k].ticks;
  const devTag = () => ORDER.filter(d => runDev.has(d)).join(',') || null;

  addEventListener('pointerdown', e => { if (e.pointerType) ptrKind = e.pointerType === 'mouse' ? 'mouse' : 'touch'; }, true);

  window.readInput = function(){
    const inp = _readInput();
    if (running && mode === 'play'){
      const pad = padTick === ticks;
      if (pad) runDev.add('pad');
      // A pad plugin that drives the game by filling `keys` would otherwise read as a keyboard, so a tick the pad
      // claimed is not also credited to one. Drop this line if a pad and a keyboard should both count.
      else if (keys.thrust || keys.left || keys.right) runDev.add('keys');
      if (stick.active || thrTouch.active || arrows.size) runDev.add(ptrKind);
    }
    return inp;
  };

  function attach(ticksBest){
    const d = document.createElement('div');
    d.dataset.lbLevel = li;
    d.dataset.lbTitle = `${li+1}. ${L.name}`;
    if (ticksBest) d.dataset.lbPost = msOf(ticksBest);
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
    noteDevice(){ padTick = ticks; },                         // a pad is polled, not evented: its reader says so itself
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
