// Tests der Generatoren (Zahnrad, Zahnstange, Riemenscheibe, Nocken, Zahnradpaar, Box, Schublade, Einsatz, Steckregal, Scheibenkugel). Aufruf: npm run test:generators
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { Pt, SubPath } from '../src/model';
import type { GearParams } from '../src/generators/gear';
import type { BoxParams } from '../src/generators/box';
import type { RackParams } from '../src/generators/rack';
import type { PulleyParams } from '../src/generators/pulley';
import type { CamParams } from '../src/generators/cam';
import type { GearPairParams } from '../src/generators/gearpair';
import type { DrawerParams } from '../src/generators/drawer';
import type { InsertParams } from '../src/generators/insert';
import type { ShelfParams } from '../src/generators/shelf';
const { GEAR, gearGeometry, GEAR_TOL } = await import('../src/generators/gear');
const { BOX, boxOuter, fieldCount } = await import('../src/generators/box');
const { RACK, rackGeometry, rackOrigin } = await import('../src/generators/rack');
const { PULLEY, BELTS, pulleyOD } = await import('../src/generators/pulley');
const { CAM, camMotion } = await import('../src/generators/cam');
const { GEARPAIR, centerDistance } = await import('../src/generators/gearpair');
const { DRAWER, drawerDims } = await import('../src/generators/drawer');
const { INSERT, dividerCenters } = await import('../src/generators/insert');
const { SHELF, shelfHeights, sideCenters } = await import('../src/generators/shelf');
const { DISCSPHERE, sphereLayout, sphereNormals } = await import('../src/generators/discsphere');
const { buildGen, checkInput, defaultParams, normalizeParams } = await import('../src/generators/index');
await import('./builtin-generators');
const { bezierPt, segments } = await import('../src/curves');
const ClipperLib = (await import('clipper-lib')).default;

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
const near = (a: number, b: number, eps: number, what = '') => assert.ok(Math.abs(a - b) < eps, `${what} ${a} ≠ ${b} (±${eps})`);

const gear = (o: Partial<GearParams> = {}): GearParams => ({ ...(defaultParams(GEAR) as unknown as GearParams), boreType: 'none', kerf: 0, backlash: 0, ...o });
function outline(o: Partial<GearParams>): SubPath[] {
  const r = buildGen(GEAR, gear(o) as unknown as Record<string, number | string | boolean>);
  assert.equal(r.parts.length, 1, r.issues.map((i) => i.msg).join('; '));
  assert.equal(r.parts[0].shape.part, undefined);
  return r.parts[0].shape.subs;
}
/** Unterpfad fein abgetastet; y wieder nach oben (wie in gearGeometry) */
function flatten(sp: SubPath, n = 24): Pt[] {
  const pts: Pt[] = [];
  for (const s of segments(sp)) {
    if (!s.curve) pts.push(s.a);
    else for (let i = 0; i < n; i++) pts.push(bezierPt(s.a, s.c1, s.c2, s.b, i / n));
  }
  return pts.map((p) => ({ x: p.x, y: -p.y }));
}
const polar = (p: Pt) => ({ R: Math.hypot(p.x, p.y), th: Math.PI / 2 - Math.atan2(p.y, p.x) });
/** Winkel auf (−π, π] */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

test('Kenngrößen: Teilkreis, Kopfkreis, Fußkreis, Zahndicke', () => {
  const g = gearGeometry(gear({ teeth: 24, module: 2 }));
  near(g.r, 24, 1e-9, 'r');
  near(g.ra, 26, 1e-9, 'ra');
  near(g.rf, 24 - 2.5, 1e-9, 'rf');
  // Zahndicke auf dem Teilkreis = halbe Teilung
  near(2 * g.flankAngle(g.r) * g.r, Math.PI, 1e-9, 's');
  assert.ok(!g.undercut);
});

test('Kontur folgt der Evolvente und den Kreisen (Abweichung ≤ Toleranz)', () => {
  for (const teeth of [12, 24, 61]) {
    const p = gear({ teeth, module: 1.5 });
    const g = gearGeometry(p);
    const pts = flatten(outline(p)[0]);
    let checked = 0;
    for (const q of pts) {
      const { R, th } = polar(q);
      // in den Zahn 0..z-1 zurückfalten, |θ| = Abstand zur nächsten Zahnmitte
      const tooth = (2 * Math.PI) / teeth;
      const a = Math.abs(wrap(th - Math.round(th / tooth) * tooth));
      assert.ok(R <= g.ra + GEAR_TOL && R >= g.rf - GEAR_TOL, `Radius ${R} außerhalb`);
      if (R > g.rFlank + 0.02 && R < g.ra - 0.02) {
        near(a * R, g.flankAngle(R) * R, GEAR_TOL * 1.5, `Flanke z=${teeth} R=${R.toFixed(3)}`);
        checked++;
      }
    }
    assert.ok(checked > teeth * 20, `zu wenige Flankenpunkte (${checked})`);
  }
});

test('Kontur ist geschlossen und überschneidet sich nicht', () => {
  for (const teeth of [6, 9, 17, 40]) {
    const pts = flatten(outline({ teeth, module: 2 })[0], 8);
    const n = pts.length;
    const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
      const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    };
    for (let i = 0; i < n; i++)
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        assert.ok(!cross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n]), `z=${teeth}: Selbstüberschneidung bei ${i}/${j}`);
      }
  }
});

