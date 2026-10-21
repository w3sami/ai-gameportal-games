// Loads config/tuning.json over built-in defaults, so the game starts even if
// the file is missing or broken. See config/tuning.json "_doc" for meanings.
export const DEFAULTS = {
  baseSize: 7, maxSize: 10, sizeGrowEvery: 4,
  minPar: 2, parGrowth: 0.6, maxPar: 12, parSlack: 1,
  rockDensity: 0.16, snowDensity: 0.06, snowFromLevel: 4,
  attempts: 6000,
  msPerCell: 55, minSlideMs: 110, maxSlideMs: 420,
  starSlack: 2, seedSalt: 1337,
};

export async function loadConfig() {
  try {
    const res = await fetch('config/tuning.json', { cache: 'no-cache' });
    if (!res.ok) return { ...DEFAULTS };
    const j = await res.json();
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (typeof j[k] === 'number') out[k] = j[k];
    return out;
  } catch { return { ...DEFAULTS }; }
}
