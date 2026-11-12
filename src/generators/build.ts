// Werkzeuge zum Aufbau von Generator-Konturen: glatte Kurven als kubische Béziers einpassen, Kreisbögen, Linien.
import { IDENT, type Node, type Pt, type SubPath } from '../model';
import { bezierPt } from '../curves';
import { flattenSub, SCALE } from '../clip';
import { autoCell, nest, type Poly } from '../nest';

/**
 * Glatte Parameterkurve f(t), t von t0 bis t1, als Folge kubischer Béziers (Hermite-Interpolation mit
 * numerischer Ableitung, Halbierung bis die Abweichung unter tol liegt).
 */
export function fitCurve(f: (t: number) => Pt, t0: number, t1: number, tol: number): [Pt, Pt, Pt][] {
  const span = Math.abs(t1 - t0) || 1;
  const d = (t: number): Pt => {
    const h = span * 1e-5;
    const a = f(t - h),
      b = f(t + h);
    return { x: (b.x - a.x) / (2 * h), y: (b.y - a.y) / (2 * h) };
  };
  const out: [Pt, Pt, Pt][] = [];
  const rec = (a: number, b: number, depth: number) => {
    const pa = f(a),
      pb = f(b);
    const k = (b - a) / 3;
    const da = d(a),
      db = d(b);
    const c1 = { x: pa.x + da.x * k, y: pa.y + da.y * k };
    const c2 = { x: pb.x - db.x * k, y: pb.y - db.y * k };
    let err = 0;
    for (let i = 1; i < 8; i++) {
      const u = i / 8;
      const q = bezierPt(pa, c1, c2, pb, u),
        p = f(a + (b - a) * u);
      err = Math.max(err, Math.hypot(q.x - p.x, q.y - p.y));
    }
    if (err > tol && depth < 12) {
      const m = (a + b) / 2;
      rec(a, m, depth + 1);
      rec(m, b, depth + 1);
    } else out.push([c1, c2, pb]);
  };
  rec(t0, t1, 0);
  return out;
}

/** Baut einen geschlossenen Unterpfad Stück für Stück auf */
export class PathBuilder {
  nodes: Node[] = [];
  private get last(): Node {
    return this.nodes[this.nodes.length - 1];
  }
  private same(p: Pt) {
    const l = this.last;
    return !!l && Math.hypot(l.x - p.x, l.y - p.y) < 1e-7;
  }
  /** Gerade bis p (bzw. erster Punkt) */
  line(p: Pt) {
    if (!this.same(p)) this.nodes.push({ x: p.x, y: p.y });
  }
  cubic(c1: Pt, c2: Pt, p: Pt) {
    if (!this.nodes.length) throw new Error('PathBuilder: kein Anfangspunkt');
    this.last.cout = { x: c1.x, y: c1.y };
    this.nodes.push({ x: p.x, y: p.y, cin: { x: c2.x, y: c2.y } });
  }
  /** Parameterkurve anhängen; der Anfangspunkt wird bei Bedarf mit einer Geraden erreicht */
  curve(f: (t: number) => Pt, t0: number, t1: number, tol: number) {
    if (Math.abs(t1 - t0) < 1e-12) return;
    this.line(f(t0));
    for (const [c1, c2, p] of fitCurve(f, t0, t1, tol)) this.cubic(c1, c2, p);
  }
  /** Kreisbogen um (cx, cy) mit Radius r von Winkel a0 nach a1 (Bogenmaß, mathematisch positiv, y nach oben) */
  arc(cx: number, cy: number, r: number, a0: number, a1: number) {
    const at = (a: number): Pt => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    this.line(at(a0));
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
    const da = (a1 - a0) / n;
    const k = (4 / 3) * Math.tan(da / 4) * r;
    for (let i = 0; i < n; i++) {
      const s = a0 + i * da,
        e = s + da;
      const ps = at(s),
        pe = at(e);
      this.cubic(
        { x: ps.x - k * Math.sin(s), y: ps.y + k * Math.cos(s) },
        { x: pe.x + k * Math.sin(e), y: pe.y - k * Math.cos(e) },
        pe,
      );
    }
  }
  /** Schließen: fällt der letzte Knoten auf den ersten, werden beide zusammengelegt */
  close(): SubPath {
    const ns = this.nodes;
    if (ns.length > 1) {
      const a = ns[0],
        b = ns[ns.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) {
        if (b.cin) a.cin = b.cin;
        ns.pop();
      }
    }
    return { nodes: ns, closed: true };
  }
}