test('Unterschnitt bei kleinen Zähnezahlen, nicht ab 17 Zähnen', () => {
  assert.ok(gearGeometry(gear({ teeth: 8 })).undercut, 'z=8 ohne Unterschnitt');
  assert.ok(gearGeometry(gear({ teeth: 12 })).undercut, 'z=12 ohne Unterschnitt');
  assert.ok(!gearGeometry(gear({ teeth: 18 })).undercut, 'z=18 mit Unterschnitt');
  // Profilverschiebung x = 1 − z·sin²α/2 hebt ihn auf
  const x = 1 - (10 * Math.sin((20 * Math.PI) / 180) ** 2) / 2 + 0.01;
  assert.ok(!gearGeometry(gear({ teeth: 10, profileShift: x })).undercut, 'z=10 mit Profilverschiebung');
  const w = GEAR.validate(gear({ teeth: 8 }) as never);
  assert.ok(w.some((i) => i.level === 'warn' && i.key === 'teeth'), 'keine Warnung');
});

test('Schnittfuge versetzt die Kontur um die halbe Fuge, Flankenspiel macht Zähne dünner', () => {
  const a = gearGeometry(gear({ teeth: 20, module: 2 }));
  const k = gearGeometry(gear({ teeth: 20, module: 2, kerf: 0.2 }));
  near(k.ra - a.ra, 0.1, 1e-9, 'Kopfkreis');
  near(k.rf - a.rf, 0.1, 1e-9, 'Fußkreis');
  // Normalabstand der Flanken = halbe Fuge: Bogen auf dem Grundkreis
  near((k.flankAngle(25) - a.flankAngle(25)) * a.rb, 0.1, 1e-9, 'Flanke');
  const j = gearGeometry(gear({ teeth: 20, module: 2, backlash: 0.2 }));
  near(2 * (a.flankAngle(a.r) - j.flankAngle(a.r)) * a.r, 0.1, 1e-9, 'Spiel');
});

test('Bohrungen: rund, D-Profil und Passfedernut, mit Fuge kleiner', () => {
  const round = outline({ boreType: 'round', boreDia: 8, kerf: 0.2 })[1];
  for (const p of flatten(round)) near(Math.hypot(p.x, p.y), 3.9, 0.002, 'Rundbohrung');
  const d = flatten(outline({ boreType: 'dflat', boreDia: 8, boreFlat: 7 })[1]);
  near(Math.max(...d.map((p) => p.y)), 3, 1e-6, 'Abflachung');
  near(Math.min(...d.map((p) => p.y)), -4, 0.01, 'Gegenseite');
  const key = flatten(outline({ boreType: 'key', boreDia: 8, keyWidth: 2, keyDepth: 1.2 })[1]);
  near(Math.max(...key.map((p) => p.y)), 5.2, 1e-6, 'Nutgrund');
  near(Math.max(...key.filter((p) => p.y > 4.5).map((p) => Math.abs(p.x))), 1, 1e-6, 'Nutbreite');
});

