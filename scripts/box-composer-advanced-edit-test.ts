// Box composer with a shaped outline (#385, #451): edit operations of the plan editor (move, stretch, add, delete), pure functions in Node.
// The outer walls are walls of the list (#451): the layouts of the tests are written as before (inner walls only, ends
// on an outer wall at its inner face) and get their outer walls (unify); results are compared as the parts see them
// (the inner walls of the model the parts are built from).
// Aufruf: node scripts/run-ts.mjs scripts/box-composer-advanced-edit-test.ts
import { strict as assert } from 'node:assert';
import { buildModel, sampleLayout, unify, type Layout, type Side, type Wall } from '../plugins/box-composer-advanced/src/model';

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
const W = 94, D = 194, T = 3;
const LIM = { t: T, gap: T, minLen: 2 * T, freeLen: 2 * T };
const ALL: Record<Side, boolean> = { x0: true, x1: true, y0: true, y1: true };
/** A layout written as before #451 with its outer walls as walls (ids after the inner walls: back, right, front, left) */
const U = (l: { ref: [number, number]; walls: Wall[] }, sides = ALL): Layout => ({ ref: l.ref, walls: unify(l.walls, l.ref[0], l.ref[1], T, sides), sides });
const model = (walls: Wall[], w = W, d = D) => buildModel({ ref: [w, d], walls }, w, d, LIM);
/** The inner walls as the parts see them (ends on an outer wall at its inner face) */
const inner = (l: Layout, w = W, d = D): Wall[] => buildModel(l, w, d, LIM).box?.model.walls.map((x) => x.wall) ?? [];

// --- Bearbeiten (für den Plan-Editor, #385) -------------------------------------------------------------------------
const E = await import('../plugins/box-composer-advanced/src/edit');
const SK = U(sampleLayout(W, D));
type R = ReturnType<typeof E.moveWall>;
const wallOf = (r: R, id: number) => (r.ok ? inner(r.layout).find((x) => x.id === id) : undefined);
const kinds = (r: R) => (r.ok ? buildModel(r.layout, W, D, LIM).box!.model.walls.map((x) => [x.wall.id, x.start.kind, x.end.kind]) : null);
const layoutOf = (r: R) => (r as Extract<R, { ok: true }>).layout;

test('unify: the outer walls of the rectangle become walls of the list, ends on them go to their centre line', () => {
  assert.deepEqual(SK.walls.slice(4), [
    { id: 5, axis: 'h', pos: -1.5, from: -1.5, to: 95.5 },
    { id: 6, axis: 'v', pos: 95.5, from: -1.5, to: 195.5 },
    { id: 7, axis: 'h', pos: 195.5, from: -1.5, to: 95.5 },
    { id: 8, axis: 'v', pos: -1.5, from: -1.5, to: 195.5 },
  ]);
  assert.deepEqual(SK.walls[0], { id: 1, axis: 'h', pos: 97, from: -1.5, to: 95.5 });
  assert.deepEqual(inner(SK), sampleLayout(W, D).walls, 'the parts see the walls as before');
  const m = buildModel(SK, W, D, LIM);
  assert.deepEqual(m.issues, []);
  assert.deepEqual(m.walls.map((x) => [x.wall.id, x.start.kind, x.end.kind]), [[1, 'tee', 'tee'], [2, 'tee', 'corner'], [3, 'corner', 'tee'], [4, 'tee', 'free'], [5, 'corner', 'corner'], [6, 'corner', 'corner'], [7, 'corner', 'corner'], [8, 'corner', 'corner']]);
  assert.deepEqual(E.settle(SK, W, D, LIM)!.size, [W, D]);
});

test('move: walls ending on the moved wall follow it, crossing walls stay', () => {
  const r = E.moveWall(SK, W, D, LIM, 1, 80);
  assert.ok(r.ok);
  assert.equal(wallOf(r, 1)!.pos, 80);
  assert.equal(wallOf(r, 4)!.from, 80, 'the T on wall 1 follows');
  assert.deepEqual([wallOf(r, 2)!.from, wallOf(r, 2)!.to], [0, 150.35], 'the crossing wall stays');
  const c = E.moveWall(SK, W, D, LIM, 3, 120);
  assert.ok(c.ok);
  assert.equal(wallOf(c, 2)!.to, 120, 'the corner partner follows');
  assert.deepEqual(kinds(c), kinds({ ok: true, layout: SK }), 'same joints');
});

test('move: may pass other walls and change joints; refused onto a wall of the same line or with a new error', () => {
  const past = E.moveWall(SK, W, D, LIM, 1, 160);
  assert.ok(past.ok, 'over wall 3 to below it');
  assert.equal(wallOf(past, 4)!.from, 160, 'the T on it still follows');
  assert.deepEqual(E.moveWall(SK, W, D, LIM, 1, 150.35), { ok: false, code: 'move-onto', values: { id: 1, id2: 3 } });
  assert.ok(E.moveWall(SK, W, D, LIM, 4, 60).ok, 'over wall 2, now crossing wall 3');
  assert.equal((E.moveWall(SK, W, D, LIM, 3, 100) as { code: string }).code, 'walls-close', 'too close to wall 1');
  // Wand 2 nach x = 92: Wand 3 (Ecke) würde nur noch 2 mm lang
  assert.equal(E.moveWall(SK, W, D, LIM, 2, 92).ok, false);
  assert.equal(E.moveWall(SK, W, D, LIM, 2, 70).ok, true);
  assert.deepEqual(E.moveWall(SK, W, D, LIM, 9, 70), { ok: false, code: 'edit-no-wall', values: { id: 9 } });
});

