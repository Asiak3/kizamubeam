// Shared, disposable dialog behavior. All dimensions are CSS pixels.
import { t } from './i18n';
export function movableToolWindow(dialog: HTMLDialogElement, handle: HTMLElement, redraw: () => void): () => void {
  let drag: { x: number; y: number; left: number; top: number } | null = null;
  const clamp = () => {
    const margin = 8, width = Math.max(1, innerWidth - margin * 2), height = Math.max(1, innerHeight - margin * 2);
    dialog.style.maxWidth = `${width}px`; dialog.style.maxHeight = `${height}px`;
    const r = dialog.getBoundingClientRect();
    dialog.style.left = `${Math.max(margin, Math.min(r.left, innerWidth - r.width - margin))}px`;
    dialog.style.top = `${Math.max(margin, Math.min(r.top, innerHeight - r.height - margin))}px`;
    redraw();
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    dialog.style.left = `${drag.left + e.clientX - drag.x}px`;
    dialog.style.top = `${drag.top + e.clientY - drag.y}px`;
    clamp();
  };
  const up = () => { drag = null; };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button,input,select')) return;
    const r = dialog.getBoundingClientRect(); drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    e.preventDefault();
  };
  handle.addEventListener('pointerdown', down);
  handle.tabIndex = 0;
  if (!handle.title) handle.title = t('Fenster mit Pfeiltasten verschieben');
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 8;
    let dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else return;
    e.preventDefault();
    const r = dialog.getBoundingClientRect();
    dialog.style.left = `${r.left + dx}px`;
    dialog.style.top = `${r.top + dy}px`;
    clamp();
  };
  handle.addEventListener('keydown', onKey);
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up); window.addEventListener('resize', clamp);
  const observer = new ResizeObserver(() => clamp()); observer.observe(dialog);
  const r = dialog.getBoundingClientRect(); dialog.style.margin = '0';
  dialog.style.left = `${r.left}px`; dialog.style.top = `${r.top}px`; clamp();
  return () => {
    observer.disconnect(); handle.removeEventListener('pointerdown', down);
    handle.removeEventListener('keydown', onKey);
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up); window.removeEventListener('resize', clamp);
  };
}
