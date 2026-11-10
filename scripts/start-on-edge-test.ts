// Start point tool: clicking an edge of a closed contour inserts a node there and makes it the start point (#149).
// Run: npm run test:start-edge
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, defaultLayer } = await import('../src/model');
const { shapeSubs } = await import('../src/geom');
type Obj = import('../src/model').Obj;

function editor(objs: Obj[]) {
  const ed = Object.create(Editor.prototype) as import('../src/editor').Editor;
  Object.assign(ed, {
    doc: newDoc(), sel: [], tool: 'start', history: new History(), listeners: new Set(), isolation: null,
    nodeSel: new Set(), nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), drag: null, draft: null, snapVer: 0,
    alignGuides: [], jointPicks: [], snapGrid: false, snapObjects: false, startHover: null, trimCache: null,
    currentLayer: 0, view: { zoom: 1, ox: 0, oy: 0 }, canvas: { style: {} },
  });
  ed.doc.objs = objs;
  ed.doc.layers[0] = defaultLayer(0);
  ed.redraw = ed.scheduleSave = ed.syncTextLinks = () => {};
  return ed;
}
const xy = (o: Obj, sub = 0) => shapeSubs(o.shape)[sub].nodes.map((n) => [+n.x.toFixed(6), +n.y.toFixed(6)]);

// Rectangle 20×30 at (30, 30): hovering the middle of the right edge offers a new node there
{
  const r: Obj = { id: 1, m: [1, 0, 0, 1, 30, 30], layer: 0, shape: { kind: 'rect', w: 20, h: 30, r: 0 } };
  const ed = editor([r]);
  ed.updateStartHover(50.5, 45);
  const h = ed.startHover!;
  assert.ok(h, 'edge is hovered');
  assert.equal(h.idx, -1);
  assert.ok(h.u !== undefined && h.pt && Math.abs(h.pt.x - 50) < 1e-9 && Math.abs(h.pt.y - 45) < 1e-9);
  // close to a corner node the node wins
  ed.updateStartHover(50.5, 30.5);
  assert.ok(ed.startHover && ed.startHover.idx >= 0 && ed.startHover.u === undefined);

  const before = ed.history.position;
  assert.ok(ed.setStartPoint(h.obj, h.sub, h.idx, 'set', h.u));
  assert.equal(r.shape.kind, 'path');
  const nodes = xy(r);
  assert.equal(nodes.length, 5);
  assert.deepEqual(nodes[0], [20, 15]);
  assert.ok(shapeSubs(r.shape)[0].start);
  assert.equal(ed.history.position, before + 1, 'one undo step');

  // Reassigning to another edge: the new spot starts, the former start stays an ordinary node
  ed.updateStartHover(40, 29.6);
  const h2 = ed.startHover!;
  assert.ok(h2 && h2.idx === -1);
  assert.ok(ed.setStartPoint(h2.obj, h2.sub, h2.idx, 'reverse', h2.u));
  const n2 = xy(r);
  assert.equal(n2.length, 6);
  assert.deepEqual(n2[0], [10, 0]);
  // reversed: from the top edge towards the top-left corner
  assert.deepEqual(n2[1], [0, 0]);
  assert.equal(n2.filter(([x, y]) => x === 20 && y === 15).length, 1);

  // Ctrl+click on an edge resets to automatic optimization without adding a node
  assert.ok(ed.setStartPoint(r, 0, -1, 'reset', 1.5));
  assert.equal(xy(r).length, 6);
  assert.ok(!shapeSubs(r.shape)[0].start);
}

// Open contour: edges are not offered, only the ends
{
  const l: Obj = { id: 2, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'path', subs: [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 40, y: 0 }] }] } };
  const ed = editor([l]);
  ed.updateStartHover(20, 1);
  assert.equal(ed.startHover, null);
  assert.equal(ed.setStartPoint(l, 0, -1, 'set', 0.5), false);
  assert.equal(xy(l).length, 2);
  assert.equal(ed.startAtPoint(l, { x: 20, y: 0 }, 'set', true), false);
}

// Agents: on_edge splits the nearest edge of a closed contour
{
  const e: Obj = { id: 3, m: [1, 0, 0, 1, 100, 100], layer: 0, shape: { kind: 'ellipse', rx: 10, ry: 10 } };
  const ed = editor([e]);
  const n0 = xy(e).length;
  assert.ok(ed.startAtPoint(e, { x: 100 + 10 * Math.SQRT1_2, y: 100 + 10 * Math.SQRT1_2 }, 'set', true));
  const ns = xy(e);
  assert.equal(ns.length, n0 + 1);
  assert.ok(Math.abs(Math.hypot(ns[0][0], ns[0][1]) - 10) < 0.01, 'new node lies on the circle');
}

console.log('Start point on edges: hover, insert, reassign, reverse, reset, open contours and agent call passed.');
