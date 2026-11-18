# Toolbar framework integration notes

The toolbar framework uses native DOM APIs. `src/toolbars.ts` is the application
facade; `src/toolbars/` separates definitions, state, persistence, registration,
rendering and app-local docking. Menus and the panel dock (`src/dock.ts`) remain
separate. Do not copy VectorCraft code or assets. Typography work in PR #360 is
independent, not a dependency of toolbar integration.

## Definitions and durable IDs

Use stable, namespaced IDs for bars, actions, controls and groups. IDs are stored
references, not translated labels, DOM selectors or proof of provider availability.
Never rename an ID merely because its label changes. Explicit item references
distinguish `action`, `control`, `group` and `separator`; legacy references resolve
only when exactly one registered kind matches.

- An **action** invokes existing feature behavior through `run()`, with optional
  `enabled()`, `on()` and `dyn()` state. Do not duplicate command dispatch.
- A **control** creates a per-view editor for feature-owned values. Numeric and
  text controls use the same rendering and layout path as action toolbars.
- A **section** is an inline group of leaves. A **flyout** has a current-action
  primary button and a popup, and can have one detached view per owner/group.
  Groups contain leaves, not nested groups.

Define contents and initial geometry through `Definitions` from `model.ts`.
Placement is `{ kind: 'dock', edge, lane, order }` (all four edges, zero-based
lane/order), or `{ kind: 'floating', x, y }` in app CSS pixels. Every `ViewLayout`
also has `orientation`, positive `rows` and `columns`.

### Build definitions from feature ownership

Construct the current `Definitions` from the available feature owners before
calling `initToolbarFramework()`, never from saved references. When definitions
change, the integration owner disposes the old system and creates a new one with
the current definitions and the same storage adapter. Loading preserves stored
customization and unknown references while merging newly introduced defaults.
Registering provider metadata alone does not mutate definitions or add content.

## One state owner, multiple views

`createToolbarRuntime(definitions, options)` owns snapshots, explicit commits and
subscriptions. `initToolbarFramework(options)` composes it with a registry,
renderers and docking. Pass `definitions`, `actions`, optional `controls`, a
`hosts` map of view IDs to `{ element, ownerId, groupId? }`, and optional `storage`.
The returned system exposes `runtime`, `registry`, `views`, `refresh()` and
`dispose()`. Call `refresh()` after registry or external feature-state changes;
registration itself does not update mounted views.

### Recommended: initialize through the common layout system

This example adds a named bar with an inline section and a feature-owned control.
`host` is an app-owned empty shell; `feature` supplies existing feature behavior.
The initializer owns rendering, grips and docking rather than the feature building
a separate toolbar layout.

```ts
import { initToolbarFramework } from '../src/toolbars/system';
import type { Definitions } from '../src/toolbars/model';
import type { ControlDefinition } from '../src/toolbars/registry';

interface ExampleFeature {
  read(): number;
  write(value: number): void;
  apply(): void;
  subscribe(listener: () => void): () => void;
}

function mountExampleToolbar(host: HTMLElement, feature: ExampleFeature) {
  const definitions: Definitions = {
    bars: [{
      id: 'example:bar', label: 'Example',
      items: [{ kind: 'group', id: 'example:section' }],
      layout: {
        placement: { kind: 'dock', edge: 'top', lane: 0, order: 0 },
        orientation: 'horizontal', rows: 1, columns: 1,
      },
    }],
    groups: [{
      id: 'example:section', label: 'Example settings', kind: 'section',
      items: [
        { kind: 'control', id: 'example:value' },
        { kind: 'action', id: 'example:apply' },
      ],
    }],
  };
  const control: ControlDefinition = {
    id: 'example:value', label: 'Example value',
    create(context) {
      const input = host.ownerDocument.createElement('input');
      input.type = 'number';
      input.id = context.id('value');
      input.setAttribute('aria-label', 'Example value');
      const update = () => {
        if (input.ownerDocument.activeElement !== input)
          input.value = String(feature.read());
      };
      const commit = () => {
        if (!context.isAvailable() || input.value.trim() === '') return;
        const value = Number(input.value);
        if (Number.isFinite(value)) feature.write(value);
      };
      input.addEventListener('change', commit);
      return {
        mount(element) { element.append(input); update(); },
        update,
        activate() { commit(); },
        dispose() { input.removeEventListener('change', commit); input.remove(); },
      };
    },
  };
  const system = initToolbarFramework({
    definitions,
    actions: [{ id: 'example:apply', label: 'Apply', run: () => feature.apply() }],
    controls: [control],
    hosts: new Map([['example:view', { element: host, ownerId: 'example:bar' }]]),
    storage: localStorage,
  });
  const unsubscribe = feature.subscribe(() => system.refresh());
  return () => { unsubscribe(); system.dispose(); };
}
```

