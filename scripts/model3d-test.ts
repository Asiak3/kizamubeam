// Tests für 3D-Modelle: STL/OBJ lesen, Querschnitte, Schichtmodell. Aufruf: npm run test:model3d
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { Mesh } from '../src/model3d/mesh';
import type { Pt } from '../src/model';
const { parseStl, parseObj, weld, meshInfo, encodeMesh, decodeMesh, meshId } = await import('../src/model3d/mesh');
const { prepare, sliceAt, region, sliceRegion, cleanRegion, regionArea, deepestPoint } = await import('../src/model3d/slice');
const { addMesh } = await import('../src/model3d/store');
const { STACK, stackLayout, numberStrokes, FRAMES } = await import('../src/generators/stack');
const { RIBS, ribsLayout, worldMesh, materialAlong, ranges, splitPlate } = await import('../src/generators/ribs');
const { buildGen, defaultParams, normalizeParams } = await import('../src/generators/index');
const { asmSolids, findOverlaps, solidBounds } = await import('../src/view3d/solids');
const { suggestSections, voxelize } = await import('../src/model3d/suggest');

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
const near = (a: number, b: number, eps: number, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} ≠ ${b} (±${eps})`);

// ---------- Testkörper (selbst erzeugt, keine fremden Modelle) ----------

/** Fläche (u, v) → Punkt als Gitter; geschlossen in u, Pole/Ränder je nach Körper */
function gridMesh(nu: number, nv: number, f: (u: number, v: number) => [number, number, number], closeV: boolean): Mesh {
  const soup: number[] = [];
  const P = (i: number, j: number) => f((i % nu) / nu, closeV ? (j % nv) / nv : j / nv);
  const tri = (a: number[], b: number[], c: number[]) => soup.push(...a, ...b, ...c);
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const a = P(i, j),
        b = P(i + 1, j),
        c = P(i + 1, j + 1),
        d = P(i, j + 1);
      tri(a, b, c);
      tri(a, c, d);
    }
  return weld(Float32Array.from(soup));
}
const sphere = (r: number, n = 96) =>
  gridMesh(n, n / 2, (u, v) => {
    const th = u * 2 * Math.PI,
      ph = v * Math.PI;
    return [r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)];
  }, false);
const torus = (R: number, r: number, n = 96) =>
  gridMesh(n, n / 2, (u, v) => {
    const a = u * 2 * Math.PI,
      b = v * 2 * Math.PI;
    return [(R + r * Math.cos(b)) * Math.cos(a), (R + r * Math.cos(b)) * Math.sin(a), r * Math.sin(b)];
  }, true);
function cube(s: number): Mesh {
  const v = [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return weld(Float32Array.from(f.flatMap((t) => t.flatMap((i) => v[i]))));
}
function toBinaryStl(m: Mesh): ArrayBuffer {
  const n = m.tri.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++)
      for (let c = 0; c < 3; c++) dv.setFloat32(84 + i * 50 + 12 + k * 12 + c * 4, m.pos[m.tri[i * 3 + k] * 3 + c], true);
  return buf;
}
const ident = (x: number, y: number, z: number): [number, number, number] => [x, y, z];

// ---------- Lesen ----------

test('STL binär und als Text, OBJ mit Vierecken und negativen Indizes', () => {
  const s = sphere(10, 32);
  const back = parseStl(toBinaryStl(s));
  assert.equal(back.tri.length, s.tri.length);
  const info = meshInfo(back);
  assert.equal(info.openEdges, 0, 'dicht');
  near(info.max[2] - info.min[2], 20, 1e-4, 'Höhe');
  const ascii = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n`;
  assert.equal(parseStl(new TextEncoder().encode(ascii).buffer as ArrayBuffer).tri.length, 3);
  const obj = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1/1/1 2/2/1 3/3/1 4/4/1\nf -4 -2 -1\n';
  const m = parseObj(obj);
  assert.equal(m.tri.length / 3, 3);
  assert.equal(m.pos.length / 3, 4, 'verschweißt');
  assert.throws(() => parseStl(new TextEncoder().encode('kein stl').buffer as ArrayBuffer));
  assert.throws(() => parseObj('v 0 0 0\nf 1 2 3\n'));
});

