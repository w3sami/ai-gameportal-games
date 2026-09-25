'use strict';
// Ghost paths. The rocket's pose is sampled every GP.STEP ticks and delta-coded into a base64 string, so a ghost
// replays as pure render data: no re-simulation, so it survives physics tuning, level edits and other browsers.
// That also means a path cannot be checked against its claimed time — the time and the path are trusted together.
//
// Bytes: version(1) step(1) flags(1) count tail, then per sample dx dy (da<<1|flame), all varints, zigzag for signed.
// Position in whole pixels, angle in 1/1024 turn (0.35°), or 1/256 (1.4°) when bit 0 of flags is set. `tail` is the
// tick length of the last segment when the landing tick is not a multiple of step, else 0. Between samples the pose
// is a Catmull-Rom spline through them.
const GP = (() => {
  const STEP = 10, ASTEP = 1024, CSTEP = 256, TAU = Math.PI*2, CAP = 1900;
  const zz = n => n >= 0 ? n*2 : -n*2-1;
  const unzz = n => (n & 1) ? -(n+1)/2 : n/2;
  function putVar(o, n){ while (n > 127){ o.push((n & 127) | 128); n = Math.floor(n/128); } o.push(n); }
  function getVar(b, st){ let n = 0, m = 1, c; do { c = b[st.i++]; n += (c & 127)*m; m *= 128; } while (c & 128); return n; }
  const wrapA = (d, A) => { d %= A; if (d >= A/2) d -= A; if (d < -A/2) d += A; return d; };
  const qa = (a, A) => ((Math.round(a/TAU*A) % A) + A) % A;
  const sample = s => ({x:s.x, y:s.y, a:s.a, flame:s.flame ? 1 : 0});

  // `coarse` halves the angle resolution and saves about a byte a sample. Only a path bound for the board uses it:
  // the copy kept on this machine has no reason to give anything up.
  function encode(samples, step, tail, coarse){
    const A = coarse ? CSTEP : ASTEP;
    const o = [1, step, coarse ? 1 : 0]; putVar(o, samples.length); putVar(o, tail);
    let px = 0, py = 0, pa = 0;
    for (const s of samples){
      const x = Math.round(s.x), y = Math.round(s.y), a = qa(s.a, A);
      putVar(o, zz(x-px)); putVar(o, zz(y-py)); putVar(o, zz(wrapA(a-pa, A))*2 + (s.flame ? 1 : 0));
      px = x; py = y; pa = a;
    }
    return Uint8Array.from(o);
  }
  function decode(b){
    const st = {i:0}, ver = b[st.i++], step = b[st.i++], flags = b[st.i++], A = (flags & 1) ? CSTEP : ASTEP;
    const n = getVar(b, st), tail = getVar(b, st), samples = [];
    let x = 0, y = 0, a = 0;
    for (let k=0;k<n;k++){
      x += unzz(getVar(b, st)); y += unzz(getVar(b, st));
      const af = getVar(b, st); a = ((a + unzz(Math.floor(af/2))) % A + A) % A;
      samples.push({x, y, a:a/A*TAU, flame:af & 1});
    }
    const total = n < 2 ? 0 : tail > 0 ? (n-2)*step + tail : (n-1)*step;
    return {ver, step, tail, samples, total};
  }
  const b64 = bytes => { let s = ''; for (let i=0;i<bytes.length;i+=8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i+8192)); return btoa(s); };
  const unb64 = str => { const s = atob(str), o = new Uint8Array(s.length); for (let i=0;i<s.length;i++) o[i] = s.charCodeAt(i); return o; };
  const lerpA = (a0, a1, u) => { let d = (a1-a0) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return a0 + d*u; };

  // Keeps every kth sample and the landing pose, and stretches the step to match, so the run still ends on the tick
  // it ended on. The spline is what makes this survivable: dropping samples curves wider, it does not cut corners.
  function thin(p, k, coarse){
    const n = p.samples.length;
    if (n < 3) return null;
    const q = Math.floor((n-2)/k), out = [];
    for (let i=0;i<=q;i++) out.push(p.samples[i*k]);
    let tail = p.total - q*k*p.step;
    if (tail > 0) out.push(p.samples[n-1]); else tail = 0;
    return b64(encode(out, k*p.step, tail, coarse));
  }
  // A board entry carries about 2 kB and the time shares it, so a long run gives up resolution rather than its
  // ghost. Angle first, because a coarser angle costs less than a coarser path. Null when even the last tier is too
  // big: a cut ghost is worse than none.
  function fit(str, cap){
    cap = cap || CAP;
    if (!str) return null;
    if (str.length <= cap) return str;
    let p; try { p = decode(unb64(str)); } catch (e) { return null; }
    if (p.samples.length < 2) return null;
    for (const [k, coarse] of [[1,1],[2,0],[2,1],[3,1],[4,1],[6,1]]){
      const out = k === 1 ? b64(encode(p.samples, p.step, p.tail, coarse)) : thin(p, k, coarse);
      if (out && out.length <= cap) return out;
    }
    return null;
  }
  // The tick length a stored path claims, for checking a posted time against the run that is supposed to have flown it.
  function ticks(str){ try { return decode(unb64(str)).total; } catch (e) { return 0; } }

  // Pose at ghost tick t, written into `out`. Tangents come from the neighbouring samples, so nothing extra is stored.
  function pose(path, t, out){
    const S = path.samples, n = S.length, o = out || {};
    if (!n) return null;
    if (n === 1 || t <= 0){ o.x = S[0].x; o.y = S[0].y; o.a = S[0].a; o.flame = 0; return o; }
    if (t >= path.total){ const e = S[n-1]; o.x = e.x; o.y = e.y; o.a = e.a; o.flame = 0; return o; }
    const step = path.step, i = Math.min(Math.floor(t/step), n-2), dur = (path.tail > 0 && i === n-2) ? path.tail : step;
    const u = Math.max(0, Math.min(1, (t - i*step)/dur)), p0 = S[i], p1 = S[i+1];
    const pp = S[i-1] || p0, pn = S[i+2] || p1, k = dur/step;       // k rescales the tangents on a short final segment
    const m0x = (p1.x-pp.x)*(S[i-1] ? 0.5 : 1)*k, m0y = (p1.y-pp.y)*(S[i-1] ? 0.5 : 1)*k;
    const m1x = (pn.x-p0.x)*(S[i+2] ? 0.5 : 1)*k, m1y = (pn.y-p0.y)*(S[i+2] ? 0.5 : 1)*k;
    const u2 = u*u, u3 = u2*u, h00 = 2*u3-3*u2+1, h10 = u3-2*u2+u, h01 = -2*u3+3*u2, h11 = u3-u2;
    o.x = h00*p0.x + h10*m0x + h01*p1.x + h11*m1x;
    o.y = h00*p0.y + h10*m0y + h01*p1.y + h11*m1y;
    o.a = lerpA(p0.a, p1.a, u); o.flame = p0.flame;
    return o;
  }
  return {STEP, CAP, encode, decode, b64, unb64, sample, pose, fit, ticks};
})();
