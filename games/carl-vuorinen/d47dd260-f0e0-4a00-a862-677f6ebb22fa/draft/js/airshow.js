'use strict';
/* =========================================================================
   AIRSHOW — smoke through the aerobatics takes time off (the biplane, TUNE.SMOKE; js/smoke.js draws it).
   - A figure (a set of gates flown as one, aeroGroups() in js/aerobatic.js: a loop, a slalom): smoke on from its first
     gate to its last, without a break, takes SMOKE_FIGURE s off.
   - A knife-edge slot or inverted hoop on its own (or another module's gate flown upside down, GATE_TYPES inverted, like
     js/fair.js's ribbon): smoke on for the last LEAD s before it takes SMOKE_GATE s off.
   Only for a gate flown clean: one with a penalty (not on edge, not upside down) earns nothing, and a figure with one
   in it earns nothing. A break shorter than GRACE (a thumb slipping) doesn't count as smoke off.
   - The smoke meter: holding smoke drains it (SMOKE_DRAIN per s, so full lasts 1 / SMOKE_DRAIN s), letting go refills
     it (SMOKE_REGEN per s), every hoop tops it up (SMOKE_HOOP), and an inverted hoop flown upside down (or another
     gate flown so, like the ribbon) fills it right up, so a long figure (a Cuban eight) can be smoked all through; run
     it dry and it stays off until it's back to UNLOCK. It shows where the boost meter does (the bar in the HUD, the ring round the button).
   Until a course has been finished once, a figure or gate flown without smoke gets a tip saying what it's worth (once a
   run for a figure, once for a gate), and smoke started too late before a gate says so; one missed with the meter run
   dry says that instead (once a run, finished or not).
   smokeMeter(P, want, dt) -> smoke on this frame (P.smokeLeft 0..1, P.smokeLock); airshowAuto(P, next) -> whether the
   autopilot smokes now (the demo shows the bonus being flown); createAirshowKit (GATE_KITS, js/sim.js): the scoring,
   calling s.bonus(sec, text) (js/game.js) while a run is on.
   ========================================================================= */
const AIRSHOW_DEFAULTS = { SMOKE_FIGURE: 2, SMOKE_GATE: 1, SMOKE_DRAIN: 0.11, SMOKE_REGEN: 0.06, SMOKE_HOOP: 0.1 };
Object.assign(TUNE, AIRSHOW_DEFAULTS);
Object.assign(TUNE_DEFAULTS, AIRSHOW_DEFAULTS);
const AIRSHOW = { LEAD: 0.5, GRACE: 0.15, UNLOCK: 0.2, AUTO_LEAD: 0.9 };

function smokeMeter(P, want, dt) {
  if (P.smokeLeft == null) { P.smokeLeft = 1; P.smokeLock = false; }
  const on = want && !P.smokeLock && P.smokeLeft > 0;
  if (on) {
    P.smokeLeft = Math.max(0, P.smokeLeft - TUNE.SMOKE_DRAIN * dt);
    if (P.smokeLeft === 0) P.smokeLock = true;
  } else {
    P.smokeLeft = Math.min(1, P.smokeLeft + TUNE.SMOKE_REGEN * dt);
    if (P.smokeLock && P.smokeLeft > AIRSHOW.UNLOCK) P.smokeLock = false;
  }
  return on;
}

const airshowFigure = (i) => { for (const g of aeroGroups()) if (i >= g.first && i <= g.last) return g; return null; };
const airshowInverted = (h) => h.kind === 'I' || !!(GATE_TYPES[h.kind] && GATE_TYPES[h.kind].inverted);
const airshowSingle = (i) => !!HOOPS[i] && (HOOPS[i].kind === 'K' || airshowInverted(HOOPS[i])) && !airshowFigure(i);
function airshowUntil(P, h) {                               // s until the plane crosses gate h, along its line
  const along = (h.pos.x - P.pos.x) * h.normal.x + (h.pos.y - P.pos.y) * h.normal.y + (h.pos.z - P.pos.z) * h.normal.z;
  return along / Math.max(P.speed, 1);
}
// the autopilot's smoke: through a figure once in it, and from AUTO_LEAD s before its first gate or a single gate
function airshowAuto(P, next) {
  const h = HOOPS[next];
  if (!h) return false;
  const g = airshowFigure(next);
  if (g && next > g.first) return true;
  if (!g && !airshowSingle(next)) return false;
  const s = airshowUntil(P, h);
  return s > -0.2 && s < AIRSHOW.AUTO_LEAD;
}

