// The eight lanes and who is holding them. A lane is held while any of its
// sources is down: a key, an arrow key that covers two lanes, or a pad button.

// Order is the keyboard's: Q W E / A S D / space shift. The note strip and the
// pad lay the lanes out the same way.
export const LANES = [
  { id: 'q', key: 'Q', icon: '↖', color: '#4dd6ff' },
  { id: 'w', key: 'W', icon: '⇔', color: '#ffd23f' },
  { id: 'e', key: 'E', icon: '↗', color: '#8cff6a' },
  { id: 'a', key: 'A', icon: '↙', color: '#ff9d4d' },
  { id: 's', key: 'S', icon: '⇔', color: '#c78bff' },
  { id: 'd', key: 'D', icon: '↘', color: '#ff6fae' },
  { id: 'squat', key: '␣', icon: '▼', color: '#7f9dff' },
  { id: 'stretch', key: '⇧', icon: '▲', color: '#ff7a6a' },
];

// The row layout, used while notes are followed: one row of keys on the home
// row, left hand on the rear of the car and right hand on the front, mirrored
// so that the same finger of each hand makes a pair (far wheels, near wheels,
// both axles). The note board draws its lanes in this order.
export const ROW = [
  { lane: 'squat', code: 'KeyA', key: 'A' },
  { lane: 'q', code: 'KeyS', key: 'S' },
  { lane: 'a', code: 'KeyD', key: 'D' },
  { lane: 's', code: 'KeyF', key: 'F' },
  { lane: 'w', code: 'KeyJ', key: 'J' },
  { lane: 'd', code: 'KeyK', key: 'K' },
  { lane: 'e', code: 'KeyL', key: 'L' },
  { lane: 'stretch', code: 'Semicolon', key: 'Ö' },
];

const ARROWS = { ArrowRight: ['e', 'd'], ArrowLeft: ['q', 'a'], ArrowUp: ['q', 'e'], ArrowDown: ['a', 'd'] };
// The grid layout, used in free dance: the keys sit like the wheels do on screen.
const GRID_KEYS = {
  KeyQ: ['q'], KeyW: ['w'], KeyE: ['e'], KeyA: ['a'], KeyS: ['s'], KeyD: ['d'],
  Space: ['squat'], ShiftLeft: ['stretch'], ShiftRight: ['stretch'], ...ARROWS,
};
const ROW_KEYS = { ...ARROWS };
for (const slot of ROW) ROW_KEYS[slot.code] = [slot.lane];
let keyLanes = GRID_KEYS;

const holds = {};
for (const lane of LANES) holds[lane.id] = 0;
const listeners = [];
const releaseListeners = [];
const keysDown = new Map();   // key code -> the lanes it went down as

function down(lanes) {
  for (const id of lanes) {
    if (holds[id]++ === 0) for (const fn of listeners) fn(id);
  }
}
function up(lanes) {
  for (const id of lanes) {
    if (holds[id] === 1) for (const fn of releaseListeners) fn(id);
    holds[id] = Math.max(0, holds[id] - 1);
  }
}

addEventListener('keydown', (e) => {
  const lanes = keyLanes[e.code];
  if (!lanes) return;
  e.preventDefault();
  if (keysDown.has(e.code)) return;
  keysDown.set(e.code, lanes);
  down(lanes);
});
addEventListener('keyup', (e) => {
  const lanes = keysDown.get(e.code);
  if (lanes) { keysDown.delete(e.code); up(lanes); }
});
function releaseKeys() {
  for (const lanes of keysDown.values()) up(lanes);
  keysDown.clear();
}
addEventListener('blur', releaseKeys);

// 'row' or 'grid'.
export function setLayout(name) {
  releaseKeys();
  keyLanes = name === 'row' ? ROW_KEYS : GRID_KEYS;
}

// For sources that live elsewhere, such as touches on the note board.
export function pressLane(id) { down([id]); }
export function releaseLane(id) { up([id]); }

// Pad buttons carry data-lane. Returns them keyed by lane for highlighting.
export function bindPad(root) {
  const buttons = {};
  for (const btn of root.querySelectorAll('button[data-lane]')) {
    const id = btn.dataset.lane;
    const lane = LANES.find((l) => l.id === id);
    btn.style.setProperty('--lane', lane.color);
    buttons[id] = btn;
    let pressed = false;
    const release = () => { if (pressed) { pressed = false; up([id]); } };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      if (!pressed) { pressed = true; down([id]); }
    });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  return buttons;
}

// { lane id: true while held }
export function held() {
  const out = {};
  for (const lane of LANES) out[lane.id] = holds[lane.id] > 0;
  return out;
}

// fn(lane id) runs at the moment a lane goes from free to held.
export function onPress(fn) { listeners.push(fn); }
// fn(lane id) runs at the moment the last source lets go of a lane.
export function onRelease(fn) { releaseListeners.push(fn); }
