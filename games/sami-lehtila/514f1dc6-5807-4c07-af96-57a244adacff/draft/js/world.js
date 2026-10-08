// Builds the scene from the course and keeps the list of things the rider
// can touch.
//
// Every prop has two halves: a look (billboard, mesh or both) and a collider
// in the lists below. The physics reads only the lists, so a look can be
// swapped for a model without touching the rules.
//
//   obstacles  { x, z, r, top, kind, ... }   circles; kind 'tree' | 'person'
//                                            | 'dog' | 'car' | 'break'
//   bouncers   { x, z, y, r, kind, power }   top of a tree, an awning (with
//                                            x0..x1, z0..z1), a balloon (y is
//                                            its centre, r its radius)
//   rails      { ax, ay, az, bx, by, bz, kind }
//   stars      { x, y, z }

import * as THREE from 'three';
import { COURSE } from './course.js';
import { HALF_WIDTH, baseAt, groundAt, heightAt, houseFloor, rampCurve, KICKER_TAPER } from './terrain.js';
import { rng } from './art.js';

export function buildWorld(scene, T) {
  const W = {
    obstacles: [], bouncers: [], rails: [], stars: [],
    billboards: [], movers: [], breakables: [],
    starCount: 0,
    finishZ: COURSE.finishZ,
    checkpoints: [{ x: 0, z: 4 }],   // the start, then course checkpoints downhill
    checkpointMarkers: [],
  };
  const r = rng(2026);
  const group = new THREE.Group();
  scene.add(group);

  // ---- shared pieces --------------------------------------------------------

  const unit = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const mats = new Map();
  const matFor = (tex) => {
    if (!mats.has(tex)) {
      mats.set(tex, new THREE.MeshBasicMaterial({
        map: tex, alphaTest: 0.5, side: THREE.DoubleSide, alphaToCoverage: true,
      }));
    }
    return mats.get(tex);
  };
  function billboard(tex, w, h, x, y, z) {
    const m = new THREE.Mesh(unit, matFor(tex));
    m.scale.set(w, h, 1);
    m.userData.w = w;
    m.position.set(x, y, z);
    group.add(m);
    W.billboards.push(m);
    return m;
  }

  const shadowMat = new THREE.MeshBasicMaterial({
    map: T.shadow, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  W.shadow = (x, z, size) => {
    const m = new THREE.Mesh(shadowGeo, shadowMat);
    m.scale.set(size, 1, size);
    placeOnGround(m, x, z, 0.03);
    group.add(m);
    return m;
  };

  const snowMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: T.snow });

  // ---- ground ---------------------------------------------------------------

  {
    const x0 = -48, x1 = 48, dx = 2;
    const z0 = 60, z1 = COURSE.finishZ - 140, dz = 1.5;
    const nx = Math.round((x1 - x0) / dx), nz = Math.round((z0 - z1) / dz);
    const pos = [], col = [], idx = [], uv = [];
    for (let j = 0; j <= nz; j++) {
      const z = z0 - j * dz;
      for (let i = 0; i <= nx; i++) {
        const x = x0 + i * dx;
        pos.push(x, groundAt(x, z), z);
        uv.push(x / 6, z / 6);
        const n = 0.96 + r() * 0.04;
        const bank = Math.min(1, Math.max(0, (Math.abs(x) - HALF_WIDTH) / 12));
        col.push(0.93 * n - bank * 0.05, 0.96 * n - bank * 0.03, 1.0 * n);
      }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, snowMat));
  }

  // A grid following f(x, z) over a rectangle, with skirts down to the ground.
  function patch(x0, x1, z0, z1, nx, nz, f, color) {
    const pos = [], col = [], idx = [], uv = [];
    const vert = (x, y, z, c) => { pos.push(x, y, z); col.push(...c); uv.push(x / 6, (z + y) / 6); return pos.length / 3 - 1; };
    const top = [];
    for (let j = 0; j <= nz; j++) {
      top.push([]);
      for (let i = 0; i <= nx; i++) {
        const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
        top[j].push(vert(x, f(x, z), z, color));
      }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = top[j][i], b = top[j][i + 1], c = top[j + 1][i], d = top[j + 1][i + 1];
      idx.push(a, b, c, b, d, c);
    }
    const side = [0.72, 0.8, 0.93];
    const skirt = (pts) => {
      for (let k = 0; k < pts.length - 1; k++) {
        const [xa, za] = pts[k], [xb, zb] = pts[k + 1];
        const a = vert(xa, f(xa, za), za, side), b = vert(xb, f(xb, zb), zb, side);
        const c = vert(xa, groundAt(xa, za) - 0.3, za, side), d = vert(xb, groundAt(xb, zb) - 0.3, zb, side);
        idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
      }
    };
    const edge = (fn, n) => Array.from({ length: n + 1 }, (_, k) => fn(k / n));
    skirt(edge((t) => [x0 + (x1 - x0) * t, z0], nx));
    skirt(edge((t) => [x0 + (x1 - x0) * t, z1], nx));
    skirt(edge((t) => [x0, z0 + (z1 - z0) * t], nz));
    skirt(edge((t) => [x1, z0 + (z1 - z0) * t], nz));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, snowMat);
    group.add(m);
    return m;
  }

  function placeOnGround(m, x, z, lift = 0) {
    const e = 0.3;
    const h = heightAt(x, z);
    const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    const n = new THREE.Vector3(-gx, 1, -gz).normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    m.position.set(x, h + lift, z);
  }
  W.placeOnGround = placeOnGround;

  // ---- items ----------------------------------------------------------------

  const lipMat = new THREE.MeshLambertMaterial({ color: '#f08a24' });
  const cpMat = new THREE.MeshBasicMaterial({ color: '#2f7cf6', side: THREE.DoubleSide });
  const railMat = new THREE.MeshLambertMaterial({ color: '#c9ced6' });
  const postMat = new THREE.MeshLambertMaterial({ color: '#555b66' });

  const add = {
    forest(it) {
      for (let z = it.from; z > it.to; z -= it.every) {
        for (const sideSign of [-1, 1]) {
          const x = sideSign * (HALF_WIDTH + 2 + r() * 20);
          tree({ x, z: z - r() * it.every, h: 7 + r() * 7 }, false);
        }
      }
    },
    tree(it) { tree(it, true); },

    kicker(it) {
      const hw = it.w / 2 + KICKER_TAPER;
      patch(it.x - hw, it.x + hw, it.z + it.len, it.z, 10, 12,
        (x, z) => Math.max(heightAt(x, z), groundAt(x, z)), [0.9, 0.94, 1]);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(it.w, 0.08, 0.12), lipMat);
      lip.position.set(it.x, baseAt(it.z) + it.h + 0.02, it.z + 0.06);
      group.add(lip);
    },

    house(it) { house(it); },

    rail(it) {
      const ax = it.x, az = it.z, bx = it.x, bz = it.z - it.len;
      const ay = groundAt(ax, az) + it.h, by = groundAt(bx, bz) + it.h;
      railMesh(ax, ay, az, bx, by, bz, 0.05);
      const posts = Math.max(2, Math.round(it.len / 4));
      for (let k = 0; k <= posts; k++) {
        const t = k / posts, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const g = groundAt(x, z), y = ay + (by - ay) * t;
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, y - g), postMat);
        p.position.set(x, (y + g) / 2, z);
        group.add(p);
      }
      W.rails.push({ ax, ay, az, bx, by, bz, kind: 'rail' });
    },

    star(it) {
      const y = groundAt(it.x, it.z) + it.y;
      const m = billboard(T.star, 1.4, 1.4, it.x, y - 0.7, it.z);
      W.stars.push({ x: it.x, y, z: it.z, mesh: m, taken: false, phase: r() * 6 });
      W.starCount++;
    },

    table(it) { breakable(it, T.table, 1.4, 1.4, 'table'); },
    snowman(it) { breakable(it, T.snowman, 1.3, 1.95, 'snowman'); },

    crowd(it) {
      for (let k = 0; k < it.n; k++) {
        const x = it.x + (r() - 0.5) * 2 * it.spread, z = it.z + (r() - 0.5) * it.spread;
        const g = groundAt(x, z);
        const m = billboard(T.person[Math.floor(r() * T.person.length)], 0.85, 1.7, x, g, z);
        W.shadow(x, z, 1.0);
        const o = { x, z, r: 0.35, top: 1.8, kind: 'person', mesh: m, base: g, phase: r() * 6 };
        W.obstacles.push(o);
        W.movers.push({ kind: 'person', o });
      }
    },

    dog(it) {
      const g = groundAt(it.x, it.z);
      const m = billboard(T.dog[Math.floor(r() * T.dog.length)], 1.1, 0.75, it.x, g, it.z);
      const sh = W.shadow(it.x, it.z, 1.1);
      const o = { x: it.x, z: it.z, r: 0.45, top: 0.8, kind: 'dog', mesh: m };
      W.obstacles.push(o);
      W.movers.push({ kind: 'dog', o, sh, home: [it.x, it.z], range: it.range, tx: it.x, tz: it.z, wait: 0 });
    },

    road(it) {
      // the road runs between two tunnel mouths dug into the banks; cars come
      // out of one and disappear into the other
      const hw = it.width / 2, P = it.tunnel ?? 28;
      const x0 = -P - 1, x1 = P + 1, nx = 24, nz = 4;
      const pos = [], uv = [], idx = [];
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const x = x0 + ((x1 - x0) * i) / nx, z = it.z + hw - (it.width * j) / nz;
        pos.push(x, groundAt(x, z) + 0.04, z);
        uv.push(x / it.width, j / nz);
      }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: T.asphalt })));

      const faceW = it.width + 4, faceH = 7.5, depth = 10;
      const concrete = new THREE.MeshLambertMaterial({ color: '#8f959e' });
      const capMat = new THREE.MeshLambertMaterial({ color: '#f2f6fd' });
      const faceMat = new THREE.MeshLambertMaterial({ map: T.tunnel });
      for (const sx of [-1, 1]) {
        const gy = groundAt(sx * P, it.z);
        const block = new THREE.Mesh(new THREE.BoxGeometry(depth, faceH + 1, faceW), concrete);
        block.position.set(sx * (P + depth / 2), gy + (faceH + 1) / 2 - 1, it.z);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(depth + 0.4, 0.5, faceW + 0.4), capMat);
        cap.position.set(sx * (P + depth / 2), gy + faceH + 0.2, it.z);
        const face = new THREE.Mesh(new THREE.PlaneGeometry(faceW, faceH), faceMat);
        face.rotation.y = -sx * Math.PI / 2;
        face.position.set(sx * (P - 0.02), gy + faceH / 2 - 0.3, it.z);
        group.add(block, cap, face);
      }

      const loop = P + 25;           // cars drive this far into the hill before coming round again
      for (const lane of it.lanes) {
        const z = it.z + lane.offset;
        let x = -loop + r() * 30;
        while (x < loop) {
          const m = billboard(T.car[Math.floor(r() * T.car.length)], 4.2, 2.1, x, groundAt(x, z), z);
          m.userData.w *= lane.dir;
          const sh = W.shadow(x, z, 3.2);
          const o = { x, z, r: 1.0, top: 1.6, kind: 'car', mesh: m, len: 1.4, hidden: false };
          W.obstacles.push(o);
          W.movers.push({ kind: 'car', o, sh, dir: lane.dir, speed: lane.speed * (0.9 + r() * 0.2), tunnel: P, loop });
          x += 22 + r() * 26;
        }
      }
    },

    balloon(it) {
      const g = groundAt(it.x, it.z);
      const w = it.r * 2.3, h = w * 1.5;
      // the envelope is the top two thirds of the picture; centre it on y
      const m = billboard(T.balloon[Math.floor(r() * T.balloon.length)], w, h, it.x, g + it.y - h * 0.68, it.z);
      const b = { x: it.x, z: it.z, y: g + it.y, r: it.r, kind: 'balloon', power: null, mesh: m, y0: g + it.y, off: h * 0.68, h, phase: r() * 6, wobble: 0 };
      W.bouncers.push(b);
      W.movers.push({ kind: 'balloon', b });
      W.shadow(it.x, it.z, it.r * 1.6);
    },

    checkpoint(it) {
      W.checkpoints.push({ x: it.x, z: it.z });
      // a blue flag only the tuning panel shows
      const g = groundAt(it.x, it.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4), cpMat);
      pole.position.set(it.x, g + 1.2, it.z);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), cpMat);
      flag.position.set(it.x + 0.45, g + 2.1, it.z);
      for (const m of [pole, flag]) { m.visible = false; group.add(m); W.checkpointMarkers.push(m); }
    },

    finish(it) {
      const g = groundAt(0, it.z);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(HALF_WIDTH * 2, HALF_WIDTH * 0.5).translate(0, HALF_WIDTH * 0.25, 0),
        new THREE.MeshBasicMaterial({ map: T.finish, alphaTest: 0.5, side: THREE.DoubleSide }));
      m.position.set(0, g, it.z);
      group.add(m);
    },
  };

  function tree(it, inCourse) {
    const g = groundAt(it.x, it.z);
    const w = it.h * 0.55;
    billboard(T.spruce[Math.floor(r() * T.spruce.length)], w, it.h, it.x, g, it.z);
    if (inCourse) W.shadow(it.x, it.z, w * 0.9);
    W.obstacles.push({ x: it.x, z: it.z, r: w * 0.42, top: it.h, kind: 'tree', base: g });
    W.bouncers.push({ x: it.x, z: it.z, y: g + it.h * 0.97, r: 1.8, kind: 'tree' });
  }

  function breakable(it, tex, w, h, what) {
    const g = groundAt(it.x, it.z);
    const m = billboard(tex, w, h, it.x, g, it.z);
    const sh = W.shadow(it.x, it.z, w);
    const o = { x: it.x, z: it.z, r: w * 0.4, top: h, kind: 'break', what, mesh: m, sh, alive: true };
    W.obstacles.push(o);
    W.breakables.push(o);
  }

  function railMesh(ax, ay, az, bx, by, bz, radius) {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), railMat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    group.add(m);
  }

  function house(it) {
    const floor = houseFloor(it);
    const h = new THREE.Group();
    h.position.set(it.x, floor, it.z);
    group.add(h);
    const wallMat = new THREE.MeshLambertMaterial({ map: T.wall(it.color) });
    const roofMat = new THREE.MeshLambertMaterial({ map: T.roof, side: THREE.DoubleSide });
    const gableMat = new THREE.MeshLambertMaterial({ color: it.color, side: THREE.DoubleSide });

    // stone footing down to the lowest ground around the house
    const low = Math.min(baseAt(it.z - it.d / 2), baseAt(it.z + it.d / 2)) - 0.3;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(it.w + 0.2, floor - low, it.d + 0.2),
      new THREE.MeshLambertMaterial({ color: '#8a8f99' }));
    foot.position.y = (low - floor) / 2;
    h.add(foot);

    const walls = new THREE.Mesh(new THREE.BoxGeometry(it.w, it.wallH, it.d), wallMat);
    walls.position.y = it.wallH / 2;
    h.add(walls);

    // roof built with its ridge along local z; a cross ridge turns the group
    const roofG = new THREE.Group();
    h.add(roofG);
    const along = it.ridge === 'z' ? it.d : it.w, across = it.ridge === 'z' ? it.w : it.d;
    if (it.ridge !== 'z') roofG.rotation.y = Math.PI / 2;
    const ov = 0.4, hl = along / 2 + ov, ha = across / 2 + ov;
    const eaveY = it.wallH - it.roofH * (ov / (across / 2)), topY = it.wallH + it.roofH + 0.05;
    const quad = (pts) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      return g;
    };
    roofG.add(new THREE.Mesh(quad([[-ha, eaveY, hl], [-ha, eaveY, -hl], [0, topY, -hl], [0, topY, hl]]), roofMat));
    roofG.add(new THREE.Mesh(quad([[ha, eaveY, -hl], [ha, eaveY, hl], [0, topY, hl], [0, topY, -hl]]), roofMat));
    for (const s of [-1, 1]) {
      const g = new THREE.BufferGeometry();
      const z = (s * along) / 2;
      g.setAttribute('position', new THREE.Float32BufferAttribute([-across / 2, it.wallH, z, across / 2, it.wallH, z, 0, it.wallH + it.roofH, z], 3));
      g.computeVertexNormals();
      roofG.add(new THREE.Mesh(g, gableMat));
    }
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.6), new THREE.MeshLambertMaterial({ color: '#7a3a2a' }));
    chim.position.set(across * 0.22, it.wallH + it.roofH * 0.6, along * 0.25);
    roofG.add(chim);

    const ridgeY = floor + it.wallH + it.roofH;
    if (it.ridge === 'z') {
      W.rails.push({ ax: it.x, ay: ridgeY, az: it.z + it.d / 2 + ov, bx: it.x, by: ridgeY, bz: it.z - it.d / 2 - ov, kind: 'ridge' });
    } else {
      W.rails.push({ ax: it.x - it.w / 2 - ov, ay: ridgeY, az: it.z, bx: it.x + it.w / 2 + ov, by: ridgeY, bz: it.z, kind: 'ridge' });
    }

    if (it.awning) {
      // striped awning sloping down and out from a wall. 'left' / 'right' sit
      // on that side wall at its uphill end and throw the rider across onto
      // the ridge; true sits on the uphill face.
      const out = 2.2;
      const mat = new THREE.MeshLambertMaterial({ map: T.awning, side: THREE.DoubleSide });
      if (it.awning === 'left' || it.awning === 'right') {
        // low and long, so a kicker in front reaches it at any sensible speed
        const sx = it.awning === 'right' ? 1 : -1, len = 7, y0 = 2.1, y1 = 1.6;
        const zA = it.d / 2, zB = it.d / 2 - len, xW = sx * it.w / 2, xO = sx * (it.w / 2 + out);
        h.add(new THREE.Mesh(quad([[xW, y0, zA], [xW, y0, zB], [xO, y1, zB], [xO, y1, zA]]), mat));
        W.bouncers.push({
          kind: 'awning', x: it.x + (xW + xO) / 2, z: it.z + (zA + zB) / 2,
          x0: it.x + Math.min(xW, xO), x1: it.x + Math.max(xW, xO), z0: it.z + zB, z1: it.z + zA,
          y: floor + (y0 + y1) / 2, r: 0,
          aimX: it.x, aimY: ridgeY + 0.3,
        });
      } else {
        const aw = it.w - 1, y0 = 2.7, y1 = 2.2;
        h.add(new THREE.Mesh(quad([[-aw / 2, y0, it.d / 2], [aw / 2, y0, it.d / 2], [aw / 2, y1, it.d / 2 + out], [-aw / 2, y1, it.d / 2 + out]]), mat));
        W.bouncers.push({
          kind: 'awning', x: it.x, z: it.z + it.d / 2 + out / 2,
          x0: it.x - aw / 2, x1: it.x + aw / 2, z0: it.z + it.d / 2, z1: it.z + it.d / 2 + out,
          y: floor + (y0 + y1) / 2, r: 0,
        });
      }
    }
    if (it.sign) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: T.sign(it.sign) }));
      s.position.set(0, it.wallH - 0.2, it.d / 2 + 0.05);
      h.add(s);
    }
  }

  for (const it of COURSE.items) add[it.type]?.(it);
  W.checkpoints.sort((a, b) => b.z - a.z);
  W.showCheckpoints = (on) => { for (const m of W.checkpointMarkers) m.visible = on; };

  // ---- per frame ------------------------------------------------------------

  W.update = (dt, t, rider) => {
    for (const mv of W.movers) {
      if (mv.kind === 'car') {
        const o = mv.o;
        o.x += mv.dir * mv.speed * dt;
        if (o.x > mv.loop) o.x -= 2 * mv.loop;
        if (o.x < -mv.loop) o.x += 2 * mv.loop;
        // inside the hill: out of sight and out of the way
        o.hidden = Math.abs(o.x) > mv.tunnel + 2.5;
        o.mesh.visible = mv.sh.visible = !o.hidden;
        const gy = groundAt(Math.max(-mv.tunnel, Math.min(mv.tunnel, o.x)), o.z);
        o.mesh.position.set(o.x, gy, o.z);
        mv.sh.position.x = o.x; mv.sh.position.y = gy + 0.05;
      } else if (mv.kind === 'dog') {
        const o = mv.o;
        mv.wait -= dt;
        const dx = mv.tx - o.x, dz = mv.tz - o.z, d = Math.hypot(dx, dz);
        if (d < 0.3) {
          if (mv.wait <= 0) {
            mv.tx = mv.home[0] + (r() - 0.5) * 2 * mv.range;
            mv.tz = mv.home[1] + (r() - 0.5) * mv.range;
            mv.wait = 0.5 + r() * 1.5;
          }
        } else if (mv.wait <= 0) {
          const v = 4.5 * dt / d;
          o.x += dx * v; o.z += dz * v;
          o.mesh.userData.flip = dx < 0 ? -1 : 1;
        }
        const g = groundAt(o.x, o.z);
        o.mesh.position.set(o.x, g + Math.abs(Math.sin(t * 14)) * (d > 0.3 && mv.wait <= 0 ? 0.08 : 0), o.z);
        mv.sh.position.set(o.x, g + 0.03, o.z);
      } else if (mv.kind === 'person') {
        const o = mv.o;
        const near = rider && Math.abs(rider.z - o.z) < 12 && Math.abs(rider.x - o.x) < 14;
        o.mesh.position.y = o.base + (near ? Math.abs(Math.sin(t * 9 + o.phase)) * 0.25 : 0);
      } else if (mv.kind === 'balloon') {
        const b = mv.b;
        // a bounce sets wobble to 1: the envelope squashes, dips and springs back
        b.wobble = (b.wobble || 0) * Math.exp(-2.5 * dt);
        const w = b.wobble * Math.cos((1 - b.wobble) * 40);
        b.y = b.y0 + Math.sin(t * 0.7 + b.phase) * 0.5 - b.wobble * 0.8;
        b.mesh.userData.sx = 1 + 0.18 * w;
        b.mesh.scale.y = b.h * (1 - 0.18 * w);
        b.mesh.position.y = b.y - b.off;
      }
    }
    for (const s of W.stars) {
      if (s.taken) continue;
      s.mesh.position.y = s.y - 0.7 + Math.sin(t * 2 + s.phase) * 0.15;
      s.mesh.userData.spin = Math.cos(t * 3 + s.phase);
    }
  };

  W.faceCamera = (cam) => {
    for (const m of W.billboards) {
      if (!m.visible) continue;
      m.rotation.y = Math.atan2(cam.position.x - m.position.x, cam.position.z - m.position.z);
      m.scale.x = m.userData.w * (m.userData.flip ?? 1) * (m.userData.spin ?? 1) * (m.userData.sx ?? 1);
    }
  };

  W.reset = () => {
    for (const o of W.breakables) { o.alive = true; o.mesh.visible = true; o.sh.visible = true; }
    for (const s of W.stars) { s.taken = false; s.mesh.visible = true; }
  };

  return W;
}
