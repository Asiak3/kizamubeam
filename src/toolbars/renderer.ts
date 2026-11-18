import { setIcon } from '../dom';
import { startWindowDrag } from './drag';
import type { WindowDragHandle } from './drag';
import { detachedId, ownEntry } from './model';
import type { GroupContent, Item, ToolbarState } from './model';
import type { ControlDefinition, ToolbarAction, ToolbarControl } from './registry';
import { ToolbarRegistry } from './registry';

const LONG_PRESS_MS = 350;
const TEAR_DISTANCE_PX = 3;
const FLYOUT_GAP_PX = 8;
const FLYOUT_MIN_WIDTH_PX = 250;

export interface TearRequest {
  ownerId: string;
  groupId: string;
  /** Anchor button box at tear time, app CSS px relative to the viewport. */
  rect: { left: number; top: number; right: number; bottom: number };
  /** Pointer position when the tear threshold was crossed. */
  x: number;
  y: number;
  pointerId?: number;
  onAbort?(): void;
  onCommit?(): void;
}

export interface ToolbarViewOptions {
  viewId: string;
  ownerId: string;
  /** Detached group views share the same choice callback as their source. */
  groupId?: string;
  registry: ToolbarRegistry;
  getState(): ToolbarState;
  /** Source: state.content.bars[ownerId]; detached: current group.items. */
  getItems(snapshot: ToolbarState): readonly Item[];
  /** Runtime owns persistence and refreshing sibling views. Never called by update. */
  choose?(groupId: string, actionId: string): void;
  /** Tear-off handover: return true when the system accepted and keeps driving the pointer. */
  onTearoff?(request: TearRequest): boolean | { cancel(): void };
  /** Raise an already detached group instead of opening a popup. Returns true when raised. */
  onRaise?(ownerId: string, groupId: string): boolean;
}

export type ToolbarIntent =
  | { kind: 'action'; id: string; groupId?: string }
  | { kind: 'control'; instanceId: string; intent?: unknown }
  | { kind: 'group'; id: string };

interface Entry {
  element: HTMLElement;
  update(snapshot: ToolbarState): void;
  dispose(): void;
}
interface List {
  update(items: readonly Item[], snapshot: ToolbarState): void;
  dispose(): void;
}

let nextView = 0;

// Capture before provider target handlers, including events dispatched without bubbling.
// Focus/blur are deliberately excluded: providers still need draft/cancel cleanup.
const CONTROL_MUTATION_EVENTS = [
  'click', 'dblclick', 'auxclick', 'beforeinput', 'input', 'change',
  'keydown', 'keypress', 'keyup', 'pointerdown', 'pointerup', 'mousedown', 'mouseup',
  'touchstart', 'touchend', 'paste', 'cut', 'drop', 'compositionstart',
  'compositionupdate', 'compositionend', 'submit', 'reset', 'wheel',
] as const;

/** Split legacy-style labels: explanation after ': ' is dropped, `(shortcut)` becomes kbd. */
function menuLabelParts(label: string): { name: string; shortcut?: string } {
  const name = label.split(': ')[0];
  const m = /^(.*?) \(([^()]{1,14})\)$/.exec(name);
  return m ? { name: m[1], shortcut: m[2] } : { name };
}

/** One independently owned DOM tree per view. No storage, editor or feature logic. */
export class ToolbarRenderer {
  readonly viewId: string;
  readonly ownerId: string;
  private namespace = `toolbar-view-${++nextView}`;
  private serial = 0;
  private root?: HTMLElement;
  private list?: List;
  private controls = new Map<string, { control: ToolbarControl; available(): boolean }>();
  private popup?: { groupId: string; element: HTMLElement; list: List; anchor: HTMLButtonElement; disposeTear?: () => void; close(): void };

  constructor(private options: ToolbarViewOptions) {
    this.viewId = options.viewId;
    this.ownerId = options.ownerId;
  }

  mount(host: HTMLElement): void {
    this.dispose();
    const root = host.ownerDocument.createElement('div');
    root.id = this.nextId();
    root.dataset.view = this.viewId;
    root.dataset.owner = this.ownerId;
    root.setAttribute('role', 'group');
    host.append(root);
    this.root = root;
    this.list = this.createList(root, this.options.groupId);
    this.update();
  }

