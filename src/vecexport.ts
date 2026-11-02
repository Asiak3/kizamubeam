// Export von Vektordateien: DXF (AutoCAD R2000, mm) sowie PDF und PDF-kompatibles Illustrator (.ai).
// Reine Rechenlogik ohne Oberfläche: Die Aufrufer (files.ts) sammeln die Objekte und die Bildpunkte ein.
import { zlibSync } from 'fflate';
import { apply, Mat, mul, PALETTE, Pt, SubPath } from './model';
import { segments } from './curves';

/** Kontur in Weltkoordinaten (mm, y nach unten) */
export interface ExportPath {
  kind: 'path';
  subs: SubPath[];
  layer: number;
  /** Fläche füllen (Layer im Modus Füllen) */
  fill: boolean;
}
/** Rasterbild: m bildet das Einheitsquadrat (0,0 = linke obere Bildecke) auf die Bildfläche in mm ab */
export interface ExportImage {
  kind: 'image';
  m: Mat;
  layer: number;
  pxW: number;
  pxH: number;
  /** JPEG-Datei (wird unverändert eingebettet) … */
  jpeg?: Uint8Array;
  /** … oder Bildpunkte RGB (3 Byte je Punkt) und optional Deckkraft (1 Byte je Punkt) */
  rgb?: Uint8Array;
  alpha?: Uint8Array;
}
export type ExportItem = ExportPath | ExportImage;

export interface ExportPage {
  name: string;
  items: ExportItem[];
}

export interface LayerInfo {
  index: number;
  name: string;
}

const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const layerRgb = (i: number) => hexRgb(PALETTE[i] ?? '#000000');

// ---------- DXF ----------

/** Die neun Grundfarben des AutoCAD-Farbindex (ACI) für Programme ohne Echtfarben */
const ACI_BASE: [number, [number, number, number]][] = [
  [1, [255, 0, 0]], [2, [255, 255, 0]], [3, [0, 255, 0]], [4, [0, 255, 255]], [5, [0, 0, 255]], [6, [255, 0, 255]],
  [7, [0, 0, 0]], [8, [128, 128, 128]], [9, [192, 192, 192]],
];
export function nearestAci(rgb: [number, number, number]): number {
  let best = 7,
    bd = Infinity;
  for (const [n, c] of ACI_BASE) {
    const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (d < bd) ((bd = d), (best = n));
  }
  return best;
}

