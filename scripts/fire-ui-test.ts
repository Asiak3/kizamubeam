// Real fireUi + DOM builder + machine boundary; only DOM and Tauri transport are in-memory doubles.
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { fireControls, fireOverlayInPanel, fireSettings, fireWarning, installFireOverlay, setFireOverlayInPanel } from '../src/fireUi';
import { machine } from '../src/machine';
import { newDevice } from '../src/gcode';

type Mutation = { type: 'childList' | 'attributes'; target: Element; addedNodes: Element[]; removedNodes: Element[]; attributeName?: string };
const mutations: { target?: Element; options?: MutationObserverInit; records: Mutation[]; notify: (records: Mutation[]) => void }[] = [];
const queueMutation = (record: Mutation) => {
  for (const observer of mutations) {
    if (!observer.target?.contains(record.target)) continue;
    if (record.type === 'attributes' && !observer.options?.attributeFilter?.includes(record.attributeName!)) continue;
    observer.records.push(record);
  }
};
const flushMutations = () => {
  let deliveries = 0;
  while (mutations.some((observer) => observer.records.length)) {
    assert.ok(++deliveries < 10, 'modal observation must settle without mutation feedback');
    for (const observer of mutations) {
      const records = observer.records.splice(0);
      if (records.length) observer.notify(records);
    }
  }
  return deliveries;
};
const modalStack: Element[] = [];
class Element {
  nodeType = 1;
  parentElement: Element | null = null;
  get isConnected(): boolean { return this === body || !!this.parentElement?.isConnected; }
  children: (Element | string)[] = [];
  attributes: Record<string, string> = {};
  listeners = new Map<string, ((e: unknown) => unknown)[]>();
  hidden = false;
  disabled = false;
  value = '';
  className = '';
  classList = { toggle: (name: string, enabled: boolean) => {
    const names = this.className.split(/\s+/).filter((part) => part && part !== name);
    if (enabled) names.push(name);
    this.className = names.join(' ');
    return enabled;
  } };
  textContent = '';
  constructor(readonly tag: string) {}
  append(...nodes: (Element | string)[]) {
    for (const node of nodes) {
      if (typeof node !== 'string') { node.remove(); node.parentElement = this; }
      this.children.push(node);
      if (typeof node !== 'string') queueMutation({ type: 'childList', target: this, addedNodes: [node], removedNodes: [] });
    }
  }
  remove() {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
    queueMutation({ type: 'childList', target: parent, addedNodes: [], removedNodes: [this] });
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
    if (key === 'value') this.value = value;
    queueMutation({ type: 'attributes', target: this, addedNodes: [], removedNodes: [], attributeName: key });
  }
  removeAttribute(key: string) {
    delete this.attributes[key];
    queueMutation({ type: 'attributes', target: this, addedNodes: [], removedNodes: [], attributeName: key });
  }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  focus() { Object.assign(document, { activeElement: this }); }
  checkVisibility() { return !this.hidden; }
  modal = false;
  matches(selector: string) { return selector === ':modal' ? this.modal : selector === 'dialog:modal' ? this.tag === 'dialog' && this.modal : this.tag === selector; }
  closest(selector: string): Element | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelector(selector: string) { return this.all('dialog').find((element) => element.matches(selector)) ?? null; }
  showModal() {
    const previous = modalStack.indexOf(this);
    if (previous >= 0) modalStack.splice(previous, 1);
    modalStack.push(this);
    this.modal = true;
    this.setAttribute('open', '');
    this.focus();
  }
  close() { this.modal = false; this.removeAttribute('open'); }
  contains(other: Element): boolean { return this === other || this.children.some((c) => typeof c !== 'string' && c.contains(other)); }
  rect?: typeof actionRect;
  surfaceSelector = '';
  getBoundingClientRect() { return this.rect ?? actionRect; }
  private capturedPointer = -1;
  setPointerCapture(id: number) { this.capturedPointer = id; }
  hasPointerCapture(id: number) { return this.capturedPointer === id; }
  addEventListener(type: string, fn: (e: unknown) => unknown) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  async emit(type: string, extra = {}) {
    for (const fn of this.listeners.get(type) ?? []) await fn({ target: this, isTrusted: true,
      preventDefault() {}, stopPropagation() {}, ...extra });
  }
  all(tag: string): Element[] {
    return this.children.flatMap((c) => typeof c === 'string' ? [] : [...(c.tag === tag ? [c] : []), ...c.all(tag)]);
  }
}
const body = new Element('body');
const windowEvents = new Element('window');
const documentEvents = new Element('document');
const actionRect = { left: 180, top: 120, right: 380, bottom: 152, width: 200, height: 32 };
let hitStack: Element[] = [];
const surfaces: Element[] = [];
let hitTest = (_x: number, _y: number) => hitStack;
let nextFrame: (() => void) | undefined;
Object.assign(document, { body, createElement: (tag: string) => new Element(tag),
  hidden: false, elementsFromPoint: (x: number, y: number) => {
    const modal = modalStack.filter((dialog) => dialog.modal && dialog.isConnected).at(-1);
    const hits = hitTest(x, y);
    return modal ? [...hits.filter((element) => modal.contains(element)), modal] : hits;
  },
  elementFromPoint: (x: number, y: number) => document.elementsFromPoint(x, y)[0] ?? null,
  querySelectorAll: (selector: string) => selector === 'dialog:modal' ? body.all('dialog').filter((dialog) => dialog.modal) :
    [...surfaces.filter((surface) => selector.split(',').map((part) => part.trim()).includes(surface.surfaceSelector)),
      ...body.all('dialog').filter((dialog) => 'open' in dialog.attributes)],
  addEventListener: documentEvents.addEventListener.bind(documentEvents) });
