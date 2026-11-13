// Projektdateien von LightBurn (.lbrn2, XML) lesen: Formen, Gruppen, Bilder und Layer-Einstellungen.
// Text wird bearbeitbarer Text, wenn die Schrift vorhanden ist und zu den mitgespeicherten Umrissen (BackupPath)
// passt; sonst bleiben die Umrisse als Pfad.
//
// Aufbau der Datei: <LightBurnProject> mit <CutSetting>/<CutSetting_Img> (Layer) und <Shape Type="…">.
// Jede Form hat eine <XForm> (a b c d e f wie SVG) und lokale Koordinaten mit y nach oben; Rechteck,
// Ellipse und Bild liegen mittig um den Ursprung. Pfade: <VertList> mit Punkten „V x y“ und optionalen
// Anfassern „c0x… c0y…“ (ausgehend) und „c1x… c1y…“ (eingehend), <PrimList> mit Strecken „L a b“ und
// Kurven „B a b“ zwischen Punktnummern. VertID/PrimID teilen Geometrie: spätere Formen mit derselben ID
// lassen die Liste weg.
import { lbCutSetting } from './materials';
import { t, tn } from './i18n';
import {
  DEFAULT_ADJUST, defaultLayer, defaultSubLayer, IDENT, ImageAdjust, inv, Layer, Mat, mul, newId, Node, Obj, SubLayer, SubPath, TextShape, translate, VarText,
} from './model';
import { boundsOf } from './geom';
import { transformSubs } from './importers';

// ---------- Kleiner XML-Leser (die Dateien sind einfach aufgebaut; läuft auch ohne DOM, z. B. in Tests) ----------

export interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s: string) =>
  s.indexOf('&') < 0
    ? s
    : s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] === '#') {
          const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return isFinite(n) ? String.fromCodePoint(n) : m;
        }
        return ENT[e.toLowerCase()] ?? m;
      });

export function parseXml(src: string): XNode {
  const root: XNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  const attrRe = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].text += unescape(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt);
      i = e < 0 ? src.length : e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt);
      stack[stack.length - 1].text += src.slice(lt + 9, e < 0 ? src.length : e);
      i = e < 0 ? src.length : e + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const e = src.indexOf('>', lt);
      i = e < 0 ? src.length : e + 1;
      continue;
    }
    // Ende des Tags suchen, Anführungszeichen beachten
    let j = lt + 1,
      q = '';
    for (; j < src.length; j++) {
      const c = src[j];
      if (q) {
        if (c === q) q = '';
      } else if (c === '"' || c === "'") q = c;
      else if (c === '>') break;
    }
    if (j >= src.length) throw new Error(t('Die XML-Datei ist fehlerhaft'));
    const body = src.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === '/') {
      const tag = body.slice(1).trim();
      // Bis zum passenden Tag schließen (verzeiht vergessene Endtags)
      for (let k = stack.length - 1; k > 0; k--)
        if (stack[k].tag === tag) {
          stack.length = k;
          break;
        }
      continue;
    }
    const self = body.endsWith('/');
    const inner = self ? body.slice(0, -1) : body;
    const m = /^[^\s/>]+/.exec(inner);
    if (!m) continue;
    const node: XNode = { tag: m[0], attrs: {}, children: [], text: '' };
    attrRe.lastIndex = m[0].length;
    for (let a; (a = attrRe.exec(inner)); ) node.attrs[a[1]] = unescape(a[3] ?? a[4] ?? '');
    stack[stack.length - 1].children.push(node);
    if (!self) stack.push(node);
  }
  return root;
}

const child = (n: XNode, tag: string) => n.children.find((c) => c.tag === tag);

// ---------- Ergebnis ----------

