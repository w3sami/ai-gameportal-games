// Rider physics: riding, flying, grinding, crashing.
//
// One state object, stepped at a fixed rate. Modes:
//   ground  follows the surface; leaves it whenever the surface drops away
//           faster than gravity pulls (a kicker lip, a crest, a roof edge)
//   air     ballistic; left/right spins, up/down flips
//   grind   locked to a rail until its end, a jump, or too little speed
//   crash   one of three: 'bury' (head first into the snow), 'ragdoll'
//           (tumbling), or 'snowball' (a fast ragdoll rolls up into a ball).
//           Each plays out, the screen fades, and the rider stands at the
//           last checkpoint passed (W.checkpoints), ready to push off.
//   ready   standing still; the jump button pushes off with the poles
//
// Only a landing off upright crashes. Upright but sideways, or hard, only
// costs speed: these are pro riders.
//
// Heading 0 faces downhill (-z); positive heading turns left.
// Trick points gather in s.run during air and grind and are banked on a clean
// landing; a crash throws them away. Everything the game shows is reported
// through ev(type, data).

import { heightAt, groundAt, surfaceAt, HALF_WIDTH, placeStartRamp } from './terrain.js';

const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createPhysics(T, W, ev) {
  const s = {};
  let gear = 'skis';
  const G = () => T[gear];

  function reset(z = 4) {
    placeStartRamp(0, z);
    Object.assign(s, {
      x: 0, z, y: heightAt(0, z), vx: 0, vy: 0, vz: 0,
      heading: 0, mode: 'ready', readyLock: false, started: false, fade: 0, poleT: 0, pushAnim: 0, crash: null, lastLand: null, checkpoint: 0, tilt: 0, lean: 0, crouch: 0,
      trickYaw: 0, trickPitch: 0, spinV: 0, flipV: 0, airT: 0, bounces: [], hovered: 0,
      switchStance: false, charge: 0, jumpHeld: false,
      grind: null, railCooldown: null, crashT: 0, invuln: 0, bounceGrace: 0,
      run: { pts: 0, parts: [] },
      finished: false,
    });
  }

  const dirX = () => -Math.sin(s.heading), dirZ = () => -Math.cos(s.heading);

  function speed() { return Math.hypot(s.vx, s.vz); }

  // ---- ground --------------------------------------------------------------

  function stepGround(dt, inp) {
    const g = G();
    const e = 0.25;
    let gx = (heightAt(s.x + e, s.z) - heightAt(s.x - e, s.z)) / (2 * e);
    let gz = (heightAt(s.x, s.z + e) - heightAt(s.x, s.z - e)) / (2 * e);
    if (Math.abs(gx) > 2 || Math.abs(gz) > 2) { gx = clamp(gx, -2, 2); gz = clamp(gz, -2, 2); }
    const k = T.gravity / (1 + gx * gx + gz * gz);
    s.vx -= gx * k * dt;
    s.vz -= gz * k * dt;

    const sp = speed();
    const steer = s.finished ? 0 : inp.x;
    s.heading -= steer * g.turnRate * (1 + 2 / (1 + sp)) * dt;
    const dx = dirX(), dz = dirZ(), rx = -dz, rz = dx;
    let f = s.vx * dx + s.vz * dz, l = s.vx * rx + s.vz * rz;
    // how far across the travel the skis point: 0 straight, 1 fully sideways
    const across = sp > 0.5 ? 1 - Math.abs(f) / Math.hypot(f, l) : 0;
    const braking = s.finished || inp.down > 0.3;
    const nl = l * Math.exp(-(braking ? g.grip * 0.6 : g.grip) * dt);
    f += Math.abs(l - nl) * T.carveKeep;
    l = nl;
    const tuck = inp.up > 0.3 && !s.finished;
    const drag = g.drag * (tuck ? T.tuckDrag : 1);
    f -= (g.friction * (tuck ? T.tuckFriction : 1) * T.gravity + drag * f * f) * dt;
    if (tuck) {
      f += T.tuckPush * inp.up * dt;
      // slow enough to need it: push with the poles every so often
      if (sp < T.poleBelow) {
        s.poleT += dt;
        if (s.poleT > T.poleEvery) { s.poleT = 0; f += T.polePush; s.pushAnim = 0.35; }
      } else s.poleT = T.poleEvery * 0.9;
    } else s.poleT = T.poleEvery * 0.9;
    if (braking) f -= T.brake * (s.finished ? 1 : inp.down) * dt;
    f = clamp(f, -6, g.maxSpeed);   // slow enough on an uphill ramp, slide back down it
    s.vx = f * dx + l * rx;
    s.vz = f * dz + l * rz;

    s.crouch += ((inp.up > 0.3 ? 0.6 : 0) + (inp.jump ? 1 : 0) * 0.7 - s.crouch) * Math.min(1, dt * 10);
    s.lean += (steer * Math.min(1, sp / 12) * 0.45 - s.lean) * Math.min(1, dt * 8);
    const slopeF = gx * dx + gz * dz;
    s.tilt += (Math.atan(slopeF) - s.tilt) * Math.min(1, dt * 10);

    // snow off the edges: sprayStraight of it running straight, all of it
    // fully sideways, more when braking; scaled by speed
    const spray = (T.sprayStraight + (1 - T.sprayStraight) * across + (braking ? 0.5 : 0)) * Math.min(1, sp / 15);
    if (spray > 0.02) ev('spray', { x: s.x, y: s.y, z: s.z, amount: spray });

    // jump: hold to crouch, release to pop
    if (inp.jump && !s.finished) s.charge = Math.min(T.chargeTime, s.charge + dt);
    if (!inp.jump && s.jumpHeld && !s.finished) {
      if (sp < T.pushBelow && !surfaceAt(s.x, s.z)) { s.jumpHeld = false; s.charge = 0; return pushOff(); }
      s.vy += g.jump * (0.65 + 0.35 * (s.charge / T.chargeTime));
      s.charge = 0;
      s.jumpHeld = false;
      takeOff();
      s.y += 0.02;
      return;
    }
    s.jumpHeld = inp.jump;

    let nx = s.x + s.vx * dt, nz = s.z + s.vz * dt;
    let h = heightAt(nx, nz);
    if (h - s.y > T.step) {
      // into a wall: slide along it if one axis is free, crash only if fast
      const okX = heightAt(nx, s.z) - s.y <= T.step, okZ = heightAt(s.x, nz) - s.y <= T.step;
      const into = okX && !okZ ? Math.abs(s.vz) : okZ && !okX ? Math.abs(s.vx) : speed();
      if (into > 4) return wallHit();
      if (okX && !okZ) { s.vz = 0; nz = s.z; }
      else if (okZ && !okX) { s.vx = 0; nx = s.x; }
      else { s.vx *= -0.3; s.vz *= -0.3; return; }
      h = heightAt(nx, nz);
    }
    const yAir = s.y + s.vy * dt - 0.5 * T.gravity * dt * dt;
    s.x = nx; s.z = nz;
    if (yAir > h + 0.01) {
      s.y = yAir;
      s.vy -= T.gravity * dt;
      takeOff();
    } else {
      s.vy = (h - s.y) / dt;
      s.y = h;
    }
  }

  // Poles in, a shove and a little hop: from standing still or from crawling.
  function pushOff() {
    const sp = speed();
    const add = Math.max(0, T.pushSpeed - sp);
    s.vx += dirX() * add; s.vz += dirZ() * add;
    s.vy += T.pushHop;
    s.pushAnim = 0.4;
    s.started = true;
    takeOff();
    s.y += 0.02;
    ev('push', { x: s.x, y: s.y, z: s.z });
  }

  function stepReady(dt, inp) {
    s.y = heightAt(s.x, s.z);
    s.vx = s.vz = s.vy = 0;
    s.crouch += ((inp.jump ? 0.7 : 0) - s.crouch) * Math.min(1, dt * 10);
    s.tilt += (0 - s.tilt) * Math.min(1, dt * 10);
    // a button already down when standing up must come up before it counts
    if (s.readyLock) { if (!inp.jump) s.readyLock = false; return; }
    if (!inp.jump && s.jumpHeld) { s.jumpHeld = false; s.mode = 'ground'; return pushOff(); }
    s.jumpHeld = inp.jump;
  }

  function takeOff() {
    s.mode = 'air';
    s.trickYaw = 0; s.trickPitch = 0; s.spinV = 0; s.flipV = 0;
    s.airT = 0; s.hovered = 0; s.bounces = [];
  }

  // ---- air -------------------------------------------------------------------

  function stepAir(dt, inp) {
    const g = G();
    const spinIn = -inp.x, flipIn = inp.down - inp.up;
    s.spinV += (spinIn * g.spinRate - s.spinV) * Math.min(1, dt * T.spinResponse);
    s.flipV += (flipIn * g.flipRate - s.flipV) * Math.min(1, dt * T.spinResponse);
    s.trickYaw += s.spinV * dt;
    s.trickPitch += s.flipV * dt;
    // with the stick released, ease toward the nearest landable angle
    if (Math.abs(flipIn) < 0.2) {
      const err = wrap(s.trickPitch);
      if (Math.abs(err) < T.levelPitch) s.trickPitch -= Math.sign(err) * Math.min(Math.abs(err), T.levelRate * dt);
    }
    if (Math.abs(spinIn) < 0.2) {
      const err = wrap(s.trickYaw * 2) / 2;
      if (Math.abs(err) < T.levelYaw) s.trickYaw -= Math.sign(err) * Math.min(Math.abs(err), T.levelRate * dt);
    }
    s.crouch += ((Math.abs(flipIn) > 0.2 ? 0.8 : 0.2) - s.crouch) * Math.min(1, dt * 8);
    s.lean *= Math.exp(-4 * dt);
    s.tilt *= Math.exp(-2 * dt);

    // a board spun hard enough rotor-hovers
    const rotor = g.hover * clamp(Math.abs(s.spinV) / g.spinRate, 0, 1) * (s.vy < 0 ? 1 : 0.4);
    if (rotor > 0.2) s.hovered += dt;
    s.vy -= T.gravity * (1 - rotor) * dt;
    s.airT += dt;

    const px = s.x, py = s.y, pz = s.z;
    const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt, nz = s.z + s.vz * dt;

    if (s.vy < 1 && tryRail(nx, ny, nz, py)) return;

    const h = heightAt(nx, nz);
    if (h - py > T.step && ny < h) {
      // flew into a wall: hold position across it and keep the vertical motion,
      // so a rider still rising goes over the edge instead of through it
      s.y = Math.max(ny, heightAt(s.x, s.z));
      if (s.y <= heightAt(s.x, s.z)) { s.y = heightAt(s.x, s.z); s.vx *= -0.2; s.vz *= -0.2; return land(); }
      if (!s.bonk) ev('bonk', { x: s.x, y: s.y, z: s.z });
      s.bonk = true;
      return;
    }
    s.bonk = false;
    if (ny <= h) {
      s.x = nx; s.z = nz; s.y = h;
      return land();
    }
    s.x = nx; s.y = ny; s.z = nz;
  }

  function land() {
    const g = G();
    const pe = wrap(s.trickPitch), ye = wrap(s.trickYaw);
    const upright = Math.abs(pe) < T.landPitch;
    const facing = Math.abs(ye) < T.landYaw || Math.abs(ye) > Math.PI - T.landYaw;
    // how hard into the slope: compare the fall to the slope's own drop
    const e = 0.25;
    const sp = speed();
    let slopeVy = 0;
    if (sp > 0.1) {
      const ux = s.vx / sp, uz = s.vz / sp;
      // clamped: across a roof edge the difference is a wall, not a slope
      slopeVy = clamp((heightAt(s.x + ux * e, s.z + uz * e) - heightAt(s.x - ux * e, s.z - uz * e)) / (2 * e), -0.6, 0.6) * sp;
    }
    const impact = slopeVy - s.vy;
    // kept for the tuning panel's dials
    s.lastLand = { pitch: pe, yaw: ye, result: !upright ? (Math.abs(pe) > T.headFirst ? 'bury' : 'ragdoll') : facing ? 'ok' : 'skid' };
    if (!upright) return crash(s.lastLand.result);
    if (impact > T.slamImpact) { s.lastLand.result = 'slam'; return crash('slam', sp, impact); }

    // the rider keeps facing the way they came down: landing angled is an
    // instant turn, as the edges' grip swings the speed round to the heading
    let off = ye;
    if (Math.abs(ye) > Math.PI / 2) { s.switchStance = !s.switchStance; off = wrap(ye - Math.PI); }
    s.heading += off;
    // hard or sideways: skid it out, no fall
    let loss = 1 - Math.min(0.4, Math.max(0, impact - 4) * T.hardLoss);
    if (!facing) loss *= T.sidewaysKeep;
    if (!facing || impact > 10) ev('spray', { x: s.x, y: s.y, z: s.z, amount: 1 });
    s.vx *= loss; s.vz *= loss;
    s.vy = slopeVy;

    const P = T.points;
    const flips = Math.round(Math.abs(s.trickPitch) / TAU);
    const halfs = Math.round(Math.abs(s.trickYaw) / Math.PI);
    if (flips > 0) {
      const name = s.trickPitch < 0 ? 'etuvoltti' : 'takavoltti';
      const pre = ['', '', 'Tupla-', 'Tripla-', 'Nelois-'][Math.min(4, flips)];
      addPart(pre ? pre + name : name[0].toUpperCase() + name.slice(1), P.flip * flips);
    }
    if (halfs > 0) {
      const heli = gear === 'board' && s.hovered > 0.5 && halfs >= 4;
      addPart((heli ? 'Helikopteri ' : '') + halfs * 180, P.spin180 * halfs * (heli ? 1.5 : 1));
    }
    if (s.airT > 1.2) addPart('Ilmaa ' + s.airT.toFixed(1).replace('.', ',') + ' s', Math.round(P.airSecond * s.airT));
    s.mode = 'ground';
    s.trickYaw = 0; s.trickPitch = 0;
    ev('land', { impact, x: s.x, y: s.y, z: s.z });
    bank();
  }

  function addPart(name, pts) {
    s.run.parts.push(name);
    s.run.pts += pts;
  }

  function bank() {
    const r = s.run;
    if (r.parts.length) {
      const mult = 1 + 0.5 * (r.parts.length - 1);
      ev('score', { parts: r.parts.slice(), pts: Math.round(r.pts * mult), mult });
    }
    s.run = { pts: 0, parts: [] };
  }

  // ---- rails ----------------------------------------------------------------

  function tryRail(nx, ny, nz, py) {
    for (const rl of W.rails) {
      if (s.railCooldown && s.railCooldown.rl === rl && s.railCooldown.t > 0) continue;
      const ex = rl.bx - rl.ax, ez = rl.bz - rl.az;
      const L2 = ex * ex + ez * ez;
      const t = clamp(((nx - rl.ax) * ex + (nz - rl.az) * ez) / L2, 0, 1);
      const qx = rl.ax + ex * t, qz = rl.az + ez * t, qy = rl.ay + (rl.by - rl.ay) * t;
      if (Math.hypot(nx - qx, nz - qz) > 0.55) continue;
      if (ny > qy + 0.5 || ny < qy - 0.6 || py < qy - 0.25) continue;
      if (t <= 0 || t >= 1) continue;
      const L = Math.hypot(ex, rl.by - rl.ay, ez);
      const ux = ex / L, uy = (rl.by - rl.ay) / L, uz = ez / L;
      const along = s.vx * ux + s.vz * uz + s.vy * uy;
      // tricks done on the way in still count
      const pe = wrap(s.trickPitch);
      if (Math.abs(pe) > T.landPitch) return false;
      const flips = Math.round(Math.abs(s.trickPitch) / TAU), halfs = Math.round(Math.abs(s.trickYaw) / Math.PI);
      if (flips) addPart(s.trickPitch < 0 ? 'Etuvoltti' : 'Takavoltti', T.points.flip * flips);
      if (halfs) addPart(String(halfs * 180), T.points.spin180 * halfs);
      s.grind = { rl, t, sp: along, L, ux, uy, uz, time: 0 };
      s.mode = 'grind';
      s.trickYaw = 0; s.trickPitch = 0;
      s.switchStance = false;
      s.heading = Math.atan2(-ux * Math.sign(along || 1), -uz * Math.sign(along || 1));
      ev('grindStart', { kind: rl.kind });
      return true;
    }
    return false;
  }

  function stepGrind(dt, inp) {
    const gr = s.grind;
    gr.sp += -T.gravity * gr.uy * dt;
    gr.sp -= Math.sign(gr.sp) * T.railFriction * dt;
    gr.t += (gr.sp * dt) / gr.L;
    gr.time += dt;
    const rl = gr.rl;
    s.x = rl.ax + (rl.bx - rl.ax) * gr.t;
    s.y = rl.ay + (rl.by - rl.ay) * gr.t;
    s.z = rl.az + (rl.bz - rl.az) * gr.t;
    s.vx = gr.ux * gr.sp; s.vy = gr.uy * gr.sp; s.vz = gr.uz * gr.sp;
    s.crouch += (0.5 - s.crouch) * Math.min(1, dt * 8);
    s.lean = Math.sin(gr.time * 7) * 0.08;
    ev('sparks', { x: s.x, y: s.y, z: s.z });

    const leave = (vyAdd, side = 0) => {
      const name = rl.kind === 'ridge' ? 'Harjagrindi' : 'Kaidegrindi';
      addPart(name + ' ' + gr.time.toFixed(1).replace('.', ',') + ' s', Math.round(T.points.grindSecond * gr.time));
      s.grind = null;
      s.railCooldown = { rl, t: 0.5 };
      takeOff();
      s.vy += vyAdd;
      s.vx += Math.cos(s.heading) * side * 3;
      s.vz += -Math.sin(s.heading) * side * 3;
      s.y += 0.05;
    };
    if (gr.t <= 0 || gr.t >= 1) return leave(1.5);
    if (Math.abs(gr.sp) < 0.8) return leave(0, 1);
    if (inp.jump && !s.jumpHeld) { s.jumpHeld = true; return leave(G().jump); }
    s.jumpHeld = inp.jump;
    if (Math.abs(inp.x) > 0.8) { gr.sideT = (gr.sideT || 0) + dt; if (gr.sideT > 0.2) return leave(2, Math.sign(inp.x)); }
  }

  // ---- crash ------------------------------------------------------------------

  function wallHit() {
    const sp = speed();
    if (sp > 0.1) { s.x -= (s.vx / sp) * 0.4; s.z -= (s.vz / sp) * 0.4; }
    s.vx *= -0.25; s.vz *= -0.25;
    if (sp < 4) { s.y = heightAt(s.x, s.z); return; }
    crash('ragdoll', sp);
  }

  // A heading near the wanted one that is not straight into a wall.
  function freeHeading(want) {
    for (const d of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
      const h = want + d;
      let ok = true;
      for (const r of [1, 2.5]) {
        if (heightAt(s.x - Math.sin(h) * r, s.z - Math.cos(h) * r) - s.y > T.step) { ok = false; break; }
      }
      if (ok) return h;
    }
    return want;
  }

  /** kind: 'bury' | 'ragdoll' | 'slam'; a ragdoll fast enough becomes a snowball. */
  function crash(kind, sp = speed(), impact = 0) {
    if (s.mode === 'crash') return;
    if (kind === 'ragdoll' && sp > T.snowballSpeed) kind = 'snowball';
    s.mode = 'crash';
    s.lastCrash = kind;
    // head first: the faster, the bigger the heap and the less of the rider
    // shows; at full speed only legs and skis stick out of its top
    let mound = 0.6 + Math.min(sp, 30) * 0.045;
    // a slam sinks the rider, limbs every which way, by how far past the
    // limit the impact went, in a heap of its own size
    const over = Math.max(0, impact - T.slamImpact);
    if (kind === 'slam') mound = T.slamMound * (0.7 + Math.min(over, 25) * 0.06);
    s.crash = {
      kind, t: 0, sp, r: 0.4, mound, mx: s.x, mz: s.z,
      sink: Math.min(1.3, 0.35 + over * 0.05),
      pose: Array.from({ length: 8 }, () => Math.random() * 2 - 1),
      // how far the upside-down rider sinks: hips at the heap's top when fast,
      // 0.6 m above it when slow
      depth: 0.9 - mound * 0.5 - 0.6 * (1 - Math.min(sp, 25) / 25),
    };
    s.grind = null;
    s.run = { pts: 0, parts: [] };
    ev('crash', { kind, x: s.x, y: s.y, z: s.z, sp });
  }

  function moveCrash(dt) {
    const nx = s.x + s.vx * dt, nz = s.z + s.vz * dt;
    if (heightAt(nx, nz) - s.y < T.step) { s.x = nx; s.z = nz; }
    else { s.vx *= -0.3; s.vz *= -0.3; }
  }

  function stepCrash(dt) {
    const c = s.crash;
    c.t += dt;
    if (c.kind === 'slam') {
      // stuck in the heap until the fade
      const k = Math.exp(-10 * dt);
      s.vx *= k; s.vz *= k;
      s.y = heightAt(s.x, s.z); s.vy = 0;
      fadeOut(c.t, T.slamTime);
    } else if (c.kind === 'bury') {
      const k = Math.exp(-10 * dt);
      s.vx *= k; s.vz *= k;
      moveCrash(dt);
      s.y = heightAt(s.x, s.z); s.vy = 0;
      fadeOut(c.t, T.buryTime);
    } else if (c.kind === 'ragdoll') {
      const k = Math.exp(-2.2 * dt);
      s.vx *= k; s.vz *= k;
      moveCrash(dt);
      s.vy -= T.gravity * dt;
      s.y += s.vy * dt;
      const h = heightAt(s.x, s.z);
      if (s.y <= h) { s.y = h; s.vy = s.vy < -2 ? -s.vy * 0.35 : 0; }
      fadeOut(c.t, T.ragdollTime);
    } else {
      // snowball: rolls down the fall line growing, then the screen fades
      const e = 0.3;
      const gx = clamp((heightAt(s.x + e, s.z) - heightAt(s.x - e, s.z)) / (2 * e), -1, 1);
      const gz = clamp((heightAt(s.x, s.z + e) - heightAt(s.x, s.z - e)) / (2 * e), -1, 1);
      s.vx -= gx * T.gravity * 0.8 * dt; s.vz -= gz * T.gravity * 0.8 * dt;
      const k = Math.exp(-0.3 * dt);
      s.vx *= k; s.vz *= k;
      moveCrash(dt);
      s.y = heightAt(s.x, s.z);
      c.r = Math.min(T.snowballMax, 0.4 + c.t * T.snowballGrow);
      fadeOut(c.t, T.snowballTime);
    }
  }

  // The last 0.6 s of a crash fade to black; then back to the checkpoint.
  function fadeOut(t, total) {
    s.fade = clamp((t - (total - 0.6)) / 0.5, 0, 1);
    if (t > total) respawn();
  }

  // Stand at the last checkpoint passed, facing downhill, ready to push off.
  function respawn() {
    const cp = W.checkpoints[s.checkpoint] || { x: 0, z: 4 };
    s.x = cp.x; s.z = cp.z;
    placeStartRamp(s.x, s.z);
    s.y = heightAt(s.x, s.z);
    s.vx = s.vy = s.vz = 0;
    s.heading = 0; s.tilt = 0; s.lean = 0;
    s.crash = null;
    s.trickYaw = 0; s.trickPitch = 0; s.crouch = 0;
    s.switchStance = false;
    s.mode = 'ready';
    s.jumpHeld = false;
    s.readyLock = true;     // a button already down must come up before it pushes
    s.invuln = 1.5;
    ev('respawn', { checkpoint: s.checkpoint });
  }

  // ---- things in the way --------------------------------------------------------

  function collide() {
    for (const st of W.stars) {
      if (st.taken) continue;
      if (Math.abs(st.z - s.z) > T.starReach + 0.5) continue;
      if (Math.hypot(st.x - s.x, st.y - (s.y + 0.9), st.z - s.z) < T.starReach) {
        st.taken = true; st.mesh.visible = false;
        ev('star', { x: st.x, y: st.y, z: st.z });
      }
    }

    if (s.mode === 'air' && s.vy < 0) {
      for (const b of W.bouncers) {
        if (Math.abs(b.z - s.z) > 6) continue;
        if (b.kind === 'tree') {
          if (Math.hypot(b.x - s.x, b.z - s.z) < b.r && s.y < b.y + 1.5 && s.y > b.y - 1.2) bounce(b, T.bouncePower, 'Latvapomppu');
        } else if (b.kind === 'awning') {
          if (s.x > b.x0 && s.x < b.x1 && s.z > b.z0 - 0.3 && s.z < b.z1 + 0.3 && s.y < b.y + 0.4 && s.y > b.y - 0.8) bounce(b, T.awningPower, 'Markiisi');
        } else if (b.kind === 'balloon') {
          const dx = s.x - b.x, dy = s.y + 0.5 - b.y, dz = s.z - b.z, d = Math.hypot(dx, dy, dz);
          if (d < b.r + 0.6) {
            if (dy > b.r * 0.2) bounce(b, T.balloonPower, 'Pallopomppu');
            else {
              // from the side or below: slide off it downward, still on course
              s.vx *= 0.7; s.vz *= 0.7;
              s.vy = Math.min(s.vy, -3);
              s.x += (dx / (Math.hypot(dx, dz) || 1)) * 0.1;
            }
          }
        }
      }
    }

    if (s.invuln > 0) return;
    for (const o of W.obstacles) {
      if (o.alive === false || o.hidden) continue;
      const reach = o.r + 0.35 + (o.len || 0);
      if (Math.abs(o.z - s.z) > reach || Math.abs(o.x - s.x) > reach + 1) continue;
      let d;
      if (o.len) {  // a car: a capsule along x
        const cx = clamp(s.x, o.x - o.len, o.x + o.len);
        d = Math.hypot(s.x - cx, s.z - o.z);
      } else d = Math.hypot(s.x - o.x, s.z - o.z);
      if (d > o.r + 0.35) continue;
      const oAbove = s.y - groundAt(o.x, o.z);
      if (o.kind === 'break') {
        if (oAbove > o.top) continue;
        o.alive = false; o.mesh.visible = false; o.sh.visible = false;
        s.vx *= 0.93; s.vz *= 0.93;
        ev('break', { o });
      } else if (o.kind === 'tree') {
        if (s.bounceGrace > 0 || oAbove > o.top) continue;
        // the crown narrows toward the top; the trunk is all there is below a metre
        const crown = oAbove < 1 ? 0.35 : o.r * (1 - oAbove / o.top);
        if (d < crown + 0.2) { const sp = speed(); s.vx *= 0.2; s.vz *= 0.2; crash('ragdoll', sp); return; }
      } else {
        if (oAbove > o.top) continue;
        const sp = speed();
        s.vx *= 0.5; s.vz *= 0.5;
        crash('ragdoll', sp);
        return;
      }
    }
  }

  function bounce(b, power, name) {
    s.vy = Math.max(power, -s.vy * 0.6);
    s.bounceGrace = 0.4;
    if (b.kind === 'awning' && b.aimX !== undefined) {
      // a side awning throws the rider up and across onto the ridge: the
      // sideways speed that comes down on it at its height
      const disc = s.vy * s.vy - 2 * T.gravity * (b.aimY - s.y);
      const t = disc > 0 ? (s.vy + Math.sqrt(disc)) / T.gravity : s.vy / T.gravity;
      s.vx = (b.aimX - s.x) / t;
      s.vz *= T.awningKeep;
    } else if (b.kind === 'awning') { s.vx *= 0.5; s.vz *= T.awningKeep; }
    b.wobble = 1;
    s.run.parts.push(name);
    s.run.pts += T.points.bounce;
    ev('bounce', { name, x: s.x, y: s.y, z: s.z });
  }

  // ---- step -----------------------------------------------------------------------

  function step(dt, inp) {
    s.invuln = Math.max(0, s.invuln - dt);
    s.bounceGrace = Math.max(0, s.bounceGrace - dt);
    if (s.railCooldown) s.railCooldown.t -= dt;
    s.pushAnim = Math.max(0, s.pushAnim - dt);
    if (!(s.mode === 'crash' && s.crash.kind === 'snowball')) s.fade = Math.max(0, s.fade - dt * 1.5);
    if (s.mode === 'ready') return stepReady(dt, inp);
    if (s.mode === 'ground') stepGround(dt, inp);
    else if (s.mode === 'air') stepAir(dt, inp);
    else if (s.mode === 'grind') stepGrind(dt, inp);
    else if (s.mode === 'crash') stepCrash(dt);
    if (s.mode !== 'crash') collide();
    if (s.mode !== 'crash') {
      while (s.checkpoint + 1 < W.checkpoints.length && s.z < W.checkpoints[s.checkpoint + 1].z) s.checkpoint++;
    }
    if (!s.finished && s.z < W.finishZ) { s.finished = true; ev('finish', {}); }
  }

  reset();
  return {
    s, step, reset,
    setGear(g) { gear = g; },
    get gear() { return gear; },
    speed,
    surface: () => surfaceAt(s.x, s.z),
  };
}
