// Session-only workspace display gate. Never changes camera settings, acquisition or live timers.
let visible = true;
const listeners = new Set<() => void>();

export const cameraOverlaysVisible = () => visible;

export function onCameraOverlayVisibilityChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function toggleCameraOverlays(ed: { redraw(): void; emit(what: 'tool'): void }): void {
  visible = !visible;
  ed.redraw();
  // Refresh customizable toolbar actions without reporting a document/settings change.
  ed.emit('tool');
  listeners.forEach((listener) => listener());
}
