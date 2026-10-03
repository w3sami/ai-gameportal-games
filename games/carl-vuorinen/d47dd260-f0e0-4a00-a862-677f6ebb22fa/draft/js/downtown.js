'use strict';
/* =========================================================================
   DOWNTOWN — what the city centre has that the outskirts don't: skybridges, glazed walkways between two towers, to
   fly under (or upside down under). A js/city.js plugin (CITY_PLUGINS).
   Course file, in city: {
     skybridges: [{ a: [x, z], b: [x, z], y, w, h }]   from a to b (the two towers' facing walls: the course places the
                towers, js/outskirts.js towers), its floor y m above the streets, w m wide and h m tall. Lined up with
                the street grid it has the towers' own windows (lit at night); at any other angle it's plain.
   }
   Sim part: each skybridge is a shore box ('skybridge': a crash). Game part: its walls, roof and underside in the
   city's building meshes.
   ========================================================================= */
const DOWNTOWN = { bridges: [] };
var CRASH_TEXT = CRASH_TEXT || {};
CRASH_TEXT.skybridge = 'Hit a skybridge';

CITY_PLUGINS.push({
  after(ctx) {
    DOWNTOWN.bridges.length = 0;
    for (const s of ctx.C.skybridges || []) {
      const [ax, az] = s.a, [bx, bz] = s.b, L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
      const w = s.w || 8, h = s.h || 6, y0 = ctx.G + s.y, b = { x: (ax + bx) / 2, z: (az + bz) / 2, ux, uz, L, w, y0, y1: y0 + h, seed: 400 + DOWNTOWN.bridges.length * 37 };
      shoreBox('skybridge', b.x, b.z, ux, uz, L / 2, w / 2, y0, b.y1);
      DOWNTOWN.bridges.push(b);
    }
  },
  kit: {
    build(K) {
      if (!DOWNTOWN.bridges.length) return;
      const M = K.M, GLASS = K.C3('#4f5d69'), FRAME = K.C3('#8d9196'), { UX, UZ } = CITY.axes;
      for (const b of DOWNTOWN.bridges) {
        M.at(b.x, b.z);
        const along = b.ux * UX + b.uz * UZ, L = b.L / 2 + 1.5, hw = b.w / 2;   // its ends run a little into the walls
        if (Math.abs(Math.abs(along) - 1) < 1e-3 || Math.abs(along) < 1e-3) {   // on the grid: windowed like a tower
          const onU = Math.abs(along) > 0.5;
          K.walls(b, onU ? L : hw, onU ? hw : L, b.y0 + 0.6, b.y1 - 0.6, GLASS, 2, FRAME, b.y0 - 0.5);
        } else K.plainBox(b.x, b.z, b.ux, b.uz, L, hw, b.y0 + 0.6, b.y1 - 0.6, GLASS);
        K.plainBox(b.x, b.z, b.ux, b.uz, L, hw + 0.25, b.y0, b.y0 + 0.6, FRAME, false);   // floor slab and roof edge
        K.plainBox(b.x, b.z, b.ux, b.uz, L, hw + 0.25, b.y1 - 0.6, b.y1, FRAME);
        const vx = -b.uz, vz = b.ux, P = (su, sv) => [b.x + b.ux * L * su + vx * (hw + 0.25) * sv, b.y0, b.z + b.uz * L * su + vz * (hw + 0.25) * sv];
        K.quad(M, P(-1, 1), P(1, 1), P(1, -1), P(-1, -1), FRAME, [0, -1, 0]);   // underside
      }
    },
  },
});
