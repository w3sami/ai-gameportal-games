// Per-browser progress: { unlocked: highest playable level, stars: { [n]: best } }
const KEY = 'norppa.progress.v1';

export function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    if (p && typeof p.unlocked === 'number') return { unlocked: p.unlocked, stars: p.stars || {} };
  } catch {}
  return { unlocked: 1, stars: {} };
}

export function saveProgress(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
}
