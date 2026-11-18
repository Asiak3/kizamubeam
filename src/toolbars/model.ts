/** DOM-free toolbar model. IDs are durable references, not runtime registrations. */
export type IconSize = 's' | 'm' | 'l';
export type DockEdge = 'top' | 'right' | 'bottom' | 'left';
export type LayoutTarget = { barId: string } | { ownerId: string; groupId: string };
/** Legacy refs remain unresolved until a renderer has an action/group registry. */
export type Leaf = { kind: 'action' | 'control' | 'legacy'; id: string } | { kind: 'separator' };
export type Item = Leaf | { kind: 'group'; id: string };
/** Groups contain leaves only: sections are visible; flyouts may have a detached view. */
export interface GroupContent { kind: 'section' | 'flyout'; items: Leaf[] }
export interface GroupDefinition extends GroupContent { id: string; label: string }
export type Placement =
  | { kind: 'dock'; edge: DockEdge; lane: number; order: number }
  | { kind: 'floating'; x: number; y: number };
export interface ViewLayout {
  placement: Placement;
  orientation: 'horizontal' | 'vertical';
  rows: number;
  columns: number;
}
export interface BarDefinition {
  id: string;
  label: string;
  items: Item[];
  layout: ViewLayout;
  iconSize?: IconSize;
  visible?: boolean;
}
export interface Definitions { bars: BarDefinition[]; groups: GroupDefinition[] }
export interface ContentState {
  bars: Record<string, Item[]>;
  groups: Record<string, GroupContent>;
  /** Shared by the source button and all views, including absent plugin groups/actions. */
  choices: Record<string, string>;
  iconSizes: Record<string, IconSize>;
  /** Custom bar ID -> display name. Built-in bars use their definition label. */
  labels: Record<string, string>;
}
export interface DetachedView { ownerId: string; groupId: string; layout: ViewLayout }
export interface LayoutState {
  locked: boolean;
  bars: Record<string, ViewLayout>;
  /** Includes visibility-only legacy bars, and unknown IDs. */
  hidden: string[];
  detached: Record<string, DetachedView>;
}
export interface ToolbarState { content: ContentState; layout: LayoutState }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const DEFAULT_ICON_SIZE: IconSize = 'm';
export const DEFAULT_VISIBLE = true;
export const DEFAULT_LAYOUT_LOCKED = false;
/** Dock lane/order are zero-based; rows/columns are positive counts. Positions use app CSS px. */
export const DEFAULT_VIEW: ViewLayout = {
  placement: { kind: 'dock', edge: 'top', lane: 0, order: 0 },
  orientation: 'horizontal', rows: 1, columns: 1,
};
export const clone = <T>(value: T): T => structuredClone(value);
/** Dock edges determine orientation; floating views retain their last orientation. */
export function orientToDock(view: ViewLayout): ViewLayout {
  const out = clone(view);
  if (out.placement.kind === 'dock')
    out.orientation = out.placement.edge === 'left' || out.placement.edge === 'right' ? 'vertical' : 'horizontal';
  return out;
}
/** Opaque IDs may name Object.prototype members; never read inherited entries or invoke setters. */
export const ownEntry = <T>(entries: Record<string, T>, id: string): T | undefined => Object.hasOwn(entries, id) ? entries[id] : undefined;
export function setEntry<T>(entries: Record<string, T>, id: string, value: T): void {
  Object.defineProperty(entries, id, { value, enumerable: true, writable: true, configurable: true });
}
export const detachedId = (ownerId: string, groupId: string): string => JSON.stringify([ownerId, groupId]);

export function createState(definitions: Definitions): ToolbarState {
  return {
    content: {
      bars: Object.fromEntries(definitions.bars.map((b) => [b.id, clone(b.items)])),
      groups: Object.fromEntries(definitions.groups.map((g) => [g.id, { kind: g.kind, items: clone(g.items) }])),
      choices: {},
      iconSizes: Object.fromEntries(definitions.bars.map((b) => [b.id, b.iconSize ?? DEFAULT_ICON_SIZE])),
      labels: {},
    },
    layout: {
      locked: DEFAULT_LAYOUT_LOCKED,
      bars: Object.fromEntries(definitions.bars.map((b) => [b.id, orientToDock(b.layout)])),
      hidden: definitions.bars.filter((b) => !(b.visible ?? DEFAULT_VISIBLE)).map((b) => b.id),
      detached: {},
    },
  };
}