test('Kompakt speichern: Hin und zurück, gleiche Kennung', () => {
  const t = torus(20, 5, 24);
  const data = encodeMesh(t);
  const back = decodeMesh(data);
  assert.deepEqual([...back.tri], [...t.tri]);
  assert.deepEqual([...back.pos], [...t.pos]);
  assert.equal(meshId(data), meshId(encodeMesh(back)));
  assert.equal(addMesh(t), addMesh(back));
});

// ---------- Querschnitte ----------

test('Querschnitt einer Kugel: Fläche π(r² − z²)', () => {
  const P = prepare(sphere(50), ident, FRAMES.z);
  for (const z of [-40, -10, 0, 25, 45]) {
    const s = sliceAt(P, z);
    assert.equal(s.open, 0);
    assert.equal(s.loops.length, 1, `z=${z}`);
    const a = regionArea(cleanRegion(region(s.loops), 0).polys);
    near(a, Math.PI * (2500 - z * z), Math.PI * (2500 - z * z) * 0.01, `z=${z}`);
  }
  // Ecke genau auf der Schnitthöhe (Würfel: z = 0 und z = s liegen auf Ecken)
  const C = prepare(cube(10), ident, FRAMES.z);
  for (const z of [1e-9, 5, 10 - 1e-9]) near(regionArea(cleanRegion(region(sliceAt(C, z).loops), 0).polys), 100, 1e-6, `Würfel z=${z}`);
});

test('Querschnitt eines Torus: Ring mit Loch, kleine Flächen fallen weg', () => {
  const P = prepare(torus(40, 10), ident, FRAMES.z);
  const s = sliceAt(P, 0);
  assert.equal(s.loops.length, 2);
  const r = cleanRegion(region(s.loops), 1);
  assert.equal(r.islands, 1);
  near(regionArea(r.polys), Math.PI * (50 * 50 - 30 * 30), Math.PI * 1600 * 0.01, 'Ring');
  // Mit großer Mindestfläche wird das Loch gefüllt
  const full = cleanRegion(region(s.loops), 3000);
  near(regionArea(full.polys), Math.PI * 2500, Math.PI * 2500 * 0.01, 'Loch gefüllt');
  // Quer geschnitten (Schichten von vorne nach hinten): zwei Kreise
  const Q = prepare(torus(40, 10), ident, FRAMES.y);
  assert.equal(cleanRegion(region(sliceAt(Q, 0).loops), 1).islands, 2);
  const d = deepestPoint(r.polys)!;
  near(d.r, 10, 0.6, 'tiefster Punkt im Ring');
});

test('Überlappende Körper verschmelzen, Drehrichtung egal', () => {
  // Zwei Kugeln (r 10, Abstand 10) in einer Datei, wie bei vielen STL-Modellen nicht vereinigt
  const a = sphere(10, 64),
    b = sphere(10, 64);
  const n = a.pos.length / 3;
  const pos = new Float32Array([...a.pos, ...[...b.pos].map((v, i) => (i % 3 === 0 ? v + 10 : v))]);
  const two: Mesh = { pos, tri: Uint32Array.from([...a.tri, ...[...b.tri].map((i) => i + n)]) };
  const s = sliceAt(prepare(two, ident, FRAMES.z), 0);
  assert.ok(s.oriented, 'ausgerichtet');
  const lens = 2 * (100 * Math.acos(0.5) - 5 * Math.sqrt(75)); // Schnittfläche zweier Kreise
  const want = 2 * Math.PI * 100 - lens;
  near(regionArea(cleanRegion(sliceRegion(s), 0).polys), want, want * 0.01, 'Vereinigung');
  // Gerade-Ungerade hätte die Überlappung ausgespart
  assert.ok(regionArea(cleanRegion(region(s.loops), 0).polys) < want - lens * 0.9);
  // Nach innen gedrehtes Netz und gespiegeltes Achsensystem ergeben dieselbe Fläche
  const inv: Mesh = { pos: two.pos, tri: Uint32Array.from(two.tri, (_, i) => two.tri[i - (i % 3) + [0, 2, 1][i % 3]]) };
  near(regionArea(cleanRegion(sliceRegion(sliceAt(prepare(inv, ident, FRAMES.z), 0)), 0).polys), want, want * 0.01, 'innen');
  // Torus mit Loch bleibt ein Ring
  const t = sliceAt(prepare(torus(40, 10), ident, FRAMES.z), 0);
  assert.ok(t.oriented);
  near(regionArea(cleanRegion(sliceRegion(t), 1).polys), Math.PI * 1600, Math.PI * 16, 'Ring');
  // Uneinheitlich gedrehte Dreiecke: Gerade-Ungerade als Rückfall
  const mixed: Mesh = { pos: a.pos, tri: Uint32Array.from(a.tri, (_, i) => (Math.floor(i / 3) % 2 ? a.tri[i - (i % 3) + [0, 2, 1][i % 3]] : a.tri[i])) };
  const m = sliceAt(prepare(mixed, ident, FRAMES.z), 3);
  assert.ok(!m.oriented);
  near(regionArea(cleanRegion(sliceRegion(m), 0).polys), Math.PI * 91, Math.PI, 'Rückfall');
});

