'use strict';
/* =========================================================================
   GHOST — the fastest run of each course, kept in this browser, to race against or watch (js/game.js).
   Ghost.key(course, vehicle) -> a fingerprint of the course's points and aircraft: move a gate and its ghost is dropped
   Ghost.info(id, key) -> { time, bytes } | null        without unpacking (the menu uses it to show its buttons)
   Ghost.save(id, key, time, track) -> Promise<bool>    track as from Replay.recorder().finish() (js/replay.js)
   Ghost.load(id, key) -> Promise<track | null>
   Ghost.packLite(track, budget) -> Promise<string | null>   the same run in at most `budget` characters, for a leaderboard
   Ghost.unpackLite(string) -> Promise<track | null>         entry (below); null where the browser can't deflate
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

  /* ---------- compact form: a whole run in a leaderboard entry's 2 kB (js/boards.js) ----------
     Keyframes only where the run needs them: from both ends, the samples either side of each respawn and one every
     KEY_EVERY, the sample furthest from the path rebuilt so far is added next (so a straight costs a key or two and a
     loop a dozen), until every sample is within TOL_P and TOL_A or no more keys fit in `budget` characters. Positions
     come back as a Hermite curve through the keys (quarter-metre steps, each predicted from the two keys before it),
     attitude slerped between 8-bit quaternions, and flags and gates as change events. About 0.3 m and 3° off on a
     90 s run, and it loosens smoothly to fit a long one. */
  const LITE = 1, KEY_EVERY = 60, TOL_P = 0.25, TOL_A = 3 * Math.PI / 180, VIS = 1, CUT = 8;
  const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
  const posOf = (F, i, c) => F[i * NF + c];
  // positions of samples i0..i1 along the Hermite segment ks[k]..ks[k+1] into out(i, x, y, z); P(j, c) reads a key's
  // position, ks the key sample indices, jumpAt(j) whether key j is where a respawn put the plane (no blending into it)
  function hermite(ks, P, jumpAt, k, out) {
    const i0 = ks[k], i1 = ks[k + 1], h = i1 - i0, n = ks.length;
    if (jumpAt(k + 1)) { for (let i = i0; i < i1; i++) out(i, P(k, 0), P(k, 1), P(k, 2)); out(i1, P(k + 1, 0), P(k + 1, 1), P(k + 1, 2)); return; }
    const left = k > 0 && !jumpAt(k), right = k + 2 < n && !jumpAt(k + 2);
    const m0 = [0, 0, 0], m1 = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      m0[c] = left ? (P(k + 1, c) - P(k - 1, c)) / (i1 - ks[k - 1]) : (P(k + 1, c) - P(k, c)) / h;
      m1[c] = right ? (P(k + 2, c) - P(k, c)) / (ks[k + 2] - i0) : (P(k + 1, c) - P(k, c)) / h;
    }
    for (let i = i0; i <= i1; i++) {
      const u = (i - i0) / h, u2 = u * u, u3 = u2 * u;
      const a = 2 * u3 - 3 * u2 + 1, b = (u3 - 2 * u2 + u) * h, d = -2 * u3 + 3 * u2, e = (u3 - u2) * h;
      out(i, a * P(k, 0) + b * m0[0] + d * P(k + 1, 0) + e * m1[0], a * P(k, 1) + b * m0[1] + d * P(k + 1, 1) + e * m1[1],
          a * P(k, 2) + b * m0[2] + d * P(k + 1, 2) + e * m1[2]);
    }
  }
  function quatAt(F, i, q) { return q.set(F[i * NF + 3], F[i * NF + 4], F[i * NF + 5], F[i * NF + 6]); }

  // keys in the order they were chosen: the fixed ones first, then worst-first
  function chooseKeys(tr, maxKeys) {
    const n = tr.n, F = tr.f, fl = tr.flags, fixed = new Set([0, n - 1]);
    for (let i = 1; i < n; i++) if (fl[i] & CUT) { fixed.add(i - 1); fixed.add(i); }
    for (let i = 0; i < n; i += KEY_EVERY) fixed.add(i);
    const ks = [...fixed].sort((a, b) => a - b), order = ks.slice();
    const segW = [], segE = [];                             // per segment: its worst sample and how bad (1 = at tolerance)
    const P = (j, c) => posOf(F, ks[j], c), jumpAt = (j) => j > 0 && (fl[ks[j]] & CUT) !== 0;
    function measure(k) {
      let worst = -1, bad = 1;
      const i0 = ks[k], i1 = ks[k + 1];
      if (i1 - i0 < 2 || jumpAt(k + 1)) { segW[k] = -1; segE[k] = 0; return; }
      quatAt(F, i0, _qa); quatAt(F, i1, _qb);
      hermite(ks, P, jumpAt, k, (i, x, y, z) => {
        if (i === i0 || i === i1 || !(fl[i] & VIS)) return;
        const dp = Math.hypot(x - posOf(F, i, 0), y - posOf(F, i, 1), z - posOf(F, i, 2)) / TOL_P;
        const q = _qs.copy(_qa).slerp(_qb, (i - i0) / (i1 - i0));
        const da = q.angleTo(quatAt(F, i, _qt)) / TOL_A, v = Math.max(dp, da);
        if (v > bad) { bad = v; worst = i; }
      });
      segW[k] = worst; segE[k] = worst < 0 ? 0 : bad;
    }
    for (let k = 0; k < ks.length - 1; k++) measure(k);
    while (order.length < maxKeys) {
      let k = -1, e = 0;
      for (let j = 0; j < segE.length; j++) if (segE[j] > e) { e = segE[j]; k = j; }
      if (k < 0) break;                                     // everything within tolerance
      const w = segW[k];
      ks.splice(k + 1, 0, w); segW.splice(k + 1, 0, -1); segE.splice(k + 1, 0, 0); order.push(w);
      for (let j = Math.max(0, k - 2); j <= Math.min(ks.length - 2, k + 3); j++) measure(j);   // tangents reach two keys out
    }
    return { order, fixed: fixed.size };
  }
  const _qs = new THREE.Quaternion(), _qt = new THREE.Quaternion();

  function varint(out, v) { while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; } out.push(v); }
  const zz = (v) => (v << 1) ^ (v >> 31), unzz = (v) => (v >>> 1) ^ -(v & 1);
  function encodeKeys(tr, ks) {
    const F = tr.f, out = [LITE], tuck = ks.some((i) => F[i * NF + 9] > 0.02);
    out.push(tuck ? 1 : 0);
    varint(out, tr.n); varint(out, ks.length);
    let pi = 0; const qp = [0, 0, 0, 0], hist = [];
    for (let k = 0; k < ks.length; k++) {
      const i = ks[k], p = [0, 1, 2].map((c) => Math.round(F[i * NF + c] * 4));
      varint(out, i - pi);
      let pred = [0, 0, 0];
      if (k >= 2) { const a = hist[k - 1], b = hist[k - 2], ia = ks[k - 1], ib = ks[k - 2]; pred = a.map((v, c) => Math.round(v + (v - b[c]) * (i - ia) / (ia - ib))); }
      else if (k === 1) pred = hist[0];
      hist.push(p);
      for (let c = 0; c < 3; c++) varint(out, zz(p[c] - pred[c]));
      const q = [F[i * NF + 3], F[i * NF + 4], F[i * NF + 5], F[i * NF + 6]];
      if (q[0] * qp[0] + q[1] * qp[1] + q[2] * qp[2] + q[3] * qp[3] < 0) for (let c = 0; c < 4; c++) q[c] = -q[c];   // continuous sign
      for (let c = 0; c < 4; c++) { const v = Math.round(q[c] * 127); varint(out, zz(v - qp[c])); qp[c] = v; }
      if (tuck) out.push(Math.round(Math.max(0, Math.min(1, F[i * NF + 9])) * 255));
      pi = i;
    }
    const ev = []; let lf = -1, ln = 0;
    for (let i = 0; i < tr.n; i++) {
      const f = tr.flags[i] & 15;
      if (f !== lf) { ev.push(i, 0, f); lf = f; }
      if (tr.next[i] !== ln) { ev.push(i, 1, tr.next[i]); ln = tr.next[i]; }
    }
    varint(out, ev.length / 3);
    for (let j = 0, li = 0; j < ev.length; j += 3) { varint(out, ev[j] - li); li = ev[j]; varint(out, ev[j + 2] * 2 + ev[j + 1]); }
    return new Uint8Array(out);
  }
  async function zip(u8) { return canZip ? new Uint8Array(await through(u8, new CompressionStream('deflate-raw'))) : null; }

  // -> base64 string of at most `budget` characters, or null (the browser can't deflate, or not even the fixed keys fit)
  async function packLite(tr, budget) {
    if (!tr || tr.n < 2 || !canZip) return null;
    const { order, fixed } = chooseKeys(tr, 1500);
    const sized = async (m) => { const z = await zip(encodeKeys(tr, order.slice(0, m).sort((a, b) => a - b))); return toB64(z.buffer); };
    let s = await sized(order.length);
    if (s.length <= budget) return s;
    let lo = fixed, hi = order.length, best = null;        // most keys that still fit
    const f0 = await sized(lo);
    if (f0.length > budget) return null;
    best = f0;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; s = await sized(mid); if (s.length <= budget) { lo = mid; best = s; } else hi = mid; }
    return best;
  }

  async function unpackLite(b64) {
    try {
      if (!canZip) return null;
      const u = new Uint8Array(await through(fromB64(b64), new DecompressionStream('deflate-raw')));
      let o = 0;
      const rd = () => { let v = 0, s = 0, b; do { b = u[o++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v >>> 0; };
      if (u[o++] !== LITE) return null;
      const tuck = u[o++] === 1, n = rd(), nk = rd();
      const ks = new Int32Array(nk), kp = new Float32Array(nk * 3), kq = new Float32Array(nk * 4), kt = new Float32Array(nk);
      const hist = [], qp = [0, 0, 0, 0];
      for (let k = 0, pi = 0; k < nk; k++) {
        const i = pi + rd(); ks[k] = i;
        let pred = [0, 0, 0];
        if (k >= 2) { const a = hist[k - 1], b = hist[k - 2], ia = ks[k - 1], ib = ks[k - 2]; pred = a.map((v, c) => Math.round(v + (v - b[c]) * (i - ia) / (ia - ib))); }
        else if (k === 1) pred = hist[0];
        const p = pred.map((v) => v + unzz(rd()));
        hist.push(p);
        for (let c = 0; c < 3; c++) kp[k * 3 + c] = p[c] / 4;
        for (let c = 0; c < 4; c++) { qp[c] += unzz(rd()); kq[k * 4 + c] = qp[c] / 127; }
        if (tuck) kt[k] = u[o++] / 255;
        pi = i;
      }
      const flags = new Uint8Array(n), next = new Uint16Array(n), ne = rd(), ev = [];
      for (let j = 0, li = 0; j < ne; j++) { li += rd(); const v = rd(); ev.push([li, v & 1, v >> 1]); }
      for (let i = 0, e = 0, f = 0, x = 0; i < n; i++) {
        while (e < ev.length && ev[e][0] <= i) { if (ev[e][1]) x = ev[e][2]; else f = ev[e][2]; e++; }
        flags[i] = f; next[i] = x;
      }
      // fill the samples back in: positions along the curve, attitude slerped, speed from the positions
      const f = new Float32Array(n * NF), P = (j, c) => kp[j * 3 + c], jumpAt = (j) => j > 0 && (flags[ks[j]] & CUT) !== 0;
      for (let k = 0; k < nk - 1; k++) {
        hermite(ks, P, jumpAt, k, (i, x, y, z) => { f[i * NF] = x; f[i * NF + 1] = y; f[i * NF + 2] = z; });
        _qa.fromArray(kq, k * 4).normalize(); _qb.fromArray(kq, (k + 1) * 4).normalize();
        const i0 = ks[k], i1 = ks[k + 1], hold = jumpAt(k + 1);
        for (let i = i0; i <= i1; i++) {
          const w = hold ? (i === i1 ? 1 : 0) : (i - i0) / (i1 - i0);
          _qs.copy(_qa).slerp(_qb, w).toArray(f, i * NF + 3);
          f[i * NF + 9] = kt[k] + (kt[k + 1] - kt[k]) * w;
        }
      }
      if (nk === 1) { for (let c = 0; c < 3; c++) f[c] = kp[c]; for (let c = 0; c < 4; c++) f[3 + c] = kq[c]; }
      for (let i = 0; i < n; i++) {
        const a = i > 0 && !(flags[i] & CUT) ? i - 1 : i, b = i + 1 < n && !(flags[i + 1] & CUT) ? i + 1 : i;
        const d = Math.hypot(f[b * NF] - f[a * NF], f[b * NF + 1] - f[a * NF + 1], f[b * NF + 2] - f[a * NF + 2]);
        f[i * NF + 7] = b > a ? d * 20 / (b - a) : 0; f[i * NF + 8] = 1;
      }
      return { f, flags, next, n, duration: (n - 1) / 20, rate: 20 };
    } catch (e) { return null; }
  }

  return { key, info, save, load, pack, unpack, packLite, unpackLite };
})();
