// Tests für DXF-Export sowie PDF/AI-Export und -Import. Aufruf: npm run test:vecformats
// Optional: KIZAMUBEAM_DUMP=<ordner> schreibt die erzeugten Dateien zum Prüfen mit Fremdprogrammen.
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { zlibSync } from 'fflate';
const { buildDxf, buildPdf } = await import('../src/vecexport');
const { importPdf, importPdfPages, encodePng, pageMatrix } = await import('../src/pdfimport');
const { importDxf } = await import('../src/importers');
type SubPath = import('../src/model').SubPath;
type ExportItem = import('../src/vecexport').ExportItem;
type ImportedPath = import('../src/importers').ImportedPath;
type ImportedImage = import('../src/importers').ImportedImage;

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
const dump = process.env.KIZAMUBEAM_DUMP;
if (dump) mkdirSync(dump, { recursive: true });
const save = (name: string, data: string | Uint8Array) => dump && writeFileSync(`${dump}/${name}`, data);
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} ≠ ${b}`);

// Testzeichnung: Rechteck (gerade), Kreis aus vier Kurven, offene S-Kurve, gemischter Pfad
const k = 0.5523;
const rect: SubPath = { closed: true, nodes: [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 40 }, { x: 10, y: 40 }] };
const circle: SubPath = {
  closed: true,
  nodes: [
    { x: 120, y: 50, cin: { x: 120, y: 50 - 20 * k }, cout: { x: 120, y: 50 + 20 * k } },
    { x: 100, y: 70, cin: { x: 100 + 20 * k, y: 70 }, cout: { x: 100 - 20 * k, y: 70 } },
    { x: 80, y: 50, cin: { x: 80, y: 50 + 20 * k }, cout: { x: 80, y: 50 - 20 * k } },
    { x: 100, y: 30, cin: { x: 100 - 20 * k, y: 30 }, cout: { x: 100 + 20 * k, y: 30 } },
  ],
};
const sCurve: SubPath = { closed: false, nodes: [{ x: 20, y: 100, cout: { x: 40, y: 80 } }, { x: 60, y: 100, cin: { x: 40, y: 120 } }] };
const mixed: SubPath = { closed: true, nodes: [{ x: 150, y: 150 }, { x: 190, y: 150, cout: { x: 200, y: 170 } }, { x: 170, y: 190, cin: { x: 190, y: 190 } }] };
const items: ExportItem[] = [
  { kind: 'path', subs: [rect], layer: 0, fill: false },
  { kind: 'path', subs: [circle], layer: 1, fill: true },
  { kind: 'path', subs: [sCurve], layer: 5, fill: false },
  { kind: 'path', subs: [mixed], layer: 2, fill: false },
];
const layers = Array.from({ length: 30 }, (_, i) => ({ index: i, name: i === 1 ? 'Gravur Äpfel' : `C${String(i).padStart(2, '0')}` }));
const bed = { w: 300, h: 200 };

/** Knoten (mit Anfassern) eines Unterpfads vergleichen; ein fehlender Anfasser zählt wie einer auf dem Knoten */
function sameSub(a: SubPath, b: SubPath, tol: number) {
  assert.equal(a.closed, b.closed, 'geschlossen');
  assert.equal(a.nodes.length, b.nodes.length, 'Knotenzahl');
  a.nodes.forEach((n, i) => {
    const m = b.nodes[i];
    near(n.x, m.x, tol, `x[${i}]`);
    near(n.y, m.y, tol, `y[${i}]`);
    for (const h of ['cin', 'cout'] as const) {
      const p = n[h] ?? n,
        q = m[h] ?? m;
      near(p.x, q.x, tol, `${h}.x[${i}]`);
      near(p.y, q.y, tol, `${h}.y[${i}]`);
    }
  });
}

await test('DXF: Rundreise über den eigenen Import ist genau (Kurven als Bézier-Spline)', async () => {
  const { text, skippedImages } = buildDxf(items, layers, bed.h);
  save('test.dxf', text);
  assert.equal(skippedImages, 0);
  assert.match(text, /AC1015/);
  assert.match(text, /\r\nLWPOLYLINE\r\n/);
  assert.match(text, /\r\nSPLINE\r\n/);
  const res = importDxf(text);
  const paths = res.items.filter((it): it is ImportedPath => it.kind === 'path');
  // y zeigt in DXF nach oben: wie der Editor am Bett spiegeln
  const flip = (sp: SubPath): SubPath => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => ({
      x: n.x,
      y: bed.h - n.y,
      ...(n.cin ? { cin: { x: n.cin.x, y: bed.h - n.cin.y } } : {}),
      ...(n.cout ? { cout: { x: n.cout.x, y: bed.h - n.cout.y } } : {}),
    })),
  });
  assert.equal(paths.length, 4, 'vier Objekte');
  for (const it of items) {
    if (it.kind !== 'path') continue;
    const got = paths.find((p) => p.layer === it.layer);
    assert.ok(got, `Layer ${it.layer} fehlt`);
    sameSub(it.subs[0], flip(got.subs[0]), 1e-5);
  }
  assert.equal(res.notes.length, 0, res.notes.join(' '));
});

await test('DXF: Layer mit Namen, Echtfarbe und $INSUNITS = mm', async () => {
  const { text } = buildDxf(items, layers, bed.h);
  assert.match(text, /\$INSUNITS\r\n 70\r\n4|\$INSUNITS\r\n70\r\n4/);
  assert.ok(text.includes('C01 Gravur \\U+00C4pfel'), 'Layername (ANSI mit \\U+)');
  assert.ok(text.includes('\r\n420\r\n255\r\n'), 'Echtfarbe Blau (0x0000ff)');
});

await test('DXF: Bilder werden gezählt und übersprungen', async () => {
  const r = buildDxf([...items, { kind: 'image', m: [10, 0, 0, 10, 0, 0], layer: 0, pxW: 0, pxH: 0 }], layers, bed.h);
  assert.equal(r.skippedImages, 1);
  assert.equal(importDxf(r.text).items.length, 4);
});

// Kleines Bild 2×2: rot, grün / blau, halbdurchsichtig weiß
const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
const alpha = new Uint8Array([255, 255, 255, 128]);
const imgM: [number, number, number, number, number, number] = [40, 0, 0, 20, 200, 20];

await test('PDF: Rundreise über den eigenen Import (Pfade, Layerfarben, Bild, zwei Seiten)', async () => {
  const pdf = buildPdf(
    [
      { name: 'Seite 1', items: [...items, { kind: 'image', m: imgM, layer: 0, pxW: 2, pxH: 2, rgb, alpha }] },
      { name: 'Rückseite', items: [{ kind: 'path', subs: [rect], layer: 3, fill: false }] },
    ],
    { bed, layers, title: 'Test', date: new Date(Date.UTC(2026, 10, 2)) },
  );
  save('test.pdf', pdf);
  save('test.ai', pdf);
  const head = new TextDecoder().decode(pdf.subarray(0, 8));
  assert.equal(head, '%PDF-1.5');
  const r = await importPdf(pdf);
  assert.equal(r.pageCount, 2);
  near(r.pageSize.w, 300, 1e-3, 'Breite');
  near(r.pageSize.h, 200, 1e-3, 'Höhe');
  const paths = r.items.filter((it): it is ImportedPath => it.kind === 'path');
  assert.equal(paths.length, 4);
  for (const it of items) {
    if (it.kind !== 'path') continue;
    const got = paths.find((p) => p.layer === it.layer);
    assert.ok(got, `Layer ${it.layer} fehlt`);
    sameSub(it.subs[0], got.subs[0], 2e-4);
  }
  const imgs = r.items.filter((it): it is ImportedImage => it.kind === 'image');
  assert.equal(imgs.length, 1);
  imgM.forEach((v, i) => near(imgs[0].m[i], v, 1e-3, `Bildmatrix[${i}]`));
  assert.ok(imgs[0].href.startsWith('data:image/png;base64,iVBORw0KGgo'), 'PNG');
  const p2 = await importPdf(pdf, { page: 1 });
  assert.equal(p2.items.length, 1);
  assert.equal((p2.items[0] as ImportedPath).layer, 3);
  const all = await importPdfPages(pdf);
  assert.deepEqual(all.map((p) => p.items.length), [5, 1]);
});

await test('PDF: JPEG wird unverändert eingebettet und wieder ausgelesen', async () => {
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
  const pdf = buildPdf([{ name: '', items: [{ kind: 'image', m: imgM, layer: 0, pxW: 8, pxH: 8, jpeg: fakeJpeg }] }], { bed, layers });
  const r = await importPdf(pdf);
  const img = r.items[0] as ImportedImage;
  assert.equal(img.href, 'data:image/jpeg;base64,' + Buffer.from(fakeJpeg).toString('base64'));
});

// ---------- Fremde PDF-Aufbauten von Hand ----------

const enc = new TextEncoder();
function concat(parts: (string | Uint8Array)[]): Uint8Array {
  const bs = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p));
  const out = new Uint8Array(bs.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of bs) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}
/** PDF mit klassischer Querverweistabelle aus Objektkörpern (Index = Objektnummer - 1) */
function classicPdf(bodies: (string | Uint8Array)[], trailerExtra = '', breakOffsets = false): Uint8Array {
  const parts: (string | Uint8Array)[] = ['%PDF-1.4\n'];
  const offs: number[] = [];
  let len = enc.encode(parts[0] as string).length;
  bodies.forEach((b, i) => {
    offs.push(len);
    const chunk = concat([`${i + 1} 0 obj\n`, b, '\nendobj\n']);
    parts.push(chunk);
    len += chunk.length;
  });
  let x = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) x += `${String(breakOffsets ? o + 7 : o).padStart(10, '0')} 00000 n \n`;
  x += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(x);
  return concat(parts);
}
const streamObj = (dict: string, data: Uint8Array) => concat([`<< ${dict} /Length ${data.length} >>\nstream\n`, data, '\nendstream']);

await test('PDF: Form-XObject, cm, re, CMYK, gedrehte Seite (Rotate 90)', async () => {
  const form = enc.encode('0 1 0 0 K 0 0 m 10 0 l S');
  const content = enc.encode('q 2 0 0 2 0 0 cm 0 1 1 0 k 10 10 20 30 re f Q q 1 0 0 1 100 100 cm /Fm0 Do Q');
  const pdf = classicPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 200 100] >>',
    '<< /Type /Page /Parent 2 0 R /Rotate 90 /Contents 4 0 R /Resources << /XObject << /Fm0 5 0 R >> >> >>',
    streamObj('', content),
    streamObj('/Type /XObject /Subtype /Form /BBox [0 0 50 50] /Matrix [1 0 0 1 5 0]', form),
  ]);
  const r = await importPdf(pdf);
  const K = 25.4 / 72;
  near(r.pageSize.w, 100 * K, 1e-6, 'gedrehte Breite');
  near(r.pageSize.h, 200 * K, 1e-6, 'gedrehte Höhe');
  const paths = r.items as ImportedPath[];
  assert.equal(paths.length, 2);
  // Rechteck: 20..60 × 20..80 pt, Farbe CMYK 0 1 1 0 = Rot
  assert.equal(paths[0].layer, 2, 'rot = Layer 02');
  const P = pageMatrix([0, 0, 200, 100], 90).m;
  const n0 = paths[0].subs[0].nodes[0];
  near(n0.x, P[0] * 20 + P[2] * 20 + P[4], 1e-6, 'x');
  near(n0.y, P[1] * 20 + P[3] * 20 + P[5], 1e-6, 'y');
  // Linie aus dem Formular: 105..115 pt bei y = 100, Magenta
  assert.equal(paths[1].layer, 7, 'magenta = Layer 07');
  const a = paths[1].subs[0].nodes[0];
  near(a.x, 100 * K, 1e-6, 'Linie x (aus y)');
  near(a.y, 105 * K, 1e-6, 'Linie y (aus x)');
});

await test('PDF: Querverweis-Stream mit Objekt-Stream, PNG-Prädiktor und Flate', async () => {
  // Objekte 1–3 im Objekt-Stream 5, Inhalt 4 als normaler Stream, Querverweise in Stream 6
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>'];
  let hdr = '',
    body = '';
  objs.forEach((o, i) => {
    hdr += `${i + 1} ${body.length} `;
    body += o + '\n';
  });
  const osData = zlibSync(enc.encode(hdr + body));
  const content = zlibSync(enc.encode('1 0 0 RG 0 0 m 72 72 l S'));
  const head = '%PDF-1.5\n';
  const o4 = concat(['4 0 obj\n', streamObj('/Filter /FlateDecode', content), '\nendobj\n']);
  const o5 = concat(['5 0 obj\n', streamObj(`/Type /ObjStm /N 3 /First ${hdr.length} /Filter /FlateDecode`, osData), '\nendobj\n']);
  const off4 = head.length,
    off5 = off4 + o4.length,
    off6 = off5 + o5.length;
  // Einträge W [1 2 1] für Objekte 0–6, mit PNG-Prädiktor „Up“ (Spalten = 4)
  const rows = [
    [0, 0, 0, 255],
    [2, 0, 5, 0],
    [2, 0, 5, 1],
    [2, 0, 5, 2],
    [1, off4 >> 8, off4 & 255, 0],
    [1, off5 >> 8, off5 & 255, 0],
    [1, off6 >> 8, off6 & 255, 0],
  ];
  const raw: number[] = [];
  let prev = [0, 0, 0, 0];
  for (const r of rows) {
    raw.push(2, ...r.map((v, i) => (v - prev[i] + 256) & 255));
    prev = r;
  }
  const xs = zlibSync(new Uint8Array(raw));
  const o6 = concat([
    '6 0 obj\n',
    streamObj('/Type /XRef /Size 7 /W [1 2 1] /Root 1 0 R /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 4 >>', xs),
    '\nendobj\n',
  ]);
  const pdf = concat([head, o4, o5, o6, `startxref\n${off6}\n%%EOF\n`]);
  const r = await importPdf(pdf);
  const paths = r.items as ImportedPath[];
  assert.equal(paths.length, 1);
  assert.equal(paths[0].layer, 2);
  near(paths[0].subs[0].nodes[1].x, 25.4, 1e-6, '72 pt = 25,4 mm');
  near(paths[0].subs[0].nodes[1].y, (100 - 72) * (25.4 / 72), 1e-6, 'y gespiegelt');
});

await test('PDF: kaputte Querverweise → Datei wird durchsucht', async () => {
  const pdf = classicPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',
      streamObj('', enc.encode('0 0 1 rg 10 10 m 20 10 l 20 20 l h f')),
    ],
    '',
    true,
  );
  const r = await importPdf(pdf);
  assert.equal(r.items.length, 1);
  assert.equal((r.items[0] as ImportedPath).layer, 1, 'blau');
  assert.ok((r.items[0] as ImportedPath).subs[0].closed);
});

await test('PDF: Filter LZW, ASCII85, ASCIIHex; Text und Inline-Bild werden gemeldet', async () => {
  // „1 0 0 RG 0 0 m 10 10 l S“ in ASCIIHex, dahinter Text und ein Inline-Bild
  const c = '1 0 0 RG 0 0 m 10 10 l S BT /F1 12 Tf (Hallo) Tj ET BI /W 1 /H 1 /BPC 8 /CS /G ID \x00 EI 0 0 1 RG 5 5 m 6 6 l S';
  const hex = Buffer.from(c, 'latin1').toString('hex') + '>';
  // LZW-Beispiel aus der PDF-Spezifikation: „-----A---B“
  const lzwData = new Uint8Array([0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01]);
  const pdf = classicPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents [4 0 R 5 0 R 6 0 R] >>',
    streamObj('/Filter /ASCIIHexDecode', enc.encode(hex)),
    // „% -----A---B“ als Kommentar: prüft nur, dass LZW nicht stört
    streamObj('/Filter /LZWDecode', lzwData),
    streamObj('/Filter /ASCII85Decode', enc.encode('0H`(m0Ha7`+>Fun+Di5]+?:Q\\+B&~>')),
  ]);
  const r = await importPdf(pdf);
  assert.equal(r.items.length, 3, 'zwei Linien aus Hex + eine aus ASCII85');
  assert.ok(r.notes.some((n) => /Text|text/.test(n)), r.notes.join(' | '));
  assert.ok(r.notes.some((n) => /Bild|image/.test(n)), r.notes.join(' | '));
});

await test('PDF: verschlüsselte Datei wird abgelehnt', async () => {
  const pdf = classicPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>'], '/Encrypt << /Filter /Standard >> ');
  await assert.rejects(() => importPdf(pdf), /Kennwort|password/);
});

await test('PDF: Bild mit Indexed-Farbraum und Maske, 1-Bit-Graustufen', async () => {
  const idx = zlibSync(new Uint8Array([0, 1, 1, 0]));
  const bits = new Uint8Array([0b10000000, 0b01000000]);
  const pdf = classicPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /XObject << /A 5 0 R /B 6 0 R >> >> >>',
    streamObj('', enc.encode('q 72 0 0 72 0 0 cm /A Do Q q 36 0 0 36 0 0 cm /B Do Q')),
    streamObj('/Subtype /Image /Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace [/Indexed /DeviceRGB 1 <FF000000FF00>] /Filter /FlateDecode', idx),
    streamObj('/Subtype /Image /Width 2 /Height 2 /BitsPerComponent 1 /ColorSpace /DeviceGray', bits),
  ]);
  const r = await importPdf(pdf);
  const imgs = r.items as ImportedImage[];
  assert.equal(imgs.length, 2);
  near(imgs[0].m[0], 25.4, 1e-6, 'Bildbreite 72 pt');
  near(imgs[0].m[3], 25.4, 1e-6, 'Bildhöhe 72 pt (y nach unten)');
  near(imgs[0].m[5], (100 - 72) * (25.4 / 72), 1e-6, 'oberer Rand');
  assert.equal(r.notes.length, 0, r.notes.join(' '));
});

// ---------- Text und Verschlüsselung (Dateien in scripts/fixtures/pdf, siehe README dort) ----------

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/pdf/${n}`, import.meta.url)));
type Item = ImportedPath | ImportedImage;
const summary = (items: Item[]) =>
  items.map((it) => {
    if (it.kind !== 'path') return 'Bild';
    const xs = it.subs.flatMap((s) => s.nodes.map((n) => n.x)),
      ys = it.subs.flatMap((s) => s.nodes.map((n) => n.y));
    return { layer: it.layer, contours: it.subs.length, x: Math.min(...xs), y: Math.min(...ys) };
  });
