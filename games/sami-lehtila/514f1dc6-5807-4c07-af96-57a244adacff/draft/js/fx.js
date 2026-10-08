// Particles (snow spray, sparks, shards) and the floating texts.

import * as THREE from 'three';

const MAX = 3000;

export function buildFx(scene, T) {
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3);
  const vel = new Float32Array(MAX * 3), life = new Float32Array(MAX), grav = new Float32Array(MAX);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.45, map: T.flake, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
  }));
  pts.frustumCulled = false;
  scene.add(pts);
  let next = 0;

  function emit(x, y, z, vx, vy, vz, c, l, g = 9) {
    const i = next; next = (next + 1) % MAX;
    pos.set([x, y, z], i * 3); vel.set([vx, vy, vz], i * 3); col.set(c, i * 3);
    life[i] = l; grav[i] = g;
  }
  const rnd = (a) => (Math.random() - 0.5) * 2 * a;

  const fx = {
    spray(x, y, z, amount) {
      const n = Math.ceil(amount * 4);
      for (let k = 0; k < n; k++) emit(x + rnd(0.3), y + 0.1, z + rnd(0.3), rnd(2), 1 + Math.random() * 2, rnd(2), [1, 1, 1], 0.5 + Math.random() * 0.4);
    },
    burst(x, y, z, n = 30, color = [1, 1, 1], speed = 4) {
      for (let k = 0; k < n; k++) emit(x, y + 0.3, z, rnd(speed), Math.random() * speed, rnd(speed), color, 0.8 + Math.random() * 0.5);
    },
    sparks(x, y, z) {
      for (let k = 0; k < 2; k++) emit(x, y, z, rnd(2), Math.random() * 2, rnd(2), [1, 0.85, 0.4], 0.3, 6);
    },
    shards(x, y, z, colors) {
      for (let k = 0; k < 24; k++) emit(x, y + 0.6, z, rnd(5), 2 + Math.random() * 5, rnd(5) - 3, colors[k % colors.length], 1.2, 12);
    },
    update(dt) {
      for (let i = 0; i < MAX; i++) {
        if (life[i] <= 0) { pos[i * 3 + 1] = -1e4; continue; }
        life[i] -= dt;
        vel[i * 3 + 1] -= grav[i] * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
  return fx;
}

/** Floating texts in the HUD layer. */
export function popup(host, text, cls = '') {
  const el = document.createElement('div');
  el.className = 'pop ' + cls;
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}