test('move near: the nearest place where the wall may stand; lined up with a wall it can be joined with', () => {
  assert.equal(wallOf(E.moveWallNear(SK, W, D, LIM, 3, 100), 3)!.pos, 103, 'jumps out of the space next to wall 1');
  assert.equal(wallOf(E.moveWallNear(SK, W, D, LIM, 1, 150), 1)!.pos, 144, 'not onto wall 3: the nearer side');
  assert.equal(wallOf(E.moveWallNear(SK, W, D, LIM, 1, 156), 1)!.pos, 157, 'past wall 3');
  // Wand 2 von links und Wand 3 von rechts enden auf Wand 1 (senkrecht bei x = 47)
  const L = U({ ref: [W, D], walls: [{ id: 1, axis: 'v', pos: 47, from: 0, to: 150 }, { id: 2, axis: 'h', pos: 120, from: 0, to: 47 }, { id: 3, axis: 'h', pos: 110, from: 47, to: 94 }] });
  const joined = E.moveWallNear(L, W, D, LIM, 3, 118);
  assert.ok(joined.ok);
  assert.deepEqual(inner(joined.layout).filter((x) => x.axis === 'h'), [{ id: 2, axis: 'h', pos: 120, from: 0, to: 94 }], 'one wall crossing wall 1');
  assert.deepEqual(kinds(joined), [[1, 'outer', 'free'], [2, 'outer', 'outer']]);
  assert.equal(wallOf(E.moveWallNear(L, W, D, LIM, 3, 125), 3)!.pos, 126, 'further on: past it, not joined');
  assert.equal(wallOf(E.moveWallNear(L, W, D, LIM, 3, 112), 3)!.pos, 112, 'far enough from it: stays apart');
  assert.equal(wallOf(E.stretchEndNear(SK, W, D, LIM, 4, 'to', 100, 3), 4)!.to, 105, 'stretched too short: the shortest free end');
  // Mitte zwischen den Nachbarn: Wand 4 zwischen linker Außenwand (−1.5) und Wand 2 (47)
  assert.deepEqual(E.neighbours(SK.walls, SK.walls[3], W, D, T), { lo: -1.5, hi: 47 });
  assert.equal(wallOf(E.moveWallNear(SK, W, D, LIM, 4, 20, 6), 4)!.pos, 22.75, 'within snap: the middle');
  assert.equal(wallOf(E.moveWallNear(SK, W, D, LIM, 4, 30, 6), 4)!.pos, 30, 'further: where it is dragged');
  assert.equal(wallOf(E.moveWallNear(SK, W, D, LIM, 4, 20), 4)!.pos, 20, 'without snap: no middle');
  // Wie in der Aufnahme (Innenmaß 194 × 194): 1 quer bei 130, 2 längs bei 64 über die ganze Tiefe, 3 quer bei 64 von
  // Wand 2 nach rechts, 4 längs bei 128 von hinten bis Wand 1 (kreuzt Wand 3)
  const Q = 194;
  const G = U({ ref: [Q, Q], walls: [{ id: 1, axis: 'h', pos: 130, from: 0, to: Q }, { id: 2, axis: 'v', pos: 64, from: 0, to: Q }, { id: 3, axis: 'h', pos: 64, from: 64, to: Q }, { id: 4, axis: 'v', pos: 128, from: 0, to: 130 }] });
  const near = (id: number, pos: number, along: number) => { const r = E.moveWallNear(G, Q, Q, LIM, id, pos, 6, along); return r.ok ? inner(r.layout, Q, Q).find((x) => x.id === id)!.pos : NaN; };
  assert.equal(near(2, 62, 50), 63.25, 'pointer high on wall 2: the middle between the left wall and wall 4');
  assert.equal(near(2, 95, 160), 97, 'pointer low on wall 2: the middle of the whole width (no wall 4 there)');
  assert.equal(near(4, 95, 120), 97, 'pointer near wall 1: the middle of wall 1, which wall 4 ends on');
  // The middle of wall 3 from wall 2 to the right outer wall, centre line to centre line (#451: the same clear space on
  // both sides; before, to the inner face of the outer wall: 129)
  assert.equal(near(4, 127, 70), 129.75, 'pointer near wall 3: the middle of wall 3, which wall 4 crosses');
  const m = model(G.walls, Q, Q);
  assert.deepEqual(E.wallCentre(m, G.walls[3], 120), { id: 1, at: 97 });
  assert.deepEqual(E.wallCentre(m, G.walls[3], 70), { id: 3, at: 129.75 });
  assert.equal(E.wallCentre(m, G.walls[0], 50)?.id, 2, 'wall 1 crosses wall 2; wall 4 ends on it and does not count');
  // In Flucht mit einer parallelen Wand, die sie nicht berührt: A (x = 30) endet oben auf Wand 1, B (x = 34) steht vorne
  const F = U({ ref: [W, D], walls: [{ id: 1, axis: 'h', pos: 97, from: 0, to: W }, { id: 2, axis: 'v', pos: 30, from: 0, to: 97 }, { id: 3, axis: 'v', pos: 34, from: 120, to: D }] });
  const lined = E.moveWallNear(F, W, D, LIM, 3, 32, 6);
  assert.equal(wallOf(lined, 3)!.pos, 30, 'snapped into line with wall 2');
  assert.equal(E.lineUp(layoutOf(lined).walls, layoutOf(lined).walls.find((x) => x.id === 3)!), 2);
  assert.equal(wallOf(E.moveWallNear(F, W, D, LIM, 3, 38, 6), 3)!.pos, 38, 'further away: where it is dragged');
  // Offene linke Seite: die Bodenplatte reicht bis −t, die Mitte zwischen ihrem Rand und Wand 2 (47) liegt bei 21.25
  const open = { x0: false, x1: true, y0: true, y1: true };
  const SO = U(sampleLayout(W, D), open);
  assert.deepEqual(E.neighbours(SO.walls, SO.walls[3], W, D, T, undefined, open), { lo: -4.5, hi: 47 });
  assert.equal(wallOf(E.moveWallNear(SO, W, D, LIM, 4, 20, 6, undefined, open), 4)!.pos, 21.25, 'open side: the middle up to the edge of the floor');
  // Mitte der ganzen Kiste (47), auch wenn das Fach eine andere Mitte hat (zwischen Wand 3 und rechts: 57.75)
  const B0 = { ref: [W, D] as [number, number], walls: [{ id: 1, axis: 'h' as const, pos: 97, from: 0, to: W }, { id: 2, axis: 'v' as const, pos: 70, from: 97, to: D }, { id: 3, axis: 'v' as const, pos: 20, from: 97, to: D }] };
  assert.equal(wallOf(E.moveWallNear(U(B0), W, D, LIM, 2, 50, 6), 2)!.pos, 47, 'snapped to the middle of the box');
  assert.equal(wallOf(E.moveWallNear(U(B0, open), W, D, LIM, 2, 50, 6, undefined, open), 2)!.pos, 47, 'the same with an open side');
  assert.equal(wallOf(E.moveWallNear(U(B0), W, D, LIM, 2, 60, 6), 2)!.pos, 57.75, 'nearer the middle of the space: that one');
});

test('stretches: the pieces of a wall between its ends, T joints and crossings', () => {
  const m = model(SK.walls);
  // Wand 1 (y = 97): Wand 4 endet bei 19.74 auf ihr, Wand 2 kreuzt bei 47; sie endet auf den Mittellinien der Außenwände
  assert.deepEqual(E.stretchOf(m, SK.walls[0], 30), [19.74, 47]);
  assert.deepEqual(E.stretchOf(m, SK.walls[0], 5), [-1.5, 19.74]);
  assert.deepEqual(E.stretchOf(m, SK.walls[0], 60), [47, 95.5]);
  assert.deepEqual(E.joinRuns([[47, 94], [19.74, 47], [0, 5]]), [[0, 5], [19.74, 94]]);
  assert.equal(E.wholeWall(SK.walls, 'h', 97, [[-1.5, 19.74], [19.74, 47], [47, 95.5]]), 1);
  assert.equal(E.wholeWall(SK.walls, 'h', 97, [[19.74, 47]]), null);
  // An outer wall too: the right one between its corners and the walls ending on it
  assert.deepEqual(E.stretchOf(m, SK.walls[5], 120), [97, 150.35]);
});

