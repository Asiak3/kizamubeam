import { clone, createState, DEFAULT_VIEW, detachedId, orientToDock, ownEntry, setEntry } from './model';
import type { Definitions, LayoutState, LayoutTarget, Result, ToolbarState, ViewLayout } from './model';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown, min: number): v is number => Number.isSafeInteger(v) && (v as number) >= min;

export function validView(v: unknown): v is ViewLayout {
  if (!object(v) || !object(v.placement)) return false;
  const p = v.placement;
  return (v.orientation === 'horizontal' || v.orientation === 'vertical') && count(v.rows, 1) && count(v.columns, 1) &&
    (p.kind === 'dock'
      ? ['top', 'right', 'bottom', 'left'].includes(p.edge as string) && count(p.lane, 0) && count(p.order, 0)
      : p.kind === 'floating' && typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y));
}

/** Missing/invalid geometry falls back, without consulting the DOM or mutating the input. */
export function normalizeView(value: unknown, fallback: ViewLayout = DEFAULT_VIEW): ViewLayout {
  return orientToDock(validView(value) ? value : validView(fallback) ? fallback : DEFAULT_VIEW);
}

export interface ReachableBounds { width: number; height: number; viewWidth: number; viewHeight: number; grip: number }
/** Keep a draggable grip reachable. Renderer supplies actual dimensions, all in app CSS px. */
export function clampReachable(view: ViewLayout, bounds: ReachableBounds): Result<ViewLayout> {
  if (!validView(view) || ![bounds.width, bounds.height, bounds.viewWidth, bounds.viewHeight, bounds.grip].every((n) => Number.isFinite(n) && n > 0))
    return { ok: false, error: 'Invalid geometry' };
  const out = clone(view);
  if (out.placement.kind === 'floating') {
    const gx = Math.min(bounds.grip, bounds.width, bounds.viewWidth);
    const gy = Math.min(bounds.grip, bounds.height, bounds.viewHeight);
    out.placement.x = Math.max(gx - bounds.viewWidth, Math.min(bounds.width - gx, out.placement.x));
    out.placement.y = Math.max(0, Math.min(bounds.height - gy, out.placement.y));
  }
  return { ok: true, value: out };
}

export type LayoutOperation =
  | { kind: 'place'; target: LayoutTarget; view: ViewLayout; insert?: boolean; insertLane?: boolean; participants?: readonly LayoutTarget[] }
  | { kind: 'detach'; ownerId: string; groupId: string; view: ViewLayout; insert?: boolean; insertLane?: boolean; participants?: readonly LayoutTarget[] }
  | { kind: 'close'; ownerId: string; groupId: string }
  | { kind: 'visibility'; barId: string; visible: boolean }
  | { kind: 'reset' };

/** Insert a whole dock row/column, retaining hidden and unavailable providers' relative lanes. */
function insertDockLane(layout: LayoutState, target: ViewLayout): boolean {
  if (target.placement.kind !== 'dock') return true;
  const placement = target.placement;
  const peers = [...Object.values(layout.bars), ...Object.values(layout.detached).map((view) => view.layout)]
    .filter((view) => view !== target && view.placement.kind === 'dock' && view.placement.edge === placement.edge && view.placement.lane >= placement.lane);
  if (peers.some((view) => view.placement.kind === 'dock' && view.placement.lane === Number.MAX_SAFE_INTEGER)) return false;
  for (const view of peers) if (view.placement.kind === 'dock') view.placement.lane++;
  placement.order = 0;
  return true;
}

/** Drag/drop uses insertion rank; assign the whole destination lane in one commit. */
function insertInLane(layout: LayoutState, target: ViewLayout, participants?: readonly LayoutTarget[]): void {
  const placement = target.placement;
  if (placement.kind !== 'dock') return;
  const candidates = participants === undefined
    ? [...Object.values(layout.bars), ...Object.values(layout.detached).map((view) => view.layout)]
    : participants.flatMap((peer) => {
      const view = 'barId' in peer ? ownEntry(layout.bars, peer.barId) : ownEntry(layout.detached, detachedId(peer.ownerId, peer.groupId))?.layout;
      return view ? [view] : [];
    });
  const siblings = [...new Set(candidates)]
    .filter((view) => view !== target && view.placement.kind === 'dock' && view.placement.edge === placement.edge && view.placement.lane === placement.lane)
    .sort((a, b) => (a.placement.kind === 'dock' ? a.placement.order : 0) - (b.placement.kind === 'dock' ? b.placement.order : 0));
  siblings.splice(Math.min(placement.order, siblings.length), 0, target);
  siblings.forEach((view, order) => { if (view.placement.kind === 'dock') view.placement.order = order; });
}