Object.assign(globalThis, { MutationObserver: class {
  records: Mutation[] = [];
  target?: Element;
  options?: MutationObserverInit;
  constructor(readonly notify: (records: Mutation[]) => void) { mutations.push(this); }
  observe(target: Element, options: MutationObserverInit) { this.target = target; this.options = options; }
} });
Object.assign(window, { innerWidth: 1000, innerHeight: 800,
  requestAnimationFrame: (fn: () => void) => { nextFrame = fn; return 1; },
  addEventListener: windowEvents.addEventListener.bind(windowEvents) });
const frame = () => { const fn = nextFrame; nextFrame = undefined; fn?.(); };
let setActionInView = (_visible: boolean) => {};
let setActionIntersection = (_bounds: typeof actionRect, _intersection: typeof actionRect, _ratio: number, _intersecting = true) => {};
let observerCount = 0;
Object.assign(globalThis, { IntersectionObserver: class {
  private previous?: { ratio: number; intersecting: boolean };
  constructor(private readonly notify: (entries: unknown[]) => void, private readonly options: IntersectionObserverInit) { observerCount++; }
  disconnect() {}
  observe(target: Element) {
    const thresholds = [this.options.threshold ?? 0].flat().map(Math.fround).sort((a, b) => a - b);
    const index = (ratio: number) => thresholds.filter((threshold) => ratio >= threshold).length;
    setActionIntersection = (bounds, intersection, ratio, intersecting = true) => {
      ratio = Math.fround(ratio);
      const previous = this.previous;
      this.previous = { ratio, intersecting };
      // Like the browser, geometry changes alone do not notify without a threshold crossing.
      if (!previous || previous.intersecting !== intersecting || index(previous.ratio) !== index(ratio)) {
        this.notify([{ target, isIntersecting: intersecting, intersectionRatio: ratio,
          boundingClientRect: { ...bounds }, intersectionRect: { ...intersection } }]);
      }
    };
    setActionInView = (visible) => setActionIntersection(actionRect, visible ? actionRect :
      { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }, Number(visible), visible);
  }
} });
const sent: string[] = [];
Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (cmd: string) => { sent.push(cmd); } } });
let d = newDevice({ fw: 'grbl', laser: { type: 'diode' }, fireEnabled: true });
Object.assign(machine, { connected: true, connectedDevice: d.id, fwId: d.fw });
machine.status.state = 'Idle';
machine.status.ov = [100, 100, 100];
installFireOverlay();
const overlay = body.children[0] as Element;
let settingsOpened = 0;
const panel = fireControls(() => d, () => { settingsOpened++; });
const root = panel.root as unknown as Element;
const [start, hold, settingsLink] = root.all('button');
const [power, seconds] = root.all('input');
let scenarios = 0;
const scenario = (name: string) => console.log(`ok UI ${++scenarios} ${name}`);
d.fireEnabled = false;
machine.connected = false;
panel.refresh();
assert.equal(root.hidden, false);
assert.equal(root.tag, 'section');
assert.equal(start.disabled, true);
assert.equal(hold.disabled, true);
assert.equal(power.disabled, true);
assert.equal(seconds.disabled, true);
assert.equal(settingsLink.disabled, false);
await settingsLink.emit('click');
assert.equal(settingsOpened, 1);
assert.equal(sent.length, 0);
scenario('unconfigured test fire stays visible and links to settings without a connection');
d.fireEnabled = true;
machine.connected = true;
panel.refresh();
assert.equal(power.disabled, false);
assert.equal(seconds.disabled, false);
assert.equal(start.disabled, false);
assert.equal(hold.disabled, false);
assert.equal(start.textContent, 'Testfeuer starten');
scenario('idle controls expose start and hold, not stop');
await start.emit('click');
hitStack = [start];
setActionInView(true);
setFireOverlayInPanel(false);
assert.equal(overlay.hidden, true);
hitStack = [new Element('floating-window'), start];
frame();
assert.equal(overlay.hidden, false, 'a floating window must not hide the only reachable Fire action');
hitStack = [overlay, start];
frame();
assert.equal(overlay.hidden, true, 'the overlay itself must not cause a visibility feedback loop');
hitStack = [start];
hitTest = (x, y) => (x < 184 || x > 376) && (y < 124 || y > 148) ? [root] : [start];
frame();
assert.equal(overlay.hidden, true, 'unpainted rounded button corners must not break unobstructed opt-out');
hitTest = () => hitStack;
const narrowSurface = new Element('div');
narrowSurface.surfaceSelector = '.dock-group.floating';
narrowSurface.rect = { left: 230, top: 125, right: 231, bottom: 127, width: 1, height: 2 };
surfaces.push(narrowSurface);
hitTest = (x, y) => x >= 230 && x <= 231 && y >= 125 && y <= 127 ? [narrowSurface, start] : [start];
frame();
assert.equal(overlay.hidden, false, 'a narrow floating surface between all nine probes must restore the overlay');
for (const selector of ['dialog[open]', '.dock-group.floating', '.toolbar-popup', '.toolbar-float', '.toolbar-layout-floating',
  '.menu-items', '.editor-context-submenu', '.fontpick-pop', '.overlap-picker', '.sync-banner', '.editor-isolation-badge',
  '.slot-placement-badge', '.sketch-bar', '.dock-ghost', '.dock-mark', '.toolbar-drop-preview', '#texteditor']) {
  narrowSurface.surfaceSelector = selector;
  frame();
  assert.equal(overlay.hidden, false, `narrow ${selector} intersections must fail safe without a hit-test probe`);
}
narrowSurface.hidden = true;
frame();
assert.equal(overlay.hidden, true, 'hidden surface roots must not break opt-out');
narrowSurface.hidden = false;
narrowSurface.rect = { left: 400, top: 125, right: 401, bottom: 127, width: 1, height: 2 };
frame();
assert.equal(overlay.hidden, true, 'unrelated visible surface roots must not break opt-out');
narrowSurface.surfaceSelector = 'dialog[open]';
narrowSurface.modal = true;
frame();
assert.equal(overlay.hidden, false, 'a modal backdrop blocks the inline action outside the dialog bounds');
surfaces.length = 0;
const ownWindow = new Element('div');
ownWindow.surfaceSelector = '.dock-group.floating';
ownWindow.append(root);
surfaces.push(ownWindow);
hitTest = () => hitStack;
frame();
assert.equal(overlay.hidden, true, 'the containing floating Move window must not count as an occluder');
surfaces.length = 0;
hitTest = () => hitStack;
frame();
assert.equal(overlay.hidden, true, 'removing the intersecting surface must preserve unobstructed opt-out');
scenario('rounded button corners preserve opt-out; narrow app-surface intersections, hidden roots, owning windows and modal backdrops are handled conservatively');
const cover = new Element('floating-window');
hitTest = (x) => x > 379 ? [cover, start] : [start];
frame();
assert.equal(overlay.hidden, false, 'an obstructed edge must not count as a fully visible action');
hitTest = () => { throw new Error('hit testing unavailable'); };
frame();
assert.equal(overlay.hidden, false, 'visibility query failures must fail safe');
hitTest = () => hitStack;
actionRect.right = 1200;
frame();
assert.equal(overlay.hidden, false, 'partially off-screen actions must keep the fallback');
actionRect.right = 380;
frame();
assert.equal(overlay.hidden, true, 'moving back into view must restore the accepted opt-out');
const originalRect = { ...actionRect };
const fractionalRect = { left: 139, top: 148.4000015258789, right: 319, bottom: 177.20000076293945,
  width: 180, height: 28.799999237060547 };