/** The inner walls of a result without ids, sorted: [axis, pos, from, to] */
const shape = (r: R) =>
  r.ok ? inner(r.layout).map((x) => [x.axis, +x.pos.toFixed(2), +x.from.toFixed(2), +x.to.toFixed(2)].join(' ')).sort() : r;

test('moving a stretch: its wall is cut, a wall from behind gets longer (a U), one from the front is crossed', () => {
  // Wand 1, Stück 19.74 … 47, nach hinten (y 85): Wand 4 kommt von vorne (von hinter dem Stück) und wird länger
  const up = E.moveRuns(SK, W, D, LIM, 'h', 97, [[19.74, 47]], 85);
  assert.ok(up.ok);
  assert.deepEqual(shape(up), ['h 150.35 47 94', 'h 85 19.74 47', 'h 97 0 19.74', 'h 97 47 94', 'v 19.74 85 169.75', 'v 47 0 150.35']);
  assert.deepEqual(model(layoutOf(up).walls).issues.filter((i) => i.level === 'error'), []);
  // Nach vorne (y 110): Wand 4 kommt von dort, bleibt und wird gekreuzt
  const down = E.moveRuns(SK, W, D, LIM, 'h', 97, [[19.74, 47]], 110);
  assert.ok(down.ok);
  assert.deepEqual(shape(down), ['h 110 19.74 47', 'h 150.35 47 94', 'h 97 0 19.74', 'h 97 47 94', 'v 19.74 97 169.75', 'v 47 0 150.35']);
  // Zurück auf die Linie: wieder eine Wand, Wand 4 wie vorher
  const back = E.moveRuns(layoutOf(up), W, D, LIM, 'h', 85, [[19.74, 47]], 97);
  assert.deepEqual(shape(back), shape({ ok: true, layout: SK }));
  // Alle Stücke = die ganze Wand: wie moveWall
  assert.deepEqual(E.moveRunsNear(SK, W, D, LIM, 'h', 97, [[-1.5, 19.74], [19.74, 95.5]], 80).ok && shape(E.moveRunsNear(SK, W, D, LIM, 'h', 97, [[-1.5, 95.5]], 80)), shape(E.moveWall(SK, W, D, LIM, 1, 80)));
  // Ziehen: nächste ganze Zahl, die Lage der Stücke kommt mit
  const near = E.moveRunsNear(SK, W, D, LIM, 'h', 97, [[19.74, 47]], 85.3, 6, 30);
  assert.ok(near.ok);
  assert.equal(near.pos, 85);
});

test('moving past the end of a wall: that wall gets longer; a follower gets shorter only up to its next joint', () => {
  // Wie im Plan des Nutzers: 2 und 3 von hinten bis 100, 4 dazwischen bei 60, 1 und 5 enden bei 100 an 2 und 3 (Ecken)
  const L = U({
    ref: [W, D],
    walls: [
      { id: 1, axis: 'h', pos: 100, from: 0, to: 30 },
      { id: 2, axis: 'v', pos: 30, from: 0, to: 100 },
      { id: 3, axis: 'v', pos: 60, from: 0, to: 100 },
      { id: 4, axis: 'h', pos: 60, from: 30, to: 60 },
      { id: 5, axis: 'h', pos: 100, from: 60, to: W },
    ],
  });
  const down = E.moveWall(L, W, D, LIM, 4, 130);
  assert.deepEqual(shape(down), ['h 100 0 30', 'h 100 60 94', 'h 130 30 60', 'v 30 0 130', 'v 60 0 130'], '2 and 3 reach wall 4');
  assert.deepEqual(model(layoutOf(down).walls).issues.filter((i) => i.level === 'error'), []);
  // Zurück nach oben: 2 und 3 folgen nur bis zu den Wänden 1 und 5 (bei 100), Wand 4 endet dann wieder an ihnen
  const up = E.moveWall(layoutOf(down), W, D, LIM, 4, 60);
  assert.deepEqual(shape(up), shape({ ok: true, layout: L }));
  // Ein Stück, das über das Ende einer Wand hinaus geht, die es kreuzt: die Wand wird länger (Wand 4 der Skizze bis 175)
  const past = E.moveRuns(SK, W, D, LIM, 'h', 97, [[19.74, 47]], 175);
  assert.ok(past.ok);
  assert.ok((shape(past) as string[]).includes('v 19.74 97 175'), 'wall 4 reaches the stretch');
});

test('deleting a stretch: the rest of the wall stays', () => {
  const r = E.deleteRuns(SK, W, D, LIM, 'h', 97, [[19.74, 47]]);
  assert.deepEqual(shape(r), ['h 150.35 47 94', 'h 97 0 19.74', 'h 97 47 94', 'v 19.74 97 169.75', 'v 47 0 150.35']);
});

test('stretch: snaps to outer walls and walls, joints may appear or go', () => {
  // (within snap of the outer wall's centre line, as of any wall)
  const r = E.stretchEnd(SK, W, D, LIM, 4, 'to', 193, 3);
  assert.ok(r.ok);
  assert.equal(wallOf(r, 4)!.to, D, 'snapped to the outer wall');
  assert.deepEqual(kinds(r)!.find((k) => k[0] === 4), [4, 'tee', 'outer']);
  const f = E.stretchEnd(SK, W, D, LIM, 4, 'to', 140, 3);
  assert.ok(f.ok && wallOf(f, 4)!.to === 140, 'nothing near: free end');
  // In line with a node: the corner of walls 2 and 3 (y = 150.35)
  assert.equal(wallOf(E.stretchEnd(SK, W, D, LIM, 4, 'to', 148, 3), 4)!.to, 150.35);
  // Wand 2 über die Ecke hinaus verlängert: Wand 3 stößt jetzt als T an Wand 2
  const t = E.stretchEnd(SK, W, D, LIM, 2, 'to', 180, 3);
  assert.ok(t.ok);
  assert.deepEqual(kinds(t)!.find((k) => k[0] === 3), [3, 'tee', 'outer']);
  assert.deepEqual(E.stretchEnd(SK, W, D, LIM, 4, 'to', 100, 3), { ok: false, code: 'wall-short', values: { id: 4, min: 6 } });
});

