import { createToolbarDocking } from './docking';
import { t } from '../i18n';
import { detachedId, ownEntry } from './model';
import type { Definitions, ViewLayout } from './model';
import { ToolbarRegistry } from './registry';
import type { ControlDefinition, ToolbarAction } from './registry';
import { ToolbarRenderer } from './renderer';
import { resolveDetached } from './state';
import { createToolbarRuntime } from './runtime';
import type { RuntimeOptions } from './runtime';

export interface ToolbarHost {
  element: HTMLElement;
  ownerId: string;
  groupId?: string;
}
export interface ToolbarSystemOptions extends RuntimeOptions {
  definitions: Definitions;
  actions: readonly ToolbarAction[];
  controls?: readonly ControlDefinition[];
  /** Keys identify views, not bars. Multiple views can share one owner/group. */
  hosts: ReadonlyMap<string, ToolbarHost>;
  /** Existing palette/status DOM stays outside the renderer. */
  visibilityHosts?: ReadonlyMap<string, HTMLElement>;
}

/** One state owner and one subscription for every mounted view. No editor dependencies. */
export function initToolbarFramework(options: ToolbarSystemOptions) {
  const registry = new ToolbarRegistry(options.definitions);
  for (const action of options.actions) registry.registerAction({ ...action, run() {
    if (disposed) return;
    action.run();
    refresh();
  } });
  for (const control of options.controls ?? []) registry.registerControl(control);
  const runtime = createToolbarRuntime(options.definitions, options);
  const views = new Map<string, ToolbarRenderer>();
  /** Floating torn-off groups, keyed by canonical detached id. */
  const floats = new Map<string, { element: HTMLElement; view: ToolbarRenderer }>();
  let disposed = false;
  let topZ = 1000;
  const firstHost = [...options.hosts.values()][0];
  const layerDoc = firstHost?.element.ownerDocument;
  let layer: HTMLDivElement | undefined = layerDoc?.createElement('div');
  if (layer && layerDoc && layerDoc.body) {
    layer.className = 'toolbar-float-layer';
    layerDoc.body.append(layer);
  } else {
    // No document body (e.g. headless legacy harness): floats stay disabled,
    // bar rendering and persistence keep working without a layer.
    layer = undefined;
  }

  const docking = layer && layerDoc ? createToolbarDocking(layerDoc, layer, {
    locked: () => runtime.read().layout.locked,
    commit: (target, view, participants, insertLane) => runtime.layout({ kind: 'place', target, view, insert: true, participants, insertLane }).ok,
  }) : undefined;
  let tearPreview: string | undefined;
  const barGrips: HTMLElement[] = [];

  const createFloat = (ownerId: string, groupId: string, layout: ViewLayout) => {
    const element = layerDoc!.createElement('div');
    element.className = 'toolbar-float';
    element.style.visibility = 'hidden';
    const head = layerDoc!.createElement('div');
    head.className = 'toolbar-float-head';
    const title = layerDoc!.createElement('span');
    title.className = 'toolbar-float-title';
    title.textContent = registry.groupLabel(groupId);
    const close = layerDoc!.createElement('button');
    close.type = 'button';
    close.className = 'toolbar-float-close';
    close.textContent = '×';
    close.setAttribute('aria-label', t('In die Leiste zurück'));
    close.addEventListener('click', () => { runtime.layout({ kind: 'close', ownerId, groupId }); });
    head.append(title, close);
    const body = layerDoc!.createElement('div');
    body.className = 'toolbar-float-body';
    element.append(head, body);
    layer!.append(element);
    const view = new ToolbarRenderer({
      viewId: `float:${detachedId(ownerId, groupId)}`, ownerId, groupId, registry,
      getState: runtime.read,
      getItems: (state) => ownEntry(state.content.groups, groupId)?.items ?? [],
      choose: (group, action) => { runtime.choose(group, action); },
    });
    view.mount(body);
    docking?.mount(element, head, { ownerId, groupId }, layout);
    docking?.update(element, layout);
    const float = { element, view };
    floats.set(detachedId(ownerId, groupId), float);
    return float;
  };

  const raiseFloat = (ownerId: string, groupId: string): boolean => {
    const float = floats.get(detachedId(ownerId, groupId));
    if (!float || !layerDoc) return false;
    float.element.style.zIndex = String(++topZ);
    float.element.classList.remove('flash');
    void float.element.offsetWidth;
    float.element.classList.add('flash');
    layerDoc.defaultView?.setTimeout(() => float.element.classList.remove('flash'), 450);
    return true;
  };

  const tearOff = (request: { ownerId: string; groupId: string; rect: { left: number; top: number; right: number; bottom: number }; x: number; y: number;
    pointerId?: number; onAbort?(): void; onCommit?(): void }): boolean | { cancel(): void } => {
    if (!layer || !layerDoc || !docking || runtime.read().layout.locked) return false;
    const id = detachedId(request.ownerId, request.groupId);
    if (floats.has(id)) { raiseFloat(request.ownerId, request.groupId); return true; }
    docking.cancel();
    const initial: ViewLayout = { placement: { kind: 'floating', x: request.rect.right + 8, y: request.rect.top - 1 }, orientation: 'horizontal', rows: 1, columns: 1 };
    const float = createFloat(request.ownerId, request.groupId, initial);
    const w = float.element.offsetWidth || 200;
    const root = layerDoc.documentElement;
    let x = request.rect.right + 8, y = request.rect.top - 1;
    if (x + w > root.clientWidth) x = request.rect.left - w - 8;
    const view: ViewLayout = { placement: { kind: 'floating', x, y }, orientation: 'horizontal', rows: 1, columns: 1 };
    docking.update(float.element, view);
    tearPreview = id;
    const removePreview = () => {
      tearPreview = undefined;
      docking.unmount(float.element); float.view.dispose(); float.element.remove(); floats.delete(id);
    };
    docking.begin(float.element, { ownerId: request.ownerId, groupId: request.groupId }, view, request.x, request.y, request.pointerId, {
      commit(placed, participants, insertLane) {
        tearPreview = undefined;
        const res = runtime.layout({ kind: 'detach', ownerId: request.ownerId, groupId: request.groupId, view: placed, insert: true, participants, insertLane });
        if (!res.ok) { removePreview(); request.onAbort?.(); }
        else request.onCommit?.();
      },
      abort() { removePreview(); if (!disposed) request.onAbort?.(); },
    });
    return { cancel: () => docking.cancel() };
  };
  const refresh = () => {
    if (disposed) return;
    const snapshot = runtime.read();
    docking?.syncLock();
    for (const [id, host] of options.hosts) {
      host.element.hidden = snapshot.layout.hidden.includes(host.ownerId);
      const layout = host.groupId === undefined ? ownEntry(snapshot.layout.bars, host.ownerId)
        : Object.values(snapshot.layout.detached).find((view) => view.ownerId === host.ownerId && view.groupId === host.groupId)?.layout
          ?? ownEntry(snapshot.layout.bars, host.ownerId);
      host.element.dataset.size = ownEntry(snapshot.content.iconSizes, host.ownerId) ?? 'm';
      const root = host.element.querySelector<HTMLElement>('[data-view]');
      if (root && layout) {
        root.classList.add('toolbar-view');
        root.dataset.orientation = layout.orientation;
        root.style.setProperty('--toolbar-rows', String(layout.rows));
        root.style.setProperty('--toolbar-columns', String(layout.columns));
        root.setAttribute('aria-label', options.definitions.bars.find((bar) => bar.id === host.ownerId)?.label ?? host.ownerId);
      }
      views.get(id)?.update();
      if (layout) docking?.update(host.element, layout);
    }
    for (const [id, element] of options.visibilityHosts ?? []) element.hidden = snapshot.layout.hidden.includes(id);
    if (layer) {
      const seen = new Set<string>();
      for (const [id, dv] of Object.entries(snapshot.layout.detached)) {
        if (!options.definitions.bars.some((bar) => bar.id === dv.ownerId)) continue;
        if (!resolveDetached(snapshot, dv.ownerId, dv.groupId) || !registry.getGroup(dv.groupId)) continue;
        seen.add(id);
        let float = floats.get(id);
        if (!float) float = createFloat(dv.ownerId, dv.groupId, dv.layout);
        float.element.style.display = snapshot.layout.hidden.includes(dv.ownerId) ? 'none' : '';
        docking?.update(float.element, dv.layout);
        const close = float.element.querySelector<HTMLButtonElement>('.toolbar-float-close');
        if (close) close.disabled = snapshot.layout.locked;
        float.view.update();
      }
      for (const [id, float] of [...floats])
        if (!seen.has(id) && id !== tearPreview) { docking?.unmount(float.element); float.view.dispose(); float.element.remove(); floats.delete(id); }
    }
  };
  for (const [viewId, host] of options.hosts) {
    const view = new ToolbarRenderer({ viewId, ownerId: host.ownerId, groupId: host.groupId, registry,
      getState: runtime.read,
      getItems: (state) => host.groupId === undefined ? ownEntry(state.content.bars, host.ownerId) ?? []
        : ownEntry(state.content.groups, host.groupId)?.items ?? [],
      choose: (group, action) => { runtime.choose(group, action); },
      onTearoff: (request) => tearOff(request),
      onRaise: (ownerId, groupId) => raiseFloat(ownerId, groupId),
    });
    view.mount(host.element);
    views.set(viewId, view);
    if (docking && layerDoc) {
      const grip = layerDoc.createElement('div');
      grip.className = 'toolbar-grip';
      const mark = layerDoc.createElement('span');
      mark.className = 'toolbar-grip-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = '⋮';
      grip.append(mark);
      host.element.prepend(grip);
      barGrips.push(grip);
      const layout = ownEntry(runtime.read().layout.bars, host.ownerId);
      if (layout) docking.mount(host.element, grip, { barId: host.ownerId }, layout);
    }
  }
  const unsubscribe = runtime.subscribe(refresh);
  refresh();
  return { runtime, registry, views, refresh, docking,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      docking?.dispose();
      for (const grip of barGrips) grip.remove();
      for (const view of views.values()) view.dispose();
      views.clear();
      for (const float of floats.values()) { float.view.dispose(); float.element.remove(); }
      floats.clear();
      layer?.remove();
    },
  };
}
export type ToolbarSystem = ReturnType<typeof initToolbarFramework>;