/** Unterpfad mit y-Achse nach unten (intern) aus mathematischen Koordinaten (y nach oben) */
export function flipY(sp: SubPath): SubPath {
  const f = (p: Pt) => ({ x: p.x, y: -p.y });
  return {
    closed: sp.closed,
    nodes: sp.nodes.map((n) => ({ ...f(n), ...(n.cin ? { cin: f(n.cin) } : {}), ...(n.cout ? { cout: f(n.cout) } : {}) })),
  };
}

/** Ausdehnung von Unterpfaden (Knoten und Anfasser; bei Kreisbögen bis 90° liegen die Anfasser innerhalb) */
export function subsBounds(subs: SubPath[]) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const sp of subs)
    for (const n of sp.nodes) {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x);
      y1 = Math.max(y1, n.y);
    }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Rechteckigen Umriss (Punkte, y nach unten) als geschlossenen Unterpfad aus Geraden */
export const polySub = (pts: Pt[]): SubPath => ({ closed: true, nodes: pts.map((q) => ({ x: q.x, y: q.y })) });

/**
 * Teile zum Ausschneiden in Reihen nebeneinanderlegen (größte zuerst), ungefähr quadratisch.
 * Die Konturen liegen um ihre Mitte; das Ergebnis ist die Lage jeder Teilmitte, die ganze Anordnung um den Ursprung.
 */
export function packParts(items: { key: string; subs: SubPath[] }[], gap: number): { key: string; subs: SubPath[]; at: Pt }[] {
  const boxes = items.map((it) => ({ ...it, b: subsBounds(it.subs) }));
  const area = boxes.reduce((s, x) => s + (x.b.w + gap) * (x.b.h + gap), 0);
  const limit = Math.max(Math.sqrt(area) * 1.3, ...boxes.map((x) => x.b.w));
  const order = [...boxes].sort((a, b) => b.b.h - a.b.h || b.b.w - a.b.w);
  const placed: { key: string; subs: SubPath[]; at: Pt }[] = [];
  let x = 0,
    y = 0,
    rowH = 0,
    maxW = 0;
  for (const it of order) {
    if (x > 0 && x + it.b.w > limit) {
      y += rowH + gap;
      x = 0;
      rowH = 0;
    }
    placed.push({ key: it.key, subs: it.subs, at: { x: x - it.b.x0, y: y - it.b.y0 } });
    x += it.b.w + gap;
    rowH = Math.max(rowH, it.b.h);
    maxW = Math.max(maxW, x - gap);
  }
  const H = y + rowH;
  // Reihenfolge wie übergeben, Mitte der Anordnung im Ursprung
  const byKey = new Map(placed.map((p) => [p.key, p]));
  return items.map((it) => {
    const p = byKey.get(it.key)!;
    return { ...p, at: { x: p.at.x - maxW / 2, y: p.at.y - H / 2 } };
  });
}

/** Höchste Abweichung der vereinfachten Konturen beim Zusammenschieben in mm */
const SIMPLIFY = 0.1;