test('Netz mit Loch: offene Stelle wird gemeldet oder überbrückt', () => {
  const s = sphere(30, 48);
  // Ein Dreieck an der Seite entfernen
  const tri = Uint32Array.from([...s.tri].filter((_, i) => Math.floor(i / 3) !== 1000));
  const holed = { pos: s.pos, tri };
  assert.ok(meshInfo(holed).openEdges >= 3);
  const P = prepare(holed, ident, FRAMES.z);
  const z = P.Z[tri[1000 * 3]] + 0.01;
  const r = sliceAt(P, z, 50);
  assert.equal(r.loops.length, 1, 'mit großer Lücke geschlossen');
  assert.ok(sliceAt(P, z, 1e-6).open >= 1, 'ohne Überbrückung offen');
});

// ---------- Schichtmodell ----------

const sphereId = addMesh(sphere(50));
const torusId = addMesh(torus(40, 10));
const params = (o: Record<string, unknown> = {}) => normalizeParams(STACK, { ...defaultParams(STACK), model: sphereId, name: 'Kugel', kerf: 0, ...o });

test('Schichtmodell: Anzahl, Schlüssel, Nummern, Prüfung', () => {
  const r = buildGen(STACK, params({ size: 100, thickness: 5 }));
  assert.deepEqual(r.issues.filter((i) => i.level === 'error'), []);
  assert.equal(r.parts.length, 20);
  assert.deepEqual(r.parts.map((p) => p.shape.part), Array.from({ length: 20 }, (_, i) => `L${i + 1}`));
  for (const p of r.parts) assert.ok(p.shape.subs.every((s) => s.closed && s.nodes.length >= 3));
  // Nummern auf allen außer den kleinsten Kappen
  const marked = r.parts.filter((p) => p.marks?.length).length;
  assert.ok(marked >= 16, `Nummern: ${marked}`);
  assert.ok(r.parts[10].marks!.every((m) => m.nodes.length >= 2));
  assert.equal(buildGen(STACK, params({ size: 100, thickness: 5, numbers: false })).parts.some((p) => p.marks), false);
  // Fehlendes Modell
  assert.ok(STACK.validate(params({ model: 'gibtsnicht' })).some((i) => i.level === 'error'));
  assert.ok(STACK.validate(params({ size: 3000, thickness: 0.3 })).some((i) => i.level === 'error'), 'zu viele Schichten');
  // Ziffer 8: ein geschlossener Linienzug (oberes Viereck) plus Rest
  assert.ok(numberStrokes('8', { x: 0, y: 0 }, 10).length <= 3);
});

