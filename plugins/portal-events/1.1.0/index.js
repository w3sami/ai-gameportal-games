/**
 * portal-events — what the page around a game knows, handed to the game.
 *
 *   import { portal, onPortal }
 *     from "https://plugins.game.bigbools.fi/portal-events/v1/index.js";
 *
 *   onPortal("lang", (lang) => setLanguage(lang));   // "fi" or "en"
 *   onPortal("debug", (on) => panel.toggle(on));
 *   setPortal("lang", "en");        // the player chose, inside the game
 *
 * A game is served from its own name inside a frame, so it cannot read the
 * address bar, cannot see the portal's cookies, and has no way of knowing
 * which language the page around it is in or whether the person looking at it
 * asked for debug. This hands those over, and nothing else.
 *
 * A handler runs once with the value as it stands and again on every change,
 * so one code path covers both and there is no "and also read it at startup"
 * to forget.
 *
 * It reads both ways. A game with a language switch of its own calls
 * `setPortal` and the portal changes to match, so a person choosing a language
 * once does not then find the page around the game disagreeing with it. There
 * is one language, and either end may set it.
 *
 * **Nothing here ever throws**, and `portal.ready` always resolves — including
 * against a portal that has never heard of this plugin, which is every portal
 * older than it. Waiting forever for a message that is not coming would be a
 * worse failure than carrying on with a sensible guess, so after a moment the
 * guess is what you get.
 */

/** Marks our own messages. Anything without it is not ours and is ignored. */
const ENVELOPE = "peliportaali";

/** How long a silent portal is given before its defaults are taken as final. */
const ANSWER_MS = 1000;

const LOCALES = ["fi", "en"];

const listeners = new Map();
let resolveReady;

function safely(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const embedded = safely(() => typeof window !== "undefined" && window.parent !== window, false);

/**
 * What to believe before the portal says otherwise — and for good, when a game
 * is opened directly rather than framed.
 *
 * The debug rule is deliberately the same one the debug-panel plugin applies on
 * its own, so the two can never disagree about whether debug is on.
 */
function guessLang() {
  const tag = safely(() => navigator.language, "") || "";
  const base = tag.toLowerCase().split("-")[0];
  return LOCALES.includes(base) ? base : "fi";
}

function guessDebug() {
  const asked = safely(() => {
    const q = new URLSearchParams(location.search);
    return q.has("debug") && q.get("debug") !== "0";
  }, false);
  if (asked) return true;
  return safely(() => localStorage.getItem("debug") === "1", false);
}

/**
 * The page around the game, as it stands right now.
 *
 * `embedded` is false when a game is opened on its own address instead of from
 * the portal, which is worth knowing because then nothing here will ever
 * change: the values are the game's own guesses and stay that way.
 */
export const portal = {
  lang: guessLang(),
  debug: guessDebug(),
  embedded,
  /** Resolves once the portal has answered, or once it is clear it will not. */
  ready: new Promise((resolve) => {
    resolveReady = resolve;
  }),
};

function emit(name, value) {
  for (const fn of listeners.get(name) ?? []) {
    // One handler throwing must not cost the others their turn, nor take the
    // message loop with it.
    try {
      fn(value, portal);
    } catch (err) {
      console.error("portal-events:", err);
    }
  }
}

/**
 * Applies a state message, announcing only what actually moved. A portal that
 * repeats itself — and it will, because it answers every game that says hello —
 * must not look like a change to the game.
 */
function apply(state) {
  for (const name of ["lang", "debug"]) {
    if (!(name in state)) continue;
    const value = state[name];
    if (name === "lang" && !LOCALES.includes(value)) continue;
    if (name === "debug" && typeof value !== "boolean") continue;
    if (portal[name] === value) continue;
    portal[name] = value;
    emit(name, value);
  }
}

/**
 * Listens for one thing the portal knows: `"lang"` or `"debug"`.
 *
 * The handler runs once with the current value, then on every change. Returns
 * the function that stops it.
 */
export function onPortal(name, fn) {
  if (typeof fn !== "function") return () => {};
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  // On a fresh task, so subscribing from the top of a module cannot run the
  // handler before the rest of that module exists.
  Promise.resolve().then(() => {
    if (!listeners.get(name)?.has(fn)) return;
    try {
      fn(portal[name], portal);
    } catch (err) {
      console.error("portal-events:", err);
    }
  });
  return () => listeners.get(name)?.delete(fn);
}

/**
 * Tells the portal what the player chose here — `"lang"` or `"debug"`.
 *
 * The value does not change on the spot. It changes when the portal says it
 * has, which arrives as an ordinary change through `onPortal`, so a game should
 * render from the handler and not from this call. That is what keeps the two
 * ends from ever holding different answers: there is one place the value is
 * decided, and this is a request to it rather than a second copy of it.
 *
 * Unframed there is no portal to ask, so the change takes effect here and now.
 *
 * Returns false for a value this does not carry, having done nothing.
 */
export function setPortal(name, value) {
  if (name === "lang" && !LOCALES.includes(value)) return false;
  if (name === "debug" && typeof value !== "boolean") return false;
  if (name !== "lang" && name !== "debug") return false;

  if (!embedded) {
    if (portal[name] !== value) {
      portal[name] = value;
      emit(name, value);
    }
    return true;
  }
  return safely(() => {
    window.parent.postMessage({ source: ENVELOPE, type: "set", [name]: value }, "*");
    return true;
  }, false);
}

function onMessage(event) {
  // The embedder is the credential. A game is served with
  // `frame-ancestors https://games.bigbools.fi`, so the only page that can be
  // this frame's parent is the portal — which makes "came from the parent"
  // exactly as strong as checking an origin, and it survives the portal being
  // served from a different name in development.
  if (event.source !== window.parent) return;
  const data = event.data;
  if (!data || data.source !== ENVELOPE || data.type !== "state") return;
  apply(data);
  settle();
}

let settled = false;
function settle() {
  if (settled) return;
  settled = true;
  resolveReady(portal);
}

if (typeof window !== "undefined" && embedded) {
  window.addEventListener("message", onMessage);
  // "I am here, and I loaded before you got round to telling me." The portal
  // answers with the state. Nothing identifying is in it, so it costs nothing
  // to send before knowing who is listening — which is just as well, since a
  // framed game cannot read its parent's address to find out.
  safely(() => window.parent.postMessage({ source: ENVELOPE, type: "ready" }, "*"));
  setTimeout(settle, ANSWER_MS);
} else {
  settle();
}

/** Stops listening. A game that never ends has no use for this. */
export function destroy() {
  if (typeof window !== "undefined") window.removeEventListener("message", onMessage);
  listeners.clear();
}