function createAirshowKit() {
  let fig = null;                                           // the figure being flown: { g, ok, tried, empty }
  let onFor = 0, offFor = 0, P = null, st = null, tipped = new Set(), early = false;
  const clean = (i) => { const h = HOOPS[i], r = GATE_TYPES[h.kind] && GATE_TYPES[h.kind].rule; return !(r && r(P, h)); };
  let last = false;                                         // passing the finishing gate: no tips, the run's over
  const tip = (kind, text) => { if (!last && st && st.playing && (st.fresh || kind === 'empty') && !tipped.has(kind)) { tipped.add(kind); st.toast(text, 3000); } };   // once a run each
  const EMPTY = 'Out of smoke: let go between manoeuvres so it refills.';
  const give = (sec, text) => { if (st && st.playing && st.bonus) st.bonus(sec, text); };
  return {
    build() {},
    reset() { fig = null; onFor = 0; offFor = 0; tipped.clear(); early = false; },
    update(s) {
      if (!TUNE.SMOKE) return;
      st = s; P = s.P;
      if (P.smoking) { onFor += s.dt; offFor = 0; } else { offFor += s.dt; if (offFor > AIRSHOW.GRACE) onFor = 0; }
      if (!fig) return;
      if (s.next <= fig.g.first || s.next > fig.g.last) { fig = null; return; }   // sent back to its start (or past it)
      if (fig.ok && onFor === 0) {                          // smoke off mid-figure
        fig.ok = false;
        if (s.playing) s.toast(P.smokeLock ? `Out of smoke: no bonus for the ${fig.g.name}.` : `Smoke off in the ${fig.g.name}: no bonus.`, 2200);
      }
    },
    pass(i) {
      if (!TUNE.SMOKE || !P) return;
      const g = airshowFigure(i), ok = clean(i), on = P.smoking;
      last = i === HOOPS.length - 1;
      if (ok && airshowInverted(HOOPS[i])) {                  // upside down through it: the smoke filled right up
        if (P.smokeLeft < 0.9) tip('refill', 'Upside down through a hoop fills the smoke right up.');   // when it made a difference
        P.smokeLeft = 1; P.smokeLock = false;
      }
      if (g) {
        if (i === g.first) fig = { g, ok: on && ok, tried: on, empty: !on && P.smokeLock };
        else if (fig && fig.g === g && !ok) fig.ok = false;
        if (i === g.last && fig && fig.g === g) {
          if (fig.ok && (on || offFor <= AIRSHOW.GRACE)) give(TUNE.SMOKE_FIGURE, `Smoke ${g.name}`);
          else if (fig.empty) tip('empty', EMPTY);
          else if (!fig.tried) tip('figure', `Smoke on all through the ${g.name} takes ${TUNE.SMOKE_FIGURE} s off.`);
          fig = null;
        }
        return;
      }
      if (!airshowSingle(i) || !ok) return;                // a penalty earns nothing
      if (on && onFor >= AIRSHOW.LEAD - 0.05) give(TUNE.SMOKE_GATE, HOOPS[i].kind === 'K' ? 'Smoke knife edge' : 'Smoke inverted');
      else if (on && !early && !last && st.playing && st.fresh) { early = true; st.toast('Smoke on a little sooner before the gate for the bonus.', 2600); }
      else if (!on && P.smokeLock) tip('empty', EMPTY);
      else if (!on) tip('gate', `Smoke on through a ${{ K: 'knife-edge slot', I: 'hoop upside down' }[HOOPS[i].kind] || 'gate upside down'} takes ${TUNE.SMOKE_GATE} s off.`);
    },
  };
}
GATE_KITS.push(createAirshowKit);