const boxFont = async () => ({
  unitsPerEm: 1000,
  name: 'Box',
  substituted: true,
  glyph: (ch: string) => (ch.trim() ? { subs: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 700 }, { x: 0, y: 700 }] }], advance: 600 } : { subs: [], advance: 600 }),
});

await test('Text: CFF (Type1C, CIDFontType0C mit Identity-H, OpenType) wird zu Umrissen', async () => {
  const r = await importPdf(fixture('text-cff.pdf'));
  assert.deepEqual(r.notes, []);
  const s = summary(r.items) as { layer: number; contours: number; x: number; y: number }[];
  // „Hallo CFF Grüße“ = 18 Konturen (blau), „Hallo“ = 7 (rot), „Grüße“ = 8 (schwarz)
  assert.deepEqual(s.map((x) => [x.layer, x.contours]), [[1, 18], [2, 7], [0, 8]]);
  near(s[0].x, 7.75, 0.05, 'linker Rand');
  near(s[2].y, 44.84, 0.05, 'Oberkante „Grüße“');
});

await test('Text: TrueType und Type 1 eingebettet, Zeichenabstand und Breite', async () => {
  const r = await importPdf(fixture('text-rl.pdf'));
  const s = summary(r.items) as { layer: number; contours: number; x: number; y: number }[];
  assert.deepEqual(s.map((x) => [x.layer, x.contours]), [[0, 34], [1, 26], [1, 29]]);
  // Helvetica ist nicht eingebettet: ohne Ersatz übersprungen und gemeldet
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /1/);
});

