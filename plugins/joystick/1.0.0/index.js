/**
 * Kelluva ohjaussauva kosketusnäytölle.
 *
 * Sauva syntyy siihen mihin sormi laskeutuu, joten peukalo voi olla nurkassa
 * eikä sen päällä mitä se ohjaa. Komponentti ei tiedä pelistä mitään: se antaa
 * pelkän suuntavektorin, ja peli päättää mitä sillä tekee.
 *
 *   import { createJoystick } from './joystick.js';
 *
 *   const stick = createJoystick({ target: canvas, toLocal });
 *
 *   // ruudunpiirrossa:
 *   player.vx += stick.x * stick.gain * MAX_SPEED * DRAG * dt;
 *   stick.draw(ctx);
 *
 * Sopimus jonka varaan voi laskea: x ja y ovat aina välillä -1…1, ja niiden
 * muodostaman vektorin pituus on korkeintaan 1 — myös viistoon. Rajaus tehdään
 * vektorille, ei akseleille erikseen, joten viistosuunta ei ole nopeampi.
 */

const DEFAULTS = {
  target: null,        // elementti jolta painallus kuunnellaan; oletus document
  toLocal: null,       // (clientX, clientY) => {x, y}; oletus elementin pikselit
  radius: 100,         // etäisyys origosta täyteen poikkeutukseen, toLocalin yksiköissä
  deadzone: 0.06,      // tätä pienempi poikkeutus luetaan nollaksi
  gain: 1,             // kerroin syötteen ja käytön välissä
  onPress: null,       // (pos) => void, kun sauva lyödään maahan
  ignore: null,        // (pos) => boolean, true jos peli varaa tämän kohdan itselleen
};

export function createJoystick(options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const target = opt.target || document;
  const events = target === document ? window : target;

  const stick = {
    x: 0,
    y: 0,
    active: false,
    gain: opt.gain,
    radius: opt.radius,
    deadzone: opt.deadzone,
    origin: { x: 0, y: 0 },
    knob: { x: 0, y: 0 },   // nupin siirtymä origosta, rajattuna säteeseen
    draw,
    release,
    destroy,
  };

  let pointerId = -1;

  function toLocal(clientX, clientY) {
    if (opt.toLocal) return opt.toLocal(clientX, clientY);
    const el = target === document ? document.documentElement : target;
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function aim(px, py) {
    let dx = px - stick.origin.x;
    let dy = py - stick.origin.y;
    const dist = Math.hypot(dx, dy);

    if (dist > stick.radius) {
      dx = dx / dist * stick.radius;
      dy = dy / dist * stick.radius;
    }
    stick.knob.x = dx;
    stick.knob.y = dy;

    const mag = Math.min(dist / stick.radius, 1);
    if (mag <= stick.deadzone || dist === 0) {
      stick.x = 0;
      stick.y = 0;
      return;
    }
    // Skaalataan kuollut alue pois, jottei ohjaus hyppää nollasta täyteen.
    const out = (mag - stick.deadzone) / (1 - stick.deadzone);
    stick.x = dx / dist * out;
    stick.y = dy / dist * out;
  }

  function onDown(e) {
    const p = toLocal(e.clientX, e.clientY);
    if (opt.ignore && opt.ignore(p)) return;
    pointerId = e.pointerId;
    stick.active = true;
    stick.origin.x = p.x;
    stick.origin.y = p.y;
    stick.knob.x = 0;
    stick.knob.y = 0;
    stick.x = 0;
    stick.y = 0;
    if (opt.onPress) opt.onPress(p);
  }

  function onMove(e) {
    if (!stick.active || e.pointerId !== pointerId) return;
    const p = toLocal(e.clientX, e.clientY);
    aim(p.x, p.y);
  }

  function onUp(e) {
    if (e.pointerId !== pointerId) return;
    release();
  }

  /** Päästää sauvan irti; syöte menee nollaan mutta peli jatkuu. */
  function release() {
    stick.active = false;
    pointerId = -1;
    stick.x = 0;
    stick.y = 0;
    stick.knob.x = 0;
    stick.knob.y = 0;
  }

  /**
   * Piirtää sauvan toLocalin koordinaatistossa. Tyylit voi korvata, tai jättää
   * tämän kokonaan kutsumatta ja piirtää itse origin- ja knob-arvoista.
   */
  function draw(ctx, style = {}) {
    if (!stick.active) return;
    const color = style.color || '#9ff0ff';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = style.lineWidth || 2;
    ctx.globalAlpha = style.ringAlpha ?? 0.22;
    ctx.beginPath();
    ctx.arc(stick.origin.x, stick.origin.y, stick.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = style.centerAlpha ?? 0.16;
    ctx.beginPath();
    ctx.arc(stick.origin.x, stick.origin.y, stick.radius * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = style.knobAlpha ?? 0.42;
    ctx.beginPath();
    ctx.arc(stick.origin.x + stick.knob.x, stick.origin.y + stick.knob.y,
            stick.radius * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function destroy() {
    events.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('blur', release);
  }

  events.addEventListener('pointerdown', onDown);
  // Liike ja irrotus kuunnellaan ikkunasta, jotta veto ei katkea jos sormi
  // liukuu elementin ulkopuolelle.
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('blur', release);

  return stick;
}