test('Schichtmodell: außen ≥ Mitte ≥ innen, Größe und Ausrichtung', () => {
  // Leere Schichten fallen weg, deshalb nach Schlüssel vergleichen
  const area = (sample: string) => new Map(stackLayout(params({ size: 100, thickness: 5, sample }))!.layers.map((l) => [l.key, regionArea(l.polys)]));
  const mid = area('mid'),
    out = area('outer'),
    inn = area('inner');
  assert.ok(out.size >= mid.size && mid.size >= inn.size);
  for (const [k, m] of mid) {
    const o = out.get(k)!,
      i = inn.get(k) ?? 0;
    assert.ok(o >= m - 1e-6 && m >= i - 1e-6, `${k}: ${o} ${m} ${i}`);
  }
  // Torus stehend (Y oben) vs. liegend: Maße vertauschen sich
  const lying = stackLayout(params({ model: torusId, size: 100 }))!;
  near(lying.dims[2], 20, 0.01, 'liegend Höhe');
  const standing = stackLayout(params({ model: torusId, size: 100, up: 'y' }))!;
  near(standing.dims[2], 100, 0.01, 'stehend Höhe');
  near(standing.dims[1], 20, 0.01, 'stehend Tiefe');
  // Schichten von vorne nach hinten durch den stehenden Torus
  assert.equal(stackLayout(params({ model: torusId, size: 100, up: 'y', axis: 'y', thickness: 2 }))!.layers.length, 10);
  // Schnittfuge macht jede Scheibe größer
  const k0 = stackLayout(params({ size: 100, thickness: 5 }))!.layers[10];
  const k1 = stackLayout(params({ size: 100, thickness: 5, kerf: 0.4 }))!.layers[10];
  assert.ok(regionArea(k1.polys) > regionArea(k0.polys));
});

test('Schichtmodell in 3D: Scheiben liegen aufeinander, ohne Durchdringung', () => {
  const s = asmSolids('stack', params({ size: 100, thickness: 5 }), 3)!;
  assert.equal(s.length, 20);
  assert.deepEqual(findOverlaps(s).map((o) => `${o.a}/${o.b}`), []);
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const x of s) {
    const b = solidBounds(x);
    for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], b.min[k])), (hi[k] = Math.max(hi[k], b.max[k]));
  }
  near(hi[2] - lo[2], 100, 1e-6, 'Höhe');
  near(hi[0] - lo[0], 100, 1.5, 'Breite');
  // Torus von vorne nach hinten: Scheiben stehen senkrecht hintereinander
  const v = asmSolids('stack', params({ model: torusId, size: 100, up: 'y', axis: 'y', thickness: 2 }), 3)!;
  assert.ok(v.every((x) => x.pose.n[1] === 1));
  assert.deepEqual(findOverlaps(v), []);
});

test('Schichtmodell: Querschnitt-Fläche passt zur Kugel', () => {
  const L = stackLayout(params({ size: 100, thickness: 5 }))!;
  for (const [i, l] of L.layers.entries()) {
    const z = -50 + (i + 0.5) * 5;
    const want = Math.PI * (2500 - z * z);
    near(regionArea(l.polys), want, want * 0.02, `Schicht ${i + 1}`);
  }
  const pts: Pt[] = L.layers[0].polys[0];
  assert.ok(pts.length > 10);
});


// ---------- Rippenmodell ----------

const ellipsoid = (rx: number, ry: number, rz: number, c: [number, number, number] = [0, 0, 0], n = 64) =>
  gridMesh(n, n / 2, (u, v) => {
    const th = u * 2 * Math.PI,
      ph = v * Math.PI;
    return [c[0] + rx * Math.sin(ph) * Math.cos(th), c[1] + ry * Math.sin(ph) * Math.sin(th), c[2] + rz * Math.cos(ph)];
  }, false);
function merge(...ms: Mesh[]): Mesh {
  let off = 0;
  const pos: number[] = [],
    tri: number[] = [];
  for (const m of ms) {
    pos.push(...m.pos);
    tri.push(...[...m.tri].map((i) => i + off));
    off += m.pos.length / 3;
  }
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}
// Fisch: Ellipsoid 120 × 40 × 60 mm; Tier: Rumpf + vier Beine (seitlich der Mitte)
const fishId = addMesh(ellipsoid(60, 20, 30));
const animalId = addMesh(merge(ellipsoid(60, 22, 25, [0, 0, 60]), ...[[-35, -14], [-35, 14], [35, -14], [35, 14]].map(([x, y]) => ellipsoid(7, 7, 18, [x, y, 20]))));
const rp = (o: Record<string, unknown> = {}) => normalizeParams(RIBS, { ...defaultParams(RIBS), model: fishId, name: 'Fisch', size: 120, kerf: 0, ...o });

