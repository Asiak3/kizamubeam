// Tests für Vorlagen: Angaben bereinigen, Dateinamen, Vorlagen-Datei und Vorlagen-Ordner (Browser-Speicher).
// Aufruf: npm run test:templates
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const g = globalThis as Record<string, unknown>;
const mem = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const T = await import('../src/templates');
const P = await import('../src/params');
const vt = await import('../src/vartext');
const { loadDoc, newDoc } = await import('../src/model');
const { t } = await import('../src/i18n');
import type { ProjectParam } from '../src/params';

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

const params: ProjectParam[] = [
  { name: 'Name', type: 'text', value: 'Anna' },
  { name: 'Breite', type: 'number', value: 60, min: 30, max: 120 },
  { name: 'Dicke', type: 'number', value: 3 },
  { name: 'Loch', type: 'bool', value: true },
];

await test('normalizeTemplate: unbekannte und doppelte Felder fallen weg, Namen wie im Projekt', () => {
  const info = T.normalizeTemplate(
    { title: '  Schild ', fields: [{ name: 'breite', slider: true }, 'Name', { name: 'Gibtsnicht' }, { name: 'BREITE' }, { name: 'Dicke', slider: true, label: 'Dicke' }] },
    params,
  );
  assert.deepEqual(info, { title: 'Schild', fields: [{ name: 'Breite', slider: true }, { name: 'Name' }, { name: 'Dicke' }] });
});

await test('normalizeTemplate: ohne Titel „Vorlage“, Beschreibung und Vorschau bleiben', () => {
  const info = T.normalizeTemplate({ description: ' Text ', preview: '<svg/>', fields: 'x' }, params);
  assert.deepEqual(info, { title: t('Vorlage'), description: 'Text', preview: '<svg/>', fields: [] });
  assert.equal(T.normalizeTemplate({ preview: 'javascript:1' }, params).preview, undefined);
});

await test('defaultTemplate und templateFields: ohne Angaben alle Parameter, Schieberegler wo möglich', () => {
  const d = newDoc();
  d.params = params;
  assert.deepEqual(T.defaultTemplate(d).fields, [{ name: 'Name' }, { name: 'Breite', slider: true }, { name: 'Dicke' }, { name: 'Loch' }]);
  d.template = { title: 'X', fields: [{ name: 'Loch' }, { name: 'Name', label: 'Dein Name' }] };
  assert.deepEqual(T.templateFields(d).map(([p, f]) => [p.name, f.label]), [['Loch', undefined], ['Name', 'Dein Name']]);
});

await test('templateFileName: keine Pfadzeichen, Endung .kzt', () => {
  assert.equal(T.templateFileName('Schild für Anna'), 'Schild für Anna.kzt');
  assert.equal(T.templateFileName('../a/b:c*?'), 'a b c.kzt');
  assert.equal(T.templateFileName('  ...  '), `${t('Vorlage')}.kzt`);
});

await test('templateJson: Projektdatei mit bereinigten Angaben und Vorschau, wieder ladbar', () => {
  const d = newDoc();
  d.params = params;
  const json = T.templateJson(JSON.stringify(d), { title: 'S', fields: [{ name: 'Name' }, { name: 'X' }], preview: '<svg old/>' }, '<svg new/>');
  const back = loadDoc(JSON.parse(json));
  assert.deepEqual(back.template, { title: 'S', fields: [{ name: 'Name' }], preview: '<svg new/>' });
  assert.equal(back.params?.length, 4);
});

await test('Vorlagen-Ordner im Browser: schreiben, auflisten, lesen, löschen', async () => {
  const d = newDoc();
  d.params = params;
  const json = T.templateJson(JSON.stringify(d), { title: 'Schild', description: 'Für Namen', fields: [{ name: 'Name' }] }, '<svg/>');
  await T.writeTemplate('Schild.kzt', json, false);
  await assert.rejects(() => T.writeTemplate('Schild.kzt', json, false));
  await T.writeTemplate('Schild.kzt', json, true);
  mem.set('kizamubeam.templates', JSON.stringify({ ...JSON.parse(mem.get('kizamubeam.templates')!), 'Kaputt.kzt': '{' }));
  const list = await T.listTemplates();
  assert.deepEqual(list.map((e) => [e.file, e.info.title, !!e.broken]), [['Kaputt.kzt', 'Kaputt', true], ['Schild.kzt', 'Schild', false]]);
  assert.equal(list[1].info.description, 'Für Namen');
  assert.equal(await T.readTemplate('Schild.kzt'), json);
  await T.deleteTemplate('Schild.kzt');
  await assert.rejects(() => T.readTemplate('Schild.kzt'));
});

