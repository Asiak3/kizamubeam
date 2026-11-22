// Regression tests for progress feedback when installing/updating extensions from the catalog.
// Run: npm run test:catalog
import './core-fixtures-env';
import { strict as assert } from 'node:assert';

const g = globalThis as Record<string, unknown>;
const mem = new Map<string, string>([['kizamubeam.lang', 'de']]);
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

class FakeClassList {
  private set = new Set<string>();
  sync(name: string) {
    this.set = new Set(name.split(/\s+/).filter(Boolean));
  }
  add(...names: string[]) {
    for (const n of names) this.set.add(n);
  }
  remove(...names: string[]) {
    for (const n of names) this.set.delete(n);
  }
  toggle(name: string, force?: boolean) {
    if (force === undefined) {
      if (this.set.has(name)) this.set.delete(name);
      else this.set.add(name);
    } else if (force) this.set.add(name);
    else this.set.delete(name);
  }
  contains(name: string) {
    return this.set.has(name);
  }
  toString() {
    return [...this.set].join(' ');
  }
}

class FakeEl {
  tagName: string;
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  children: (FakeEl | string)[] = [];
  listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  classList = new FakeClassList();
  hidden = false;
  disabled = false;
  checked = false;
  tabIndex = -1;
  isConnected = true;
  max = 1;
  private _value: string | number = '';
  private _hasValueAttr = false;
  private _text = '';
  onclick: ((ev: unknown) => unknown) | null = null;
  onchange: ((ev: unknown) => unknown) | null = null;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  get className() {
    return this.classList.toString();
  }
  set className(v: string) {
    this.classList.sync(v);
  }
  get value() {
    return this._value;
  }
  set value(v: string | number) {
    this._value = v;
    this._hasValueAttr = true;
    this.attrs.value = String(v);
  }
  get hasValueAttr() {
    return this._hasValueAttr;
  }
  get textContent(): string {
    if (this.children.length) return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
    return this._text;
  }
  set textContent(v: string) {
    this.children = [];
    this._text = v;
  }
  addEventListener(type: string, fn: (...a: unknown[]) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
    if (k === 'value') {
      this._hasValueAttr = true;
      this._value = v;
    }
  }
  removeAttribute(k: string) {
    delete this.attrs[k];
    if (k === 'value') this._hasValueAttr = false;
  }
  append(...kids: (FakeEl | string)[]) {
    this.children.push(...kids);
  }
  replaceChildren(...kids: (FakeEl | string)[]) {
    this.children = [...kids];
    this._text = '';
  }
  querySelectorAll(sel: string): FakeEl[] {
    const classes = sel.split('.').filter(Boolean);
    return walk(this).filter((el) => el !== this && classes.every((c) => el.classList.contains(c)));
  }
  remove() {
    this.isConnected = false;
  }
  showModal() {}
  close() {
    this.fire('close');
  }
  fire(type: string, more: Record<string, unknown> = {}) {
    let prevented = false;
    const ev = {
      target: this,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {},
      ...more,
    };
    if (type === 'click' && this.onclick) this.onclick(ev);
    if (type === 'change' && this.onchange) this.onchange(ev);
    for (const fn of this.listeners[type] ?? []) fn(ev);
    return { prevented };
  }
}

const walk = (el: FakeEl): FakeEl[] => [el, ...el.children.flatMap((c) => (c instanceof FakeEl ? walk(c) : []))];
const findByClass = (root: FakeEl, cls: string) => walk(root).find((e) => e.classList.contains(cls));
const findAllByClass = (root: FakeEl, cls: string) => walk(root).filter((e) => e.classList.contains(cls));
const findButton = (root: FakeEl, text: string) => walk(root).find((e) => e.tagName === 'BUTTON' && e.textContent === text);

const dialogs: FakeEl[] = [];
g.document = {
  documentElement: { lang: 'de' },
  createElement: (tag: string) => new FakeEl(tag),
  body: { append: (el: FakeEl) => dialogs.push(el) },
};
g.alert = (msg: string) => {
  throw new Error(`unexpected alert: ${msg}`);
};

const C = await import('../src/catalog');
const P = await import('../src/packs');
const D = await import('../src/packsDialog');

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const waitFor = async (cond: () => boolean, label: string) => {
  for (let i = 0; i < 150; i++) {
    if (cond()) return;
    await tick();
  }
  throw new Error(`timeout waiting for: ${label}`);
};

const packJson = (id: string, name: string, version: string) =>
  JSON.stringify({
    format: 'kizamubeam-pack',
    id,
    version,
    name: { de: name, en: name },
    devices: [{ name: `${name} Laser`, fw: 'grbl', bedW: 300, bedH: 200 }],
  });

const buildParsedCatalog = async (entries: [string, string][], catalogUrl = 'https://x.test/catalog.json') => {
  const catText = await C.buildCatalog(entries, '2026-11-22T00:00:00Z');
  const cat = C.parseCatalog(catText);
  for (const p of cat.packs) p.catalogUrl = catalogUrl;
  return cat;
};