test('add: ends snap into T and corners, refused on an existing wall or too close; delete frees the ends', () => {
  const a = E.addWall(SK, W, D, LIM, 'h', 40, 0, 46, 3);
  assert.ok(a.ok);
  const nw = wallOf(a, 9)!;
  assert.deepEqual([nw.from, nw.to], [0, 47], 'snapped to the outer wall and to wall 2');
  assert.deepEqual(kinds(a)!.find((k) => k[0] === 9), [9, 'outer', 'tee']);
  // Ecke: Ende nahe am freien Ende von Wand 4 (x = 19,74, bis y = 169,75)
  const l = E.addWall(SK, W, D, LIM, 'h', 171, 0, 19, 3);
  assert.ok(l.ok);
  assert.equal(wallOf(l, 4)!.to, 171, 'the free end of wall 4 comes onto the new line');
  assert.deepEqual(kinds(l)!.filter((k) => k[0] === 4 || k[0] === 9), [[4, 'tee', 'corner'], [9, 'outer', 'corner']]);
  assert.deepEqual(E.addWall(SK, W, D, LIM, 'h', 97, 10, 30, 3), { ok: false, code: 'add-on-wall', values: { id: 9 } });
  assert.equal((E.addWall(SK, W, D, LIM, 'h', 100, 0, 30, 3) as { code: string }).code, 'walls-close');
  const del = E.deleteWall(SK, W, D, LIM, 1);
  assert.ok(del.ok);
  assert.deepEqual(kinds(del), [[2, 'outer', 'corner'], [3, 'corner', 'outer'], [4, 'free', 'free']]);
});

