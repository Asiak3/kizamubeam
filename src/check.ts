// Konstruktion prüfen: Fertigungsprüfung der aktuellen Seite vor dem Lasern. Findet doppelte Schnittlinien,
// ungewollt offene oder nicht verbundene Konturen, schmale Stege, zu kleine Innenausschnitte, Objekte außerhalb
// des Arbeitsbereichs und Import-Hinweise. Jeder Befund nennt die betroffenen Objekte, die Stellen zum Markieren
// (Weltkoordinaten) und, wo es geht, eine Korrektur. Ohne DOM, damit es auch in den Tests läuft.
import ClipperLib from 'clipper-lib';
import { apply, IDENT, isOff, Layer, Mat, mul, Obj, Pt, SubPath } from './model';
import { boundsOf, shapeSubs, textOutline } from './geom';
import { parkedObjs } from './parking';
import { bezierPt, segments } from './curves';
import { SCALE } from './clip';
import { copySub, extract, joinSubs } from './pathtools';
import { dec, t, tn } from './i18n';
import { checkFits, FitFinding } from './fitcheck';
import { AsmFinding, checkAssemblies } from './asmcheck';
import type { Params } from './generators/types';

export type CheckKind = 'double' | 'open' | 'unjoined' | 'web' | 'hole' | 'bed' | 'import' | 'fit' | 'thickness' | 'loose' | 'insert';
export type CheckLevel = 'error' | 'warn' | 'info';

/** Korrektur zu einem Befund; ausgeführt vom Editor (src/editor/check.ts) */
export type CheckFix =
  /** Doppelte Objekte löschen */
  | { kind: 'delete'; objs: Obj[] }
  /** Abschnitte (Pfadparameter je Unterpfad) aus Formen entfernen */
  | { kind: 'spans'; items: { leaf: Obj; sub: number; spans: [number, number][] }[] }
  /** Offene Pfade dieser Objekte mit einer Geraden schließen */
  | { kind: 'close'; objs: Obj[]; tol: number }
  /** Offene Pfade dieser Objekte verbinden (Auto-Join) */
  | { kind: 'join'; objs: Obj[]; tol: number }
  /** Auf das Bett schieben */
  | { kind: 'bed'; objs: Obj[]; dx: number; dy: number }
  /** Import-Hinweis ausblenden */
  | { kind: 'note'; objs: Obj[] }
  /** Parameter eines Generator-Bauteils ändern (Passung, Materialdicke); die Baugruppe wird neu berechnet */
  | { kind: 'gen'; obj: Obj; patch: Partial<Params>; calibrated: boolean };

export interface CheckIssue {
  /** Bleibt bei erneutem Prüfen gleich (zum Ausblenden einzelner Befunde) */
  key: string;
  kind: CheckKind;
  level: CheckLevel;
  msg: string;
  /** Betroffene Objekte der obersten Ebene */
  objs: Obj[];
  /** Stellen zum Hervorheben (Linienzüge in Weltkoordinaten) */
  lines: Pt[][];
  /** Punkte zum Einkreisen */
  pts: Pt[];
  fix?: CheckFix;
}

export interface CheckSettings {
  /** Schmalster Steg, der noch als stabil gilt (mm) */
  minWeb: number;
  /** Schnittbreite des Lasers (mm), wenn der Layer keinen Kerf-Versatz hat */
  beam: number;
  /** Abstand, unter dem Linien als deckungsgleich und Enden als verbunden gelten (mm) */
  tol: number;
  /** Offene Umrisse, deren Enden höchstens so weit auseinanderliegen, gelten als ungewollt offen (mm) */
  closeGap: number;
  /** Layer, die nur gravieren (Linie mit wenig Leistung): zählen nicht als Schnitte für Stege und Ausschnitte */
  engraveLayers: number[];
  /** Vor dem Lasern prüfen und bei Problemen nachfragen */
  beforeLaser: boolean;
}

export const DEFAULT_CHECK: CheckSettings = { minWeb: 1, beam: 0.15, tol: 0.05, closeGap: 1, engraveLayers: [], beforeLaser: true };

const KEY = 'kizamubeam.check';

export function loadCheckSettings(): CheckSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULT_CHECK, ...raw, engraveLayers: Array.isArray(raw.engraveLayers) ? raw.engraveLayers : [] };
  } catch {
    return { ...DEFAULT_CHECK };
  }
}

export function saveCheckSettings(s: CheckSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ohne Speicher gelten die Einstellungen nur bis zum Neustart
  }
}