/** Zwei Räder im Eingriff: Schnittfläche der Konturen bei verschiedenen Drehstellungen */
function meshOverlap(z1: number, z2: number, o: Partial<GearParams>): number {
  const S = 1e5;
  const g1 = flatten(outline({ ...o, teeth: z1 })[0], 16);
  const g2 = flatten(outline({ ...o, teeth: z2 })[0], 16);
  const m = o.module ?? 2;
  const x = (o.profileShift ?? 0) * 2;
  const a = (m * (z1 + z2)) / 2 + x * m;
  const place = (pts: Pt[], ang: number, cy: number) =>
    pts.map((p) => ({ X: Math.round((p.x * Math.cos(ang) - p.y * Math.sin(ang)) * S), Y: Math.round((p.x * Math.sin(ang) + p.y * Math.cos(ang) + cy) * S) }));
  let worst = 0;
  for (let i = 0; i < 24; i++) {
    const d = ((i / 24) * 2 * Math.PI) / z1;
    // Rad 2 oben, mit einer Lücke nach unten (gegenüber Zahn 0 von Rad 1)
    const a2 = Math.PI + Math.PI / z2 - (d * z1) / z2;
    const c = new ClipperLib.Clipper();
    c.AddPath(place(g1, d, 0), ClipperLib.PolyType.ptSubject, true);
    c.AddPath(place(g2, a2, a), ClipperLib.PolyType.ptClip, true);
    const sol: { X: number; Y: number }[][] = [];
    c.Execute(ClipperLib.ClipType.ctIntersection, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const area = sol.reduce((s, p) => s + Math.abs(ClipperLib.Clipper.Area(p)), 0) / (S * S);
    worst = Math.max(worst, area);
  }
  return worst;
}

test('Räder greifen ohne Überschneidung ineinander (auch mit Unterschnitt)', () => {
  for (const [z1, z2] of [[20, 20], [12, 30], [8, 25], [15, 16]]) {
    const ov = meshOverlap(z1, z2, { module: 2, backlash: 0.04 });
    assert.ok(ov < 1e-4, `z=${z1}/${z2}: Überschneidung ${ov} mm²`);
  }
  // Gegenprobe: ohne Spiel und mit Fuge (Rad zu dick) überschneiden sie sich
  assert.ok(meshOverlap(20, 20, { module: 2, kerf: 0.3 }) > 1e-3, 'dicke Räder überschneiden sich nicht');
});

test('Profilverschiebung x1 + x2 = 0 kämmt beim Null-Achsabstand', () => {
  // gleiche Verschiebung an beiden Rädern geht nur mit vergrößertem Achsabstand; hier: beide x = 0,3, a + 0,6·m
  const ov = meshOverlap(14, 14, { module: 2, backlash: 0.15, profileShift: 0.3 });
  assert.ok(ov < 1e-4, `Überschneidung ${ov}`);
});

test('Validierung: spitze Zähne, zu große Bohrung, unbekannte Parameter', () => {
  const err = (o: Partial<GearParams>) => GEAR.validate(gear(o) as never).filter((i) => i.level === 'error');
  assert.ok(err({ teeth: 10, profileShift: 0.85 }).length, 'spitze Zähne nicht erkannt');
  assert.ok(err({ boreType: 'round', boreDia: 50 }).length, 'Bohrung zu groß nicht erkannt');
  assert.ok(err({ boreType: 'dflat', boreDia: 6, boreFlat: 2 }).length, 'Abflachung nicht geprüft');
  assert.equal(err({}).length, 0);
  assert.ok(checkInput(GEAR, { teeth: 3 }).length, 'Bereich nicht geprüft');
  assert.ok(checkInput(GEAR, { zaehne: 12 }).length, 'unbekannter Parameter nicht erkannt');
  const n = normalizeParams(GEAR, { teeth: 12.4, module: 'x', boreType: 'quadrat' });
  assert.equal(n.teeth, 12);
  assert.equal(n.module, 2);
  assert.equal(n.boreType, 'round');
});

// Gemeinsame Hilfen für die weiteren Bauteile

type Raw = Record<string, number | string | boolean>;
/** Teile eines Generators, Unterpfade wieder mit y nach oben abgetastet */
function partsOf(g: typeof GEAR, p: object, n = 16): Map<string, Pt[][]> {
  const r = buildGen(g, p as Raw);
  assert.ok(r.parts.length, r.issues.map((i) => i.msg).join('; '));
  return new Map(r.parts.map((x) => [x.shape.part ?? 'main', x.shape.subs.map((sp) => flatten(sp, n))]));
}
const S = 1e5;
const toClip = (pts: Pt[]) => pts.map((p) => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) }));
function overlapArea(a: Pt[], b: Pt[]): number {
  const c = new ClipperLib.Clipper();
  c.AddPath(toClip(a), ClipperLib.PolyType.ptSubject, true);
  c.AddPath(toClip(b), ClipperLib.PolyType.ptClip, true);
  const sol: { X: number; Y: number }[][] = [];
  c.Execute(ClipperLib.ClipType.ctIntersection, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return sol.reduce((s, p) => s + Math.abs(ClipperLib.Clipper.Area(p)), 0) / (S * S);
}
/** Einfacher Umriss: Vereinfachen ergibt genau einen Ring mit gleicher Fläche */
function assertSimple(pts: Pt[], what: string) {
  const ring = toClip(pts);
  const simple = ClipperLib.Clipper.SimplifyPolygon(ring, ClipperLib.PolyFillType.pftNonZero);
  assert.equal(simple.length, 1, `${what}: ${simple.length} Ringe nach dem Vereinfachen`);
  near(Math.abs(ClipperLib.Clipper.Area(simple[0])), Math.abs(ClipperLib.Clipper.Area(ring)), 1e-3 * S * S, `${what} Fläche`);
}
const bboxOf = (pts: Pt[]) => {
  const xs = pts.map((p) => p.x),
    ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

// Zahnstange

const rack = (o: Partial<RackParams> = {}): RackParams => ({ ...(defaultParams(RACK) as unknown as RackParams), kerf: 0, backlash: 0, ...o });

test('Zahnstange: Maße, Teilungslinie und Schnittfuge', () => {
  const p = rack({ teeth: 10, module: 2, back: 5 });
  const pts = partsOf(RACK, p).get('main')![0];
  assertSimple(pts, 'Zahnstange');
  const b = bboxOf(pts);
  near(b.x1 - b.x0, 10 * Math.PI * 2, 1e-6, 'Länge');
  near(b.y1 - b.y0, 2 + 2.5 + 5, 1e-6, 'Höhe');
  const g = rackGeometry(p);
  near(g.s, Math.PI, 1e-12, 'Zahndicke auf der Teilungslinie');
  const k = partsOf(RACK, { ...p, kerf: 0.2 }).get('main')![0];
  const bk = bboxOf(k);
  near(bk.x1 - bk.x0, b.x1 - b.x0 + 0.2, 1e-6, 'Länge mit Fuge');
  near(bk.y1 - bk.y0, b.y1 - b.y0 + 0.2, 1e-6, 'Höhe mit Fuge');
  near(rackGeometry({ ...p, backlash: 0.2 }).s, Math.PI - 0.1, 1e-12, 'Spiel');
});

/** Zahnrad auf der Zahnstange abrollen: größte Schnittfläche */
function rackOverlap(z: number, o: Partial<RackParams & GearParams>): number {
  const m = o.module ?? 2;
  const rp = rack({ teeth: Math.max(6, Math.ceil(z / 2) + 4), module: m, ...o });
  const rk = partsOf(RACK, rp).get('main')![0];
  const gp = flatten(outline({ teeth: z, module: m, backlash: o.backlash ?? 0, kerf: o.kerf ?? 0 })[0], 16);
  const org = rackOrigin(rp);
  const r = (m * z) / 2;
  const pitch = Math.PI * m;
  const K = Math.floor(rp.teeth / 2);
  let worst = 0;
  for (let i = -12; i <= 12; i++) {
    const phi = ((i / 12) * Math.PI) / z;
    const ang = Math.PI + phi;
    const cx = org.x + K * pitch,
      cy = org.y + r;
    const gear = gp.map((q) => ({ x: q.x * Math.cos(ang) - q.y * Math.sin(ang) + cx, y: q.x * Math.sin(ang) + q.y * Math.cos(ang) + cy }));
    const moved = rk.map((q) => ({ x: q.x + r * phi, y: q.y }));
    worst = Math.max(worst, overlapArea(gear, moved));
  }
  return worst;
}

test('Zahnstange kämmt mit dem Zahnrad ohne Überschneidung', () => {
  for (const z of [8, 12, 24, 40]) {
    const ov = rackOverlap(z, { module: 2, backlash: 0.04 });
    assert.ok(ov < 1e-4, `z=${z}: Überschneidung ${ov} mm²`);
  }
  assert.ok(rackOverlap(20, { module: 2, kerf: 0.3 }) > 1e-3, 'zu dicke Zahnstange überschneidet sich nicht');
});

// Riemenscheibe

const pulley = (o: Partial<PulleyParams> = {}): PulleyParams => ({ ...(defaultParams(PULLEY) as unknown as PulleyParams), boreType: 'none', kerf: 0, ...o });

test('Riemenscheibe: Außendurchmesser, Lückentiefe und Zahl der Lücken für alle Profile', () => {
  for (const profile of Object.keys(BELTS) as PulleyParams['profile'][]) {
    for (const teeth of [10, 12, 16, 20, 60]) {
      const p = pulley({ profile, teeth });
      if (PULLEY.validate(p as never).some((i) => i.level === 'error')) continue;
      const pts = partsOf(PULLEY, p, 24).get('main')![0];
      assertSimple(pts, `${profile} z=${teeth}`);
      const R = pts.map((q) => Math.hypot(q.x, q.y));
      near(Math.max(...R), pulleyOD(p) / 2, 1e-3, `${profile} z=${teeth} Außenradius`);
      near(Math.min(...R), pulleyOD(p) / 2 - BELTS[profile].depth, 2e-3, `${profile} z=${teeth} Lückengrund`);
      // Lücken zählen: Übergänge unter die halbe Tiefe
      const half = pulleyOD(p) / 2 - BELTS[profile].depth / 2;
      let gaps = 0;
      for (let i = 0; i < R.length; i++) if (R[i] < half && R[(i + R.length - 1) % R.length] >= half) gaps++;
      assert.equal(gaps, teeth, `${profile} z=${teeth} Lücken`);
    }
  }
  near(pulleyOD(pulley({ profile: 'gt2_2', teeth: 20 })), 40 / Math.PI - 0.508, 1e-12, 'GT2 20 Zähne');
});

test('Riemenscheibe: Spiel und Fuge', () => {
  const a = partsOf(PULLEY, pulley({ teeth: 20, play: 0 }), 24).get('main')![0];
  const k = partsOf(PULLEY, pulley({ teeth: 20, play: 0, kerf: 0.2 }), 24).get('main')![0];
  near(Math.max(...k.map((q) => Math.hypot(q.x, q.y))) - Math.max(...a.map((q) => Math.hypot(q.x, q.y))), 0.1, 1e-3, 'Außenradius mit Fuge');
});

// Nocken

const cam = (o: Partial<CamParams> = {}): CamParams => ({ ...(defaultParams(CAM) as unknown as CamParams), boreType: 'none', kerf: 0, ...o } as CamParams);

test('Nocken mit Spitze: Radius folgt dem Hubverlauf', () => {
  for (const law of ['cycloid', 'harmonic', 'poly5'] as const) {
    const p = cam({ follower: 'knife', law });
    const pts = partsOf(CAM, p, 24).get('main')![0];
    assertSimple(pts, law);
    const m = camMotion(p);
    for (const q of pts) {
      let th = Math.atan2(q.x, q.y);
      if (th < 0) th += 2 * Math.PI;
      near(Math.hypot(q.x, q.y), p.baseRadius + m.s(th), 0.01, `${law} θ=${th.toFixed(3)}`);
    }
  }
});

test('Nocken mit Rolle: Kontur hält überall den Rollenradius zur Bahn', () => {
  const p = cam({ follower: 'roller', rollerDia: 12, lift: 10 });
  const pts = partsOf(CAM, p, 24).get('main')![0];
  assertSimple(pts, 'Rolle');
  const m = camMotion(p);
  for (let i = 0; i < 180; i++) {
    const c = m.pitch((i / 180) * 2 * Math.PI);
    let dmin = Infinity;
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j],
        b = pts[(j + 1) % pts.length];
      const vx = b.x - a.x,
        vy = b.y - a.y;
      const u = Math.max(0, Math.min(1, ((c.x - a.x) * vx + (c.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
      dmin = Math.min(dmin, Math.hypot(a.x + u * vx - c.x, a.y + u * vy - c.y));
    }
    near(dmin, 6, 0.01, `Abstand bei ${i}`);
  }
  // Mit Fuge wächst die Kontur nach außen
  const k = partsOf(CAM, { ...p, kerf: 0.2 }, 24).get('main')![0];
  near(Math.min(...k.map((q) => Math.hypot(q.x, q.y))), p.baseRadius + 0.1, 0.01, 'Grundkreis mit Fuge');
});

test('Nocken: Prüfung', () => {
  const err = (o: Partial<CamParams>, l = 'error') => CAM.validate(cam(o) as never).filter((i) => i.level === l);
  assert.equal(err({}).length, 0);
  assert.ok(err({ rise: 200, fall: 200 }).length, 'über 360° nicht erkannt');
  assert.ok(err({ baseRadius: 5, lift: 20, rise: 40, rollerDia: 30 }).length, 'zu große Rolle nicht erkannt');
  assert.ok(err({ baseRadius: 5, lift: 20, rise: 60 }, 'warn').length, 'Druckwinkel nicht gewarnt');
});

// Zahnradpaar

test('Zahnradpaar: Räder wie beim Zahnradgenerator, Platte mit Achsabstand', () => {
  const p = { ...(defaultParams(GEARPAIR) as unknown as GearPairParams), kerf: 0, plate: true, axleDia: 6, teeth1: 12, teeth2: 31 };
  const parts = partsOf(GEARPAIR, p);
  assert.deepEqual([...parts.keys()], ['gear1', 'gear2', 'plate']);
  const single = flatten(outline({ teeth: 12, module: 2, backlash: 0.1 })[0], 16);
  const g1 = parts.get('gear1')![0];
  near(Math.max(...g1.map((q) => Math.hypot(q.x, q.y))), Math.max(...single.map((q) => Math.hypot(q.x, q.y))), 1e-9, 'Rad 1');
  const plate = parts.get('plate')!;
  assert.equal(plate.length, 3, 'Platte mit zwei Löchern');
  const cx = plate.slice(1).map((h) => h.reduce((s, q) => s + q.x, 0) / h.length);
  near(Math.abs(cx[1] - cx[0]), centerDistance(p), 1e-3, 'Achsabstand');
  const hr = plate[1].map((q) => Math.hypot(q.x - cx[0], q.y - plate[1].reduce((s, v) => s + v.y, 0) / plate[1].length));
  near(Math.max(...hr), 3, 1e-3, 'Achsloch');
  const e = GEARPAIR.validate({ ...p, teeth1: 6 } as never).filter((i) => i.level === 'error' || i.level === 'warn');
  assert.ok(e.some((i) => i.key === 'teeth1'), 'Unterschnitt am kleinen Rad nicht gemeldet');
});

// Box

const box = (o: Partial<BoxParams> = {}): BoxParams => ({ ...(defaultParams(BOX) as unknown as BoxParams), kerf: 0, ...o });
function boxParts(o: Partial<BoxParams>) {
  const r = buildGen(BOX, box(o) as unknown as Record<string, number | string | boolean>);
  assert.ok(r.parts.length, r.issues.map((i) => i.msg).join('; '));
  for (const p of r.parts) for (const sp of p.shape.subs) assert.ok(sp.nodes.every((n) => !n.cin && !n.cout), 'Box-Kanten müssen gerade sein');
  return new Map(r.parts.map((p) => [p.shape.part!, p.shape.subs[0].nodes as Pt[]]));
}
const bbox = (pts: Pt[]) => ({
  w: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)),
  h: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)),
});
function inside(pts: Pt[], x: number, y: number) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i],
      b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
