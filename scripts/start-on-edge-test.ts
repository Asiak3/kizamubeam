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

  // Reassigning to another edge: the new spot starts, the node inserted for the former start goes away (#333)
  ed.updateStartHover(40, 29.6);
  const h2 = ed.startHover!;
  assert.ok(h2 && h2.idx === -1);
  assert.ok(ed.setStartPoint(h2.obj, h2.sub, h2.idx, 'reverse', h2.u));
  const n2 = xy(r);
  assert.equal(n2.length, 5);
  assert.deepEqual(n2[0], [10, 0]);
  // reversed: from the top edge towards the top-left corner
  assert.deepEqual(n2[1], [0, 0]);
  assert.equal(n2.filter(([x, y]) => x === 20 && y === 15).length, 0, 'former start node removed');

  // Moving to a corner removes the inserted node as well
  assert.ok(ed.setStartPoint(r, 0, 2, 'set'));
  assert.equal(xy(r).length, 4);
  assert.ok(shapeSubs(r.shape)[0].nodes.every((n) => !n.split));

  // Ctrl+click on an edge resets to automatic optimization without adding a node, and drops an inserted one
  assert.ok(ed.setStartPoint(r, 0, -1, 'set', 0.5));
  assert.equal(xy(r).length, 5);
  const pos = ed.history.position;
  assert.ok(ed.setStartPoint(r, 0, -1, 'reset', 1.5));
  assert.equal(xy(r).length, 4);
  assert.ok(!shapeSubs(r.shape)[0].start);
  assert.equal(ed.history.position, pos + 1, 'cleanup and reset share one undo step');
}

// A node the user has moved since it was inserted is kept
{
  const r: Obj = { id: 4, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 20, h: 30, r: 0 } };
  const ed = editor([r]);
  assert.ok(ed.setStartPoint(r, 0, -1, 'set', 0.5));
  const sp = shapeSubs(r.shape)[0];
  assert.equal(sp.nodes.length, 5);
  sp.nodes[0].y += 2; // off the edge now
  assert.ok(ed.setStartPoint(r, 0, -1, 'set', 2.5));
  const s2 = shapeSubs(r.shape)[0];
  assert.equal(s2.nodes.length, 6, 'edited node kept');
  assert.equal(s2.nodes.filter((n) => n.split).length, 1, 'only the current start is still marked');
}

// Curves: moving the start along a circle restores the original curve exactly
{
  const c: Obj = { id: 5, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'ellipse', rx: 10, ry: 10 } };
  const ed = editor([c]);
  ed.convertObjToPath(c);
  const orig = JSON.parse(JSON.stringify(shapeSubs(c.shape)[0].nodes));
  const n0 = orig.length;
  assert.ok(ed.setStartPoint(c, 0, -1, 'set', 0.3));
  assert.equal(shapeSubs(c.shape)[0].nodes.length, n0 + 1);
  assert.ok(ed.setStartPoint(c, 0, -1, 'set', 2.7));
  assert.equal(shapeSubs(c.shape)[0].nodes.length, n0 + 1, 'one start node, not two');
  // back to an original node: the curve equals the original (up to rotation)
  const sp = shapeSubs(c.shape)[0];
  const corner = sp.nodes.findIndex((n) => !n.split);
  assert.ok(ed.setStartPoint(c, 0, corner, 'set'));
  const now = shapeSubs(c.shape)[0].nodes;
  assert.equal(now.length, n0);
  const k = orig.findIndex((n: { x: number; y: number }) => Math.hypot(n.x - now[0].x, n.y - now[0].y) < 1e-9);
  assert.ok(k >= 0);
  const close = (p?: { x: number; y: number }, q?: { x: number; y: number }) =>
    (!p && !q) || (!!p && !!q && Math.hypot(p.x - q.x, p.y - q.y) < 1e-9);
  now.forEach((n, i) => {
    const o = orig[(i + k) % n0];
    assert.ok(close(n, o) && close(n.cin, o.cin) && close(n.cout, o.cout), `node ${i} restored`);
  });
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

console.log('Start point on edges: hover, insert, reassign, cleanup of inserted nodes, reverse, reset, curves, open contours and agent call passed.');
