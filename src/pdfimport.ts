// Import von PDF und PDF-kompatiblen Illustrator-Dateien (.ai ab Illustrator 9 enthalten eine vollständige
// PDF-Fassung der Zeichnung). Eigener, kleiner PDF-Leser: Querverweise (Tabelle und Stream, mit Rückfall auf
// Durchsuchen der Datei), Objekt-Streams, die üblichen Filter und die Zeichenbefehle für Pfade und Bilder.
// Pfade bleiben Bézierkurven; Farben werden wie beim SVG-Import auf die nächstliegende Layerfarbe abgebildet.
import { inflateSync, unzlibSync, zlibSync } from 'fflate';
import { apply, IDENT, Mat, mul, SubPath } from './model';
import { ImportedImage, ImportedPath, ImportResult, nearestLayer, PathBuilder, transformSubs } from './importers';
import { FontProgram, nameToUnicode, parseCFF, parseTrueType, parseType1, STANDARD, WIN_ANSI } from './pdffonts';
import { t, tn } from './i18n';
import { EncryptInfo, PdfDecryptor } from './pdfcrypt';

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
  /** Datei ist verschlüsselt; crypt fehlt, wenn ein Kennwort zum Öffnen nötig ist oder das Verfahren unbekannt ist */
  encrypted = false;
  crypt: PdfDecryptor | null = null;
  private encryptNum = -1;
  private lastGen = 0;
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
    this.setupCrypt();
  }

  /** Standard-Sicherheitsverfahren mit leerem Benutzerkennwort (nur Bearbeitungsschutz) einrichten */
  private setupCrypt() {
    const enc = this.trailer.get('Encrypt') as Obj | undefined;
    if (enc === undefined || enc === null) return;
    this.encrypted = true;
    if (enc instanceof Ref) this.encryptNum = enc.num;
    const d = this.dict(enc);
    if (!d) return;
    const R = (k: string) => this.resolve(d.get(k) as Obj);
    const bytes = (k: string) => {
      const v = R(k);
      return v instanceof Str ? v.b : undefined;
    };
    const id = this.resolve(this.trailer.get('ID') as Obj);
    const id0 = Array.isArray(id) && this.resolve(id[0]) instanceof Str ? (this.resolve(id[0]) as Str).b : new Uint8Array(0);
    const v = num(R('V'), 0);
    const cf = this.dict(d.get('CF'));
    const method = (name: string): EncryptInfo['stmMethod'] => {
      if (v < 4) return 'RC4';
      if (name === 'Identity' || !name) return 'Identity';
      const cfm = nameOf(this.resolve(this.dict(cf?.get(name))?.get('CFM') as Obj));
      return cfm === 'AESV2' ? 'AESV2' : cfm === 'AESV3' ? 'AESV3' : cfm === 'V2' ? 'RC4' : 'Identity';
    };
    const em = R('EncryptMetadata');
    try {
      this.crypt = new PdfDecryptor({
        filter: nameOf(R('Filter')),
        v,
        r: num(R('R'), 2),
        length: num(R('Length'), 40),
        o: bytes('O') ?? new Uint8Array(0),
        u: bytes('U') ?? new Uint8Array(0),
        oe: bytes('OE'),
        ue: bytes('UE'),
        p: num(R('P'), -1) | 0,
        id0,
        encryptMetadata: em !== false,
        stmMethod: method(nameOf(R('StmF'))),
        strMethod: method(nameOf(R('StrF'))),
      });
    } catch {
      this.crypt = null;
      return;
    }
    // Bisher gelesene Objekte waren noch verschlüsselt
    const keep = this.cache.get(this.encryptNum);
    this.cache.clear();
    if (keep !== undefined) this.cache.set(this.encryptNum, keep);
  }

  private decryptObj(v: Obj, n: number, g: number): Obj {
    const c = this.crypt!;
    if (v instanceof Str) return new Str(c.string(n, g, v.b));
    if (Array.isArray(v)) return v.map((x) => this.decryptObj(x, n, g));
    if (v instanceof Dict) {
      for (const [k, x] of v.m) v.m.set(k, this.decryptObj(x as Obj, n, g));
      return v;
    }
    if (v instanceof Stream) {
      this.decryptObj(v.dict, n, g);
      const type = nameOf(v.dict.get('Type'));
      if (type === 'XRef') return v;
      return new Stream(v.dict, c.stream(n, g, v.raw));
    }
    return v;
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
    const gen = num(lx.next());
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
        this.lastGen = gen;
        return new Stream(v, this.b.subarray(p, end));
      }
      lx.p = save;
    }
    this.lastGen = gen;
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
        if (this.crypt && n !== this.encryptNum) v = this.decryptObj(v, n, this.lastGen);
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
  // Textzustand
  font: PFont | null;
  fs: number;
  tc: number;
  tw: number;
  th: number;
  tl: number;
  rise: number;
  mode: number;
}

