// The player's own recorded charts, kept in this browser's localStorage.

const KEY = 'tanssiauto.charts';

export function loadOwn() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

// Returns false when the browser refuses to store, as a private window does.
export function saveOwn(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    return false;
  }
}