test('Rippenmodell: Anzahl, Schlitze in Rippen und Rückgrat, Nummern', () => {
  const L = ribsLayout(rp())!;
  // Länge 120, Abstand 10, Dicke 3: 12 Rippen
  assert.equal(L.count, 12);
  assert.equal(L.ribs.length + L.lostRibs, 12);
  assert.ok(L.ribs.length >= 10, `${L.ribs.length} Rippen`);
  assert.equal(L.spine.length, 1);
  assert.deepEqual(L.ribs.map((r) => r.key), L.ribs.map((_, i) => `R${i + 1}`));
  // Mittlere Rippe: Ellipse 40 × 60 minus Schlitz (Breite 3,1, halbe Höhe)
  const mid = L.ribs[Math.floor(L.ribs.length / 2)];
  const full = Math.PI * 20 * 30;
  const a = regionArea(mid.polys);
  assert.ok(a < full - 3.1 * 20 && a > full - 3.1 * 40, `Rippe ${a} von ${full}`);
  // Rückgrat (nach innen versetzt um 2 mm): ein Schlitz je Rippe
  const sa = regionArea(L.spine[0].polys);
  const sfull = Math.PI * 58 * 28;
  assert.ok(sa < sfull - L.ribs.length * 3.1 * 10, `Rückgrat ${sa}`);
  // Nummern: Rippen und Schlitzmarken
  const r = buildGen(RIBS, rp());
  assert.equal(r.parts.length, L.ribs.length + 1);
  assert.ok(r.parts.filter((x) => x.marks?.length).length >= L.ribs.length - 2);
  assert.ok(r.parts.find((x) => x.shape.part === 'S')!.marks!.length > 0, 'Schlitzmarken');
  assert.deepEqual(RIBS.validate(rp()).filter((i) => i.level === 'error'), []);
  assert.ok(RIBS.validate(rp({ spacing: 3 })).some((i) => i.key === 'spacing' && i.level === 'error'));
});

test('Rippenmodell in 3D: gesteckt ohne Durchdringung, Presspassung wird erkannt', () => {
  for (const o of [{}, { axis: 'z', spineDir: 'x', size: 120 }, { spineDir: 'y' }]) {
    const s = asmSolids('ribs', rp(o), 3)!;
    assert.ok(s.length > 5);
    assert.deepEqual(findOverlaps(s).map((x) => `${x.a}/${x.b}`), [], JSON.stringify(o));
  }
  // Schlitze schmaler als die Dicke: Rippen und Rückgrat durchdringen sich
  assert.ok(findOverlaps(asmSolids('ribs', rp({ play: -0.5 }), 3)!).length > 5);
  // Teile liegen im Modell: Ausdehnung = Fisch
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const x of asmSolids('ribs', rp({ spineInset: 0 }), 3)!) {
    const b = solidBounds(x);
    for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], b.min[k])), (hi[k] = Math.max(hi[k], b.max[k]));
  }
  near(hi[2] - lo[2], 60, 1, 'Höhe');
  near(hi[1] - lo[1], 40, 1, 'Breite');
  assert.ok(hi[0] - lo[0] > 110 && hi[0] - lo[0] <= 120.01, 'Länge');
});

test('Rippenmodell: Beine neben dem Rückgrat fallen weg, Torus hat zwei Rückgrate', () => {
  const L = ribsLayout(rp({ model: animalId, size: 120 }))!;
  assert.ok(L.lostPieces > 0, 'Beinstücke');
  assert.ok(RIBS.validate(rp({ model: animalId, size: 120 })).some((i) => i.key === 'spineOffset'));
  // Keine Rippe enthält ein Bein: alles liegt über dem Rumpfboden (Rumpf ab z = 35 von 85)
  for (const r of L.ribs) {
    const s = asmSolids('ribs', rp({ model: animalId, size: 120 }), 3)!.find((x) => x.key === r.key)!;
    assert.ok(solidBounds(s).min[2] > 30, r.key);
  }
  const T = ribsLayout(rp({ model: torusId, size: 100 }))!;
  assert.equal(T.spine.length, 2);
  assert.ok(T.lostRibs > 0);
  assert.ok(RIBS.validate(rp({ model: torusId, size: 100 })).some((i) => i.key === 'spineInset'));
});


