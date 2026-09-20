/**
 * leaderboard — shared high-score boards for portal games.
 *
 * A game posts a score and reads a board. Nothing is configured and there is no
 * key: the portal knows which game is calling because the call goes to the
 * game's own name, and a game is only ever served under its own name.
 *
 *   import { submit, top } from "https://plugins.game.bigbools.fi/leaderboard/v1/index.js";
 *
 *   const { kept, rank, reason } = await submit({ score: 1200, name: "Sami" });
 *   const { entries } = await top({ limit: 10 });
 *
 * **Nothing here ever throws.** `submit` and `top` always resolve, and `reason`
 * says what went wrong. That is one rule with no exceptions, because an
 * exception to it is exactly the thing a game author forgets — and forgetting
 * costs the score *and* the rest of whatever the game was doing.
 *
 * A bug in the call is still loud: it goes to the console and is re-thrown on
 * its own stack, so it reaches `window.onerror` and a developer cannot miss it.
 * What it does not do is take the player's game-over screen with it.
 *
 * `score` is a whole number and the only thing the board sorts by — pick a unit
 * that needs no decimals (points, milliseconds, centimetres). `data` is yours:
 * any JSON object up to 2 kB, stored and handed back untouched.
 *
 * **A board is a kind of leaderboard; levels live inside it.** Pass `level` and
 * the ranking is scoped to it — level 3 does not compete with level 4, and each
 * level keeps its own hundred rows. The board carries the title, the styling
 * and the sort direction once, for all of its levels. Leave `level` out and
 * everything behaves exactly as before.
 *
 *   await submit({ board: "time-attack", level: "3", score: 6758 });
 *   const { entries } = await top({ board: "time-attack", level: "3" });
 *
 * A board keeps its best 100 entries and drops the worst to make room, so the
 * same player may hold several places. Use `configure_leaderboard` over MCP to
 * turn a board around when a *lower* score is the better one.
 */

const NAME_KEY = "leaderboard:name";
const MAX_NAME = 24;

/**
 * Games are served from `/api/play/<owner>/<gameId>/<channel>/...`, so the page
 * already knows which game it is. Reading it from the address means a game
 * carries no id it could get wrong, and a fork gets its own board for free.
 */
function detectGameId() {
  const parts = location.pathname.split("/").filter(Boolean);
  const at = parts.indexOf("play");
  const id = at >= 0 ? parts[at + 2] : undefined;
  if (!id) {
    throw new Error(
      "leaderboard: could not tell which game this is from the address. " +
      "Call configure({ gameId }) if the game is not served from /api/play/.",
    );
  }
  return id;
}

let gameIdOverride = null;

/** Only needed when a game is served from somewhere unusual, such as a test page. */
export function configure({ gameId } = {}) {
  if (gameId) gameIdOverride = gameId;
}

export function gameId() {
  return gameIdOverride ?? detectGameId();
}

function boardUrl(board) {
  return `/api/leaderboard/${gameId()}/${board}`;
}

/**
 * What a bug in the game's own call is reported as: a score that is not a whole
 * number, `data` over 2 kB, a board name with spaces in it, a game id that is
 * not this game.
 *
 * It reaches a developer through `window.onerror` and the console, never by
 * rejecting the promise a game is waiting on. `status` and `kind` are on it so
 * an error handler can tell it apart without reading the English.
 */