const { planDraw, planPointer } = await import('../plugins/box-composer-advanced/src/surface');
// --- Außenwände sind Wände (#451): verschoben geben sie der Kiste eine andere Form oder Größe ------------------------
{
  const B = 194;
  const h = (id: number, pos: number, from: number, to: number): Wall => ({ id, axis: 'h', pos, from, to });
  const v = (id: number, pos: number, from: number, to: number): Wall => ({ id, axis: 'v', pos, from, to });
  const ok = (r: R) => {
    assert.ok(r.ok, JSON.stringify(r));
    return r.layout;
  };
  const box = (walls: Wall[], sides = ALL) => U({ ref: [B, B], walls }, sides);
  /** A shaped box: all its walls (outer walls too) */
  const shaped = (walls: Wall[]): Layout => ({ ref: [B, B], walls, sides: ALL });
  /** What the parts see: the outline (null: the rectangle), the inner walls, the inner size */
  const seen = (l: Layout) => {
    const m = buildModel(l, B, B, LIM);
    assert.ok(m.box, JSON.stringify(m.issues));
    const [sx, sy] = m.box.shift;
    return { outline: m.box.pts.length === 4 ? null : m.box.pts.map(([x, y]) => [x + sx, y + sy]), walls: m.box.model.walls.map((x) => x.wall), size: m.box.size, issues: m.issues };
  };
  const idOn = (l: Layout, axis: 'h' | 'v', pos: number, along: number) => l.walls.find((q) => q.axis === axis && Math.abs(q.pos - pos) < 0.01 && q.from <= along && q.to >= along)!.id;

  test('outer walls: a stretch moved in cuts a corner away (L); the divider in line is one stepped board; three walls meet in a T; moved back, the box is whole again', () => {
    const l = box([h(1, 97, 0, B)]);
    // The right outer wall between the back corner and wall 1, moved in to x = 97
    const r = ok(E.moveRunsNear(l, B, B, LIM, 'v', 195.5, [[-1.5, 97]], 97.3, 6, 40));
    const s = seen(r);
    assert.deepEqual(s.outline, [[-1.5, -1.5], [97, -1.5], [97, 97], [195.5, 97], [195.5, 195.5], [-1.5, 195.5]]);
    assert.deepEqual(s.walls, [h(1, 97, 0, 97)], 'wall 1 goes on as outer wall past the corner: one board');
    assert.deepEqual(s.issues, []);
    const m = buildModel(r, B, B, LIM);
    const piece = m.walls.find((x) => x.wall.axis === 'v' && x.wall.pos === 97)!;
    assert.deepEqual([piece.start.kind, piece.end], ['corner', { kind: 'tee', host: 1 }], 'the moved stretch ends on wall 1 in a T');
    assert.deepEqual(m.box!.model.outline!.edges.map((e) => [e.start.kind, e.end.kind]).slice(1, 3), [['corner', 'into'], ['through', 'corner']]);
    const back = ok(E.moveRunsNear(r, B, B, LIM, 'v', 97, [[-1.5, 97]], 195, 6, 40));
    assert.deepEqual(seen(back), seen(l));
    assert.deepEqual(back.walls.length, l.walls.length, 'the stretch is one wall with the rest of its outer wall again');
  });

  test('outer walls: a stretch between two dividers moved in (U), deeper to whole millimetres; a whole side changes the size', () => {
    const l = box([h(1, 60, 0, B), h(2, 130, 0, B)]);
    const r = ok(E.moveRuns(l, B, B, LIM, 'v', 195.5, [[60, 130]], 150));
    assert.deepEqual(seen(r).walls, [h(1, 60, 0, 150), h(2, 130, 0, 150)]);
    assert.deepEqual(seen(r).issues, []);
    const deeper = ok(E.moveRunsNear(r, B, B, LIM, 'v', 150, [[60, 130]], 119.9, 6, 90));
    assert.deepEqual(seen(deeper).walls, [h(1, 60, 0, 120), h(2, 130, 0, 120)]);
    // The back wall down to y = 20: the box is lower, the walls keep their place in it
    const top = ok(E.moveWall(l, B, B, LIM, idOn(l, 'h', -1.5, 50), 20));
    const st = E.settle(top, B, B, LIM)!;
    assert.deepEqual([st.size, st.shift], [[194, 172.5], [0, -21.5]]);
    assert.deepEqual(inner(st.layout, ...st.size).map((x) => x.pos), [38.5, 108.5]);
    // The right wall out to x = 230: the walls ending on it follow
    const grow = ok(E.moveWall(l, B, B, LIM, idOn(l, 'v', 195.5, 50), 230));
    assert.deepEqual([seen(grow).size, seen(grow).walls.map((x) => x.to)], [[228.5, 194], [228.5, 228.5]]);
  });

  test('outer walls: deleted they are left open (the side or a stretch), deleted again closed; refused where the box would fall apart', () => {
    const l = box([h(1, 60, 0, B), h(2, 130, 0, B)]);
    // A shaped box with an open side
    const open = box([h(1, 60, 0, B), h(2, 130, 0, B)], { ...ALL, y1: false });
    assert.ok(E.moveRuns(open, B, B, LIM, 'v', 195.5, [[60, 130]], 150).ok);
    // A stretch of an outer wall deleted: left open between walls 1 and 2 (the shape stays)
    const part = E.deleteRuns(l, B, B, LIM, 'v', 195.5, [[60, 130]]);
    assert.ok(part.ok);
    assert.deepEqual(part.layout.walls.filter((q) => q.axis === 'v' && q.pos === 195.5).map((q) => [q.from, q.to, !!q.open]), [[-1.5, 60, false], [60, 130, true], [130, 195.5, false]]);
    assert.deepEqual(buildModel(part.layout, B, B, LIM).issues, []);
    // The open wall is a wall of its own now: moved alone (#451) it moves like a closed stretch (a notch in the outline,
    // walls 1 and 2 stay joined to the right wall) and stays open
    {
      const moved = E.moveRuns(part.layout, B, B, LIM, 'v', 195.5, [[60, 130]], 150);
      assert.ok(moved.ok, JSON.stringify(moved));
      assert.deepEqual(moved.layout.walls.filter((q) => q.open).map((q) => [q.axis, q.pos, q.from, q.to]), [['v', 150, 60, 130]]);
      assert.deepEqual(buildModel(moved.layout, B, B, LIM).issues, []);
    }
    // The whole front wall: left open, the front of the rectangle is open; deleted again, it is closed
    const id = idOn(l, 'h', 195.5, 50);
    const front = E.deleteWall(l, B, B, LIM, id);
    assert.ok(front.ok);
    assert.equal(front.layout.walls.find((q) => q.id === id)!.open, true);
    assert.deepEqual(buildModel(front.layout, B, B, LIM).box!.sides, { ...ALL, y1: false });
    assert.deepEqual(seen(front.layout).walls, seen(l).walls);
    const closed = E.deleteWall(front.layout, B, B, LIM, id);
    assert.ok(closed.ok);
    assert.deepEqual(closed.layout.walls, l.walls);
  });

  test('open stretch (#451): moved alone it moves like a closed one, in and out, and stays open', () => {
    const closed = box([h(1, 60, 0, B), h(2, 140, 0, B)]);
    const opened = E.deleteRuns(closed, B, B, LIM, 'v', 195.5, [[60, 140]]);
    assert.ok(opened.ok);
    const line = (x: Layout) => x.walls.filter((q) => q.axis === 'v' && q.open).map((q) => [q.pos, q.from, q.to]);
    for (const to of [175.5, 135.5, 100, 215.5, 255.5]) {
      const a = E.moveRunsNear(opened.layout, B, B, LIM, 'v', 195.5, [[60, 140]], to, 0, 100, opened.layout.sides);
      const c = E.moveRunsNear(closed, B, B, LIM, 'v', 195.5, [[60, 140]], to, 0, 100, ALL);
      assert.ok(a.ok && c.ok, `to ${to}: ${JSON.stringify(a.ok ? c : a)}`);
      const [ma, mc] = [buildModel(a.layout, B, B, LIM), buildModel(c.layout, B, B, LIM)];
      assert.deepEqual(ma.box?.pts, mc.box?.pts, `to ${to}: the same outline as the closed stretch`);
      assert.deepEqual(ma.issues, [], `to ${to}`);
      assert.deepEqual(line(a.layout), [[to, 60, 140]], `to ${to}: the stretch is open where it is now`);
      // The walls 1 and 2 stay as the closed stretch has them
      assert.deepEqual(a.layout.walls.filter((q) => q.id === 1 || q.id === 2).map((q) => [q.id, q.from, q.to]), c.layout.walls.filter((q) => q.id === 1 || q.id === 2).map((q) => [q.id, q.from, q.to]), `to ${to}`);
    }
    // Moved back to its line: joined with the open rest of the line, the box is as it was
    const out = E.moveRunsNear(opened.layout, B, B, LIM, 'v', 195.5, [[60, 140]], 235.5, 0, 100, opened.layout.sides);
    assert.ok(out.ok);
    const back = E.moveRunsNear(out.layout, B, B, LIM, 'v', 235.5, [[60, 140]], 195.5, 0, 100, out.layout.sides);
    assert.ok(back.ok, JSON.stringify(back));
    assert.deepEqual(buildModel(back.layout, B, B, LIM).box?.pts, buildModel(opened.layout, B, B, LIM).box?.pts);
    assert.deepEqual(line(back.layout), [[195.5, 60, 140]]);
    // A gap with no wall across it at its ends: it moves alone, in or out, and its two sides are open (no wall)
    const bare = E.deleteRuns(box([]), B, B, LIM, 'v', 195.5, [[60, 140]]);
    assert.ok(bare.ok);
    for (const to of [150.5, 235.5]) {
      const g = E.moveRunsNear(bare.layout, B, B, LIM, 'v', 195.5, [[60, 140]], to, 0, 100, bare.layout.sides);
      assert.ok(g.ok, `gap to ${to}: ${JSON.stringify(g)}`);
      const m = buildModel(g.layout, B, B, LIM);
      assert.deepEqual(m.issues, []);
      assert.equal(m.box?.open.filter(Boolean).length, 3, 'the gap and its two sides are open');
      // (the sides run from the old line to the new one, at the ends of the gap)
      const [lo, hi] = [Math.min(195.5, to), Math.max(195.5, to)];
      const key = (x: (string | number)[]) => JSON.stringify(x);
      assert.deepEqual(g.layout.walls.filter((q) => q.open).map((q) => key([q.axis, q.pos, q.from, q.to])).sort(), [key(['h', 60, lo, hi]), key(['h', 140, lo, hi]), key(['v', to, 60, 140])].sort());
    }
    // With a wall ending on it (one leg), the closed way stays (no side is made up)
    const oneLeg = E.deleteRuns(box([h(1, 60, 0, B)]), B, B, LIM, 'v', 195.5, [[60, 140]]);
    assert.ok(oneLeg.ok);
    // A whole open side with walls across it: the same as one that is closed
    const side = E.deleteWall(box([h(1, 60, 0, B), h(2, 140, 0, B)]), B, B, LIM, idOn(box([h(1, 60, 0, B), h(2, 140, 0, B)]), 'v', 195.5, 100));
    assert.ok(side.ok);
    const sOpen = E.moveWallNear(side.layout, B, B, LIM, idOn(side.layout, 'v', 195.5, 100), 150, 0, 100, side.layout.sides);
    const sClosed = E.moveWallNear(box([h(1, 60, 0, B), h(2, 140, 0, B)]), B, B, LIM, idOn(box([h(1, 60, 0, B), h(2, 140, 0, B)]), 'v', 195.5, 100), 150, 0, 100, ALL);
    assert.ok(sOpen.ok && sClosed.ok);
    assert.equal(buildModel(sOpen.layout, B, B, LIM).box?.size.join('x'), buildModel(sClosed.layout, B, B, LIM).box?.size.join('x'));
  });

  test('outer walls: dragged towards a wall in their line they join it (one board), as walls do (screenshot Nodos)', () => {
    const ol = (y5: number): [number, number][] => [[-1.5, -1.5], [195.5, -1.5], [195.5, 60], [150, 60], [150, y5], [195.5, y5], [195.5, 195.5], [-1.5, 195.5]];
    // Wall 2 ends on the outer wall 6 of the notch; 7 is the outer wall below the notch
    const l = shaped([h(2, 130, -1.5, 150), h(3, -1.5, -1.5, 195.5), v(4, 195.5, -1.5, 60), h(5, 60, 150, 195.5), v(6, 150, 60, 140), h(7, 140, 150, 195.5), v(8, 195.5, 140, 195.5), h(9, 195.5, -1.5, 195.5), v(10, -1.5, -1.5, 195.5)]);
    const a5 = idOn(l, 'h', 140, 170);
    const joined = ok(E.moveWallNear(l, B, B, LIM, a5, 131, 6));
    assert.deepEqual([seen(joined).outline, seen(joined).walls], [ol(130), [h(2, 130, 0, 150)]]);
    assert.ok(joined.walls.some((q) => q.axis === 'h' && q.pos === 130 && q.from === -1.5 && q.to === 195.5), 'wall 2 and the outer wall are one wall of the list');
    assert.equal(seen(ok(E.moveWallNear(l, B, B, LIM, a5, 136, 6))).outline![4][1], 136, 'far enough from it: stays apart');
  });

  test('magnetic snap (#451): ends, whole walls and outer walls line up with the free ends of other walls (nodes)', () => {
    // Wall 1 ends free at (40, 120)
    const l = box([v(1, 40, 0, 120), h(2, 150, 100, B), h(3, 60, 100, B)]);
    const end = ok(E.stretchEndNear(l, B, B, LIM, 2, 'from', 42, 6));
    assert.equal(end.walls.find((x) => x.id === 2)!.from, 40, 'the free end of wall 2 in line with that of wall 1');
    const whole = ok(E.moveWallNear(l, B, B, LIM, 3, 117, 6));
    assert.equal(whole.walls.find((x) => x.id === 3)!.pos, 120, 'wall 3 on the line through the free end of wall 1');
    // The right outer wall moved in near the free end of wall 4 (x = 150): in line with it, wall 4 ends on it
    const l4 = box([h(4, 100, 0, 150)]);
    const r = ok(E.moveWallNear(l4, B, B, LIM, idOn(l4, 'v', 195.5, 50), 153, 6));
    assert.deepEqual([seen(r).size, seen(r).walls], [[148.5, 194], [h(4, 100, 0, 148.5)]], 'the side on x = 150, the wall on its inner face');
  });

  test('plan (#451): a wall whose line runs through the free end of another wall gets a guide to it (screenshot Magnetic snap2)', () => {
    // Wall 4 (x = 60) from wall 1 to the front; wall 27 ends free at x = 60 above wall 1
    const layout = box([h(1, 100, 0, B), v(4, 60, 100, B), h(27, 50, 0, 60)]);
    const plan = { w: B, d: B, t: T, lim: LIM, layout, sides: ALL };
    const guides = (row: number) => planDraw(plan, { view: 'plan', state: null, selected: { walls: row }, have: [] } as never).items.filter((i) => i.type === 'line' && i.dash && i.alpha === 0.6).map((i) => (i as { pts: [number, number][] }).pts);
    assert.deepEqual(guides(1), [[[60, 100], [60, 50]]], 'from the end of wall 4 to the free end of wall 27');
    assert.deepEqual(guides(0), [], 'wall 1: no node in its line');
  });

  test('plan (#451): an outer wall in line with another one gets the guide of walls that line up (O8 under O12)', () => {
    // A notch in the left side from y = 60 to 100, 40 deep: the left outer wall in two (8 above, 4 below)
    const layout = shaped([h(1, -1.5, -1.5, 195.5), v(2, 195.5, -1.5, 195.5), h(3, 195.5, -1.5, 195.5), v(4, -1.5, 100, 195.5), h(5, 100, -1.5, 40), v(6, 40, 60, 100), h(7, 60, -1.5, 40), v(8, -1.5, -1.5, 60)]);
    const row = layout.walls.findIndex((q) => q.axis === 'v' && q.pos === -1.5 && q.from === 100);
    const plan = { w: B, d: B, t: T, lim: LIM, layout, sides: ALL };
    const dr = planDraw(plan, { view: 'plan', state: null, selected: { walls: row }, have: [] } as never);
    const guides = dr.items.filter((i) => i.type === 'line' && i.dash && i.alpha === 0.7).map((i) => (i as { pts: [number, number][] }).pts);
    assert.deepEqual(guides, [[[-1.5, 60], [-1.5, 100]]]);
    assert.deepEqual(dr.fields!.map((f) => f.id), ['b', 'len'], 'measured to the inside only');
  });

  // The L of the first test: the corner at the back right cut away up to x = 97, y = 97
  const L = () => ok(E.moveRunsNear(box([h(1, 97, 0, B)]), B, B, LIM, 'v', 195.5, [[-1.5, 97]], 97.3, 6, 40));

  test('several lines (#451): the two outer walls of the arm of an L moved together, the L gets bigger and stays an L', () => {
    const l = L();
    const arm = [
      { axis: 'v' as const, pos: 97, runs: [[-1.5, 97]] as [number, number][] },
      { axis: 'h' as const, pos: -1.5, runs: [[-1.5, 97]] as [number, number][] },
    ];
    const r = E.moveGroups(l, B, B, LIM, arm, 20, -10);
    const s = seen(ok(r));
    // (seen in the box's own inner size: 10 mm deeper, everything 10 mm further down)
    assert.deepEqual(s.outline, [[-1.5, -1.5], [117, -1.5], [117, 107], [195.5, 107], [195.5, 205.5], [-1.5, 205.5]]);
    assert.deepEqual(s.issues, []);
    assert.deepEqual(r.ok && r.groups, [
      { axis: 'v', pos: 117, runs: [[-11.5, 97]] },
      { axis: 'h', pos: -11.5, runs: [[-1.5, 117]] },
    ], 'the selection where it is now: the corner moved with both');
    // Near: whole millimetres
    const near = E.moveGroupsNear(l, B, B, LIM, arm, 20.1, -10.1, 6, 40);
    assert.deepEqual(seen(ok(near)).outline, s.outline);
    // An inner wall in the selection stays inside the box
    const lw = ok(E.addWall(l, B, B, LIM, 'h', 50, 0, 97, 0));
    const out = E.moveGroups(lw, B, B, LIM, [{ axis: 'h', pos: 50, runs: [[0, 97]] }, { axis: 'v', pos: 97, runs: [[-1.5, 97]] }], 0, -60);
    assert.equal(out.ok, false);
  });

  test('several lines (#451): a pocket over an open stretch moved sideways, the open stretch goes along (screenshots moveGroup)', () => {
    // The front: 11 closed, 16 open, 17 closed; the pocket 13, 14, 15 stands on the joints between them
    const l = shaped([h(1, -1.5, -1.5, 195.5), v(2, 195.5, -1.5, 195.5), v(4, -1.5, -1.5, 195.5), h(11, 195.5, -1.5, 60), { ...h(16, 195.5, 60, 120), open: true }, h(17, 195.5, 120, 195.5), v(13, 60, 150, 195.5), h(14, 150, 60, 120), v(15, 120, 150, 195.5)]);
    const pocket = [
      { axis: 'v' as const, pos: 60, runs: [[150, 195.5]] as [number, number][] },
      { axis: 'h' as const, pos: 150, runs: [[60, 120]] as [number, number][] },
      { axis: 'v' as const, pos: 120, runs: [[150, 195.5]] as [number, number][] },
    ];
    const front = (r: R) => ok(r).walls.filter((q) => q.axis === 'h' && q.pos === 195.5).map((q) => [q.from, q.to, !!q.open]);
    assert.deepEqual(front(E.moveGroups(l, B, B, LIM, pocket, 30, 0)), [[-1.5, 90, false], [90, 150, true], [150, 195.5, false]]);
    assert.deepEqual(front(E.moveGroups(l, B, B, LIM, pocket, -30, 0)), [[-1.5, 30, false], [30, 90, true], [90, 195.5, false]]);
    // One side of the pocket as a stretch: the joint under it moves too
    assert.deepEqual(front(E.moveRuns(l, B, B, LIM, 'v', 60, [[150, 195.5]], 80)), [[-1.5, 80, false], [80, 120, true], [120, 195.5, false]]);
  });

  test('plan (#451): Shift adds stretches of other walls; dragged, they move together; Delete opens both', () => {
    const layout = L();
    const plan = { w: B, d: B, t: T, lim: LIM, layout, sides: ALL };
    const iv = idOn(layout, 'v', 97, 40),
      ih = idOn(layout, 'h', -1.5, 40);
    let state: unknown = null;
    let row = -1;
    const ev = (e: Record<string, unknown>) => {
      const r = planPointer(plan, { shift: false, ctrl: false, ...e } as never, { view: 'plan', state, selected: { walls: row }, have: [] } as never)!;
      if (r && 'state' in r) state = r.state;
      if (r?.select) row = (r.select as Record<string, number>).walls;
      return r;
    };
    ev({ type: 'down', hit: `w${iv}`, x: 97, y: 40 });
    ev({ type: 'up', x: 97, y: 40 });
    ev({ type: 'down', hit: `w${ih}`, x: 40, y: -1.5, shift: true });
    ev({ type: 'up', x: 40, y: -1.5 });
    const sel = (state as { sel: { axis: string; more?: unknown[] } }).sel;
    assert.deepEqual([sel.axis, sel.more?.length], ['h', 1], 'both lines selected, the one clicked last first');
    const accent = planDraw(plan, { view: 'plan', state, selected: { walls: row }, have: [] } as never).items.filter((i) => i.type === 'handle' && i.size === 5);
    assert.equal(accent.length, 2, 'a grip on each selected stretch');
    // A click on a selected stretch keeps the selection; dragged up and right
    ev({ type: 'down', hit: `w${iv}`, x: 97, y: 40 });
    ev({ type: 'move', x: 117, y: 30 });
    const up = ev({ type: 'up', x: 117, y: 30 }) as { patch: Record<string, string | number> };
    // (the arm is wider, the box is not: the front part reaches further to the right)
    assert.deepEqual([up.patch.width, up.patch.depth], [B + 2 * T, B + 10 + 2 * T], 'the box got deeper by the arm');
    // Delete: both stretches left open
    const next = { ...plan, layout: { ...layout, ref: [B, B + 10] as [number, number], walls: JSON.parse(String(up.patch.walls)) as Wall[] }, d: B + 10 };
    const del = planPointer(next, { type: 'key', key: 'Delete' } as never, { view: 'plan', state, selected: { walls: row }, have: [] } as never) as { patch: Record<string, string> };
    assert.equal((JSON.parse(del.patch.walls) as Wall[]).filter((q) => q.open).length, 2);
  });
}

