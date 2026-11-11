// Schriftprogramme aus PDF-Dateien lesen, um Text als Umrisse zu übernehmen: TrueType (glyf), CFF (Type 1C,
// auch CID-basiert und in OpenType) und Type 1 (eexec). Liefert je Glyphe Bézier-Konturen in Schrifteinheiten
// (y nach oben) und die Abbildung auf das Geviert (FontMatrix). Ohne weitere Bibliotheken.
import { Mat, Pt, SubPath } from './model';
import { PathBuilder } from './importers';

export interface FontProgram {
  /** Schrifteinheiten → Geviert (1 = Schriftgröße) */
  matrix: Mat;
  numGlyphs: number;
  /** Glyphe nach Glyphennummer */
  glyph(gid: number): SubPath[] | null;
  /** Glyphennummer zu einem Glyphennamen (Type 1, CFF; TrueType über die post-Tabelle) */
  nameToGid(name: string): number | undefined;
  /** Eingebaute Kodierung: Code → Glyphennummer */
  builtinCode(code: number): number | undefined;
  /** TrueType-cmap (Plattform, Kodierung) → Code → Glyphennummer */
  cmap?(platform: number, encoding: number): Map<number, number> | undefined;
  /** CID-basierte CFF-Schrift: CID → Glyphennummer */
  cidToGid?(cid: number): number | undefined;
  /** Vorschub in Schrifteinheiten (falls die PDF-Datei keine Breiten nennt) */
  advance(gid: number): number;
}

// ---------- Namen und Kodierungen ----------

const ASCII_NAMES =
  'space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde'.split(
    ' ',
  );
const WIN_HIGH =
  'Euro - quotesinglbase florin quotedblbase ellipsis dagger daggerdbl circumflex perthousand Scaron guilsinglleft OE - Zcaron - - quoteleft quoteright quotedblleft quotedblright bullet endash emdash tilde trademark scaron guilsinglright oe - zcaron Ydieresis space exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot hyphen registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn ydieresis'.split(
    ' ',
  );
/** WinAnsiEncoding: Code → Glyphenname */
export const WIN_ANSI: (string | undefined)[] = [];
ASCII_NAMES.forEach((n, i) => (WIN_ANSI[32 + i] = n));
WIN_HIGH.forEach((n, i) => (WIN_ANSI[128 + i] = n === '-' ? undefined : n));

/** CFF-Standardzeichenketten 0–228 (danach Expert-Namen, die hier nicht gebraucht werden) */
const STD_STRINGS = [
  '.notdef',
  ...ASCII_NAMES.map((n) => (n === 'quotesingle' ? 'quoteright' : n === 'grave' ? 'quoteleft' : n)),
  ...'exclamdown cent sterling fraction yen florin section currency quotesingle quotedblleft guillemotleft guilsinglleft guilsinglright fi fl endash dagger daggerdbl periodcentered paragraph bullet quotesinglbase quotedblbase quotedblright guillemotright ellipsis perthousand questiondown grave acute circumflex tilde macron breve dotaccent dieresis ring cedilla hungarumlaut ogonek caron emdash AE ordfeminine Lslash Oslash OE ordmasculine ae dotlessi lslash oslash oe germandbls onesuperior logicalnot mu trademark Eth onehalf plusminus Thorn onequarter divide brokenbar degree thorn threequarters twosuperior registered minus eth multiply threesuperior copyright Aacute Acircumflex Adieresis Agrave Aring Atilde Ccedilla Eacute Ecircumflex Edieresis Egrave Iacute Icircumflex Idieresis Igrave Ntilde Oacute Ocircumflex Odieresis Ograve Otilde Scaron Uacute Ucircumflex Udieresis Ugrave Yacute Ydieresis Zcaron aacute acircumflex adieresis agrave aring atilde ccedilla eacute ecircumflex edieresis egrave iacute icircumflex idieresis igrave ntilde oacute ocircumflex odieresis ograve otilde scaron uacute ucircumflex udieresis ugrave yacute ydieresis zcaron'.split(
    ' ',
  ),
];

/** StandardEncoding: Code → Glyphenname */
export const STANDARD: (string | undefined)[] = [];
for (let c = 32; c < 127; c++) STANDARD[c] = STD_STRINGS[c - 31];
[161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 177, 178, 179, 180, 182, 183, 184, 185, 186, 187, 188, 189, 191, 193, 194, 195, 196, 197, 198, 199, 200, 202, 203, 205, 206, 207, 208, 225, 227, 232, 233, 234, 235, 241, 245, 248, 249, 250, 251].forEach(
  (c, i) => (STANDARD[c] = STD_STRINGS[96 + i]),
);

const decoder1252 = (() => {
  try {
    return new TextDecoder('windows-1252');
  } catch {
    return null;
  }
})();
/** Glyphenname → Unicode-Zeichen (Latein, uniXXXX, uXXXX[XX]) */
const NAME_UNI = new Map<string, string>();
WIN_ANSI.forEach((n, c) => {
  if (n && !NAME_UNI.has(n)) NAME_UNI.set(n, c < 128 ? String.fromCharCode(c) : decoder1252 ? decoder1252.decode(new Uint8Array([c])) : String.fromCharCode(c));
});
for (const [n, u] of Object.entries({
  quoteright: '’', quoteleft: '‘', fi: 'ﬁ', fl: 'ﬂ', fraction: '⁄', dotlessi: 'ı', Lslash: 'Ł', lslash: 'ł',
  minus: '−', breve: '˘', dotaccent: '˙', ring: '˚', hungarumlaut: '˝', ogonek: '˛', caron: 'ˇ', nbspace: ' ',
  sfthyphen: '­', periodcentered: '·', middot: '·', Delta: '∆', Omega: 'Ω', mu: 'µ', germandbls: 'ß',
}))
  NAME_UNI.set(n, u);
