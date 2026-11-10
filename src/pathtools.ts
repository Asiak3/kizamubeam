// Pfad-Werkzeuge wie in LightBurn: Pfade schließen, verbinden (Auto-Join), zerlegen (Break Apart),
// Startpunkt setzen und Richtung umkehren, Trimmen an Schnittpunkten. Alles bleibt Bézierkurve:
// Kurvenstücke werden mit de Casteljau exakt geteilt, nie in Polylinien zerlegt.
import { Node, Pt, SubPath } from './model';
import { bezierPt, segments } from './curves';

/** Ein Segment als kubische Kurve (Geraden: curve = false, Anfasser = Endpunkte) */
export interface Piece {
  a: Pt;
  c1: Pt;
  c2: Pt;
  b: Pt;
  curve: boolean;
}

/** Abstand, unter dem zwei Endpunkte als identisch gelten (mm) */
export const SAME_PT = 1e-3;
/** Close Path: Anfang und Ende müssen so nah beieinander liegen (wie LightBurn, mm) */
export const CLOSE_TOL = 0.5;
/** Auto-Join: Endpunkte in diesem Abstand werden verbunden (wie LightBurn, mm) */
export const JOIN_TOL = 0.05;

const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
const lerp = (p: Pt, q: Pt, t: number): Pt => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
const cp = (p?: Pt) => (p ? { x: p.x, y: p.y } : undefined);

function copyNode(n: Node): Node {
  const q: Node = { x: n.x, y: n.y };
  if (n.cin) q.cin = cp(n.cin);
  if (n.cout) q.cout = cp(n.cout);
  if (n.smooth) q.smooth = true;
  return q;
}

export function copySub(sp: SubPath): SubPath {
  const q: SubPath = { closed: sp.closed, nodes: sp.nodes.map(copyNode) };
  if (sp.start) q.start = true;
  return q;
}

/** Ein offener Unterpfad hat einen eigenen Anfang und ein Ende (mindestens ein Segment) */
const isOpen = (sp: SubPath) => !sp.closed && sp.nodes.length >= 2;

/** Taugt der Unterpfad zum Schließen (mehr als eine einzelne Gerade)? */
function closable(sp: SubPath) {
  return sp.nodes.length >= 3 || (sp.nodes.length === 2 && segments(sp).some((s) => s.curve));
}

// ---------- Richtung und Startpunkt ----------

/** Laufrichtung umkehren (Anfasser tauschen die Rollen) */
export function reverseSub(sp: SubPath) {
  sp.nodes.reverse();
  for (const n of sp.nodes) [n.cin, n.cout] = [n.cout, n.cin];
  for (const n of sp.nodes) {
    if (!n.cin) delete n.cin;
    if (!n.cout) delete n.cout;
  }
  // Geschlossen: der Startknoten bleibt vorn
  if (sp.closed && sp.nodes.length > 1) sp.nodes.unshift(sp.nodes.pop()!);
}

/**
 * Startpunkt auf Knoten idx legen. Geschlossene Pfade beginnen danach dort; offene können nur an einem
 * Ende beginnen (das hintere Ende kehrt die Richtung um). false = Knoten taugt nicht als Startpunkt.
 */
export function setStart(sp: SubPath, idx: number, reverse = false): boolean {
  const n = sp.nodes.length;
  if (idx < 0 || idx >= n) return false;
  if (sp.closed) {
    sp.nodes = sp.nodes.slice(idx).concat(sp.nodes.slice(0, idx));
    if (reverse) reverseSub(sp);
  } else {
    if (idx !== 0 && idx !== n - 1) return false;
    if (idx === n - 1) reverseSub(sp);
  }
  sp.start = true;
  return true;
}

/**
 * Insert a node at path parameter u (segment index + t), splitting the segment exactly (de Casteljau),
 * and return its index. If u lies within eps of an existing node, that node's index is returned instead.
 */
export function splitAt(sp: SubPath, u: number, eps = 1e-6): number {
  const segs = segments(sp);
  if (!segs.length) return -1;
  const k = Math.min(segs.length - 1, Math.max(0, Math.floor(u)));
  const t = Math.min(1, Math.max(0, u - k));
  const sg = segs[k];
  if (t <= eps) return sg.ia;
  if (t >= 1 - eps) return sg.ib;
  let n: Node;
  if (sg.curve) {
    const p01 = lerp(sg.a, sg.c1, t), p12 = lerp(sg.c1, sg.c2, t), p23 = lerp(sg.c2, sg.b, t);
    const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), p = lerp(p012, p123, t);
    sg.a.cout = p01;
    sg.b.cin = p23;
    n = { x: p.x, y: p.y, cin: p012, cout: p123, smooth: true };
  } else n = lerp(sg.a, sg.b, t);
  sp.nodes.splice(sg.ia + 1, 0, n);
  return sg.ia + 1;
}