Object.assign(actionRect, fractionalRect);
for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
  const intersection = { ...fractionalRect, [edge]: fractionalRect[edge] + (edge === 'left' || edge === 'top' ? 0.25 : -0.25) };
  intersection.width = intersection.right - intersection.left;
  intersection.height = intersection.bottom - intersection.top;
  setActionIntersection(fractionalRect, intersection, intersection.width * intersection.height / (fractionalRect.width * fractionalRect.height));
  assert.equal(overlay.hidden, false, `real subpixel ${edge} clipping must keep the fallback even when all cross probes hit`);
  frame();
  assert.equal(nextFrame, undefined, 'clipped actions must not keep polling');
  setActionInView(true);
}
scenario('real quarter-pixel ancestor clipping on each edge retains the fallback without polling');
const roundedIntersection = { ...fractionalRect, bottom: 177.1999969482422,
  height: 177.1999969482422 - fractionalRect.top };
setActionIntersection(fractionalRect, roundedIntersection, 0.9999999403953552);
assert.equal(overlay.hidden, true, 'Chromium float32 intersection rounding must not reject a fully visible transformed action');
const fractionalObserverCount = observerCount;
setActionIntersection(fractionalRect, roundedIntersection, 0.9999999403953552);
assert.equal(observerCount, fractionalObserverCount, 'the initial notification after re-observing must settle without a loop');
setActionIntersection(fractionalRect, roundedIntersection, 0.9999998807907104);
assert.equal(overlay.hidden, true, 'edge coverage, not a fixed ratio epsilon, must determine full visibility');
setActionIntersection(fractionalRect, roundedIntersection, 0.9999999403953552);
setActionIntersection(fractionalRect, roundedIntersection, 0.9999999403953552);
scenario('fractional Chromium intersection geometry preserves the accepted opt-out');
const clippedFractional = { ...roundedIntersection, bottom: roundedIntersection.bottom - 0.25, height: roundedIntersection.height - 0.25 };
setActionIntersection(fractionalRect, clippedFractional, clippedFractional.height / fractionalRect.height);
assert.equal(overlay.hidden, false, 'clipping after a fractional full intersection must cross an observed threshold below one');
setActionIntersection(fractionalRect, clippedFractional, clippedFractional.height / fractionalRect.height);
frame();
assert.equal(nextFrame, undefined);
setActionIntersection(fractionalRect, roundedIntersection, 0.9999999403953552);
assert.equal(overlay.hidden, true, 'unclipping must restore opt-out without requiring an exact ratio of one');
setActionInView(false);
const offscreenObserverCount = observerCount;
setActionInView(false);
assert.equal(observerCount, offscreenObserverCount, 'offscreen observation must also settle without a loop');
frame();
assert.equal(overlay.hidden, false);
assert.equal(nextFrame, undefined, 'fully offscreen actions must not keep polling');
Object.assign(actionRect, originalRect);
setActionInView(true);
scenario('fractional clipping and recovery are observed below ratio one; offscreen actions stop polling');
setFireOverlayInPanel(true);
await start.emit('click');
await start.emit('click');
scenario('hit testing restores an opted-out overlay when docking or a floating window obscures the inline action');
const connectedFirmware = d.fw;
d.fw = 'marlin';
panel.refresh();
assert.equal(start.disabled, true, 'profile firmware must match the connected controller');
assert.equal(hold.disabled, true, 'hold must use the same machine eligibility as start');
d.fw = connectedFirmware;
panel.refresh();
assert.equal(start.disabled, false);
assert.equal(hold.disabled, false);
scenario('firmware/profile mismatch disables start and hold until the profile matches again');
for (const fw of ['grbl', 'grblhal', 'fluidnc'] as const) {
  d.fw = machine.fwId = fw;
  for (const override of [undefined, 80, 150]) {
    machine.status.ov = override === undefined ? undefined : [100, 100, override];
    panel.refresh();
    assert.equal(start.disabled, true);
    assert.equal(hold.disabled, true);
    assert.match(root.all('span')[0].textContent, /Laser-Override.*100 %.*Statusmeldung/, `${fw}: ${override}`);
    assert.equal(machine.status.ov?.[2], override, 'explaining the override must never reset it');
  }
  machine.status.ov = [100, 100, 100];
  panel.refresh();
  assert.equal(start.disabled, false);
  assert.equal(hold.disabled, false);
}
for (const fw of ['marlin', 'smoothie'] as const) {
  d.fw = machine.fwId = fw;
  machine.status.ov = undefined;
  panel.refresh();
  assert.equal(start.disabled, false);
  assert.equal(hold.disabled, false);
}
d.fw = machine.fwId = connectedFirmware;
machine.status.ov = [100, 100, 100];
panel.refresh();
scenario('GRBL-family override gates explain unknown or non-100% values without resetting them; Marlin and Smoothie do not require an override');
const persistenceError = 'Testfeuer nicht gestartet: Sicherheitsstatus konnte nicht gespeichert werden. Lokalen Speicher freigeben und erneut versuchen.';
const commandsBeforeStorageFailure = sent.length;
const writeStorage = localStorage.setItem;
try {
  localStorage.setItem = () => { throw new Error('storage unavailable'); };
  await start.emit('click');
} finally { localStorage.setItem = writeStorage; }
assert.equal(machine.fire.state, 'idle');
assert.equal(sent.length, commandsBeforeStorageFailure);
assert.equal(machine.fireStartError, persistenceError);
assert.equal(root.all('span')[0].textContent, persistenceError, 'the specific storage failure must reach the visible error');
await power.emit('input');
scenario('rejected starts display the specific persistence error without dispatching');
for (const input of [power, seconds]) {
  assert.ok(input.attributes['aria-label']);
  const original = input.value;
  for (const value of ['', '0', '-1', 'Infinity', 'NaN', '99999', '0,', '0,5.1', '0,5x']) {
    input.value = value;
    await input.emit('input');
    assert.equal(start.disabled, true, value);
  }
  input.value = original;
  await input.emit('input');
}
scenario('invalid visible power/duration blocks start and exposes accessible labels');
power.value = '0,5';
seconds.value = '2.5';
await power.emit('input');
await seconds.emit('input');
assert.equal(start.disabled, false);
scenario('manual controls accept fractional power and duration with either separator');
const commandsBeforeUntrusted = sent.length;
await start.emit('click', { isTrusted: false });
assert.equal(sent.length, commandsBeforeUntrusted);
scenario('untrusted activation does not dispatch');
await start.emit('click');
assert.equal(start.disabled, false);
assert.equal(start.textContent, 'Testfeuer stoppen');
assert.equal(hold.disabled, true);
assert.equal(settingsLink.disabled, true);
assert.equal(fireOverlayInPanel(), true);
setActionInView(true);
assert.equal(overlay.hidden, false);
setFireOverlayInPanel(false);
assert.equal(overlay.hidden, true);
setActionInView(false);
assert.equal(overlay.hidden, false);
const [overlayStop, confirm] = overlay.all('button');
assert.equal(overlayStop.disabled, false);
assert.equal(confirm.hidden, true);
scenario('overlay opt-out only applies while the inline action is visible');
await windowEvents.emit('keydown', { key: 'Escape' });
await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(machine.fire.state, 'unknown');
assert.equal(confirm.hidden, false);
assert.equal(confirm.disabled, false);
assert.equal(start.textContent, 'Am Gerät geprüft: Laser ist aus');
assert.match(confirm.className, /\bfire-confirm\b/);
assert.equal(overlay.all('span')[0].attributes.role, 'status');
assert.equal(overlay.all('span')[0].textContent, 'Laserstatus unbekannt – direkt am Gerät abschalten');
scenario('Escape leaves explicit unknown status and local recovery');
frame();
assert.equal(nextFrame, undefined, 'unknown/offscreen state has no visibility polling to discover a modal');
flushMutations();
const modalFirstInDom = new Element('dialog'), modalLastInDom = new Element('dialog');
body.append(modalFirstInDom, modalLastInDom);
modalLastInDom.showModal();
modalFirstInDom.showModal();
flushMutations();
const assertModalReachable = (host: Element) => {
  assert.equal(overlay.hidden, false);
  for (const button of [overlayStop, confirm]) {
    hitStack = [button];
    assert.equal((document.elementFromPoint(500, 400) as unknown as Element)?.tag, 'button',
      'a visible fallback button must hit the button, not an inert modal backdrop');
  }
  assert.equal(overlay.parentElement, host, 'fallback must belong to the actual top modal, not the last dialog in DOM order');
  assert.equal(machine.fire.state, 'unknown', 'moving the fallback must not acknowledge or alter Fire state');
};
assertModalReachable(modalFirstInDom);
assert.equal(document.activeElement as unknown as Element, modalFirstInDom, 'hosting must not steal the new modal\'s focus');
assert.equal(overlayStop.attributes.type, 'button', 'modal hosting must not turn Stop into a form submit action');
assert.equal(confirm.attributes.type, 'button');
assert.equal(nextFrame, undefined, 'modal detection must not restart offscreen polling');
assert.equal(flushMutations(), 0, 'settled modal hosting must not mutate the DOM repeatedly');
overlay.remove();
flushMutations();
assertModalReachable(modalFirstInDom);
scenario('static unknown/offscreen fallback Stop and Confirm escape body inertness in the actual top modal');
const nestedModal = new Element('dialog');
modalFirstInDom.append(nestedModal);
nestedModal.showModal();
flushMutations();
assertModalReachable(nestedModal);
nestedModal.close();
flushMutations();
assertModalReachable(modalFirstInDom);
modalFirstInDom.close();
flushMutations();
assertModalReachable(modalLastInDom);
modalLastInDom.close();
flushMutations();
assert.equal(overlay.parentElement, body, 'closing the last modal restores the original overlay parent');
scenario('nested modal close restores the previous active modal, then the original body host');
modalLastInDom.showModal();
modalFirstInDom.showModal();
flushMutations();
assertModalReachable(modalFirstInDom);
modalFirstInDom.remove();
flushMutations();
assertModalReachable(modalLastInDom);
const removedContainer = new Element('div');
body.append(removedContainer);
removedContainer.append(modalLastInDom);
flushMutations();
removedContainer.remove();
flushMutations();
assert.equal(overlay.parentElement, body, 'removing a modal ancestor must rescue the existing fallback into its original host');
assert.equal(overlay.all('button')[0], overlayStop, 'hosting preserves existing controls and handlers');
assert.equal(overlay.all('button')[1], confirm);
assert.equal(nextFrame, undefined);
assert.equal(flushMutations(), 0);
hitStack = [start];
scenario('direct modal removal and ancestor removal rescue the same fallback without polling or mutation feedback');
await confirm.emit('click', { isTrusted: false });
assert.equal(machine.fire.state, 'unknown');
await start.emit('click');
assert.equal(overlay.hidden, true);
assert.equal(machine.fire.state, 'idle');
assert.equal(start.textContent, 'Testfeuer starten');
scenario('only trusted physical-off acknowledgement releases lock');

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
await start.emit('click');
await start.emit('click');
assert.equal(machine.fire.state, 'unknown');
await start.emit('click');
assert.equal(machine.fire.state, 'idle');
scenario('main button stops, then requires a separate confirmation');