/**
 * Teile in 3D zusammenstecken und mit Zufallspunkten prüfen: Wie viele Platten enthalten jeden Punkt?
 * Liefert Zahl der Punkte in zwei Platten und Zahl der Punkte der Wandschale ohne Platte.
 */
function assemble(o: Partial<BoxParams>, samples = 60000) {
  const p = box(o);
  const parts = boxParts(o);
  const { W, D, H } = boxOuter(p);
  const th = p.thickness;
  // Lokale Koordinaten der Teile: Mitte im Ursprung, y nach unten (oben = Oberkante der Wände)
  const inPart = (k: string, x: number, y: number, a: number, b: number) => parts.has(k) && inside(parts.get(k)!, x - a / 2, y - b / 2);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let overlap = 0,
    holes = 0;
  for (let n = 0; n < samples; n++) {
    // Punkte nur in der Schale (Abstand < Dicke zur Außenfläche)
    const X = rnd() * W,
      Y = rnd() * D,
      Z = rnd() * H;
    if (X > th && X < W - th && Y > th && Y < D - th && Z > th && Z < H - th) continue;
    let cnt = 0;
    if (Z < th && inPart('bottom', X, Y, W, D)) cnt++;
    if (Z > H - th && inPart('top', X, Y, W, D)) cnt++;
    if (Y < th && inPart('front', X, H - Z, W, H)) cnt++;
    if (Y > D - th && inPart('back', X, H - Z, W, H)) cnt++;
    if (X < th && inPart('left', Y, H - Z, D, H)) cnt++;
    if (X > W - th && inPart('right', Y, H - Z, D, H)) cnt++;
    if (cnt > 1) overlap++;
    const openTop = p.top === 'open' && Z > H - th && X > th && X < W - th && Y > th && Y < D - th;
    if (cnt === 0 && !openTop) holes++;
  }
  return { overlap, holes };
}

