'use strict';
/* =========================================================================
   GHOST — the fastest run of each course, kept in this browser, to race against or watch (js/game.js).
   Ghost.key(course, vehicle) -> a fingerprint of the course's points and aircraft: move a gate and its ghost is dropped
   Ghost.info(id, key) -> { time, bytes } | null        without unpacking (the menu uses it to show its buttons)
   Ghost.save(id, key, time, track) -> Promise<bool>    track as from Replay.recorder().finish() (js/replay.js)
   Ghost.load(id, key) -> Promise<track | null>
   Packing: each channel planar and delta-coded over time (positions quantized to the run's box, ~6 cm steps; the
   attitude as 16-bit quaternions), then deflated where the browser can: a 90 s run comes to about 20 kB of storage.
   ========================================================================= */
const Ghost = (() => {
  const PREFIX = 'skyrace.ghost.', VERSION = 1, NF = 10;
  const HEAD = 8;                                           // floats: n, rate, x0, y0, z0, sx, sy, sz

  function key(course, vehicle) {                           // FNV-1a over the points and aircraft
    const s = JSON.stringify(course.points) + '|' + (vehicle || '');
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16);
  }
  function read(id) {
    try { return JSON.parse(localStorage.getItem(PREFIX + id) || 'null'); } catch (e) { return null; }
  }
  function info(id, k) {
    const g = read(id);
    return g && g.v === VERSION && g.key === k && typeof g.time === 'number' && typeof g.data === 'string' ? { time: g.time, bytes: g.data.length } : null;
  }

  function pack(tr) {
    const n = tr.n, F = tr.f;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { const v = F[i * NF + c]; lo[c] = Math.min(lo[c], v); hi[c] = Math.max(hi[c], v); }
    const sc = lo.map((l, c) => Math.max(hi[c] - l, 1e-3) / 65535);
    const buf = new ArrayBuffer(HEAD * 4 + n * 22), head = new Float32Array(buf, 0, HEAD);
    head.set([n, tr.rate, lo[0], lo[1], lo[2], sc[0], sc[1], sc[2]]);
    const w = new Uint16Array(buf, HEAD * 4, n * 10), b = new Uint8Array(buf, HEAD * 4 + n * 20, n * 2);
    // channel k's value at sample i -> 16 bits; stored as the change from the sample before (wrapping)
    const chan = (k, get) => { let prev = 0; for (let i = 0; i < n; i++) { const q = get(i) & 0xffff; w[k * n + i] = (q - prev) & 0xffff; prev = q; } };
    for (let c = 0; c < 3; c++) chan(c, (i) => Math.round((F[i * NF + c] - lo[c]) / sc[c]));
    const sign = new Int8Array(n); sign[0] = 1;                // q and -q are the same turn: keep the sign continuous
    for (let i = 1; i < n; i++) sign[i] = dotQ(F, i, i - 1) < 0 ? -sign[i - 1] : sign[i - 1];   // so the deltas stay small
    for (let c = 0; c < 4; c++) chan(3 + c, (i) => Math.round(clampQ(F[i * NF + 3 + c] * sign[i]) * 32767));
    chan(7, (i) => Math.round(Math.min(F[i * NF + 7], 655) * 100));
    chan(8, (i) => Math.round(Math.max(-327, Math.min(327, F[i * NF + 8])) * 100));
    chan(9, (i) => tr.next[i]);
    for (let i = 0; i < n; i++) { b[i] = Math.round(Math.max(0, Math.min(1, F[i * NF + 9])) * 255); b[n + i] = tr.flags[i]; }
    return buf;
  }
  const clampQ = (v) => Math.max(-1, Math.min(1, v));
  function dotQ(F, i, j) { let d = 0; for (let c = 0; c < 4; c++) d += F[i * NF + 3 + c] * F[j * NF + 3 + c]; return d; }

  function unpack(buf) {
    const head = new Float32Array(buf, 0, HEAD), n = head[0], rate = head[1];
    if (!(n >= 2) || buf.byteLength !== HEAD * 4 + n * 22) return null;
    const w = new Uint16Array(buf, HEAD * 4, n * 10), b = new Uint8Array(buf, HEAD * 4 + n * 20, n * 2);
    const f = new Float32Array(n * NF), flags = new Uint8Array(n), next = new Uint16Array(n);
    const chan = (k, set, signed) => { let q = 0; for (let i = 0; i < n; i++) { q = (q + w[k * n + i]) & 0xffff; set(i, signed && q > 32767 ? q - 65536 : q); } };
    for (let c = 0; c < 3; c++) chan(c, (i, q) => { f[i * NF + c] = head[2 + c] + q * head[5 + c]; });
    for (let c = 0; c < 4; c++) chan(3 + c, (i, q) => { f[i * NF + 3 + c] = q / 32767; }, true);
    chan(7, (i, q) => { f[i * NF + 7] = q / 100; });
    chan(8, (i, q) => { f[i * NF + 8] = q / 100; }, true);
    chan(9, (i, q) => { next[i] = q; });
    for (let i = 0; i < n; i++) {
      f[i * NF + 9] = b[i] / 255; flags[i] = b[n + i];
      let l = 0; for (let c = 0; c < 4; c++) l += f[i * NF + 3 + c] ** 2;
      l = Math.sqrt(l) || 1; for (let c = 0; c < 4; c++) f[i * NF + 3 + c] /= l;   // (16-bit rounding: back to unit length)
    }
    return { f, flags, next, n, duration: (n - 1) / rate, rate };
  }

  const canZip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  const through = (buf, t) => new Response(new Blob([buf]).stream().pipeThrough(t)).arrayBuffer();
  function toB64(buf) {
    const u = new Uint8Array(buf); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(s) { const t = atob(s), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u.buffer; }

  async function save(id, k, time, tr) {
    if (!tr || tr.n < 2) return false;
    try {
      let buf = pack(tr), z = '';
      if (canZip) { try { buf = await through(buf, new CompressionStream('deflate-raw')); z = 'deflate-raw'; } catch (e) { buf = pack(tr); } }
      localStorage.setItem(PREFIX + id, JSON.stringify({ v: VERSION, key: k, time, z, data: toB64(buf) }));
      return true;
    } catch (e) { return false; }                             // no storage, or it's full: this run just isn't kept
  }
  async function load(id, k) {
    const g = read(id);
    if (!g || g.v !== VERSION || g.key !== k) return null;
    try {
      let buf = fromB64(g.data);
      if (g.z) { if (!canZip) return null; buf = await through(buf, new DecompressionStream(g.z)); }
      return unpack(buf);
    } catch (e) { return null; }
  }

  return { key, info, save, load, pack, unpack };
})();
