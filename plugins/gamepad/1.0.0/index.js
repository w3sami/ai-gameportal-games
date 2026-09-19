/**
 * gamepad — controller input for portal games.
 *
 *   import { createGamepad } from "https://plugins.game.bigbools.fi/gamepad/v1/index.js";
 *
 *   const pad = createGamepad();
 *
 *   function frame() {
 *     pad.poll();                          // once per frame, before the logic
 *     ship.vx += pad.x * THRUST * dt;      // left stick and d-pad together
 *     if (pad.pressed("A")) jump();        // true for exactly one frame
 *     if (pad.held("RT")) fire();          // true for as long as it is down
 *     requestAnimationFrame(frame);
 *   }
 *
 * `x` and `y` keep the same promise the joystick plugin makes: both are between
 * -1 and 1, and the vector they form is never longer than 1 — diagonals are not
 * faster. A game written against one can be handed the other without touching
 * its physics.
 *
 * **Nothing here ever throws**, the same rule the leaderboard plugin follows.
 * No controller means `connected` is false and every reading is zero. There is
 * no failure case a game has to write a branch for, because the case where the
 * player simply has no controller is the common one.
 *
 * Two things about the Gamepad API are worth knowing before wondering why
 * nothing happens, because neither is this plugin's doing and neither can be
 * worked around from here:
 *
 * 1. The browser hides controllers from a document that is not focused. Inside
 *    the portal the game runs in a frame, so the frame has to have been clicked
 *    or focused. The portal does that for its own player.
 * 2. Even then, a controller stays invisible until a button on it is pressed.
 *    So "no controller" and "controller nobody has touched yet" look the same
 *    from here, which is why a game wanting to say something about it should
 *    say "press a button" rather than "no controller found".
 */

/**
 * The standard mapping, in the order the spec lays the buttons out. A browser
 * reports `mapping: "standard"` when it recognised the device and arranged it
 * this way, which is the case for anything Xbox- or PlayStation-shaped.
 *
 * The names are the Xbox ones because they are the ones people say out loud. On
 * a PlayStation pad `A` is cross and `B` is circle — same position, same index.
 */
export const BUTTONS = [
  "A", "B", "X", "Y",
  "LB", "RB", "LT", "RT",
  "Back", "Start",
  "LS", "RS",
  "Up", "Down", "Left", "Right",
  "Guide",
];

const DEFAULTS = {
  // Sticks rest slightly off centre and wear makes it worse, so a reading this
  // small is read as nothing. Applied to the vector, not to each axis.
  deadzone: 0.12,
  // How far an analogue trigger goes before `held("RT")` becomes true. Higher
  // than the stick deadzone because a finger rests on a trigger.
  triggerThreshold: 0.3,
  // Multiplier between the stick and what the game does with it.
  gain: 1,
  // Named actions: { thrust: ["A", "RT", "ArrowUp"] }. A name resolves to a
  // button, a key code, or another action's sources.
  actions: null,
  // Track the keyboard too, so `held("Space")` answers for both. This only
  // reads keys, it never sends them — see bridgeKeys for the other direction.
  keys: true,
  // Let the arrow keys and WASD drive `x` and `y`. Off by default: a game that
  // already handles its own keyboard would otherwise move twice per press.
  keyAxis: false,
  // Where the gamepads are read from. Only worth replacing in a test.
  source: null,
  onConnect: null,
  onDisconnect: null,
};

/** Key codes that drive `x`/`y` when `keyAxis` is on. */
const KEY_AXIS = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Scales the dead zone out of a vector instead of cutting it off, so the first
 * millimetre of stick travel is a small push rather than a jump to a third of
 * full speed. The length is clamped to 1 before scaling, which is what keeps a
 * diagonal from outrunning a straight line.
 */
function applyDeadzone(x, y, deadzone) {
  const dist = Math.hypot(x, y);
  if (dist === 0) return { x: 0, y: 0 };
  const mag = Math.min(dist, 1);
  if (mag <= deadzone) return { x: 0, y: 0 };
  const out = (mag - deadzone) / (1 - deadzone);
  return { x: (x / dist) * out, y: (y / dist) * out };
}