test('Box: Teile, Außenmaße und gerade Kanten', () => {
  const open = boxParts({ width: 120, depth: 80, height: 60, thickness: 4 });
  assert.deepEqual([...open.keys()].sort(), ['back', 'bottom', 'front', 'left', 'right']);
  near(bbox(open.get('bottom')!).w, 120, 1e-9, 'Boden Breite');
  near(bbox(open.get('bottom')!).h, 80, 1e-9, 'Boden Tiefe');
  near(bbox(open.get('front')!).h, 60, 1e-9, 'Wand Höhe');
  near(bbox(open.get('left')!).w, 80, 1e-9, 'Seitenwand Breite');
  const closed = boxParts({ top: 'closed' });
  assert.equal(closed.size, 6);
  // Innenmaß: Wände kommen dazu
  const p = box({ sizeMode: 'inner', width: 100, depth: 50, height: 40, thickness: 3, top: 'closed' });
  assert.deepEqual(boxOuter(p), { W: 106, D: 56, H: 46 });
  assert.equal(fieldCount(94, 10), 9);
  assert.equal(fieldCount(30, 10), 3);
  assert.equal(fieldCount(5, 10), 1);
});

test('Box: Teile passen lückenlos und ohne Überschneidung zusammen', () => {
  for (const o of [
    { width: 100, depth: 80, height: 50, thickness: 3 },
    { width: 100, depth: 80, height: 50, thickness: 3, top: 'closed' as const },
    { width: 37, depth: 151, height: 23.5, thickness: 4.2, finger: 6, top: 'closed' as const },
    { width: 60, depth: 60, height: 60, thickness: 5, finger: 50 },
  ]) {
    const r = assemble(o);
    assert.equal(r.overlap, 0, `Überschneidung bei ${JSON.stringify(o)}: ${r.overlap}`);
    assert.equal(r.holes, 0, `Lücke bei ${JSON.stringify(o)}: ${r.holes}`);
  }
});