  update(): void {
    if (!this.root || !this.list) return;
    const snapshot = this.options.getState();
    this.preserveFocus(() => {
      this.root!.dataset.size = ownEntry(snapshot.content.iconSizes, this.ownerId) ?? 'm';
      const detachedGroup = this.options.groupId;
      this.list!.update(detachedGroup === undefined || this.groupContent(detachedGroup, snapshot)
        ? this.options.getItems(snapshot) : [], snapshot);
      const popup = this.popup;
      if (!popup) return;
      const group = this.groupContent(popup.groupId, snapshot);
      if (group?.kind !== 'flyout' || !popup.anchor.isConnected) this.closePopup(false);
      else {
        popup.element.setAttribute('aria-label', this.options.registry.groupLabel(popup.groupId));
        popup.list.update(this.popupItems(group), snapshot);
      }
    });
  }

  activate(intent: ToolbarIntent): boolean {
    if (!this.root) return false;
    const snapshot = this.options.getState();
    if (this.options.groupId !== undefined && !this.groupContent(this.options.groupId, snapshot)) return false;
    if (intent.kind === 'control') {
      const instance = this.controls.get(intent.instanceId);
      if (!instance?.available()) return false;
      instance.control.activate(intent.intent);
      return true;
    }
    if (intent.kind === 'group') {
      const action = this.current(intent.id, this.options.getState());
      return action ? this.activate({ kind: 'action', id: action.id, groupId: intent.id }) : false;
    }
    const groupId = intent.groupId ?? this.options.groupId;
    if (groupId !== undefined) {
      const group = this.groupContent(groupId, snapshot);
      if (!group?.items.some((leaf) => this.actionFor(leaf)?.id === intent.id)) return false;
    }
    const action = this.options.registry.getAction(intent.id);
    // Recheck here, not just at paint time: predicates may have changed since update.
    if (!action || action.enabled?.() === false) return false;
    action.run();
    if (groupId !== undefined && !action.small) this.options.choose?.(groupId, action.id);
    this.closePopup(true);
    this.update();
    return true;
  }

  dispose(): void {
    this.closePopup(false);
    this.list?.dispose();
    this.list = undefined;
    this.root?.remove();
    this.root = undefined;
    this.controls.clear();
  }

  private nextId(): string { return `${this.namespace}-${++this.serial}`; }

  private actionFor(item: Item): ToolbarAction | undefined {
    return item.kind === 'action' || item.kind === 'legacy' && this.options.registry.resolveLegacy(item.id) === 'action'
      ? this.options.registry.getAction(item.id) : undefined;
  }

  private groupContent(id: string, snapshot: ToolbarState) {
    const registration = this.options.registry.getGroup(id);
    return registration && registration.enabled?.() !== false ? ownEntry(snapshot.content.groups, id) : undefined;
  }

  private current(groupId: string, snapshot: ToolbarState): ToolbarAction | undefined {
    const group = this.groupContent(groupId, snapshot);
    const actions = (group?.items ?? []).flatMap((leaf) => {
      const action = this.actionFor(leaf);
      return action && !action.small ? [action] : [];
    });
    return actions.find((action) => action.on?.())
      ?? actions.find((action) => action.id === ownEntry(snapshot.content.choices, groupId)) ?? actions[0];
  }

  private createList(host: HTMLElement, groupId?: string, available: () => boolean = () => true, mode: 'bar' | 'menu' = 'bar'): List {
    let entries = new Map<string, Entry>();
    return {
      update: (items, snapshot) => {
        const next = new Map<string, Entry>();
        const counts = new Map<string, number>();
        let cursor = host.firstChild;
        for (const item of items) {
          const base = JSON.stringify([item.kind, 'id' in item ? item.id : null]);
          const occurrence = counts.get(base) ?? 0;
          counts.set(base, occurrence + 1);
          const key = JSON.stringify([base, occurrence]);
          const entry = entries.get(key) ?? this.createEntry(item, host.ownerDocument, groupId, available, mode);
          next.set(key, entry);
          if (entry.element !== cursor) host.insertBefore(entry.element, cursor);
          cursor = entry.element.nextSibling;
          entry.update(snapshot);
        }
        for (const [key, entry] of entries) if (!next.has(key)) entry.dispose();
        entries = next;
      },
      dispose: () => {
        for (const entry of entries.values()) entry.dispose();
        entries.clear();
      },
    };
  }

