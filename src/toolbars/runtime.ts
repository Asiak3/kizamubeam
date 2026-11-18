import { clone, createState, DEFAULT_ICON_SIZE, DEFAULT_VIEW, ownEntry, setEntry } from './model';
import type { Definitions, GroupContent, IconSize, Item, Leaf, Result, ToolbarState, ViewLayout } from './model';
import { decode, encode } from './migration';
import type { DecodeOptions } from './migration';
import { applyLayout, resetContent, setLayoutLocked, validView, normalizeView } from './state';
import type { LayoutOperation } from './state';

export const TOOLBAR_STORAGE_KEY = 'kizamubeam.toolbars';
export interface ToolbarStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface Commit { changed: boolean; persisted: boolean }
export interface RuntimeOptions extends DecodeOptions {
  storage?: ToolbarStorage;
  /** Rendering errors must not undo a completed operation or prevent other views updating. */
  reportListenerError?: (error: unknown) => void;
}

/** Explicitly constructed owner; no DOM, global storage access or automatic migration write. */
export function createToolbarRuntime(definitions: Definitions, options: RuntimeOptions = {}) {
  const defaults = clone(definitions);
  let current = createState(defaults);
  let blocked: string | undefined;
  let storageError: string | undefined;
  const listeners = new Set<() => void>();
  try {
    const raw = options.storage?.getItem(TOOLBAR_STORAGE_KEY);
    if (raw != null) {
      const loaded = decode(raw, defaults, options);
      if (loaded.ok) current = loaded.value.state;
      else blocked = loaded.error;
    }
  } catch {
    // A failed read must never permit a later write to overwrite unexamined data.
    blocked = 'Toolbar storage could not be read';
  }

  function notify() {
    for (const listener of [...listeners]) {
      try { listener(); }
      catch (error) {
        try { (options.reportListenerError ?? console.error)(error); }
        catch { /* An external reporter must not interrupt the remaining views either. */ }
      }
    }
  }

  function commit(next: ToolbarState): Result<Commit> {
    const encoded = encode(next);
    if (!encoded.ok) return encoded;
    const before = encode(current);
    if (before.ok && encoded.value === before.value) return { ok: true, value: { changed: false, persisted: false } };
    // Keep runtime edits usable even when storage is blocked or unavailable.
    current = clone(next);
    let persisted = false;
    if (options.storage && !blocked) {
      try {
        options.storage.setItem(TOOLBAR_STORAGE_KEY, encoded.value);
        storageError = undefined;
        persisted = true;
      } catch { storageError = 'Toolbar storage could not be written'; }
    }
    notify();
    return { ok: true, value: { changed: true, persisted } };
  }

  return {
    /** Each consumer receives its own snapshot, never the mutable source of truth. */
    read: (): ToolbarState => clone(current),
    persistence: () => ({ writable: !!options.storage && !blocked, blocked, storageError }),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    layout(operation: LayoutOperation): Result<Commit> {
      const result = applyLayout(current, operation, defaults);
      return result.ok ? commit(result.value) : result;
    },
    lock(locked: boolean): Result<Commit> { return commit(setLayoutLocked(current, locked)); },
    choose(groupId: string, actionId: string): Result<Commit> {
      const group = ownEntry(current.content.groups, groupId);
      if (!group?.items.some((item) => (item.kind === 'action' || item.kind === 'legacy') && item.id === actionId))
        return { ok: false, error: 'Unknown group action' };
      const next = clone(current);
      setEntry(next.content.choices, groupId, actionId);
      return commit(next);
    },
    setBarItems(barId: string, items: Item[]): Result<Commit> {
      if (!Object.hasOwn(current.content.bars, barId)) return { ok: false, error: 'Unknown bar' };
      const next = clone(current);
      setEntry(next.content.bars, barId, clone(items));
      return commit(next);
    },
    setGroupItems(groupId: string, group: GroupContent): Result<Commit> {
      if (!Object.hasOwn(current.content.groups, groupId)) return { ok: false, error: 'Unknown group' };
      const next = clone(current);
      setEntry(next.content.groups, groupId, clone(group));
      return commit(next);
    },
    setIconSize(barId: string, size: IconSize): Result<Commit> {
      if (!Object.hasOwn(current.content.bars, barId)) return { ok: false, error: 'Unknown bar' };
      if (!['s', 'm', 'l'].includes(size)) return { ok: false, error: 'Invalid icon size' };
      const next = clone(current);
      setEntry(next.content.iconSizes, barId, size);
      return commit(next);
    },
    addBar(input: { id: string; label: string; items?: Item[]; layout?: ViewLayout; iconSize?: IconSize }): Result<Commit> {
      if (typeof input.id !== 'string' || input.id.length < 1 || input.id.length > 64)
        return { ok: false, error: 'Invalid bar id' };
      if (Object.hasOwn(current.content.bars, input.id) || defaults.bars.some((b) => b.id === input.id))
        return { ok: false, error: 'Bar already exists' };
      if (typeof input.label !== 'string' || input.label.trim().length < 1 || input.label.trim().length > 40)
        return { ok: false, error: 'Invalid bar label' };
      if (input.layout !== undefined && !validView(input.layout)) return { ok: false, error: 'Invalid view' };
      if (input.iconSize !== undefined && !['s', 'm', 'l'].includes(input.iconSize))
        return { ok: false, error: 'Invalid icon size' };
      const next = clone(current);
      setEntry(next.content.bars, input.id, clone(input.items ?? []));
      setEntry(next.content.iconSizes, input.id, input.iconSize ?? DEFAULT_ICON_SIZE);
      setEntry(next.content.labels, input.id, input.label.trim());
      setEntry(next.layout.bars, input.id, normalizeView(input.layout ?? DEFAULT_VIEW));
      return commit(next);
    },
    removeBar(barId: string): Result<Commit> {
      if (!Object.hasOwn(current.content.bars, barId)) return { ok: false, error: 'Unknown bar' };
      // Custom bars are re-attached to definitions by the host facade, so the
      // persisted labels (not the supplied definitions) decide what is built-in.
      if (!Object.hasOwn(current.content.labels ?? {}, barId)) return { ok: false, error: 'Built-in bar' };
      const next = clone(current);
      delete next.content.bars[barId];
      delete next.content.iconSizes[barId];
      if (Object.hasOwn(next.content.labels, barId)) delete next.content.labels[barId];
      if (Object.hasOwn(next.layout.bars, barId)) delete next.layout.bars[barId];
      next.layout.hidden = next.layout.hidden.filter((id) => id !== barId);
      for (const id of Object.keys(next.layout.detached))
        if (ownEntry(next.layout.detached, id)?.ownerId === barId) delete next.layout.detached[id];
      return commit(next);
    },
    setBarLabel(barId: string, label: string): Result<Commit> {
      if (!Object.hasOwn(current.content.bars, barId)) return { ok: false, error: 'Unknown bar' };
      // See removeBar: labels mark custom bars even when definitions carry them.
      if (!Object.hasOwn(current.content.labels ?? {}, barId)) return { ok: false, error: 'Built-in bar' };
      if (typeof label !== 'string' || label.trim().length < 1 || label.trim().length > 40)
        return { ok: false, error: 'Invalid bar label' };
      const next = clone(current);
      setEntry(next.content.labels, barId, label.trim());
      return commit(next);
    },
    addGroup(input: { id: string; label: string; items?: Leaf[] }): Result<Commit> {
      if (typeof input.id !== 'string' || input.id.length < 1 || input.id.length > 64)
        return { ok: false, error: 'Invalid group id' };
      if (Object.hasOwn(current.content.groups, input.id) || defaults.groups.some((g) => g.id === input.id))
        return { ok: false, error: 'Group already exists' };
      if (typeof input.label !== 'string' || input.label.trim().length < 1 || input.label.trim().length > 40)
        return { ok: false, error: 'Invalid group label' };
      const next = clone(current);
      setEntry(next.content.groups, input.id, { kind: 'flyout', items: clone(input.items ?? []) });
      setEntry(next.content.labels, input.id, input.label.trim());
      return commit(next);
    },
    removeGroup(groupId: string): Result<Commit> {
      if (!Object.hasOwn(current.content.groups, groupId)) return { ok: false, error: 'Unknown group' };
      // Code groups carry no labels; persisted labels mark custom groups even when definitions carry them.
      if (!Object.hasOwn(current.content.labels ?? {}, groupId)) return { ok: false, error: 'Built-in group' };
      const next = clone(current);
      delete next.content.groups[groupId];
      if (Object.hasOwn(next.content.labels, groupId)) delete next.content.labels[groupId];
      for (const barId of Object.keys(next.content.bars))
        setEntry(next.content.bars, barId, (ownEntry(next.content.bars, barId) ?? []).filter((i) => !(i.kind === 'group' && i.id === groupId)));
      for (const id of Object.keys(next.layout.detached))
        if (ownEntry(next.layout.detached, id)?.groupId === groupId) delete next.layout.detached[id];
      if (Object.hasOwn(next.content.choices, groupId)) delete next.content.choices[groupId];
      return commit(next);
    },
    setGroupLabel(groupId: string, label: string): Result<Commit> {
      if (!Object.hasOwn(current.content.groups, groupId)) return { ok: false, error: 'Unknown group' };
      // See removeGroup: labels mark custom groups even when definitions carry them.
      if (!Object.hasOwn(current.content.labels ?? {}, groupId)) return { ok: false, error: 'Built-in group' };
      if (typeof label !== 'string' || label.trim().length < 1 || label.trim().length > 40)
        return { ok: false, error: 'Invalid group label' };
      const next = clone(current);
      setEntry(next.content.labels, groupId, label.trim());
      return commit(next);
    },
    resetBarContent(barId: string): Result<Commit> {
      const definition = defaults.bars.find((bar) => bar.id === barId);
      if (!definition || !Object.hasOwn(current.content.bars, barId)) return { ok: false, error: 'Unknown bar' };
      const next = clone(current);
      setEntry(next.content.bars, barId, clone(definition.items));
      for (const item of definition.items) {
        if (item.kind !== 'group') continue;
        const group = defaults.groups.find((candidate) => candidate.id === item.id);
        if (!group || Object.hasOwn(current.content.labels, group.id)) continue;
        setEntry(next.content.groups, group.id, { kind: group.kind, items: clone(group.items) });
        delete next.content.choices[group.id];
      }
      return commit(next);
    },
    resetContent: (): Result<Commit> => commit(resetContent(current, defaults)),
  };
}
export type ToolbarRuntime = ReturnType<typeof createToolbarRuntime>;