test('Box: Steckspiel lässt Luft, Presspassung überschneidet', () => {
  const play = assemble({ top: 'closed', clearance: 0.3 });
  assert.equal(play.overlap, 0, `Überschneidung mit Spiel: ${play.overlap}`);
  assert.ok(play.holes > 0, 'Spiel ohne Luft');
  const press = assemble({ top: 'closed', clearance: -0.3 });
  assert.ok(press.overlap > 0, 'Presspassung ohne Überdeckung');
  assert.equal(press.holes, 0, `Lücke bei Presspassung: ${press.holes}`);
});

test('Box: Schnittfuge versetzt jede Kontur um die halbe Fuge', () => {
  const a = boxParts({ top: 'closed' }),
    k = boxParts({ top: 'closed', kerf: 0.2 });
  for (const [key, pts] of a) {
    const b0 = bbox(pts),
      b1 = bbox(k.get(key)!);
    near(b1.w, b0.w + 0.2, 1e-9, `${key} Breite`);
    near(b1.h, b0.h + 0.2, 1e-9, `${key} Höhe`);
    assert.equal(k.get(key)!.length, pts.length, `${key}: Eckenzahl`);
  }
});

test('Box: Validierung', () => {
  const lvl = (o: Partial<BoxParams>, l: string) => BOX.validate(box(o) as never).filter((i) => i.level === l);
  assert.equal(lvl({}, 'error').length, 0);
  assert.ok(lvl({ height: 10, thickness: 3 }, 'error').length, 'zu dick nicht erkannt');
  // Total play (#402): a finger loses half of it, so at half the finger width nothing is left of a field between them
  assert.ok(lvl({ clearance: 1.5, finger: 3 }, 'error').length, 'Spiel zu groß nicht erkannt');
  assert.equal(lvl({ clearance: 1.4, finger: 3 }, 'error').length, 0, 'Spiel knapp unter der Grenze');
  assert.ok(lvl({ finger: 2 }, 'warn').length, 'schmale Zinken nicht gewarnt');
});

// Schublade

const drawer = (o: Partial<DrawerParams> = {}): DrawerParams => ({ ...(defaultParams(DRAWER) as unknown as DrawerParams), kerf: 0, ...o });
const size = (pts: Pt[]) => {
  const b = bboxOf(pts);
  return [b.x1 - b.x0, b.y1 - b.y0].sort((a, c) => a - c);
};

test('Schublade: Korpus, Schubkasten mit Luft und Blende', () => {
  const p = drawer({ width: 160, height: 80, depth: 150, thickness: 3 });
  const parts = partsOf(DRAWER, p);
  const keys = [...parts.keys()].sort();
  assert.deepEqual(keys, ['c_back', 'c_bottom', 'c_left', 'c_right', 'c_top', 'd_back', 'd_bottom', 'd_front', 'd_left', 'd_right', 'front']);
  for (const [k, subs] of parts) assertSimple(subs[0], k);
  const d = drawerDims(p);
  // Öffnung 154 × 74 × 147, Schubkasten 152 × 72 × 145
  assert.deepEqual(d.box, { W: 152, H: 72, D: 145 });
  near(size(parts.get('c_back')![0])[1], 160, 1e-6, 'Korpus Rückwand Breite');
  near(size(parts.get('c_back')![0])[0], 80, 1e-6, 'Korpus Rückwand Höhe');
  near(size(parts.get('c_left')![0])[1], 150, 1e-6, 'Korpus Seite Tiefe');
  near(size(parts.get('d_bottom')![0])[1], 152, 1e-6, 'Schubkasten Boden Breite');
  near(size(parts.get('d_bottom')![0])[0], 145, 1e-6, 'Schubkasten Boden Tiefe');
  near(size(parts.get('d_front')![0])[0], 72, 1e-6, 'Schubkasten Höhe');
  near(size(parts.get('front')![0])[1], 158, 1e-6, 'Blende vorgesetzt');
  assert.equal(parts.get('front')!.length, 2, 'Griffloch');
  near(size(parts.get('front')![1])[1], 50, 0.01, 'Griffbreite');
  // Ohne Korpus und mit eingelegter Blende
  const inset = partsOf(DRAWER, drawer({ carcass: false, front: 'inset', handle: 'hole', handleWidth: 20 }));
  assert.ok(![...inset.keys()].some((k) => k.startsWith('c_')), 'Korpus trotz „ohne Korpus“');
  assert.equal(drawerDims(drawer({ carcass: false, front: 'inset' })).box.D, 150 - 2 - 3, 'eingelegte Blende kürzt den Schubkasten');
  const err = (o: Partial<DrawerParams>) => DRAWER.validate(drawer(o) as never).filter((i) => i.level === 'error');
  assert.equal(err({}).length, 0);
  assert.ok(err({ handleWidth: 200 }).length, 'zu breiter Griff nicht erkannt');
  assert.ok(err({ height: 20, thickness: 4 }).length, 'zu dünner Schubkasten nicht erkannt');
});

// Einsatz

const insertP = (o: Partial<InsertParams> = {}): InsertParams => ({ ...(defaultParams(INSERT) as unknown as InsertParams), kerf: 0, play: 0, ...o });

