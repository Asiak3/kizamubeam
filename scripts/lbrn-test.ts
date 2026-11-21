// Tests für den Import von LightBurn-Projekten (.lbrn2). Aufruf: npm run test:lbrn
// Die Testdatei ist von Hand nachgebaut (Aufbau wie bei LightBurn 1.5), keine echte Kundendatei.
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const { buildSubs, convertLbrn, cutOrderGroupOverride, finishLbrnTexts, imageInfo, isLbrn, lbText, loadCutOrderApply, parsePrims, parseVerts, parseXml } = await import('../src/lbrn');
type TextShape = import('../src/model').TextShape;
const { apply, leaves } = await import('../src/model');
const { shapeSubs } = await import('../src/geom');

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

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAQAAAA3fa6RAAAADklEQVR4nGNg+A+GEAoAJucF+yYOZRsAAAAASUVORK5CYII=';
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const FILE = `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="1.5.06" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">
    <Thumbnail Source="${PNG}"/>
    <VariableText>
        <Start Value="0"/><End Value="999"/><Current Value="7"/><Increment Value="1"/><AutoAdvance Value="1"/>
    </VariableText>
    <CutSetting type="Cut">
        <index Value="5"/><name Value="Schneiden"/><maxPower Value="80"/><speed Value="30"/><numPasses Value="7"/><priority Value="1"/>
    </CutSetting>
    <CutSetting type="Cut">
        <index Value="25"/><name Value="C25"/><maxPower Value="20"/><speed Value="100"/><priority Value="0"/><doOutput Value="0"/>
    </CutSetting>
    <CutSetting type="Offset">
        <index Value="0"/><name Value="C00"/><maxPower Value="97"/><speed Value="3.33333"/><priority Value="2"/>
    </CutSetting>
    <CutSetting type="Scan">
        <index Value="3"/><name Value="C03"/><maxPower Value="30"/><speed Value="200"/><interval Value="0.08"/><crossHatch Value="1"/><bidir Value="0"/>
    </CutSetting>
    <CutSetting type="Cut">
        <index Value="1"/><name Value="C01"/><maxPower Value="20"/><speed Value="100"/><priority Value="3"/>
    </CutSetting>
    <CutSetting_Img type="Image">
        <index Value="1"/><name Value="C01"/><maxPower Value="40"/><speed Value="150"/><interval Value="0.08"/><priority Value="0"/><ditherMode Value="stucki"/>
    </CutSetting_Img>
    <Shape Type="Rect" CutIndex="25" W="100" H="50" Cr="3">
        <XForm>1 0 0 1 60 40</XForm>
    </Shape>
    <Shape Type="Group">
        <XForm>1 0 0 1 10 20</XForm>
        <Children>
            <Shape Type="Ellipse" CutIndex="5" Rx="2.5" Ry="2">
                <XForm>1 0 0 1 5 6</XForm>
            </Shape>
            <Shape Type="Path" CutIndex="5" VertID="0" PrimID="0">
                <XForm>1 0 0 1 0 0</XForm>
                <VertList>V0 0c0x1c1x1V10 0c0x10c0y5c1x1V10 10c0x1c1x10c1y5V0 10c0x1c1x1</VertList>
                <PrimList>L0 1B1 2L2 3L3 0</PrimList>
            </Shape>
        </Children>
    </Shape>
    <Shape Type="Path" CutIndex="5" VertID="0" PrimID="0">
        <XForm>1 0 0 1 100 100</XForm>
    </Shape>
    <Shape Type="Path" CutIndex="5">
        <XForm>1 0 0 1 0 0</XForm>
        <VertList>V0 0V5 0V5 5</VertList>
        <PrimList>LineClosed</PrimList>
    </Shape>
    <Shape Type="Text" CutIndex="0" Font="Arial,-1,100,5,50,0,0,0,0,0" Str="Hallo&#10;Welt" H="10" LS="0" LnS="0" Ah="1" Av="1" Weld="1" HasBackupPath="1">
        <BackupPath Type="Path" CutIndex="0">
            <XForm>1 0 0 1 50 50</XForm>
            <VertList>V0 0V0 8V3 8</VertList>
            <PrimList>L0 1L1 2</PrimList>
        </BackupPath>
        <XForm>1 0 0 1 50 50</XForm>
    </Shape>
    <Shape Type="Text" CutIndex="0" Str="ohne Umriss" H="10" HasBackupPath="0">
        <XForm>1 0 0 1 0 0</XForm>
    </Shape>
    <Shape Type="Bitmap" CutIndex="1" W="30" H="20" Gamma="0.7" Contrast="0.05" Brightness="-0.05" EnhanceAmount="2.5" EnhanceRadius="4" EnhanceDenoise="0" File="C:/Bilder/logo.png" Data="${PNG}">
        <XForm>2 0 0 2 150 80</XForm>
    </Shape>
    <Shape Type="Spline" CutIndex="0"><XForm>1 0 0 1 0 0</XForm></Shape>
    <Notes ShowOnLoad="0" Notes="Pappel 3 mm&#10;Fokus 2 mm tiefer"/>
</LightBurnProject>
`;

