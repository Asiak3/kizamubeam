// Import von Vektordateien: SVG und DXF werden in Bézierpfade (mm, y nach unten) übersetzt.
// Farben werden wie in LightBurn auf die nächstliegende Palettenfarbe (= Layer) abgebildet.
import { fitPolyline } from './fit';
import { apply, IDENT, Mat, mul, Node, PALETTE, Pt, SubPath } from './model';
import { t, tn } from './i18n';

/** Ein importiertes Element: Konturen in mm (y nach unten) und Layer */
export interface ImportedPath {
  kind: 'path';
  subs: SubPath[];
  layer: number;
}
/** Eingebettetes Rasterbild (z. B. data:-URL in einer SVG) */
export interface ImportedImage {
  kind: 'image';
  href: string;
  /** Abbildung des Einheitsquadrats 0..1 auf die Bildfläche in mm */
  m: Mat;
  layer: number;
}
export type Imported = ImportedPath | ImportedImage;

export interface ImportResult {
  items: Imported[];
  /** Hinweise für die Statusleiste (übersprungene Elemente usw.) */
  notes: string[];
  /** Koordinaten mit y nach oben (DXF): der Aufrufer spiegelt am Bett */
  yUp?: boolean;
}

// ---------- Pfadaufbau ----------

export class PathBuilder {
  subs: SubPath[] = [];
  private cur: SubPath | null = null;
  start: Pt = { x: 0, y: 0 };
  pos: Pt = { x: 0, y: 0 };
  moveTo(p: Pt) {
    this.cur = { nodes: [{ x: p.x, y: p.y }], closed: false };
    this.subs.push(this.cur);
    this.start = this.pos = p;
  }
  private ensure() {
    if (!this.cur) this.moveTo(this.pos);
    return this.cur!;
  }
  lineTo(p: Pt) {
    this.ensure().nodes.push({ x: p.x, y: p.y });
    this.pos = p;
  }
  curveTo(c1: Pt, c2: Pt, p: Pt) {
    const sp = this.ensure();
    sp.nodes[sp.nodes.length - 1].cout = { x: c1.x, y: c1.y };
    sp.nodes.push({ x: p.x, y: p.y, cin: { x: c2.x, y: c2.y } });
    this.pos = p;
  }
  close() {
    const sp = this.cur;
    if (!sp) return;
    const ns = sp.nodes;
    if (ns.length > 1) {
      const a = ns[0],
        b = ns[ns.length - 1];
      if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) {
        if (b.cin) a.cin = b.cin;
        ns.pop();
      }
    }
    sp.closed = true;
    this.pos = this.start;
    this.cur = null;
  }
  /** Ellipsenbogen um c mit Radien rx, ry, Drehung phi; von Winkel t0 über den Bogen dt (Bogenmaß, Vorzeichen = Richtung) */
  arc(c: Pt, rx: number, ry: number, phi: number, t0: number, dt: number, connect: boolean) {
    const cp = Math.cos(phi),
      sp = Math.sin(phi);
    const P = (t: number): Pt => {
      const x = rx * Math.cos(t),
        y = ry * Math.sin(t);
      return { x: c.x + x * cp - y * sp, y: c.y + x * sp + y * cp };
    };
    const D = (t: number): Pt => {
      const x = -rx * Math.sin(t),
        y = ry * Math.cos(t);
      return { x: x * cp - y * sp, y: x * sp + y * cp };
    };
    const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
    const step = dt / n;
    const k = (4 / 3) * Math.tan(step / 4);
    const p0 = P(t0);
    if (!connect || !this.cur) this.moveTo(p0);
    else if (Math.hypot(p0.x - this.pos.x, p0.y - this.pos.y) > 1e-9) this.lineTo(p0);
    for (let i = 0; i < n; i++) {
      const a = t0 + i * step,
        b = a + step;
      const pa = P(a),
        pb = P(b),
        da = D(a),
        db = D(b);
      this.curveTo({ x: pa.x + k * da.x, y: pa.y + k * da.y }, { x: pb.x - k * db.x, y: pb.y - k * db.y }, pb);
    }
  }
}

/** Unterpfade mit einer Matrix in neue Koordinaten bringen */
export function transformSubs(subs: SubPath[], m: Mat): SubPath[] {
  const T = (p: Pt) => apply(m, p.x, p.y);
  return subs.map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n): Node => {
      const q: Node = T(n);
      if (n.cin) q.cin = T(n.cin);
      if (n.cout) q.cout = T(n.cout);
      if (n.smooth) q.smooth = true;
      return q;
    }),
    ...(sp.start ? { start: true } : {}),
  }));
}

// ---------- Farben ----------

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00', blue: '#0000ff', yellow: '#ffff00',
  cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080',
  silver: '#c0c0c0', maroon: '#800000', olive: '#808000', navy: '#000080', purple: '#800080', teal: '#008080',
  orange: '#ffa500', brown: '#a52a2a', pink: '#ffc0cb',
};