// --- Außenwand in der Liste geändert (#451): die Kiste nimmt die Maße der Wände an ------------------------------------
{
  const edit = (walls: Wall[], f: (q: Wall) => Wall) => walls.map(f);
  const lay = (): Layout => ({ ref: [194, 194], walls: unify([], 194, 194, T, ALL), sides: ALL });
  const run = (l: Layout, w = 194, d = 194) => {
    const plan = { w, d, t: T, lim: LIM, layout: l, sides: ALL };
    return planPointer(plan, { type: 'move', x: 50, y: 50 } as never, { view: 'plan', state: null, selected: { walls: -1 }, have: [] } as never) as { patch?: Record<string, string | number> } | null;
  };

  test('list (#451): typing the position and ends of an outer wall (the box is still the old size) sets width and depth on the next move', () => {
    const l = lay();
    const [back, right, front] = [l.walls[0], l.walls[1], l.walls[2]];
    // The right wall in at 150, the ends of the back and front wall with it (three entries in the list)
    const moved: Layout = { ...l, walls: edit(l.walls, (q) => (q.id === right.id ? { ...q, pos: 150 } : q.id === back.id || q.id === front.id ? { ...q, to: 150 } : q)) };
    const r = run(moved);
    assert.ok(r?.patch, 'the plan answers with a patch');
    assert.equal(r!.patch!.width, 194 + 2 * T - 45.5, 'the width follows the right wall');
    assert.equal(r!.patch!.depth, 194 + 2 * T, 'the depth stays');
    // With the patch taken the walls are the size of the box: nothing more to do
    const w = JSON.parse(String(r!.patch!.walls)) as Wall[];
    const ref = JSON.parse(String(r!.patch!.wallsRef)) as [number, number];
    assert.equal(run({ ref, walls: w, sides: ALL }, 194 - 45.5, 194), null);
  });

  test('list (#451): the left wall typed in: the walls are put back to the corner and the width follows', () => {
    const l = lay();
    const left = l.walls[3];
    const moved: Layout = { ...l, walls: edit(l.walls, (q) => (q.id === left.id ? { ...q, pos: 20 } : q.axis === 'h' ? { ...q, from: 20 } : q)) };
    const r = run(moved);
    assert.ok(r?.patch);
    assert.equal(r!.patch!.width, 194 + 2 * T - 21.5);
    const w = JSON.parse(String(r!.patch!.walls)) as Wall[];
    assert.equal(Math.min(...w.map((q) => (q.axis === 'v' ? q.pos : q.from))), -1.5, 'the box starts at the corner again');
  });

  test('list (#451): a box that is as big as its walls, and walls that enclose no box, change nothing', () => {
    assert.equal(run(lay()), null);
    const l = lay();
    // The right wall removed from the list: no box
    assert.equal(run({ ...l, walls: l.walls.filter((q) => q.id !== l.walls[1].id) }), null);
  });
}