await start.emit('click');
assert.equal(machine.fire.state, 'firing');
const firingModal = new Element('dialog');
body.append(firingModal);
firingModal.showModal();
flushMutations();
hitStack = [overlayStop];
assert.equal(document.elementFromPoint(500, 400) as unknown as Element, overlayStop);
await overlayStop.emit('click');
await settle();
assertModalReachable(firingModal);
await confirm.emit('click');
assert.equal(machine.fire.state, 'idle', 'the original trusted Confirm handler still releases the lock inside a modal');
assert.equal(overlay.parentElement, body);
assert.equal(overlay.hidden, true);
assert.equal(firingModal.modal, true, 'the Fire buttons must not close the host modal');
firingModal.close();
firingModal.remove();
flushMutations();
hitStack = [start];
scenario('the same modal-hosted Stop and trusted Confirm handlers stop and acknowledge a simulated session without submitting or closing the modal');

seconds.value = '0.03';
await seconds.emit('input');
const timedStart = start.emit('click');
await start.emit('pointerdown', { isPrimary: true, button: 0 });
await timedStart;
await new Promise((resolve) => setTimeout(resolve, 60));
await start.emit('click', { detail: 1 });
assert.equal(machine.fire.state, 'unknown');
assert.equal(start.textContent, 'Am Gerät geprüft: Laser ist aus');
await start.emit('pointerdown', { isPrimary: true, button: 0 });
await start.emit('click', { detail: 1 });
assert.equal(machine.fire.state, 'idle');
seconds.value = '2.5';
await seconds.emit('input');
scenario('expiry switches to confirmation, without treating a press on Stop as an acknowledgement');

