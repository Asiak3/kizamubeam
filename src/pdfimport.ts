// Import von PDF und PDF-kompatiblen Illustrator-Dateien (.ai ab Illustrator 9 enthalten eine vollständige
// PDF-Fassung der Zeichnung). Eigener, kleiner PDF-Leser: Querverweise (Tabelle und Stream, mit Rückfall auf
// Durchsuchen der Datei), Objekt-Streams, die üblichen Filter und die Zeichenbefehle für Pfade und Bilder.
// Pfade bleiben Bézierkurven; Farben werden wie beim SVG-Import auf die nächstliegende Layerfarbe abgebildet.
import { inflateSync, unzlibSync, zlibSync } from 'fflate';
import { apply, IDENT, Mat, mul } from './model';
import { ImportedImage, ImportedPath, ImportResult, nearestLayer, PathBuilder } from './importers';
import { t, tn } from './i18n';

// ---------- Objekte ----------

class Name {
  constructor(public n: string) {}
}
class Str {
  constructor(public b: Uint8Array) {}
}
class Ref {
  constructor(public num: number, public gen: number) {}
}
class Op {
  constructor(public op: string) {}
}
class Dict {
  m = new Map<string, unknown>();
  get(k: string) {
    return this.m.get(k);
  }
}
class Stream {
  constructor(public dict: Dict, public raw: Uint8Array) {}
}
type Obj = number | boolean | null | Name | Str | Ref | Dict | Stream | Obj[] | Op;

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const latin1 = (b: Uint8Array, a = 0, e = b.length) => {
  let s = '';
  for (let i = a; i < e; i += 8192) s += String.fromCharCode(...b.subarray(i, Math.min(e, i + 8192)));
  return s;
};

class Lexer {
  constructor(public b: Uint8Array, public p = 0) {}
  skipWs() {
    const b = this.b;
    while (this.p < b.length) {
      const c = b[this.p];
      if (WS.has(c)) this.p++;
      else if (c === 0x25) {
        while (this.p < b.length && b[this.p] !== 10 && b[this.p] !== 13) this.p++;
      } else break;
    }
  }
  /** Nächstes Objekt; Operatoren (Schlüsselwörter) als Op; undefined am Ende */
  next(): Obj | undefined {
    this.skipWs();
    const b = this.b;
    if (this.p >= b.length) return undefined;
    const c = b[this.p];
    if (c === 0x2f) {
      // Name mit #xx-Escapes
      let s = '';
      this.p++;
      while (this.p < b.length && !WS.has(b[this.p]) && !DELIM.has(b[this.p])) {
        if (b[this.p] === 0x23 && this.p + 2 < b.length) {
          s += String.fromCharCode(parseInt(String.fromCharCode(b[this.p + 1], b[this.p + 2]), 16));
          this.p += 3;
        } else s += String.fromCharCode(b[this.p++]);
      }
      return new Name(s);
    }
    if (c === 0x28) return this.litString();
    if (c === 0x3c) {
      if (b[this.p + 1] === 0x3c) {
        this.p += 2;
        const d = new Dict();
        for (;;) {
          this.skipWs();
          if (this.p >= b.length) break;
          if (b[this.p] === 0x3e && b[this.p + 1] === 0x3e) {
            this.p += 2;
            break;
          }
          const k = this.next();
          if (!(k instanceof Name)) {
            if (k === undefined) break;
            continue;
          }
          d.m.set(k.n, this.value());
        }
        return d;
      }
      this.p++;
      let hex = '';
      while (this.p < b.length && b[this.p] !== 0x3e) {
        const ch = b[this.p++];
        if (!WS.has(ch)) hex += String.fromCharCode(ch);
      }
      this.p++;
      if (hex.length % 2) hex += '0';
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16) || 0;
      return new Str(out);
    }
    if (c === 0x5b) {
      this.p++;
      const arr: Obj[] = [];
      for (;;) {
        this.skipWs();
        if (this.p >= b.length) break;
        if (b[this.p] === 0x5d) {
          this.p++;
          break;
        }
        const v = this.value();
        if (v === undefined) break;
        arr.push(v);
      }
      return arr;
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      this.p++;
      return new Op(String.fromCharCode(c));
    }
    // Zahl oder Schlüsselwort
    const start = this.p;
    while (this.p < b.length && !WS.has(b[this.p]) && !DELIM.has(b[this.p])) this.p++;
    if (this.p === start) {
      this.p++;
      return new Op(String.fromCharCode(c));
    }
    const s = latin1(b, start, this.p);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return parseFloat(s);
    if (/^[+-]?\d*\.?\d*$/.test(s)) return 0; // z. B. „-“ oder „.“ in fehlerhaften Dateien
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    return new Op(s);
  }
  /** Wert in Dicts/Arrays: „n g R“ wird zu Ref */
  value(): Obj | undefined {
    const v = this.next();
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) {
      const save = this.p;
      const g = this.next();
      if (typeof g === 'number' && Number.isInteger(g)) {
        const r = this.next();
        if (r instanceof Op && r.op === 'R') return new Ref(v, g);
      }
      this.p = save;
    }
    return v;
  }
  private litString(): Str {
    const b = this.b;
    this.p++;
    const out: number[] = [];
    let depth = 1;
    while (this.p < b.length) {
      let c = b[this.p++];
      if (c === 0x5c) {
        c = b[this.p++];
        const map: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };
        if (map[c] !== undefined) out.push(map[c]);
        else if (c >= 0x30 && c <= 0x37) {
          let v = c - 0x30;
          for (let k = 0; k < 2 && b[this.p] >= 0x30 && b[this.p] <= 0x37; k++) v = v * 8 + (b[this.p++] - 0x30);
          out.push(v & 255);
        } else if (c === 13) {
          if (b[this.p] === 10) this.p++;
        } else if (c !== 10) out.push(c);
        continue;
      }
      if (c === 0x28) depth++;
      else if (c === 0x29 && --depth === 0) break;
      out.push(c);
    }
    return new Str(new Uint8Array(out));
  }
}