// --- Der Plan wächst beim Herausziehen (#451, Punkt 4) ---------------------------------------------------------------
{
  const { viewFit } = await import('../src/generators/surfaceView');
  const SW = 560, SH = 480;
  const sizeOf = { width: SW, height: SH };
  /** A plan on its drawing surface: the pointer is given in pixels, as in the app (the frame decides what they mean) */
  const session = (B: number) => {
    const layout: Layout = { ref: [B, B], walls: unify([], B, B, T, ALL), sides: ALL };
    const plan = { w: B, d: B, t: T, lim: LIM, layout, sides: ALL };
    let state: unknown = null;
    let row = -1;
    const surf = () => ({ view: 'plan', state, selected: { walls: row }, have: [], size: sizeOf }) as never;
    const ev = (e: Record<string, unknown>) => {
      const r = planPointer(plan, { shift: false, ctrl: false, ...e } as never, { view: 'plan', state, selected: { walls: row }, have: [] } as never) as { state?: unknown; select?: Record<string, number>; patch?: Record<string, string | number> } | null;
      if (r && 'state' in r) state = r.state;
      if (r?.select) row = r.select.walls;
      return r;
    };
    const frame = () => planDraw(plan, surf()).frame;
    const fit = () => viewFit(null, frame(), SW, SH);
    const right = layout.walls.find((q) => q.axis === 'v' && q.pos > B / 2)!;
    /** Press on the right outer wall; then moves to a pixel column (the middle row) */
    const press = () => ev({ type: 'down', hit: `w${right.id}`, x: Math.round(right.pos), y: Math.round(B / 2) });
    const moveToPx = (px: number) => {
      const q = fit();
      ev({ type: 'move', x: Math.round((px - q.ox) / q.k), y: Math.round((SH / 2 - q.oy) / q.k) });
    };
    const wallPx = () => {
      const x = (state as { walls?: Wall[] } | null)?.walls?.find((q) => q.id === right.id)?.pos;
      const q = fit();
      return x === undefined ? NaN : q.ox + x * q.k;
    };
    return { plan, ev, frame, fit, press, moveToPx, wallPx, right, startPx: () => fit().ox + right.pos * fit().k, getState: () => state };
  };
  const width = (f: { x0: number; x1: number }) => f.x1 - f.x0;

  test('plan grows (#451): the wall pulled to the edge of the plan, the frame grows a step with each move and the wall stays in view', () => {
    const S = session(194);
    const w0 = width(S.frame());
    S.press();
    // Inside the plan: the frame stays as it is
    S.moveToPx(S.startPx() - 40);
    assert.equal(width(S.frame()), w0, 'no growth while the wall is inside');
    // Pushed out past the edge, the pointer at the edge of the surface, many moves
    let last = width(S.frame());
    const steps: number[] = [];
    const px0 = S.startPx();
    for (let i = 1; i <= 120; i++) {
      S.moveToPx(i <= 20 ? px0 + ((SW - 4 - px0) * i) / 20 : SW - 4);
      const w = width(S.frame());
      steps.push(w - last);
      last = w;
      assert.ok(S.wallPx() <= SW, `move ${i}: the wall stays on the surface (${S.wallPx().toFixed(0)} px)`);
    }
    assert.ok(steps.every((d) => d >= -1e-9), 'the frame never shrinks while dragging out');
    assert.ok(Math.max(...steps) <= 0.012 * w0 + 1e-6, `a step is small (${Math.max(...steps).toFixed(2)} mm of ${w0})`);
    assert.ok(last > 2 * w0, 'the plan can be pulled to more than twice its size');
    // Steady, not faster and faster: the last steps are as big as the middle ones
    assert.ok(Math.abs(steps[119] - steps[60]) < 0.5, 'the growth is linear');
  });

  test('plan grows (#451): a wall pulled back does not shrink the frame; released, the plan hardly jumps', () => {
    const S = session(194);
    S.press();
    const px0 = S.startPx();
    for (let i = 1; i <= 60; i++) S.moveToPx(i <= 20 ? px0 + ((SW - 4 - px0) * i) / 20 : SW - 4);
    const grown = width(S.frame());
    // (it may still catch up with the room it keeps free beyond the wall, a step or two)
    for (let i = 1; i <= 10; i++) {
      S.moveToPx(SW - 4 - i * 20);
      assert.ok(width(S.frame()) >= grown - 1e-9, 'pulled back: the frame does not shrink');
    }
    const settled = width(S.frame());
    S.moveToPx(SW - 4 - 220);
    assert.equal(width(S.frame()), settled, 'pulled back: the frame stays');
    // Out again to the edge, then released there
    for (let i = 0; i < 10; i++) S.moveToPx(SW - 4);
    const before = width(S.frame());
    const up = S.ev({ type: 'up', x: 0, y: 0 });
    const w2 = Number(up!.patch!.width) - 2 * T;
    const L2: Layout = { ref: [w2, 194], walls: JSON.parse(String(up!.patch!.walls)) as Wall[], sides: ALL };
    const after = width(planDraw({ ...S.plan, layout: L2, w: w2 }, { view: 'plan', state: null, selected: { walls: -1 }, have: [], size: sizeOf } as never).frame);
    assert.ok(after / before > 0.9 && after / before < 1.15, `the frame after release is about the one before (${(after / before).toFixed(2)})`);
  });

  test('plan grows (#451): a small box can be pulled out to more than twice its size', () => {
    const S = session(30);
    const w0 = width(S.frame());
    S.press();
    const px0 = S.startPx();
    for (let i = 1; i <= 90; i++) S.moveToPx(i <= 20 ? px0 + ((SW - 4 - px0) * i) / 20 : SW - 4);
    assert.ok(width(S.frame()) > 2 * w0, `${width(S.frame()).toFixed(0)} mm from ${w0}`);
    assert.ok(S.wallPx() <= SW);
  });
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