/** Beschriftung des Korrektur-Knopfs */
export function fixLabel(f: CheckFix): string {
  switch (f.kind) {
    case 'delete':
      return tn('Doppeltes Objekt löschen', 'Doppelte Objekte löschen', f.objs.length);
    case 'spans':
      return t('Doppelte Linien entfernen');
    case 'close':
      return t('Schließen|Pfad');
    case 'join':
      return t('Verbinden|Pfade');
    case 'bed':
      return t('Aufs Bett schieben');
    case 'note':
      return t('Hinweis ausblenden');
    case 'gen':
      return f.calibrated ? t('Kalibrierte Werte übernehmen') : 'thickness' in f.patch && Object.keys(f.patch).length === 1 ? t('Materialdicke übernehmen') : t('Spiel anpassen');
  }
}

// ---------- Konturen ----------

interface Contour {
  idx: number;
  top: Obj;
  leaf: Obj;
  /** Index in shapeSubs(leaf.shape) bzw. in den Textkonturen */
  sub: number;
  closed: boolean;
  layer: number;
  fill: boolean;
  /** Zählt als Schnitt (Linie, nicht als Gravur-Layer markiert) */
  cut: boolean;
  /** Kerf-Versatz und Schnittbreite des Layers */
  kerf: number;
  beam: number;
  text: boolean;
  /** Linienzug in Weltkoordinaten (geschlossen: letzter Punkt = erster) und Pfadparameter je Punkt */
  pts: Pt[];
  us: number[];
  /** Bogenlänge bis zu jedem Punkt */
  cum: number[];
  len: number;
  box: { x0: number; y0: number; x1: number; y1: number };
}

/** Kurven zerlegen, so fein, dass deckungsgleiche Linien und Stege sicher erkannt werden */
const FLAT_TOL = 0.005;

function flattenU(sp: SubPath, m: Mat): { pts: Pt[]; us: number[] } {
  const pts: Pt[] = [],
    us: number[] = [];
  if (!sp.nodes.length) return { pts, us };
  pts.push(apply(m, sp.nodes[0].x, sp.nodes[0].y));
  us.push(0);
  segments(sp).forEach((s, k) => {
    if (!s.curve) {
      pts.push(apply(m, s.b.x, s.b.y));
      us.push(k + 1);
      return;
    }
    const w = [s.a, s.c1, s.c2, s.b].map((p) => apply(m, p.x, p.y));
    const len = Math.hypot(w[1].x - w[0].x, w[1].y - w[0].y) + Math.hypot(w[2].x - w[1].x, w[2].y - w[1].y) + Math.hypot(w[3].x - w[2].x, w[3].y - w[2].y);
    const n = Math.max(4, Math.min(1024, Math.max(Math.ceil(Math.sqrt(len / FLAT_TOL) * 0.6), Math.ceil(len / 0.5))));
    for (let i = 1; i <= n; i++) {
      const p = bezierPt(s.a, s.c1, s.c2, s.b, i / n);
      pts.push(apply(m, p.x, p.y));
      us.push(k + i / n);
    }
  });
  return { pts, us };
}

/** Pfadparameter an der Bogenlänge a */
function uAt(c: Contour, a: number): number {
  if (a <= 0) return 0;
  if (a >= c.len) return c.us[c.us.length - 1];
  let lo = 0,
    hi = c.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c.cum[mid] <= a) lo = mid;
    else hi = mid;
  }
  const seg = c.cum[hi] - c.cum[lo];
  const f = seg > 0 ? (a - c.cum[lo]) / seg : 0;
  return c.us[lo] + (c.us[hi] - c.us[lo]) * f;
}

/** Punkt an der Bogenlänge a */
function ptAt(c: Contour, a: number): Pt {
  a = Math.max(0, Math.min(c.len, a));
  let lo = 0,
    hi = c.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c.cum[mid] <= a) lo = mid;
    else hi = mid;
  }
  const seg = c.cum[hi] - c.cum[lo];
  const f = seg > 0 ? (a - c.cum[lo]) / seg : 0;
  const p = c.pts[lo],
    q = c.pts[hi];
  return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
}

/** Teil des Linienzugs zwischen den Bogenlängen a0 und a1 (bei geschlossenen auch über den Anfang) */
function polyPart(c: Contour, a0: number, a1: number): Pt[] {
  if (c.closed && a1 < a0) return [...polyPart(c, a0, c.len), ...polyPart(c, 0, a1).slice(1)];
  const out = [ptAt(c, a0)];
  for (let i = 0; i < c.pts.length; i++) if (c.cum[i] > a0 && c.cum[i] < a1) out.push(c.pts[i]);
  out.push(ptAt(c, a1));
  return out;
}