await test('guessColumns und tableRows: Spalten nach Name oder Beschriftung, Zahlen mit Komma, Ja/Nein', () => {
  const map = T.guessColumns(['NAME', 'Breite (mm)', 'Dein Loch', 'Loch?'], params, [{ name: 'Loch', label: 'Dein Loch' }]);
  assert.deepEqual(map, { Name: 0, Loch: 2 });
  const rows = T.tableRows([['Anna', '', 'ja'], ['Bernd', '', '0'], ['Clara']], { Name: 0, Breite: 1, Loch: 2 }, params);
  assert.deepEqual(rows, [{ Name: 'Anna', Loch: true }, { Name: 'Bernd', Loch: false }, { Name: 'Clara', Loch: false }]);
  assert.deepEqual(T.tableRows([['x', '90,5']], { Breite: 1 }, params), [{ Breite: 90.5 }]);
});

const { builtinTemplates } = await import('../src/builtinTemplates');
const { usesName } = await import('../src/params');
await test('Mitgelieferte Vorlagen: gültige Dateien, alle Formeln nennen nur vorhandene Parameter', async () => {
  const list = builtinTemplates();
  assert.deepEqual(list.map((b) => b.id), ['keyfob', 'nametag', 'labelbox']);
  for (const b of list) {
    const d = loadDoc(JSON.parse(await b.json()));
    const names = (d.params ?? []).map((p) => p.name);
    assert.ok(d.template && d.template.fields.length >= 3, b.id);
    for (const f of d.template!.fields) assert.ok(names.includes(f.name), `${b.id}: Feld ${f.name}`);
    assert.equal(d.template!.preview, undefined);
    // Jede Formel muss sich mit den Parametern auswerten lassen
    const scope = P.scopeOf(d.params);
    for (const o of d.objs) {
      for (const v of Object.values(o.bind ?? {})) if (typeof v === 'string') P.evaluate(v, scope);
      if (o.showIf) P.evaluate(o.showIf, scope);
      if (o.shape.kind === 'gen') for (const v of Object.values(o.shape.bind ?? {})) P.evaluate(v, scope);
    }
    assert.ok(names.some((n) => d.objs.some((o) => o.shape.kind === 'text' && usesName(o.shape.text, n, true))), `${b.id}: Text mit Platzhalter`);
  }
});

const { bakeObjs } = await import('../src/editor/series');
await test('bakeObjs: Platzhalter ersetzt (Klammern bleiben Text), Formeln weg, Bedingung ausgewertet', () => {
  const scope = P.scopeOf([{ name: 'Name', type: 'text', value: 'Clara {Chefin}' }, { name: 'Loch', type: 'bool', value: false }]);
  const objs = [
    { id: 1, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'text', text: 'Hallo {Name}', font: 'Arial', size: 5, bold: false, italic: false, upper: false, align: 'left', hSpace: 0, vSpace: 0 }, bind: { size: 'Name' } },
    { id: 2, m: [1, 0, 0, 1, 0, 0], layer: 1, shape: { kind: 'ellipse', rx: 1, ry: 1 }, showIf: 'Loch' },
    { id: 3, m: [1, 0, 0, 1, 0, 0], layer: 1, shape: { kind: 'rect', w: 1, h: 1, r: 0 }, showIf: '!Loch' },
  ] as never;
  const out = bakeObjs(objs, scope);
  assert.equal(out.length, 2);
  assert.equal((out[0].shape as { text: string }).text, 'Hallo Clara {{Chefin}}');
  assert.equal(out[0].bind, undefined);
  assert.equal(out[1].showIf, undefined);
  assert.notEqual(out[0].id, 1);
});

await test('Tabelle: Einfügen aus Tabellenprogramm, CSV-Export, Ausgangstabelle', () => {
  const tb = { header: ['Name', 'Breite'], rows: [['Anna', '60']] };
  assert.equal(T.pasteIntoTable(tb, 0, 0, 'nur eins'), false);
  assert.ok(T.pasteIntoTable(tb, 0, 1, '70\tja\n80\n'));
  assert.deepEqual(tb, { header: ['Name', 'Breite', ''], rows: [['Anna', '70', 'ja'], ['', '80', '']] });
  assert.ok(T.pasteIntoTable(tb, -1, 0, 'A;B'));
  assert.deepEqual(tb.header, ['A', 'B', '']);
  assert.equal(T.tableToCsv({ header: ['a', 'b'], rows: [['x;y', 'he said "hi"'], [' z', '1']] }), 'a;b\r\n"x;y";"he said ""hi"""\r\n" z";1\r\n');
  const { parseCsv } = vt;
  assert.deepEqual(parseCsv(T.tableToCsv({ header: ['a', 'b'], rows: [['x;y', 'q"']] })), [['a', 'b'], ['x;y', 'q"']]);
  const d = newDoc();
  d.params = params;
  d.template = { title: 'S', fields: [{ name: 'Name' }, { name: 'Loch' }] };
  assert.deepEqual(T.initialSeriesTable(d), { header: ['Name', 'Loch'], rows: [['Anna', t('ja')]] });
  d.seriesTable = { header: ['Name'], rows: [['Bernd']] };
  assert.deepEqual(T.initialSeriesTable(d), { header: ['Name'], rows: [['Bernd']] });
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