  private createEntry(item: Item, doc: Document, groupId?: string, available: () => boolean = () => true, mode: 'bar' | 'menu' = 'bar'): Entry {
    const element = doc.createElement(item.kind === 'separator' ? 'div' : 'span');
    element.id = this.nextId();
    if ('id' in item) element.dataset.ref = item.id;
    if (item.kind === 'separator') {
      element.className = 'sep';
      element.setAttribute('role', 'separator');
      return { element, update() {}, dispose: () => element.remove() };
    }
    if (item.kind === 'group') return this.createGroup(item.id, element, available);
    if (item.kind === 'legacy') {
      let kind: 'action' | 'control' | 'group' | undefined;
      let child: Entry | undefined;
      return {
        element,
        update: (snapshot) => {
          const resolved = this.options.registry.resolveLegacy(item.id);
          // Groups stay flat: a legacy leaf inside a group cannot introduce nesting.
          const next = resolved === 'group' && groupId !== undefined ? undefined : resolved;
          if (kind !== next) {
            child?.dispose();
            kind = next;
            child = next ? this.createEntry({ kind: next, id: item.id }, doc, groupId,
              () => available() && this.options.registry.resolveLegacy(item.id) === next, mode) : undefined;
            if (child) element.append(child.element);
          }
          element.dataset.unresolved = String(!child);
          child?.update(snapshot);
        },
        dispose: () => { child?.dispose(); element.remove(); },
      };
    }

    let action: ToolbarAction | undefined;
    let definition: ControlDefinition | undefined;
    let control: ToolbarControl | undefined;
    let releaseControl: (() => void) | undefined;
    let button: Entry | undefined;
    const clear = () => {
      releaseControl?.();
      releaseControl = undefined;
      control?.dispose();
      this.controls.delete(element.id);
      control = undefined;
      button?.dispose();
      button = undefined;
      element.replaceChildren();
    };
    return {
      element,
      update: (snapshot) => {
        const nextAction = this.actionFor(item);
        const nextDefinition = item.kind === 'control'
          ? this.options.registry.getControl(item.id) : undefined;
        if (action !== nextAction || definition !== nextDefinition) {
          clear();
          action = nextAction;
          definition = nextDefinition;
          if (action) {
            button = mode === 'menu' && groupId !== undefined
              ? this.createMenuButton(doc, () => this.actionFor(item), groupId, available)
              : this.createActionButton(doc, () => this.actionFor(item), groupId, available);
            element.append(button.element);
          } else if (definition) {
            const ids = new Map<string, string>();
            const registeredDefinition = definition;
            let mounted = false;
            const isAvailable = () => mounted && available() &&
              this.options.registry.getControl(item.id) === registeredDefinition &&
              (groupId === undefined || !!this.groupContent(groupId, this.options.getState()));
            control = definition.create({
              viewId: this.viewId, ownerId: this.ownerId, controlId: item.id, instanceId: element.id,
              isAvailable,
              id: (name) => {
                if (!ids.has(name)) ids.set(name, this.nextId());
                return ids.get(name)!;
              },
            });
            const guard = (event: Event) => {
              if (isAvailable()) return;
              // A stale control must not suppress renderer-owned Escape cleanup.
              if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') this.closePopup(true);
              event.preventDefault();
              event.stopImmediatePropagation();
            };
            for (const type of CONTROL_MUTATION_EVENTS) element.addEventListener(type, guard, true);
            releaseControl = () => {
              mounted = false;
              for (const type of CONTROL_MUTATION_EVENTS) element.removeEventListener(type, guard, true);
            };
            mounted = true;
            this.controls.set(element.id, { control, available: isAvailable });
            control.mount(element);
          }
        }
        element.dataset.unresolved = String(!action && !definition);
        button?.update(snapshot);
        control?.update(snapshot);
      },
      dispose: () => { clear(); element.remove(); },
    };
  }