const BED = 400;
const conv = () => convertLbrn(FILE, { bedH: BED, assetId: async (u) => 'id' + u.length });

await test('XML: Attribute, Entitäten, selbstschließende Tags', () => {
  const r = parseXml('<?xml version="1.0"?><a x="1 &amp; 2" y=\'&#10;\'><b/><c>t&lt;</c><!-- k --></a>');
  const a = r.children[0];
  assert.equal(a.attrs.x, '1 & 2');
  assert.equal(a.attrs.y, '\n');
  assert.deepEqual(a.children.map((c) => c.tag), ['b', 'c']);
  assert.equal(a.children[1].text, 't<');
  assert.ok(isLbrn(FILE));
  assert.ok(!isLbrn('<svg/>'));
});

await test('Punktliste: Anfasser und „kein Anfasser“', () => {
  const v = parseVerts('V1 2c0x3c0y4c1x5c1y6V-1.5e1 .5c0x1c1x1');
  assert.deepEqual(v[0], { x: 1, y: 2, c0: [3, 4], c1: [5, 6] });
  assert.deepEqual(v[1], { x: -15, y: 0.5 });
});

await test('Primitive werden zu geschlossenen und offenen Unterpfaden', () => {
  const v = parseVerts('V0 0V1 0V1 1V5 5V6 5');
  const subs = buildSubs(v, parsePrims('L0 1L1 2L2 0L3 4', v.length));
  assert.equal(subs.length, 2);
  assert.equal(subs[0].closed, true);
  assert.equal(subs[0].nodes.length, 3);
  assert.equal(subs[1].closed, false);
  assert.equal(subs[1].nodes.length, 2);
  assert.equal(parsePrims('LineClosed', 3).length, 3);
  assert.equal(parsePrims('LineOpen', 3).length, 2);
});

await test('Bildkopf: PNG-Maße', () => {
  assert.deepEqual(imageInfo(PNG), { mime: 'image/png', w: 3, h: 2 });
});

await test('Layer: mm/s → mm/min, Ausgabe, Reihenfolge, Füllarten, Bild-Einstellungen', async () => {
  const { layers } = await conv();
  assert.equal(layers[5].name, 'Schneiden');
  assert.equal(layers[5].mode, 'line');
  assert.equal(layers[5].speed, 1800);
  assert.equal(layers[5].power, 80);
  assert.equal(layers[5].passes, 7);
  assert.equal(layers[5].priority, 1);
  assert.equal(layers[25].output, false);
  assert.equal(layers[0].mode, 'fill');
  assert.equal(layers[0].fillStyle, 'offset');
  near(layers[0].speed, 200, 0.01);
  assert.equal(layers[3].fillStyle, 'scan');
  assert.equal(layers[3].interval, 0.08);
  assert.equal(layers[3].crossHatch, true);
  assert.equal(layers[3].bidirectional, false);
  // Vektor- und Bild-Einstellungen auf demselben Layer: Reihenfolge kommt von den Vektor-Einstellungen
  assert.equal(layers[1].mode, 'line');
  assert.equal(layers[1].priority, 3);
  assert.equal(layers[1].img?.dither, 'stucki');
  assert.equal(layers[1].img?.speed, 9000);
  assert.equal(layers[1].img?.power, 40);
  assert.equal(layers[1].img?.interval, 0.08);
});