/** Completed operations only. Preview callers keep their own draft; cancel simply drops it. */
export function applyLayout(state: ToolbarState, operation: LayoutOperation, definitions: Definitions): Result<ToolbarState> {
  if (state.layout.locked) return { ok: false, error: 'Layout is locked' };
  const out = clone(state);
  const op = operation;
  if (op.kind === 'reset') {
    const defaults = createState(definitions).layout;
    out.layout = { ...defaults, bars: Object.fromEntries(Object.keys(state.layout.bars).map((id) => [id, clone(ownEntry(defaults.bars, id) ?? DEFAULT_VIEW)])) };
    for (const [id, view] of Object.entries(defaults.bars)) setEntry(out.layout.bars, id, clone(view));
  } else if (op.kind === 'visibility') {
    if (!Object.hasOwn(out.content.bars, op.barId)) return { ok: false, error: 'Unknown bar' };
    if (op.visible) out.layout.hidden = out.layout.hidden.filter((id) => id !== op.barId);
    else if (!out.layout.hidden.includes(op.barId)) out.layout.hidden.push(op.barId);
  } else if (op.kind === 'place') {
    if (!validView(op.view)) return { ok: false, error: 'Invalid view' };
    if ('barId' in op.target) {
      if (!Object.hasOwn(out.content.bars, op.target.barId)) return { ok: false, error: 'Unknown bar' };
      const placed = normalizeView(op.view);
      setEntry(out.layout.bars, op.target.barId, placed);
      if (op.insertLane && !insertDockLane(out.layout, placed)) return { ok: false, error: 'Lane rank overflow' };
      if (op.insert) insertInLane(out.layout, placed, op.participants);
    } else {
      const id = detachedId(op.target.ownerId, op.target.groupId);
      const view = ownEntry(out.layout.detached, id);
      if (!view) return { ok: false, error: 'Unknown detached view' };
      view.layout = normalizeView(op.view);
      if (op.insertLane && !insertDockLane(out.layout, view.layout)) return { ok: false, error: 'Lane rank overflow' };
      if (op.insert) insertInLane(out.layout, view.layout, op.participants);
    }
  } else {
    const id = detachedId(op.ownerId, op.groupId);
    if (op.kind === 'close') delete out.layout.detached[id];
    else {
      if (!validView(op.view)) return { ok: false, error: 'Invalid view' };
      if (!ownEntry(out.content.bars, op.ownerId)?.some((i) => i.kind === 'group' && i.id === op.groupId) ||
          ownEntry(out.content.groups, op.groupId)?.kind !== 'flyout') return { ok: false, error: 'Not an owner flyout' };
      // Repeated detach focuses the existing view; it must not relocate or duplicate it.
      if (!Object.hasOwn(out.layout.detached, id)) {
        const placed = normalizeView(op.view);
        setEntry(out.layout.detached, id, { ownerId: op.ownerId, groupId: op.groupId, layout: placed });
        if (op.insertLane && !insertDockLane(out.layout, placed)) return { ok: false, error: 'Lane rank overflow' };
        if (op.insert) insertInLane(out.layout, placed, op.participants);
      }
    }
  }
  return { ok: true, value: out };
}

export function setLayoutLocked(state: ToolbarState, locked: boolean): ToolbarState {
  const out = clone(state);
  out.layout.locked = locked;
  return out;
}

/** Separate content reset; layout and icon sizes remain untouched.
 * Custom bars/groups (marked by persisted labels, even when definitions carry them for
 * hosts and dialogs) survive with items/iconSizes/labels. Choices survive for custom groups. */
export function resetContent(state: ToolbarState, definitions: Definitions): ToolbarState {
  const out = clone(state);
  const fresh = createState(definitions).content;
  const next = clone(fresh);
  next.iconSizes = clone(state.content.iconSizes);
  const labels = state.content.labels ?? {};
  for (const id of Object.keys(state.content.bars)) {
    if (!Object.hasOwn(labels, id)) continue;
    const items = ownEntry(state.content.bars, id);
    if (items !== undefined) setEntry(next.bars, id, clone(items));
    const label = ownEntry(labels, id);
    if (label !== undefined) setEntry(next.labels, id, label);
  }
  for (const id of Object.keys(state.content.groups)) {
    if (!Object.hasOwn(labels, id)) continue;
    const group = ownEntry(state.content.groups, id);
    if (group !== undefined) setEntry(next.groups, id, clone(group));
    const label = ownEntry(labels, id);
    if (label !== undefined) setEntry(next.labels, id, label);
    const choice = ownEntry(state.content.choices, id);
    if (choice !== undefined) setEntry(next.choices, id, choice);
  }
  out.content = next;
  return out;
}

/** Resolve each render afresh: detached views never own a second content/selection copy. */
export function resolveDetached(state: ToolbarState, ownerId: string, groupId: string) {
  const view = ownEntry(state.layout.detached, detachedId(ownerId, groupId));
  const group = ownEntry(state.content.groups, groupId);
  if (!view || group?.kind !== 'flyout' || !ownEntry(state.content.bars, ownerId)?.some((i) => i.kind === 'group' && i.id === groupId)) return undefined;
  return clone({ ...view, items: group.items, selected: ownEntry(state.content.choices, groupId), visible: !state.layout.hidden.includes(ownerId) });
}

/** Loaded layouts retain unknown bars/groups, but canonicalize detached identity and geometry. */
export function normalizeLayout(layout: LayoutState, definitions: Definitions): LayoutState {
  const out = clone(layout);
  const defaults = createState(definitions).layout;
  out.bars = Object.fromEntries(Object.entries({ ...defaults.bars, ...out.bars }).map(([id, v]) => [id, normalizeView(v, ownEntry(defaults.bars, id))]));
  out.detached = Object.fromEntries(Object.values(out.detached).map((v) => [detachedId(v.ownerId, v.groupId), { ...v, layout: normalizeView(v.layout) }]));
  return out;
}
