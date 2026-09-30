'use strict';
/* =========================================================================
   REPLAY — records a run and plays it back from trackside cameras.
   Replay.recorder() -> { elapsed, cut(), sample(dt, P, next, visible), finish() -> track | null }
     sample() once a frame while the run is on (and through the finish hold); cut() when the plane is put back after
     a crash, so playback jumps there instead of sweeping through the hills. finish() resamples to an even RATE grid,
     the same shape a stored ghost will have, so what plays here is what a saved run will look like.
   Replay.at(track, t, S) -> S posed at time t (S from Replay.state()), for a ghost flown alongside a run
   Replay.player(track, opt) -> { S, cam, time, step(dt) -> { loop, cut } }
     opt: { ground(x, z), solid(p) (obstacles other than the ground), size (m, rough aircraft length),
          avoid (points, the gates), avoidR (m: no camera closer to them than that), minFrame (m: the view is never framed tighter than this) }
     S: the plane at the current time { pos, q, vdir, speed, gload, tuck, visible, boosting, smoking, next }
     cam: { pos, look, fov (deg, vertical), kind } from a tripod beside the course: each shot is picked a little ahead of
     the plane, off to one side, where the ground and obstacles leave it in sight; the camera pans to follow and cuts to
     a new spot once the plane has gone past and away, or out of sight. kind: 'near', or 'loose' (from further off, framed
     looser and held longer). The track loops.
   ========================================================================= */