export interface CheckInput {
  objs: Obj[];
  layer: (i: number) => Layer;
  bed: { w: number; h: number };
  settings: CheckSettings;
  /** Lage auf dem Bett nicht prüfen (Start ab Benutzer-Ursprung oder aktueller Position, Drehachse) */
  skipBed?: boolean;
  /** Objekte aller Seiten (Baugruppen, deren Teile nach dem Verschachteln verteilt liegen); sonst nur objs */
  allObjs?: Obj[];
}

function collect(inp: CheckInput): Contour[] {
  const out: Contour[] = [];
  const engrave = new Set(inp.settings.engraveLayers);
  const walk = (top: Obj, o: Obj, parent: Mat) => {
    if (isOff(o) || o.noLaser) return;
    const m = mul(parent, o.m);
    if (o.shape.kind === 'group') {
      for (const c of o.shape.children) walk(top, c, m);
      return;
    }
    if (o.shape.kind === 'image') return;
    const L = inp.layer(o.layer);
    if (!L.output) return;
    const text = o.shape.kind === 'text';
    const subs = o.shape.kind === 'text' ? (textOutline(o.shape)?.subs ?? []) : shapeSubs(o.shape);
    const fill = L.mode === 'fill';
    // Beschriftung eines Generator-Teils (z. B. Schichtnummer) wird nur geritzt, nie ausgeschnitten
    const mark = o.shape.kind === 'path' && !!o.shape.mark;
    subs.forEach((sp, si) => {
      if (sp.nodes.length < 2) return;
      const { pts, us } = flattenU(sp, m);
      if (sp.closed) {
        pts.push(pts[0]);
        us.push(segments(sp).length);
      }
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      const len = cum[cum.length - 1];
      if (len < 1e-6) return;
      const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const p of pts) {
        box.x0 = Math.min(box.x0, p.x);
        box.y0 = Math.min(box.y0, p.y);
        box.x1 = Math.max(box.x1, p.x);
        box.y1 = Math.max(box.y1, p.y);
      }
      out.push({
        idx: out.length, top, leaf: o, sub: si, closed: sp.closed, layer: o.layer, fill, cut: !fill && !engrave.has(o.layer) && !mark,
        kerf: fill ? 0 : L.kerf, beam: L.kerf > 0 ? 2 * L.kerf : inp.settings.beam, text, pts, us, cum, len, box,
      });
    });
  };
  for (const o of inp.objs) walk(o, o, IDENT);
  return out;
}

// ---------- Raster für Nachbarschaftssuche ----------

class SegGrid {
  private map = new Map<number, number[]>();
  /** Segment k: Kontur und Index seines Anfangspunkts */
  private segC: Contour[] = [];
  private segI: number[] = [];
  constructor(
    cs: Contour[],
    private cell: number,
  ) {
    for (const c of cs)
      for (let i = 0; i + 1 < c.pts.length; i++) {
        const id = this.segC.length;
        this.segC.push(c);
        this.segI.push(i);
        const a = c.pts[i],
          b = c.pts[i + 1];
        this.addBox(id, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
      }
  }
  private k(gx: number, gy: number) {
    return gx * 73856093 + gy * 19349663;
  }
  private addBox(id: number, x0: number, y0: number, x1: number, y1: number) {
    const c = this.cell;
    for (let gx = Math.floor(x0 / c); gx <= Math.floor(x1 / c); gx++)
      for (let gy = Math.floor(y0 / c); gy <= Math.floor(y1 / c); gy++) {
        const key = this.k(gx, gy);
        const l = this.map.get(key);
        if (l) l.push(id);
        else this.map.set(key, [id]);
      }
  }
  /** Segmente, deren Zellen das Rechteck berühren (ohne Doppelte) */
  query(x0: number, y0: number, x1: number, y1: number): number[] {
    const c = this.cell;
    const out = new Set<number>();
    for (let gx = Math.floor(x0 / c); gx <= Math.floor(x1 / c); gx++)
      for (let gy = Math.floor(y0 / c); gy <= Math.floor(y1 / c); gy++) for (const id of this.map.get(this.k(gx, gy)) ?? []) out.add(id);
    return [...out];
  }
  seg(id: number): [Contour, Pt, Pt] {
    const c = this.segC[id],
      i = this.segI[id];
    return [c, c.pts[i], c.pts[i + 1]];
  }
}

interface Sample {
  a: Pt;
  /** Einheitstangente */
  d: Pt;
  /** Bogenlänge */
  at: number;
}

/** Abtastpunkte im Abstand step (Mitte der Abschnitte) */
function samples(c: Contour, step: number): Sample[] {
  const n = Math.max(1, Math.round(c.len / step));
  const st = c.len / n;
  const out: Sample[] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const at = (k + 0.5) * st;
    while (i + 2 < c.cum.length && c.cum[i + 1] < at) i++;
    const p = c.pts[i],
      q = c.pts[i + 1];
    const l = c.cum[i + 1] - c.cum[i] || 1e-12;
    const f = (at - c.cum[i]) / l;
    out.push({ a: { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f }, d: { x: (q.x - p.x) / l, y: (q.y - p.y) / l }, at });
  }
  return out;
}

function distSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const f = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - dx * f, p.y - a.y - dy * f);
}

/** Läufe aufeinanderfolgender markierter Abtastpunkte (bei geschlossenen Konturen auch über den Anfang) */
function runs(flags: boolean[], closed: boolean): [number, number][] {
  const n = flags.length;
  const out: [number, number][] = [];
  let i = 0;
  while (i < n) {
    if (!flags[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && flags[j + 1]) j++;
    out.push([i, j]);
    i = j + 1;
  }
  // Lauf über den Anfang zusammenfügen
  if (closed && out.length > 1 && out[0][0] === 0 && out[out.length - 1][1] === n - 1) {
    const last = out.pop()!;
    out[0] = [last[0], out[0][1] + n];
  }
  return out;
}

const fmt = (v: number) => dec(v < 10 ? v.toFixed(2) : v.toFixed(1));

/** Rahmen etwas außerhalb des Objekts, damit er neben dessen Umriss sichtbar bleibt */
function boxLine(r: { x: number; y: number; w: number; h: number }, pad = 1): Pt[] {
  const b = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
  return [
    { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }, { x: b.x, y: b.y },
  ];
}

// ---------- Prüfungen ----------

/** Höchstzahl Abtastpunkte je Prüfung: bei sehr langen Konturen wird der Abstand größer */
const MAX_SAMPLES = 200000;

function sampleStep(cs: Contour[], want: number): number {
  const total = cs.reduce((s, c) => s + c.len, 0);
  return Math.max(want, total / MAX_SAMPLES);
}

/** Doppelte Schnittlinien: Abschnitte, die eine andere Kontur (gleiche Richtung oder entgegen) überdecken */
function checkDouble(cs: Contour[], s: CheckSettings, out: CheckIssue[]) {
  const lines = cs.filter((c) => !c.fill);
  if (lines.length < 1) return;
  const step = sampleStep(lines, 0.25);
  const tol = s.tol;
  const grid = new SegGrid(lines, 2);
  // je Paar oberster Objekte sammeln
  interface Acc {
    top: Obj;
    other: Obj;
    len: number;
    lines: Pt[][];
    spans: Map<Obj, Map<number, [number, number][]>>;
    full: Set<Contour>;
    kerf: boolean;
    text: boolean;
  }
  const acc = new Map<string, Acc>();
  for (const c of lines) {
    const sm = samples(c, step);
    const st = c.len / sm.length;
    const hit: (Contour | null)[] = sm.map((p) => {
      let best: Contour | null = null;
      for (const id of grid.query(p.a.x - tol, p.a.y - tol, p.a.x + tol, p.a.y + tol)) {
        const [o, a, b] = grid.seg(id);
        // Nur gegen frühere Konturen: so wird jede doppelte Stelle einmal gemeldet und aus der späteren entfernt
        if (o.idx >= c.idx) continue;
        if (best && o.idx >= best.idx) continue;
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        if (l < 1e-9) continue;
        const cross = Math.abs(p.d.x * (b.y - a.y) - p.d.y * (b.x - a.x)) / l;
        if (cross > 0.2) continue;
        if (distSeg(p.a, a, b) > tol) continue;
        best = o;
      }
      return best;
    });
    const rs = runs(hit.map((h) => !!h), c.closed);
    const covered = hit.filter((h) => h).length;
    const full = covered >= sm.length * 0.98;
    for (const [i0, i1] of rs) {
      const len = (i1 - i0 + 1) * st;
      if (len < Math.max(0.5, 2 * st) && !full) continue;
      const other = hit[i0 % sm.length]!;
      const key = `${c.top.id}:${other.top.id}`;
      let A = acc.get(key);
      if (!A) acc.set(key, (A = { top: c.top, other: other.top, len: 0, lines: [], spans: new Map(), full: new Set(), kerf: false, text: false }));
      A.len += len;
      let a0 = sm[i0 % sm.length].at - st / 2,
        a1 = sm[i1 % sm.length].at + st / 2;
      // an die Enden offener Linien heranziehen
      if (!c.closed && a0 < st) a0 = 0;
      if (!c.closed && a1 > c.len - st) a1 = c.len;
      if (full) {
        A.lines.push(c.pts);
        A.full.add(c);
      } else A.lines.push(polyPart(c, a0, a1 % (c.closed ? c.len : Infinity)));
      if (c.kerf || other.kerf) A.kerf = true;
      if (c.text) A.text = true;
      let bySub = A.spans.get(c.leaf);
      if (!bySub) A.spans.set(c.leaf, (bySub = new Map()));
      const list = bySub.get(c.sub) ?? [];
      if (full) list.push([0, c.us[c.us.length - 1]]);
      else list.push([uAt(c, a0), uAt(c, a1 > c.len ? a1 - c.len : a1)]);
      bySub.set(c.sub, list);
    }
  }
  for (const A of acc.values()) {
    // Ganzes Objekt deckungsgleich mit einem anderen: das spätere löschen
    const own = lines.filter((c) => c.top === A.top);
    const whole = A.top !== A.other && own.every((c) => A.full.has(c));
    const issue: CheckIssue = {
      key: `double:${A.top.id}:${A.other.id}`,
      kind: 'double',
      level: 'warn',
      msg: whole
        ? t('Diese Kontur würde zweimal geschnitten (deckungsgleiches Objekt).')
        : t('{len} mm würden zweimal geschnitten (deckungsgleiche Linien).', { len: fmt(A.len) }),
      objs: A.top === A.other ? [A.top] : [A.top, A.other],
      lines: A.lines,
      pts: [],
    };
    if (whole) issue.fix = { kind: 'delete', objs: [A.top] };
    else if (!A.kerf && !A.text)
      issue.fix = { kind: 'spans', items: [...A.spans].flatMap(([leaf, bySub]) => [...bySub].map(([sub, spans]) => ({ leaf, sub, spans }))) };
    out.push(issue);
  }
}

/** Offene Umrisse: fast geschlossen, auf Füll-Layern oder aus Einzellinien, die zusammen einen Umriss ergeben */
function checkOpen(cs: Contour[], s: CheckSettings, out: CheckIssue[]) {
  const open = cs.filter((c) => !c.closed && !c.text);
  if (!open.length) return;
  // Einzellinien, die zusammen einen geschlossenen Umriss bilden
  const chained = new Set<Contour>();
  const subs = open.map((c) => ({ closed: false, nodes: c.pts.map((p) => ({ x: p.x, y: p.y })) }) as SubPath);
  const r = joinSubs(subs.map(copySub), s.tol);
  r.subs.forEach((sp, k) => {
    const from = r.origin[k];
    if (!sp.closed || from.length < 2) return;
    const parts = from.map((i) => open[i]);
    parts.forEach((c) => chained.add(c));
    const tops = [...new Set(parts.map((c) => c.top))];
    const issue: CheckIssue = {
      key: `unjoined:${parts.map((c) => `${c.leaf.id}.${c.sub}`).join(',')}`,
      kind: 'unjoined',
      level: 'warn',
      msg: tn(
        'Diese Linie bildet einen Umriss, ist aber nicht verbunden: Kerf und Füllen wirken nur auf geschlossene Formen.',
        'Diese {n} Linien bilden einen Umriss, sind aber nicht verbunden: Kerf und Füllen wirken nur auf geschlossene Formen.',
        parts.length,
      ),
      objs: tops,
      lines: parts.map((c) => c.pts),
      pts: [],
    };
    if (tops.every((o) => o.shape.kind === 'path')) issue.fix = { kind: 'join', objs: tops, tol: s.tol };
    out.push(issue);
  });
  for (const c of open) {
    if (chained.has(c)) continue;
    const a = c.pts[0],
      b = c.pts[c.pts.length - 1];
    const gap = Math.hypot(a.x - b.x, a.y - b.y);
    // Eine einzelne Gerade ist kein Umriss
    const closable = c.pts.length >= 3;
    const near = closable && gap <= s.closeGap;
    if (!near && !c.fill) continue;
    const issue: CheckIssue = {
      key: `open:${c.leaf.id}.${c.sub}`,
      kind: 'open',
      level: 'warn',
      msg: near
        ? t('Dieser Umriss ist nicht geschlossen (Lücke {gap} mm).', { gap: fmt(gap) })
        : t('Offene Linie auf einem Füll-Layer: Sie wird nicht gelasert.'),
      objs: [c.top],
      lines: [c.pts],
      pts: near ? [a, b] : [],
    };
    if (closable && c.top.shape.kind === 'path') issue.fix = { kind: 'close', objs: [c.top], tol: gap + 1e-3 };
    out.push(issue);
  }
}

/** Liegt p im Linienzug (Gerade-Ungerade)? */
function inside(p: Pt, pts: Pt[]): boolean {
  let inn = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i],
      b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inn = !inn;
  }
  return inn;
}