/** Stege in 3D: Wie viele Stege enthalten Punkte in den Kreuzungen, und füllen die Stege ihre Bahnen? */
function insertCheck(o: Partial<InsertParams>, samples = 4000) {
  const p = insertP(o);
  const parts = partsOf(INSERT, p);
  const xs = dividerCenters(p.width, p.cellsX, p.thickness),
    ys = dividerCenters(p.depth, p.cellsY, p.thickness);
  const e = p.endPlay / 2,
    h = p.height,
    th = p.thickness;
  const inX = (i: number, X: number, Y: number, Z: number) =>
    Math.abs(X - xs[i]) < th / 2 && inside(parts.get(`x${i + 1}`)![0], Y - e - (p.depth - p.endPlay) / 2, Z - h / 2);
  const inY = (j: number, X: number, Y: number, Z: number) =>
    Math.abs(Y - ys[j]) < th / 2 && inside(parts.get(`y${j + 1}`)![0], X - e - (p.width - p.endPlay) / 2, Z - h / 2);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let double = 0,
    empty = 0;
  for (let n = 0; n < samples; n++) {
    const i = Math.floor(rnd() * xs.length),
      j = Math.floor(rnd() * ys.length);
    const X = xs[i] + (rnd() - 0.5) * th,
      Y = ys[j] + (rnd() - 0.5) * th,
      Z = rnd() * h;
    const c = (inX(i, X, Y, Z) ? 1 : 0) + (inY(j, X, Y, Z) ? 1 : 0);
    if (c > 1) double++;
    if (c === 0) empty++;
  }
  // Abseits der Kreuzungen sind die Stege voll
  let gaps = 0;
  for (let n = 0; n < samples; n++) {
    const i = Math.floor(rnd() * xs.length);
    const Y = e + rnd() * (p.depth - p.endPlay),
      Z = rnd() * h;
    if (ys.some((y) => Math.abs(Y - y) < th)) continue;
    if (!inX(i, xs[i], Y, Z)) gaps++;
  }
  return { double, empty, gaps };
}

test('Einsatz: Stege greifen ohne Überschneidung und ohne Lücke ineinander', () => {
  for (const o of [{}, { cellsX: 4, cellsY: 3, width: 203, depth: 97, height: 31, thickness: 4 }]) {
    const r = insertCheck(o);
    assert.deepEqual(r, { double: 0, empty: 0, gaps: 0 }, JSON.stringify(o));
  }
  assert.equal(insertCheck({ play: 0.4 }).double, 0, 'Spiel überschneidet');
  assert.ok(insertCheck({ play: -0.4 }).double > 0, 'Presspassung ohne Überdeckung');
  const p = insertP({ cellsX: 3, cellsY: 1 });
  const keys = [...partsOf(INSERT, p).keys()];
  assert.deepEqual(keys, ['x1', 'x2'], 'nur Längsstege');
  near(size(partsOf(INSERT, p).get('x1')![0])[1], 100 - 0.5, 1e-6, 'Steglänge mit Endluft');
  assert.ok(INSERT.validate(insertP({ cellsX: 1, cellsY: 1 }) as never).some((i) => i.level === 'error'), 'kein Steg nicht erkannt');
});

// Steckregal

const shelfP = (o: Partial<ShelfParams> = {}): ShelfParams => ({ ...(defaultParams(SHELF) as unknown as ShelfParams), kerf: 0, play: 0, ...o });

/** Regal in 3D zusammenstecken: Punkte in den Kreuzungen gehören genau einem Teil, Seiten und Böden sind sonst voll */
function shelfCheck(o: Partial<ShelfParams>, samples = 6000) {
  const p = shelfP(o);
  const parts = partsOf(SHELF, p);
  const th = p.thickness;
  const sx = sideCenters(p);
  const zs = shelfHeights(p);
  const inSide = (k: number, X: number, Y: number, Z: number) => Math.abs(X - sx[k]) < th / 2 && inside(parts.get(`side${k + 1}`)![0], Y - p.depth / 2, Z - p.height / 2);
  const inBoard = (i: number, X: number, Y: number, Z: number) => Z > zs[i] && Z < zs[i] + th && inside(parts.get(`board${i + 1}`)![0], X - p.width / 2, p.depth / 2 - Y);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let double = 0,
    empty = 0,
    gaps = 0;
  for (let n = 0; n < samples; n++) {
    const k = Math.floor(rnd() * 2),
      i = Math.floor(rnd() * zs.length);
    const X = sx[k] + (rnd() - 0.5) * th,
      Y = rnd() * p.depth,
      Z = zs[i] + rnd() * th;
    const c = (inSide(k, X, Y, Z) ? 1 : 0) + (inBoard(i, X, Y, Z) ? 1 : 0);
    if (c > 1) double++;
    if (c === 0) empty++;
    // Seite abseits der Böden und Boden abseits der Seiten
    const Z2 = rnd() * p.height;
    if (!zs.some((z) => Z2 > z - 0.5 && Z2 < z + th + 0.5) && !inSide(k, sx[k], Y, Z2)) gaps++;
    const X2 = rnd() * p.width;
    if (!sx.some((x) => Math.abs(X2 - x) < th / 2 + 0.5) && !inBoard(i, X2, Y, zs[i] + th / 2)) gaps++;
  }
  return { double, empty, gaps };
}