export class LeaderboardError extends Error {
  constructor(message, { status, kind }) {
    super(message);
    this.name = "LeaderboardError";
    this.status = status;
    this.kind = kind;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reports a mistake in the game's own call as loudly as an uncaught error,
 * without being one for the caller.
 *
 * Re-thrown from a fresh task so it lands on `window.onerror` with its stack
 * intact — the thing a developer actually notices — while the game's own flow
 * carries on to the next line.
 */
function reportBug(error) {
  console.error("leaderboard:", error);
  setTimeout(() => {
    throw error;
  });
}

/** The shape `submit` answers with when the score is not on the board. */
const notKept = (reason, message) => ({
  kept: false,
  reason,
  message,
  entry: null,
  rank: null,
  total: null,
  board: null,
});

/**
 * One request, with the transient failures absorbed.
 *
 * Returns `{ ok: true, body }`, or `{ ok: false, reason, message }` for
 * something nobody can help — the player's connection, the portal restarting,
 * a busy minute. Throws only for the caller's own mistakes.
 *
 * A wait is honoured when it is short enough to be worth waiting through. A
 * game-over screen that sits there for forty seconds is worse than a score that
 * did not make it.
 */
async function call(url, options, { attempts = 3, maxWaitMs = 4000 } = {}) {
  let last = { ok: false, reason: "offline", message: "could not reach the leaderboard" };

  for (let attempt = 0; attempt < attempts; attempt++) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (err) {
      // No connection, or the page is going away. Worth one more try.
      last = { ok: false, reason: "offline", message: err.message };
      if (attempt < attempts - 1) await sleep(500 * (attempt + 1));
      continue;
    }

    let body = null;
    try {
      body = await response.json();
    } catch {
      // An empty or non-JSON body from a proxy. The status still says enough.
    }

    if (response.ok) return { ok: true, body };

    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? body?.retryAfter ?? 0) * 1000;
      last = { ok: false, reason: "busy", message: body?.error ?? "too many scores just now" };
      if (attempt < attempts - 1 && wait > 0 && wait <= maxWaitMs) {
        await sleep(wait + 250);
        continue;
      }
      return last;
    }

    if (response.status >= 500) {
      last = { ok: false, reason: "server", message: body?.error ?? `leaderboard: ${response.status}` };
      if (attempt < attempts - 1) await sleep(500 * (attempt + 1));
      continue;
    }

    // 400 or 404: the request itself is wrong, and sending it again will not
    // make it right. The game's bug — shouted at the developer, handed back to
    // the caller as an ordinary answer.
    const bug = new LeaderboardError(body?.error ?? `leaderboard: ${response.status}`, {
      status: response.status,
      kind: response.status === 404 ? "unknown-game" : "invalid",
    });
    reportBug(bug);
    return { ok: false, reason: bug.kind, message: bug.message };
  }

  return last;
}

/** The name this browser last posted under. Empty when it has never posted. */
export function getName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    // Private mode, or storage turned off. A name is a convenience, not state
    // the game depends on.
    return "";
  }
}

export function setName(name) {
  const clean = String(name).replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  try {
    localStorage.setItem(NAME_KEY, clean);
  } catch {
    // Same as above: remembering is best effort.
  }
  return clean;
}

/**
 * Posts one score.
 *
 * Always resolves, and `kept` is the whole answer: true when the score is on
 * the board, false when it is not. A game only has to handle one case, and it
 * is a case it already has — "you did not make the board".
 *
 *   const { kept, rank, entry, reason } = await submit({ score });
 *
 * `reason` says why a score was not kept, in two families:
 *
 * - **Not this time.** "full" when a better hundred already hold the board,
 *   "busy" when this address has posted a great many just now, "offline" when
 *   the player has no connection, "server" when the portal is having a moment.
 *   The last three deserve a quieter message than "full": nothing was beaten,
 *   it just did not arrive.
 * - **Your own bug.** "invalid" for a score with decimals, `data` over 2 kB, a
 *   board name with spaces, a missing name; "unknown-game" when the address
 *   does not hold the game it claims. These also reach the console and
 *   `window.onerror`, so they are impossible to miss while writing the game —
 *   but they still do not throw here. See [[LeaderboardError]].
 *
 * It never rejects. Not for the network, not for a bug, not for anything.
 */
export async function submit({ score, name, board = "default", level, data = {} } = {}) {
  let result;
  try {
    const who = name === undefined ? getName() : setName(name);
    if (!who) {
      throw new LeaderboardError(
        "leaderboard: no name to post under. Ask the player for one and pass it " +
        "as `name`, or call setName() once.",
        { status: 0, kind: "invalid" },
      );
    }
    result = await call(boardUrl(board), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ score, name: who, data, level }),
    });
  } catch (err) {
    // Everything that can still throw is the game's own doing: no name, a game
    // id the address does not hold, `data` that will not stringify. Loud, but
    // not in the caller's face.
    reportBug(err);
    return notKept(err.kind ?? "invalid", err.message);
  }

  if (!result.ok) return notKept(result.reason, result.message);
  return { ...result.body, reason: result.body.kept ? null : "full", message: null };
}

/**
 * Reads a page of a board, best first.
 *
 * `around` takes an entry id — the one `submit` just returned — and centres the
 * page on it, which is how you show a player their own place without knowing
 * their rank first.
 */