function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) s += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y;
  return s / 2;
}

/**
 * Schmale Stege und zu kleine Innenausschnitte. Grundlage sind die geschlossenen Schnittkonturen: Nach der
 * Gerade-Ungerade-Regel liegt Material innerhalb von Konturen mit gerader Schachtelungstiefe (Außenkonturen) und
 * außerhalb von solchen mit ungerader (Löcher). Von jeder Kontur aus wird senkrecht ins Material gemessen.
 */
function checkWebsAndHoles(cs: Contour[], s: CheckSettings, out: CheckIssue[]) {
  const cuts = cs.filter((c) => c.cut && c.closed && c.pts.length >= 4);
  if (!cuts.length) return;
  // Schachtelungstiefe
  const depth = cuts.map((c) => {
    const p = c.pts[0];
    let d = 0;
    for (const o of cuts) {
      if (o === c || p.x < o.box.x0 || p.x > o.box.x1 || p.y < o.box.y0 || p.y > o.box.y1) continue;
      // Gleiche Kontur doppelt (wird als doppelte Linie gemeldet): nicht als Schachtelung zählen
      if (Math.abs(o.box.x0 - c.box.x0) < s.tol && Math.abs(o.box.x1 - c.box.x1) < s.tol && Math.abs(o.box.y0 - c.box.y0) < s.tol && Math.abs(o.box.y1 - c.box.y1) < s.tol) continue;
      if (inside(p, o.pts)) d++;
    }
    return d;
  });
  const local = new Map<Contour, number>(cuts.map((c, i) => [c, i]));

  // Zu kleine Innenausschnitte
  cuts.forEach((c, i) => {
    if (depth[i] % 2 === 0) return;
    const path = c.pts.slice(0, -1).map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
    const survives = (r: number) => {
      const co = new ClipperLib.ClipperOffset();
      co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
      const res: ClipperLib.Paths = [];
      co.Execute(res, -r * SCALE);
      return res.length > 0;
    };
    const lost = c.kerf > 0 && !survives(c.kerf);
    const small = !lost && !survives(c.beam);
    if (!lost && !small) return;
    const cx = (c.box.x0 + c.box.x1) / 2,
      cy = (c.box.y0 + c.box.y1) / 2;
    out.push({
      key: `hole:${c.leaf.id}.${c.sub}`,
      kind: 'hole',
      level: lost ? 'error' : 'warn',
      msg: lost
        ? t('Der Kerf-Ausgleich ({k} mm) lässt diesen Ausschnitt verschwinden.', { k: fmt(c.kerf) })
        : t('Der Ausschnitt ist für die Schnittbreite ({b} mm) zu klein.', { b: fmt(c.beam) }),
      objs: [c.top],
      lines: [c.pts],
      pts: [{ x: cx, y: cy }],
    });
  });

  // Schmale Stege
  const step = sampleStep(cuts, 0.2);
  const grid = new SegGrid(cuts, 2);
  const maxBeam = Math.max(...cuts.map((c) => c.beam));
  const reach = s.minWeb + maxBeam + 0.1;
  interface Acc {
    a: Contour;
    b: Contour;
    w: number;
    lines: Pt[][];
  }
  const acc = new Map<string, Acc>();
  cuts.forEach((c, ci) => {
    const materialInside = depth[ci] % 2 === 0;
    const ccw = signedArea(c.pts) > 0;
    // Normale nach innen: bei positiver Fläche links der Laufrichtung
    const sign = (ccw ? 1 : -1) * (materialInside ? 1 : -1);
    const sm = samples(c, step);
    const st = c.len / sm.length;
    const hits = sm.map((p) => {
      const n = { x: -p.d.y * sign, y: p.d.x * sign };
      const e = { x: p.a.x + n.x * reach, y: p.a.y + n.y * reach };
      let best: { d: number; o: Contour; q: Pt } | null = null;
      for (const id of grid.query(Math.min(p.a.x, e.x), Math.min(p.a.y, e.y), Math.max(p.a.x, e.x), Math.max(p.a.y, e.y))) {
        const [o, a, b] = grid.seg(id);
        // Schnitt Strahl p + n·u mit Strecke a + (b - a)·v
        const bx = b.x - a.x,
          by = b.y - a.y;
        const den = n.x * by - n.y * bx;
        if (Math.abs(den) < 1e-12) continue;
        const wx = a.x - p.a.x,
          wy = a.y - p.a.y;
        const u = (wx * by - wy * bx) / den;
        const v = (wx * n.y - wy * n.x) / den;
        if (v < 0 || v > 1 || u <= s.tol || u > reach) continue;
        if (!best || u < best.d) best = { d: u, o, q: { x: p.a.x + n.x * u, y: p.a.y + n.y * u } };
      }
      if (!best) return null;
      // Verbleibender Steg: Abstand minus halbe Schnittbreite je Seite, plus Kerf-Ausgleich (schiebt beide Schnitte weg vom Material)
      const w = best.d - c.beam / 2 - best.o.beam / 2 + c.kerf + best.o.kerf;
      return w < s.minWeb ? { ...best, w, p: p.a } : null;
    });
    for (const [i0, i1] of runs(hits.map((h) => !!h), true)) {
      if ((i1 - i0 + 1) * st < 0.4 || i1 === i0) continue;
      const span = Array.from({ length: i1 - i0 + 1 }, (_, k) => hits[(i0 + k) % hits.length]!);
      const o = span[Math.floor(span.length / 2)].o;
      const [x, y] = [ci, local.get(o)!].sort((p, q) => p - q);
      const key = `${cuts[x].leaf.id}.${cuts[x].sub}:${cuts[y].leaf.id}.${cuts[y].sub}`;
      let A = acc.get(key);
      if (!A) acc.set(key, (A = { a: cuts[x], b: cuts[y], w: Infinity, lines: [] }));
      for (const [k, h] of span.entries()) {
        A.w = Math.min(A.w, h.w);
        // jede zweite Messung als Querstrich zeigen
        if (k % 2 === 0 || k === span.length - 1) A.lines.push([h.p, h.q]);
      }
    }
  });
  for (const A of acc.values()) {
    const tops = [...new Set([A.a.top, A.b.top])];
    out.push({
      key: `web:${[A.a, A.b].map((c) => `${c.leaf.id}.${c.sub}`).join(':')}`,
      kind: 'web',
      level: A.w <= 0 ? 'error' : 'warn',
      msg:
        A.w <= 0
          ? t('Die Schnitte berühren sich hier: Das Material wird durchtrennt.')
          : t('Steg nur {w} mm breit: Er könnte beim Schneiden brechen.', { w: fmt(A.w) }),
      objs: tops,
      lines: A.lines,
      pts: [],
    });
  }
}