  /** Source primaries, sections, detached leaves and popup leaves use this path. */
  private createActionButton(doc: Document, resolve: (snapshot: ToolbarState) => ToolbarAction | undefined, groupId?: string, available: () => boolean = () => true, isSuppressed?: () => boolean): Entry {
    const button = doc.createElement('button');
    button.type = 'button';
    const click = () => {
      if (isSuppressed?.()) return;
      const action = resolve(this.options.getState());
      if (action && available()) this.activate({ kind: 'action', id: action.id, groupId });
      // Abgerissene Gruppe (VectorCraft): Quellknopf aktiviert weiter das Tool,
      // holt aber zusätzlich den Streifen nach vorn statt ein Flyout zu öffnen.
      if (groupId !== undefined && this.options.onRaise && this.isDetached(groupId, this.options.getState())) this.options.onRaise(this.ownerId, groupId);
    };
    button.addEventListener('click', click);
    return {
      element: button,
      update: (snapshot) => {
        const action = resolve(snapshot);
        this.paint(button, action);
        if (action) button.dataset.action = action.id;
        else delete button.dataset.action;
      },
      dispose: () => { button.removeEventListener('click', click); button.remove(); },
    };
  }

  /** Popup leaves render as menu rows (icon + name + shortcut), not compact bar buttons. */
  private createMenuButton(doc: Document, resolve: (snapshot: ToolbarState) => ToolbarAction | undefined, groupId: string, available: () => boolean = () => true): Entry {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'toolbar-menu-item';
    const check = doc.createElement('span');
    check.className = 'menu-check';
    check.setAttribute('aria-hidden', 'true');
    const icon = doc.createElement('span');
    icon.className = 'menu-icon';
    icon.setAttribute('aria-hidden', 'true');
    const label = doc.createElement('span');
    label.className = 'menu-label';
    button.append(check, icon, label);
    const click = () => {
      const action = resolve(this.options.getState());
      if (action && available()) this.activate({ kind: 'action', id: action.id, groupId });
    };
    button.addEventListener('click', click);
    return {
      element: button,
      update: (snapshot) => {
        const action = resolve(snapshot);
        const dynamic = action?.dyn?.();
        const iconName = dynamic?.icon ?? action?.icon;
        const fullLabel = dynamic?.label ?? action?.label ?? '';
        const { name, shortcut } = menuLabelParts(fullLabel);
        button.title = fullLabel;
        button.setAttribute('aria-label', fullLabel);
        button.disabled = !action || action.enabled?.() === false;
        const on = !!action?.on?.();
        button.classList.toggle('on', on);
        if (action?.on) button.setAttribute('aria-pressed', String(on));
        else button.removeAttribute('aria-pressed');
        if (iconName) {
          if (button.dataset.icon !== iconName) setIcon(icon, iconName);
          button.dataset.icon = iconName;
        } else {
          icon.replaceChildren();
          delete button.dataset.icon;
        }
        icon.toggleAttribute('hidden', !iconName);
        label.textContent = name;
        button.querySelector('kbd')?.remove();
        if (shortcut) {
          const kbd = doc.createElement('kbd');
          kbd.textContent = shortcut;
          button.append(kbd);
        }
        const marked = !!action && this.current(groupId, snapshot)?.id === action.id;
        check.textContent = marked ? '✓' : '';
        if (action) button.dataset.action = action.id;
        else delete button.dataset.action;
      },
      dispose: () => { button.removeEventListener('click', click); button.remove(); },
    };
  }

  /** The popup shows resolvable leaves only; unknown entries stay in state but render no blank rows. */
  private popupItems(group: GroupContent): readonly Item[] {
    return group.items.filter((leaf) => {
      if (leaf.kind === 'separator') return true;
      if (leaf.kind === 'action') return !!this.actionFor(leaf);
      if (leaf.kind === 'control') return !!this.options.registry.getControl(leaf.id);
      const resolved = this.options.registry.resolveLegacy(leaf.id);
      if (resolved === 'group') return false;
      if (resolved === 'action') return !!this.options.registry.getAction(leaf.id);
      if (resolved === 'control') return !!this.options.registry.getControl(leaf.id);
      return false;
    });
  }