Translate example labels in a real integration. The app should compose feature
definitions into its one system/storage owner, not run competing systems writing
the same toolbar key. On a definition change, invoke the returned cleanup before
recreating that owner with the complete current definitions.

### Advanced: manually owned renderer views

Use a standalone renderer only for a deliberately separate view whose integration
already owns layout and lifecycle. It does not provide the common docking shell:

```ts
import { ToolbarRenderer } from '../src/toolbars/renderer';
import { ownEntry } from '../src/toolbars/model';

// runtime, registry and host are supplied by the integration owner.
const view = new ToolbarRenderer({
  viewId: 'example:main-view',
  ownerId: 'example:main',
  registry,
  getState: runtime.read,
  getItems: state => ownEntry(state.content.bars, 'example:main') ?? [],
  choose: (groupId, actionId) => { runtime.choose(groupId, actionId); },
});
view.mount(host);
const unsubscribe = runtime.subscribe(() => view.update());

// When this integration is removed:
unsubscribe();
view.dispose();
```

Detached renderers additionally receive `groupId` and resolve current group
leaves on every update. They do not copy content or choices. `activate(intent)`
accepts action, group or control intents; controls use their per-view `instanceId`.
Rendering and reading must never write state.

## Control ownership and cleanup

Register `{ id, label, create(context) }` with `registry.registerControl()`.
The factory returns `mount(host)`, `update(snapshot)`, `activate(intent?)` and
`dispose()`. Each source, popup and detached view owns its own DOM and instances.
Use `context.id(name)` for labels and accessible relationships; do not derive
selectors from persistent IDs. Use text nodes and the existing safe DOM/icon
helpers, not HTML assembled from translations or provider data.

Feature values, validation, drafts and commit policy stay in the feature's
existing getter/setter. Views share that source of truth, including numeric
fields, text formatting and font selection; toolbar state stores no second copy.
`update()` must preserve uncommitted input. A factory that subscribes to feature
events must unsubscribe in `dispose()` and remove its listeners and timers.
Recheck `context.isAvailable()` immediately before every delayed/non-DOM write.
It becomes false after disposal, control replacement, group removal/disable or
ambiguous legacy resolution. Renderer event guards do not replace this check.
Action activation likewise rechecks availability and enabled state.

Register/unregister group metadata explicitly with `registerGroup()` and
`unregisterGroup()`; saved group contents do not enable an absent provider.
Unregistering disables its views without deleting saved references. Call system
`dispose()` on teardown to unsubscribe and remove owned interactions and views.

## Persistence and reset boundaries

The only toolbar storage key is `kizamubeam.toolbars`, exported as
`TOOLBAR_STORAGE_KEY`. The native envelope is `toolbar-layout`, version 1; legacy
configuration version 14 is a different format. Migration retains legacy
contents, separators, choices, hidden IDs and icon sizes. Older legacy versions
require the application's upgrader rather than a partial second migration.

`decode()` and `encode()` return explicit results. Loading merges new defaults
without discarding unknown bars, groups, actions or controls. Missing providers
remain inert until available again. Loading, normalization and rendering do not
write storage. Invalid/future data or a failed read block writes for that runtime
so an older application cannot overwrite unexamined settings. Inspect
`runtime.persistence()` and commit results (`changed`, `persisted`); in-memory
operation does not prove persistence succeeded.

