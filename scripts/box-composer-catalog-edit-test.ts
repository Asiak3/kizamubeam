// Test branch for #463: the box-composer tests of this repo, run on the catalog version (plugins/box-composer-catalog, 0.2.1)
// Box composer (#385): edit operations of the plan editor (move, stretch, add, delete), pure functions in Node.
// Aufruf: node scripts/run-ts.mjs scripts/box-composer-edit-test.ts
import { strict as assert } from 'node:assert';
import { buildModel, sampleLayout, type Wall } from '../plugins/box-composer-catalog/src/model';

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
const model = (walls: Wall[], w = W, d = D) => buildModel({ ref: [w, d], walls }, w, d, LIM);

// --- Bearbeiten (für den Plan-Editor, #385) -------------------------------------------------------------------------
const E = await import('../plugins/box-composer-catalog/src/edit');
const SK = sampleLayout(W, D);
const wallOf = (r: ReturnType<typeof E.moveWall>, id: number) => (r.ok ? r.layout.walls.find((x) => x.id === id) : undefined);
const kinds = (r: ReturnType<typeof E.moveWall>) => (r.ok ? model(r.layout.walls).walls.map((x) => [x.wall.id, x.start.kind, x.end.kind]) : null);

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
  const L = { ref: [W, D] as [number, number], walls: [{ id: 1, axis: 'v' as const, pos: 47, from: 0, to: 150 }, { id: 2, axis: 'h' as const, pos: 120, from: 0, to: 47 }, { id: 3, axis: 'h' as const, pos: 110, from: 47, to: 94 }] };
  const joined = E.moveWallNear(L, W, D, LIM, 3, 118);
  assert.ok(joined.ok);
  assert.deepEqual(joined.layout.walls.filter((x) => x.axis === 'h'), [{ id: 2, axis: 'h', pos: 120, from: 0, to: 94 }], 'one wall crossing wall 1');
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
  const G = { ref: [Q, Q] as [number, number], walls: [{ id: 1, axis: 'h' as const, pos: 130, from: 0, to: Q }, { id: 2, axis: 'v' as const, pos: 64, from: 0, to: Q }, { id: 3, axis: 'h' as const, pos: 64, from: 64, to: Q }, { id: 4, axis: 'v' as const, pos: 128, from: 0, to: 130 }] };
  const near = (id: number, pos: number, along: number) => { const r = E.moveWallNear(G, Q, Q, LIM, id, pos, 6, along); return r.ok ? r.layout.walls.find((x) => x.id === id)!.pos : NaN; };
  assert.equal(near(2, 62, 50), 63.25, 'pointer high on wall 2: the middle between the left wall and wall 4');
  assert.equal(near(2, 95, 160), 97, 'pointer low on wall 2: the middle of the whole width (no wall 4 there)');
  assert.equal(near(4, 95, 120), 97, 'pointer near wall 1: the middle of wall 1, which wall 4 ends on');
  assert.equal(near(4, 127, 70), 129, 'pointer near wall 3: the middle of wall 3, which wall 4 crosses');
  const m = model(G.walls, Q, Q);
  assert.deepEqual(E.wallCentre(m, G.walls[3], 120), { id: 1, at: 97 });
  assert.deepEqual(E.wallCentre(m, G.walls[3], 70), { id: 3, at: 129 });
  assert.equal(E.wallCentre(m, G.walls[0], 50)?.id, 2, 'wall 1 crosses wall 2; wall 4 ends on it and does not count');
  // In Flucht mit einer parallelen Wand, die sie nicht berührt: A (x = 30) endet oben auf Wand 1, B (x = 34) steht vorne
  const F = { ref: [W, D] as [number, number], walls: [{ id: 1, axis: 'h' as const, pos: 97, from: 0, to: W }, { id: 2, axis: 'v' as const, pos: 30, from: 0, to: 97 }, { id: 3, axis: 'v' as const, pos: 34, from: 120, to: D }] };
  const lined = E.moveWallNear(F, W, D, LIM, 3, 32, 6);
  assert.equal(wallOf(lined, 3)!.pos, 30, 'snapped into line with wall 2');
  assert.equal(E.lineUp((lined as { layout: { walls: Wall[] } }).layout.walls, wallOf(lined, 3)!), 2);
  assert.equal(wallOf(E.moveWallNear(F, W, D, LIM, 3, 38, 6), 3)!.pos, 38, 'further away: where it is dragged');
  // Offene linke Seite: die Bodenplatte reicht bis −t, die Mitte zwischen ihrem Rand und Wand 2 (47) liegt bei 21.25
  const open = { x0: false, x1: true, y0: true, y1: true };
  assert.deepEqual(E.neighbours(SK.walls, SK.walls[3], W, D, T, undefined, open), { lo: -4.5, hi: 47 });
  assert.equal(wallOf(E.moveWallNear(SK, W, D, LIM, 4, 20, 6, undefined, open), 4)!.pos, 21.25, 'open side: the middle up to the edge of the floor');
  // Mitte der ganzen Kiste (47), auch wenn das Fach eine andere Mitte hat (zwischen Wand 3 und rechts: 57.75)
  const B = { ref: [W, D] as [number, number], walls: [{ id: 1, axis: 'h' as const, pos: 97, from: 0, to: W }, { id: 2, axis: 'v' as const, pos: 70, from: 97, to: D }, { id: 3, axis: 'v' as const, pos: 20, from: 97, to: D }] };
  assert.equal(wallOf(E.moveWallNear(B, W, D, LIM, 2, 50, 6), 2)!.pos, 47, 'snapped to the middle of the box');
  assert.equal(wallOf(E.moveWallNear(B, W, D, LIM, 2, 50, 6, undefined, open), 2)!.pos, 47, 'the same with an open side');
  assert.equal(wallOf(E.moveWallNear(B, W, D, LIM, 2, 60, 6), 2)!.pos, 57.75, 'nearer the middle of the space: that one');
});

