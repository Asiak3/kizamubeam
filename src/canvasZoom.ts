// Precision touchpads report pinch as Ctrl+wheel; WebKit also has gesture events.
// Never use browser/page zoom for canvas navigation.
const active = new WeakSet<HTMLElement>();
export const pinchGestureActive = (element: HTMLElement) => active.has(element);

export function canvasWheelFactor(event: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>, ordinarySensitivity: number): number {
  const delta = event.deltaY * (event.deltaMode ? 30 : 1);
  if (!Number.isFinite(delta)) return 1;
  const sensitivity = event.ctrlKey ? 0.01 : ordinarySensitivity;
  return Math.exp(Math.max(-1, Math.min(1, -delta * sensitivity)));
}

export function installPinchGestures(element: HTMLElement, zoom: (factor: number, x: number, y: number) => void): () => void {
  let scale = 1;
  type Gesture = Event & { scale?: number; clientX?: number; clientY?: number };
  const start = (event: Event) => {
    event.preventDefault();
    const value = (event as Gesture).scale;
    scale = Number.isFinite(value) && value! > 0 ? value! : 1;
    active.add(element);
  };
  const change = (event: Event) => {
    event.preventDefault();
    const e = event as Gesture;
    if (!active.has(element) || !Number.isFinite(e.scale) || e.scale! <= 0) return;
    const factor = e.scale! / scale;
    scale = e.scale!;
    if (!Number.isFinite(factor) || factor <= 0) return;
    const r = element.getBoundingClientRect();
    zoom(Math.max(0.1, Math.min(10, factor)), Number.isFinite(e.clientX) ? e.clientX! - r.left : r.width / 2,
      Number.isFinite(e.clientY) ? e.clientY! - r.top : r.height / 2);
  };
  const end = (event: Event) => { event.preventDefault(); active.delete(element); scale = 1; };
  element.addEventListener('gesturestart', start, { passive: false });
  element.addEventListener('gesturechange', change, { passive: false });
  element.addEventListener('gestureend', end, { passive: false });
  element.addEventListener('gesturecancel', end, { passive: false });
  element.addEventListener('pointercancel', end);
  return () => {
    active.delete(element);
    element.removeEventListener('gesturestart', start); element.removeEventListener('gesturechange', change);
    element.removeEventListener('gestureend', end);
    element.removeEventListener('gesturecancel', end); element.removeEventListener('pointercancel', end);
  };
}