await test('Text: nicht eingebettete Schrift über Ersatzschrift der App', async () => {
  const r = await importPdf(fixture('text-rl.pdf'), { fallback: boxFont });
  const s = summary(r.items) as { layer: number; contours: number; x: number; y: number }[];
  // „Helvetica Bold nicht eingebettet“ hat 29 Zeichen ohne Leerzeichen, rot
  assert.deepEqual(s[1], { ...s[1], layer: 2, contours: 29 });
  near(s[1].x, 10, 1e-4, 'Start bei 10 mm');
  assert.ok(r.notes.some((n) => /Box/.test(n)), r.notes.join(' | '));
});

await test('Text: Type-3-Schrift und CID-TrueType aus Chromium, gedrehter Text', async () => {
  const r = await importPdf(fixture('text-chrome.pdf'));
  const s = summary(r.items) as { layer: number; contours: number; x: number; y: number }[];
  assert.deepEqual(s.map((x) => x.contours), [36, 32, 11]);
  assert.deepEqual(r.notes, []);
});

await test('Verschlüsselung: RC4 40/128, AES-128 und AES-256 ohne Öffnungskennwort', async () => {
  for (const f of ['enc-rc4-40.pdf', 'enc-rc4-128.pdf', 'enc-aes128.pdf', 'enc-aes256r6.pdf']) {
    const r = await importPdf(fixture(f));
    assert.equal(r.items.length, 3, f);
    assert.equal((r.items[0] as ImportedPath).layer, 2, `${f}: rotes Rechteck`);
  }
  await assert.rejects(() => importPdf(fixture('enc-userpw.pdf')), /Kennwort|password/);
});