// ---------- Schriften ----------

/** Ersatz für nicht eingebettete Schriften (von der App geliefert): Glyphen in Schrifteinheiten, y nach oben */
export interface FallbackFont {
  unitsPerEm: number;
  glyph(ch: string): { subs: SubPath[]; advance: number } | null;
  /** Name der tatsächlich verwendeten Schrift */
  name: string;
  /** true, wenn die gewünschte Schrift fehlte und eine andere einspringt */
  substituted: boolean;
}
/** Schrift laden: Kandidaten für den Familiennamen (bester zuerst), fett, kursiv */
export type FallbackResolver = (families: string[], bold: boolean, italic: boolean) => Promise<FallbackFont | null>;

interface PFont {
  name: string;
  /** Codes aus einer Zeichenkette lesen */
  codes(b: Uint8Array): { code: number; cid: number; len: number }[];
  /** Vorschub in Textraum-Einheiten (1 = Schriftgröße) */
  width(code: number, cid: number): number;
  /** Umriss im Geviert (y nach oben); null = keine Glyphe */
  outline(code: number, cid: number): SubPath[] | null;
  /** Type-3-Schrift: Glyphe als Inhalts-Stream */
  type3?: { proc(code: number): Stream | null; matrix: Mat; resources: Dict | null };
  /** Kein Schriftprogramm lesbar: Ersatz nötig */
  needsFallback: boolean;
  families: string[];
  bold: boolean;
  italic: boolean;
  fallback: FallbackFont | null;
  unicode(code: number, cid: number): string;
}

/** Familienname aus dem PostScript-Namen (ohne Teilmengen-Präfix) mit Varianten für die Suche */
function familyCandidates(base: string): { families: string[]; bold: boolean; italic: boolean } {
  const n = base.replace(/^[A-Z]{6}\+/, '');
  const bold = /bold|black|heavy|semibold|demi/i.test(n);
  const italic = /italic|oblique|kursiv/i.test(n);
  const STD: Record<string, string> = { helvetica: 'Arial', arial: 'Arial', times: 'Times New Roman', timesnewroman: 'Times New Roman', courier: 'Courier New', couriernew: 'Courier New' };
  let fam = n.split(/[-,]/)[0].replace(/(PSMT|MT|PS)$/, '');
  const std = STD[fam.toLowerCase().replace(/[^a-z]/g, '').replace(/roman$/, '')] ?? STD[fam.toLowerCase().replace(/[^a-z]/g, '')];
  if (std) return { families: [std], bold, italic };
  fam = fam.replace(/(Bold|Italic|Oblique|Regular|Medium|Light|Black|Semibold|SemiBold)+$/g, '') || fam;
  const spaced = fam.replace(/([a-z])([A-Z])/g, '$1 $2');
  return { families: [...new Set([spaced, fam])], bold, italic };
}

