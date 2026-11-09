// Gravur an Einzelteilen (Bauteil-Generatoren ohne Baugruppe) bleibt beim Einfügen und Ändern erhalten. Aufruf: npm run test:generators
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { EditorGenerators, isMarkGroup } from '../src/editor/generators';
import { buildGen, defaultParams, getGenerator } from '../src/generators/index';
import { defaultLayer, loadDoc } from '../src/model';
import type { Obj, SubPath } from '../src/model';

const gear = getGenerator('gear')!;
assert.equal(gear.kind, 'part');
const mark = (w: number): SubPath[] => [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: w, y: 0 }] }];
const withMarks = (marks?: SubPath[]) => {
  const r = buildGen(gear, defaultParams(gear));
  return { ...r, parts: r.parts.map((p) => (marks ? { ...p, marks } : p)) };
};

const ed = Object.create(EditorGenerators.prototype);
ed.doc = loadDoc({ bed: { w: 500, h: 500 }, objs: [], layers: {} });
ed.currentLayer = 0; ed.agentCall = true; ed.sel = [];
ed.snapshot = () => {}; ed.touch = () => {}; ed.emit = () => {}; ed.setSel = (o: Obj[]) => (ed.sel = o);
ed.layer = (i: number) => ed.doc.layers[i] ?? (ed.doc.layers[i] = defaultLayer(i));

const marks = (g: Obj) => (g.shape.kind === 'group' ? g.shape.children.filter((c) => c.shape.kind === 'path' && c.shape.mark) : []);

// Einfügen: Teil + Gravur als Gruppe, Gravur auf eigenem Layer
const [grp] = ed.addGen(withMarks(mark(5)), 0, { x: 100, y: 100 }) as Obj[];
assert.ok(isMarkGroup(grp), 'Einzelteil mit marks wird zur Gruppe aus Teil und Gravur');
assert.equal(marks(grp).length, 1);
assert.notEqual(marks(grp)[0].layer, 0, 'Gravur liegt auf eigenem Layer');
assert.deepEqual((marks(grp)[0].shape as { subs: SubPath[] }).subs, mark(5));

// Ohne marks bleibt das Teil ein einzelnes Objekt
const [plain] = ed.addGen(withMarks(), 0, { x: 200, y: 200 }) as Obj[];
assert.equal(plain.shape.kind, 'gen');

// Ändern: Gravur wird nachgeführt, dann entfernt, dann am obersten Objekt neu angelegt
const part = (grp.shape as { children: Obj[] }).children.find((c) => c.shape.kind === 'gen')!;
ed.updateGen(part, withMarks(mark(9)));
assert.deepEqual((marks(grp)[0].shape as { subs: SubPath[] }).subs, mark(9));
ed.updateGen(part, withMarks());
assert.equal(marks(grp).length, 0);
ed.updateGen(plain, withMarks(mark(3)));
const regrouped = ed.doc.objs.find((o: Obj) => isMarkGroup(o) && o !== grp);
assert.ok(regrouped, 'nachträglich hinzugekommene Gravur legt Gruppe an');
console.log('single-part marks: ok');
