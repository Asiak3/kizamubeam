// Tests für den Font-Manager: Schriftliste lesen, Schnitte wählen, suchen, fehlende Schriften finden.
// Aufruf: npm run test:fonts
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const { parseCatalog, pickVariants, searchFonts, findFont, fontsInDoc, missingFonts, styleInfo, fontFavorites, setFontFavorite } = await import('../src/fontCatalog');
const { newDoc } = await import('../src/model');

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

// Ausschnitt im Format von fonts.google.com/metadata/fonts
const GOOGLE = `)]}'
{"axisRegistry":[],"familyMetadataList":[
 {"family":"Open Sans","category":"Sans Serif","subsets":["menu","latin","latin-ext","greek"],"fonts":{"300":{},"400":{},"700":{},"800":{},"400i":{},"700i":{}},"designers":["Steve Matteson"],"popularity":2},
 {"family":"Lobster","category":"Display","subsets":["menu","latin"],"fonts":{"400":{}},"designers":["Impallari Type"],"popularity":40},
 {"family":"Buda","category":"Display","subsets":["latin"],"fonts":{"300":{}},"popularity":900},
 {"family":"Roboto Slab","category":"Serif","subsets":["latin"],"fonts":{"100":{},"400":{},"900":{}},"popularity":10},
 {"family":"Space Mono","category":"Monospace","subsets":["latin"],"fonts":{"400":{},"700":{},"400i":{},"700i":{}},"popularity":80},
 {"category":"Serif"}
]}`;

// Ausschnitt im Format von api.fontsource.org/v1/fonts
const FONTSOURCE = JSON.stringify([
  { id: 'abeezee', family: 'ABeeZee', subsets: ['latin'], weights: [400], styles: ['italic', 'normal'], category: 'sans-serif', type: 'google' },
  { id: 'caveat', family: 'Caveat', subsets: ['latin', 'cyrillic'], weights: [400, 500, 600, 700], styles: ['normal'], category: 'handwriting', type: 'google' },
  { id: 'other', family: 'Other', weights: [400], styles: ['normal'], category: 'serif', type: 'other' },
]);

test('Google-Liste lesen (mit Schutzpräfix, ohne „menu“, kaputte Einträge weg)', () => {
  const l = parseCatalog('google', GOOGLE);
  assert.equal(l.length, 5);
  const os = l[0];
  assert.equal(os.family, 'Open Sans');
  assert.equal(os.category, 'sans');
  assert.deepEqual(os.subsets, ['latin', 'latin-ext', 'greek']);
  assert.equal(os.popularity, 2);
  assert.equal(os.designers, 'Steve Matteson');
  assert.ok(os.variants.includes('700i'));
  assert.equal(l[4].category, 'mono');
});

test('Fontsource-Liste lesen (nur Google-Schriften)', () => {
  const l = parseCatalog('fontsource', FONTSOURCE);
  assert.deepEqual(l.map((f) => f.family), ['ABeeZee', 'Caveat']);
  assert.deepEqual(l[0].variants.sort(), ['400', '400i']);
  assert.equal(l[1].category, 'handwriting');
  assert.equal(l[1].variants.length, 4);
});

test('Unlesbare Liste wirft', () => {
  assert.throws(() => parseCatalog('google', '<html>'));
});

test('Schnitte: normal ≈ 400, fett ≈ 700, je gerade und kursiv', () => {
  const l = parseCatalog('google', GOOGLE);
  assert.deepEqual(pickVariants(findFont(l, 'open sans')), [[false, 400], [false, 700], [true, 400], [true, 700]]);
  assert.deepEqual(pickVariants(findFont(l, 'Lobster')), [[false, 400]]);
  // Nur 300 vorhanden: der nächstliegende Schnitt
  assert.deepEqual(pickVariants(findFont(l, 'Buda')), [[false, 300]]);
  // 100/400/900: fett nimmt den nächstliegenden zu 700 (900)
  assert.deepEqual(pickVariants(findFont(l, 'Roboto Slab')), [[false, 400], [false, 900]]);
  // Ohne Liste: die üblichen vier
  assert.equal(pickVariants(undefined).length, 4);
});

test('Fett/kursiv-Angabe für die Liste', () => {
  const l = parseCatalog('google', GOOGLE);
  assert.deepEqual(styleInfo(findFont(l, 'Lobster')!), { bold: false, italic: false });
  assert.deepEqual(styleInfo(findFont(l, 'Space Mono')!), { bold: true, italic: true });
});

