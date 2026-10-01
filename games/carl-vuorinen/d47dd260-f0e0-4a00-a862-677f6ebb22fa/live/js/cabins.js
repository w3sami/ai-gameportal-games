'use strict';
/* =========================================================================
   CABINS — small red lakeside cabins (falu red, white corners, dark gable roof, a chimney), as a js/shore.js plugin.
   Course file: cabins: true | [[x, z, fx, fz], ...]
     true   one beside each pier (js/shore.js), a little back from where it meets the land and off to one side, its
            front to the water; it goes to whichever side has the flatter dry ground
     list   placed by hand: at (x, z), its front facing (fx, fz)
   Everything is a crash ('cabin'). Trees keep clear of it (as of every shore box). Sim part (no DOM): buildCabins()
   (a SHORE plugin, after the piers); CABINS for the tests. Game part: the meshes (the plugin's kit).
   ========================================================================= */
const CABINS = [];
const CABIN = { w: 6.2, d: 4.6, wall: 2.7, roof: 2.1 };        // width (along the front), depth, wall and roof height (m)
function buildCabins() {
  CABINS.length = 0;
  const spec = COURSE && COURSE.cabins;
  if (!spec) return;
  const W = TER.WATER;
  // how level and dry a footprint at (x, z) is: the spread of the ground over it (m), Infinity if any of it is wet
  const lumpy = (x, z, fx, fz) => {
    let lo = Infinity, hi = -Infinity;
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) {
      const h = heightAt(x - fz * a * CABIN.w * 0.6 + fx * b * CABIN.d * 0.6, z + fx * a * CABIN.w * 0.6 + fz * b * CABIN.d * 0.6);
      if (h < W + 1) return Infinity;
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return hi - lo;
  };
  const place = (x, z, fx, fz) => {
    const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    let lo = Infinity;
    for (const a of [-1, 1]) for (const b of [-1, 1]) lo = Math.min(lo, heightAt(x - fz * a * CABIN.w / 2 + fx * b * CABIN.d / 2, z + fx * a * CABIN.w / 2 + fz * b * CABIN.d / 2));
    const c = { x, z, fx, fz, y: lo };                        // floor at the footprint's lowest corner; a plinth fills in
    CABINS.push(c);
    shoreBox('cabin', x, z, -fz, fx, CABIN.w / 2 + 0.3, CABIN.d / 2 + 0.3, lo - 1, lo + 0.6 + CABIN.wall + CABIN.roof + 0.8);
  };
  if (Array.isArray(spec)) { for (const p of spec) place(p[0], p[1], p[2], p[3]); return; }
  for (const p of SHORE.piers) {
    // candidates: back from the pier's landward end, off to either side; the flattest dry one wins
    let best = null;
    for (const back of [10, 16, 24]) for (const side of [-1, 1]) for (const off of [11, 15, 20]) {
      const x = p.x - p.ux * back + p.vx * side * off, z = p.z - p.uz * back + p.vz * side * off;
      const q = lumpy(x, z, p.ux, p.uz) + back * 0.02 + off * 0.02;   // a little nearer the water is better
      if (q < 3 && (!best || q < best.q)) best = { x, z, q };
    }
    if (best) place(best.x, best.z, p.ux, p.uz);             // the front faces out along the pier, to the water
  }
}

function createCabinKit() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.shared = true;
  const Mx = createMesher(), { BOX, PRISM } = Mx.G;
  const C = (h) => new THREE.Color(h);
  const RED = C('#8e3027'), WHITE = C('#efece4'), ROOF = C('#3b3d40'), STONE = C('#8b857a'), GLASS = C('#2f3d47'), DOOR = C('#5a2a22');
  return {
    build(group) {
      if (!CABINS.length) return;
      Mx.reset();
      const { w, d, wall, roof } = CABIN;
      for (const c of CABINS) {
        Mx.frame(c.x, c.y, c.z, c.fx, c.fz);                  // local -z = the front, toward the water
        const g = heightAt(c.x, c.z) - c.y;
        Mx.part(BOX, STONE, 0, -1, 0, w + 0.3, 1.6 + Math.max(0, g), d + 0.3);            // stone plinth
        Mx.part(BOX, RED, 0, 0.6, 0, w, wall, d);                                         // walls
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) Mx.part(BOX, WHITE, sx * (w / 2 - 0.05), 0.6, sz * (d / 2 - 0.05), 0.2, wall, 0.2);   // corner boards
        Mx.part(PRISM, RED, 0, 0.6 + wall, 0, d, roof, w, Math.PI / 2);                  // gable ends
        for (const s of [-1, 1]) {                                                         // roof slopes, a little overhang
          Mx.part(BOX, ROOF, 0, 0.6 + wall + roof / 2 - 0.05, s * d / 4, w + 0.7, 0.16, Math.hypot(d / 2, roof) + 0.45, 0, s * Math.atan2(roof, d / 2));
        }
        Mx.part(BOX, ROOF, w * 0.28, 0.6 + wall + roof * 0.4, d * 0.18, 0.55, roof * 0.9, 0.55);   // chimney
        Mx.part(BOX, WHITE, -w * 0.22, 1.35, -d / 2 - 0.04, 1.3, 1.1, 0.1);              // window frames and panes, front
        Mx.part(BOX, GLASS, -w * 0.22, 1.45, -d / 2 - 0.08, 1.0, 0.85, 0.08);
        Mx.part(BOX, WHITE, w * 0.22, 0.6, -d / 2 - 0.04, 1.05, 2.0, 0.1);                // door
        Mx.part(BOX, DOOR, w * 0.22, 0.6, -d / 2 - 0.08, 0.8, 1.85, 0.08);
        Mx.part(BOX, C('#9c7a55'), w * 0.22, 0.2, -d / 2 - 0.7, 1.4, 0.4, 1.2);          // step
      }
      const m = Mx.mesh(mat);
      if (m) group.add(m);
    },
  };
}
SHORE_PLUGINS.push({ build: buildCabins, createKit: createCabinKit });
var CRASH_TEXT = CRASH_TEXT || {};
CRASH_TEXT.cabin = 'Hit a cabin';