function parseColor(v: string | undefined | null): [number, number, number] | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent' || s.startsWith('url(')) return null;
  const hex = NAMED[s] ?? s;
  let m = /^#([0-9a-f]{3})$/.exec(hex);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})/.exec(hex);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(([^)]*)\)/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    return parts.map((p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p))) as [number, number, number];
  }
  return null;
}

const PAL_RGB = PALETTE.slice(0, 30).map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
/** Nächstliegende Palettenfarbe (00–29) */
export function nearestLayer(rgb: [number, number, number] | null): number {
  if (!rgb) return 0;
  let best = 0,
    bd = Infinity;
  PAL_RGB.forEach((c, i) => {
    // gewichteter Abstand (Rot und Blau weniger empfindlich als Grün)
    const r = (c[0] + rgb[0]) / 2;
    const d = (2 + r / 256) * (c[0] - rgb[0]) ** 2 + 4 * (c[1] - rgb[1]) ** 2 + (2 + (255 - r) / 256) * (c[2] - rgb[2]) ** 2;
    if (d < bd) ((bd = d), (best = i));
  });
  return best;
}

// ---------- SVG ----------

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };

function lengthMm(v: string | null): number | null {
  if (!v) return null;
  const m = /^\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px|%)?\s*$/i.exec(v);
  if (!m || m[2] === '%') return null;
  return parseFloat(m[1]) * UNIT_MM[(m[2] ?? '').toLowerCase()];
}

