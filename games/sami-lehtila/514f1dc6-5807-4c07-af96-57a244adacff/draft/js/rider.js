// The rider's 3D model and its pose.
//
// root      at the feet; yaw is the travel heading, tilt follows the slope
// └ trick   pivot at the hips; yaw and pitch here are spins and flips
//   └ inner back down to the feet
//     ├ skis / board
//     └ body  (turned sideways on a board)

import * as THREE from 'three';

const HIP = 0.9;

export function buildRider(scene, T) {
  const mat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const M = {
    jacket: mat('#e63946'), pants: mat('#1d3557'), boot: mat('#222'), skin: mat('#f1c7a1'),
    hat: mat('#ffb703'), goggles: mat('#2a9d8f'), ski: mat('#f4f4f4'), skiTop: mat('#e63946'),
    board: mat('#3a86ff'), pole: mat('#888'), glove: mat('#333'),
  };
  const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    return b;
  };

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const trick = new THREE.Group();
  trick.rotation.order = 'YXZ';
  trick.position.y = HIP;
  const inner = new THREE.Group();
  inner.position.y = -HIP;
  root.add(trick); trick.add(inner);
  scene.add(root);

  // body, facing -z
  const body = new THREE.Group();
  inner.add(body);
  const legs = new THREE.Group();
  body.add(legs);
  for (const s of [-1, 1]) {
    legs.add(box(0.15, 0.78, 0.17, M.pants, s * 0.13, 0.47, 0));
    legs.add(box(0.18, 0.18, 0.32, M.boot, s * 0.13, 0.1, -0.03));
  }
  const upper = new THREE.Group();
  upper.position.y = 0.86;
  body.add(upper);
  upper.add(box(0.46, 0.6, 0.3, M.jacket, 0, 0.3, 0));
  upper.add(box(0.48, 0.1, 0.32, M.pants, 0, 0.02, 0));
  const head = new THREE.Group();
  head.position.y = 0.78;
  upper.add(head);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), M.skin);
  head.add(skull);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.hat);
  hat.position.y = 0.02; head.add(hat);
  const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), M.hat);
  pom.position.y = 0.2; head.add(pom);
  head.add(box(0.3, 0.08, 0.06, M.goggles, 0, 0.02, -0.14));
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.29, 0.55, 0);
    arm.add(box(0.12, 0.52, 0.12, M.jacket, 0, -0.26, 0));
    arm.add(box(0.13, 0.12, 0.13, M.glove, 0, -0.56, 0));
    upper.add(arm);
    arms.push(arm);
  }

  // skis with poles in hand
  const skis = new THREE.Group();
  for (const s of [-1, 1]) {
    skis.add(box(0.1, 0.03, 1.7, M.ski, s * 0.13, 0.015, -0.1));
    skis.add(box(0.1, 0.031, 0.5, M.skiTop, s * 0.13, 0.03, -0.1));
    const tip = box(0.1, 0.03, 0.2, M.ski, s * 0.13, 0.05, -1.0);
    tip.rotation.x = 0.5;
    skis.add(tip);
  }
  inner.add(skis);
  const poles = [];
  for (const arm of arms) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.1), M.pole);
    p.position.set(0, -0.95, 0.05);
    p.rotation.x = 0.25;
    arm.add(p);
    poles.push(p);
  }

  // board, nose toward -z
  const board = new THREE.Group();
  board.add(box(0.3, 0.04, 1.3, M.board, 0, 0.02, 0));
  for (const s of [-1, 1]) {
    const end = box(0.3, 0.04, 0.16, M.board, 0, 0.06, s * 0.71);
    end.rotation.x = s * -0.45;
    board.add(end);
  }
  inner.add(board);

  // crash props: the heap a head-first fall leaves, and the snowball
  const snowMat = new THREE.MeshLambertMaterial({ color: '#f4f8ff', flatShading: true });
  const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), snowMat);
  mound.visible = false;
  scene.add(mound);
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), snowMat);
  ball.visible = false;
  scene.add(ball);
  const rollAxis = new THREE.Vector3();

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: T.shadow, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  scene.add(shadow);

  let gear = 'skis';
  function setGear(g) {
    gear = g;
    skis.visible = g === 'skis';
    board.visible = g === 'board';
    for (const p of poles) p.visible = g === 'skis';
    body.rotation.y = g === 'board' ? -Math.PI / 2 : 0;
    legs.children.forEach((c, i) => { c.position.x = (i < 2 ? -1 : 1) * (g === 'board' ? 0.2 : 0.13); });
    head.rotation.y = g === 'board' ? Math.PI / 2 - 0.3 : 0;
    M.jacket.color.set(g === 'board' ? '#2a9d8f' : '#e63946');
    M.hat.color.set(g === 'board' ? '#ff6b35' : '#ffb703');
  }
  setGear('skis');

  let tumble = 0;
  /** s: the physics state from physics.js; place: (mesh, x, z, lift) puts a mesh on the ground. */
  function update(s, dt, place, groundY) {
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = s.heading;
    root.rotation.x = s.tilt;
    root.rotation.z = s.lean;
    const sw = s.switchStance ? Math.PI : 0;
    trick.rotation.set(s.trickPitch, s.trickYaw + sw + (s.mode === 'grind' ? Math.PI / 2 : 0), 0);
    root.scale.setScalar(1);
    mound.visible = false;
    ball.visible = false;
    legs.rotation.set(0, 0, 0);
    upper.rotation.z = 0;

    // crouch: hips drop while charging a jump or tucking
    const c = s.crouch;
    upper.position.y = 0.86 - c * 0.28;
    upper.rotation.x = -0.15 - c * 0.5;
    legs.scale.y = 1 - c * 0.3;
    const armOut = s.mode === 'air' ? 1.2 : 0.35 + c * 0.3;
    arms[0].rotation.z = -armOut; arms[1].rotation.z = armOut;
    arms[0].rotation.x = arms[1].rotation.x = s.mode === 'air' ? 0 : -0.5;
    if (s.pushAnim > 0) {
      // pole push: arms reach forward and sweep back
      const p = 1 - s.pushAnim / 0.4;
      arms[0].rotation.x = arms[1].rotation.x = -1.4 + p * 2.2;
      arms[0].rotation.z = -0.2; arms[1].rotation.z = 0.2;
      upper.rotation.x = -0.6 + p * 0.3;
    }

    let shadowOn = true;
    const k = s.crash;
    if (s.mode === 'crash' && k.kind === 'bury') {
      // head first into the snow: upside down, sunk, legs and skis out
      root.position.y = s.y - k.depth;
      root.rotation.set(0.15, s.heading, 0.12);
      trick.rotation.set(Math.PI, 0, 0);
      const kick = k.t < 1.3 ? Math.sin(k.t * 16) * 0.25 : 0;
      legs.rotation.set(kick, 0, kick * 0.5);
      arms[0].rotation.z = -0.3; arms[1].rotation.z = 0.3;
      const grow = Math.min(1, k.t * 8);
      mound.visible = true;
      place(mound, s.x, s.z, -0.05);
      mound.scale.set(k.mound * grow, k.mound * 0.5 * grow, k.mound * grow);
      shadowOn = false;
    } else if (s.mode === 'crash' && k.kind === 'ragdoll') {
      tumble += dt * 10 * Math.max(0.25, 1 - k.t / 1.6);
      trick.rotation.set(Math.sin(tumble * 0.9) * 1.6, tumble * 0.4, tumble);
      flail(k.t);
    } else if (s.mode === 'crash' && k.kind === 'snowball') {
      ball.visible = true;
      ball.scale.setScalar(k.r);
      ball.position.set(s.x, s.y + k.r * 0.85, s.z);
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > 0.1) {
        rollAxis.set(-s.vz, 0, s.vx).normalize();
        ball.rotateOnWorldAxis(rollAxis, -(sp * dt) / k.r);
      }
      // the rider rolls with the ball, hips at its centre: skis and arms poke
      // out until it grows over them
      root.position.set(s.x, ball.position.y - HIP, s.z);
      root.rotation.set(0, 0, 0);
      trick.quaternion.copy(ball.quaternion);
      flail(k.t);
    } else tumble = 0;

    const flash = s.invuln > 0 && s.mode !== 'ready' && Math.floor(s.invuln * 12) % 2 === 0;
    root.visible = !flash;

    const above = Math.max(0, s.y - groundY);
    const sk = 1 / (1 + above * 0.15);
    shadow.visible = shadowOn;
    place(shadow, s.x, s.z, 0.04);
    shadow.scale.setScalar(sk * (k && k.kind === 'snowball' ? k.r * 1.6 : 1));
    shadow.material.opacity = sk;
  }

  // limbs thrown about while tumbling
  function flail(t) {
    arms[0].rotation.set(Math.sin(t * 13) * 1.5, 0, -1.2 + Math.sin(t * 9) * 0.8);
    arms[1].rotation.set(Math.cos(t * 11) * 1.5, 0, 1.2 + Math.cos(t * 10) * 0.8);
    legs.rotation.set(Math.sin(t * 8) * 0.5, 0, Math.cos(t * 7) * 0.3);
    upper.rotation.z = Math.sin(t * 6) * 0.4;
  }

  return { root, setGear, update, get gear() { return gear; } };
}
