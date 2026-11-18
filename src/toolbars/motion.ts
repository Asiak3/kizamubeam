export const LAYOUT_SETTLE_MS = 150;
const LAYOUT_SETTLE_EASING = 'ease-out';

export interface ToolbarMotionSnapshot {
  readonly rects: ReadonlyMap<HTMLElement, DOMRect>;
  readonly exclude?: HTMLElement;
}

/** Visual settling only: layout and docking hit areas remain at their final geometry. */
export function createToolbarMotion(doc: Document) {
  const owned = new Set<Animation>();
  let disposed = false;
  let media: MediaQueryList | undefined;

  function cancel() {
    for (const animation of owned) animation.cancel();
    owned.clear();
  }

  function motionChanged() {
    if (media?.matches) cancel();
  }

  function reducedMotion() {
    const next = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (next !== media) {
      media?.removeEventListener?.('change', motionChanged);
      media = next;
      media?.addEventListener?.('change', motionChanged);
    }
    return !!media?.matches;
  }

  function excluded(element: HTMLElement, exclude?: HTMLElement) {
    return !!exclude && (element.contains(exclude) || exclude.contains(element));
  }

  function capture(exclude?: HTMLElement): ToolbarMotionSnapshot {
    // Cancel our transforms before *any* reads, including an animated ancestor.
    cancel();
    const rects = new Map<HTMLElement, DOMRect>();
    if (disposed || reducedMotion()) return { rects, exclude };
    for (const element of doc.querySelectorAll<HTMLElement>(
      '.toolbar-layout-app .toolbar-layout-shell, .toolbar-layout-app #main',
    )) {
      if (excluded(element, exclude) || typeof element.animate !== 'function') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) rects.set(element, rect);
    }
    return { rects, exclude };
  }

  function settle(snapshot: ToolbarMotionSnapshot) {
    if (disposed) return;
    if (reducedMotion()) { cancel(); return; }
    cancel();
    // Finish reading all geometry before starting animations on any element.
    const targets = [...snapshot.rects].filter(([element]) =>
      element.isConnected && element.closest('.toolbar-layout-app') &&
      !excluded(element, snapshot.exclude) && typeof element.animate === 'function',
    ).map(([element, before]) => ({ element, before, after: element.getBoundingClientRect() }));
    for (const { element, before, after } of targets) {
      if (!(after.width > 0 && after.height > 0)) continue;
      let x = before.left - after.left, y = before.top - after.top;
      let sx = 1, sy = 1;
      if (element.id === 'main') {
        sx = before.width / after.width;
        sy = before.height / after.height;
        // Preserve the existing transform origin without writing inline styles.
        const origin = doc.defaultView?.getComputedStyle(element).transformOrigin.split(' ') ?? [];
        x += (parseFloat(origin[0]) || 0) * (sx - 1);
        y += (parseFloat(origin[1]) || 0) * (sy - 1);
      }
      if (![x, y, sx, sy].every(Number.isFinite) || (x === 0 && y === 0 && sx === 1 && sy === 1)) continue;
      const animation = element.animate([
        { transform: `translate(${x}px, ${y}px) scale(${sx}, ${sy})` },
        { transform: 'none' },
      ], { duration: LAYOUT_SETTLE_MS, easing: LAYOUT_SETTLE_EASING });
      owned.add(animation);
      const release = () => owned.delete(animation);
      animation.addEventListener('finish', release, { once: true });
      animation.addEventListener('cancel', release, { once: true });
    }
  }

  function dispose() {
    disposed = true;
    cancel();
    media?.removeEventListener?.('change', motionChanged);
    media = undefined;
  }

  return { capture, settle, cancel, dispose };
}
