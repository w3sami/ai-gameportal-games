// Speed trails: a fading ribbon from each ski tail (one from a board), lying
// flat and following the path the tail took. Its strength grows with speed
// from tune.trailFrom to tune.trailFull, and it shows in the air as well.

import * as THREE from 'three';

const N = 40;                 // samples per ribbon, one per frame

function strip(scene) {
  const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 4);
  const idx = [];
  for (let i = 0; i < N - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, pos, col, geo, hist: [] };
}

export function buildTrails(scene) {
  const strips = [strip(scene), strip(scene)];
  const side = new THREE.Vector3();

  /** points: world positions of the tails this frame; alpha 0…1; width in metres. */
  function update(points, alpha, width) {
    strips.forEach((st, k) => {
      const p = points[k];
      st.mesh.visible = !!p;
      if (!p) { st.hist.length = 0; return; }
      // a teleport (respawn) starts a new ribbon instead of drawing across
      const last = st.hist[0];
      if (last && last.p.distanceToSquared(p) > 25) st.hist.length = 0;
      st.hist.unshift({ p: p.clone(), a: alpha });
      if (st.hist.length > N) st.hist.length = N;
      const h = st.hist;
      const end = h.length - 1;
      for (let i = 0; i < N; i++) {
        const s = h[Math.min(i, end)];
        const nb = h[Math.min(i + 1, end)], pb = h[Math.min(Math.max(i - 1, 0), end)];
        side.set(-(pb.p.z - nb.p.z), 0, pb.p.x - nb.p.x);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize().multiplyScalar(width / 2);
        const fade = i < h.length ? s.a * (1 - i / N) : 0;
        st.pos.set([s.p.x - side.x, s.p.y, s.p.z - side.z, s.p.x + side.x, s.p.y, s.p.z + side.z], i * 6);
        st.col.set([1, 1, 1, fade * 0.55, 1, 1, 1, fade * 0.55], i * 8);
      }
      st.geo.attributes.position.needsUpdate = true;
      st.geo.attributes.color.needsUpdate = true;
    });
  }
  return { update };
}