// ---------- Filter ----------

function lzw(data: Uint8Array, early = 1): Uint8Array {
  const out: number[] = [];
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < 256; i++) dict.push([i]);
    dict.push([], []);
  };
  reset();
  let bits = 9,
    buf = 0,
    nb = 0,
    prev: number[] | null = null;
  for (let i = 0; i < data.length; i++) {
    buf = (buf << 8) | data[i];
    nb += 8;
    while (nb >= bits) {
      const code = (buf >> (nb - bits)) & ((1 << bits) - 1);
      nb -= bits;
      if (code === 256) {
        reset();
        bits = 9;
        prev = null;
        continue;
      }
      if (code === 257) return new Uint8Array(out);
      let entry: number[];
      if (code < dict.length) entry = dict[code];
      else if (prev) entry = [...prev, prev[0]];
      else return new Uint8Array(out);
      for (const v of entry) out.push(v);
      if (prev) dict.push([...prev, entry[0]]);
      prev = entry;
      if (dict.length + early >= 1 << bits && bits < 12) bits++;
    }
  }
  return new Uint8Array(out);
}

function ascii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let group: number[] = [];
  let i = 0;
  if (data[0] === 0x3c && data[1] === 0x7e) i = 2;
  for (; i < data.length; i++) {
    const c = data[i];
    if (c === 0x7e) break;
    if (WS.has(c)) continue;
    if (c === 0x7a && !group.length) {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(c - 33);
    if (group.length === 5) {
      let v = 0;
      for (const d of group) v = v * 85 + d;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      group = [];
    }
  }
  if (group.length > 1) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const d of group) v = v * 85 + d;
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bytes.slice(0, n - 1));
  }
  return new Uint8Array(out);
}

function asciiHex(data: Uint8Array): Uint8Array {
  let s = '';
  for (const c of data) {
    if (c === 0x3e) break;
    if (!WS.has(c)) s += String.fromCharCode(c);
  }
  if (s.length % 2) s += '0';
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16) || 0;
  return out;
}

function runLength(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; ) {
    const n = data[i++];
    if (n === 128) break;
    if (n < 128) {
      for (let k = 0; k <= n && i < data.length; k++) out.push(data[i++]);
    } else {
      const v = data[i++];
      for (let k = 0; k < 257 - n; k++) out.push(v);
    }
  }
  return new Uint8Array(out);
}

function inflate(data: Uint8Array): Uint8Array {
  try {
    return unzlibSync(data);
  } catch {
    try {
      return inflateSync(data.subarray(2));
    } catch {
      return inflateSync(data);
    }
  }
}