await test('formatPackBytes und catalogFetchStatus: alle Phasen und Größenbereiche', () => {
  assert.equal(D.formatPackBytes(512, 'de'), '512 B');
  assert.equal(D.formatPackBytes(1536, 'de'), '1,5 KB');
  assert.equal(D.formatPackBytes(250 * 1024, 'de'), '250 KB');
  assert.equal(D.formatPackBytes(1.5 * 1024 * 1024, 'de'), '1,5 MB');

  const connecting = D.catalogFetchStatus('Lochplatte', { phase: 'download', loaded: 0, total: 2048 }, 'de');
  assert.equal(connecting.ratio, null);
  assert.match(connecting.text, /Lochplatte.*wird geladen/);

  const half = D.catalogFetchStatus('Lochplatte', { phase: 'download', loaded: 1024, total: 2048 }, 'de');
  assert.equal(half.ratio, 0.5);
  assert.match(half.text, /50 %/);
  assert.match(half.text, /1 KB \/ 2 KB/);

  const unknownTotal = D.catalogFetchStatus('Lochplatte', { phase: 'download', loaded: 2048, total: 0 }, 'de');
  assert.equal(unknownTotal.ratio, null);
  assert.match(unknownTotal.text, /2 KB/);

  const verify = D.catalogFetchStatus('Lochplatte', { phase: 'verify', loaded: 2048, total: 2048 }, 'de');
  assert.equal(verify.ratio, 1);
  assert.match(verify.text, /wird geprüft/);
});

await test('installPackFile: Fortschrittsbalken während der Installation, kein Status im Fehlerfeld', async () => {
  dialogs.length = 0;
  const text = packJson('de.test.confirm', 'Bestätigungstest', '1.0.0');
  const pending = D.installPackFile('de.test.confirm.kzp', text, true);
  await waitFor(() => dialogs.length === 1, 'install dialog');
  const dlg = dialogs[0];
  const progressBox = findByClass(dlg, 'pack-progress')!;
  const progressText = findByClass(dlg, 'pack-progress-text')!;
  const err = findByClass(dlg, 'error')!;
  assert.ok(progressBox && progressBox.hidden, 'progress starts hidden');

  const okBtn = findButton(dlg, 'Installieren')!;
  const cancelBtn = findButton(dlg, 'Abbrechen')!;
  assert.ok(okBtn && cancelBtn);

  okBtn.fire('click');
  assert.equal(progressBox.hidden, false, 'progress shown when install starts');
  assert.match(progressText.textContent, /wird installiert/);
  assert.equal(err.textContent, '', 'status must not be written into error element');
  assert.equal(okBtn.disabled, true);
  assert.equal(cancelBtn.disabled, true);
  assert.equal(dlg.fire('cancel').prevented, true, 'cancel blocked while installing');

  const installed = await pending;
  assert.equal(installed?.id, 'de.test.confirm');
});

const catalogCards = (dlg: FakeEl) => {
  const visiblePanel = findAllByClass(dlg, 'pack-panel').find((p) => !p.hidden);
  return visiblePanel ? findAllByClass(visiblePanel, 'pack-card') : [];
};

await test('openPacksDialog: Live-Fortschritt beim Installieren aus dem Katalog und Sperre während des Ladens', async () => {
  dialogs.length = 0;
  const text = packJson('de.test.stream', 'Stream-Plugin', '1.0.0');
  const bytes = new TextEncoder().encode(text);
  const mid = Math.floor(bytes.length / 2);
  const cat = await buildParsedCatalog([['de.test.stream.kzp', text]]);

  let releaseSecondChunk!: () => void;
  const secondChunkGate = new Promise<void>((r) => (releaseSecondChunk = r));
  g.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => String(bytes.length) },
    body: {
      getReader() {
        let step = 0;
        return {
          async read() {
            if (step === 0) {
              step = 1;
              return { done: false, value: bytes.slice(0, mid) };
            }
            if (step === 1) {
              await secondChunkGate;
              step = 2;
              return { done: false, value: bytes.slice(mid) };
            }
            return { done: true, value: undefined };
          },
        };
      },
    },
  });

  await D.openPacksDialog(undefined, { loadCatalog: async () => cat });
  const mgrDlg = dialogs[0];
  await waitFor(() => catalogCards(mgrDlg).length === 1, 'catalog card rendered');

  const progressBox = findByClass(mgrDlg, 'pack-progress')!;
  const progressText = findByClass(mgrDlg, 'pack-progress-text')!;
  const progressBar = findByClass(mgrDlg, 'pack-progress-bar')!;
  assert.equal(progressBox.hidden, true, 'progress box hidden before click');

  const cardBtn = walk(catalogCards(mgrDlg)[0]).find((e) => e.tagName === 'BUTTON')!;
  cardBtn.fire('click');

  await waitFor(
    () => !progressBox.hidden && typeof progressBar.value === 'number' && progressBar.value > 0 && progressBar.value < 1,
    'determinate mid-download progress',
  );
  assert.match(progressText.textContent, /Stream-Plugin.*wird geladen.*%/);
  assert.equal(cardBtn.disabled, true);
  assert.equal(cardBtn.textContent, 'Wird geladen …');
  const detailsBtn = walk(findByClass(mgrDlg, 'pack-details')!).find((e) => e.tagName === 'BUTTON')!;
  assert.equal(detailsBtn.disabled, true);
  assert.equal(detailsBtn.textContent, 'Wird geladen …');
  assert.equal(mgrDlg.fire('cancel').prevented, true, 'dialog cancel blocked while downloading');

  releaseSecondChunk();
  await waitFor(() => dialogs.length === 2, 'confirmation dialog opened');
  assert.equal(progressBox.hidden, true, 'catalog progress box hides when confirmation dialog opens');

  const confirmDlg = dialogs[1];
  findButton(confirmDlg, 'Installieren')!.fire('click');
  await waitFor(() => !confirmDlg.isConnected, 'confirmation dialog closed');
  await waitFor(() => findButton(mgrDlg, 'Installiert') !== undefined, 'card updated to Installiert');
  assert.equal(progressBox.hidden, true);
  assert.equal(mgrDlg.fire('cancel').prevented, false, 'dialog cancel allowed again after install');
  mgrDlg.close();
});