// Tier mit Abschnitten: Rumpf, vier Beine (mit dem Rumpf verschmolzen), gebogener Schwanz aus Kugeln
const beastParts: Mesh[] = [ellipsoid(60, 22, 25, [0, 0, 60])];
for (const [x, y] of [[-35, -12], [-35, 12], [35, -12], [35, 12]]) beastParts.push(ellipsoid(7, 7, 32, [x, y, 30]));
const tailAt = (a: number): [number, number, number] => [90 + 26 * Math.cos(a), 0, 66 + 26 * Math.sin(a)];
for (let a = Math.PI * 1.05; a >= Math.PI * 0.55; a -= 0.08) beastParts.push(ellipsoid(7, 7, 7, tailAt(a), 24));
const beast = merge(...beastParts);
const beastId = addMesh(beast);
// Maßstab 1: Größe = längste Seite; Welt = Modell verschoben (Mitte in X/Y, Boden bei Z = 0)
const bw = worldMesh(beast, 'z', 1);
const blo = [Infinity, Infinity, Infinity],
  bhi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < beast.pos.length; i += 3)
  for (let k = 0; k < 3; k++) (blo[k] = Math.min(blo[k], beast.pos[i + k])), (bhi[k] = Math.max(bhi[k], beast.pos[i + k]));
const bsize = Math.max(bhi[0] - blo[0], bhi[1] - blo[1], bhi[2] - blo[2]);
void bw;
const W = (x: number, z: number): [number, number] => [x - (blo[0] + bhi[0]) / 2, z - blo[2]];
const sections = [
  { name: 'Rumpf', view: 'xz', pts: [W(-60, 60), W(60, 60)], offset: 0 },
  ...[[-35, -12], [-35, 12], [35, -12], [35, 12]].map(([x, y], i) => ({ name: `Bein ${i + 1}`, view: 'xz', pts: [W(x, 24), W(x, 0)], offset: y, extend: 25 })),
  { name: 'Schwanz', view: 'xz', pts: [Math.PI * 1.0, Math.PI * 0.9, Math.PI * 0.8, Math.PI * 0.7, Math.PI * 0.6].map((a) => W(tailAt(a)[0], tailAt(a)[2])), offset: 0, spacing: 7 },
];
const bp = (o: Record<string, unknown> = {}) => rp({ model: beastId, name: 'Tier', size: bsize, sections: JSON.stringify(sections), ...o });

test('Rippenmodell mit Abschnitten: Rumpf, Beine, gebogener Schwanz', () => {
  const L = ribsLayout(bp())!;
  assert.ok(L.manual);
  assert.deepEqual(L.bad, []);
  for (const s of L.sections) assert.ok(s.ribs >= 2, `${s.name}: ${s.ribs} Rippen`);
  // Rückgrate: Rumpf + Schwanz in einer Ebene, dazu vier Beinplatten
  const legSpines = L.spine.filter((x) => Math.abs(Math.abs(x.pose.o[1] + x.pose.n[1] * 1.5) - 12) < 0.5);
  assert.equal(legSpines.length, 4, 'Beinplatten');
  assert.ok(L.spine.length >= 5 && L.spine.length <= 6, `${L.spine.length} Rückgrate`);
  const s = asmSolids('ribs', bp(), 3)!;
  assert.deepEqual(findOverlaps(s).map((x) => `${x.a}/${x.b}`), []);
  const z = (k: string) => solidBounds(s.find((x) => x.key === k)!);
  for (const r of L.ribs) {
    if (r.section === 0) assert.ok(z(r.key).min[2] > 28, `Rumpf-Rippe ${r.key} ohne Bein`);
    if (r.section >= 1 && r.section <= 4) assert.ok(z(r.key).max[2] < 30, `Bein-Rippe ${r.key}`);
  }
  // Beinplatten stecken in Rumpf-Rippen: ohne Spiel durchdringen sie sich
  const tight = findOverlaps(asmSolids('ribs', bp({ play: -0.5 }), 3)!);
  const legKeys = new Set(legSpines.map((x) => x.key));
  const body = new Set(L.ribs.filter((r) => r.section === 0).map((r) => r.key));
  assert.ok(tight.some((o) => (legKeys.has(o.a) && body.has(o.b)) || (legKeys.has(o.b) && body.has(o.a))), 'Beinplatte ↔ Rumpf-Rippe');
  // Schwanz-Rippen stehen schräg (gebogene Achse)
  const tail = L.ribs.filter((r) => r.section === 5);
  assert.ok(tail.some((r) => Math.abs(r.pose.n[2]) > 0.3), 'schräge Schwanz-Rippe');
  assert.deepEqual(RIBS.validate(bp()).filter((i) => i.level === 'error'), []);
  // Beinplatte reicht nur knapp in den Rumpf: Kerbe statt Schlitz, trotzdem keine Durchdringung
  const short = JSON.stringify(sections.map((x, i) => (i >= 1 && i <= 4 ? { ...x, extend: 6 } : x)));
  assert.deepEqual(findOverlaps(asmSolids('ribs', bp({ sections: short }), 3)!).map((x) => `${x.a}/${x.b}`), []);
  // Gebogen und zu eng: Hinweis
  const tight2 = JSON.stringify([{ ...sections[5], spacing: 3.6, pts: [W(64, 66), W(80, 66), W(80, 90)] }, sections[0]]);
  assert.ok(RIBS.validate(bp({ sections: tight2 })).some((i) => /Biegung|bend/.test(i.msg)), 'Biegung');
  // Material entlang eines Strahls (für „Mitte“ im Dialog): Bein bei y = ±12
  const iv = materialAlong(worldMesh(beast, 'z', bsize).mesh, [W(-35, 10)[0], -40, W(-35, 10)[1]], [0, 1, 0]);
  assert.equal(iv.length, 2);
  near((iv[0][0] + iv[0][1]) / 2 - 40, -12, 0.5, 'Bein links');
});

