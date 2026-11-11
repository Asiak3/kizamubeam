import { t } from './i18n';
import { ICONS } from './icons';
import type { SlotRecipe } from './slotPlacement';

export type SlotTreeSelection = { kind: 'group' | 'slot' | 'helper'; id: string } | { kind: 'source'; id: 'source' } | null;
type Selection = NonNullable<SlotTreeSelection>;
export interface SlotTreeState {
  /** Visibility and draft keys use `${kind}:${id}`, including `source:source`. */
  hidden?: ReadonlySet<string>;
  draftIds?: ReadonlySet<string>;
}
const MIME = 'application/x-kizamubeam-slot-feature';
let nextTreeId = 0;
const key = (selection: Selection) => JSON.stringify([selection.kind, selection.id]);
const same = (a: SlotTreeSelection, b: SlotTreeSelection) => a?.kind === b?.kind && a?.id === b?.id;

/** Presentation only: all edits, including drop validation beyond identity, belong to the parent. */
export function createSlotFeatureTree(
  onSelect: (selection: Selection) => void,
  onDrop: (source: Selection, target: SlotTreeSelection, position: 'before' | 'into') => void,
  options?: { onToggleVisibility?: (selection: Selection) => void },
): { element: HTMLElement; render(recipe: SlotRecipe, selected: SlotTreeSelection, invalidIds?: ReadonlySet<string>, state?: SlotTreeState): void; dispose(): void } {
  const element = document.createElement('div');
  const treeId = ++nextTreeId;
  element.className = 'slot-feature-tree';
  element.setAttribute('role', 'tree');
  element.setAttribute('aria-label', t('Schlitzmerkmale'));
  element.style.cssText = 'overflow:auto;min-height:80px;max-height:360px;flex:1;';
  let entries = new Map<string, Selection>();
  let rows = new Map<HTMLElement, Selection>();
  let selected: SlotTreeSelection = null;
  let dragged: SlotTreeSelection = null;
  let disposed = false;
  let marked: HTMLElement | null = null;
  let mirrorIds = new Set<string>();
  const visibilityAt = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLButtonElement>('.slot-feature-visibility') : null;

  const rowAt = (target: EventTarget | null): HTMLElement | null => {
    let node = target instanceof HTMLElement ? target : null;
    while (node && node !== element) {
      if (rows.has(node)) return node;
      node = node.parentElement;
    }
    return null;
  };
  const highlight = () => {
    const active = [...rows].find(([, value]) => same(value, selected))?.[0] ?? rows.keys().next().value;
    element.tabIndex = rows.size ? -1 : 0;
    for (const [row, value] of rows) {
      const isSelected = same(value, selected);
      row.tabIndex = row === active ? 0 : -1;
      row.setAttribute('aria-selected', String(isSelected));
      row.classList.toggle('selected', isSelected);
      row.style.background = isSelected ? 'var(--accent, #3675b8)' : 'transparent';
      row.style.color = isSelected ? 'var(--on-accent, white)' : '';
    }
  };
  const select = (row: HTMLElement) => {
    const value = rows.get(row);
    if (!value) return;
    selected = value;
    highlight();
    row.focus();
    onSelect({ ...value });
  };
  const click = (event: MouseEvent) => {
    const eye = visibilityAt(event.target);
    if (eye) {
      const value = entries.get(eye.dataset.key!);
      if (value) options?.onToggleVisibility?.({ ...value });
      return;
    }
    const row = rowAt(event.target);
    if (row) select(row);
  };
  const keydown = (event: KeyboardEvent) => {
    if (visibilityAt(event.target)) return;
    const row = rowAt(event.target);
    const visible = [...rows.keys()];
    const index = row ? visible.indexOf(row) : -1;
    let next: HTMLElement | undefined;
    switch (event.key) {
      case 'ArrowDown': next = visible[Math.min(index + 1, visible.length - 1)]; break;
      case 'ArrowUp': next = visible[Math.max(index - 1, 0)]; break;
      case 'Home': next = visible[0]; break;
      case 'End': next = visible[visible.length - 1]; break;
      case 'Enter': case ' ': next = row ?? undefined; break;
      default: return;
    }
    event.preventDefault();
    if (next) select(next);
  };
  const clearDrop = () => {
    if (marked) {
      marked.classList.remove('drop-before', 'drop-into');
      marked.style.boxShadow = '';
      marked = null;
    }
  };
  const readDrag = (transfer: DataTransfer | null): SlotTreeSelection => {
    if (!transfer) return null;
    try {
      const raw: unknown = JSON.parse(transfer.getData(MIME));
      if (!raw || typeof raw !== 'object') return null;
      const value = raw as Record<string, unknown>;
      if (!['group', 'slot', 'helper'].includes(String(value.kind)) || typeof value.id !== 'string') return null;
      return entries.get(key({ kind: value.kind as 'group' | 'slot' | 'helper', id: value.id })) ?? null;
    } catch { return null; }
  };
  const destination = (event: DragEvent, source: Selection) => {
    const row = rowAt(event.target);
    const target = row ? rows.get(row)! : null;
    // The top edge remains available for reordering groups; the body accepts slots.
    const into = source.kind === 'slot' && target?.kind === 'group' &&
      !!row && event.clientY >= row.getBoundingClientRect().top + 6;
    return { row, target, position: into ? 'into' as const : 'before' as const };
  };
  const dragstart = (event: DragEvent) => {
    const row = rowAt(event.target);
    const source = row ? rows.get(row) : null;
    if (!source || source.kind === 'source' || (source.kind === 'slot' && mirrorIds.has(source.id)) || !event.dataTransfer) { event.preventDefault(); return; }
    dragged = { ...source };
    event.dataTransfer.setData(MIME, JSON.stringify(source));
    event.dataTransfer.effectAllowed = 'move';
  };
  const dragover = (event: DragEvent) => {
    // Browsers protect payload contents during dragover; only our active drag can preview.
    const source = dragged && entries.get(key(dragged));
    if (!source || !event.dataTransfer?.types.includes(MIME)) return;
    const drop = destination(event, source);
    clearDrop();
    if (same(source, drop.target) || drop.target?.kind === 'source' || (source.kind === 'slot' && mirrorIds.has(source.id))) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    marked = drop.row ?? element;
    marked.classList.add(`drop-${drop.position}`);
    marked.style.boxShadow = drop.position === 'into' ? 'inset 0 0 0 2px var(--accent, #3675b8)' : 'inset 0 2px var(--accent, #3675b8)';
  };
  const drop = (event: DragEvent) => {
    clearDrop();
    const source = readDrag(event.dataTransfer);
    dragged = null;
    if (!source) return;
    event.preventDefault();
    const target = destination(event, source);
    if (!same(source, target.target) && target.target?.kind !== 'source' && !(source.kind === 'slot' && mirrorIds.has(source.id))) onDrop({ ...source }, target.target ? { ...target.target } : null, target.position);
  };
  const dragend = () => { dragged = null; clearDrop(); };
  const dragleave = (event: DragEvent) => {
    if (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget)) clearDrop();
  };
  element.addEventListener('click', click);
  element.addEventListener('keydown', keydown);
  element.addEventListener('dragstart', dragstart);
  element.addEventListener('dragover', dragover);
  element.addEventListener('drop', drop);
  element.addEventListener('dragend', dragend);
  element.addEventListener('dragleave', dragleave);

  return {
    element,
    render(recipe, selection, invalidIds = new Set(), state) {
      if (disposed) return;
      const focused = rowAt(document.activeElement);
      const previousFocus = focused ? rows.get(focused) : null;
      const hadFocus = element.contains(document.activeElement);
      const focusedEye = visibilityAt(document.activeElement)?.dataset.key;
      const scrollTop = element.scrollTop;
      clearDrop();
      selected = selection;
      entries = new Map(); rows = new Map();
      const labels = new Map<string, string>();
      const groups = recipe.groups ?? [];
      const helpers = recipe.helpers ?? [];
      // Only the identity is needed here; geometry and validation belong to the engine.
      const mirrorParents = new Map<string, string>();
      for (const slot of recipe.slots) {
        const mirror = slot.mirror;
        if (slot.id && mirror) mirrorParents.set(slot.id, mirror.slotId);
      }
      mirrorIds = new Set(mirrorParents.keys());
      const add = (value: Selection, label: string) => {
        entries.set(key(value), value); labels.set(key(value), label);
      };
      for (const group of groups) add({ kind: 'group', id: group.id }, group.name || group.id);
      for (const slot of recipe.slots) if (slot.id) add({ kind: 'slot', id: slot.id }, mirrorIds.has(slot.id) ? t('Spiegelung {id}', { id: slot.id }) : t('Schlitz {id}', { id: slot.id }));
      for (const helper of helpers) add({ kind: 'helper', id: helper.id }, helper.name || helper.id);
      const ordered: Selection[] = [];
      const seen = new Set<string>();
      for (const value of [...(recipe.order ?? []), ...entries.values()]) {
        const id = key(value);
        if (entries.has(id) && !seen.has(id)) { ordered.push(entries.get(id)!); seen.add(id); }
      }
      const makeRow = (value: Selection, level: number) => {
        const row = document.createElement('button');
        row.type = 'button'; row.draggable = value.kind !== 'source' && !(value.kind === 'slot' && mirrorIds.has(value.id));
        row.className = 'slot-feature-row';
        row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(level));
        row.dataset.kind = value.kind; row.dataset.id = value.id;
        row.textContent = labels.get(key(value))!;
        const scopedKey = `${value.kind}:${value.id}`;
        if (state?.draftIds?.has(scopedKey)) {
          row.dataset.draft = 'true';
          const badge = document.createElement('span');
          badge.className = 'slot-feature-draft'; badge.textContent = ` · ${t('Entwurf')}`;
          row.append(badge);
        }
        row.dataset.hidden = String(state?.hidden?.has(scopedKey) ?? false);
        row.classList.toggle('hidden-feature', state?.hidden?.has(scopedKey) ?? false);
        row.title = value.id;
        row.style.cssText = 'display:block;width:100%;text-align:left;white-space:nowrap;padding:6px 8px;border:0;border-radius:2px;cursor:pointer;';
        if (invalidIds.has(value.id)) {
          row.classList.add('invalid'); row.setAttribute('aria-invalid', 'true');
          row.style.textDecoration = 'underline wavy var(--danger, #d44)';
        }
        rows.set(row, value);
        return row;
      };
      const withVisibility = (row: HTMLButtonElement, value: Selection) => {
        if (!options?.onToggleVisibility) return row;
        const wrapper = document.createElement('div');
        wrapper.setAttribute('role', 'none'); wrapper.style.cssText = 'display:flex;align-items:center;';
        row.style.flex = '1'; row.style.minWidth = '0';
        const eye = document.createElement('button');
        eye.type = 'button'; eye.className = 'slot-feature-visibility'; eye.dataset.key = key(value);
        const hidden = state?.hidden?.has(`${value.kind}:${value.id}`) ?? false;
        eye.title = hidden ? t('Einblenden') : t('Ausblenden');
        eye.setAttribute('aria-label', `${eye.title}: ${labels.get(key(value))}`);
        eye.setAttribute('aria-pressed', String(!hidden));
        eye.innerHTML = hidden ? ICONS.eyeoff : ICONS.eye;
        eye.style.cssText = 'flex:none;width:28px;height:28px;padding:4px;border:0;background:transparent;color:inherit;cursor:pointer;';
        wrapper.append(row, eye);
        return wrapper;
      };
      const fragment = document.createDocumentFragment();
      const groupIds = new Set(groups.map(group => group.id));
      const slotsById = new Map(recipe.slots.map(slot => [slot.id, slot]));
      const hasMirrorParent = (id: string) => mirrorParents.has(id) && slotsById.has(mirrorParents.get(id));
      const rendered = new Set<string>();
      const appendBranch = (parent: HTMLElement | DocumentFragment, value: Selection, level: number) => {
        if (rendered.has(key(value))) return;
        rendered.add(key(value));
        const row = makeRow(value, level);
        const childrenValues = ordered.filter(child => child.kind === 'slot' && (
          value.kind === 'group'
            ? slotsById.get(child.id)?.groupId === value.id && !hasMirrorParent(child.id)
            : value.kind === 'slot' && mirrorParents.get(child.id) === value.id
        ) && !rendered.has(key(child)));
        if (!childrenValues.length) { parent.append(withVisibility(row, value)); return; }
        row.setAttribute('aria-expanded', 'true');
        const branch = document.createElement('div'); branch.setAttribute('role', 'none');
        branch.append(withVisibility(row, value));
        const children = document.createElement('div');
        children.id = `slot-feature-tree-${treeId}-group-${rows.size}`;
        children.setAttribute('role', 'group'); children.setAttribute('aria-label', labels.get(key(value))!);
        children.style.paddingLeft = '16px';
        row.setAttribute('aria-owns', children.id);
        for (const child of childrenValues) appendBranch(children, child, level + 1);
        branch.append(children); parent.append(branch);
      };
      if (state) {
        const source = { kind: 'source', id: 'source' } as const;
        add(source, t('Grundkörper')); appendBranch(fragment, source, 1);
      }
      for (const value of ordered) {
        if (value.kind === 'helper') continue;
        if (value.kind === 'slot' && hasMirrorParent(value.id)) continue;
        if (value.kind === 'slot' && groupIds.has(slotsById.get(value.id)?.groupId ?? '')) continue;
        appendBranch(fragment, value, 1);
      }
      // Malformed mirror cycles still appear exactly once instead of disappearing or recursing forever.
      for (const value of ordered) if (value.kind === 'slot') appendBranch(fragment, value, 1);
      if (helpers.length) {
        const section = document.createElement('div');
        section.setAttribute('role', 'group'); section.setAttribute('aria-label', t('Konstruktionshilfen'));
        const heading = document.createElement('div');
        heading.setAttribute('role', 'presentation'); heading.textContent = t('Konstruktionshilfen');
        heading.style.cssText = 'padding:8px;font-weight:bold;';
        section.append(heading);
        for (const value of ordered) if (value.kind === 'helper') section.append(withVisibility(makeRow(value, 1), value));
        fragment.append(section);
      }
      element.replaceChildren(fragment);
      highlight();
      if (hadFocus) {
        const eye = [...element.querySelectorAll<HTMLButtonElement>('.slot-feature-visibility')].find(button => button.dataset.key === focusedEye);
        const next = [...rows].find(([, value]) => same(value, selected))?.[0] ??
          [...rows].find(([, value]) => same(value, previousFocus ?? null))?.[0] ?? rows.keys().next().value;
        (eye ?? next ?? element).focus({ preventScroll: true });
      }
      element.scrollTop = scrollTop;
    },
    dispose() {
      disposed = true; dragend();
      element.removeEventListener('click', click);
      element.removeEventListener('keydown', keydown);
      element.removeEventListener('dragstart', dragstart);
      element.removeEventListener('dragover', dragover);
      element.removeEventListener('drop', drop);
      element.removeEventListener('dragend', dragend);
      element.removeEventListener('dragleave', dragleave);
      rows.clear(); entries.clear();
    },
  };
}