/** Zahlenliste aus Attributen wie points oder viewBox */
const nums = (s: string | null) => (s ?? '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];

function parseTransform(s: string | null): Mat {
  let m: Mat = IDENT;
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
  let r: RegExpExecArray | null;
  while ((r = re.exec(s))) {
    const a = nums(r[2]);
    let t: Mat = IDENT;
    switch (r[1]) {
      case 'matrix':
        if (a.length >= 6) t = a.slice(0, 6) as Mat;
        break;
      case 'translate':
        t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const ang = ((a[0] ?? 0) * Math.PI) / 180,
          c = Math.cos(ang),
          sn = Math.sin(ang);
        const cx = a[1] ?? 0,
          cy = a[2] ?? 0;
        t = mul(mul([1, 0, 0, 1, cx, cy], [c, sn, -sn, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, t);
  }
  return m;
}

/** SVG-Pfaddaten (alle Befehle inkl. Bögen) in Unterpfade */
export function parsePathData(d: string): SubPath[] {
  const toks = d.match(/[a-df-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const pb = new PathBuilder();
  let i = 0,
    cmd = '';
  let lastC: Pt | null = null,
    lastQ: Pt | null = null;
  const isCmd = (t: string) => /^[a-z]$/i.test(t);
  const num = () => parseFloat(toks[i++]);
  const flag = () => {
    // Bogen-Flags dürfen ohne Trenner stehen („a1 1 0 01 10 10“)
    const t = toks[i];
    if (t.length > 1 && (t[0] === '0' || t[0] === '1') && !t.includes('.')) {
      toks[i] = t.slice(1);
      return t[0] === '1';
    }
    i++;
    return parseFloat(t) !== 0;
  };
  while (i < toks.length) {
    if (isCmd(toks[i])) cmd = toks[i++];
    else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const o = rel ? pb.pos : { x: 0, y: 0 };
    const P = (x: number, y: number): Pt => ({ x: o.x + x, y: o.y + y });
    const C = cmd.toUpperCase();
    try {
      switch (C) {
        case 'M': {
          pb.moveTo(P(num(), num()));
          cmd = rel ? 'l' : 'L'; // weitere Paare sind Linien
          lastC = lastQ = null;
          break;
        }
        case 'L':
          pb.lineTo(P(num(), num()));
          lastC = lastQ = null;
          break;
        case 'H':
          pb.lineTo({ x: (rel ? pb.pos.x : 0) + num(), y: pb.pos.y });
          lastC = lastQ = null;
          break;
        case 'V':
          pb.lineTo({ x: pb.pos.x, y: (rel ? pb.pos.y : 0) + num() });
          lastC = lastQ = null;
          break;
        case 'C': {
          const c1 = P(num(), num()),
            c2 = P(num(), num()),
            p = P(num(), num());
          pb.curveTo(c1, c2, p);
          lastC = c2;
          lastQ = null;
          break;
        }
        case 'S': {
          const c1 = lastC ? { x: 2 * pb.pos.x - lastC.x, y: 2 * pb.pos.y - lastC.y } : pb.pos;
          const c2 = P(num(), num()),
            p = P(num(), num());
          pb.curveTo(c1, c2, p);
          lastC = c2;
          lastQ = null;
          break;
        }
        case 'Q': {
          const q = P(num(), num()),
            p = P(num(), num());
          const a = pb.pos;
          pb.curveTo({ x: a.x + (2 / 3) * (q.x - a.x), y: a.y + (2 / 3) * (q.y - a.y) }, { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p);
          lastQ = q;
          lastC = null;
          break;
        }
        case 'T': {
          const a = pb.pos;
          const q: Pt = lastQ ? { x: 2 * a.x - lastQ.x, y: 2 * a.y - lastQ.y } : a;
          const p = P(num(), num());
          pb.curveTo({ x: a.x + (2 / 3) * (q.x - a.x), y: a.y + (2 / 3) * (q.y - a.y) }, { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p);
          lastQ = q;
          lastC = null;
          break;
        }
        case 'A': {
          const rx = Math.abs(num()),
            ry = Math.abs(num()),
            rot = num();
          const large = flag(),
            sweep = flag();
          const p = P(num(), num());
          svgArc(pb, pb.pos, p, rx, ry, rot, large, sweep);
          lastC = lastQ = null;
          break;
        }
        case 'Z':
          pb.close();
          lastC = lastQ = null;
          break;
        default:
          i++;
      }
    } catch {
      break;
    }
    if (toks[i] === undefined) break;
  }
  return pb.subs.filter((sp) => sp.nodes.length > 1 || sp.closed);
}

/** Bogen nach SVG-Endpunktparametern (Implementierungshinweise der SVG-Spezifikation, Anhang F.6) */
function svgArc(pb: PathBuilder, a: Pt, b: Pt, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean) {
  if ((a.x === b.x && a.y === b.y) || !rx || !ry) {
    pb.lineTo(b);
    return;
  }
  const phi = (rotDeg * Math.PI) / 180,
    cp = Math.cos(phi),
    sp = Math.sin(phi);
  const dx = (a.x - b.x) / 2,
    dy = (a.y - b.y) / 2;
  const x1 = cp * dx + sp * dy,
    y1 = -sp * dx + cp * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cxp = (co * rx * y1) / ry,
    cyp = (-co * ry * x1) / rx;
  const c = { x: cp * cxp - sp * cyp + (a.x + b.x) / 2, y: sp * cxp + cp * cyp + (a.y + b.y) / 2 };
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t0 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  pb.arc(c, rx, ry, phi, t0, dt, true);
  // Endpunkt exakt setzen (Rundungsfehler)
  pb.pos = b;
}

type Style = Record<string, string>;
interface CssRule {
  sel: string;
  props: Style;
}

function parseCss(text: string): CssRule[] {
  const rules: CssRule[] = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const props = parseDecl(m[2]);
    for (const sel of m[1].split(',')) rules.push({ sel: sel.trim(), props });
  }
  return rules;
}
function parseDecl(s: string): Style {
  const out: Style = {};
  for (const part of s.split(';')) {
    const k = part.indexOf(':');
    if (k > 0) out[part.slice(0, k).trim().toLowerCase()] = part.slice(k + 1).trim();
  }
  return out;
}
/** Einfache Selektoren: Element, .klasse, #id, element.klasse */
function matches(el: Element, sel: string): boolean {
  const m = /^([a-z][\w-]*)?((?:[.#][\w-]+)*)$/i.exec(sel);
  if (!m) return false;
  if (m[1] && m[1] !== '*' && el.localName !== m[1]) return false;
  for (const p of m[2].match(/[.#][\w-]+/g) ?? []) {
    if (p[0] === '.' && !(el.getAttribute('class') ?? '').split(/\s+/).includes(p.slice(1))) return false;
    if (p[0] === '#' && el.getAttribute('id') !== p.slice(1)) return false;
  }
  return true;
}

const STYLE_PROPS = ['stroke', 'fill', 'display', 'visibility'];

function sanitizeSvgText(input: string): string {
  let s = input;
  s = s.replace(/<\?xml[\s\S]*?\?>/gi, '');
  s = s.replace(/<!doctype[\s\S]*?>/gi, '');
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<!--([\s\S]*?)-->/g, '');
  } while (s !== prev);
  do {
    prev = s;
    s = s.replace(/<(script|foreignObject|iframe|object|embed|audio|video|canvas)\b[\s\S]*?<\/\1\s*>/gi, '');
  } while (s !== prev);
  do {
    prev = s;
    s = s.replace(/\son[a-z0-9_-]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '');
  } while (s !== prev);
  s = s.replace(/\s(xlink:href|href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_m, attr, _raw, d1, d2, d3) => {
    const v = (d1 ?? d2 ?? d3 ?? '').trim();
    const low = v.toLowerCase();
    if (low.startsWith('#')) return ` ${attr}="${v}"`;
    if (low.startsWith('javascript:') || low.startsWith('vbscript:')) return '';
    if (low.startsWith('data:') && !low.startsWith('data:image/')) return '';
    return ` ${attr}="${v}"`;
  });
  return s;
}

export function importSvg(text: string): ImportResult {
  const safeText = sanitizeSvgText(text);
  const doc = new DOMParser().parseFromString(safeText, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length)
    throw new Error(t('Keine gültige SVG-Datei'));
  const css = [...doc.getElementsByTagName('style')].flatMap((s) => parseCss(s.textContent ?? ''));
  const notes: string[] = [];
  let skippedText = 0;

  // Seitenmaßstab: Benutzereinheiten → mm
  const vb = nums(root.getAttribute('viewBox'));
  const wmm = lengthMm(root.getAttribute('width')),
    hmm = lengthMm(root.getAttribute('height'));
  let base: Mat = [25.4 / 96, 0, 0, 25.4 / 96, 0, 0];
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    const sx = wmm !== null ? wmm / vb[2] : hmm !== null ? hmm / vb[3] : 25.4 / 96;
    const sy = hmm !== null ? hmm / vb[3] : sx;
    const s = Math.min(sx, sy); // preserveAspectRatio xMidYMid meet (Standard)
    base = [s, 0, 0, s, -vb[0] * s, -vb[1] * s];
  }

  const items: Imported[] = [];
  const styleOf = (el: Element, parent: Style): Style => {
    const st: Style = {};
    for (const k of ['stroke', 'fill']) if (parent[k] !== undefined) st[k] = parent[k];
    if (parent.visibility) st.visibility = parent.visibility;
    for (const k of STYLE_PROPS) {
      const a = el.getAttribute(k);
      if (a !== null) st[k] = a;
    }
    for (const r of css) if (matches(el, r.sel)) for (const k of STYLE_PROPS) if (r.props[k] !== undefined) st[k] = r.props[k];
    const inline = parseDecl(el.getAttribute('style') ?? '');
    for (const k of STYLE_PROPS) if (inline[k] !== undefined) st[k] = inline[k];
    return st;
  };
  const layerFor = (st: Style) => {
    const stroke = parseColor(st.stroke);
    return nearestLayer(stroke ?? parseColor(st.fill ?? 'black'));
  };
  const attr = (el: Element, k: string, d = 0) => {
    const v = el.getAttribute(k);
    return v === null ? d : parseFloat(v) || 0;
  };

  const walk = (el: Element, m: Mat, pst: Style, depth: number) => {
    if (depth > 64) return;
    const name = el.localName;
    if (['defs', 'clipPath', 'mask', 'symbol', 'metadata', 'title', 'desc', 'style', 'script', 'pattern', 'marker', 'linearGradient', 'radialGradient', 'filter', 'foreignObject'].includes(name))
      return;
    const st = styleOf(el, pst);
    if (st.display === 'none') return;
    const mm = mul(m, parseTransform(el.getAttribute('transform')));
    const pb = new PathBuilder();
    switch (name) {
      case 'svg':
      case 'g':
      case 'a':
      case 'switch':
        if (el !== root && name === 'svg') {
          const t = mul(mm, [1, 0, 0, 1, attr(el, 'x'), attr(el, 'y')]);
          for (const c of el.children) walk(c, t, st, depth + 1);
        } else for (const c of el.children) walk(c, mm, st, depth + 1);
        return;
      case 'use': {
        const href = el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';
        const ref = href.startsWith('#') ? doc.getElementById(href.slice(1)) : null;
        if (!ref) return;
        const t = mul(mm, [1, 0, 0, 1, attr(el, 'x'), attr(el, 'y')]);
        if (ref.localName === 'symbol') for (const c of ref.children) walk(c, t, st, depth + 1);
        else walk(ref, t, st, depth + 1);
        return;
      }
      case 'path':
        items.push({ kind: 'path', subs: transformSubs(parsePathData(el.getAttribute('d') ?? ''), mul(base, mm)), layer: layerFor(st) });
        break;
      case 'rect': {
        const x = attr(el, 'x'),
          y = attr(el, 'y'),
          w = attr(el, 'width'),
          h = attr(el, 'height');
        if (w <= 0 || h <= 0) return;
        let rx = el.hasAttribute('rx') ? attr(el, 'rx') : attr(el, 'ry'),
          ry = el.hasAttribute('ry') ? attr(el, 'ry') : rx;
        rx = Math.min(rx, w / 2);
        ry = Math.min(ry, h / 2);
        if (rx > 0 && ry > 0) {
          pb.arc({ x: x + w - rx, y: y + ry }, rx, ry, 0, -Math.PI / 2, Math.PI / 2, false);
          pb.arc({ x: x + w - rx, y: y + h - ry }, rx, ry, 0, 0, Math.PI / 2, true);
          pb.arc({ x: x + rx, y: y + h - ry }, rx, ry, 0, Math.PI / 2, Math.PI / 2, true);
          pb.arc({ x: x + rx, y: y + ry }, rx, ry, 0, Math.PI, Math.PI / 2, true);
          pb.close();
        } else {
          pb.moveTo({ x, y });
          pb.lineTo({ x: x + w, y });
          pb.lineTo({ x: x + w, y: y + h });
          pb.lineTo({ x, y: y + h });
          pb.close();
        }
        break;
      }
      case 'circle':
      case 'ellipse': {
        const rx = name === 'circle' ? attr(el, 'r') : attr(el, 'rx'),
          ry = name === 'circle' ? rx : attr(el, 'ry');
        if (rx <= 0 || ry <= 0) return;
        pb.arc({ x: attr(el, 'cx'), y: attr(el, 'cy') }, rx, ry, 0, 0, 2 * Math.PI, false);
        pb.close();
        break;
      }
      case 'line':
        pb.moveTo({ x: attr(el, 'x1'), y: attr(el, 'y1') });
        pb.lineTo({ x: attr(el, 'x2'), y: attr(el, 'y2') });
        break;
      case 'polyline':
      case 'polygon': {
        const a = nums(el.getAttribute('points'));
        if (a.length < 4) return;
        pb.moveTo({ x: a[0], y: a[1] });
        for (let k = 2; k + 1 < a.length; k += 2) pb.lineTo({ x: a[k], y: a[k + 1] });
        if (name === 'polygon') pb.close();
        break;
      }
      case 'image': {
        const href = el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';
        const w = attr(el, 'width'),
          h = attr(el, 'height');
        if (!href.startsWith('data:image/') || w <= 0 || h <= 0) {
          notes.push(t('Verknüpftes Bild übersprungen (nur eingebettete Bilder werden übernommen).'));
          return;
        }
        items.push({ kind: 'image', href, m: mul(mul(base, mm), [w, 0, 0, h, attr(el, 'x'), attr(el, 'y')]), layer: layerFor(st) });
        return;
      }
      case 'text':
        skippedText++;
        return;
      default:
        for (const c of el.children) walk(c, mm, st, depth + 1);
        return;
    }
    if (pb.subs.length) items.push({ kind: 'path', subs: transformSubs(pb.subs, mul(base, mm)), layer: layerFor(st) });
  };
  walk(root, IDENT, {}, 0);
  if (skippedText) notes.push(tn('{n} Text übersprungen (in der Quelldatei vorher in Pfade umwandeln).', '{n} Texte übersprungen (in der Quelldatei vorher in Pfade umwandeln).', skippedText));
  return { items: items.filter((it) => it.kind === 'image' || it.subs.length), notes: [...new Set(notes)] };
}

// ---------- DXF ----------

interface DxfEnt {
  type: string;
  g: [number, string][];
  verts?: DxfEnt[];
}

const ACI: Record<number, [number, number, number]> = {
  1: [255, 0, 0], 2: [255, 255, 0], 3: [0, 255, 0], 4: [0, 255, 255], 5: [0, 0, 255], 6: [255, 0, 255], 7: [0, 0, 0],
  8: [128, 128, 128], 9: [192, 192, 192],
};

function dxfPairs(text: string): [number, string][] {
  const lines = text.split(/\r?\n/);
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = parseInt(lines[i].trim(), 10);
    if (isNaN(c)) continue;
    out.push([c, lines[i + 1].trim()]);
  }
  return out;
}

const INSUNITS_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4 };

export function importDxf(text: string): ImportResult {
  const pairs = dxfPairs(text);
  if (!pairs.some(([c, v]) => c === 0 && v === 'SECTION')) throw new Error(t('Keine gültige DXF-Datei'));
  let unit = 1;
  const layerColor = new Map<string, number>();
  // Echtfarben (Gruppencode 420, ab AutoCAD 2004) gehen vor dem Farbindex
  const layerTrue = new Map<string, [number, number, number]>();
  const blocks = new Map<string, { base: Pt; ents: DxfEnt[] }>();
  const entities: DxfEnt[] = [];
  const notes: string[] = [];
  let i = 0;
  let section = '';
  let curBlock: { base: Pt; ents: DxfEnt[] } | null = null;
  let polyline: DxfEnt | null = null;
  const readEnt = (): DxfEnt => {
    const type = pairs[i][1];
    const g: [number, string][] = [];
    i++;
    while (i < pairs.length && pairs[i][0] !== 0) g.push(pairs[i++]);
    return { type, g };
  };
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c !== 0) {
      i++;
      continue;
    }
    if (v === 'SECTION') {
      section = pairs[i + 1]?.[1] ?? '';
      i += 2;
      continue;
    }
    if (v === 'ENDSEC') {
      section = '';
      i++;
      continue;
    }
    if (v === 'EOF') break;
    const e = readEnt();
    if (section === 'HEADER') continue;
    if (section === 'TABLES') {
      if (e.type === 'LAYER') {
        const name = e.g.find(([k]) => k === 2)?.[1];
        const col = e.g.find(([k]) => k === 62)?.[1];
        const tc = e.g.find(([k]) => k === 420)?.[1];
        if (name && col) layerColor.set(name, Math.abs(parseInt(col, 10)));
        if (name && tc) layerTrue.set(name, trueColor(tc));
      }
      continue;
    }
    if (e.type === 'BLOCK') {
      const name = e.g.find(([k]) => k === 2)?.[1] ?? '';
      const bx = parseFloat(e.g.find(([k]) => k === 10)?.[1] ?? '0'),
        by = parseFloat(e.g.find(([k]) => k === 20)?.[1] ?? '0');
      curBlock = { base: { x: bx, y: by }, ents: [] };
      blocks.set(name, curBlock);
      continue;
    }
    if (e.type === 'ENDBLK') {
      curBlock = null;
      continue;
    }
    const list = section === 'BLOCKS' ? curBlock?.ents : section === 'ENTITIES' ? entities : null;
    if (!list) continue;
    if (e.type === 'VERTEX' && polyline) {
      polyline.verts!.push(e);
      continue;
    }
    if (e.type === 'SEQEND') {
      polyline = null;
      continue;
    }
    if (e.type === 'POLYLINE') {
      e.verts = [];
      polyline = e;
    }
    list.push(e);
  }
  // Einheit aus dem Kopf
  const hdr = pairs.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
  if (hdr >= 0) unit = INSUNITS_MM[parseInt(pairs[hdr + 1]?.[1] ?? '4', 10)] ?? 1;

  const items: ImportedPath[] = [];
  const skipped = new Map<string, number>();
  const emit = (e: DxfEnt, m: Mat, inheritColor: number | null, inheritRgb: [number, number, number] | null, depth: number) => {
    const get = (k: number, d = 0) => {
      const p = e.g.find(([c]) => c === k);
      return p ? parseFloat(p[1]) : d;
    };
    const lname = e.g.find(([c]) => c === 8)?.[1] ?? '0';
    let aci = get(62, 256);
    const tc = e.g.find(([c]) => c === 420)?.[1];
    let rgb: [number, number, number] | null = tc !== undefined ? trueColor(tc) : null;
    if (!rgb && aci === 256) {
      rgb = layerTrue.get(lname) ?? null;
      aci = layerColor.get(lname) ?? 7;
    }
    if (!rgb && aci === 0) {
      rgb = inheritRgb;
      aci = inheritColor ?? 7;
    }
    rgb ??= ACI[aci] ?? ACI[7];
    const layer = nearestLayer(rgb);
    const pb = new PathBuilder();
    switch (e.type) {
      case 'LINE':
        pb.moveTo({ x: get(10), y: get(20) });
        pb.lineTo({ x: get(11), y: get(21) });
        break;
      case 'LWPOLYLINE': {
        const vs: { x: number; y: number; b: number }[] = [];
        for (const [c, v] of e.g) {
          if (c === 10) vs.push({ x: parseFloat(v), y: 0, b: 0 });
          else if (c === 20 && vs.length) vs[vs.length - 1].y = parseFloat(v);
          else if (c === 42 && vs.length) vs[vs.length - 1].b = parseFloat(v);
        }
        polyBulge(pb, vs, (get(70) & 1) === 1);
        break;
      }
      case 'POLYLINE': {
        const vs = (e.verts ?? [])
          .filter((v) => (parseInt(v.g.find(([c]) => c === 70)?.[1] ?? '0', 10) & 16) === 0)
          .map((v) => {
            const gv = (k: number) => parseFloat(v.g.find(([c]) => c === k)?.[1] ?? '0');
            return { x: gv(10), y: gv(20), b: gv(42) };
          });
        polyBulge(pb, vs, (get(70) & 1) === 1);
        break;
      }
      case 'CIRCLE':
        pb.arc({ x: get(10), y: get(20) }, get(40), get(40), 0, 0, 2 * Math.PI, false);
        pb.close();
        break;
      case 'ARC': {
        const a0 = (get(50) * Math.PI) / 180;
        let a1 = (get(51) * Math.PI) / 180;
        while (a1 <= a0) a1 += 2 * Math.PI;
        pb.arc({ x: get(10), y: get(20) }, get(40), get(40), 0, a0, a1 - a0, false);
        break;
      }
      case 'ELLIPSE': {
        const mx = get(11),
          my = get(21);
        const rx = Math.hypot(mx, my),
          ry = rx * get(40, 1);
        const t0 = get(41, 0);
        let t1 = get(42, 2 * Math.PI);
        while (t1 <= t0) t1 += 2 * Math.PI;
        pb.arc({ x: get(10), y: get(20) }, rx, ry, Math.atan2(my, mx), t0, t1 - t0, false);
        if (Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6) pb.close();
        break;
      }
      case 'SPLINE': {
        const bz = bezierSpline(e);
        if (bz) {
          pb.subs.push(bz);
          break;
        }
        const pts = splinePoints(e);
        if (pts.length >= 2) {
          const closed = (get(70) & 1) === 1 || (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6);
          const sp = fitPolyline(pts, closed, 0.005);
          pb.subs.push(sp);
        }
        break;
      }
      case 'INSERT': {
        const name = e.g.find(([c]) => c === 2)?.[1] ?? '';
        const blk = blocks.get(name);
        if (!blk || depth > 16) return;
        const sx = get(41, 1),
          sy = get(42, 1),
          rot = (get(50) * Math.PI) / 180;
        const t: Mat = mul(
          mul([1, 0, 0, 1, get(10), get(20)], [Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), 0, 0]),
          mul([sx, 0, 0, sy, 0, 0], [1, 0, 0, 1, -blk.base.x, -blk.base.y]),
        );
        for (const be of blk.ents) emit(be, mul(m, t), aci, rgb, depth + 1);
        return;
      }
      default:
        if (!['POINT', 'ATTDEF', 'ATTRIB', 'VIEWPORT'].includes(e.type)) skipped.set(e.type, (skipped.get(e.type) ?? 0) + 1);
        return;
    }
    if (pb.subs.length) items.push({ kind: 'path', subs: transformSubs(pb.subs, m), layer });
  };
  // Einheit anwenden, y bleibt nach oben (der Aufrufer spiegelt am Bett)
  for (const e of entities) emit(e, [unit, 0, 0, unit, 0, 0], null, null, 0);
  if (skipped.size) notes.push(t('Übersprungen: {list}.', { list: [...skipped].map(([what, n]) => `${n}× ${what}`).join(', ') }));
  return { items: joinPaths(items), notes, yUp: true };
}

function polyBulge(pb: PathBuilder, vs: { x: number; y: number; b: number }[], closed: boolean) {
  if (vs.length < 2) return;
  pb.moveTo(vs[0]);
  const n = closed ? vs.length : vs.length - 1;
  for (let k = 0; k < n; k++) {
    const a = vs[k],
      b = vs[(k + 1) % vs.length];
    if (Math.abs(a.b) < 1e-9) pb.lineTo(b);
    else {
      // Bogen mit Wölbung: Öffnungswinkel = 4·atan(b), positiv gegen den Uhrzeigersinn
      const theta = 4 * Math.atan(a.b);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const r = d / (2 * Math.sin(Math.abs(theta) / 2));
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2;
      const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2)) * Math.sign(a.b) * (Math.abs(theta) > Math.PI ? -1 : 1);
      const ux = -(b.y - a.y) / d,
        uy = (b.x - a.x) / d;
      const c = { x: mx + ux * h, y: my + uy * h };
      const t0 = Math.atan2(a.y - c.y, a.x - c.x);
      pb.arc(c, r, r, 0, t0, theta, true);
      pb.pos = b;
    }
  }
  if (closed) pb.close();
}

const trueColor = (v: string): [number, number, number] => {
  const n = parseInt(v, 10) & 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Kubische Spline, die aus aneinandergereihten Bézier-Segmenten besteht (Knoten 0000 111 222 … nnnn, ohne
 * Gewichte; so schreiben KizamuBeam, Inkscape und viele CAD-Programme Kurven): genau übernehmen statt annähern.
 */
function bezierSpline(e: DxfEnt): SubPath | null {
  if (parseInt(e.g.find(([c]) => c === 71)?.[1] ?? '3', 10) !== 3) return null;
  const knots: number[] = [],
    ctrl: Pt[] = [],
    weights: number[] = [];
  for (const [c, v] of e.g) {
    const f = parseFloat(v);
    if (c === 40) knots.push(f);
    else if (c === 10) ctrl.push({ x: f, y: 0 });
    else if (c === 20 && ctrl.length) ctrl[ctrl.length - 1].y = f;
    else if (c === 41) weights.push(f);
  }
  const n = (ctrl.length - 1) / 3;
  if (!Number.isInteger(n) || n < 1 || knots.length !== ctrl.length + 4) return null;
  if (weights.some((w) => Math.abs(w - weights[0]) > 1e-9)) return null;
  const eq = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  for (let k = 0; k < 4; k++) if (!eq(knots[k], knots[0]) || !eq(knots[knots.length - 1 - k], knots[knots.length - 1])) return null;
  for (let s = 1; s < n; s++) {
    const i = 1 + 3 * s;
    if (!eq(knots[i], knots[i + 1]) || !eq(knots[i + 1], knots[i + 2]) || !(knots[i] > knots[i - 1])) return null;
  }
  const first = ctrl[0],
    last = ctrl[ctrl.length - 1];
  const closed = Math.hypot(first.x - last.x, first.y - last.y) < 1e-6;
  const nodes: Node[] = [{ x: first.x, y: first.y }];
  for (let s = 0; s < n; s++) {
    const c1 = ctrl[3 * s + 1],
      c2 = ctrl[3 * s + 2],
      p = ctrl[3 * s + 3];
    const a = nodes[nodes.length - 1];
    const line = (q: Pt) => {
      // Anfasser genau auf der Sehne: Gerade
      const dx = p.x - a.x,
        dy = p.y - a.y,
        L = Math.hypot(dx, dy);
      return L > 0 && Math.abs((q.x - a.x) * dy - (q.y - a.y) * dx) / L < 1e-7;
    };
    const straight = line(c1) && line(c2);
    if (!straight) a.cout = { x: c1.x, y: c1.y };
    nodes.push(straight ? { x: p.x, y: p.y } : { x: p.x, y: p.y, cin: { x: c2.x, y: c2.y } });
  }
  if (closed) {
    const end = nodes.pop()!;
    if (end.cin) nodes[0].cin = end.cin;
  }
  return { nodes, closed };
}

/** NURBS-Kurve mit de Boor auswerten (oder Stützpunkte verwenden) */
function splinePoints(e: DxfEnt): Pt[] {
  const deg = parseInt(e.g.find(([c]) => c === 71)?.[1] ?? '3', 10);
  const knots: number[] = [],
    ctrl: Pt[] = [],
    weights: number[] = [],
    fit: Pt[] = [];
  for (const [c, v] of e.g) {
    const f = parseFloat(v);
    if (c === 40) knots.push(f);
    else if (c === 10) ctrl.push({ x: f, y: 0 });
    else if (c === 20 && ctrl.length) ctrl[ctrl.length - 1].y = f;
    else if (c === 41) weights.push(f);
    else if (c === 11) fit.push({ x: f, y: 0 });
    else if (c === 21 && fit.length) fit[fit.length - 1].y = f;
  }
  if (ctrl.length <= deg || knots.length !== ctrl.length + deg + 1) return fit;
  const w = weights.length === ctrl.length ? weights : ctrl.map(() => 1);
  const lo = knots[deg],
    hi = knots[knots.length - 1 - deg];
  const steps = Math.max(32, ctrl.length * 16);
  const out: Pt[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = Math.min(hi - 1e-12, lo + ((hi - lo) * s) / steps);
    let k = deg;
    while (k < knots.length - deg - 2 && t >= knots[k + 1]) k++;
    const d = [];
    for (let j = 0; j <= deg; j++) {
      const p = ctrl[k - deg + j],
        ww = w[k - deg + j];
      d.push({ x: p.x * ww, y: p.y * ww, w: ww });
    }
    for (let r = 1; r <= deg; r++)
      for (let j = deg; j >= r; j--) {
        const i0 = k - deg + j;
        const den = knots[i0 + deg - r + 1] - knots[i0];
        const a = den ? (t - knots[i0]) / den : 0;
        d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y, w: (1 - a) * d[j - 1].w + a * d[j].w };
      }
    out.push({ x: d[deg].x / d[deg].w, y: d[deg].y / d[deg].w });
  }
  return out;
}

/** Offene Linienzüge gleicher Farbe zusammenfügen, deren Enden sich berühren (CAD-Dateien bestehen oft aus Einzellinien) */
export function joinPaths(items: ImportedPath[], tol = 0.005): ImportedPath[] {
  const out: ImportedPath[] = [];
  const byLayer = new Map<number, SubPath[]>();
  for (const it of items) {
    const closed = it.subs.filter((s) => s.closed);
    if (closed.length) out.push({ kind: 'path', subs: closed, layer: it.layer });
    for (const s of it.subs) if (!s.closed && s.nodes.length > 1) (byLayer.get(it.layer) ?? byLayer.set(it.layer, []).get(it.layer)!).push(s);
  }
  const key = (p: Pt) => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const rev = (s: SubPath): SubPath => ({
    closed: s.closed,
    nodes: s.nodes.slice().reverse().map((n) => ({ x: n.x, y: n.y, cin: n.cout, cout: n.cin, smooth: n.smooth })),
  });
  for (const [layer, subs] of byLayer) {
    const ends = new Map<string, Set<number>>();
    const add = (k: string, i: number) => (ends.get(k) ?? ends.set(k, new Set()).get(k)!).add(i);
    subs.forEach((s, i) => {
      add(key(s.nodes[0]), i);
      add(key(s.nodes[s.nodes.length - 1]), i);
    });
    const used = new Uint8Array(subs.length);
    const take = (k: string, not: number): number => {
      for (const j of ends.get(k) ?? []) if (!used[j] && j !== not) return j;
      return -1;
    };
    for (let i = 0; i < subs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      let cur: SubPath = { closed: false, nodes: subs[i].nodes.map((n) => ({ ...n })) };
      // in beide Richtungen verlängern
      for (let pass = 0; pass < 2; pass++) {
        for (;;) {
          const endP = cur.nodes[cur.nodes.length - 1];
          const j = take(key(endP), i);
          if (j < 0) break;
          used[j] = 1;
          let nx = subs[j];
          if (key(nx.nodes[0]) !== key(endP)) nx = rev(nx);
          const last = cur.nodes[cur.nodes.length - 1];
          last.cout = nx.nodes[0].cout;
          cur.nodes.push(...nx.nodes.slice(1).map((n) => ({ ...n })));
        }
        cur = rev(cur);
      }
      const a = cur.nodes[0],
        b = cur.nodes[cur.nodes.length - 1];
      if (cur.nodes.length > 2 && key(a) === key(b)) {
        a.cin = b.cin;
        cur.nodes.pop();
        cur.closed = true;
      }
      out.push({ kind: 'path', subs: [cur], layer });
    }
  }
  return out;
}