test('Rippenmodell: Vorschlag findet Rumpf, vier Beine und Schwanz; unterste Beinrippe auf dem Boden', () => {
  const p0 = bp({ sections: '' });
  const sg = suggestSections(beast, p0);
  const legs = sg.sections.filter((s) => s.extend > 0 && s.offset !== sg.sections[0].offset);
  assert.equal(legs.length, 4, sg.found);
  for (const l of legs) near(Math.abs(l.offset), 12, 1.5, `Bein ${l.name} quer`);
  // Rumpf liegt in der Spiegelebene y = 0 und ist fast waagerecht
  const r = sg.sections[0];
  assert.equal(r.view, 'xz');
  near(r.offset, 0, 1, 'Spiegelebene');
  assert.ok(Math.abs(r.pts[1][1] - r.pts[0][1]) < 0.25 * Math.abs(r.pts[1][0] - r.pts[0][0]), 'Rumpf waagerecht');
  // Schwanz als eigener, gebogener Abschnitt
  const tail = sg.sections.find((s) => s !== r && !legs.includes(s));
  assert.ok(tail && tail.pts.length >= 3, `Schwanz: ${JSON.stringify(tail?.pts)}`);
  const p = bp({ sections: JSON.stringify(sg.sections) });
  const L = ribsLayout(p)!;
  for (const s of L.sections) assert.ok(s.ribs >= 2, `${s.name}: ${s.ribs} Rippen`);
  assert.deepEqual(findOverlaps(asmSolids('ribs', p, 3)!).map((x) => `${x.a}/${x.b}`), []);
  // Standfläche: Die Beinrippen sind vom Boden aus gesetzt (Unterseite bei z = 0, 10, 20 …; die Spitze des
  // Test-Beins ist für eine Rippe zu klein)
  for (let si = 1; si < L.sections.length; si++) {
    if (!legs.some((l) => l.name === L.sections[si].name)) continue;
    for (const x of L.ribs.filter((q) => q.section === si)) {
      const bottom = x.pose.o[2] + x.pose.n[2] * 1.5 - 1.5;
      const k = Math.round(bottom / 10);
      near(bottom, k * 10, 0.2, `${L.sections[si].name}: Rippe ab Boden`);
    }
  }
});

test('Voxel-Raster: Kugel füllt etwa π/6 ihres Würfels', () => {
  const g = voxelize(sphere(20, 48), 40);
  let n = 0;
  for (const x of g.v) n += x;
  near(n / (g.nx * g.ny * g.nz), Math.PI / 6, 0.03, 'Füllgrad');
});