/** Objekte ganz oder teilweise außerhalb des Arbeitsbereichs */
function checkBed(inp: CheckInput, cs: Contour[], out: CheckIssue[]) {
  const { w, h } = inp.bed;
  const tops = new Set(cs.map((c) => c.top));
  const eps = 1e-3;
  // Parts parked completely outside the work area are fine: they are not lasered
  const parked = parkedObjs(inp.objs, inp.bed, inp.layer);
  for (const o of inp.objs) {
    if (parked.has(o)) continue;
    if (!tops.has(o) && !(o.shape.kind === 'image' && !isOff(o) && !o.noLaser && inp.layer(o.layer).output)) continue;
    const b = boundsOf([o]);
    if (!b) continue;
    if (b.x >= -eps && b.y >= -eps && b.x + b.w <= w + eps && b.y + b.h <= h + eps) continue;
    const away = b.x > w || b.y > h || b.x + b.w < 0 || b.y + b.h < 0;
    const issue: CheckIssue = {
      key: `bed:${o.id}`,
      kind: 'bed',
      level: 'error',
      msg: away ? t('Liegt außerhalb des Arbeitsbereichs.') : t('Ragt über den Arbeitsbereich hinaus.'),
      objs: [o],
      lines: [boxLine(b)],
      pts: [],
    };
    if (b.w <= w && b.h <= h) {
      const dx = Math.min(Math.max(b.x, 0), w - b.w) - b.x,
        dy = Math.min(Math.max(b.y, 0), h - b.h) - b.y;
      issue.fix = { kind: 'bed', objs: [o], dx, dy };
    }
    out.push(issue);
  }
}