export function nameToUnicode(name: string): string | undefined {
  const base = name.split('.')[0];
  const u = NAME_UNI.get(base);
  if (u) return u;
  let m = /^uni([0-9A-Fa-f]{4})/.exec(base);
  if (m) return String.fromCharCode(parseInt(m[1], 16));
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(base);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  return undefined;
}
const UNI_NAME = new Map<string, string>();
for (const [n, u] of NAME_UNI) if (!UNI_NAME.has(u)) UNI_NAME.set(u, n);
export const unicodeToName = (ch: string) => UNI_NAME.get(ch) ?? `uni${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

// ---------- Hilfen ----------

class Reader {
  constructor(public b: Uint8Array, public p = 0) {}
  u8() {
    return this.b[this.p++] ?? 0;
  }
  u16() {
    const v = ((this.b[this.p] ?? 0) << 8) | (this.b[this.p + 1] ?? 0);
    this.p += 2;
    return v;
  }
  i16() {
    const v = this.u16();
    return v & 0x8000 ? v - 0x10000 : v;
  }
  u32() {
    const v = this.u16() * 65536 + this.u16();
    return v;
  }
}

/** Kontur aus Punkten zusammensetzen; Ergebnis in Schrifteinheiten */
class GlyphPath {
  pb = new PathBuilder();
  open = false;
  x = 0;
  y = 0;
  move(x: number, y: number) {
    if (this.open) this.pb.close();
    this.pb.moveTo({ x, y });
    this.open = true;
    this.x = x;
    this.y = y;
  }
  line(x: number, y: number) {
    if (!this.open) this.move(this.x, this.y);
    this.pb.lineTo({ x, y });
    this.x = x;
    this.y = y;
  }
  curve(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    if (!this.open) this.move(this.x, this.y);
    this.pb.curveTo({ x: x1, y: y1 }, { x: x2, y: y2 }, { x, y });
    this.x = x;
    this.y = y;
  }
  close() {
    if (this.open) this.pb.close();
    this.open = false;
  }
  result(): SubPath[] {
    this.close();
    return this.pb.subs.filter((s) => s.nodes.length > 1);
  }
}

// ---------- TrueType ----------

export function parseTrueType(data: Uint8Array): FontProgram {
  const r = new Reader(data);
  let tag = r.u32();
  if (tag === 0x74746366) {
    // Schriftsammlung: erste Schrift
    r.p = 12;
    r.p = r.u32();
    tag = r.u32();
  }
  const base = r.p - 4;
  r.p = base + 4;
  const numTables = r.u16();
  r.p += 6;
  const tables = new Map<string, { off: number; len: number }>();
  for (let i = 0; i < numTables; i++) {
    const t = String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8());
    r.u32();
    tables.set(t, { off: r.u32(), len: r.u32() });
  }
  const cff = tables.get('CFF ');
  if (cff && !tables.get('glyf')) return parseCFF(data.subarray(cff.off, cff.off + cff.len));
  const T = (n: string) => tables.get(n);
  const head = T('head');
  const unitsPerEm = head ? (new Reader(data, head.off + 18).u16() || 1000) : 1000;
  const locFmt = head ? new Reader(data, head.off + 50).i16() : 0;
  const maxp = T('maxp');
  const loca = T('loca'),
    glyf = T('glyf');
  let numGlyphs = maxp ? new Reader(data, maxp.off + 4).u16() : 0;
  const locs: number[] = [];
  if (loca) {
    const lr = new Reader(data, loca.off);
    const n = Math.floor(loca.len / (locFmt ? 4 : 2));
    for (let i = 0; i < n; i++) locs.push(locFmt ? lr.u32() : lr.u16() * 2);
    if (!numGlyphs) numGlyphs = n - 1;
  }
  // Vorschübe
  const hhea = T('hhea'),
    hmtx = T('hmtx');
  const nh = hhea ? new Reader(data, hhea.off + 34).u16() : 0;
  const advance = (gid: number) => (hmtx && nh ? new Reader(data, hmtx.off + 4 * Math.min(gid, nh - 1)).u16() : unitsPerEm / 2);
  // cmap
  const cmaps = new Map<string, Map<number, number>>();
  const cm = T('cmap');
  if (cm) {
    const cr = new Reader(data, cm.off + 2);
    const n = cr.u16();
    for (let i = 0; i < n; i++) {
      const pid = cr.u16(),
        eid = cr.u16(),
        off = cr.u32();
      const map = new Map<number, number>();
      const s = new Reader(data, cm.off + off);
      const fmt = s.u16();
      if (fmt === 0) {
        s.p += 4;
        for (let c = 0; c < 256; c++) map.set(c, s.u8());
      } else if (fmt === 4) {
        s.p += 4;
        const segX2 = s.u16();
        s.p += 6;
        const seg = segX2 / 2;
        const endP = s.p,
          startP = endP + segX2 + 2,
          deltaP = startP + segX2,
          rangeP = deltaP + segX2;
        const rr = new Reader(data);
        for (let k = 0; k < seg; k++) {
          rr.p = endP + 2 * k;
          const end = rr.u16();
          rr.p = startP + 2 * k;
          const start = rr.u16();
          rr.p = deltaP + 2 * k;
          const delta = rr.i16();
          rr.p = rangeP + 2 * k;
          const ro = rr.u16();
          if (start > end || end - start > 0xffff) continue;
          for (let c = start; c <= end && c !== 0xffff; c++) {
            let g: number;
            if (!ro) g = (c + delta) & 0xffff;
            else {
              rr.p = rangeP + 2 * k + ro + 2 * (c - start);
              g = rr.u16();
              if (g) g = (g + delta) & 0xffff;
            }
            if (g) map.set(c, g);
          }
        }
      } else if (fmt === 6) {
        s.p += 4;
        const first = s.u16(),
          cnt = s.u16();
        for (let k = 0; k < cnt; k++) map.set(first + k, s.u16());
      } else if (fmt === 12) {
        s.p += 10;
        const ng = s.u32();
        for (let k = 0; k < ng && k < 100000; k++) {
          const a = s.u32(),
            b = s.u32(),
            g = s.u32();
          for (let c = a; c <= b && c - a < 70000; c++) map.set(c, g + c - a);
        }
      } else continue;
      cmaps.set(`${pid},${eid}`, map);
    }
  }
  // post-Tabelle (Glyphennamen)
  let names: Map<string, number> | null = null;
  const post = T('post');
  const nameMap = () => {
    if (names) return names;
    names = new Map();
    if (!post) return names;
    const pr = new Reader(data, post.off);
    const ver = pr.u32();
    if (ver !== 0x20000) return names;
    pr.p = post.off + 32;
    const n = pr.u16();
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(pr.u16());
    const extra: string[] = [];
    while (pr.p < post.off + post.len) {
      const len = pr.u8();
      let s = '';
      for (let k = 0; k < len; k++) s += String.fromCharCode(pr.u8());
      extra.push(s);
    }
    const MAC = macGlyphNames();
    idx.forEach((v, gid) => {
      const nm = v < 258 ? MAC[v] : extra[v - 258];
      if (nm && !names!.has(nm)) names!.set(nm, gid);
    });
    return names;
  };

  const cache = new Map<number, SubPath[] | null>();
  const glyphPts = (gid: number, depth: number): { pts: { x: number; y: number; on: boolean }[][] } => {
    const out: { x: number; y: number; on: boolean }[][] = [];
    if (!glyf || gid < 0 || gid + 1 >= locs.length || depth > 8) return { pts: out };
    const a = locs[gid],
      b = locs[gid + 1];
    if (b <= a) return { pts: out };
    const g = new Reader(data, glyf.off + a);
    const nc = g.i16();
    g.p += 8;
    if (nc >= 0) {
      const ends: number[] = [];
      for (let i = 0; i < nc; i++) ends.push(g.u16());
      const n = nc ? ends[nc - 1] + 1 : 0;
      const il = g.u16();
      g.p += il;
      const flags: number[] = [];
      while (flags.length < n) {
        const f = g.u8();
        flags.push(f);
        if (f & 8) {
          let rep = g.u8();
          while (rep-- > 0 && flags.length < n) flags.push(f);
        }
      }
      const xs: number[] = [],
        ys: number[] = [];
      let v = 0;
      for (const f of flags) {
        if (f & 2) v += f & 16 ? g.u8() : -g.u8();
        else if (!(f & 16)) v += g.i16();
        xs.push(v);
      }
      v = 0;
      for (const f of flags) {
        if (f & 4) v += f & 32 ? g.u8() : -g.u8();
        else if (!(f & 32)) v += g.i16();
        ys.push(v);
      }
      let s = 0;
      for (const e of ends) {
        const c: { x: number; y: number; on: boolean }[] = [];
        for (let i = s; i <= e && i < n; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
        out.push(c);
        s = e + 1;
      }
      return { pts: out };
    }
    // zusammengesetzte Glyphe
    for (let more = true; more; ) {
      const f = g.u16();
      const sub = g.u16();
      let dx: number, dy: number;
      if (f & 1) {
        dx = f & 2 ? g.i16() : g.u16();
        dy = f & 2 ? g.i16() : g.u16();
      } else {
        dx = f & 2 ? (g.u8() << 24) >> 24 : g.u8();
        dy = f & 2 ? (g.u8() << 24) >> 24 : g.u8();
      }
      if (!(f & 2)) dx = dy = 0; // Punktnummern statt Versatz: nicht unterstützt
      let [sa, sb, sc, sd] = [1, 0, 0, 1];
      const f2 = () => g.i16() / 16384;
      if (f & 8) sa = sd = f2();
      else if (f & 0x40) ((sa = f2()), (sd = f2()));
      else if (f & 0x80) ((sa = f2()), (sb = f2()), (sc = f2()), (sd = f2()));
      for (const c of glyphPts(sub, depth + 1).pts) out.push(c.map((p) => ({ x: sa * p.x + sc * p.y + dx, y: sb * p.x + sd * p.y + dy, on: p.on })));
      more = (f & 0x20) !== 0;
    }
    return { pts: out };
  };
  const glyph = (gid: number): SubPath[] | null => {
    if (cache.has(gid)) return cache.get(gid)!;
    const gp = new GlyphPath();
    for (const c of glyphPts(gid, 0).pts) {
      const n = c.length;
      if (n < 2) continue;
      // Beginnen an einem Punkt auf der Kurve, sonst an der Mitte zwischen den ersten beiden Kontrollpunkten
      const mid = (p: Pt, q: Pt) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      let arr: { x: number; y: number; on: boolean }[];
      const si = c.findIndex((p) => p.on);
      if (si >= 0) arr = [...c.slice(si), ...c.slice(0, si)];
      else arr = [{ ...mid(c[0], c[1]), on: true }, ...c.slice(1), c[0]];
      let cur: Pt = arr[0];
      gp.move(cur.x, cur.y);
      let ctrl: Pt | null = null;
      const quad = (q: Pt, p: Pt) => {
        gp.curve(cur.x + (2 / 3) * (q.x - cur.x), cur.y + (2 / 3) * (q.y - cur.y), p.x + (2 / 3) * (q.x - p.x), p.y + (2 / 3) * (q.y - p.y), p.x, p.y);
        cur = p;
      };
      const L = arr.length;
      for (let k = 1; k <= L; k++) {
        const p = arr[k % L];
        if (p.on) {
          if (ctrl) quad(ctrl, p);
          else {
            gp.line(p.x, p.y);
            cur = p;
          }
          ctrl = null;
        } else {
          if (ctrl) quad(ctrl, mid(ctrl, p));
          ctrl = p;
        }
      }
      gp.close();
    }
    const res = gp.result();
    cache.set(gid, res);
    return res;
  };
  const k = 1 / unitsPerEm;
  return {
    matrix: [k, 0, 0, k, 0, 0],
    numGlyphs,
    glyph,
    nameToGid: (n) => nameMap().get(n),
    builtinCode: () => undefined,
    cmap: (p, e) => cmaps.get(`${p},${e}`),
    advance,
  };
}

let macNames: string[] | null = null;
/** Die 258 Standardnamen der Macintosh-Glyphenliste (post-Tabelle) */
function macGlyphNames(): string[] {
  if (macNames) return macNames;
  macNames = (
    '.notdef .null nonmarkingreturn ' +
    ASCII_NAMES.join(' ') +
    ' Adieresis Aring Ccedilla Eacute Ntilde Odieresis Udieresis aacute agrave acircumflex adieresis atilde aring ccedilla eacute egrave ecircumflex edieresis iacute igrave icircumflex idieresis ntilde oacute ograve ocircumflex odieresis otilde uacute ugrave ucircumflex udieresis dagger degree cent sterling section bullet paragraph germandbls registered copyright trademark acute dieresis notequal AE Oslash infinity plusminus lessequal greaterequal yen mu partialdiff summation product pi integral ordfeminine ordmasculine Omega ae oslash questiondown exclamdown logicalnot radical florin approxequal Delta guillemotleft guillemotright ellipsis nonbreakingspace Agrave Atilde Otilde OE oe endash emdash quotedblleft quotedblright quoteleft quoteright divide lozenge ydieresis Ydieresis fraction currency guilsinglleft guilsinglright fi fl daggerdbl periodcentered quotesinglbase quotedblbase perthousand Acircumflex Ecircumflex Aacute Edieresis Egrave Iacute Icircumflex Idieresis Igrave Oacute Ocircumflex apple Ograve Uacute Ucircumflex Ugrave dotlessi circumflex tilde macron breve dotaccent ring cedilla hungarumlaut ogonek caron Lslash lslash Scaron scaron Zcaron zcaron brokenbar Eth eth Yacute yacute Thorn thorn minus multiply onesuperior twosuperior threesuperior onehalf onequarter threequarters franc Gbreve gbreve Idotaccent Scedilla scedilla Cacute cacute Ccaron ccaron dcroat'
  ).split(' ');
  return macNames;
}

// ---------- CFF ----------

function cffIndex(r: Reader): Uint8Array[] {
  const count = r.u16();
  if (!count) return [];
  const os = r.u8();
  const offs: number[] = [];
  for (let i = 0; i <= count; i++) {
    let v = 0;
    for (let k = 0; k < os; k++) v = v * 256 + r.u8();
    offs.push(v);
  }
  const base = r.p - 1;
  const items = offs.slice(0, -1).map((o, i) => r.b.subarray(base + o, base + offs[i + 1]));
  r.p = base + offs[count];
  return items;
}

function cffDict(d: Uint8Array): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let ops: number[] = [];
  for (let i = 0; i < d.length; ) {
    const b = d[i];
    if (b <= 21) {
      let op = b;
      i++;
      if (b === 12) op = 1200 + d[i++];
      out.set(op, ops);
      ops = [];
    } else if (b === 28) {
      ops.push(((d[i + 1] << 24) | (d[i + 2] << 16)) >> 16);
      i += 3;
    } else if (b === 29) {
      ops.push((d[i + 1] << 24) | (d[i + 2] << 16) | (d[i + 3] << 8) | d[i + 4]);
      i += 5;
    } else if (b === 30) {
      let s = '';
      i++;
      const nib = '0123456789.EE?-';
      for (let done = false; !done && i < d.length; i++) {
        for (const n of [d[i] >> 4, d[i] & 15]) {
          if (n === 15) {
            done = true;
            break;
          }
          s += n === 12 ? 'E-' : nib[n];
        }
      }
      ops.push(parseFloat(s) || 0);
    } else if (b >= 32 && b <= 246) {
      ops.push(b - 139);
      i++;
    } else if (b >= 247 && b <= 250) {
      ops.push((b - 247) * 256 + d[i + 1] + 108);
      i += 2;
    } else if (b >= 251 && b <= 254) {
      ops.push(-(b - 251) * 256 - d[i + 1] - 108);
      i += 2;
    } else i++;
  }
  return out;
}

const bias = (n: number) => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

export function parseCFF(data: Uint8Array): FontProgram {
  const r = new Reader(data, data[2]);
  cffIndex(r); // Namen
  const top = cffDict(cffIndex(r)[0] ?? new Uint8Array(0));
  const strings = cffIndex(r);
  const gsubrs = cffIndex(r);
  const sid = (s: number) => (s < STD_STRINGS.length ? STD_STRINGS[s] : s >= 391 ? new TextDecoder('latin1').decode(strings[s - 391] ?? new Uint8Array(0)) : `sid${s}`);
  const fm = top.get(1207);
  const matrix: Mat = fm && fm.length === 6 ? (fm as Mat) : [0.001, 0, 0, 0.001, 0, 0];
  const charStrings = cffIndex(new Reader(data, top.get(17)?.[0] ?? 0));
  const n = charStrings.length;
  const isCID = top.has(1230);
  // Private-Bereiche (je Schrift bzw. je FD) mit lokalen Subroutinen und Breiten
  interface Priv {
    subrs: Uint8Array[];
    nominal: number;
    dflt: number;
  }
  const priv = (pd: number[] | undefined): Priv => {
    if (!pd || pd.length < 2) return { subrs: [], nominal: 0, dflt: 0 };
    const [size, off] = pd;
    const p = cffDict(data.subarray(off, off + size));
    const so = p.get(19)?.[0];
    return { subrs: so ? cffIndex(new Reader(data, off + so)) : [], nominal: p.get(21)?.[0] ?? 0, dflt: p.get(20)?.[0] ?? 0 };
  };
  let privs: Priv[] = [priv(top.get(18))];
  let fdSelect: (gid: number) => number = () => 0;
  if (isCID) {
    const fda = cffIndex(new Reader(data, top.get(1236)?.[0] ?? 0));
    privs = fda.map((d) => priv(cffDict(d).get(18)));
    const fso = top.get(1237)?.[0];
    if (fso !== undefined) {
      const fr = new Reader(data, fso);
      const fmt = fr.u8();
      if (fmt === 0) {
        const tbl = data.subarray(fso + 1, fso + 1 + n);
        fdSelect = (g) => tbl[g] ?? 0;
      } else if (fmt === 3) {
        const nr = fr.u16();
        const ranges: [number, number][] = [];
        for (let i = 0; i < nr; i++) ranges.push([fr.u16(), fr.u8()]);
        const sentinel = fr.u16();
        fdSelect = (g) => {
          for (let i = ranges.length - 1; i >= 0; i--) if (g >= ranges[i][0] && g < (i + 1 < ranges.length ? ranges[i + 1][0] : sentinel)) return ranges[i][1];
          return 0;
        };
      }
    }
  }
  // Zeichensatz: Glyphennummer → SID bzw. CID
  const charset: number[] = [0];
  const cso = top.get(15)?.[0] ?? 0;
  if (cso > 2) {
    const cr = new Reader(data, cso);
    const fmt = cr.u8();
    while (charset.length < n) {
      if (fmt === 0) charset.push(cr.u16());
      else {
        const first = cr.u16();
        const left = fmt === 1 ? cr.u8() : cr.u16();
        for (let k = 0; k <= left && charset.length < n; k++) charset.push(first + k);
      }
    }
  } else for (let g = 1; g < n; g++) charset.push(g);
  const names = new Map<string, number>();
  const cids = new Map<number, number>();
  charset.forEach((s, g) => {
    if (isCID) cids.set(s, g);
    else if (!names.has(sid(s))) names.set(sid(s), g);
  });
  // Eingebaute Kodierung
  const enc = new Map<number, number>();
  const eo = top.get(16)?.[0] ?? 0;
  if (!isCID) {
    if (eo > 1) {
      const er = new Reader(data, eo);
      const fmt = er.u8();
      if ((fmt & 0x7f) === 0) {
        const nc = er.u8();
        for (let g = 1; g <= nc; g++) enc.set(er.u8(), g);
      } else if ((fmt & 0x7f) === 1) {
        const nr = er.u8();
        let g = 1;
        for (let i = 0; i < nr; i++) {
          const first = er.u8(),
            left = er.u8();
          for (let k = 0; k <= left; k++) enc.set(first + k, g++);
        }
      }
      if (fmt & 0x80) {
        const ns = er.u8();
        for (let i = 0; i < ns; i++) {
          const code = er.u8();
          const g = names.get(sid(er.u16()));
          if (g !== undefined) enc.set(code, g);
        }
      }
    } else
      STANDARD.forEach((nm, code) => {
        const g = nm ? names.get(nm) : undefined;
        if (g !== undefined) enc.set(code, g);
      });
  }

  const widths = new Map<number, number>();
  const cache = new Map<number, SubPath[] | null>();
  const run = (gid: number, depth: number, gp: GlyphPath, ox: number, oy: number): number => {
    const pv = privs[fdSelect(gid)] ?? privs[0];
    const cs = charStrings[gid];
    if (!cs || depth > 4) return 0;
    const st: number[] = [];
    let nStems = 0,
      haveWidth = false,
      width = pv.dflt,
      x = ox,
      y = oy;
    const takeWidth = (even: boolean) => {
      if (haveWidth) return;
      haveWidth = true;
      if ((st.length % 2 === 1) === even) width = pv.nominal + st.shift()!;
    };
    const lb = bias(pv.subrs.length),
      gb = bias(gsubrs.length);
    let stop = false;
    const exec = (code: Uint8Array, lvl: number) => {
      for (let i = 0; i < code.length && !stop; ) {
        const b = code[i];
        if (b >= 32 || b === 28) {
          if (b === 28) {
            st.push(((code[i + 1] << 24) | (code[i + 2] << 16)) >> 16);
            i += 3;
          } else if (b <= 246) {
            st.push(b - 139);
            i++;
          } else if (b <= 250) {
            st.push((b - 247) * 256 + code[i + 1] + 108);
            i += 2;
          } else if (b <= 254) {
            st.push(-(b - 251) * 256 - code[i + 1] - 108);
            i += 2;
          } else {
            st.push(((code[i + 1] << 24) | (code[i + 2] << 16) | (code[i + 3] << 8) | code[i + 4]) / 65536);
            i += 5;
          }
          continue;
        }
        i++;
        switch (b) {
          case 1:
          case 3:
          case 18:
          case 23:
            takeWidth(true);
            nStems += st.length >> 1;
            st.length = 0;
            break;
          case 19:
          case 20:
            takeWidth(true);
            nStems += st.length >> 1;
            st.length = 0;
            i += (nStems + 7) >> 3;
            break;
          case 21:
            if (!haveWidth) {
              haveWidth = true;
              if (st.length > 2) width = pv.nominal + st.shift()!;
            }
            x += st[st.length - 2] ?? 0;
            y += st[st.length - 1] ?? 0;
            gp.move(x, y);
            st.length = 0;
            break;
          case 22:
            if (!haveWidth) {
              haveWidth = true;
              if (st.length > 1) width = pv.nominal + st.shift()!;
            }
            x += st[0] ?? 0;
            gp.move(x, y);
            st.length = 0;
            break;
          case 4:
            if (!haveWidth) {
              haveWidth = true;
              if (st.length > 1) width = pv.nominal + st.shift()!;
            }
            y += st[0] ?? 0;
            gp.move(x, y);
            st.length = 0;
            break;
          case 5:
            for (let k = 0; k + 1 < st.length; k += 2) gp.line((x += st[k]), (y += st[k + 1]));
            st.length = 0;
            break;
          case 6:
          case 7: {
            let horiz = b === 6;
            for (const v of st) {
              if (horiz) x += v;
              else y += v;
              gp.line(x, y);
              horiz = !horiz;
            }
            st.length = 0;
            break;
          }
          case 8:
            for (let k = 0; k + 5 < st.length; k += 6) {
              const x1 = x + st[k],
                y1 = y + st[k + 1],
                x2 = x1 + st[k + 2],
                y2 = y1 + st[k + 3];
              x = x2 + st[k + 4];
              y = y2 + st[k + 5];
              gp.curve(x1, y1, x2, y2, x, y);
            }
            st.length = 0;
            break;
          case 24: {
            let k = 0;
            for (; k + 7 < st.length; k += 6) {
              const x1 = x + st[k],
                y1 = y + st[k + 1],
                x2 = x1 + st[k + 2],
                y2 = y1 + st[k + 3];
              x = x2 + st[k + 4];
              y = y2 + st[k + 5];
              gp.curve(x1, y1, x2, y2, x, y);
            }
            gp.line((x += st[k]), (y += st[k + 1]));
            st.length = 0;
            break;
          }
          case 25: {
            let k = 0;
            for (; k + 7 < st.length; k += 2) gp.line((x += st[k]), (y += st[k + 1]));
            const x1 = x + st[k],
              y1 = y + st[k + 1],
              x2 = x1 + st[k + 2],
              y2 = y1 + st[k + 3];
            x = x2 + st[k + 4];
            y = y2 + st[k + 5];
            gp.curve(x1, y1, x2, y2, x, y);
            st.length = 0;
            break;
          }
          case 26: {
            let k = 0;
            if (st.length % 2) x += st[k++];
            for (; k + 3 < st.length; k += 4) {
              const x1 = x,
                y1 = y + st[k],
                x2 = x1 + st[k + 1],
                y2 = y1 + st[k + 2];
              x = x2;
              y = y2 + st[k + 3];
              gp.curve(x1, y1, x2, y2, x, y);
            }
            st.length = 0;
            break;
          }
          case 27: {
            let k = 0;
            if (st.length % 2) y += st[k++];
            for (; k + 3 < st.length; k += 4) {
              const x1 = x + st[k],
                y1 = y,
                x2 = x1 + st[k + 1],
                y2 = y1 + st[k + 2];
              x = x2 + st[k + 3];
              y = y2;
              gp.curve(x1, y1, x2, y2, x, y);
            }
            st.length = 0;
            break;
          }
          case 30:
          case 31: {
            let horiz = b === 31;
            for (let k = 0; k + 3 < st.length; k += 4) {
              const last = k + 5 === st.length;
              if (horiz) {
                const x1 = x + st[k],
                  y1 = y,
                  x2 = x1 + st[k + 1],
                  y2 = y1 + st[k + 2];
                y = y2 + st[k + 3];
                x = x2 + (last ? st[k + 4] : 0);
                gp.curve(x1, y1, x2, y2, x, y);
              } else {
                const x1 = x,
                  y1 = y + st[k],
                  x2 = x1 + st[k + 1],
                  y2 = y1 + st[k + 2];
                x = x2 + st[k + 3];
                y = y2 + (last ? st[k + 4] : 0);
                gp.curve(x1, y1, x2, y2, x, y);
              }
              horiz = !horiz;
            }
            st.length = 0;
            break;
          }
          case 10: {
            const sub = pv.subrs[(st.pop() ?? 0) + lb];
            if (sub && lvl < 10) exec(sub, lvl + 1);
            break;
          }
          case 29: {
            const sub = gsubrs[(st.pop() ?? 0) + gb];
            if (sub && lvl < 10) exec(sub, lvl + 1);
            break;
          }
          case 11:
            return;
          case 14: {
            if (!haveWidth) {
              haveWidth = true;
              if (st.length === 1 || st.length === 5) width = pv.nominal + st.shift()!;
            }
            if (st.length === 4) {
              // Akzent aus zwei Glyphen der Standardkodierung (wie seac)
              const [adx, ady, bc, ac] = st;
              const bg = names.get(STANDARD[bc] ?? ''),
                ag = names.get(STANDARD[ac] ?? '');
              gp.close();
              if (bg !== undefined) run(bg, depth + 1, gp, ox, oy);
              if (ag !== undefined) run(ag, depth + 1, gp, ox + adx, oy + ady);
            }
            gp.close();
            stop = true;
            return;
          }
          case 12: {
            const b2 = code[i++];
            const s = st;
            if (b2 === 35) {
              // flex
              const p: number[] = [];
              for (let k = 0; k < 12; k += 2) p.push((x += s[k]), (y += s[k + 1]));
              gp.curve(p[0], p[1], p[2], p[3], p[4], p[5]);
              gp.curve(p[6], p[7], p[8], p[9], p[10], p[11]);
            } else if (b2 === 34) {
              const y0 = y;
              const x1 = x + s[0],
                y1 = y,
                x2 = x1 + s[1],
                y2 = y1 + s[2],
                x3 = x2 + s[3];
              const x4 = x3 + s[4],
                x5 = x4 + s[5],
                x6 = x5 + s[6];
              gp.curve(x1, y1, x2, y2, x3, y2);
              gp.curve(x4, y2, x5, y0, x6, y0);
              x = x6;
              y = y0;
            } else if (b2 === 36) {
              const y0 = y;
              const x1 = x + s[0],
                y1 = y + s[1],
                x2 = x1 + s[2],
                y2 = y1 + s[3],
                x3 = x2 + s[4];
              const x4 = x3 + s[5],
                x5 = x4 + s[6],
                y5 = y2 + s[7],
                x6 = x5 + s[8];
              gp.curve(x1, y1, x2, y2, x3, y2);
              gp.curve(x4, y2, x5, y5, x6, y0);
              x = x6;
              y = y0;
            } else if (b2 === 37) {
              const sx = x,
                sy = y;
              const pts: number[] = [];
              let cx = x,
                cy = y;
              for (let k = 0; k < 10; k += 2) pts.push((cx += s[k]), (cy += s[k + 1]));
              const dx = cx - sx,
                dy = cy - sy;
              if (Math.abs(dx) > Math.abs(dy)) ((cx += s[10]), (cy = sy));
              else ((cx = sx), (cy += s[10]));
              gp.curve(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]);
              gp.curve(pts[6], pts[7], pts[8], pts[9], cx, cy);
              x = cx;
              y = cy;
            }
            st.length = 0;
            break;
          }
          default:
            st.length = 0;
        }
      }
    };
    exec(cs, 0);
    if (depth === 0) widths.set(gid, width);
    return width;
  };
  const glyph = (gid: number) => {
    if (cache.has(gid)) return cache.get(gid)!;
    const gp = new GlyphPath();
    run(gid, 0, gp, 0, 0);
    const res = gp.result();
    cache.set(gid, res);
    return res;
  };
  return {
    matrix,
    numGlyphs: n,
    glyph,
    nameToGid: (nm) => names.get(nm),
    builtinCode: (c) => enc.get(c),
    cidToGid: isCID ? (c) => cids.get(c) : undefined,
    advance: (gid) => {
      if (!widths.has(gid)) glyph(gid);
      return widths.get(gid) ?? 500;
    },
  };
}

// ---------- Type 1 ----------

function decryptT1(data: Uint8Array, r: number, skip: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, data.length - skip));
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (i >= skip) out[i - skip] = c ^ (r >> 8);
    r = ((c + r) * 52845 + 22719) & 0xffff;
  }
  return out;
}

export function parseType1(data: Uint8Array, len1?: number): FontProgram {
  // PFB-Kopf entfernen
  if (data[0] === 0x80 && data[1] === 1) {
    const parts: Uint8Array[] = [];
    let p = 0;
    while (p + 6 <= data.length && data[p] === 0x80 && data[p + 1] !== 3) {
      const l = data[p + 2] | (data[p + 3] << 8) | (data[p + 4] << 16) | (data[p + 5] << 24);
      parts.push(data.subarray(p + 6, p + 6 + l));
      p += 6 + l;
    }
    const all = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
    let o = 0;
    for (const x of parts) {
      all.set(x, o);
      o += x.length;
    }
    len1 = parts[0]?.length;
    data = all;
  }
  void len1;
  const txt = new TextDecoder('latin1').decode(data.subarray(0, Math.min(data.length, 65536)));
  const ee = txt.indexOf('eexec');
  if (ee < 0) throw new Error('Type1: kein eexec');
  let start = ee + 5;
  while (start < data.length && (data[start] === 13 || data[start] === 10 || data[start] === 32 || data[start] === 9)) start++;
  // Hex- oder Binärform
  let enc = data.subarray(start);
  const isHex = [0, 1, 2, 3].every((k) => /[0-9A-Fa-f]/.test(String.fromCharCode(enc[k] ?? 0)));
  if (isHex) {
    const hex: number[] = [];
    let hi = -1;
    for (const c of enc) {
      const v = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
      if (v < 0) continue;
      if (hi < 0) hi = v;
      else {
        hex.push(hi * 16 + v);
        hi = -1;
      }
    }
    enc = new Uint8Array(hex);
  }
  const priv = decryptT1(enc, 55665, 4);
  const ptxt = new TextDecoder('latin1').decode(priv);
  const lenIV = parseInt(/\/lenIV\s+(-?\d+)/.exec(ptxt)?.[1] ?? '4', 10);
  const cs = (off: number, len: number) => {
    const raw = priv.subarray(off, off + len);
    return lenIV < 0 ? raw : decryptT1(raw, 4330, lenIV);
  };
  const subrs: Uint8Array[] = [];
  const si = ptxt.indexOf('/Subrs');
  const ci = ptxt.indexOf('/CharStrings');
  if (si >= 0) {
    const re = /dup\s+(\d+)\s+(\d+)\s+(RD|-\|)\s/g;
    re.lastIndex = si;
    for (let m; (m = re.exec(ptxt)); ) {
      if (ci >= 0 && m.index > ci) break;
      const off = m.index + m[0].length;
      subrs[parseInt(m[1], 10)] = cs(off, parseInt(m[2], 10));
      re.lastIndex = off + parseInt(m[2], 10);
    }
  }
  const glyphs = new Map<string, Uint8Array>();
  if (ci >= 0) {
    const re = /\/([^\s/[\]{}()<>]+)\s+(\d+)\s+(RD|-\|)\s/g;
    re.lastIndex = ci + 12;
    for (let m; (m = re.exec(ptxt)); ) {
      const off = m.index + m[0].length;
      glyphs.set(m[1], cs(off, parseInt(m[2], 10)));
      re.lastIndex = off + parseInt(m[2], 10);
    }
  }
  const names = [...glyphs.keys()];
  const gidOf = new Map(names.map((n, i) => [n, i]));
  // Kodierung aus dem Klartextteil
  const encMap = new Map<number, number>();
  const clear = txt.slice(0, start);
  if (/\/Encoding\s+StandardEncoding/.test(clear)) {
    STANDARD.forEach((nm, c) => {
      const g = nm ? gidOf.get(nm) : undefined;
      if (g !== undefined) encMap.set(c, g);
    });
  } else {
    const re = /dup\s+(\d+)\s*\/([^\s/[\]{}()<>]+)\s+put/g;
    for (let m; (m = re.exec(clear)); ) {
      const g = gidOf.get(m[2]);
      if (g !== undefined) encMap.set(parseInt(m[1], 10), g);
    }
  }
  const fmM = /\/FontMatrix\s*\[([^\]]*)\]/.exec(clear);
  const fm = fmM ? fmM[1].trim().split(/\s+/).map(Number) : [];
  const matrix: Mat = fm.length === 6 && fm.every(isFinite) ? (fm as Mat) : [0.001, 0, 0, 0.001, 0, 0];

  const widths = new Map<number, number>();
  const cache = new Map<number, SubPath[] | null>();
  const run = (name: string, gp: GlyphPath, ox: number, oy: number, depth: number): number => {
    const code = glyphs.get(name);
    if (!code || depth > 3) return 0;
    const st: number[] = [];
    const ps: number[] = [];
    let x = ox,
      y = oy,
      sbx = 0,
      width = 0;
    let flex: number[] | null = null;
    let stop = false;
    const exec = (c: Uint8Array, lvl: number) => {
      for (let i = 0; i < c.length && !stop; ) {
        const b = c[i];
        if (b >= 32) {
          if (b <= 246) {
            st.push(b - 139);
            i++;
          } else if (b <= 250) {
            st.push((b - 247) * 256 + c[i + 1] + 108);
            i += 2;
          } else if (b <= 254) {
            st.push(-(b - 251) * 256 - c[i + 1] - 108);
            i += 2;
          } else {
            st.push((c[i + 1] << 24) | (c[i + 2] << 16) | (c[i + 3] << 8) | c[i + 4]);
            i += 5;
          }
          continue;
        }
        i++;
        switch (b) {
          case 13: // hsbw
            sbx = st[0] ?? 0;
            width = st[1] ?? 0;
            x = ox + sbx;
            y = oy;
            st.length = 0;
            break;
          case 21:
            x += st[0] ?? 0;
            y += st[1] ?? 0;
            if (flex) flex.push(x, y);
            else gp.move(x, y);
            st.length = 0;
            break;
          case 22:
            x += st[0] ?? 0;
            if (flex) flex.push(x, y);
            else gp.move(x, y);
            st.length = 0;
            break;
          case 4:
            y += st[0] ?? 0;
            if (flex) flex.push(x, y);
            else gp.move(x, y);
            st.length = 0;
            break;
          case 5:
            gp.line((x += st[0] ?? 0), (y += st[1] ?? 0));
            st.length = 0;
            break;
          case 6:
            gp.line((x += st[0] ?? 0), y);
            st.length = 0;
            break;
          case 7:
            gp.line(x, (y += st[0] ?? 0));
            st.length = 0;
            break;
          case 8: {
            const x1 = x + st[0],
              y1 = y + st[1],
              x2 = x1 + st[2],
              y2 = y1 + st[3];
            x = x2 + st[4];
            y = y2 + st[5];
            gp.curve(x1, y1, x2, y2, x, y);
            st.length = 0;
            break;
          }
          case 30: {
            const x1 = x,
              y1 = y + st[0],
              x2 = x1 + st[1],
              y2 = y1 + st[2];
            x = x2 + st[3];
            y = y2;
            gp.curve(x1, y1, x2, y2, x, y);
            st.length = 0;
            break;
          }
          case 31: {
            const x1 = x + st[0],
              y1 = y,
              x2 = x1 + st[1],
              y2 = y1 + st[2];
            x = x2;
            y = y2 + st[3];
            gp.curve(x1, y1, x2, y2, x, y);
            st.length = 0;
            break;
          }
          case 9:
            gp.close();
            st.length = 0;
            break;
          case 10: {
            const sub = subrs[st.pop() ?? -1];
            if (sub && lvl < 10) exec(sub, lvl + 1);
            break;
          }
          case 11:
            return;
          case 14:
            gp.close();
            stop = true;
            return;
          case 1:
          case 3:
            st.length = 0;
            break;
          case 12: {
            const b2 = c[i++];
            if (b2 === 7) {
              // sbw
              sbx = st[0] ?? 0;
              width = st[2] ?? 0;
              x = ox + sbx;
              y = oy + (st[1] ?? 0);
              st.length = 0;
            } else if (b2 === 6) {
              // seac: Grundglyphe + Akzent
              const [asb, adx, ady, bc, ac] = st;
              st.length = 0;
              gp.close();
              run(STANDARD[bc] ?? '', gp, ox, oy, depth + 1);
              run(STANDARD[ac] ?? '', gp, ox + (adx ?? 0) - (asb ?? 0) + sbx, oy + (ady ?? 0), depth + 1);
              stop = true;
              return;
            } else if (b2 === 12) {
              const d = st.pop() ?? 1,
                n = st.pop() ?? 0;
              st.push(d ? n / d : 0);
            } else if (b2 === 16) {
              const other = st.pop() ?? 0,
                n = st.pop() ?? 0;
              const args = st.splice(st.length - n, n);
              if (other === 1) flex = [];
              else if (other === 0 && flex) {
                // 7 Punkte: Bezug, dann zwei Kurven
                const f = flex;
                if (f.length >= 14) {
                  gp.curve(f[2], f[3], f[4], f[5], f[6], f[7]);
                  gp.curve(f[8], f[9], f[10], f[11], f[12], f[13]);
                }
                flex = null;
                ps.push(y, x);
                break;
              }
              for (let k = args.length - 1; k >= 0; k--) ps.push(args[k]);
            } else if (b2 === 17) st.push(ps.pop() ?? 0);
            else if (b2 === 33) {
              x = ox + (st[0] ?? 0) - 0;
              y = oy + (st[1] ?? 0);
              st.length = 0;
            } else st.length = 0;
            break;
          }
          default:
            st.length = 0;
        }
      }
    };
    exec(code, 0);
    return width;
  };
  return {
    matrix,
    numGlyphs: names.length,
    glyph: (gid) => {
      if (cache.has(gid)) return cache.get(gid)!;
      const gp = new GlyphPath();
      const w = run(names[gid] ?? '', gp, 0, 0, 0);
      widths.set(gid, w);
      const res = gp.result();
      cache.set(gid, res);
      return res;
    },
    nameToGid: (n) => gidOf.get(n),
    builtinCode: (c) => encMap.get(c),
    advance: (gid) => widths.get(gid) ?? 500,
  };
}