/** ToUnicode- oder Kodierungs-CMap lesen */
function parseCMap(data: Uint8Array) {
  const s = latin1(data);
  const hexNum = (h: string) => parseInt(h || '0', 16);
  const ranges: { lo: number; hi: number; len: number }[] = [];
  for (const m of s.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g))
    for (const r of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) ranges.push({ lo: hexNum(r[1]), hi: hexNum(r[2]), len: r[1].length / 2 });
  const cid = new Map<number, number>();
  const cidRanges: [number, number, number][] = [];
  for (const m of s.matchAll(/begincidrange([\s\S]*?)endcidrange/g))
    for (const r of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\d+)/g)) cidRanges.push([hexNum(r[1]), hexNum(r[2]), parseInt(r[3], 10)]);
  for (const m of s.matchAll(/begincidchar([\s\S]*?)endcidchar/g)) for (const r of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*(\d+)/g)) cid.set(hexNum(r[1]), parseInt(r[2], 10));
  const uni = new Map<number, string>();
  const utf16 = (h: string) => {
    let out = '';
    for (let i = 0; i + 3 < h.length; i += 4) out += String.fromCharCode(parseInt(h.substr(i, 4), 16));
    return out;
  };
  for (const m of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const r of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) uni.set(hexNum(r[1]), utf16(r[2]));
  for (const m of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const r of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]*)>|\[([^\]]*)\])/g)) {
      const lo = hexNum(r[1]),
        hi = hexNum(r[2]);
      if (hi - lo > 65535) continue;
      if (r[4] !== undefined) {
        const base = utf16(r[4]);
        for (let c = lo; c <= hi; c++) uni.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + c - lo));
      } else {
        const list = [...(r[5] ?? '').matchAll(/<([0-9A-Fa-f]*)>/g)].map((x) => utf16(x[1]));
        list.forEach((u, i) => uni.set(lo + i, u));
      }
    }
  return {
    ranges,
    cid: (c: number) => {
      if (cid.has(c)) return cid.get(c)!;
      for (const [lo, hi, st] of cidRanges) if (c >= lo && c <= hi) return st + c - lo;
      return undefined;
    },
    uni,
  };
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

const fontCache = new WeakMap<PdfDoc, Map<Dict, PFont>>();