/** Geschlossenen Linienzug vereinfachen (Douglas-Peucker), Abweichung höchstens tol */
function simplifyRing(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 8) return pts;
  const keep = new Uint8Array(pts.length);
  // Start am Punkt, der am weitesten vom ersten entfernt ist: zwei Hälften des Rings
  let far = 0;
  for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y) > Math.hypot(pts[far].x - pts[0].x, pts[far].y - pts[0].y)) far = i;
  keep[0] = keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, pts.length]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const p = pts[a], q = pts[b % pts.length];
    const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
    let worst = -1, dist = tol;
    for (let i = a + 1; i < b; i++) {
      const d = len > 1e-12 ? Math.abs((pts[i].x - p.x) * dy - (pts[i].y - p.y) * dx) / len : Math.hypot(pts[i].x - p.x, pts[i].y - p.y);
      if (d > dist) { dist = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Kompakte, aufgeräumte Anordnung einer Baugruppe (ohne Drehung). Kandidaten:
 * - Spalten (columnLayout): gleiche Teile als Reihe in Spaltenbreite oder als Stapel, Blöcke in Spalten;
 * - Verschachteln mit echten Konturen (nestLayout), gleiche Teile als Block bzw. einzeln.
 * Genommen wird die bessere aufgeräumte Anordnung (Spalten oder Blöcke); einzeln verschachtelt nur, wenn es deutlich
 * kleiner ist, packParts ebenso. Alles ohne Zufall und Zeitgrenze: Gleiche Teile ergeben immer dieselbe Anordnung,
 * damit eine gespeicherte Baugruppe beim Bearbeiten als vom Generator angeordnet erkannt wird.
 */
export function nestParts(items: { key: string; subs: SubPath[] }[], gap: number): { key: string; subs: SubPath[]; at: Pt }[] {
  if (items.length < 2) return packParts(items, gap);
  const tidy = [columnLayout(items, gap), nestLayout(items, gap, true)].filter((x): x is { at: Pt[]; score: number } => !!x);
  const grouped = tidy.length ? tidy.reduce((a, b) => (b.score < a.score - 1e-6 ? b : a)) : null;
  const single = nestLayout(items, gap, false);
  // Aufgeräumt (gleiche Teile zusammen) bevorzugt, außer einzeln verschachtelt ist deutlich kleiner
  const best = !grouped || (single && single.score < grouped.score / GROUP_BONUS) ? single : grouped;
  const packed = packParts(items, gap);
  if (!best) return packed;
  const pb = subsBoundsAt(packed);
  if (layoutScore(pb.w, pb.h) < best.score / 1.05) return packed;
  return items.map((it, i) => ({ key: it.key, subs: it.subs, at: best.at[i] }));
}

/** So viel größer darf die aufgeräumte Anordnung (gleiche Teile als Block) sein */
const GROUP_BONUS = 1.1;

/** Fläche des umschließenden Rechtecks, ein Seitenverhältnis über 1 zählt mit einem Viertel dazu */
const layoutScore = (w: number, h: number) => w * h * (1 + 0.25 * (Math.max(w, h) / Math.max(1e-9, Math.min(w, h)) - 1));

/** Gleiche Konturen (auf 1/1000 mm) haben denselben Schlüssel */
const shapeKey = (subs: SubPath[]) =>
  JSON.stringify(subs.map((sp) => [sp.closed, sp.nodes.map((n) => [n.x, n.y, n.cin?.x, n.cin?.y, n.cout?.x, n.cout?.y].map((v) => (v === undefined ? null : Math.round(v * 1000))))]));

/** Indizes gleicher Teile, in der übergebenen Reihenfolge */
function sameParts(items: { subs: SubPath[] }[]): number[][] {
  const groups = new Map<string, number[]>();
  items.forEach((it, i) => {
    const k = shapeKey(it.subs);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  return [...groups.values()];
}

/**
 * Anordnung in Spalten (umschließende Rechtecke, Mitte im Ursprung) samt Bewertung. Spaltenbreite = breitestes Teil.
 * Jede Gruppe gleicher Teile liegt entweder in Reihen, die die Spaltenbreite füllen, oder als ein Stapel; probiert
 * werden alle Kombinationen (höchstens 6 Gruppen frei wählbar) und viele Spaltenhöhen. Die Blöcke kommen, breiteste
 * zuerst, in die erste Spalte, in die sie passen, und werden von unten gestapelt.
 */
export function columnLayout(items: { key: string; subs: SubPath[] }[], gap: number): { at: Pt[]; score: number } | null {
  const boxes = items.map((it) => subsBounds(it.subs));
  if (!boxes.every((b) => isFinite(b.w) && isFinite(b.h))) return null;
  const groups = sameParts(items);
  const colW = Math.max(...boxes.map((b) => b.w));
  const free = groups.map((m, g) => (m.length > 1 ? g : -1)).filter((g) => g >= 0).slice(0, 6);
  type Block = { members: number[]; w: number; h: number; pw: number; ph: number; stacked: boolean };
  let best: { at: Pt[]; score: number } | null = null;
  for (let mask = 0; mask < 1 << free.length; mask++) {
    const blocks: Block[] = [];
    groups.forEach((members, g) => {
      const b = boxes[members[0]], k = free.indexOf(g);
      if (k >= 0 && mask & (1 << k)) {
        blocks.push({ members, w: b.w, h: members.length * (b.h + gap) - gap, pw: b.w, ph: b.h, stacked: true });
        return;
      }
      const per = Math.max(1, Math.floor((colW + gap) / (b.w + gap)));
      for (let i = 0; i < members.length; i += per) {
        const row = members.slice(i, i + per);
        blocks.push({ members: row, w: row.length * (b.w + gap) - gap, h: b.h, pw: b.w, ph: b.h, stacked: false });
      }
    });
    const order = blocks.map((_, i) => i).sort((a, b) => blocks[b].w - blocks[a].w || blocks[b].h - blocks[a].h || a - b);
    const total = blocks.reduce((s, b) => s + (b.w + gap) * (b.h + gap), 0);
    const tallest = Math.max(...blocks.map((b) => b.h));
    const heights = [tallest];
    for (let f = 5; f <= 25; f++) heights.push(Math.max(tallest, (Math.sqrt(total) * f) / 10));
    for (const H of heights) {
      const cols: { w: number; used: number }[] = [];
      const place: { col: number; y: number }[] = [];
      for (const bi of order) {
        const b = blocks[bi];
        let col = cols.findIndex((c) => b.w <= c.w + 1e-9 && c.used + gap + b.h <= H + 1e-9);
        if (col < 0) {
          cols.push({ w: b.w, used: -gap });
          col = cols.length - 1;
        }
        place[bi] = { col, y: cols[col].used + gap };
        cols[col].used += gap + b.h;
      }
      const xs: number[] = [];
      let x = 0;
      for (const c of cols) {
        xs.push(x);
        x += c.w + gap;
      }
      const W = x - gap, Hh = Math.max(...cols.map((c) => c.used));
      const score = layoutScore(W, Hh);
      if (best && score >= best.score - 1e-6) continue;
      const at: Pt[] = [];
      blocks.forEach((b, bi) => {
        const p = place[bi];
        b.members.forEach((m, j) => {
          const bb = boxes[m];
          // y nach unten: Spalten von unten (Hh) nach oben füllen
          at[m] = {
            x: xs[p.col] + (b.stacked ? 0 : j * (b.pw + gap)) - bb.x0 - W / 2,
            y: Hh - p.y - (b.stacked ? j * (b.ph + gap) : 0) - b.ph - bb.y0 - Hh / 2,
          };
        });
      });
      best = { at, score };
    }
  }
  return best;
}

/** Verschachtelte Anordnung (Mitte im Ursprung) samt Bewertung; group: gleiche Teile vorher als Block */
export function nestLayout(items: { key: string; subs: SubPath[] }[], gap: number, group: boolean): { at: Pt[]; score: number } | null {
  const boxes = items.map((it) => subsBounds(it.subs));
  // Vereinfachte Konturen (Abweichung höchstens SIMPLIFY); der Abstand wächst um das Doppelte, bleibt also sicher
  const regions: Poly[][] = items.map((it) =>
    it.subs.filter((sp) => sp.closed).map((sp) => simplifyRing(flattenSub(sp, IDENT).map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })), SIMPLIFY)),
  );
  // Gleiche Konturen zu Blöcken: ungefähr quadratisches Raster, Abstand gap, Teile in der übergebenen Reihenfolge
  const groups = group ? sameParts(items) : items.map((_, i) => [i]);
  const blocks = groups.map((members) => {
    const b = boxes[members[0]], n = members.length;
    const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * (b.h + gap)) / (b.w + gap)))));
    const off = members.map((_, j) => ({ x: (j % cols) * (b.w + gap) - b.x0, y: Math.floor(j / cols) * (b.h + gap) - b.y0 }));
    const region = members.flatMap((m, j) => regions[m].map((poly) => poly.map((q) => ({ x: q.x + off[j].x, y: q.y + off[j].y }))));
    return { members, off, region, w: cols * (b.w + gap) - gap, h: Math.ceil(n / cols) * (b.h + gap) - gap };
  });
  const nestGap = gap + 2 * SIMPLIFY;
  const area = blocks.reduce((s, b) => s + (b.w + gap) * (b.h + gap), 0);
  const widest = Math.max(...blocks.map((b) => b.w)) + gap;
  const tallest = Math.max(...blocks.map((b) => b.h)) + gap;
  const stacked = blocks.reduce((s, b) => s + b.h + gap, 0);
  let best: { at: Pt[]; score: number } | null = null;
  for (const f of [0.8, 1, 1.3, 1.7, 2.2]) {
    const w = Math.max(widest, Math.sqrt(area) * f) + 2 * gap;
    const h = Math.min(stacked, Math.max(tallest, (3 * area) / w)) + 2 * gap;
    const sheet = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    const r = nest(
      blocks.map((b, key) => ({ key, region: b.region })),
      { area: [sheet], obstacles: [] },
      { gap: nestGap, margin: 0, rotations: [0], flipX: false, flipY: true, cell: autoCell(w, h, 0.5, 3e5), newSheets: false, maxSheets: 1, timeLimit: 0 },
    );
    if (r.unplaced.length || r.placed.length !== blocks.length) continue;
    const at: Pt[] = [];
    for (const p of r.placed) blocks[p.key].members.forEach((m, j) => (at[m] = { x: p.m[4] + blocks[p.key].off[j].x, y: p.m[5] + blocks[p.key].off[j].y }));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    boxes.forEach((b, i) => {
      x0 = Math.min(x0, b.x0 + at[i].x); x1 = Math.max(x1, b.x1 + at[i].x);
      y0 = Math.min(y0, b.y0 + at[i].y); y1 = Math.max(y1, b.y1 + at[i].y);
    });
    const cand = { at: at.map((q) => ({ x: q.x - (x0 + x1) / 2, y: q.y - (y0 + y1) / 2 })), score: layoutScore(x1 - x0, y1 - y0) };
    if (!best || cand.score < best.score - 1e-6) best = cand;
  }
  return best;
}