// ---------- Schließen ----------

/** Letzten Knoten mit dem ersten verschmelzen (an der Stelle p) und den Pfad schließen */
function mergeEnds(sp: SubPath, p: Pt) {
  const first = sp.nodes[0],
    last = sp.nodes.pop()!;
  const move = (src: Pt, h?: Pt) => (h ? { x: h.x + p.x - src.x, y: h.y + p.y - src.y } : undefined);
  const cin = move(last, last.cin),
    cout = move(first, first.cout);
  first.x = p.x;
  first.y = p.y;
  if (cin) first.cin = cin;
  else delete first.cin;
  if (cout) first.cout = cout;
  first.smooth = false;
  sp.closed = true;
}

export interface CloseStats {
  /** offene Pfade in der Auswahl */
  open: number;
  /** davon geschlossen */
  closed: number;
}

/**
 * Offene Pfade schließen, deren Anfang und Ende höchstens tol auseinanderliegen.
 * mode 'line': mit einer Geraden verbinden (liegen sie aufeinander, werden sie verschmolzen); 'move': Enden zusammenziehen.
 * Mit apply = false wird nur gezählt (Vorschau im Dialog).
 */
export function closeSubs(subs: SubPath[], tol: number, mode: 'line' | 'move', apply = true): CloseStats {
  const st: CloseStats = { open: 0, closed: 0 };
  for (const sp of subs) {
    if (!isOpen(sp)) continue;
    st.open++;
    if (!closable(sp)) continue;
    const a = sp.nodes[0],
      b = sp.nodes[sp.nodes.length - 1];
    const d = dist(a, b);
    if (d > tol) continue;
    st.closed++;
    if (!apply) continue;
    if (d < SAME_PT) mergeEnds(sp, a);
    else if (mode === 'move') mergeEnds(sp, lerp(a, b, 0.5));
    else sp.closed = true;
  }
  return st;
}

// ---------- Verbinden (Auto-Join) ----------

/** Endpunkt: Unterpfad i, Ende e (0 = Anfang, 1 = Ende) */
type End = { i: number; e: 0 | 1; p: Pt };

/**
 * Offene Unterpfade verbinden, deren Enden höchstens tol auseinanderliegen (Auto-Join).
 * Ketten, deren Anfang und Ende sich treffen, werden geschlossen. Geschlossene Unterpfade bleiben, wie sie sind.
 * Liefert die neue Liste und, welche Eingaben in welchem Ergebnis aufgegangen sind.
 */