/** Schrift aus einem /Font-Eintrag lesen (zwischengespeichert je Dokument) */
function loadPFont(doc: PdfDoc, fd: Dict): PFont {
  let cache = fontCache.get(doc);
  if (!cache) fontCache.set(doc, (cache = new Map()));
  const hit = cache.get(fd);
  if (hit) return hit;
  const R = (v: unknown) => doc.resolve(v as Obj);
  const sub = nameOf(R(fd.get('Subtype')));
  const baseName = nameOf(R(fd.get('BaseFont'))) || nameOf(R(fd.get('Name'))) || 'Font';
  const cand = familyCandidates(baseName);
  const desc0 = sub === 'Type0' ? doc.dict((R(fd.get('DescendantFonts')) as Obj[] | null)?.[0]) : fd;
  const fdesc = doc.dict(desc0?.get('FontDescriptor'));
  const flags = num(R(fdesc?.get('Flags')));
  if (num(R(fdesc?.get('FontWeight'))) >= 600 || flags & (1 << 18)) cand.bold = true;
  if (flags & 64 || num(R(fdesc?.get('ItalicAngle'))) !== 0) cand.italic = true;
  // ToUnicode (für Ersatzschriften)
  const tu = R(fd.get('ToUnicode'));
  let toUni: Map<number, string> | null = null;
  if (tu instanceof Stream) {
    try {
      toUni = parseCMap(doc.decode(tu)).uni;
    } catch {
      toUni = null;
    }
  }
  // Schriftprogramm
  let prog: FontProgram | null = null;
  const ff = (k: string) => {
    const v = R(fdesc?.get(k));
    return v instanceof Stream ? v : null;
  };
  try {
    const f2 = ff('FontFile2'),
      f3 = ff('FontFile3'),
      f1 = ff('FontFile');
    if (f2) prog = parseTrueType(doc.decode(f2));
    else if (f3) {
      const st = nameOf(R(f3.dict.get('Subtype')));
      const d = doc.decode(f3);
      prog = st === 'OpenType' ? parseTrueType(d) : parseCFF(d);
    } else if (f1) prog = parseType1(doc.decode(f1), num(R(f1.dict.get('Length1'))));
    if (prog && prog.numGlyphs === 0) prog = null;
  } catch {
    prog = null;
  }
  const gcache = new Map<number, SubPath[] | null>();
  const outlineGid = (gid: number | undefined, key: number): SubPath[] | null => {
    if (gcache.has(key)) return gcache.get(key)!;
    let res: SubPath[] | null = null;
    if (prog && gid !== undefined && gid >= 0 && gid < Math.max(prog.numGlyphs, 1)) {
      const g = prog.glyph(gid);
      res = g ? transformSubs(g, prog.matrix) : null;
    }
    gcache.set(key, res);
    return res;
  };
  const fallbackOutline = (pf: PFont, code: number, cid: number): SubPath[] | null => {
    const fb = pf.fallback;
    if (!fb) return null;
    const ch = pf.unicode(code, cid);
    const key = -1 - code;
    if (gcache.has(key)) return gcache.get(key)!;
    const g = ch ? fb.glyph(ch) : null;
    const res = g ? transformSubs(g.subs, [1 / fb.unitsPerEm, 0, 0, 1 / fb.unitsPerEm, 0, 0]) : null;
    gcache.set(key, res);
    return res;
  };
  let pf: PFont;
  if (sub === 'Type3') {
    const procs = doc.dict(fd.get('CharProcs'));
    const fmA = R(fd.get('FontMatrix'));
    const matrix: Mat = Array.isArray(fmA) && fmA.length === 6 ? (fmA.map((x) => num(R(x))) as Mat) : [0.001, 0, 0, 0.001, 0, 0];
    const names = simpleEncoding(doc, fd, null, false);
    const first = num(R(fd.get('FirstChar')));
    const wa = R(fd.get('Widths'));
    pf = {
      name: baseName,
      codes: (b) => [...b].map((c) => ({ code: c, cid: c, len: 1 })),
      width: (c) => (Array.isArray(wa) ? num(R(wa[c - first])) * matrix[0] : 0),
      outline: () => null,
      type3: {
        proc: (c) => {
          const v = R(procs?.get(names[c] ?? ''));
          return v instanceof Stream ? v : null;
        },
        matrix,
        resources: doc.dict(fd.get('Resources')),
      },
      needsFallback: false,
      ...cand,
      fallback: null,
      unicode: (c) => toUni?.get(c) ?? '',
    };
  } else if (sub === 'Type0') {
    const encO = R(fd.get('Encoding'));
    let cm: ReturnType<typeof parseCMap> | null = null;
    if (encO instanceof Stream) {
      try {
        cm = parseCMap(doc.decode(encO));
      } catch {
        cm = null;
      }
    }
    const ranges = cm?.ranges.length ? cm.ranges : [{ lo: 0, hi: 0xffff, len: 2 }];
    const W = new Map<number, number>();
    const wa = R(desc0?.get('W'));
    if (Array.isArray(wa))
      for (let i = 0; i < wa.length; ) {
        const c1 = num(R(wa[i]));
        const nx = R(wa[i + 1]);
        if (Array.isArray(nx)) {
          nx.forEach((w, k) => W.set(c1 + k, num(R(w))));
          i += 2;
        } else {
          const c2 = num(nx),
            w = num(R(wa[i + 2]));
          for (let c = c1; c <= c2 && c - c1 < 65536; c++) W.set(c, w);
          i += 3;
        }
      }
    const dw = num(R(desc0?.get('DW')), 1000);
    const c2g = R(desc0?.get('CIDToGIDMap'));
    let c2gMap: Uint8Array | null = null;
    if (c2g instanceof Stream) {
      try {
        c2gMap = doc.decode(c2g);
      } catch {
        c2gMap = null;
      }
    }
    const gidOf = (cid: number) => {
      if (c2gMap) return 2 * cid + 1 < c2gMap.length ? (c2gMap[2 * cid] << 8) | c2gMap[2 * cid + 1] : undefined;
      if (prog?.cidToGid) return prog.cidToGid(cid);
      return cid;
    };
    pf = {
      name: baseName,
      codes: (b) => {
        const out: { code: number; cid: number; len: number }[] = [];
        for (let i = 0; i < b.length; ) {
          let done = false;
          for (let len = 1; len <= 4 && !done; len++) {
            if (i + len > b.length) break;
            let c = 0;
            for (let k = 0; k < len; k++) c = c * 256 + b[i + k];
            if (ranges.some((r) => r.len === len && c >= r.lo && c <= r.hi)) {
              out.push({ code: c, cid: cm ? (cm.cid(c) ?? c) : c, len });
              i += len;
              done = true;
            }
          }
          if (!done) i++;
        }
        return out;
      },
      width: (_c, cid) => (W.get(cid) ?? dw) / 1000,
      outline: (code, cid) => (prog ? outlineGid(gidOf(cid), cid) : fallbackOutline(pf, code, cid)),
      needsFallback: !prog,
      ...cand,
      fallback: null,
      unicode: (c) => toUni?.get(c) ?? '',
    };
  } else {
    // einfache Schrift (Type1, MMType1, TrueType)
    const symbolic = (flags & 4) !== 0 && (flags & 32) === 0;
    const names = simpleEncoding(doc, fd, prog, sub === 'TrueType');
    const first = num(R(fd.get('FirstChar')));
    const wa = R(fd.get('Widths'));
    const missing = num(R(fdesc?.get('MissingWidth')));
    const gidFor = (code: number): number | undefined => {
      if (!prog) return undefined;
      const nm = names[code];
      if (sub === 'TrueType' || prog.cmap) {
        const c30 = prog.cmap?.(3, 0),
          c31 = prog.cmap?.(3, 1),
          c10 = prog.cmap?.(1, 0);
        if (symbolic || !c31) {
          const g = c30?.get(0xf000 + code) ?? c30?.get(code) ?? c10?.get(code);
          if (g) return g;
        }
        const u = nm ? nameToUnicode(nm) : undefined;
        const g = (u ? c31?.get(u.charCodeAt(0)) : undefined) ?? (nm ? prog.nameToGid(nm) : undefined) ?? c10?.get(code) ?? c30?.get(0xf000 + code);
        if (g) return g;
        return code < prog.numGlyphs ? code : undefined;
      }
      return (nm ? prog.nameToGid(nm) : undefined) ?? prog.builtinCode(code);
    };
    pf = {
      name: baseName,
      codes: (b) => [...b].map((c) => ({ code: c, cid: c, len: 1 })),
      width: (c) => {
        const w = Array.isArray(wa) ? R(wa[c - first]) : null;
        if (typeof w === 'number') return w / 1000;
        if (missing) return missing / 1000;
        if (prog) {
          const g = gidFor(c);
          if (g !== undefined) return prog.advance(g) * prog.matrix[0];
        }
        const fb = pf.fallback;
        const ch = pf.unicode(c, c);
        const gl = fb && ch ? fb.glyph(ch) : null;
        return gl ? gl.advance / fb!.unitsPerEm : 0.5;
      },
      outline: (code) => (prog ? outlineGid(gidFor(code), code) : fallbackOutline(pf, code, code)),
      needsFallback: !prog,
      ...cand,
      fallback: null,
      unicode: (c) => toUni?.get(c) ?? (names[c] ? (nameToUnicode(names[c]!) ?? '') : c >= 32 && c < 127 ? String.fromCharCode(c) : ''),
    };
  }
  cache.set(fd, pf);
  return pf;
}