/** DXF-Layername eines KizamuBeam-Layers: Nummer vorneweg, damit Namen eindeutig bleiben */
export function dxfLayerName(L: LayerInfo): string {
  const id = `C${String(L.index).padStart(2, '0')}`;
  const nm = L.name.replace(/[<>/\\":;?*|=`,\r\n]/g, ' ').trim();
  return nm && nm !== id ? `${id} ${nm}` : id;
}
/** DXF bis R2000 ist ANSI-kodiert: Zeichen außerhalb von ASCII als \U+XXXX schreiben */
const dxfText = (s: string) => s.replace(/[^\x20-\x7e]/g, (c) => `\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);

const fmt = (v: number) => {
  const s = (Math.abs(v) < 5e-10 ? 0 : v).toFixed(6).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

/**
 * DXF (AC1015 = AutoCAD 2000) in mm. Gerade Unterpfade werden zu LWPOLYLINE, Unterpfade mit Kurven zu einer
 * kubischen SPLINE, deren Kontrollpunkte genau die Bézier-Punkte sind (also ohne Annäherung). y zeigt in DXF
 * nach oben: am Bett gespiegelt, damit die Zeichnung in CAD-Programmen gleich herum liegt.
 * Bilder kann DXF nicht einbetten; sie werden übersprungen (skippedImages).
 */
export function buildDxf(items: ExportItem[], layers: LayerInfo[], bedH: number): { text: string; skippedImages: number } {
  let handle = 0x20;
  const H = () => (handle++).toString(16).toUpperCase();
  const out: string[] = [];
  const g = (code: number, v: string | number) => out.push(String(code), typeof v === 'number' ? fmt(v) : v);
  const flip = (p: Pt): Pt => ({ x: p.x, y: bedH - p.y });

  const used = new Map<number, LayerInfo>();
  let skippedImages = 0;
  for (const it of items) {
    if (it.kind === 'image') skippedImages++;
    else if (!used.has(it.layer)) used.set(it.layer, layers.find((L) => L.index === it.layer) ?? { index: it.layer, name: '' });
  }
  const layerList = [...used.values()].sort((a, b) => a.index - b.index);

  // Handles, auf die verwiesen wird
  const hBlockRecTable = 'A',
    hModel = '1F',
    hPaper = '1E',
    hDict = 'C';

  // ----- HEADER -----
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1015');
  g(9, '$DWGCODEPAGE');
  g(3, 'ANSI_1252');
  g(9, '$INSBASE');
  g(10, 0), g(20, 0), g(30, 0);
  g(9, '$EXTMIN');
  g(10, 0), g(20, 0), g(30, 0);
  g(9, '$EXTMAX');
  g(10, 1000), g(20, 1000), g(30, 0);
  g(9, '$INSUNITS');
  g(70, '4');
  g(9, '$MEASUREMENT');
  g(70, '1');
  g(9, '$LUNITS');
  g(70, '2');
  const seedAt = out.length;
  g(9, '$HANDSEED');
  g(5, 'FFFF');
  g(0, 'ENDSEC');

  // ----- CLASSES (leer) -----
  g(0, 'SECTION');
  g(2, 'CLASSES');
  g(0, 'ENDSEC');

  // ----- TABLES -----
  g(0, 'SECTION');
  g(2, 'TABLES');
  const table = (name: string, h: string, n: number, body: () => void) => {
    g(0, 'TABLE');
    g(2, name);
    g(5, h);
    g(330, '0');
    g(100, 'AcDbSymbolTable');
    g(70, String(n));
    body();
    g(0, 'ENDTAB');
  };
  const rec = (type: string, owner: string, sub: string) => {
    g(0, type);
    g(5, H());
    g(330, owner);
    g(100, 'AcDbSymbolTableRecord');
    g(100, sub);
  };
  table('VPORT', '8', 1, () => {
    rec('VPORT', '8', 'AcDbViewportTableRecord');
    g(2, '*ACTIVE');
    g(70, '0');
    g(10, 0), g(20, 0), g(11, 1), g(21, 1), g(12, 200), g(22, 200), g(13, 0), g(23, 0), g(14, 10), g(24, 10);
    g(15, 10), g(25, 10), g(16, 0), g(26, 0), g(36, 1), g(17, 0), g(27, 0), g(37, 0);
    g(40, 400), g(41, 1.5), g(42, 50), g(43, 0), g(44, 0), g(50, 0), g(51, 0);
    g(71, '0'), g(72, '100'), g(73, '1'), g(74, '3'), g(75, '0'), g(76, '0'), g(77, '0'), g(78, '0');
    g(281, '0'), g(65, '1'), g(110, 0), g(120, 0), g(130, 0), g(111, 1), g(121, 0), g(131, 0), g(112, 0), g(122, 1), g(132, 0);
    g(79, '0'), g(146, 0);
  });
  table('LTYPE', '5', 3, () => {
    for (const nm of ['ByBlock', 'ByLayer', 'Continuous']) {
      rec('LTYPE', '5', 'AcDbLinetypeTableRecord');
      g(2, nm);
      g(70, '0');
      g(3, nm === 'Continuous' ? 'Solid line' : '');
      g(72, '65');
      g(73, '0');
      g(40, 0);
    }
  });
  table('LAYER', '2', layerList.length + 1, () => {
    const layer = (name: string, rgb: [number, number, number]) => {
      rec('LAYER', '2', 'AcDbLayerTableRecord');
      g(2, name);
      g(70, '0');
      g(62, String(nearestAci(rgb)));
      g(420, String((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]));
      g(6, 'Continuous');
      g(370, '-3');
      g(390, '0');
    };
    layer('0', [0, 0, 0]);
    for (const L of layerList) layer(dxfText(dxfLayerName(L)), layerRgb(L.index));
  });
  table('STYLE', '3', 1, () => {
    rec('STYLE', '3', 'AcDbTextStyleTableRecord');
    g(2, 'Standard');
    g(70, '0'), g(40, 0), g(41, 1), g(50, 0), g(71, '0'), g(42, 2.5), g(3, 'txt'), g(4, '');
  });
  table('VIEW', '6', 0, () => {});
  table('UCS', '7', 0, () => {});
  table('APPID', '9', 1, () => {
    rec('APPID', '9', 'AcDbRegAppTableRecord');
    g(2, 'ACAD');
    g(70, '0');
  });
  g(0, 'TABLE');
  g(2, 'DIMSTYLE');
  g(5, 'B');
  g(330, '0');
  g(100, 'AcDbSymbolTable');
  g(70, '1');
  g(100, 'AcDbDimStyleTable');
  g(71, '0');
  g(0, 'DIMSTYLE');
  g(105, H());
  g(330, 'B');
  g(100, 'AcDbSymbolTableRecord');
  g(100, 'AcDbDimStyleTableRecord');
  g(2, 'Standard');
  g(70, '0');
  g(0, 'ENDTAB');
  g(0, 'TABLE');
  g(2, 'BLOCK_RECORD');
  g(5, hBlockRecTable);
  g(330, '0');
  g(100, 'AcDbSymbolTable');
  g(70, '2');
  for (const [nm, h] of [['*Model_Space', hModel], ['*Paper_Space', hPaper]]) {
    g(0, 'BLOCK_RECORD');
    g(5, h);
    g(330, hBlockRecTable);
    g(100, 'AcDbSymbolTableRecord');
    g(100, 'AcDbBlockTableRecord');
    g(2, nm);
    g(340, '0');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  // ----- BLOCKS -----
  g(0, 'SECTION');
  g(2, 'BLOCKS');
  for (const [nm, owner] of [['*Model_Space', hModel], ['*Paper_Space', hPaper]]) {
    g(0, 'BLOCK');
    g(5, H());
    g(330, owner);
    g(100, 'AcDbEntity');
    if (nm === '*Paper_Space') g(67, '1');
    g(8, '0');
    g(100, 'AcDbBlockBegin');
    g(2, nm);
    g(70, '0');
    g(10, 0), g(20, 0), g(30, 0);
    g(3, nm);
    g(1, '');
    g(0, 'ENDBLK');
    g(5, H());
    g(330, owner);
    g(100, 'AcDbEntity');
    if (nm === '*Paper_Space') g(67, '1');
    g(8, '0');
    g(100, 'AcDbBlockEnd');
  }
  g(0, 'ENDSEC');

  // ----- ENTITIES -----
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const ext = (p: Pt) => {
    x0 = Math.min(x0, p.x), y0 = Math.min(y0, p.y), x1 = Math.max(x1, p.x), y1 = Math.max(y1, p.y);
  };
  for (const it of items) {
    if (it.kind !== 'path') continue;
    const lname = dxfText(dxfLayerName(used.get(it.layer)!));
    for (const sp of it.subs) {
      if (sp.nodes.length < 2 && !(sp.nodes.length === 1 && sp.closed)) continue;
      const segs = segments(sp);
      if (!segs.length) continue;
      const head = (type: string, sub: string) => {
        g(0, type);
        g(5, H());
        g(330, hModel);
        g(100, 'AcDbEntity');
        g(8, lname);
        g(100, sub);
      };
      if (!segs.some((s) => s.curve)) {
        const pts = sp.nodes.map(flip);
        head('LWPOLYLINE', 'AcDbPolyline');
        g(90, String(pts.length));
        g(70, sp.closed ? '1' : '0');
        g(43, 0);
        for (const p of pts) {
          g(10, p.x), g(20, p.y);
          ext(p);
        }
        continue;
      }
      // Kubische B-Spline mit dreifachen inneren Knoten = Folge von Bézier-Segmenten
      const ctrl: Pt[] = [flip(segs[0].a)];
      for (const s of segs) ctrl.push(flip(s.c1), flip(s.c2), flip(s.b));
      const n = segs.length;
      const knots = [0, 0, 0, 0];
      for (let k = 1; k < n; k++) knots.push(k, k, k);
      knots.push(n, n, n, n);
      head('SPLINE', 'AcDbSpline');
      g(210, 0), g(220, 0), g(230, 1);
      // 8 = eben; geschlossene Kurven zusätzlich mit 1 (Anfang = Ende, die Knoten bleiben geklemmt)
      g(70, String(8 | (sp.closed ? 1 : 0)));
      g(71, '3');
      g(72, String(knots.length));
      g(73, String(ctrl.length));
      g(74, '0');
      g(42, 0.0000001), g(43, 0.0000001);
      for (const k of knots) g(40, k);
      for (const p of ctrl) {
        g(10, p.x), g(20, p.y), g(30, 0);
        ext(p);
      }
    }
  }
  g(0, 'ENDSEC');

  // ----- OBJECTS: Stammverzeichnis, ohne das AutoCAD die Datei nicht öffnet -----
  g(0, 'SECTION');
  g(2, 'OBJECTS');
  const hGroup = H();
  g(0, 'DICTIONARY');
  g(5, hDict);
  g(330, '0');
  g(100, 'AcDbDictionary');
  g(281, '1');
  g(3, 'ACAD_GROUP');
  g(350, hGroup);
  g(0, 'DICTIONARY');
  g(5, hGroup);
  g(330, hDict);
  g(100, 'AcDbDictionary');
  g(281, '1');
  g(0, 'ENDSEC');
  g(0, 'EOF');

  out[seedAt + 3] = handle.toString(16).toUpperCase();
  // Ausdehnung eintragen
  if (isFinite(x0)) {
    const iMin = out.indexOf('$EXTMIN'),
      iMax = out.indexOf('$EXTMAX');
    out[iMin + 2] = fmt(x0);
    out[iMin + 4] = fmt(y0);
    out[iMax + 2] = fmt(x1);
    out[iMax + 4] = fmt(y1);
  }
  return { text: out.join('\r\n') + '\r\n', skippedImages };
}

// ---------- PDF ----------

const PT = 72 / 25.4;
const num = (v: number) => {
  const s = (Math.abs(v) < 5e-7 ? 0 : v).toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};
/** Text als PDF-Zeichenkette (UTF-16BE mit BOM, damit Umlaute in Ebenen- und Seitennamen ankommen) */
function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}
const pdfDate = (d: Date) => {
  const p = (v: number) => String(v).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

export interface PdfOptions {
  bed: { w: number; h: number };
  layers: LayerInfo[];
  title?: string;
  /** Strichstärke der Linien in mm */
  stroke?: number;
  /** Feste Zeit (Tests) */
  date?: Date;
}

/**
 * PDF 1.5 mit einer Seite je Projektseite in Bettgröße (1:1 in mm). Konturen bleiben Bézierkurven, Füll-Layer
 * werden gefüllt (gerade-ungerade), jeder Layer wird eine eigene Ebene (Optional Content), damit PDF-Programme
 * und Illustrator die Layer auseinanderhalten. Bilder werden als JPEG oder verlustfrei (Flate) eingebettet.
 * Dieselbe Datei mit der Endung .ai öffnet Illustrator als PDF-kompatible Illustrator-Datei.
 */
export function buildPdf(pages: ExportPage[], o: PdfOptions): Uint8Array {
  const enc = new TextEncoder();
  const objs: (Uint8Array | null)[] = [null]; // Index = Objektnummer
  const alloc = () => objs.push(null) - 1;
  const set = (n: number, body: string | Uint8Array) => {
    const head = enc.encode(`${n} 0 obj\n`);
    const b = typeof body === 'string' ? enc.encode(body) : body;
    const tail = enc.encode('\nendobj\n');
    const all = new Uint8Array(head.length + b.length + tail.length);
    all.set(head, 0);
    all.set(b, head.length);
    all.set(tail, head.length + b.length);
    objs[n] = all;
  };
  const stream = (n: number, dict: string, data: Uint8Array) => {
    const head = enc.encode(`<< ${dict} /Length ${data.length} >>\nstream\n`);
    const tail = enc.encode('\nendstream');
    const all = new Uint8Array(head.length + data.length + tail.length);
    all.set(head, 0);
    all.set(data, head.length);
    all.set(tail, head.length + data.length);
    set(n, all);
  };

  const catalog = alloc(),
    pagesObj = alloc(),
    info = alloc();
  // Ebenen nur für Layer, die irgendwo vorkommen
  const usedLayers = [...new Set(pages.flatMap((p) => p.items.map((it) => it.layer)))].sort((a, b) => a - b);
  const ocg = new Map<number, number>();
  for (const li of usedLayers) {
    const n = alloc();
    ocg.set(li, n);
    const L = o.layers.find((x) => x.index === li);
    set(n, `<< /Type /OCG /Name ${pdfString(L ? dxfLayerName(L) : `C${String(li).padStart(2, '0')}`)} >>`);
  }

  const { w, h } = o.bed;
  const W = w * PT,
    Hh = h * PT;
  // mm (y nach unten) → pt (y nach oben)
  const F: Mat = [PT, 0, 0, -PT, 0, Hh];
  const lw = (o.stroke ?? 0.1) * PT;
  const kids: number[] = [];
  for (const page of pages) {
    const pageN = alloc(),
      contentN = alloc();
    kids.push(pageN);
    const xobj: string[] = [];
    let c = `${num(lw)} w 1 J 1 j\n`;
    for (const it of page.items) {
      const tag = `/OC /L${it.layer} BDC\n`;
      const [r, gg, b] = layerRgb(it.layer).map((v) => num(v / 255));
      if (it.kind === 'image') {
        const imgN = alloc();
        const name = `Im${xobj.length}`;
        xobj.push(`/${name} ${imgN} 0 R`);
        let smask = '';
        if (it.jpeg) stream(imgN, `/Type /XObject /Subtype /Image /Width ${it.pxW} /Height ${it.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, it.jpeg);
        else if (it.rgb) {
          if (it.alpha && it.alpha.some((a) => a < 255)) {
            const sN = alloc();
            stream(sN, `/Type /XObject /Subtype /Image /Width ${it.pxW} /Height ${it.pxH} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, zlibSync(it.alpha));
            smask = ` /SMask ${sN} 0 R`;
          }
          stream(imgN, `/Type /XObject /Subtype /Image /Width ${it.pxW} /Height ${it.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask}`, zlibSync(it.rgb));
        } else continue;
        // Bildraum: (0,0) = linke untere Ecke, oberste Bildzeile bei v = 1
        const m = mul(F, mul(it.m, [1, 0, 0, -1, 0, 1]));
        c += `${tag}q ${m.map(num).join(' ')} cm /${name} Do Q\nEMC\n`;
        continue;
      }
      let d = '';
      for (const sp of it.subs) {
        if (!sp.nodes.length) continue;
        const P = (p: Pt) => {
          const q = apply(F, p.x, p.y);
          return `${num(q.x)} ${num(q.y)}`;
        };
        d += `${P(sp.nodes[0])} m\n`;
        for (const s of segments(sp)) d += s.curve ? `${P(s.c1)} ${P(s.c2)} ${P(s.b)} c\n` : `${P(s.b)} l\n`;
        if (sp.closed) d += 'h\n';
      }
      if (!d) continue;
      c += `${tag}${r} ${gg} ${b} RG ${it.fill ? `${r} ${gg} ${b} rg\n` : '\n'}${d}${it.fill ? 'B*' : 'S'}\nEMC\n`;
    }
    stream(contentN, '/Filter /FlateDecode', zlibSync(enc.encode(c)));
    const props = usedLayers.map((li) => `/L${li} ${ocg.get(li)} 0 R`).join(' ');
    set(
      pageN,
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(W)} ${num(Hh)}] /Contents ${contentN} 0 R ` +
        `/Resources << /XObject << ${xobj.join(' ')} >> /Properties << ${props} >> >> >>`,
    );
  }
  set(pagesObj, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const ocgRefs = usedLayers.map((li) => `${ocg.get(li)} 0 R`).join(' ');
  const labels = pages.map((p, i) => `${i} << /P ${pdfString(p.name || String(i + 1))} >>`).join(' ');
  set(
    catalog,
    `<< /Type /Catalog /Pages ${pagesObj} 0 R /PageLabels << /Nums [${labels}] >> ` +
      `/OCProperties << /OCGs [${ocgRefs}] /D << /Order [${ocgRefs}] /ON [${ocgRefs}] >> >> >>`,
  );
  const date = pdfString(pdfDate(o.date ?? new Date()));
  set(info, `<< /Title ${pdfString(o.title ?? 'KizamuBeam')} /Creator (KizamuBeam) /Producer (KizamuBeam) /CreationDate ${date} /ModDate ${date} >>`);

  // Zusammensetzen mit Querverweistabelle
  const header = new Uint8Array([...enc.encode('%PDF-1.5\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  const offsets: number[] = [];
  let len = header.length;
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = len;
    len += objs[n]!.length;
  }
  let xref = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objs.length} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  const tail = enc.encode(xref);
  const outBytes = new Uint8Array(len + tail.length);
  outBytes.set(header, 0);
  let pos = header.length;
  for (let n = 1; n < objs.length; n++) {
    outBytes.set(objs[n]!, pos);
    pos += objs[n]!.length;
  }
  outBytes.set(tail, pos);
  return outBytes;
}
