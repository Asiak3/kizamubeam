import type { Definitions, ToolbarState } from './model';

/** Structural subset of the legacy Action; no import of its runtime module.
 *  Button-Gesicht ist Pflicht (Symbol oder Kurztext), wie in der Legacy-Action. */
interface ToolbarActionBase {
  id: string;
  label: string;
  small?: boolean;
  run: () => void;
  enabled?: () => boolean;
  on?: () => boolean;
  dyn?: () => { icon?: string; label?: string };
  /** Current keyboard shortcut for the tooltip and menu rows */
  shortcut?: () => string;
}

export type ToolbarAction = ToolbarActionBase & ({ icon: string; short?: string } | { icon?: string; short: string });

export interface ControlContext {
  viewId: string;
  ownerId: string;
  controlId: string;
  instanceId: string;
  /** Recheck immediately before delayed feature writes; false after disposal/replacement. */
  isAvailable(): boolean;
  /** Stable within this instance; never derived from a selector or persisted ID. */
  id: (name: string) => string;
}

export interface ToolbarControl {
  mount(host: HTMLElement): void;
  /** Controls own draft policy: do not overwrite an uncommitted edit here. */
  update(snapshot: ToolbarState): void;
  activate(intent?: unknown): void;
  dispose(): void;
}

export interface ControlDefinition {
  id: string;
  label: string;
  create(context: ControlContext): ToolbarControl;
}

export interface GroupRegistration {
  id: string;
  label: string;
  /** Optional runtime availability; retained content is never registration. */
  enabled?: () => boolean;
}

/** Registration is inert. Consumers explicitly update mounted views after changes. */
export class ToolbarRegistry {
  private actions = new Map<string, ToolbarAction>();
  private controls = new Map<string, ControlDefinition>();
  private groups = new Map<string, GroupRegistration>();

  constructor(definitions?: Pick<Definitions, 'groups'>) {
    for (const group of definitions?.groups ?? []) this.registerGroup(group);
  }

  registerAction(action: ToolbarAction): void { this.actions.set(action.id, action); }
  unregisterAction(id: string): void { this.actions.delete(id); }
  getAction(id: string): ToolbarAction | undefined { return this.actions.get(id); }
  registerControl(control: ControlDefinition): void { this.controls.set(control.id, control); }
  unregisterControl(id: string): void { this.controls.delete(id); }
  getControl(id: string): ControlDefinition | undefined { return this.controls.get(id); }
  registerGroup(group: GroupRegistration): void { this.groups.set(group.id, group); }
  unregisterGroup(id: string): void { this.groups.delete(id); }
  getGroup(id: string): GroupRegistration | undefined { return this.groups.get(id); }
  groupLabel(id: string): string { return this.groups.get(id)?.label ?? id; }

  /** Legacy has no declared kind: exactly one registration resolves; collisions stay inert. */
  resolveLegacy(id: string): 'action' | 'control' | 'group' | undefined {
    const kinds = [this.actions.has(id) ? 'action' : undefined,
      this.controls.has(id) ? 'control' : undefined, this.groups.has(id) ? 'group' : undefined] as const;
    const found = kinds.filter((kind) => kind !== undefined);
    return found.length === 1 ? found[0] : undefined;
  }
}
