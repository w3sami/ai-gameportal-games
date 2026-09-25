// Dev unlock: with the portal's debug toggle on the author's own game page, every level is open in the menu and the
// view is not capped, so zooming the browser out shows more of the level.
// Strict on purpose: only the portal's word counts. portal-events seeds debug from ?debug / localStorage.debug before
// the portal answers, and keeps that guess when unframed; canWrite is true only on the owner's page (checked
// server-side), so requiring embedded + canWrite + debug ignores the guess everywhere, the public page included.
// Read-time only: store.unlocked is never touched, so real progress is kept and nothing reaches thruster-v1,
// which draft and live share on this origin.
import { portal, onPortal } from 'https://plugins.game.bigbools.fi/portal-events/v1/index.js';
const sync = () => {
  const on = !!(portal.embedded && portal.canWrite && portal.debug);
  if (on === devUnlock) return;                                // the first calls carry current values: no redraw for nothing
  devUnlock = on;
  resize();                                                    // the view cap follows the toggle too, see resize() in game.js
  if (mode === 'menu') showMenu();
};
onPortal('debug', sync);
onPortal('canWrite', sync);                                     // arrives separately from debug