export function joinSubs(subs: SubPath[], tol: number): { subs: SubPath[]; joins: number; origin: number[][] } {
  const ends: End[] = [];
  subs.forEach((sp, i) => {
    if (!isOpen(sp)) return;
    ends.push({ i, e: 0, p: sp.nodes[0] }, { i, e: 1, p: sp.nodes[sp.nodes.length - 1] });
  });
  // Kandidatenpaare über ein Raster finden, dann die nächsten zuerst verbinden
  const cell = Math.max(tol, 1e-6);
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${x},${y}`;
  ends.forEach((en, k) => {
    const kk = key(Math.floor(en.p.x / cell), Math.floor(en.p.y / cell));
    (grid.get(kk) ?? grid.set(kk, []).get(kk)!).push(k);
  });
  const pairs: [number, number, number][] = [];
  ends.forEach((en, k) => {
    const gx = Math.floor(en.p.x / cell),
      gy = Math.floor(en.p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of grid.get(key(gx + dx, gy + dy)) ?? []) {
          if (j <= k) continue;
          const o = ends[j];
          const d = dist(en.p, o.p);
          if (d > tol) continue;
          // Anfang und Ende desselben Pfads: nur wenn er sich wirklich schließen lässt
          if (o.i === en.i && !closable(subs[en.i])) continue;
          pairs.push([d, k, j]);
        }
  });
  pairs.sort((a, b) => a[0] - b[0]);
  const link = new Int32Array(ends.length).fill(-1);
  let joins = 0;
  for (const [, k, j] of pairs) {
    if (link[k] >= 0 || link[j] >= 0) continue;
    link[k] = j;
    link[j] = k;
    joins++;
  }
  if (!joins) return { subs, joins: 0, origin: subs.map((_, i) => [i]) };

  // Enden je Unterpfad nachschlagen
  const endIdx = new Map<number, [number, number]>();
  ends.forEach((en, k) => {
    const v = endIdx.get(en.i) ?? [-1, -1];
    v[en.e] = k;
    endIdx.set(en.i, v);
  });
  const used = new Set<number>();
  const out: SubPath[] = [];
  const origin: number[][] = [];
  const walk = (startSub: number, enterEnd: 0 | 1) => {
    // Kette ab startSub, die bei enterEnd betreten wird
    let cur = startSub,
      at = enterEnd;
    const res: Node[] = [];
    const from: number[] = [];
    let closed = false;
    for (;;) {
      used.add(cur);
      from.push(cur);
      const sp = copySub(subs[cur]);
      if (at === 1) reverseSub(sp);
      if (!res.length) res.push(...sp.nodes);
      else {
        // letzten Knoten der Kette mit dem ersten des neuen Stücks verschmelzen
        const e = res[res.length - 1],
          s = sp.nodes[0];
        const m = lerp(e, s, 0.5);
        const sh = (h: Pt | undefined, n: Pt) => (h ? { x: h.x + m.x - n.x, y: h.y + m.y - n.y } : undefined);
        const joined: Node = { x: m.x, y: m.y };
        const ci = sh(e.cin, e),
          co = sh(s.cout, s);
        if (ci) joined.cin = ci;
        if (co) joined.cout = co;
        res[res.length - 1] = joined;
        res.push(...sp.nodes.slice(1));
      }
      const exitK = endIdx.get(cur)![at === 0 ? 1 : 0];
      const nk = link[exitK];
      if (nk < 0) break;
      const nxt = ends[nk];
      if (nxt.i === startSub && nxt.e === enterEnd) {
        closed = true;
        break;
      }
      if (used.has(nxt.i)) break;
      cur = nxt.i;
      at = nxt.e;
    }
    const sp: SubPath = { closed: false, nodes: res };
    if (closed && res.length >= 2) mergeEnds(sp, lerp(res[0], res[res.length - 1], 0.5));
    out.push(sp);
    origin.push(from);
  };
  subs.forEach((sp, i) => {
    if (isOpen(sp)) return;
    out.push(sp);
    origin.push([i]);
  });
  // Erst Ketten mit freiem Ende (von dort aus laufen), dann übrige Ringe
  subs.forEach((sp, i) => {
    if (!isOpen(sp) || used.has(i)) return;
    const [k0, k1] = endIdx.get(i)!;
    if (link[k0] < 0) walk(i, 0);
    else if (link[k1] < 0) walk(i, 1);
  });
  subs.forEach((sp, i) => {
    if (isOpen(sp) && !used.has(i)) walk(i, 0);
  });
  return { subs: out, joins, origin };
}

// ---------- Zerlegen ----------

/** Unterpfad in seine einzelnen Geraden und Kurven zerlegen (Break Apart) */
export function breakApart(sp: SubPath): SubPath[] {
  return segments(sp).map((s) => {
    const a: Node = { x: s.a.x, y: s.a.y },
      b: Node = { x: s.b.x, y: s.b.y };
    if (s.a.cout) a.cout = cp(s.a.cout);
    if (s.b.cin) b.cin = cp(s.b.cin);
    return { closed: false, nodes: [a, b] };
  });
}

/** Pfad an Knoten idx aufbrechen (Knoteneditor, Taste B). Liefert die Teile oder null. */
export function breakAtNode(sp: SubPath, idx: number): SubPath[] | null {
  const n = sp.nodes.length;
  if (idx < 0 || idx >= n || n < 2) return null;
  if (sp.closed) {
    const nodes = sp.nodes.slice(idx).concat(sp.nodes.slice(0, idx)).map(copyNode);
    const first = nodes[0];
    const end: Node = { x: first.x, y: first.y };
    if (first.cin) end.cin = first.cin;
    delete first.cin;
    first.smooth = end.smooth = false;
    return [{ closed: false, nodes: [...nodes, end] }];
  }
  if (idx === 0 || idx === n - 1) return null;
  const a = sp.nodes.slice(0, idx + 1).map(copyNode),
    b = sp.nodes.slice(idx).map(copyNode);
  delete a[a.length - 1].cout;
  delete b[0].cin;
  a[a.length - 1].smooth = b[0].smooth = false;
  return [
    { closed: false, nodes: a },
    { closed: false, nodes: b },
  ];
}

// ---------- Teilstücke ----------

export function piecesOf(sp: SubPath): Piece[] {
  return segments(sp).map((s) => ({ a: s.a, c1: s.c1, c2: s.c2, b: s.b, curve: s.curve }));
}

/** Teil [t0, t1] eines Segments (exakt, de Casteljau) */
export function subPiece(p: Piece, t0: number, t1: number): Piece {
  if (!p.curve) return { a: lerp(p.a, p.b, t0), c1: lerp(p.a, p.b, t0), c2: lerp(p.a, p.b, t1), b: lerp(p.a, p.b, t1), curve: false };
  // erst bei t1 teilen (linke Hälfte), dann die linke Hälfte bei t0/t1 (rechte Hälfte davon)
  const left = (q: Piece, t: number): Piece => {
    const p01 = lerp(q.a, q.c1, t), p12 = lerp(q.c1, q.c2, t), p23 = lerp(q.c2, q.b, t);
    const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
    return { a: q.a, c1: p01, c2: p012, b: lerp(p012, p123, t), curve: true };
  };
  const right = (q: Piece, t: number): Piece => {
    const p01 = lerp(q.a, q.c1, t), p12 = lerp(q.c1, q.c2, t), p23 = lerp(q.c2, q.b, t);
    const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
    return { a: lerp(p012, p123, t), c1: p123, c2: p23, b: q.b, curve: true };
  };
  let q = t1 < 1 ? left(p, t1) : p;
  if (t0 > 0) q = right(q, t1 > 0 ? t0 / t1 : 0);
  return q;
}

/** Punkt zum Pfadparameter u (Segmentindex + t) */
export function pointAt(sp: SubPath, u: number): Pt {
  const ps = piecesOf(sp);
  const k = Math.min(ps.length - 1, Math.max(0, Math.floor(u)));
  const p = ps[k];
  const t = Math.min(1, Math.max(0, u - k));
  return p.curve ? bezierPt(p.a, p.c1, p.c2, p.b, t) : lerp(p.a, p.b, t);
}

/**
 * Teilstück von u0 bis u1 als offener Unterpfad. Bei geschlossenen Pfaden darf es über den Anfang laufen (u1 ≤ u0).
 */
export function extract(sp: SubPath, u0: number, u1: number): SubPath {
  const ps = piecesOf(sp);
  const n = ps.length;
  if (sp.closed && u1 <= u0) u1 += n;
  const nodes: Node[] = [];
  for (let k = Math.floor(u0); k < u1 - 1e-12; k++) {
    const ta = Math.max(u0 - k, 0),
      tb = Math.min(u1 - k, 1);
    if (tb - ta < 1e-9) continue;
    const idx = ((k % n) + n) % n;
    const q = subPiece(ps[idx], ta, tb);
    if (!nodes.length) nodes.push({ x: q.a.x, y: q.a.y });
    const prev = nodes[nodes.length - 1];
    const nb: Node = { x: q.b.x, y: q.b.y };
    if (q.curve) {
      prev.cout = { x: q.c1.x, y: q.c1.y };
      nb.cin = { x: q.c2.x, y: q.c2.y };
    }
    // endet das Stück an einem Originalknoten, bleibt dessen Glättung
    if (tb === 1 && sp.nodes[(idx + 1) % sp.nodes.length].smooth) nb.smooth = true;
    nodes.push(nb);
  }
  if (nodes.length) nodes[0].smooth = nodes[nodes.length - 1].smooth = false;
  return { closed: false, nodes };
}

// ---------- Schnittpunkte ----------

/** Toleranz der Schnittpunktsuche (mm) */
const FLAT = 1e-4;

function bbox(p: Piece) {
  const xs = [p.a.x, p.c1.x, p.c2.x, p.b.x],
    ys = [p.a.y, p.c1.y, p.c2.y, p.b.y];
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function flat(p: Piece) {
  if (!p.curve) return true;
  const dx = p.b.x - p.a.x,
    dy = p.b.y - p.a.y;
  const l = Math.hypot(dx, dy);
  if (l < FLAT) return dist(p.a, p.c1) < FLAT && dist(p.a, p.c2) < FLAT;
  const d = (q: Pt) => Math.abs((q.x - p.a.x) * dy - (q.y - p.a.y) * dx) / l;
  return d(p.c1) < FLAT && d(p.c2) < FLAT;
}

/** Schnittpunkte zweier Segmente als Parameterpaare (tA, tB) */
export function intersectPieces(A: Piece, B: Piece): [number, number][] {
  const out: [number, number][] = [];
  let budget = 4000;
  const rec = (a: Piece, a0: number, a1: number, b: Piece, b0: number, b1: number) => {
    if (--budget < 0) return;
    const ba = bbox(a),
      bb = bbox(b);
    const e = 1e-7;
    if (ba.x1 < bb.x0 - e || bb.x1 < ba.x0 - e || ba.y1 < bb.y0 - e || bb.y1 < ba.y0 - e) return;
    const fa = flat(a),
      fb = flat(b);
    if (fa && fb) {
      // Gerade gegen Gerade
      const rx = a.b.x - a.a.x, ry = a.b.y - a.a.y, sx = b.b.x - b.a.x, sy = b.b.y - b.a.y;
      const den = rx * sy - ry * sx;
      const la = Math.hypot(rx, ry), lb = Math.hypot(sx, sy);
      if (Math.abs(den) < 1e-12 * Math.max(1, la * lb)) return; // parallel oder deckungsgleich
      const qx = b.a.x - a.a.x, qy = b.a.y - a.a.y;
      const ta = (qx * sy - qy * sx) / den,
        tb = (qx * ry - qy * rx) / den;
      const ea = la > 0 ? 1e-6 / la : 0,
        eb = lb > 0 ? 1e-6 / lb : 0;
      if (ta < -ea || ta > 1 + ea || tb < -eb || tb > 1 + eb) return;
      const ca = Math.min(1, Math.max(0, ta)),
        cb = Math.min(1, Math.max(0, tb));
      out.push([a0 + (a1 - a0) * ca, b0 + (b1 - b0) * cb]);
      return;
    }
    // die weniger flache bzw. größere Kurve halbieren
    const sa = fa ? 0 : Math.max(ba.x1 - ba.x0, ba.y1 - ba.y0),
      sb = fb ? 0 : Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0);
    if (sa >= sb) {
      const m = (a0 + a1) / 2;
      rec(subPiece(a, 0, 0.5), a0, m, b, b0, b1);
      rec(subPiece(a, 0.5, 1), m, a1, b, b0, b1);
    } else {
      const m = (b0 + b1) / 2;
      rec(a, a0, a1, subPiece(b, 0, 0.5), b0, m);
      rec(a, a0, a1, subPiece(b, 0.5, 1), m, b1);
    }
  };
  rec(A, 0, 1, B, 0, 1);
  return out;
}

/**
 * Schnittstellen eines Unterpfads mit anderen Kurven und mit sich selbst, als sortierte Pfadparameter
 * (Segmentindex + t). Berührungen an den Enden offener Pfade zählen nicht als Schnitt.
 */
export function cutParams(sp: SubPath, others: SubPath[]): number[] {
  const ps = piecesOf(sp);
  const n = ps.length;
  const us: number[] = [];
  const boxes = ps.map(bbox);
  for (const o of others)
    for (const q of piecesOf(o)) {
      const bq = bbox(q);
      ps.forEach((p, k) => {
        const b = boxes[k];
        if (b.x1 < bq.x0 - FLAT || bq.x1 < b.x0 - FLAT || b.y1 < bq.y0 - FLAT || bq.y1 < b.y0 - FLAT) return;
        for (const [ta] of intersectPieces(p, q)) us.push(k + ta);
      });
    }
  // Enden offener Kurven, die auf dem Pfad liegen (T-Stoß, oder Reste eines vorigen Trimmens, deren Ende
  // nur bis auf die Rechengenauigkeit auf dieser Kurve liegt)
  for (const o of others) {
    if (o.closed || o.nodes.length < 2) continue;
    for (const e of [o.nodes[0], o.nodes[o.nodes.length - 1]]) {
      const r = nearestParam(sp, e);
      if (r.d < SAME_PT) us.push(r.u);
    }
  }
  // mit sich selbst (Nachbarsegmente berühren sich am gemeinsamen Knoten, das ist kein Schnitt)
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (sp.closed && i === 0 && j === n - 1);
      const shared = j === i + 1 ? ps[i].b : ps[i].a;
      for (const [ta, tb] of intersectPieces(ps[i], ps[j])) {
        const p = pointAt(sp, i + ta);
        if (adjacent && dist(p, shared) < SAME_PT) continue;
        us.push(i + ta, j + tb);
      }
    }
  us.sort((a, b) => a - b);
  // Doppelte (gleicher Ort) zusammenfassen, Enden offener Pfade auslassen
  const out: number[] = [];
  // (derselbe Ort an fast gleicher Stelle des Pfads, etwa an einem Knoten zwischen zwei Segmenten; ein
  // Selbstschnitt trifft denselben Ort dagegen an zwei weit auseinanderliegenden Stellen)
  let lastP: Pt | null = null,
    lastU = -Infinity;
  for (const u of us) {
    const p = pointAt(sp, u);
    if (!sp.closed && (dist(p, sp.nodes[0]) < SAME_PT || dist(p, sp.nodes[sp.nodes.length - 1]) < SAME_PT)) continue;
    if (lastP && u - lastU < 0.01 && dist(p, lastP) < SAME_PT) continue;
    out.push(u);
    lastP = p;
    lastU = u;
  }
  if (sp.closed && out.length > 1 && out[0] + n - out[out.length - 1] < 0.01 && dist(pointAt(sp, out[0]), pointAt(sp, out[out.length - 1])) < SAME_PT) out.pop();
  return out;
}

/** Abschnitt zwischen zwei Schnittstellen, in dem u liegt: [Anfang, Ende]; null = ganzer Pfad (keine Schnitte) */
export function trimSpan(sp: SubPath, cuts: number[], u: number): [number, number] | null {
  const n = piecesOf(sp).length;
  if (sp.closed) {
    if (cuts.length < 2) return null;
    for (let j = 0; j < cuts.length - 1; j++) if (u >= cuts[j] && u < cuts[j + 1]) return [cuts[j], cuts[j + 1]];
    return [cuts[cuts.length - 1], cuts[0]];
  }
  if (!cuts.length) return null;
  const b = [0, ...cuts, n];
  for (let j = 0; j < b.length - 1; j++) if (u >= b[j] && u <= b[j + 1]) return [b[j], b[j + 1]];
  return [b[b.length - 2], n];
}

/** Abschnitt entfernen: was übrig bleibt (0–2 offene Unterpfade) und das entfernte Stück */
export function trimSub(sp: SubPath, span: [number, number] | null): { kept: SubPath[]; removed: SubPath } {
  if (!span) return { kept: [], removed: copySub(sp) };
  const n = piecesOf(sp).length;
  const [s, e] = span;
  const removed = extract(sp, s, e);
  if (sp.closed) return { kept: [extract(sp, e, s)], removed };
  const kept: SubPath[] = [];
  if (s > 1e-9) kept.push(extract(sp, 0, s));
  if (e < n - 1e-9) kept.push(extract(sp, e, n));
  return { kept, removed };
}

/** Nächster Pfadparameter zu Punkt p (für den Mauszeiger), mit Abstand */
export function nearestParam(sp: SubPath, p: Pt): { u: number; d: number } {
  let best = { u: 0, d: Infinity };
  piecesOf(sp).forEach((q, k) => {
    const N = q.curve ? 48 : 1;
    // grob abtasten, dann um das beste Stück verfeinern
    let bt = 0,
      bd = Infinity;
    if (!q.curve) {
      const dx = q.b.x - q.a.x,
        dy = q.b.y - q.a.y;
      const l2 = dx * dx + dy * dy;
      bt = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - q.a.x) * dx + (p.y - q.a.y) * dy) / l2)) : 0;
      bd = dist(lerp(q.a, q.b, bt), p);
    } else {
      for (let i = 0; i <= N; i++) {
        const d = dist(bezierPt(q.a, q.c1, q.c2, q.b, i / N), p);
        if (d < bd) [bd, bt] = [d, i / N];
      }
      let h = 1 / N;
      for (let it = 0; it < 20; it++) {
        h /= 2;
        for (const t of [bt - h, bt + h]) {
          if (t < 0 || t > 1) continue;
          const d = dist(bezierPt(q.a, q.c1, q.c2, q.b, t), p);
          if (d < bd) [bd, bt] = [d, t];
        }
      }
    }
    if (bd < best.d) best = { u: k + bt, d: bd };
  });
  return best;
}