test('Rippenmodell: lange Platten mit Schwalbenschwanz geteilt, Bauplan mit Steckreihenfolge', () => {
  assert.equal(ranges([3, 1, 2, 7, 9, 10]), '1–3, 7, 9–10');
  // Rechteck 200 × 40 in Stücke bis 80 mm: drei Stücke, Zapfen greift ins Nachbarstück
  const rect = [[{ x: -100, y: -20 }, { x: 100, y: -20 }, { x: 100, y: 20 }, { x: -100, y: 20 }]];
  const pcs = splitPlate(rect, 80, 3, 0.1, 1)!;
  assert.equal(pcs.length, 3);
  for (const pc of pcs) {
    const xs = pc.flat().map((q) => q.x);
    assert.ok(Math.max(...xs) - Math.min(...xs) <= 80 + 12 + 1e-6, `Stück ${Math.min(...xs)}…${Math.max(...xs)}`);
  }
  const area = pcs.reduce((s, pc) => s + regionArea(pc), 0);
  near(area, 200 * 40, 40, 'Fläche bleibt (bis aufs Spiel)');
  // Am Tier: Rückgrat über 60 mm wird geteilt, alles steckt ohne Durchdringung
  const p = bp({ maxPlate: 60 });
  const L = ribsLayout(p)!;
  const pieces = L.spine.filter((x) => x.piece);
  assert.ok(pieces.length >= 2, `${pieces.length} Stücke`);
  assert.ok(pieces.every((x) => /^S\d*[a-z]$/.test(x.key)), pieces.map((x) => x.key).join(','));
  assert.deepEqual(findOverlaps(asmSolids('ribs', p, 3)!).map((x) => `${x.a}/${x.b}`), []);
  const r = buildGen(RIBS, p);
  assert.ok(r.plan, 'Bauplan');
  assert.ok(r.plan!.lines.length > 10);
  assert.ok(r.plan!.labels.some((l) => l.text === '1'));
  assert.ok(r.plan!.steps.some((s) => /Schwalbenschwanz|dovetail/.test(s)), r.plan!.steps.join(' | '));
  assert.ok(r.plan!.steps.some((s) => /Bein|Leg/.test(s)), r.plan!.steps.join(' | '));
  for (const l of r.plan!.lines) for (const q of l) assert.ok(q.x >= 14.9 && q.x <= 195.1 && q.y >= 21.9 && q.y <= 132.1, 'Zeichnung im Feld');
  assert.equal(buildGen(RIBS, bp({ plan: false })).plan, undefined);
});

test('Rippenmodell: dichter an Details, wo sich der Umriss schnell ändert', () => {
  const even = ribsLayout(rp())!;
  const p = rp({ minSpacing: 4 });
  const L = ribsLayout(p)!;
  assert.ok(L.count > even.count && L.count < 2.5 * even.count, `${L.count} statt ${even.count} Rippen`);
  // Abstände entlang der Achse: an den runden Enden enger als in der Mitte, nie unter 4 und nie über 10 mm
  const xs = L.ribs.map((r) => r.pose.o[0] + r.pose.n[0] * 1.5).sort((a, b) => a - b);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  for (const g of gaps) assert.ok(g >= 4 - 0.05 && g <= 10 + 0.05, `Abstand ${g}`);
  const mid = gaps[Math.floor(gaps.length / 2)];
  assert.ok(gaps[0] < mid - 2 && gaps[gaps.length - 1] < mid - 2, `Enden ${gaps[0]} / ${gaps[gaps.length - 1]}, Mitte ${mid}`);
  assert.deepEqual(findOverlaps(asmSolids('ribs', p, 3)!).map((x) => `${x.a}/${x.b}`), []);
  // Mit Abschnitten (Tier) ebenso ohne Durchdringung; zu kleiner Abstand ist ein Fehler
  assert.deepEqual(findOverlaps(asmSolids('ribs', bp({ minSpacing: 4 }), 3)!).map((x) => `${x.a}/${x.b}`), []);
  assert.ok(RIBS.validate(rp({ minSpacing: 3.2 })).some((i) => i.key === 'minSpacing' && i.level === 'error'));
  // Gleich großer kleinster Abstand ändert nichts
  assert.equal(ribsLayout(rp({ minSpacing: 10 }))!.count, even.count);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle 3D-Modell-Tests bestanden');