export interface LbrnResult {
  /** Objekte in KizamuBeam-Koordinaten (mm, y nach unten, Ursprung oben links am Bett) */
  objs: Obj[];
  /** Layer-Einstellungen aus den CutSettings */
  layers: Record<number, Layer>;
  /** Bilddaten: Asset-ID → data:-URL */
  assets: Record<string, string>;
  /** Hinweise (übersprungene oder vereinfachte Elemente) */
  notes: string[];
  /** Notizen des Projekts */
  projectNotes?: string;
  /** Variabler Text, falls vom Standard abweichend */
  vt?: VarText;
  /** Texte der Datei; bis finishLbrnTexts sie prüft, liegen sie als Pfad (gespeicherte Umrisse) vor */
  texts: LbrnText[];
  /**
   * Optimierer-Einstellungen der Datei (Issue #222), soweit mappbar. Die exakten LightBurn-Attributnamen
   * sind nicht belegt, daher tolerantes Lesen (s. convertLbrn). Wird nur gemeldet, nicht automatisch
   * auf das Gerät angewendet — im Laser-Panel übernehmen.
   */
  optimizer?: { innerFirst?: boolean; travel?: boolean; group?: boolean };
}

export interface LbrnText {
  obj: Obj;
  /** Bearbeitbarer Text nach den Angaben der Datei */
  text: TextShape;
  /** Gespeicherte Umrisse in lokalen Koordinaten des Texts (y nach unten); null = keine */
  backup: SubPath[] | null;
  /** Zeilenabstand aus der Datei (LnS, zusätzlich zur natürlichen Zeilenhöhe der Schrift) */
  lineSpacing: number;
}

/** Messung eines Texts mit der echten Schrift (in der App über opentype) */
export interface TextMeasure {
  /** Umrisse des Texts in lokalen mm */
  subs: SubPath[];
  /** Natürlicher Zeilenabstand der Schrift bei dieser Größe in mm (Oberlänge + Unterlänge + Durchschuss) */
  lineHeight: number;
  /** Die Schrift fehlt, es wurde eine Ersatzschrift verwendet */
  fallback: boolean;
}

/**
 * Text-Element von LightBurn lesen. Font ist ein Qt-Schrift-String „Familie,Punkt,Pixel,Hinweis,Gewicht,Kursiv,…“
 * (Gewicht 50 normal, 75 fett; neuere Qt-Fassungen 400/700). H ist die Schriftgröße (Em) in mm, LS der zusätzliche
 * Zeichenabstand, Ah die waagerechte Ausrichtung (0 links, 1 mittig, 2 rechts).
 */
export function lbText(n: XNode): TextShape {
  const parts = (n.attrs.Font ?? '').split(',');
  const weight = Number(parts[4]);
  const num = (k: string, d = 0) => {
    const v = Number(n.attrs[k]);
    return isFinite(v) ? v : d;
  };
  const size = num('H', 10) > 0 ? num('H', 10) : 10;
  const ah = Math.round(num('Ah', 0));
  return {
    kind: 'text',
    text: (n.attrs.Str ?? '').replace(/\r\n?/g, '\n'),
    font: parts[0]?.trim() || 'Arial',
    size,
    bold: isFinite(weight) && (weight > 100 ? weight >= 600 : weight >= 63),
    italic: parts[5] === '1',
    upper: false,
    align: ah === 1 ? 'center' : ah === 2 ? 'right' : 'left',
    hSpace: num('LS'),
    // Vorläufig: übliche Schriften haben etwa 1,15 Em Zeilenhöhe, KizamuBeam rechnet mit 1,2 Em plus Zeilenabstand
    vSpace: num('LnS') - 0.05 * size,
    ...(n.attrs.Weld === '1' ? { weld: true } : {}),
  };
}

/**
 * Texte bearbeitbar machen. measure misst einen Text mit der echten Schrift. Ein Text wird übernommen, wenn die
 * Schrift vorhanden ist und seine Umrisse in Breite und Höhe zu den gespeicherten passen (höchstens 2 % bzw.
 * 0,3 mm Abweichung); seine Lage wird dann an den gespeicherten Umrissen ausgerichtet (das gleicht auch die
 * senkrechte Ausrichtung aus). Sonst bleiben die gespeicherten Umrisse als Pfad. Ohne measure bleiben alle Pfade.
 */
