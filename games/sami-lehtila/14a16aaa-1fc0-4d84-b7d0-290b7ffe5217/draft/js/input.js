// Keyboard, swipe and tap. Calls handlers.move(dir) / undo() / restart() / hint() / next().
export function bindInput(canvas, handlers, getSealCenter) {
  const KEY = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  };
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (KEY[e.code]) { e.preventDefault(); handlers.move(KEY[e.code]); return; }
    if (e.code === 'KeyZ' || e.code === 'Backspace' || e.code === 'KeyU') { e.preventDefault(); handlers.undo(); }
    else if (e.code === 'KeyR') handlers.restart();
    else if (e.code === 'KeyH') handlers.hint();
    else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyN') {
      if (handlers.next()) e.preventDefault();
    }
  });

  let start = null;
  canvas.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!start) return;
    let dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (Math.hypot(dx, dy) < 20) {
      // Tap: move toward the tapped point along its dominant axis.
      const r = canvas.getBoundingClientRect();
      const c = getSealCenter();
      if (!c) return;
      dx = e.clientX - r.left - c.x; dy = e.clientY - r.top - c.y;
      if (Math.hypot(dx, dy) < c.cell * 0.5) return;
    }
    handlers.move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });
  canvas.addEventListener('pointercancel', () => { start = null; });
}