test('Steckregal: Seiten und Böden greifen ohne Überschneidung und ohne Lücke ineinander', () => {
  for (const o of [{}, { shelves: 5, width: 420, depth: 200, height: 600, thickness: 6, overhang: 0 }, { shelves: 1, topGap: 0 }]) {
    const r = shelfCheck(o);
    assert.deepEqual(r, { double: 0, empty: 0, gaps: 0 }, JSON.stringify(o));
  }
  assert.equal(shelfCheck({ play: 0.3 }).double, 0, 'Spiel überschneidet');
  assert.ok(shelfCheck({ play: -0.3 }).double > 0, 'Presspassung ohne Überdeckung');
  const parts = partsOf(SHELF, shelfP({ shelves: 4 }));
  assert.deepEqual([...parts.keys()], ['side1', 'side2', 'board1', 'board2', 'board3', 'board4']);
  for (const [k, subs] of parts) assertSimple(subs[0], k);
  const top = shelfHeights(shelfP());
  near(top[top.length - 1] + 4, 300 - 20, 1e-9, 'oberster Boden');
  assert.ok(SHELF.validate(shelfP({ shelves: 30, height: 100 }) as never).some((i) => i.level === 'error'), 'zu viele Böden nicht erkannt');
});

// Scheibenkugel

const sphereP = (o: Raw = {}): Raw => ({ ...defaultParams(DISCSPHERE), kerf: 0, play: 0, ...o });
const polyArea = (pts: Pt[]) => Math.abs(pts.reduce((s, a, i) => { const b = pts[(i + 1) % pts.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;

test('Scheibenkugel: Polyeder, Schlitze, gleiche Scheiben', () => {
  const counts: Record<string, number> = { cube: 6, octa: 8, dodeca: 12, cubocta: 14, icosa: 20, rhombi: 26, tico: 32 };
  for (const [shape, n] of Object.entries(counts)) {
    const ns = sphereNormals(shape);
    assert.equal(ns.length, n, shape);
    near(ns[0][2], 1, 1e-12, `${shape}: oben`);
    near(ns[n - 1][2], -1, 1e-12, `${shape}: unten`);
    const L = sphereLayout(sphereP({ shape }));
    assert.ok(L, `${shape}: keine Aufteilung`);
    // Außendurchmesser: Rand der Scheiben auf der Kugel
    near(2 * Math.hypot(L!.d, L!.r), 250, 1e-9, `${shape}: Durchmesser`);
    // Jeder Schlitz hat sein Gegenstück in der anderen Scheibe, in Gegenrichtung
    for (const [i, d] of L!.discs.entries())
      for (const s of d.slots) assert.ok(L!.discs[s.other].slots.some((x) => x.other === i), `${shape}: Gegenstück fehlt`);
  }
  // Regelmäßige Polyeder: alle Scheiben gleich (gleiche Fläche, gleiche Schlitzzahl), oben mit Öffnung
  for (const shape of ['dodeca', 'icosa']) {
    const parts = partsOf(DISCSPHERE, sphereP({ shape, topHole: 0 }), 24);
    const areas = [...parts.values()].map((subs) => polyArea(subs[0]));
    for (const [k, subs] of parts) {
      assert.equal(subs.length, 1, `${shape} ${k}`);
      assertSimple(subs[0], `${shape} ${k}`);
    }
    for (const a of areas) near(a, areas[0], 1e-3 * areas[0], `${shape}: Fläche`);
  }
  const withHole = partsOf(DISCSPHERE, sphereP({ topHole: 40, bottomHole: 30 }));
  assert.equal(withHole.get('d1')!.length, 2, 'Öffnung oben');
  assert.equal(withHole.get('d20')!.length, 2, 'Öffnung unten');
  assert.equal(withHole.get('d2')!.length, 1);
});

test('Scheibenkugel: Schlitzbreite je Winkel, Schnittfuge, Prüfung', () => {
  // Würfel: senkrecht, Breite = Dicke + Spiel
  const cube = sphereLayout(sphereP({ shape: 'cube', thickness: 3, play: 0.2 }))!;
  for (const d of cube.discs) for (const s of d.slots) near(s.w, 3.2, 1e-9, 'Würfel');
  // Ikosaeder-Anordnung (Dodekaeder-Ecken): 41,8° zwischen Nachbarn
  const ico = sphereLayout(sphereP({ shape: 'icosa', thickness: 1, play: 0.1 }))!;
  const s0 = ico.discs[0].slots[0];
  const a = (s0.angle * Math.PI) / 180;
  near(s0.angle, 41.81, 0.01, 'Winkel');
  near(s0.w, 1.1 / Math.sin(a) + Math.cos(a) / Math.sin(a), 1e-9, 'Breite');
  // Mehr Überlappung = größere Scheiben
  const r0 = sphereLayout(sphereP({ overlap: 0 }))!.r,
    r1 = sphereLayout(sphereP({ overlap: 100 }))!.r;
  assert.ok(r1 > r0 + 5, `${r0} ${r1}`);
  // Schnittfuge: Kontur um k/2 nach außen
  const area = (o: Raw) => polyArea(partsOf(DISCSPHERE, sphereP({ topHole: 0, ...o }), 24).get('d2')![0]);
  assert.ok(area({ kerf: 0.2 }) > area({}), 'Kerf');
  // Fehler: zu klein für die Dicke, Öffnung zu groß, Schlitze schmaler als Fuge
  const errs = (o: Raw) => DISCSPHERE.validate(normalizeParams(DISCSPHERE, sphereP(o))).filter((i) => i.level === 'error').map((i) => i.key);
  assert.deepEqual(errs({ diameter: 40, thickness: 6, shape: 'tico' }), ['thickness']);
  assert.deepEqual(errs({ topHole: 300 }), ['topHole']);
  assert.deepEqual(errs({ thickness: 0.1, play: 0, kerf: 0.2 }), ['play']);
  assert.deepEqual(errs({}), []);
  assert.ok(DISCSPHERE.validate(normalizeParams(DISCSPHERE, sphereP({ thickness: 3, diameter: 600 }))).some((i) => i.level === 'warn'), 'starres Material');
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Generator-Tests bestanden');
