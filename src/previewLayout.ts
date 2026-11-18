/** Resizes the preview's two panes without touching the job or playback state. */
export function previewSplitter(main: HTMLElement, side: HTMLElement, label: string): HTMLElement {
  const split = document.createElement('div');
  split.className = 'preview-splitter';
  split.tabIndex = 0;
  split.setAttribute('role', 'separator');
  split.setAttribute('aria-orientation', 'vertical');
  split.setAttribute('aria-label', label);
  const minCanvas = 120;
  const minSide = 280;
  const storageKey = 'kizamubeam.previewSidebarWidth';
  let preferred: number | null = null;
  try {
    const saved = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(saved) && saved > 0) preferred = saved;
  } catch { /* Local layout still works when storage is unavailable. */ }
  const limits = () => {
    const available = Math.max(0, main.clientWidth - split.getBoundingClientRect().width);
    return { min: Math.min(minSide, available), max: Math.max(Math.min(minSide, available), available - minCanvas) };
  };
  const update = (width: number) => {
    const { min, max } = limits();
    const value = Math.round(Math.max(min, Math.min(max, width)));
    side.style.width = `${value}px`;
    split.setAttribute('aria-valuemin', String(Math.round(min)));
    split.setAttribute('aria-valuemax', String(Math.round(max)));
    split.setAttribute('aria-valuenow', String(value));
  };
  const save = () => {
    preferred = Number(split.getAttribute('aria-valuenow'));
    try { localStorage.setItem(storageKey, String(preferred)); } catch { /* Storage unavailable. */ }
  };
  split.addEventListener('keydown', (e) => {
    const { min, max } = limits();
    const width = side.getBoundingClientRect().width;
    const step = e.shiftKey ? 50 : 10;
    const next = e.key === 'ArrowLeft' ? width + step : e.key === 'ArrowRight' ? width - step
      : e.key === 'Home' ? min : e.key === 'End' ? max : null;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    update(next);
    save();
  });
  split.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    split.focus();
    const width = side.getBoundingClientRect().width;
    const x = e.clientX;
    split.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => update(width + x - ev.clientX);
    const end = (ev: Event) => {
      if (ev.type === 'pointercancel' || ev.type === 'keydown') update(width);
      else save();
      split.removeEventListener('pointermove', move);
      split.removeEventListener('pointerup', end);
      split.removeEventListener('pointercancel', end);
      split.removeEventListener('keydown', cancel);
      if (split.hasPointerCapture(e.pointerId)) split.releasePointerCapture(e.pointerId);
    };
    const cancel = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      end(ev);
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', end);
    split.addEventListener('pointercancel', end);
    split.addEventListener('keydown', cancel);
  });
  const ro = new ResizeObserver(() => update(preferred ?? side.getBoundingClientRect().width));
  ro.observe(main);
  main.closest('dialog')?.addEventListener('close', () => ro.disconnect(), { once: true });
  return split;
}