export async function finishLbrnTexts(res: LbrnResult, measure?: (t: TextShape) => Promise<TextMeasure | null>) {
  let asPath = 0,
    skipped = 0,
    differ = 0,
    unchecked = 0;
  const missing = new Map<string, number>();
  const box = (subs: SubPath[]) => boundsOf([{ id: 0, m: IDENT, layer: 0, shape: { kind: 'path', subs } }]);
  for (const e of res.texts) {
    const keepPath = () => {
      if (e.backup) asPath++;
      else {
        skipped++;
        dropObj(res.objs, e.obj);
      }
    };
    const first = measure ? await measure(e.text).catch(() => null) : null;
    if (!first) {
      keepPath();
      continue;
    }
    if (first.fallback) {
      if (e.backup) missing.set(e.text.font, (missing.get(e.text.font) ?? 0) + 1);
      else skipped++, dropObj(res.objs, e.obj);
      continue;
    }
    const text: TextShape = { ...e.text, vSpace: e.lineSpacing + first.lineHeight - 1.2 * e.text.size };
    const m = text.vSpace === e.text.vSpace ? first : await measure!(text).catch(() => null);
    if (!m) {
      keepPath();
      continue;
    }
    if (!e.backup) {
      // Ohne gespeicherte Umrisse: Lage nicht prüfbar (Grundlinie der ersten Zeile am Ursprung angenommen)
      e.obj.shape = text;
      unchecked++;
      continue;
    }
    const a = box(m.subs),
      b = box(e.backup);
    const tol = (v: number) => Math.max(0.3, Math.abs(v) * 0.02);
    if (!a || !b || Math.abs(a.w - b.w) > tol(b.w) || Math.abs(a.h - b.h) > tol(b.h)) {
      differ++;
      continue;
    }
    e.obj.shape = text;
    e.obj.m = mul(e.obj.m, translate(b.x + b.w / 2 - (a.x + a.w / 2), b.y + b.h / 2 - (a.y + a.h / 2)));
  }
  if (asPath) res.notes.push(tn('{n} Text als Pfad übernommen (Umrisse aus der Datei).', '{n} Texte als Pfade übernommen (Umrisse aus der Datei).', asPath));
  for (const [font, n] of missing)
    res.notes.push(tn('Schrift „{font}“ fehlt: {n} Text als Pfad übernommen.', 'Schrift „{font}“ fehlt: {n} Texte als Pfade übernommen.', n, { font }));
  if (differ) res.notes.push(tn('{n} Text sähe hier anders aus und bleibt ein Pfad.', '{n} Texte sähen hier anders aus und bleiben Pfade.', differ));
  if (skipped) res.notes.push(tn('{n} Text ohne gespeicherte Umrisse übersprungen.', '{n} Texte ohne gespeicherte Umrisse übersprungen.', skipped));
  if (unchecked) res.notes.push(tn('{n} Text ohne gespeicherte Umrisse: Lage bitte prüfen.', '{n} Texte ohne gespeicherte Umrisse: Lage bitte prüfen.', unchecked));
  res.texts = [];
}

/** Objekt aus der Liste oder einer Gruppe darin entfernen (leere Gruppen fallen mit weg) */
function dropObj(objs: Obj[], o: Obj): boolean {
  const i = objs.indexOf(o);
  if (i >= 0) {
    objs.splice(i, 1);
    return true;
  }
  for (let k = 0; k < objs.length; k++) {
    const g = objs[k];
    if (g.shape.kind === 'group' && dropObj(g.shape.children, o)) {
      if (!g.shape.children.length) objs.splice(k, 1);
      return true;
    }
  }
  return false;
}