export async function top({ board = "default", level, limit = 10, offset, around } = {}) {
  let result;
  try {
    const query = new URLSearchParams({ limit: String(limit) });
    if (level !== undefined) query.set("level", String(level));
    if (offset !== undefined) query.set("offset", String(offset));
    if (around !== undefined) query.set("around", String(around));
    result = await call(`${boardUrl(board)}?${query}`);
  } catch (err) {
    reportBug(err);
    result = { ok: false, reason: err.kind ?? "invalid", message: err.message };
  }
  // A board that could not be read is an empty board with a reason on it, so a
  // game renders the same table either way.
  if (!result.ok) {
    return { board: null, total: 0, entries: [], reason: result.reason, message: result.message };
  }
  return { ...result.body, reason: null, message: null };
}

/** Every board this game has, with its settings. Empty when it could not ask. */
export async function boards() {
  try {
    const result = await call(`/api/leaderboard/${gameId()}`);
    return result.ok ? result.body.boards : [];
  } catch (err) {
    reportBug(err);
    return [];
  }
}

/**
 * The panel's own look, deliberately the *same vocabulary* as the board page the
 * portal hosts: same custom properties, same class names. Style a board once and
 * it looks the same in the game and in the portal's popup.
 *
 * The background defaults to transparent rather than to the page colour, because
 * a panel usually sits over a game that has already drawn something.
 */
const PANEL_CSS = `
:host {
  --lb-bg: transparent;
  --lb-fg: currentColor;
  --lb-muted: #98a2b8;
  --lb-accent: #7c8cff;
  --lb-row-bg: rgb(255 255 255 / 0.06);
  --lb-line: rgb(255 255 255 / 0.12);
  --lb-radius: 10px;
  --lb-font: inherit;
  --lb-gap: 0.35rem;
  display: block;
  background: var(--lb-bg);
  color: var(--lb-fg);
  font-family: var(--lb-font);
  line-height: 1.5;
}
* { box-sizing: border-box; }
.lb-title { margin: 0 0 0.5rem; font-size: 1.1em; }
.lb-total { color: var(--lb-muted); font-size: 0.8em; font-weight: 400; }
.lb-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--lb-gap); }
.lb-row {
  display: grid;
  grid-template-columns: 2.2em 1fr auto;
  align-items: baseline;
  gap: 0.6em;
  background: var(--lb-row-bg);
  border: 1px solid var(--lb-line);
  border-radius: var(--lb-radius);
  padding: 0.3em 0.6em;
}
.lb-rank { color: var(--lb-muted); font-variant-numeric: tabular-nums; }
.lb-name { overflow-wrap: anywhere; }
.lb-score { font-variant-numeric: tabular-nums; font-weight: 600; }
.lb-row-1 .lb-rank, .lb-row-2 .lb-rank, .lb-row-3 .lb-rank { color: var(--lb-accent); }
.lb-you { border-color: var(--lb-accent); }
.lb-empty, .lb-error { color: var(--lb-muted); margin: 0.25em 0; }
`;

/**
 * `<leaderboard-panel>` — the board inside the game, for a game that would rather
 * not draw one.
 *
 *   <leaderboard-panel board="default" limit="10"></leaderboard-panel>
 *
 * Three ways to make it yours, in the order you should reach for them:
 *
 * 1. **The board's own stylesheet.** Whatever `configure_leaderboard { css }`
 *    was given is applied here too, so a board styled once looks the same in the
 *    game and in the portal's popup. `theme="none"` turns that off.
 * 2. **Custom properties**, which reach in from the game's own stylesheet
 *    because custom properties cross a shadow boundary: `leaderboard-panel {
 *    --lb-accent: gold; --lb-row-bg: #222 }`.
 * 3. **`::part()`**, for anything the properties do not cover:
 *    `leaderboard-panel::part(row) { ... }`. Parts are title, total, list, row,
 *    rank, name, score, empty and error.
 *
 * Attributes: `board`, `level`, `limit`, `around`, `theme`, `refresh` in seconds for a
 * board that keeps itself up to date — an attract screen or a lobby — and
 * `empty-text` / `error-text`, because a game says those in its own language.
 * Set `panel.highlight = entry.id` after a score to mark the player's own row.
 *
 * Every value is written with textContent. Names are typed by players and are
 * never trusted as markup. Nothing here throws either — a panel that cannot
 * reach its board says so in the box and leaves the game alone.
 */
