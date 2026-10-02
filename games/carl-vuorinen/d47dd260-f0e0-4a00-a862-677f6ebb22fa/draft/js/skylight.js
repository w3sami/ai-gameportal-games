'use strict';
/* =========================================================================
   SKYLIGHT — a course's own time of day. Every course has been flown in the same mid-afternoon light (js/game.js
   sets it up once); course.light changes it for that course, and loading any other course puts the afternoon back.
   Course file: light: { preset, ...any of the keys below to override the preset's }
     sunDir: [x, y, z]                 toward the sun (normalised here)
     sunColor, sunIntensity           the direct light; hemiSky, hemiGround, hemiIntensity the sky light
     zenith, mid, horizon             the sky dome overhead, at about 12 degrees up, and at the horizon on the sun's side;
     away                             the horizon opposite the sun (the dome blends between them round the compass)
     fog                              the fog colour (default: the horizon's, a little toward away)
     warm                             the fog's tint toward the sun (js/atmosphere.js)
     disc, discScale                  the sun's colour and size; glare: the dazzle's tint (js/glare.js)
     lights                           how many windows are lit (js/city.js: 0 none .. 1 dusk)
   presets: 'sunset'. The sky dome, fog, sun and both lights are game.js's; it hands them over on every course load
   (configure(course, env), before the terrain's shadows are baked). current: the light in use, for other modules
   (js/city.js's glass reflects its sky), or null for the afternoon.
   ========================================================================= */
const Skylight = (() => {
  const PRESETS = {
    sunset: {
      sunDir: [-0.9, 0.18, 0.36], sunColor: '#ffb27a', sunIntensity: 2.5,
      hemiSky: '#8a9cc9', hemiGround: '#5b4b45', hemiIntensity: 1.05,
      zenith: '#24508f', mid: '#c98f86', horizon: '#ffb070', away: '#b89ab0',
      warm: '#ffa45c', disc: '#ffe0b0', discScale: 1.35, glare: '#ffc48a', lights: 0.45,
    },
  };
  let base = null, cur = null;
  const C = (h) => new THREE.Color(h);

  function capture(env) {
    base = {
      sunDir: env.SUN_DIR.clone(), sunColor: env.sunLight.color.clone(), sunIntensity: env.sunLight.intensity,
      hemiSky: env.hemiLight.color.clone(), hemiGround: env.hemiLight.groundColor.clone(), hemiIntensity: env.hemiLight.intensity,
      sky: env.COL.sky.clone(), horizon: env.COL.horizon.clone(), disc: env.sunDisc.material.color.clone(),
      af: [Airframe.ENV.afSky.value.clone(), Airframe.ENV.afHorizon.value.clone(), Airframe.ENV.afGround.value.clone()],
      glare: typeof Glare !== 'undefined' ? Glare.uniforms.glColor.value.clone() : null,
    };
  }

  // the dome's vertex colours: the afternoon's two-colour gradient, or the light's three colours, warmer toward the sun
  function paintSky(sky, L, sunDir) {
    const g = sky.geometry, p = g.attributes.position, col = g.attributes.color, R = g.parameters.radius, c = new THREE.Color(), h = new THREE.Color();
    const sx = sunDir.x, sz = sunDir.z, sl = Math.hypot(sx, sz) || 1;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / R, y = p.getY(i) / R, z = p.getZ(i) / R;
      if (!L) c.copy(base.horizon).lerp(base.sky, y > 0 ? Math.pow(y, 0.55) : 0);
      else {
        const hl = Math.hypot(x, z) || 1, toward = 0.5 + 0.5 * (x * sx + z * sz) / (hl * sl);   // 1 facing the sun
        h.copy(L.away).lerp(L.horizon, Math.pow(toward, 1.6));
        const yy = Math.max(y, 0);
        if (yy < 0.2) c.copy(h).lerp(L.mid, smoothstep(0, 0.2, yy) * (1 - 0.5 * toward));
        else c.copy(L.mid).lerp(h, 0.5 * toward * (1 - smoothstep(0.2, 0.45, yy))).lerp(L.zenith, Math.pow(smoothstep(0.2, 1, yy), 0.7));
      }
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  function configure(course, env) {
    if (!base) capture(env);
    const spec = course && course.light;
    const P = spec ? Object.assign({}, PRESETS[spec.preset] || {}, spec) : null;
    let L = null;
    if (P) {
      L = { sunDir: new THREE.Vector3().fromArray(P.sunDir || base.sunDir.toArray()).normalize(),
        sunColor: C(P.sunColor), zenith: C(P.zenith), mid: C(P.mid), horizon: C(P.horizon), away: C(P.away || P.horizon), lights: P.lights };
      L.fog = P.fog ? C(P.fog) : L.horizon.clone().lerp(L.away, 0.35).lerp(L.mid, 0.2);
      L.sky = L.zenith; L.discScale = P.discScale || 1;
    }
    cur = L;
    const sd = L ? L.sunDir : base.sunDir;
    env.SUN_DIR.copy(sd);
    env.sunLight.position.copy(sd).multiplyScalar(100);
    env.sunLight.color.copy(L ? L.sunColor : base.sunColor); env.sunLight.intensity = P ? P.sunIntensity : base.sunIntensity;
    env.hemiLight.color.copy(P ? C(P.hemiSky) : base.hemiSky); env.hemiLight.groundColor.copy(P ? C(P.hemiGround) : base.hemiGround);
    env.hemiLight.intensity = P ? P.hemiIntensity : base.hemiIntensity;
    env.COL.sky.copy(L ? L.zenith : base.sky); env.COL.horizon.copy(L ? L.fog : base.horizon);   // scene.fog.color is COL.horizon
    env.scene.fog.color.copy(env.COL.horizon);
    env.sunDisc.material.color.copy(P ? C(P.disc) : base.disc);
    paintSky(env.sky, L, sd);
    Airframe.ENV.afSky.value.copy(L ? L.zenith : base.af[0]); Airframe.ENV.afHorizon.value.copy(L ? L.horizon : base.af[1]);
    Airframe.ENV.afGround.value.copy(L ? C('#3d3a3a') : base.af[2]);
    Atmosphere.init({ sunDir: sd, sun: env.sunLight });     // sun direction and full-sun level for the fog's tint
    if (Atmosphere.setWarm) Atmosphere.setWarm(P && P.warm ? C(P.warm) : null);
    if (base.glare) Glare.uniforms.glColor.value.copy(P && P.glare ? C(P.glare) : base.glare);
  }

  return { configure, PRESETS, get current() { return cur; }, get discScale() { return cur ? cur.discScale : 1; } };
})();