/**
 * Reads the live list, dropping the holes in it: `getGamepads()` returns a
 * sparse array with `null` where a slot is empty, and every browser does this.
 */
function readPads(source) {
  let list;
  try {
    list = source();
  } catch {
    return [];
  }
  return Array.from(list ?? []).filter(Boolean);
}

export function createGamepad(options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const source = opt.source
    ?? (() => (typeof navigator === "undefined" ? [] : navigator.getGamepads?.() ?? []));

  const pad = {
    connected: false,
    /** The device string the browser reports. Useful in a bug report. */
    id: "",
    /** "standard" when the browser recognised the layout, "" when it did not. */
    mapping: "",
    index: -1,
    x: 0,
    y: 0,
    rx: 0,
    ry: 0,
    /** Analogue triggers, 0…1 each. A game can use them as more than a button. */
    trigger: { left: 0, right: 0 },
    gain: opt.gain,
    deadzone: opt.deadzone,
    triggerThreshold: opt.triggerThreshold,
    held,
    pressed,
    released,
    value,
    pressedAny,
    poll,
    rumble,
    destroy,
  };

  // Button state by name, this frame and last, which is all an edge is.
  let now = new Map();
  let before = new Map();
  const keysDown = new Set();

  // Which slot we are reading. Kept between frames so a second controller
  // plugged in mid-game does not steal the first one's place.
  let index = -1;
  let raw = null;
  let warnedMapping = false;
  let gameDrives = false;
  let loop = 0;

  const actions = new Map(Object.entries(opt.actions ?? {}));

  /**
   * Resolves a name to the things that can satisfy it: an action expands to its
   * sources, anything else stands for itself. One level of indirection only —
   * an action naming another action is a knot, not a feature.
   */
  function sourcesOf(name) {
    const listed = actions.get(name);
    return listed ? listed : [name];
  }

  // Keys live in the same per-frame map as buttons, so an edge on a key is the
  // same subtraction as an edge on a button. The two name spaces cannot
  // collide: a key code is "KeyA" or "ArrowUp" where a button is "A" or "Up".
  const isDown = (source) => now.get(source) > 0;
  const wasDown = (source) => before.get(source) > 0;

  /** True while any source of `name` is down. */
  function held(name) {
    return sourcesOf(name).some(isDown);
  }

  /** True for the one frame a source of `name` went down. */
  function pressed(name) {
    return sourcesOf(name).some((s) => isDown(s) && !wasDown(s));
  }

  /** True for the one frame a source of `name` came up. */
  function released(name) {
    return sourcesOf(name).some((s) => !isDown(s) && wasDown(s));
  }

  /**
   * How far down, 0…1. Only the triggers answer with anything between — every
   * other button is 0 or 1 — but reading them the same way means a game can
   * swap a trigger for a button without a second code path.
   */
  function value(name) {
    let best = 0;
    for (const s of sourcesOf(name)) {
      const v = now.get(s) ?? 0;
      if (v > best) best = v;
    }
    return best;
  }

  /** For "press any button to start", which is the screen this API needs. */
  function pressedAny() {
    for (const [name, v] of now) {
      if (v > 0 && !(before.get(name) > 0)) return name;
    }
    return null;
  }

  /** Picks a controller and stays with it while it is still there. */
  function choose(pads) {
    if (index >= 0) {
      const kept = pads.find((p) => p.index === index);
      if (kept) return kept;
    }
    // A recognised layout first: an unrecognised one may have its buttons
    // anywhere, and if there is a choice it is the worse one.
    return pads.find((p) => p.mapping === "standard") ?? pads[0] ?? null;
  }

  function zero() {
    pad.x = 0;
    pad.y = 0;
    pad.rx = 0;
    pad.ry = 0;
    pad.trigger.left = 0;
    pad.trigger.right = 0;
  }

  function update() {
    const pads = readPads(source);
    const chosen = choose(pads);

    // One roll per frame, whatever happens below: an edge is the difference
    // between these two maps, so rolling them anywhere else would either lose
    // an edge or repeat one.
    before = now;
    now = new Map();

    if (!chosen) {
      zero();
      if (pad.connected) {
        pad.connected = false;
        pad.id = "";
        pad.mapping = "";
        pad.index = -1;
        index = -1;
        raw = null;
        opt.onDisconnect?.(pad);
      }
      addKeys();
      applyKeys();
      return pad;
    }

    if (!pad.connected || chosen.index !== index) {
      index = chosen.index;
      pad.index = index;
      pad.id = chosen.id ?? "";
      pad.mapping = chosen.mapping ?? "";
      pad.connected = true;
      if (pad.mapping !== "standard" && !warnedMapping) {
        warnedMapping = true;
        console.warn(
          `gamepad: "${pad.id}" reports no standard mapping, so its buttons may `
          + "sit anywhere. Axes and buttons are read by index as a best guess.",
        );
      }
      opt.onConnect?.(pad);
    }
    raw = chosen;

    const buttons = chosen.buttons ?? [];
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      const amount = typeof button === "number"
        ? button
        : button?.value ?? (button?.pressed ? 1 : 0);
      const name = BUTTONS[i] ?? `B${i}`;
      now.set(name, clamp01(amount));
    }

    pad.trigger.left = now.get("LT") ?? 0;
    pad.trigger.right = now.get("RT") ?? 0;
    // A trigger reading below the threshold is a finger resting on it, not a
    // press. The analogue value stays readable on `trigger` either way, and a
    // trigger that only reports pressed/not lands on 0 or 1 regardless.
    now.set("LT", pad.trigger.left >= pad.triggerThreshold ? pad.trigger.left : 0);
    now.set("RT", pad.trigger.right >= pad.triggerThreshold ? pad.trigger.right : 0);

    const axes = chosen.axes ?? [];
    let ax = axes[0] ?? 0;
    let ay = axes[1] ?? 0;
    // The d-pad wins where it is pressed: it is the precise input of the two,
    // and a game that wants them apart can still read held("Left").
    const dx = (isDown("Right") ? 1 : 0) - (isDown("Left") ? 1 : 0);
    const dy = (isDown("Down") ? 1 : 0) - (isDown("Up") ? 1 : 0);
    if (dx !== 0) ax = dx;
    if (dy !== 0) ay = dy;

    const left = applyDeadzone(ax, ay, pad.deadzone);
    pad.x = left.x * pad.gain;
    pad.y = left.y * pad.gain;

    const right = applyDeadzone(axes[2] ?? 0, axes[3] ?? 0, pad.deadzone);
    pad.rx = right.x * pad.gain;
    pad.ry = right.y * pad.gain;

    addKeys();
    applyKeys();
    return pad;
  }

  /** Folds the keys held right now into this frame, beside the buttons. */
  function addKeys() {
    for (const code of keysDown) now.set(code, 1);
  }

  /** Lets the keyboard stand in for the stick, when the game asked it to. */
  function applyKeys() {
    if (!opt.keyAxis) return;
    if (pad.x !== 0 || pad.y !== 0) return;
    const kx = (KEY_AXIS.right.some((k) => keysDown.has(k)) ? 1 : 0)
      - (KEY_AXIS.left.some((k) => keysDown.has(k)) ? 1 : 0);
    const ky = (KEY_AXIS.down.some((k) => keysDown.has(k)) ? 1 : 0)
      - (KEY_AXIS.up.some((k) => keysDown.has(k)) ? 1 : 0);
    if (kx === 0 && ky === 0) return;
    const keyed = applyDeadzone(kx, ky, 0);
    pad.x = keyed.x * pad.gain;
    pad.y = keyed.y * pad.gain;
  }

  /**
   * Reads the controller and advances the frame. Call it once per frame, before
   * anything that asks a question: `pressed` and `released` are the difference
   * between this call and the one before, so calling it twice in a frame throws
   * an edge away and calling it not at all leaves the readings where they were.
   *
   * Until a game calls this, the plugin drives itself from its own animation
   * frame, so a game that only ever asks `held` still gets an answer.
   */
  function poll() {
    if (!gameDrives) {
      gameDrives = true;
      if (loop && typeof cancelAnimationFrame === "function") cancelAnimationFrame(loop);
      loop = 0;
    }
    return update();
  }

  /**
   * A short buzz. Returns false when the controller or the browser has no
   * motors, which is most of them — so this is something a game adds on top of
   * what it already tells the player, never the only way it tells them.
   */
  function rumble({ duration = 150, strong = 0.6, weak = 0.3, delay = 0 } = {}) {
    const actuator = raw?.vibrationActuator;
    if (!actuator?.playEffect) return false;
    try {
      const effect = actuator.playEffect("dual-rumble", {
        startDelay: delay,
        duration,
        strongMagnitude: clamp01(strong),
        weakMagnitude: clamp01(weak),
      });
      // A rejected buzz is not news. Swallowing it here is what keeps the
      // promise that nothing from this module reaches window.onerror.
      effect?.catch?.(() => {});
    } catch {
      return false;
    }
    return true;
  }

  function onKeyDown(e) {
    keysDown.add(e.code);
  }

  function onKeyUp(e) {
    keysDown.delete(e.code);
  }

  /**
   * A window that loses focus stops hearing about the button coming up, and a
   * game left with the throttle down is worse than one that stops. The joystick
   * plugin releases on blur for the same reason.
   */
  function onBlur() {
    keysDown.clear();
    now = new Map();
    zero();
  }

  function destroy() {
    if (loop && typeof cancelAnimationFrame === "function") cancelAnimationFrame(loop);
    loop = 0;
    if (typeof window === "undefined") return;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  }

  if (typeof window !== "undefined") {
    if (opt.keys) {
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
    }
    window.addEventListener("blur", onBlur);
    if (typeof requestAnimationFrame === "function") {
      const tick = () => {
        if (gameDrives) return;
        update();
        loop = requestAnimationFrame(tick);
      };
      loop = requestAnimationFrame(tick);
    }
  }

  return pad;
}