class LeaderboardPanel extends HTMLElement {
  static observedAttributes = [
    "board", "level", "limit", "around", "theme", "refresh", "empty-text", "error-text",
  ];

  #root = this.attachShadow({ mode: "open" });
  #base = null;
  #theme = null;
  #body = null;
  #highlight = null;
  #timer = null;

  connectedCallback() {
    if (!this.#base) {
      this.#base = document.createElement("style");
      this.#base.textContent = PANEL_CSS;
      this.#theme = document.createElement("style");
      this.#body = document.createElement("div");
      this.#root.append(this.#base, this.#theme, this.#body);
    }
    this.reload();
    this.#schedule();
  }

  disconnectedCallback() {
    // A game that hides its panel should stop paying for it.
    clearInterval(this.#timer);
    this.#timer = null;
  }

  attributeChangedCallback() {
    if (!this.isConnected) return;
    this.reload();
    this.#schedule();
  }

  set highlight(id) {
    this.#highlight = id === null || id === undefined ? null : Number(id);
    this.reload();
  }

  get highlight() {
    return this.#highlight;
  }

  #schedule() {
    clearInterval(this.#timer);
    this.#timer = null;
    const seconds = Number(this.getAttribute("refresh"));
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    // Below this a panel is asking for a rate limit rather than for news.
    this.#timer = setInterval(() => this.reload(), Math.max(seconds, 5) * 1000);
  }

  async reload() {
    const board = this.getAttribute("board") ?? "default";
    const level = this.getAttribute("level") ?? undefined;
    const limit = Number(this.getAttribute("limit") ?? 10);
    const around = this.#highlight ?? numberOrUndefined(this.getAttribute("around"));
    // top() never throws, so there is nothing to catch here either.
    const page = await top({ board, level, limit, around });
    if (page.reason) {
      // A bug shows its own message: it is the game's own mistake, it only
      // happens while the game is being written, and "unavailable" would send
      // the author looking in the wrong place. A bad minute stays vague.
      const bug = page.reason === "invalid" || page.reason === "unknown-game";
      this.#message(
        "lb-error",
        "error",
        bug ? page.message : this.#text("error-text", "Leaderboard unavailable."),
      );
      return;
    }
    this.#applyTheme(page.board);
    this.#render(page);
  }

  /**
   * The board's own stylesheet, if it has one. `:root` is what a board is
   * written against, and it matches nothing inside a shadow tree — so it is
   * mapped to `:host`, which is the same thing here. Nothing else is touched.
   */
  #applyTheme(board) {
    const wanted =
      this.getAttribute("theme") === "none" ? "" : (board?.css ?? "").replaceAll(":root", ":host");
    if (this.#theme.textContent !== wanted) this.#theme.textContent = wanted;
  }

  /** A game says these in its own language; `empty-text` and `error-text`. */
  #text(attribute, fallback) {
    return this.getAttribute(attribute) ?? fallback;
  }

  #message(className, part, text) {
    this.#body.replaceChildren(element("p", text, className, part));
  }

  #render(page) {
    if (page.entries.length === 0) {
      this.#message("lb-empty", "empty", this.#text("empty-text", "No scores yet — be the first."));
      return;
    }

    const list = element("ol", undefined, "lb-list", "list");
    for (const entry of page.entries) {
      const row = element("li", undefined, `lb-row lb-row-${entry.rank}`, "row");
      if (entry.id === this.#highlight) row.className += " lb-you";
      row.dataset.rank = String(entry.rank);
      row.append(
        element("span", String(entry.rank), "lb-rank", "rank"),
        element("span", entry.name, "lb-name", "name"),
        element("span", entry.score.toLocaleString(), "lb-score", "score"),
      );
      list.append(row);
    }

    const title = element(
      "h2",
      page.board.title || page.board.board,
      "lb-title",
      "title",
    );
    title.append(" ", element("span", String(page.total), "lb-total", "total"));
    this.#body.replaceChildren(title, list);
  }
}

function element(tag, text, className, part) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  if (part) node.setAttribute("part", part);
  return node;
}

function numberOrUndefined(raw) {
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

// Defined once. A game that imports this module twice — directly and through
// another plugin — must not crash on the second import.
if (!customElements.get("leaderboard-panel")) {
  customElements.define("leaderboard-panel", LeaderboardPanel);
}

export { LeaderboardPanel };