/** Umschließendes Rechteck angeordneter Teile */
function subsBoundsAt(parts: { subs: SubPath[]; at: Pt }[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) {
    const b = subsBounds(p.subs);
    x0 = Math.min(x0, b.x0 + p.at.x); x1 = Math.max(x1, b.x1 + p.at.x);
    y0 = Math.min(y0, b.y0 + p.at.y); y1 = Math.max(y1, b.y1 + p.at.y);
  }
  return { w: x1 - x0, h: y1 - y0 };
}

/** Teile ohne Lage anordnen: 'packed' = packParts (gespeicherte Objekte), sonst nestParts */
export function arrangeParts<T extends { key: string; subs: SubPath[] }>(items: T[], gap: number, layout: unknown): (T & { at: Pt })[] {
  const placed = layout === 'packed' ? packParts(items, gap) : nestParts(items, gap);
  return items.map((it, i) => ({ ...it, at: placed[i].at }));
}

/** Anordnung einer Baugruppe: 'rows' = wie vom Generator gelegt (gespeicherte Objekte), 'packed' = packParts, sonst nestParts */
export function layoutParts<T extends { key: string; subs: SubPath[]; at: Pt }>(parts: T[], gap: number, layout: unknown): T[] {
  if (layout === 'rows') return parts;
  const placed = layout === 'packed' ? packParts(parts, gap) : nestParts(parts, gap);
  return parts.map((p, i) => ({ ...p, at: placed[i].at }));
}
