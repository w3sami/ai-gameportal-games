'use strict';
/* Cloud deck: a layer of cloud across the whole map, for courses flown above the clouds (Cloud Run). Rendering only;
   the sim doesn't know about it. Course file:
     deck: { base, top, layers, tile, under: { fog, color, light }, inside: { fog, color, light } }
       base, top   the layer's bottom and top (m). It's drawn as `layers` stacked semi-transparent planes with a cloud
                   texture `tile` m across, so peaks poke through and gaps show a little of the ground far below.
       under       below the deck: fog [near, far] (m), fog/sky colour, and how much sunlight gets through (0..1)
       inside      the same for the middle of the layer; between the three states it blends by camera height
   createCloudDeck(env), env: { scene, sky, sunDisc, sun, hemi, renderer }. build(group, view) after each course load
   (no deck: puts fog, sky and light back to the course's own), update(camY) every frame. */
const DECK_DEF = {
  layers: 6, tile: 1700,
  under: { fog: [60, 1150], color: '#8e99a3', light: 0.45 },
  inside: { fog: [30, 420], color: '#dde3e8', light: 0.8 },   // far enough to keep your own aircraft in sight
};

function createCloudDeck(env) {
  const { scene, sky, sunDisc, sun, hemi } = env;
  // sky and sun fade out under the deck: they go in the transparent pass (renderOrder keeps them first, behind everything)
  for (const m of [sky.material, sunDisc.material]) { m.transparent = true; m.needsUpdate = true; }
  scene.background = scene.fog.color;                       // one colour for both, so the fog blends into the sky
  const base = { color: scene.fog.color.clone(), sun: sun.intensity, hemi: hemi.intensity, near: 0, far: 0 };
  const cAbove = new THREE.Color(), cIn = new THREE.Color(), cUnder = new THREE.Color();
  let D = null, tex = null;

  // tileable value-noise fbm, 256 px; two alpha curves: patchy (real holes) and dense (a floor of cover)
  function makeTextures() {
    const S = 256, rand = mulberry32(71), lat = [];
    for (let o = 0; o < 5; o++) { const n = 4 << o, g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rand(); lat.push([n, g]); }
    const field = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let v = 0, a = 0.5, sum = 0;
      for (const [n, g] of lat) {
        const fx = x / S * n, fy = y / S * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty), at = (i, j) => g[((j % n) * n) + (i % n)];
        v += a * lerp(lerp(at(ix, iy), at(ix + 1, iy), ux), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), ux), uy);
        sum += a; a *= 0.55;
      }
      field[y * S + x] = v / sum;
    }
    const make = (alpha) => {
      const c = document.createElement('canvas'); c.width = c.height = S;
      const cx = c.getContext('2d'), img = cx.createImageData(S, S);
      for (let i = 0; i < S * S; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = Math.round(255 * alpha(field[i])); }
      cx.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(8, env.renderer.capabilities.getMaxAnisotropy());
      return t;
    };
    return { patchy: make((v) => smoothstep(0.38, 0.66, v)), dense: make((v) => 0.55 + 0.45 * smoothstep(0.3, 0.6, v)) };
  }

  function build(group, view) {
    base.near = view.fog[0]; base.far = view.fog[1];
    D = COURSE.deck ? Object.assign({}, DECK_DEF, COURSE.deck, {
      under: Object.assign({}, DECK_DEF.under, COURSE.deck.under), inside: Object.assign({}, DECK_DEF.inside, COURSE.deck.inside) }) : null;
    apply(0, 0);
    if (!D) return;
    cIn.set(D.inside.color); cUnder.set(D.under.color);
    if (!tex) tex = makeTextures();
    const size = view.far * 2, n = D.layers, rand = mulberry32(19), top = new THREE.Color(), bot = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? i / (n - 1) : 1, y = lerp(D.base, D.top, f);
      // uv scale and offset per layer, so the holes don't line up
      const g = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), uv = g.attributes.uv;
      const rep = size / (D.tile * (0.75 + rand() * 0.5)), ou = rand(), ov = rand();
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * rep + ou, uv.getY(k) * rep + ov);
      const dense = f > 0.25 && f < 0.75;                    // the middle of the layer has no holes right through
      const opacity = dense ? 0.75 : f >= 0.75 ? 0.62 : 0.35 + 0.3 * f;
      top.set('#c6d0d9').lerp(new THREE.Color('#ffffff'), f);       // from above: lower layers a little shaded
      bot.set('#7c8791').lerp(new THREE.Color('#b6bfc7'), f);       // from below: the base darkest
      for (const [side, col] of [[THREE.FrontSide, top], [THREE.BackSide, bot]]) {
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: dense ? tex.dense : tex.patchy, color: col, transparent: true,
          opacity, depthWrite: false, side }));
        m.position.set(TER.CX, y, TER.CZ); m.frustumCulled = false;   // same centre for all: sorts by height, back to front
        group.add(m);
      }
    }
  }

  // i: 0 above the deck .. 1 once well inside it; u: 0 .. 1 below its base
  const expLerp = (a, b, t) => a * Math.pow(b / a, t);
  function apply(i, u) {
    const c = scene.fog.color;
    if (!D) { c.copy(base.color); scene.fog.near = base.near; scene.fog.far = base.far; }
    else {
      cAbove.copy(base.color);
      c.copy(cAbove).lerp(cIn, i).lerp(cUnder, u);
      scene.fog.near = lerp(lerp(base.near, D.inside.fog[0], i), D.under.fog[0], u);
      scene.fog.far = expLerp(expLerp(base.far, D.inside.fog[1], i), D.under.fog[1], u);
    }
    const L = D ? lerp(lerp(1, D.inside.light, i), D.under.light, u) : 1;
    sun.intensity = base.sun * L; hemi.intensity = base.hemi * (0.55 + 0.45 * L);
    sky.material.opacity = 1 - i; sunDisc.material.opacity = 1 - i;
    sky.visible = sunDisc.visible = i < 0.999;
  }

  function update(camY) {
    if (!D) return;
    const th = D.top - D.base;
    apply(smoothstep(D.top + 25, D.top - th * 0.35, camY), smoothstep(D.base + th * 0.35, D.base - 40, camY));
  }

  return { build, update };
}