/** Beim Import übersprungene Elemente (Hinweis steht am importierten Objekt) */
function checkImport(inp: CheckInput, out: CheckIssue[]) {
  const by = new Map<string, Obj[]>();
  for (const o of inp.objs) if (o.importNote) (by.get(o.importNote) ?? by.set(o.importNote, []).get(o.importNote)!).push(o);
  for (const [note, objs] of by) {
    const b = boundsOf(objs);
    out.push({
      key: `import:${note}`,
      kind: 'import',
      level: 'info',
      msg: t('Einige Elemente der Quelldatei wurden nicht übernommen. {note}', { note }),
      objs,
      lines: b ? [boxLine(b)] : [],
      pts: [],
      fix: { kind: 'note', objs },
    });
  }
}

const ORDER: Record<CheckLevel, number> = { error: 0, warn: 1, info: 2 };

/** Alle Prüfungen für die Objekte einer Seite; Ergebnis nach Schwere sortiert */
export function checkDesign(inp: CheckInput): CheckIssue[] {
  const cs = collect(inp);
  const out: CheckIssue[] = [];
  if (!inp.skipBed) checkBed(inp, cs, out);
  checkDouble(cs, inp.settings, out);
  checkOpen(cs, inp.settings, out);
  checkWebsAndHoles(cs, inp.settings, out);
  checkImport(inp, out);
  const fits: FitFinding[] = [];
  checkFits(inp.objs, inp.layer, inp.settings.beam, fits);
  for (const f of fits)
    out.push({
      key: f.key, kind: f.kind, level: f.level, msg: f.msg, objs: f.objs, lines: f.lines, pts: [],
      fix: f.gen ? { kind: 'gen', obj: f.gen.obj, patch: f.gen.patch, calibrated: f.calibrated } : undefined,
    });
  const asm: AsmFinding[] = [];
  checkAssemblies(inp.objs, inp.allObjs ?? inp.objs, inp.layer, asm);
  for (const f of asm) out.push({ key: f.key, kind: f.kind, level: f.level, msg: f.msg, objs: f.objs, lines: f.lines, pts: [] });
  return out.map((x, i) => [x, i] as const).sort((a, b) => ORDER[a[0].level] - ORDER[b[0].level] || a[1] - b[1]).map(([x]) => x);
}

