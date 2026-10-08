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

/**
 * Impact rings: a soft ring of snow spreading on the ground where a hard
 * landing hit. place(mesh, x, z, lift) puts a mesh flat on the surface.
 */
export function buildRings(scene, T, place) {
  // blue-grey like a shadowed dent, since white would vanish on the snow
  const geo = new THREE.RingGeometry(0.6, 1, 48).rotateX(-Math.PI / 2);
  const pool = Array.from({ length: 4 }, () => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: '#7f98c0', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
    }));
    m.visible = false;
    scene.add(m);
    return { m, t: 1, size: 1 };
  });
  let next = 0;
  return {
    spawn(x, z, k) {
      const r = pool[next]; next = (next + 1) % pool.length;
      place(r.m, x, z, 0.05);
      r.t = 0; r.size = 1.5 + k * 3.5; r.m.visible = true;
    },
    update(dt) {
      for (const r of pool) {
        if (!r.m.visible) continue;
        r.t += dt / 0.9;
        if (r.t >= 1) { r.m.visible = false; continue; }
        const e = 1 - Math.pow(1 - r.t, 3);
        r.m.scale.setScalar(0.3 + e * r.size);
        r.m.material.opacity = 0.75 * (1 - r.t);
      }
    },
  };
}

/** Floating texts in the HUD layer. */
export function popup(host, text, cls = '') {
  const el = document.createElement('div');
  el.className = 'pop ' + cls;
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}