/** Glyphennamen je Code für einfache Schriften: Differences vor Basiskodierung */
function simpleEncoding(doc: PdfDoc, fd: Dict, prog: FontProgram | null, trueType: boolean): (string | undefined)[] {
  const enc = doc.resolve(fd.get('Encoding') as Obj);
  const baseOf = (n: string) => (n === 'WinAnsiEncoding' || n === 'MacRomanEncoding' || n === 'MacExpertEncoding' ? WIN_ANSI : n === 'StandardEncoding' ? STANDARD : null);
  let base: (string | undefined)[] | null = null;
  if (enc instanceof Name) base = baseOf(enc.n);
  else if (enc instanceof Dict) base = baseOf(nameOf(doc.resolve(enc.get('BaseEncoding') as Obj)));
  // Ohne Angabe: eingebaute Kodierung des Schriftprogramms (Type 1/CFF) bzw. Standard (TrueType)
  const names: (string | undefined)[] = [];
  if (base) base.forEach((n, c) => (names[c] = n));
  else if (trueType || !prog) STANDARD.forEach((n, c) => (names[c] = n));
  if (enc instanceof Dict) {
    const diff = doc.resolve(enc.get('Differences') as Obj);
    if (Array.isArray(diff)) {
      let code = 0;
      for (const d of diff) {
        const v = doc.resolve(d);
        if (typeof v === 'number') code = v;
        else if (v instanceof Name) names[code++] = v.n;
      }
    }
  }
  return names;
}