  /** A torn-off group raises its floating strip instead of opening another popup. */
  private isDetached(groupId: string, snapshot: ToolbarState): boolean {
    return this.options.groupId === undefined &&
      ownEntry(snapshot.layout.detached, detachedId(this.ownerId, groupId)) !== undefined;
  }
  private paint(button: HTMLButtonElement, action?: ToolbarAction): void {
    const dynamic = action?.dyn?.();
    const icon = dynamic?.icon ?? action?.icon;
    const label = dynamic?.label ?? action?.label ?? '';
    button.className = `ib${icon ? '' : ' text'}${action?.small ? ' small' : ''}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.disabled = !action || action.enabled?.() === false;
    const on = !!action?.on?.();
    button.classList.toggle('on', on);
    if (action?.on) button.setAttribute('aria-pressed', String(on));
    else button.removeAttribute('aria-pressed');
    if (icon) {
      if (button.dataset.icon !== icon) setIcon(button, icon);
      button.dataset.icon = icon;
    } else {
      button.textContent = action?.short ?? label;
      delete button.dataset.icon;
    }
  }

  private createGroup(id: string, element: HTMLElement, available: () => boolean): Entry {
    const doc = element.ownerDocument;
    let list: List | undefined;
    let kind: string | undefined;
    let main: Entry | undefined;
    let arrow: HTMLButtonElement | undefined;
    let pressTimer: number | undefined;
    let pressListening = false;
    let suppressNextClick = false;
    // Abgerissene Gruppe: Quellknopf holt den Streifen nach vorn (raise/flash),
    // statt ein zweites Flyout zu öffnen.
    const open = () => {
      if (!arrow || !available()) return;
      if (this.isDetached(id, this.options.getState())) {
        if (this.options.onRaise?.(this.ownerId, id)) return;
      }
      this.togglePopup(id, arrow, available);
    };
    const cancelPress = () => {
      if (pressTimer !== undefined) { clearTimeout(pressTimer); pressTimer = undefined; }
      if (pressListening) {
        doc.removeEventListener('keydown', cancelPressKey);
        doc.defaultView?.removeEventListener('blur', cancelPress);
        pressListening = false;
      }
    };
    const cancelPressKey = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelPress(); };
    const clear = () => {
      cancelPress();
      suppressNextClick = false;
      if (this.popup?.anchor === arrow) this.closePopup(false);
      list?.dispose();
      list = undefined;
      if (main) {
        main.element.removeEventListener('pointerdown', startPress);
        main.element.removeEventListener('pointerup', cancelPress);
        main.element.removeEventListener('pointercancel', cancelPress);
        main.element.removeEventListener('pointerleave', cancelPress);
        main.element.removeEventListener('contextmenu', blockMenu);
        main.dispose();
      }
      arrow?.removeEventListener('click', open);
      arrow?.removeEventListener('contextmenu', blockMenu);
      main = undefined;
      arrow = undefined;
      element.replaceChildren();
    };
    element.dataset.action = id;
    element.setAttribute('role', 'group');
    // Long-Press wie VectorCraft (LONG_PRESS 0,35 s): Halten öffnet das Flyout,
    // Loslassen danach wählt nichts aus und schließt nichts.
    const startPress = (event: PointerEvent) => {
      if (!available() || event.button !== 0 || !event.isPrimary) return;
      suppressNextClick = false;
      if (this.popup?.anchor === arrow) return;
      cancelPress();
      doc.addEventListener('keydown', cancelPressKey);
      doc.defaultView?.addEventListener('blur', cancelPress);
      pressListening = true;
      pressTimer = window.setTimeout(() => {
        cancelPress();
        if (!available()) return;
        open();
        suppressNextClick = this.popup?.anchor === arrow;
      }, LONG_PRESS_MS);
    };
    // Touch-Long-Press darf kein Anpassungsmenü über das Flyout legen.
    const blockMenu = (event: Event) => {
      if (!available()) return;
      event.preventDefault();
      event.stopPropagation();
      cancelPress();
      if (this.popup?.anchor !== arrow) open();
    };
    return {
      element,
      update: (snapshot) => {
        const group = this.groupContent(id, snapshot);
        if (kind !== group?.kind) {
          clear();
          kind = group?.kind;
          if (kind === 'section') list = this.createList(element, id, available);
          else if (kind === 'flyout') {
            main = this.createActionButton(doc, (state) => this.current(id, state), id, available, () => {
              if (suppressNextClick) { suppressNextClick = false; return true; }
              return false;
            });
            arrow = doc.createElement('button');
            arrow.type = 'button';
            arrow.className = 'ib-more';
            arrow.textContent = '▾';
            arrow.setAttribute('aria-haspopup', 'dialog');
            arrow.addEventListener('click', open);
            arrow.addEventListener('contextmenu', blockMenu);
            // Langes Halten (wie VectorCraft, 350 ms) öffnet das Flyout, ohne den Pfeil zu treffen.
            main.element.addEventListener('pointerdown', startPress);
            main.element.addEventListener('pointerup', cancelPress);
            main.element.addEventListener('pointercancel', cancelPress);
            main.element.addEventListener('pointerleave', cancelPress);
            main.element.addEventListener('contextmenu', blockMenu);
            element.append(main.element, arrow);
          }
        }
        const label = this.options.registry.groupLabel(id);
        element.setAttribute('aria-label', label);
        element.className = kind === 'flyout' ? 'ib-group' : 'toolbar-section';
        element.dataset.unresolved = String(!group);
        if (list && group) list.update(group.items, snapshot);
        if (main && arrow) {
          const current = this.current(id, snapshot);
          main.update(snapshot);
          main.element.dataset.cur = current?.id ?? '';
          arrow.setAttribute('aria-label', label);
          arrow.setAttribute('aria-expanded', String(this.popup?.anchor === arrow));
          arrow.disabled = !group?.items.some((leaf) => this.actionFor(leaf) ||
            (leaf.kind === 'control' || leaf.kind === 'legacy' && this.options.registry.resolveLegacy(leaf.id) === 'control') && this.options.registry.getControl(leaf.id));
          if (arrow.disabled && this.popup?.anchor === arrow) this.closePopup(false);
        }
      },
      dispose: () => { clear(); element.remove(); },
    };
  }

  private togglePopup(groupId: string, anchor: HTMLButtonElement, available: () => boolean): void {
    const wasOpen = this.popup?.anchor === anchor;
    this.closePopup(false);
    if (wasOpen) { anchor.focus(); return; }
    const snapshot = this.options.getState();
    if (this.options.onRaise && this.isDetached(groupId, snapshot)) {
      this.options.onRaise(this.ownerId, groupId);
      return;
    }
    const group = this.groupContent(groupId, snapshot);
    if (group?.kind !== 'flyout') return;
    const doc = anchor.ownerDocument;
    const element = doc.createElement('div');
    element.id = this.nextId();
    element.className = 'toolbar-popup toolbar-menu';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-label', this.options.registry.groupLabel(groupId));
    element.tabIndex = -1;
    const rect = (anchor.closest('.ib-group') ?? anchor).getBoundingClientRect();
    element.style.position = 'fixed';
    doc.body.append(element);
    // Like the reference: rows beside the whole tool button; grip on the right.
    element.style.minWidth = `${Math.min(FLYOUT_MIN_WIDTH_PX, Math.max(0, doc.documentElement.clientWidth - 8))}px`;
    element.style.display = 'grid';
    element.style.gridTemplateColumns = 'minmax(0, 1fr) 24px';
    element.style.columnGap = '4px';
    // Drag beyond 3 CSS px hands the pointer to the shared layout transaction.
    // Das System übernimmt dann den Zeiger (onTearoff-Handover), das Popup schließt.
    const grip = doc.createElement('div');
    grip.className = 'toolbar-grip';
    grip.style.height = 'auto';
    grip.style.width = '24px';
    grip.style.gridColumn = '2';
    grip.style.gridRow = '1';
    grip.title = this.options.registry.groupLabel(groupId);
    grip.setAttribute('aria-hidden', 'true');
    const listHost = doc.createElement('div');
    listHost.className = 'toolbar-menu-list';
    listHost.style.gridColumn = '1';
    listHost.style.gridRow = '1';
    listHost.style.minWidth = '0';
    element.append(listHost, grip);
    const list = this.createList(listHost, groupId, available, 'menu');
    list.update(this.popupItems(group), snapshot);
    const viewport = doc.documentElement;
    const right = rect.right + FLYOUT_GAP_PX;
    const x = right + element.offsetWidth <= viewport.clientWidth ? right : rect.left - element.offsetWidth - FLYOUT_GAP_PX;
    element.style.left = `${Math.max(0, Math.min(x, viewport.clientWidth - element.offsetWidth - 4))}px`;
    element.style.top = `${Math.max(0, Math.min(rect.top - 1, viewport.clientHeight - element.offsetHeight - 4))}px`;
    const tearAt = rect;
    let torn = false;
    let tearDrag: WindowDragHandle | null = null;
    let cancelHandover: (() => void) | undefined;
    grip.addEventListener('pointerdown', (tearEvent) => {
      if (tearEvent.button !== 0 || !tearEvent.isPrimary) return;
      tearEvent.preventDefault();
      const startX = tearEvent.clientX, startY = tearEvent.clientY;
      tearDrag = startWindowDrag(doc, {
        onMove: (x, y) => {
          if (!torn && Math.hypot(x - startX, y - startY) > TEAR_DISTANCE_PX) {
            const handover = this.options.onTearoff?.({
              ownerId: this.ownerId, groupId,
              rect: { left: tearAt.left, top: tearAt.top, right: tearAt.right, bottom: tearAt.bottom },
              x, y, pointerId: tearEvent.pointerId,
              onAbort: () => {
                cancelHandover = undefined;
                torn = false;
                if (this.popup?.element === element) { element.hidden = false; element.style.display = 'grid'; element.focus(); }
              },
              onCommit: () => { cancelHandover = undefined; this.closePopup(false); },
            }) ?? false;
            torn = !!handover;
            if (torn) {
              if (typeof handover === 'object') cancelHandover = () => handover.cancel();
              tearDrag?.cancel();
              tearDrag = null;
              element.hidden = true;
              element.style.display = 'none';
            }
          }
        },
        onEnd: () => { tearDrag = null; },
        onAbort: () => { tearDrag = null; },
      }, tearEvent.pointerId);
    });
    const outside = (event: PointerEvent) => {
      if (torn) return;
      const target = event.target as Node | null;
      if (target && !element.contains(target) && !anchor.contains(target)) this.closePopup(true);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); this.closePopup(true); }
    };
    doc.addEventListener('pointerdown', outside);
    doc.addEventListener('keydown', escape);
    anchor.setAttribute('aria-expanded', 'true');
    anchor.setAttribute('aria-controls', element.id);
    this.popup = { groupId, element, list, anchor, disposeTear: () => { tearDrag?.cancel(); cancelHandover?.(); }, close: () => {
      doc.removeEventListener('pointerdown', outside);
      doc.removeEventListener('keydown', escape);
      list.dispose();
      element.remove();
      anchor.setAttribute('aria-expanded', 'false');
      anchor.removeAttribute('aria-controls');
    } };
    element.focus();
  }

  private closePopup(returnFocus: boolean): void {
    const popup = this.popup;
    this.popup = undefined;
    popup?.disposeTear?.();
    popup?.close();
    if (returnFocus && popup?.anchor.isConnected) popup.anchor.focus();
  }

  private preserveFocus(work: () => void): void {
    const doc = this.root!.ownerDocument;
    const active = doc.activeElement as HTMLElement | null;
    const owned = !!active && (this.root!.contains(active) || !!this.popup?.element.contains(active));
    const selection = owned && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
      ? [active.selectionStart, active.selectionEnd, active.selectionDirection] as const : undefined;
    work();
    if (owned && active.isConnected && doc.activeElement !== active) {
      active.focus({ preventScroll: true });
      if (selection && selection[0] !== null && selection[1] !== null)
        (active as HTMLInputElement).setSelectionRange(selection[0], selection[1], selection[2] ?? undefined);
    }
  }
}