export interface LbrnOptions {
  /** Betthöhe: LightBurn zählt y von unten, KizamuBeam von oben */
  bedH: number;
  /** ID zu Bilddaten (in der App dieselbe wie im Asset-Speicher) */
  assetId: (dataUrl: string) => Promise<string>;
  /**
   * Bild senkrecht spiegeln (in der App per Canvas). LightBurn speichert Bilder mit der untersten Zeile zuerst;
   * gespiegelt bekommt das Bild eine ungespiegelte Matrix. Fehlt die Funktion, bleibt das Bild, wie es ist, und
   * die Matrix spiegelt es.
   */
  flipImage?: (dataUrl: string) => Promise<string>;
}

export const isLbrn = (text: string) => /^\s*(<\?xml[^>]*>\s*)?<LightBurnProject[\s>]/.test(text.slice(0, 600));

// ---------- Pfade ----------

interface Vert {
  x: number;
  y: number;
  c0?: [number, number];
  c1?: [number, number];
}
type Prim = { k: 'L' | 'B'; a: number; b: number };

const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';

/** „V x y c0x… c0y… c1x… c1y…“; ein einzelnes „c0x1“ ohne c0y heißt: kein Anfasser */
export function parseVerts(s: string): Vert[] {
  const out: Vert[] = [];
  const re = new RegExp(`V\\s*(${NUM})\\s*(${NUM})((?:\\s*c[01][xy]\\s*${NUM})*)`, 'g');
  const cre = new RegExp(`c([01])([xy])\\s*(${NUM})`, 'g');
  for (let m; (m = re.exec(s)); ) {
    const v: Vert = { x: +m[1], y: +m[2] };
    const c: Record<string, number> = {};
    for (let k; (k = cre.exec(m[3])); ) c[k[1] + k[2]] = +k[3];
    if ('0x' in c && '0y' in c) v.c0 = [c['0x'], c['0y']];
    if ('1x' in c && '1y' in c) v.c1 = [c['1x'], c['1y']];
    out.push(v);
  }
  return out;
}

/** „L a b“ / „B a b“; „LineClosed“/„LineOpen“ verbinden alle Punkte der Reihe nach mit Strecken */
export function parsePrims(s: string, nVerts: number): Prim[] {
  const tr = s.trim();
  if (/^Line(Closed|Open)?$/i.test(tr)) {
    const out: Prim[] = [];
    for (let i = 0; i + 1 < nVerts; i++) out.push({ k: 'L', a: i, b: i + 1 });
    if (!/open/i.test(tr) && nVerts > 2) out.push({ k: 'L', a: nVerts - 1, b: 0 });
    return out;
  }
  const out: Prim[] = [];
  const re = /([LB])\s*(\d+)\s+(\d+)/g;
  for (let m; (m = re.exec(s)); ) out.push({ k: m[1] as 'L' | 'B', a: +m[2], b: +m[3] });
  return out;
}

/** Strecken und Kurven zu Unterpfaden verketten; lokale Koordinaten bleiben (y nach oben) */
export function buildSubs(verts: Vert[], prims: Prim[]): SubPath[] {
  const subs: SubPath[] = [];
  let cur: { sp: SubPath; first: number; last: number } | null = null;
  const node = (v: Vert): Node => ({ x: v.x, y: v.y });
  for (const p of prims) {
    const va = verts[p.a],
      vb = verts[p.b];
    if (!va || !vb) continue;
    if (!cur || cur.last !== p.a || cur.sp.closed) {
      cur = { sp: { nodes: [node(va)], closed: false }, first: p.a, last: p.a };
      subs.push(cur.sp);
    }
    const ns = cur.sp.nodes;
    const prev = ns[ns.length - 1];
    const closing = p.b === cur.first && ns.length > 1;
    const target = closing ? ns[0] : node(vb);
    if (p.k === 'B') {
      if (va.c0) prev.cout = { x: va.c0[0], y: va.c0[1] };
      if (vb.c1) target.cin = { x: vb.c1[0], y: vb.c1[1] };
    }
    if (closing) cur.sp.closed = true;
    else ns.push(target);
    cur.last = p.b;
  }
  return subs.filter((sp) => sp.nodes.length > 1 || sp.closed);
}