await test('openPacksDialog: Fehler beim Laden blendet Fortschritt aus und gibt Knöpfe wieder frei', async () => {
  dialogs.length = 0;
  const text = packJson('de.test.fail', 'Fehler-Plugin', '1.0.0');
  const cat = await buildParsedCatalog([['de.test.fail.kzp', text]]);
  g.fetch = async () => ({ ok: false, status: 500, text: async () => '' });

  await D.openPacksDialog(undefined, { loadCatalog: async () => cat });
  const mgrDlg = dialogs[0];
  await waitFor(() => catalogCards(mgrDlg).length === 1, 'fail card rendered');
  const progressBox = findByClass(mgrDlg, 'pack-progress')!;
  const err = findByClass(mgrDlg, 'error')!;

  const cardBtn = walk(catalogCards(mgrDlg)[0]).find((e) => e.tagName === 'BUTTON')!;
  cardBtn.fire('click');

  await waitFor(() => /500/.test(err.textContent), 'error shown');
  assert.equal(progressBox.hidden, true, 'progress hidden after error');
  const refreshedBtn = walk(catalogCards(mgrDlg)[0]).find((e) => e.tagName === 'BUTTON')!;
  assert.equal(refreshedBtn.disabled, false, 'install button re-enabled after error');
  assert.equal(refreshedBtn.textContent, 'Installieren');
  mgrDlg.close();
});

await test('openPacksDialog: Alle aktualisieren zeigt Schritt-Fortschritt und aktualisiert alle Pakete', async () => {
  dialogs.length = 0;
  await P.installPack(packJson('de.test.up1', 'Paket Eins', '1.0.0'), { verified: true });
  await P.installPack(packJson('de.test.up2', 'Paket Zwei', '1.0.0'), { verified: true });
  const v2a = packJson('de.test.up1', 'Paket Eins', '2.0.0');
  const v2b = packJson('de.test.up2', 'Paket Zwei', '2.0.0');
  const cat = await buildParsedCatalog([
    ['de.test.up1.kzp', v2a],
    ['de.test.up2.kzp', v2b],
  ]);

  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((r) => (releaseFirst = r));
  const files = new Map<string, string>([
    ['https://x.test/de.test.up1.kzp', v2a],
    ['https://x.test/de.test.up2.kzp', v2b],
  ]);
  g.fetch = async (url: string) => {
    const content = files.get(url) ?? '';
    const bytes = new TextEncoder().encode(content);
    if (url.endsWith('up1.kzp')) await firstGate;
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(bytes.length) },
      body: {
        getReader() {
          let done = false;
          return {
            async read() {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: bytes };
            },
          };
        },
      },
    };
  };

  await D.openPacksDialog(undefined, { loadCatalog: async () => cat });
  const mgrDlg = dialogs[0];
  await waitFor(() => findButton(mgrDlg, 'Alle aktualisieren (2)') !== undefined, 'updateAll button visible');

  const progressBox = findByClass(mgrDlg, 'pack-progress')!;
  const progressText = findByClass(mgrDlg, 'pack-progress-text')!;
  const updateAllBtn = findButton(mgrDlg, 'Alle aktualisieren (2)')!;
  updateAllBtn.fire('click');

  await waitFor(() => !progressBox.hidden && /1 von 2/.test(progressText.textContent), 'step 1 of 2 shown');
  assert.equal(updateAllBtn.disabled, true);
  assert.equal(updateAllBtn.textContent, 'Wird aktualisiert …');

  releaseFirst();
  await waitFor(() => progressBox.hidden, 'updateAll finished and progress hidden');
  const versions = Object.fromEntries(P.allPacks().map((ip) => [ip.pack.id, ip.pack.version]));
  assert.equal(versions['de.test.up1'], '2.0.0');
  assert.equal(versions['de.test.up2'], '2.0.0');
  mgrDlg.close();
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
