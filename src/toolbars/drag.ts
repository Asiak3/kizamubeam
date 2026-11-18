/** Pointer-drag sessions owned by the toolbar framework (tear-off, float moves).
 * Window-level listeners: no pointer capture needed, so removing the grab
 * element mid-gesture (popup closes on tear) never strands the session.
 * ESC, pointer cancel and window blur abort without committing anything. */
export type DragAbortReason = 'esc' | 'blur' | 'cancel';

export interface WindowDragCallbacks {
  onMove(x: number, y: number, event: PointerEvent): void;
  onEnd(event: PointerEvent): void;
  onAbort(reason: DragAbortReason): void;
}

export interface WindowDragHandle {
  cancel(): void;
  readonly active: boolean;
}

export function startWindowDrag(doc: Document, callbacks: WindowDragCallbacks, pointerId?: number): WindowDragHandle {
  let done = false;
  const view = doc.defaultView ?? null;
  const cleanup = () => {
    doc.removeEventListener('pointermove', move);
    doc.removeEventListener('pointerup', up);
    doc.removeEventListener('pointercancel', cancel);
    doc.removeEventListener('keydown', key, true);
    view?.removeEventListener('blur', blur);
  };
  const finish = (fn: () => void) => {
    if (done) return;
    done = true;
    cleanup();
    fn();
  };
  const move = (event: PointerEvent) => {
    if (done || (pointerId !== undefined && event.pointerId !== pointerId)) return;
    callbacks.onMove(event.clientX, event.clientY, event);
  };
  const up = (event: PointerEvent) => {
    if (pointerId === undefined || event.pointerId === pointerId) finish(() => callbacks.onEnd(event));
  };
  const cancel = (event: PointerEvent) => {
    if (pointerId === undefined || event.pointerId === pointerId) finish(() => callbacks.onAbort('cancel'));
  };
  const blur = () => finish(() => callbacks.onAbort('blur'));
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // The drag owns Escape: do not also close the restored flyout/dialog.
      event.stopImmediatePropagation();
      finish(() => callbacks.onAbort('esc'));
    }
  };
  doc.addEventListener('pointermove', move);
  doc.addEventListener('pointerup', up);
  doc.addEventListener('pointercancel', cancel);
  doc.addEventListener('keydown', key, true);
  view?.addEventListener('blur', blur);
  return {
    cancel() { finish(() => callbacks.onAbort('cancel')); },
    get active() { return !done; },
  };
}