// ---------- Bilder ----------

function b64Bytes(b64: string, max: number): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const part = clean.slice(0, Math.ceil(max / 3) * 4);
  const bin = atob(part.slice(0, part.length - (part.length % 4)));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bildart und Pixelmaße aus dem Dateikopf (PNG, JPEG, GIF, BMP, WebP) */
export function imageInfo(b64: string): { mime: string; w: number; h: number } | null {
  const b = b64Bytes(b64.slice(0, 4 * 1024 * 1024), 3 * 1024 * 1024);
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const u32le = (i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', w: u32(16), h: u32(20) };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { mime: 'image/gif', w: u16le(6), h: u16le(8) };
  if (b[0] === 0x42 && b[1] === 0x4d) return { mime: 'image/bmp', w: u32le(18), h: Math.abs(u32le(22) | 0) };
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8X') return { mime: 'image/webp', w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === 'VP8 ') return { mime: 'image/webp', w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff };
    if (kind === 'VP8L') {
      const v = u32le(21);
      return { mime: 'image/webp', w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
    }
    return { mime: 'image/webp', w: 0, h: 0 };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const mk = b[i + 1];
      if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0xff) {
        i += mk === 0xff ? 1 : 2;
        continue;
      }
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { mime: 'image/jpeg', w: u16(i + 7), h: u16(i + 5) };
      i += 2 + u16(i + 2);
    }
    return { mime: 'image/jpeg', w: 0, h: 0 };
  }
  return null;
}

// ---------- Umrechnung ----------

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function parseXForm(n: XNode): Mat {
  const x = child(n, 'XForm');
  const v = (x?.text ?? '').trim().split(/[\s,]+/).map(Number);
  return v.length >= 6 && v.slice(0, 6).every(isFinite) ? (v.slice(0, 6) as Mat) : [1, 0, 0, 1, 0, 0];
}

/** Spiegelung y → -y (LightBurn: y nach oben, KizamuBeam: y nach unten) */
const S: Mat = [1, 0, 0, -1, 0, 0];

/**
 * .lbrn2-Text in KizamuBeam-Objekte übersetzen. Für jede Form gilt: Welt(LightBurn) = XForm · lokal(LightBurn);
 * KizamuBeam = F · Welt mit F = Spiegelung am Bett. Damit Rechtecke, Ellipsen und Bilder ihre Form behalten, wird
 * ihre lokale Lage (mittig, y nach oben) über die Matrix C in die von KizamuBeam (Ecke oben links bzw. Mitte,
 * y nach unten) übersetzt: m = P · XForm · C, wobei P oben F ist und in Gruppen S.
 */
