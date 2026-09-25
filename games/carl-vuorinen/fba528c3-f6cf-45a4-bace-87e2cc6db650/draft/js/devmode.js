// Dev unlock: with the portal's debug toggle on (the author's own game page), every level is open in the menu.
// Read-time only: store.unlocked is never touched, so real progress is kept and nothing reaches thruster-v1,
// which draft and live share on this origin. Unframed, portal-events falls back to ?debug / localStorage.debug.
import { onPortal } from 'https://plugins.game.bigbools.fi/portal-events/v1/index.js';
onPortal('debug', on => {
  if (!!on === devUnlock) return;                              // the first call carries the current value: no redraw for nothing
  devUnlock = !!on;
  if (mode === 'menu') showMenu();
});