test('stretches: the pieces of a wall between its ends, T joints and crossings', () => {
  const m = model(SK.walls);
  // Wand 1 (y = 97): Wand 4 endet bei 19.74 auf ihr, Wand 2 kreuzt bei 47
  assert.deepEqual(E.stretchOf(m, SK.walls[0], 30), [19.74, 47]);
  assert.deepEqual(E.stretchOf(m, SK.walls[0], 5), [0, 19.74]);
  assert.deepEqual(E.stretchOf(m, SK.walls[0], 60), [47, 94]);
  assert.deepEqual(E.joinRuns([[47, 94], [19.74, 47], [0, 5]]), [[0, 5], [19.74, 94]]);
  assert.equal(E.wholeWall(SK.walls, 'h', 97, [[0, 19.74], [19.74, 47], [47, 94]]), 1);
  assert.equal(E.wholeWall(SK.walls, 'h', 97, [[19.74, 47]]), null);
});

/** The walls of a result without ids, sorted: [axis, pos, from, to] */
const shape = (r: ReturnType<typeof E.moveWall>) =>
  r.ok ? r.layout.walls.map((x) => [x.axis, +x.pos.toFixed(2), +x.from.toFixed(2), +x.to.toFixed(2)].join(' ')).sort() : r;

test('moving a stretch: its wall is cut, a wall from behind gets longer (a U), one from the front is crossed', () => {
  // Wand 1, Stück 19.74 … 47, nach hinten (y 85): Wand 4 kommt von vorne (von hinter dem Stück) und wird länger
  const up = E.moveRuns(SK, W, D, LIM, 'h', 97, [[19.74, 47]], 85);
  assert.ok(up.ok);
  assert.deepEqual(shape(up), ['h 150.35 47 94', 'h 85 19.74 47', 'h 97 0 19.74', 'h 97 47 94', 'v 19.74 85 169.75', 'v 47 0 150.35']);
  assert.deepEqual(model((up as { layout: { walls: Wall[] } }).layout.walls).issues.filter((i) => i.level === 'error'), []);
  // Nach vorne (y 110): Wand 4 kommt von dort, bleibt und wird gekreuzt
  const down = E.moveRuns(SK, W, D, LIM, 'h', 97, [[19.74, 47]], 110);
  assert.ok(down.ok);
  assert.deepEqual(shape(down), ['h 110 19.74 47', 'h 150.35 47 94', 'h 97 0 19.74', 'h 97 47 94', 'v 19.74 97 169.75', 'v 47 0 150.35']);
  // Zurück auf die Linie: wieder eine Wand, Wand 4 wie vorher
  const back = E.moveRuns((up as { layout: Parameters<typeof E.moveRuns>[0] }).layout, W, D, LIM, 'h', 85, [[19.74, 47]], 97);
  assert.deepEqual(shape(back), shape({ ok: true, layout: SK }));
  // Alle Stücke = die ganze Wand: wie moveWall
  assert.deepEqual(E.moveRunsNear(SK, W, D, LIM, 'h', 97, [[0, 19.74], [19.74, 94]], 80).ok && shape(E.moveRunsNear(SK, W, D, LIM, 'h', 97, [[0, 94]], 80)), shape(E.moveWall(SK, W, D, LIM, 1, 80)));
  // Ziehen: nächste ganze Zahl, die Lage der Stücke kommt mit
  const near = E.moveRunsNear(SK, W, D, LIM, 'h', 97, [[19.74, 47]], 85.3, 6, 30);
  assert.ok(near.ok);
  assert.equal(near.pos, 85);
});