/**
 * Abschnitte [u0, u1] (Pfadparameter) aus einem Unterpfad entfernen; liefert die verbleibenden Stücke als offene
 * Unterpfade (Bézierkurven bleiben erhalten). Bei geschlossenen darf ein Abschnitt über den Anfang laufen (u1 < u0).
 */
export function removeSpans(sp: SubPath, spans: [number, number][]): SubPath[] {
  const n = segments(sp).length;
  if (!n || !spans.length) return [copySub(sp)];
  // Abschnitte über den Anfang aufteilen, sortieren und zusammenfassen
  const list: [number, number][] = [];
  for (const [a, b] of spans) {
    if (sp.closed && b < a) {
      list.push([a, n], [0, b]);
    } else list.push([Math.max(0, a), Math.min(n, b)]);
  }
  list.sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const s of list) {
    const l = merged[merged.length - 1];
    if (l && s[0] <= l[1] + 1e-9) l[1] = Math.max(l[1], s[1]);
    else merged.push([...s]);
  }
  const keep: [number, number][] = [];
  if (sp.closed) {
    if (merged.length === 1 && merged[0][0] <= 1e-9 && merged[0][1] >= n - 1e-9) return [];
    for (let i = 0; i < merged.length; i++) {
      const from = merged[i][1];
      const to = i + 1 < merged.length ? merged[i + 1][0] : merged[0][0] + n;
      if (to - from > 1e-6) keep.push([from, to > n ? to - n : to]);
    }
  } else {
    let at = 0;
    for (const [a, b] of merged) {
      if (a - at > 1e-6) keep.push([at, a]);
      at = b;
    }
    if (n - at > 1e-6) keep.push([at, n]);
  }
  return keep.map(([a, b]) => extract(sp, a, b)).filter((q) => q.nodes.length >= 2);
}