await test('Layer: Sub-Layer, Perforation, Anschnitt, Überschnitt, Rampe, Z, Scan+Cut', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="2.1.01" FormatVersion="1">
    <CutSetting type="Scan">
        <index Value="1"/><name Value="ENGRAVE+CUT"/><maxPower Value="20"/><speed Value="100"/><zOffset Value="0.5"/>
        <SubLayer type="Cut" index="1">
            <maxPower Value="60"/><minPower Value="15"/><speed Value="10"/><numPasses Value="3"/><zPerPass Value="0.8"/>
            <perforate Value="1"/><perfLen Value="2"/><perfSkip Value="0.5"/>
            <leadIn Value="1"/><leadLength Value="3"/><leadAngle Value="-45"/><leadStyle Value="arc"/><overcut Value="1.5"/>
            <enablePowerRamp Value="1"/><rampLength Value="0.7"/>
        </SubLayer>
        <SubLayer type="Cut" index="2"><speed Value="5"/><doOutput Value="0"/></SubLayer>
    </CutSetting>
    <CutSetting type="Scan+Cut">
        <index Value="2"/><maxPower Value="30"/><speed Value="50"/>
    </CutSetting>
</LightBurnProject>`;
  const { layers, notes } = await convertLbrn(xml, { bedH: 400 } as never);
  const L = layers[1];
  assert.equal(L.mode, 'fill');
  assert.equal(L.zOffset, 0.5);
  assert.equal(L.sub?.length, 2);
  const s = L.sub![0];
  assert.equal(s.mode, 'line');
  assert.equal(s.speed, 600);
  assert.equal(s.power, 60);
  assert.equal(s.passes, 3);
  assert.equal(s.zStep, 0.8);
  assert.deepEqual(s.perf, { enabled: true, on: 2, off: 0.5 });
  assert.deepEqual(s.lead, { leadIn: true, leadOut: false, length: 3, angle: 45, arc: true, overcut: 1.5 });
  assert.equal(s.ramp.enabled, true);
  assert.equal(s.ramp.length, 0.7);
  assert.equal(s.output, true);
  assert.ok(!('air' in s));
  assert.equal(L.sub![1].output, false);
  // Scan+Cut: füllen, dann mit denselben Werten schneiden
  assert.equal(layers[2].mode, 'fill');
  assert.equal(layers[2].sub?.length, 1);
  assert.equal(layers[2].sub![0].mode, 'line');
  assert.equal(layers[2].sub![0].speed, 3000);
  assert.ok(notes.some((n) => n.includes('Z')));
});

await test('Rechteck: Lage mit y nach unten, Maße und Eckenradius bleiben', async () => {
  const { objs } = await conv();
  const r = objs[0];
  assert.equal(r.shape.kind, 'rect');
  assert.equal(r.layer, 25);
  if (r.shape.kind !== 'rect') return;
  assert.equal(r.shape.r, 3);
  // LightBurn: Mitte (60, 40), y nach oben → KizamuBeam: Mitte (60, 360)
  const c = apply(r.m, r.shape.w / 2, r.shape.h / 2);
  near(c.x, 60);
  near(c.y, BED - 40);
  // Nicht gespiegelt
  assert.ok(r.m[0] * r.m[3] - r.m[1] * r.m[2] > 0);
});

await test('Gruppe: Matrizen werden verkettet, geteilte Geometrie über VertID/PrimID', async () => {
  const { objs } = await conv();
  const g = objs[1];
  assert.equal(g.shape.kind, 'group');
  const ls = [...leaves([g])];
  assert.equal(ls.length, 2);
  const [ell, em] = ls[0];
  assert.equal(ell.shape.kind, 'ellipse');
  const c = apply(em, 0, 0);
  near(c.x, 15);
  near(c.y, BED - 26);
  const [path, pm] = ls[1];
  // Punkt (10, 10) der Datei liegt nach Gruppenverschiebung bei (20, 30) → y = 370
  const pts = shapeSubs(path.shape)[0].nodes.map((n) => apply(pm, n.x, n.y));
  assert.ok(pts.some((p) => Math.abs(p.x - 20) < 1e-6 && Math.abs(p.y - (BED - 30)) < 1e-6));
  // Kurve 1 → 2: Anfasser c0 von Punkt 1 (10, 5), c1 von Punkt 2 (10, 5)
  const sub = shapeSubs(path.shape)[0];
  assert.equal(sub.closed, true);
  const n1 = sub.nodes[1];
  assert.ok(n1.cout);
  const h = apply(pm, n1.cout!.x, n1.cout!.y);
  near(h.x, 20);
  near(h.y, BED - 25);
  // Zweite Form mit derselben VertID/PrimID ohne Listen
  const again = objs[2];
  assert.equal(again.shape.kind, 'path');
  if (again.shape.kind === 'path') assert.equal(again.shape.subs[0].nodes.length, 4);
});

await test('Text ohne Schrift-Messung: Umriss aus BackupPath als Pfad, Name aus dem Text', async () => {
  const r = await conv();
  await finishLbrnTexts(r);
  const tx = r.objs.find((o) => o.name === 'Hallo Welt');
  assert.ok(tx);
  assert.equal(tx!.shape.kind, 'path');
  const p = apply(tx!.m, 0, -8);
  near(p.x, 50);
  near(p.y, BED - 58);
  // Text ohne Umriss fällt weg
  assert.ok(!r.objs.some((o) => o.name === 'ohne Umriss'));
  // Drei Hinweise: unbekannter Typ, Text als Pfad, Text ohne Umriss (Sprache hängt von der Umgebung ab)
  assert.equal(r.notes.length, 3);
  assert.ok(r.notes.some((n) => n.includes('Spline')));
});

await test('Text-Felder: Schrift, Größe, Ausrichtung, Abstände, Schweißen', async () => {
  const r = await conv();
  const e = r.texts.find((x) => x.text.text === 'Hallo\nWelt')!;
  assert.ok(e);
  assert.equal(e.text.font, 'Arial');
  assert.equal(e.text.size, 10);
  assert.equal(e.text.bold, false);
  assert.equal(e.text.align, 'center');
  assert.equal(e.text.weld, true);
  const b = lbText(parseXml('<Shape Type="Text" Font="Times New Roman,-1,100,5,75,1,0,0,0,0" Str="x" H="5" LS="0.5" Ah="2"/>').children[0]);
  assert.equal(b.font, 'Times New Roman');
  assert.equal(b.bold, true);
  assert.equal(b.italic, true);
  assert.equal(b.align, 'right');
  assert.equal(b.hSpace, 0.5);
  assert.equal(b.size, 5);
});

/** Messung, die den Text als Rechteck w × h um die Mitte x = 0, Grundlinie y = 0 liefert */
const fakeMeasure = (w: number, h: number, fallback = false) => async (t: TextShape) => ({
  subs: [{ closed: true, nodes: [{ x: -w / 2, y: 0 }, { x: w / 2, y: 0 }, { x: w / 2, y: -h }, { x: -w / 2, y: -h }] }],
  lineHeight: 1.15 * t.size,
  fallback,
});

await test('Text mit passender Schrift wird bearbeitbar und an den Umrissen ausgerichtet', async () => {
  const r = await conv();
  await finishLbrnTexts(r, fakeMeasure(3, 8));
  const tx = r.objs.find((o) => o.name === 'Hallo Welt')!;
  assert.equal(tx.shape.kind, 'text');
  if (tx.shape.kind !== 'text') return;
  near(tx.shape.vSpace, 1.15 * 10 - 1.2 * 10);
  // Umriss der Datei: x 0..3 ab Ursprung (50, 50); gemessener Text: x -1,5..1,5 → um 1,5 mm verschoben
  const o = apply(tx.m, 0, 0);
  near(o.x, 51.5);
  near(o.y, BED - 50);
  // Ohne Umriss, aber mit Schrift: bleibt Text (Lage ungeprüft, mit Hinweis)
  assert.equal(r.objs.find((x) => x.name === 'ohne Umriss')?.shape.kind, 'text');
  assert.equal(r.notes.length, 2);
});

await test('Text mit fehlender oder abweichender Schrift bleibt Pfad', async () => {
  const r = await conv();
  await finishLbrnTexts(r, fakeMeasure(3, 8, true));
  assert.equal(r.objs.find((o) => o.name === 'Hallo Welt')!.shape.kind, 'path');
  assert.ok(r.notes.some((n) => n.includes('Arial')));
  const r2 = await conv();
  await finishLbrnTexts(r2, fakeMeasure(4, 8));
  assert.equal(r2.objs.find((o) => o.name === 'Hallo Welt')!.shape.kind, 'path');
});

await test('Bild: Asset, Pixelmaße, Lage, Anpassungen, aufrecht', async () => {
  // LightBurn speichert die unterste Bildzeile zuerst: Die App spiegelt die Bilddaten, die Matrix bleibt ungespiegelt
  let flipped = 0;
  const { objs, assets } = await convertLbrn(FILE, { bedH: BED, assetId: async (u) => 'id' + u.length, flipImage: async (u) => (flipped++, u) });
  assert.equal(flipped, 1);
  const im = objs.find((o) => o.shape.kind === 'image')!;
  assert.ok(im);
  if (im.shape.kind !== 'image') return;
  assert.equal(im.shape.pxW, 3);
  assert.equal(im.shape.pxH, 2);
  assert.equal(im.shape.name, 'logo.png');
  assert.ok(assets[im.shape.asset].startsWith('data:image/png;base64,'));
  assert.equal(im.shape.adjust.brightness, -5);
  assert.equal(im.shape.adjust.contrast, 5);
  near(im.shape.adjust.gamma, 0.7);
  // Mitte (150, 80), doppelt so groß
  const c = apply(im.m, 15, 10);
  near(c.x, 150);
  near(c.y, BED - 80);
  // Bildzeile 0 (oben im Bild) liegt oben auf dem Bett (kleineres y)
  const top = apply(im.m, 15, 0),
    bottom = apply(im.m, 15, 20);
  assert.ok(top.y < bottom.y);
  near(bottom.y - top.y, 40);
});

await test('Bild ohne Spiegelfunktion: Matrix spiegelt', async () => {
  const { objs } = await conv();
  const im = objs.find((o) => o.shape.kind === 'image')!;
  if (im.shape.kind !== 'image') return;
  const c = apply(im.m, 15, 10);
  near(c.x, 150);
  near(c.y, BED - 80);
  assert.ok(apply(im.m, 15, 0).y > apply(im.m, 15, 20).y);
});

await test('Notizen und variabler Text', async () => {
  const r = await conv();
  assert.equal(r.projectNotes, 'Pappel 3 mm\nFokus 2 mm tiefer');
  assert.equal(r.vt?.current, 7);
  assert.equal(r.vt?.autoAdvance, true);
});

await test('CutOrder: UIPrefs-Attribute werden als Ränge gelesen, ByGroup schaltet Gruppen ein', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="1.5.06" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">
    <UIPrefs ByLayer="0" ByGroup="1" ByPriority="2"/>
</LightBurnProject>`;
  const r = await convertLbrn(xml, { bedH: BED, assetId: async () => 'x' });
  assert.deepEqual(r.cutOrder, { byLayer: 0, byGroup: 1, byPriority: 2 });
  assert.equal(cutOrderGroupOverride(r.cutOrder), true);
});

await test('CutOrder: Kinder-Elemente, Großschreibung egal, −1 schaltet Gruppen aus', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="1.5.06" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">
    <UIPrefs><bygroup Value="-1"/><ByLayer Value="3"/></UIPrefs>
</LightBurnProject>`;
  const r = await convertLbrn(xml, { bedH: BED, assetId: async () => 'x' });
  assert.deepEqual(r.cutOrder, { byLayer: 3, byGroup: -1, byPriority: undefined });
  assert.equal(cutOrderGroupOverride(r.cutOrder), false);
});

await test('CutOrder: ohne UIPrefs kein CutOrder, Mapping lässt das Preset gelten', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="1.5.06" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">
</LightBurnProject>`;
  const r = await convertLbrn(xml, { bedH: BED, assetId: async () => 'x' });
  assert.equal(r.cutOrder, undefined);
  assert.equal(cutOrderGroupOverride(r.cutOrder), null);
  assert.equal(loadCutOrderApply(), true);
});

await test('Keine LightBurn-Datei', async () => {
  await assert.rejects(convertLbrn('<svg/>', { bedH: BED, assetId: async () => 'x' }));
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