test('moving past the end of a wall: that wall gets longer; a follower gets shorter only up to its next joint', () => {
  // Wie im Plan des Nutzers: 2 und 3 von hinten bis 100, 4 dazwischen bei 60, 1 und 5 enden bei 100 an 2 und 3 (Ecken)
  const L = {
    ref: [W, D] as [number, number],
    walls: [
      { id: 1, axis: 'h' as const, pos: 100, from: 0, to: 30 },
      { id: 2, axis: 'v' as const, pos: 30, from: 0, to: 100 },
      { id: 3, axis: 'v' as const, pos: 60, from: 0, to: 100 },
      { id: 4, axis: 'h' as const, pos: 60, from: 30, to: 60 },
      { id: 5, axis: 'h' as const, pos: 100, from: 60, to: W },
    ],
  };
  const down = E.moveWall(L, W, D, LIM, 4, 130);
  assert.deepEqual(shape(down), ['h 100 0 30', 'h 100 60 94', 'h 130 30 60', 'v 30 0 130', 'v 60 0 130'], '2 and 3 reach wall 4');
  assert.deepEqual(model((down as { layout: { walls: Wall[] } }).layout.walls).issues.filter((i) => i.level === 'error'), []);
  // Zurück nach oben: 2 und 3 folgen nur bis zu den Wänden 1 und 5 (bei 100), Wand 4 endet dann wieder an ihnen
  const up = E.moveWall((down as { layout: Parameters<typeof E.moveWall>[0] }).layout, W, D, LIM, 4, 60);
  assert.deepEqual(shape(up), shape({ ok: true, layout: L }));
  // Ein Stück, das über das Ende einer Wand hinaus geht, die es kreuzt: die Wand wird länger (Wand 4 der Skizze bis 175)
  const past = E.moveRuns(SK, W, D, LIM, 'h', 97, [[19.74, 47]], 175);
  assert.ok(past.ok);
  assert.ok(shape(past).includes('v 19.74 97 175'), 'wall 4 reaches the stretch');
});

test('deleting a stretch: the rest of the wall stays', () => {
  const r = E.deleteRuns(SK, W, D, 'h', 97, [[19.74, 47]]);
  assert.deepEqual(shape(r), ['h 150.35 47 94', 'h 97 0 19.74', 'h 97 47 94', 'v 19.74 97 169.75', 'v 47 0 150.35']);
});

test('stretch: snaps to outer walls and walls, joints may appear or go', () => {
  const r = E.stretchEnd(SK, W, D, LIM, 4, 'to', 192, 3);
  assert.ok(r.ok);
  assert.equal(wallOf(r, 4)!.to, D, 'snapped to the outer wall');
  assert.deepEqual(kinds(r)!.find((k) => k[0] === 4), [4, 'tee', 'outer']);
  const f = E.stretchEnd(SK, W, D, LIM, 4, 'to', 150, 3);
  assert.ok(f.ok && wallOf(f, 4)!.to === 150, 'nothing near: free end');
  // Wand 2 über die Ecke hinaus verlängert: Wand 3 stößt jetzt als T an Wand 2
  const t = E.stretchEnd(SK, W, D, LIM, 2, 'to', 180, 3);
  assert.ok(t.ok);
  assert.deepEqual(kinds(t)!.find((k) => k[0] === 3), [3, 'tee', 'outer']);
  assert.deepEqual(E.stretchEnd(SK, W, D, LIM, 4, 'to', 100, 3), { ok: false, code: 'wall-short', values: { id: 4, min: 6 } });
});

test('add: ends snap into T and corners, refused on an existing wall or too close; delete frees the ends', () => {
  const a = E.addWall(SK, W, D, LIM, 'h', 40, 0, 46, 3);
  assert.ok(a.ok);
  const nw = wallOf(a, 5)!;
  assert.deepEqual([nw.from, nw.to], [0, 47], 'snapped to the outer wall and to wall 2');
  assert.deepEqual(kinds(a)!.find((k) => k[0] === 5), [5, 'outer', 'tee']);
  // Ecke: Ende nahe am freien Ende von Wand 4 (x = 19,74, bis y = 169,75)
  const l = E.addWall(SK, W, D, LIM, 'h', 171, 0, 19, 3);
  assert.ok(l.ok);
  assert.equal(wallOf(l, 4)!.to, 171, 'the free end of wall 4 comes onto the new line');
  assert.deepEqual(kinds(l)!.filter((k) => k[0] === 4 || k[0] === 5), [[4, 'tee', 'corner'], [5, 'outer', 'corner']]);
  assert.deepEqual(E.addWall(SK, W, D, LIM, 'h', 97, 10, 30, 3), { ok: false, code: 'add-on-wall', values: { id: 5 } });
  assert.equal((E.addWall(SK, W, D, LIM, 'h', 100, 0, 30, 3) as { code: string }).code, 'walls-close');
  const del = E.deleteWall(SK, W, D, 1);
  assert.ok(del.ok);
  assert.deepEqual(kinds(del), [[2, 'outer', 'corner'], [3, 'corner', 'outer'], [4, 'free', 'free']]);
});


if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