export async function convertLbrn(text: string, opts: LbrnOptions): Promise<LbrnResult> {
  const root = parseXml(text);
  const proj = child(root, 'LightBurnProject');
  if (!proj) throw new Error(t('Keine LightBurn-Projektdatei'));
  const res: LbrnResult = { objs: [], layers: {}, assets: {}, notes: [], texts: [] };
  const counts = new Map<string, number>();
  const note = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);

  // Layer
  const vectorSeen = new Set<number>();
  for (const cs of proj.children) {
    if (cs.tag !== 'CutSetting' && cs.tag !== 'CutSetting_Img') continue;
    const val = (...names: string[]) => {
      for (const nm of names) {
        const v = child(cs, nm)?.attrs.Value;
        if (v !== undefined && v !== '') return v;
      }
      return null;
    };
    const index = Math.round(Number(val('index')));
    if (!(index >= 0 && index < 32)) continue;
    const { settings, img } = lbCutSetting(cs.attrs.type ?? 'Cut', cs.tag === 'CutSetting_Img', val);
    const L = (res.layers[index] ??= defaultLayer(index));
    // Name, Ausgabe und Reihenfolge stehen bei Vektor- und Bild-Einstellungen; die Vektor-Einstellungen zählen
    if (!img || !vectorSeen.has(index)) {
      const name = val('name');
      if (name) L.name = name;
      const out = val('doOutput');
      if (out !== null) L.output = out === '1' || out.toLowerCase() === 'true';
      const pr = Number(val('priority'));
      if (val('priority') !== null && isFinite(pr)) L.priority = pr;
    }
    if (!img) vectorSeen.add(index);
    if (img) L.img = img;
    else {
      Object.assign(L, settings);
      // Sub-Layer: weitere Bearbeitungen derselben Formen (<SubLayer type="Cut"> mit eigenen Feldern)
      const subs: SubLayer[] = [];
      for (const sl of cs.children) {
        if (sl.tag !== 'SubLayer') continue;
        const sv = (...names: string[]) => {
          for (const nm of names) {
            const v = child(sl, nm)?.attrs.Value;
            if (v !== undefined && v !== '') return v;
          }
          return null;
        };
        const ty = (sl.attrs.type ?? 'Cut').toLowerCase();
        if (ty !== 'cut' && ty !== 'scan' && ty !== 'offset') {
          note('sublayer');
          continue;
        }
        const { air: _a, look: _l, sub: _s, ...rest } = lbCutSetting(sl.attrs.type ?? 'Cut', false, sv).settings;
        const out = sv('doOutput');
        subs.push({ ...rest, output: out === null || out === '1' || out.toLowerCase() === 'true' });
      }
      // Ältere Dateien: „Scan+Cut“ = füllen, danach mit denselben Werten den Umriss schneiden
      if ((cs.attrs.type ?? '').toLowerCase() === 'scan+cut' && !subs.length) {
        subs.push({ ...defaultSubLayer('line'), speed: settings.speed, power: settings.power, minPower: settings.minPower, passes: settings.passes, kerf: settings.kerf });
      }
      L.sub = subs.length ? subs : undefined;
    }
    if (!img && (L.zOffset || L.zStep || L.sub?.some((s) => s.zOffset || s.zStep))) note('zaxis');
  }

  const verts = new Map<string, Vert[]>();
  const prims = new Map<string, string>();
  const F: Mat = [1, 0, 0, -1, 0, opts.bedH];

  const pathSubs = (n: XNode): SubPath[] | null => {
    const vl = child(n, 'VertList'),
      pl = child(n, 'PrimList');
    const vid = n.attrs.VertID,
      pid = n.attrs.PrimID;
    let vs: Vert[] | undefined;
    if (vl) {
      vs = parseVerts(vl.text);
      if (vid !== undefined) verts.set(vid, vs);
    } else if (vid !== undefined) vs = verts.get(vid);
    let ps: string | undefined;
    if (pl) {
      ps = pl.text;
      if (pid !== undefined) prims.set(pid, ps);
    } else if (pid !== undefined) ps = prims.get(pid);
    if (!vs) return null;
    // Ohne Primitive: Punkte der Reihe nach verbinden
    const subs = buildSubs(vs, parsePrims(ps ?? 'LineOpen', vs.length));
    // y spiegeln (lokal nach KizamuBeam), Anfasser mit
    for (const sp of subs)
      for (const nd of sp.nodes) {
        nd.y = -nd.y;
        if (nd.cin) nd.cin = { x: nd.cin.x, y: -nd.cin.y };
        if (nd.cout) nd.cout = { x: nd.cout.x, y: -nd.cout.y };
      }
    return subs;
  };

  const layerOf = (n: XNode) => {
    const v = Math.round(Number(n.attrs.CutIndex));
    return v >= 0 && v < 32 ? v : 0;
  };

  const conv = async (n: XNode, P: Mat): Promise<Obj | null> => {
    const type = n.attrs.Type ?? '';
    const X = parseXForm(n);
    const layer = layerOf(n);
    if (child(n, 'Tabs')) note('tabs');
    const num = (k: string, d = 0) => {
      const v = Number(n.attrs[k]);
      return isFinite(v) ? v : d;
    };
    switch (type) {
      case 'Rect': {
        const w = num('W'),
          h = num('H');
        if (!(w > 0) || !(h > 0)) return null;
        return { id: newId(), m: mul(P, mul(X, [1, 0, 0, -1, -w / 2, h / 2])), layer, shape: { kind: 'rect', w, h, r: Math.max(0, num('Cr')) } };
      }
      case 'Ellipse': {
        const rx = num('Rx'),
          ry = num('Ry');
        if (!(rx > 0) || !(ry > 0)) return null;
        return { id: newId(), m: mul(P, mul(X, S)), layer, shape: { kind: 'ellipse', rx, ry } };
      }
      case 'Path': {
        const subs = pathSubs(n);
        if (!subs || !subs.length) {
          note('path');
          return null;
        }
        return { id: newId(), m: mul(P, mul(X, S)), layer, shape: { kind: 'path', subs } };
      }
      case 'Text': {
        // Erst die gespeicherten Umrisse (in Lage des Texts); finishLbrnTexts macht daraus bearbeitbaren Text
        const bp = child(n, 'BackupPath');
        let subs = bp ? pathSubs(bp) : null;
        if (subs && bp) subs = transformSubs(subs, mul(S, mul(inv(X), mul(parseXForm(bp), S))));
        const text = lbText(n);
        if (!text.text.trim()) return null;
        const name = text.text.replace(/\s+/g, ' ').trim();
        const o: Obj = {
          id: newId(),
          m: mul(P, mul(X, S)),
          layer: bp?.attrs.CutIndex !== undefined ? layerOf(bp) : layer,
          shape: subs?.length ? { kind: 'path', subs } : text,
          name: name.length > 40 ? name.slice(0, 39) + '…' : name,
        };
        res.texts.push({ obj: o, text, backup: subs?.length ? subs : null, lineSpacing: num('LnS') });
        return o;
      }
      case 'Bitmap': {
        const data = (n.attrs.Data ?? '').replace(/\s+/g, '');
        const w = num('W'),
          h = num('H');
        const info = data ? imageInfo(data) : null;
        if (!info || !(w > 0) || !(h > 0)) {
          note('image');
          return null;
        }
        let url = `data:${info.mime};base64,${data}`;
        let C: Mat = [1, 0, 0, 1, -w / 2, -h / 2];
        if (opts.flipImage) {
          try {
            url = await opts.flipImage(url);
            C = [1, 0, 0, -1, -w / 2, h / 2];
          } catch {
            // Bild bleibt ungespiegelt, die Matrix übernimmt die Spiegelung
          }
        }
        const asset = await opts.assetId(url);
        res.assets[asset] = url;
        const adjust: ImageAdjust = {
          ...DEFAULT_ADJUST,
          brightness: clamp(Math.round(num('Brightness') * 100), -100, 100),
          contrast: clamp(Math.round(num('Contrast') * 100), -100, 100),
          gamma: clamp(num('Gamma', 1) || 1, 0.1, 5),
          sharpen: clamp(num('EnhanceAmount'), 0, 300),
          sharpenRadius: Math.max(1, num('EnhanceRadius', 1)),
          denoise: clamp(num('EnhanceDenoise'), 0, 50),
        };
        const file = (n.attrs.File ?? '').split(/[\\/]/).pop() || undefined;
        // Bildzeile 0 liegt bei LightBurn lokal unten (y = -H/2); geprüft an echten Dateien gegen das Vorschaubild
        return {
          id: newId(),
          m: mul(P, mul(X, C)),
          layer,
          shape: { kind: 'image', asset, w, h, pxW: info.w || Math.round((w / 25.4) * 96), pxH: info.h || Math.round((h / 25.4) * 96), ...(file ? { name: file } : {}), adjust },
        };
      }
      case 'Group': {
        const kids = child(n, 'Children');
        const children: Obj[] = [];
        for (const c of kids?.children ?? []) {
          if (c.tag !== 'Shape') continue;
          const o = await conv(c, S);
          if (o) children.push(o);
        }
        if (!children.length) return null;
        return { id: newId(), m: mul(P, mul(X, S)), layer: children[0].layer, shape: { kind: 'group', children } };
      }
      default:
        note(`type:${type || '?'}`);
        return null;
    }
  };

  for (const n of proj.children) {
    if (n.tag !== 'Shape') continue;
    const o = await conv(n, F);
    if (o) res.objs.push(o);
  }

  const nt = child(proj, 'Notes');
  if (nt?.attrs.Notes?.trim()) res.projectNotes = nt.attrs.Notes;

  const vtx = child(proj, 'VariableText');
  if (vtx) {
    const v = (k: string, d: number) => {
      const x = Number(child(vtx, k)?.attrs.Value);
      return isFinite(x) ? x : d;
    };
    const vt: VarText = { start: v('Start', 0), end: v('End', 999), current: v('Current', 0), advance: v('Increment', 1), autoAdvance: v('AutoAdvance', 0) !== 0 };
    if (vt.start !== 0 || vt.end !== 999 || vt.current !== 0 || vt.advance !== 1 || vt.autoAdvance) res.vt = vt;
  }

  // Optimierer-Einstellungen (Issue #222): CutOptimize-Element tolerantes Lesen — exakte
  // LightBurn-Namen sind nicht belegt, daher Aliase in Kleinschreibung; Unbekanntes wird ignoriert.
  {
    const ox = proj.children.find((c) => /optimiz/i.test(c.tag));
    if (ox) {
      const raw: Record<string, string> = {};
      for (const [k, v] of Object.entries(ox.attrs)) raw[k.toLowerCase()] = v;
      for (const c of ox.children) {
        const v = c.attrs.Value;
        if (v !== undefined && v !== '') raw[c.tag.toLowerCase()] = v;
      }
      const b = (...names: string[]): boolean | undefined => {
        for (const nm of names) {
          const v = raw[nm];
          if (v === undefined) continue;
          if (v === '1' || v.toLowerCase() === 'true') return true;
          if (v === '0' || v.toLowerCase() === 'false') return false;
        }
        return undefined;
      };
      const innerFirst = b('innerfirst', 'cutinnerfirst', 'cutinnershapesfirst', 'innershapesfirst');
      const travel = b('reducetravel', 'reducetravelmoves', 'reducemoves', 'travel', 'travelmoves');
      const group = b('orderbygroup', 'grouporder', 'group');
      if (innerFirst !== undefined || travel !== undefined || group !== undefined) {
        res.optimizer = { innerFirst, travel, group };
        const f = (v: boolean | undefined) => (v === undefined ? '?' : v ? '1' : '0');
        res.notes.push(
          t('LightBurn-Optimierer gefunden (innere zuerst: {inner}, Leerwege: {travel}, Gruppen: {group}) — bei Bedarf im Laser-Panel übernehmen.', {
            inner: f(innerFirst),
            travel: f(travel),
            group: f(group),
          }),
        );
      }
    }
  }

  // Hinweise
  for (const [k, n] of counts) {
    if (k === 'image') res.notes.push(tn('{n} Bild ließ sich nicht lesen.', '{n} Bilder ließen sich nicht lesen.', n));
    else if (k === 'path') res.notes.push(tn('{n} Pfad ohne Punkte übersprungen.', '{n} Pfade ohne Punkte übersprungen.', n));
    else if (k === 'tabs') res.notes.push(t('Von Hand gesetzte Haltestege werden nicht übernommen.'));
    else if (k === 'sublayer') res.notes.push(t('Sub-Layer mit unbekannter Art übersprungen.'));
    else if (k === 'zaxis') res.notes.push(t('Z-Versatz übernommen: Richtung vor dem Lasern prüfen (positiv = Fokus tiefer).'));
    else if (k.startsWith('type:')) res.notes.push(tn('{n} Element vom Typ „{type}“ übersprungen.', '{n} Elemente vom Typ „{type}“ übersprungen.', n, { type: k.slice(5) }));
  }
  return res;
}