const commandsBeforeHoldClick = sent.length;
await hold.emit('click');
await hold.emit('keydown', { code: 'Space', repeat: true });
assert.equal(sent.length, commandsBeforeHoldClick);
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  await hold.emit('pointerdown', { isPrimary: true, button: 0, pointerId: 3 });
  await settle();
  assert.equal(machine.fire.state, 'firing');
  await hold.emit(event, { pointerId: 3 });
  await settle();
  assert.equal(machine.fire.state, 'unknown');
  await start.emit('click');
}
await hold.emit('keydown', { code: 'Space' });
await settle();
assert.equal(machine.fire.state, 'firing');
await hold.emit('keyup', { code: 'Space' });
await settle();
assert.equal(machine.fire.state, 'unknown');
await start.emit('click');
scenario('hold stops on pointer release, cancellation, capture loss, or Space release');

setActionInView(true);
await hold.emit('keydown', { code: 'Space' });
await settle();
assert.equal(machine.fire.state, 'firing');
setActionInView(false);
await settle();
assert.equal(machine.fire.state, 'unknown');
assert.equal(overlay.hidden, false);
await start.emit('click');
scenario('leaving the visible panel during a hold requests stop and restores the overlay');

for (const type of ['co2', 'ir', 'fiber', undefined] as const) {
  d = { ...d, laser: type === undefined ? undefined : { type } };
  panel.refresh();
  assert.equal(start.disabled, false);
  assert.equal(hold.disabled, false);
}
scenario('CO2, IR, fiber and unspecified sources use the same start and hold controls');
await start.emit('click');
await windowEvents.emit('blur');
await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(machine.fire.state, 'unknown');
assert.equal(overlay.hidden, false);
scenario('loss of focus ends session without claiming shutdown');
const draft = { ...d };
const settings = fireSettings(draft);
assert.equal(settings.save(), false);
assert.equal(draft.fireMaxPower, d.fireMaxPower);
scenario('already-open Fire settings cannot save while session is locked');
machine.connected = false;
(machine as unknown as { emit(e: { type: 'connection' }): void }).emit({ type: 'connection' });
assert.equal(overlayStop.disabled, true);
assert.match(overlay.all('span')[1].textContent, /keine lokale Verbindung/);
assert.equal(confirm.disabled, false);
await confirm.emit('click');
assert.equal(machine.fire.locked, false);
scenario('disconnected overlay disables software stop with reason but permits physical-off acknowledgement');
const fields = new Element('div');
fields.append(...settings.rows as unknown as Element[]);
assert.ok(fields.all('div').some((el) => el.children.includes(fireWarning())));
const settingsInputs = fields.all('input').filter((el) => el.attributes.inputmode === 'decimal');
assert.equal(settingsInputs.length, 2);
for (const input of settingsInputs) {
  const original = input.value;
  for (const value of ['', '-1', '0', 'NaN', 'Infinity', '99999', '0,5,1', '0.5x']) {
    input.value = value;
    await input.emit('input');
    assert.equal(settings.save(), false, value);
    assert.equal(input.attributes['aria-invalid'], 'true');
  }
  input.value = original;
  await input.emit('input');
}
settingsInputs[0].value = '0,5';
settingsInputs[1].value = '4.5';
assert.equal(settings.save(), true);
assert.equal(draft.fireMaxPower, 0.5);
assert.equal(draft.fireMaxSeconds, 4.5);
scenario('Fire-specific settings reject invalid visible drafts, display exact opt-in warning and save valid values');
machine.fire.confirmOff();
console.log(`${scenarios} individually reported fire UI scenarios passed (in-memory DOM/transport; no hardware)`);