test('Suche: Treffer am Namensanfang zuerst, sonst nach Beliebtheit; Art und Auswahl filtern', () => {
  const l = parseCatalog('google', GOOGLE);
  assert.deepEqual(searchFonts(l, {}).map((f) => f.family), ['Open Sans', 'Roboto Slab', 'Lobster', 'Space Mono', 'Buda']);
  assert.deepEqual(searchFonts(l, { sort: 'name' }).map((f) => f.family), ['Buda', 'Lobster', 'Open Sans', 'Roboto Slab', 'Space Mono']);
  assert.deepEqual(searchFonts(l, { query: 's' }).map((f) => f.family), ['Space Mono', 'Open Sans', 'Roboto Slab', 'Lobster']);
  assert.deepEqual(searchFonts(l, { category: 'display' }).map((f) => f.family), ['Lobster', 'Buda']);
  assert.deepEqual(searchFonts(l, { query: 'impallari' }).map((f) => f.family), ['Lobster']);
  assert.deepEqual(searchFonts(l, { only: new Set(['lobster', 'BUDA']) }).map((f) => f.family), ['Lobster', 'Buda']);
  assert.deepEqual(searchFonts(l, { subset: 'latin-ext' }).map((f) => f.family), ['Open Sans']);
});

test('Schriften im Projekt: alle Seiten und Gruppen, ohne Doppelte', () => {
  const d = newDoc();
  const text = (font: string) => ({ id: Math.random(), layer: 0, m: [1, 0, 0, 1, 0, 0], shape: { kind: 'text', text: 'A', font, size: 5, bold: false, italic: false, hSpace: 0, vSpace: 0, align: 'left', upper: false } });
  d.pages[0].objs.push(text('Lobster') as never, { id: 9, layer: 0, m: [1, 0, 0, 1, 0, 0], shape: { kind: 'group', children: [text('Open Sans'), text('Lobster')] } } as never);
  d.pages.push({ name: 'Seite 2', objs: [text('Space Mono') as never] });
  assert.deepEqual(fontsInDoc(d), ['Lobster', 'Open Sans', 'Space Mono']);
});

test('Fehlende Schriften: Groß-/Kleinschreibung egal', () => {
  assert.deepEqual(missingFonts(['Lobster', 'open sans', 'Arial'], ['Arial', 'Open Sans']), ['Lobster']);
  assert.deepEqual(missingFonts([], ['Arial']), []);
});

test('Favoriten: hinzufügen, doppelt egal, entfernen', () => {
  const mem = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) };
  setFontFavorite('Lobster', true);
  setFontFavorite('Arial', true);
  setFontFavorite('lobster', true);
  assert.deepEqual(fontFavorites(), ['Arial', 'lobster']);
  setFontFavorite('LOBSTER', false);
  assert.deepEqual(fontFavorites(), ['Arial']);
});

// requestLocalFonts: Browser-API gemockt (window ist hier globalThis, navigator ersetzbar)
const { requestLocalFonts } = await import('../src/fonts');
async function atest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}
const gg = globalThis as Record<string, unknown>;
const realNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, enumerable: true });
}
function mockBrowser(state: 'granted' | 'denied' | 'prompt' | null, query?: () => Promise<unknown[]>) {
  if (query) gg.queryLocalFonts = query;
  else delete gg.queryLocalFonts;
  if (state === null) {
    setNavigator({ language: 'de', languages: ['de'] });
  } else {
    setNavigator({ language: 'de', languages: ['de'], permissions: { query: async () => ({ state }) } });
  }
}

await atest('Local-Fonts: ohne API kein Zugriff', async () => {
  mockBrowser(null);
  assert.equal(await requestLocalFonts(), false);
});

await atest('Local-Fonts: abgelehnt bleibt abgelehnt (kein Prompt)', async () => {
  let called = 0;
  mockBrowser('denied', async () => {
    called++;
    return [];
  });
  assert.equal(await requestLocalFonts(), false);
  assert.equal(called, 0);
});

await atest('Local-Fonts: erteilt nutzt Zugriff ohne Rückfrage', async () => {
  let called = 0;
  mockBrowser('granted', async () => {
    called++;
    return [];
  });
  assert.equal(await requestLocalFonts(), true);
  assert.equal(called, 0);
});

await atest('Local-Fonts: Rückfrage löst Zugriff aus, Abbruch bleibt false', async () => {
  mockBrowser('prompt', async () => []);
  assert.equal(await requestLocalFonts(), true);
  mockBrowser('prompt', async () => {
    throw new DOMException('aborted', 'AbortError');
  });
  assert.equal(await requestLocalFonts(), false);
});

await atest('Local-Fonts: ohne Permissions-API direkt versuchen', async () => {
  mockBrowser(null, async () => []);
  assert.equal(await requestLocalFonts(), true);
  mockBrowser(null, async () => {
    throw new Error('kein Zugriff');
  });
  assert.equal(await requestLocalFonts(), false);
});
if (realNavigatorDesc) Object.defineProperty(globalThis, 'navigator', realNavigatorDesc);
delete gg.queryLocalFonts;

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
