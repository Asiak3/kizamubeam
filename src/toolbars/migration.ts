import { clone, createState, DEFAULT_ICON_SIZE, DEFAULT_VIEW, setEntry } from './model';
import type { Definitions, Item, Result, ToolbarState } from './model';
import { normalizeLayout } from './state';

export const FORMAT = 'toolbar-layout';
export const VERSION = 1;
export const LEGACY_VERSION = 14;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const mapOf = (v: unknown, check: (x: unknown) => boolean): boolean => record(v) && Object.values(v).every(check);
const size = (v: unknown): boolean => v === 's' || v === 'm' || v === 'l';
const leaf = (v: unknown): boolean => record(v) && (v.kind === 'separator' ||
  (['action', 'control', 'legacy'].includes(v.kind as string) && typeof v.id === 'string'));
const items = (v: unknown): boolean => Array.isArray(v) && v.every((i) => leaf(i) || (record(i) && i.kind === 'group' && typeof i.id === 'string'));
const group = (v: unknown): boolean => record(v) && (v.kind === 'section' || v.kind === 'flyout') && Array.isArray(v.items) && v.items.every(leaf);

function validState(v: unknown): v is ToolbarState {
  if (!record(v) || !record(v.content) || !record(v.layout)) return false;
  const c = v.content, l = v.layout;
  return mapOf(c.bars, items) && mapOf(c.groups, group) && mapOf(c.choices, (x) => typeof x === 'string') &&
    mapOf(c.iconSizes, size) && (!('labels' in c) || mapOf((c as { labels?: unknown }).labels, (x) => typeof x === 'string')) &&
    typeof l.locked === 'boolean' && strings(l.hidden) && record(l.bars) &&
    mapOf(l.detached, (x) => record(x) && typeof x.ownerId === 'string' && typeof x.groupId === 'string');
}

function normalizeState(state: ToolbarState, definitions: Definitions): ToolbarState {
  const defaults = createState(definitions);
  const out = clone(state);
  for (const id of defaults.layout.hidden)
    if (!Object.hasOwn(state.content.bars, id) && !out.layout.hidden.includes(id)) out.layout.hidden.push(id);
  out.content.bars = { ...defaults.content.bars, ...out.content.bars };
  out.content.groups = { ...defaults.content.groups, ...out.content.groups };
  out.content.iconSizes = { ...defaults.content.iconSizes, ...out.content.iconSizes };
  out.content.labels = { ...defaults.content.labels, ...(out.content.labels ?? {}) };
  for (const id of Object.keys(out.content.labels))
    if (!Object.hasOwn(out.content.bars, id) && !Object.hasOwn(out.content.groups, id)) delete out.content.labels[id];
  out.layout = normalizeLayout(out.layout, definitions);
  for (const id of Object.keys(out.content.bars))
    if (!Object.hasOwn(out.layout.bars, id)) setEntry(out.layout.bars, id, clone(DEFAULT_VIEW));
  return out;
}

export interface Decoded { state: ToolbarState; source: 'native' | 'legacy-v14' }
/** Legacy normalization (including optional old fields) can be injected without DOM dependencies.
 * Versions <14 and unversioned legacy bars require the complete upgrader. No lossy fallback. */
export interface DecodeOptions { upgradeLegacy?: (raw: unknown) => unknown }

/** Errors deliberately return no default state to accidentally save over invalid/future data. */
export function decode(raw: string, definitions: Definitions, options: DecodeOptions = {}): Result<Decoded> {
  try {
    let value: unknown = JSON.parse(raw);
    if (!record(value)) return { ok: false, error: 'Invalid toolbar data' };
    if ('format' in value) {
      if (value.format !== FORMAT || value.version !== VERSION) return { ok: false, error: 'Unsupported toolbar format/version; retain original storage' };
      if (!validState(value.state)) return { ok: false, error: 'Invalid toolbar state' };
      // Reject ambiguous duplicate identities instead of silently choosing a position.
      const identities = Object.values(value.state.layout.detached).map((v) => JSON.stringify([v.ownerId, v.groupId]));
      if (new Set(identities).size !== identities.length) return { ok: false, error: 'Duplicate detached identity' };
      return { ok: true, value: { state: normalizeState(value.state, definitions), source: 'native' } };
    }
    if (value.v !== undefined && (typeof value.v !== 'number' || !Number.isInteger(value.v) || value.v < 1 || value.v > LEGACY_VERSION))
      return { ok: false, error: 'Unsupported legacy version; retain original storage' };
    if (options.upgradeLegacy) value = options.upgradeLegacy(clone(value));
    else if (value.v === undefined || (value.v as number) < LEGACY_VERSION)
      return { ok: false, error: 'Older legacy version requires injected upgrader' };
    if (!record(value) || value.v !== LEGACY_VERSION || !mapOf(value.bars, strings) || !mapOf(value.size, size) ||
        !strings(value.hidden) || !mapOf(value.groups, (x) => typeof x === 'string'))
      return { ok: false, error: 'Invalid legacy v14 payload' };
    const state = createState(definitions);
    const bars = value.bars as Record<string, string[]>;
    const legacyItems = (list: string[]): Item[] => list.map((id) => id === '|' ? { kind: 'separator' } :
      { kind: Object.hasOwn(state.content.groups, id) ? 'group' : 'legacy', id });
    state.content.bars = { ...state.content.bars, ...Object.fromEntries(Object.entries(bars).map(([id, list]) => [id, legacyItems(list)])) };
    state.content.iconSizes = { ...state.content.iconSizes, ...value.size as ToolbarState['content']['iconSizes'] };
    for (const id of Object.keys(bars))
      if (!Object.hasOwn(state.content.iconSizes, id)) setEntry(state.content.iconSizes, id, DEFAULT_ICON_SIZE);
    state.content.choices = clone(value.groups as Record<string, string>);
    state.layout.hidden = [...value.hidden];
    // Legacy placement was fixed by the DOM; supplied definitions must carry those defaults.
    state.layout = normalizeLayout(state.layout, definitions);
    return { ok: true, value: { state: normalizeState(state, definitions), source: 'legacy-v14' } };
  } catch {
    return { ok: false, error: 'Invalid toolbar JSON or legacy upgrader failure' };
  }
}

/** No storage access and no normalization writes. Call only after completed operations. */
export function encode(state: ToolbarState): Result<string> {
  try {
    if (!validState(state)) return { ok: false, error: 'Invalid toolbar state' };
    // Encode must not silently turn NaN/Infinity into null.
    const normalized = normalizeLayout(state.layout, { bars: [], groups: [] });
    if (JSON.stringify(normalized) !== JSON.stringify(state.layout)) return { ok: false, error: 'Non-canonical toolbar layout' };
    return { ok: true, value: JSON.stringify({ format: FORMAT, version: VERSION, state }) };
  } catch {
    return { ok: false, error: 'Toolbar state is not serializable' };
  }
}