/** Alle Schriften, die auf den Seiten (auch in Formularen und Type-3-Schriften) benutzt werden */
function collectFonts(doc: PdfDoc, res: Dict | null, out: Set<Dict>, seen: Set<Dict>, depth = 0) {
  if (!res || seen.has(res) || depth > 12) return;
  seen.add(res);
  const fonts = doc.dict(res.get('Font'));
  if (fonts)
    for (const v of fonts.m.values()) {
      const f = doc.dict(v);
      if (f && !out.has(f)) {
        out.add(f);
        collectFonts(doc, doc.dict(f.get('Resources')), out, seen, depth + 1);
      }
    }
  const xo = doc.dict(res.get('XObject'));
  if (xo)
    for (const v of xo.m.values()) {
      const x = doc.resolve(v as Obj);
      if (x instanceof Stream && nameOf(x.dict.get('Subtype')) === 'Form') collectFonts(doc, doc.dict(x.dict.get('Resources')), out, seen, depth + 1);
    }
}

export const isPdf = (b: Uint8Array) => latin1(b, 0, Math.min(b.length, 1024)).includes('%PDF-');

export interface PdfImportOptions {
  /** Seite ab 0 (nur importPdf) */
  page?: number;
  /** Ersatz für nicht eingebettete Schriften; ohne werden solche Texte übersprungen */
  fallback?: FallbackResolver;
}

/** PDF bzw. PDF-kompatible .ai-Datei lesen (eine Seite) */
export async function importPdf(bytes: Uint8Array, opts: PdfImportOptions = {}): Promise<PdfImportResult> {
  const { doc, pages } = openPdf(bytes);
  const pi = Math.max(0, Math.min(pages.length - 1, opts.page ?? 0));
  const subst = await prepareFonts(doc, [pages[pi]], opts.fallback);
  return readPage(doc, pages, pi, subst);
}

/** Alle Seiten einer PDF-Datei (je Seite ein Ergebnis) */
export async function importPdfPages(bytes: Uint8Array, opts: PdfImportOptions = {}): Promise<PdfImportResult[]> {
  const { doc, pages } = openPdf(bytes);
  const subst = await prepareFonts(doc, pages, opts.fallback);
  return pages.map((_, i) => readPage(doc, pages, i, subst));
}

/** Nicht eingebettete Schriften vorab über die App laden; liefert die Namen ersetzter Schriften */
async function prepareFonts(doc: PdfDoc, pages: ReturnType<PdfDoc['pages']>, fallback?: FallbackResolver): Promise<Map<string, string>> {
  const subst = new Map<string, string>();
  if (!fallback) return subst;
  const fonts = new Set<Dict>();
  const seen = new Set<Dict>();
  for (const pg of pages) collectFonts(doc, pg.resources, fonts, seen);
  const byKey = new Map<string, Promise<FallbackFont | null>>();
  for (const fd of fonts) {
    let pf: PFont;
    try {
      pf = loadPFont(doc, fd);
    } catch {
      continue;
    }
    if (!pf.needsFallback || pf.type3) continue;
    const key = `${pf.families.join('|')}/${pf.bold}/${pf.italic}`;
    if (!byKey.has(key)) byKey.set(key, fallback(pf.families, pf.bold, pf.italic).catch(() => null));
    pf.fallback = await byKey.get(key)!;
    if (pf.fallback?.substituted) subst.set(pf.families[0], pf.fallback.name);
  }
  return subst;
}