/** PNG- und TIFF-Prädiktoren rückgängig machen */
function unpredict(data: Uint8Array, parms: Dict | null): Uint8Array {
  const pred = num(parms?.get('Predictor'), 1);
  if (pred < 2) return data;
  const colors = num(parms?.get('Colors'), 1),
    bpc = num(parms?.get('BitsPerComponent'), 8),
    cols = num(parms?.get('Columns'), 1);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const row = Math.ceil((colors * bpc * cols) / 8);
  if (pred === 2) {
    if (bpc !== 8) return data;
    const out = data.slice();
    for (let r = 0; r * row < out.length; r++)
      for (let i = r * row + bpp; i < Math.min(out.length, (r + 1) * row); i++) out[i] = (out[i] + out[i - bpp]) & 255;
    return out;
  }
  const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  let prev = new Uint8Array(row);
  for (let r = 0; r < rows; r++) {
    const f = data[r * (row + 1)];
    const cur = out.subarray(r * row, (r + 1) * row);
    const src = data.subarray(r * (row + 1) + 1, (r + 1) * (row + 1));
    for (let i = 0; i < row; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0,
        b = prev[i],
        c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  return out;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const nameOf = (v: unknown) => (v instanceof Name ? v.n : '');

// ---------- Dokument ----------

interface XEntry {
  type: 1 | 2;
  off: number;
  idx: number;
}

class PdfDoc {
  xref = new Map<number, XEntry>();
  trailer = new Dict();
  cache = new Map<number, Obj>();
  constructor(public b: Uint8Array) {
    try {
      this.readXref();
      if (!this.trailer.get('Root')) throw new Error('kein Root');
      // Stichprobe: das Katalogobjekt muss lesbar sein
      if (!(this.resolve(this.trailer.get('Root') as Obj) instanceof Dict)) throw new Error('Root unlesbar');
    } catch {
      this.xref.clear();
      this.cache.clear();
      this.trailer = new Dict();
      this.scan();
    }
  }

  private readXref() {
    const tail = latin1(this.b, Math.max(0, this.b.length - 2048));
    const m = /startxref\s+(\d+)/g;
    let off = -1;
    for (let r; (r = m.exec(tail)); ) off = parseInt(r[1], 10);
    if (off < 0) throw new Error('kein startxref');
    const seen = new Set<number>();
    let first = true;
    while (off >= 0 && off < this.b.length && !seen.has(off)) {
      seen.add(off);
      const lx = new Lexer(this.b, off);
      const tok = lx.next();
      let tr: Dict;
      if (tok instanceof Op && tok.op === 'xref') {
        for (;;) {
          const s = lx.next();
          if (s instanceof Op) {
            if (s.op !== 'trailer') throw new Error('xref');
            break;
          }
          const n = lx.next();
          if (typeof s !== 'number' || typeof n !== 'number') throw new Error('xref');
          for (let i = 0; i < n; i++) {
            const o = lx.next(),
              _g = lx.next(),
              k = lx.next();
            if (typeof o !== 'number' || !(k instanceof Op)) throw new Error('xref');
            void _g;
            if (k.op === 'n' && !this.xref.has(s + i) && o > 0) this.xref.set(s + i, { type: 1, off: o, idx: 0 });
          }
        }
        tr = lx.next() as Dict;
        const xs = tr.get('XRefStm');
        if (typeof xs === 'number') this.readXrefStream(xs);
      } else {
        tr = this.readXrefStream(off);
      }
      if (first) this.trailer = tr;
      else for (const [k, v] of tr.m) if (!this.trailer.m.has(k)) this.trailer.m.set(k, v);
      first = false;
      const prev = tr.get('Prev');
      off = typeof prev === 'number' ? prev : -1;
    }
  }

  private readXrefStream(off: number): Dict {
    const s = this.parseAt(off);
    if (!(s instanceof Stream)) throw new Error('xref-Stream');
    const d = s.dict;
    const data = this.decode(s);
    const w = (d.get('W') as number[]).map((v) => num(v));
    const size = num(d.get('Size'));
    const index = (d.get('Index') as number[] | undefined)?.map((v) => num(v)) ?? [0, size];
    let p = 0;
    const field = (n: number, def: number) => {
      if (!n) return def;
      let v = 0;
      for (let i = 0; i < n; i++) v = v * 256 + data[p++];
      return v;
    };
    for (let k = 0; k + 1 < index.length; k += 2)
      for (let i = 0; i < index[k + 1]; i++) {
        const type = field(w[0], 1),
          a = field(w[1], 0),
          b = field(w[2], 0);
        const n = index[k] + i;
        if (this.xref.has(n)) continue;
        if (type === 1) this.xref.set(n, { type: 1, off: a, idx: 0 });
        else if (type === 2) this.xref.set(n, { type: 2, off: a, idx: b });
      }
    return d;
  }

  /** Rückfall: Datei nach „n g obj“ durchsuchen (beschädigte Querverweise) */
  private scan() {
    const s = latin1(this.b);
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    for (let m; (m = re.exec(s)); ) this.xref.set(parseInt(m[1], 10), { type: 1, off: m.index, idx: 0 });
    // Objekt-Streams auspacken
    for (const [n] of [...this.xref]) {
      const o = this.get(n);
      if (o instanceof Stream && nameOf(o.dict.get('Type')) === 'ObjStm') {
        const nObj = num(o.dict.get('N'));
        const lx = new Lexer(this.decode(o));
        for (let i = 0; i < nObj; i++) {
          const on = lx.next();
          lx.next();
          if (typeof on === 'number' && !this.xref.has(on)) this.xref.set(on, { type: 2, off: n, idx: i });
        }
      }
      if (o instanceof Stream && nameOf(o.dict.get('Type')) === 'XRef') for (const [k, v] of o.dict.m) this.trailer.m.set(k, v);
    }
    const tr = /trailer\s*<</g;
    for (let m; (m = tr.exec(s)); ) {
      const d = new Lexer(this.b, m.index + 7).next();
      if (d instanceof Dict) for (const [k, v] of d.m) this.trailer.m.set(k, v);
    }
    if (!this.trailer.get('Root')) {
      for (const [n] of this.xref) {
        const o = this.get(n);
        if (o instanceof Dict && nameOf(o.get('Type')) === 'Catalog') {
          this.trailer.m.set('Root', new Ref(n, 0));
          break;
        }
      }
    }
  }

  /** Indirektes Objekt an einer Dateiposition („n g obj … endobj“) */
  private parseAt(off: number): Obj {
    const lx = new Lexer(this.b, off);
    lx.next();
    lx.next();
    const kw = lx.next();
    if (!(kw instanceof Op) || kw.op !== 'obj') throw new Error('obj');
    const v = lx.value() ?? null;
    if (v instanceof Dict) {
      const save = lx.p;
      const s = lx.next();
      if (s instanceof Op && s.op === 'stream') {
        let p = lx.p;
        if (this.b[p] === 13) p++;
        if (this.b[p] === 10) p++;
        let len = v.get('Length') as Obj;
        if (len instanceof Ref) len = this.cache.has(len.num) || this.xref.has(len.num) ? this.resolve(len) : null;
        let end = typeof len === 'number' ? p + len : -1;
        const check = end >= 0 ? latin1(this.b, end, Math.min(this.b.length, end + 20)) : '';
        if (end < 0 || end > this.b.length || !/^\s*endstream/.test(check)) {
          // Länge fehlt oder stimmt nicht: bis „endstream“ suchen
          const rest = latin1(this.b, p, Math.min(this.b.length, p + 64 * 1024 * 1024));
          const k = rest.indexOf('endstream');
          end = k < 0 ? this.b.length : p + k;
          while (end > p && (this.b[end - 1] === 10 || this.b[end - 1] === 13)) end--;
        }
        return new Stream(v, this.b.subarray(p, end));
      }
      lx.p = save;
    }
    return v;
  }

  get(n: number): Obj {
    if (this.cache.has(n)) return this.cache.get(n)!;
    const e = this.xref.get(n);
    let v: Obj = null;
    this.cache.set(n, null); // gegen Endlosschleifen
    if (e?.type === 1) {
      try {
        v = this.parseAt(e.off);
      } catch {
        v = null;
      }
    } else if (e?.type === 2) {
      const os = this.get(e.off);
      if (os instanceof Stream) {
        const data = this.decode(os);
        const lx = new Lexer(data);
        const nObj = num(os.dict.get('N'));
        const offs: number[] = [];
        for (let i = 0; i < nObj; i++) {
          lx.next();
          offs.push(num(lx.next()));
        }
        const first = num(os.dict.get('First'));
        if (e.idx < offs.length) v = new Lexer(data, first + offs[e.idx]).value() ?? null;
      }
    }
    this.cache.set(n, v);
    return v;
  }

  resolve(v: Obj | undefined): Obj {
    let k = 0;
    while (v instanceof Ref && k++ < 32) v = this.get(v.num);
    return v ?? null;
  }
  dict(v: unknown): Dict | null {
    const r = this.resolve(v as Obj);
    return r instanceof Dict ? r : r instanceof Stream ? r.dict : null;
  }

  /** Stream entpacken; stopAtDct: Bilddaten im JPEG-Format nicht weiter anfassen */
  decode(s: Stream, stopAtDct = false): Uint8Array {
    let f = this.resolve(s.dict.get('Filter') as Obj);
    let p = this.resolve(s.dict.get('DecodeParms') as Obj);
    const filters = Array.isArray(f) ? f.map((x) => nameOf(this.resolve(x))) : f instanceof Name ? [f.n] : [];
    const parms = Array.isArray(p) ? p.map((x) => this.dict(x)) : [this.dict(p)];
    f = null;
    p = null;
    let data = s.raw;
    filters.forEach((name, i) => {
      if (data === null) return;
      const pr = parms[i] ?? null;
      switch (name) {
        case 'FlateDecode':
        case 'Fl':
          data = unpredict(inflate(data), pr);
          break;
        case 'LZWDecode':
        case 'LZW':
          data = unpredict(lzw(data, num(pr?.get('EarlyChange'), 1)), pr);
          break;
        case 'ASCII85Decode':
        case 'A85':
          data = ascii85(data);
          break;
        case 'ASCIIHexDecode':
        case 'AHx':
          data = asciiHex(data);
          break;
        case 'RunLengthDecode':
        case 'RL':
          data = runLength(data);
          break;
        case 'DCTDecode':
        case 'DCT':
          if (!stopAtDct) throw new Error('DCT');
          break;
        default:
          throw new Error(name);
      }
    });
    return data;
  }

  /** Seiten in Reihenfolge mit geerbten Einträgen */
  pages(): { dict: Dict; resources: Dict | null; box: number[]; rotate: number }[] {
    const out: { dict: Dict; resources: Dict | null; box: number[]; rotate: number }[] = [];
    const root = this.dict(this.trailer.get('Root'));
    const seen = new Set<Dict>();
    const walk = (node: Dict | null, inh: { res: Dict | null; media: Obj; crop: Obj; rot: number }) => {
      if (!node || seen.has(node) || out.length > 10000) return;
      seen.add(node);
      const res = this.dict(node.get('Resources')) ?? inh.res;
      const media = node.get('MediaBox') !== undefined ? this.resolve(node.get('MediaBox') as Obj) : inh.media;
      const crop = node.get('CropBox') !== undefined ? this.resolve(node.get('CropBox') as Obj) : inh.crop;
      const rot = node.get('Rotate') !== undefined ? num(this.resolve(node.get('Rotate') as Obj)) : inh.rot;
      const kids = this.resolve(node.get('Kids') as Obj);
      if (Array.isArray(kids) && nameOf(node.get('Type')) !== 'Page') {
        for (const k of kids) walk(this.dict(k), { res, media, crop, rot });
        return;
      }
      const toBox = (b: Obj) => (Array.isArray(b) && b.length === 4 ? b.map((v) => num(this.resolve(v))) : null);
      let box = toBox(crop) ?? toBox(media) ?? [0, 0, 612, 792];
      const mb = toBox(media);
      if (mb && toBox(crop)) {
        // CropBox auf die MediaBox begrenzen
        const n = (bx: number[]) => [Math.min(bx[0], bx[2]), Math.min(bx[1], bx[3]), Math.max(bx[0], bx[2]), Math.max(bx[1], bx[3])];
        const [a, c] = [n(box), n(mb)];
        box = [Math.max(a[0], c[0]), Math.max(a[1], c[1]), Math.min(a[2], c[2]), Math.min(a[3], c[3])];
        if (box[2] <= box[0] || box[3] <= box[1]) box = c;
      }
      out.push({ dict: node, resources: res, box, rotate: (((Math.round(rot / 90) * 90) % 360) + 360) % 360 });
    };
    walk(this.dict(root?.get('Pages')), { res: null, media: null, crop: null, rot: 0 });
    return out;
  }
}

// ---------- Bilder ----------

let crcTable: Uint32Array | null = null;
function crc32(b: Uint8Array, a: number, e: number) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = a; i < e; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** RGBA-Bildpunkte als PNG-Datei */
export function encodePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const idat = zlibSync(raw);
  const chunks: [string, Uint8Array][] = [
    ['IHDR', new Uint8Array([w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, 8, 6, 0, 0, 0])],
    ['IDAT', idat],
    ['IEND', new Uint8Array(0)],
  ];
  let len = 8;
  for (const [, d] of chunks) len += 12 + d.length;
  const out = new Uint8Array(len);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let p = 8;
  for (const [type, d] of chunks) {
    const n = d.length;
    out.set([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], p);
    for (let i = 0; i < 4; i++) out[p + 4 + i] = type.charCodeAt(i);
    out.set(d, p + 8);
    const c = crc32(out, p + 4, p + 8 + n);
    out.set([c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255], p + 8 + n);
    p += 12 + n;
  }
  return out;
}

const b64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
};

type RGB = [number, number, number];

interface ColorSpace {
  kind: 'gray' | 'rgb' | 'cmyk' | 'indexed' | 'tint' | 'lab' | 'pattern';
  n: number;
  base?: ColorSpace;
  hival?: number;
  lookup?: Uint8Array;
}
const GRAY: ColorSpace = { kind: 'gray', n: 1 },
  DRGB: ColorSpace = { kind: 'rgb', n: 3 },
  CMYK: ColorSpace = { kind: 'cmyk', n: 4 };

function toRgb(cs: ColorSpace, c: number[]): RGB {
  const v = (i: number) => Math.max(0, Math.min(1, c[i] ?? 0));
  switch (cs.kind) {
    case 'gray':
      return [v(0) * 255, v(0) * 255, v(0) * 255];
    case 'rgb':
      return [v(0) * 255, v(1) * 255, v(2) * 255];
    case 'cmyk':
      return [255 * (1 - v(0)) * (1 - v(3)), 255 * (1 - v(1)) * (1 - v(3)), 255 * (1 - v(2)) * (1 - v(3))];
    case 'lab': {
      // grob: nur die Helligkeit
      const l = Math.max(0, Math.min(100, c[0] ?? 0)) * 2.55;
      return [l, l, l];
    }
    case 'tint': {
      // Sonderfarben: Farbton als Grauwert (1 = volle Farbe = dunkel)
      const g = 255 * (1 - v(0));
      return [g, g, g];
    }
    case 'indexed': {
      const base = cs.base ?? DRGB;
      const i = Math.max(0, Math.min(cs.hival ?? 255, Math.round(c[0] ?? 0)));
      const lk = cs.lookup ?? new Uint8Array(0);
      const comps = [];
      for (let k = 0; k < base.n; k++) comps.push((lk[i * base.n + k] ?? 0) / 255);
      return toRgb(base, comps);
    }
    default:
      return [0, 0, 0];
  }
}

// ---------- Inhalt abspielen ----------

interface GState {
  ctm: Mat;
  fillCs: ColorSpace;
  strokeCs: ColorSpace;
  fill: RGB;
  stroke: RGB;
}

const PT = 25.4 / 72;

/** Abbildung PDF-Seitenkoordinaten (pt, y nach oben) → mm (y nach unten) mit Seitendrehung */
export function pageMatrix(box: number[], rotate: number): { m: Mat; w: number; h: number } {
  const [x0, y0, x1, y1] = [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];
  const K = PT;
  const bw = (x1 - x0) * K,
    bh = (y1 - y0) * K;
  switch (rotate) {
    case 90:
      return { m: [0, K, K, 0, -y0 * K, -x0 * K], w: bh, h: bw };
    case 180:
      return { m: [-K, 0, 0, K, x1 * K, -y0 * K], w: bw, h: bh };
    case 270:
      return { m: [0, -K, -K, 0, y1 * K, x1 * K], w: bh, h: bw };
    default:
      return { m: [K, 0, 0, -K, -x0 * K, y1 * K], w: bw, h: bh };
  }
}

export interface PdfImportResult extends ImportResult {
  /** Anzahl Seiten der Datei */
  pageCount: number;
  /** Größe der gelesenen Seite in mm */
  pageSize: { w: number; h: number };
}

export const isPdf = (b: Uint8Array) => latin1(b, 0, Math.min(b.length, 1024)).includes('%PDF-');

/** PDF bzw. PDF-kompatible .ai-Datei lesen; page: Seite ab 0 */
export function importPdf(bytes: Uint8Array, opts: { page?: number } = {}): PdfImportResult {
  const { doc, pages } = openPdf(bytes);
  return readPage(doc, pages, Math.max(0, Math.min(pages.length - 1, opts.page ?? 0)));
}

/** Alle Seiten einer PDF-Datei (je Seite ein Ergebnis) */
export function importPdfPages(bytes: Uint8Array): PdfImportResult[] {
  const { doc, pages } = openPdf(bytes);
  return pages.map((_, i) => readPage(doc, pages, i));
}

function openPdf(bytes: Uint8Array) {
  if (!isPdf(bytes)) throw new Error(t('Keine gültige PDF-Datei'));
  const doc = new PdfDoc(bytes);
  if (doc.trailer.get('Encrypt') !== undefined)
    throw new Error(t('Die PDF-Datei ist verschlüsselt. Bitte ohne Kennwort/Schutz speichern und erneut importieren.'));
  const pages = doc.pages();
  if (!pages.length) throw new Error(t('Die PDF-Datei enthält keine lesbare Seite.'));
  return { doc, pages };
}

function readPage(doc: PdfDoc, pages: ReturnType<PdfDoc['pages']>, pi: number): PdfImportResult {
  const pg = pages[pi];
  const P = pageMatrix(pg.box, pg.rotate);
  const items: (ImportedPath | ImportedImage)[] = [];
  const notes: string[] = [];
  let texts = 0,
    shadings = 0,
    inlineImgs = 0,
    badImgs = 0,
    depthHit = false;

  const colorSpace = (v: unknown, res: Dict | null, depth = 0): ColorSpace => {
    let o = doc.resolve(v as Obj);
    if (o instanceof Name) {
      switch (o.n) {
        case 'DeviceGray':
        case 'G':
        case 'CalGray':
          return GRAY;
        case 'DeviceRGB':
        case 'RGB':
        case 'CalRGB':
          return DRGB;
        case 'DeviceCMYK':
        case 'CMYK':
          return CMYK;
        case 'Pattern':
          return { kind: 'pattern', n: 0 };
      }
      const named = doc.dict(res?.get('ColorSpace'))?.get(o.n);
      if (named !== undefined && depth < 8) return colorSpace(named, res, depth + 1);
      return GRAY;
    }
    if (Array.isArray(o) && o.length) {
      const kind = nameOf(doc.resolve(o[0]));
      switch (kind) {
        case 'ICCBased': {
          const s = doc.resolve(o[1]);
          const n = s instanceof Stream ? num(doc.resolve(s.dict.get('N') as Obj), 3) : 3;
          return n === 1 ? GRAY : n === 4 ? CMYK : DRGB;
        }
        case 'CalRGB':
          return DRGB;
        case 'CalGray':
          return GRAY;
        case 'Lab':
          return { kind: 'lab', n: 3 };
        case 'Indexed':
        case 'I': {
          const base = colorSpace(o[1], res, depth + 1);
          const lk = doc.resolve(o[3]);
          const lookup = lk instanceof Str ? lk.b : lk instanceof Stream ? safeDecode(lk) : new Uint8Array(0);
          return { kind: 'indexed', n: 1, base, hival: num(doc.resolve(o[2]), 255), lookup: lookup ?? new Uint8Array(0) };
        }
        case 'Separation':
          return { kind: 'tint', n: 1 };
        case 'DeviceN': {
          const names = doc.resolve(o[1]);
          return { kind: 'tint', n: Array.isArray(names) ? names.length : 1 };
        }
        case 'Pattern':
          return { kind: 'pattern', n: 0 };
      }
      o = null;
    }
    return GRAY;
  };
  const safeDecode = (s: Stream, dct = false) => {
    try {
      return doc.decode(s, dct);
    } catch {
      return null;
    }
  };

  const image = (s: Stream, gs: GState, res: Dict | null) => {
    const d = s.dict;
    const w = num(doc.resolve(d.get('Width') as Obj)),
      h = num(doc.resolve(d.get('Height') as Obj));
    if (!(w > 0 && h > 0) || w * h > 60e6) {
      badImgs++;
      return;
    }
    const m = mul(P.m, mul(gs.ctm, [1, 0, 0, -1, 0, 1]));
    const f = doc.resolve(d.get('Filter') as Obj);
    const filters = Array.isArray(f) ? f.map((x) => nameOf(doc.resolve(x))) : f instanceof Name ? [f.n] : [];
    const last = filters[filters.length - 1];
    const smaskObj = doc.resolve(d.get('SMask') as Obj);
    const isMask = doc.resolve(d.get('ImageMask') as Obj) === true;
    if ((last === 'DCTDecode' || last === 'DCT') && !(smaskObj instanceof Stream) && !isMask) {
      const jpg = safeDecode(s, true);
      if (!jpg) {
        badImgs++;
        return;
      }
      items.push({ kind: 'image', href: 'data:image/jpeg;base64,' + b64(jpg), m, layer: 0 });
      return;
    }
    if (last === 'DCTDecode' || last === 'DCT' || last === 'JPXDecode' || last === 'JBIG2Decode' || last === 'CCITTFaxDecode') {
      // JPEG mit Maske, JPEG 2000 und Faxformate kann der Import nicht entpacken
      badImgs++;
      return;
    }
    const data = safeDecode(s);
    if (!data) {
      badImgs++;
      return;
    }
    const bpc = isMask ? 1 : num(doc.resolve(d.get('BitsPerComponent') as Obj), 8);
    const cs = isMask ? GRAY : colorSpace(d.get('ColorSpace') ?? new Name('DeviceGray'), res);
    if (cs.kind === 'pattern' || ![1, 2, 4, 8, 16].includes(bpc)) {
      badImgs++;
      return;
    }
    const n = cs.n;
    const dec = doc.resolve(d.get('Decode') as Obj);
    const decode = Array.isArray(dec) ? dec.map((v) => num(doc.resolve(v))) : null;
    const rowBytes = Math.ceil((w * n * bpc) / 8);
    const maxv = (1 << Math.min(bpc, 16)) - 1;
    const sample = (row: number, i: number) => {
      const bit = i * bpc;
      const p = row * rowBytes + (bit >> 3);
      if (bpc === 8) return data[p] ?? 0;
      if (bpc === 16) return ((data[p] ?? 0) << 8) | (data[p + 1] ?? 0);
      return ((data[p] ?? 0) >> (8 - bpc - (bit & 7))) & maxv;
    };
    const rgba = new Uint8Array(w * h * 4);
    const comps: number[] = new Array(n).fill(0);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (isMask) {
          // Schablone: Bildpunkt 0 wird mit der Füllfarbe gemalt (Decode [1 0] kehrt das um)
          const v = sample(y, x);
          const paint = decode && decode[0] === 1 ? v === 1 : v === 0;
          rgba[o] = gs.fill[0];
          rgba[o + 1] = gs.fill[1];
          rgba[o + 2] = gs.fill[2];
          rgba[o + 3] = paint ? 255 : 0;
          continue;
        }
        for (let k = 0; k < n; k++) {
          const raw = sample(y, x * n + k);
          if (cs.kind === 'indexed') comps[k] = decode ? decode[0] + (raw * (decode[1] - decode[0])) / maxv : raw;
          else {
            const lo = decode ? decode[2 * k] : 0,
              hi = decode ? decode[2 * k + 1] : 1;
            comps[k] = lo + (raw * (hi - lo)) / maxv;
          }
        }
        const c = toRgb(cs, comps);
        rgba[o] = c[0];
        rgba[o + 1] = c[1];
        rgba[o + 2] = c[2];
        rgba[o + 3] = 255;
      }
    if (smaskObj instanceof Stream) {
      const sm = safeDecode(smaskObj);
      const sw = num(doc.resolve(smaskObj.dict.get('Width') as Obj)),
        sh = num(doc.resolve(smaskObj.dict.get('Height') as Obj));
      const sb = num(doc.resolve(smaskObj.dict.get('BitsPerComponent') as Obj), 8);
      if (sm && sw > 0 && sh > 0 && sb === 8)
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) rgba[(y * w + x) * 4 + 3] = sm[Math.floor((y * sh) / h) * sw + Math.floor((x * sw) / w)] ?? 255;
    }
    items.push({ kind: 'image', href: 'data:image/png;base64,' + b64(encodePng(w, h, rgba)), m, layer: 0 });
  };

  const run = (content: Uint8Array, res: Dict | null, gs0: GState, depth: number, forms: Set<Stream>) => {
    const lx = new Lexer(content);
    const stack: GState[] = [];
    let gs: GState = { ...gs0 };
    let ops: Obj[] = [];
    let pb = new PathBuilder();
    let shown = false;
    const T = () => mul(P.m, gs.ctm);
    const pt = (x: unknown, y: unknown) => apply(T(), num(x), num(y));
    const paint = (stroke: boolean, fill: boolean) => {
      if (fill)
        // Füllen schließt offene Teilpfade stillschweigend
        for (const sp of pb.subs) {
          if (sp.closed || sp.nodes.length < 3) continue;
          const a = sp.nodes[0],
            b = sp.nodes[sp.nodes.length - 1];
          if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) {
            if (b.cin) a.cin = b.cin;
            sp.nodes.pop();
          }
          sp.closed = true;
        }
      const subs = pb.subs.filter((sp) => sp.nodes.length > 1 || sp.closed);
      if (subs.length && (stroke || fill)) {
        const c = stroke ? gs.stroke : gs.fill;
        items.push({ kind: 'path', subs, layer: nearestLayer(c) });
      }
      pb = new PathBuilder();
    };
    for (;;) {
      const v = lx.next();
      if (v === undefined) break;
      if (!(v instanceof Op)) {
        ops.push(v);
        if (ops.length > 64) ops.shift();
        continue;
      }
      const a = ops;
      ops = [];
      const nums = () => a.filter((x): x is number => typeof x === 'number');
      switch (v.op) {
        case 'q':
          if (stack.length < 256) stack.push({ ...gs });
          break;
        case 'Q':
          if (stack.length) gs = stack.pop()!;
          break;
        case 'cm': {
          const n = a.filter((x): x is number => typeof x === 'number');
          if (n.length >= 6) gs.ctm = mul(gs.ctm, n.slice(-6) as Mat);
          break;
        }
        case 'm':
          pb.moveTo(pt(a[0], a[1]));
          break;
        case 'l':
          pb.lineTo(pt(a[0], a[1]));
          break;
        case 'c':
          pb.curveTo(pt(a[0], a[1]), pt(a[2], a[3]), pt(a[4], a[5]));
          break;
        case 'v':
          pb.curveTo(pb.pos, pt(a[0], a[1]), pt(a[2], a[3]));
          break;
        case 'y': {
          const e = pt(a[2], a[3]);
          pb.curveTo(pt(a[0], a[1]), e, e);
          break;
        }
        case 'h':
          pb.close();
          break;
        case 're': {
          const [x, y, w, h] = [num(a[0]), num(a[1]), num(a[2]), num(a[3])];
          pb.moveTo(pt(x, y));
          pb.lineTo(pt(x + w, y));
          pb.lineTo(pt(x + w, y + h));
          pb.lineTo(pt(x, y + h));
          pb.close();
          break;
        }
        case 'S':
          paint(true, false);
          break;
        case 's':
          pb.close();
          paint(true, false);
          break;
        case 'f':
        case 'F':
        case 'f*':
          paint(false, true);
          break;
        case 'B':
        case 'B*':
          paint(true, true);
          break;
        case 'b':
        case 'b*':
          pb.close();
          paint(true, true);
          break;
        case 'n':
          pb = new PathBuilder();
          break;
        case 'W':
        case 'W*':
          break;
        case 'g':
          gs.fillCs = GRAY;
          gs.fill = toRgb(GRAY, nums());
          break;
        case 'G':
          gs.strokeCs = GRAY;
          gs.stroke = toRgb(GRAY, nums());
          break;
        case 'rg':
          gs.fillCs = DRGB;
          gs.fill = toRgb(DRGB, nums());
          break;
        case 'RG':
          gs.strokeCs = DRGB;
          gs.stroke = toRgb(DRGB, nums());
          break;
        case 'k':
          gs.fillCs = CMYK;
          gs.fill = toRgb(CMYK, nums());
          break;
        case 'K':
          gs.strokeCs = CMYK;
          gs.stroke = toRgb(CMYK, nums());
          break;
        case 'cs':
          gs.fillCs = colorSpace(a[a.length - 1], res);
          gs.fill = [0, 0, 0];
          break;
        case 'CS':
          gs.strokeCs = colorSpace(a[a.length - 1], res);
          gs.stroke = [0, 0, 0];
          break;
        case 'sc':
        case 'scn':
          if (gs.fillCs.kind !== 'pattern') gs.fill = toRgb(gs.fillCs, nums());
          break;
        case 'SC':
        case 'SCN':
          if (gs.strokeCs.kind !== 'pattern') gs.stroke = toRgb(gs.strokeCs, nums());
          break;
        case 'BT':
          shown = false;
          break;
        case 'ET':
          if (shown) texts++;
          shown = false;
          break;
        case 'Tj':
        case 'TJ':
        case "'":
        case '"':
          shown = true;
          break;
        case 'sh':
          shadings++;
          break;
        case 'BI': {
          // Eingebettetes Inline-Bild überspringen: Daten zwischen ID und EI
          for (;;) {
            const x = lx.next();
            if (x === undefined || (x instanceof Op && x.op === 'ID')) break;
          }
          let p = lx.p + 1;
          const b = lx.b;
          while (p + 1 < b.length && !(b[p] === 0x45 && b[p + 1] === 0x49 && WS.has(b[p - 1]) && (p + 2 >= b.length || WS.has(b[p + 2])))) p++;
          lx.p = p + 2;
          inlineImgs++;
          break;
        }
        case 'Do': {
          const nm = a[a.length - 1];
          if (!(nm instanceof Name)) break;
          const xo = doc.resolve(doc.dict(res?.get('XObject'))?.get(nm.n) as Obj);
          if (!(xo instanceof Stream)) break;
          const sub = nameOf(xo.dict.get('Subtype'));
          if (sub === 'Image') image(xo, gs, res);
          else if (sub === 'Form') {
            if (depth > 24 || forms.has(xo)) {
              depthHit = true;
              break;
            }
            const data = safeDecode(xo);
            if (!data) break;
            const mt = doc.resolve(xo.dict.get('Matrix') as Obj);
            const fm = Array.isArray(mt) && mt.length === 6 ? (mt.map((x) => num(doc.resolve(x))) as Mat) : IDENT;
            forms.add(xo);
            run(data, doc.dict(xo.dict.get('Resources')) ?? res, { ...gs, ctm: mul(gs.ctm, fm) }, depth + 1, forms);
            forms.delete(xo);
          }
          break;
        }
      }
    }
  };

  // Seiteninhalt (ein Stream oder mehrere aneinandergehängt)
  const cont = doc.resolve(pg.dict.get('Contents') as Obj);
  const streams = Array.isArray(cont) ? cont.map((c) => doc.resolve(c)) : [cont];
  const parts: Uint8Array[] = [];
  for (const s of streams) {
    if (!(s instanceof Stream)) continue;
    const d = safeDecode(s);
    if (d) parts.push(d, new Uint8Array([10]));
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  run(all, pg.resources, { ctm: IDENT, fillCs: GRAY, strokeCs: GRAY, fill: [0, 0, 0], stroke: [0, 0, 0] }, 0, new Set());

  if (texts) notes.push(tn('{n} Text wurde übersprungen (vorher in Pfade umwandeln).', '{n} Texte wurden übersprungen (vorher in Pfade umwandeln).', texts));
  if (shadings) notes.push(tn('{n} Farbverlauf wurde übersprungen.', '{n} Farbverläufe wurden übersprungen.', shadings));
  if (inlineImgs || badImgs) notes.push(tn('{n} Bild ließ sich nicht lesen.', '{n} Bilder ließen sich nicht lesen.', inlineImgs + badImgs));
  if (depthHit) notes.push(t('Zu tief verschachtelte Inhalte wurden übersprungen.'));
  return { items, notes, pageCount: pages.length, pageSize: { w: P.w, h: P.h } };
}
