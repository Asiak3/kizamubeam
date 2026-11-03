// Tests für Hilfslinien (eigene Ebene statt Objekte auf T1). Aufruf: npm run test:guides
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const { cleanGuides, legacyGuide, loadDoc, newDoc, translate } = await import('../src/model');
type Obj = import('../src/model').Obj;

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

/** So hat Version 2.0.0-rc.1 eine Hilfslinie angelegt */
const oldGuide = (axis: 'x' | 'y', v: number, w = 400, h = 400): Obj => ({
  id: 1, m: axis === 'y' ? translate(0, v) : translate(v, 0), layer: 30,
  shape: { kind: 'path', subs: [{ nodes: axis === 'y' ? [{ x: 0, y: 0 }, { x: w, y: 0 }] : [{ x: 0, y: 0 }, { x: 0, y: h }], closed: false }] },
});

test('Fehlerhafte Einträge fallen weg', () => {
  assert.deepEqual(cleanGuides([{ axis: 'x', v: 10 }, { axis: 'z', v: 1 }, { axis: 'y', v: NaN }, { axis: 'y', v: '5' }, null, { axis: 'y', v: 2.5 }]), [
    { axis: 'x', v: 10 },
    { axis: 'y', v: 2.5 },
  ]);
  assert.deepEqual(cleanGuides('x'), []);
});

test('Hilfslinien überstehen Speichern und Öffnen', () => {
  const d = newDoc();
  d.guides = [{ axis: 'x', v: 12.5 }, { axis: 'y', v: 100 }];
  d.guidesLocked = true;
  const back = loadDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(back.guides, d.guides);
  assert.equal(back.guidesLocked, true);
  assert.equal(back.guidesHidden, undefined);
});

test('Alte Hilfslinien auf T1 werden zu echten Hilfslinien, auf allen Seiten', () => {
  const d = newDoc();
  const keep: Obj = { id: 2, m: translate(5, 5), layer: 0, shape: { kind: 'path', subs: [{ nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false }] } };
  d.pages[0].objs = [oldGuide('y', 50), keep, oldGuide('x', 120)];
  d.pages.push({ name: 'Seite 2', objs: [oldGuide('y', 50), oldGuide('y', 75)] });
  const back = loadDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(back.guides, [
    { axis: 'y', v: 50 },
    { axis: 'x', v: 120 },
    { axis: 'y', v: 75 },
  ]);
  assert.equal(back.pages[0].objs.length, 1);
  assert.equal(back.pages[0].objs[0].id, 2);
  assert.equal(back.pages[1].objs.length, 0);
});

test('Gewöhnliche Linien auf T1 bleiben Objekte', () => {
  const bed = { w: 400, h: 400 };
  assert.ok(legacyGuide(oldGuide('y', 10), bed));
  assert.equal(legacyGuide({ ...oldGuide('y', 10), name: 'Mittellinie' }, bed), null);
  assert.equal(legacyGuide({ ...oldGuide('y', 10), layer: 31 }, bed), null);
  assert.equal(legacyGuide(oldGuide('y', 10, 300), bed), null);
  assert.equal(legacyGuide({ ...oldGuide('y', 10), m: [1, 0, 0, 1, 3, 10] }, bed), null);
  assert.equal(legacyGuide({ ...oldGuide('x', 10), m: [2, 0, 0, 1, 10, 0] }, bed), null);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