function openPdf(bytes: Uint8Array) {
  if (!isPdf(bytes)) throw new Error(t('Keine gültige PDF-Datei'));
  const doc = new PdfDoc(bytes);
  if (doc.encrypted && !doc.crypt)
    throw new Error(t('Die PDF-Datei ist mit einem Kennwort zum Öffnen geschützt. Bitte ohne Kennwort speichern und erneut importieren.'));
  const pages = doc.pages();
  if (!pages.length) throw new Error(t('Die PDF-Datei enthält keine lesbare Seite.'));
  return { doc, pages };
}

function readPage(doc: PdfDoc, pages: ReturnType<PdfDoc['pages']>, pi: number, subst: Map<string, string>): PdfImportResult {
  const pg = pages[pi];
  const P = pageMatrix(pg.box, pg.rotate);
  const items: (ImportedPath | ImportedImage)[] = [];
  const notes: string[] = [];
  let texts = 0,
    missingGlyphs = 0,
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
    let tm: Mat = IDENT,
      tlm: Mat = IDENT;
    let textAcc = new Map<number, ImportedPath>();
    let lostText = false;
    const T = () => mul(P.m, gs.ctm);
    /** Zeichenkette setzen: Glyphen als Umrisse sammeln, Textmatrix weiterschieben */
    const show = (b: Uint8Array) => {
      const f = gs.font;
      if (!f) {
        lostText = true;
        return;
      }
      const th = gs.th;
      const visible = gs.mode !== 3 && gs.mode !== 7;
      const strokeOnly = gs.mode === 1 || gs.mode === 5;
      const layer = nearestLayer(strokeOnly ? gs.stroke : gs.fill);
      for (const { code, cid, len } of f.codes(b)) {
        const w0 = f.width(code, cid);
        if (visible) {
          const gm: Mat = mul(tm, [gs.fs * th, 0, 0, gs.fs, 0, gs.rise]);
          if (f.type3) {
            const proc = f.type3.proc(code);
            if (proc && depth < 24) {
              const data = safeDecode(proc);
              const before = items.length;
              if (data) run(data, f.type3.resources ?? res, { ...gs, ctm: mul(gs.ctm, mul(gm, f.type3.matrix)) }, depth + 1, forms);
              // Glyphen eines Textes zu einem Objekt je Farbe zusammenfassen
              for (const it of items.splice(before)) {
                if (it.kind !== 'path') {
                  items.push(it);
                  continue;
                }
                let acc = textAcc.get(it.layer);
                if (!acc) {
                  acc = { kind: 'path', subs: [], layer: it.layer };
                  textAcc.set(it.layer, acc);
                  items.push(acc);
                }
                acc.subs.push(...it.subs);
              }
            }
          } else {
            const ol = f.outline(code, cid);
            if (ol === null) {
              if (f.needsFallback && !f.fallback) lostText = true;
              else if (code !== 32 && f.unicode(code, cid).trim()) missingGlyphs++;
            } else if (ol.length) {
              let acc = textAcc.get(layer);
              if (!acc) {
                acc = { kind: 'path', subs: [], layer };
                textAcc.set(layer, acc);
                items.push(acc);
              }
              acc.subs.push(...transformSubs(ol, mul(P.m, mul(gs.ctm, gm))));
            }
          }
        }
        const tx = (w0 * gs.fs + gs.tc + (len === 1 && code === 32 ? gs.tw : 0)) * th;
        tm = mul(tm, [1, 0, 0, 1, tx, 0]);
      }
    };
    const strBytes = (v: Obj | undefined) => (v instanceof Str ? v.b : null);
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
          tm = tlm = IDENT;
          textAcc = new Map();
          lostText = false;
          break;
        case 'ET':
          if (lostText) texts++;
          lostText = false;
          textAcc = new Map();
          break;
        case 'Tf': {
          const fname = a[a.length - 2];
          gs.fs = num(a[a.length - 1], gs.fs);
          const fdict = fname instanceof Name ? doc.dict(doc.dict(res?.get('Font'))?.get(fname.n)) : null;
          try {
            gs.font = fdict ? loadPFont(doc, fdict) : null;
          } catch {
            gs.font = null;
          }
          break;
        }
        case 'Tc':
          gs.tc = num(a[a.length - 1]);
          break;
        case 'Tw':
          gs.tw = num(a[a.length - 1]);
          break;
        case 'Tz':
          gs.th = num(a[a.length - 1], 100) / 100;
          break;
        case 'TL':
          gs.tl = num(a[a.length - 1]);
          break;
        case 'Ts':
          gs.rise = num(a[a.length - 1]);
          break;
        case 'Tr':
          gs.mode = num(a[a.length - 1]);
          break;
        case 'Td':
        case 'TD': {
          const [tx, ty] = nums().slice(-2);
          if (v.op === 'TD') gs.tl = -(ty ?? 0);
          tm = tlm = mul(tlm, [1, 0, 0, 1, tx ?? 0, ty ?? 0]);
          break;
        }
        case 'Tm': {
          const n6 = nums().slice(-6);
          if (n6.length === 6) tm = tlm = n6 as Mat;
          break;
        }
        case 'T*':
          tm = tlm = mul(tlm, [1, 0, 0, 1, 0, -gs.tl]);
          break;
        case 'Tj': {
          const b = strBytes(a[a.length - 1]);
          if (b) show(b);
          break;
        }
        case "'":
        case '"': {
          if (v.op === '"') {
            gs.tw = num(a[a.length - 3]);
            gs.tc = num(a[a.length - 2]);
          }
          tm = tlm = mul(tlm, [1, 0, 0, 1, 0, -gs.tl]);
          const b = strBytes(a[a.length - 1]);
          if (b) show(b);
          break;
        }
        case 'TJ': {
          const arr = a[a.length - 1];
          if (!Array.isArray(arr)) break;
          for (const el of arr) {
            if (el instanceof Str) show(el.b);
            else if (typeof el === 'number') tm = mul(tm, [1, 0, 0, 1, (-el / 1000) * gs.fs * gs.th, 0]);
          }
          break;
        }
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
  run(
    all,
    pg.resources,
    { ctm: IDENT, fillCs: GRAY, strokeCs: GRAY, fill: [0, 0, 0], stroke: [0, 0, 0], font: null, fs: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, mode: 0 },
    0,
    new Set(),
  );
  // Textsammler ohne Glyphen entfernen
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'path' && !it.subs.length) items.splice(i, 1);
  }

  if (texts) notes.push(tn('{n} Text wurde übersprungen (Schrift nicht eingebettet und nicht vorhanden).', '{n} Texte wurden übersprungen (Schrift nicht eingebettet und nicht vorhanden).', texts));
  if (missingGlyphs) notes.push(tn('{n} Zeichen fehlte in der Schrift.', '{n} Zeichen fehlten in der Schrift.', missingGlyphs));
  if (subst.size) notes.push(t('Nicht eingebettete Schriften ersetzt: {list}.', { list: [...subst].map(([a, b]) => `${a} → ${b}`).join(', ') }));
  if (shadings) notes.push(tn('{n} Farbverlauf wurde übersprungen.', '{n} Farbverläufe wurden übersprungen.', shadings));
  if (inlineImgs || badImgs) notes.push(tn('{n} Bild ließ sich nicht lesen.', '{n} Bilder ließen sich nicht lesen.', inlineImgs + badImgs));
  if (depthHit) notes.push(t('Zu tief verschachtelte Inhalte wurden übersprungen.'));
  return { items, notes, pageCount: pages.length, pageSize: { w: P.w, h: P.h } };
}