const Replay = (() => {
  const RATE = 20;                                          // Hz; Catmull-Rom between samples keeps pans smooth
  const NF = 10;                                            // floats a sample: x y z, qx qy qz qw, speed, gload, tuck
  const VIS = 1, BOOST = 2, SMOKE = 4, CUT = 8;
  const V3 = THREE.Vector3;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function recorder() {
    const t = [], f = [], flags = [], next = [];
    let clock = 0, cut = false;
    return {
      get elapsed() { return t.length ? clock - t[0] : 0; },   // the track time of the latest sample
      cut() { cut = true; },
      sample(dt, P, n, visible) {
        clock += dt;
        t.push(clock);
        f.push(P.pos.x, P.pos.y, P.pos.z, P.q.x, P.q.y, P.q.z, P.q.w, P.speed, P.gload || 1, P.tuck || 0);
        flags.push((visible ? VIS : 0) | (P.boosting ? BOOST : 0) | (P.smoking ? SMOKE : 0) | (cut ? CUT : 0));
        next.push(n); cut = false;
      },
      finish() { return resample(t, f, flags, next); },
    };
  }

  // frame-rate samples onto the even grid; never blends across a cut
  function resample(rt, rf, rflags, rnext) {
    const n = rt.length;
    if (n < 2) return null;
    const t0 = rt[0], m = Math.floor((rt[n - 1] - t0) * RATE) + 1;
    const f = new Float32Array(m * NF), flags = new Uint8Array(m), next = new Uint16Array(m);
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    let j = 0, pend = false;
    for (let i = 0; i < m; i++) {
      const t = t0 + i / RATE;
      while (j < n - 2 && rt[j + 1] <= t) { j++; if (rflags[j] & CUT) pend = true; }
      const a = j, b = j + 1;
      let u = clamp((t - rt[a]) / Math.max(1e-6, rt[b] - rt[a]), 0, 1);
      if (rflags[b] & CUT) u = 0;
      for (let k = 0; k < NF; k++) f[i * NF + k] = rf[a * NF + k] + (rf[b * NF + k] - rf[a * NF + k]) * u;
      qa.fromArray(rf, a * NF + 3); qb.fromArray(rf, b * NF + 3); qa.slerp(qb, u).toArray(f, i * NF + 3);
      const src = u < 0.5 ? a : b;
      flags[i] = (rflags[src] & ~CUT) | (pend ? CUT : 0); pend = false;
      next[i] = rnext[src];
    }
    return { f, flags, next, n: m, duration: (m - 1) / RATE, rate: RATE };
  }

  function makeState() {
    return { pos: new V3(), q: new THREE.Quaternion(), vdir: new V3(0, 0, -1), speed: 0, gload: 1, tuck: 0,
             visible: true, boosting: false, smoking: false, next: 0 };
  }
  const _pm = new V3(), _p0 = new V3(), _p1 = new V3(), _pp = new V3(), _qb = new THREE.Quaternion();
  function at(tr, t, S) {
    const x = clamp(t * RATE, 0, tr.n - 1), i = Math.min(Math.floor(x), tr.n - 2), F = tr.f, fl = tr.flags;
    const hold = fl[i + 1] & CUT, u = hold ? 0 : x - i;
    _p0.fromArray(F, i * NF); _p1.fromArray(F, (i + 1) * NF);
    if (i === 0 || fl[i] & CUT) _pm.copy(_p0); else _pm.fromArray(F, (i - 1) * NF);
    if (hold) _p1.copy(_p0);
    if (i + 2 >= tr.n || fl[i + 2] & CUT || hold) _pp.copy(_p1); else _pp.fromArray(F, (i + 2) * NF);
    const u2 = u * u, u3 = u2 * u;
    for (const c of ['x', 'y', 'z']) {
      const pm = _pm[c], p0 = _p0[c], p1 = _p1[c], pp = _pp[c];
      const b = -pm + p1, cc = 2 * pm - 5 * p0 + 4 * p1 - pp, d = -pm + 3 * p0 - 3 * p1 + pp;
      S.pos[c] = p0 + 0.5 * (b * u + cc * u2 + d * u3);
      S.vdir[c] = 0.5 * (b + 2 * cc * u + 3 * d * u2);
    }
    if (S.vdir.lengthSq() < 1e-8) S.vdir.set(0, 0, -1).applyQuaternion(S.q.fromArray(F, i * NF + 3));
    S.vdir.normalize();
    S.q.fromArray(F, i * NF + 3); _qb.fromArray(F, (i + 1) * NF + 3); S.q.slerp(_qb, u);
    const k0 = i * NF, k1 = (i + 1) * NF;
    S.speed = F[k0 + 7] + (F[k1 + 7] - F[k0 + 7]) * u;
    S.gload = F[k0 + 8] + (F[k1 + 8] - F[k0 + 8]) * u;
    S.tuck = F[k0 + 9] + (F[k1 + 9] - F[k0 + 9]) * u;
    const src = hold || u < 0.5 ? i : i + 1, g = fl[src];
    S.visible = !!(g & VIS); S.boosting = !!(g & BOOST); S.smoking = !!(g & SMOKE); S.next = tr.next[src];
    return S;
  }

  /* ---------- trackside cameras ---------- */
  const LEADS = [2.4, 3.4, 1.6];                            // s ahead the shot is set up, first choice first
  const HEIGHTS = [-3, 5, 16];                              // m relative to the plane there
  const MIN_SHOT = 1.6, MAX_SHOT = 14, BLOCKED_CUT = 0.35;  // s
  const PLAN_MS = 3;                                        // ms a frame for picking the next shot
  const FAR_MAX = 260;                                      // m: past this the haze swallows even a zoomed-in plane
  // loose shots: set LOOSE times further off than usual, framed looser and held longer. Half the shots of a manoeuvre
  // (upside down, pulling up steeply or round most of a circle, starting within MANOEUVRE_SOON s), and otherwise about
  // one shot in LOOSE_EVERY
  const LOOSE = 2.2, LOOSE_EVERY = 5, LOOSE_MAX = 330, MANOEUVRE_LOOK = 8, MANOEUVRE_SOON = 4;   // -, -, m, s, s
  function director(tr, opt) {
    const size = opt.size || 9, frameH = Math.max(size * 5, opt.minFrame || 0);   // about five aircraft lengths tall
    const cam = { pos: new V3(), look: new V3(), fov: 50, kind: 'near' };
    const S = makeState(), _c = new V3(), _d = new V3(), _s = new V3(), _r = new V3();
    let shot = null, side = 1, lastDist = 0, blocked = 0, sinceLoose = 0;
    const _u = new V3(), acts = [], rates = [];

    function clear(from, to) {                             // line of sight, stopping short of the plane itself
      _r.subVectors(to, from);
      const len = _r.length(), end = len - size * 0.8;
      if (end <= 0) return true;
      _r.divideScalar(len);
      const step = Math.max(3, len / 48);
      for (let s = step, k = 0; s < end; s += step, k++) {
        const x = from.x + _r.x * s, y = from.y + _r.y * s, z = from.z + _r.z * s;
        if (y < opt.ground(x, z) + 0.3) return false;
        if (opt.solid && k % 2 === 0 && opt.solid(_s.set(x, y, z))) return false;
      }
      return true;
    }
    function nearAvoid(p) {                                 // right beside a gate, which would fill the frame
      const r2 = (opt.avoidR || 0) ** 2;
      if (opt.avoid) for (const a of opt.avoid) if (a.distanceToSquared(p) < r2) return true;
      return false;
    }
    function segEnd(t) {                                    // next cut after t, or the end
      for (let i = Math.floor(t * RATE) + 1; i < tr.n; i++) if (tr.flags[i] & CUT) return i / RATE;
      return tr.duration;
    }
    function* score(pos, t0, t1) {                         // share of the window the plane is in sight; -1 if too close
      let seen = 0, all = 0;
      for (let t = t0; t <= t1; t += 0.2) {
        at(tr, t, S);
        if (!S.visible) continue;
        if (S.pos.distanceTo(pos) < size * 1.6) return -1;
        all++; if (clear(pos, S.pos)) seen++;
        yield;
      }
      return all ? seen / all : 0;
    }
    function manoeuvreAhead(t, end) {
      const t1 = Math.min(t + MANOEUVRE_LOOK, end);
      let turn = 0, prevYaw = null;
      acts.length = 0; rates.length = 0;
      for (let u = t; u <= t1; u += 0.25) {
        at(tr, u, S);
        const upY = _u.set(0, 1, 0).applyQuaternion(S.q).y, yaw = Math.atan2(S.vdir.x, S.vdir.z);
        let dy = 0;
        if (prevYaw != null) { dy = yaw - prevYaw; dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI; turn += Math.abs(dy); }
        prevYaw = yaw;
        acts.push(upY < -0.2 || Math.abs(S.vdir.y) > 0.75); rates.push(Math.abs(dy) / 0.25);
      }
      const circling = turn > 4;                              // most of a circle: a thermal, a turn round a pylon
      const soon = Math.min(acts.length, MANOEUVRE_SOON / 0.25 + 1);
      for (let i = 0; i < soon; i++) if (acts[i] || (circling && rates[i] > 0.45)) return true;
      return false;
    }
    // a generator, one candidate a step, so a cut's search can spread over a few frames
    function* planGen(t) {
      const end = segEnd(t);
      const loose = manoeuvreAhead(t, end) ? Math.random() < 0.5 : sinceLoose >= LOOSE_EVERY - 1;
      if (loose) { const w = yield* planNear(t, end, LOOSE); if (w.sc >= 0.85) return w; }
      return yield* planNear(t, end, 1);
    }
    // the usual shot: a little ahead of the plane and off to one side; m > 1 sets it further off and frames it looser
    function* planNear(t, end, m) {
      let best = null;
      const k = clamp(70 / Math.max(1, at(tr, t, S).speed), 0.8, 1);   // fast (the jet): set up nearer, or it starts far off
      search: for (const lead of LEADS) {
        const ta = Math.min(t + lead * k * Math.sqrt(m), end), t1 = Math.min(ta + 3.5 * k * Math.sqrt(m), end);
        at(tr, ta, S);
        _d.set(S.vdir.x, 0, S.vdir.z);
        if (_d.lengthSq() < 1e-4) _d.set(0, 0, -1).applyQuaternion(S.q).setY(0);
        _d.normalize();
        const L0 = clamp(S.speed * 0.6, frameH * 0.5, frameH * 1.5) * m, py = S.pos.y, px = S.pos.x, pz = S.pos.z;
        for (const sd of [-side, side]) for (const L of [L0, L0 * 1.7]) for (const h of HEIGHTS) {
          _c.set(px - _d.z * sd * L + _d.x * L * 0.35, 0, pz + _d.x * sd * L + _d.z * L * 0.35);
          const g = opt.ground(_c.x, _c.z);
          _c.y = Math.max(py + h, g + 2.5);
          if (opt.solid && opt.solid(_c)) continue;
          if (nearAvoid(_c)) continue;
          // looking steeply down on the plane (a camera up a slope beside it) reads badly: prefer level or below
          const up = Math.max(0, _c.y - py) / L;
          const pos = _c.clone(), sc = (yield* score(pos, t, t1)) - (sd === side ? 0.04 : 0) - Math.max(0, up - 0.3) * 0.5;
          if (!best || sc > best.sc) best = { sc, pos, side: sd, m };
          if (sc >= 0.94) break search;
        }
        if (best && best.sc >= 0.9) break;
      }
      at(tr, t, S);
      if (m > 1) return best || { sc: -1 };
      if (!best || best.sc < 0.25) {                        // nowhere good: hang back above and behind the plane
        _d.copy(S.vdir).setY(0).normalize();
        best = { pos: S.pos.clone().addScaledVector(_d, -size * 5), side, m: 1 };
        best.pos.y = Math.max(S.pos.y + size * 1.5, opt.ground(best.pos.x, best.pos.z) + 3);
      }
      return best;
    }
    function apply(best, t, S) {
      side = best.side;
      sinceLoose = best.m > 1 ? 0 : sinceLoose + 1;
      const m = best.m || 1;
      // gone past and this far away: time for the next camera (well within what the zoom can still frame)
      shot = { pos: best.pos, t0: t, m,
               far: Math.min(m > 1 ? LOOSE_MAX : FAR_MAX, clamp(best.pos.distanceTo(S.pos) * 0.9, frameH * 3 * m, frameH * 6 * m)) };
      blocked = 0; lastDist = best.pos.distanceTo(S.pos);
      return true;
    }
    function plan(t, S) { const g = planGen(t); let r; do r = g.next(); while (!r.done); return apply(r.value, t, S); }
    let pending = null;                                     // a search under way: the current shot runs on meanwhile
    function stepPlan(t, S) {
      const until = performance.now() + PLAN_MS;
      let r;
      do r = pending.next(); while (!r.done && performance.now() < until);
      if (!r.done) return false;
      pending = null;
      return apply(r.value, t, S);
    }
    function aimAt(S, out) { return out.copy(S.pos).addScaledVector(S.vdir, S.speed * 0.08); }
    const fovFor = (d, m = 1) => clamp(2 * Math.atan(frameH * m / 2 / Math.max(d, 1)) * 180 / Math.PI, 8, 62);

    return {
      cam,
      reset() { shot = null; side = 1; pending = null; sinceLoose = 0; },
      // S: the plane at time t (already sampled); fresh: the track looped or jumped, so start a new shot
      update(t, dt, S, fresh) {
        let cut = false;
        if (!shot || fresh) { pending = null; cut = plan(t, S); }   // nothing to show meanwhile: pick at once
        else if (pending) cut = stepPlan(t, S);
        else {
          const d = shot.pos.distanceTo(S.pos), age = t - shot.t0;
          if (S.visible) blocked = clear(shot.pos, S.pos) ? 0 : blocked + dt;
          const away = d > shot.far && d > lastDist;
          if (S.visible && age > MIN_SHOT && (away || blocked > BLOCKED_CUT || age > (shot.m > 1 ? MAX_SHOT * 1.3 : MAX_SHOT))) { pending = planGen(t); cut = stepPlan(t, S); }
          else lastDist = d;
        }
        const d = shot.pos.distanceTo(S.pos), fov = fovFor(d, shot.m);
        cam.pos.copy(shot.pos);
        cam.kind = shot.m > 1 ? 'loose' : 'near';
        aimAt(S, _s);
        if (cut) { cam.look.copy(_s); cam.fov = fov; }
        else {
          cam.look.lerp(_s, 1 - Math.exp(-14 * dt));
          cam.fov += (fov - cam.fov) * (1 - Math.exp(-4 * dt));
        }
        return cut;
      },
    };
  }

  function player(tr, opt) {
    const S = makeState(), dir = director(tr, opt);
    let t = 0, lastI = -1;
    return {
      S, cam: dir.cam, track: tr,
      get time() { return t; },
      step(dt) {
        t += dt;
        let loop = false, cut = false;
        if (lastI < 0 || t > tr.duration) { t = 0; loop = true; lastI = 0; dir.reset(); }
        const i = Math.min(tr.n - 1, Math.floor(t * RATE));
        for (let k = lastI + 1; k <= i; k++) if (tr.flags[k] & CUT) cut = true;
        lastI = i;
        at(tr, t, S);
        dir.update(t, dt, S, loop || cut);
        return { loop, cut };
      },
    };
  }

  return { RATE, recorder, player, at, state: makeState };
})();