/** What a key code is called when an event carries it as `key` as well. */
function keyOf(code) {
  if (code === "Space") return " ";
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

/**
 * Turns controller buttons into keyboard events, so a game that already listens
 * for keys gets controller support without its own code being touched:
 *
 *   import { bridgeKeys } from "https://plugins.game.bigbools.fi/gamepad/v1/index.js";
 *   bridgeKeys({ Left: "ArrowLeft", Right: "ArrowRight", A: "Space" });
 *
 * The events are synthetic, so `isTrusted` is false and the browser will not
 * act on them itself — a bridged Space will not scroll the page. Game logic
 * reading `event.code` cannot tell the difference, which is the whole point.
 */
export function bridgeKeys(map, options = {}) {
  const pairs = Object.entries(map ?? {});
  const target = options.target
    ?? (typeof document === "undefined" ? null : document);
  const pad = options.pad ?? createGamepad({ keys: false, ...options.gamepad });
  const down = new Set();
  let loop = 0;

  function send(type, code) {
    if (!target) return;
    target.dispatchEvent(new KeyboardEvent(type, {
      code,
      key: keyOf(code),
      bubbles: true,
      cancelable: true,
    }));
  }

  function step() {
    // A controller handed in belongs to the game, and the game is polling it.
    // Polling it again here would throw away an edge the game is waiting for.
    if (!options.pad) pad.poll();
    for (const [button, code] of pairs) {
      const isDown = pad.held(button);
      if (isDown && !down.has(code)) {
        down.add(code);
        send("keydown", code);
      } else if (!isDown && down.has(code)) {
        down.delete(code);
        send("keyup", code);
      }
    }
    if (typeof requestAnimationFrame === "function") loop = requestAnimationFrame(step);
  }

  function destroy() {
    if (loop && typeof cancelAnimationFrame === "function") cancelAnimationFrame(loop);
    loop = 0;
    // Whatever was held is let go, or the game keeps running on a key that
    // nothing will ever lift.
    for (const code of down) send("keyup", code);
    down.clear();
    if (!options.pad) pad.destroy();
  }

  if (typeof requestAnimationFrame === "function") loop = requestAnimationFrame(step);
  return { pad, step, destroy };
}
