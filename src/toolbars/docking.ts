import { startWindowDrag } from './drag';
import { t } from '../i18n';
import { createToolbarMotion } from './motion';
import type { WindowDragHandle } from './drag';
import type { DockEdge, LayoutTarget, ViewLayout } from './model';

export type { LayoutTarget } from './model';
interface MountedView {
  target: LayoutTarget;
  element: HTMLElement;
  grip: HTMLElement;
  layout: ViewLayout;
  home: Comment;
  original: { className: string; style: string | null; dataset: Record<string, string | undefined> };
  cleanup(): void;
}
const EDGES: DockEdge[] = ['top', 'bottom', 'left', 'right'];
const DOCK_DISTANCE = 36;
const SEPARATOR_BAND = 12;
const TARGET_HYSTERESIS = 6;
interface DockSnapshot {
  bounds: DOMRect;
  zones: Map<DockEdge, DOMRect>;
  lanes: { edge: DockEdge; lane: number; rect: DOMRect; siblings: DOMRect[] }[];
}
interface DockDraft {
  view: ViewLayout;
  insertLane?: boolean;
  key?: string;
  hit?: { left: number; right: number; top: number; bottom: number };
}

/** Placement only: never owns action/control children or writes storage during preview. */
export function createToolbarDocking(doc: Document, layer: HTMLElement, options: {
  locked(): boolean;
  commit(target: LayoutTarget, view: ViewLayout, participants?: readonly LayoutTarget[], insertLane?: boolean): boolean | void;
}) {
  const mounted = new Map<HTMLElement, MountedView>();
  const zones = new Map<DockEdge, HTMLElement>();
  const lanes = new Map<string, HTMLElement>();
  const app = doc.getElementById('app');
  const motion = createToolbarMotion(doc);
  let lastPointerId: number | undefined;
  const rememberPointer = (event: PointerEvent) => { lastPointerId = event.pointerId; };
  doc.addEventListener('pointerdown', rememberPointer, true);
  let active: WindowDragHandle | undefined;
  let previewElement: HTMLElement | undefined;
  let redrawPreview: (() => void) | undefined;
  let disposed = false;
  const moveElement = (element: HTMLElement, parent: Node, before: Node | null = null) => {
    if (element.parentNode === parent && element.nextSibling === before) return;
    const focused = doc.activeElement as HTMLElement | null;
    const preserve = focused && element.contains(focused);
    let selection: { start: number; end: number; direction: 'forward' | 'backward' | 'none' } | undefined;
    // Number/date inputs reject selection APIs. Text/formula drafts must keep their
    // selection even on WebViews without state-preserving moveBefore().
    if (preserve && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) {
      const field = focused as HTMLInputElement | HTMLTextAreaElement;
      if (field.selectionStart !== null && field.selectionEnd !== null)
        selection = { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection ?? 'none' };
    }
    const movable = parent as Node & { moveBefore?: (node: Node, child: Node | null) => void };
    if (movable.moveBefore && element.isConnected && parent.isConnected) movable.moveBefore(element, before);
    else {
      parent.insertBefore(element, before);
      if (preserve) {
        focused.focus({ preventScroll: true });
        if (selection) (focused as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(selection.start, selection.end, selection.direction);
      }
    }
  };
  if (app) {
    app.classList.add('toolbar-layout-app');
    // Explicit grid areas preserve the menu, canvas/panel docking, palette and status.
    for (const edge of EDGES) {
      const zone = doc.createElement('div');
      zone.className = 'toolbar-dock-zone';
      zone.dataset.edge = edge;
      app.append(zone);
      zones.set(edge, zone);
    }
  }
  const laneFor = (edge: DockEdge, lane: number) => {
    const zone = zones.get(edge);
    if (!zone) return undefined;
    const key = `${edge}:${lane}`;
    let element = lanes.get(key);
    if (!element) {
      element = doc.createElement('div');
      element.className = 'toolbar-dock-lane';
      element.dataset.lane = String(lane);
      element.style.order = String(lane);
      zone.append(element);
      lanes.set(key, element);
    }
    return element;
  };
  const reachable = (element: HTMLElement, view: ViewLayout): ViewLayout => {
    if (view.placement.kind !== 'floating') return view;
    const { clientWidth: width, clientHeight: height } = doc.documentElement;
    const grip = mounted.get(element)?.grip ?? element.querySelector<HTMLElement>('.toolbar-float-head');
    const rect = element.getBoundingClientRect(), handle = grip?.getBoundingClientRect();
    const offsetX = handle ? handle.left - rect.left : 0;
    const offsetY = handle ? handle.top - rect.top : 0;
    const gripWidth = Math.min(handle?.width || 24, 48, width);
    const gripHeight = Math.min(handle?.height || 24, height);
    // Prefer the whole shell inside the viewport when it fits; for oversized
    // content the actual grip (not an arbitrary far edge) remains reachable.
    const minX = rect.width <= width ? Math.max(0, -offsetX) : -offsetX;
    const minY = rect.height <= height ? Math.max(0, -offsetY) : -offsetY;
    const maxX = Math.min(width - offsetX - gripWidth, rect.width <= width ? width - rect.width : width);
    const maxY = Math.min(height - offsetY - gripHeight, rect.height <= height ? height - rect.height : height);
    return { ...view, placement: { kind: 'floating',
      x: Math.max(minX, Math.min(view.placement.x, maxX)),
      y: Math.max(minY, Math.min(view.placement.y, maxY)),
    } };
  };
  const apply = (element: HTMLElement, view: ViewLayout, previewLane?: HTMLElement) => {
    element.classList.add('toolbar-layout-shell');
    element.dataset.orientation = view.orientation;
    const gripMark = element.querySelector<HTMLElement>(':scope > .toolbar-grip > .toolbar-grip-mark');
    if (gripMark) gripMark.textContent = view.orientation === 'vertical' ? '⋯' : '⋮';
    const root = element.querySelector<HTMLElement>('[data-view]');
    if (root) {
      root.classList.add('toolbar-view');
      root.dataset.orientation = view.orientation;
      root.style.setProperty('--toolbar-rows', String(view.rows));
      root.style.setProperty('--toolbar-columns', String(view.columns));
    }
    const p = view.placement;
    element.classList.toggle('toolbar-layout-floating', p.kind === 'floating');
    element.dataset.placement = p.kind;
    const moveTo = (parent: HTMLElement) => {
      if (element.parentElement === parent) return;
      // New WebViews can move a live subtree without resetting focus/control state.
      moveElement(element, parent);
    };
    if (p.kind === 'floating') {
      moveTo(layer);
      const bounded = reachable(element, view).placement;
      if (bounded.kind === 'floating') {
        element.style.left = `${bounded.x}px`;
        element.style.top = `${bounded.y}px`;
      }
      element.style.order = '';
    } else {
      const lane = previewLane ?? laneFor(p.edge, p.lane);
      if (lane) moveTo(lane);
      element.style.left = '';
      element.style.top = '';
      element.style.order = String(p.order);
      element.dataset.edge = p.edge;
      element.dataset.lane = String(p.lane);
    }
    element.style.visibility = '';
  };
  const laneSiblings = (lane: HTMLElement, element: HTMLElement) => ([...lane.children] as HTMLElement[])
    .filter(child => child !== element).sort((a, b) => Number(a.style.order) - Number(b.style.order));
  const visibleSiblings = (lane: HTMLElement, element: HTMLElement) => laneSiblings(lane, element)
    .filter(child => !child.hidden && doc.defaultView?.getComputedStyle(child).display !== 'none');
  const candidate = (prior: ViewLayout, geometry: DockSnapshot, x: number, y: number, dx: number, dy: number): DockDraft => {
    const { bounds } = geometry;
    const distances: [DockEdge, number][] = [
      ['top', Math.abs(y - (geometry.zones.get('top')?.top ?? bounds.top))],
      ['bottom', Math.abs(y - (geometry.zones.get('bottom')?.bottom ?? bounds.bottom))],
      ['left', Math.abs(x - bounds.left)], ['right', Math.abs(x - bounds.right)],
    ];
    // Existing lanes accept drops throughout their bounds, not only at the viewport edge.
    for (const { edge, rect: r } of geometry.lanes) {
      if (r.width && r.height && x >= r.left - SEPARATOR_BAND && x <= r.right + SEPARATOR_BAND && y >= r.top - SEPARATOR_BAND && y <= r.bottom + SEPARATOR_BAND)
        distances.find(([e]) => e === edge)![1] = 0;
    }
    distances.sort((a, b) => a[1] - b[1]);
    const [edge, distance] = distances[0];
    if (distance > DOCK_DISTANCE) return { view: { ...prior, placement: { kind: 'floating', x: x - dx, y: y - dy } } };
    const vertical = edge === 'left' || edge === 'right';
    let lane = 0, order = 0;
    let insertLane = false;
    const occupied = geometry.lanes.filter(row => row.edge === edge).sort((a, b) => a.lane - b.lane);
    const cross = vertical ? x : y, along = vertical ? y : x;
    const nearest = occupied.reduce<typeof occupied[number] | undefined>((best, row) => {
      const distance = (r: DOMRect) => Math.max((vertical ? r.left : r.top) - cross, cross - (vertical ? r.right : r.bottom), 0);
      return !best || distance(row.rect) < distance(best.rect) ? row : best;
    }, undefined);
    let start = -Infinity, end = Infinity, alongStart = -Infinity, alongEnd = Infinity;
    if (nearest) {
      lane = nearest.lane;
      const r = nearest.rect;
      const low = vertical ? r.left : r.top, high = vertical ? r.right : r.bottom;
      const band = Math.min(SEPARATOR_BAND, (high - low) / 4);
      if (cross <= low + band) { insertLane = true; end = low + band; start = low - SEPARATOR_BAND; }
      else if (cross >= high - band) {
        insertLane = true;
        lane = occupied[occupied.indexOf(nearest) + 1]?.lane ?? nearest.lane + 1;
        start = high - band; end = high + SEPARATOR_BAND;
      } else {
        start = low + band; end = high - band;
        const centers = nearest.siblings.map(rect => vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2);
        order = centers.findIndex(center => along < center);
        if (order < 0) order = centers.length;
        alongStart = centers[order - 1] ?? -Infinity;
        alongEnd = centers[order] ?? Infinity;
      }
    }
    return { view: { ...prior, orientation: vertical ? 'vertical' : 'horizontal', placement: { kind: 'dock', edge, lane, order } }, insertLane,
      key: `${edge}:${lane}:${insertLane ? 'new' : order}`,
      hit: vertical ? { left: start, right: end, top: alongStart, bottom: alongEnd } : { left: alongStart, right: alongEnd, top: start, bottom: end } };
  };
  const participants = (element: HTMLElement, view: ViewLayout): LayoutTarget[] => {
    const placement = view.placement;
    if (placement.kind !== 'dock') return [];
    return [...mounted.values()].filter((entry) => entry.element !== element && !entry.element.hidden && entry.element.style.display !== 'none' &&
      entry.layout.placement.kind === 'dock' && entry.layout.placement.edge === placement.edge && entry.layout.placement.lane === placement.lane)
      .map((entry) => entry.target);
  };
  const commitView = (element: HTMLElement, target: LayoutTarget, view: ViewLayout, insertLane?: boolean, smooth = true) => {
    // During a pointer gesture the preview already occupies its final location.
    const before = smooth ? motion.capture(element) : undefined;
    const accepted = options.commit(target, view, participants(element, view), insertLane);
    if (before) motion.settle(before);
    return accepted;
  };
  const begin = (element: HTMLElement, target: LayoutTarget, prior: ViewLayout, x: number, y: number,
    pointerId?: number, transaction?: { commit(view: ViewLayout, participants: readonly LayoutTarget[], insertLane?: boolean): boolean | void; abort(): void }) => {
    if (disposed || options.locked()) return false;
    active?.cancel();
    motion.cancel();
    const parent = element.parentNode, next = element.nextSibling;
    const priorLanes = new Set(lanes.keys());
    const discardPreviewLanes = () => {
      for (const [key, lane] of lanes) if (!priorLanes.has(key) && !lane.children.length) { lane.remove(); lanes.delete(key); }
    };
    const style = element.getAttribute('style'), className = element.className;
    const data = { ...element.dataset };
    const gripMark = element.querySelector<HTMLElement>(':scope > .toolbar-grip > .toolbar-grip-mark');
    const gripText = gripMark?.textContent;
    const root = element.querySelector<HTMLElement>('[data-view]');
    const rootStyle = root?.getAttribute('style'), rootOrientation = root?.dataset.orientation;
    const rect = element.getBoundingClientRect(), dx = x - rect.left, dy = y - rect.top;
    // Measure once, before the preview can change lane sizes or sibling positions.
    const position = element.style.getPropertyValue('position'), positionPriority = element.style.getPropertyPriority('position');
    element.style.position = 'fixed';
    let geometry: DockSnapshot;
    try {
      geometry = { bounds: app?.getBoundingClientRect() ?? doc.documentElement.getBoundingClientRect(),
        zones: new Map([...zones].map(([edge, zone]) => [edge, zone.getBoundingClientRect()])), lanes: [] };
      for (const [edge, zone] of zones) for (const row of zone.children as HTMLCollectionOf<HTMLElement>) {
        const siblings = visibleSiblings(row, element);
        if (siblings.length) geometry.lanes.push({ edge, lane: Number(row.dataset.lane), rect: row.getBoundingClientRect(),
          siblings: siblings.map(sibling => sibling.getBoundingClientRect()) });
      }
    } finally {
      if (position) element.style.setProperty('position', position, positionPriority); else element.style.removeProperty('position');
      if (style === null) element.removeAttribute('style');
    }
    let draft: DockDraft = { view: prior }, moved = !!transaction;
    const previewLane = doc.createElement('div');
    previewLane.className = 'toolbar-dock-lane';
    previewLane.dataset.previewLane = 'true';
    const laneOrders = new Map<HTMLElement, string | null>();
    const restoreLanes = () => {
      for (const [lane, original] of laneOrders) {
        if (original === null) lane.removeAttribute('style'); else lane.setAttribute('style', original);
      }
      laneOrders.clear();
    };
    const siblingOrders = new Map<HTMLElement, { value: string; priority: string; hadStyle: boolean }>();
    const restoreOrders = () => {
      for (const [sibling, original] of siblingOrders) {
        if (original.value) sibling.style.setProperty('order', original.value, original.priority);
        else sibling.style.removeProperty('order');
        if (!original.hadStyle && !sibling.getAttribute('style')) sibling.removeAttribute('style');
      }
      siblingOrders.clear();
    };
    const marker = doc.createElement('div');
    marker.className = 'toolbar-drop-preview';
    marker.setAttribute('aria-hidden', 'true');
    layer.append(marker);
    previewElement = element;
    let motionKey: string | undefined;
    const renderPreview = () => {
      const p = draft.view.placement;
      const key = p.kind === 'dock' ? `${p.edge}:${p.lane}:${p.order}:${!!draft.insertLane}` : 'floating';
      const before = key === motionKey ? undefined : motion.capture(element);
      motionKey = key;
      restoreOrders();
      restoreLanes();
      if (p.kind === 'dock' && draft.insertLane) {
        const zone = zones.get(p.edge);
        if (zone) {
          if (previewLane.parentElement !== zone) moveElement(previewLane, zone);
          previewLane.style.order = String(p.lane);
          for (const lane of zone.children as HTMLCollectionOf<HTMLElement>) {
            if (lane === previewLane || Number(lane.dataset.lane) < p.lane) continue;
            laneOrders.set(lane, lane.getAttribute('style'));
            lane.style.order = String(Number(lane.dataset.lane) + 1);
          }
        }
      }
      apply(element, draft.view, draft.insertLane ? previewLane : undefined);
      if (!draft.insertLane) previewLane.remove();
      if (p.kind === 'floating') draft.view = reachable(element, draft.view);
      if (p.kind === 'dock' && !draft.insertLane) {
        const lane = laneFor(p.edge, p.lane);
        if (lane) {
          // Reindex only the DOM draft. Without this, equal CSS orders display
          // insert-before as insert-after until the durable operation completes.
          const siblings = visibleSiblings(lane, element);
          siblings.splice(Math.min(p.order, siblings.length), 0, element);
          siblings.forEach((sibling, index) => {
            if (sibling !== element) siblingOrders.set(sibling, {
              value: sibling.style.getPropertyValue('order'), priority: sibling.style.getPropertyPriority('order'), hadStyle: sibling.hasAttribute('style'),
            });
            sibling.style.order = String(index);
          });
        }
      }
      const r = element.getBoundingClientRect();
      Object.assign(marker.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      marker.dataset.kind = draft.view.placement.kind;
      marker.dataset.insertLane = String(!!draft.insertLane);
      if (before) motion.settle(before);
    };
    redrawPreview = () => { if (moved) renderPreview(); };
    const finish = () => {
      active = undefined; previewElement = undefined; redrawPreview = undefined;
      restoreOrders(); restoreLanes(); marker.remove(); element.classList.remove('toolbar-dragging');
    };
    const restore = () => {
      if (parent) moveElement(element, parent, next?.parentNode === parent ? next : null);
      if (style === null) element.removeAttribute('style'); else element.setAttribute('style', style);
      element.className = className;
      for (const key of Object.keys(element.dataset)) delete element.dataset[key];
      Object.assign(element.dataset, data);
      if (gripMark && gripText !== undefined) gripMark.textContent = gripText;
      if (root) {
        if (rootStyle == null) root.removeAttribute('style'); else root.setAttribute('style', rootStyle);
        if (rootOrientation === undefined) delete root.dataset.orientation; else root.dataset.orientation = rootOrientation;
      }
      discardPreviewLanes();
      previewLane.remove();
    };
    element.classList.add('toolbar-dragging');
    active = startWindowDrag(doc, {
      onMove(px, py) {
        if (options.locked()) { active?.cancel(); return; }
        if (!moved && Math.hypot(px - x, py - y) < 4) return;
        moved = true;
        const next = candidate(prior, geometry, px, py, dx, dy);
        const hit = draft.hit;
        if (!(next.key && draft.key && next.key !== draft.key && hit &&
          next.view.placement.kind === 'dock' && draft.view.placement.kind === 'dock' && next.view.placement.edge === draft.view.placement.edge &&
          px >= hit.left - TARGET_HYSTERESIS && px <= hit.right + TARGET_HYSTERESIS && py >= hit.top - TARGET_HYSTERESIS && py <= hit.bottom + TARGET_HYSTERESIS)) draft = next;
        renderPreview();
      },
      onEnd() {
        finish();
        if (options.locked()) { restore(); transaction?.abort(); return; }
        if (moved) {
          const accepted = transaction ? transaction.commit(draft.view, participants(element, draft.view), draft.insertLane)
            : commitView(element, target, draft.view, draft.insertLane, false);
          if (accepted === false) restore();
          else if (element.parentElement === previewLane) apply(element, draft.view);
          previewLane.remove();
          discardPreviewLanes();
        }
        else restore();
      },
      onAbort() {
        const before = motion.capture(element);
        finish(); restore(); transaction?.abort();
        motion.settle(before);
      },
    }, pointerId ?? lastPointerId);
    return true;
  };
  const mount = (element: HTMLElement, grip: HTMLElement, target: LayoutTarget, view: ViewLayout) => {
    const home = doc.createComment('toolbar home');
    element.before(home);
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false || options.locked()) return;
      if ((event.target as Element).closest('button,input,select') && event.target !== grip) return;
      event.preventDefault();
      begin(element, target, mounted.get(element)!.layout, event.clientX, event.clientY, event.pointerId);
    };
    // Focus-scoped non-drag alternatives; Escape always cancels the global session.
    const key = (event: KeyboardEvent) => {
      if (options.locked() || event.target !== grip) return;
      const edge: Record<string, DockEdge> = { ArrowUp: 'top', ArrowDown: 'bottom', ArrowLeft: 'left', ArrowRight: 'right' };
      const current = mounted.get(element)!.layout;
      if (edge[event.key]) {
        event.preventDefault();
        if (event.ctrlKey && event.shiftKey && current.placement.kind === 'dock') {
          const after = event.key === 'ArrowDown' || event.key === 'ArrowRight';
          commitView(element, target, { ...current,
            placement: { ...current.placement, lane: current.placement.lane + (after ? 1 : 0), order: 0 } }, true);
        } else if (event.shiftKey && current.placement.kind === 'floating') {
          const p = current.placement, step = 16;
          commitView(element, target, reachable(element, { ...current, placement: { kind: 'floating',
            x: p.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
            y: p.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) } }));
        } else commitView(element, target, { ...current, orientation: event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? 'vertical' : 'horizontal',
          placement: { kind: 'dock', edge: edge[event.key], lane: event.shiftKey && current.placement.kind === 'dock' ? current.placement.lane + 1 : 0,
            order: current.placement.kind === 'dock' ? current.placement.order : 0 } });
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const r = element.getBoundingClientRect();
        commitView(element, target, reachable(element, { ...current, placement: { kind: 'floating', x: r.left + 32, y: r.top + 32 } }));
      }
    };
    grip.tabIndex = 0;
    grip.setAttribute('role', 'button');
    grip.setAttribute('aria-label', t('Leiste verschieben: Pfeile docken an, Umschalt+Pfeile verschieben oder wechseln die Reihe, Strg+Umschalt+Pfeile fügen Reihen ein, Eingabe löst ab'));
    grip.addEventListener('pointerdown', down);
    grip.addEventListener('keydown', key);
    mounted.set(element, { element, grip, target, layout: view, home,
      original: { className: element.className, style: element.getAttribute('style'), dataset: { ...element.dataset } }, cleanup() {
      grip.removeEventListener('pointerdown', down); grip.removeEventListener('keydown', key);
    } });
  };
  const update = (element: HTMLElement, view: ViewLayout) => {
    const entry = mounted.get(element);
    if (entry) { entry.layout = view; entry.grip.setAttribute('aria-disabled', String(options.locked())); }
    if (element !== previewElement) apply(element, view);
    redrawPreview?.();
  };
  const unmount = (element: HTMLElement, restore = false) => {
    if (element === previewElement) active?.cancel();
    const entry = mounted.get(element);
    if (!entry) return;
    entry.cleanup();
    if (restore) {
      if (entry.home.parentNode) moveElement(element, entry.home.parentNode, entry.home);
      element.className = entry.original.className;
      if (entry.original.style === null) element.removeAttribute('style'); else element.setAttribute('style', entry.original.style);
      for (const key of ['orientation', 'placement', 'edge', 'lane']) {
        const value = entry.original.dataset[key];
        if (value === undefined) delete element.dataset[key]; else element.dataset[key] = value;
      }
    }
    entry.home.remove();
    mounted.delete(element);
  };
  const resize = () => {
    active?.cancel();
    motion.cancel();
    for (const entry of mounted.values()) if (entry.element !== previewElement) apply(entry.element, entry.layout);
    redrawPreview?.();
  };
  doc.defaultView?.addEventListener('resize', resize);
  const scroll = () => { active?.cancel(); };
  doc.addEventListener('scroll', scroll, true);
  return { mount, update, begin, unmount,
    cancel() { active?.cancel(); },
    syncLock() { if (options.locked()) active?.cancel(); },
    dispose() {
      if (disposed) return;
      active?.cancel(); disposed = true;
      motion.dispose();
      doc.defaultView?.removeEventListener('resize', resize);
      doc.removeEventListener('scroll', scroll, true);
      doc.removeEventListener('pointerdown', rememberPointer, true);
      for (const element of [...mounted.keys()]) unmount(element, true);
      for (const zone of zones.values()) zone.remove();
      app?.classList.remove('toolbar-layout-app');
    },
  };
}