await test('Krypto-Bausteine: bekannte Prüfwerte', async () => {
  const { md5, sha256, sha512, rc4, aesCbcDecrypt, aesCbcEncrypt } = await import('../src/pdfcrypt');
  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
  const abc = new TextEncoder().encode('abc');
  assert.equal(hex(md5(abc)), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(hex(sha256(abc)), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hex(sha512(abc, true)).slice(0, 16), 'cb00753f45a35e8b');
  assert.equal(hex(sha512(abc)).slice(0, 16), 'ddaf35a193617aba');
  assert.equal(hex(rc4(new TextEncoder().encode('Key'), new TextEncoder().encode('Plaintext'))), 'bbf316e8d940af0ad3');
  // FIPS-197: AES-128 mit Schlüssel 000102…0f
  const key = Uint8Array.from({ length: 16 }, (_, i) => i);
  const pt = Uint8Array.from({ length: 16 }, (_, i) => i * 0x11);
  const ct = aesCbcEncrypt(key, new Uint8Array(16), pt);
  assert.equal(hex(ct), '69c4e0d86a7b0430d8cdb78070b4c55a');
  assert.equal(hex(aesCbcDecrypt(key, new Uint8Array(16), ct, false)), hex(pt));
});

await test('PNG-Kodierer erzeugt gültige Kopfzeilen', async () => {
  const png = encodePng(1, 1, new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(new TextDecoder().decode(png.subarray(12, 16)), 'IHDR');
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