Use `runtime.layout(operation)` for layout, `lock(boolean)` for the saved global
lock (default `false`), `choose()` for shared group choice, `setBarItems()` and
`setGroupItems()` for contents, and `setIconSize()` for icon size.
Layout reset restores placement, orientation, rows/columns and visibility and
removes detachments, preserving contents, shared choices and icon sizes.
`resetContent()` restores all default contents/choices, preserving layout and icon
sizes and retaining user-created bars/groups. `resetBarContent(barId)` restores
one bar's default items and the default members of its built-in groups in one
commit. Group definitions are shared, so their restored members update every
view of those groups. Neither reset deletes feature values such as numeric or
text/font settings.

Completed dock insertions use `insert: true` on the `place` or `detach` operation.
The layout system supplies `participants`, the visible mounted peer targets in
the destination lane. Their orders are updated atomically with the moved view;
absent providers and hidden views retain their saved layout and do not distort
the visible insertion index. Omit `insert` for an explicit geometry-only update.
Use transient `insertLane: true` to insert a whole dock row/column at the target
lane. All other saved views at or beyond that lane on the same edge shift by one,
including hidden/absent providers; this is one atomic commit, not sequential moves.

## Interaction contract

The toolbar shell provides grip movement, all-edge docking, floating placement
and row/column layout with inner scrolling. Top/bottom docking determines a
horizontal orientation; left/right docking determines a vertical orientation.
Floating bars retain their last orientation. Orientation is not a separate
customizer setting. Adjust row/column counts rather than using a physical resize
handle. Floating means inside the application, not an OS window.

The customizer can create, rename and delete user bars. Built-in bars cannot be
deleted. Built-in and user-created flyouts use the same member editing commands:
add/remove actions, indent/outdent and reorder. Groups remain flat and contain
actions, not nested groups or feature controls. Sections containing feature
controls are not editable action flyouts. Workspace profiles and icon/font
redesign are outside this framework.

Dragging uses a geometry snapshot plus separator bands and hysteresis, so a
preview cannot move its own hit targets. Drop near the boundary between lanes to
insert a new row/column. With a docked grip focused, Ctrl+Shift+Up/Left inserts
before its lane and Ctrl+Shift+Down/Right inserts after it. Resize/scroll cancels
an active gesture rather than using outdated geometry.

`motion.ts` visually settles the other bars and workspace over 150 ms. The moving
bar is excluded; hit testing uses unanimated geometry. Repeating the same target
does not restart the animation. Reduced-motion preferences disable the animation.

Open flyouts with the arrow, right-click or a 350 ms primary-button hold. Drag
the popup grip to tear off; the close X returns it to its source. Source and
detached views share the current choice; invoking an already detached group raises
its existing view. Hiding an owner hides its detached views; showing it restores
them with their saved placement.

Keep move/tear-off previews separate from committed state. Escape, window
blur and pointer cancellation discard the whole gesture without saving, including
a new tear-off. A completed drop commits immediately. The global lock rejects
layout changes, not action use or feature editing. Clamp using measured dimensions
and preserve a reachable grip; never persist speculative geometry during render.

## Offline verification

Run `npm run test:toolbar-layout` for core, persistence and legacy-migration tests,
then `npm run build:toolbar-fixtures`. Serve the app with the development server
and open the generated pages under `artifacts/` in a native browser:

- `toolbar-framework-browser`: `window.runToolbarRendererChecks()`.
- `toolbar-motion-browser`: `await window.runToolbarMotionChecks()`.
- `toolbar-system-browser`: `window.runToolbarSystemChecks()` and
  `await window.runToolbarDialogLifecycleChecks()`.
- `toolbar-controls-browser`: `window.runToolbarControlChecks()`.
- `toolbar-flyout-browser`: `await window.runToolbarFlyoutChecks()`.
- `toolbar-docking-browser`: `window.runToolbarDockingChecks()`.

These exercise real DOM rendering and synthetic native events without machine
access. Feature-control checks use an editor double, not physical hardware.
They do not replace user acceptance of layout, platform-native behavior or
accessibility.
