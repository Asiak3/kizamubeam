// Tests des Deckelscharniers (Verbindung „lidhinge“). Aufruf: npm run test:joints
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { Obj, Pt, SubPath } from '../src/model';
import type { EdgePick, JointOptions } from '../src/joints';
const { IDENT } = await import('../src/model');
const { computeJoint, DEFAULT_JOINT, lidHingeDims, lidHingeProfiles } = await import('../src/joints');
const { bezierPt, segments } = await import('../src/curves');

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
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const rect = (x: number, y: number, w: number, h: number): Obj => ({
  id: Math.random(), m: IDENT, layer: 0,
  shape: { kind: 'path', subs: [{ closed: true, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }] },
});
const pick = (obj: Obj, seg: number): EdgePick => ({ obj, m: IDENT, sub: 0, seg });
const opts = (o: Partial<JointOptions> = {}): JointOptions => ({ ...DEFAULT_JOINT, kind: 'lidhinge', thickness: 3, ...o });

/** Unterpfad als fein abgetastetes Polygon */
function flatten(sp: SubPath): Pt[] {
  const pts: Pt[] = [];
  for (const s of segments(sp)) {
    if (!s.curve) pts.push(s.a);
    else for (let i = 0; i < 32; i++) pts.push(bezierPt(s.a, s.c1, s.c2, s.b, i / 32));
  }
  return pts;
}
function inside(poly: Pt[], p: Pt): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}
const area = (poly: Pt[]) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;
/** Punkte eines Rechtecks [x0,x1]×[y0,y1] (Rand und Inneres), um die Achse gedreht (im Uhrzeigersinn = Deckel öffnet) */
function rectSamples(x0: number, x1: number, y0: number, y1: number, step = 0.1): Pt[] {
  const pts: Pt[] = [];
  for (let x = x0; x <= x1 + 1e-9; x += step) for (let y = y0; y <= y1 + 1e-9; y += step) pts.push({ x, y });
  return pts;
}
const rotCw = (p: Pt, c: Pt, a: number): Pt => {
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(a) + dy * Math.sin(a), y: c.y - dx * Math.sin(a) + dy * Math.cos(a) };
};

test('Schlitze in Rückwand und Deckel, Knöchel als neue Teile', () => {
  const wall = rect(0, 0, 100, 50), lid = rect(0, -100, 100, 60);
  const r = computeJoint([pick(wall, 0), pick(lid, 0)], opts());
  assert.equal(r.error, undefined);
  // 5 Knöchel: 3 am Kasten (außen und Mitte), 2 am Deckel
  assert.equal(r.changes.get(wall)!.subs.length, 1 + 3);
  assert.equal(r.changes.get(lid)!.subs.length, 1 + 2);
  // je Knöchel Umriss + Stiftloch
  assert.equal(r.added.length, 5 * 2);
  const d = lidHingeDims(opts());
  // Schlitz: Materialdicke breit, Zapfenlänge tief, mit Abstand zur Kante; erster mittig bei 10 mm
  const slot = r.changes.get(wall)!.subs[1].nodes;
  const xs = slot.map((p) => p.x), ys = slot.map((p) => p.y);
  near(Math.max(...xs) - Math.min(...xs), 3);
  near((Math.max(...xs) + Math.min(...xs)) / 2, 10);
  near(Math.max(...ys) - Math.min(...ys), d.T);
  near(Math.min(...ys), d.s0);
  // Deckel-Schlitze an den Stellen dazwischen (30 und 70 mm)
  const mids = r.changes.get(lid)!.subs.slice(1).map((sp) => (Math.min(...sp.nodes.map((p) => p.x)) + Math.max(...sp.nodes.map((p) => p.x))) / 2);
  assert.deepEqual(mids.map((m) => Math.round(m * 1000) / 1000).sort((a, b) => a - b), [30, 70]);
  assert.match(r.info, /3 Knöchel für den Kasten, 2 für den Deckel; Stift Ø 3 mm, etwa 87 mm lang/);
});

test('Gerade Knöchelzahl wird ungerade, eine Kante allein geht nicht', () => {
  const wall = rect(0, 0, 100, 50), lid = rect(0, -100, 100, 60);
  const r = computeJoint([pick(wall, 0), pick(lid, 0)], opts({ hingeCount: 4 }));
  assert.equal(r.added.length, 5 * 2);
  assert.ok(computeJoint([pick(wall, 0)], opts()).error);
  assert.ok(computeJoint([pick(wall, 0), pick(lid, 0)], opts({ hingeCount: 41 })).error, 'zu viele Knöchel');
});

test('Stiftloch mittig im Auge, mit Spiel', () => {
  const o = opts({ pinDia: 3, pinPlay: 0.2 });
  const d = lidHingeDims(o);
  for (const part of Object.values(lidHingeProfiles(o))) {
    const hole = flatten(part[1]);
    const cx = hole.reduce((s, p) => s + p.x, 0) / hole.length, cy = hole.reduce((s, p) => s + p.y, 0) / hole.length;
    near(cx, d.ax, 1e-3);
    near(cy, d.ay, 1e-3);
    for (const p of hole) near(Math.hypot(p.x - d.ax, p.y - d.ay), 1.6, 2e-3);
    const outline = flatten(part[0]);
    // Auge: ganzer Kreis um das Loch liegt im Teil (Wandstärke rundum)
    for (let a = 0; a < 2 * Math.PI; a += 0.05) assert.ok(inside(outline, { x: d.ax + Math.cos(a) * (d.R - 0.05), y: d.ay + Math.sin(a) * (d.R - 0.05) }) || Math.sin(a) < 0, 'Auge offen');
    assert.ok(Math.abs(area(outline)) > Math.PI * d.R * d.R * 0.5);
  }
});

test('Deckel öffnet bis 100° ohne an Kasten-Knöcheln oder Rückwand anzustoßen', () => {
  for (const o of [opts(), opts({ thickness: 6, pinDia: 4, hingeWall: 3 }), opts({ thickness: 2, pinDia: 1.75, hingeWall: 1.5 })]) {
    const d = lidHingeDims(o);
    const prof = lidHingeProfiles(o);
    const A = { x: d.ax, y: d.ay };
    const boxKnuckle = flatten(prof.box[0]);
    const lidKnuckle = flatten(prof.lid[0]);
    const lidPlate = rectSamples(-40, -0.01, 0.01, d.th - 0.01, 0.2);
    // Rückwand ohne den Bereich der Schlitze (dort steckt der Zapfen des eigenen Knöchels)
    const wallHit = (p: Pt) => p.x > -d.th && p.x < 0 && p.y < 0 && p.y > -60;
    const lidKnSamples = rectSamples(-d.mid - d.tenonHalf, d.ax + d.R, d.ay - d.R, d.ay + d.R, 0.2).filter((p) => inside(lidKnuckle, p) && p.y > d.th + 0.01 || (inside(lidKnuckle, p) && p.x > 0.01));
    for (let deg = 0; deg <= 100; deg += 2) {
      const a = (deg * Math.PI) / 180;
      for (const p of lidPlate) assert.ok(!inside(boxKnuckle, rotCw(p, A, a)), `Deckel trifft Kasten-Knöchel bei ${deg}° (t=${d.th})`);
      for (const p of lidKnSamples) assert.ok(!wallHit(rotCw(p, A, a)), `Deckel-Knöchel trifft Rückwand bei ${deg}° (t=${d.th})`);
    }
  }
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Scharnier-Tests bestanden');
